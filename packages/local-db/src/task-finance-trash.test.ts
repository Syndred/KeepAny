import 'fake-indexeddb/auto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { effectiveFinanceEntry, historySchema, newAsset, taskSchema, type History, type Task } from '../../domain/src';
import { NativeStore } from '../../local-db-native/src/store';
import { NativeFileStore } from '../../local-db-native/src/repository-storage';
import type { SqlDriver, SqlRow } from '../../local-db-native/src/driver';
import type { PersistentFiles } from '../../platform-native/src';
import { decryptBackup, encryptBackup } from './backup-crypto';
import { LocalRepository, openLocalRepository, openRepositoryFromBackend } from './index';

async function open(kind: 'web' | 'sqlite') {
  if (kind === 'web') {
    const repository = await openLocalRepository(`task-trash-${crypto.randomUUID().slice(0, 10)}`);
    return { repository, close: () => repository.close(), failRecordWrite() { const spy = vi.spyOn(repository.records, 'modify').mockRejectedValueOnce(Error('synthetic-storage-full')); return () => spy.mockRestore(); } };
  }
  const root = await mkdtemp(join(tmpdir(), 'keepany-task-trash-'));
  const sql = new DatabaseSync(join(root, 'native.db'));
  let failRecordWrite = false;
  const files: PersistentFiles = {
    async rootUri() { return pathToFileURL(root).href; },
    async write(path, bytes) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); },
    async read(path) { return new Uint8Array(await readFile(join(root, path))); },
    async remove(path) { await rm(join(root, path)); },
    async list() { const paths: string[] = []; for (const folder of ['files', 'vaults', 'recovery']) for (const name of await readdir(join(root, folder)).catch(() => [])) paths.push(`${folder}/${name}`); return paths; },
  };
  const driver: SqlDriver = {
    uri: pathToFileURL(join(root, 'native.db')).href,
    async execute(statement) { sql.exec(statement); },
    async query<T extends SqlRow>(statement: string, values = []) { return sql.prepare(statement).all(...values) as T[]; },
    async run(statement, values = []) {
      if (failRecordWrite && statement.startsWith('INSERT INTO records(')) { failRecordWrite = false; throw Error('synthetic-storage-full'); }
      return Number(sql.prepare(statement).run(...values).changes);
    },
    async close() { sql.close(); },
  };
  const store = await NativeStore.open(driver, files), side = new NativeFileStore(`task-trash-${crypto.randomUUID().slice(0, 10)}`, store);
  const repository = await openRepositoryFromBackend(side.records, side);
  return { repository, failRecordWrite() { failRecordWrite = true; return () => { failRecordWrite = false; }; }, async close() {
    await repository.close();
    if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}keepany-task-trash-`)) throw Error('unsafe-test-cleanup');
    await rm(root, { recursive: true });
  } };
}
const task = (assetId = '') => taskSchema.parse({ id: crypto.randomUUID(), assetId, name: 'Original task', dueDate: '2026-10-27', createdAt: '2026-10-20T00:00:00Z', completionHistory: ['2026-10-21T00:00:00Z'], dedupeKey: `manual:${assetId}:fixed:2026-10-27` });
const bill = (assetId: string, assetIds = [assetId]) => historySchema.parse({ id: crypto.randomUUID(), assetId, assetIds, action: 'expense', title: 'Original shared invoice', source: 'Synthetic statement', note: 'Exact local evidence', amount: 1234, currency: 'USD', eventDate: '2026-10-27', createdAt: '2026-10-27T00:00:00Z' });
async function renewal(repository: LocalRepository) {
  const asset = { ...newAsset('subscription'), dueDate: '2026-10-27', billingAnchor: '2026-10-27', amount: 1200, currency: 'USD' as const };
  await repository.save('asset', asset);
  const fact = historySchema.parse({ id: crypto.randomUUID(), assetId: asset.id, action: 'renew', billDate: '2026-10-27', amount: 1200, currency: 'USD', note: 'Original renewal fact', createdAt: '2026-10-27T00:00:00Z' });
  const current = { ...asset, dueDate: '2026-11-27', renewalCount: 1, lastRenewalId: fact.id, updatedAt: '2026-10-27T00:00:01Z' };
  await repository.recordRenewal(asset, current, fact);
  const hidden = historySchema.parse({ ...fact, financeCorrection: { title: 'Hidden ledger correction', source: 'Correction statement', note: 'Correction private evidence', amount: 1100, currency: 'USD', eventDate: '2026-10-26', hidden: true } });
  await repository.saveFinanceEntryIfCurrent(fact, hidden);
  return { fact, current, hidden };
}

for (const kind of ['web', 'sqlite'] as const) describe(`${kind} ordinary task and ledger trash contract`, () => {
  it('validates selected targets atomically, permits no target and retains all immutable task fields', async () => {
    const context = await open(kind), db = context.repository;
    try {
      const first = newAsset('project'), second = newAsset('account'); await db.saveBatch([first, second].map(value => ({ type: 'asset', value })));
      const initial = task(first.id); await db.saveManualTaskIfCurrent(null, initial);
      const edited = { ...initial, name: 'Edited task', assetId: second.id, dedupeKey: `manual:${second.id}:edited:2026-10-27` };
      await db.saveTaskIfCurrent(initial, edited); expect(await db.get('task', initial.id)).toEqual(edited);
      expect(edited.completionHistory).toEqual(initial.completionHistory); expect(edited.createdAt).toBe(initial.createdAt);
      for (const target of ['missing', first.id]) {
        if (target === first.id) await db.deleteEntity('asset', first.id);
        await expect(db.saveManualTaskIfCurrent(null, { ...task(target), dedupeKey: crypto.randomUUID() })).rejects.toThrow('task-target-changed');
      }
      const unlinked = task(); await db.saveManualTaskIfCurrent(null, unlinked); expect(await db.get('task', unlinked.id)).toEqual(unlinked);
      expect(await db.list('task')).toHaveLength(2);
    } finally { await context.close(); }
  });
  it('rejects stale task deletion and preserves identity, completion history and target through restore', async () => {
    const context = await open(kind), db = context.repository;
    try {
      const asset = newAsset('item'); await db.save('asset', asset);
      const initial = task(asset.id); await db.saveManualTaskIfCurrent(null, initial);
      const other = new LocalRepository(db.records, db.fileStore), changed = { ...initial, name: 'Other view wins' };
      await other.saveTaskIfCurrent(initial, changed);
      await expect(db.deleteTaskIfCurrent(initial)).rejects.toThrow('task-stale'); expect(await db.get('task', initial.id)).toEqual(changed);
      await db.deleteTaskIfCurrent(changed); const deleted = { ...changed, deleted: true };
      expect(await db.get('task', initial.id)).toEqual(deleted);
      await db.restoreTaskIfCurrent(deleted); expect(await db.get('task', initial.id)).toEqual(changed); expect(await db.get('asset', asset.id)).toEqual(asset);
      await expect(other.restoreTaskIfCurrent(deleted)).rejects.toThrow('task-stale');
    } finally { await context.close(); }
  });
  it('blocks duplicate pending task restore and unavailable targets until the original asset is restored', async () => {
    const context = await open(kind), db = context.repository;
    try {
      const asset = newAsset('project'); await db.save('asset', asset);
      const original = task(asset.id); await db.saveManualTaskIfCurrent(null, original); await db.deleteTaskIfCurrent(original);
      const competing = { ...original, id: crypto.randomUUID() }; await db.saveManualTaskIfCurrent(null, competing);
      await expect(db.restoreTaskIfCurrent({ ...original, deleted: true })).rejects.toThrow('task-duplicate');
      await db.deleteTaskIfCurrent(competing); await db.deleteEntity('asset', asset.id);
      await expect(db.restoreTaskIfCurrent({ ...original, deleted: true })).rejects.toThrow('task-target-changed');
      await db.restoreEntity('asset', asset.id); await db.restoreTaskIfCurrent({ ...original, deleted: true });
      expect(await db.get('task', original.id)).toEqual(original);
    } finally { await context.close(); }
  });
  it('purges only the selected ordinary task and keeps other tasks, assets and bills untouched', async () => {
    const context = await open(kind), db = context.repository;
    try {
      const asset = newAsset('account'); await db.save('asset', asset);
      const first = task(asset.id), second = { ...task(asset.id), dedupeKey: 'other-task' }, entry = bill(asset.id);
      await db.saveManualTaskIfCurrent(null, first); await db.saveManualTaskIfCurrent(null, second); await db.createFinanceEntry(entry);
      await db.deleteTaskIfCurrent(first); const plan = await db.previewTrashPurge([{ type: 'task', id: first.id }]);
      expect(plan.rows.map(row => row.id)).toEqual([`task:${first.id}`]); await db.purgeTrash(plan); await db.purgeTrash(plan);
      const erased = await db.get<Task>('task', first.id); expect(erased).toMatchObject({ purged: true, deleted: true, name: '—', completionHistory: [] });
      expect(await db.get('task', second.id)).toEqual(second); expect(await db.get('asset', asset.id)).toEqual(asset); expect(await db.get('history', entry.id)).toEqual(entry);
      await expect(db.restoreTaskIfCurrent(erased as Task)).rejects.toThrow('task-stale');
    } finally { await context.close(); }
  });
  it('restores one manual bill with original owners and refuses stale or unavailable-owner restoration', async () => {
    const context = await open(kind), db = context.repository;
    try {
      const first = newAsset('project'), second = newAsset('item'); await db.saveBatch([first, second].map(value => ({ type: 'asset', value })));
      const entry = bill(first.id, [first.id, second.id]); await db.createFinanceEntry(entry); const deleted = { ...entry, deleted: true };
      await db.saveFinanceEntryIfCurrent(entry, deleted); await db.deleteEntity('asset', second.id);
      await expect(db.restoreFinanceEntryIfCurrent(deleted)).rejects.toThrow('finance-target-changed'); expect(await db.get('history', entry.id)).toEqual(deleted);
      await db.restoreEntity('asset', second.id); await db.restoreFinanceEntryIfCurrent(deleted);
      expect(await db.get('history', entry.id)).toEqual(entry); await expect(db.restoreFinanceEntryIfCurrent(deleted)).rejects.toThrow('history-stale');
      const plan = await db.previewTrashPurge([{ type: 'history', id: entry.id }]).catch(() => null); expect(plan).toBeNull();
    } finally { await context.close(); }
  });
  it('restores hidden renewal display without replaying or changing its original fact and subscription schedule', async () => {
    const context = await open(kind), db = context.repository;
    try {
      const { fact, hidden, current } = await renewal(db); await db.restoreFinanceEntryIfCurrent(hidden);
      const visible = await db.get<History>('history', fact.id);
      expect(visible).toEqual({ ...hidden, financeCorrection: { ...hidden.financeCorrection, hidden: false } });
      expect(await db.get('asset', current.id)).toEqual(current); expect((await db.list<History>('history')).filter(row => row.action === 'renew')).toHaveLength(1);
      await expect(db.restoreFinanceEntryIfCurrent({ ...fact, deleted: true })).rejects.toThrow('history-stale');
    } finally { await context.close(); }
  });
  it('permanently removes only a hidden renewal projection, keeps the fact, blocks old writes and retains marker through encrypted KA1', async () => {
    const context = await open(kind), target = await open(kind), db = context.repository;
    try {
      const { fact, hidden, current } = await renewal(db), owner = newAsset('project'); await db.save('asset', owner);
      const otherBill = bill(owner.id); await db.createFinanceEntry(otherBill);
      const plan = await db.previewTrashPurge([{ type: 'history', id: hidden.id }]); expect(plan.rows.map(row => row.id)).toEqual([`history:${hidden.id}`]);
      await db.purgeTrash(plan); await db.purgeTrash(plan);
      const erased = await db.get<History>('history', fact.id); if (!erased) throw Error('missing-fact');
      const { financeCorrection: ignored, ...preserved } = erased; expect(preserved).toEqual(fact);
      expect(erased.financeCorrection).toMatchObject({ purged: true, hidden: true, title: '—', source: '', note: '' }); expect(effectiveFinanceEntry(erased).deleted).toBe(true);
      expect(await db.get('asset', current.id)).toEqual(current); expect(await db.get('history', otherBill.id)).toEqual(otherBill);
      await expect(db.restoreFinanceEntryIfCurrent(erased)).rejects.toThrow('history-stale');
      await expect(db.saveFinanceEntryIfCurrent(erased, hidden)).rejects.toThrow('history-stale'); await expect(db.save('history', hidden)).rejects.toThrow('trash-purged');
      const marker = (await db.allRecords()).find(row => row.id === `history:${fact.id}`); if (!marker) throw Error('missing-marker');
      await expect(db.applyIncoming('history', hidden, marker.payload)).resolves.toBe('conflict');
      await expect(db.applyIncoming('history', erased, marker.payload)).resolves.toBe('duplicate');
      const archive = await encryptBackup(await db.exportArchive(), 'Synthetic-projection-backup');
      await target.repository.restoreArchive(await decryptBackup(archive, 'Synthetic-projection-backup'));
      expect(await target.repository.get('history', fact.id)).toEqual(erased); expect(await target.repository.get('asset', current.id)).toEqual(current);
    } finally { await context.close(); await target.close(); }
  });
  it('preserves genuinely older correction objects without injecting the optional marker', async () => {
    const context = await open(kind), target = await open(kind), db = context.repository;
    try {
      const { hidden } = await renewal(db); expect(Object.hasOwn(hidden.financeCorrection ?? {}, 'purged')).toBe(false);
      await target.repository.restoreArchive(await db.exportArchive());
      const restored = await target.repository.get<History>('history', hidden.id); expect(restored).toEqual(hidden); expect(Object.hasOwn(restored?.financeCorrection ?? {}, 'purged')).toBe(false);
      await target.repository.restoreFinanceEntryIfCurrent(restored as History); expect(effectiveFinanceEntry(await target.repository.get<History>('history', hidden.id) as History).deleted).toBe(false);
      expect(historySchema.safeParse({ ...hidden, financeCorrection: { ...hidden.financeCorrection, hidden: false, purged: true } }).success).toBe(false);
    } finally { await context.close(); await target.close(); }
  });
  for (const acknowledgedAfterPurge of [false, true]) it(`protects a ${acknowledgedAfterPurge ? 'clean acknowledged' : 'dirty'} projection marker through scoped pull, conflict resolution and idempotent push`, async () => {
    const context = await open(kind), db = context.repository;
    try {
      const { hidden } = await renewal(db);
      const endpoint = 'https://sync.example.test', accountId = 'synthetic-trash-scope', workspaceId = crypto.randomUUID();
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([endpoint, accountId]))));
      const scope = `${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}:${workspaceId}`;
      await db.claimDatasetBinding({ endpoint, accountId, workspaceId, scope });
      const projection = [{ type: 'history' as const, id: hidden.id }];
      if (acknowledgedAfterPurge) await db.purgeTrash(await db.previewTrashPurge(projection));
      const baseline = (await db.allRecords()).find(row => row.id === `history:${hidden.id}`); if (!baseline) throw Error('missing-baseline');
      const operationId = crypto.randomUUID();
      await db.stageScopedOutbox(scope, baseline, { operationId, id: baseline.id, kind: 'history', schemaVersion: 1, expectedVersion: 0, ciphertext: 'synthetic-initial', tombstone: false, intent: 'write' });
      await db.acknowledgeScopedOutbox(scope, operationId, 1, 1);
      await expect(db.applyScopedPull(scope, { row: baseline, sequence: 1, version: 1, operationId, keyEpoch: 1, ciphertext: 'synthetic-initial' })).resolves.toBe('applied');
      if (!acknowledgedAfterPurge) await db.purgeTrash(await db.previewTrashPurge(projection));
      const marker = await db.get<History>('history', hidden.id);
      const oldPeer = { ...baseline, payload: JSON.stringify({ ...hidden, financeCorrection: { ...hidden.financeCorrection, hidden: false } }) };
      await expect(db.applyScopedPull(scope, { row: oldPeer, sequence: 2, version: 2, operationId: crypto.randomUUID(), keyEpoch: 1, ciphertext: 'synthetic-old-peer' })).resolves.toBe('conflict');
      expect(await db.scopedConflict(scope)).not.toBeNull(); await expect(db.resolveScopedConflict(scope, 'remote')).rejects.toThrow('trash-purged');
      expect(await db.get('history', hidden.id)).toEqual(marker); await db.resolveScopedConflict(scope, 'local'); expect(await db.scopedConflict(scope)).toBeNull();
      expect(await db.get('history', hidden.id)).toEqual(marker);
      const row = (await db.allRecords()).find(row => row.id === baseline.id); if (!row) throw Error('missing-marker');
      const nextOperation = { operationId: crypto.randomUUID(), id: row.id, kind: 'history' as const, schemaVersion: 1 as const, expectedVersion: 2, ciphertext: 'synthetic-marker-retry', tombstone: false, intent: 'write' as const };
      const first = await db.stageScopedOutbox(scope, row, nextOperation), retry = await db.stageScopedOutbox(scope, row, nextOperation); expect(retry).toEqual(first);
      await db.acknowledgeScopedOutbox(scope, nextOperation.operationId, 3, 1);
      await expect(db.applyScopedPull(scope, { row, sequence: 3, version: 3, operationId: nextOperation.operationId, keyEpoch: 1, ciphertext: nextOperation.ciphertext })).resolves.toBe('applied');
      expect(await db.get('history', hidden.id)).toEqual(marker); expect((await db.dirtyScopedRows(scope)).some(value => value.id === row.id)).toBe(false);
    } finally { await context.close(); }
  });
  it('retains the original asset-purge cascade even when a hidden projection is also selected', async () => {
    const context = await open(kind), db = context.repository;
    try {
      const { hidden, current } = await renewal(db); await db.deleteEntity('asset', current.id);
      const plan = await db.previewTrashPurge([{ type: 'asset', id: current.id }, { type: 'history', id: hidden.id }]); await db.purgeTrash(plan);
      const erased = await db.get<History>('history', hidden.id); expect(erased).toMatchObject({ action: 'maintenance', purged: true, deleted: true, note: '' }); expect(erased?.financeCorrection).toBeUndefined();
      expect((await db.get('asset', current.id)) as { purged: boolean }).toMatchObject({ purged: true });
    } finally { await context.close(); }
  });
  it('rejects purging unrelated event histories and preserves a failed restore for a clean retry', async () => {
    const context = await open(kind), db = context.repository;
    try {
      const asset = newAsset('item'); await db.save('asset', asset);
      const event = historySchema.parse({ id: crypto.randomUUID(), assetId: asset.id, action: 'maintenance', note: 'Keep factual history', createdAt: '2026-10-27T00:00:00Z', deleted: true }); await db.save('history', event);
      await expect(db.previewTrashPurge([{ type: 'history', id: event.id }])).rejects.toThrow('trash-invalid');
      const original = task(asset.id); await db.saveManualTaskIfCurrent(null, original); await db.deleteTaskIfCurrent(original);
      const clearFault = context.failRecordWrite();
      await expect(db.restoreTaskIfCurrent({ ...original, deleted: true })).rejects.toThrow('synthetic-storage-full'); clearFault();
      expect(await db.get('task', original.id)).toEqual({ ...original, deleted: true }); await db.restoreTaskIfCurrent({ ...original, deleted: true }); expect(await db.get('task', original.id)).toEqual(original);
    } finally { await context.close(); }
  });
});
