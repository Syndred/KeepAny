import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ native: true, available: true, request: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => state.native, isPluginAvailable: () => state.available }, CapacitorHttp: { request: state.request } }));
import { createNativeServiceFetch } from './service-fetch';
import { allowSyncRoute, createNativeBindingPlatform } from './binding-transport';
import { registerSyncFetchFactory, fetchSync } from '../../sync-client/src/platform-fetch';

const origin = 'https://service.example.test';
const request = () => createNativeServiceFetch(origin, allowSyncRoute);
beforeEach(() => { vi.resetAllMocks(); state.native = true; state.available = true; });
afterEach(() => { vi.unstubAllGlobals(); });
it('keeps the build issuer/resource fixed, removes the desktop bridge requirement, and leaves an absent service disabled', () => {
  const disabled = createNativeBindingPlatform(undefined, undefined);
  expect(disabled.configured(origin)).toBe(false);
  expect(disabled.allowsResource(origin)).toBe(false);
  expect(() => disabled.client(origin)).toThrow('binding-unconfigured');
  const adapter = createNativeBindingPlatform(origin, 'https://sync.example.test');
  expect(adapter.configured(origin)).toBe(true);
  expect(adapter.client(origin).transport.issuer).toBe(origin);
  expect(adapter.allowsResource('https://sync.example.test')).toBe(true);
  expect(adapter.allowsResource('https://other.example.test')).toBe(false);
  expect(() => adapter.client('https://other.example.test')).toThrow('binding-unconfigured');
  expect(() => createNativeBindingPlatform('http://service.example.test', undefined)).toThrow('native-service-origin');
  expect(state.request).not.toHaveBeenCalled();
});
it('maps native parsed JSON back to Fetch responses without sending cookies, extra headers or redirect permission', async () => {
  state.request.mockResolvedValue({ url: `${origin}/sync/identity`, status: 200, headers: { 'content-type': 'application/json' }, data: { accountId: 'synthetic-account' } });
  const response = await request()(`${origin}/sync/identity`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-session-only' }, body: '{}' });
  expect(await response.json()).toEqual({ accountId: 'synthetic-account' });
  expect(state.request).toHaveBeenCalledWith(expect.objectContaining({ url: `${origin}/sync/identity`, data: {}, method: 'POST', disableRedirects: true, responseType: 'arraybuffer', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-session-only' } }));
});
it('preserves ciphertext bytes for native PUT/GET rather than serializing a typed array as JSON', async () => {
  const url = `${origin}/workspaces/11111111-1111-1111-1111-111111111111/attachments/22222222-2222-2222-2222-222222222222`;
  const bytes = Uint8Array.of(0, 128, 255, 64);
  state.request.mockResolvedValueOnce({ url, status: 200, headers: { 'content-type': 'application/json' }, data: { status: 'stored' } });
  await request()(url, { method: 'PUT', headers: { 'Content-Type': 'application/vnd.keepany.ciphertext' }, body: bytes.buffer });
  expect(state.request.mock.calls[0][0]).toMatchObject({ dataType: 'file', data: 'AID/QA==' });
  state.request.mockResolvedValueOnce({ url, status: 200, headers: { 'content-type': 'application/vnd.keepany.ciphertext' }, data: 'AID/QA==' });
  expect(new Uint8Array(await (await request()(url)).arrayBuffer())).toEqual(bytes);
});
it('rejects credentialed/changed origins, unknown routes/methods, query strings and unapproved headers before native dispatch', async () => {
  for (const url of [`${origin}/unknown`, `${origin}/sync/identity?token=synthetic`, `${origin}/sync/identity#fragment`, 'https://other.example.test/sync/identity', 'https://user:password@service.example.test/sync/identity']) {
    await expect(request()(url, { method: 'POST' })).rejects.toThrow('native-service-target');
  }
  await expect(request()(`${origin}/sync/identity`, { method: 'DELETE' })).rejects.toThrow('native-service-target');
  await expect(request()(`${origin}/sync/identity`, { method: 'POST', headers: { Cookie: 'synthetic-only' } })).rejects.toThrow('native-service-header');
  expect(state.request).not.toHaveBeenCalled();
});
it('rejects redirect/changed-URL receipts, invalid base64 and oversized readback without exposing native error details', async () => {
  for (const result of [
    { url: `${origin}/sync/identity`, status: 302, headers: {}, data: '' },
    { url: 'https://other.example.test/sync/identity', status: 200, headers: {}, data: '' },
    { url: `${origin}/sync/identity`, status: 200, headers: {}, data: 'not base64' },
    { url: `${origin}/sync/identity`, status: 200, headers: { 'content-type': 'application/json', 'content-length': String(9 * 1024 * 1024) }, data: {} },
  ]) {
    state.request.mockResolvedValueOnce(result);
    await expect(request()(`${origin}/sync/identity`, { method: 'POST' })).rejects.toThrow('native-service-network');
  }
  state.request.mockRejectedValueOnce(Error('native internal error with synthetic private header'));
  await expect(request()(`${origin}/sync/identity`, { method: 'POST' })).rejects.toThrow(/^native-service-network$/);
});
it('retains HTTP auth errors as real responses and refuses missing native plugins without Web fallback', async () => {
  state.request.mockResolvedValue({ url: `${origin}/sync/identity`, status: 401, headers: { 'content-type': 'text/plain' }, data: 'Unauthorized' });
  expect((await request()(`${origin}/sync/identity`, { method: 'POST' })).status).toBe(401);
  state.available = false;
  await expect(request()(`${origin}/sync/identity`, { method: 'POST' })).rejects.toThrow('native-service-unavailable');
  state.native = false;
  await expect(request()(`${origin}/sync/identity`, { method: 'POST' })).rejects.toThrow('native-service-unavailable');
  expect(state.request).toHaveBeenCalledTimes(1);
});
it('cancels a waiting caller while retaining the occupied native slot until its real request ends', async () => {
  const fetcher = request(), controller = new AbortController();
  const finishes: Array<(value: unknown) => void> = [];
  state.request.mockImplementation(() => new Promise(resolve => { finishes.push(resolve); }));
  const pending = fetcher(`${origin}/sync/identity`, { method: 'POST', signal: controller.signal });
  await vi.waitFor(() => expect(state.request).toHaveBeenCalledTimes(1));
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  const others = Array.from({ length: 3 }, () => fetcher(`${origin}/sync/identity`, { method: 'POST' }));
  await vi.waitFor(() => expect(state.request).toHaveBeenCalledTimes(4));
  await expect(fetcher(`${origin}/sync/identity`, { method: 'POST' })).rejects.toThrow('native-service-busy');
  for (const finish of finishes) finish({ url: `${origin}/sync/identity`, status: 200, headers: { 'content-type': 'application/json' }, data: {} });
  await Promise.all(others);
  const cancelled = new AbortController(); cancelled.abort();
  await expect(fetcher(`${origin}/sync/identity`, { method: 'POST', signal: cancelled.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(state.request).toHaveBeenCalledTimes(4);
});
it('routes sync through an installed factory and restores the ordinary Web transport after removal', async () => {
  const native = vi.fn(async () => new Response('{}')), web = vi.fn(async () => new Response('{}'));
  vi.stubGlobal('fetch', web);
  const factory = vi.fn(() => native), stop = registerSyncFetchFactory(factory);
  try { await fetchSync(origin, `${origin}/workspaces`); expect(factory).toHaveBeenCalledWith(origin); expect(native).toHaveBeenCalledOnce(); expect(web).not.toHaveBeenCalled(); }
  finally { stop(); }
  await fetchSync(origin, `${origin}/workspaces`); expect(web).toHaveBeenCalledOnce();
});
