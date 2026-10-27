import { entitySchemas, type EntityType } from '../../domain/src';
import { checkedPasswordVaultBytes, checkedPasswordVaultRecord } from '../../local-db/src/password-vault-storage';
import type { VaultPersistence, VaultRecord } from '../../password-vault/src/types';
import type { PersistentFiles } from '../../platform-native/src';
import type { SqlDriver, SqlRow } from './driver';

export interface NativeRecord { id: string; type: EntityType; payload: string; updatedAt: number }
type StoredRecord = SqlRow & { id: string; type: EntityType; payload: string; updated_at: number; revision: number };
export type FilePointer = SqlRow & { id: string; path: string; name: string; mime: string; size: number; sha256: string };
type VaultPointer = FilePointer & { revision: string; updated_at: string };

export const sideTableNames = ['journal', 'importJournal', 'renewalJournal', 'syncBase', 'syncMeta', 'pullJournal',
  'scopedBase', 'scopedMeta', 'scopedOutbox', 'scopedPull', 'datasetBinding', 'scopedAttachmentUploads',
  'archiveMerge', 'subscriptionSaveJournal', 'intakeReview', 'categoryEditJournal'] as const;
export type SideTableName = typeof sideTableNames[number];

async function hash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), value => value.toString(16).padStart(2, '0')).join('');
}
function record(row: StoredRecord): NativeRecord {
  return { id: row.id, type: row.type, payload: row.payload, updatedAt: row.updated_at };
}
function checkRecord(row: NativeRecord) {
  const entity = entitySchemas[row.type]?.parse(JSON.parse(row.payload));
  if (!entity || row.id !== `${row.type}:${entity.id}` || !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0) throw Error('native-record-invalid');
}

/** A single SQLite database with immutable file pointers. No IndexedDB fallback. */
export class NativeStore {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private listeners = new Set<() => void>();
  private constructor(readonly driver: SqlDriver, readonly files: PersistentFiles, private scoped = false, private readOnly = false,
    private scopeToken?: { active: boolean; parent?: { active: boolean } }) {}

  static async open(driver: SqlDriver, files: PersistentFiles): Promise<NativeStore> {
    const store = new NativeStore(driver, files);
    try {
      await files.rootUri();
      const [{ user_version: version }] = await driver.query<{ user_version: number }>('PRAGMA user_version');
      if (version > 1) throw Error('native-schema-newer');
      await driver.execute(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, type TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL, revision INTEGER NOT NULL, internal_deleted INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS records_type ON records(type);
        ${sideTableNames.map(name => `CREATE TABLE IF NOT EXISTS "${name}"(id TEXT PRIMARY KEY, payload TEXT NOT NULL, scope TEXT, assetId TEXT, fileHash TEXT, status TEXT);
          CREATE INDEX IF NOT EXISTS "${name}_scope" ON "${name}"(scope);
          CREATE INDEX IF NOT EXISTS "${name}_status" ON "${name}"(status);
          CREATE INDEX IF NOT EXISTS "${name}_fileHash" ON "${name}"(fileHash);`).join('\n')}
        CREATE UNIQUE INDEX IF NOT EXISTS subscriptionSaveJournal_assetId ON subscriptionSaveJournal(assetId);
        CREATE TABLE IF NOT EXISTS blobs(id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS passwordVault(id TEXT PRIMARY KEY CHECK(id='local'), path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, revision TEXT NOT NULL, updated_at TEXT NOT NULL);
        PRAGMA user_version=1; COMMIT;`);
      return store;
    } catch (error) { await driver.close(); throw error; }
  }

  private assertOpen(): void {
    if (this.closed) throw Error('native-store-closed');
    if (this.scopeToken && (!this.scopeToken.active || this.scopeToken.parent?.active === false)) throw Error('native-transaction-expired');
  }
  subscribe(listener: () => void): () => void { this.assertOpen(); this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.scoped) return Promise.resolve().then(() => { this.assertOpen(); return work(); });
    const next = this.tail.then(() => { this.assertOpen(); return work(); });
    this.tail = next.catch(() => {});
    return next;
  }
  private async commit<T>(work: () => Promise<T>, publish = true): Promise<T> {
    if (this.readOnly) throw Error('native-read-only-transaction');
    if (this.scoped) return work();
    await this.driver.execute('BEGIN IMMEDIATE');
    try {
      const result = await work();
      await this.driver.execute('COMMIT');
      // Observer exceptions must never turn a committed save into a failure.
      if (publish) for (const listener of this.listeners) { try { listener(); } catch { /* UI reads can retry. */ } }
      return result;
    } catch (error) { await this.driver.execute('ROLLBACK').catch(() => {}); throw error; }
  }
  readSql<T>(action: (driver: SqlDriver) => Promise<T>): Promise<T> { return this.serial(() => action(this.driver)); }
  writeSql<T>(action: (driver: SqlDriver) => Promise<T>): Promise<T> { return this.serial(() => this.commit(() => action(this.driver))); }
  transaction<T>(readOnly: boolean, action: (scope: NativeStore) => Promise<T>): Promise<T> {
    if (this.scoped) {
      if (this.readOnly && !readOnly) return Promise.reject(Error('native-read-only-transaction'));
      return this.serial(async () => {
        const token = { active: true, parent: this.scopeToken };
        const nested = new NativeStore(this.driver, this.files, true, this.readOnly || readOnly, token);
        nested.listeners = this.listeners;
        try { return await action(nested); } finally { token.active = false; }
      });
    }
    return this.serial(() => this.commit(async () => {
      const token = { active: true };
      const scope = new NativeStore(this.driver, this.files, true, readOnly, token);
      scope.listeners = this.listeners;
      try { return await action(scope); } finally { token.active = false; }
    }, !readOnly));
  }
  allRecords(type?: EntityType): Promise<NativeRecord[]> {
    return this.serial(async () => (await this.driver.query<StoredRecord>(
      `SELECT * FROM records WHERE internal_deleted=0${type ? ' AND type=?' : ''} ORDER BY id`, type ? [type] : [])).map(record));
  }
  saveRecords(changes: ReadonlyArray<{ next: NativeRecord; expected: NativeRecord | null }>): Promise<void> {
    for (const change of changes) checkRecord(change.next);
    if (new Set(changes.map(change => change.next.id)).size !== changes.length) return Promise.reject(Error('native-record-duplicate'));
    return this.serial(() => this.commit(async () => {
      for (const { next, expected } of changes) {
        const [current] = await this.driver.query<StoredRecord>('SELECT * FROM records WHERE id=?', [next.id]);
        if (expected ? !current || expected.id !== next.id || expected.type !== current.type || expected.payload !== current.payload || expected.updatedAt !== current.updated_at : current) throw Error('native-record-stale');
        await this.driver.run('INSERT INTO records(id,type,payload,updated_at,revision) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,payload=excluded.payload,updated_at=excluded.updated_at,revision=excluded.revision',
          [next.id, next.type, next.payload, next.updatedAt, (current?.revision ?? 0) + 1]);
      }
    }));
  }
  readSideRows<T>(table: SideTableName): Promise<T[]> {
    if (!sideTableNames.includes(table)) return Promise.reject(Error('native-table'));
    return this.serial(async () => (await this.driver.query<{ payload: string }>(`SELECT payload FROM "${table}" ORDER BY id`)).map(row => JSON.parse(row.payload) as T));
  }
  saveSideRow(table: SideTableName, value: { id: string }): Promise<void> {
    if (!sideTableNames.includes(table)) return Promise.reject(Error('native-table'));
    return this.serial(() => this.commit(async () => {
      await this.driver.run(`INSERT INTO "${table}"(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`, [value.id, JSON.stringify(value)]);
    }));
  }
  async prepareFile(bytes: Uint8Array, kind: 'files' | 'vaults', name: string, mime: string): Promise<FilePointer> {
    this.assertOpen();
    if (this.readOnly) throw Error('native-read-only-transaction');
    const id = crypto.randomUUID(), path = `${kind}/${id}${kind === 'vaults' ? '.kdbx' : '.bin'}`;
    const sha256 = await hash(bytes);
    await this.files.write(path, bytes);
    const actual = await this.files.read(path);
    if (actual.length !== bytes.length || await hash(actual) !== sha256) throw Error('native-file-verification');
    return { id, path, name, mime, size: bytes.length, sha256 };
  }
  async readPointer(pointer: FilePointer): Promise<Uint8Array> {
    this.assertOpen();
    const bytes = await this.files.read(pointer.path);
    if (bytes.length !== pointer.size || await hash(bytes) !== pointer.sha256) throw Error('native-file-verification');
    return bytes;
  }
  putFile(bytes: Uint8Array, name: string, mime: string): Promise<string> {
    // Caller validates image decoding using the existing shared image pipeline.
    if (bytes.length > 20 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime)) return Promise.reject(Error('native-file-invalid'));
    const snapshot = bytes.slice();
    return this.serial(async () => {
      const pointer = await this.prepareFile(snapshot, 'files', name, mime);
      await this.commit(async () => { await this.driver.run('INSERT INTO blobs(id,path,name,mime,size,sha256) VALUES(?,?,?,?,?,?)',
        [pointer.id, pointer.path, pointer.name, pointer.mime, pointer.size, pointer.sha256]); });
      return pointer.id;
    });
  }
  readFile(id: string): Promise<{ bytes: Uint8Array; name: string; mime: string } | null> {
    return this.serial(async () => {
      const [pointer] = await this.driver.query<FilePointer>('SELECT * FROM blobs WHERE id=?', [id]);
      return pointer ? { bytes: await this.readPointer(pointer), name: pointer.name, mime: pointer.mime } : null;
    });
  }
  vaultPersistence(): VaultPersistence {
    return {
      read: () => this.serial(async () => {
        const [pointer] = await this.driver.query<VaultPointer>("SELECT * FROM passwordVault WHERE id='local'");
        return pointer ? checkedPasswordVaultRecord({ id: 'local', revision: pointer.revision, updatedAt: pointer.updated_at, bytes: await this.readPointer(pointer) }) : null;
      }),
      write: (input, expectedRevision) => {
        const bytes = checkedPasswordVaultBytes(input);
        return this.serial(async () => {
          // Check first to avoid writing files for already-stale edits, then
          // repeat inside the pointer transaction in case another handle won.
          const [old] = await this.driver.query<VaultPointer>("SELECT * FROM passwordVault WHERE id='local'");
          if ((old?.revision ?? null) !== expectedRevision) throw Error('vault-stale');
          const pointer = await this.prepareFile(bytes, 'vaults', 'password-vault.kdbx', 'application/x-keepass2');
          const saved: VaultRecord = { id: 'local', revision: crypto.randomUUID(), updatedAt: new Date().toISOString(), bytes };
          await this.commit(async () => {
            const [current] = await this.driver.query<VaultPointer>("SELECT * FROM passwordVault WHERE id='local'");
            if ((current?.revision ?? null) !== expectedRevision) throw Error('vault-stale');
            await this.driver.run("INSERT INTO passwordVault(id,path,name,mime,size,sha256,revision,updated_at) VALUES('local',?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,size=excluded.size,sha256=excluded.sha256,revision=excluded.revision,updated_at=excluded.updated_at",
              [pointer.path, pointer.name, pointer.mime, pointer.size, pointer.sha256, saved.revision, saved.updatedAt]);
          });
          return checkedPasswordVaultRecord(saved);
        });
      },
    };
  }
  collectFileGarbage(): Promise<number> {
    // The root queue excludes every live file read and pointer write. Archive
    // snapshots copy bytes while holding this queue, so they no longer depend
    // on disk pointers once their read returns.
    return this.serial(async () => {
      if (this.scoped) throw Error('native-gc-in-transaction');
      const retained = new Set<string>();
      for (const table of ['blobs', 'passwordVault']) {
        for (const row of await this.driver.query<{ path: string }>(`SELECT path FROM "${table}"`)) retained.add(row.path);
      }
      function visit(node: unknown) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { for (const child of node) visit(child); return; }
        const value = node as Record<string, unknown>;
        if ((value.t === 'bytes' || value.t === 'blob') && value.v && typeof value.v === 'object') {
          const pointer = value.v as Record<string, unknown>;
          if (typeof pointer.path !== 'string') throw Error('native-value-format');
          retained.add(pointer.path);
        }
        for (const child of Object.values(value)) visit(child);
      }
      for (const table of sideTableNames) {
        for (const row of await this.driver.query<{ payload: string }>(`SELECT payload FROM "${table}"`)) visit(JSON.parse(row.payload));
      }
      let removed = 0;
      for (const path of await this.files.list()) {
        if (!/^(?:files|vaults|recovery)\/[a-z0-9-]+(?:\.(?:bin|kdbx|ka1))?$/.test(path)) throw Error('native-file-path');
        if (!retained.has(path)) { await this.files.remove(path); removed++; }
      }
      return removed;
    });
  }
  async close(): Promise<void> {
    if (this.scoped) throw Error('native-scoped-close');
    await this.serial(async () => { this.closed = true; this.listeners.clear(); await this.driver.close(); });
  }
}
