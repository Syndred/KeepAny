import type { Asset } from '../../../packages/domain/src';
import { localRepository } from '../../../packages/local-db/src';
import * as review from '../../../packages/local-db/src/intake-review';

export type ReviewedCandidate = review.ReviewedCandidate;

export async function stageReviewedCandidates(rows: ReviewedCandidate[]): Promise<ReviewedCandidate[]> {
  return review.stageReviewedCandidates((await localRepository()).fileStore, rows);
}

export async function listReviewedCandidates(): Promise<ReviewedCandidate[]> {
  return review.listReviewedCandidates((await localRepository()).fileStore);
}

export async function getReviewedCandidate(id: string): Promise<ReviewedCandidate | undefined> {
  return review.getReviewedCandidate((await localRepository()).fileStore, id);
}

export async function editReviewedCandidate(id: string, asset: Asset, kindSelected?: boolean): Promise<boolean> {
  return review.editReviewedCandidate((await localRepository()).fileStore, id, asset, kindSelected);
}

export async function decideReviewedCandidate(id: string, status: "accepted" | "ignored"): Promise<void> {
  const repository = await localRepository();
  return review.decideReviewedCandidate(repository.fileStore, id, status,
    async assetId => !!(await repository.get('asset', assetId)));
}
