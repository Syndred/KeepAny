import { entitySchemas, type EntityType } from '../../domain/src';
import type { FileStore, RecordRow } from '../../local-db/src';
import { checkedPasswordVaultRecord } from '../../local-db/src/password-vault-storage';
import type { RecordBackend, RecordChange, SideTable, SideTableRef, StoredRecord, WriteResult } from '../../local-db/src/storage-contracts';
import type { SqlDriver, SqlRow, SqlValue } from './driver';
import { type NativeStore, sideTableNames, type FilePointer } from './store';
import { decodeNativeValue, encodeNativeValue } from './value-codec';

type RawRecord = SqlRow & { id: string; type: EntityType; payload: string; updated_at: number; revision: number; internal_deleted: number };
function stored(row: RawRecord): StoredRecord {
  return { id: row.id, type: row.type, payload: row.payload, updatedAt: row.updated_at, revision: String(row.revision), internalDeleted: row.internal_deleted === 1 };
}
function checkRow(row: RecordRow): void {
  const entity = entitySchemas[row.type]?.parse(JSON.parse(row.payload));
  if (!entity || row.id !== `${row.type}:${entity.id}` || !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0) throw Error('native-record-invalid');
}
async function readRecord(driver: SqlDriver, id: string): Promise<StoredRecord | null> {
  const [row] = await driver.query<RawRecord>('SELECT * FROM records WHERE id=?', [id]);
  return row ? stored(row) : null;
}
export class NativeRecordBackend implements RecordBackend {
  constructor(readonly name: string, readonly store: NativeStore) {}
  async get(id: string, includeInternalDeleted = false): Promise<StoredRecord | null> {
    return this.store.readSql(async driver => {
      const current = await readRecord(driver, id);
      return current && (includeInternalDeleted || !current.internalDeleted) ? current : null;
    });
  }
  async getMany(ids: readonly string[], includeInternalDeleted = false): Promise<StoredRecord[]> {
    return this.store.readSql(async driver => {
      const result: StoredRecord[] = [];
      // Parameter count stays below the SQLite limit even for large archives.
      for (let offset = 0; offset < ids.length; offset += 500) {
        const chunk = ids.slice(offset, offset + 500);
        const rows = await driver.query<RawRecord>(`SELECT * FROM records WHERE id IN (${chunk.map(() => '?').join(',')})${includeInternalDeleted ? '' : ' AND internal_deleted=0'}`, [...chunk]);
        result.push(...rows.map(stored));
      }
      return result;
    });
  }
  list(type?: EntityType): Promise<StoredRecord[]> {
    return this.store.readSql(async driver => (await driver.query<RawRecord>(`SELECT * FROM records WHERE internal_deleted=0${type ? ' AND type=?' : ''} ORDER BY id`, type ? [type] : [])).map(stored));
  }
  async insert(row: RecordRow): Promise<void> {
    checkRow(row);
    const current = await this.get(row.id, true);
    if (current && !current.internalDeleted) throw Error('record-existing');
    if ((await this.compareAndWrite([{ previous: current, next: row }], 'insert')).error.length) throw Error('record-stale');
  }
  insertMany(rows: readonly RecordRow[]): Promise<WriteResult> {
    return this.compareAndWrite(rows.map(next => ({ previous: null, next })), 'insert-many');
  }
  async modify(id: string, modifier: (row: RecordRow) => RecordRow | Promise<RecordRow>): Promise<void> {
    // Run application callbacks outside the root SQL transaction. They may read
    // other records, and must rerun after a concurrent CAS rather than deadlock.
    for (let attempt = 0; attempt < 32; attempt++) {
      const previous = await this.get(id);
      if (!previous) throw Error('record-missing');
      const next = await modifier({ id: previous.id, type: previous.type, payload: previous.payload, updatedAt: previous.updatedAt });
      if (next.id !== id) throw Error('native-record-invalid');
      if (!(await this.compareAndWrite([{ previous, next }], 'modify')).error.length) return;
    }
    throw Error('record-stale');
  }
  compareAndWrite(changes: readonly RecordChange[], _context: string): Promise<WriteResult> {
    for (const change of changes) checkRow(change.next);
    if (new Set(changes.map(change => change.next.id)).size !== changes.length) return Promise.reject(Error('native-record-duplicate'));
    return this.store.writeSql(async driver => {
      const current = new Map<string, StoredRecord | null>();
      for (const change of changes) current.set(change.next.id, await readRecord(driver, change.next.id));
      const error = changes.filter(change => {
        const found = current.get(change.next.id);
        return change.previous ? !found || change.previous.id !== change.next.id || found.revision !== change.previous.revision : !!found && !found.internalDeleted;
      }).map(change => ({ documentId: change.next.id, status: 409 }));
      if (error.length) return { success: [], error };
      for (const { next, internalDeleted = false } of changes) {
        await driver.run('INSERT INTO records(id,type,payload,updated_at,revision,internal_deleted) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,payload=excluded.payload,updated_at=excluded.updated_at,revision=excluded.revision,internal_deleted=excluded.internal_deleted',
          [next.id, next.type, next.payload, next.updatedAt, Number(current.get(next.id)?.revision ?? 0) + 1, internalDeleted ? 1 : 0]);
      }
      return { success: changes.map(change => change.next.id), error: [] };
    });
  }
  async remove(id: string, expectedRevision: string): Promise<void> {
    const previous = await this.get(id, true);
    if (!previous || previous.revision !== expectedRevision || (await this.compareAndWrite([{ previous, next: previous, internalDeleted: true }], 'remove')).error.length) throw Error('record-stale');
  }
  subscribe(listener: () => void) { return this.store.subscribe(listener); }
  close(): Promise<void> { return this.store.close(); }
}

type TableName = typeof sideTableNames[number] | 'blobs' | 'passwordVault';
type SideRow = { id: string };
const indexedFields = new Set(['id', 'scope', 'assetId', 'fileHash', 'status']);
class NativeSideTable<T extends SideRow> implements SideTable<T> {
  constructor(readonly name: TableName, readonly store: NativeStore) {}
  private async decode(_driver: SqlDriver, row: SqlRow): Promise<T> {
    if (this.name === 'blobs') {
      const pointer = row as FilePointer;
      return { id: pointer.id, name: pointer.name, blob: new Blob([await this.store.readPointer(pointer) as BlobPart], { type: pointer.mime }) } as unknown as T;
    }
    if (this.name === 'passwordVault') {
      return checkedPasswordVaultRecord({ id: 'local', bytes: await this.store.readPointer(row as FilePointer), revision: row.revision as string, updatedAt: row.updated_at as string }) as unknown as T;
    }
    return decodeNativeValue<T>(this.store, row.payload as string);
  }
  get(id: string): Promise<T | undefined> {
    return this.store.readSql(async driver => {
      const [row] = await driver.query(`SELECT * FROM "${this.name}" WHERE id=?`, [id]);
      return row ? this.decode(driver, row) : undefined;
    });
  }
  private async save(driver: SqlDriver, value: T, insert: boolean): Promise<string> {
    if (typeof value.id !== 'string') throw Error('native-row-id');
    const found = (await driver.query(`SELECT id FROM "${this.name}" WHERE id=?`, [value.id])).length > 0;
    if (insert && found) throw Error('native-row-existing');
    if (this.name === 'blobs') {
      const file = value as unknown as { id: string; blob: Blob; name: string };
      if (!(file.blob instanceof Blob) || file.blob.size > 20 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.blob.type)) throw Error('native-file-invalid');
      const pointer = await this.store.prepareFile(new Uint8Array(await file.blob.arrayBuffer()), 'files', file.name, file.blob.type);
      await driver.run('INSERT INTO blobs(id,path,name,mime,size,sha256) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,name=excluded.name,mime=excluded.mime,size=excluded.size,sha256=excluded.sha256',
        [file.id, pointer.path, pointer.name, pointer.mime, pointer.size, pointer.sha256]);
    } else if (this.name === 'passwordVault') {
      const vault = checkedPasswordVaultRecord(value as unknown as Parameters<typeof checkedPasswordVaultRecord>[0]);
      const pointer = await this.store.prepareFile(vault.bytes, 'vaults', 'password-vault.kdbx', 'application/x-keepass2');
      await driver.run('INSERT INTO passwordVault(id,path,name,mime,size,sha256,revision,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,size=excluded.size,sha256=excluded.sha256,revision=excluded.revision,updated_at=excluded.updated_at',
        [vault.id, pointer.path, pointer.name, pointer.mime, pointer.size, pointer.sha256, vault.revision, vault.updatedAt]);
    } else {
      const payload = await encodeNativeValue(this.store, value);
      const fields = value as Record<string, unknown>;
      const indexValue = (field: string) => typeof fields[field] === 'string' ? fields[field] as string : null;
      await driver.run(`INSERT INTO "${this.name}"(id,payload,scope,assetId,fileHash,status) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,scope=excluded.scope,assetId=excluded.assetId,fileHash=excluded.fileHash,status=excluded.status`,
        [value.id, payload, indexValue('scope'), indexValue('assetId'), indexValue('fileHash'), indexValue('status')]);
    }
    return value.id;
  }
  add(value: T): Promise<string> { return this.store.writeSql(driver => this.save(driver, value, true)); }
  put(value: T): Promise<string> { return this.store.writeSql(driver => this.save(driver, value, false)); }
  update(id: string, patch: Partial<T>): Promise<number> {
    return this.store.transaction(false, async scope => {
      const table = new NativeSideTable<T>(this.name, scope);
      const current = await table.get(id);
      if (!current) return 0;
      const next = { ...current, ...patch, id };
      for (const key of Object.keys(patch) as (keyof T)[]) if (patch[key] === undefined) delete next[key];
      await table.put(next);
      return 1;
    });
  }
  async delete(id: string): Promise<void> { await this.store.writeSql(driver => driver.run(`DELETE FROM "${this.name}" WHERE id=?`, [id])); }
  async bulkDelete(ids: readonly string[]): Promise<void> {
    await this.store.writeSql(async driver => { for (const id of ids) await driver.run(`DELETE FROM "${this.name}" WHERE id=?`, [id]); });
  }
  async clear(): Promise<void> { await this.store.writeSql(driver => driver.run(`DELETE FROM "${this.name}"`)); }
  count(): Promise<number> { return this.store.readSql(async driver => Number((await driver.query(`SELECT count(*) AS n FROM "${this.name}"`))[0].n)); }
  toArray(): Promise<T[]> { return this.store.readSql(async driver => Promise.all((await driver.query(`SELECT * FROM "${this.name}" ORDER BY id`)).map(row => this.decode(driver, row)))); }
  keys(): Promise<string[]> { return this.store.readSql(async driver => (await driver.query(`SELECT id FROM "${this.name}" ORDER BY id`)).map(row => row.id as string)); }
  equals<K extends keyof T & string>(field: K, value: T[K]): Promise<T[]> {
    if (!indexedFields.has(field)) return Promise.reject(Error('native-table-index'));
    return this.store.readSql(async driver => Promise.all((await driver.query(`SELECT * FROM "${this.name}" WHERE "${field}"=? ORDER BY id`, [value as SqlValue])).map(row => this.decode(driver, row))));
  }
  deleteEquals<K extends keyof T & string>(field: K, value: T[K]): Promise<number> {
    if (!indexedFields.has(field)) return Promise.reject(Error('native-table-index'));
    return this.store.writeSql(driver => driver.run(`DELETE FROM "${this.name}" WHERE "${field}"=?`, [value as SqlValue]));
  }
  distinct<K extends keyof T & string>(field: K): Promise<T[K][]> {
    if (!indexedFields.has(field)) return Promise.reject(Error('native-table-index'));
    return this.store.readSql(async driver => (await driver.query(`SELECT DISTINCT "${field}" AS v FROM "${this.name}" WHERE "${field}" IS NOT NULL ORDER BY "${field}"`)).map(row => row.v as T[K]));
  }
}

export class NativeFileStore implements FileStore {
  readonly records: NativeRecordBackend;
  get recoveryTables(): SideTableRef[] {
    return [this.journal, this.importJournal, this.pullJournal, this.scopedPull, this.scopedOutbox,
      this.scopedAttachmentUploads, this.archiveMerge, this.renewalJournal, this.subscriptionSaveJournal];
  }
  declare blobs: FileStore['blobs']; declare passwordVault: FileStore['passwordVault'];
  declare journal: FileStore['journal']; declare importJournal: FileStore['importJournal'];
  declare renewalJournal: FileStore['renewalJournal']; declare syncBase: FileStore['syncBase'];
  declare syncMeta: FileStore['syncMeta']; declare pullJournal: FileStore['pullJournal'];
  declare scopedBase: FileStore['scopedBase']; declare scopedMeta: FileStore['scopedMeta'];
  declare scopedOutbox: FileStore['scopedOutbox']; declare scopedPull: FileStore['scopedPull'];
  declare datasetBinding: FileStore['datasetBinding']; declare scopedAttachmentUploads: FileStore['scopedAttachmentUploads'];
  declare archiveMerge: FileStore['archiveMerge']; declare subscriptionSaveJournal: FileStore['subscriptionSaveJournal'];
  declare intakeReview: FileStore['intakeReview']; declare categoryEditJournal: FileStore['categoryEditJournal'];
  constructor(readonly name: string, readonly store: NativeStore) {
    this.records = new NativeRecordBackend(name, store);
    for (const table of [...sideTableNames, 'blobs', 'passwordVault'] as const) Object.defineProperty(this, table, { value: new NativeSideTable(table, store), enumerable: true });
  }
  transaction<T>(mode: 'r' | 'rw', _tables: SideTableRef | readonly (SideTableRef | string)[], action: (scope: this) => Promise<T>): Promise<T> {
    return this.store.transaction(mode === 'r', scope => action(new NativeFileStore(this.name, scope) as this));
  }
  outsideTransaction<T>(action: () => Promise<T>): Promise<T> { return action(); }
  waitFor<T>(promise: Promise<T>): Promise<T> { return promise; }
  subscribe(listener: () => void) { return this.store.subscribe(listener); }
  async open(): Promise<void> { await this.store.readSql(driver => driver.query('SELECT 1')); }
  close(): void { /* The paired record backend owns the shared connection. */ }
}
