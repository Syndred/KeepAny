import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { newAsset } from '../../domain/src';
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
