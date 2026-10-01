import Dexie, { type Table } from 'dexie';
import type { RxDatabase } from 'rxdb';
import { z } from 'zod';
import { assetSchema, currencies, historySchema, parseMinorUnits, type Asset, type History } from '../../domain/src';
import type { RecordRow } from './index';

// Review rows are drafts. Preserve invalid editable text so users can continue
// correcting it after a backup is restored.
const draftText = z.string().max(1024 * 1024);
export const reviewedExpenseDraftSchema = z.object({
  assetId: z.string().max(96), title: draftText, amount: draftText,
  currency: z.enum(currencies), eventDate: draftText, source: draftText, note: draftText,
}).strict();
export type ReviewedExpenseDraft = z.infer<typeof reviewedExpenseDraftSchema>;
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
  source: z.enum(['pdf', 'ai']).optional(), sourceText: z.string().max(20000).optional(),
  ai: z.object({ provider: z.string().min(1).max(64), model: z.string().min(1).max(160),
    evidence: z.string().min(1).max(2000), missingFields: z.array(z.string().max(60)).max(20),
    relatedName: z.string().max(160).default('') }).strict().optional(),
  kindSelected: z.boolean().optional(), asset: draftAssetSchema,
  reviewMode: z.enum(['asset', 'expense']).optional(), expenseDraft: reviewedExpenseDraftSchema.optional(),
  historyId: z.string().max(96).optional(),
  status: z.enum(['pending', 'accepted', 'ignored']),
}).strict().superRefine((row, context) => {
  const suffix = row.source === 'pdf' ? '' : `-${row.rowNumber}`;
  const prefix = row.source === 'pdf' ? 'pdf' : row.source === 'ai' ? 'ai' : 'csv';
  if (row.id !== `${prefix}-${row.fileHash}${suffix}` ||
    row.asset.id !== `${prefix}-${row.fileHash.slice(0, 48)}${suffix}` ||
    (row.source === 'pdf' ? row.rowNumber !== 1 || !row.sourceText : row.source === 'ai' ? row.rowNumber < 1 || !row.sourceText || !row.ai : row.rowNumber < 2 || row.sourceText !== undefined)) {
    context.addIssue({ code: 'custom', message: 'review-id' });
  }
  if ((row.source === 'ai') !== Boolean(row.ai)) context.addIssue({ code: 'custom', message: 'review-ai-source' });
  if (row.reviewMode === 'expense') {
    if (row.source !== 'pdf' || !row.expenseDraft || (row.status === 'accepted' &&
      (row.historyId !== reviewedExpenseHistoryId(row.fileHash) || !expenseHistory(row)))) {
      context.addIssue({ code: 'custom', message: 'review-expense' });
    }
  } else if (row.historyId !== undefined || (row.status === 'accepted' && (!assetSchema.safeParse(row.asset).success ||
    (row.source === 'pdf' && !row.kindSelected)))) context.addIssue({ code: 'custom', message: 'review-accepted' });
  if (row.status === 'accepted' && row.source === 'ai' && row.asset.kind === 'subscription' && row.ai?.missingFields.some(field => ['amount', 'currency', 'cycle'].includes(field))) context.addIssue({ code: 'custom', message: 'review-ai-missing' });
  if (row.status !== 'accepted' && row.historyId !== undefined) context.addIssue({ code: 'custom', message: 'review-history' });
});

export type ReviewedCandidate = z.infer<typeof reviewedCandidateSchema>;
export interface IntakeReviewStorage {
  intakeReview: Table<ReviewedCandidate, string>;
  importJournal?: Table<ReviewedImportJournal, string>;
  transaction: Dexie['transaction'];
}
export interface ReviewedImportJournal {
  id: string; rows: RecordRow[]; reviewedExpense?: ReviewedCandidate;
}
export interface ReviewedExpenseStorage extends IntakeReviewStorage {
  importJournal: Table<ReviewedImportJournal, string>;
  archiveMerge?: Pick<Table<{ id: string }, string>, 'name' | 'count'>;
  journal?: Pick<Table<{ id: string }, string>, 'name' | 'count'>;
}
export interface PendingReviewedExpenseConfirmation {
  candidateId: string; historyId: string; committed: boolean;
}

export const reviewedExpenseHistoryId = (fileHash: string): string => `pdf-expense-${fileHash}`;
export const reviewedExpenseJournalId = (candidateId: string): string => `review-expense:${candidateId}`;

// Draft strings may be incomplete. Validation happens only at confirmation.
function expenseHistory(row: { fileHash: string; expenseDraft?: ReviewedExpenseDraft }, createdAt = new Date().toISOString()): History | null {
  const draft = row.expenseDraft;
  if (!draft?.amount.trim() || draft.amount.trim().length > 32) return null;
  const parsed = historySchema.safeParse({ id: reviewedExpenseHistoryId(row.fileHash), action: 'expense',
    assetId: draft.assetId, title: draft.title.trim(), amount: parseMinorUnits(draft.amount, draft.currency),
    currency: draft.currency, eventDate: draft.eventDate, source: draft.source.trim(), note: draft.note,
    createdAt, deleted: false });
  return parsed.success ? parsed.data : null;
}

function matchesExpenseReceipt(row: ReviewedCandidate, value: unknown): value is History {
  const parsed = historySchema.safeParse(value), expected = expenseHistory(row);
  if (!parsed.success || !expected) return false;
  return (['id', 'assetId', 'action', 'title', 'amount', 'currency', 'eventDate', 'source', 'note'] as const)
    .every(field => parsed.data[field] === expected[field]);
}

export function parseReviewedCandidates(value: unknown): ReviewedCandidate[] {
  const rows = z.array(reviewedCandidateSchema).max(100000).parse(value);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error('archive-review-id');
  return rows;
}

export function sameReviewedCandidate(left: ReviewedCandidate, right: ReviewedCandidate): boolean {
  return JSON.stringify(reviewedCandidateSchema.parse(left)) === JSON.stringify(reviewedCandidateSchema.parse(right));
}

export function assertReviewedAssetReferences(rows: ReviewedCandidate[], assetIds: Set<string>, histories = new Map<string, History>()): void {
  for (const row of rows.filter(row => row.status === 'accepted')) {
    if (row.reviewMode === 'expense') {
      if (!row.historyId || !matchesExpenseReceipt(row, histories.get(row.historyId)) ||
        !assetIds.has(row.expenseDraft?.assetId ?? '')) throw Error('archive-review-history-reference');
    } else if (!assetIds.has(row.asset.id)) throw Error('archive-review-asset-reference');
  }
}

/** Copy missing rows only; keep the source database intact for retry/recovery. */
export async function migrateLegacyIntakeReview(store: IntakeReviewStorage,
  sourceName = 'keepany-intake-review-v1', assetIds?: Set<string>, histories?: Map<string, History>): Promise<void> {
  if (!(await Dexie.exists(sourceName))) return;
  const legacy = new Dexie(sourceName);
  legacy.version(1).stores({ rows: 'id, fileHash, status' });
  try {
    const rows = parseReviewedCandidates(await legacy.table('rows').toArray());
    await store.transaction('rw', store.intakeReview, async () => {
      if (assetIds) {
        const final = new Map(parseReviewedCandidates(await store.intakeReview.toArray()).map(row => [row.id, row]));
        for (const row of rows) if (!final.has(row.id)) final.set(row.id, row);
        assertReviewedAssetReferences([...final.values()], assetIds, histories);
      }
      for (const row of rows) if (!(await store.intakeReview.get(row.id))) await store.intakeReview.add(row);
    });
  } catch {
    throw Error('review-migration-failed');
  } finally { legacy.close(); }
}

export async function stageReviewedCandidates(store: IntakeReviewStorage, input: ReviewedCandidate[], isCurrent: () => boolean = () => true): Promise<ReviewedCandidate[]> {
  if (!input.length) return [];
  const rows = parseReviewedCandidates(input);
  if (rows.some(row => row.fileHash !== rows[0].fileHash || row.status !== 'pending')) throw Error('review-stage');
  await store.transaction('rw', store.intakeReview, async () => {
    for (const row of rows) {
      if (!isCurrent()) throw Error('review-cancelled');
      const existing = await store.intakeReview.get(row.id);
      if (!isCurrent()) throw Error('review-cancelled');
      if (!existing) await store.intakeReview.add(row);
      if (!isCurrent()) throw Error('review-cancelled');
    }
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
  kindSelected?: boolean, resolvedField?: string): Promise<boolean> {
  return reviewTransaction(store, async () => {
    await assertReviewEditable(store, id);
    const row = await store.intakeReview.get(id);
    if (row?.status !== 'pending') return false;
    await store.intakeReview.put(reviewedCandidateSchema.parse({ ...row, asset, kindSelected: kindSelected ?? row.kindSelected, ...(row.ai && resolvedField ? { ai: { ...row.ai, missingFields: row.ai.missingFields.filter(field => field !== resolvedField) } } : {}) }));
    return true;
  });
}

export async function decideReviewedCandidate(store: IntakeReviewStorage, id: string,
  status: 'accepted' | 'ignored', assetExists: (assetId: string) => Promise<boolean>): Promise<void> {
  const row = await getReviewedCandidate(store, id);
  if (row?.status !== 'pending') return;
  if (status === 'accepted' && row.reviewMode === 'expense') throw Error('review-expense-confirm-required');
  if (status === 'accepted' && !(await assetExists(row.asset.id))) throw Error('review-asset-missing');
  await reviewTransaction(store, async () => {
    await assertReviewEditable(store, id);
    const current = await store.intakeReview.get(id);
    if (current?.status !== 'pending') return;
    if (!sameReviewedCandidate(current, row)) throw Error('review-stale');
    await store.intakeReview.put(reviewedCandidateSchema.parse({ ...current, status }));
  });
}

function reviewTransaction<T>(store: IntakeReviewStorage, action: () => Promise<T>): Promise<T> {
  return store.transaction('rw', [store.intakeReview, ...(store.importJournal ? [store.importJournal] : [])], action);
}
async function assertReviewEditable(store: IntakeReviewStorage, id: string): Promise<void> {
  if (await store.importJournal?.get(reviewedExpenseJournalId(id))) throw Error('review-expense-pending');
}

export async function setReviewedCandidateMode(store: IntakeReviewStorage, id: string, reviewMode: 'asset' | 'expense',
  initialDraft?: ReviewedExpenseDraft): Promise<boolean> {
  return reviewTransaction(store, async () => {
    await assertReviewEditable(store, id);
    const row = await getReviewedCandidate(store, id);
    if (row?.status !== 'pending') return false;
    if (row.source !== 'pdf') throw Error('review-expense-invalid');
    await store.intakeReview.put(reviewedCandidateSchema.parse({ ...row, reviewMode,
      ...(reviewMode === 'expense' ? { expenseDraft: row.expenseDraft ?? initialDraft ?? {
        assetId: '', title: row.asset.name, amount: '', currency: 'CNY', eventDate: '', source: row.fileName, note: '',
      } } : {}) }));
    return true;
  });
}

export async function editReviewedExpenseDraft(store: IntakeReviewStorage, id: string, expenseDraft: ReviewedExpenseDraft): Promise<boolean> {
  return reviewTransaction(store, async () => {
    await assertReviewEditable(store, id);
    const row = await getReviewedCandidate(store, id);
    if (row?.status !== 'pending') return false;
    if (row.source !== 'pdf' || row.reviewMode !== 'expense') throw Error('review-expense-invalid');
    await store.intakeReview.put(reviewedCandidateSchema.parse({ ...row, expenseDraft }));
    return true;
  });
}

async function storedEntity(db: RxDatabase, type: 'asset' | 'history', id: string): Promise<unknown> {
  const [row] = await db.records.storageInstance.findDocumentsById([`${type}:${id}`], false);
  return row ? JSON.parse((row as RecordRow).payload) : null;
}

/** Freeze the exact reviewed draft before crossing the FileStore/RxDB boundary. */
export async function confirmReviewedExpense(db: RxDatabase, store: ReviewedExpenseStorage, input: ReviewedCandidate): Promise<History> {
  const expected = reviewedCandidateSchema.parse(input);
  if (expected.source !== 'pdf' || expected.reviewMode !== 'expense' || expected.status === 'ignored') throw Error('review-expense-invalid');
  const history = expenseHistory(expected);
  if (!history) throw Error('review-expense-invalid');
  const id = reviewedExpenseJournalId(expected.id);
  await store.transaction('rw', [store.intakeReview, store.importJournal,
    ...(store.archiveMerge ? [store.archiveMerge.name] : []), ...(store.journal ? [store.journal.name] : [])], async () => {
    if (await store.archiveMerge?.count()) throw Error('archive-merge-pending');
    if (await store.journal?.count()) throw Error('restore-recovery-pending');
    const current = await getReviewedCandidate(store, expected.id);
    if (!current) throw Error('review-expense-stale');
    const pending = await store.importJournal.get(id);
    if (pending) {
      if (!pending.reviewedExpense || !sameReviewedCandidate(pending.reviewedExpense, expected)) throw Error('review-expense-stale');
      return;
    }
    if (current.status === 'accepted') {
      if (current.reviewMode !== 'expense' || !sameReviewedCandidate(current, { ...expected, status: 'accepted', historyId: history.id })) throw Error('review-expense-stale');
      const saved = await Dexie.waitFor(Dexie.ignoreTransaction(() => storedEntity(db, 'history', history.id)));
      if (!matchesExpenseReceipt(current, saved)) throw Error('review-expense-recovery-conflict');
      return;
    }
    if (!sameReviewedCandidate(current, expected)) throw Error('review-expense-stale');
    const target = await Dexie.waitFor(Dexie.ignoreTransaction(() => storedEntity(db, 'asset', history.assetId)));
    const parsedTarget = assetSchema.safeParse(target);
    if (!parsedTarget.success || parsedTarget.data.deleted || !['subscription', 'account'].includes(parsedTarget.data.kind)) throw Error('review-expense-target');
    await store.importJournal.add({ id, reviewedExpense: expected, rows: [{ id: `history:${history.id}`, type: 'history',
      payload: JSON.stringify(history), updatedAt: Date.now() }] });
  });
  const result = await replayReviewedExpense(db, store, id);
  if (result) return result;
  // A competing tab may have completed the same intent while this caller waited.
  const current = await getReviewedCandidate(store, expected.id);
  const saved = await storedEntity(db, 'history', history.id);
  if (current?.status !== 'accepted' || current.historyId !== history.id || !matchesExpenseReceipt(current, saved)) throw Error('review-expense-recovery-conflict');
  return historySchema.parse(saved);
}

/** IndexedDB serializes edits, confirmation and replay even without Web Locks. */
export async function replayReviewedExpense(db: RxDatabase, store: ReviewedExpenseStorage, id: string): Promise<History | null> {
  return store.transaction('rw', store.intakeReview, store.importJournal, async () => {
    const journal = await store.importJournal.get(id);
    if (!journal) return null;
    const parsed = reviewedCandidateSchema.safeParse(journal.reviewedExpense);
    const planned = journal.rows[0];
    if (!parsed.success || parsed.data.status !== 'pending' || parsed.data.reviewMode !== 'expense' ||
      journal.rows.length !== 1 || planned?.type !== 'history' || id !== reviewedExpenseJournalId(parsed.data.id)) throw Error('review-expense-recovery-conflict');
    const before = parsed.data, accepted = reviewedCandidateSchema.parse({ ...before, status: 'accepted', historyId: reviewedExpenseHistoryId(before.fileHash) });
    let history: unknown;
    try { history = JSON.parse(planned.payload); } catch { throw Error('review-expense-recovery-conflict'); }
    if (!matchesExpenseReceipt(before, history) || planned.id !== `history:${history.id}` || history.deleted) throw Error('review-expense-recovery-conflict');
    const current = await getReviewedCandidate(store, before.id);
    if (!current || (!sameReviewedCandidate(current, before) && !sameReviewedCandidate(current, accepted))) throw Error('review-expense-recovery-conflict');
    const confirmedHistory = history;
    await Dexie.waitFor(Dexie.ignoreTransaction(async () => {
      let saved = await storedEntity(db, 'history', confirmedHistory.id);
      if (!saved) {
        const target = assetSchema.safeParse(await storedEntity(db, 'asset', confirmedHistory.assetId));
        if (!target.success || target.data.deleted || !['subscription', 'account'].includes(target.data.kind)) throw Error('review-expense-target');
        try { await db.records.insert(planned); }
        catch (error) { if (!await storedEntity(db, 'history', confirmedHistory.id)) throw error; }
        saved = await storedEntity(db, 'history', confirmedHistory.id);
      }
      const actual = historySchema.safeParse(saved);
      if (!actual.success || JSON.stringify(actual.data) !== JSON.stringify(confirmedHistory)) throw Error('review-expense-recovery-conflict');
    }));
    // Both changes share the FileStore transaction: an error or crash after the
    // RxDB write retains the original frozen intent and never a false receipt.
    await store.intakeReview.put(accepted);
    await store.importJournal.delete(id);
    return confirmedHistory;
  });
}

export async function pendingReviewedExpenseConfirmations(db: RxDatabase, store: ReviewedExpenseStorage): Promise<PendingReviewedExpenseConfirmation[]> {
  const pending: PendingReviewedExpenseConfirmation[] = [];
  for (const journal of await store.importJournal.toArray()) {
    if (!journal.reviewedExpense) continue;
    const parsed = reviewedCandidateSchema.safeParse(journal.reviewedExpense);
    if (!parsed.success || journal.id !== reviewedExpenseJournalId(parsed.data.id)) throw Error('review-expense-recovery-conflict');
    const historyId = reviewedExpenseHistoryId(parsed.data.fileHash);
    pending.push({ candidateId: parsed.data.id, historyId, committed: !!await storedEntity(db, 'history', historyId) });
  }
  return pending;
}

// A cancellation can unlock an uncommitted draft. Once the History exists,
// complete the frozen receipt or preserve its conflict; never erase a payment.
export async function cancelReviewedExpenseConfirmation(db: RxDatabase, store: ReviewedExpenseStorage,
  candidateId: string): Promise<'cancelled' | 'completed'> {
  const id = reviewedExpenseJournalId(candidateId);
  const cancelled = await store.transaction('rw', store.intakeReview, store.importJournal, async () => {
    const journal = await store.importJournal.get(id);
    if (!journal) return true;
    const parsed = reviewedCandidateSchema.safeParse(journal.reviewedExpense);
    const current = await getReviewedCandidate(store, candidateId);
    if (!parsed.success || parsed.data.id !== candidateId || parsed.data.status !== 'pending' ||
      !current || !sameReviewedCandidate(current, parsed.data)) throw Error('review-expense-recovery-conflict');
    const history = await Dexie.waitFor(Dexie.ignoreTransaction(() => storedEntity(db, 'history', reviewedExpenseHistoryId(parsed.data.fileHash))));
    if (history) return false;
    await store.importJournal.delete(id);
    return true;
  });
  if (!cancelled) {
    await replayReviewedExpense(db, store, id);
    return 'completed';
  }
  const current = await getReviewedCandidate(store, candidateId);
  if (current?.status === 'accepted' && current.reviewMode === 'expense') {
    if (!matchesExpenseReceipt(current, await storedEntity(db, 'history', current.historyId ?? ''))) throw Error('review-expense-recovery-conflict');
    return 'completed';
  }
  return 'cancelled';
}
