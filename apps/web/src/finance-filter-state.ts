import { calendarDayDistance, historyAssetIds, type History } from '../../../packages/domain/src';

export const financeFilterStorageKey = 'keepany-finance-filters';
export const financeCurrencies = ['CNY', 'USD', 'EUR', 'GBP', 'JPY'] as const;
export interface FinanceFilters {
  type: 'all' | 'expense' | 'topup' | 'refund' | 'balance' | 'renew';
  asset: string;
  source: string;
  currency: string;
  from: string;
  to: string;
  query: string;
}
export const emptyFinanceFilters: FinanceFilters = { type: 'all', asset: '', source: 'all', currency: 'all', from: '', to: '', query: '' };
export function validFinanceDate(value: string): boolean {
  try { return !value || calendarDayDistance(value, value) === 0; } catch { return false; }
}
export function validFinanceRange(filters: Pick<FinanceFilters, 'from' | 'to'>): boolean {
  return validFinanceDate(filters.from) && validFinanceDate(filters.to) && (!filters.from || !filters.to || filters.from <= filters.to);
}
export function readFinanceFilters(raw: string | null): FinanceFilters {
  const fallback = { ...emptyFinanceFilters };
  try {
    const value = JSON.parse(raw ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
    const text = (key: string, initial: string, limit = 20_000) => typeof value[key] === 'string' && value[key].length <= limit ? value[key] : initial;
    const type = text('type', 'all');
    const currency = text('currency', 'all');
    const source = text('source', 'all');
    const from = text('from', ''), to = text('to', '');
    return { type: ['all', 'expense', 'topup', 'refund', 'balance', 'renew'].includes(type) ? type as FinanceFilters['type'] : 'all',
      asset: text('asset', '', 512), source: source === 'all' || source === 'empty' || source.startsWith('source:') ? source : 'all',
      currency: currency === 'all' || financeCurrencies.some(value => value === currency) ? currency : 'all',
      from: validFinanceDate(from) ? from : '', to: validFinanceDate(to) ? to : '', query: text('query', '', 2000) };
  } catch { return fallback; }
}
export function financeEntryDate(entry: Pick<History, 'eventDate' | 'billDate' | 'createdAt'>): string {
  return entry.eventDate || entry.billDate || entry.createdAt.slice(0, 10);
}
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
/** Ledger-local filtering only; this does not change global search or AI/MCP context. */
export function matchesFinanceFilters(entry: History, filters: FinanceFilters, assetNames: readonly string[] = []): boolean {
  if (!validFinanceRange(filters) || (filters.type !== 'all' && entry.action !== filters.type) ||
    (filters.asset && !historyAssetIds(entry).includes(filters.asset)) ||
    (filters.currency !== 'all' && entry.currency !== filters.currency)) return false;
  const source = entry.source?.trim() ?? '';
  if (filters.source !== 'all' && (filters.source === 'empty' ? !!source : source !== filters.source.slice(7))) return false;
  if (filters.from || filters.to) {
    const date = financeEntryDate(entry);
    if (!date || !validFinanceDate(date) || (filters.from && date < filters.from) || (filters.to && date > filters.to)) return false;
  }
  const query = normalize(filters.query);
  return !query || normalize([entry.title, entry.note, source, entry.action, entry.currency, financeEntryDate(entry), ...assetNames].filter(Boolean).join(' ')).includes(query);
}
