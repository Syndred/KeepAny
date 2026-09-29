import { z } from 'zod';
import { syncPullResponseSchema, syncPushResponseSchema, type SyncChange, type SyncOperation } from '../../contracts/src';
import { generateWorkspaceKey, openSyncChangeEnvelope, ReplayGuard, sealEnvelope, type RecoveryWrap } from '../../crypto/src';
import type { LocalRepository, RecordRow, ScopedConflict, ScopedOutbox } from '../../local-db/src';
import { SelfHostAttachmentSync } from './attachment-sync';

export type SyncStatus = 'local' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed';
export interface SyncReport { status: SyncStatus; pending: number; cursor: number; conflict: ScopedConflict | null; error?: string }
interface SelfHostBaseConfig { endpoint: string; workspaceId: string; key: Uint8Array; keyEpoch?: number }
export interface BoundSyncAuthorizer {
  accountId: string;
  headers(method: 'GET' | 'POST' | 'PUT', url: string): Promise<{ Authorization: string; DPoP: string }>;
  assertCurrent(): Promise<void>;
}
export type KeyEnvelopeConfig = { endpoint: string; workspaceId: string } & ({ token: string; sessionAccountId?: never; bound?: never } |
  { sessionAccountId: string; token?: never; bound?: never } |
  { bound: BoundSyncAuthorizer; token?: never; sessionAccountId?: never });
export type SelfHostConfig = SelfHostBaseConfig & KeyEnvelopeConfig;
const workspaceSchema = z.uuid();
const preflightSchema = z.object({ accountId: z.string().min(1).max(256), workspaceId: workspaceSchema });
const keyFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const recoveryWrapSchema = z.object({
  format: z.literal('keepany-recovery-wrap'), version: z.literal(1), workspaceId: workspaceSchema,
  keyEpoch: z.literal(1), nonce: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  ciphertext: z.string().regex(/^[A-Za-z0-9_-]{64}$/),
});
const keyEnvelopeKindSchema = z.enum(['recovery', 'join']);
const keyEnvelopeMetadataSchema = z.object({
  envelopeId: workspaceSchema, kind: keyEnvelopeKindSchema, keyEpoch: z.number().int().positive(),
  keyFingerprint: keyFingerprintSchema, expiresAt: z.iso.datetime().nullable(), createdAt: z.iso.datetime(),
});
const keyEnvelopeSchema = keyEnvelopeMetadataSchema.extend({ wrap: recoveryWrapSchema });
export type KeyEnvelopeMetadata = z.infer<typeof keyEnvelopeMetadataSchema>;
export type KeyEnvelope = KeyEnvelopeMetadata & { wrap: RecoveryWrap };
export type CreateKeyEnvelope = { kind: 'recovery' | 'join'; wrap: RecoveryWrap; keyFingerprint: string;
  expiresInSeconds?: number };
function assertActiveEnvelope(metadata: KeyEnvelopeMetadata): void {
  if (metadata.kind === 'recovery' ? metadata.expiresAt !== null : metadata.expiresAt === null)
    throw Error('sync-key-envelope-response');
  if (metadata.expiresAt !== null && Date.parse(metadata.expiresAt) <= Date.now())
    throw Error('sync-key-envelope-expired');
}
const text = new TextEncoder();
const decode = new TextDecoder('utf-8', { fatal: true });
const scopeLocks = new Map<string, Promise<void>>();

async function withScopeLock<T>(scope: string, action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(`keepany-sync:${scope}`, action);
  }
  // The browser lock spans tabs. This queue covers callers sharing one JS runtime
  // (including the Node protocol tests) where navigator.locks is unavailable.
  const previous = scopeLocks.get(scope) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  scopeLocks.set(scope, current);
  await previous;
  try { return await action(); }
  finally {
    release();
    if (scopeLocks.get(scope) === current) scopeLocks.delete(scope);
  }
}

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

type RequestAuthorization = { token: string; sessionAccountId?: never; bound?: never } |
  { sessionAccountId: string | undefined; token?: never; bound?: never } |
  { bound: BoundSyncAuthorizer; token?: never; sessionAccountId?: never };

async function request<T>(endpoint: string, auth: RequestAuthorization, method: 'GET' | 'POST', route: string,
  schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const url = `${endpoint}${route}`;
  await auth.bound?.assertCurrent();
  const boundHeaders = auth.bound ? await auth.bound.headers(method, url) : {};
  await auth.bound?.assertCurrent();
  const response = await fetch(url, {
    method, headers: { ...boundHeaders, ...(auth.token === undefined ? {} : { Authorization: `Bearer ${auth.token}` }),
      ...(auth.sessionAccountId === undefined ? {} : { 'X-KeepAny-Account-Id': auth.sessionAccountId }),
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store', credentials: 'sessionAccountId' in auth ? 'include' : 'omit',
    signal: AbortSignal.timeout(30_000),
  });
  await auth.bound?.assertCurrent();
  if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? 'sync-auth' : `sync-http-${response.status}`);
  const parsed = schema.parse(await response.json());
  await auth.bound?.assertCurrent();
  return parsed;
}

export async function createSelfHostedWorkspace(endpoint: string, token: string): Promise<string> {
  if (token.length < 32) throw Error('sync-auth');
  return (await request(normalizeEndpoint(endpoint), { token }, 'POST', '/workspaces',
    z.object({ workspaceId: workspaceSchema }), {})).workspaceId;
}

export async function getSessionIdentity(endpoint: string): Promise<string> {
  const response = await request(normalizeEndpoint(endpoint), { sessionAccountId: undefined }, 'POST', '/sync/identity',
    z.object({ accountId: z.string().min(1).max(256) }), {});
  if (!response.accountId.startsWith('selfhost:') || response.accountId.length <= 'selfhost:'.length)
    throw Error('sync-account-mismatch');
  return response.accountId;
}

export async function createSessionWorkspace(endpoint: string): Promise<string> {
  const accountId = await getSessionIdentity(endpoint);
  return (await request(normalizeEndpoint(endpoint), { sessionAccountId: accountId }, 'POST', '/workspaces',
    z.object({ workspaceId: workspaceSchema }), {})).workspaceId;
}

function checkedBound(bound: BoundSyncAuthorizer): BoundSyncAuthorizer {
  if (!/^keepanyadm:[A-Za-z0-9_-]{1,128}$/.test(bound.accountId) ||
    typeof bound.headers !== 'function' || typeof bound.assertCurrent !== 'function') throw Error('sync-auth');
  return bound;
}

function checkedAuthorization(config: KeyEnvelopeConfig): { token?: string; bound?: BoundSyncAuthorizer; accountId: string } {
  const session = config.sessionAccountId !== undefined;
  const bound = config.bound !== undefined;
  if (Number(session) + Number(config.token !== undefined) + Number(bound) !== 1) throw Error('sync-auth');
  if (config.token !== undefined && config.token.length < 32) throw Error('sync-auth');
  if (session && (!z.string().min(1).max(256).safeParse(config.sessionAccountId).success ||
    !config.sessionAccountId?.startsWith('selfhost:') || config.sessionAccountId.length <= 'selfhost:'.length))
    throw Error('sync-auth');
  if (config.bound) checkedBound(config.bound);
  return { token: config.token, bound: config.bound,
    accountId: config.bound?.accountId ?? config.sessionAccountId ?? 'self-host-owner' };
}

/** Opaque encrypted key wraps. This client never accepts a recovery credential or data key. */
export class KeyEnvelopeClient {
  readonly endpoint: string;
  readonly workspaceId: string;
  readonly accountId: string;
  private readonly token: string | undefined;
  private readonly bound: BoundSyncAuthorizer | undefined;

  constructor(config: KeyEnvelopeConfig) {
    this.endpoint = normalizeEndpoint(config.endpoint);
    this.workspaceId = workspaceSchema.parse(config.workspaceId).toLowerCase();
    const auth = checkedAuthorization(config);
    this.accountId = auth.accountId;
    this.token = auth.token;
    this.bound = auth.bound;
  }

  async create(input: CreateKeyEnvelope): Promise<KeyEnvelopeMetadata> {
    const wrap = recoveryWrapSchema.parse(input.wrap);
    if (wrap.workspaceId !== this.workspaceId) throw Error('sync-key-envelope-context');
    keyFingerprintSchema.parse(input.keyFingerprint);
    keyEnvelopeKindSchema.parse(input.kind);
    if (input.kind === 'join' && (typeof input.expiresInSeconds !== 'number' ||
      !Number.isSafeInteger(input.expiresInSeconds) ||
      input.expiresInSeconds < 60 || input.expiresInSeconds > 900)) throw Error('sync-key-envelope-expiry');
    if (input.kind === 'recovery' && input.expiresInSeconds !== undefined) throw Error('sync-key-envelope-expiry');
    await this.verifyTarget();
    const response = await request(this.endpoint, this.authorization(), 'POST',
      `/workspaces/${this.workspaceId}/key-envelopes`, keyEnvelopeMetadataSchema, input);
    if (response.kind !== input.kind || response.keyEpoch !== wrap.keyEpoch ||
      response.keyFingerprint !== input.keyFingerprint)
      throw Error('sync-key-envelope-response');
    assertActiveEnvelope(response);
    return response;
  }

  async list(): Promise<KeyEnvelopeMetadata[]> {
    await this.verifyTarget();
    const response = await request(this.endpoint, this.authorization(), 'GET',
      `/workspaces/${this.workspaceId}/key-envelopes`, z.object({ envelopes: z.array(keyEnvelopeMetadataSchema) }));
    for (const envelope of response.envelopes) assertActiveEnvelope(envelope);
    return response.envelopes;
  }

  async get(envelopeId: string): Promise<KeyEnvelope> {
    const id = workspaceSchema.parse(envelopeId).toLowerCase();
    await this.verifyTarget();
    const response = await request(this.endpoint, this.authorization(), 'GET',
      `/workspaces/${this.workspaceId}/key-envelopes/${id}`, keyEnvelopeSchema);
    if (response.envelopeId !== id || response.wrap.workspaceId !== this.workspaceId ||
      response.wrap.keyEpoch !== response.keyEpoch)
      throw Error('sync-key-envelope-response');
    assertActiveEnvelope(response);
    return response;
  }

  async revoke(envelopeId: string): Promise<void> {
    const id = workspaceSchema.parse(envelopeId).toLowerCase();
    await this.verifyTarget();
    const response = await request(this.endpoint, this.authorization(), 'POST',
      `/workspaces/${this.workspaceId}/key-envelopes/${id}/revoke`, z.object({ status: z.literal('revoked') }), {});
    if (response.status !== 'revoked') throw Error('sync-key-envelope-response');
  }

  async verifyTarget(): Promise<{ accountId: string; workspaceId: string }> {
    const { accountId, workspaceId } = await request(this.endpoint, this.authorization(), 'POST', '/sync/preflight',
      preflightSchema, { workspaceId: this.workspaceId });
    if (accountId !== this.accountId || workspaceId !== this.workspaceId ||
      (this.bound && this.bound.accountId !== this.accountId)) throw Error('sync-account-mismatch');
    await this.bound?.assertCurrent();
    return { accountId, workspaceId };
  }

  private authorization(): RequestAuthorization {
    return this.bound ? { bound: this.bound } : this.token !== undefined ? { token: this.token } :
      { sessionAccountId: this.accountId };
  }
}

export async function getBoundIdentity(endpoint: string, bound: BoundSyncAuthorizer): Promise<string> {
  const authorizer = checkedBound(bound);
  const expectedAccountId = authorizer.accountId;
  const response = await request(normalizeEndpoint(endpoint), { bound: authorizer }, 'POST', '/sync/identity',
    z.object({ accountId: z.string().min(1).max(256) }), {});
  if (response.accountId !== expectedAccountId || authorizer.accountId !== expectedAccountId)
    throw Error('sync-account-mismatch');
  return response.accountId;
}

export async function listBoundWorkspaces(endpoint: string, bound: BoundSyncAuthorizer): Promise<string[]> {
  const authorizer = checkedBound(bound);
  await getBoundIdentity(endpoint, authorizer);
  const response = await request(normalizeEndpoint(endpoint), { bound: authorizer }, 'GET', '/workspaces',
    z.object({ workspaces: z.array(z.object({ workspaceId: workspaceSchema,
      canRead: z.boolean(), canWrite: z.boolean() })) }));
  return response.workspaces.filter(workspace => workspace.canRead && workspace.canWrite)
    .map(workspace => workspace.workspaceId);
}

export async function createBoundWorkspace(endpoint: string, bound: BoundSyncAuthorizer): Promise<string> {
  const authorizer = checkedBound(bound);
  await getBoundIdentity(endpoint, authorizer);
  return (await request(normalizeEndpoint(endpoint), { bound: authorizer }, 'POST', '/workspaces',
    z.object({ workspaceId: workspaceSchema }), {})).workspaceId;
}

async function scopeFor(endpoint: string, accountId: string, workspaceId: string): Promise<string> {
  // The server subject remains stable across credential rotation. A session subject
  // only becomes trusted after the authenticated preflight agrees with this ID.
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', text.encode(JSON.stringify([endpoint, accountId]))));
  return `${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}:${workspaceId}`;
}

export class SelfHostSyncClient {
  readonly endpoint: string;
  readonly workspaceId: string;
  readonly keyEpoch: number;
  private readonly token: string | undefined;
  private readonly bound: BoundSyncAuthorizer | undefined;
  private readonly accountId: string;
  private readonly key: Uint8Array;
  private scopePromise: Promise<string>;
  private busy = false;

  constructor(private readonly repository: LocalRepository, config: SelfHostConfig) {
    this.endpoint = normalizeEndpoint(config.endpoint);
    this.workspaceId = workspaceSchema.parse(config.workspaceId).toLowerCase();
    const auth = checkedAuthorization(config);
    if (config.key.length !== 32) throw Error('sync-key');
    this.token = auth.token;
    this.bound = auth.bound;
    this.accountId = auth.accountId;
    this.key = Uint8Array.from(config.key);
    this.keyEpoch = config.keyEpoch ?? 1;
    if (!Number.isSafeInteger(this.keyEpoch) || this.keyEpoch < 1) throw Error('sync-key-epoch');
    this.scopePromise = scopeFor(this.endpoint, this.accountId, this.workspaceId);
  }

  async report(status: SyncStatus = 'local', error?: string): Promise<SyncReport> {
    const scope = await this.scopePromise;
    const binding = await this.repository.getDatasetBinding();
    if (binding && (binding.scope !== scope || binding.endpoint !== this.endpoint ||
      binding.accountId !== this.accountId || binding.workspaceId !== this.workspaceId)) {
      return { status: 'failed', pending: 0, cursor: 0, conflict: null, error: 'sync-dataset-bound' };
    }
    const subscriptionFailure = async (): Promise<SyncReport> => ({ status: 'failed', pending: 0,
      cursor: await this.repository.scopedCursor(scope), conflict: null, error: 'subscription-relations-pending' });
    // Status reads must not transfer or repair a partially saved subscription.
    if (await this.repository.fileStore.subscriptionSaveJournal.count()) return subscriptionFailure();
    let outbox: ScopedOutbox[];
    let dirty: RecordRow[], cursor: number, conflict: ScopedConflict | null;
    try {
      [outbox, dirty, cursor, conflict] = await Promise.all([
        this.repository.listScopedOutbox(scope), this.repository.dirtyScopedRows(scope),
        this.repository.scopedCursor(scope), this.repository.scopedConflict(scope),
      ]);
    } catch (error) {
      if (error instanceof Error && error.message === 'subscription-relations-pending') return subscriptionFailure();
      throw error;
    }
    const pending = outbox.length + dirty.length;
    const blocked = outbox.some(item => item.blocked);
    return { status: status === 'failed' ? 'failed' : conflict ? 'conflict' : blocked ? 'failed' : pending && (status === 'local' || status === 'synced') ? 'pending' : status,
      pending, cursor, conflict: status === 'failed' ? null : conflict, ...(error ? { error } : {}) };
  }

  async resolve(choice: 'local' | 'remote'): Promise<SyncReport> {
    const scope = await this.scopePromise;
    return withScopeLock(scope, async () => {
      await this.verifyDataset(scope);
      await this.pinKey(scope);
      const remote = await this.repository.pendingScopedPullRow(scope);
      if (remote) await this.attachments(scope).ensureDownloadedRow(remote);
      await this.assertCurrent();
      await this.repository.resolveScopedConflict(scope, choice);
      return this.report('pending');
    });
  }

  async run(onStatus?: (report: SyncReport) => void): Promise<SyncReport> {
    if (this.busy) throw Error('sync-busy');
    this.busy = true;
    try {
      const scope = await this.scopePromise;
      return await withScopeLock(scope, () => this.runUnlocked(scope, onStatus));
    } finally { this.busy = false; }
  }

  async verifyTarget(): Promise<void> {
    const scope = await this.scopePromise;
    await withScopeLock(scope, async () => {
      await this.verifyDataset(scope);
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', this.key as BufferSource));
      const fingerprint = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      await this.repository.verifyPinnedScopedKey(scope, fingerprint, this.keyEpoch);
    });
  }

  private async runUnlocked(scope: string, onStatus?: (report: SyncReport) => void): Promise<SyncReport> {
    try {
      await this.repository.retryAllSubscriptionSaves();
      await this.verifyDataset(scope);
      const keyState = await this.pinKey(scope);
      const attachments = this.attachments(scope);
      onStatus?.(await this.report('syncing'));
      const interruptedPull = await this.repository.pendingScopedPullRow(scope);
      if (interruptedPull) await attachments.ensureDownloadedRow(interruptedPull);
      await this.assertCurrent();
      const recovered = await this.repository.resumeScopedPull(scope);
      if (recovered === 'conflict') return this.report('conflict');
      // Before the first trusted key exists, authenticate remote records before
      // sending local ciphertext. A wrong but well-formed key must not upload assets.
      if (keyState === 'provisional' && await this.pullAll(scope, attachments)) return this.report('conflict');
      await this.pushOutbox(scope, attachments);
      if (await this.pullAll(scope, attachments)) return this.report('conflict');
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
        await this.assertCurrent();
        await this.repository.stageScopedOutbox(scope, row, operation);
      }
      await this.pushOutbox(scope, attachments);
      if (await this.pullAll(scope, attachments)) return this.report('conflict');
      const report = await this.report('synced');
      await this.assertCurrent();
      onStatus?.(report);
      return report;
    } catch (error) {
      const report = await this.report('failed', error instanceof Error ? error.message : 'sync-failed');
      onStatus?.(report);
      return report;
    }
  }

  private async verifyDataset(scope: string): Promise<void> {
    const { accountId, workspaceId } = await request(this.endpoint, this.authorization(), 'POST', '/sync/preflight',
      preflightSchema, { workspaceId: this.workspaceId });
    // The account ID provided at setup cannot identify a dataset on its own. Require
    // this request's authenticated server subject before claiming or sending records.
    if (accountId !== this.accountId || workspaceId !== this.workspaceId) throw Error('sync-account-mismatch');
    await this.assertCurrent();
    await this.repository.claimDatasetBinding({
      endpoint: this.endpoint, accountId, workspaceId: this.workspaceId, scope,
    });
  }

  private async pinKey(scope: string): Promise<'provisional' | 'trusted'> {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', this.key as BufferSource));
    const fingerprint = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    await this.assertCurrent();
    return this.repository.pinScopedKey(scope, fingerprint, this.keyEpoch);
  }

  private authorization(): RequestAuthorization {
    return this.bound ? { bound: this.bound } : this.token !== undefined ? { token: this.token } :
      { sessionAccountId: this.accountId };
  }

  private async assertCurrent(): Promise<void> { await this.bound?.assertCurrent(); }

  private attachments(scope: string): SelfHostAttachmentSync {
    return new SelfHostAttachmentSync(this.repository, scope, this.endpoint, this.token,
      this.workspaceId, this.key, this.keyEpoch,
      this.token === undefined && !this.bound ? this.accountId : undefined, this.bound);
  }

  private async pushOutbox(scope: string, attachments: SelfHostAttachmentSync): Promise<void> {
    const pending = (await this.repository.listScopedOutbox(scope)).filter(item => !item.blocked);
    let offset = 0;
    while (offset < pending.length) {
      const batch: typeof pending = [];
      let bytes = 0;
      while (offset < pending.length && batch.length < 100) {
        const item = pending[offset];
        const size = JSON.stringify(item.operation).length + 1;
        if (size > 3_500_000) throw Error('sync-operation-size');
        if (batch.length && bytes + size > 3_500_000) break;
        batch.push(item);
        bytes += size;
        offset++;
      }
      for (const item of batch) await attachments.ensureUploadedRow(item.row);
      const response = await request(this.endpoint, this.authorization(), 'POST', '/sync/push',
        syncPushResponseSchema, { workspaceId: this.workspaceId, operations: batch.map(item => item.operation) });
      if (response.results.length !== batch.length ||
        response.results.some((result, index) => result.operationId !== batch[index].operation.operationId)) throw Error('sync-push-response');
      for (const [index, result] of response.results.entries()) {
        if (result.status === 'accepted' || result.status === 'duplicate') {
          await this.assertCurrent();
          await this.repository.acknowledgeScopedOutbox(scope, result.operationId, result.version, this.keyEpoch);
          await attachments.forgetUploadedRow(batch[index].row);
        } else if (result.status === 'conflict') {
          await this.assertCurrent();
          await this.repository.blockScopedOutbox(scope, result.operationId);
        } else throw Error('sync-push-rejected');
      }
    }
  }

  private async pullAll(scope: string, attachments: SelfHostAttachmentSync): Promise<boolean> {
    for (let page = 0; page < 10000; page++) {
      const cursor = await this.repository.scopedCursor(scope);
      const response = await request(this.endpoint, this.authorization(), 'POST', '/sync/pull',
        syncPullResponseSchema, { workspaceId: this.workspaceId, cursor, limit: 100 });
      if (!response.changes.length) {
        if (response.nextCursor !== cursor) throw Error('sync-cursor');
        return false;
      }
      if (response.changes.some((change, index) => change.sequence !== cursor + index + 1) ||
        response.nextCursor !== cursor + response.changes.length) throw Error('sync-cursor');
      for (const change of response.changes) {
        const row = await this.openChange(scope, change);
        await attachments.ensureDownloadedRow(row);
        await this.assertCurrent();
        const result = await this.repository.applyScopedPull(scope, { row, sequence: change.sequence,
          version: change.version, operationId: change.operationId, keyEpoch: this.keyEpoch, ciphertext: change.ciphertext });
        if (result === 'conflict') return true;
      }
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
    return row;
  }
}
