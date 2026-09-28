import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { assetSchema } from '../../domain/src';
import { McpAccessError, type McpAuthority, type ReadField, type WriteField } from './authority';
import type { AssetSnapshot, McpAssetStore, PreviewResult } from './service';

type Action = 'get' | 'list' | 'compareAndSet';
type Request = { id: string; action: Action; args: unknown[]; expiresAt: number };
type Pending = Request & { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

const secret = () => randomBytes(32).toString('base64url');
const equal = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length === 43 && timingSafeEqual(a, b);
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new McpAccessError('invalid-request');
  return value as Record<string, unknown>;
};
const json = async (request: IncomingMessage) => {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) throw new McpAccessError('invalid-content-type');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > 1_000_000) throw new McpAccessError('body-too-large');
    chunks.push(chunk);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch { throw new McpAccessError('invalid-request'); }
};

export interface LocalBridgeOptions {
  /** Exact web application origin chosen by the trusted launcher; never inferred from a request. */
  appOrigin: string;
  authority: McpAuthority;
  grantId: string;
  grantSecret: string;
  requestTimeoutMs?: number;
}

export interface LocalMcpBridge {
  /** Loopback only. The random port is selected by the OS. */
  url: string;
  /** One-time, two-minute secret. Deliver through a trusted UI/IPC, never MCP stdout or a URL. */
  pairingSecret: string;
  /** Resolves only after the first successful, authenticated browser pairing. */
  paired: Promise<void>;
  store: McpAssetStore;
  /** Receives the exact write preview from the MCP tool, never a model approval. */
  publishPreview(preview: PreviewResult): void;
  close(): Promise<void>;
}

/** A single-process, single-browser-peer RPC relay. It is not a general HTTP asset API. */
export async function startLocalMcpBridge(options: LocalBridgeOptions): Promise<LocalMcpBridge> {
  const origin = new URL(options.appOrigin);
  if (origin.origin !== options.appOrigin || !['https:', 'http:'].includes(origin.protocol) ||
    (origin.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))) {
    throw new McpAccessError('invalid-app-origin');
  }
  const grant = await options.authority.requireGrant(options.grantId, options.grantSecret);
  const permittedWireFields = new Set(['id', 'kind', 'createdAt', 'updatedAt', 'deleted', ...grant.readFields]);
  const wireAsset = (raw: unknown) => {
    const value = object(raw);
    if (Object.keys(value).some(key => !permittedWireFields.has(key))) throw new McpAccessError('invalid-browser-result');
    // The domain schema requires a name even when the grant does not expose it.
    // This sentinel is never projected to MCP output; browser writes merge only approved fields.
    return assetSchema.parse({ name: '[private]', ...value });
  };
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 30_000)
    throw new McpAccessError('invalid-timeout');

  let pairingSecret = secret();
  let pairExpiresAt = Date.now() + 120_000;
  let sessionSecret = '';
  let sessionExpiresAt = 0;
  let sessionTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let pairedResolve!: () => void;
  let pairedReject!: (error: Error) => void;
  const pairedPromise = new Promise<void>((resolve, reject) => { pairedResolve = resolve; pairedReject = reject; });
  // The launcher may close before it starts waiting for the pair result.
  void pairedPromise.catch(() => undefined);
  const queue: Request[] = [];
  const pending = new Map<string, Pending>();
  const previews = new Map<string, PreviewResult>();
  let store!: McpAssetStore;

  const failPending = (code: string) => {
    queue.length = 0;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new McpAccessError(code)); }
    pending.clear();
  };
  const allowed = async () => {
    if (closed) throw new McpAccessError('bridge-closed');
    await options.authority.requireGrant(options.grantId, options.grantSecret);
  };
  const paired = async (request: IncomingMessage) => {
    await allowed();
    const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '');
    if (!bearer || !sessionSecret || !equal(bearer[1], sessionSecret) || Date.now() >= sessionExpiresAt)
      throw new McpAccessError('bridge-denied');
  };
  const reply = (response: ServerResponse, status: number, value?: unknown) => {
    response.statusCode = status;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (value !== undefined) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); }
    else response.end();
  };

  const server = createServer(async (request, response) => {
    try {
      const address = server.address() as AddressInfo;
      if (request.headers.host !== `127.0.0.1:${address.port}` || request.headers.origin !== options.appOrigin)
        throw new McpAccessError('bridge-denied');
      response.setHeader('Access-Control-Allow-Origin', options.appOrigin);
      response.setHeader('Vary', 'Origin');
      if (request.method === 'OPTIONS') {
        if (request.headers['access-control-request-method'] !== 'POST') throw new McpAccessError('bridge-denied');
        response.setHeader('Access-Control-Allow-Methods', 'POST');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        reply(response, 204); return;
      }
      if (request.method !== 'POST') throw new McpAccessError('bridge-denied');
      if (request.url === '/pair') {
        await allowed();
        const body = await json(request);
        if (sessionSecret || Date.now() >= pairExpiresAt || typeof body.secret !== 'string' || !equal(body.secret, pairingSecret))
          throw new McpAccessError('bridge-denied');
        sessionSecret = secret();
        pairingSecret = '';
        pairExpiresAt = 0;
        sessionExpiresAt = Math.min(Date.now() + 15 * 60_000, grant.expiresAt);
        clearTimeout(pairTimer);
        sessionTimer = setTimeout(() => { void stop(); }, Math.max(0, sessionExpiresAt - Date.now()));
        pairedResolve();
        reply(response, 200, { sessionSecret, expiresAt: sessionExpiresAt,
          scope: { assetIds: grant.assetIds, readFields: grant.readFields, writeFields: grant.writeFields } });
        return;
      }
      await paired(request);
      if (request.url === '/poll') {
        await json(request);
        let next: Request | undefined;
        for (;;) {
          next = queue.shift();
          if (!next || (pending.has(next.id) && Date.now() < next.expiresAt)) break;
        }
        reply(response, next ? 200 : 204, next); return;
      }
      if (request.url === '/respond') {
        const body = await json(request);
        if (typeof body.id !== 'string') throw new McpAccessError('invalid-request');
        const item = pending.get(body.id);
        if (!item || Date.now() >= item.expiresAt) throw new McpAccessError('request-expired');
        pending.delete(item.id);
        clearTimeout(item.timer);
        if (body.error !== undefined) item.reject(new McpAccessError('browser-operation-failed'));
        else item.resolve(body.result);
        reply(response, 204); return;
      }
      if (request.url === '/check-write') {
        const body = await json(request);
        const item = typeof body.id === 'string' ? pending.get(body.id) : undefined;
        if (item?.action !== 'compareAndSet' || Date.now() >= item.expiresAt)
          throw new McpAccessError('request-expired');
        reply(response, 204); return;
      }
      if (request.url === '/pending-previews') {
        await json(request);
        const visible: PreviewResult[] = [];
        for (const [id, preview] of previews) {
          try { await options.authority.pendingPreview(grant.id, id); visible.push(preview); }
          catch { previews.delete(id); }
        }
        reply(response, 200, { previews: visible }); return;
      }
      if (request.url === '/approve-preview' || request.url === '/reject-preview') {
        const body = await json(request);
        if (typeof body.previewId !== 'string') throw new McpAccessError('preview-denied');
        const preview = previews.get(body.previewId);
        if (!preview) throw new McpAccessError('preview-denied');
        const registered = await options.authority.pendingPreview(grant.id, body.previewId);
        if (registered.assetId !== preview.assetId || registered.operationId !== preview.operationId ||
          registered.expectedVersion !== preview.expectedVersion || registered.expiresAt !== preview.expiresAt)
          throw new McpAccessError('preview-denied');
        if (request.url === '/approve-preview') {
          // Ask the active browser for the current RxDB version. A stale preview
          // cannot be approved, even when it is still inside its five-minute TTL.
          const current = await store.get(preview.assetId);
          if (!current || current.asset.deleted || current.version !== preview.expectedVersion)
            throw new McpAccessError('write-conflict');
          await options.authority.approvePreview(grant.id, body.previewId);
        } else await options.authority.rejectPreview(grant.id, body.previewId);
        previews.delete(body.previewId);
        reply(response, 204); return;
      }
      if (request.url === '/revoke-grant') {
        await json(request);
        await options.authority.revokeGrant(grant.id);
        previews.clear();
        failPending('grant-denied');
        reply(response, 204);
        queueMicrotask(() => { void stop(); });
        return;
      }
      throw new McpAccessError('bridge-denied');
    } catch (error) {
      const code = error instanceof McpAccessError ? error.code : 'bridge-failed';
      reply(response, code === 'bridge-denied' || code === 'grant-denied' ? 403 : 400, { error: code });
    }
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  } catch (error) { server.close(); throw error; }
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  const call = async (action: Action, args: unknown[]) => {
    await allowed();
    if (!sessionSecret || Date.now() >= sessionExpiresAt) throw new McpAccessError('bridge-unpaired');
    if (pending.size >= 16) throw new McpAccessError('bridge-busy');
    const id = randomUUID();
    const expiresAt = Date.now() + requestTimeoutMs;
    const value = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new McpAccessError('bridge-timeout')); }, requestTimeoutMs);
      const item: Pending = { id, action, args, expiresAt, resolve, reject, timer };
      pending.set(id, item);
      queue.push({ id, action, args, expiresAt });
    });
    await allowed(); // Revocation while the browser was working must not release a result.
    return value;
  };
  store = {
    async get(id) {
      if (!grant.assetIds.includes(id)) throw new McpAccessError('asset-denied');
      const value = await call('get', [id]);
      if (value === null) return null;
      const row = object(value);
      const asset = wireAsset(row.asset);
      if (asset.id !== id || typeof row.version !== 'string') throw new McpAccessError('invalid-browser-result');
      return { asset, version: row.version };
    },
    async list(ids) {
      if (ids.some(id => !grant.assetIds.includes(id))) throw new McpAccessError('asset-denied');
      const value = await call('list', [ids]);
      if (!Array.isArray(value) || value.length > ids.length) throw new McpAccessError('invalid-browser-result');
      const seen = new Set<string>();
      return value.map(raw => {
        const row = object(raw);
        const asset = wireAsset(row.asset);
        if (!ids.includes(asset.id) || seen.has(asset.id) || typeof row.version !== 'string') throw new McpAccessError('invalid-browser-result');
        seen.add(asset.id);
        return { asset, version: row.version };
      });
    },
    async compareAndSet(id, version, next) {
      if (!grant.assetIds.includes(id)) throw new McpAccessError('asset-denied');
      const value = await call('compareAndSet', [id, version, next]);
      if (value !== 'applied' && value !== 'conflict') throw new McpAccessError('invalid-browser-result');
      return value;
    },
  };
  const stop = async () => {
      if (closed) return;
      closed = true;
      clearTimeout(pairTimer);
      clearTimeout(sessionTimer);
      sessionSecret = ''; pairingSecret = '';
      previews.clear();
      pairedReject(new McpAccessError('bridge-closed'));
      failPending('bridge-closed');
      await new Promise<void>(resolve => server.close(() => resolve()));
  };
  const pairTimer = setTimeout(() => { void stop(); }, 120_000);
  return { url, get pairingSecret() { return pairingSecret; }, paired: pairedPromise,
    store,
    publishPreview(preview) {
      if (closed || !sessionSecret || Date.now() >= sessionExpiresAt || preview.expiresAt <= Date.now() ||
        previews.size >= 32) throw new McpAccessError('preview-denied');
      const previous = previews.get(preview.previewId);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(preview)) throw new McpAccessError('preview-denied');
        return;
      }
      previews.set(preview.previewId, structuredClone(preview));
    },
    close: stop,
  };
}

export interface BridgeScope { assetIds: string[]; readFields: ReadField[]; writeFields: WriteField[] }
export type BrowserBridgeRequest = { id: string; action: Action; args: unknown[]; expiresAt: number };
export type BrowserBridgeResult = AssetSnapshot | AssetSnapshot[] | 'applied' | 'conflict' | null;
