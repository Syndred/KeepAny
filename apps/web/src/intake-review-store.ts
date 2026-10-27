import type { Asset } from '../../../packages/domain/src';
import { localRepository } from '../../../packages/local-db/src';
import * as review from '../../../packages/local-db/src/intake-review';
import * as merge from '../../../packages/local-db/src/intake-asset-merge';

export type ReviewedCandidate = review.ReviewedCandidate;
export type ReviewedExpenseDraft = review.ReviewedExpenseDraft;
export type ReviewedMergeField = review.ReviewedMergeField;
export { reviewedMergeFieldsForKind } from '../../../packages/local-db/src/intake-review';
export { previewReviewedAssetMerge } from '../../../packages/local-db/src/intake-asset-merge';

export async function confirmReviewedAssetMerge(input: merge.ConfirmReviewedAssetMergeInput): Promise<Asset> {
  const repository = await localRepository();
  return merge.confirmReviewedAssetMerge(repository.db, repository.fileStore, input);
}
export async function pendingReviewedAssetMerges(): Promise<merge.PendingReviewedAssetMerge[]> {
  const repository = await localRepository();
  return merge.pendingReviewedAssetMerges(repository.db, repository.fileStore);
}
export async function retryReviewedAssetMerges(): Promise<void> {
  const repository = await localRepository();
  for (const entry of await repository.fileStore.importJournal.toArray()) {
    if (entry.reviewedAssetMerge) await merge.replayReviewedAssetMerge(repository.db, repository.fileStore, entry.id);
  }
}
export async function cancelReviewedAssetMerge(candidateId: string): Promise<'cancelled' | 'completed'> {
  const repository = await localRepository();
  return merge.cancelReviewedAssetMerge(repository.db, repository.fileStore, candidateId);
}

export async function stageReviewedCandidates(rows: ReviewedCandidate[], isCurrent?: () => boolean): Promise<ReviewedCandidate[]> {
  return review.stageReviewedCandidates((await localRepository()).fileStore, rows, isCurrent);
}

export async function listReviewedCandidates(): Promise<ReviewedCandidate[]> {
  return review.listReviewedCandidates((await localRepository()).fileStore);
}

export async function getReviewedCandidate(id: string): Promise<ReviewedCandidate | undefined> {
  return review.getReviewedCandidate((await localRepository()).fileStore, id);
}

export async function editReviewedCandidate(id: string, asset: Asset, kindSelected?: boolean, resolvedField?: string): Promise<boolean> {
  return review.editReviewedCandidate((await localRepository()).fileStore, id, asset, kindSelected, resolvedField);
}

export async function setReviewedCandidateMode(id: string, mode: 'asset' | 'expense', initialDraft?: ReviewedExpenseDraft): Promise<boolean> {
  return review.setReviewedCandidateMode((await localRepository()).fileStore, id, mode, initialDraft);
}

export async function editReviewedExpenseDraft(id: string, draft: ReviewedExpenseDraft): Promise<boolean> {
  return review.editReviewedExpenseDraft((await localRepository()).fileStore, id, draft);
}

export async function decideReviewedCandidate(id: string, status: "accepted" | "ignored"): Promise<void> {
  const repository = await localRepository();
  return review.decideReviewedCandidate(repository.fileStore, id, status,
    async assetId => !!(await repository.get('asset', assetId)));
}
