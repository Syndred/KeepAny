import { describe, expect, it } from 'vitest';
import { effectiveFinanceEntry, historyAssetIds, historyReferenceIds, historySchema } from './index';

const base = {
  id: crypto.randomUUID(), assetId: crypto.randomUUID(), action: 'expense',
  title: 'Hosting invoice', source: 'Card statement', note: '',
  eventDate: '2026-09-29', amount: 1299, currency: 'CNY',
  createdAt: '2026-09-29T00:00:00.000Z', deleted: false,
};

describe('manual finance history', () => {
  it('accepts confirmed actions, a zero balance observation and legacy renewal history', () => {
    for (const action of ['expense', 'topup', 'refund'] as const)
      expect(historySchema.safeParse({ ...base, action }).success).toBe(true);
    expect(historySchema.safeParse({ ...base, action: 'balance', amount: 0 }).success).toBe(true);
    expect(historySchema.safeParse({ ...base, source: '' }).success).toBe(true);
    expect(historySchema.safeParse({ id: base.id, assetId: base.assetId, action: 'renew',
      note: '', billDate: base.eventDate, amount: 1299, currency: 'CNY',
      createdAt: base.createdAt }).success).toBe(true);
  });

  it('rejects unconfirmed or malformed finance values', () => {
    for (const patch of [
      { title: '' }, { title: 'x'.repeat(161) }, { source: 'x'.repeat(301) },
      { eventDate: undefined }, { eventDate: '2026-02-30' },
      { amount: undefined }, { amount: 0 }, { amount: 1.5 }, { amount: -1 },
      { currency: undefined }, { currency: 'BTC' },
    ]) expect(historySchema.safeParse({ ...base, ...patch }).success, JSON.stringify(patch)).toBe(false);
  });

  it('keeps legacy ownership and requires explicit unique bill owners', () => {
    const legacy = historySchema.parse(base);
    expect(legacy).not.toHaveProperty('assetIds');
    expect(historyAssetIds(legacy)).toEqual([base.assetId]);
    const second = crypto.randomUUID();
    const shared = historySchema.parse({ ...base, assetIds: [base.assetId, second] });
    expect(historyAssetIds(shared)).toEqual([base.assetId, second]);
    for (const assetIds of [[], [second], [base.assetId, base.assetId]])
      expect(historySchema.safeParse({ ...base, assetIds }).success).toBe(false);
    expect(historySchema.safeParse({ ...base, action: 'maintenance', assetIds: [base.assetId] }).success).toBe(false);
  });

  it('separates corrected or hidden renewal bills from the preserved renewal fact and source reference', () => {
    const owner = crypto.randomUUID();
    const renewal = historySchema.parse({ ...base, action: 'renew', billDate: base.eventDate,
      financeCorrection: { title: 'Corrected invoice', note: 'Corrected evidence', amount: 2001, currency: 'JPY',
        eventDate: '2026-10-25', assetIds: [owner], hidden: true } });
    expect(effectiveFinanceEntry(renewal)).toMatchObject({ amount: 2001, currency: 'JPY', billDate: '2026-10-25', deleted: true });
    expect(renewal).toMatchObject({ amount: 1299, currency: 'CNY', billDate: base.eventDate, deleted: false });
    expect(historyAssetIds(renewal)).toEqual([owner]);
    expect(historyReferenceIds(renewal)).toEqual([base.assetId, owner]);
    expect(historySchema.safeParse({ ...base, financeCorrection: renewal.financeCorrection }).success).toBe(false);
    for (const assetIds of [[], [owner, owner]]) expect(historySchema.safeParse({ ...renewal,
      financeCorrection: { ...renewal.financeCorrection, assetIds } }).success).toBe(false);
  });
});
