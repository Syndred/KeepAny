import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { newAsset, type Asset, type History } from '../../domain/src';
import { inspectArchive, openLocalRepository, type DatasetBinding } from './index';
import { encryptBackup, decryptBackup } from './backup-crypto';
import { confirmReviewedExpense, decideReviewedCandidate, editReviewedCandidate, editReviewedExpenseDraft,
  getReviewedCandidate, reviewedExpenseHistoryId, setReviewedCandidateMode, stageReviewedCandidates,
  type ReviewedCandidate, type ReviewedExpenseDraft } from './intake-review';

const databaseName = () => `test-${crypto.randomUUID().slice(0, 12)}`;
type Repository = Awaited<ReturnType<typeof openLocalRepository>>;
const pdf = (hash = 'a'.repeat(64)): ReviewedCandidate => ({
  id: `pdf-${hash}`, fileHash: hash, fileName: 'invoice.pdf', rowNumber: 1, source: 'pdf',
  sourceText: 'Cloud deployment CNY 100.08, September 22, 2026', kindSelected: false, status: 'pending',
  asset: { ...newAsset('item'), id: `pdf-${hash.slice(0, 48)}`, name: 'Invoice text' },
});
const draft = (assetId = ''): ReviewedExpenseDraft => ({ assetId, title: 'Cloud deployment invoice', amount: '100.08',
  currency: 'CNY', eventDate: '2026-09-22', source: ' invoice.pdf ', note: 'Confirmed manually against the original text' });
async function stage(repository: Repository, row = pdf(), value = draft()) {
  await stageReviewedCandidates(repository.fileStore, [row]);
  await setReviewedCandidateMode(repository.fileStore, row.id, 'expense', value);
  const result = await getReviewedCandidate(repository.fileStore, row.id);
  if (!result) throw Error('fixture-missing');
  return result;
}
async function target(repository: Repository, value = { ...newAsset('subscription'), name: 'Cloud deployment',
  amount: 9800, dueDate: '2026-10-22', billingAnchor: '2026-09-22' }): Promise<Asset> {
  await repository.save('asset', value);
  return value;
}
const hashBytes = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)),
  byte => byte.toString(16).padStart(2, '0')).join('');
async function mutateArchive(bytes: Uint8Array, change: (rows: Array<{ type: string; id: string; payload: string }>) => void) {
  const entries = unzipSync(bytes), rows = JSON.parse(strFromU8(entries['records.json']));
  change(rows); entries['records.json'] = strToU8(JSON.stringify(rows));
  const manifest = JSON.parse(strFromU8(entries['manifest.json']));
  manifest.recordCount = rows.length; manifest.recordsHash = await hashBytes(entries['records.json']);
  entries['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(entries);
}
async function binding(): Promise<DatasetBinding> {
  const endpoint = 'https://sync.example.test', accountId = 'expense-owner', workspaceId = crypto.randomUUID();
  return { endpoint, accountId, workspaceId, scope: `${await hashBytes(strToU8(JSON.stringify([endpoint, accountId])))}:${workspaceId}` };
}

it('preserves incomplete expense drafts, old asset candidates and toggled drafts in encrypted backups without requiring a target', async () => {
  const source = await openLocalRepository(databaseName()), restored = await openLocalRepository(databaseName());
  try {
    const row = await stage(source, pdf(), { ...draft('missing-target'), title: '', amount: 'unfinished', eventDate: '' });
    await setReviewedCandidateMode(source.fileStore, row.id, 'asset');
    await setReviewedCandidateMode(source.fileStore, row.id, 'expense', draft('replacement-must-not-win'));
    expect((await getReviewedCandidate(source.fileStore, row.id))?.expenseDraft).toEqual(row.expenseDraft);
    const old = { ...pdf('b'.repeat(64)), kindSelected: true, asset: { ...pdf('b'.repeat(64)).asset, kind: 'account' as const } };
    await stageReviewedCandidates(source.fileStore, [old]); await source.save('asset', old.asset);
    await decideReviewedCandidate(source.fileStore, old.id, 'accepted', async id => !!await source.get('asset', id));
    const encrypted = await encryptBackup(await source.exportArchive(), 'expense-test-password');
    expect(new TextDecoder().decode(encrypted)).not.toContain('unfinished');
    await restored.restoreArchive(await decryptBackup(encrypted, 'expense-test-password'));
    expect(await getReviewedCandidate(restored.fileStore, row.id)).toEqual(await getReviewedCandidate(source.fileStore, row.id));
    expect(await getReviewedCandidate(restored.fileStore, old.id)).toMatchObject({ status: 'accepted', asset: old.asset });
    expect(await restored.list('history')).toEqual([]);
  } finally { await source.close(); await restored.close(); }
});

it('records one deterministic expense without creating an asset, changing a schedule or modifying relationships; restore and renamed re-upload remain idempotent', async () => {
  const source = await openLocalRepository(databaseName()), restored = await openLocalRepository(databaseName());
  try {
    const service = await target(source), row = await stage(source, pdf(), draft(service.id));
    const history = await source.confirmReviewedExpense(row);
    expect(history).toMatchObject({ id: reviewedExpenseHistoryId(row.fileHash), assetId: service.id, action: 'expense',
      title: row.expenseDraft?.title, amount: 10008, currency: 'CNY', eventDate: '2026-09-22', source: 'invoice.pdf' });
    expect(history.id.length).toBeLessThanOrEqual(96);
    expect(await source.get('asset', service.id)).toEqual(service);
    expect(await source.list('asset')).toHaveLength(1); expect(await source.list('relation')).toEqual([]);
    expect(await source.confirmReviewedExpense(row)).toEqual(history);
    const receipt = await getReviewedCandidate(source.fileStore, row.id);
    expect(receipt).toMatchObject({ status: 'accepted', historyId: history.id, reviewMode: 'expense', kindSelected: false });
    await stageReviewedCandidates(source.fileStore, [{ ...pdf(), fileName: 'renamed.pdf' }]);
    expect(await getReviewedCandidate(source.fileStore, row.id)).toEqual(receipt);
    const archive = await decryptBackup(await encryptBackup(await source.exportArchive(), 'expense-test-password'), 'expense-test-password');
    expect((await inspectArchive(archive)).manifest.recordCount).toBe(2);
    expect(await restored.restoreArchive(archive)).toBe(2); await restored.restoreArchive(archive);
    expect(await restored.get('history', history.id)).toEqual(history);
    expect(await restored.list('asset')).toEqual([service]);
    expect(await restored.confirmReviewedExpense(receipt as ReviewedCandidate)).toEqual(history);
    expect(await restored.list('history')).toHaveLength(1);
  } finally { await source.close(); await restored.close(); }
});

it('validates exact minor units, title/date and live subscription/account targets before creating any intent', async () => {
  const repository = await openLocalRepository(databaseName());
  try {
    const service = await target(repository), row = await stage(repository, pdf(), draft(service.id));
    const project = { ...newAsset('project'), name: 'Not a finance target' }; await repository.save('asset', project);
    const invalid = [ { amount: '' }, { amount: '0' }, { amount: '1.234' }, { amount: '90071992547409.92' }, { amount: '9'.repeat(10000) },
      { amount: '1.1', currency: 'JPY' as const }, { title: ' ' }, { eventDate: '2026-02-30' },
      { assetId: '' }, { assetId: 'missing' }, { assetId: project.id } ];
    for (const patch of invalid) {
      await editReviewedExpenseDraft(repository.fileStore, row.id, { ...draft(service.id), ...patch });
      const latest = await getReviewedCandidate(repository.fileStore, row.id);
      await expect(repository.confirmReviewedExpense(latest as ReviewedCandidate)).rejects.toThrow(/review-expense-(invalid|target)/);
      expect(await repository.fileStore.importJournal.count()).toBe(0); expect(await repository.list('history')).toEqual([]);
    }
    await editReviewedExpenseDraft(repository.fileStore, row.id, { ...draft(service.id), amount: '100', currency: 'JPY' });
    expect(await repository.confirmReviewedExpense((await getReviewedCandidate(repository.fileStore, row.id)) as ReviewedCandidate)).toMatchObject({ amount: 100, currency: 'JPY' });
  } finally { await repository.close(); }
});

it('rejects a stale confirmation snapshot while preserving the newer draft', async () => {
  const repository = await openLocalRepository(databaseName());
  try {
    const service = await target(repository), row = await stage(repository, pdf(), draft(service.id));
    await editReviewedExpenseDraft(repository.fileStore, row.id, { ...draft(service.id), amount: '200.01' });
    await expect(repository.confirmReviewedExpense(row)).rejects.toThrow('review-expense-stale');
    expect((await getReviewedCandidate(repository.fileStore, row.id))?.expenseDraft?.amount).toBe('200.01');
    expect(await repository.list('history')).toEqual([]); expect(await repository.fileStore.importJournal.count()).toBe(0);
  } finally { await repository.close(); }
});

it('freezes edits, mode and ignore after a failed history write, then retries the original persisted intent', async () => {
  const repository = await openLocalRepository(databaseName());
  try {
    const service = await target(repository), row = await stage(repository, pdf(), draft(service.id));
    const failure = vi.spyOn(repository.db.records, 'insert').mockRejectedValueOnce(Error('injected-history-write'));
    await expect(repository.confirmReviewedExpense(row)).rejects.toThrow('review-expense-pending'); failure.mockRestore();
    expect(await repository.fileStore.importJournal.count()).toBe(1);
    await expect(editReviewedExpenseDraft(repository.fileStore, row.id, { ...draft(service.id), amount: '999' })).rejects.toThrow('review-expense-pending');
    await expect(editReviewedCandidate(repository.fileStore, row.id, { ...row.asset, name: 'Different' })).rejects.toThrow('review-expense-pending');
    await expect(setReviewedCandidateMode(repository.fileStore, row.id, 'asset')).rejects.toThrow('review-expense-pending');
    await expect(decideReviewedCandidate(repository.fileStore, row.id, 'ignored', async () => false)).rejects.toThrow('review-expense-pending');
    await repository.save('asset', { ...newAsset('project'), name: 'Unrelated CRUD remains usable' });
    await repository.retryReviewedExpenseConfirmations();
    expect(await repository.get<History>('history', reviewedExpenseHistoryId(row.fileHash))).toMatchObject({ amount: 10008 });
    expect(await getReviewedCandidate(repository.fileStore, row.id)).toMatchObject({ status: 'accepted', expenseDraft: row.expenseDraft });
    expect(repository.intakeExpenseRecoveryError).toBeNull(); expect(await repository.fileStore.importJournal.count()).toBe(0);
  } finally { await repository.close(); }
});

it('reopens after the History write but before receipt acceptance and completes the exact original amount once', async () => {
  const name = databaseName(); let repository = await openLocalRepository(name);
  try {
    const service = await target(repository), row = await stage(repository, pdf(), draft(service.id));
    const put = repository.fileStore.intakeReview.put.bind(repository.fileStore.intakeReview);
    const failure = vi.spyOn(repository.fileStore.intakeReview, 'put').mockImplementation((value, key) => {
      if (value.status === 'accepted') return Promise.reject(Error('injected-receipt-write')) as ReturnType<typeof put>;
      return put(value, key);
    });
    await expect(repository.confirmReviewedExpense(row)).rejects.toThrow('review-expense-pending'); failure.mockRestore();
    const written = await repository.get<History>('history', reviewedExpenseHistoryId(row.fileHash));
    expect(written?.amount).toBe(10008); expect((await getReviewedCandidate(repository.fileStore, row.id))?.status).toBe('pending');
    await repository.close(); repository = await openLocalRepository(name);
    expect(await repository.get('history', written?.id as string)).toEqual(written);
    expect(await getReviewedCandidate(repository.fileStore, row.id)).toMatchObject({ status: 'accepted', historyId: written?.id });
    expect(await repository.confirmReviewedExpense(row)).toEqual(written);
    expect(await repository.list('history')).toHaveLength(1); expect(await repository.fileStore.importJournal.count()).toBe(0);
  } finally { await repository.close(); }
});

it('rolls back receipt acceptance when journal deletion fails and preserves the original History for retry', async () => {
  const repository = await openLocalRepository(databaseName());
  try {
    const service = await target(repository), row = await stage(repository, pdf(), draft(service.id));
    const failure = vi.spyOn(repository.fileStore.importJournal, 'delete').mockRejectedValueOnce(Error('injected-cleanup'));
    await expect(repository.confirmReviewedExpense(row)).rejects.toThrow('review-expense-pending'); failure.mockRestore();
    const written = await repository.get('history', reviewedExpenseHistoryId(row.fileHash));
    expect((await getReviewedCandidate(repository.fileStore, row.id))?.status).toBe('pending');
    expect(await repository.fileStore.importJournal.count()).toBe(1);
    expect(await repository.confirmReviewedExpense(row)).toEqual(written);
    expect(await repository.fileStore.importJournal.count()).toBe(0); expect(await repository.list('history')).toHaveLength(1);
  } finally { await repository.close(); }
});

it('serializes two FileStore handles directly through Dexie, without relying on Web Locks or the repository in-process lock', async () => {
  const name = databaseName(), first = await openLocalRepository(name);
  const FileStore = first.fileStore.constructor as new (name: string) => Repository['fileStore'];
  const secondStore = new FileStore(name);
  try {
    const service = await target(first), row = await stage(first, pdf(), draft(service.id));
    const results = await Promise.all([confirmReviewedExpense(first.db, first.fileStore, row), confirmReviewedExpense(first.db, secondStore, row)]);
    expect(results[0]).toEqual(results[1]); expect(await first.list('history')).toHaveLength(1);
    expect(await first.fileStore.importJournal.count()).toBe(0);
  } finally { await first.close(); secondStore.close(); }
});

it('refuses confirmation while a durable restore or archive merge is pending, even when the repository precheck is bypassed', async () => {
  const repository = await openLocalRepository(databaseName());
  try {
    const service = await target(repository), row = await stage(repository, pdf(), draft(service.id));
    await repository.fileStore.journal.add({ id: 'pending-restore', rows: [] });
    await expect(confirmReviewedExpense(repository.db, repository.fileStore, row)).rejects.toThrow('restore-recovery-pending');
    await repository.fileStore.journal.clear();
    await repository.fileStore.archiveMerge.add({ id: 'active', phase: 'applying', archiveHash: 'a'.repeat(64),
      targetFingerprint: 'b'.repeat(64), changes: [], addedFileIds: [], insertedFileIds: [] });
    await expect(confirmReviewedExpense(repository.db, repository.fileStore, row)).rejects.toThrow('archive-merge-pending');
    expect(await repository.list('history')).toEqual([]); expect(await repository.fileStore.importJournal.count()).toBe(0);
    expect(await getReviewedCandidate(repository.fileStore, row.id)).toEqual(row);
    await repository.fileStore.archiveMerge.clear();
    await repository.confirmReviewedExpense(row);
    expect(await repository.list('history')).toHaveLength(1);
  } finally { await repository.close(); }
});

it('rejects an export when another handle freezes a new uncommitted confirmation after the initial recovery pass', async () => {
  const repository = await openLocalRepository(databaseName());
  const FileStore = repository.fileStore.constructor as new (name: string) => Repository['fileStore'];
  const secondStore = new FileStore(repository.db.name);
  try {
    const service = await target(repository), row = await stage(repository, pdf(), draft(service.id));
    const read = repository.allRecords.bind(repository);
    const insertFailure = vi.spyOn(repository.db.records, 'insert').mockRejectedValueOnce(Error('injected-history-write'));
    const concurrent = vi.spyOn(repository, 'allRecords').mockImplementationOnce(async () => {
      const snapshot = await read();
      await expect(confirmReviewedExpense(repository.db, secondStore, row)).rejects.toThrow('injected-history-write');
      return snapshot;
    });
    await expect(repository.exportArchive()).rejects.toThrow('review-expense-pending');
    concurrent.mockRestore(); insertFailure.mockRestore();
    expect(await repository.list('history')).toEqual([]); expect(await repository.fileStore.importJournal.count()).toBe(1);
    await repository.retryReviewedExpenseConfirmations();
    expect((await inspectArchive(await repository.exportArchive())).intakeReview[0]).toMatchObject({ status: 'accepted' });
  } finally { await repository.close(); secondStore.close(); }
});

it('cancels only an uncommitted intent after the target is deleted and preserves the draft for retargeting', async () => {
  const repository = await openLocalRepository(databaseName());
  try {
    const service = await target(repository), row = await stage(repository, pdf(), draft(service.id));
    const failure = vi.spyOn(repository.db.records, 'insert').mockRejectedValueOnce(Error('injected-history-write'));
    await expect(repository.confirmReviewedExpense(row)).rejects.toThrow('review-expense-pending'); failure.mockRestore();
    await repository.deleteEntity('asset', service.id);
    expect(await repository.pendingReviewedExpenseConfirmations()).toEqual([{ candidateId: row.id,
      historyId: reviewedExpenseHistoryId(row.fileHash), committed: false }]);
    await expect(repository.retryReviewedExpenseConfirmations()).rejects.toThrow('review-expense-target');
    expect(await repository.cancelReviewedExpenseConfirmation(row.id)).toBe('cancelled');
    expect(await repository.pendingReviewedExpenseConfirmations()).toEqual([]);
    expect(await getReviewedCandidate(repository.fileStore, row.id)).toEqual(row);
    const replacement = await target(repository, { ...newAsset('subscription'), name: 'Replacement service', amount: 1,
      dueDate: '', billingAnchor: '' });
    await editReviewedExpenseDraft(repository.fileStore, row.id, { ...draft(replacement.id), amount: '200.02' });
    await repository.confirmReviewedExpense((await getReviewedCandidate(repository.fileStore, row.id)) as ReviewedCandidate);
    expect(await repository.get<History>('history', reviewedExpenseHistoryId(row.fileHash))).toMatchObject({ assetId: replacement.id, amount: 20002 });
  } finally { await repository.close(); }
});

it('completes the original receipt instead of cancelling when the History already committed', async () => {
  const repository = await openLocalRepository(databaseName());
  try {
    const service = await target(repository), row = await stage(repository, pdf(), draft(service.id));
    const failure = vi.spyOn(repository.fileStore.importJournal, 'delete').mockRejectedValueOnce(Error('injected-cleanup'));
    await expect(repository.confirmReviewedExpense(row)).rejects.toThrow('review-expense-pending'); failure.mockRestore();
    const written = await repository.get('history', reviewedExpenseHistoryId(row.fileHash));
    expect(await repository.pendingReviewedExpenseConfirmations()).toEqual([{ candidateId: row.id,
      historyId: reviewedExpenseHistoryId(row.fileHash), committed: true }]);
    expect(await repository.cancelReviewedExpenseConfirmation(row.id)).toBe('completed');
    expect(await repository.get('history', reviewedExpenseHistoryId(row.fileHash))).toEqual(written);
    expect(await getReviewedCandidate(repository.fileStore, row.id)).toMatchObject({ status: 'accepted', expenseDraft: row.expenseDraft });
    expect(await editReviewedExpenseDraft(repository.fileStore, row.id, { ...draft(service.id), amount: '1' })).toBe(false);
  } finally { await repository.close(); }
});

it('keeps a conflicting interrupted intent visible on reopen and rejects export, restore and merge preview without blocking assets', async () => {
  const name = databaseName(); let repository = await openLocalRepository(name);
  try {
    const service = await target(repository), row = await stage(repository, pdf(), draft(service.id));
    const initial = await repository.exportArchive();
    const failure = vi.spyOn(repository.db.records, 'insert').mockRejectedValueOnce(Error('injected-history-write'));
    await expect(repository.confirmReviewedExpense(row)).rejects.toThrow('review-expense-pending'); failure.mockRestore();
    await repository.save('history', { id: reviewedExpenseHistoryId(row.fileHash), assetId: service.id, action: 'expense', title: 'Unrelated conflicting entry',
      amount: 1, currency: 'CNY', eventDate: '2026-09-22', source: 'Other', note: '', createdAt: new Date().toISOString(), deleted: false });
    await repository.close(); repository = await openLocalRepository(name);
    expect(repository.intakeExpenseRecoveryError).toBe('review-expense-recovery-conflict');
    expect(await repository.get('asset', service.id)).toEqual(service);
    await expect(repository.exportArchive()).rejects.toThrow('review-expense-recovery-conflict');
    await expect(repository.restoreArchive(initial)).rejects.toThrow('review-expense-recovery-conflict');
    await expect(repository.previewArchiveMerge(initial)).rejects.toThrow('review-expense-recovery-conflict');
    await expect(repository.cancelReviewedExpenseConfirmation(row.id)).rejects.toThrow('review-expense-recovery-conflict');
    expect((await repository.get<History>('history', reviewedExpenseHistoryId(row.fileHash)))?.amount).toBe(1);
    expect((await getReviewedCandidate(repository.fileStore, row.id))?.status).toBe('pending'); expect(await repository.fileStore.importJournal.count()).toBe(1);
  } finally { await repository.close(); }
});

it('rejects missing or mismatched actual History references before a restore writes anything', async () => {
  const source = await openLocalRepository(databaseName()), restored = await openLocalRepository(databaseName());
  try {
    const service = await target(source), row = await stage(source, pdf(), draft(service.id)); await source.confirmReviewedExpense(row);
    const valid = await source.exportArchive();
    for (const change of [(rows: Array<{ type: string; id: string; payload: string }>) => { rows.splice(rows.findIndex(row => row.type === 'history'), 1); },
      (rows: Array<{ type: string; id: string; payload: string }>) => { const history = rows.find(row => row.type === 'history'); if (history) history.payload = JSON.stringify({ ...JSON.parse(history.payload), amount: 1 }); }]) {
      const bad = await mutateArchive(valid, change);
      await expect(inspectArchive(bad)).rejects.toThrow('archive-review-history-reference');
      await expect(restored.restoreArchive(bad)).rejects.toThrow('archive-review-history-reference');
      expect(await restored.allRecords()).toEqual([]); expect(await restored.fileStore.intakeReview.count()).toBe(0); expect(await restored.fileStore.journal.count()).toBe(0);
    }
  } finally { await source.close(); await restored.close(); }
});

it('preflights selected candidate/History merge combinations and restores both records and receipt on undo', async () => {
  const source = await openLocalRepository(databaseName()), destination = await openLocalRepository(databaseName());
  try {
    const service = await target(source); await target(destination, service); const original = pdf();
    const sourceRow = await stage(source, original, draft(service.id)), targetRow = await stage(destination, original, { ...draft(service.id), amount: '200.02' });
    const sourceHistory = await source.confirmReviewedExpense(sourceRow), targetHistory = await destination.confirmReviewedExpense(targetRow);
    await destination.claimDatasetBinding(await binding()); const archive = await source.exportArchive();
    const preview = await destination.previewArchiveMerge(archive);
    const historyKey = `history:${sourceHistory.id}`, candidateKey = `review:${original.id}`;
    await expect(destination.applyArchiveMerge(archive, { [historyKey]: 'target', [candidateKey]: 'source' }, preview.targetFingerprint))
      .rejects.toThrow('archive-review-history-reference');
    expect(await destination.get('history', targetHistory.id)).toEqual(targetHistory);
    expect(await destination.pendingArchiveMerge()).toBeNull();
    await destination.applyArchiveMerge(archive, { [historyKey]: 'source', [candidateKey]: 'source' }, preview.targetFingerprint);
    expect(await destination.get('history', sourceHistory.id)).toEqual(sourceHistory);
    expect((await getReviewedCandidate(destination.fileStore, original.id))?.expenseDraft?.amount).toBe('100.08');
    await destination.rollbackArchiveMerge();
    expect(await destination.get('history', targetHistory.id)).toEqual(targetHistory);
    expect((await getReviewedCandidate(destination.fileStore, original.id))?.expenseDraft?.amount).toBe('200.02');
    await inspectArchive(await destination.exportArchive());
  } finally { await source.close(); await destination.close(); }
});
