import { assetSchema, type Asset } from '../../domain/src';
import { readableFields, writableFields, type ReadField, type WriteField } from './authority';
import type { BridgeScope, BrowserBridgeRequest, BrowserBridgeResult } from './bridge';
import type { AssetSnapshot, McpAssetStore } from './service';

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid-bridge-message');
  return value as Record<string, unknown>;
};
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) { resolve(); return; }
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
  signal.addEventListener('abort', done, { once: true });
});
const project = (snapshot: AssetSnapshot, scope: BridgeScope): AssetSnapshot => {
  const { asset } = snapshot;
  const partial: Record<string, unknown> = { id: asset.id, kind: asset.kind, createdAt: asset.createdAt,
    updatedAt: asset.updatedAt, deleted: asset.deleted };
  for (const field of scope.readFields) partial[field] = asset[field];
  // The wire shape is deliberately partial. Node fills schema defaults only after it has
  // rejected unapproved keys; the browser retains the complete canonical record.
  return { asset: partial as unknown as Asset, version: snapshot.version };
};

/** Runs inside the Web app's IndexedDB origin against its canonical RxDB adapter. */
export async function executeBrowserBridgeRequest(
  request: BrowserBridgeRequest, store: McpAssetStore, scope: BridgeScope,
  control?: { check(): void; checkRemote(id: string): Promise<void>; commit<T>(work: () => Promise<T>): Promise<T> },
): Promise<BrowserBridgeResult> {
  if (!request || typeof request.id !== 'string' || !Array.isArray(request.args) || Date.now() >= request.expiresAt)
    throw Error('invalid-bridge-message');
  const [id] = request.args;
  if (request.action === 'get') {
    if (typeof id !== 'string' || !scope.assetIds.includes(id)) throw Error('asset-denied');
    const item = await store.get(id);
    return item ? project(item, scope) : null;
  }
  if (request.action === 'list') {
    if (!Array.isArray(id) || id.some(item => typeof item !== 'string' || !scope.assetIds.includes(item)))
      throw Error('asset-denied');
    return (await store.list(id)).filter(item => id.includes(item.asset.id)).map(item => project(item, scope));
  }
  if (request.action === 'compareAndSet') {
    const check = async () => {
      if (Date.now() >= request.expiresAt) throw Error('bridge-request-expired');
      control?.check();
      await control?.checkRemote(request.id);
      if (Date.now() >= request.expiresAt) throw Error('bridge-request-expired');
      control?.check();
    };
    await check();
    const [, version, value] = request.args;
    if (typeof id !== 'string' || !scope.assetIds.includes(id) || typeof version !== 'string')
      throw Error('asset-denied');
    const next = assetSchema.parse(value);
    if (next.id !== id || next.deleted) throw Error('invalid-bridge-message');
    const current = await store.get(id);
    await check();
    if (!current || current.version !== version || current.asset.deleted) return 'conflict';
    const merged: Asset = { ...current.asset, updatedAt: next.updatedAt };
    for (const field of scope.writeFields) (merged as unknown as Record<WriteField, unknown>)[field] = next[field];
    const write = () => store.compareAndSet(id, version, assetSchema.parse(merged), check);
    return control ? control.commit(write) : write();
  }
  throw Error('invalid-bridge-message');
}

export interface BrowserBridgeOptions {
  /** Exact loopback URL and pairing secret received through trusted app UI/IPC. */
  url: string;
  pairingSecret: string;
  store: McpAssetStore;
  /** Required one-time user approval after the locally issued grant scope is displayed. */
  approve: (scope: BridgeScope) => Promise<boolean>;
  fetcher?: typeof fetch;
}

export class BrowserMcpBridgeClient {
  private sessionSecret = '';
  private expiresAt = 0;
  private scope: BridgeScope | null = null;
  private stopped = false;
  private writesCancelled = false;
  private writeMayHaveApplied = false;
  private readonly activeCommits = new Set<Promise<unknown>>();
  private revocation: Promise<{ writeMayHaveApplied: boolean }> | null = null;
  private closing: Promise<void> | null = null;
  private readonly loopAbort = new AbortController();
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: BrowserBridgeOptions) {
    const url = new URL(options.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' ||
      url.search || url.hash || !url.port || url.origin !== options.url) throw Error('invalid-bridge-url');
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  private async post(path: string, body: unknown, token?: string, signal?: AbortSignal) {
    const response = await this.fetcher(`${this.options.url}${path}`, { method: 'POST', mode: 'cors', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body), signal });
    if (response.status === 204) return null;
    if (!response.ok) throw Error('bridge-request-failed');
    return object(await response.json());
  }

  async pair() {
    if (this.sessionSecret || this.stopped) throw Error('bridge-already-paired');
    const reply = await this.post('/pair', { secret: this.options.pairingSecret });
    if (!reply) throw Error('bridge-pair-failed');
    const scope = object(reply.scope);
    const reads = scope.readFields;
    const writes = scope.writeFields;
    if (!Array.isArray(scope.assetIds) || scope.assetIds.length < 1 || scope.assetIds.length > 500 ||
      scope.assetIds.some(item => typeof item !== 'string' || item.length > 96) ||
      !Array.isArray(reads) || reads.some(item => !readableFields.includes(item as ReadField)) ||
      !Array.isArray(writes) || writes.some(item => !writableFields.includes(item as WriteField) || !reads.includes(item)) ||
      typeof reply.sessionSecret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(reply.sessionSecret) ||
      typeof reply.expiresAt !== 'number' || reply.expiresAt <= Date.now()) throw Error('invalid-bridge-pair');
    this.scope = scope as unknown as BridgeScope;
    this.sessionSecret = reply.sessionSecret;
    this.expiresAt = reply.expiresAt;
    let approved = false;
    try { approved = await this.options.approve(this.scope); }
    catch (error) { await this.revokeGrant().catch(() => this.close()); throw error; }
    if (!approved) { await this.revokeGrant().catch(() => this.close()); throw Error('bridge-approval-denied'); }
    return this.scope;
  }

  private token() {
    if (this.stopped || !this.sessionSecret || Date.now() >= this.expiresAt) throw Error('bridge-not-paired');
    return this.sessionSecret;
  }

  /** The trusted Web UI may show exact before/after values; this is never an MCP tool. */
  async pendingPreviews(): Promise<import('./service').PreviewResult[]> {
    const reply = await this.post('/pending-previews', {}, this.token());
    if (!reply || !Array.isArray(reply.previews)) throw Error('invalid-bridge-message');
    return reply.previews as import('./service').PreviewResult[];
  }

  async approvePreview(previewId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(previewId)) throw Error('invalid-preview-id');
    await this.post('/approve-preview', { previewId }, this.token());
  }

  async rejectPreview(previewId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(previewId)) throw Error('invalid-preview-id');
    await this.post('/reject-preview', { previewId }, this.token());
  }

  private checkWrite() {
    if (this.writesCancelled || this.stopped || Date.now() >= this.expiresAt) throw Error('bridge-write-cancelled');
  }

  private commit<T>(work: () => Promise<T>): Promise<T> {
    this.checkWrite();
    // Register before the work starts. Revoke/close can then cancel queued work
    // and wait for a storage write already underway before reporting completion.
    const task = Promise.resolve().then(() => { this.checkWrite(); return work(); });
    this.activeCommits.add(task);
    void task.finally(() => this.activeCommits.delete(task)).catch(() => undefined);
    return task;
  }

  private async drainCommits() {
    while (this.activeCommits.size) await Promise.allSettled([...this.activeCommits]);
  }

  /** A successful result is returned only after any already-started storage write settles. */
  revokeGrant(): Promise<{ writeMayHaveApplied: boolean }> {
    if (this.revocation) return this.revocation;
    const token = this.token();
    this.writesCancelled = true;
    this.writeMayHaveApplied ||= this.activeCommits.size > 0;
    const work = (async () => {
      await this.drainCommits();
      await this.post('/revoke-grant', {}, token);
      this.stopLocal();
      return { writeMayHaveApplied: this.writeMayHaveApplied };
    })();
    this.revocation = work;
    void work.finally(() => { if (this.revocation === work) this.revocation = null; }).catch(() => undefined);
    return work;
  }

  /** Keep this active only while the Web app is open. It never persists a token. */
  async run(signal?: AbortSignal) {
    if (!this.scope || !this.sessionSecret) throw Error('bridge-not-paired');
    const combined = signal ? AbortSignal.any([signal, this.loopAbort.signal]) : this.loopAbort.signal;
    try {
      while (!this.stopped && !combined.aborted && Date.now() < this.expiresAt) {
        const request = await this.post('/poll', {}, this.sessionSecret, combined);
        if (!request) { await sleep(100, combined); continue; }
        const message = request as unknown as BrowserBridgeRequest;
        let body: { id: string; result?: BrowserBridgeResult; error?: string };
        try {
          body = { id: message.id, result: await executeBrowserBridgeRequest(message, this.options.store, this.scope, {
            check: () => this.checkWrite(),
            checkRemote: async id => { await this.post('/check-write', { id }, this.sessionSecret); },
            commit: work => this.commit(work),
          }) };
        } catch { body = { id: message.id, error: 'browser-operation-failed' }; }
        if (combined.aborted) break;
        await this.post('/respond', body, this.sessionSecret, combined);
      }
    } catch (error) {
      if (!combined.aborted) throw error;
    } finally {
      if (!this.stopped && this.revocation) await this.revocation.catch(() => undefined);
      if (!this.stopped) await this.close();
    }
  }

  private stopLocal() {
    this.stopped = true;
    this.writesCancelled = true;
    this.loopAbort.abort();
    this.sessionSecret = '';
    this.scope = null;
  }

  /** Best-effort on page close; callers needing proof of revocation use revokeGrant(). */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.stopped) return Promise.resolve();
    const token = this.sessionSecret;
    this.stopLocal();
    this.closing = (async () => {
      await this.drainCommits();
      if (token) await this.post('/revoke-grant', {}, token).catch(() => undefined);
    })();
    return this.closing;
  }
}
