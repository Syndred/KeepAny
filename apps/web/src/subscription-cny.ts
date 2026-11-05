import { monthlyMinorUnits, type Asset, type History } from '../../../packages/domain/src';

export const subscriptionRatesId = 'subscriptionCnyRatesV1';
export type SubscriptionRates = Record<string, string>;

// User supplied CNY per one major unit. No network rates or implicit fallback.
export function readSubscriptionRates(value: unknown): SubscriptionRates {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
 return Object.fromEntries(Object.entries(value).filter(([key, rate]) => ['USD','EUR','GBP','JPY'].includes(key) && typeof rate === 'string' && /^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(rate) && Number(rate) > 0));
}
export function cnyMinor(amount: number | bigint, currency: string, rates: SubscriptionRates): bigint | null {
 if (currency === 'CNY') return BigInt(amount);
 const rate = readSubscriptionRates(rates)[currency];
 if (!rate) return null;
 const [whole, fraction = ''] = rate.split('.');
 const numerator = BigInt(whole + fraction), denominator = 10n ** BigInt(fraction.length) * (currency === 'JPY' ? 1n : 100n);
 return (BigInt(amount) * numerator * 100n + denominator / 2n) / denominator;
}
export function subscriptionCny(asset: Asset, rates: SubscriptionRates): Asset | null {
 if (asset.currency === 'CNY') return asset;
 const quoted = asset.subscriptionCny;
 const valid = quoted && quoted.sourceAmount === asset.amount && quoted.sourceDiscountAmount === asset.discountAmount && quoted.sourceCurrency === asset.currency;
 const amount = valid ? BigInt(quoted.amount) : cnyMinor(asset.amount, asset.currency, rates);
 const discount = valid ? BigInt(quoted.discountAmount) : cnyMinor(asset.discountAmount, asset.currency, rates);
 if (amount === null || discount === null || amount > BigInt(Number.MAX_SAFE_INTEGER) || discount > BigInt(Number.MAX_SAFE_INTEGER)) return null;
 return { ...asset, amount: Number(amount), discountAmount: Number(discount), currency: 'CNY' };
}
export function subscriptionMonthlyCny(asset: Asset, rates: SubscriptionRates) {
 const value = subscriptionCny(asset, rates);
 return value ? monthlyMinorUnits(value) : null;
}

export function historyCny(entry: History, rates: SubscriptionRates): bigint | null {
 if (entry.currency === "CNY") return entry.amount === undefined ? null : BigInt(entry.amount);
 const quote = entry.financeCny;
 if (quote && quote.sourceAmount === entry.amount && quote.sourceCurrency === entry.currency) return BigInt(quote.amount);
 return entry.amount !== undefined && entry.currency ? cnyMinor(entry.amount,entry.currency,rates) : null;
}
