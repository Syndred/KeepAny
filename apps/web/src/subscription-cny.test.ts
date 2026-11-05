import { expect, it } from 'vitest';
import { assetSchema, newAsset } from '../../../packages/domain/src';
import { cnyMinor, readSubscriptionRates, subscriptionCny, subscriptionMonthlyCny } from './subscription-cny';
import { buildWorkspaceSummary } from './workspace-summary';

it('uses explicit exact rates, handles JPY major units, rounds once and never relabels foreign amounts',()=>{
 expect(cnyMinor(4900,'USD',{USD:'6.7'})).toBe(32830n);
 expect(cnyMinor(49,'JPY',{JPY:'0.047'})).toBe(230n);
 expect(cnyMinor(4900,'USD',{})).toBeNull();
 expect(readSubscriptionRates({USD:'NaN',EUR:'0',GBP:'-1',JPY:'1e3'})).toEqual({});
 expect(cnyMinor(BigInt(Number.MAX_SAFE_INTEGER),'USD',{USD:'6.7'})).toBe(60348235006764640n);
});
it('keeps original currency and backup schema, and invalidates quotes when their source changes',()=>{
 const asset = {...newAsset('subscription'),currency:'USD' as const,amount:4900,cycle:'year' as const};
 const before=JSON.stringify(asset);
 expect(subscriptionMonthlyCny(asset,{USD:'6.7'})).toBe(2736n);
 expect(JSON.stringify(asset)).toBe(before);
 const quoted=assetSchema.parse({...asset,subscriptionCny:{amount:33000,discountAmount:0,sourceAmount:4900,sourceDiscountAmount:0,sourceCurrency:'USD',confirmedAt:'2026-11-05T00:00:00.000Z'}});
 expect(assetSchema.safeParse({...quoted,subscriptionCny:{...quoted.subscriptionCny!,amount:10,discountAmount:20}}).success).toBe(false);
 expect(subscriptionCny(quoted,{})?.amount).toBe(33000);
 expect(subscriptionCny({...quoted,amount:5000},{})).toBeNull();
 expect(assetSchema.parse(JSON.parse(JSON.stringify(quoted))).currency).toBe('USD');
});
it('reports missing conversions alongside a CNY subtotal instead of silently dropping them',()=>{
 const assets=[{...newAsset('subscription'),amount:2500},{...newAsset('subscription'),currency:'USD' as const,amount:4900,cycle:'year' as const}];
 const input={assets,tasks:[],history:[],relations:[],today:'2026-11-05'};
 const missing=buildWorkspaceSummary(input);
 expect(missing.monthlyCny.get('CNY')).toBe(2500n); expect(missing.unconvertedSubscriptions).toBe(1);
 const converted=buildWorkspaceSummary({...input,subscriptionRates:{USD:'6.7'}});
 expect(converted.monthlyCny.get('CNY')).toBe(5236n); expect(converted.unconvertedSubscriptions).toBe(0);
 expect(converted.monthly.get('USD')).toBe(408n);
});
