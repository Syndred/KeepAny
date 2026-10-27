import { constants } from 'node:fs';
import { open, mkdir, lstat, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AuthorityState, AuthorityStorage } from './authority';
import { nativePrivateFiles } from './node-private-files';

const initial: AuthorityState = { grants: [], previews: [], operations: [], audit: [] };
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Local single-host file store. Atomic replacement keeps grants, approvals and receipts after restart.
// A crashed lock intentionally fails closed until its owner removes the stale .lock file.
export class FileAuthorityStorage implements AuthorityStorage {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly path: string) {}

  private async prepare() {
    const directory = dirname(this.path);
    if (process.platform === 'win32') {
      await nativePrivateFiles.createDirectory(directory);
      return;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const dir = await lstat(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077) !== 0) throw Error('authority-directory-permissions');
    try {
      const item = await lstat(this.path);
      if (!item.isFile() || item.isSymbolicLink() || (item.mode & 0o077) !== 0) throw Error('authority-file-permissions');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async read(): Promise<AuthorityState> {
    await this.prepare();
    if (process.platform === 'win32') {
      const data = await nativePrivateFiles.readState(this.path);
      return data === null ? structuredClone(initial) : this.parse(data);
    }
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as AuthorityState;
      if (!Array.isArray(value.grants) || !Array.isArray(value.previews) ||
        !Array.isArray(value.operations) || !Array.isArray(value.audit)) throw Error('authority-file-invalid');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(initial);
      throw error;
    }
  }

  private parse(data: string): AuthorityState {
    const value = JSON.parse(data) as AuthorityState;
    if (!Array.isArray(value.grants) || !Array.isArray(value.previews) ||
      !Array.isArray(value.operations) || !Array.isArray(value.audit)) throw Error('authority-file-invalid');
    return value;
  }

  private async updateWindows<T>(change: (state: AuthorityState) => T | Promise<T>): Promise<T> {
    await this.prepare();
    let transaction: Awaited<ReturnType<typeof nativePrivateFiles.transaction>> | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { transaction = await nativePrivateFiles.transaction(this.path); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; await pause(50); }
    }
    if (!transaction) throw Error('authority-locked');
    try {
      const state = transaction.data === null ? structuredClone(initial) : this.parse(transaction.data);
      const result = await change(state);
      await transaction.commit(JSON.stringify(state));
      return result;
    } finally { await transaction.release(); }
  }

  async update<T>(change: (state: AuthorityState) => T | Promise<T>): Promise<T> {
    const work = this.queue.then(async () => {
      if (process.platform === 'win32') return this.updateWindows(change);
      await this.prepare();
      const lockPath = `${this.path}.lock`;
      let lock: Awaited<ReturnType<typeof open>> | undefined;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600); break; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          await pause(50);
        }
      }
      if (!lock) throw Error('authority-locked');
      let temporary = '';
      try {
        const state = await this.read();
        const result = await change(state);
        temporary = `${this.path}.${randomUUID()}.tmp`;
        const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
        try { await file.writeFile(JSON.stringify(state)); await file.sync(); }
        finally { await file.close(); }
        await rename(temporary, this.path);
        temporary = '';
        const directory = await open(dirname(this.path), constants.O_RDONLY);
        try { await directory.sync(); } finally { await directory.close(); }
        return result;
      } finally {
        if (temporary) await unlink(temporary).catch(() => undefined);
        await lock.close();
        await unlink(lockPath);
      }
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
}
