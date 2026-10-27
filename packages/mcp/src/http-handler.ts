import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { McpAccessError, type McpAuthority } from './authority';
import { createKeepAnyMcpServer } from './server';
import type { McpAssetStore, PreviewResult } from './service';

export const MCP_HTTP_REQUEST_LIMIT = 1_000_000;
export const MCP_HTTP_RESPONSE_LIMIT = 8 * 1024 * 1024;
/** Captured by the native HTTP parser, never inferred from the published URL.
 * Browser Request strips Host, so native IO must provide this separately. */
export type McpInboundHttp = { readonly host: string };
type Options = {
  endpoint: string;
  authority: McpAuthority;
  store: McpAssetStore;
  allowedOrigins?: readonly string[];
  onPreview?: (grantId: string, preview: PreviewResult) => void | Promise<void>;
  assertAvailable?: () => void;
};
const failure = (status: number, code: string) => Response.json({ error: code }, { status,
  headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
function ensureJsonResponse() {
  if (typeof Response.json === 'function') return;
  // The SDK also calls this standard static method. WebView 111 predates it.
  // Follow Fetch's JSON serialization/header/constructor steps, retaining all
  // native status validation. Existing implementations are never replaced.
  // https://fetch.spec.whatwg.org/#dom-response-json
  Object.defineProperty(Response, 'json', { configurable: true, writable: true,
    value: function json(data: unknown, init?: ResponseInit): Response {
      const body = JSON.stringify(data);
      if (body === undefined) throw new TypeError('JSON value cannot be serialized');
      const headers = new Headers(init?.headers);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      return new Response(body, { ...init, headers });
    } });
}
async function abortable<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw new McpAccessError('request-cancelled');
  let abort!: () => void;
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(new McpAccessError('request-cancelled'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([work(), stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}

/** Protocol/authority adapter only. The owner must separately provide TLS IO,
 * durable private authority storage, lifecycle shutdown and trusted approval UI.
 * This function never opens a listener or issues/approves a grant. */
export function createKeepAnyMcpHttpHandler(options: Options) {
  ensureJsonResponse();
  const endpoint = new URL(options.endpoint);
  if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname))) ||
    endpoint.username || endpoint.password || endpoint.pathname !== '/mcp' || endpoint.search || endpoint.hash)
    throw Error('mcp-http-endpoint');
  const origins = new Set(options.allowedOrigins ?? []);
  if ([...origins].some(value => { try { return new URL(value).origin !== value; } catch { return true; } }))
    throw Error('mcp-http-origin');
  let closed = false;
  const active = new Map<AbortController, McpHttpHandler | undefined>();
  return {
    async fetch(request: Request, inbound?: McpInboundHttp): Promise<Response> {
      const url = new URL(request.url);
      const headerHost = request.headers.get('host');
      const actualHost = inbound?.host ?? headerHost;
      if (url.href !== endpoint.href || actualHost !== endpoint.host ||
        inbound && headerHost && headerHost !== inbound.host || request.headers.has('cookie') ||
        request.headers.has('origin') && !origins.has(request.headers.get('origin') ?? ''))
        return failure(403, 'mcp-denied');
      if (request.method !== 'POST') return failure(405, 'mcp-method');
      if (closed) return failure(503, 'mcp-stopped');
      if (active.size >= 4) return failure(429, 'mcp-busy');
      const credential = /^Bearer ([0-9a-fA-F-]{36})\.([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '');
      if (!credential) return failure(401, 'mcp-denied');
      const [, grantId, secret] = credential;
      const controller = new AbortController();
      active.set(controller, undefined);
      const abort = () => controller.abort();
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
      const deadline = setTimeout(abort, 30_000);
      let handler: McpHttpHandler | undefined;
      const assertActive = () => {
        if (closed || controller.signal.aborted) throw new McpAccessError('request-cancelled');
        options.assertAvailable?.();
      };
      try {
        assertActive();
        try { await abortable(controller.signal, () => options.authority.requireGrant(grantId, secret)); }
        catch { if (controller.signal.aborted) throw new McpAccessError('request-cancelled'); return failure(401, 'mcp-denied'); }
        assertActive();
        const guarded: McpAssetStore = {
          async get(id) { assertActive(); const result = await options.store.get(id); assertActive(); return result; },
          async list(ids) { assertActive(); const result = await options.store.list(ids); assertActive(); return result; },
          async compareAndSet(id, version, next, assertCanCommit) {
            assertActive();
            const result = await options.store.compareAndSet(id, version, next, async () => {
              assertActive(); await assertCanCommit?.(); assertActive();
            });
            // A cancelled acknowledgement can be uncertain; never replay it.
            assertActive(); return result;
          },
        };
        handler = createMcpHandler(() => createKeepAnyMcpServer({ store: guarded, authority: options.authority,
          grantId, grantSecret: secret, onPreview: async preview => {
            assertActive(); await options.onPreview?.(grantId, preview); assertActive();
          } }), { responseMode: 'json', maxRequestBodySize: MCP_HTTP_REQUEST_LIMIT });
        active.set(controller, handler);
        const protocol = handler;
        const response = await abortable(controller.signal, () => protocol.fetch(new Request(request, { signal: controller.signal })));
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (response.body) {
          const reader = response.body.getReader();
          try {
            while (true) {
              assertActive();
              const value = await abortable(controller.signal, () => reader.read());
              if (value.done) break;
              size += value.value.byteLength;
              if (size > MCP_HTTP_RESPONSE_LIMIT) throw new McpAccessError('response-limit');
              chunks.push(value.value);
            }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        assertActive();
        const headers = new Headers(response.headers);
        headers.set('cache-control', 'no-store'); headers.set('x-content-type-options', 'nosniff');
        return new Response(size ? new Blob(chunks as BlobPart[]) : null, { status: response.status, headers });
      } catch {
        return failure(controller.signal.aborted ? 408 : closed ? 503 : 500, 'mcp-request-failed');
      } finally {
        clearTimeout(deadline); request.signal.removeEventListener('abort', abort);
        active.delete(controller); await handler?.close().catch(() => {});
      }
    },
    async close() {
      closed = true;
      const work = [...active].map(([controller, handler]) => {
        controller.abort(); return handler?.close();
      });
      await Promise.allSettled(work);
    },
  };
}
