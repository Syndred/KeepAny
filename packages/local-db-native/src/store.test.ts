import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { historySchema, newAsset } from '../../domain/src';
import { VaultSession } from '../../password-vault/src';
import { decryptBackup, encryptBackup } from '../../local-db/src/backup-crypto';
import type { PersistentFiles } from '../../platform-native/src';
import type { SqlDriver, SqlRow } from './driver';
import { NativeStore, type NativeRecord, sideTableNames } from './store';
import { NativeFileStore } from './repository-storage';

const roots: string[] = [];
const opened = new Set<NativeStore>();
afterEach(async () => {
  for (const store of opened) await store.close();
  opened.clear();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'keepany-native-'));
  roots.push(root);
  const path = join(root, 'keepany.db');
  const state = { failWrite: false, corruptRead: false, failBatchAfter: null as number | null, batchCalls: 0 };
  const files: PersistentFiles = {
    async rootUri() { return pathToFileURL(root).href; },
    async write(relative, bytes) {
      if (state.failWrite) throw Error('synthetic-no-space');
      const target = join(root, relative);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    },
    async read(relative) { const bytes = new Uint8Array(await readFile(join(root, relative))); return state.corruptRead ? bytes.slice(0, -1) : bytes; },
    async remove(relative) { await rm(join(root, relative)); },
    async list() {
      const paths: string[] = [];
      for (const child of ['files', 'vaults', 'recovery']) {
        const names = await readdir(join(root, child)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
        for (const name of names) paths.push(`${child}/${name}`);
      }
      return paths;
    },
  };
  const connect = async () => {
    const db = new DatabaseSync(path);
    const driver: SqlDriver = {
      uri: pathToFileURL(path).href,
      async execute(sql) { db.exec(sql); },
      async query<T extends SqlRow>(sql: string, values = []) { return db.prepare(sql).all(...values) as T[]; },
      async run(sql, values = []) { return Number(db.prepare(sql).run(...values).changes); },
      async runBatch(statements) {
        state.batchCalls++;
        for (const [index, { sql, values }] of statements.entries()) {
          if (index === state.failBatchAfter) throw Error('synthetic-batch-failure');
          db.prepare(sql).run(...values);
        }
      },
      async close() { db.close(); },
    };
    const store = await NativeStore.open(driver, files);
    opened.add(store);
    return { store, db };
  };
  return { ...(await connect()), connect, state, files };
}
function row(name: string): NativeRecord {
  const asset = { ...newAsset('project'), name };
  return { id: `asset:${asset.id}`, type: 'asset', payload: JSON.stringify(asset), updatedAt: Date.now() };
}

it('restores missing rows in an atomic bound batch, preserves identical revisions and rolls back a mid-batch failure', async () => {
  const { store, state, connect } = await fixture();
  const side = new NativeFileStore('batch-native', store);
  const originals = [row("quoted ' 项目"), row('Second'), row('Third')];
  await side.records.restoreRowsIfIdentical([originals[0]]);
  const previous = await side.records.get(originals[0].id);
  state.failBatchAfter = 1;
  await expect(side.records.restoreRowsIfIdentical(originals)).rejects.toThrow('synthetic-batch-failure');
  expect(await side.records.list()).toEqual([previous]);
  state.failBatchAfter = null;
  await side.records.restoreRowsIfIdentical(originals);
  expect(await side.records.get(originals[0].id)).toEqual(previous);
  expect((await side.records.list()).map(value => value.id).sort()).toEqual(originals.map(value => value.id).sort());
  const changed = { ...originals[0], payload: JSON.stringify({ ...JSON.parse(originals[0].payload), name: 'Conflicting' }) };
  await expect(side.records.restoreRowsIfIdentical([row('Must not appear'), changed])).rejects.toThrow('restore-conflict');
  expect((await side.records.list()).length).toBe(3);
  expect(state.batchCalls).toBe(3);
  await store.close(); opened.delete(store);
  expect((await (await connect()).store.allRecords()).sort((a, b) => a.id.localeCompare(b.id))).toEqual([...originals].sort((a, b) => a.id.localeCompare(b.id)));
});

it('persists complete original fields and side tables on disk, then reopens and rejects stale atomic batches', async () => {
  const { store, connect, db } = await fixture();
  const original = row('原始 KeepAny 项目');
  await store.saveRecords([{ next: original, expected: null }]);
  expect(await store.allRecords()).toEqual([original]);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)).toEqual(expect.arrayContaining(['records', 'blobs', 'passwordVault', ...sideTableNames]));
  await store.saveSideRow('intakeReview', { id: 'review-1', originalText: 'CSV synthetic full text' } as { id: string });
  const next = { ...original, payload: JSON.stringify({ ...JSON.parse(original.payload), name: '最新项目' }), updatedAt: original.updatedAt + 1 };
  await store.saveRecords([{ next, expected: original }]);
  const added = row('must roll back');
  await expect(store.saveRecords([{ next: added, expected: null }, { next: original, expected: original }])).rejects.toThrow('native-record-stale');
  expect(await store.allRecords()).toEqual([next]);
  await store.close(); opened.delete(store);
  const reopened = (await connect()).store;
  expect(await reopened.allRecords()).toEqual([next]);
  expect(await reopened.readSideRows('intakeReview')).toEqual([{ id: 'review-1', originalText: 'CSV synthetic full text' }]);
});

it('rolls back a real SQL failure between an item and its history, then commits the same intent once after reopen', async () => {
  const { openRepositoryFromBackend } = await import('../../local-db/src');
  const { store, db, connect } = await fixture();
  const side = new NativeFileStore('native-history-failure', store);
  const repository = await openRepositoryFromBackend(side.records, side);
  const expected = { ...newAsset('item'), name: 'Synthetic transaction camera',
    purchaseDate: '2026-01-31', warrantyDate: '2028-01-31', notes: 'Preserve the complete original payload' };
  await repository.save('asset', expected);
  const event = historySchema.parse({ id: crypto.randomUUID(), assetId: expected.id, action: 'maintenance',
    note: 'Synthetic lens cleaning', eventDate: '2026-10-28', createdAt: '2026-10-28T01:00:00.000Z' });
  const next = { ...expected, lastItemEventId: event.id, updatedAt: '2026-10-28T01:00:00.000Z' };
  const originalRows = db.prepare('SELECT * FROM records ORDER BY id').all();
  const originalRevision = Number(originalRows[0].revision);
  // This is an actual SQLite constraint failure. Its distinct error also
  // proves the asset statement ran first inside the same uncommitted write.
  db.exec(`CREATE TRIGGER synthetic_history_failure BEFORE INSERT ON records WHEN NEW.type='history' BEGIN
    SELECT CASE WHEN (SELECT revision FROM records WHERE id='asset:${expected.id}')=${originalRevision + 1}
      THEN RAISE(ABORT,'synthetic-after-asset-before-history')
      ELSE RAISE(ABORT,'synthetic-history-before-asset') END;
    END;`);
  await expect(repository.recordItemAction(expected, next, event)).rejects.toThrow('synthetic-after-asset-before-history');
  expect(db.prepare('SELECT * FROM records ORDER BY id').all()).toEqual(originalRows);
  expect(await repository.get('asset', expected.id)).toEqual(expected);
  expect(await repository.list('history')).toEqual([]);
  expect(await side.renewalJournal.count()).toBe(0);
  await repository.close(); opened.delete(store);

  const reopened = await connect();
  const reopenedSide = new NativeFileStore('native-history-failure', reopened.store);
  const returned = await openRepositoryFromBackend(reopenedSide.records, reopenedSide);
  expect(reopened.db.prepare('SELECT * FROM records ORDER BY id').all()).toEqual(originalRows);
  expect(returned.renewalRecoveryError).toBeNull();
  expect(await returned.get('asset', expected.id)).toEqual(expected);
  expect(await returned.list('history')).toEqual([]);
  expect(await reopenedSide.renewalJournal.count()).toBe(0);
  // The fault survived close/reopen; recovery did not secretly retry the write.
  await expect(returned.recordItemAction(expected, next, event)).rejects.toThrow('synthetic-after-asset-before-history');
  expect(reopened.db.prepare('SELECT * FROM records ORDER BY id').all()).toEqual(originalRows);
  reopened.db.exec('DROP TRIGGER synthetic_history_failure');
  await returned.recordItemAction(expected, next, event);
  expect(await returned.get('asset', expected.id)).toEqual(next);
  expect(await returned.list('history')).toEqual([event]);
  expect(await reopenedSide.renewalJournal.count()).toBe(0);
  await expect(returned.recordItemAction(expected, next, event)).rejects.toThrow('item-stale');
  expect(await returned.list('history')).toEqual([event]);
  const committed = reopened.db.prepare('SELECT * FROM records ORDER BY id').all();
  await returned.close(); opened.delete(reopened.store);

  const final = await connect();
  const finalSide = new NativeFileStore('native-history-failure', final.store);
  const finalRepository = await openRepositoryFromBackend(finalSide.records, finalSide);
  expect(final.db.prepare('SELECT * FROM records ORDER BY id').all()).toEqual(committed);
  expect(await finalRepository.get('asset', expected.id)).toEqual(next);
  expect(await finalRepository.list('history')).toEqual([event]);
  expect(await finalSide.renewalJournal.count()).toBe(0);
  await finalRepository.close(); opened.delete(final.store);
});

it('keeps old original bytes on failed writes/readback, including a corrupt image pointer read', async () => {
  const { store, state, db } = await fixture();
  const original = Uint8Array.of(137, 80, 78, 71, 1, 2, 3);
  const id = await store.putFile(original, 'original.png', 'image/png');
  state.failWrite = true;
  await expect(store.putFile(Uint8Array.of(4), 'new.png', 'image/png')).rejects.toThrow('synthetic-no-space');
  state.failWrite = false;
  state.corruptRead = true;
  await expect(store.putFile(Uint8Array.of(4, 5), 'new.png', 'image/png')).rejects.toThrow('native-file-verification');
  await expect(store.readFile(id)).rejects.toThrow('native-file-verification');
  state.corruptRead = false;
  expect((await store.readFile(id))?.bytes).toEqual(original);
  expect(db.prepare('SELECT count(*) AS n FROM blobs').get()?.n).toBe(1);
});

it('round-trips actual KDBX and KA1 crypto, keeps secrets out of ordinary SQL, preserves old vault on failure and stale writes', async () => {
  const { store, connect, state, db } = await fixture();
  const master = 'Synthetic-native-master-v1', secret = 'Synthetic-private-native-P4ss!';
  const persistence = store.vaultPersistence();
  const session = new VaultSession(persistence);
  await session.initialize();
  await session.create(master);
  const entryId = await session.saveEntry({ title: 'Native credential', username: 'native@example.test', password: secret, url: 'https://example.test', notes: '', linkedAssetIds: [] });
  const before = await persistence.read();
  expect(before).not.toBeNull();
  state.failWrite = true;
  await expect(session.saveEntry({ id: entryId, title: 'Native credential', username: 'native@example.test', password: 'unsaved', url: '', notes: '', linkedAssetIds: [] })).rejects.toThrow();
  state.failWrite = false;
  expect((await persistence.read())?.revision).toBe(before?.revision);
  await expect(persistence.write(before!.bytes, null)).rejects.toThrow('vault-stale');
  const sqlText = ['records', ...sideTableNames, 'passwordVault'].map(table => JSON.stringify(db.prepare(`SELECT * FROM "${table}"`).all())).join('');
  expect(sqlText).not.toContain(secret);
  expect(sqlText).not.toContain(master);
  expect(sqlText).not.toContain('Native credential');
  const encrypted = await encryptBackup(before!.bytes, 'Synthetic-backup-passphrase');
  expect(await decryptBackup(encrypted, 'Synthetic-backup-passphrase')).toEqual(before!.bytes);
  await expect(decryptBackup(encrypted, 'incorrect-password')).rejects.toThrow();
  session.lock();
  await store.close(); opened.delete(store);
  const restored = new VaultSession((await connect()).store.vaultPersistence());
  await restored.initialize();
  expect(restored.getSnapshot().status).toBe('locked');
  await restored.unlock(master);
  expect(restored.getSnapshot().entries[0]?.id).toBe(entryId);
  expect(restored.readEntry(entryId).password).toBe(secret);
  restored.lock();
}, 30_000);

it('M0-08 rejects the second stale KDBX writer, reopens exact committed bytes and retries only its intended entry once', async () => {
  const { openRepositoryFromBackend } = await import('../../local-db/src');
  const { store, db, files, connect } = await fixture();
  const sideA = new NativeFileStore('native-vault-two-writers', store);
  const repositoryA = await openRepositoryFromBackend(sideA.records, sideA);
  const account = { ...newAsset('account'), name: 'Synthetic vault association' };
  await repositoryA.save('asset', account);
  const ordinaryBefore = () => Object.fromEntries(['records', ...sideTableNames].map(table => [table, db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all()]));
  const ordinaryRows = ordinaryBefore();
  const master = `Synthetic-M0-08-master-${crypto.randomUUID()}`;
  const passwords = Array.from({ length: 5 }, () => `Synthetic-M0-08-${crypto.randomUUID()}`);
  const seed = new VaultSession({ read: () => repositoryA.readPasswordVault(), write: (bytes, revision) => repositoryA.savePasswordVault(bytes, revision) });
  await seed.initialize(); await seed.create(master);
  const ids: string[] = [];
  for (let index = 0; index < 3; index++) {
    const id = await seed.saveEntry({ title: `Synthetic private K${index + 1}`, username: `synthetic-${index}@example.test`,
      usernameAliases: [`alias-${index}@example.test`, `exact-alias-${index}`], password: passwords[index],
      url: `https://example.test/vault/${index}`, notes: `Synthetic encrypted note ${index}`, linkedAssetIds: [account.id] });
    await seed.saveEntry({ ...seed.readEntry(id), notes: `Synthetic established history ${index}` });
    ids.push(id);
  }
  seed.lock();
  const second = await connect();
  expect(second.db).not.toBe(db);
  const sideB = new NativeFileStore('native-vault-two-writers', second.store);
  const repositoryB = await openRepositoryFromBackend(sideB.records, sideB);
  const first = new VaultSession({ read: () => repositoryA.readPasswordVault(), write: (bytes, revision) => repositoryA.savePasswordVault(bytes, revision) });
  const stale = new VaultSession({ read: () => repositoryB.readPasswordVault(), write: (bytes, revision) => repositoryB.savePasswordVault(bytes, revision) });
  await Promise.all([first.initialize(), stale.initialize()]);
  await Promise.all([first.unlock(master), stale.unlock(master)]);
  const capture = (session: VaultSession) => ids.map(id => {
    const summary = session.getSnapshot().entries.find(entry => entry.id === id);
    if (!summary) throw Error('synthetic-vault-entry-missing');
    return { entry: session.readEntry(id), history: session.history(id), summary };
  });
  const readVault = async (repository: typeof repositoryA) => {
    const value = await repository.readPasswordVault();
    if (!value) throw Error('synthetic-vault-missing');
    return value;
  };
  const pointer = (connection: DatabaseSync) => {
    const value = connection.prepare('SELECT * FROM passwordVault').get();
    if (!value) throw Error('synthetic-vault-pointer-missing');
    return value;
  };
  // Compare every field/history without printing plaintext values in a failing diff.
  const exact = (actual: unknown, expected: unknown) => expect(JSON.stringify(actual) === JSON.stringify(expected)).toBe(true);
  const bytesEqual = (actual: Uint8Array, expected: Uint8Array) => expect(actual.length === expected.length && actual.every((value, index) => value === expected[index])).toBe(true);
  const base = capture(first);
  exact(capture(stale), base);
  expect(base.map(entry => entry.history.length)).toEqual([1, 1, 1]);
  const baseline = await repositoryA.readPasswordVault();
  if (!baseline) throw Error('synthetic-vault-missing');
  expect(first.getSnapshot().revision).toBe(baseline.revision);
  expect(stale.getSnapshot().revision).toBe(baseline.revision);
  const originalPointer = pointer(db);
  bytesEqual(await files.read(String(originalPointer.path)), baseline.bytes);
  db.exec(`CREATE TABLE synthetic_vault_pointer_writes(revision TEXT PRIMARY KEY);
    CREATE TRIGGER synthetic_count_vault_pointer AFTER UPDATE OF revision ON passwordVault BEGIN
      INSERT INTO synthetic_vault_pointer_writes(revision) VALUES(NEW.revision); END;`);
  const writeCount = (connection: DatabaseSync) => {
    const value = connection.prepare('SELECT count(*) AS n FROM synthetic_vault_pointer_writes').get();
    if (!value) throw Error('synthetic-write-count-missing');
    return Number(value.n);
  };
  const nextK1 = { ...base[0].entry, password: passwords[3], notes: 'Synthetic first writer committed K1' };
  const pendingK2 = { ...base[1].entry, password: passwords[4], notes: 'Synthetic second writer intended K2' };
  expect(await first.saveEntry(nextK1)).toBe(ids[0]);
  const afterFirst = capture(first);
  exact(afterFirst[0].entry, nextK1);
  exact(afterFirst[0].history, [...base[0].history, { at: base[0].summary.modifiedAt, draft: base[0].entry }]);
  exact(afterFirst.slice(1), base.slice(1));
  const committed = await repositoryA.readPasswordVault();
  if (!committed) throw Error('synthetic-vault-missing');
  expect(committed.revision).not.toBe(baseline.revision);
  expect(committed.bytes.some((value, index) => value !== baseline.bytes[index])).toBe(true);
  const committedPointer = pointer(db);
  const pathsAfterFirst = (await files.list()).sort();
  expect(writeCount(db)).toBe(1);
  const staleSnapshot = stale.getSnapshot();
  await expect(stale.saveEntry(pendingK2)).rejects.toThrow('vault-stale');
  expect(stale.getSnapshot()).toBe(staleSnapshot);
  exact(capture(stale), base);
  expect(db.prepare('SELECT * FROM passwordVault').get()).toEqual(committedPointer);
  bytesEqual((await readVault(repositoryB)).bytes, committed.bytes);
  bytesEqual(await files.read(String(committedPointer.path)), committed.bytes);
  bytesEqual(await files.read(String(originalPointer.path)), baseline.bytes);
  expect((await files.list()).sort()).toEqual(pathsAfterFirst);
  expect(writeCount(second.db)).toBe(1);
  first.lock(); stale.lock();
  await repositoryA.close(); opened.delete(store);
  await repositoryB.close(); opened.delete(second.store);

  const reopened = await connect();
  const reopenedSide = new NativeFileStore('native-vault-two-writers', reopened.store);
  const returned = await openRepositoryFromBackend(reopenedSide.records, reopenedSide);
  const retry = new VaultSession({ read: () => returned.readPasswordVault(), write: (bytes, revision) => returned.savePasswordVault(bytes, revision) });
  await retry.initialize();
  expect(retry.getSnapshot().status).toBe('locked');
  expect(retry.getSnapshot().revision).toBe(committed.revision);
  bytesEqual((await readVault(returned)).bytes, committed.bytes);
  await retry.unlock(master);
  exact(capture(retry), afterFirst);
  expect(writeCount(reopened.db)).toBe(1);
  expect(await retry.saveEntry(pendingK2)).toBe(ids[1]);
  const afterRetry = capture(retry);
  exact(afterRetry[0], afterFirst[0]);
  exact(afterRetry[1].entry, pendingK2);
  exact(afterRetry[1].history, [...base[1].history, { at: base[1].summary.modifiedAt, draft: base[1].entry }]);
  exact(afterRetry[2], base[2]);
  const retried = await returned.readPasswordVault();
  if (!retried) throw Error('synthetic-vault-missing');
  expect(retried.revision).not.toBe(committed.revision);
  expect(retried.bytes.some((value, index) => value !== committed.bytes[index])).toBe(true);
  expect(writeCount(reopened.db)).toBe(2);
  retry.lock();
  await returned.close(); opened.delete(reopened.store);

  const final = await connect();
  const finalSide = new NativeFileStore('native-vault-two-writers', final.store);
  const finalRepository = await openRepositoryFromBackend(finalSide.records, finalSide);
  const finalSession = new VaultSession({ read: () => finalRepository.readPasswordVault(), write: (bytes, revision) => finalRepository.savePasswordVault(bytes, revision) });
  await finalSession.initialize();
  bytesEqual((await readVault(finalRepository)).bytes, retried.bytes);
  await finalSession.unlock(master);
  exact(capture(finalSession), afterRetry);
  expect(finalSession.getSnapshot().revision).toBe(retried.revision);
  expect(writeCount(final.db)).toBe(2);
  exact(Object.fromEntries(['records', ...sideTableNames].map(table => [table, final.db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all()])), ordinaryRows);
  const sql = ['records', ...sideTableNames, 'passwordVault', 'synthetic_vault_pointer_writes'].map(table => JSON.stringify(final.db.prepare(`SELECT * FROM "${table}"`).all())).join('');
  const privateValues = [master, ...passwords, nextK1.notes, pendingK2.notes,
    ...base.flatMap(({ entry }) => [entry.title, entry.username, entry.url, entry.notes, ...(entry.usernameAliases ?? [])])];
  expect(privateValues.some(value => sql.includes(value))).toBe(false);
  finalSession.lock();
  await finalRepository.close(); opened.delete(final.store);
}, 30_000);

it('keeps application trash separate from internal rollback tombstones and reruns CAS modifiers', async () => {
  const { store } = await fixture();
  const backend = new NativeFileStore('native-test', store).records;
  const original = row('CAS original');
  await backend.insert(original);
  const before = (await backend.get(original.id))!;
  const tombstone = { ...original, payload: JSON.stringify({ ...JSON.parse(original.payload), deleted: true }) };
  expect((await backend.compareAndWrite([{ previous: before, next: tombstone }], 'trash')).error).toEqual([]);
  expect(await backend.list()).toHaveLength(1);
  expect((await backend.compareAndWrite([{ previous: before, next: original }], 'stale')).error[0].status).toBe(409);
  await backend.remove(original.id, (await backend.get(original.id))!.revision);
  expect(await backend.list()).toHaveLength(0);
  expect((await backend.get(original.id, true))?.internalDeleted).toBe(true);
  await backend.insert(original);
  let attempts = 0;
  await backend.modify(original.id, async current => {
    attempts++;
    if (attempts === 1) await backend.modify(original.id, latest => ({ ...latest, updatedAt: latest.updatedAt + 1 }));
    return { ...current, updatedAt: current.updatedAt + 1 };
  });
  expect(attempts).toBe(2);
  expect((await backend.get(original.id))?.updatedAt).toBe(original.updatedAt + 2);
});

it('externalizes nested ciphertext/binary and retains type, ID and original Blob metadata', async () => {
  const { store, db } = await fixture();
  const side = new NativeFileStore('native-test', store);
  const bytes = Uint8Array.of(1, 2, 3, 255);
  const journal = { id: 'native-review', rows: [], binary: bytes, nested: { bytes }, missing: undefined };
  await side.journal.put(journal);
  expect(await side.journal.get(journal.id)).toEqual(journal);
  const raw = db.prepare('SELECT payload FROM journal').get()?.payload as string;
  expect(raw).toContain('keepany-sqlite-value');
  expect(raw).not.toContain('"0":1');
  const blob = new Blob([bytes], { type: 'image/png' });
  await side.blobs.add({ id: 'original-id', name: 'source.png', blob });
  const restored = await side.blobs.get('original-id');
  expect(restored?.name).toBe('source.png');
  expect(new Uint8Array(await restored!.blob.arrayBuffer())).toEqual(bytes);
  expect(restored?.blob.type).toBe('image/png');
});

it('uses explicit transaction scopes, excludes concurrent root writes and retains durable intent after rollback', async () => {
  const { store } = await fixture();
  const side = new NativeFileStore('native-test', store);
  await side.syncMeta.put({ id: 'intent', cursor: 1 });
  let unblock!: () => void;
  const hold = new Promise<void>(resolve => { unblock = resolve; });
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const transaction = side.transaction('rw', side.syncMeta, async scope => {
    await scope.syncMeta.put({ id: 'intent', cursor: 2 });
    entered(); await hold;
    throw Error('synthetic-interruption');
  });
  await ready;
  let concurrentFinished = false;
  const concurrent = side.syncMeta.put({ id: 'unrelated', cursor: 3 }).then(() => { concurrentFinished = true; });
  await Promise.resolve();
  expect(concurrentFinished).toBe(false);
  unblock();
  await expect(transaction).rejects.toThrow('synthetic-interruption');
  await concurrent;
  expect(await side.syncMeta.get('intent')).toEqual({ id: 'intent', cursor: 1 });
  expect(await side.syncMeta.get('unrelated')).toEqual({ id: 'unrelated', cursor: 3 });
  let events = 0;
  const unsubscribe = store.subscribe(() => events++);
  await side.transaction('r', side.syncMeta, scope => scope.syncMeta.toArray());
  expect(events).toBe(0);
  unsubscribe();
});

it('rejects writes through nested read-only or expired scopes instead of acknowledging a later rolled-back write', async () => {
  const { store } = await fixture();
  const side = new NativeFileStore('native-test', store);
  let expired!: NativeFileStore;
  await side.transaction('rw', side.syncMeta, async outer => {
    expired = outer;
    await expect(outer.transaction('r', outer.syncMeta, scope => scope.syncMeta.put({ id: 'must-not-write', cursor: 1 }))).rejects.toThrow('native-read-only-transaction');
  });
  await expect(expired.syncMeta.put({ id: 'expired-write', cursor: 2 })).rejects.toThrow('native-transaction-expired');
  expect(await side.syncMeta.toArray()).toEqual([]);
});

it('rolls back a failed nested scope even if the outer operation catches its error', async () => {
  const { store } = await fixture();
  const side = new NativeFileStore('native-test', store);
  await side.transaction('rw', side.syncMeta, async outer => {
    await outer.syncMeta.put({ id: 'outer', cursor: 1 });
    await expect(outer.transaction('rw', outer.syncMeta, async inner => {
      await inner.syncMeta.put({ id: 'inner', cursor: 2 });
      throw Error('nested-failure');
    })).rejects.toThrow('nested-failure');
    await outer.syncMeta.put({ id: 'outer-after', cursor: 3 });
  });
  expect(await side.syncMeta.keys()).toEqual(['outer', 'outer-after']);
});

it('collects replaced and rolled-back immutable files while retaining active images and journal ciphertext', async () => {
  const { store, files } = await fixture();
  const side = new NativeFileStore('native-test', store);
  const value = { id: 'original', name: 'source.png', blob: new Blob([Uint8Array.of(1)], { type: 'image/png' }) };
  await side.blobs.put(value);
  await side.blobs.put({ ...value, blob: new Blob([Uint8Array.of(2)], { type: 'image/png' }) });
  const journal = { id: 'ciphertext', rows: [], binary: Uint8Array.of(3, 4) };
  await side.journal.put(journal);
  await expect(side.transaction('rw', side.blobs, async scope => {
    await scope.blobs.put({ ...value, blob: new Blob([Uint8Array.of(5)], { type: 'image/png' }) });
    throw Error('interrupted');
  })).rejects.toThrow('interrupted');
  expect(await files.list()).toHaveLength(4);
  expect(await store.collectFileGarbage()).toBe(2);
  expect(await files.list()).toHaveLength(2);
  expect(new Uint8Array(await (await side.blobs.get('original'))!.blob.arrayBuffer())).toEqual(Uint8Array.of(2));
  expect(await side.journal.get('ciphertext')).toEqual(journal);
  await side.blobs.delete('original');
  expect(await store.collectFileGarbage()).toBe(1);
  expect(await side.journal.get('ciphertext')).toEqual(journal);
});

it('runs the shared repository and encrypted KA1 archive across clean native databases with IDs, relationships, original images and KDBX intact', async () => {
  // No fake IndexedDB is installed: an accidental Web default would fail here.
  const { openRepositoryFromBackend, inspectArchive } = await import('../../local-db/src');
  const sourceFixture = await fixture();
  const side = new NativeFileStore('native-source', sourceFixture.store);
  const source = await openRepositoryFromBackend(side.records, side);
  const project = { ...newAsset('project'), name: 'Native project', title: 'Compatibility title' };
  const account = { ...newAsset('account'), name: 'Native account', username: 'native@example.test' };
  const subscription = { ...newAsset('subscription'), name: 'Native subscription', amount: 1200, currency: 'USD', dueDate: '2026-11-30' };
  const item = { ...newAsset('item'), name: 'Native item', purchaseDate: '2024-10-27' };
  const image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQqkAAAAASUVORK5CYII=', 'base64'));
  const imageId = await source.putFile(new File([image], 'original.png', { type: 'image/png' }));
  project.attachments = [imageId];
  await source.saveBatch([project, account, subscription, item].map(value => ({ type: 'asset', value })));
  const relationId = crypto.randomUUID();
  await source.save('relation', { id: relationId, from: project.id, to: account.id, label: 'login', createdAt: new Date().toISOString() });
  const taskId = crypto.randomUUID();
  await source.save('task', { id: taskId, assetId: project.id, name: 'Native task', dueDate: '2026-11-01', createdAt: new Date().toISOString() });
  await source.deleteEntity('asset', item.id);
  const vault = new VaultSession({ read: () => source.readPasswordVault(), write: (bytes, revision) => source.savePasswordVault(bytes, revision) });
  await vault.initialize(); await vault.create('Native-shared-master');
  const entryId = await vault.saveEntry({ title: 'Account login', username: account.username, password: 'Native-private-secret!', url: 'https://example.test', notes: '', linkedAssetIds: [account.id] });
  const rows = await source.allRecords();
  const archive = await source.exportArchive();
  const inspected = await inspectArchive(archive);
  expect(inspected.manifest.version).toBe(1);
  expect(inspected.manifest.passwordVault).toBeDefined();
  expect(inspected.rows).toEqual(rows);
  const encrypted = await encryptBackup(archive, 'Native-backup-master');
  vault.lock();
  const targetFixture = await fixture();
  const targetSide = new NativeFileStore('native-target', targetFixture.store);
  const target = await openRepositoryFromBackend(targetSide.records, targetSide);
  await target.restoreArchive(await decryptBackup(encrypted, 'Native-backup-master'));
  expect(await target.allRecords()).toEqual(rows);
  expect(await target.get('asset', item.id)).toMatchObject({ deleted: true });
  expect(new Uint8Array(await (await target.fileStore.blobs.get(imageId))!.blob.arrayBuffer())).toEqual(image);
  const restored = new VaultSession({ read: () => target.readPasswordVault(), write: (bytes, revision) => target.savePasswordVault(bytes, revision) });
  await restored.initialize(); await restored.unlock('Native-shared-master');
  expect(restored.readEntry(entryId).password).toBe('Native-private-secret!');
  expect(restored.readEntry(entryId).linkedAssetIds).toEqual([account.id]);
  restored.lock();
}, 30_000);

it('edits intake drafts and expense review through shared scoped transactions without waiting on its own root queue', async () => {
  const review = await import('../../local-db/src/intake-review');
  const { store } = await fixture();
  const side = new NativeFileStore('native-review', store);
  const digest = 'a'.repeat(64);
  const candidate: import('../../local-db/src/intake-review').ReviewedCandidate = {
    id: `csv-${digest}-2`, fileHash: digest, fileName: 'source.csv', rowNumber: 2,
    asset: { ...newAsset('project'), id: `csv-${digest.slice(0, 48)}-2`, name: 'Draft source' }, status: 'pending',
  };
  await review.stageReviewedCandidates(side, [candidate]);
  await review.editReviewedCandidate(side, candidate.id, { ...candidate.asset, name: 'Edited native draft' });
  expect((await side.intakeReview.get(candidate.id))?.asset.name).toBe('Edited native draft');
  const pdfHash = 'b'.repeat(64);
  const pdf: typeof candidate = { ...candidate, id: `pdf-${pdfHash}`, fileHash: pdfHash, fileName: 'invoice.pdf', rowNumber: 1, source: 'pdf', sourceText: 'Synthetic invoice USD 1.00', asset: { ...candidate.asset, id: `pdf-${pdfHash.slice(0, 48)}` } };
  await review.stageReviewedCandidates(side, [pdf]);
  const expense = { assetId: candidate.asset.id, title: 'Receipt', amount: '1.00', currency: 'USD' as const, eventDate: '2026-10-27', source: 'Synthetic source', note: '' };
  expect(await review.setReviewedCandidateMode(side, pdf.id, 'expense', expense)).toBe(true);
  expect(await review.editReviewedExpenseDraft(side, pdf.id, { ...expense, amount: '1.25' })).toBe(true);
  expect((await side.intakeReview.get(pdf.id))?.expenseDraft?.amount).toBe('1.25');
}, 5000);

it('restores into a verified new dataset, preserves the source after interruption, and can switch back without rewriting original IDs', async () => {
  const { NativeDatasetManager } = await import('./datasets');
  const { openRepositoryFromBackend } = await import('../../local-db/src');
  const control = await fixture();
  const slots = new Map<string, Awaited<ReturnType<typeof fixture>>>();
  const used = new Set<string>();
  let failCandidate = true;
  const factory = async (name: string) => {
    let slot = slots.get(name);
    if (!slot) { slot = await fixture(); slots.set(name, slot); }
    const current = used.has(name) ? (await slot.connect()).store : slot.store;
    used.add(name);
    slot.state.failWrite = failCandidate && name.startsWith('keepany-data-');
    const side = new NativeFileStore(name, current);
    return openRepositoryFromBackend(side.records, side);
  };
  const manager = await NativeDatasetManager.open(control.store.driver, factory, async name => slots.has(name));
  const original = await manager.openActive();
  const originalAsset = { ...newAsset('project'), name: 'Retained original' };
  await original.save('asset', originalAsset);
  const incoming = await factory('incoming-library');
  const imageId = await incoming.putFile(new File([Uint8Array.of(1, 2, 3)], 'source.png', { type: 'image/png' }));
  const incomingAsset = { ...newAsset('item'), name: 'Incoming original ID', attachments: [imageId] };
  await incoming.save('asset', incomingAsset);
  const archive = await incoming.exportArchive();
  await expect(original.restoreArchive(archive)).rejects.toThrow('synthetic-no-space');
  const first = await manager.list();
  const pendingName = first.find(row => row.phase === 'candidate')?.name;
  expect(pendingName).toBeDefined();
  expect(first.find(row => row.active)?.name).toBe('keepany-v1');
  expect(await original.get('asset', originalAsset.id)).toMatchObject({ name: originalAsset.name });
  failCandidate = false;
  expect(await original.restoreArchive(archive)).toBe(1);
  expect((await manager.list()).find(row => row.active)?.name).toBe(pendingName);
  expect((await manager.list()).filter(row => row.name.startsWith('keepany-data-'))).toHaveLength(1);
  const restored = await manager.openActive();
  expect(await restored.get('asset', incomingAsset.id)).toMatchObject({ id: incomingAsset.id, attachments: [imageId] });
  expect(await restored.get('asset', originalAsset.id)).toBeNull();
  await restored.close();
  await original.close();
  await manager.switchTo('keepany-v1');
  const returned = await manager.openActive();
  expect(await returned.get('asset', originalAsset.id)).toMatchObject({ id: originalAsset.id, name: originalAsset.name });
  expect(await returned.get('asset', incomingAsset.id)).toBeNull();
  await returned.close();
  slots.delete('keepany-v1');
  await expect(manager.openActive()).rejects.toThrow('native-dataset-missing');
}, 10_000);

// The version comes from an actual random disk database, not a mocked PRAGMA.
// The adapter delegates all SQL to Node SQLite; this does not test Capacitor or
// Android/iOS connection setup. Keep the entire logical schema and file set.
function futureSchemaDriver(path: string, trace: string[] = []) {
  const database = new DatabaseSync(path);
  let closed = false;
  const driver: SqlDriver = {
    uri: pathToFileURL(path).href,
    async execute(sql) { trace.push('execute'); database.exec(sql); },
    async query<T extends SqlRow>(sql: string, values = []) { trace.push(sql === 'PRAGMA user_version' ? 'version' : 'query'); return database.prepare(sql).all(...values) as T[]; },
    async run(sql, values = []) { trace.push('run'); return Number(database.prepare(sql).run(...values).changes); },
    async close() { trace.push('close'); database.close(); closed = true; },
  };
  return { database, driver, isClosed: () => closed };
}
function futureSchemaSnapshot(database: DatabaseSync) {
  const schema = database.prepare('SELECT name,type,tbl_name,sql FROM sqlite_master ORDER BY name').all();
  return {
    version: database.prepare('PRAGMA user_version').get(),
    schema,
    tables: Object.fromEntries(schema.filter(item => item.type === 'table').map(item => {
      const name = String(item.name);
      return [name, database.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()];
    })),
  };
}
async function futureSchemaFileHashes(files: PersistentFiles) {
  const result: Array<{ path: string; size: number; sha256: string }> = [];
  for (const path of (await files.list()).sort()) {
    const bytes = await files.read(path);
    result.push({ path, size: bytes.length, sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), value => value.toString(16).padStart(2, '0')).join('') });
  }
  return result;
}

it('M0-03/X-07 refuses a future on-disk data schema through openActive without changing rows, original files, control pointer or creating fallback storage', async () => {
  const { fileURLToPath } = await import('node:url');
  const { NativeDatasetManager } = await import('./datasets');
  const { openRepositoryFromBackend } = await import('../../local-db/src');
  const { store, db, files } = await fixture();
  const path = fileURLToPath(store.driver.uri), root = dirname(path);
  // Reuse the existing local-db synthetic image fixture; no real user input.
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGdEAAAAASUVORK5CYII=', 'base64'));
  const imageId = await store.putFile(png, 'future-schema-original.png', 'image/png');
  const asset = { ...newAsset('item'), name: 'Synthetic future-schema item', title: 'Preserved legacy title',
    attachments: [imageId], itemMedia: { coverId: imageId, detailIds: [], receiptIds: [] } };
  const original: NativeRecord = { id: `asset:${asset.id}`, type: 'asset', payload: JSON.stringify(asset), updatedAt: Date.now() };
  await store.saveRecords([{ next: original, expected: null }]);
  await store.saveSideRow('intakeReview', { id: 'future-schema-review', originalText: 'Synthetic review remains unchanged' } as { id: string });
  const vault = new VaultSession(store.vaultPersistence());
  await vault.initialize(); await vault.create('Synthetic-future-schema-master'); vault.lock();
  const pointers = db.prepare('SELECT * FROM passwordVault').all();
  expect(pointers).toHaveLength(1);
  expect(await futureSchemaFileHashes(files)).toHaveLength(2);

  const control = futureSchemaDriver(join(root, 'control.sqlite'));
  const name = `keepany-data-${crypto.randomUUID()}`, requests: string[] = [], trace: string[] = [];
  let attempted: ReturnType<typeof futureSchemaDriver> | undefined;
  let unexpectedlyOpened: NativeStore | undefined;
  try {
    const manager = await NativeDatasetManager.open(control.driver, async requested => {
      requests.push(requested);
      if (requested !== name) throw Error('synthetic-unexpected-dataset');
      attempted = futureSchemaDriver(path, trace);
      unexpectedlyOpened = await NativeStore.open(attempted.driver, files);
      opened.add(unexpectedlyOpened);
      const side = new NativeFileStore(requested, unexpectedlyOpened);
      return openRepositoryFromBackend(side.records, side);
    }, async requested => requested === name);
    // Fixture construction only: emulate a future release already owning this
    // pointer. Runtime actions below use the actual manager/store entry points.
    control.database.prepare("INSERT INTO local_datasets(name,created_at,phase) VALUES(?,?,'active')").run(name, new Date().toISOString());
    control.database.prepare("UPDATE local_datasets SET phase='retained' WHERE name='keepany-v1'").run();
    control.database.prepare('UPDATE active_dataset SET name=?,initialized=1 WHERE id=1').run(name);
    db.exec("CREATE TABLE future_schema_canary(id TEXT PRIMARY KEY, title TEXT NOT NULL); INSERT INTO future_schema_canary VALUES('future-one','Synthetic future canary'); PRAGMA user_version=77;");
    const beforeData = futureSchemaSnapshot(db), beforeControl = futureSchemaSnapshot(control.database);
    const beforeFiles = await futureSchemaFileHashes(files);
    await store.close(); opened.delete(store);
    const beforeDataBytes = await readFile(path), beforeControlBytes = await readFile(join(root, 'control.sqlite'));
    const beforeNames = (await readdir(root)).sort();

    await expect(manager.openActive()).rejects.toThrow('native-schema-newer');
    expect(requests).toEqual([name]);
    expect(trace).toEqual(['version', 'close']);
    expect(attempted?.isClosed()).toBe(true);
    expect(await readFile(path)).toEqual(beforeDataBytes);
    expect(await readFile(join(root, 'control.sqlite'))).toEqual(beforeControlBytes);
    expect((await readdir(root)).sort()).toEqual(beforeNames);
    expect(await futureSchemaFileHashes(files)).toEqual(beforeFiles);
    const reopened = new DatabaseSync(path, { readOnly: true });
    try {
      expect(futureSchemaSnapshot(reopened)).toEqual(beforeData);
      expect(reopened.prepare('PRAGMA user_version').get()).toEqual({ user_version: 77 });
      expect(reopened.prepare('SELECT payload FROM records WHERE id=?').get(original.id)?.payload).toBe(original.payload);
      expect(reopened.prepare('SELECT * FROM passwordVault').all()).toEqual(pointers);
    } finally { reopened.close(); }
    expect(futureSchemaSnapshot(control.database)).toEqual(beforeControl);
    expect((await manager.list()).find(dataset => dataset.active)?.name).toBe(name);
  } finally {
    vault.lock();
    if (unexpectedlyOpened) { await unexpectedlyOpened.close(); opened.delete(unexpectedlyOpened); }
    if (attempted && !attempted.isClosed()) await attempted.driver.close();
    await control.driver.close();
  }
}, 20_000);

it('M0-03/X-07 refuses a future on-disk control schema before any write or factory call and preserves its complete active metadata', async () => {
  const { NativeDatasetManager } = await import('./datasets');
  const root = await mkdtemp(join(tmpdir(), 'keepany-future-control-')); roots.push(root);
  const path = join(root, 'control.sqlite'), trace: string[] = [];
  const control = futureSchemaDriver(path, trace);
  let factoryCalls = 0, existsCalls = 0;
  const factory = async () => { factoryCalls++; throw Error('synthetic-unexpected-factory'); };
  const exists = async () => { existsCalls++; return true; };
  try {
    await NativeDatasetManager.open(control.driver, factory, exists);
    const name = `keepany-data-${crypto.randomUUID()}`;
    control.database.prepare("INSERT INTO local_datasets(name,created_at,phase) VALUES(?,?,'active')").run(name, new Date().toISOString());
    control.database.prepare("UPDATE local_datasets SET phase='retained' WHERE name='keepany-v1'").run();
    control.database.prepare('UPDATE active_dataset SET name=?,initialized=1 WHERE id=1').run(name);
    control.database.prepare('INSERT INTO native_restores(id,database_name,previous_name,archive_hash,fingerprint,phase) VALUES(?,?,?,?,?,?)')
      .run(crypto.randomUUID(), `keepany-data-${crypto.randomUUID()}`, name, 'a'.repeat(64), 'b'.repeat(64), 'prepared');
    control.database.exec("CREATE TABLE future_control_canary(id TEXT PRIMARY KEY, title TEXT NOT NULL); INSERT INTO future_control_canary VALUES('future-one','Synthetic future control title'); PRAGMA user_version=77;");
    const before = futureSchemaSnapshot(control.database), beforeBytes = await readFile(path), beforeNames = (await readdir(root)).sort();
    trace.length = 0;
    await expect(NativeDatasetManager.open(control.driver, factory, exists)).rejects.toThrow('native-schema-newer');
    expect(trace).toEqual(['version', 'close']);
    expect(control.isClosed()).toBe(true);
    expect(factoryCalls).toBe(0); expect(existsCalls).toBe(0);
    expect(await readFile(path)).toEqual(beforeBytes);
    expect((await readdir(root)).sort()).toEqual(beforeNames);
    const reopened = new DatabaseSync(path, { readOnly: true });
    try { expect(futureSchemaSnapshot(reopened)).toEqual(before); expect(reopened.prepare('PRAGMA user_version').get()).toEqual({ user_version: 77 }); }
    finally { reopened.close(); }
  } finally { if (!control.isClosed()) await control.driver.close(); }
});

it.each([0, 1])('opens supported control schema %i without changing its version or existing complete metadata', async version => {
  const { NativeDatasetManager } = await import('./datasets');
  const root = await mkdtemp(join(tmpdir(), 'keepany-known-control-')); roots.push(root);
  const path = join(root, 'control.sqlite'), control = futureSchemaDriver(path);
  let factoryCalls = 0, existsCalls = 0;
  const factory = async () => { factoryCalls++; throw Error('synthetic-unexpected-factory'); };
  const exists = async () => { existsCalls++; return true; };
  try {
    control.database.exec(`PRAGMA user_version=${version}`);
    await NativeDatasetManager.open(control.driver, factory, exists);
    const name = `keepany-data-${crypto.randomUUID()}`;
    control.database.prepare("INSERT INTO local_datasets(name,created_at,phase) VALUES(?,?,'active')").run(name, new Date().toISOString());
    control.database.prepare("UPDATE local_datasets SET phase='retained' WHERE name='keepany-v1'").run();
    control.database.prepare('UPDATE active_dataset SET name=?,initialized=1 WHERE id=1').run(name);
    control.database.prepare('INSERT INTO native_restores(id,database_name,previous_name,archive_hash,fingerprint,phase) VALUES(?,?,?,?,?,?)')
      .run(crypto.randomUUID(), `keepany-data-${crypto.randomUUID()}`, name, 'a'.repeat(64), 'b'.repeat(64), 'prepared');
    const before = futureSchemaSnapshot(control.database), beforeBytes = await readFile(path);
    const manager = await NativeDatasetManager.open(control.driver, factory, exists);
    expect(futureSchemaSnapshot(control.database)).toEqual(before);
    expect(control.database.prepare('PRAGMA user_version').get()).toEqual({ user_version: version });
    expect(await readFile(path)).toEqual(beforeBytes);
    expect((await manager.list()).find(dataset => dataset.active)?.name).toBe(name);
    expect(factoryCalls).toBe(0); expect(existsCalls).toBe(0);
  } finally { await control.driver.close(); }
});

it('preserves an actual SQLite control PRAGMA read error while attempting only its owned connection close', async () => {
  const { NativeDatasetManager } = await import('./datasets');
  const root = await mkdtemp(join(tmpdir(), 'keepany-control-query-failure-')); roots.push(root);
  const trace: string[] = [], control = futureSchemaDriver(join(root, 'control.sqlite'), trace);
  // A genuine closed SQLite handle makes PRAGMA fail, then close also fails.
  // This is a C lifecycle error case, not an Android/iOS I/O fault injection.
  control.database.close();
  let firstReadError: unknown, returnedError: unknown, factoryCalls = 0, existsCalls = 0;
  const failed: SqlDriver = { ...control.driver,
    async query<T extends SqlRow>(sql: string, values = []) {
      try { return await control.driver.query<T>(sql, values); }
      catch (error) { firstReadError = error; throw error; }
    } };
  try {
    await NativeDatasetManager.open(failed, async () => { factoryCalls++; throw Error('synthetic-unexpected-factory'); }, async () => { existsCalls++; return true; });
  } catch (error) { returnedError = error; }
  expect(firstReadError).toBeInstanceOf(Error);
  expect(returnedError === firstReadError).toBe(true);
  expect(trace).toEqual(['version', 'close']);
  expect(factoryCalls).toBe(0); expect(existsCalls).toBe(0);
});
