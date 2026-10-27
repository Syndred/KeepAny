import Dexie from 'dexie';
import type { RxDatabase } from 'rxdb';
import { assetSchema, type Asset } from '../../domain/src';
import { assertCategoryMutationAllowed, type CategoryEditStore } from './category-edit';
import type { RecordRow } from './index';
import { getReviewedCandidate, reviewedAssetMergeReceiptSchema, reviewedCandidateSchema,
  reviewedMergeFieldsForKind, sameReviewedCandidate, type ReviewedAssetMergeReceipt,
  type ReviewedCandidate, type ReviewedExpenseStorage, type ReviewedMergeField } from './intake-review';

export interface ReviewedAssetMergeStorage extends ReviewedExpenseStorage, CategoryEditStore {}
export interface ConfirmReviewedAssetMergeInput {
  expectedCandidate: ReviewedCandidate; expectedTarget: Asset; fields: ReviewedMergeField[];
}
export interface PendingReviewedAssetMerge {
  candidateId: string; targetId: string; committed: boolean;
}
export const reviewedAssetMergeJournalId = (candidateId: string) => `review-merge:${candidateId}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function previewReviewedAssetMerge(input: ConfirmReviewedAssetMergeInput,
  recordedAt = new Date().toISOString()): ReviewedAssetMergeReceipt {
  const candidate = reviewedCandidateSchema.parse(input.expectedCandidate), before = assetSchema.parse(input.expectedTarget);
  const allowed = reviewedMergeFieldsForKind(before.kind);
  if (candidate.status !== 'pending' || candidate.reviewMode === 'expense' || before.deleted || before.purged ||
    candidate.asset.kind !== before.kind || candidate.asset.id === before.id ||
    (candidate.source === 'pdf' && !candidate.kindSelected)) throw Error('review-merge-target');
  if (!input.fields.length || new Set(input.fields).size !== input.fields.length ||
    input.fields.some(field => !allowed.includes(field) || candidate.ai?.missingFields.includes(field))) throw Error('review-merge-fields');
  const changes = Object.fromEntries(input.fields.map(field => [field, candidate.asset[field]]));
  const after = assetSchema.safeParse({ ...before, ...changes, updatedAt: recordedAt });
  if (!after.success) throw Error('review-merge-invalid');
  const receipt = reviewedAssetMergeReceiptSchema.safeParse({ targetId: before.id, fields: input.fields, before, after: after.data, recordedAt });
  if (!receipt.success) throw Error('review-merge-fields');
  return receipt.data;
}

async function storedTarget(db: RxDatabase, id: string): Promise<Asset | null> {
  const [raw] = await db.records.storageInstance.findDocumentsById([`asset:${id}`], false);
  return raw ? assetSchema.parse(JSON.parse((raw as RecordRow).payload)) : null;
}
function acceptedCandidate(candidate: ReviewedCandidate, receipt: ReviewedAssetMergeReceipt): ReviewedCandidate {
  return reviewedCandidateSchema.parse({ ...candidate, status: 'accepted', merge: receipt });
}

/** Freeze the selected values before crossing the FileStore/RxDB transaction boundary. */
export async function confirmReviewedAssetMerge(db: RxDatabase, store: ReviewedAssetMergeStorage,
  input: ConfirmReviewedAssetMergeInput): Promise<Asset> {
  const expected = reviewedCandidateSchema.parse(input.expectedCandidate);
  const id = reviewedAssetMergeJournalId(expected.id);
  let receipt = previewReviewedAssetMerge(input);
  await store.transaction('rw', [store.intakeReview, store.importJournal, store.categoryEditJournal,
    ...(store.archiveMerge ? [store.archiveMerge.name] : []), ...(store.journal ? [store.journal.name] : [])], async () => {
    if (await store.archiveMerge?.count()) throw Error('archive-merge-pending');
    if (await store.journal?.count()) throw Error('restore-recovery-pending');
    await assertCategoryMutationAllowed(db, store, [{ type: 'asset', id: receipt.targetId, kind: receipt.before.kind }]);
    const current = await getReviewedCandidate(store, expected.id);
    if (!current) throw Error('review-merge-stale');
    const pending = await store.importJournal.get(id);
    if (pending) {
      const intent = pending.reviewedAssetMerge;
      if (!intent || !sameReviewedCandidate(intent.expectedCandidate, expected) ||
        !same(intent.receipt.before, receipt.before) || !same(intent.receipt.fields, receipt.fields)) throw Error('review-merge-stale');
      receipt = reviewedAssetMergeReceiptSchema.parse(intent.receipt);
      return;
    }
    if (current.status === 'accepted') {
      if (!current.merge || !sameReviewedCandidate(current, acceptedCandidate(expected, current.merge)) ||
        !same(current.merge.before, receipt.before) || !same(current.merge.fields, receipt.fields)) throw Error('review-merge-stale');
      receipt = current.merge;
      return;
    }
    if (!sameReviewedCandidate(current, expected)) throw Error('review-merge-stale');
    if ((await store.importJournal.toArray()).some(journal => journal.reviewedAssetMerge?.receipt.targetId === receipt.targetId)) throw Error('review-merge-pending');
    const target = await Dexie.waitFor(Dexie.ignoreTransaction(() => storedTarget(db, receipt.targetId)));
    if (!same(target, receipt.before)) throw Error('review-merge-stale');
    await store.importJournal.add({ id, reviewedAssetMerge: { expectedCandidate: expected, receipt }, rows: [{
      id: `asset:${receipt.targetId}`, type: 'asset', payload: JSON.stringify(receipt.after), updatedAt: Date.parse(receipt.recordedAt),
    }] });
  });
  const result = await replayReviewedAssetMerge(db, store, id);
  if (result) return result;
  const current = await getReviewedCandidate(store, expected.id);
  if (!current || !sameReviewedCandidate(current, acceptedCandidate(expected, receipt))) throw Error('review-merge-conflict');
  // A later legitimate edit does not invalidate the historical merge receipt.
  return receipt.after;
}

/** CAS writes preserve unrelated edits; a crash retains the frozen intent for retry. */
export async function replayReviewedAssetMerge(db: RxDatabase, store: ReviewedAssetMergeStorage, id: string): Promise<Asset | null> {
  return store.transaction('rw', store.intakeReview, store.importJournal, store.categoryEditJournal, async () => {
    const journal = await store.importJournal.get(id);
    if (!journal) return null;
    const intent = journal.reviewedAssetMerge;
    if (!intent || id !== reviewedAssetMergeJournalId(intent.expectedCandidate.id)) throw Error('review-merge-conflict');
    const expected = reviewedCandidateSchema.parse(intent.expectedCandidate), receipt = reviewedAssetMergeReceiptSchema.parse(intent.receipt);
    const planned = journal.rows[0];
    if (!same(previewReviewedAssetMerge({ expectedCandidate: expected, expectedTarget: receipt.before, fields: receipt.fields }, receipt.recordedAt), receipt) ||
      journal.rows.length !== 1 || planned?.type !== 'asset' || planned.id !== `asset:${receipt.targetId}` ||
      planned.payload !== JSON.stringify(receipt.after) || planned.updatedAt !== Date.parse(receipt.recordedAt)) throw Error('review-merge-conflict');
    const accepted = acceptedCandidate(expected, receipt), current = await getReviewedCandidate(store, expected.id);
    if (!current || (!sameReviewedCandidate(current, expected) && !sameReviewedCandidate(current, accepted))) throw Error('review-merge-conflict');
    await assertCategoryMutationAllowed(db, store, [{ type: 'asset', id: receipt.targetId, kind: receipt.before.kind }]);
    await Dexie.waitFor(Dexie.ignoreTransaction(async () => {
      const [raw] = await db.records.storageInstance.findDocumentsById([planned.id], true);
      const target = raw && !raw._deleted ? assetSchema.parse(JSON.parse((raw as RecordRow).payload)) : null;
      if (same(target, receipt.after)) return;
      if (!same(target, receipt.before)) throw Error('review-merge-conflict');
      const result = await db.records.storageInstance.bulkWrite([{ previous: raw, document: { ...raw, ...planned } }], 'intake-asset-merge');
      if (result.error.length) throw Error(result.error.some(error => error.status === 409) ? 'review-merge-conflict' : 'review-merge-pending');
    }));
    await store.intakeReview.put(accepted);
    await store.importJournal.delete(id);
    return receipt.after;
  });
}

export async function pendingReviewedAssetMerges(db: RxDatabase, store: ReviewedAssetMergeStorage): Promise<PendingReviewedAssetMerge[]> {
  const pending: PendingReviewedAssetMerge[] = [];
  for (const entry of await store.importJournal.toArray()) {
    if (!entry.reviewedAssetMerge) continue;
    const intent = entry.reviewedAssetMerge, receipt = reviewedAssetMergeReceiptSchema.parse(intent.receipt);
    if (entry.id !== reviewedAssetMergeJournalId(intent.expectedCandidate.id)) throw Error('review-merge-conflict');
    pending.push({ candidateId: intent.expectedCandidate.id, targetId: receipt.targetId,
      committed: same(await storedTarget(db, receipt.targetId), receipt.after) });
  }
  return pending;
}

export async function cancelReviewedAssetMerge(db: RxDatabase, store: ReviewedAssetMergeStorage, candidateId: string): Promise<'cancelled' | 'completed'> {
  const id = reviewedAssetMergeJournalId(candidateId);
  const cancelled = await store.transaction('rw', store.intakeReview, store.importJournal, async () => {
    const journal = await store.importJournal.get(id);
    if (!journal) return true;
    const intent = journal.reviewedAssetMerge;
    if (!intent || intent.expectedCandidate.id !== candidateId) throw Error('review-merge-conflict');
    const current = await getReviewedCandidate(store, candidateId);
    if (!current || !sameReviewedCandidate(current, intent.expectedCandidate)) throw Error('review-merge-conflict');
    const target = await Dexie.waitFor(Dexie.ignoreTransaction(() => storedTarget(db, intent.receipt.targetId)));
    if (same(target, intent.receipt.after)) return false;
    if (!same(target, intent.receipt.before)) throw Error('review-merge-conflict');
    await store.importJournal.delete(id);
    return true;
  });
  if (cancelled) return 'cancelled';
  await replayReviewedAssetMerge(db, store, id);
  return 'completed';
}
