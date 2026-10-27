import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export const intakeMetadataPath = '/__keepany_intake__/url-metadata';
const maxHtmlBytes = 1024 * 1024;
const timeoutMs = 8000;

function metadataError(code) { return Object.assign(new Error(code), { code }); }

export function isPublicMetadataAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    // Only global unicast. This excludes loopback, mapped IPv4, unique/local,
    // link-local, multicast and the IPv6 translation ranges in one check.
    const parts = address.toLowerCase().split(':');
    const first = Number.parseInt(parts[0], 16), second = Number.parseInt(parts[1] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff
      && !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
      && first !== 0x2002; // Deprecated 6to4 can encode a private IPv4 target.
  }
  return false;
}

function targetUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048) throw metadataError('metadata-url');
  let url;
  try { url = new URL(value); } catch { throw metadataError('metadata-url'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw metadataError('metadata-url');
  url.hash = '';
  return url;
}

async function targetAddress(url, testAllowedOrigins, signal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(hostname);
  const addresses = literal ? [{ address: hostname, family: literal }]
    : await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    ]);
  // Dependency injection is for isolated module tests only. The normal Vite
  // and portable routes never pass it; clients cannot request an exception.
  const testLoopback = testAllowedOrigins?.includes(url.origin)
    && addresses.every(item => ['127.0.0.1', '::1'].includes(item.address));
  if (!addresses.length || (!testLoopback && addresses.some(item => !isPublicMetadataAddress(item.address)))) {
    throw metadataError('metadata-private');
  }
  return addresses[0];
}

async function fetchOne(url, address, signal) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = transport(url, {
      signal, agent: false, family: address.family, autoSelectFamily: false,
      // Pin the validated DNS answer for this connection, keeping TLS SNI and
      // certificate verification on the original hostname.
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      headers: { accept: 'text/html, application/xhtml+xml', 'accept-encoding': 'identity', 'user-agent': 'KeepAny-Metadata/1.0' },
    }, response => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.destroy();
        resolve({ redirect: location });
        return;
      }
      if (status < 200 || status >= 300) { response.destroy(); reject(metadataError('metadata-http')); return; }
      const type = response.headers['content-type'] ?? '';
      if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(type)) {
        response.destroy(); reject(metadataError('metadata-type')); return;
      }
      if ((response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
        || Number(response.headers['content-length'] ?? 0) > maxHtmlBytes) {
        response.destroy(); reject(metadataError('metadata-limit')); return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxHtmlBytes) { response.destroy(); reject(metadataError('metadata-limit')); }
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(type)?.[1] ?? 'utf-8';
          const html = new TextDecoder(charset, { fatal: true }).decode(Buffer.concat(chunks));
          resolve({ html });
        } catch { reject(metadataError('metadata-encoding')); }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

export async function readUrlMetadataHtml(value, options = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  let url = targetUrl(value);
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      const address = await targetAddress(url, options.testAllowedOrigins, signal);
      const result = await fetchOne(url, address, signal);
      if ('html' in result) return { url: url.href, html: result.html };
      if (!result.redirect || redirects === 4) throw metadataError('metadata-redirect');
      url = targetUrl(new URL(result.redirect, url).href);
    }
  } catch (error) {
    if (signal.aborted) throw metadataError('metadata-timeout');
    if (typeof error?.code === 'string' && error.code.startsWith('metadata-')) throw error;
    throw metadataError('metadata-network');
  }
  throw metadataError('metadata-redirect');
}

export function createUrlMetadataHandler(expectedOrigin, options = {}) {
  const expected = new URL(expectedOrigin);
  let active = 0;
  return async function urlMetadata(request) {
    const json = (value, status = 200) => new Response(JSON.stringify(value), {
      status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
    if (request.method !== 'POST') return json({ error: 'metadata-method' }, 405);
    if (request.headers.get('host') !== expected.host || request.headers.get('origin') !== expected.origin
      || request.headers.get('x-keepany-intake') !== 'metadata'
      || (request.headers.get('sec-fetch-site') && request.headers.get('sec-fetch-site') !== 'same-origin')) {
      return json({ error: 'metadata-forbidden' }, 403);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return json({ error: 'metadata-body' }, 415);
    if (active >= 4) return json({ error: 'metadata-busy' }, 429);
    active++;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]);
    let rejectAborted;
    const aborted = new Promise((_, reject) => { rejectAborted = () => reject(metadataError('metadata-timeout')); });
    signal.addEventListener('abort', rejectAborted, { once: true });
    // The same deadline bounds request input and outbound redirects together.
    // This promise is observed below even for a bodyless/invalid request.
    aborted.catch(() => {});
    try {
      const length = request.headers.get('content-length');
      if (length && (!/^\d+$/.test(length) || Number(length) > 4096)) return json({ error: 'metadata-body' }, 413);
      const reader = request.body?.getReader();
      const chunks = [];
      let bytes = 0;
      if (reader) {
        try {
          for (;;) {
            const chunk = await Promise.race([reader.read(), aborted]);
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 4096) { await reader.cancel(); return json({ error: 'metadata-body' }, 413); }
            chunks.push(chunk.value);
          }
        } finally { if (signal.aborted) await reader.cancel(); reader.releaseLock(); }
      }
      const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'url')) return json({ error: 'metadata-body' }, 400);
      return json(await readUrlMetadataHtml(input.url, { ...options, signal }));
    } catch (error) {
      const known = typeof error?.code === 'string' && error.code.startsWith('metadata-');
      return json({ error: known ? error.code : 'metadata-body' }, known ? 422 : 400);
    } finally { signal.removeEventListener('abort', rejectAborted); active--; }
  };
}

/** Connect-style adapter, used by Vite's dev and preview servers. */
export function createUrlMetadataMiddleware(expectedOrigin, options = {}) {
  const handle = createUrlMetadataHandler(expectedOrigin, options);
  return async (incoming, outgoing, next) => {
    if (incoming.url?.split('?')[0] !== intakeMetadataPath) return next();
    try {
      const controller = new AbortController();
      outgoing.on('close', () => { if (!outgoing.writableEnded) controller.abort(); });
      const request = new Request(`${expectedOrigin}${intakeMetadataPath}`, {
        method: incoming.method, headers: incoming.headers, signal: controller.signal,
        ...(!['GET', 'HEAD'].includes(incoming.method ?? 'GET') ? { body: incoming, duplex: 'half' } : {}),
      });
      const response = await handle(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      outgoing.end(JSON.stringify({ error: 'metadata-body' }));
    }
  };
}
