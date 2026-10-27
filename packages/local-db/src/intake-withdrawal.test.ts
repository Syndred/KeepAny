import 'fake-indexeddb/auto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { newAsset, type Asset, type History } from '../../domain/src';
import { NativeStore } from '../../local-db-native/src/store';
import { NativeFileStore } from '../../local-db-native/src/repository-storage';
import type { SqlDriver, SqlRow } from '../../local-db-native/src/driver';
import type { PersistentFiles } from '../../platform-native/src';
import { decryptBackup, encryptBackup } from './backup-crypto';
import { openLocalRepository, openRepositoryFromBackend } from './index';
import { decideReviewedCandidate, getReviewedCandidate, setReviewedCandidateMode, stageReviewedCandidates, reviewedCandidateExpenseHistoryId, type ReviewedCandidate } from './intake-review';
import { confirmReviewedAssetMerge } from './intake-asset-merge';
async function open(kind: 'web' | 'sqlite') {
  if (kind === 'web') {
    const repository = await openLocalRepository(`task-trash-${crypto.randomUUID().slice(0, 10)}`);
    return { repository, failReceiptWrite() { const original = repository.fileStore.intakeReview.put.bind(repository.fileStore.intakeReview); const spy = vi.spyOn(repository.fileStore.intakeReview, 'put').mockImplementation((value, key) => value.status === 'withdrawn' ? Promise.reject(Error('synthetic-receipt-failure')) : original(value, key)); return () => spy.mockRestore(); }, async reopen() { await repository.close(); return openLocalRepository(repository.records.name); }, close: () => repository.close(), failRecordWrite() { const spy = vi.spyOn(repository.records, 'compareAndWrite').mockRejectedValueOnce(Error('synthetic-storage-full')); return () => spy.mockRestore(); } };
  }
  const root = await mkdtemp(join(tmpdir(), 'keepany-task-trash-'));
  let sql = new DatabaseSync(join(root, 'native.db'));
  let failRecordWrite = false, failReceiptWrite = false;
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
      if (failReceiptWrite && statement.startsWith('INSERT INTO "intakeReview"') && values[5] === 'withdrawn') { failReceiptWrite = false; throw Error('synthetic-receipt-failure'); }
      return Number(sql.prepare(statement).run(...values).changes);
    },
    async close() { sql.close(); },
  };
  const databaseName = `task-trash-${crypto.randomUUID().slice(0, 10)}`;
  const store = await NativeStore.open(driver, files), side = new NativeFileStore(databaseName, store);
  let repository = await openRepositoryFromBackend(side.records, side);
  return { repository, failReceiptWrite() { failReceiptWrite = true; return () => { failReceiptWrite = false; }; }, async reopen() { await repository.close(); sql = new DatabaseSync(join(root, 'native.db')); const reopenedStore = await NativeStore.open(driver, files), reopenedSide = new NativeFileStore(databaseName, reopenedStore); repository = await openRepositoryFromBackend(reopenedSide.records, reopenedSide); return repository; }, failRecordWrite() { failRecordWrite = true; return () => { failRecordWrite = false; }; }, async close() {
    await repository.close();
    if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}keepany-task-trash-`)) throw Error('unsafe-test-cleanup');
    await rm(root, { recursive: true });
  } };
}

const candidate = (n: number, source?: 'pdf'): ReviewedCandidate => {
  const hash = n.toString(16).repeat(64), rowNumber = source ? 1 : n + 1;
  const id = source ? `pdf-${hash}` : `csv-${hash}-${rowNumber}`;
  return { id, fileHash: hash, fileName: source ? 'Synthetic.pdf' : 'Synthetic.csv', rowNumber, ...(source ? { source } : {}), sourceText: 'Original retained evidence', kindSelected: true, status: 'pending', asset: { ...newAsset('project'), id: source ? `pdf-${hash.slice(0,48)}` : `csv-${hash.slice(0,48)}-${rowNumber}`, name: `Accepted original ${n}` } };
};
async function accepted(db: Awaited<ReturnType<typeof open>>['repository'], row = candidate(1)) {
  await stageReviewedCandidates(db.fileStore, [row]);
  const asset = { ...row.asset, updatedAt: '2026-10-27T01:00:00Z' }; await db.save('asset', asset);
  await decideReviewedCandidate(db.fileStore, row.id, 'accepted', async () => true, asset);
  return (await getReviewedCandidate(db.fileStore, row.id))!;
}
for (const kind of ['web', 'sqlite'] as const) describe(`${kind} durable individual intake withdrawal`, () => {
  it('withdraws only the accepted original ID, retains evidence and leaves unrelated records unchanged', async () => {
    const ctx = await open(kind), db = ctx.repository;
    try {
      const row = await accepted(db), other = { ...newAsset('project'), name: 'Keep unrelated' }; await db.save('asset', other);
      await db.withdrawReviewedCandidate(row);
      expect(await db.get('asset', row.asset.id)).toMatchObject({ id: row.asset.id, deleted: true });
      expect(await db.get('asset', other.id)).toEqual(other);
      const receipt = await getReviewedCandidate(db.fileStore, row.id);
      expect(receipt).toMatchObject({ status: 'withdrawn', sourceText: row.sourceText, acceptedRecord: row.acceptedRecord });
      await expect(db.withdrawReviewedCandidate(row)).rejects.toThrow('review-withdraw-stale');
    } finally { await ctx.close(); }
  });
  it('refuses stale accepted snapshots, later edits and genuinely old receipts without guessing timestamps', async () => {
    const ctx = await open(kind), db = ctx.repository;
    try {
      const row = await accepted(db), saved = await db.get<Asset>('asset', row.asset.id);
      await db.save('asset', { ...saved!, notes: 'Later independent edit', updatedAt: '2026-10-27T02:00:00Z' });
      await expect(db.withdrawReviewedCandidate(row)).rejects.toThrow('review-withdraw-conflict');
      expect(await db.fileStore.importJournal.count()).toBe(0); expect(await db.get('asset', row.asset.id)).toMatchObject({ notes: 'Later independent edit', deleted: false });
      const old = candidate(2); await stageReviewedCandidates(db.fileStore, [old]); await db.save('asset', old.asset); await decideReviewedCandidate(db.fileStore, old.id, 'accepted', async () => true);
      await expect(db.withdrawReviewedCandidate((await getReviewedCandidate(db.fileStore, old.id))!)).rejects.toThrow('review-withdraw-missing-receipt');
      expect(await db.get('asset', old.asset.id)).toEqual(old.asset);
    } finally { await ctx.close(); }
  });
  it('retries an exact frozen intent after write failure and can abandon an uncommitted conflict without losing a later edit', async () => {
    const ctx = await open(kind), db = ctx.repository;
    try {
      const row = await accepted(db), reset = ctx.failRecordWrite();
      await expect(db.withdrawReviewedCandidate(row)).rejects.toThrow(); reset();
      expect(await db.pendingReviewedWithdrawals()).toEqual([{ candidateId: row.id, committed: false }]);
      const original = await db.get<Asset>('asset', row.asset.id); await db.save('asset', { ...original!, name: 'Later edit wins' });
      await expect(db.retryReviewedWithdrawals()).rejects.toThrow('review-withdraw-conflict');
      expect(await db.cancelReviewedWithdrawal(row.id)).toBe('cancelled'); expect(await db.fileStore.importJournal.count()).toBe(0);
      expect(await db.get('asset', row.asset.id)).toMatchObject({ name: 'Later edit wins', deleted: false });
      const second = await accepted(db, candidate(3)), reset2 = ctx.failRecordWrite(); await expect(db.withdrawReviewedCandidate(second)).rejects.toThrow(); reset2();
      await db.retryReviewedWithdrawals(); expect(await db.get('asset', second.asset.id)).toMatchObject({ deleted: true });
    } finally { await ctx.close(); }
  });
  it('restores a merge before snapshot only while the exact after snapshot is unchanged', async () => {
    const ctx = await open(kind), db = ctx.repository;
    try {
      const target = { ...newAsset('project'), name: 'Existing target' }, row = candidate(4); await db.save('asset', target); await stageReviewedCandidates(db.fileStore, [row]);
      await confirmReviewedAssetMerge(db.records, db.fileStore, { expectedCandidate: row, expectedTarget: target, fields: ['name'] });
      const merged = (await getReviewedCandidate(db.fileStore, row.id))!; await db.withdrawReviewedCandidate(merged);
      expect(await db.get('asset', target.id)).toEqual(target); expect(await getReviewedCandidate(db.fileStore, row.id)).toMatchObject({ status: 'withdrawn', merge: merged.merge });
      const laterRow = candidate(7); await stageReviewedCandidates(db.fileStore, [laterRow]);
      await confirmReviewedAssetMerge(db.records, db.fileStore, { expectedCandidate: laterRow, expectedTarget: target, fields: ['name'] });
      const laterReceipt = (await getReviewedCandidate(db.fileStore, laterRow.id))!, after = (await db.get<Asset>('asset', target.id))!;
      const later = { ...after, notes: 'Later merge-target edit' }; await db.save('asset', later);
      await expect(db.withdrawReviewedCandidate(laterReceipt)).rejects.toThrow('review-withdraw-conflict');
      expect(await db.get('asset', target.id)).toEqual(later); expect(await db.fileStore.importJournal.count()).toBe(0);
    } finally { await ctx.close(); }
  });
  it('keeps PDF IDs stable and gives each CSV expense row an independent History, receipt and encrypted-backup continuation', async () => {
    const ctx = await open(kind), db = ctx.repository, restored = await openLocalRepository(`withdraw-clean-${crypto.randomUUID().slice(0,8)}`);
    try {
      const target = { ...newAsset('subscription'), amount: 500, dueDate: '2026-11-27', renewalCount: 2, lastRenewalId: 'old-renewal' }; await db.save('asset', target);
      const rows = [candidate(5), { ...candidate(5), id: `csv-${'5'.repeat(64)}-7`, rowNumber: 7, asset: { ...candidate(5).asset, id: `csv-${'5'.repeat(48)}-7` }, sourceText: undefined, sourceTextRef: '5'.repeat(64) }, candidate(6, 'pdf')];
      await stageReviewedCandidates(db.fileStore, rows.slice(0, 2)); await stageReviewedCandidates(db.fileStore, [rows[2]]);
      for (const row of rows) {
        await setReviewedCandidateMode(db.fileStore, row.id, 'expense', { assetId: target.id, title: 'Exact expense', amount: '12.34', currency: 'USD', eventDate: '2026-10-27', source: row.fileName, note: 'Original payment evidence' });
        const confirmed = (await getReviewedCandidate(db.fileStore, row.id))!;
        if (row === rows[0]) {
          await db.fileStore.intakeReview.put({ ...confirmed, expenseDraft: { ...confirmed.expenseDraft!, currencyConfirmed: false } });
          await expect(db.confirmReviewedExpense((await getReviewedCandidate(db.fileStore, row.id))!)).rejects.toThrow('review-expense-invalid');
          expect(await db.fileStore.importJournal.count()).toBe(0);
          await db.fileStore.intakeReview.put(confirmed);
        }
        await db.confirmReviewedExpense(confirmed);
      }
      const histories = await db.list<History>('history'); expect(new Set(histories.map(row => row.id)).size).toBe(3); expect(histories.find(row => row.id.startsWith('pdf-'))?.id).toBe(`pdf-expense-${'6'.repeat(64)}`);
      const encrypted = await encryptBackup(await db.exportArchive(), 'synthetic-withdrawal-backup'); await restored.restoreArchive(await decryptBackup(encrypted, 'synthetic-withdrawal-backup'));
      const receipt = (await getReviewedCandidate(restored.fileStore, rows[0].id))!; await restored.withdrawReviewedCandidate(receipt);
      expect(await restored.get('asset', target.id)).toEqual(target);
      expect(await restored.get('history', reviewedCandidateExpenseHistoryId(rows[0]))).toMatchObject({ deleted: true, amount: 1234 });
      expect((await restored.list('history')).length).toBe(2); expect(await restored.get('history', reviewedCandidateExpenseHistoryId(rows[1]))).toEqual(histories.find(row => row.id === reviewedCandidateExpenseHistoryId(rows[1])));
      expect((await getReviewedCandidate(restored.fileStore, rows[0].id))?.sourceText).toBe(rows[0].sourceText);
    } finally { await ctx.close(); await restored.close(); }
  });
});
for (const kind of ['web', 'sqlite'] as const) it(`${kind} reopens after a failed withdrawn receipt and completes the frozen intent once`, async () => {
  const ctx = await open(kind); let db = ctx.repository;
  try {
    const row = await accepted(db), reset = ctx.failReceiptWrite();
    await expect(db.withdrawReviewedCandidate(row)).rejects.toThrow('synthetic-receipt-failure'); reset();
    expect(await db.get('asset', row.asset.id)).toMatchObject({ deleted: kind === 'web' }); expect((await getReviewedCandidate(db.fileStore, row.id))?.status).toBe('accepted');
    db = await ctx.reopen();
    expect((await getReviewedCandidate(db.fileStore, row.id))?.status).toBe('withdrawn'); expect(await db.fileStore.importJournal.count()).toBe(0);
  } finally { await db.close(); await ctx.close(); }
});
