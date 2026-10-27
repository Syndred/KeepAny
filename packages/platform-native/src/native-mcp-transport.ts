import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { z } from 'zod';
import { MCP_HTTP_REQUEST_LIMIT, MCP_HTTP_RESPONSE_LIMIT, type McpInboundHttp } from '../../mcp/src/http-handler';

export interface NativeMcpTransportPlugin {
  reset(): Promise<void>;
  prepare(options: { address: string }): Promise<NativeMcpEndpoint>;
  activate(options: { instanceId: string }): Promise<NativeMcpEndpoint>;
  start(options: { address: string }): Promise<NativeMcpEndpoint>;
  stop(options: { instanceId: string }): Promise<void>;
  cancel(options: { instanceId: string; requestId: string }): Promise<void>;
  responseStart(options: { instanceId: string; requestId: string; status: number; headers: Record<string, string> }): Promise<void>;
  responseWrite(options: { instanceId: string; requestId: string; chunkBase64: string }): Promise<void>;
  responseEnd(options: { instanceId: string; requestId: string }): Promise<void>;
  addListener(event: 'mcpRequest' | 'mcpCancelled' | 'mcpStopped', listener: (event: unknown) => void): Promise<PluginListenerHandle>;
}
export type NativeMcpEndpoint = { instanceId: string; endpoint: string; certificatePem: string; spkiSha256: string };
export type NativeMcpRequestHandler = {
  fetch(request: Request, inbound: McpInboundHttp): Promise<Response>;
  close(): Promise<void>;
};
const native = registerPlugin<NativeMcpTransportPlugin>('KeepAnyMcpTransport');
const uuid = z.uuid(), instance = z.strictObject({ instanceId: uuid });
const cancelled = instance.extend({ requestId: uuid });
const incoming = cancelled.extend({ method: z.literal('POST'), path: z.enum(['/mcp', '/pair']),
  host: z.string().min(1).max(260), headers: z.record(z.string(), z.string()), body: z.string().max(MCP_HTTP_REQUEST_LIMIT) });
const started = instance.extend({ endpoint: z.string().max(512), certificatePem: z.string().min(64).max(16384),
  spkiSha256: z.string().regex(/^[a-f0-9]{64}$/) });
const responseHeaders = new Set(['content-type', 'cache-control', 'x-content-type-options', 'mcp-session-id',
  'mcp-protocol-version', 'allow', 'www-authenticate', 'retry-after', 'vary', 'access-control-allow-origin', 'access-control-expose-headers']);
// Native IO owns connection framing and the final byte length. The official
// SDK emits connection/x-accel-buffering for its finite SSE replies as well.
const ioHeaders = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'x-accel-buffering']);
const encoder = new TextEncoder();
/** Call before mounting a new native WebView runtime; pagehide delivery alone
 * cannot guarantee an old page's asynchronous native stop was acknowledged. */
export async function resetNativeMcpTransport(bridge: NativeMcpTransportPlugin = native): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('KeepAnyMcpTransport')) return false;
  try { await bridge.reset(); return true; } catch { throw Error('mcp-native-transport'); }
}
function privateAddress(address: string) {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(address)) return false;
  const parts = address.split('.').map(Number);
  return parts.every(value => value <= 255) && (address === '127.0.0.1' || parts[0] === 10 ||
    parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}
function checkedEndpoint(value: unknown, address: string): NativeMcpEndpoint {
  const result = started.safeParse(value);
  if (!result.success) throw Error('mcp-native-transport');
  const info = result.data, url = new URL(info.endpoint);
  if (url.protocol !== 'https:' || url.hostname !== address || !url.port || url.pathname !== '/mcp' ||
    url.search || url.hash || url.username || url.password ||
    !/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END CERTIFICATE-----\r?\n?$/.test(info.certificatePem)) throw Error('mcp-native-transport');
  return info;
}
function checkedHeaders(headers: Record<string, string>): boolean {
  const entries = Object.entries(headers);
  return entries.length <= 64 && entries.every(([key, value]) => /^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(key) && !/[\r\n\0]/.test(value)) &&
    entries.reduce((size, [key, value]) => size + encoder.encode(key + value).byteLength + 4, 0) <= 16 * 1024;
}
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
function abortable<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(Error('mcp-native-stopped'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(Error('mcp-native-stopped'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw Error('mcp-native-stopped');
      return action();
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Opens only an explicitly requested native listener. Pairing, grant issuance
 * and approval remain in the trusted caller; registration alone opens no port. */
export async function startNativeMcpTransport(options: {
  address: string;
  createHandler(endpoint: NativeMcpEndpoint, assertAvailable: () => void): NativeMcpRequestHandler;
  onStopped?: () => void;
}, bridge: NativeMcpTransportPlugin = native) {
  if (!privateAddress(options.address) || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('KeepAnyMcpTransport')) throw Error('mcp-native-transport');
  let endpoint: NativeMcpEndpoint | undefined, handler: NativeMcpRequestHandler | undefined;
  let closed = false, closing: Promise<void> | undefined;
  const listeners: PluginListenerHandle[] = [], pending = new Map<string, AbortController>();
  const stoppedEarly = new Set<string>();
  let resolveReady!: () => void;
  const ready = new Promise<void>(resolve => { resolveReady = resolve; });
  const assertAvailable = () => { if (closed || !endpoint || !handler) throw Error('mcp-native-stopped'); };
  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    for (const controller of pending.values()) controller.abort();
    resolveReady();
    closing = Promise.resolve().then(async () => {
      // Close the HTTP handler before awaiting native IO so storage commit
      // guards observe cancellation immediately, including a queued CAS.
      const work = [Promise.resolve().then(() => handler?.close()),
        Promise.resolve().then(() => endpoint ? bridge.stop({ instanceId: endpoint.instanceId }) : undefined)];
      await Promise.allSettled(work);
      await Promise.allSettled(listeners.map(listener => Promise.resolve().then(() => listener.remove())));
      pending.clear();
      try { options.onStopped?.(); } catch { /* UI callbacks cannot keep a listener alive. */ }
    });
    return closing;
  };
  const process = async (event: unknown) => {
    const result = incoming.safeParse(event);
    if (!result.success || closed || pending.size >= 4) return;
    const row = result.data, key = `${row.instanceId}:${row.requestId}`;
    if (pending.has(key) || !checkedHeaders(row.headers) || encoder.encode(row.body).byteLength > MCP_HTTP_REQUEST_LIMIT) return;
    const controller = new AbortController(); pending.set(key, controller);
    const active = () => { assertAvailable(); if (controller.signal.aborted) throw Error('mcp-native-stopped'); };
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      await ready; active();
      if (!endpoint || row.instanceId !== endpoint.instanceId || !handler) return;
      const protocol = handler;
      const request = new Request(new URL(row.path, endpoint.endpoint), { method: row.method,
        headers: row.headers, body: row.body, signal: controller.signal });
      const response = await abortable(controller.signal, () => protocol.fetch(request, { host: row.host })); active();
      if (response.status >= 300 && response.status <= 399) throw Error('mcp-native-response');
      const headers: Record<string, string> = {};
      for (const [name, value] of response.headers) {
        if (/[\r\n\0]/.test(value)) throw Error('mcp-native-response');
        if (ioHeaders.has(name)) continue;
        if (!responseHeaders.has(name)) throw Error('mcp-native-response');
        headers[name] = value;
      }
      if (!checkedHeaders(headers)) throw Error('mcp-native-response');
      const reference = { instanceId: endpoint.instanceId, requestId: row.requestId };
      await abortable(controller.signal, () => bridge.responseStart({ ...reference, status: response.status, headers })); active();
      let size = 0;
      if (response.body) {
        const responseReader = response.body.getReader(); reader = responseReader;
        while (true) {
          active(); const chunk = await abortable(controller.signal, () => responseReader.read()); active();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MCP_HTTP_RESPONSE_LIMIT) throw Error('mcp-native-response');
          for (let offset = 0; offset < chunk.value.length; offset += 256 * 1024) {
            active();
            await abortable(controller.signal, () => bridge.responseWrite({ ...reference, chunkBase64: base64(chunk.value.subarray(offset, offset + 256 * 1024)) }));
            active();
          }
        }
      }
      active(); await abortable(controller.signal, () => bridge.responseEnd(reference));
    } catch {
      // Native owns the total deadline and closes unfinished responses. Never
      // retry a handler: a lost acknowledgement may follow a committed write.
      controller.abort();
      if (endpoint?.instanceId === row.instanceId) void Promise.resolve().then(() => bridge.cancel({ instanceId: row.instanceId, requestId: row.requestId })).catch(() => {});
    } finally {
      void reader?.cancel().catch(() => {}); reader?.releaseLock(); pending.delete(key);
    }
  };
  try {
    listeners.push(await bridge.addListener('mcpRequest', event => { void process(event); }));
    listeners.push(await bridge.addListener('mcpCancelled', event => {
      const row = cancelled.safeParse(event);
      if (row.success) pending.get(`${row.data.instanceId}:${row.data.requestId}`)?.abort();
    }));
    listeners.push(await bridge.addListener('mcpStopped', event => {
      const row = instance.safeParse(event);
      if (!row.success) return;
      if (endpoint) { if (row.data.instanceId === endpoint.instanceId) void close(); }
      else if (stoppedEarly.size < 8) stoppedEarly.add(row.data.instanceId);
    }));
    const info = await bridge.start({ address: options.address });
    // Retain a well-formed instance ID even if endpoint validation fails so the
    // native listener created by this call is still stopped in the catch path.
    if (uuid.safeParse(info?.instanceId).success) endpoint = info;
    endpoint = checkedEndpoint(info, options.address);
    if (closed || stoppedEarly.has(endpoint.instanceId)) throw Error('mcp-native-stopped');
    handler = options.createHandler(endpoint, assertAvailable);
    resolveReady();
    return { endpoint, close, assertAvailable };
  } catch {
    await close(); throw Error('mcp-native-transport');
  }
}

/** Preparing and exporting a ticket must precede opening the foreground
 * listener: a system Save/Share activity can pause the application. */
export async function prepareNativeMcpTransport(address: string, bridge: NativeMcpTransportPlugin = native) {
  if (!privateAddress(address) || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('KeepAnyMcpTransport')) throw Error('mcp-native-transport');
  let info: NativeMcpEndpoint | undefined;
  try { info = await bridge.prepare({ address }); info = checkedEndpoint(info, address); }
  catch {
    if (uuid.safeParse(info?.instanceId).success && info) await bridge.stop({ instanceId: info.instanceId }).catch(() => {});
    throw Error('mcp-native-transport');
  }
  const endpoint = info;
  let phase: 'prepared' | 'activating' | 'active' | 'closed' = 'prepared';
  let active: Awaited<ReturnType<typeof startNativeMcpTransport>> | undefined;
  return {
    endpoint,
    async activate(options: Omit<Parameters<typeof startNativeMcpTransport>[0], 'address'>) {
      if (phase !== 'prepared') throw Error('mcp-native-transport');
      phase = 'activating';
      const delegated: NativeMcpTransportPlugin = {
        reset: () => bridge.reset(), prepare: row => bridge.prepare(row), activate: row => bridge.activate(row),
        start: async () => {
          const result = await bridge.activate({ instanceId: endpoint.instanceId });
          if (['instanceId', 'endpoint', 'certificatePem', 'spkiSha256'].some(key => result[key as keyof NativeMcpEndpoint] !== endpoint[key as keyof NativeMcpEndpoint])) throw Error('mcp-native-transport');
          return result;
        },
        stop: row => bridge.stop(row), cancel: row => bridge.cancel(row),
        responseStart: row => bridge.responseStart(row), responseWrite: row => bridge.responseWrite(row), responseEnd: row => bridge.responseEnd(row),
        addListener: (event, listener) => bridge.addListener(event, listener),
      };
      try {
        const session = await startNativeMcpTransport({ ...options, address }, delegated);
        if (phase !== 'activating') { await session.close(); throw Error('mcp-native-transport'); }
        active = session; phase = 'active'; return session;
      } catch {
        phase = 'closed'; await bridge.stop({ instanceId: endpoint.instanceId }).catch(() => {}); throw Error('mcp-native-transport');
      }
    },
    async close() {
      phase = 'closed';
      if (active) await active.close();
      else await bridge.stop({ instanceId: endpoint.instanceId });
    },
  };
}
