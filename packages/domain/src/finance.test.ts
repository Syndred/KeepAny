import { describe, expect, it } from 'vitest';
import { historySchema } from './index';

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
});
