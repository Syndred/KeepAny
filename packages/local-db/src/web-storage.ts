import Dexie, { liveQuery, type Table } from 'dexie';
import type { RxDatabase } from 'rxdb';
import type { EntityType } from '../../domain/src';
import type { RecordRow } from './index';
import type { RecordBackend, RecordChange, SideTable, SideTableRef, SideStoreRuntime, StoredRecord, WriteResult } from './storage-contracts';

function row(value: Record<string, unknown>): RecordRow {
  return { id: value.id as string, type: value.type as EntityType, payload: value.payload as string, updatedAt: value.updatedAt as number };
}
function stored(value: Record<string, unknown>): StoredRecord {
  return { ...row(value), revision: value._rev as string, internalDeleted: value._deleted === true };
}
export class WebRecordBackend implements RecordBackend {
  constructor(readonly raw: RxDatabase) {}
  get webDatabase() { return this.raw; }
  get name() { return this.raw.name; }
  async get(id: string, includeInternalDeleted = false) { return (await this.getMany([id], includeInternalDeleted))[0] ?? null; }
  async getMany(ids: readonly string[], includeInternalDeleted = false): Promise<StoredRecord[]> {
    return (await this.raw.records.storageInstance.findDocumentsById([...ids], includeInternalDeleted)).map((value: Record<string, unknown>) => stored(value));
  }
  async list(type?: EntityType): Promise<StoredRecord[]> {
    const query = this.raw.records.find(type ? { selector: { type } } : undefined);
    return (await this.raw.records.storageInstance.query(query.getPreparedQuery())).documents.map((value: Record<string, unknown>) => stored(value));
  }
  async insert(value: RecordRow) { await this.raw.records.insert(value); }
  async insertMany(values: readonly RecordRow[]): Promise<WriteResult> {
    const result = await this.raw.records.bulkInsert([...values]);
    return { success: result.success.map((document: { primary: string }) => document.primary), error: result.error.map((error: { documentId: string; status: number }) => ({ documentId: error.documentId, status: error.status })) };
  }
  async modify(id: string, modifier: (value: RecordRow) => RecordRow | Promise<RecordRow>) {
    const document = await this.raw.records.findOne(id).exec();
    if (!document) throw Error('record-missing');
    await document.incrementalModify(async (current: Record<string, unknown>) => ({ ...current, ...await modifier(row(current)) }));
  }
  async compareAndWrite(changes: readonly RecordChange[], context: string): Promise<WriteResult> {
    const rawRows = await this.raw.records.storageInstance.findDocumentsById(changes.map(change => change.next.id), true);
    const current = new Map<string, Record<string, unknown>>(rawRows.map((value: Record<string, unknown>) => [value.id as string, value]));
    const error = changes.filter(change => {
      const raw = current.get(change.next.id);
      return change.previous ? !raw || raw._rev !== change.previous.revision : !!raw && raw._deleted !== true;
    }).map(change => ({ documentId: change.next.id, status: 409 }));
    if (error.length) return { success: [], error };
    const result = await this.raw.records.storageInstance.bulkWrite(changes.map(change => {
      const previous = current.get(change.next.id);
      const next = change.next;
      return { ...(previous ? { previous } : {}), document: { ...previous,
        id: next.id, type: next.type, payload: next.payload, updatedAt: next.updatedAt,
        _deleted: change.internalDeleted ?? false, _attachments: previous?._attachments ?? {} } };
    }), context);
    return { success: changes.filter(change => !result.error.some((error: { documentId: string }) => error.documentId === change.next.id)).map(change => change.next.id), error: result.error.map((error: { documentId: string; status: number }) => ({ documentId: error.documentId, status: error.status })) };
  }
  async remove(id: string, expectedRevision: string) {
    const previous = await this.get(id, true);
    if (!previous || previous.revision !== expectedRevision) throw Error('record-stale');
    const result = await this.compareAndWrite([{ previous, next: previous, internalDeleted: true }], 'record-remove');
    if (result.error.length) throw Error('record-stale');
  }
  subscribe(listener: () => void) {
    const subscription = this.raw.records.find().$.subscribe({ next: listener, error: listener });
    return () => subscription.unsubscribe();
  }
  async close() { await this.raw.close(); }
}

export class WebSideTable<T extends { id: string }> implements SideTable<T> {
  constructor(readonly raw: Table<T, string>) {}
  get name() { return this.raw.name; }
  get(id: string) { return this.raw.get(id); }
  add(value: T, key?: string) { return this.raw.add(value, key); }
  put(value: T, key?: string) { return this.raw.put(value, key); }
  update(id: string, patch: Partial<T>) {
    return this.raw.where(':id').equals(id).modify(value => {
      for (const key of Object.keys(patch) as Array<keyof T>) {
        if (patch[key] === undefined) delete value[key]; else value[key] = patch[key] as T[keyof T];
      }
    });
  }
  delete(id: string) { return this.raw.delete(id); }
  bulkDelete(ids: readonly string[]) { return this.raw.bulkDelete([...ids]); }
  clear() { return this.raw.clear(); }
  count() { return this.raw.count(); }
  toArray() { return this.raw.toArray(); }
  keys() { return this.raw.toCollection().primaryKeys(); }
  equals<K extends keyof T & string>(field: K, value: T[K]): Promise<T[]> { return this.raw.where(field).equals(value as never).toArray(); }
  deleteEquals<K extends keyof T & string>(field: K, value: T[K]): Promise<number> { return this.raw.where(field).equals(value as never).delete(); }
  distinct<K extends keyof T & string>(field: K): Promise<T[K][]> { return this.raw.toArray().then(rows => [...new Set(rows.map(row => row[field]))]); }
}

const webBackendsByFileStore = new Map<string, WeakRef<RecordBackend>>();
export class WebSideRuntime implements SideStoreRuntime {
  private boundRecords?: RecordBackend;
  constructor(readonly raw: Dexie, records?: RecordBackend) { if (records) this.bindRecords(records); }
  get records(): RecordBackend {
    const records = this.boundRecords ?? webBackendsByFileStore.get(this.raw.name)?.deref();
    if (!records) throw Error('repository-not-bound');
    return records;
  }
  bindRecords(records: RecordBackend) { this.boundRecords = records; webBackendsByFileStore.set(this.raw.name, new WeakRef(records)); }
  get name() { return this.raw.name; }
  async transaction<T>(mode: 'r' | 'rw', tables: SideTableRef | readonly (SideTableRef | string)[], action: (scope: this) => Promise<T>): Promise<T> {
    const names = (Array.isArray(tables) ? tables : [tables]).map(table => typeof table === 'string' ? table : table.name);
    return this.raw.transaction(mode, names, async () => action(this));
  }
  outsideTransaction<T>(action: () => Promise<T>): Promise<T> { return Dexie.waitFor(Dexie.ignoreTransaction(action)); }
  waitFor<T>(promise: Promise<T>): Promise<T> { return Dexie.waitFor(promise); }
  subscribe(listener: () => void) {
    const subscription = liveQuery(async () => Promise.all(this.raw.tables.map(table => table.count()))).subscribe({ next: listener, error: listener });
    return () => subscription.unsubscribe();
  }
  close() { this.raw.close(); }
  async open() { await this.raw.open(); }
}
