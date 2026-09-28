import { createRxDatabase, type RxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import Dexie, { type Table } from 'dexie';
import { z } from 'zod';
import { dueOnCycle, entitySchemas, normalizeCategoryName, type Asset, type AssetKind, type Category, type EntityType, type History, type Task } from '../../domain/src';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { SyncOperation } from '../../contracts/src';

// This transport shape is consumed by the web app's RxDB observer.
export interface RecordRow { id: string; type: EntityType; payload: string; updatedAt: number }
interface StoredFile { id: string; blob: Blob; name: string }
interface Journal { id: string; rows: RecordRow[] }
interface ImportJournal { id: string; rows: RecordRow[] }
interface RenewalJournal { id: string; assetId: string; expectedPayload: string; next: RecordRow; history: RecordRow }
interface SyncBase { id: string; payload: string; version: number }
export interface PulledRow { row: RecordRow; sequence: number; version: number; operationId?: string; keyEpoch?: number; ciphertext?: string }
interface PullJournal { id: string; cursorStart: number; changes: PulledRow[] }
interface ScopedBase { id: string; scope: string; rowId: string; payload: string; version: number; row?: RecordRow; operationId?: string; keyEpoch?: number; ciphertext?: string }
export interface ScopedOutbox { id: string; scope: string; row: RecordRow; operation: SyncOperation; blocked?: boolean }
interface ScopedPullJournal { id: string; scope: string; cursorStart: number; change: PulledRow; localPayload: string | null; decision?: 'local' | 'remote' }
export interface ScopedConflict { rowId: string; localPayload: string | null; remotePayload: string; basePayload: string | null; remoteVersion: number }
export interface DatasetBinding { endpoint: string; accountId: string; workspaceId: string; scope: string }
interface StoredDatasetBinding extends DatasetBinding { id: 'active' }
export interface ScopedAttachmentUploadPlan {
  scope: string;
  attachmentId: string;
  sourceSha256: string;
  keyEpoch: number;
  objects: Array<{ id: string; sha256: string; bytes: Uint8Array }>;
}
interface StoredScopedAttachmentUploadPlan extends ScopedAttachmentUploadPlan { id: string }

class FileStore extends Dexie {
  blobs!: Table<StoredFile, string>;
  journal!: Table<Journal, string>;
  importJournal!: Table<ImportJournal, string>;
  renewalJournal!: Table<RenewalJournal, string>;
  syncBase!: Table<SyncBase, string>;
  syncMeta!: Table<{ id: string; cursor: number }, string>;
  pullJournal!: Table<PullJournal, string>;
  scopedBase!: Table<ScopedBase, string>;
  scopedMeta!: Table<{ id: string; cursor: number; keyFingerprint?: string; keyEpoch?: number }, string>;
  scopedOutbox!: Table<ScopedOutbox, string>;
  scopedPull!: Table<ScopedPullJournal, string>;
  datasetBinding!: Table<StoredDatasetBinding, string>;
  scopedAttachmentUploads!: Table<StoredScopedAttachmentUploadPlan, string>;
  constructor(name: string) {
    super(`${name}-files-v1`);
    this.version(1).stores({ blobs: 'id', journal: 'id' });
    this.version(2).stores({ blobs: 'id', journal: 'id', importJournal: 'id' });
    this.version(3).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id' });
    this.version(4).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id' });
    this.version(5).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id', datasetBinding: 'id' });
    this.version(6).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id', datasetBinding: 'id',
      scopedAttachmentUploads: 'id, scope' });
    this.version(7).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id', datasetBinding: 'id',
      scopedAttachmentUploads: 'id, scope', renewalJournal: 'id, assetId' });
  }
}

interface DefaultRepositoryState {
  fileStore?: FileStore;
  resources?: Promise<{ db: RxDatabase; fileStore: FileStore; recoveryState?: RepositoryRecoveryState }>;
}
interface RepositoryRecoveryState { syncError: string | null; restoreError: string | null; renewalError: string | null }
// Vite HMR re-evaluates this module while the old RxDB remains open. Keep the resource across reloads.
const defaultGlobal = globalThis as typeof globalThis & { __keepanyLocalDbState?: DefaultRepositoryState };
if (!defaultGlobal.__keepanyLocalDbState) defaultGlobal.__keepanyLocalDbState = {};
const defaultState = defaultGlobal.__keepanyLocalDbState;
if (!defaultState.fileStore?.renewalJournal) {
  // A Vite HMR module may have retained a v6 Dexie handle. Rebind the shared
  // RxDB handle to a v7 file store so the new journal table can be upgraded.
  defaultState.fileStore?.close();
  const upgradedStore = new FileStore('keepany');
  defaultState.fileStore = upgradedStore;
  if (defaultState.resources) {
    defaultState.resources = defaultState.resources.then(resource => ({ ...resource, fileStore: upgradedStore }));
  }
}
export const files = defaultState.fileStore;
const recordSchema = {
  title: 'KeepAny entity', version: 0, primaryKey: 'id', type: 'object',
  properties: {
    id: { type: 'string', maxLength: 120 },
    type: { type: 'string', maxLength: 20 },
    payload: { type: 'string' },
    updatedAt: { type: 'number', minimum: 0, maximum: 9999999999999, multipleOf: 1 },
  },
  required: ['id', 'type', 'payload', 'updatedAt'], indexes: ['type'],
} as const;

const key = (type: EntityType, id: string) => `${type}:${id}`;
const canonical = (doc: { toJSON(): Record<string, unknown> }): RecordRow => {
  const value = doc.toJSON();
  return { id: value.id as string, type: value.type as EntityType, payload: value.payload as string, updatedAt: value.updatedAt as number };
};
const parseEntity = (type: EntityType, value: unknown): { id: string; deleted: boolean } =>
  entitySchemas[type].parse(value) as unknown as { id: string; deleted: boolean };
const parsedPayload = (row: RecordRow) => parseEntity(row.type, JSON.parse(row.payload));
const rowFor = (type: EntityType, value: unknown): RecordRow => {
  const parsed = parseEntity(type, value);
  return { id: key(type, parsed.id), type, payload: JSON.stringify(parsed), updatedAt: Date.now() };
};
const renewalLocks = new Map<string, Promise<void>>();
async function withRenewalLock<T>(name: string, action: () => Promise<T>): Promise<T> {
  const previous = renewalLocks.get(name) ?? Promise.resolve();
  const run = previous.then(() => {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    return locks ? locks.request(name, action) : action();
  });
  const tail = run.then(() => {}, () => {});
  renewalLocks.set(name, tail);
  try { return await run; }
  finally { if (renewalLocks.get(name) === tail) renewalLocks.delete(name); }
}

export class LocalRepository {
  constructor(readonly db: RxDatabase, readonly fileStore: FileStore,
    readonly recoveryState: RepositoryRecoveryState = { syncError: null, restoreError: null, renewalError: null }) {}
  get syncRecoveryError(): string | null { return this.recoveryState.syncError; }
  set syncRecoveryError(value: string | null) { this.recoveryState.syncError = value; }
  get restoreRecoveryError(): string | null { return this.recoveryState.restoreError; }
  set restoreRecoveryError(value: string | null) { this.recoveryState.restoreError = value; }
  get renewalRecoveryError(): string | null { return this.recoveryState.renewalError; }
  set renewalRecoveryError(value: string | null) { this.recoveryState.renewalError = value; }

  async allRecords(): Promise<RecordRow[]> {
    return (await this.db.records.find().exec()).map(canonical);
  }

  async get<T>(type: EntityType, id: string): Promise<T | null> {
    const doc = await this.db.records.findOne(key(type, id)).exec();
    return doc ? JSON.parse(canonical(doc).payload) as T : null;
  }

  async list<T>(type: EntityType, includeDeleted = false): Promise<T[]> {
    const docs = await this.db.records.find({ selector: { type } }).exec();
    return docs.map(doc => JSON.parse(canonical(doc).payload) as T)
      .filter(value => includeDeleted || !(value as { deleted?: boolean }).deleted);
  }

  private async assertRelationEndpoints(relation: { from: string; to: string }): Promise<void> {
    const from = await this.get<{ deleted: boolean }>('asset', relation.from);
    const to = await this.get<{ deleted: boolean }>('asset', relation.to);
    if (!from || !to || from.deleted || to.deleted) throw Error('relation-endpoint');
  }

  async save(type: EntityType, value: unknown): Promise<RecordRow> {
    const task = type === 'task' ? entitySchemas.task.parse(value) : null;
    if (task?.dedupeKey && !task.done && !task.deleted) {
      return withRenewalLock(`keepany-task:${this.db.name}`, () => this.saveUnlocked(type, value));
    }
    return this.saveUnlocked(type, value);
  }

  async createCategory(kind: AssetKind, name: string, order: number): Promise<Category> {
    const trimmed = name.trim();
    const normalized = normalizeCategoryName(trimmed);
    if (!normalized) throw Error('category-name');
    return withRenewalLock(`keepany-category:${this.db.name}:${kind}:${normalized}`, async () => {
      const categories = await this.list<Category>('category', true);
      if (categories.some(category => category.kind === kind && !category.deleted &&
        normalizeCategoryName(category.name) === normalized)) throw Error('category-duplicate');
      const hash = await sha(new TextEncoder().encode(`${kind}:${normalized}`));
      const prefix = `category-${kind}-${hash}`;
      const used = new Set(categories.map(category => category.id));
      let sequence = 1;
      while (used.has(`${prefix}-${sequence}`)) sequence++;
      const category = entitySchemas.category.parse({
        id: `${prefix}-${sequence}`, kind, name: trimmed, order, deleted: false,
      });
      try {
        await this.db.records.insert(rowFor('category', category));
      } catch (error) {
        if (await this.get<Category>('category', category.id)) throw Error('category-duplicate');
        throw error;
      }
      return category;
    });
  }

  async saveAssetIfCurrent(expected: Asset, next: Asset): Promise<RecordRow> {
    if (expected.id !== next.id || expected.kind !== next.kind) throw Error('asset-stale');
    return this.saveUnlocked('asset', next, rowFor('asset', expected).payload);
  }

  private async saveUnlocked(type: EntityType, value: unknown, expectedAssetPayload?: string): Promise<RecordRow> {
    if (type === 'asset' && this.renewalRecoveryError) throw Error('renewal-recovery-pending');
    const next = rowFor(type, value);
    const entity = parsedPayload(next) as Record<string, unknown>;
    if (type === 'asset') {
      for (const id of entity.attachments as string[]) {
        if (!(await this.fileStore.blobs.get(id))) throw Error('attachment-missing');
      }
    }
    if (type === 'relation' && !entity.deleted) {
      await this.assertRelationEndpoints(entity as { from: string; to: string });
    }
    if (type === 'task' && entity.dedupeKey && !entity.deleted && !entity.done) {
      const tasks = await this.list<{ id: string; dedupeKey: string; done: boolean }>('task');
      if (tasks.some(task => task.id !== entity.id && task.dedupeKey === entity.dedupeKey && !task.done)) throw Error('task-duplicate');
    }
    const current = await this.db.records.findOne(next.id).exec();
    if (current) {
      await current.incrementalModify((data: RecordRow) => {
        if (expectedAssetPayload !== undefined && JSON.stringify(parsedPayload(data)) !== expectedAssetPayload) throw Error('asset-stale');
        if (parsedPayload(data).deleted && !parsedPayload(next).deleted) throw Error('tombstone-restore-required');
        if (type === 'asset') {
          const previous = parsedPayload(data) as Asset;
          const proposed = parsedPayload(next) as Asset;
          if (previous.lastRenewalId !== proposed.lastRenewalId) throw Error('asset-stale-renewal');
          if (previous.lastItemEventId !== proposed.lastItemEventId) throw Error('item-stale');
          if (previous.kind === 'item' &&
            (previous.status !== proposed.status || previous.borrower !== proposed.borrower)) throw Error('item-action-required');
        }
        return { ...data, ...next };
      });
    } else {
      if (expectedAssetPayload !== undefined) throw Error('asset-stale');
      if (type === 'asset' && entity.kind === 'item' &&
        (entity.status !== 'active' || entity.borrower)) throw Error('item-action-required');
      try {
        await this.db.records.insert(next);
      } catch (error) {
        if (!(await this.db.records.findOne(next.id).exec())) throw error;
        return this.saveUnlocked(type, value);
      }
    }
    return next;
  }

  // Re-read the current row inside RxDB's CAS retry to preserve every completion timestamp.
  async setTaskDone(id: string, expectedDone: boolean): Promise<Task> {
    return withRenewalLock(`keepany-task:${this.db.name}`, async () => {
      const current = await this.db.records.findOne(key('task', id)).exec();
      if (!current) throw Error('task-stale');
      const before = entitySchemas.task.parse(JSON.parse(canonical(current).payload));
      if (expectedDone && before.dedupeKey) {
        const tasks = await this.list<Task>('task');
        if (tasks.some(task => task.id !== id && !task.done && task.dedupeKey === before.dedupeKey)) throw Error('task-duplicate');
      }
      const now = new Date().toISOString();
      let result: Task | null = null;
      await current.incrementalModify((data: RecordRow) => {
        const task = entitySchemas.task.parse(JSON.parse(data.payload));
        if (task.deleted || task.done !== expectedDone) throw Error('task-stale');
        const history = task.completionHistory.length ? task.completionHistory :
          task.done && task.completedAt ? [task.completedAt] : [];
        result = entitySchemas.task.parse({ ...task, done: !expectedDone,
          completedAt: expectedDone ? '' : now,
          completionHistory: expectedDone ? history : [...history, now] });
        return { ...data, payload: JSON.stringify(result), updatedAt: Date.now() };
      });
      if (!result) throw Error('task-stale');
      return result;
    });
  }

  async setItemArchived(id: string, expectedStatus: 'active' | 'archived'): Promise<Asset> {
    return withRenewalLock(`keepany-renewal:${this.db.name}`, async () => {
      await this.settleRenewalJournals();
      const current = await this.db.records.findOne(key('asset', id)).exec();
      if (!current) throw Error('item-stale');
      let result: Asset | null = null;
      await current.incrementalModify((data: RecordRow) => {
        const item = entitySchemas.asset.parse(JSON.parse(data.payload));
        if (item.kind !== 'item' || item.deleted || item.status !== expectedStatus || item.borrower) throw Error('item-stale');
        result = entitySchemas.asset.parse({ ...item, status: expectedStatus === 'active' ? 'archived' : 'active',
          updatedAt: new Date().toISOString() });
        return { ...data, payload: JSON.stringify(result), updatedAt: Date.now() };
      });
      if (!result) throw Error('item-stale');
      return result;
    });
  }

  // New records only. A durable journal rolls back partial writes after errors or interruption.
  async saveBatch(items: ReadonlyArray<{ type: EntityType; value: unknown }>): Promise<number> {
    if (!items.length || items.length > 1000) throw Error('batch-size');
    const rows = items.map(item => rowFor(item.type, item.value));
    const ids = new Set(rows.map(row => row.id));
    if (ids.size !== rows.length) throw Error('batch-duplicate');
    const liveAssets = new Map<string, boolean>();
    for (const row of rows.filter(row => row.type === 'asset')) {
      const asset = parsedPayload(row);
      liveAssets.set(asset.id, !asset.deleted);
      if ((asset as unknown as Asset).kind === 'item' &&
        ((asset as unknown as Asset).status !== 'active' || (asset as unknown as Asset).borrower)) throw Error('item-action-required');
      for (const id of (asset as unknown as { attachments: string[] }).attachments) {
        if (!(await this.fileStore.blobs.get(id))) throw Error('attachment-missing');
      }
    }
    const taskKeys = new Set<string>();
    const existingTasks = await this.list<{ id: string; dedupeKey: string; done: boolean }>('task');
    for (const row of rows) {
      if (await this.db.records.findOne(row.id).exec()) throw Error('batch-existing');
      const value = parsedPayload(row) as Record<string, unknown>;
      if (row.type === 'relation' && !value.deleted) {
        for (const endpoint of [value.from, value.to] as string[]) {
          const live = liveAssets.get(endpoint);
          if (live === false) throw Error('relation-endpoint');
          if (live === undefined) {
            const existing = await this.get<{ deleted: boolean }>('asset', endpoint);
            if (!existing || existing.deleted) throw Error('relation-endpoint');
          }
        }
      }
      if (row.type === 'task' && value.dedupeKey && !value.done && !value.deleted) {
        const dedupeKey = value.dedupeKey as string;
        if (taskKeys.has(dedupeKey) || existingTasks.some(task => task.dedupeKey === dedupeKey && !task.done)) throw Error('task-duplicate');
        taskKeys.add(dedupeKey);
      }
    }
    const id = crypto.randomUUID();
    await this.fileStore.importJournal.put({ id, rows });
    try {
      const result = await this.db.records.bulkInsert(rows);
      if (result.error.length) throw Error('batch-insert-failed');
      await this.fileStore.importJournal.delete(id);
      return rows.length;
    } catch (error) {
      await rollbackImport(this.db, this.fileStore, id);
      throw error;
    }
  }

  private async settleRenewalJournals(): Promise<void> {
    for (const entry of await this.fileStore.renewalJournal.toArray()) {
      try { await replayRenewalJournal(this.db, this.fileStore, entry.id); }
      catch (error) {
        this.renewalRecoveryError = error instanceof Error ? error.message : 'renewal-recovery-pending';
        throw Error('renewal-recovery-pending');
      }
    }
    this.renewalRecoveryError = null;
  }

  // The wrapped RxDB storage sends both rows through one Dexie transaction. Its CAS can
  // reject one row while accepting the other, so the durable journal repairs that case.
  async recordRenewal(expectedAsset: Asset, nextAsset: Asset, history: History): Promise<void> {
    const expected = entitySchemas.asset.parse(expectedAsset);
    const next = entitySchemas.asset.parse(nextAsset);
    const event = entitySchemas.history.parse(history);
    const anchor = expected.billingAnchor || expected.dueDate;
    const unchanged = Object.keys(expected).every(field =>
      ['dueDate', 'billingAnchor', 'renewalCount', 'lastRenewalId', 'updatedAt'].includes(field) ||
      JSON.stringify(expected[field as keyof Asset]) === JSON.stringify(next[field as keyof Asset]));
    if (expected.kind !== 'subscription' || expected.status !== 'active' || expected.deleted || !expected.dueDate ||
      next.id !== expected.id || next.kind !== 'subscription' || next.status !== 'active' || next.deleted ||
      next.renewalCount !== expected.renewalCount + 1 || next.billingAnchor !== anchor ||
      next.lastRenewalId !== event.id ||
      next.dueDate !== dueOnCycle(anchor, expected.cycle, expected.interval, next.renewalCount) ||
      !unchanged ||
      event.action !== 'renew' || event.assetId !== expected.id || event.deleted ||
      event.billDate !== expected.dueDate || event.amount === undefined || event.currency !== expected.currency) {
      throw Error('renewal-invalid');
    }
    await this.recordHistoryPair(expected, next, event, 'renewal');
  }

  async recordItemAction(expectedAsset: Asset, nextAsset: Asset, history: History): Promise<void> {
    const expected = entitySchemas.asset.parse(expectedAsset);
    const next = entitySchemas.asset.parse(nextAsset);
    const event = entitySchemas.history.parse(history);
    const unchanged = Object.keys(expected).every(field =>
      ['status', 'borrower', 'lastItemEventId', 'updatedAt'].includes(field) ||
      JSON.stringify(expected[field as keyof Asset]) === JSON.stringify(next[field as keyof Asset]));
    const active = expected.status === 'active';
    const loaned = expected.status === 'loaned';
    const validTransition = event.action === 'loan'
      ? active && next.status === 'loaned' && !!next.borrower.trim() &&
        event.borrower === next.borrower && !expected.borrower
      : event.action === 'return'
        ? loaned && next.status === 'active' && !next.borrower && event.borrower === expected.borrower
        : event.action === 'maintenance' && (active || loaned) && next.status === expected.status &&
          next.borrower === expected.borrower && !!event.note.trim() && !!event.eventDate;
    if (expected.kind !== 'item' || expected.deleted || next.id !== expected.id ||
      next.kind !== 'item' || next.deleted || !unchanged || !validTransition ||
      next.lastItemEventId !== event.id || event.assetId !== expected.id || event.deleted ||
      (event.eventDate !== undefined && !event.eventDate)) throw Error('item-invalid');
    await this.recordHistoryPair(expected, next, event, 'item');
  }

  private async recordHistoryPair(expected: Asset, next: Asset, event: History,
    kind: 'renewal' | 'item'): Promise<void> {
    const lockName = `keepany-renewal:${this.db.name}`;
    await withRenewalLock(lockName, async () => {
      await this.settleRenewalJournals();
      for (let attempt = 0; attempt < 3; attempt++) {
        // Direct storage writes can leave RxDocument._data at an older revision until
        // its change event arrives. Read the storage revision used by the CAS itself.
        const [current] = await this.db.records.storageInstance.findDocumentsById([key('asset', expected.id)], false);
        const [existingHistory] = await this.db.records.storageInstance.findDocumentsById([key('history', event.id)], false);
        if (!current || existingHistory) throw Error(kind === 'item' ? 'item-stale' : 'renewal-stale');
        const currentRow = current as RecordRow;
        const currentAsset = entitySchemas.asset.parse(JSON.parse(currentRow.payload));
        if (JSON.stringify(currentAsset) !== JSON.stringify(expected)) throw Error(kind === 'item' ? 'item-stale' : 'renewal-stale');
        const nextRow = rowFor('asset', next);
        const historyRow = rowFor('history', event);
        const journalId = crypto.randomUUID();
        await this.fileStore.renewalJournal.add({ id: journalId, assetId: expected.id,
          expectedPayload: currentRow.payload, next: nextRow, history: historyRow });
        try {
          const result = await this.db.records.storageInstance.bulkWrite([
            { previous: current, document: { ...current, ...nextRow } },
            { document: { ...historyRow, _deleted: false, _attachments: {} } },
          ], `keepany-${kind}`);
          if (result.error.length) throw Error(result.error.some(error => error.status === 409) ?
            (kind === 'item' ? 'item-stale' : 'renewal-stale') : `${kind}-write-failed`);
          // A failed journal cleanup leaves a committed pair that replay can safely recognize.
          await this.fileStore.renewalJournal.delete(journalId).catch(() => {});
          return;
        } catch (error) {
          let outcome: 'committed' | 'cancelled';
          try { outcome = await replayRenewalJournal(this.db, this.fileStore, journalId); }
          catch (recoveryError) {
            this.renewalRecoveryError = recoveryError instanceof Error ? recoveryError.message : 'renewal-recovery-pending';
            throw Error('renewal-recovery-pending');
          }
          if (outcome === 'committed') return;
          // A storage revision can advance while its payload remains unchanged.
          // Retry only a CAS conflict after the journal has cancelled its own row;
          // the next iteration rechecks the exact expected asset payload.
          if (error instanceof Error && error.message === (kind === 'item' ? 'item-stale' : 'renewal-stale') &&
            attempt < 2) continue;
          throw error;
        }
      }
    });
  }

  async syncCursor(): Promise<number> { return (await this.fileStore.syncMeta.get('cursor'))?.cursor ?? 0; }

  async getDatasetBinding(): Promise<DatasetBinding | null> {
    const binding = await this.fileStore.datasetBinding.get('active');
    if (!binding) return null;
    const { endpoint, accountId, workspaceId, scope } = binding;
    return { endpoint, accountId, workspaceId, scope };
  }

  // RxDB records are one local dataset. Only an explicit migration may attach them to another remote.
  async claimDatasetBinding(binding: DatasetBinding): Promise<DatasetBinding> {
    await validateDatasetBinding(binding);
    await this.fileStore.transaction('rw', [this.fileStore.datasetBinding, this.fileStore.scopedMeta,
      this.fileStore.scopedBase, this.fileStore.scopedOutbox, this.fileStore.scopedPull,
      this.fileStore.scopedAttachmentUploads, this.fileStore.syncBase, this.fileStore.syncMeta, this.fileStore.pullJournal], async () => {
        const existing = await this.fileStore.datasetBinding.get('active');
        if (existing && !sameDatasetBinding(existing, binding)) throw Error('sync-dataset-bound');
        const [meta, base, outbox, pulls, uploads, oldBaseCount, oldMetaCount, oldPullCount] = await Promise.all([
          this.fileStore.scopedMeta.toCollection().primaryKeys(),
          this.fileStore.scopedBase.orderBy('scope').uniqueKeys(),
          this.fileStore.scopedOutbox.orderBy('scope').uniqueKeys(),
          this.fileStore.scopedPull.toCollection().primaryKeys(),
          this.fileStore.scopedAttachmentUploads.orderBy('scope').uniqueKeys(),
          this.fileStore.syncBase.count(), this.fileStore.syncMeta.count(), this.fileStore.pullJournal.count(),
        ]);
        // The pre-scoped prototype has no remote identity, so its provenance cannot be inferred.
        if (oldBaseCount || oldMetaCount || oldPullCount) throw Error('sync-dataset-ambiguous');
        const legacyScopes = new Set([...meta, ...base, ...outbox, ...pulls, ...uploads]);
        if (legacyScopes.size > 1) throw Error('sync-dataset-ambiguous');
        if (legacyScopes.size === 1 && !legacyScopes.has(binding.scope)) throw Error('sync-dataset-bound');
        if (!existing) await this.fileStore.datasetBinding.add({ id: 'active', ...binding });
      });
    return { ...binding };
  }

  private async assertDatasetScope(scope: string): Promise<void> {
    const binding = await this.fileStore.datasetBinding.get('active');
    if (binding && binding.scope !== scope) throw Error('sync-dataset-bound');
  }

  async scopedCursor(scope: string): Promise<number> { return (await this.fileStore.scopedMeta.get(scope))?.cursor ?? 0; }

  // A key is fixed once ciphertext or an authenticated pull has durable local evidence.
  // A cursor-zero fingerprint alone may come from a failed first attempt or a crash.
  async pinScopedKey(scope: string, fingerprint: string, keyEpoch: number): Promise<'provisional' | 'trusted'> {
    assertScope(scope);
    await this.assertDatasetScope(scope);
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || !Number.isSafeInteger(keyEpoch) || keyEpoch < 1) throw Error('sync-key');
    return this.fileStore.transaction('rw', [this.fileStore.datasetBinding, this.fileStore.scopedMeta,
      this.fileStore.scopedBase, this.fileStore.scopedOutbox, this.fileStore.scopedPull,
      this.fileStore.scopedAttachmentUploads], async () => {
      const binding = await this.fileStore.datasetBinding.get('active');
      if (binding && binding.scope !== scope) throw Error('sync-dataset-bound');
      const existing = await this.fileStore.scopedMeta.get(scope);
      const [base, outbox, pull, uploads] = await Promise.all([
        this.fileStore.scopedBase.where('scope').equals(scope).count(),
        this.fileStore.scopedOutbox.where('scope').equals(scope).count(),
        this.fileStore.scopedPull.get(scope),
        this.fileStore.scopedAttachmentUploads.where('scope').equals(scope).count(),
      ]);
      const trusted = Boolean((existing?.cursor ?? 0) > 0 || base || outbox || pull || uploads);
      if (existing?.keyFingerprint === fingerprint && existing.keyEpoch === keyEpoch) return trusted ? 'trusted' : 'provisional';
      if (trusted || (existing?.keyEpoch && keyEpoch < existing.keyEpoch)) throw Error('sync-key-mismatch');
      await this.fileStore.scopedMeta.put({ id: scope, cursor: 0, keyFingerprint: fingerprint, keyEpoch });
      return 'provisional';
    });
  }

  async scopedBaseFor(scope: string, rowId: string): Promise<ScopedBase | null> {
    return (await this.fileStore.scopedBase.get(scopedKey(scope, rowId))) ?? null;
  }

  async listScopedOutbox(scope: string): Promise<ScopedOutbox[]> {
    assertScope(scope);
    return this.fileStore.scopedOutbox.where('scope').equals(scope).toArray();
  }

  async getScopedAttachmentUpload(scope: string, attachmentId: string): Promise<ScopedAttachmentUploadPlan | null> {
    assertScope(scope);
    z.uuid().parse(attachmentId);
    await this.requireDatasetScope(scope);
    const stored = await this.fileStore.scopedAttachmentUploads.get(scopedKey(scope, attachmentId));
    return stored ? copyAttachmentPlan(stored) : null;
  }

  async putScopedAttachmentUpload(plan: ScopedAttachmentUploadPlan): Promise<ScopedAttachmentUploadPlan> {
    if (!plan || !Array.isArray(plan.objects) || plan.objects.some(object => !(object?.bytes instanceof Uint8Array)))
      throw Error('sync-attachment-plan');
    const snapshot = copyAttachmentPlan(plan);
    await validateAttachmentPlan(snapshot);
    const id = scopedKey(snapshot.scope, snapshot.attachmentId);
    await this.fileStore.transaction('rw', [this.fileStore.datasetBinding, this.fileStore.scopedAttachmentUploads], async () => {
      const binding = await this.fileStore.datasetBinding.get('active');
      if (binding?.scope !== snapshot.scope) throw Error('sync-dataset-bound');
      const existing = await this.fileStore.scopedAttachmentUploads.get(id);
      if (existing) {
        if (!sameAttachmentPlan(existing, snapshot)) throw Error('sync-attachment-plan-conflict');
      } else {
        await this.fileStore.scopedAttachmentUploads.add({ id, ...snapshot });
      }
    });
    return snapshot;
  }

  async deleteScopedAttachmentUpload(scope: string, attachmentId: string): Promise<void> {
    assertScope(scope);
    z.uuid().parse(attachmentId);
    await this.fileStore.transaction('rw', [this.fileStore.datasetBinding, this.fileStore.scopedAttachmentUploads], async () => {
      const binding = await this.fileStore.datasetBinding.get('active');
      if (binding?.scope !== scope) throw Error('sync-dataset-bound');
      await this.fileStore.scopedAttachmentUploads.delete(scopedKey(scope, attachmentId));
    });
  }

  async pendingScopedPullRow(scope: string): Promise<RecordRow | null> {
    assertScope(scope);
    await this.requireDatasetScope(scope);
    const pending = await this.fileStore.scopedPull.get(scope);
    return pending ? { ...pending.change.row } : null;
  }

  private async requireDatasetScope(scope: string): Promise<void> {
    const binding = await this.fileStore.datasetBinding.get('active');
    if (binding?.scope !== scope) throw Error('sync-dataset-bound');
  }

  async dirtyScopedRows(scope: string): Promise<RecordRow[]> {
    assertScope(scope);
    await this.assertDatasetScope(scope);
    const rows = await this.allRecords();
    const dirty: RecordRow[] = [];
    for (const row of rows) {
      const [base, pending] = await Promise.all([
        this.fileStore.scopedBase.get(scopedKey(scope, row.id)),
        this.fileStore.scopedOutbox.get(scopedKey(scope, row.id)),
      ]);
      if (row.payload !== (base?.payload ?? null) && !pending) dirty.push(row);
    }
    return dirty;
  }

  async stageScopedOutbox(scope: string, row: RecordRow, operation: SyncOperation): Promise<ScopedOutbox> {
    assertScope(scope);
    await this.assertDatasetScope(scope);
    validateRow(row);
    if (operation.id !== row.id || operation.kind !== row.type || operation.expectedVersion !==
      ((await this.scopedBaseFor(scope, row.id))?.version ?? 0) || operation.tombstone !== Boolean(parsedPayload(row).deleted)) throw Error('outbox-context');
    const id = scopedKey(scope, row.id);
    const existing = await this.fileStore.scopedOutbox.get(id);
    if (existing) return existing;
    const current = await this.db.records.findOne(row.id).exec();
    if (!current || canonical(current).payload !== row.payload) throw Error('outbox-stale');
    const item = { id, scope, row, operation };
    await this.fileStore.scopedOutbox.add(item);
    return item;
  }

  async acknowledgeScopedOutbox(scope: string, operationId: string, version: number, keyEpoch: number): Promise<void> {
    assertScope(scope);
    const item = (await this.listScopedOutbox(scope)).find(entry => entry.operation.operationId === operationId);
    if (!item || version !== item.operation.expectedVersion + 1) throw Error('outbox-ack');
    await this.fileStore.transaction('rw', this.fileStore.scopedBase, this.fileStore.scopedOutbox, async () => {
      const current = await this.fileStore.scopedOutbox.get(item.id);
      if (current?.operation.operationId !== operationId) throw Error('outbox-ack');
      await this.fileStore.scopedBase.put({ id: item.id, scope, rowId: item.row.id, payload: item.row.payload,
        row: item.row, version, operationId, keyEpoch, ciphertext: item.operation.ciphertext });
      await this.fileStore.scopedOutbox.delete(item.id);
    });
  }

  async blockScopedOutbox(scope: string, operationId: string): Promise<void> {
    const item = (await this.listScopedOutbox(scope)).find(entry => entry.operation.operationId === operationId);
    if (!item) throw Error('outbox-missing');
    await this.fileStore.scopedOutbox.update(item.id, { blocked: true });
  }

  async scopedConflict(scope: string): Promise<ScopedConflict | null> {
    assertScope(scope);
    const journal = await this.fileStore.scopedPull.get(scope);
    if (!journal || journal.decision) return null;
    const base = await this.fileStore.scopedBase.get(scopedKey(scope, journal.change.row.id));
    const current = await this.db.records.findOne(journal.change.row.id).exec();
    const localPayload = current ? canonical(current).payload : null;
    if (localPayload === journal.change.row.payload || localPayload === (base?.payload ?? null)) return null;
    return { rowId: journal.change.row.id, localPayload, remotePayload: journal.change.row.payload,
      basePayload: base?.payload ?? null, remoteVersion: journal.change.version };
  }

  async applyScopedPull(scope: string, change: PulledRow): Promise<'applied' | 'conflict'> {
    assertScope(scope);
    await this.assertDatasetScope(scope);
    validateRow(change.row);
    const cursor = await this.scopedCursor(scope);
    if (change.sequence !== cursor + 1 || !Number.isSafeInteger(change.version) || change.version < 1) throw Error('pull-sequence');
    const previous = await this.fileStore.scopedPull.get(scope);
    if (previous && (previous.change.sequence !== change.sequence || previous.change.row.payload !== change.row.payload)) throw Error('pull-pending');
    if (!previous) {
      const current = await this.db.records.findOne(change.row.id).exec();
      await this.fileStore.scopedPull.add({ id: scope, scope, cursorStart: cursor, change,
        localPayload: current ? canonical(current).payload : null });
    }
    return replayScopedPull(this.db, this.fileStore, scope);
  }

  async resumeScopedPull(scope: string): Promise<'applied' | 'conflict' | 'none'> {
    assertScope(scope);
    await this.assertDatasetScope(scope);
    if (!(await this.fileStore.scopedPull.get(scope))) return 'none';
    return replayScopedPull(this.db, this.fileStore, scope);
  }

  async resolveScopedConflict(scope: string, decision: 'local' | 'remote'): Promise<void> {
    assertScope(scope);
    await this.assertDatasetScope(scope);
    const journal = await this.fileStore.scopedPull.get(scope);
    if (!journal || !(await this.scopedConflict(scope))) throw Error('conflict-missing');
    const current = await this.db.records.findOne(journal.change.row.id).exec();
    if ((current ? canonical(current).payload : null) !== journal.localPayload) {
      await this.fileStore.scopedPull.update(scope, { localPayload: current ? canonical(current).payload : null });
      throw Error('conflict-local-changed');
    }
    await this.fileStore.scopedPull.update(scope, { decision });
    if (await replayScopedPull(this.db, this.fileStore, scope) !== 'applied') throw Error('conflict-unresolved');
  }

  // The cursor is committed only after every decrypted record in the page is durable.
  async applyPulledBatch(changes: PulledRow[], cursorStart: number): Promise<number> {
    if (await this.fileStore.pullJournal.count()) throw Error('pull-pending');
    if (cursorStart !== await this.syncCursor()) throw Error('cursor-mismatch');
    if (!changes.length || changes.length > 500) throw Error('pull-size');
    for (let index = 0; index < changes.length; index++) {
      const change = changes[index];
      if (change.sequence !== cursorStart + index + 1 || !Number.isSafeInteger(change.version) || change.version < 1) throw Error('pull-sequence');
      validateRow(change.row);
    }
    const id = crypto.randomUUID();
    await this.fileStore.pullJournal.put({ id, cursorStart, changes });
    try {
      await replayPullJournal(this.db, this.fileStore, id);
      return cursorStart + changes.length;
    } catch (error) {
      this.syncRecoveryError = error instanceof Error ? error.message : 'pull-failed';
      throw error;
    }
  }

  async deleteEntity(type: EntityType, id: string): Promise<RecordRow> {
    return withRenewalLock(`keepany-renewal:${this.db.name}`, async () => {
      if (type === 'asset' || type === 'history') await this.settleRenewalJournals();
      const current = await this.get<Record<string, unknown>>(type, id);
      if (!current) throw Error('not-found');
      if (current.deleted) {
        const row = await this.db.records.findOne(key(type, id)).exec();
        return canonical(row);
      }
      const tombstone = { ...current, deleted: true, ...(type === 'asset' ? { updatedAt: new Date().toISOString() } : {}) };
      return type === 'asset'
        ? this.saveAssetIfCurrent(current as Asset, tombstone as Asset)
        : this.save(type, tombstone);
    });
  }

  // Explicit undo is the only local path that can revive a tombstone.
  async restoreEntity(type: EntityType, id: string): Promise<RecordRow> {
    if (type === 'asset' || type === 'history') {
      return withRenewalLock(`keepany-renewal:${this.db.name}`, async () => {
        await this.settleRenewalJournals();
        return this.restoreEntityUnlocked(type, id);
      });
    }
    return this.restoreEntityUnlocked(type, id);
  }

  private async restoreEntityUnlocked(type: EntityType, id: string): Promise<RecordRow> {
    const document = await this.db.records.findOne(key(type, id)).exec();
    if (!document) throw Error('not-in-trash');
    const previous = parsedPayload(canonical(document)) as Record<string, unknown>;
    if (!previous.deleted) throw Error('not-in-trash');
    if (type === 'relation') await this.assertRelationEndpoints(previous as { from: string; to: string });
    let next: RecordRow | undefined;
    await document.incrementalModify(async (data: RecordRow) => {
      const current = parsedPayload(data) as Record<string, unknown>;
      if (!current.deleted) throw Error('not-in-trash');
      // The callback sees the latest tombstone after RxDB retries a concurrent write.
      // Check endpoints here too, immediately before this relation is made live.
      if (type === 'relation') await this.assertRelationEndpoints(current as { from: string; to: string });
      next = rowFor(type, { ...current, deleted: false });
      return { ...data, ...next };
    });
    if (!next) throw Error('restore-failed');
    return next;
  }

  // An exact base snapshot prevents silent last-write-wins. Replayed writes are idempotent.
  async applyIncoming(type: EntityType, value: unknown, expectedPayload: string | null): Promise<'applied' | 'duplicate' | 'conflict'> {
    const next = rowFor(type, value);
    const existing = await this.db.records.findOne(next.id).exec();
    if (existing) {
      const duplicate = Symbol('duplicate');
      const conflict = Symbol('conflict');
      try {
        await existing.incrementalModify((data: RecordRow) => {
          if (data.payload === next.payload) throw duplicate;
          if (parsedPayload(data).deleted && !parsedPayload(next).deleted) throw conflict;
          if (data.payload !== expectedPayload) throw conflict;
          return { ...data, ...next };
        });
        return 'applied';
      } catch (error) {
        if (error === duplicate) return 'duplicate';
        if (error === conflict) return 'conflict';
        throw error;
      }
    }
    if (expectedPayload !== null) return 'conflict';
    try {
      await this.db.records.insert(next);
      return 'applied';
    } catch (error) {
      if (!(await this.db.records.findOne(next.id).exec())) throw error;
      return this.applyIncoming(type, value, expectedPayload);
    }
  }

  async putFile(file: File): Promise<string> {
    if (file.name.length > 255) throw Error('file-name');
    if (file.size > 20 * 1024 * 1024) throw Error('file-size');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw Error('file-type');
    const id = crypto.randomUUID();
    await this.fileStore.blobs.add({ id, blob: file, name: file.name });
    return id;
  }

  async readFile(id: string): Promise<{ id: string; name: string; type: string; bytes: Uint8Array } | null> {
    z.uuid().parse(id);
    const file = await this.fileStore.blobs.get(id);
    if (!file) return null;
    return { id, name: file.name, type: file.blob.type, bytes: new Uint8Array(await file.blob.arrayBuffer()) };
  }

  async putSyncedFile(input: { id: string; name: string; type: string; bytes: Uint8Array; sha256: string }): Promise<void> {
    const { id, name, type, sha256 } = input;
    z.uuid().parse(id);
    if (typeof name !== 'string' || name.length > 255) throw Error('file-name');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type)) throw Error('file-type');
    if (!(input.bytes instanceof Uint8Array) || input.bytes.length > 20 * 1024 * 1024) throw Error('file-size');
    const bytes = new Uint8Array(input.bytes);
    if (!/^[a-f0-9]{64}$/.test(sha256) || await sha(bytes) !== sha256) throw Error('sync-attachment-integrity');
    await this.fileStore.transaction('rw', this.fileStore.blobs, async () => {
      const existing = await this.fileStore.blobs.get(id);
      if (existing) {
        if (existing.name !== name || existing.blob.type !== type || existing.blob.size !== bytes.length ||
          !sameBytes(new Uint8Array(await Dexie.waitFor(existing.blob.arrayBuffer())), bytes)) throw Error('sync-attachment-conflict');
      } else {
        await this.fileStore.blobs.add({ id, name, blob: new Blob([new Uint8Array(bytes)], { type }) });
      }
    });
  }

  async fileUrl(id: string): Promise<string> {
    const value = await this.fileStore.blobs.get(id);
    return value ? URL.createObjectURL(value.blob) : '';
  }

  // Call after an asset write fails or after removing an image from an asset.
  // Tombstones and durable journals still protect their referenced images.
  async cleanupUnreferencedFile(id: string): Promise<boolean> {
    z.string().uuid().parse(id);
    if ((await this.protectedFileIds()).has(id)) return false;
    if (!(await this.fileStore.blobs.get(id))) return false;
    await this.fileStore.blobs.delete(id);
    return true;
  }

  async collectOrphanFiles(): Promise<number> {
    const protectedIds = await this.protectedFileIds();
    const candidates = (await this.fileStore.blobs.toCollection().primaryKeys())
      .filter(id => !protectedIds.has(id));
    let removed = 0;
    for (const id of candidates) if (await this.cleanupUnreferencedFile(id)) removed++;
    return removed;
  }

  private async protectedFileIds(): Promise<Set<string>> {
    const rows = await this.allRecords();
    const [restores, imports, pulls, scopedOutbox, scopedPull, renewals] = await Promise.all([
      this.fileStore.journal.toArray(), this.fileStore.importJournal.toArray(), this.fileStore.pullJournal.toArray(),
      this.fileStore.scopedOutbox.toArray(), this.fileStore.scopedPull.toArray(), this.fileStore.renewalJournal.toArray(),
    ]);
    for (const entry of restores) rows.push(...entry.rows);
    for (const entry of imports) rows.push(...entry.rows);
    for (const entry of pulls) rows.push(...entry.changes.map(change => change.row));
    for (const entry of scopedOutbox) rows.push(entry.row);
    for (const entry of scopedPull) rows.push(entry.change.row);
    for (const entry of renewals) rows.push(entry.next);
    return attachmentIdsIn(rows);
  }

  async exportArchive(): Promise<Uint8Array> {
    return withRenewalLock(`keepany-renewal:${this.db.name}`, async () => {
      await this.settleRenewalJournals();
      const rows = await this.allRecords();
      const blobs: StoredFile[] = [];
      for (const id of attachmentIdsIn(rows)) {
        const file = await this.fileStore.blobs.get(id);
        if (!file) throw Error('archive-attachment-reference');
        blobs.push(file);
      }
      validateReferences(rows, new Set(blobs.map(blob => blob.id)));
      const entries: Record<string, Uint8Array> = { 'records.json': strToU8(JSON.stringify(rows)) };
      const attachments: AttachmentManifest[] = [];
      for (const item of blobs) {
        const bytes = new Uint8Array(await item.blob.arrayBuffer());
        entries[`files/${item.id}`] = bytes;
        attachments.push({ id: item.id, name: item.name, type: attachmentSchema.shape.type.parse(item.blob.type), size: bytes.length, sha256: await sha(bytes) });
      }
      entries['manifest.json'] = strToU8(JSON.stringify({
        format: 'keepany-backup', version: 1, createdAt: new Date().toISOString(),
        recordCount: rows.length, recordsHash: await sha(entries['records.json']), attachments,
      }));
      if (Object.values(entries).reduce((size, entry) => size + entry.length, 0) > 300 * 1024 * 1024) throw Error('archive-size');
      const archive = zipSync(entries, { level: 1 });
      if (archive.length > 100 * 1024 * 1024) throw Error('archive-size');
      return archive;
    });
  }

  async restoreArchive(bytes: Uint8Array): Promise<number> {
    return withRenewalLock(`keepany-renewal:${this.db.name}`, async () => {
      await this.settleRenewalJournals();
      if (await this.fileStore.journal.count()) throw Error('restore-recovery-pending');
      const { rows, manifest, entries } = await inspectArchive(bytes);
      // Validate all conflicts before writing attachments or a journal.
      for (const row of rows) {
        const current = await this.db.records.findOne(row.id).exec();
        if (current && canonical(current).payload !== row.payload) throw Error('restore-conflict');
      }
      for (const attachment of manifest.attachments) {
        const current = await this.fileStore.blobs.get(attachment.id);
        if (current && (current.name !== attachment.name || current.blob.type !== attachment.type ||
          current.blob.size !== attachment.size ||
          await sha(new Uint8Array(await current.blob.arrayBuffer())) !== attachment.sha256)) throw Error('restore-conflict');
      }
      const journalId = crypto.randomUUID();
      await this.fileStore.transaction('rw', this.fileStore.blobs, this.fileStore.journal, async () => {
        for (const attachment of manifest.attachments) {
          const existing = await this.fileStore.blobs.get(attachment.id);
          if (existing) {
            if (existing.name !== attachment.name || existing.blob.type !== attachment.type ||
              existing.blob.size !== attachment.size ||
              !sameBytes(new Uint8Array(await Dexie.waitFor(existing.blob.arrayBuffer())), entries[`files/${attachment.id}`])) {
              throw Error('restore-conflict');
            }
          } else {
            await this.fileStore.blobs.add({
              id: attachment.id, name: attachment.name,
              blob: new Blob([entries[`files/${attachment.id}`] as BlobPart], { type: attachment.type }),
            });
          }
        }
        await this.fileStore.journal.put({ id: journalId, rows });
    });
    try {
      await replayJournal(this.db, this.fileStore, journalId);
      this.restoreRecoveryError = null;
    } catch (error) {
      this.restoreRecoveryError = error instanceof Error ? error.message : 'restore-failed';
      throw error;
    }
    return rows.length;
    });
  }

  async close(): Promise<void> {
    await this.db.close();
    this.fileStore.close();
  }
}

async function replayJournal(db: RxDatabase, store: FileStore, id: string): Promise<void> {
  const journal = await store.journal.get(id);
  if (!journal) return;
  for (const row of journal.rows) {
    await assertRowAttachmentsAvailable(store, row);
    const current = await db.records.findOne(row.id).exec();
    if (current) {
      if (canonical(current).payload !== row.payload) throw Error('restore-conflict');
      continue;
    }
    try {
      await db.records.insert(row);
    } catch (error) {
      const raced = await db.records.findOne(row.id).exec();
      if (!raced) throw error;
      if (canonical(raced).payload !== row.payload) throw Error('restore-conflict');
    }
  }
  await store.journal.delete(id);
}

async function rollbackImport(db: RxDatabase, store: FileStore, id: string): Promise<void> {
  const journal = await store.importJournal.get(id);
  if (!journal) return;
  for (const row of journal.rows) {
    const current = await db.records.findOne(row.id).exec();
    if (!current) continue;
    if (canonical(current).payload !== row.payload) throw Error('import-rollback-conflict');
    await current.remove();
  }
  await store.importJournal.delete(id);
}

// A completed storage batch is atomic. If RxDB reports a per-row CAS conflict,
// repair only this journal's own history row; never rewind an unrelated asset update.
async function replayRenewalJournal(db: RxDatabase, store: FileStore, id: string): Promise<'committed' | 'cancelled'> {
  const journal = await store.renewalJournal.get(id);
  if (!journal) return 'cancelled';
  const [asset] = await db.records.storageInstance.findDocumentsById([journal.next.id], false);
  const [history] = await db.records.storageInstance.findDocumentsById([journal.history.id], false);
  const assetPayload = asset ? asset.payload : null;
  const historyPayload = history ? history.payload : null;
  if (historyPayload && historyPayload !== journal.history.payload) throw Error('renewal-recovery-conflict');
  const action = entitySchemas.history.parse(JSON.parse(journal.history.payload)).action;
  const markerField = action === 'renew' ? 'lastRenewalId' : 'lastItemEventId';
  const expectedMarker = entitySchemas.asset.parse(JSON.parse(journal.expectedPayload))[markerField];
  const nextMarker = entitySchemas.asset.parse(JSON.parse(journal.next.payload))[markerField];
  const currentMarker = assetPayload ? entitySchemas.asset.parse(JSON.parse(assetPayload))[markerField] : null;
  // A later ordinary edit can change the payload without changing this operation marker.
  // Old v7 journals have no marker, so keep their exact-payload recovery behavior.
  if (assetPayload === journal.next.payload || (nextMarker && currentMarker === nextMarker)) {
    if (!history) {
      try { await db.records.insert(journal.history); }
      catch (error) {
        const raced = await db.records.findOne(journal.history.id).exec();
        if (!raced || canonical(raced).payload !== journal.history.payload) throw error;
      }
    }
    await store.renewalJournal.delete(id);
    return 'committed';
  }
  const cannotCancel = nextMarker
    ? currentMarker !== expectedMarker
    : assetPayload !== journal.expectedPayload;
  if (cannotCancel) {
    throw Error('renewal-recovery-conflict');
  }
  if (history) {
    const document = await db.records.findOne(journal.history.id).exec();
    if (!document) throw Error('renewal-recovery-conflict');
    await document.remove();
  }
  await store.renewalJournal.delete(id);
  return 'cancelled';
}

function validateRow(row: RecordRow): void {
  if (!Object.hasOwn(entitySchemas, row.type) || typeof row.payload !== 'string' ||
    !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0) throw Error('pull-record');
  const entity = parsedPayload(row);
  if (row.id !== key(row.type, entity.id)) throw Error('pull-record');
}

async function assertRowAttachmentsAvailable(store: FileStore, row: RecordRow): Promise<void> {
  if (row.type !== 'asset') return;
  const asset = parsedPayload(row) as unknown as { attachments: string[] };
  for (const id of asset.attachments) {
    if (!(await store.blobs.get(id))) throw Error('attachment-missing');
  }
}

async function replayPullJournal(db: RxDatabase, store: FileStore, id: string): Promise<void> {
  const journal = await store.pullJournal.get(id);
  if (!journal) return;
  if (((await store.syncMeta.get('cursor'))?.cursor ?? 0) !== journal.cursorStart) throw Error('cursor-mismatch');
  for (const change of journal.changes) {
    validateRow(change.row);
    const current = await db.records.findOne(change.row.id).exec();
    const base = await store.syncBase.get(change.row.id);
    const currentPayload = current ? canonical(current).payload : null;
    if (currentPayload !== change.row.payload) {
      if (currentPayload !== (base?.payload ?? null)) throw Error('sync-conflict');
      if (current) {
        const conflict = Symbol('sync-conflict');
        try {
          await current.incrementalModify((data: RecordRow) => {
            if (data.payload !== (base?.payload ?? null)) throw conflict;
            return { ...data, ...change.row };
          });
        } catch (error) {
          if (error === conflict) throw Error('sync-conflict');
          throw error;
        }
      } else {
        try { await db.records.insert(change.row); }
        catch (error) {
          const raced = await db.records.findOne(change.row.id).exec();
          if (!raced || canonical(raced).payload !== change.row.payload) throw error;
        }
      }
    }
    await store.syncBase.put({ id: change.row.id, payload: change.row.payload, version: change.version });
  }
  await store.transaction('rw', store.syncMeta, store.pullJournal, async () => {
    await store.syncMeta.put({ id: 'cursor', cursor: journal.cursorStart + journal.changes.length });
    await store.pullJournal.delete(id);
  });
}

function assertScope(scope: string): void {
  if (!/^[a-f0-9]{64}:[a-f0-9-]{36}$/.test(scope)) throw Error('sync-scope');
}
function scopedKey(scope: string, rowId: string): string { assertScope(scope); return `${scope}|${rowId}`; }

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function copyAttachmentPlan(plan: ScopedAttachmentUploadPlan): ScopedAttachmentUploadPlan {
  return { scope: plan.scope, attachmentId: plan.attachmentId, sourceSha256: plan.sourceSha256,
    keyEpoch: plan.keyEpoch, objects: plan.objects.map(object => ({ ...object, bytes: new Uint8Array(object.bytes) })) };
}

function sameAttachmentPlan(left: ScopedAttachmentUploadPlan, right: ScopedAttachmentUploadPlan): boolean {
  return left.scope === right.scope && left.attachmentId === right.attachmentId &&
    left.sourceSha256 === right.sourceSha256 && left.keyEpoch === right.keyEpoch &&
    left.objects.length === right.objects.length && left.objects.every((object, index) => {
      const other = right.objects[index];
      return object.id === other.id && object.sha256 === other.sha256 && sameBytes(object.bytes, other.bytes);
    });
}

async function validateAttachmentPlan(plan: ScopedAttachmentUploadPlan): Promise<void> {
  assertScope(plan.scope);
  if (!z.uuid().safeParse(plan.attachmentId).success || !/^[a-f0-9]{64}$/.test(plan.sourceSha256) ||
    !Number.isSafeInteger(plan.keyEpoch) || plan.keyEpoch < 1 || !Array.isArray(plan.objects) ||
    plan.objects.length < 1 || plan.objects.length > 32 ||
    plan.objects.at(-1)?.id !== plan.attachmentId) throw Error('sync-attachment-plan');
  const seen = new Set<string>();
  for (const object of plan.objects) {
    if (!z.uuid().safeParse(object.id).success || seen.has(object.id) ||
      !/^[a-f0-9]{64}$/.test(object.sha256) || !(object.bytes instanceof Uint8Array) ||
      object.bytes.length < 1 || object.bytes.length > 4 * 1024 * 1024 ||
      await sha(object.bytes) !== object.sha256) throw Error('sync-attachment-plan');
    seen.add(object.id);
  }
}

function sameDatasetBinding(a: DatasetBinding, b: DatasetBinding): boolean {
  return a.endpoint === b.endpoint && a.accountId === b.accountId &&
    a.workspaceId === b.workspaceId && a.scope === b.scope;
}

async function validateDatasetBinding(binding: DatasetBinding): Promise<void> {
  let url: URL;
  try { url = new URL(binding.endpoint); }
  catch { throw Error('sync-dataset-identity'); }
  if (url.origin !== binding.endpoint || url.username || url.password || url.pathname !== '/' ||
    url.search || url.hash || (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    !binding.accountId || binding.accountId.trim() !== binding.accountId || binding.accountId.length > 256 ||
    !z.uuid().safeParse(binding.workspaceId).success || binding.workspaceId !== binding.workspaceId.toLowerCase()) {
    throw Error('sync-dataset-identity');
  }
  assertScope(binding.scope);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([binding.endpoint, binding.accountId]))));
  const digest = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  if (binding.scope !== `${digest}:${binding.workspaceId}`) throw Error('sync-dataset-identity');
}

async function replayScopedPull(db: RxDatabase, store: FileStore, scope: string): Promise<'applied' | 'conflict'> {
  const journal = await store.scopedPull.get(scope);
  if (!journal) return 'applied';
  if (((await store.scopedMeta.get(scope))?.cursor ?? 0) !== journal.cursorStart) throw Error('cursor-mismatch');
  const { row, version } = journal.change;
  validateRow(row);
  await assertRowAttachmentsAvailable(store, row);
  const id = scopedKey(scope, row.id);
  const current = await db.records.findOne(row.id).exec();
  const currentPayload = current ? canonical(current).payload : null;
  const base = await store.scopedBase.get(id);
  const basePayload = base?.payload ?? null;
  if (base?.version === version && base.operationId === journal.change.operationId &&
      base.ciphertext === journal.change.ciphertext && row.payload === base.payload) {
    await store.transaction('rw', store.scopedMeta, store.scopedPull, async () => {
      const meta = await store.scopedMeta.get(scope);
      await store.scopedMeta.put({ ...meta, id: scope, cursor: journal.cursorStart + 1 });
      await store.scopedPull.delete(scope);
    });
    return 'applied';
  }
  if (!journal.decision && currentPayload !== row.payload && currentPayload !== basePayload) return 'conflict';
  if (journal.decision === 'remote' && currentPayload !== journal.localPayload && currentPayload !== row.payload) {
    await store.scopedPull.update(scope, { decision: undefined, localPayload: currentPayload });
    return 'conflict';
  }
  if (journal.decision !== 'local' && currentPayload !== row.payload) {
    if (journal.decision !== 'remote' && currentPayload !== basePayload) return 'conflict';
    if (current) {
      await current.incrementalModify((data: RecordRow) => {
        if (data.payload !== currentPayload) throw Error('pull-race');
        return { ...data, ...row };
      });
    } else {
      try { await db.records.insert(row); }
      catch (error) {
        const raced = await db.records.findOne(row.id).exec();
        if (!raced || canonical(raced).payload !== row.payload) throw error;
      }
    }
  }
  await store.transaction('rw', store.scopedMeta, store.scopedBase, store.scopedOutbox, store.scopedPull, async () => {
    await store.scopedBase.put({ id, scope, rowId: row.id, payload: row.payload, version,
      row, operationId: journal.change.operationId, keyEpoch: journal.change.keyEpoch, ciphertext: journal.change.ciphertext });
    const pending = await store.scopedOutbox.get(id);
    if (journal.decision || currentPayload === row.payload || pending?.blocked) await store.scopedOutbox.delete(id);
    const meta = await store.scopedMeta.get(scope);
    await store.scopedMeta.put({ ...meta, id: scope, cursor: journal.cursorStart + 1 });
    await store.scopedPull.delete(scope);
  });
  return 'applied';
}

export async function openLocalRepository(name: string): Promise<LocalRepository> {
  if (!/^[a-z][a-z0-9-]{2,60}$/.test(name)) throw Error('database-name');
  const store = name === 'keepany-v1' ? files : new FileStore(name);
  let db: RxDatabase | undefined;
  try {
    db = await createRxDatabase({ name, storage: getRxStorageDexie(), multiInstance: true });
    await db.addCollections({ records: { schema: recordSchema } });
    const openedDb = db;
    for (const entry of await store.importJournal.toArray()) await rollbackImport(db, store, entry.id);
    const repository = new LocalRepository(db, store);
    await withRenewalLock(`keepany-renewal:${name}`, async () => {
      for (const entry of await store.renewalJournal.toArray()) {
        try { await replayRenewalJournal(openedDb, store, entry.id); }
        catch (error) {
          repository.renewalRecoveryError = error instanceof Error ? error.message : 'renewal-recovery-pending';
          break;
        }
      }
    });
    for (const entry of await store.journal.toArray()) {
      try { await replayJournal(db, store, entry.id); }
      catch (error) {
        // Keep an interrupted journal for manual recovery without locking users out of local data.
        repository.restoreRecoveryError = error instanceof Error ? error.message : 'restore-failed';
        break;
      }
    }
    for (const entry of await store.pullJournal.toArray()) {
      try { await replayPullJournal(db, store, entry.id); }
      catch (error) { repository.syncRecoveryError = error instanceof Error ? error.message : 'pull-failed'; break; }
    }
    const pendingScopedPulls = await store.scopedPull.toArray();
    if (pendingScopedPulls.length) {
      const binding = await store.datasetBinding.get('active');
      const [meta, base, outbox, uploads] = await Promise.all([
        store.scopedMeta.toCollection().primaryKeys(), store.scopedBase.orderBy('scope').uniqueKeys(),
        store.scopedOutbox.orderBy('scope').uniqueKeys(), store.scopedAttachmentUploads.orderBy('scope').uniqueKeys(),
      ]);
      const scopes = new Set([...meta, ...base, ...outbox, ...uploads, ...pendingScopedPulls.map(entry => entry.scope)]);
      if (scopes.size > 1) repository.syncRecoveryError = 'sync-dataset-ambiguous';
      else if (binding && scopes.size && !scopes.has(binding.scope)) repository.syncRecoveryError = 'sync-dataset-bound';
      else {
        for (const entry of pendingScopedPulls) {
          try { await replayScopedPull(db, store, entry.scope); }
          catch (error) { repository.syncRecoveryError = error instanceof Error ? error.message : 'pull-failed'; break; }
        }
      }
    }
    return repository;
  } catch (error) {
    await db?.close();
    if (store !== files) store.close();
    throw error;
  }
}

let singleton: Promise<LocalRepository> | undefined;
function defaultRepository(): Promise<LocalRepository> {
  if (!singleton) {
    if (!defaultState.resources) {
      defaultState.resources = openLocalRepository('keepany-v1')
        .then(repository => ({ db: repository.db, fileStore: repository.fileStore,
          recoveryState: repository.recoveryState }))
        .catch(error => { defaultState.resources = undefined; throw error; });
    }
    const resources = defaultState.resources;
    singleton = resources.then(async resource => {
      // An older HMR module kept only handles. Preserve a visible pending state for its journals.
      if (!resource.recoveryState) {
        resource.recoveryState = {
          restoreError: await resource.fileStore.journal.count() ? 'restore-recovery-pending' : null,
          syncError: await resource.fileStore.pullJournal.count() || await resource.fileStore.scopedPull.count()
            ? 'sync-recovery-pending' : null,
          renewalError: await resource.fileStore.renewalJournal.count() ? 'renewal-recovery-pending' : null,
        };
      }
      if (resource.recoveryState.renewalError === undefined) resource.recoveryState.renewalError = null;
      const repository = new LocalRepository(resource.db, resource.fileStore, resource.recoveryState);
      await withRenewalLock(`keepany-renewal:${resource.db.name}`, async () => {
        for (const entry of await resource.fileStore.renewalJournal.toArray()) {
          try { await replayRenewalJournal(resource.db, resource.fileStore, entry.id); }
          catch (error) {
            repository.renewalRecoveryError = error instanceof Error ? error.message : 'renewal-recovery-pending';
            break;
          }
        }
      });
      return repository;
    })
      .catch(error => { singleton = undefined; throw error; });
  }
  return singleton;
}
export async function database(): Promise<RxDatabase> { return (await defaultRepository()).db; }
export async function localRepository(): Promise<LocalRepository> { return defaultRepository(); }
export async function save(type: EntityType, value: unknown) { return (await defaultRepository()).save(type, value); }
export async function createCategory(kind: AssetKind, name: string, order: number) {
  return (await defaultRepository()).createCategory(kind, name, order);
}
export async function saveAssetIfCurrent(expected: Asset, next: Asset) { return (await defaultRepository()).saveAssetIfCurrent(expected, next); }
export async function saveBatch(items: ReadonlyArray<{ type: EntityType; value: unknown }>) { return (await defaultRepository()).saveBatch(items); }
export async function recordRenewal(expectedAsset: Asset, nextAsset: Asset, history: History) {
  return (await defaultRepository()).recordRenewal(expectedAsset, nextAsset, history);
}
export async function recordItemAction(expectedAsset: Asset, nextAsset: Asset, history: History) {
  return (await defaultRepository()).recordItemAction(expectedAsset, nextAsset, history);
}
export async function setTaskDone(id: string, expectedDone: boolean) {
  return (await defaultRepository()).setTaskDone(id, expectedDone);
}
export async function setItemArchived(id: string, expectedStatus: 'active' | 'archived') {
  return (await defaultRepository()).setItemArchived(id, expectedStatus);
}
export async function applyPulledBatch(changes: PulledRow[], cursorStart: number) { return (await defaultRepository()).applyPulledBatch(changes, cursorStart); }
export async function syncCursor() { return (await defaultRepository()).syncCursor(); }
export async function allRecords() { return (await defaultRepository()).allRecords(); }
export async function deleteEntity(type: EntityType, id: string) { return (await defaultRepository()).deleteEntity(type, id); }
export async function restoreEntity(type: EntityType, id: string) { return (await defaultRepository()).restoreEntity(type, id); }
export async function putFile(file: File) { return (await defaultRepository()).putFile(file); }
export async function fileUrl(id: string) { return (await defaultRepository()).fileUrl(id); }
export async function cleanupUnreferencedFile(id: string) { return (await defaultRepository()).cleanupUnreferencedFile(id); }
export async function collectOrphanFiles() { return (await defaultRepository()).collectOrphanFiles(); }
export async function exportArchive() { return (await defaultRepository()).exportArchive(); }
export async function restoreArchive(bytes: Uint8Array) { return (await defaultRepository()).restoreArchive(bytes); }

const attachmentSchema = z.object({
  id: z.string().uuid(), name: z.string().max(255),
  type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  size: z.number().int().nonnegative().max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
type AttachmentManifest = z.infer<typeof attachmentSchema>;
const manifestSchema = z.object({
  format: z.literal('keepany-backup'), version: z.literal(1),
  createdAt: z.string().datetime(), recordCount: z.number().int().nonnegative().max(100000),
  recordsHash: z.string().regex(/^[0-9a-f]{64}$/), attachments: z.array(attachmentSchema).max(10000),
});
async function sha(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)))
    .map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function inspectArchive(bytes: Uint8Array) {
  if (bytes.length > 100 * 1024 * 1024) throw Error('archive-size');
  let total = 0;
  const entries = unzipSync(bytes, { filter: entry => {
    total += entry.originalSize;
    if (total > 300 * 1024 * 1024) throw Error('archive-size');
    return true;
  } });
  if (!entries['manifest.json'] || !entries['records.json']) throw Error('archive-missing');
  const manifest = manifestSchema.parse(JSON.parse(strFromU8(entries['manifest.json'])));
  if (await sha(entries['records.json']) !== manifest.recordsHash) throw Error('archive-hash');
  const rawRows: unknown = JSON.parse(strFromU8(entries['records.json']));
  if (!Array.isArray(rawRows) || rawRows.length !== manifest.recordCount) throw Error('archive-records');
  const rows: RecordRow[] = [];
  const ids = new Set<string>();
  for (const value of rawRows) {
    if (!value || typeof value !== 'object') throw Error('archive-records');
    const row = value as RecordRow;
    if (!Object.hasOwn(entitySchemas, row.type) || typeof row.payload !== 'string' ||
      !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0) throw Error('archive-records');
    const parsed = parsedPayload(row);
    if (row.id !== key(row.type, parsed.id) || ids.has(row.id)) throw Error('archive-id');
    ids.add(row.id);
    rows.push({ id: row.id, type: row.type, payload: JSON.stringify(parsed), updatedAt: row.updatedAt });
  }
  const allowed = new Set(['manifest.json', 'records.json']);
  const attachmentIds = new Set<string>();
  for (const attachment of manifest.attachments) {
    if (attachmentIds.has(attachment.id)) throw Error('archive-id');
    attachmentIds.add(attachment.id);
    const path = `files/${attachment.id}`;
    allowed.add(path);
    const content = entries[path];
    if (!content || content.length !== attachment.size || await sha(content) !== attachment.sha256) throw Error('archive-hash');
  }
  if (Object.keys(entries).some(path => !allowed.has(path))) throw Error('archive-entry');
  validateReferences(rows, attachmentIds);
  return { rows, manifest, entries };
}

function validateReferences(rows: RecordRow[], attachmentIds: Set<string>): void {
  const assetIds = new Set(rows.filter(row => row.type === 'asset').map(row => JSON.parse(row.payload).id as string));
  for (const row of rows) {
    const value = JSON.parse(row.payload) as Record<string, unknown>;
    if (row.type === 'asset' && (value.attachments as string[]).some(id => !attachmentIds.has(id))) throw Error('archive-attachment-reference');
    if (row.type === 'relation' && (!assetIds.has(value.from as string) || !assetIds.has(value.to as string))) throw Error('archive-relation-reference');
    if (row.type === 'task' && value.assetId && !assetIds.has(value.assetId as string)) throw Error('archive-task-reference');
    if ((row.type === 'submission' || row.type === 'history') && !assetIds.has(value.assetId as string)) {
      throw Error(`archive-${row.type}-reference`);
    }
  }
}

function attachmentIdsIn(rows: RecordRow[]): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.type !== 'asset') continue;
    const asset = parsedPayload(row) as unknown as { attachments: string[] };
    for (const id of asset.attachments) ids.add(id);
  }
  return ids;
}
