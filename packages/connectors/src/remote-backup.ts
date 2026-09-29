import { z } from 'zod';
import { decryptBackup, encryptBackup } from '../../local-db/src/backup-crypto';
import { inspectArchive } from '../../local-db/src';

const MAX_REMOTE_BYTES = 100 * 1024 * 1024 + 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface BackupTransport {
  put(ciphertext: Uint8Array): Promise<void>;
  get(): Promise<Uint8Array>;
}

export interface RemoteBackupReceipt {
  format: 'keepany-remote-backup'; version: 1; ciphertextSha256: string;
  ciphertextSize: number; createdAt: string;
}

const receiptSchema = z.object({
  format: z.literal('keepany-remote-backup'), version: z.literal(1),
  ciphertextSha256: z.string().regex(/^[0-9a-f]{64}$/),
  ciphertextSize: z.number().int().min(52).max(MAX_REMOTE_BYTES),
  createdAt: z.string().datetime(),
});

export function parseRemoteBackupReceipt(value: unknown): RemoteBackupReceipt {
  return receiptSchema.parse(value);
}

function safeEndpoint(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw Error('backup-endpoint'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash ||
      !url.hostname.includes('.') || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
      url.hostname.endsWith('.local') || url.hostname.endsWith('.internal') ||
      /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) throw Error('backup-endpoint');
  return url;
}

function requestTimeout(ms: number): AbortController {
  if (!Number.isInteger(ms) || ms < 1000 || ms > 120_000) throw Error('backup-timeout');
  return new AbortController();
}

async function readLimited(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_BYTES) throw Error('backup-size');
  if (!response.body) throw Error('backup-empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REMOTE_BYTES) throw Error('backup-size');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

async function request(
  fetchImpl: typeof fetch, endpoint: URL, method: 'PUT' | 'GET',
  bytes: Uint8Array | undefined, headers: HeadersInit | undefined, timeoutMs: number,
): Promise<Uint8Array | undefined> {
  const controller = requestTimeout(timeoutMs);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers, body: bytes ? new Blob([bytes as BlobPart]) : undefined, signal: controller.signal,
    });
    if (method === 'PUT') {
      if (![200, 201, 204].includes(response.status)) throw Error('backup-http');
      return;
    }
    if (response.status !== 200) throw Error('backup-http');
    return await readLimited(response);
  } finally { clearTimeout(timer); }
}

export function createS3PresignedTransport(options: {
  putUrl: string; getUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number;
}): BackupTransport {
  const putUrl = safeEndpoint(options.putUrl);
  const getUrl = safeEndpoint(options.getUrl);
  if (putUrl.origin !== getUrl.origin || putUrl.pathname !== getUrl.pathname) throw Error('backup-object-mismatch');
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    put: async bytes => {
      if (bytes.length > MAX_REMOTE_BYTES) throw Error('backup-size');
      await request(fetchImpl, putUrl, 'PUT', bytes, undefined, timeoutMs);
    },
    get: async () => await request(fetchImpl, getUrl, 'GET', undefined, undefined, timeoutMs) as Uint8Array,
  };
}

export function createWebDavTransport(options: {
  objectUrl: string; authorization?: () => Promise<string>; fetchImpl?: typeof fetch; timeoutMs?: number;
}): BackupTransport {
  const endpoint = safeEndpoint(options.objectUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = async (upload: boolean): Promise<Headers> => {
    const result = new Headers();
    if (upload) result.set('Content-Type', 'application/octet-stream');
    const authorization = await options.authorization?.();
    if (authorization) {
      if (/[\r\n]/.test(authorization)) throw Error('backup-authorization');
      result.set('Authorization', authorization);
    }
    return result;
  };
  return {
    put: async bytes => {
      if (bytes.length > MAX_REMOTE_BYTES) throw Error('backup-size');
      await request(fetchImpl, endpoint, 'PUT', bytes, await headers(true), timeoutMs);
    },
    get: async () => await request(fetchImpl, endpoint, 'GET', undefined, await headers(false), timeoutMs) as Uint8Array,
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)))
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function downloadCiphertext(transport: BackupTransport, receipt: RemoteBackupReceipt): Promise<Uint8Array> {
  const valid = parseRemoteBackupReceipt(receipt);
  const bytes = await transport.get();
  if (bytes.length !== valid.ciphertextSize || await sha256(bytes) !== valid.ciphertextSha256) throw Error('backup-readback-mismatch');
  return bytes;
}

export async function uploadEncryptedArchive(archive: Uint8Array, passphrase: string, transport: BackupTransport): Promise<RemoteBackupReceipt> {
  await inspectArchive(archive);
  const ciphertext = await encryptBackup(archive, passphrase);
  if (ciphertext.length > MAX_REMOTE_BYTES) throw Error('backup-size');
  const receipt: RemoteBackupReceipt = {
    format: 'keepany-remote-backup', version: 1,
    ciphertextSha256: await sha256(ciphertext), ciphertextSize: ciphertext.length,
    createdAt: new Date().toISOString(),
  };
  await transport.put(ciphertext);
  const readback = await downloadCiphertext(transport, receipt);
  const restored = await decryptBackup(readback, passphrase);
  if (await sha256(restored) !== await sha256(archive)) throw Error('backup-readback-mismatch');
  await inspectArchive(restored);
  return receipt;
}

export async function downloadVerifiedArchive(receipt: RemoteBackupReceipt, passphrase: string, transport: BackupTransport): Promise<Uint8Array> {
  const ciphertext = await downloadCiphertext(transport, receipt);
  const archive = await decryptBackup(ciphertext, passphrase);
  await inspectArchive(archive);
  return archive;
}

export async function restoreEncryptedArchive(
  receipt: RemoteBackupReceipt, passphrase: string, transport: BackupTransport,
  repository: { restoreArchive(bytes: Uint8Array): Promise<number> },
): Promise<number> {
  const archive = await downloadVerifiedArchive(receipt, passphrase, transport);
  return repository.restoreArchive(archive);
}
