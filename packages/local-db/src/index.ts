import { createRxDatabase, type RxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import Dexie, { type Table } from 'dexie';
import { z } from 'zod';
import { entitySchemas, type EntityType } from '../../domain/src';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { SyncOperation } from '../../contracts/src';

// This transport shape is consumed by the web app's RxDB observer.
export interface RecordRow { id: string; type: EntityType; payload: string; updatedAt: number }
interface StoredFile { id: string; blob: Blob; name: string }
interface Journal { id: string; rows: RecordRow[] }
interface ImportJournal { id: string; rows: RecordRow[] }
interface SyncBase { id: string; payload: string; version: number }
export interface PulledRow { row: RecordRow; sequence: number; version: number; operationId?: string; keyEpoch?: number; ciphertext?: string }
interface PullJournal { id: string; cursorStart: number; changes: PulledRow[] }
interface ScopedBase { id: string; scope: string; rowId: string; payload: string; version: number; row?: RecordRow; operationId?: string; keyEpoch?: number; ciphertext?: string }
export interface ScopedOutbox { id: string; scope: string; row: RecordRow; operation: SyncOperation; blocked?: boolean }
interface ScopedPullJournal { id: string; scope: string; cursorStart: number; change: PulledRow; localPayload: string | null; decision?: 'local' | 'remote' }
export interface ScopedConflict { rowId: string; localPayload: string | null; remotePayload: string; basePayload: string | null; remoteVersion: number }

class FileStore extends Dexie {
  blobs!: Table<StoredFile, string>;
  journal!: Table<Journal, string>;
  importJournal!: Table<ImportJournal, string>;
  syncBase!: Table<SyncBase, string>;
  syncMeta!: Table<{ id: string; cursor: number }, string>;
  pullJournal!: Table<PullJournal, string>;
  scopedBase!: Table<ScopedBase, string>;
  scopedMeta!: Table<{ id: string; cursor: number; keyFingerprint?: string; keyEpoch?: number }, string>;
  scopedOutbox!: Table<ScopedOutbox, string>;
  scopedPull!: Table<ScopedPullJournal, string>;
  constructor(name: string) {
    super(`${name}-files-v1`);
    this.version(1).stores({ blobs: 'id', journal: 'id' });
    this.version(2).stores({ blobs: 'id', journal: 'id', importJournal: 'id' });
    this.version(3).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id' });
    this.version(4).stores({ blobs: 'id', journal: 'id', importJournal: 'id', syncBase: 'id', syncMeta: 'id', pullJournal: 'id',
      scopedBase: 'id, scope', scopedMeta: 'id', scopedOutbox: 'id, scope', scopedPull: 'id' });
  }
}

interface DefaultRepositoryState {
  fileStore?: FileStore;
  resources?: Promise<{ db: RxDatabase; fileStore: FileStore }>;
}
// Vite HMR re-evaluates this module while the old RxDB remains open. Keep the resource across reloads.
const defaultGlobal = globalThis as typeof globalThis & { __keepanyLocalDbState?: DefaultRepositoryState };
if (!defaultGlobal.__keepanyLocalDbState) defaultGlobal.__keepanyLocalDbState = {};
const defaultState = defaultGlobal.__keepanyLocalDbState;
if (!defaultState.fileStore) defaultState.fileStore = new FileStore('keepany');
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

export class LocalRepository {
  syncRecoveryError: string | null = null;
  constructor(readonly db: RxDatabase, readonly fileStore: FileStore) {}

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

  async save(type: EntityType, value: unknown): Promise<RecordRow> {
    const next = rowFor(type, value);
    const entity = parsedPayload(next) as Record<string, unknown>;
    if (type === 'asset') {
      for (const id of entity.attachments as string[]) {
        if (!(await this.fileStore.blobs.get(id))) throw Error('attachment-missing');
      }
    }
    if (type === 'relation' && !entity.deleted) {
      const from = await this.get<{ deleted: boolean }>('asset', entity.from as string);
      const to = await this.get<{ deleted: boolean }>('asset', entity.to as string);
      if (!from || !to || from.deleted || to.deleted) throw Error('relation-endpoint');
    }
    if (type === 'task' && entity.dedupeKey && !entity.deleted && !entity.done) {
      const tasks = await this.list<{ id: string; dedupeKey: string; done: boolean }>('task');
      if (tasks.some(task => task.id !== entity.id && task.dedupeKey === entity.dedupeKey && !task.done)) throw Error('task-duplicate');
    }
    const current = await this.db.records.findOne(next.id).exec();
    if (current) {
      await current.incrementalModify((data: RecordRow) => {
        if (parsedPayload(data).deleted && !parsedPayload(next).deleted) throw Error('tombstone-restore-required');
        return { ...data, ...next };
      });
    } else {
      try {
        await this.db.records.insert(next);
      } catch (error) {
        if (!(await this.db.records.findOne(next.id).exec())) throw error;
        return this.save(type, value);
      }
    }
    return next;
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

  async syncCursor(): Promise<number> { return (await this.fileStore.syncMeta.get('cursor'))?.cursor ?? 0; }

  async scopedCursor(scope: string): Promise<number> { return (await this.fileStore.scopedMeta.get(scope))?.cursor ?? 0; }

  async pinScopedKey(scope: string, fingerprint: string, keyEpoch: number): Promise<void> {
    assertScope(scope);
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || !Number.isSafeInteger(keyEpoch) || keyEpoch < 1) throw Error('sync-key');
    await this.fileStore.transaction('rw', this.fileStore.scopedMeta, async () => {
      const existing = await this.fileStore.scopedMeta.get(scope);
      if (existing && (existing.keyFingerprint !== fingerprint || existing.keyEpoch !== keyEpoch)) throw Error('sync-key-mismatch');
      if (!existing) await this.fileStore.scopedMeta.add({ id: scope, cursor: 0, keyFingerprint: fingerprint, keyEpoch });
    });
  }

  async scopedBaseFor(scope: string, rowId: string): Promise<ScopedBase | null> {
    return (await this.fileStore.scopedBase.get(scopedKey(scope, rowId))) ?? null;
  }

  async listScopedOutbox(scope: string): Promise<ScopedOutbox[]> {
    assertScope(scope);
    return this.fileStore.scopedOutbox.where('scope').equals(scope).toArray();
  }

  async dirtyScopedRows(scope: string): Promise<RecordRow[]> {
    assertScope(scope);
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
    if (!(await this.fileStore.scopedPull.get(scope))) return 'none';
    return replayScopedPull(this.db, this.fileStore, scope);
  }

  async resolveScopedConflict(scope: string, decision: 'local' | 'remote'): Promise<void> {
    assertScope(scope);
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
    const current = await this.get<Record<string, unknown>>(type, id);
    if (!current) throw Error('not-found');
    if (current.deleted) {
      const row = await this.db.records.findOne(key(type, id)).exec();
      return canonical(row);
    }
    return this.save(type, { ...current, deleted: true, ...(type === 'asset' ? { updatedAt: new Date().toISOString() } : {}) });
  }

  // Explicit undo is the only local path that can revive a tombstone.
  async restoreEntity(type: EntityType, id: string): Promise<RecordRow> {
    const document = await this.db.records.findOne(key(type, id)).exec();
    if (!document) throw Error('not-in-trash');
    const next = rowFor(type, { ...parsedPayload(canonical(document)), deleted: false });
    await document.incrementalModify((data: RecordRow) => {
      if (!parsedPayload(data).deleted) throw Error('not-in-trash');
      return { ...data, ...next };
    });
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
    if (file.size > 20 * 1024 * 1024) throw Error('file-size');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw Error('file-type');
    const id = crypto.randomUUID();
    await this.fileStore.blobs.add({ id, blob: file, name: file.name });
    return id;
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
    const [restores, imports, pulls] = await Promise.all([
      this.fileStore.journal.toArray(), this.fileStore.importJournal.toArray(), this.fileStore.pullJournal.toArray(),
    ]);
    for (const entry of restores) rows.push(...entry.rows);
    for (const entry of imports) rows.push(...entry.rows);
    for (const entry of pulls) rows.push(...entry.changes.map(change => change.row));
    return attachmentIdsIn(rows);
  }

  async exportArchive(): Promise<Uint8Array> {
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
  }

  async restoreArchive(bytes: Uint8Array): Promise<number> {
    const { rows, manifest, entries } = await inspectArchive(bytes);
    // Validate all conflicts before writing attachments or a journal.
    for (const row of rows) {
      const current = await this.db.records.findOne(row.id).exec();
      if (current && canonical(current).payload !== row.payload) throw Error('restore-conflict');
    }
    for (const attachment of manifest.attachments) {
      const current = await this.fileStore.blobs.get(attachment.id);
      if (current && await sha(new Uint8Array(await current.blob.arrayBuffer())) !== attachment.sha256) throw Error('restore-conflict');
    }
    const journalId = crypto.randomUUID();
    await this.fileStore.transaction('rw', this.fileStore.blobs, this.fileStore.journal, async () => {
      for (const attachment of manifest.attachments) {
        await this.fileStore.blobs.put({
          id: attachment.id, name: attachment.name,
          blob: new Blob([entries[`files/${attachment.id}`] as BlobPart], { type: attachment.type }),
        });
      }
      await this.fileStore.journal.put({ id: journalId, rows });
    });
    await replayJournal(this.db, this.fileStore, journalId);
    return rows.length;
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

function validateRow(row: RecordRow): void {
  if (!Object.hasOwn(entitySchemas, row.type) || typeof row.payload !== 'string' ||
    !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0) throw Error('pull-record');
  const entity = parsedPayload(row);
  if (row.id !== key(row.type, entity.id)) throw Error('pull-record');
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

async function replayScopedPull(db: RxDatabase, store: FileStore, scope: string): Promise<'applied' | 'conflict'> {
  const journal = await store.scopedPull.get(scope);
  if (!journal) return 'applied';
  if (((await store.scopedMeta.get(scope))?.cursor ?? 0) !== journal.cursorStart) throw Error('cursor-mismatch');
  const { row, version } = journal.change;
  validateRow(row);
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
    if (journal.decision || currentPayload === row.payload) await store.scopedOutbox.delete(id);
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
    for (const entry of await store.importJournal.toArray()) await rollbackImport(db, store, entry.id);
    for (const entry of await store.journal.toArray()) await replayJournal(db, store, entry.id);
    const repository = new LocalRepository(db, store);
    for (const entry of await store.pullJournal.toArray()) {
      try { await replayPullJournal(db, store, entry.id); }
      catch (error) { repository.syncRecoveryError = error instanceof Error ? error.message : 'pull-failed'; break; }
    }
    for (const entry of await store.scopedPull.toArray()) {
      try { await replayScopedPull(db, store, entry.scope); }
      catch (error) { repository.syncRecoveryError = error instanceof Error ? error.message : 'pull-failed'; break; }
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
        .then(repository => ({ db: repository.db, fileStore: repository.fileStore }))
        .catch(error => { defaultState.resources = undefined; throw error; });
    }
    const resources = defaultState.resources;
    singleton = resources.then(({ db, fileStore }) => new LocalRepository(db, fileStore))
      .catch(error => { singleton = undefined; throw error; });
  }
  return singleton;
}
export async function database(): Promise<RxDatabase> { return (await defaultRepository()).db; }
export async function localRepository(): Promise<LocalRepository> { return defaultRepository(); }
export async function save(type: EntityType, value: unknown) { return (await defaultRepository()).save(type, value); }
export async function saveBatch(items: ReadonlyArray<{ type: EntityType; value: unknown }>) { return (await defaultRepository()).saveBatch(items); }
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
