import { beforeEach, expect, test, vi } from 'vitest';
import type { ReviewedCandidate } from './intake-review-store';
import { parseReviewedCandidates } from '../../../packages/local-db/src/intake-review';

const stage = vi.hoisted(() => vi.fn(async (rows: ReviewedCandidate[], _current?: () => boolean) => rows));
vi.mock('./intake-review-store', () => ({ stageReviewedCandidates: stage }));
import { stageTextForReview } from './intake-text';
beforeEach(() => stage.mockClear());

test('local text retains exact original, stable per-record IDs and ordinary blank fields without an AI request', async () => {
  const text = 'Alpha\r\n\r\nBeta\n第三项';
  expect(await stageTextForReview(text, 'project', 'Text capture')).toBe(3);
  const rows = stage.mock.calls[0][0];
  expect(parseReviewedCandidates(rows)).toEqual(rows);
  expect(rows.map(row => row.asset.name)).toEqual(['Alpha', 'Beta', '第三项']);
  expect(rows.every(row => row.source === 'text' && row.sourceText === text && row.status === 'pending' && !row.ai && row.asset.amount === 0 && !row.asset.url)).toBe(true);
  await stageTextForReview(text, 'project', 'Renamed source');
  expect(stage.mock.calls[1][0].map(row => row.id)).toEqual(rows.map(row => row.id));
  expect(new Set(rows.map(row => row.asset.id)).size).toBe(3);
});

test('text invalid input, explicit secrets and cancelled hashing stage no partial drafts', async () => {
  for (const text of ['', 'x'.repeat(161), 'valid\n'.repeat(201), 'x\n'.repeat(10_001)]) await expect(stageTextForReview(text, 'item', 'Text')).rejects.toThrow('text-limit');
  await expect(stageTextForReview('password: synthetic-password', 'account', 'Text')).rejects.toThrow('text-secret');
  await expect(stageTextForReview('Ordinary', 'project', 'Text', () => false)).rejects.toThrow('review-cancelled');
  expect(stage).not.toHaveBeenCalled();
});
