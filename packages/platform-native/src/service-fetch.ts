import { Capacitor, CapacitorHttp } from '@capacitor/core';

const maxJsonBytes = 8 * 1024 * 1024;
const maxObjectBytes = 4 * 1024 * 1024;
const objectPath = /^\/workspaces\/[0-9a-f-]{36}\/attachments\/[0-9a-f-]{36}$/i;
const allowedHeaders = new Set(['authorization', 'dpop', 'content-type', 'x-keepany-account-id', 'x-ciphertext-sha256']);
function encode(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
function decode(value: unknown, limit: number): Uint8Array {
  if (typeof value !== 'string' || value.length > 4 * Math.ceil(limit / 3) || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error('native-service-response');
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  if (bytes.length > limit) throw Error('native-service-limit');
  return bytes;
}
export function serviceOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== value || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('native-service-origin');
  return url.origin;
}

/** A caller pins its configured service origin. No redirects or Web fallback. */
export function createNativeServiceFetch(origin: string, allowPath: (path: string, method: string) => boolean,
  plugin: Pick<typeof CapacitorHttp, 'request'> = CapacitorHttp): typeof fetch {
  const fixed = serviceOrigin(origin);
  let active = 0;
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('CapacitorHttp')) throw Error('native-service-unavailable');
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin !== fixed || url.username || url.password || url.search || url.hash || !allowPath(url.pathname, method)) throw Error('native-service-target');
    const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const supplied = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined)), headers: Record<string, string> = {};
    for (const [key, value] of supplied) {
      if (!allowedHeaders.has(key) || value.length > 16384 || /[\r\n\0]/.test(value)) throw Error('native-service-header');
      headers[key] = value;
    }
    const binary = objectPath.test(url.pathname) && method === 'PUT';
    let data: unknown;
    if (init.body !== undefined && init.body !== null || input instanceof Request && !['GET', 'HEAD'].includes(method)) {
      if (method === 'GET' || method === 'HEAD') throw Error('native-service-body');
      const body = init.body ?? (input instanceof Request ? await input.clone().arrayBuffer() : undefined);
      if (binary) {
        const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : null;
        if (!bytes?.length || bytes.length > maxObjectBytes || headers['content-type'] !== 'application/vnd.keepany.ciphertext') throw Error('native-service-body');
        data = encode(bytes);
      } else {
        const value = typeof body === 'string' ? body : body instanceof ArrayBuffer ? new TextDecoder('utf-8', { fatal: true }).decode(body) : null;
        if (value === null || new TextEncoder().encode(value).length > maxJsonBytes || headers['content-type'] !== 'application/json') throw Error('native-service-body');
        try { data = JSON.parse(value); } catch { throw Error('native-service-body'); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('native-service-body');
      }
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (active >= 4) throw Error('native-service-busy');
    active++;
    const pending = Promise.resolve().then(() => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return plugin.request({ url: url.href, method, headers, ...(data === undefined ? {} : { data }),
      ...(binary ? { dataType: 'file' as const } : {}), responseType: 'arraybuffer', disableRedirects: true, connectTimeout: 8000, readTimeout: 30000,
      });
    }).finally(() => { active--; });
    let abort: (() => void) | undefined;
    try {
      const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new DOMException('Aborted', 'AbortError')); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort(); });
      const response = await Promise.race([pending, cancelled]);
      if (typeof response.url !== 'string' || response.url !== url.href || !Number.isInteger(response.status) || response.status < 200 || response.status > 599 || response.status >= 300 && response.status < 400) throw Error('native-service-response');
      const received = new Headers(response.headers);
      // Both fixed native implementations parse application/json even when
      // responseType=arraybuffer; binary success responses are base64 instead.
      const json = received.get('content-type')?.toLowerCase().includes('application/json');
      const bytes = json ? new TextEncoder().encode(JSON.stringify(response.data)) : response.status >= 400 && typeof response.data === 'string' ?
        new TextEncoder().encode(response.data) : decode(response.data, objectPath.test(url.pathname) && method === 'GET' ? maxObjectBytes : maxJsonBytes);
      if (bytes.length > (objectPath.test(url.pathname) && method === 'GET' ? maxObjectBytes : maxJsonBytes)) throw Error('native-service-limit');
      if (Number(received.get('content-length')) > (objectPath.test(url.pathname) ? maxObjectBytes : maxJsonBytes)) throw Error('native-service-limit');
      return new Response([204, 205, 304].includes(response.status) ? null : bytes as BodyInit, { status: response.status, headers: received });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw Error('native-service-network');
    } finally { if (abort) signal?.removeEventListener('abort', abort); }
  }) as typeof fetch;
}
