import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { nativePrivateFiles } from '../../../packages/mcp/src/node-private-files';
import { readableFields, writableFields, type ReadField, type WriteField } from '../../../packages/mcp/src/fields';

const maxAgeMs = 5 * 60_000;
const maxFutureSkewMs = 30_000;
const maxRequestBytes = 64 * 1024;
const maxGrantTtlMs = 7 * 24 * 60 * 60_000;

const schema = z.object({
  kind: z.literal('keepany-mcp-local-request-v1'),
  appOrigin: z.string().min(1).max(2_048),
  assetIds: z.array(z.string().min(1).max(96)).min(1).max(500),
  readFields: z.array(z.enum(readableFields)).min(1).max(readableFields.length),
  writeFields: z.array(z.enum(writableFields)).max(writableFields.length),
  ttlMs: z.number().int().min(60_000).max(maxGrantTtlMs),
  createdAt: z.number().int().nonnegative(),
  requestNonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
}).strict();

export type LocalLaunchRequest = Omit<z.infer<typeof schema>, 'readFields' | 'writeFields'> & {
  readFields: ReadField[];
  writeFields: WriteField[];
};

export class LauncherError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function parseLaunchRequest(input: unknown, now = Date.now()): LocalLaunchRequest {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new LauncherError('invalid-request');
  const value = parsed.data;
  if (!Number.isSafeInteger(now) || value.createdAt < now - maxAgeMs || value.createdAt > now + maxFutureSkewMs)
    throw new LauncherError('request-expired');
  let origin: URL;
  try { origin = new URL(value.appOrigin); }
  catch { throw new LauncherError('invalid-origin'); }
  if (origin.origin !== value.appOrigin ||
    (origin.protocol !== 'https:' && !(origin.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)))) {
    throw new LauncherError('invalid-origin');
  }
  if (new Set(value.assetIds).size !== value.assetIds.length ||
    new Set(value.readFields).size !== value.readFields.length ||
    new Set(value.writeFields).size !== value.writeFields.length ||
    value.writeFields.some(field => !value.readFields.includes(field))) {
    throw new LauncherError('invalid-scope');
  }
  return value;
}

export async function readLaunchRequest(path: string, now = Date.now()): Promise<LocalLaunchRequest> {
  if (!isAbsolute(path)) throw new LauncherError('request-path-not-absolute');
  if (process.platform === 'win32') {
    const text = await nativePrivateFiles.readRequest(path).catch(error => {
      const unsafe = ['unsafe-size', 'unsafe-owner'].includes((error as Error).message);
      throw new LauncherError(unsafe ? 'request-file-unsafe' : 'request-file-unavailable');
    });
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new LauncherError('invalid-request'); }
    return parseLaunchRequest(input, now);
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => {
    throw new LauncherError('request-file-unavailable');
  });
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > maxRequestBytes ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
      throw new LauncherError('request-file-unsafe');
    }
    let input: unknown;
    try { input = JSON.parse(await file.readFile('utf8')); }
    catch { throw new LauncherError('invalid-request'); }
    return parseLaunchRequest(input, now);
  } finally { await file.close(); }
}
