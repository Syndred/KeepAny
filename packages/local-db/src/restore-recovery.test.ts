import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { entitySchemas, newAsset, type Asset, type History } from '../../domain/src';
import { LocalRepository, openLocalRepository, type DatasetBinding, type RecordRow, type RestoreRecoveryToken } from './index';
import { reviewedCandidateSchema, reviewedExpenseHistoryId } from './intake-review';
import { withCategoryMutationGate } from './category-edit';

const repositories: LocalRepository[] = [];
const extraStores: LocalRepository['fileStore'][] = [];
const databaseName = () => `test-${crypto.randomUUID().slice(0, 12)}`;
async function repository() {
  const value = await openLocalRepository(databaseName()); repositories.push(value); return value;
}
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  for (const store of extraStores.splice(0)) store.close();
  for (const value of repositories.splice(0)) await value.close();
});
function row(type: RecordRow['type'], value: unknown): RecordRow {
  const parsed = entitySchemas[type].parse(value);
  return { id: `${type}:${parsed.id}`, type, payload: JSON.stringify(parsed), updatedAt: 100 };
}
async function binding(accountId = 'restore-owner'): Promise<DatasetBinding> {
  const endpoint = 'https://sync.example.test', workspaceId = crypto.randomUUID();
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([endpoint, accountId])));
  const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  return { endpoint, accountId, workspaceId, scope: `${digest}:${workspaceId}` };
}
function secondHandle(first: LocalRepository) {
  const Store = first.fileStore.constructor as new (name: string) => LocalRepository['fileStore'];
  const store = new Store(first.records.name); extraStores.push(store);
  return new LocalRepository(first.records, store, first.recoveryState);
}
async function pendingToken(target: LocalRepository): Promise<RestoreRecoveryToken> {
  const pending = await target.getPendingRestoreRecoveries(); expect(pending).toHaveLength(1); return pending[0].token;
}
async function interruptedRestore(target: LocalRepository, archive: Uint8Array) {
  const insert = target.db.records.insert.bind(target.db.records);
  const fault = vi.spyOn(target.db.records, 'insert').mockImplementationOnce(value => insert(value))
    .mockRejectedValueOnce(Error('injected-restore-write'));
  await expect(target.restoreArchive(archive)).rejects.toThrow('injected-restore-write'); fault.mockRestore();
  return pendingToken(target);
}
async function archiveFixture(owner?: DatasetBinding) {
  const source = await repository();
  if (owner) await source.claimDatasetBinding(owner);
  const image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2hO8AAAAASUVORK5CYII=', 'base64'));
  const imageId = await source.putFile(new File([image], 'original.png', { type: 'image/png' }));
  const first = { ...newAsset('item'), id: 'a-original', name: 'Original record', notes: 'PRIVATE-RESTORE-NOTE', attachments: [imageId] };
  const hash = 'a'.repeat(64);
  const candidate = reviewedCandidateSchema.parse({ id: `csv-${hash}-2`, fileHash: hash, fileName: 'import.csv', rowNumber: 2,
    asset: { ...newAsset('project'), id: `csv-${hash.slice(0, 48)}-2`, name: 'Accepted record' }, status: 'accepted' });
  await source.save('asset', first); await source.save('asset', candidate.asset);
  await source.fileStore.intakeReview.add(candidate);
  return { archive: await source.exportArchive(), first, candidate, imageId, image };
}

it('acquires the native mutation gate before invoking a callback with no category targets', async () => {
  const target = await repository(), other = secondHandle(target);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const holding = target.fileStore.transaction('rw', target.fileStore.categoryEditJournal, async () => {
    await target.fileStore.categoryEditJournal.count(); entered(); await Dexie.waitFor(held);
  });
  await started;
  let callbackEntered = false;
  const mutation = withCategoryMutationGate(target.records, other.fileStore, [], async () => { callbackEntered = true; return 'mutated'; });
  const outcomes = Promise.allSettled([holding, mutation]);
  try {
    await new Promise(resolve => setTimeout(resolve, 10)); expect(callbackEntered).toBe(false);
  } finally { release(); await outcomes; }
  expect(await outcomes).toMatchObject([{ status: 'fulfilled' }, { status: 'fulfilled', value: 'mutated' }]);
  expect(callbackEntered).toBe(true);
});

it('retries a real interrupted restore with separate row/candidate counts and opaque metadata', async () => {
  const fixture = await archiveFixture(await binding()), target = await repository();
  const token = await interruptedRestore(target, fixture.archive);
  const [pending] = await target.getPendingRestoreRecoveries();
  expect(pending).toMatchObject({ rowCount: 2, candidateCount: 1, presentEqual: 1, missing: 1, different: 0,
    canRetry: true, canAbandon: true, reason: null });
  expect(JSON.stringify(pending)).not.toContain('PRIVATE-RESTORE-NOTE');
  expect(JSON.stringify(pending)).not.toContain('Original record');
  expect(await target.fileStore.intakeReview.count()).toBe(0);
  expect(await target.retryRestoreRecovery(token)).toBe('completed');
  expect(await target.allRecords()).toHaveLength(2);
  expect(await target.fileStore.intakeReview.get(fixture.candidate.id)).toEqual(fixture.candidate);
  expect((await target.readFile(fixture.imageId))?.bytes).toEqual(fixture.image);
  expect(await target.getPendingRestoreRecoveries()).toEqual([]); expect(target.restoreRecoveryError).toBeNull();
  await expect(target.retryRestoreRecovery(token)).rejects.toThrow('restore-recovery-stale');
});

it('keeps a newer tombstone, current image and provenance when abandoning only the remaining restore', async () => {
  const owner = await binding(), fixture = await archiveFixture(owner), target = await repository();
  const token = await interruptedRestore(target, fixture.archive);
  await target.save('asset', { ...fixture.first, name: 'Newer local edit', deleted: true });
  const before = await target.allRecords(), files = await target.fileStore.blobs.toArray();
  expect((await target.getPendingRestoreRecoveries())[0]).toMatchObject({ different: 1, canRetry: false,
    canAbandon: true, reason: 'restore-conflict' });
  await expect(target.retryRestoreRecovery(token)).rejects.toThrow('restore-conflict');
  expect(await target.abandonRestoreRecovery(token)).toBe('kept-current');
  expect(await target.allRecords()).toEqual(before); expect(await target.fileStore.blobs.toArray()).toEqual(files);
  expect((await target.readFile(fixture.imageId))?.bytes).toEqual(fixture.image);
  expect(await target.fileStore.intakeReview.count()).toBe(0); expect(await target.getDatasetBinding()).toEqual(owner);
  expect(await target.get<Asset>('asset', fixture.candidate.asset.id)).toBeNull();
  await expect(target.claimDatasetBinding(await binding('another-owner'))).rejects.toThrow('sync-dataset-bound');
});

it.each(['unknown', 'foreign'])('retains a bound %s-source journal and refuses both self-service actions', async kind => {
  const target = await repository(), owner = await binding(); await target.claimDatasetBinding(owner);
  await target.fileStore.journal.add({ id: 'legacy-source', rows: [], ...(kind === 'foreign' ? { sourceBinding: await binding('foreign') } : {}) });
  const [pending] = await target.getPendingRestoreRecoveries();
  expect(pending).toMatchObject({ canRetry: false, canAbandon: false, reason: 'restore-source-identity' });
  for (const action of [() => target.retryRestoreRecovery(pending.token), () => target.abandonRestoreRecovery(pending.token)])
    await expect(action()).rejects.toThrow('restore-source-identity');
  expect(await target.fileStore.journal.count()).toBe(1); expect(await target.getDatasetBinding()).toEqual(owner);
});

it.each(['legacy', 'single scope', 'multiple scopes'])('refuses unbound recovery with %s remote proof', async kind => {
  const target = await repository();
  if (kind === 'legacy') await target.fileStore.syncBase.add({ id: 'old', payload: '{}', version: 1 });
  else {
    await target.fileStore.scopedMeta.add({ id: (await binding()).scope, cursor: 0 });
    if (kind === 'multiple scopes') await target.fileStore.scopedMeta.add({ id: (await binding()).scope, cursor: 0 });
  }
  await target.fileStore.journal.add({ id: 'local-legacy', rows: [] }); const token = await pendingToken(target);
  await expect(target.retryRestoreRecovery(token)).rejects.toThrow('sync-dataset-ambiguous');
  await expect(target.abandonRestoreRecovery(token)).rejects.toThrow('sync-dataset-ambiguous');
  expect(await target.fileStore.journal.count()).toBe(1); expect(await target.getDatasetBinding()).toBeNull();
});

it('rejects an ordinary unbound restore before writing files when old remote proof exists', async () => {
  const fixture = await archiveFixture(), target = await repository();
  await target.fileStore.syncMeta.add({ id: 'cursor', cursor: 2 });
  await expect(target.restoreArchive(fixture.archive)).rejects.toThrow('sync-dataset-ambiguous');
  expect(await target.allRecords()).toEqual([]); expect(await target.fileStore.blobs.count()).toBe(0);
  expect(await target.fileStore.journal.count()).toBe(0);
});

it('retains declared-source recovery when the claimed binding is missing', async () => {
  const target = await repository(); await target.fileStore.journal.add({ id: 'unclaimed', rows: [], sourceBinding: await binding() });
  const token = await pendingToken(target);
  await expect(target.retryRestoreRecovery(token)).rejects.toThrow('restore-source-identity');
  await expect(target.abandonRestoreRecovery(token)).rejects.toThrow('restore-source-identity');
  expect(await target.fileStore.journal.count()).toBe(1);
});

it('allows pure local keep-current and leaves unrelated journals and the warning intact', async () => {
  const target = await repository();
  for (const value of [{ id: 'one', rows: [] }, { id: 'two', rows: [] }]) await target.fileStore.journal.add(value);
  const [first] = await target.getPendingRestoreRecoveries(); await target.abandonRestoreRecovery(first.token);
  expect(await target.fileStore.journal.keys()).toEqual(['two']);
  expect(target.restoreRecoveryError).toBe('restore-recovery-pending'); expect(await target.getDatasetBinding()).toBeNull();
  await target.abandonRestoreRecovery((await target.getPendingRestoreRecoveries())[0].token);
  expect(target.restoreRecoveryError).toBeNull(); expect(await target.claimDatasetBinding(await binding())).toBeTruthy();
});

it.each(['history', 'relation', 'image'])('refuses keep-current with an incomplete actual %s reference', async kind => {
  const target = await repository();
  if (kind === 'history') await target.db.records.insert(row('history', { id: 'history', assetId: 'missing', action: 'maintenance', note: '', createdAt: '2026-09-30' }));
  else if (kind === 'relation') await target.db.records.insert(row('relation', { id: 'relation', from: 'missing-a', to: 'missing-b', label: 'Uses', createdAt: '2026-09-30' }));
  else await target.db.records.insert(row('asset', { ...newAsset('item'), attachments: [crypto.randomUUID()] }));
  await target.fileStore.journal.add({ id: 'retain', rows: [] }); const token = await pendingToken(target);
  const before = await target.allRecords();
  await expect(target.abandonRestoreRecovery(token)).rejects.toThrow(`archive-${kind === 'image' ? 'attachment' : kind}-reference`);
  expect(await target.allRecords()).toEqual(before); expect(await target.fileStore.journal.count()).toBe(1);
});

it('requires the actual accepted expense receipt and lets retry complete its missing History', async () => {
  const target = await repository(), asset = { ...newAsset('subscription'), name: 'Billed service' }; await target.save('asset', asset);
  const hash = 'b'.repeat(64), historyId = reviewedExpenseHistoryId(hash);
  const candidate = reviewedCandidateSchema.parse({ id: `pdf-${hash}`, fileHash: hash, fileName: 'invoice.pdf', rowNumber: 1,
    source: 'pdf', sourceText: 'Invoice', asset: { ...newAsset('item'), id: `pdf-${hash.slice(0, 48)}`, name: 'Invoice' },
    status: 'accepted', reviewMode: 'expense', historyId,
    expenseDraft: { assetId: asset.id, title: 'Invoice', amount: '12.34', currency: 'CNY', eventDate: '2026-09-30', source: 'invoice.pdf', note: '' } });
  await target.fileStore.intakeReview.add(candidate);
  const history = row('history', { id: historyId, assetId: asset.id, action: 'expense', title: 'Invoice', amount: 1234,
    currency: 'CNY', eventDate: '2026-09-30', source: 'invoice.pdf', note: '', createdAt: '2026-09-30T00:00:00.000Z' });
  await target.fileStore.journal.add({ id: 'expense-receipt', rows: [history], intakeReview: [candidate] });
  const [pending] = await target.getPendingRestoreRecoveries(); expect(pending.canRetry).toBe(true); expect(pending.canAbandon).toBe(false);
  await expect(target.abandonRestoreRecovery(pending.token)).rejects.toThrow('archive-review-history-reference');
  await target.retryRestoreRecovery(pending.token);
  const current = await target.get<History>('history', historyId); await target.save('history', { ...current, amount: 999 });
  await target.fileStore.journal.add({ id: 'wrong-receipt', rows: [] });
  await expect(target.abandonRestoreRecovery(await pendingToken(target))).rejects.toThrow('archive-review-history-reference');
});

it('serializes a local history edit with keep-current validation and preserves the later write', async () => {
  const target = await repository(), asset = { ...newAsset('subscription'), name: 'Receipt owner' };
  await target.save('asset', asset);
  const hash = 'c'.repeat(64), historyId = reviewedExpenseHistoryId(hash);
  const candidate = reviewedCandidateSchema.parse({ id: `pdf-${hash}`, fileHash: hash, fileName: 'receipt.pdf', rowNumber: 1,
    source: 'pdf', sourceText: 'Receipt', asset: { ...newAsset('item'), id: `pdf-${hash.slice(0, 48)}`, name: 'Receipt' },
    status: 'accepted', reviewMode: 'expense', historyId,
    expenseDraft: { assetId: asset.id, title: 'Receipt', amount: '12.34', currency: 'CNY', eventDate: '2026-09-30', source: 'receipt.pdf', note: '' } });
  const history = entitySchemas.history.parse({ id: historyId, assetId: asset.id, action: 'expense', title: 'Receipt', amount: 1234,
    currency: 'CNY', eventDate: '2026-09-30', source: 'receipt.pdf', note: '', createdAt: '2026-09-30T00:00:00.000Z' });
  await target.save('history', history); await target.fileStore.intakeReview.add(candidate);
  await target.fileStore.journal.add({ id: 'checked-receipt', rows: [] });
  const token = await pendingToken(target), other = secondHandle(target);
  const query = target.db.records.storageInstance.query.bind(target.db.records.storageInstance);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const pause = vi.spyOn(target.db.records.storageInstance, 'query').mockImplementationOnce(async input => {
    const snapshot = await query(input); entered(); await held; return snapshot;
  });
  const abandon = target.abandonRestoreRecovery(token); await started;
  let edited = false;
  const edit = other.save('history', { ...history, note: 'Later local note' }).then(value => { edited = true; return value; });
  const outcomes = Promise.allSettled([abandon, edit]);
  try {
    await new Promise(resolve => setTimeout(resolve, 10)); expect(edited).toBe(false);
  } finally { release(); await outcomes; pause.mockRestore(); }
  expect(await outcomes).toMatchObject([{ status: 'fulfilled', value: 'kept-current' }, { status: 'fulfilled' }]);
  expect(await target.get<History>('history', historyId)).toMatchObject({ ...history, note: 'Later local note' });
  expect(await target.fileStore.journal.count()).toBe(0); expect(await target.fileStore.intakeReview.get(candidate.id)).toEqual(candidate);
});

it('retains the restore intent when a newer receipt edit wins the native mutation gate', async () => {
  const target = await repository(), asset = { ...newAsset('subscription'), name: 'Receipt owner' };
  await target.save('asset', asset);
  const hash = 'd'.repeat(64), historyId = reviewedExpenseHistoryId(hash);
  const candidate = reviewedCandidateSchema.parse({ id: `pdf-${hash}`, fileHash: hash, fileName: 'receipt.pdf', rowNumber: 1,
    source: 'pdf', sourceText: 'Receipt', asset: { ...newAsset('item'), id: `pdf-${hash.slice(0, 48)}`, name: 'Receipt' },
    status: 'accepted', reviewMode: 'expense', historyId,
    expenseDraft: { assetId: asset.id, title: 'Receipt', amount: '12.34', currency: 'CNY', eventDate: '2026-09-30', source: 'receipt.pdf', note: '' } });
  const history = entitySchemas.history.parse({ id: historyId, assetId: asset.id, action: 'expense', title: 'Receipt', amount: 1234,
    currency: 'CNY', eventDate: '2026-09-30', source: 'receipt.pdf', note: '', createdAt: '2026-09-30T00:00:00.000Z' });
  await target.save('history', history); await target.fileStore.intakeReview.add(candidate);
  await target.fileStore.journal.add({ id: 'newer-receipt', rows: [] });
  const token = await pendingToken(target), other = secondHandle(target);
  const write = target.db.records.storageInstance.bulkWrite.bind(target.db.records.storageInstance);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const pause = vi.spyOn(target.db.records.storageInstance, 'bulkWrite').mockImplementationOnce(async (...args) => {
    entered(); await held; return write(...args);
  });
  const edit = other.save('history', { ...history, note: 'Third version' }); await started;
  let resolved = false;
  const abandon = target.abandonRestoreRecovery(token).finally(() => { resolved = true; });
  const outcomes = Promise.allSettled([edit, abandon]);
  try {
    await new Promise(resolve => setTimeout(resolve, 10)); expect(resolved).toBe(false);
  } finally { release(); await outcomes; pause.mockRestore(); }
  expect(await outcomes).toMatchObject([{ status: 'fulfilled' },
    { status: 'rejected', reason: new Error('archive-review-history-reference') }]);
  expect(await target.get<History>('history', historyId)).toMatchObject({ ...history, note: 'Third version' });
  expect(await target.fileStore.journal.count()).toBe(1); expect(await target.fileStore.intakeReview.get(candidate.id)).toEqual(candidate);
});

it('does not collect a restored image after waiting on an in-flight native restore transaction', async () => {
  const fixture = await archiveFixture(), target = await repository(), token = await interruptedRestore(target, fixture.archive);
  // Only the missing row needs this image. Before the recovery it is protected
  // by the journal; afterwards it is protected by the newly stored asset.
  const original = await target.get<Asset>('asset', fixture.first.id);
  if (original) await target.save('asset', { ...original, attachments: [] });
  const journal = await target.fileStore.journal.get(token.journalId);
  if (!journal) throw Error('restore-journal-missing');
  const missing = journal.rows.find(entry => entry.id === `asset:${fixture.candidate.asset.id}`);
  if (!missing) throw Error('restore-row-missing');
  const withImage = { ...fixture.candidate.asset, attachments: [fixture.imageId] };
  await target.fileStore.journal.update(journal.id, { rows: [row('asset', withImage)] });
  const nextToken = await pendingToken(target), other = secondHandle(target);
  const insert = target.db.records.insert.bind(target.db.records);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const pause = vi.spyOn(target.db.records, 'insert').mockImplementationOnce(async value => { entered(); await held; return insert(value); });
  const retry = target.retryRestoreRecovery(nextToken); await started;
  const cleanup = other.cleanupUnreferencedFile(fixture.imageId), outcomes = Promise.allSettled([retry, cleanup]);
  await new Promise(resolve => setTimeout(resolve, 10)); release();
  expect(await outcomes).toMatchObject([{ status: 'fulfilled', value: 'completed' }, { status: 'fulfilled', value: false }]);
  pause.mockRestore();
  expect((await target.readFile(fixture.imageId))?.bytes).toEqual(fixture.image);
  expect(await target.get<Asset>('asset', withImage.id)).toMatchObject({ attachments: [fixture.imageId] });
});

it.each(['edit', 'completion', 'restore'])('serializes a local task %s with the recovery snapshot without losing it', async kind => {
  const target = await repository();
  const task = entitySchemas.task.parse({ id: crypto.randomUUID(), name: 'Current task', createdAt: '2026-09-30', deleted: kind === 'restore' });
  await target.save('task', task); await target.fileStore.journal.add({ id: 'task-snapshot', rows: [] });
  const token = await pendingToken(target), other = secondHandle(target);
  const query = target.db.records.storageInstance.query.bind(target.db.records.storageInstance);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const pause = vi.spyOn(target.db.records.storageInstance, 'query').mockImplementationOnce(async input => {
    const snapshot = await query(input); entered(); await held; return snapshot;
  });
  const abandon = target.abandonRestoreRecovery(token); await started;
  let mutated = false;
  const mutation = (kind === 'edit' ? other.saveTaskIfCurrent(task, { ...task, name: 'Later task edit' })
    : kind === 'completion' ? other.setTaskDone(task.id, false) : other.restoreEntity('task', task.id))
    .then(value => { mutated = true; return value; });
  const outcomes = Promise.allSettled([abandon, mutation]);
  try {
    await new Promise(resolve => setTimeout(resolve, 10)); expect(mutated).toBe(false);
  } finally { release(); await outcomes; pause.mockRestore(); }
  expect(await outcomes).toMatchObject([{ status: 'fulfilled', value: 'kept-current' }, { status: 'fulfilled' }]);
  const current = await target.get('task', task.id);
  expect(current).toMatchObject(kind === 'edit' ? { name: 'Later task edit' } : kind === 'completion' ? { done: true } : { deleted: false });
  expect(await target.fileStore.journal.count()).toBe(0);
});

it.each(['retry', 'keep-current'])('resumes scoped push, acknowledgement and pull after %s resolves the last restore intent', async kind => {
  const owner = await binding(), fixture = await archiveFixture(owner), target = await repository();
  const token = await interruptedRestore(target, fixture.archive);
  if (kind === 'retry') await target.retryRestoreRecovery(token);
  else await target.abandonRestoreRecovery(token);
  expect(await target.getPendingRestoreRecoveries()).toEqual([]);
  expect(await target.pinScopedKey(owner.scope, 'f'.repeat(64), 1)).toBe('provisional');
  const records = await target.dirtyScopedRows(owner.scope), restored = records.find(entry => entry.id === `asset:${fixture.first.id}`);
  if (!restored) throw Error('restored-record-missing');
  const operation = { operationId: crypto.randomUUID(), id: restored.id, kind: restored.type, schemaVersion: 1,
    expectedVersion: 0, ciphertext: 'resumed-ciphertext', tombstone: false, intent: 'write' as const };
  await target.stageScopedOutbox(owner.scope, restored, operation);
  await target.acknowledgeScopedOutbox(owner.scope, operation.operationId, 1, 1);
  expect(await target.applyScopedPull(owner.scope, { row: restored, sequence: 1, version: 1,
    operationId: operation.operationId, keyEpoch: 1, ciphertext: operation.ciphertext })).toBe('applied');
  expect(await target.scopedCursor(owner.scope)).toBe(1); expect(await target.listScopedOutbox(owner.scope)).toEqual([]);
  expect((await target.scopedBaseFor(owner.scope, restored.id))?.payload).toBe(restored.payload);
  expect(await target.getDatasetBinding()).toEqual(owner); expect(await target.allRecords()).toEqual(records);
});

it('rejects stale A actions after resolution and after the same legacy key becomes plan B', async () => {
  const target = await repository(); await target.fileStore.journal.add({ id: 'reused-legacy', rows: [] });
  const token = await pendingToken(target); await target.abandonRestoreRecovery(token);
  await expect(target.retryRestoreRecovery(token)).rejects.toThrow('restore-recovery-stale');
  await target.fileStore.journal.add({ id: token.journalId, rows: [row('asset', newAsset('project'))] });
  const planB = await target.fileStore.journal.get(token.journalId);
  for (const action of [() => target.retryRestoreRecovery(token), () => target.abandonRestoreRecovery(token)])
    await expect(action()).rejects.toThrow('restore-recovery-stale');
  expect(await target.fileStore.journal.get(token.journalId)).toEqual(planB); expect(await target.allRecords()).toEqual([]);
});

it('rejects changed dataset proof and tokens from another local dataset', async () => {
  const target = await repository(); await target.fileStore.journal.add({ id: 'same-plan', rows: [] });
  const token = await pendingToken(target), other = await repository(); await other.fileStore.journal.add({ id: 'same-plan', rows: [] });
  await expect(other.abandonRestoreRecovery(token)).rejects.toThrow('restore-recovery-stale');
  await target.fileStore.scopedMeta.add({ id: (await binding()).scope, cursor: 0 });
  await expect(target.abandonRestoreRecovery(token)).rejects.toThrow('restore-recovery-stale');
  expect(await target.fileStore.journal.count()).toBe(1); expect(await other.fileStore.journal.count()).toBe(1);
});

it('does not confuse same-owner metadata or cursor growth with dataset replacement', async () => {
  const target = await repository(), owner = await binding(); await target.claimDatasetBinding(owner);
  await target.fileStore.journal.add({ id: 'same-owner', rows: [], sourceBinding: owner }); const token = await pendingToken(target);
  await target.fileStore.scopedMeta.add({ id: owner.scope, cursor: 4, keyFingerprint: 'f'.repeat(64), keyEpoch: 1 });
  await target.retryRestoreRecovery(token);
  expect(await target.fileStore.scopedMeta.get(owner.scope)).toMatchObject({ cursor: 4, keyEpoch: 1 });
});

it('serializes native retry then abandon across two handles without Web Locks', async () => {
  vi.stubGlobal('navigator', { locks: undefined });
  const fixture = await archiveFixture(), target = await repository(), token = await interruptedRestore(target, fixture.archive);
  const other = secondHandle(target), insert = target.db.records.insert.bind(target.db.records);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const pause = vi.spyOn(target.db.records, 'insert').mockImplementationOnce(async value => { entered(); await held; return insert(value); });
  const retry = target.retryRestoreRecovery(token); await started;
  let cancelled = false;
  const abandon = other.abandonRestoreRecovery(token).finally(() => { cancelled = true; });
  const outcomes = Promise.allSettled([retry, abandon]);
  await new Promise(resolve => setTimeout(resolve, 10)); expect(cancelled).toBe(false);
  release(); expect(await outcomes).toMatchObject([{ status: 'fulfilled', value: 'completed' },
    { status: 'rejected', reason: new Error('restore-recovery-stale') }]); pause.mockRestore();
  expect(await target.allRecords()).toHaveLength(2); expect(await target.fileStore.journal.count()).toBe(0);
});

it('serializes native abandon then retry without recreating cancelled rows', async () => {
  vi.stubGlobal('navigator', { locks: undefined });
  const target = await repository(); await target.fileStore.journal.add({ id: 'cancel-first', rows: [row('asset', newAsset('project'))] });
  const token = await pendingToken(target), other = secondHandle(target), query = target.db.records.storageInstance.query.bind(target.db.records.storageInstance);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const pause = vi.spyOn(target.db.records.storageInstance, 'query').mockImplementationOnce(async input => { entered(); await held; return query(input); });
  const abandon = target.abandonRestoreRecovery(token); await started;
  const retry = other.retryRestoreRecovery(token), outcomes = Promise.allSettled([abandon, retry]);
  release(); expect(await outcomes).toMatchObject([{ status: 'fulfilled', value: 'kept-current' },
    { status: 'rejected', reason: new Error('restore-recovery-stale') }]); pause.mockRestore();
  expect(await target.allRecords()).toEqual([]); expect(await target.fileStore.journal.count()).toBe(0);
});

it('blocks scoped and legacy sync writes while keeping local CRUD available', async () => {
  const target = await repository(), owner = await binding(); await target.claimDatasetBinding(owner);
  await target.fileStore.journal.add({ id: 'sync-paused', rows: [], sourceBinding: owner });
  const asset = newAsset('project'), incoming = row('asset', asset);
  for (const action of [() => target.pinScopedKey(owner.scope, 'f'.repeat(64), 1),
    () => target.applyIncoming('asset', asset, null), () => target.applyScopedPull(owner.scope, { row: incoming, sequence: 1, version: 1 }),
    () => target.applyPulledBatch([{ row: incoming, sequence: 1, version: 1 }], 0),
    () => target.stageScopedOutbox(owner.scope, incoming, { operationId: crypto.randomUUID(), id: incoming.id, kind: 'asset', schemaVersion: 1,
      expectedVersion: 0, ciphertext: 'ciphertext', tombstone: false, intent: 'write' }),
    () => target.putSyncedFile({ id: crypto.randomUUID(), name: 'remote.png', type: 'image/png', bytes: new Uint8Array([1]), sha256: 'f'.repeat(64) })])
    await expect(action()).rejects.toThrow('restore-recovery-pending');
  await target.save('asset', asset); expect(await target.get<Asset>('asset', asset.id)).toMatchObject({ id: asset.id });
  expect(await target.fileStore.scopedOutbox.count()).toBe(0); expect(await target.fileStore.scopedPull.count()).toBe(0);
  expect(await target.fileStore.pullJournal.count()).toBe(0);
});

it.each(['outbox', 'scoped pull', 'legacy pull', 'incoming', 'key', 'image'])('rechecks ordinary recovery at the actual %s sync commit after its public precheck', async kind => {
  const target = await repository(), owner = await binding(); await target.claimDatasetBinding(owner);
  const asset = newAsset('project'); await target.save('asset', asset);
  const stored = (await target.allRecords())[0], incoming = row('asset', newAsset('project'));
  const other = secondHandle(target);
  const seam = target as unknown as { assertArchiveMergeSyncAllowed(): Promise<void> };
  const precheck = seam.assertArchiveMergeSyncAllowed.bind(target);
  const pause = vi.spyOn(seam, 'assertArchiveMergeSyncAllowed').mockImplementationOnce(async () => {
    await precheck(); await other.fileStore.journal.add({ id: 'raced-restore', rows: [], sourceBinding: owner });
  });
  const bytes = new Uint8Array([1, 2, 3]);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const action = kind === 'outbox' ? () => target.stageScopedOutbox(owner.scope, stored, {
    operationId: crypto.randomUUID(), id: stored.id, kind: 'asset', schemaVersion: 1,
    expectedVersion: 0, ciphertext: 'ciphertext', tombstone: false, intent: 'write',
  }) : kind === 'scoped pull' ? () => target.applyScopedPull(owner.scope, { row: incoming, sequence: 1, version: 1 })
    : kind === 'legacy pull' ? () => target.applyPulledBatch([{ row: incoming, sequence: 1, version: 1 }], 0)
    : kind === 'incoming' ? () => target.applyIncoming('asset', JSON.parse(incoming.payload), null)
    : kind === 'key' ? () => target.pinScopedKey(owner.scope, 'f'.repeat(64), 1)
    : () => target.putSyncedFile({ id: crypto.randomUUID(), name: 'remote.png', type: 'image/png', bytes, sha256: digest });
  await expect(action()).rejects.toThrow('restore-recovery-pending'); pause.mockRestore();
  expect(await target.allRecords()).toEqual([stored]);
  expect(await target.fileStore.scopedOutbox.count()).toBe(0); expect(await target.fileStore.scopedPull.count()).toBe(0);
  expect(await target.fileStore.pullJournal.count()).toBe(0); expect(await target.fileStore.blobs.count()).toBe(0);
  expect(await target.fileStore.scopedMeta.count()).toBe(0); expect(await target.fileStore.journal.count()).toBe(1);
});

it.each(['renewal', 'subscription'])('does not consume a pending %s financial intent during retry or keep-current', async kind => {
  const target = await repository(), asset = { ...newAsset('subscription'), name: 'Pending service' };
  await target.save('asset', asset); await target.fileStore.journal.add({ id: 'ordinary-restore', rows: [] });
  const token = await pendingToken(target), next = row('asset', asset), id = crypto.randomUUID();
  if (kind === 'renewal') await target.fileStore.renewalJournal.add({ id, assetId: asset.id, expectedPayload: next.payload, next,
    history: row('history', { id, assetId: asset.id, action: 'renew', note: '', createdAt: '2026-09-30' }) });
  else await target.fileStore.subscriptionSaveJournal.add({ id, assetId: asset.id, expectedMarker: '', next, relations: [] });
  const before = await target.allRecords(), journals = await target.fileStore.journal.toArray();
  const financial = kind === 'renewal' ? await target.fileStore.renewalJournal.toArray() : await target.fileStore.subscriptionSaveJournal.toArray();
  const reason = kind === 'renewal' ? 'renewal-recovery-pending' : 'subscription-relations-pending';
  expect((await target.getPendingRestoreRecoveries())[0]).toMatchObject({ canRetry: false, canAbandon: false, reason });
  await expect(target.retryRestoreRecovery(token)).rejects.toThrow(reason);
  await expect(target.abandonRestoreRecovery(token)).rejects.toThrow(reason);
  expect(await target.allRecords()).toEqual(before); expect(await target.fileStore.journal.toArray()).toEqual(journals);
  expect(kind === 'renewal' ? await target.fileStore.renewalJournal.toArray() : await target.fileStore.subscriptionSaveJournal.toArray()).toEqual(financial);
});

it('reports an invalid legacy journal without breaking local readable assets', async () => {
  const target = await repository(), asset = newAsset('item'); await target.save('asset', asset);
  await target.fileStore.journal.add({ id: 'invalid', rows: [{ id: 'asset:bad', type: 'asset', payload: '{}', updatedAt: 0 }] });
  const [pending] = await target.getPendingRestoreRecoveries(); expect(pending).toMatchObject({ canRetry: false, canAbandon: false, reason: 'restore-recovery-invalid' });
  await expect(target.abandonRestoreRecovery(pending.token)).rejects.toThrow('restore-recovery-invalid');
  expect(await target.get<Asset>('asset', asset.id)).toMatchObject({ id: asset.id }); expect(await target.fileStore.journal.count()).toBe(1);
});

it('validates legacy schema defaults without rewriting current transport payloads', async () => {
  const target = await repository(), asset = newAsset('item');
  const { attachments: omitted, ...legacy } = asset; expect(omitted).toEqual([]);
  const original = { id: `asset:${asset.id}`, type: 'asset' as const, payload: JSON.stringify(legacy), updatedAt: 100 };
  await target.db.records.insert(original); await target.fileStore.journal.add({ id: 'legacy-defaults', rows: [] });
  const [pending] = await target.getPendingRestoreRecoveries(); expect(pending).toMatchObject({ canRetry: true, canAbandon: true, reason: null });
  await target.abandonRestoreRecovery(pending.token); expect(await target.allRecords()).toEqual([original]);
});

it('preserves existing same-owner queued operations, cursor and key proof when keeping current records', async () => {
  const owner = await binding(), fixture = await archiveFixture(owner), target = await repository();
  await target.claimDatasetBinding(owner);
  await target.save('asset', { ...newAsset('account'), name: 'Existing account' });
  const existing = (await target.allRecords())[0];
  await target.pinScopedKey(owner.scope, 'f'.repeat(64), 1);
  await target.stageScopedOutbox(owner.scope, existing, { operationId: crypto.randomUUID(), id: existing.id, kind: 'asset',
    schemaVersion: 1, expectedVersion: 0, ciphertext: 'existing-ciphertext', tombstone: false, intent: 'write' });
  await target.fileStore.scopedMeta.update(owner.scope, { cursor: 4 });
  const token = await interruptedRestore(target, fixture.archive);
  const before = { binding: await target.getDatasetBinding(), rows: await target.allRecords(),
    meta: await target.fileStore.scopedMeta.toArray(), outbox: await target.fileStore.scopedOutbox.toArray(),
    base: await target.fileStore.scopedBase.toArray(), pulls: await target.fileStore.scopedPull.toArray(),
    uploads: await target.fileStore.scopedAttachmentUploads.toArray() };
  await target.abandonRestoreRecovery(token);
  expect({ binding: await target.getDatasetBinding(), rows: await target.allRecords(),
    meta: await target.fileStore.scopedMeta.toArray(), outbox: await target.fileStore.scopedOutbox.toArray(),
    base: await target.fileStore.scopedBase.toArray(), pulls: await target.fileStore.scopedPull.toArray(),
    uploads: await target.fileStore.scopedAttachmentUploads.toArray() }).toEqual(before);
  expect((await target.readFile(fixture.imageId))?.bytes).toEqual(fixture.image);
});
