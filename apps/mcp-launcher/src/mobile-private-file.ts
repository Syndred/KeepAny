import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, parse, resolve } from 'node:path';
import { nativePrivateFiles } from '../../../packages/mcp/src/node-private-files';

const MAX_BYTES = 64 * 1024;
export class MobileSecretFileError extends Error {
  constructor() { super('mobile-mcp-file-unsafe'); this.name = 'MobileSecretFileError'; }
}
type Identity = Pick<BigIntStats, 'dev' | 'ino'>;
const same = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;
function fileSafe(stat: BigIntStats, uid: bigint) {
  return stat.isFile() && stat.nlink === 1n && stat.uid === uid && (stat.mode & 0o777n) === 0o600n &&
    stat.size > 0n && stat.size <= BigInt(MAX_BYTES);
}
function unchanged(a: BigIntStats, b: BigIntStats) {
  return same(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
async function posixRead(path: string): Promise<string> {
  if (typeof process.getuid !== 'function') throw new MobileSecretFileError();
  const uid = BigInt(process.getuid()), parent = dirname(path), root = parse(path).root;
  const chain: { path: string; handle: FileHandle; before: BigIntStats }[] = [];
  let handle: FileHandle | undefined;
  try {
    const paths = [root];
    for (const component of parent.slice(root.length).split('/').filter(Boolean)) paths.push(resolve(paths.at(-1) ?? root, component));
    for (const item of paths) {
      const before = await lstat(item, { bigint: true });
      if (!before.isDirectory() || before.isSymbolicLink()) throw new MobileSecretFileError();
      const directory = await open(item, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      chain.push({ path: item, handle: directory, before });
      if (!same(before, await directory.stat({ bigint: true }))) throw new MobileSecretFileError();
      if (item === parent && (before.uid !== uid || (before.mode & 0o777n) !== 0o700n)) throw new MobileSecretFileError();
    }
    const beforePath = await lstat(path, { bigint: true });
    if (!fileSafe(beforePath, uid) || beforePath.isSymbolicLink()) throw new MobileSecretFileError();
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!same(beforePath, before) || !fileSafe(before, uid)) throw new MobileSecretFileError();
    // Read at most one byte beyond the limit even if an owner concurrently grows the file.
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const value = await handle.read(bytes, size, bytes.length - size, size);
      if (!value.bytesRead) break;
      size += value.bytesRead;
    }
    if (size === 0 || size > MAX_BYTES) throw new MobileSecretFileError();
    const after = await handle.stat({ bigint: true }), afterPath = await lstat(path, { bigint: true });
    if (!fileSafe(after, uid) || !fileSafe(afterPath, uid) || !unchanged(before, after) || !unchanged(after, afterPath)) throw new MobileSecretFileError();
    for (const directory of chain) {
      const current = await lstat(directory.path, { bigint: true }), descriptor = await directory.handle.stat({ bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || !same(current, directory.before) || !same(current, descriptor) ||
        directory.path === parent && (current.uid !== uid || (current.mode & 0o777n) !== 0o700n)) throw new MobileSecretFileError();
    }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, size));
  } finally {
    await handle?.close();
    await Promise.allSettled(chain.map(directory => directory.handle.close()));
  }
}

/** Returns a bounded UTF-8 snapshot; does not parse, chmod, delete or consume it.
 * POSIX retains one descriptor and checks identities before/after reading. It
 * does not claim Windows-style mandatory exclusion of concurrent renames. */
export async function readMobileSecretFile(path: string): Promise<{ text: string }> {
  try {
    if (!isAbsolute(path) || path.includes('\0')) throw new MobileSecretFileError();
    const absolute = resolve(path);
    if (process.platform !== 'win32') return { text: await posixRead(absolute) };
    const held = await nativePrivateFiles.holdDirectory(dirname(absolute));
    try {
      const before = await nativePrivateFiles.inspect(absolute);
      const value = await nativePrivateFiles.readMobileSecret(absolute);
      const after = await nativePrivateFiles.inspect(absolute);
      if (before !== value.identity || value.identity !== after || Buffer.byteLength(value.text, 'utf8') > MAX_BYTES) throw new MobileSecretFileError();
      return { text: value.text };
    } finally { await held.release(); }
  } catch { throw new MobileSecretFileError(); }
}
