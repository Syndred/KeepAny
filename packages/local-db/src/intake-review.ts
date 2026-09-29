import Dexie, { type Table } from 'dexie';
import { z } from 'zod';
import { assetSchema, type Asset } from '../../domain/src';

// Review rows are drafts. Preserve invalid editable text so users can continue
// correcting it after a backup is restored.
const draftText = z.string().max(1024 * 1024);
const draftAssetSchema = z.unknown().transform((value, context) => {
  const editable = z.object({ name: draftText, url: draftText, description: draftText }).safeParse(value);
  if (!editable.success || !value || typeof value !== 'object' || Array.isArray(value)) {
    context.addIssue({ code: 'custom', message: 'review-asset' });
    return z.NEVER;
  }
  const result = assetSchema.safeParse({ ...value, name: 'Review draft', url: '', description: '' });
  if (!result.success || result.data.attachments.length) {
    context.addIssue({ code: 'custom', message: 'review-asset' });
    return z.NEVER;
  }
  return { ...result.data, ...editable.data };
});

export const reviewedCandidateSchema = z.object({
  id: z.string().min(1).max(100), fileHash: z.string().regex(/^[a-f0-9]{64}$/),
  fileName: z.string().min(1).max(1024), rowNumber: z.number().int().min(1).max(100000),
  source: z.literal('pdf').optional(), sourceText: z.string().max(20000).optional(),
  kindSelected: z.boolean().optional(), asset: draftAssetSchema,
  status: z.enum(['pending', 'accepted', 'ignored']),
}).strict().superRefine((row, context) => {
  const suffix = row.source === 'pdf' ? '' : `-${row.rowNumber}`;
  const prefix = row.source === 'pdf' ? 'pdf' : 'csv';
  if (row.id !== `${prefix}-${row.fileHash}${suffix}` ||
    row.asset.id !== `${prefix}-${row.fileHash.slice(0, 48)}${suffix}` ||
    (row.source === 'pdf' ? row.rowNumber !== 1 || !row.sourceText : row.rowNumber < 2 || row.sourceText !== undefined)) {
    context.addIssue({ code: 'custom', message: 'review-id' });
  }
  if (row.status === 'accepted' && (!assetSchema.safeParse(row.asset).success ||
    (row.source === 'pdf' && !row.kindSelected))) context.addIssue({ code: 'custom', message: 'review-accepted' });
});

export type ReviewedCandidate = z.infer<typeof reviewedCandidateSchema>;
export interface IntakeReviewStorage {
  intakeReview: Table<ReviewedCandidate, string>;
  transaction: Dexie['transaction'];
}

export function parseReviewedCandidates(value: unknown): ReviewedCandidate[] {
  const rows = z.array(reviewedCandidateSchema).max(100000).parse(value);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error('archive-review-id');
  return rows;
}

export function sameReviewedCandidate(left: ReviewedCandidate, right: ReviewedCandidate): boolean {
  return JSON.stringify(reviewedCandidateSchema.parse(left)) === JSON.stringify(reviewedCandidateSchema.parse(right));
}

export function assertReviewedAssetReferences(rows: ReviewedCandidate[], assetIds: Set<string>): void {
  if (rows.some(row => row.status === 'accepted' && !assetIds.has(row.asset.id))) throw Error('archive-review-asset-reference');
}

/** Copy missing rows only; keep the source database intact for retry/recovery. */
export async function migrateLegacyIntakeReview(store: IntakeReviewStorage,
  sourceName = 'keepany-intake-review-v1', assetIds?: Set<string>): Promise<void> {
  if (!(await Dexie.exists(sourceName))) return;
  const legacy = new Dexie(sourceName);
  legacy.version(1).stores({ rows: 'id, fileHash, status' });
  try {
    const rows = parseReviewedCandidates(await legacy.table('rows').toArray());
    await store.transaction('rw', store.intakeReview, async () => {
      if (assetIds) {
        const final = new Map(parseReviewedCandidates(await store.intakeReview.toArray()).map(row => [row.id, row]));
        for (const row of rows) if (!final.has(row.id)) final.set(row.id, row);
        assertReviewedAssetReferences([...final.values()], assetIds);
      }
      for (const row of rows) if (!(await store.intakeReview.get(row.id))) await store.intakeReview.add(row);
    });
  } catch {
    throw Error('review-migration-failed');
  } finally { legacy.close(); }
}

export async function stageReviewedCandidates(store: IntakeReviewStorage, input: ReviewedCandidate[]): Promise<ReviewedCandidate[]> {
  if (!input.length) return [];
  const rows = parseReviewedCandidates(input);
  if (rows.some(row => row.fileHash !== rows[0].fileHash || row.status !== 'pending')) throw Error('review-stage');
  await store.transaction('rw', store.intakeReview, async () => {
    for (const row of rows) if (!(await store.intakeReview.get(row.id))) await store.intakeReview.add(row);
  });
  return store.intakeReview.where('fileHash').equals(rows[0].fileHash).sortBy('rowNumber');
}

export async function listReviewedCandidates(store: IntakeReviewStorage): Promise<ReviewedCandidate[]> {
  return parseReviewedCandidates(await store.intakeReview.toArray())
    .sort((a, b) => a.fileName.localeCompare(b.fileName) || a.rowNumber - b.rowNumber);
}

export async function getReviewedCandidate(store: IntakeReviewStorage, id: string): Promise<ReviewedCandidate | undefined> {
  const row = await store.intakeReview.get(id);
  return row ? reviewedCandidateSchema.parse(row) : undefined;
}

export async function editReviewedCandidate(store: IntakeReviewStorage, id: string, asset: Asset,
  kindSelected?: boolean): Promise<boolean> {
  return store.transaction('rw', store.intakeReview, async () => {
    const row = await store.intakeReview.get(id);
    if (row?.status !== 'pending') return false;
    await store.intakeReview.put(reviewedCandidateSchema.parse({ ...row, asset, kindSelected: kindSelected ?? row.kindSelected }));
    return true;
  });
}

export async function decideReviewedCandidate(store: IntakeReviewStorage, id: string,
  status: 'accepted' | 'ignored', assetExists: (assetId: string) => Promise<boolean>): Promise<void> {
  const row = await getReviewedCandidate(store, id);
  if (row?.status !== 'pending') return;
  if (status === 'accepted' && !(await assetExists(row.asset.id))) throw Error('review-asset-missing');
  await store.transaction('rw', store.intakeReview, async () => {
    const current = await store.intakeReview.get(id);
    if (current?.status !== 'pending') return;
    if (!sameReviewedCandidate(current, row)) throw Error('review-stale');
    await store.intakeReview.put({ ...current, status });
  });
}
