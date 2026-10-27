import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PlatformConnections, SessionConnection } from '../../../apps/web/src/platform-connections';
import { allowSyncRoute } from './binding-transport';
import { serviceOrigin } from './service-fetch';

export const backupLimit = 100 * 1024 * 1024 + 1024;
const chunkSize = 256 * 1024;
type Reply = { status: number; headers: Record<string, string>; size: number };
export interface ConnectionsPlugin {
  openSession(options: { origin: string }): Promise<{ sessionId: string }>;
  closeSession(options: { sessionId: string }): Promise<void>;
  sessionRequest(options: { requestId: string; sessionId: string; url: string; method: string; headers: Record<string, string>; bodyBase64: string }): Promise<Reply & { bodyBase64: string }>;
  backupWrite(options: { requestId: string; bodyBase64: string }): Promise<void>;
  backupRequest(options: { requestId: string; url: string; method: string; headers: Record<string, string> }): Promise<Reply>;
  backupRead(options: { requestId: string; offset: number }): Promise<{ bodyBase64: string }>;
  cancel(options: { requestId: string }): Promise<void>;
}
const plugin = registerPlugin<ConnectionsPlugin>('KeepAnyConnections');
function encode(bytes: Uint8Array): string {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
function decode(value: string, limit: number): Uint8Array {
  if (typeof value !== 'string' || value.length > 4 * Math.ceil(limit / 3) || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error('native-connections-response');
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  if (bytes.length > limit) throw Error('native-connections-limit');
  return bytes;
}
export function allowSessionRoute(path: string, method: string): boolean {
  if (path === '/api/auth/get-session') return method === 'GET';
  if (['/api/auth/sign-in/email', '/api/auth/sign-up/email', '/api/auth/sign-out'].includes(path)) return method === 'POST';
  return allowSyncRoute(path, method);
}
function reply(result: Reply, body: BodyInit | null): Response {
  if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599 || result.status >= 300 && result.status < 400 || !Number.isSafeInteger(result.size) || result.size < 0) throw Error('native-connections-response');
  return new Response([204, 205].includes(result.status) ? null : body, { status: result.status, headers: result.headers });
}
function checkNative() {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('KeepAnyConnections')) throw Error('native-connections-unavailable');
}
async function bodyBytes(input: RequestInfo | URL, init: RequestInit): Promise<Uint8Array> {
  const body = init.body;
  if (body === undefined || body === null) return input instanceof Request && !['GET', 'HEAD'].includes(input.method) ? new Uint8Array(await input.clone().arrayBuffer()) : new Uint8Array();
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  throw Error('native-connections-body');
}
/** Requests use distinct native cookie jars; cookies never cross the JS bridge. */
export function createNativeConnections(bridge: ConnectionsPlugin = plugin): PlatformConnections & { sessionFetch(origin: string): typeof fetch | undefined } {
  const sessions = new Map<string, SessionConnection>();
  const run = async <T>(id: string, signal: AbortSignal | null | undefined, action: () => Promise<T>): Promise<T> => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([action(), new Promise<never>((_, reject) => {
        abort = () => { void bridge.cancel({ requestId: id }).catch(() => {}); reject(new DOMException('Aborted', 'AbortError')); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      })]);
    } finally { if (abort) signal?.removeEventListener('abort', abort); }
  };
  return {
    sessionFetch(origin) { return sessions.get(origin)?.fetch; },
    async openSession(origin) {
      checkNative(); const fixed = serviceOrigin(origin);
      if (sessions.has(fixed)) throw Error('native-session-active');
      const { sessionId } = await bridge.openSession({ origin: fixed });
      let closed = false;
      const connection: SessionConnection = { origin: fixed,
        fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
          if (closed) throw Error('native-session-closed');
          const url = new URL(input instanceof Request ? input.url : String(input));
          const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
          if (url.origin !== fixed || url.username || url.password || url.search || url.hash || !allowSessionRoute(url.pathname, method)) throw Error('native-session-target');
          const headers: Record<string, string> = {};
          for (const [name, value] of new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))) {
            if (!['accept', 'content-type', 'x-keepany-account-id', 'x-ciphertext-sha256'].includes(name) || value.length > 4096 || /[\r\n\0]/.test(value)) throw Error('native-session-header');
            headers[name] = value;
          }
          const bytes = await bodyBytes(input, init);
          const limit = /\/attachments\//.test(url.pathname) ? 4 * 1024 * 1024 : 8 * 1024 * 1024;
          if (bytes.length > limit || method === 'GET' && bytes.length) throw Error('native-connections-limit');
          const id = crypto.randomUUID();
          const signal = init.signal !== undefined ? init.signal : input instanceof Request ? input.signal : undefined;
          const result = await run(id, signal, () => bridge.sessionRequest({ requestId: id, sessionId, url: url.href, method, headers, bodyBase64: encode(bytes) }));
          if (closed) throw Error('native-session-closed');
          const received = decode(result.bodyBase64, limit);
          if (received.length !== result.size) throw Error('native-connections-response');
          return reply(result, received as BodyInit);
        }) as typeof fetch,
        async close() { if (closed) return; closed = true; if (sessions.get(fixed) === connection) sessions.delete(fixed); await bridge.closeSession({ sessionId }); },
      };
      sessions.set(fixed, connection); return connection;
    },
    backupFetch(targets) {
      const allowed = new Set(targets.map(target => `${target.method} ${new URL(target.url).href}`));
      return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
        checkNative();
        const url = new URL(input instanceof Request ? input.url : String(input));
        const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || !allowed.has(`${method} ${url.href}`)) throw Error('native-backup-target');
        const headers: Record<string, string> = {};
        for (const [name, value] of new Headers(init.headers !== undefined ? init.headers : input instanceof Request ? input.headers : undefined)) {
          if (!['authorization', 'content-type'].includes(name) || value.length > 16384 || /[\r\n\0]/.test(value)) throw Error('native-backup-header');
          headers[name] = value;
        }
        const id = crypto.randomUUID(), signal = init.signal !== undefined ? init.signal : input instanceof Request ? input.signal : undefined;
        try {
          return await run(id, signal, async () => {
            if (method === 'PUT') {
              const bytes = await bodyBytes(input, init);
              if (bytes.length > backupLimit) throw Error('backup-size');
              for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                await bridge.backupWrite({ requestId: id, bodyBase64: encode(bytes.subarray(offset, offset + chunkSize)) });
              }
            }
            const result = await bridge.backupRequest({ requestId: id, url: url.href, method, headers });
            if (result.size > backupLimit) throw Error('backup-size');
            const chunks: Uint8Array[] = [];
            let offset = 0;
            if (method === 'GET') while (offset < result.size) {
              if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
              const chunk = decode((await bridge.backupRead({ requestId: id, offset })).bodyBase64, chunkSize);
              if (!chunk.length || offset + chunk.length > result.size) throw Error('native-connections-response');
              chunks.push(chunk); offset += chunk.length;
            }
            return reply(result, new Blob(chunks as BlobPart[]));
          });
        } finally { await bridge.cancel({ requestId: id }).catch(() => {}); }
      }) as typeof fetch;
    },
  };
}
