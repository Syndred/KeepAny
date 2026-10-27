import { describe, expect, it } from 'vitest';
import { historySchema } from '../../../packages/domain/src';
import { emptyFinanceFilters, financeEntryDate, matchesFinanceFilters, readFinanceFilters, validFinanceRange } from './finance-filter-state';

const entry = historySchema.parse({ id: '11111111-1111-4111-8111-111111111111', assetId: '22222222-2222-4222-8222-222222222222', assetIds: ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'], action: 'expense', title: 'Alpha invoice', source: 'Bank', note: 'Local ledger note', amount: 1234, currency: 'USD', eventDate: '2024-02-29', createdAt: '2024-03-01T00:30:00Z' });
describe('ledger-local filter state', () => {
  it('intersects every selection and includes shared ownership without duplicating entries', () => {
    const filters = { ...emptyFinanceFilters, type: 'expense' as const, asset: '33333333-3333-4333-8333-333333333333', source: 'source:Bank', currency: 'USD', from: '2024-02-29', to: '2024-02-29', query: 'ＡＬＰＨＡ' };
    expect(matchesFinanceFilters(entry, filters)).toBe(true);
    for (const change of [{ type: 'refund' as const }, { asset: 'absent' }, { source: 'empty' }, { currency: 'JPY' }, { from: '2024-03-01' }, { to: '2024-02-28' }, { query: 'absent' }]) expect(matchesFinanceFilters(entry, { ...filters, ...change })).toBe(false);
  });
  it('keeps zero and unknown amounts distinct and excludes undated rows only for active date bounds', () => {
    const unknown = { ...entry, amount: undefined, currency: undefined, eventDate: '', billDate: undefined, createdAt: '' };
    expect(matchesFinanceFilters({ ...entry, action: 'balance', amount: 0 }, emptyFinanceFilters)).toBe(true);
    expect(matchesFinanceFilters(unknown, emptyFinanceFilters)).toBe(true);
    expect(matchesFinanceFilters(unknown, { ...emptyFinanceFilters, currency: 'USD' })).toBe(false);
    expect(matchesFinanceFilters(unknown, { ...emptyFinanceFilters, from: '2024-01-01' })).toBe(false);
  });
  it('uses pure calendar dates, inclusive endpoints and bill/created fallback without timezone conversion', () => {
    expect(financeEntryDate(entry)).toBe('2024-02-29');
    expect(financeEntryDate({ ...entry, eventDate: '', billDate: '2024-03-02' })).toBe('2024-03-02');
    expect(financeEntryDate({ ...entry, eventDate: '', billDate: undefined })).toBe('2024-03-01');
    expect(validFinanceRange({ from: '2024-02-29', to: '2024-02-29' })).toBe(true);
    for (const range of [{ from: '2026-02-29', to: '' }, { from: '', to: '2024-13-01' }, { from: '2024-03-01', to: '2024-02-29' }]) expect(validFinanceRange(range)).toBe(false);
  });
  it('restores valid zero-result selections even after their last entry is deleted', () => {
    const state = { ...emptyFinanceFilters, currency: 'JPY', asset: 'deleted-record-owner', source: 'source:Old statement', from: '2026-10-01', query: ' invoice ' };
    expect(readFinanceFilters(JSON.stringify(state))).toEqual(state);
    expect(matchesFinanceFilters(entry, state)).toBe(false);
  });
  it('rejects malformed stored preferences without reading arbitrary keys or trusting dates', () => {
    for (const value of ['bad JSON', '[]', 'null', '17']) expect(readFinanceFilters(value)).toEqual(emptyFinanceFilters);
    expect(readFinanceFilters(JSON.stringify({ type: 'drop', currency: 'DOGE', source: 'arbitrary', from: '2026-02-30', query: 'x'.repeat(2001), asset: 1 }))).toEqual(emptyFinanceFilters);
    const reverse = { ...emptyFinanceFilters, from: '2026-10-28', to: '2026-10-27' };
    expect(readFinanceFilters(JSON.stringify(reverse))).toEqual(reverse);
    expect(validFinanceRange(reverse)).toBe(false);
  });
  it('matches visible local ledger details and asset names without changing another search index', () => {
    expect(matchesFinanceFilters(entry, { ...emptyFinanceFilters, query: 'owner project' }, ['Owner project'])).toBe(true);
    expect(matchesFinanceFilters(entry, { ...emptyFinanceFilters, query: 'local ledger note' })).toBe(true);
    expect(matchesFinanceFilters(entry, { ...emptyFinanceFilters, source: 'empty' })).toBe(false);
  });
});
