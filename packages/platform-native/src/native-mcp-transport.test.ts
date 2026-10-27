import { afterEach, expect, it, vi } from 'vitest';
const platform = vi.hoisted(() => ({ native: true, available: true }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => platform.native, isPluginAvailable: () => platform.available }, registerPlugin: () => ({}) }));
import { McpAuthority, MemoryAuthorityStorage } from '../../mcp/src/authority';
import { createKeepAnyMcpHttpHandler } from '../../mcp/src/http-handler';
import { startNativeMcpTransport, type NativeMcpTransportPlugin, type NativeMcpRequestHandler } from './native-mcp-transport';

const endpoint = { instanceId: crypto.randomUUID(), endpoint: 'https://127.0.0.1:9448/mcp',
  certificatePem: `-----BEGIN CERTIFICATE-----\n${'A'.repeat(64)}\n-----END CERTIFICATE-----\n`, spkiSha256: 'a'.repeat(64) };
function fixture() {
  const callbacks = new Map<string, (event: unknown) => void>(), responses = new Map<string, { status: number; chunks: string[] }>();
  const bridge: NativeMcpTransportPlugin = {
    start: vi.fn(async () => endpoint), stop: vi.fn(async () => {}), cancel: vi.fn(async () => {}),
    addListener: vi.fn(async (name, callback) => { callbacks.set(name, callback); return { remove: vi.fn(async () => { callbacks.delete(name); }) }; }),
    responseStart: vi.fn(async row => { responses.set(row.requestId, { status: row.status, chunks: [] }); }),
    responseWrite: vi.fn(async row => { responses.get(row.requestId)?.chunks.push(row.chunkBase64); }),
    responseEnd: vi.fn(async () => {}),
  };
  const request = (extra: Record<string, unknown> = {}) => {
    const row = { instanceId: endpoint.instanceId, requestId: crypto.randomUUID(), method: 'POST', path: '/mcp',
      host: '127.0.0.1:9448', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}', ...extra };
    callbacks.get('mcpRequest')?.(row); return row;
  };
  return { bridge, callbacks, responses, request };
}
const idleHandler = (): NativeMcpRequestHandler => ({ fetch: vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } })), close: vi.fn(async () => {}) });
afterEach(() => { platform.native = true; platform.available = true; vi.restoreAllMocks(); });

it('passes actual parser Host separately to the official SDK protocol and preserves its real finite response in bounded chunks', async () => {
  const test = fixture(), authority = new McpAuthority(new MemoryAuthorityStorage());
  const grant = await authority.issueGrant({ assetIds: [crypto.randomUUID()], readFields: ['name'], writeFields: [], ttlMs: 60000 });
  const protocolHeaders: string[][] = [];
  const session = await startNativeMcpTransport({ address: '127.0.0.1', createHandler: (info, assertAvailable) => {
    const protocol = createKeepAnyMcpHttpHandler({ endpoint: info.endpoint, authority,
      store: { get: async () => null, list: async () => [], compareAndSet: async () => 'conflict' }, assertAvailable });
    return { close: () => protocol.close(), fetch: async (...args) => {
      const response = await protocol.fetch(...args); protocolHeaders.push([...response.headers.keys()]); return response;
    } };
  } }, test.bridge);
  try {
    const row = test.request({ headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${grant.id}.${grant.secret}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic-native-client', version: '1' } } }) });
    await vi.waitFor(() => expect(test.bridge.responseEnd, JSON.stringify(protocolHeaders)).toHaveBeenCalledWith({ instanceId: endpoint.instanceId, requestId: row.requestId }));
    const response = test.responses.get(row.requestId);
    if (!response) throw Error('Missing completed protocol response');
    expect(response.status).toBe(200);
    const text = response.chunks.map(value => atob(value)).join('');
    const json = text.startsWith('event:') ? text.split('\n').find(line => line.startsWith('data: '))?.slice(6) : text;
    if (!json) throw Error('Missing SDK response data');
    const body = JSON.parse(json);
    expect(body.result.serverInfo.name).toBe('keepany-local');
    const denied = test.request({ host: 'spoofed.test:9448', headers: { authorization: `Bearer ${grant.id}.${grant.secret}` } });
    await vi.waitFor(() => expect(test.responses.get(denied.requestId)?.status).toBe(403));
  } finally { await session.close(); }
});

it('disconnect aborts a paused handler, prevents its late response, and releases the JS request slot', async () => {
  const test = fixture(); let release!: (response: Response) => void, signal: AbortSignal | undefined;
  const handler = idleHandler();
  handler.fetch = vi.fn(request => { signal = request.signal; return new Promise<Response>(resolve => { release = resolve; }); });
  const session = await startNativeMcpTransport({ address: '127.0.0.1', createHandler: () => handler }, test.bridge);
  const row = test.request();
  await vi.waitFor(() => expect(signal).toBeDefined());
  test.callbacks.get('mcpCancelled')?.({ instanceId: endpoint.instanceId, requestId: row.requestId });
  await vi.waitFor(() => expect(test.bridge.cancel).toHaveBeenCalledOnce());
  expect(signal?.aborted).toBe(true);
  release(new Response('late-private-answer'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(test.bridge.responseStart).not.toHaveBeenCalled();
  await session.close();
});

it('stopping the matching native session closes the handler and commit guard; an old session event cannot stop the active one', async () => {
  const test = fixture(), handler = idleHandler(), stopped = vi.fn();
  const session = await startNativeMcpTransport({ address: '127.0.0.1', createHandler: () => handler, onStopped: stopped }, test.bridge);
  test.callbacks.get('mcpStopped')?.({ instanceId: crypto.randomUUID() });
  expect(() => session.assertAvailable()).not.toThrow();
  test.callbacks.get('mcpStopped')?.({ instanceId: endpoint.instanceId });
  expect(() => session.assertAvailable()).toThrow('mcp-native-stopped');
  await session.close();
  expect(handler.close).toHaveBeenCalledOnce(); expect(test.bridge.stop).toHaveBeenCalledOnce(); expect(stopped).toHaveBeenCalledOnce();
  expect(test.callbacks.size).toBe(0);
});

it('rejects foreign endpoint or native startup stop and cleans up the already-created listener', async () => {
  for (const mode of ['foreign', 'stopped']) {
    const test = fixture();
    test.bridge.start = vi.fn(async () => {
      if (mode === 'stopped') test.callbacks.get('mcpStopped')?.({ instanceId: endpoint.instanceId });
      return { ...endpoint, endpoint: mode === 'foreign' ? 'https://192.168.1.9:9448/mcp' : endpoint.endpoint };
    });
    const createHandler = vi.fn(idleHandler);
    await expect(startNativeMcpTransport({ address: '127.0.0.1', createHandler }, test.bridge)).rejects.toThrow('mcp-native-transport');
    expect(createHandler).not.toHaveBeenCalled(); expect(test.bridge.stop).toHaveBeenCalledOnce(); expect(test.callbacks.size).toBe(0);
  }
});

it('rejects public/wildcard/ambiguous addresses and unavailable platforms before opening a native port', async () => {
  const test = fixture();
  for (const address of ['0.0.0.0', '8.8.8.8', '169.254.1.1', 'localhost', '127.0.0.2', '192.168.001.1', '10.0.0.256', '::1']) {
    await expect(startNativeMcpTransport({ address, createHandler: idleHandler }, test.bridge)).rejects.toThrow('mcp-native-transport');
  }
  platform.available = false;
  await expect(startNativeMcpTransport({ address: '127.0.0.1', createHandler: idleHandler }, test.bridge)).rejects.toThrow('mcp-native-transport');
  expect(test.bridge.start).not.toHaveBeenCalled();
});

it('rejects cookie response, redirect, and oversized output without completing a partial successful response', async () => {
  for (const response of [new Response('secret', { headers: { 'set-cookie': 'private=secret' } }), new Response(null, { status: 307 }), new Response(new Uint8Array(8 * 1024 * 1024 + 1))]) {
    const test = fixture(), handler = idleHandler(); handler.fetch = vi.fn(async () => response);
    const session = await startNativeMcpTransport({ address: '127.0.0.1', createHandler: () => handler }, test.bridge);
    test.request();
    await vi.waitFor(() => expect(test.bridge.cancel).toHaveBeenCalledOnce());
    expect(test.bridge.responseEnd).not.toHaveBeenCalled(); await session.close();
  }
});

it('preserves non-ASCII bytes across chunks and never sends a bridge chunk larger than 256 KiB', async () => {
  const test = fixture(), handler = idleHandler(), text = '中文🙂'.repeat(80000);
  handler.fetch = vi.fn(async () => new Response(text, { headers: { 'content-type': 'application/json' } }));
  const session = await startNativeMcpTransport({ address: '127.0.0.1', createHandler: () => handler }, test.bridge);
  const row = test.request();
  await vi.waitFor(() => expect(test.bridge.responseEnd).toHaveBeenCalledOnce());
  const response = test.responses.get(row.requestId);
  if (!response) throw Error('Missing completed chunked response');
  const chunks = response.chunks.map(value => Uint8Array.from(atob(value), char => char.charCodeAt(0)));
  expect(chunks.every(value => value.length <= 256 * 1024)).toBe(true);
  const joined = new Uint8Array(chunks.reduce((size, value) => size + value.length, 0)); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  expect(new TextDecoder().decode(joined)).toBe(text); await session.close();
});

it('still stops native IO and removes listeners when the protocol close throws synchronously', async () => {
  const test = fixture(), handler = idleHandler(); handler.close = () => { throw Error('private failure'); };
  const session = await startNativeMcpTransport({ address: '127.0.0.1', createHandler: () => handler }, test.bridge);
  await session.close(); expect(test.bridge.stop).toHaveBeenCalledOnce(); expect(test.callbacks.size).toBe(0);
});

it('a bridge acknowledgement failure never replays the handler and frees the slot for a distinct retry', async () => {
  const test = fixture(), handler = idleHandler();
  test.bridge.responseWrite = vi.fn(async () => { throw Error('private IO diagnostic'); });
  const session = await startNativeMcpTransport({ address: '127.0.0.1', createHandler: () => handler }, test.bridge);
  test.request();
  await vi.waitFor(() => expect(test.bridge.cancel).toHaveBeenCalledOnce());
  expect(handler.fetch).toHaveBeenCalledOnce(); expect(test.bridge.responseEnd).not.toHaveBeenCalled();
  test.bridge.responseWrite = vi.fn(async () => {});
  test.request();
  await vi.waitFor(() => expect(test.bridge.responseEnd).toHaveBeenCalledOnce());
  expect(handler.fetch).toHaveBeenCalledTimes(2); await session.close();
});

it('rejects UTF8 byte overflow, excess headers and CRLF before protocol access', async () => {
  const test = fixture(), handler = idleHandler();
  const session = await startNativeMcpTransport({ address: '127.0.0.1', createHandler: () => handler }, test.bridge);
  test.request({ body: '中'.repeat(333334) });
  test.request({ headers: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`header-${index}`, 'value'])) });
  test.request({ headers: { authorization: 'Bearer fake\r\nCookie: fake' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(handler.fetch).not.toHaveBeenCalled(); await session.close();
});
