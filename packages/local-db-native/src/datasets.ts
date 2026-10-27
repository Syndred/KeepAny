import { LocalRepository, inspectArchive, type RecordRow } from '../../local-db/src';
import type { SqlDriver, SqlRow } from './driver';

export interface LocalDataset { name: string; createdAt: string; active: boolean; phase: 'retained' | 'candidate' | 'active' | 'abandoned' }
type RestoreIntent = SqlRow & { id: string; database_name: string; previous_name: string; archive_hash: string; fingerprint: string; phase: string };
type DatasetFactory = (name: string) => Promise<LocalRepository>;

async function sha(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), n => n.toString(16).padStart(2, '0')).join('');
}
async function archiveFingerprint(archive: Uint8Array): Promise<string> {
  const input = await inspectArchive(archive);
  const rows = input.rows.map(({ id, type, payload, updatedAt }: RecordRow) => ({ id, type, payload, updatedAt })).sort((a, b) => a.id.localeCompare(b.id));
  const attachments = [...input.manifest.attachments].sort((a, b) => a.id.localeCompare(b.id));
  const reviews = [...input.intakeReview].sort((a, b) => a.id.localeCompare(b.id));
  return sha(new TextEncoder().encode(JSON.stringify({ rows, attachments, reviews, vault: input.manifest.passwordVault ?? null, source: input.manifest.sourceBinding ?? null })));
}

/** Control database only stores dataset identities and recovery fingerprints. */
export class NativeDatasetManager {
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(event: 'active' | 'catalog') => void>();
  private constructor(private control: SqlDriver, private factory: DatasetFactory, private exists: (name: string) => Promise<boolean>, private discard?: (name: string) => Promise<void>) {}
  static async open(control: SqlDriver, factory: DatasetFactory, exists: (name: string) => Promise<boolean>, discard?: (name: string) => Promise<void>): Promise<NativeDatasetManager> {
    await control.execute('BEGIN IMMEDIATE');
    try { await control.execute(`
      CREATE TABLE IF NOT EXISTS local_datasets(name TEXT PRIMARY KEY, created_at TEXT NOT NULL, phase TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS active_dataset(id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, initialized INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS native_restores(id TEXT PRIMARY KEY, database_name TEXT NOT NULL UNIQUE, previous_name TEXT NOT NULL, archive_hash TEXT NOT NULL, fingerprint TEXT NOT NULL, phase TEXT NOT NULL);
      INSERT OR IGNORE INTO active_dataset(id,name) VALUES(1,'keepany-v1');`);
      await control.execute('COMMIT');
    } catch (error) { await control.execute('ROLLBACK').catch(() => {}); throw error; }
    await control.run("INSERT OR IGNORE INTO local_datasets(name,created_at,phase) VALUES('keepany-v1',?,'active')", [new Date().toISOString()]);
    return new NativeDatasetManager(control, factory, exists, discard);
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action); this.tail = next.catch(() => {}); return next;
  }
  private async current() {
    const [active] = await this.control.query<{ name: string; initialized: number }>('SELECT name,initialized FROM active_dataset WHERE id=1');
    if (!active || !/^[a-z][a-z0-9-]{2,60}$/.test(active.name)) throw Error('native-dataset-invalid');
    return active;
  }
  subscribe(listener: (event: 'active' | 'catalog') => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify(event: 'active' | 'catalog') { for (const listener of this.listeners) { try { listener(event); } catch { /* Observer cannot undo control commit. */ } } }
  async list(): Promise<LocalDataset[]> {
    return this.serial(async () => {
      const active = await this.current();
      return (await this.control.query<{ name: string; created_at: string; phase: LocalDataset['phase'] }>('SELECT * FROM local_datasets ORDER BY created_at DESC,name')).map(row => ({ name: row.name, createdAt: row.created_at, phase: row.phase, active: row.name === active.name }));
    });
  }
  async openActive(): Promise<LocalRepository> {
    return this.serial(async () => {
      const current = await this.current();
      if (current.initialized && !(await this.exists(current.name))) throw Error('native-dataset-missing');
      const repository = await this.factory(current.name);
      await this.control.run('UPDATE active_dataset SET initialized=1 WHERE id=1', []);
      return new ManagedNativeRepository(repository, this);
    });
  }
  private async activate(name: string, previous: string, restoreId?: string): Promise<void> {
    await this.control.execute('BEGIN IMMEDIATE');
    try {
      if (await this.control.run('UPDATE active_dataset SET name=?,initialized=1 WHERE id=1 AND name=?', [name, previous]) !== 1) throw Error('native-dataset-stale');
      await this.control.run("UPDATE local_datasets SET phase='retained' WHERE name=?", [previous]);
      await this.control.run("UPDATE local_datasets SET phase='active' WHERE name=?", [name]);
      if (restoreId) await this.control.run("UPDATE native_restores SET phase='active' WHERE id=?", [restoreId]);
      await this.control.execute('COMMIT');
    } catch (error) { await this.control.execute('ROLLBACK').catch(() => {}); throw error; }
    this.notify('active');
  }
  private async verifyAndActivate(intent: RestoreIntent): Promise<number> {
    // Verification opens a fresh connection after the candidate has been closed.
    const candidate = await this.factory(intent.database_name);
    let count: number;
    try {
      const archive = await candidate.exportArchive();
      if (await archiveFingerprint(archive) !== intent.fingerprint) throw Error('native-restore-incomplete');
      count = (await candidate.allRecords()).length;
    } finally { await candidate.close(); }
    await this.control.run("UPDATE native_restores SET phase='verified' WHERE id=?", [intent.id]);
    await this.activate(intent.database_name, intent.previous_name, intent.id);
    return count;
  }
  restore(archive: Uint8Array): Promise<number> {
    const input = archive.slice();
    return this.serial(async () => {
      const fingerprint = await archiveFingerprint(input), archiveHash = await sha(input);
      const previous = (await this.current()).name;
      let [intent] = await this.control.query<RestoreIntent>("SELECT * FROM native_restores WHERE previous_name=? AND archive_hash=? AND phase IN ('prepared','verified')", [previous, archiveHash]);
      if (!intent) {
        intent = { id: crypto.randomUUID(), database_name: `keepany-data-${crypto.randomUUID()}`, previous_name: previous, archive_hash: archiveHash, fingerprint, phase: 'prepared' };
        await this.control.execute('BEGIN IMMEDIATE');
        try {
          await this.control.run("INSERT INTO local_datasets(name,created_at,phase) VALUES(?,?,'candidate')", [intent.database_name, new Date().toISOString()]);
          await this.control.run('INSERT INTO native_restores(id,database_name,previous_name,archive_hash,fingerprint,phase) VALUES(?,?,?,?,?,?)',
            [intent.id, intent.database_name, previous, archiveHash, fingerprint, 'prepared']);
          await this.control.execute('COMMIT');
        } catch (error) { await this.control.execute('ROLLBACK').catch(() => {}); throw error; }
        this.notify('catalog');
      }
      const candidate = await this.factory(intent.database_name);
      try { await candidate.restoreArchive(input); }
      finally { await candidate.close(); }
      return this.verifyAndActivate(intent);
    });
  }
  resume(name: string): Promise<number> {
    return this.serial(async () => {
      const [intent] = await this.control.query<RestoreIntent>("SELECT * FROM native_restores WHERE database_name=? AND phase IN ('prepared','verified')", [name]);
      if (!intent || intent.previous_name !== (await this.current()).name) throw Error('native-dataset-stale');
      const candidate = await this.factory(name);
      try {
        for (const recovery of await candidate.getPendingRestoreRecoveries()) {
          if (!recovery.canRetry) throw Error('native-restore-incomplete');
          await candidate.retryRestoreRecovery(recovery.token);
        }
      } finally { await candidate.close(); }
      return this.verifyAndActivate(intent);
    });
  }
  switchTo(name: string): Promise<void> {
    return this.serial(async () => {
      const [dataset] = await this.control.query<{ phase: string }>('SELECT phase FROM local_datasets WHERE name=?', [name]);
      if (!dataset || !['active', 'retained'].includes(dataset.phase) || !(await this.exists(name))) throw Error('native-dataset-unavailable');
      const previous = (await this.current()).name;
      if (previous !== name) await this.activate(name, previous);
    });
  }
  abandon(name: string): Promise<void> {
    return this.serial(async () => {
      if (name === (await this.current()).name) throw Error('native-dataset-active');
      const changed = await this.control.run("UPDATE native_restores SET phase='abandoned' WHERE database_name=? AND phase IN ('prepared','verified','abandoned')", [name]);
      if (changed !== 1) throw Error('native-dataset-unavailable');
      await this.control.run("UPDATE local_datasets SET phase='abandoned' WHERE name=?", [name]);
      this.notify('catalog');
      await this.discard?.(name);
      await this.control.run('DELETE FROM local_datasets WHERE name=?', [name]);
      await this.control.run('DELETE FROM native_restores WHERE database_name=?', [name]);
      this.notify('catalog');
    });
  }
}
class ManagedNativeRepository extends LocalRepository {
  constructor(repository: LocalRepository, private manager: NativeDatasetManager) {
    super(repository.records, repository.fileStore, repository.recoveryState);
  }
  override restoreArchive(bytes: Uint8Array): Promise<number> { return this.manager.restore(bytes); }
}
