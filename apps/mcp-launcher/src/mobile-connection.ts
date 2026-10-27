import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import { z } from 'zod';
import { mobileMcpPairingReplySchema } from '../../../packages/mcp/src/mobile-pairing';
import { nativePrivateFiles } from '../../../packages/mcp/src/node-private-files';
import { prepareDefaultDirectory, prepareStateDirectory } from './pairing-file';
import { readMobileSecretFile } from './mobile-private-file';
import { createMobileTlsFetch } from './mobile-tls-fetch';

const approved = mobileMcpPairingReplySchema.options[1].shape;
const schema = z.strictObject({ kind: z.literal('keepany-mcp-mobile-connection-v1'),
  endpoint: z.string().max(512), certificatePem: z.string().max(16384), spkiSha256: z.string().regex(/^[a-f0-9]{64}$/),
  instanceId: z.uuid(), grantId: approved.grantId, grantSecret: approved.grantSecret, expiresAt: approved.expiresAt, scope: approved.scope });
export type MobileMcpConnectionFile = z.infer<typeof schema>;
export class MobileConnectionError extends Error {
  constructor() { super('mobile-mcp-connection-invalid'); this.name = 'MobileConnectionError'; }
}
export function parseMobileMcpConnectionFile(input: unknown, now = Date.now()): MobileMcpConnectionFile {
  try {
    const value = schema.parse(input);
    if (!new URL(value.endpoint).port || !Number.isSafeInteger(now) || value.expiresAt <= now || value.expiresAt > now + value.scope.ttlMs + 5000 ||
      Buffer.byteLength(JSON.stringify(value), 'utf8') > 65536) throw new MobileConnectionError();
    const check = createMobileTlsFetch(value); check.close();
    return value;
  } catch { throw new MobileConnectionError(); }
}
export async function readMobileMcpConnectionFile(path: string): Promise<MobileMcpConnectionFile> {
  try { return parseMobileMcpConnectionFile(JSON.parse((await readMobileSecretFile(path)).text)); }
  catch { throw new MobileConnectionError(); }
}

async function checkPosixDirectoryChain(directory: string) {
  const root = parse(directory).root, paths = [root];
  for (const component of directory.slice(root.length).split('/').filter(Boolean)) paths.push(resolve(paths.at(-1) ?? root, component));
  const identities: { path: string; dev: number; ino: number }[] = [];
  for (const path of paths) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path === directory &&
      (stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700)) throw new MobileConnectionError();
    identities.push({ path, dev: stat.dev, ino: stat.ino });
  }
  return async () => {
    for (const before of identities) {
      const current = await lstat(before.path);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino)
        throw new MobileConnectionError();
    }
  };
}

/** Persistent exclusive profile, never the temporary delete-on-close pairing writer. */
export async function writeMobileMcpConnectionFile(input: MobileMcpConnectionFile, stateDir?: string): Promise<string> {
  const value = parseMobileMcpConnectionFile(input);
  const directory = stateDir ? await prepareStateDirectory(stateDir) : await prepareDefaultDirectory();
  const path = join(directory, `connection-${randomUUID()}.json`), text = JSON.stringify(value);
  try {
    if (process.platform === 'win32') {
      const identity = await nativePrivateFiles.createFile(path, text);
      if (await nativePrivateFiles.inspect(path) !== identity) throw new MobileConnectionError();
    } else {
      const checkDirectories = await checkPosixDirectoryChain(directory);
      const parent = await lstat(directory);
      const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const identity = await file.stat();
      try {
        if ((identity.mode & 0o777) !== 0o600 || identity.nlink !== 1 || identity.uid !== process.getuid?.()) throw new MobileConnectionError();
        await file.writeFile(text, 'utf8'); await file.sync();
        const current = await lstat(path), currentParent = await lstat(directory);
        if (current.dev !== identity.dev || current.ino !== identity.ino || currentParent.dev !== parent.dev || currentParent.ino !== parent.ino)
          throw new MobileConnectionError();
        await checkDirectories();
      } catch (error) {
        const current = await lstat(path).catch(() => undefined);
        if (current?.isFile() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) await unlink(path);
        throw error;
      } finally { await file.close(); }
      const dir = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await dir.sync(); } finally { await dir.close(); }
    }
    // Read back using the strict importer, including all ancestor/identity checks.
    if (JSON.stringify(await readMobileMcpConnectionFile(path)) !== text) throw new MobileConnectionError();
    return path;
  } catch { throw new MobileConnectionError(); }
}
