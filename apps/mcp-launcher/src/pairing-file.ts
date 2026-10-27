import { randomUUID } from 'node:crypto';
import { constants, lstatSync, unlinkSync } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { LauncherError } from './request';
import { nativePrivateFiles } from '../../../packages/mcp/src/node-private-files';

export interface PairingFilePayload {
  kind: 'keepany-mcp-pairing-v1';
  url: string;
  pairingSecret: string;
  requestNonce: string;
  appOrigin: string;
  expiresAt: number;
}

export function defaultPairingPath(directory = join(homedir(), '.keepany', 'mcp')): string {
  return join(directory, `pairing-${randomUUID()}.json`);
}

export function defaultAuthorityPath(directory = join(homedir(), '.keepany', 'mcp')): string {
  return join(directory, 'authority.json');
}

async function verifyPrivateDirectory(path: string) {
  if (process.platform === 'win32') {
    await nativePrivateFiles.checkDirectory(path).catch(error => {
      throw new LauncherError((error as Error).message === 'ENOENT' ? 'pairing-directory-unavailable' : 'pairing-directory-unsafe');
    });
    return;
  }
  const stat = await lstat(path).catch(() => { throw new LauncherError('pairing-directory-unavailable'); });
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
    throw new LauncherError('pairing-directory-unsafe');
  }
}

export async function prepareDefaultDirectory() {
  const base = join(homedir(), '.keepany');
  const directory = join(base, 'mcp');
  for (const item of [base, directory]) {
    if (process.platform === 'win32') {
      await nativePrivateFiles.createDirectory(item).catch(() => { throw new LauncherError('pairing-directory-unsafe'); });
      continue;
    }
    await mkdir(item, { mode: 0o700 }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new LauncherError('pairing-directory-unavailable');
    });
    await verifyPrivateDirectory(item);
  }
  return directory;
}

/** Explicit state directories must exist already; never create arbitrary parent chains. */
export async function prepareStateDirectory(path: string) {
  if (!isAbsolute(path)) throw new LauncherError('state-directory-not-absolute');
  await verifyPrivateDirectory(path);
  return path;
}

export interface PairingFile {
  path: string;
  remove(): Promise<void>;
  removeSync(): void;
}

export async function writePairingFile(path: string, payload: PairingFilePayload): Promise<PairingFile> {
  if (!isAbsolute(path)) throw new LauncherError('pairing-path-not-absolute');
  await verifyPrivateDirectory(dirname(path));
  if (process.platform === 'win32') {
    const file = await nativePrivateFiles.pairing(path, JSON.stringify(payload)).catch(error => {
      throw new LauncherError((error as Error).message === 'EEXIST' ? 'pairing-file-exists' : 'pairing-file-unavailable');
    });
    return { path, remove: file.release, removeSync: file.releaseOnExit };
  }
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new LauncherError('pairing-file-exists');
    throw new LauncherError('pairing-file-unavailable');
  }
  const created = await file.stat();
  let identity: { ino: number; dev: number } = { ino: created.ino, dev: created.dev };
  const removeOwned = async () => {
    const current = await lstat(path).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (current && current.ino === identity.ino && current.dev === identity.dev &&
      current.isFile() && !current.isSymbolicLink()) await unlink(path);
  };
  try {
    await file.writeFile(JSON.stringify(payload));
    await file.sync();
    const stat = await file.stat();
    if ((stat.mode & 0o777) !== 0o600 || !stat.isFile() || stat.nlink !== 1) throw new LauncherError('pairing-file-unsafe');
    identity = { ino: stat.ino, dev: stat.dev };
  } catch (error) {
    await file.close();
    await removeOwned().catch(() => undefined);
    throw error;
  }
  await file.close();
  try {
    const directory = await open(dirname(path), constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await removeOwned().catch(() => undefined);
    throw error;
  }

  const matches = (stat: { ino: number; dev: number; isFile(): boolean; isSymbolicLink(): boolean }) =>
    stat.ino === identity.ino && stat.dev === identity.dev && stat.isFile() && !stat.isSymbolicLink();
  return {
    path,
    remove: removeOwned,
    removeSync() {
      try {
        const current = lstatSync(path);
        if (matches(current)) unlinkSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
  };
}
