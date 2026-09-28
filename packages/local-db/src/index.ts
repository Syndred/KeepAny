import { createRxDatabase, type RxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import Dexie, { type Table } from 'dexie';
import { z } from 'zod';
import { entitySchemas, type EntityType } from '../../domain/src';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

// This transport shape is consumed by the web app's RxDB observer.
export interface RecordRow { id: string; type: EntityType; payload: string; updatedAt: number }
interface StoredFile { id: string; blob: Blob; name: string }
interface Journal { id: string; rows: RecordRow[] }
interface ImportJournal { id: string; rows: RecordRow[] }

class FileStore extends Dexie {
  blobs!: Table<StoredFile, string>;
  journal!: Table<Journal, string>;
  importJournal!: Table<ImportJournal, string>;
  constructor(name: string) {
    super(`${name}-files-v1`);
    this.version(1).stores({ blobs: 'id', journal: 'id' });
    this.version(2).stores({ blobs: 'id', journal: 'id', importJournal: 'id' });
  }
}

export const files = new FileStore('keepany');
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

  async exportArchive(): Promise<Uint8Array> {
    const rows = await this.allRecords();
    const blobs = await this.fileStore.blobs.toArray();
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

export async function openLocalRepository(name: string): Promise<LocalRepository> {
  if (!/^[a-z][a-z0-9-]{2,60}$/.test(name)) throw Error('database-name');
  const store = name === 'keepany-v1' ? files : new FileStore(name);
  let db: RxDatabase | undefined;
  try {
    db = await createRxDatabase({ name, storage: getRxStorageDexie(), multiInstance: true });
    await db.addCollections({ records: { schema: recordSchema } });
    for (const entry of await store.importJournal.toArray()) await rollbackImport(db, store, entry.id);
    for (const entry of await store.journal.toArray()) await replayJournal(db, store, entry.id);
    return new LocalRepository(db, store);
  } catch (error) {
    await db?.close();
    if (store !== files) store.close();
    throw error;
  }
}

let singleton: Promise<LocalRepository> | undefined;
function defaultRepository(): Promise<LocalRepository> {
  if (!singleton) singleton = openLocalRepository('keepany-v1').catch(error => { singleton = undefined; throw error; });
  return singleton;
}
export async function database(): Promise<RxDatabase> { return (await defaultRepository()).db; }
export async function save(type: EntityType, value: unknown) { return (await defaultRepository()).save(type, value); }
export async function saveBatch(items: ReadonlyArray<{ type: EntityType; value: unknown }>) { return (await defaultRepository()).saveBatch(items); }
export async function allRecords() { return (await defaultRepository()).allRecords(); }
export async function deleteEntity(type: EntityType, id: string) { return (await defaultRepository()).deleteEntity(type, id); }
export async function restoreEntity(type: EntityType, id: string) { return (await defaultRepository()).restoreEntity(type, id); }
export async function putFile(file: File) { return (await defaultRepository()).putFile(file); }
export async function fileUrl(id: string) { return (await defaultRepository()).fileUrl(id); }
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
