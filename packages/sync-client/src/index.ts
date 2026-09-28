import { z } from 'zod';
import { syncPullResponseSchema, syncPushResponseSchema, type SyncChange, type SyncOperation } from '../../contracts/src';
import { generateWorkspaceKey, openSyncChangeEnvelope, ReplayGuard, sealEnvelope } from '../../crypto/src';
import type { LocalRepository, RecordRow, ScopedConflict } from '../../local-db/src';

export type SyncStatus = 'local' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed';
export interface SyncReport { status: SyncStatus; pending: number; cursor: number; conflict: ScopedConflict | null; error?: string }
export interface SelfHostConfig { endpoint: string; token: string; workspaceId: string; key: Uint8Array; keyEpoch?: number }
const workspaceSchema = z.uuid();
const text = new TextEncoder();
const decode = new TextDecoder('utf-8', { fatal: true });

export function normalizeEndpoint(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw Error('sync-endpoint');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('sync-endpoint');
  return url.origin;
}

export function decodeWorkspaceKey(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) throw Error('sync-key');
  const bytes = Uint8Array.from(atob(`${encoded.replace(/-/g, '+').replace(/_/g, '/')}=`), c => c.charCodeAt(0));
  if (bytes.length !== 32) throw Error('sync-key');
  return bytes;
}
export function encodeWorkspaceKey(key: Uint8Array): string {
  if (key.length !== 32) throw Error('sync-key');
  return btoa(String.fromCharCode(...key)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function newWorkspaceKey(): Promise<string> { return encodeWorkspaceKey(await generateWorkspaceKey()); }

async function request<T>(endpoint: string, token: string, route: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${endpoint}${route}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store', credentials: 'omit',
  });
  if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? 'sync-auth' : `sync-http-${response.status}`);
  return schema.parse(await response.json());
}

export async function createSelfHostedWorkspace(endpoint: string, token: string): Promise<string> {
  if (token.length < 32) throw Error('sync-auth');
  return (await request(normalizeEndpoint(endpoint), token, '/workspaces', {}, z.object({ workspaceId: workspaceSchema }))).workspaceId;
}

async function scopeFor(endpoint: string, workspaceId: string): Promise<string> {
  // Self-host mode has one stable server subject. Bearer token rotation must not abandon an outbox.
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', text.encode(JSON.stringify([endpoint, 'self-host-owner']))));
  return `${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}:${workspaceId}`;
}

function assertNoUnsupportedFiles(row: RecordRow): void {
  if (row.type !== 'asset') return;
  const attachments = (JSON.parse(row.payload) as { attachments?: unknown }).attachments;
  if (Array.isArray(attachments) && attachments.length) throw Error('sync-attachments-unsupported');
}

export class SelfHostSyncClient {
  readonly endpoint: string;
  readonly workspaceId: string;
  readonly keyEpoch: number;
  private readonly token: string;
  private readonly key: Uint8Array;
  private scopePromise: Promise<string>;
  private busy = false;

  constructor(private readonly repository: LocalRepository, config: SelfHostConfig) {
    this.endpoint = normalizeEndpoint(config.endpoint);
    this.workspaceId = workspaceSchema.parse(config.workspaceId).toLowerCase();
    if (config.token.length < 32) throw Error('sync-auth');
    if (config.key.length !== 32) throw Error('sync-key');
    this.token = config.token;
    this.key = Uint8Array.from(config.key);
    this.keyEpoch = config.keyEpoch ?? 1;
    if (!Number.isSafeInteger(this.keyEpoch) || this.keyEpoch < 1) throw Error('sync-key-epoch');
    this.scopePromise = scopeFor(this.endpoint, this.workspaceId);
  }

  async report(status: SyncStatus = 'local', error?: string): Promise<SyncReport> {
    const scope = await this.scopePromise;
    const [outbox, dirty, cursor, conflict] = await Promise.all([
      this.repository.listScopedOutbox(scope), this.repository.dirtyScopedRows(scope),
      this.repository.scopedCursor(scope), this.repository.scopedConflict(scope),
    ]);
    const pending = outbox.length + dirty.length;
    const blocked = outbox.some(item => item.blocked);
    return { status: conflict ? 'conflict' : blocked ? 'failed' : pending && (status === 'local' || status === 'synced') ? 'pending' : status,
      pending, cursor, conflict, ...(error ? { error } : {}) };
  }

  async resolve(choice: 'local' | 'remote'): Promise<SyncReport> {
    const scope = await this.scopePromise;
    await this.pinKey(scope);
    await this.repository.resolveScopedConflict(scope, choice);
    return this.report('pending');
  }

  async run(onStatus?: (report: SyncReport) => void): Promise<SyncReport> {
    if (this.busy) throw Error('sync-busy');
    this.busy = true;
    try {
      const scope = await this.scopePromise;
      const execute = () => this.runUnlocked(scope, onStatus);
      return typeof navigator !== 'undefined' && navigator.locks
        ? await navigator.locks.request(`keepany-sync:${scope}`, execute)
        : await execute();
    } finally { this.busy = false; }
  }

  private async runUnlocked(scope: string, onStatus?: (report: SyncReport) => void): Promise<SyncReport> {
    try {
      await this.pinKey(scope);
      // Never upload a partial asset collection when its referenced binary files cannot be transferred.
      for (const row of await this.repository.allRecords()) assertNoUnsupportedFiles(row);
      onStatus?.(await this.report('syncing'));
      const recovered = await this.repository.resumeScopedPull(scope);
      if (recovered === 'conflict') return this.report('conflict');
      await this.pushOutbox(scope);
      if (await this.pullAll(scope)) return this.report('conflict');
      for (const row of await this.repository.dirtyScopedRows(scope)) {
        const current = (await this.repository.allRecords()).find(item => item.id === row.id);
        if (!current || current.payload !== row.payload) continue;
        const base = await this.repository.scopedBaseFor(scope, row.id);
        const operationId = crypto.randomUUID();
        const expectedVersion = base?.version ?? 0;
        const tombstone = Boolean((JSON.parse(row.payload) as { deleted?: boolean }).deleted);
        const context = { workspaceId: this.workspaceId, recordId: row.id, kind: row.type,
          schemaVersion: 1, keyEpoch: this.keyEpoch, recordVersion: expectedVersion + 1, operationId, tombstone };
        const envelope = await sealEnvelope(text.encode(JSON.stringify(row)), this.key, context);
        const operation: SyncOperation = { operationId, id: row.id, kind: row.type, schemaVersion: 1,
          expectedVersion, ciphertext: JSON.stringify(envelope), tombstone, intent: base &&
          (JSON.parse(base.payload) as { deleted?: boolean }).deleted && !tombstone ? 'restore' : 'write' };
        await this.repository.stageScopedOutbox(scope, row, operation);
        await this.pushOutbox(scope);
        if (await this.pullAll(scope)) return this.report('conflict');
      }
      const report = await this.report('synced');
      onStatus?.(report);
      return report;
    } catch (error) {
      const report = await this.report('failed', error instanceof Error ? error.message : 'sync-failed');
      onStatus?.(report);
      return report;
    }
  }

  private async pinKey(scope: string): Promise<void> {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', this.key as BufferSource));
    const fingerprint = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    await this.repository.pinScopedKey(scope, fingerprint, this.keyEpoch);
  }

  private async pushOutbox(scope: string): Promise<void> {
    for (const item of await this.repository.listScopedOutbox(scope)) {
      if (item.blocked) continue;
      const response = await request(this.endpoint, this.token, '/sync/push',
        { workspaceId: this.workspaceId, operations: [item.operation] }, syncPushResponseSchema);
      const result = response.results[0];
      if (!result || result.operationId !== item.operation.operationId) throw Error('sync-push-response');
      if (result.status === 'accepted' || result.status === 'duplicate') {
        await this.repository.acknowledgeScopedOutbox(scope, result.operationId, result.version, this.keyEpoch);
      } else if (result.status === 'conflict') {
        await this.repository.blockScopedOutbox(scope, result.operationId);
      } else throw Error('sync-push-rejected');
    }
  }

  private async pullAll(scope: string): Promise<boolean> {
    for (let page = 0; page < 10000; page++) {
      const cursor = await this.repository.scopedCursor(scope);
      const response = await request(this.endpoint, this.token, '/sync/pull',
        { workspaceId: this.workspaceId, cursor, limit: 1 }, syncPullResponseSchema);
      if (!response.changes.length) {
        if (response.nextCursor !== cursor) throw Error('sync-cursor');
        return false;
      }
      const change = response.changes[0];
      if (response.changes.length !== 1 || response.nextCursor !== cursor + 1 || change.sequence !== cursor + 1) throw Error('sync-cursor');
      const row = await this.openChange(scope, change);
      const result = await this.repository.applyScopedPull(scope, { row, sequence: change.sequence,
        version: change.version, operationId: change.operationId, keyEpoch: this.keyEpoch, ciphertext: change.ciphertext });
      if (result === 'conflict') return true;
    }
    throw Error('sync-page-limit');
  }

  private async openChange(scope: string, change: SyncChange): Promise<RecordRow> {
    const base = await this.repository.scopedBaseFor(scope, change.id);
    if (base && change.version === base.version && change.operationId === base.operationId &&
      change.ciphertext === base.ciphertext && base.row && base.keyEpoch === this.keyEpoch &&
      change.kind === base.row.type && change.schemaVersion === 1 &&
      change.tombstone === Boolean((JSON.parse(base.payload) as { deleted?: boolean }).deleted)) return base.row;
    if (base && change.version <= base.version) throw Error('sync-replay');
    const guard = new ReplayGuard();
    if (base) {
      if (!base.operationId || !base.keyEpoch) throw Error('sync-baseline');
      guard.markApplied({ workspaceId: this.workspaceId, recordId: change.id, kind: change.kind,
        schemaVersion: change.schemaVersion, keyEpoch: base.keyEpoch, recordVersion: base.version,
        operationId: base.operationId, tombstone: Boolean((JSON.parse(base.payload) as { deleted?: boolean }).deleted) }, base.version);
    }
    const opened = await openSyncChangeEnvelope(JSON.parse(change.ciphertext), this.key,
      { workspaceId: this.workspaceId, change, keyEpoch: this.keyEpoch }, guard);
    const row = JSON.parse(decode.decode(opened.plaintext)) as RecordRow;
    if (row.id !== change.id || row.type !== change.kind ||
      Boolean((JSON.parse(row.payload) as { deleted?: boolean }).deleted) !== change.tombstone) throw Error('sync-content');
    assertNoUnsupportedFiles(row);
    return row;
  }
}
