import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { newAsset, type Asset } from '../../domain/src';
import { openLocalRepository } from './index';
import { decryptBackup, encryptBackup } from './backup-crypto';
import { confirmReviewedAssetMerge, cancelReviewedAssetMerge, pendingReviewedAssetMerges,
  previewReviewedAssetMerge, replayReviewedAssetMerge, reviewedAssetMergeJournalId } from './intake-asset-merge';
import { editReviewedCandidate, getReviewedCandidate, listReviewedCandidates, reviewedCandidateSchema,
  parseReviewedCandidates, stageReviewedCandidates, type ReviewedCandidate, type ReviewedMergeField } from './intake-review';

const dbName = () => `test-${crypto.randomUUID().slice(0, 12)}`;
type Repository = Awaited<ReturnType<typeof openLocalRepository>>;
function candidate(): ReviewedCandidate {
  return { id: `csv-${'a'.repeat(64)}-2`, fileHash: 'a'.repeat(64), fileName: 'synthetic.csv', rowNumber: 2,
    sourceText: '\ufeffkind,name,url,description\r\nproject,Reviewed name,https://review.example.test,New text\r\n',
    asset: { ...newAsset('project'), id: `csv-${'a'.repeat(48)}-2`, name: 'Reviewed name',
      url: 'https://review.example.test', description: 'New text', category: 'new category', tags: ['new'] }, status: 'pending' };
}
async function setup(repository: Repository, input = candidate()) {
  const target: Asset = { ...newAsset(input.asset.kind), name: 'Original name', description: 'Original text',
    url: 'https://old.example.test', notes: 'Do not replace notes', tags: ['old'], category: 'old category' };
  await repository.save('asset', target);
  await stageReviewedCandidates(repository.fileStore, [input]);
  return { expectedCandidate: input, expectedTarget: target, fields: ['description'] as ReviewedMergeField[] };
}

it('merges only explicitly selected fields, keeps identity and relations, and records source plus complete old values', async () => {
  const repository = await openLocalRepository(dbName());
  try {
    const input = await setup(repository), neighbor = { ...newAsset('account'), name: 'Related account' };
    await repository.save('asset', neighbor);
    const relation = { id: crypto.randomUUID(), from: input.expectedTarget.id, to: neighbor.id, label: 'Owner', createdAt: new Date().toISOString(), verifiedAt: '', deleted: false };
    await repository.save('relation', relation);
    const actual = await confirmReviewedAssetMerge(repository.records, repository.fileStore, input);
    expect(actual).toEqual({ ...input.expectedTarget, description: 'New text', updatedAt: actual.updatedAt });
    expect(await repository.get('asset', input.expectedCandidate.asset.id)).toBeNull();
    expect(await repository.get('relation', relation.id)).toEqual(relation);
    expect(await repository.list('asset')).toHaveLength(2);
    expect(await getReviewedCandidate(repository.fileStore, input.expectedCandidate.id)).toMatchObject({
      status: 'accepted', asset: input.expectedCandidate.asset, sourceText: input.expectedCandidate.sourceText,
      merge: { targetId: actual.id, fields: ['description'], before: input.expectedTarget, after: actual },
    });
    await confirmReviewedAssetMerge(repository.records, repository.fileStore, input);
    expect(await repository.get('asset', actual.id)).toEqual(actual);
    expect(await repository.fileStore.importJournal.count()).toBe(0);
  } finally { await repository.close(); }
});

it('allows an unchecked invalid URL draft while rejecting a selected invalid URL without side effects', async () => {
  const repository = await openLocalRepository(dbName());
  try {
    const row = candidate(); row.asset.url = 'unfinished URL';
    const input = await setup(repository, row);
    await expect(confirmReviewedAssetMerge(repository.records, repository.fileStore, { ...input, fields: ['url'] })).rejects.toThrow('review-merge-invalid');
    expect(await repository.get('asset', input.expectedTarget.id)).toEqual(input.expectedTarget);
    expect(await repository.fileStore.importJournal.count()).toBe(0);
    await confirmReviewedAssetMerge(repository.records, repository.fileStore, input);
    expect((await getReviewedCandidate(repository.fileStore, row.id))?.asset.url).toBe('unfinished URL');
    expect((await repository.get<Asset>('asset', input.expectedTarget.id))?.url).toBe(input.expectedTarget.url);
  } finally { await repository.close(); }
});

it('requires explicit fields and a live same-type target and refuses identity, markers and attachment replacement', async () => {
  const repository = await openLocalRepository(dbName());
  try {
    const input = await setup(repository);
    for (const fields of [[], ['id'], ['attachments'], ['lastRenewalId'], ['name', 'name']]) {
      expect(() => previewReviewedAssetMerge({ ...input, fields: fields as ReviewedMergeField[] })).toThrow('review-merge-fields');
    }
    for (const expectedTarget of [{ ...input.expectedTarget, kind: 'account' as const },
      { ...input.expectedTarget, deleted: true }, { ...input.expectedTarget, id: input.expectedCandidate.asset.id }]) {
      await expect(confirmReviewedAssetMerge(repository.records, repository.fileStore, { ...input, expectedTarget })).rejects.toThrow('review-merge-target');
    }
    expect(await repository.get('asset', input.expectedTarget.id)).toEqual(input.expectedTarget);
    expect((await getReviewedCandidate(repository.fileStore, input.expectedCandidate.id))?.status).toBe('pending');
  } finally { await repository.close(); }
});

it('refuses a stale reviewed draft or changed target before freezing any intent', async () => {
  const repository = await openLocalRepository(dbName());
  try {
    const input = await setup(repository);
    await editReviewedCandidate(repository.fileStore, input.expectedCandidate.id, { ...input.expectedCandidate.asset, name: 'Newer candidate' });
    await expect(confirmReviewedAssetMerge(repository.records, repository.fileStore, input)).rejects.toThrow('review-merge-stale');
    const nextCandidate = await getReviewedCandidate(repository.fileStore, input.expectedCandidate.id);
    if (!nextCandidate) throw Error('fixture-candidate-missing');
    const newerTarget = { ...input.expectedTarget, notes: 'A concurrent note', updatedAt: new Date().toISOString() };
    await repository.save('asset', newerTarget);
    await expect(confirmReviewedAssetMerge(repository.records, repository.fileStore, { ...input, expectedCandidate: nextCandidate })).rejects.toThrow('review-merge-stale');
    expect(await repository.get('asset', newerTarget.id)).toEqual(newerTarget);
    expect(await repository.fileStore.importJournal.count()).toBe(0);
  } finally { await repository.close(); }
});

it('retains a frozen draft after a failed write, blocks edits, supports cancellation and retries once', async () => {
  const repository = await openLocalRepository(dbName());
  try {
    const input = await setup(repository), original = repository.db.records.storageInstance.bulkWrite.bind(repository.db.records.storageInstance);
    const failure = vi.spyOn(repository.db.records.storageInstance, 'bulkWrite').mockImplementation((rows, context) => {
      if (context === 'intake-asset-merge') throw Error('synthetic-write-failed');
      return original(rows, context);
    });
    await expect(confirmReviewedAssetMerge(repository.records, repository.fileStore, input)).rejects.toThrow('synthetic-write-failed');
    failure.mockRestore();
    expect(await pendingReviewedAssetMerges(repository.records, repository.fileStore)).toEqual([{ candidateId: input.expectedCandidate.id, targetId: input.expectedTarget.id, committed: false }]);
    await expect(editReviewedCandidate(repository.fileStore, input.expectedCandidate.id, input.expectedCandidate.asset)).rejects.toThrow('review-merge-pending');
    expect(await cancelReviewedAssetMerge(repository.records, repository.fileStore, input.expectedCandidate.id)).toBe('cancelled');
    expect(await repository.get('asset', input.expectedTarget.id)).toEqual(input.expectedTarget);
    await confirmReviewedAssetMerge(repository.records, repository.fileStore, input);
    expect((await getReviewedCandidate(repository.fileStore, input.expectedCandidate.id))?.status).toBe('accepted');
    expect(await repository.fileStore.importJournal.count()).toBe(0);
  } finally { await repository.close(); }
});

it('replays an interruption after the RxDB CAS without losing the old values or duplicating the asset', async () => {
  const repository = await openLocalRepository(dbName());
  try {
    const input = await setup(repository);
    const failure = vi.spyOn(repository.fileStore.intakeReview, 'put').mockRejectedValueOnce(Error('synthetic-receipt-interruption'));
    await expect(confirmReviewedAssetMerge(repository.records, repository.fileStore, input)).rejects.toThrow('synthetic-receipt-interruption');
    failure.mockRestore();
    expect(await pendingReviewedAssetMerges(repository.records, repository.fileStore)).toEqual([{ candidateId: input.expectedCandidate.id, targetId: input.expectedTarget.id, committed: true }]);
    expect((await getReviewedCandidate(repository.fileStore, input.expectedCandidate.id))?.status).toBe('pending');
    expect(await cancelReviewedAssetMerge(repository.records, repository.fileStore, input.expectedCandidate.id)).toBe('completed');
    expect((await getReviewedCandidate(repository.fileStore, input.expectedCandidate.id))?.merge?.before).toEqual(input.expectedTarget);
    expect(await repository.list('asset')).toHaveLength(1);
    expect(await repository.fileStore.importJournal.count()).toBe(0);
  } finally { await repository.close(); }
});

it('does not overwrite a newer target edit when an interrupted merge is retried', async () => {
  const repository = await openLocalRepository(dbName());
  try {
    const input = await setup(repository);
    const failure = vi.spyOn(repository.fileStore.intakeReview, 'put').mockRejectedValueOnce(Error('interrupted'));
    await expect(confirmReviewedAssetMerge(repository.records, repository.fileStore, input)).rejects.toThrow('interrupted');
    failure.mockRestore();
    const merged = await repository.get<Asset>('asset', input.expectedTarget.id);
    if (!merged) throw Error('fixture-target-missing');
    const newer = { ...merged, description: 'A later edit', updatedAt: new Date().toISOString() };
    await repository.save('asset', newer);
    await expect(replayReviewedAssetMerge(repository.records, repository.fileStore, reviewedAssetMergeJournalId(input.expectedCandidate.id))).rejects.toThrow('review-merge-conflict');
    expect(await repository.get('asset', newer.id)).toEqual(newer);
    expect(await repository.fileStore.importJournal.count()).toBe(1);
    expect((await getReviewedCandidate(repository.fileStore, input.expectedCandidate.id))?.status).toBe('pending');
  } finally { await repository.close(); }
});

it('encrypted backup restores accepted merge receipts by the target ID with no phantom candidate asset', async () => {
  const repository = await openLocalRepository(dbName()), restored = await openLocalRepository(dbName());
  try {
    const input = await setup(repository);
    await confirmReviewedAssetMerge(repository.records, repository.fileStore, input);
    const accepted = await listReviewedCandidates(repository.fileStore);
    const encrypted = await encryptBackup(await repository.exportArchive(), 'synthetic-merge-password');
    await restored.restoreArchive(await decryptBackup(encrypted, 'synthetic-merge-password'));
    expect(await listReviewedCandidates(restored.fileStore)).toEqual(accepted);
    expect(await restored.list('asset')).toHaveLength(1);
    expect(await restored.get('asset', input.expectedCandidate.asset.id)).toBeNull();
  } finally { await repository.close(); await restored.close(); }
});

it('keeps legacy CSV rows and complete CSV source text while rejecting forged merge receipts', () => {
  const row = candidate();
  expect(reviewedCandidateSchema.parse(row).sourceText).toBe(row.sourceText);
  const { sourceText: _source, ...legacy } = row;
  expect(reviewedCandidateSchema.parse(legacy)).toEqual(legacy);
  const target = { ...newAsset('project'), name: 'Existing' }, receipt = previewReviewedAssetMerge({ expectedCandidate: row, expectedTarget: target, fields: ['name'] });
  expect(reviewedCandidateSchema.safeParse({ ...row, status: 'accepted', merge: { ...receipt, after: { ...receipt.after, notes: 'Unselected change' } } }).success).toBe(false);
  expect(reviewedCandidateSchema.safeParse({ ...row, status: 'pending', merge: receipt }).success).toBe(false);
});

it('reopens an interrupted merge safely instead of treating its target as an inserted import to roll back', async () => {
  const name = dbName();
  let repository = await openLocalRepository(name);
  try {
    const input = await setup(repository);
    const failure = vi.spyOn(repository.fileStore.intakeReview, 'put').mockRejectedValueOnce(Error('interrupted-receipt'));
    await expect(confirmReviewedAssetMerge(repository.records, repository.fileStore, input)).rejects.toThrow('interrupted-receipt');
    failure.mockRestore();
    await repository.close();
    repository = await openLocalRepository(name);
    expect((await repository.get<Asset>('asset', input.expectedTarget.id))?.description).toBe('New text');
    expect((await getReviewedCandidate(repository.fileStore, input.expectedCandidate.id))?.merge?.before).toEqual(input.expectedTarget);
    expect(await repository.fileStore.importJournal.count()).toBe(0);
    expect(await repository.list('asset')).toHaveLength(1);
  } finally { await repository.close(); }
});

it('blocks backup and restore while an uncommitted merge intent is frozen', async () => {
  const repository = await openLocalRepository(dbName());
  try {
    const input = await setup(repository), archive = await repository.exportArchive();
    const original = repository.db.records.storageInstance.bulkWrite.bind(repository.db.records.storageInstance);
    const failure = vi.spyOn(repository.db.records.storageInstance, 'bulkWrite').mockImplementation((rows, context) => {
      if (context === 'intake-asset-merge') throw Error('write-failed');
      return original(rows, context);
    });
    await expect(confirmReviewedAssetMerge(repository.records, repository.fileStore, input)).rejects.toThrow('write-failed');
    failure.mockRestore();
    await expect(repository.exportArchive()).rejects.toThrow('review-merge-pending');
    await expect(repository.restoreArchive(archive)).rejects.toThrow('review-merge-pending');
    await cancelReviewedAssetMerge(repository.records, repository.fileStore, input.expectedCandidate.id);
    expect(await repository.exportArchive()).toBeInstanceOf(Uint8Array);
  } finally { await repository.close(); }
});

it('stores a near-2MiB CSV once for 200 candidates and preserves exact BOM/CRLF text through an actual backup restore', async () => {
  const repository = await openLocalRepository(dbName()), restored = await openLocalRepository(dbName());
  try {
    const base = candidate(), lines = Array.from({ length: 200 }, (_, index) => `project,Row ${index + 1},${index === 0 ? 'x'.repeat(2 * 1024 * 1024 - 10000) : 'small'}\r\n`);
    const original = `\ufeffkind,name,ignored\r\n${lines.join('')}`;
    expect(new TextEncoder().encode(original).length).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(original.length).toBeGreaterThan(2_000_000);
    const rows: ReviewedCandidate[] = Array.from({ length: 200 }, (_, index) => {
      const { sourceText: _source, ...rest } = base;
      return { ...rest, id: `csv-${base.fileHash}-${index + 2}`, rowNumber: index + 2,
        asset: { ...base.asset, id: `csv-${base.fileHash.slice(0, 48)}-${index + 2}`, name: `Row ${index + 1}` },
        ...(index === 0 ? { sourceText: original } : { sourceTextRef: base.fileHash }) };
    });
    await stageReviewedCandidates(repository.fileStore, rows);
    const actual = await listReviewedCandidates(repository.fileStore);
    expect(actual.filter(row => row.sourceText !== undefined)).toHaveLength(1);
    expect(JSON.stringify(actual).length).toBeLessThan(3 * 1024 * 1024);
    const archive = await repository.exportArchive();
    expect(archive.length).toBeLessThan(300 * 1024 * 1024);
    await restored.restoreArchive(archive);
    const roundTrip = await listReviewedCandidates(restored.fileStore);
    expect(roundTrip).toEqual(actual);
    expect(roundTrip[0].sourceText).toBe(original);
    expect(roundTrip.filter(row => row.sourceTextRef === base.fileHash)).toHaveLength(199);
    expect(() => parseReviewedCandidates(rows.slice(1))).toThrow('archive-review-source-reference');
  } finally { await repository.close(); await restored.close(); }
});

it('purges a merged target receipt and moves the CSV source carrier to its remaining candidate', async () => {
  const repository = await openLocalRepository(dbName());
  try {
    const input = await setup(repository), { sourceText: _source, ...source } = candidate();
    const remaining: ReviewedCandidate = { ...source, id: `csv-${source.fileHash}-3`, rowNumber: 3, sourceTextRef: source.fileHash,
      asset: { ...source.asset, id: `csv-${source.fileHash.slice(0, 48)}-3`, name: 'Remaining candidate' } };
    // The stage input is a complete source group; existing carrier and its draft are preserved.
    await stageReviewedCandidates(repository.fileStore, [input.expectedCandidate, remaining]);
    await confirmReviewedAssetMerge(repository.records, repository.fileStore, input);
    await repository.deleteEntity('asset', input.expectedTarget.id);
    await repository.purgeTrash(await repository.previewTrashPurge([{ type: 'asset', id: input.expectedTarget.id }]));
    const rows = await listReviewedCandidates(repository.fileStore);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: remaining.id, sourceText: input.expectedCandidate.sourceText });
    expect(rows[0].sourceTextRef).toBeUndefined();
    expect(await getReviewedCandidate(repository.fileStore, input.expectedCandidate.id)).toBeUndefined();
    expect((await repository.get<Asset>('asset', input.expectedTarget.id))?.purged).toBe(true);
    expect(await repository.exportArchive()).toBeInstanceOf(Uint8Array);
  } finally { await repository.close(); }
});
