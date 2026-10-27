import { assertCategoryMutationAllowed, type CategoryEditStore } from './category-edit';
import { getReviewedCandidate, reviewedCandidateSchema, sameReviewedCandidate, type ReviewedCandidate, type ReviewedExpenseStorage } from './intake-review';
import { reviewedAcceptanceSchema, type ReviewedAcceptance } from './intake-receipt';
import type { RecordRow } from './index';
import type { RecordBackend } from './storage-contracts';

export interface ReviewedWithdrawalIntent {
  expected: ReviewedCandidate; before: ReviewedAcceptance; after: ReviewedAcceptance; recordedAt: string;
}
export interface WithdrawalStorage extends ReviewedExpenseStorage, CategoryEditStore {}
export interface PendingReviewedWithdrawal { candidateId: string; committed: boolean }
export const reviewedWithdrawalJournalId = (candidateId: string) => `review-withdraw:${candidateId}`;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const acceptance = (row: ReviewedCandidate) => row.acceptedRecord;

function withdrawalPlan(expected: ReviewedCandidate, recordedAt: string): ReviewedWithdrawalIntent {
  if (expected.status !== 'accepted') throw Error('review-withdraw-stale');
  if (expected.merge) return { expected, before: { type: 'asset', value: expected.merge.after }, after: { type: 'asset', value: expected.merge.before }, recordedAt };
  const receipt = acceptance(expected);
  if (!receipt) throw Error('review-withdraw-missing-receipt');
  const before = reviewedAcceptanceSchema.parse(receipt);
  if (before.value.deleted || before.value.purged || before.type === 'asset' && before.value.id !== expected.asset.id || before.type === 'history' &&
    (expected.reviewMode !== 'expense' || before.value.id !== expected.historyId || before.value.action !== 'expense')) throw Error('review-withdraw-conflict');
  const after = reviewedAcceptanceSchema.parse({ type: before.type, value: { ...before.value, deleted: true,
    ...(before.type === 'asset' ? { updatedAt: recordedAt } : {}) } });
  return { expected, before, after, recordedAt };
}
function checkedIntent(value: ReviewedWithdrawalIntent): ReviewedWithdrawalIntent {
  const expected = reviewedCandidateSchema.parse(value.expected), at = new Date(value.recordedAt).toISOString();
  const planned = withdrawalPlan(expected, at);
  if (!same(planned, value)) throw Error('review-withdraw-conflict');
  return planned;
}
const withdrawn = (intent: ReviewedWithdrawalIntent) => reviewedCandidateSchema.parse({ ...intent.expected, status: 'withdrawn', withdrawnAt: intent.recordedAt });
const rowFor = (receipt: ReviewedAcceptance, at: string): RecordRow => ({ id: `${receipt.type}:${receipt.value.id}`, type: receipt.type, payload: JSON.stringify(receipt.value), updatedAt: Date.parse(at) });

/** Freeze one reviewed decision and exact record snapshots before any record write. */
export async function withdrawReviewedCandidate(db: RecordBackend, store: WithdrawalStorage, input: ReviewedCandidate): Promise<void> {
  const expected = reviewedCandidateSchema.parse(input), id = reviewedWithdrawalJournalId(expected.id);
  await store.transaction('rw', [store.intakeReview, store.importJournal, store.categoryEditJournal,
    ...(store.archiveMerge ? [store.archiveMerge.name] : []), ...(store.journal ? [store.journal.name] : [])], async scope => {
    if (await scope.archiveMerge?.count()) throw Error('archive-merge-pending');
    if (await scope.journal?.count()) throw Error('restore-recovery-pending');
    const existing = await scope.importJournal.get(id);
    if (existing?.reviewedWithdrawal) {
      if (!sameReviewedCandidate(existing.reviewedWithdrawal.expected, expected)) throw Error('review-withdraw-stale');
      return;
    }
    if (await scope.importJournal.get(`review-expense:${expected.id}`) || await scope.importJournal.get(`review-merge:${expected.id}`)) throw Error('review-withdraw-pending');
    const current = await getReviewedCandidate(scope, expected.id);
    if (!current || !sameReviewedCandidate(current, expected)) throw Error('review-withdraw-stale');
    const intent = withdrawalPlan(expected, new Date().toISOString());
    if (intent.before.type === 'asset') await assertCategoryMutationAllowed(scope.records, scope, [{ type: 'asset', id: intent.before.value.id, kind: intent.before.value.kind }]);
    const raw = await scope.outsideTransaction(() => scope.records.get(rowFor(intent.before, intent.recordedAt).id));
    if (!raw || raw.payload !== JSON.stringify(intent.before.value)) throw Error('review-withdraw-conflict');
    await scope.importJournal.add({ id, reviewedWithdrawal: intent, rows: [rowFor(intent.after, intent.recordedAt)] });
  });
  await replayReviewedWithdrawal(db, store, id);
}

/** CAS preserves later edits. A crash after the write retains the same durable intent. */
export async function replayReviewedWithdrawal(_db: RecordBackend, store: WithdrawalStorage, id: string): Promise<void> {
  await store.transaction('rw', [store.intakeReview, store.importJournal, store.categoryEditJournal], async scope => {
    const journal = await scope.importJournal.get(id);
    if (!journal) return;
    if (!journal.reviewedWithdrawal) throw Error('review-withdraw-conflict');
    const intent = checkedIntent(journal.reviewedWithdrawal), afterRow = rowFor(intent.after, intent.recordedAt);
    if (id !== reviewedWithdrawalJournalId(intent.expected.id) || journal.rows.length !== 1 || !same(journal.rows[0], afterRow)) throw Error('review-withdraw-conflict');
    const current = await getReviewedCandidate(scope, intent.expected.id), receipt = withdrawn(intent);
    if (!current || !sameReviewedCandidate(current, intent.expected) && !sameReviewedCandidate(current, receipt)) throw Error('review-withdraw-stale');
    if (intent.before.type === 'asset') await assertCategoryMutationAllowed(scope.records, scope, [{ type: 'asset', id: intent.before.value.id, kind: intent.before.value.kind }]);
    await scope.outsideTransaction(async () => {
      const raw = await scope.records.get(afterRow.id);
      if (raw?.payload === afterRow.payload) return;
      if (!raw || raw.payload !== JSON.stringify(intent.before.value)) throw Error('review-withdraw-conflict');
      const result = await scope.records.compareAndWrite([{ previous: raw, next: afterRow }], 'intake-withdrawal');
      if (result.error.length) throw Error(result.error.some(error => error.status === 409) ? 'review-withdraw-conflict' : 'review-withdraw-pending');
    });
    await scope.intakeReview.put(receipt);
    await scope.importJournal.delete(id);
  });
}
export async function pendingReviewedWithdrawals(db: RecordBackend, store: WithdrawalStorage): Promise<PendingReviewedWithdrawal[]> {
  const pending: PendingReviewedWithdrawal[] = [];
  for (const entry of await store.importJournal.toArray()) {
    if (!entry.reviewedWithdrawal) continue;
    const intent = checkedIntent(entry.reviewedWithdrawal);
    if (entry.id !== reviewedWithdrawalJournalId(intent.expected.id)) throw Error('review-withdraw-conflict');
    const raw = await db.get(rowFor(intent.after, intent.recordedAt).id);
    pending.push({ candidateId: intent.expected.id, committed: raw?.payload === JSON.stringify(intent.after.value) });
  }
  return pending;
}

/** Abandon an uncommitted withdrawal without touching a newer record. */
export async function cancelReviewedWithdrawal(db: RecordBackend, store: WithdrawalStorage, candidateId: string): Promise<'cancelled' | 'completed'> {
  const id = reviewedWithdrawalJournalId(candidateId);
  const completed = await store.transaction('rw', [store.intakeReview, store.importJournal], async scope => {
    const entry = await scope.importJournal.get(id);
    if (!entry?.reviewedWithdrawal) return false;
    const intent = checkedIntent(entry.reviewedWithdrawal);
    if (intent.expected.id !== candidateId) throw Error('review-withdraw-conflict');
    const raw = await scope.outsideTransaction(() => scope.records.get(rowFor(intent.after, intent.recordedAt).id));
    if (raw?.payload === JSON.stringify(intent.after.value)) return true;
    const current = await getReviewedCandidate(scope, candidateId);
    if (!current || !sameReviewedCandidate(current, intent.expected)) throw Error('review-withdraw-stale');
    await scope.importJournal.delete(id);
    return false;
  });
  if (completed) { await replayReviewedWithdrawal(db, store, id); return 'completed'; }
  return 'cancelled';
}
