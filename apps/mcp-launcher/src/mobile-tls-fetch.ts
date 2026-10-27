import { createHash, timingSafeEqual, X509Certificate } from 'node:crypto';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { Agent, request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';

export const MOBILE_MCP_REQUEST_BYTES = 1_000_000;
export const MOBILE_MCP_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MOBILE_MCP_TIMEOUT_MS = 30_000;
const MAX_IN_FLIGHT = 4;
type ErrorCode = 'mobile-mcp-config' | 'mobile-mcp-request' | 'mobile-mcp-busy' |
  'mobile-mcp-aborted' | 'mobile-mcp-stopped' | 'mobile-mcp-timeout' |
  'mobile-mcp-request-limit' | 'mobile-mcp-response-limit' | 'mobile-mcp-network' | 'mobile-mcp-response';

/** Never retain the underlying TLS/HTTP error: it may include endpoints or credentials. */
export class MobileTlsFetchError extends Error {
  constructor(readonly code: ErrorCode) { super(code); this.name = 'MobileTlsFetchError'; }
}
export interface MobileTlsFetchOptions { endpoint: string; certificatePem: string; spkiSha256: string }
export interface MobileTlsFetch { fetch: typeof fetch; close(): void }
type Operation = {
  request?: ClientRequest; response?: IncomingMessage; cancelInput?: () => void;
  error?: MobileTlsFetchError; stop(error: MobileTlsFetchError): void;
};
const failure = (code: ErrorCode) => new MobileTlsFetchError(code);
function privateIpv4(host: string) {
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return host === '127.0.0.1' || a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168;
}
function spki(certificate: X509Certificate) {
  return createHash('sha256').update(certificate.publicKey.export({ format: 'der', type: 'spki' })).digest();
}
const assertLive = (operation: Operation) => { if (operation.error) throw operation.error; };

async function requestBytes(request: Request, operation: Operation): Promise<Buffer> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader(), chunks: Buffer[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  operation.cancelInput = () => { void reader.cancel().catch(() => {}); };
  try {
    while (true) {
      assertLive(operation);
      const value = await reader.read();
      assertLive(operation);
      if (value.done) break;
      size += value.value.byteLength;
      if (size > MOBILE_MCP_REQUEST_BYTES) throw failure('mobile-mcp-request-limit');
      decoder.decode(value.value, { stream: true });
      chunks.push(Buffer.from(value.value));
    }
    decoder.decode();
    return Buffer.concat(chunks, size);
  } catch (error) {
    if (error instanceof MobileTlsFetchError) throw error;
    throw failure('mobile-mcp-request');
  } finally {
    operation.cancelInput = undefined;
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* Cancellation can still be settling the pending read. */ }
  }
}

/** Connection-local trust only. This factory neither starts a listener nor approves a scope. */
export function createMobileTlsFetch(options: MobileTlsFetchOptions): MobileTlsFetch {
  let endpoint: URL, certificate: X509Certificate, pin: Buffer;
  try {
    endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== 'https:' || !privateIpv4(endpoint.hostname) || endpoint.username || endpoint.password ||
      endpoint.pathname !== '/mcp' || endpoint.search || endpoint.hash || endpoint.href !== options.endpoint ||
      !/^[a-fA-F0-9]{64}$/.test(options.spkiSha256) ||
      !/^\s*-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----\s*$/.test(options.certificatePem)) throw failure('mobile-mcp-config');
    certificate = new X509Certificate(options.certificatePem);
    if (certificate.subject !== certificate.issuer || !certificate.verify(certificate.publicKey)) throw failure('mobile-mcp-config');
    pin = Buffer.from(options.spkiSha256, 'hex');
  } catch { throw failure('mobile-mcp-config'); }
  const origin = endpoint.origin;
  const agent = new Agent({ ca: options.certificatePem, rejectUnauthorized: true, keepAlive: false,
    maxSockets: MAX_IN_FLIGHT, maxTotalSockets: MAX_IN_FLIGHT, maxCachedSessions: 0,
    checkServerIdentity(host, peer) {
      // Pinning augments normal SAN verification; it never replaces it.
      const invalidName = checkServerIdentity(host, peer);
      if (invalidName) return failure('mobile-mcp-network');
      try { if (!timingSafeEqual(spki(new X509Certificate(peer.raw)), pin)) return failure('mobile-mcp-network'); }
      catch { return failure('mobile-mcp-network'); }
      return undefined;
    } });
  const active = new Set<Operation>();
  let closed = false;
  const fetcher: typeof fetch = async (input, init) => {
    if (closed) throw failure('mobile-mcp-stopped');
    let request: Request, url: URL;
    try {
      request = new Request(input, init);
      url = new URL(request.url);
      if (url.origin !== origin || !['/mcp', '/pair'].includes(url.pathname) || url.search || url.hash ||
        url.username || url.password || request.method !== 'POST' || request.credentials === 'include' ||
        ['cookie', 'cookie2', 'proxy-authorization', 'transfer-encoding', 'connection', 'upgrade', 'trailer', 'te'].some(key => request.headers.has(key)) ||
        request.headers.has('host') && request.headers.get('host') !== url.host) throw failure('mobile-mcp-request');
    } catch { throw failure('mobile-mcp-request'); }
    if (request.signal.aborted) throw failure('mobile-mcp-aborted');
    if (active.size >= MAX_IN_FLIGHT) throw failure('mobile-mcp-busy');
    let rejectStopped!: (error: MobileTlsFetchError) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
    const operation: Operation = { stop(error) {
      if (operation.error) return;
      operation.error = error;
      operation.cancelInput?.(); operation.response?.destroy(); operation.request?.destroy();
      rejectStopped(error);
    } };
    active.add(operation);
    const abort = () => operation.stop(failure('mobile-mcp-aborted'));
    request.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => operation.stop(failure('mobile-mcp-timeout')), MOBILE_MCP_TIMEOUT_MS);
    const work = async () => {
      const body = await requestBytes(request, operation);
      assertLive(operation);
      const headers = Object.fromEntries(request.headers);
      if (headers['content-length'] !== undefined && headers['content-length'] !== String(body.length)) throw failure('mobile-mcp-request');
      headers['content-length'] = String(body.length); headers['accept-encoding'] = 'identity';
      return new Promise<Response>((resolve, reject) => {
        const fail = (code: ErrorCode) => { operation.stop(failure(code)); reject(operation.error); };
        const outgoing = httpsRequest(url, { method: 'POST', headers, agent }, incoming => {
          operation.response = incoming;
          if ((incoming.statusCode ?? 0) >= 300 && (incoming.statusCode ?? 0) < 400 || incoming.headers['set-cookie'] ||
            incoming.headers['content-encoding'] && incoming.headers['content-encoding'] !== 'identity') { fail('mobile-mcp-response'); return; }
          const declared = incoming.headers['content-length'];
          if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MOBILE_MCP_RESPONSE_BYTES)) { fail('mobile-mcp-response-limit'); return; }
          const chunks: Buffer[] = [], decoder = new TextDecoder('utf-8', { fatal: true });
          let size = 0;
          incoming.on('data', (chunk: Buffer) => {
            if (operation.error) return;
            size += chunk.length;
            if (size > MOBILE_MCP_RESPONSE_BYTES) { fail('mobile-mcp-response-limit'); return; }
            try { decoder.decode(chunk, { stream: true }); } catch { fail('mobile-mcp-response'); return; }
            chunks.push(chunk);
          });
          incoming.once('aborted', () => fail('mobile-mcp-network'));
          incoming.once('error', () => fail('mobile-mcp-network'));
          incoming.once('end', () => {
            if (operation.error) { reject(operation.error); return; }
            try {
              decoder.decode();
              const responseHeaders = new Headers();
              for (const [name, value] of Object.entries(incoming.headers)) {
                if (value === undefined || ['connection', 'keep-alive', 'transfer-encoding', 'trailer', 'upgrade'].includes(name)) continue;
                for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(name, item);
              }
              const status = incoming.statusCode ?? 500;
              resolve(new Response(size && ![204, 205, 304].includes(status) ? Buffer.concat(chunks, size) : null,
                { status, headers: responseHeaders }));
            } catch { fail('mobile-mcp-response'); }
          });
        });
        operation.request = outgoing;
        outgoing.once('error', () => fail('mobile-mcp-network'));
        outgoing.end(body);
      });
    };
    try { return await Promise.race([work(), stopped]); }
    catch (error) { throw operation.error ?? (error instanceof MobileTlsFetchError ? error : failure('mobile-mcp-network')); }
    finally {
      clearTimeout(timer); request.signal.removeEventListener('abort', abort); active.delete(operation);
    }
  };
  return { fetch: fetcher, close() {
    if (closed) return;
    closed = true;
    for (const operation of active) operation.stop(failure('mobile-mcp-stopped'));
    agent.destroy();
  } };
}
