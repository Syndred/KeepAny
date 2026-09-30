import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { historySchema, newAsset, kinds, type Asset, type AssetKind, type Category } from '../../domain/src';
import { inspectArchive, LocalRepository, openLocalRepository, type RecordRow } from './index';
import { decryptBackup, encryptBackup } from './backup-crypto';
import { editCustomCategory, type CategoryEditOperationStore, type EditCustomCategoryInput } from './category-edit';

type Repository = Awaited<ReturnType<typeof openLocalRepository>>;
const databaseName = () => `test-${crypto.randomUUID().slice(0, 12)}`;
const asset = (kind: AssetKind, name: string, category = 'Alpha', deleted = false): Asset => ({ ...newAsset(kind), name, category, deleted });
async function fixture(repository: Repository, kind: AssetKind = 'project') {
  const category = await repository.createCategory(kind, 'Alpha', 7);
  const assets = [asset(kind, 'Keep'), asset(kind, 'Remove'), asset(kind, 'Selected elsewhere', 'Other'),
    asset(kind, 'Leave elsewhere', 'Other'), asset(kind, 'Deleted member', 'Alpha', true), asset(kind, 'Deleted elsewhere', 'Other', true)];
  for (const value of assets) await repository.save('asset', value);
  await repository.save('preference', { id: `categoryOrder-${kind}`, value: ['builtin', 'Alpha', 'Other'], deleted: false });
  return { category, assets, input: { expectedCategory: category, expectedAssets: assets,
    name: 'Beta', memberIds: [assets[0].id, assets[2].id], reservedNames: ['website', '网站', 'All', '全部'] } satisfies EditCustomCategoryInput };
}
function operationStore(repository: Repository, fileStore = repository.fileStore): CategoryEditOperationStore {
  return { categoryEditJournal: fileStore.categoryEditJournal, transaction: fileStore.transaction.bind(fileStore),
    recoveryTables: [fileStore.journal, fileStore.importJournal, fileStore.pullJournal, fileStore.scopedPull,
      fileStore.scopedOutbox, fileStore.scopedAttachmentUploads, fileStore.archiveMerge,
      fileStore.renewalJournal, fileStore.subscriptionSaveJournal] };
}
function failWrite(repository: Repository, count = 2) {
  const storage = repository.db.records.storageInstance, original = storage.bulkWrite.bind(storage);
  let writes = 0;
  return vi.spyOn(storage, 'bulkWrite').mockImplementation((rows: Parameters<typeof original>[0], context: string) => {
    if (context === 'category-edit' && ++writes === count) return Promise.reject(Error('injected-category-write'));
    return original(rows, context);
  });
}
async function rows(repository: Repository) {
  const result = await repository.db.records.storageInstance.query(repository.db.records.find().getPreparedQuery());
  return result.documents.map((row: RecordRow) => ({ id: row.id, type: row.type, payload: row.payload, updatedAt: row.updatedAt })) as RecordRow[];
}
async function externalEdit(repository: Repository, id: string, patch: Partial<Asset>) {
  const storage = repository.db.records.storageInstance;
  const [before] = await storage.findDocumentsById([`asset:${id}`], false);
  const value = JSON.parse(before.payload);
  const result = await storage.bulkWrite([{ previous: before, document: { ...before,
    payload: JSON.stringify({ ...value, ...patch }), updatedAt: before.updatedAt + 1 } }], 'external-test-edit');
  expect(result.error).toEqual([]);
}

it.each(kinds)('renames %s categories in place, updates selected/live/tombstone members and order, and reads encrypted backup after restoration', async kind => {
  const repository = await openLocalRepository(databaseName()), restored = await openLocalRepository(databaseName());
  try {
    const { category, assets, input } = await fixture(repository, kind);
    const otherKind = kind === 'account' ? 'project' : 'account';
    const unrelated = asset(otherKind, 'Unrelated old name'); await repository.save('asset', unrelated);
    const result = await repository.editCustomCategory(input);
    expect(result).toEqual({ ...category, name: 'Beta' });
    for (const [index, expectedCategory] of ['Beta', '', 'Beta', 'Other', 'Beta', 'Other'].entries()) {
      const current = await repository.get<Asset>('asset', assets[index].id);
      expect(current).toMatchObject({ ...assets[index], category: expectedCategory, updatedAt: current?.updatedAt });
      if ([3, 5].includes(index)) expect(current).toEqual(assets[index]);
    }
    expect(await repository.get('asset', unrelated.id)).toEqual(unrelated);
    expect((await repository.get<{ value: string[] }>('preference', `categoryOrder-${kind}`))?.value).toEqual(['builtin', 'Beta', 'Other']);
    expect(await repository.getPendingCategoryEdit(kind)).toBeNull();
    const encrypted = await encryptBackup(await repository.exportArchive(), 'category-test-password');
    const archive = await decryptBackup(encrypted, 'category-test-password'); await inspectArchive(archive);
    await restored.restoreArchive(archive);
    expect(await restored.get('category', category.id)).toEqual(result);
    const tombstone = await restored.get<Asset>('asset', assets[4].id);
    expect(tombstone).toMatchObject({ deleted: true, category: 'Beta' });
    await restored.restoreEntity('asset', assets[4].id);
    expect(await restored.get('asset', assets[4].id)).toMatchObject({ deleted: false, category: 'Beta' });
  } finally { await repository.close(); await restored.close(); }
});

it('excludes itself from normalized duplicate checks, rejects reserved names and permits recreating the old name with a different ID', async () => {
  const repository = await openLocalRepository(databaseName());
  try {
    const { category, input } = await fixture(repository);
    await repository.createCategory('project', 'Work', 8);
    for (const [name, code] of [['ｗＯＲＫ', 'category-duplicate'], ['全部', 'category-reserved'], [' Website ', 'category-reserved'], ['', 'category-name'], ['x'.repeat(61), 'category-name']]) {
      await expect(repository.editCustomCategory({ ...input, name })).rejects.toThrow(code);
      expect(await repository.getPendingCategoryEdit('project')).toBeNull();
    }
    const same = await repository.editCustomCategory({ ...input, name: 'Ａｌｐｈａ' });
    expect(same.id).toBe(category.id);
    const current = await repository.list<Asset>('asset', true);
    await repository.editCustomCategory({ ...input, expectedCategory: same, expectedAssets: current, name: 'Beta' });
    const recreated = await repository.createCategory('project', 'Alpha', 9);
    expect(recreated.id).not.toBe(category.id); expect(recreated.name).toBe('Alpha');
    expect(await repository.get('category', category.id)).toMatchObject({ name: 'Beta', order: 7 });
  } finally { await repository.close(); }
});

it('rejects changed categories, missing/changed/new asset snapshots and invalid member IDs before freezing or changing any row', async () => {
  const repository = await openLocalRepository(databaseName());
  try {
    const { assets, input } = await fixture(repository), initial = await rows(repository);
    const cases = [ { expectedCategory: { ...input.expectedCategory, name: 'Old' } },
      { expectedAssets: assets.slice(1) }, { expectedAssets: assets.map((row, index) => index ? row : { ...row, notes: 'Old' }) },
      { memberIds: [assets[4].id] }, { memberIds: ['missing'] }, { memberIds: [assets[0].id, assets[0].id] } ];
    for (const patch of cases) {
      await expect(repository.editCustomCategory({ ...input, ...patch })).rejects.toThrow(/category-(stale|members-stale|edit-invalid)/);
      expect(await rows(repository)).toEqual(initial); expect(await repository.getPendingCategoryEdit('project')).toBeNull();
    }
    await repository.save('asset', asset('project', 'Added after the modal opened', 'Other'));
    const changed = await rows(repository);
    await expect(repository.editCustomCategory(input)).rejects.toThrow('category-members-stale');
    expect(await rows(repository)).toEqual(changed);
  } finally { await repository.close(); }
});

it('rejects stale deletion and generic stale category writes before clearing any member', async () => {
  const repository = await openLocalRepository(databaseName());
  try {
    const { category, assets, input } = await fixture(repository);
    await repository.editCustomCategory(input); const current = await rows(repository);
    await expect(repository.deleteCustomCategory({ expectedCategory: category, expectedAssets: assets })).rejects.toThrow('category-stale');
    await expect(repository.save('category', { ...category, deleted: true })).rejects.toThrow('category-stale');
    expect(await rows(repository)).toEqual(current); expect(await repository.getPendingCategoryEdit('project')).toBeNull();
  } finally { await repository.close(); }
});

it('leaves a durable interrupted plan visible and resumes it once on open, preserving original tombstones and ID/order', async () => {
  const name = databaseName(); let repository = await openLocalRepository(name);
  try {
    const { category, assets, input } = await fixture(repository);
    const failure = failWrite(repository);
    await expect(repository.editCustomCategory(input)).rejects.toThrow('category-edit-pending'); failure.mockRestore();
    expect(await repository.getPendingCategoryEdit('project')).toMatchObject({ kind: 'project', categoryId: category.id,
      beforeName: 'Alpha', afterName: 'Beta', phase: 'applying', changedAssets: 4, deleting: false });
    expect(await repository.get('category', category.id)).toMatchObject({ name: 'Beta' });
    expect(await repository.get('asset', assets[0].id)).toEqual(assets[0]);
    await repository.close(); repository = await openLocalRepository(name);
    expect(await repository.getPendingCategoryEdit('project')).toBeNull(); expect(repository.categoryEditRecoveryError).toBeNull();
    expect(await repository.get('category', category.id)).toEqual({ ...category, name: 'Beta' });
    expect(await repository.get('asset', assets[4].id)).toMatchObject({ deleted: true, category: 'Beta' });
    const settled = await rows(repository); await repository.retryCategoryEdit('project'); expect(await rows(repository)).toEqual(settled);
  } finally { await repository.close(); }
});

it('blocks all same-kind create/save/batch/delete/restore/order/member paths while keeping other assets and reads available', async () => {
  const repository = await openLocalRepository(databaseName());
  try {
    const { category, assets, input } = await fixture(repository), archive = await repository.exportArchive();
    const failure = failWrite(repository);
    await expect(repository.editCustomCategory(input)).rejects.toThrow('category-edit-pending'); failure.mockRestore();
    for (const action of [
      () => repository.createCategory('project', 'New', 0),
      () => repository.save('asset', asset('project', 'New')),
      () => repository.saveAssetIfCurrent(assets[0], { ...assets[0], category: '' }),
      () => repository.saveBatch([{ type: 'asset' as const, value: asset('project', 'Batch') }]),
      () => repository.deleteEntity('asset', assets[0].id),
      () => repository.restoreEntity('asset', assets[4].id),
      () => repository.save('category', { ...category, deleted: true }),
      () => repository.save('preference', { id: 'categoryOrder-project', value: [] }),
      () => repository.editCustomCategory(input),
      () => repository.applyIncoming('asset', assets[0], JSON.stringify(assets[0])),
      () => repository.applyPulledBatch([], 0),
    ]) await expect(action()).rejects.toThrow('category-edit-pending');
    // An unrelated kind still supports normal editing and creation.
    await repository.save('asset', asset('account', 'Available', 'Alpha'));
    await repository.createCategory('account', 'Available', 0);
    expect(await repository.get('asset', assets[0].id)).toEqual(assets[0]);
    const failedRetry = failWrite(repository, 1);
    await expect(repository.restoreArchive(archive)).rejects.toThrow('category-edit-pending'); failedRetry.mockRestore();
    await repository.retryCategoryEdit('project'); expect(await repository.fileStore.importJournal.count()).toBe(0);
  } finally { await repository.close(); }
});

it('guards dedicated subscription save/renewal and physical-item archive/history paths while that kind has a category intent', async () => {
  for (const kind of ['subscription', 'item'] as const) {
    const repository = await openLocalRepository(databaseName());
    try {
      const { input, assets } = await fixture(repository, kind);
      if (kind === 'subscription') {
        assets[0] = { ...assets[0], dueDate: '2026-09-30', billingAnchor: '2026-09-30', amount: 9800 };
        await repository.save('asset', assets[0]);
      }
      const failure = failWrite(repository, 2);
      await expect(repository.editCustomCategory({ ...input, expectedAssets: assets })).rejects.toThrow('category-edit-pending'); failure.mockRestore();
      const expected = assets[0];
      if (kind === 'subscription') {
        await expect(repository.saveSubscription(expected, { ...expected, name: 'Changed subscription' }, [])).rejects.toThrow('category-edit-pending');
        const history = historySchema.parse({ id: crypto.randomUUID(), assetId: expected.id, action: 'renew',
          billDate: expected.dueDate, amount: expected.amount, currency: expected.currency, note: '', createdAt: new Date().toISOString() });
        await expect(repository.recordRenewal(expected, { ...expected, dueDate: '2026-10-30', renewalCount: 1,
          lastRenewalId: history.id }, history)).rejects.toThrow('category-edit-pending');
      } else {
        await expect(repository.setItemArchived(expected.id, 'active')).rejects.toThrow('category-edit-pending');
        const history = historySchema.parse({ id: crypto.randomUUID(), assetId: expected.id, action: 'loan',
          borrower: 'Ada', eventDate: '2026-09-30', note: '', createdAt: new Date().toISOString() });
        await expect(repository.recordItemAction(expected, { ...expected, status: 'loaned', borrower: 'Ada',
          lastItemEventId: history.id }, history)).rejects.toThrow('category-edit-pending');
      }
      expect(await repository.fileStore.subscriptionSaveJournal.count()).toBe(0);
      expect(await repository.fileStore.renewalJournal.count()).toBe(0);
      expect(await repository.list('history')).toEqual([]);
      expect(await repository.get('asset', expected.id)).toEqual(expected);
    } finally { await repository.close(); }
  }
});

it('rejects export if a second FileStore handle freezes an uncommitted category intent after the initial recovery pass', async () => {
  const repository = await openLocalRepository(databaseName());
  const FileStore = repository.fileStore.constructor as new (name: string) => Repository['fileStore'];
  const secondStore = new FileStore(repository.db.name);
  try {
    const { input } = await fixture(repository), read = repository.allRecords.bind(repository);
    const failure = failWrite(repository, 1);
    const concurrent = vi.spyOn(repository, 'allRecords').mockImplementationOnce(async () => {
      const snapshot = await read();
      await expect(editCustomCategory(repository.db, operationStore(repository, secondStore), input)).rejects.toThrow('injected-category-write');
      return snapshot;
    });
    await expect(repository.exportArchive()).rejects.toThrow('category-edit-pending');
    concurrent.mockRestore(); failure.mockRestore();
    expect(await repository.getPendingCategoryEdit('project')).not.toBeNull();
    await repository.retryCategoryEdit('project'); await inspectArchive(await repository.exportArchive());
  } finally { await repository.close(); secondStore.close(); }
});

it('cancels an interrupted edit by restoring the exact before rows and order without changing other-kind work', async () => {
  const repository = await openLocalRepository(databaseName());
  try {
    const { input } = await fixture(repository), initial = await rows(repository);
    const failure = failWrite(repository, 3);
    await expect(repository.editCustomCategory(input)).rejects.toThrow('category-edit-pending'); failure.mockRestore();
    const unrelated = asset('account', 'Created while pending'); await repository.save('asset', unrelated);
    await repository.cancelCategoryEdit('project');
    expect(await rows(repository)).toEqual(expect.arrayContaining(initial));
    expect((await rows(repository)).filter(row => row.type !== 'asset' || !row.id.endsWith(unrelated.id))).toEqual(initial);
    expect(await repository.getPendingCategoryEdit('project')).toBeNull(); expect(await repository.get('asset', unrelated.id)).toEqual(unrelated);
  } finally { await repository.close(); }
});

it('persists rollback direction before undo writes and resumes interrupted undo on reopen', async () => {
  const name = databaseName(); let repository = await openLocalRepository(name);
  try {
    const { input } = await fixture(repository), initial = await rows(repository);
    const cleanup = vi.spyOn(repository.fileStore.categoryEditJournal, 'delete').mockRejectedValueOnce(Error('injected-cleanup'));
    await expect(repository.editCustomCategory(input)).rejects.toThrow('category-edit-pending'); cleanup.mockRestore();
    const undoFailure = failWrite(repository, 2);
    await expect(repository.cancelCategoryEdit('project')).rejects.toThrow('category-edit-pending'); undoFailure.mockRestore();
    expect(await repository.getPendingCategoryEdit('project')).toMatchObject({ phase: 'rolling-back' });
    await repository.close(); repository = await openLocalRepository(name);
    expect(await rows(repository)).toEqual(initial); expect(await repository.getPendingCategoryEdit('project')).toBeNull();
  } finally { await repository.close(); }
});

it('retains conflicting intent and newer external fields on retry, cancellation and reopening; backups cannot hide the partial edit', async () => {
  const name = databaseName(); let repository = await openLocalRepository(name);
  try {
    const { assets, input } = await fixture(repository), archive = await repository.exportArchive();
    const failure = failWrite(repository, 3);
    await expect(repository.editCustomCategory(input)).rejects.toThrow('category-edit-pending'); failure.mockRestore();
    await externalEdit(repository, assets[0].id, { description: 'Newer external value' });
    const changed = await rows(repository);
    for (const action of [() => repository.retryCategoryEdit('project'), () => repository.cancelCategoryEdit('project'),
      () => repository.exportArchive(), () => repository.restoreArchive(archive), () => repository.previewArchiveMerge(archive)]) {
      await expect(action()).rejects.toThrow('category-edit-conflict'); expect(await rows(repository)).toEqual(changed);
      expect(await repository.getPendingCategoryEdit('project')).not.toBeNull();
    }
    await repository.close(); repository = await openLocalRepository(name);
    expect(repository.categoryEditRecoveryError).toBe('category-edit-conflict'); expect(await rows(repository)).toEqual(changed);
    await repository.save('asset', asset('account', 'Still available'));
    expect(await repository.get('asset', assets[0].id)).toMatchObject({ description: 'Newer external value' });
  } finally { await repository.close(); }
});

it('uses one native FileStore gate for two handles, without repository locks, and never applies a competing intent', async () => {
  const repository = await openLocalRepository(databaseName());
  const FileStore = repository.fileStore.constructor as new (name: string) => Repository['fileStore'];
  const secondStore = new FileStore(repository.db.name), second = new LocalRepository(repository.db, secondStore);
  try {
    const { input } = await fixture(repository);
    const results = await Promise.allSettled([editCustomCategory(repository.db, operationStore(repository), input),
      editCustomCategory(repository.db, operationStore(repository, secondStore), { ...input, name: 'Competing' })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await repository.fileStore.categoryEditJournal.count()).toBe(0);
    const currentCategory = await repository.get<Category>('category', input.expectedCategory.id);
    expect(['Beta', 'Competing']).toContain(currentCategory?.name);
    const freshAssets = await repository.list<Asset>('asset', true);
    const failure = failWrite(repository, 2);
    await expect(editCustomCategory(repository.db, operationStore(repository), { ...input,
      expectedCategory: currentCategory as Category, expectedAssets: freshAssets, name: 'Final' })).rejects.toThrow('injected-category-write');
    failure.mockRestore();
    await expect(second.save('asset', asset('project', 'Blocked by other handle'))).rejects.toThrow('category-edit-pending');
    await second.cancelCategoryEdit('project'); expect(await repository.fileStore.categoryEditJournal.count()).toBe(0);
  } finally { await repository.close(); secondStore.close(); }
});

it('rejects stale retry and cancellation for a resolved operation A when the same kind now has operation B', async () => {
  const repository = await openLocalRepository(databaseName());
  try {
    const { input } = await fixture(repository);
    const firstFailure = failWrite(repository, 2);
    await expect(repository.editCustomCategory(input)).rejects.toThrow('category-edit-pending'); firstFailure.mockRestore();
    const operationA = (await repository.getPendingCategoryEdit('project'))?.operationId as string;
    await repository.retryCategoryEdit('project', operationA);
    await expect(repository.cancelCategoryEdit('project', operationA)).rejects.toThrow('category-stale');
    await expect(repository.retryCategoryEdit('project', operationA)).rejects.toThrow('category-stale');
    const currentRows = await rows(repository);
    const category = JSON.parse(currentRows.find(row => row.type === 'category')?.payload as string) as Category;
    const assets = currentRows.filter(row => row.type === 'asset').map(row => JSON.parse(row.payload) as Asset);
    const secondFailure = failWrite(repository, 2);
    await expect(repository.editCustomCategory({ ...input, expectedCategory: category, expectedAssets: assets, name: 'Gamma' }))
      .rejects.toThrow('category-edit-pending'); secondFailure.mockRestore();
    const operationB = await repository.getPendingCategoryEdit('project');
    expect(operationB?.operationId).not.toBe(operationA); const pendingRows = await rows(repository);
    await expect(repository.cancelCategoryEdit('project', operationA)).rejects.toThrow('category-stale');
    await expect(repository.retryCategoryEdit('project', operationA)).rejects.toThrow('category-stale');
    expect(await rows(repository)).toEqual(pendingRows); expect(await repository.getPendingCategoryEdit('project')).toEqual(operationB);
    await repository.retryCategoryEdit('project', operationB?.operationId);
    expect(await repository.getPendingCategoryEdit('project')).toBeNull();
    expect(await repository.get('category', category.id)).toMatchObject({ name: 'Gamma' });
  } finally { await repository.close(); }
});

it.each(kinds)('deletes %s categories with one frozen intent, clears live and deleted names and supports safe cancellation after interruption', async kind => {
  const repository = await openLocalRepository(databaseName());
  try {
    const { category, assets } = await fixture(repository, kind), initial = await rows(repository);
    const failure = failWrite(repository, 3);
    await expect(repository.deleteCustomCategory({ expectedCategory: category, expectedAssets: assets })).rejects.toThrow('category-edit-pending'); failure.mockRestore();
    expect(await repository.getPendingCategoryEdit(kind)).toMatchObject({ deleting: true });
    await repository.cancelCategoryEdit(kind); expect(await rows(repository)).toEqual(initial);
    const deleted = await repository.deleteCustomCategory({ expectedCategory: category, expectedAssets: assets });
    expect(deleted).toEqual({ ...category, deleted: true });
    for (const index of [0, 1, 4]) expect(await repository.get('asset', assets[index].id)).toMatchObject({ category: '', deleted: assets[index].deleted });
    expect(await repository.get('asset', assets[2].id)).toEqual(assets[2]);
    expect((await repository.get<{ value: string[] }>('preference', `categoryOrder-${kind}`))?.value).toEqual(['builtin', 'Other']);
  } finally { await repository.close(); }
});
