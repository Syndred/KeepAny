import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ native: true, available: true }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => state.native, isPluginAvailable: () => state.available }, registerPlugin: () => ({}), CapacitorHttp: {} }));
import { backupLimit, createNativeConnections, type ConnectionsPlugin } from './connections';
import { createNativeSyncFetchFactory } from './binding-transport';
import { backupPlatformFetch, openPlatformSession, registerPlatformConnections } from '../../../apps/web/src/platform-connections';
import { createWebDavTransport } from '../../connectors/src/remote-backup';
const origin = 'https://session.example.test';
function bridge(): ConnectionsPlugin {
  return { openSession: vi.fn(async () => ({ sessionId: 'synthetic-process-session' })), closeSession: vi.fn(async () => {}),
    sessionRequest: vi.fn(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, size: 2, bodyBase64: 'e30=' })),
    backupWrite: vi.fn(async () => {}), backupRequest: vi.fn(async () => ({ status: 204, headers: {}, size: 0 })),
    backupRead: vi.fn(async () => ({ bodyBase64: '' })), cancel: vi.fn(async () => {}) };
}
afterEach(() => { state.native = true; state.available = true; vi.restoreAllMocks(); });
it.each(['declared', 'streamed'])('maps a stable native %s limit rejection to the existing backup-size error and cleans the transfer', async () => {
  const native = bridge(), adapter = createNativeConnections(native), url = 'https://backup.example.test/object.ka1';
  native.backupRequest = vi.fn(async () => { throw Object.assign(new Error('native-connections-limit'), { code: 'native-connections-limit' }); });
  const transport = createWebDavTransport({ objectUrl: url, authorization: async () => 'Basic synthetic', fetchImpl: adapter.backupFetch([{ url, method: 'GET' }]) });
  await expect(transport.get()).rejects.toThrow(/^backup-size$/);
  expect(native.backupRead).not.toHaveBeenCalled();
  expect(native.cancel).toHaveBeenCalledOnce();
  expect(native.cancel).toHaveBeenCalledWith({ requestId: vi.mocked(native.backupRequest).mock.calls[0][0].requestId });
});
it.each(['backupWrite', 'backupRequest', 'backupRead'] as const)('maps only stable native codes, sanitizes unknown %s failures and always cleans up', async action => {
  const native = bridge(), adapter = createNativeConnections(native), url = 'https://backup.example.test/object.ka1';
  native.backupRequest = vi.fn(async () => ({ status: 200, headers: {}, size: 1 }));
  const request = adapter.backupFetch([{ url, method: 'GET' }, { url, method: 'PUT' }]);
  const invoke = () => request(url, action === 'backupWrite' ? { method: 'PUT', body: Uint8Array.of(1) } : {});
  vi.spyOn(native, action).mockRejectedValueOnce(Object.assign(new Error('private TLS/auth detail must not cross the bridge'), { code: 'native-connections-failed' }))
    .mockRejectedValueOnce(new Error('native-connections-limit'))
    .mockRejectedValueOnce({ code: 'native-connections-limit', message: 'must not forward details' });
  await expect(invoke()).rejects.toThrow(/^native-connections-failed$/);
  await expect(invoke()).rejects.toThrow(/^native-connections-failed$/);
  await expect(invoke()).rejects.toThrow(/^backup-size$/);
  expect(native.cancel).toHaveBeenCalledTimes(3);
});
it('does not misclassify corrupt base64 as a backup limit and cleans the transfer', async () => {
  const native = bridge(), adapter = createNativeConnections(native), url = 'https://backup.example.test/object.ka1';
  native.backupRequest = vi.fn(async () => ({ status: 200, headers: {}, size: 1 }));
  native.backupRead = vi.fn(async () => ({ bodyBase64: '%%%=' }));
  await expect(adapter.backupFetch([{ url, method: 'GET' }])(url)).rejects.toThrow(/^native-connections-response$/);
  expect(native.cancel).toHaveBeenCalledOnce();
});
it('preserves the checked size error when cleanup also fails and keeps HTTP authentication failures as HTTP results', async () => {
  const native = bridge(), adapter = createNativeConnections(native), url = 'https://backup.example.test/object.ka1';
  const request = adapter.backupFetch([{ url, method: 'GET' }]);
  native.cancel = vi.fn(async () => { throw Error('private cleanup detail'); });
  native.backupRequest = vi.fn(async () => { throw { code: 'native-connections-limit' }; });
  await expect(request(url)).rejects.toThrow(/^backup-size$/);
  native.backupRequest = vi.fn(async () => ({ status: 401, headers: {}, size: 0 }));
  await expect(request(url)).resolves.toHaveProperty('status', 401);
  expect(native.cancel).toHaveBeenCalledTimes(2);
});
it('requires registration and explicit HTTPS confirmation without issuing a request or falling back to Web', async () => {
  const web = vi.spyOn(globalThis, 'fetch');
  await expect(openPlatformSession(origin, true)).rejects.toThrow('unavailable');
  expect(() => backupPlatformFetch([])).toThrow('unavailable');
  const native = bridge(), adapter = createNativeConnections(native), remove = registerPlatformConnections(adapter);
  try {
    await expect(openPlatformSession('http://session.example.test', true)).rejects.toThrow();
    await expect(openPlatformSession(`${origin}/extra`, true)).rejects.toThrow();
    const connection = await openPlatformSession(origin, true);
    expect(native.sessionRequest).not.toHaveBeenCalled(); expect(web).not.toHaveBeenCalled();
    await connection.close();
  } finally { remove(); }
});
it('pins session paths, methods and headers and routes session sync through the same process session', async () => {
  const native = bridge(), adapter = createNativeConnections(native), connection = await adapter.openSession(origin);
  const sync = createNativeSyncFetchFactory(adapter.sessionFetch)(origin);
  await sync(`${origin}/sync/identity`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  await connection.fetch(`${origin}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect(native.sessionRequest).toHaveBeenCalledTimes(2);
  await expect(connection.fetch('https://other.example.test/api/auth/get-session')).rejects.toThrow('target');
  await expect(connection.fetch(`${origin}/api/auth/get-session?redirect=evil`)).rejects.toThrow('target');
  await expect(connection.fetch(`${origin}/api/auth/delete-user`, { method: 'POST' })).rejects.toThrow('target');
  await expect(connection.fetch(`${origin}/api/auth/get-session`, { headers: { Cookie: 'never-accept-js-cookies' } })).rejects.toThrow('header');
  await connection.close();
  await expect(sync(`${origin}/sync/identity`, { method: 'POST', credentials: 'include' })).rejects.toThrow('session-required');
  await expect(connection.fetch(`${origin}/api/auth/get-session`)).rejects.toThrow('session-closed');
});
it('cancels abandoned session requests and never turns an unavailable native plugin into Web fetch', async () => {
  const native = bridge(), adapter = createNativeConnections(native), connection = await adapter.openSession(origin);
  native.sessionRequest = vi.fn(() => new Promise<Awaited<ReturnType<ConnectionsPlugin['sessionRequest']>>>(() => {}));
  const controller = new AbortController();
  const pending = connection.fetch(`${origin}/api/auth/get-session`, { signal: controller.signal });
  await Promise.resolve(); await Promise.resolve(); controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(native.cancel).toHaveBeenCalled();
  state.available = false; await expect(adapter.openSession('https://other.example.test')).rejects.toThrow('unavailable');
});
it('retains signed queries and exact object/method pins, passes Basic only to the chosen object and returns original bytes', async () => {
  const native = bridge(), adapter = createNativeConnections(native), url = 'https://backup.example.test/object.ka1?signature=synthetic';
  native.backupRequest = vi.fn(async () => ({ status: 200, headers: {}, size: 4 }));
  native.backupRead = vi.fn(async () => ({ bodyBase64: 'AID/QA==' }));
  const transport = createWebDavTransport({ objectUrl: url, authorization: async () => 'Basic synthetic', fetchImpl: adapter.backupFetch([{ url, method: 'GET' }, { url, method: 'PUT' }]) });
  expect(await transport.get()).toEqual(Uint8Array.of(0,128,255,64));
  expect(native.backupRequest).toHaveBeenCalledWith(expect.objectContaining({ url, method: 'GET', headers: { authorization: 'Basic synthetic' } }));
  await expect(adapter.backupFetch([{ url, method: 'GET' }])('https://backup.example.test/other')).rejects.toThrow('target');
  await expect(adapter.backupFetch([{ url, method: 'GET' }])(url, { method: 'PUT' })).rejects.toThrow('target');
  expect(native.cancel).toHaveBeenCalled();
});
it('stages the full existing 100 MiB plus envelope budget using bounded bridge chunks', async () => {
  const native = bridge(), adapter = createNativeConnections(native), url = 'https://backup.example.test/object.ka1';
  let total = 0, largest = 0, chunks = 0;
  native.backupWrite = async ({ bodyBase64 }) => { const size = atob(bodyBase64).length; total += size; largest = Math.max(largest,size); chunks++; };
  const request = adapter.backupFetch([{ url, method: 'PUT' }]);
  await request(url, { method: 'PUT', body: new Blob([new Uint8Array(backupLimit)]) });
  expect(total).toBe(backupLimit); expect(largest).toBe(256 * 1024); expect(chunks).toBe(401);
  await expect(request(url, { method: 'PUT', body: new Blob([new Uint8Array(backupLimit + 1)]) })).rejects.toThrow('backup-size');
  expect(total).toBe(backupLimit);
  // Full-budget binary/base64 conversion is CPU work; keep all 401 real chunks
  // while allowing slower shared CI workers to finish the assertions.
}, 20_000);
it('rejects redirect-shaped responses, oversized reads, corrupted chunks and preserves failed operations as failures', async () => {
  const native = bridge(), adapter = createNativeConnections(native), url = 'https://backup.example.test/object.ka1';
  const fetch = adapter.backupFetch([{ url, method: 'GET' }]);
  native.backupRequest = vi.fn(async () => ({ status: 302, headers: {}, size: 0 })); await expect(fetch(url)).rejects.toThrow('response');
  native.backupRequest = vi.fn(async () => ({ status: 200, headers: {}, size: backupLimit + 1 })); await expect(fetch(url)).rejects.toThrow('backup-size');
  native.backupRequest = vi.fn(async () => ({ status: 200, headers: {}, size: 1 }));
  native.backupRead = vi.fn(async () => ({ bodyBase64: '' })); await expect(fetch(url)).rejects.toThrow('response');
  expect(native.cancel).toHaveBeenCalledTimes(3);
});

it('inherits Request headers, method and original bytes while explicit init headers and body take priority', async () => {
  const native = bridge(), adapter = createNativeConnections(native), url = 'https://backup.example.test/object.ka1';
  const fetch = adapter.backupFetch([{ url, method: 'GET' }, { url, method: 'PUT' }]);
  await fetch(new Request(url, { method: 'PUT', headers: { Authorization: 'Basic synthetic-request-only', 'Content-Type': 'application/octet-stream' }, body: Uint8Array.of(0, 128, 255, 64) }));
  expect(native.backupRequest).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'PUT', headers: { authorization: 'Basic synthetic-request-only', 'content-type': 'application/octet-stream' } }));
  expect(native.backupWrite).toHaveBeenLastCalledWith(expect.objectContaining({ bodyBase64: 'AID/QA==' }));
  await fetch(new Request(url, { method: 'GET', headers: { Authorization: 'Basic must-be-overridden' } }), { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Uint8Array.of(1, 2, 3) });
  expect(native.backupRequest).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'PUT', headers: { 'content-type': 'application/octet-stream' } }));
  expect(native.backupWrite).toHaveBeenLastCalledWith(expect.objectContaining({ bodyBase64: 'AQID' }));
  await expect(fetch(new Request(url, { method: 'POST', body: 'not-an-allowed-method' }))).rejects.toThrow('native-backup-target');
  await expect(fetch(url, { method: 'PUT', body: new FormData() })).rejects.toThrow('native-connections-body');
  expect(native.backupRequest).toHaveBeenCalledTimes(2);
});

it('does not send or stage an already aborted Request and cancels Request-owned signals during native flight', async () => {
  const native = bridge(), adapter = createNativeConnections(native), url = 'https://backup.example.test/object.ka1';
  const fetch = adapter.backupFetch([{ url, method: 'GET' }, { url, method: 'PUT' }]);
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await expect(fetch(new Request(url, { method: 'PUT', body: new Blob([Uint8Array.of(1)]), signal: alreadyAborted.signal }))).rejects.toMatchObject({ name: 'AbortError' });
  expect(native.backupWrite).not.toHaveBeenCalled(); expect(native.backupRequest).not.toHaveBeenCalled();
  let complete!: (value: Awaited<ReturnType<ConnectionsPlugin['backupRequest']>>) => void;
  native.backupRequest = vi.fn(() => new Promise<Awaited<ReturnType<ConnectionsPlugin['backupRequest']>>>(resolve => { complete = resolve; }));
  const controller = new AbortController();
  const pending = fetch(new Request(url, { signal: controller.signal }));
  await vi.waitFor(() => expect(native.backupRequest).toHaveBeenCalledTimes(1));
  const id = vi.mocked(native.backupRequest).mock.calls[0][0].requestId;
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(native.cancel).toHaveBeenCalledWith({ requestId: id });
  complete({ status: 200, headers: {}, size: 0 });
  await Promise.resolve();
  expect(native.backupRead).not.toHaveBeenCalled();
});

it('lets explicit init signals override an aborted Request, including explicit null', async () => {
  const native = bridge(), adapter = createNativeConnections(native), url = 'https://backup.example.test/object.ka1';
  const fetch = adapter.backupFetch([{ url, method: 'GET' }]);
  const original = new AbortController(); original.abort();
  const request = new Request(url, { signal: original.signal, headers: { Authorization: 'Basic overridden' } });
  await expect(fetch(request, { signal: new AbortController().signal, headers: {} })).resolves.toHaveProperty('status', 204);
  await expect(fetch(request, { signal: null, headers: {} })).resolves.toHaveProperty('status', 204);
  expect(native.backupRequest).toHaveBeenCalledTimes(2);
  expect(native.backupRequest).toHaveBeenLastCalledWith(expect.objectContaining({ headers: {} }));
});

it('honors explicit null cancellation overrides for a session Request without reviving inherited cancellation', async () => {
  const native = bridge(), adapter = createNativeConnections(native), connection = await adapter.openSession(origin);
  const original = new AbortController(); original.abort();
  const request = new Request(`${origin}/api/auth/get-session`, { signal: original.signal });
  await expect(connection.fetch(request)).rejects.toMatchObject({ name: 'AbortError' });
  expect(native.sessionRequest).not.toHaveBeenCalled();
  await expect(connection.fetch(request, { signal: null })).resolves.toHaveProperty('status', 200);
  expect(native.sessionRequest).toHaveBeenCalledTimes(1);
  await connection.close();
});
