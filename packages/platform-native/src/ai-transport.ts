import { Capacitor, registerPlugin } from '@capacitor/core';
import type { AiConnection, AiFetchFactory } from '../../ai/src';

export const aiRequestLimit = 16 * 1024 * 1024, aiResponseLimit = 8 * 1024 * 1024, aiChunkSize = 256 * 1024;
type AiReply = { status: number; headers: Record<string, string>; size: number };
export interface AiPlugin {
  aiOpen(options: { requestId: string; provider: string; baseURL: string; model: string; headers: Record<string, string>; timeoutMs: number }): Promise<void>;
  aiWrite(options: { requestId: string; bodyBase64: string }): Promise<void>;
  aiRequest(options: { requestId: string }): Promise<AiReply>;
  aiRead(options: { requestId: string; offset: number }): Promise<{ bodyBase64: string }>;
  aiCancel(options: { requestId: string }): Promise<void>;
}
const plugin = registerPlugin<AiPlugin>('KeepAnyConnections');
const providers = new Set(['openai', 'anthropic', 'google', 'deepseek', 'qwen', 'doubao', 'moonshot', 'minimax', 'openrouter', 'ollama', 'compatible']);
const allowedHeaders = new Set(['accept', 'content-type', 'user-agent', 'authorization', 'x-api-key', 'x-goog-api-key', 'anthropic-version', 'anthropic-beta', 'openai-organization', 'openai-project', 'http-referer', 'x-title', 'x-openrouter-title']);
export function aiEndpoint(connection: Readonly<AiConnection>): string {
  const base = new URL(connection.baseURL);
  if (!providers.has(connection.provider) || base.username || base.password || base.search || base.hash || base.href.length > 2048 ||
    base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) ||
    !connection.model.trim() || connection.model.length > 200) throw Error('native-ai-target');
  let value = base.href.replace(/\/+$/, '');
  if (['anthropic', 'minimax'].includes(connection.provider)) return new URL(`${value}/messages`).href;
  if (connection.provider === 'google') {
    const model = connection.model.includes('/') ? connection.model : `models/${connection.model}`;
    // Model IDs are path components, never a way to escape the configured base.
    if (!/^[A-Za-z0-9_./-]+$/.test(model) || model.split('/').some(part => !part || part === '.' || part === '..')) throw Error('native-ai-target');
    return new URL(`${value}/${model}:generateContent`).href;
  }
  if (value.endsWith('/chat/completions')) value = value.slice(0, -'/chat/completions'.length);
  return new URL(`${value}/chat/completions`).href;
}
function encode(bytes: Uint8Array): string {
  let value = ''; for (let at = 0; at < bytes.length; at += 8192) value += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return btoa(value);
}
function decode(value: string): Uint8Array {
  if (typeof value !== 'string' || value.length % 4 || value.length > 4 * Math.ceil(aiChunkSize / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error('native-ai-failed');
  try { const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0)); if (bytes.length > aiChunkSize) throw Error(); return bytes; }
  catch { throw Error('native-ai-failed'); }
}
async function requestBytes(input: RequestInfo | URL, init: RequestInit, signal: AbortSignal): Promise<Uint8Array> {
  const body = init.body !== undefined ? init.body : input instanceof Request ? input.clone().body : undefined;
  if (typeof body === 'string') { if (body.length > aiRequestLimit) throw Error('native-ai-failed'); return new TextEncoder().encode(body); }
  if (body instanceof Blob) { if (body.size > aiRequestLimit) throw Error('native-ai-failed'); return new Uint8Array(await body.arrayBuffer()); }
  if (body instanceof ArrayBuffer) { if (body.byteLength > aiRequestLimit) throw Error('native-ai-failed'); return new Uint8Array(body.slice(0)); }
  if (ArrayBuffer.isView(body)) { if (body.byteLength > aiRequestLimit) throw Error('native-ai-failed'); return new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice(); }
  if (body instanceof ReadableStream) {
    const reader = body.getReader(), chunks: Uint8Array[] = []; let size = 0, done = false;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
    try {
      while (true) {
        const next = await reader.read(); if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (next.done) { done = true; break; }
        if (!(next.value instanceof Uint8Array) || size + next.value.length > aiRequestLimit) throw Error('native-ai-failed');
        chunks.push(next.value.slice()); size += next.value.length;
      }
      const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; } return bytes;
    } finally { signal.removeEventListener('abort', cancel); if (!done) cancel(); reader.releaseLock(); }
  }
  throw Error('native-ai-failed');
}
/** Memory-only, explicitly configured AI POST. Never uses login sessions or backup files. */
export function createNativeAiFetchFactory(bridge: AiPlugin = plugin): AiFetchFactory {
  let active = false;
  return (connection, { timeoutMs }) => {
    const endpoint = aiEndpoint(connection), fixed = { provider: connection.provider, baseURL: connection.baseURL, model: connection.model };
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw Error('native-ai-failed');
    return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('KeepAnyConnections')) throw Error('native-ai-unavailable');
      const signal = init.signal !== undefined ? init.signal : input instanceof Request ? input.signal : undefined;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const url = new URL(input instanceof Request ? input.url : String(input)), method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (url.href !== endpoint || method !== 'POST') throw Error('native-ai-target');
      const headers: Record<string, string> = {}; let headerBytes = 0;
      for (const [name, value] of new Headers(init.headers !== undefined ? init.headers : input instanceof Request ? input.headers : undefined)) {
        headerBytes += new TextEncoder().encode(name + value).length;
        if (!allowedHeaders.has(name) || value.length > 16384 || /[\r\n\0]/.test(value) || headerBytes > 65536) throw Error('native-ai-header');
        headers[name] = value;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(headers['content-type'] ?? '')) throw Error('native-ai-header');
      if (active) throw Error('native-ai-busy'); active = true;
      const id = crypto.randomUUID(), controller = new AbortController(), deadline = Date.now() + timeoutMs;
      let expired = false, abort: (() => void) | undefined;
      const cancel = () => { controller.abort(); void bridge.aiCancel({ requestId: id }).catch(() => {}); };
      const timer = setTimeout(() => { expired = true; cancel(); }, timeoutMs);
      abort = () => cancel(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) cancel();
      const check = () => { if (Date.now() >= deadline) { expired = true; cancel(); } if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError'); };
      const work = async () => {
        check(); const bytes = await requestBytes(input, init, controller.signal); check();
        if (!bytes.length || bytes.length > aiRequestLimit) throw Error('native-ai-failed');
        try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw Error('native-ai-failed'); }
        await bridge.aiOpen({ requestId: id, ...fixed, headers, timeoutMs: Math.max(1, deadline - Date.now()) }); check();
        for (let at = 0; at < bytes.length; at += aiChunkSize) { check(); await bridge.aiWrite({ requestId: id, bodyBase64: encode(bytes.subarray(at, at + aiChunkSize)) }); }
        check(); const result = await bridge.aiRequest({ requestId: id }); check();
        if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599 || result.status >= 300 && result.status < 400 || !Number.isSafeInteger(result.size) || result.size < 0 || result.size > aiResponseLimit) throw Error('native-ai-failed');
        const chunks: Uint8Array[] = []; let offset = 0;
        while (offset < result.size) {
          check(); const bytes = decode((await bridge.aiRead({ requestId: id, offset })).bodyBase64); check();
          if (!bytes.length || offset + bytes.length > result.size) throw Error('native-ai-failed'); chunks.push(bytes); offset += bytes.length;
        }
        return new Response([204, 205].includes(result.status) ? null : new Blob(chunks as BlobPart[]), { status: result.status, headers: result.headers });
      };
      try {
        return await Promise.race([work(), new Promise<never>((_, reject) => { controller.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); if (controller.signal.aborted) reject(new DOMException('Aborted', 'AbortError')); })]);
      } catch (error) {
        if (expired || error && typeof error === 'object' && 'code' in error && error.code === 'TIMEOUT') throw Object.assign(new Error('native-ai-timeout'), { code: 'TIMEOUT' });
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        throw Error('native-ai-failed');
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); await bridge.aiCancel({ requestId: id }).catch(() => {}); active = false;
      }
    }) as typeof fetch;
  };
}
