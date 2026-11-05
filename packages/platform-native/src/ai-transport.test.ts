import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ native: true, available: true }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => state.native, isPluginAvailable: () => state.available }, registerPlugin: () => ({}) }));
import { aiProviderIds, generateAiText, registerAiFetchFactory, type AiConnection } from '../../ai/src';
import { aiChunkSize, aiEndpoint, aiRequestLimit, aiResponseLimit, createNativeAiFetchFactory, type AiPlugin } from './ai-transport';
const connection = (provider: AiConnection['provider'] = 'openai'): AiConnection => ({ provider, baseURL: 'https://ai.example.test/v1', model: 'synthetic-model', apiKey: 'synthetic-key' });
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
function fixture() {
  const chunks: Uint8Array[] = []; let opened: Parameters<AiPlugin['aiOpen']>[0] | undefined;
  let response = new Uint8Array();
  const bridge: AiPlugin = {
    aiOpen: vi.fn(async options => { opened = options; chunks.length = 0; }),
    aiWrite: vi.fn(async ({ bodyBase64 }) => { chunks.push(Uint8Array.from(atob(bodyBase64), char => char.charCodeAt(0))); }),
    aiRequest: vi.fn(async () => {
      const provider = opened?.provider;
      const result = ['anthropic', 'minimax'].includes(provider ?? '') ? { id: 'synthetic', type: 'message', role: 'assistant', model: 'synthetic-model', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } } :
        provider === 'google' ? { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 }, modelVersion: 'synthetic-model' } :
          { id: 'synthetic', object: 'chat.completion', created: 0, model: 'synthetic-model', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } };
      response = new TextEncoder().encode(JSON.stringify(result)); return { status: 200, headers: { 'content-type': 'application/json' }, size: response.length };
    }),
    aiRead: vi.fn(async ({ offset }) => ({ bodyBase64: encode(response.subarray(offset, offset + aiChunkSize)) })),
    aiCancel: vi.fn(async () => {}),
  };
  return { bridge, chunks, get opened() { return opened; }, body() { const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0)); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; } return JSON.parse(new TextDecoder().decode(bytes)); } };
}
afterEach(() => { state.native = true; state.available = true; vi.restoreAllMocks(); vi.useRealTimers(); });
it.each(aiProviderIds)('uses the actual %s provider SDK through isolated native POST, without Web fetch', async provider => {
  const test = fixture(), web = vi.spyOn(globalThis, 'fetch'), remove = registerAiFetchFactory(createNativeAiFetchFactory(test.bridge));
  try {
    const result = await generateAiText(connection(provider), { prompt: 'synthetic input', json: true });
    expect(result.text).toBe('ok'); expect(web).not.toHaveBeenCalled();
    expect(test.opened).toMatchObject({ provider, baseURL: connection(provider).baseURL, timeoutMs: expect.any(Number) });
    expect(test.opened?.headers['content-type']).toMatch(/^application\/json/);
    const header = ['anthropic', 'minimax'].includes(provider) ? 'x-api-key' : provider === 'google' ? 'x-goog-api-key' : 'authorization';
    expect(test.opened?.headers[header]).toContain('synthetic-key');
    expect(test.opened?.headers.cookie).toBeUndefined(); expect(test.bridge.aiRequest).toHaveBeenCalledOnce(); expect(test.bridge.aiCancel).toHaveBeenCalledOnce();
    expect(test.body().stream).not.toBe(true);
  } finally { remove(); }
});
it('carries the full 14,000,000-character image in bounded memory blocks without narrowing its existing limit', async () => {
  const test = fixture(), remove = registerAiFetchFactory(createNativeAiFetchFactory(test.bridge));
  try {
    await generateAiText(connection(), { prompt: 'synthetic image', image: { data: 'A'.repeat(14_000_000), mediaType: 'image/png' } });
    expect(Math.max(...test.chunks.map(chunk => chunk.length))).toBe(aiChunkSize);
    expect(test.chunks.reduce((size, chunk) => size + chunk.length, 0)).toBeLessThan(aiRequestLimit);
    expect(test.body().messages[0].content[1].image_url.url).toHaveLength('data:image/png;base64,'.length + 14_000_000);
    await expect(generateAiText(connection(), { prompt: 'synthetic', image: { data: 'A'.repeat(14_000_001), mediaType: 'image/png' } })).rejects.toMatchObject({ code: 'invalid-image' });
    expect(test.bridge.aiRequest).toHaveBeenCalledOnce();
  } finally { remove(); }
});
it('pins provider endpoints and preserves explicitly configured HTTP for the three exact loopback names', async () => {
  expect(aiEndpoint({ ...connection(), baseURL: 'https://ai.example.test/v1/chat/completions/' })).toBe('https://ai.example.test/v1/chat/completions');
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) expect(aiEndpoint({ ...connection('ollama'), baseURL: `http://${host}:11434/v1` })).toBe(`http://${host}:11434/v1/chat/completions`);
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    expect(aiEndpoint({ ...connection('compatible'), baseURL: `http://${host}:11434/v1/chat/completions` })).toBe(`http://${host}:11434/v1/chat/completions`);
    expect(aiEndpoint({ ...connection('anthropic'), baseURL: `http://${host}:11434/v1` })).toBe(`http://${host}:11434/v1/messages`);
  }
  for (const baseURL of ['http://192.168.1.2:11434', 'http://localhost.evil.test', 'https://user:pass@ai.example.test', 'https://ai.example.test?key=never', 'file:///tmp/ai']) expect(() => aiEndpoint({ ...connection('ollama'), baseURL })).toThrow();
  expect(() => aiEndpoint({ ...connection('google'), model: '../../outside' })).toThrow();
  const test = fixture(), fetch = createNativeAiFetchFactory(test.bridge)(connection(), { timeoutMs: 30000 });
  await expect(fetch('https://other.example.test/v1/chat/completions', { method: 'POST' })).rejects.toThrow('target');
  await expect(fetch(aiEndpoint(connection()), { method: 'GET' })).rejects.toThrow('target');
  await expect(fetch(aiEndpoint(connection()), { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'synthetic' }, body: '{}' })).rejects.toThrow('header');
  expect(test.bridge.aiOpen).not.toHaveBeenCalled();
});
it.each(['compatible', 'anthropic'] as const)('preserves the existing %s HTTP localhost configuration through its actual SDK', async provider => {
  const test = fixture(), remove = registerAiFetchFactory(createNativeAiFetchFactory(test.bridge));
  try {
    const selected = { ...connection(provider), baseURL: 'http://localhost:11434/v1' };
    expect((await generateAiText(selected, { prompt: 'synthetic local gateway' })).text).toBe('ok');
    expect(test.opened?.baseURL).toBe(selected.baseURL); expect(test.bridge.aiRequest).toHaveBeenCalledOnce();
  } finally { remove(); }
});
it('inherits Request body/headers/signal and respects explicit init overrides, including null cancellation', async () => {
  const test = fixture(), fetch = createNativeAiFetchFactory(test.bridge)(connection(), { timeoutMs: 30000 }), url = aiEndpoint(connection());
  const controller = new AbortController(), request = new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer inherited' }, body: '{"inherited":true}', signal: controller.signal });
  await fetch(request); expect(test.body()).toEqual({ inherited: true }); expect(test.opened?.headers.authorization).toBe('Bearer inherited');
  controller.abort(); await expect(fetch(request)).rejects.toMatchObject({ name: 'AbortError' });
  await fetch(request, { signal: null, headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode('{"override":true}') });
  expect(test.body()).toEqual({ override: true }); expect(test.opened?.headers.authorization).toBeUndefined();
  expect(test.bridge.aiRequest).toHaveBeenCalledTimes(2);
});
it('snapshots caller-owned binary JSON before asynchronous staging so later mutation cannot change the approved request', async () => {
  const test = fixture(), fetch = createNativeAiFetchFactory(test.bridge)(connection(), { timeoutMs: 30000 });
  let release!: () => void; test.bridge.aiOpen = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const original = '{"record":"synthetic"}', bytes = new TextEncoder().encode(original);
  const pending = fetch(aiEndpoint(connection()), { method: 'POST', headers: { 'content-type': 'application/json' }, body: bytes });
  await vi.waitFor(() => expect(test.bridge.aiOpen).toHaveBeenCalledOnce()); bytes.fill(88); release(); await pending;
  expect(new TextDecoder().decode(test.chunks[0])).toBe(original);
});
it('cancels native flight, blocks concurrent AI calls, and prevents a late response from being read', async () => {
  const test = fixture(), fetch = createNativeAiFetchFactory(test.bridge)(connection(), { timeoutMs: 30000 }), url = aiEndpoint(connection());
  let complete!: (value: Awaited<ReturnType<AiPlugin['aiRequest']>>) => void;
  test.bridge.aiRequest = vi.fn(() => new Promise<Awaited<ReturnType<AiPlugin['aiRequest']>>>(resolve => { complete = resolve; }));
  const controller = new AbortController(), request = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' };
  const pending = fetch(url, { ...request, signal: controller.signal });
  await vi.waitFor(() => expect(test.bridge.aiRequest).toHaveBeenCalledOnce());
  await expect(fetch(url, request)).rejects.toThrow('busy'); controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  complete({ status: 200, headers: {}, size: 1 }); await Promise.resolve(); await Promise.resolve();
  expect(test.bridge.aiRead).not.toHaveBeenCalled(); expect(test.bridge.aiCancel).toHaveBeenCalled();
});
it('sends nothing for a pre-aborted request and stops staging after cancellation while native open is pending', async () => {
  const test = fixture(), fetch = createNativeAiFetchFactory(test.bridge)(connection(), { timeoutMs: 30000 }), url = aiEndpoint(connection());
  const before = new AbortController(); before.abort();
  const request = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' };
  await expect(fetch(url, { ...request, signal: before.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(test.bridge.aiOpen).not.toHaveBeenCalled(); expect(test.bridge.aiCancel).not.toHaveBeenCalled();
  let release!: () => void; test.bridge.aiOpen = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const controller = new AbortController(), pending = fetch(url, { ...request, signal: controller.signal });
  await vi.waitFor(() => expect(test.bridge.aiOpen).toHaveBeenCalledOnce()); controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  release(); await Promise.resolve(); await Promise.resolve();
  expect(test.bridge.aiWrite).not.toHaveBeenCalled(); expect(test.bridge.aiRequest).not.toHaveBeenCalled(); expect(test.bridge.aiCancel).toHaveBeenCalled();
});
it('bounds inherited streaming Request bodies and cancels a waiting reader without starting native IO', async () => {
  const test = fixture(), fetch = createNativeAiFetchFactory(test.bridge)(connection(), { timeoutMs: 30000 }), url = aiEndpoint(connection());
  let streamCancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(aiRequestLimit + 1)); }, cancel() { streamCancelled = true; } });
  await expect(fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit)).rejects.toThrow(/^native-ai-failed$/);
  expect(streamCancelled).toBe(true); expect(test.bridge.aiOpen).not.toHaveBeenCalled();
  const controller = new AbortController(); let cancelled = false;
  const waiting = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const pending = fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: waiting, signal: controller.signal, duplex: 'half' } as RequestInit);
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(cancelled).toBe(true); expect(test.bridge.aiOpen).not.toHaveBeenCalled();
});
it('uses the full configured deadline, never a hidden 30s native cap, and releases timed-out calls', async () => {
  vi.useFakeTimers(); const test = fixture(), fetch = createNativeAiFetchFactory(test.bridge)(connection(), { timeoutMs: 120000 });
  test.bridge.aiRequest = vi.fn(() => new Promise<Awaited<ReturnType<AiPlugin['aiRequest']>>>(() => {}));
  const pending = fetch(aiEndpoint(connection()), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const failure = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
  await vi.advanceTimersByTimeAsync(30001); expect(test.bridge.aiCancel).not.toHaveBeenCalled();
  expect(test.opened?.timeoutMs).toBeGreaterThan(119000);
  await vi.advanceTimersByTimeAsync(89999); await failure; expect(test.bridge.aiCancel).toHaveBeenCalled();
});
it('rejects bad input and oversized declared/actual responses, corrupted chunks and unknown native failures without details', async () => {
  const test = fixture(), fetch = createNativeAiFetchFactory(test.bridge)(connection(), { timeoutMs: 30000 }), url = aiEndpoint(connection()), request = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' };
  await expect(fetch(url, { ...request, body: '{' })).rejects.toThrow(/^native-ai-failed$/);
  await expect(fetch(url, { ...request, body: JSON.stringify({ text: 'a'.repeat(aiRequestLimit) }) })).rejects.toThrow(/^native-ai-failed$/);
  expect(test.bridge.aiOpen).not.toHaveBeenCalled();
  test.bridge.aiRequest = vi.fn(async () => ({ status: 200, headers: {}, size: aiResponseLimit + 1 }));
  await expect(fetch(url, request)).rejects.toThrow(/^native-ai-failed$/);
  test.bridge.aiRequest = vi.fn(async () => ({ status: 200, headers: {}, size: 1 })); test.bridge.aiRead = vi.fn(async () => ({ bodyBase64: '%%%=' }));
  await expect(fetch(url, request)).rejects.toThrow(/^native-ai-failed$/);
  test.bridge.aiRequest = vi.fn(async () => { throw Error('private TLS or provider credential detail'); });
  await expect(fetch(url, request)).rejects.toThrow(/^native-ai-failed$/);
  expect(test.bridge.aiCancel).toHaveBeenCalledTimes(5);
});
it('lets SDK response validation reject malformed provider JSON and keeps unavailable Native from falling back to Web', async () => {
  const test = fixture(), web = vi.spyOn(globalThis, 'fetch'), remove = registerAiFetchFactory(createNativeAiFetchFactory(test.bridge));
  try {
    test.bridge.aiRequest = vi.fn(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, size: 1 }));
    test.bridge.aiRead = vi.fn(async () => ({ bodyBase64: 'ew==' }));
    await expect(generateAiText(connection(), { prompt: 'synthetic' })).rejects.toMatchObject({ code: 'request-failed', message: 'request-failed' });
    state.available = false; await expect(generateAiText(connection(), { prompt: 'synthetic' })).rejects.toMatchObject({ code: 'request-failed' });
    expect(test.bridge.aiRequest).toHaveBeenCalledOnce(); expect(web).not.toHaveBeenCalled();
  } finally { remove(); }
});
it('preserves a native timeout through provider SDK error wrapping without exposing its detail', async () => {
  const test = fixture(), remove = registerAiFetchFactory(createNativeAiFetchFactory(test.bridge));
  test.bridge.aiRequest = vi.fn(async () => { throw { code: 'TIMEOUT', message: 'private network diagnostic' }; });
  try { await expect(generateAiText(connection(), { prompt: 'synthetic', timeoutMs: 120000 })).rejects.toMatchObject({ code: 'timeout', message: 'timeout' }); }
  finally { remove(); }
});
