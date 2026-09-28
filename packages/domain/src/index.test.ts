import { describe, expect, it } from 'vitest';
import { actualCharge, assetSchema, dueOnCycle, monthlyAmount, newAsset, nextDue } from './index';

describe('subscription and local asset rules', () => {
  it('uses the original billing anchor across short months and leap years', () => {
    expect(nextDue('2026-01-31', 'month')).toBe('2026-02-28');
    expect(dueOnCycle('2026-01-31', 'month', 1, 2)).toBe('2026-03-31');
    expect(dueOnCycle('2024-02-29', 'year', 1, 1)).toBe('2025-02-28');
    expect(dueOnCycle('2024-02-29', 'year', 1, 4)).toBe('2028-02-29');
  });

  it('separates nominal monthly equivalent from actual trial and discount charges', () => {
    const subscription = assetSchema.parse({
      ...newAsset('subscription'), name: 'Cloud plan', amount: 12000, cycle: 'year',
      dueDate: '2026-04-15', trialEndsAt: '2026-04-01', discountUntil: '2026-04-30', discountAmount: 3000,
    });
    expect(monthlyAmount(subscription)).toBe(1000);
    expect(actualCharge(subscription, '2026-03-31')).toBe(0);
    expect(actualCharge(subscription, '2026-04-15')).toBe(9000);
    expect(actualCharge(subscription, '2026-05-15')).toBe(12000);
    expect(actualCharge({ ...subscription, status: 'paused' }, '2026-05-15')).toBeNull();
    expect(actualCharge({ ...subscription, status: 'cancelled' }, '2026-05-15')).toBeNull();
  });

  it('rejects impossible dates, over-discounts and executable URL schemes', () => {
    const base = newAsset('subscription');
    expect(assetSchema.safeParse({ ...base, dueDate: '2026-02-30' }).success).toBe(false);
    expect(assetSchema.safeParse({ ...base, amount: 100, discountAmount: 200 }).success).toBe(false);
    expect(assetSchema.safeParse({ ...base, url: 'javascript:alert(1)' }).success).toBe(false);
  });
});
