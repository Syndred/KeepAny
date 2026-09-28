import { describe, expect, it } from 'vitest';
import { actualCharge, assetSchema, dueOnCycle, historySchema, monthlyAmount, newAsset, nextDue, taskSchema } from './index';

describe('subscription and local asset rules', () => {
  it('uses the original billing anchor across short months and leap years', () => {
    expect(nextDue('2026-01-31', 'month')).toBe('2026-02-28');
    expect(dueOnCycle('2026-01-31', 'month', 1, 2)).toBe('2026-03-31');
    expect(dueOnCycle('2024-02-29', 'year', 1, 1)).toBe('2025-02-28');
    expect(dueOnCycle('2024-02-29', 'year', 1, 4)).toBe('2028-02-29');
    let subscription = assetSchema.parse({ ...newAsset('subscription'), dueDate: '2026-01-31' });
    for (const expected of ['2026-02-28', '2026-03-31']) {
      const billingAnchor = subscription.billingAnchor || subscription.dueDate;
      const renewalCount = subscription.renewalCount + 1;
      subscription = assetSchema.parse({ ...subscription, billingAnchor, renewalCount,
        dueDate: dueOnCycle(billingAnchor, subscription.cycle, subscription.interval, renewalCount) });
      expect(subscription.dueDate).toBe(expected);
    }
  });

  it('keeps date-only billing stable across host time zones and skipped local dates', () => {
    const originalTimeZone=process.env.TZ;
    try {
      for(const timeZone of ['UTC','America/New_York','Europe/Berlin','Asia/Shanghai','Pacific/Apia']){
        process.env.TZ=timeZone;
        expect(dueOnCycle('2011-12-29','day',1,1),timeZone).toBe('2011-12-30');
        expect(dueOnCycle('2024-03-09','day',2,1),timeZone).toBe('2024-03-11');
        expect(dueOnCycle('2026-12-28','week',2,1),timeZone).toBe('2027-01-11');
        expect(dueOnCycle('2024-01-31','month',2,1),timeZone).toBe('2024-03-31');
        expect(dueOnCycle('2024-02-29','year',4,1),timeZone).toBe('2028-02-29');
        expect(nextDue('2011-12-29','day'),timeZone).toBe('2011-12-30');
        expect(assetSchema.safeParse({...newAsset('subscription'),dueDate:'2011-12-30'}).success,timeZone).toBe(true);
        expect(actualCharge({...newAsset('subscription'),amount:100},'2011-12-30'),timeZone).toBe(100);
      }
    } finally {
      if(originalTimeZone===undefined)delete process.env.TZ;
      else process.env.TZ=originalTimeZone;
    }
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

  it('accepts legacy history and validates optional renewal amount snapshots', () => {
    const legacy={id:'history-1',assetId:'subscription-1',action:'renew',note:'Local renewal',createdAt:'2026-09-29T00:00:00.000Z'};
    expect(historySchema.safeParse(legacy).success).toBe(true);
    expect(historySchema.safeParse({...legacy,billDate:'2026-09-29',amount:0,currency:'USD'}).success).toBe(true);
    expect(historySchema.safeParse({...legacy,billDate:'2026-02-30',amount:100,currency:'USD'}).success).toBe(false);
    expect(historySchema.safeParse({...legacy,billDate:'2026-09-29',amount:-1,currency:'USD'}).success).toBe(false);
    expect(assetSchema.parse({...newAsset('subscription'),lastRenewalId:undefined}).lastRenewalId).toBe('');
  });

  it('keeps legacy item records and validates real purchase, warranty, maintenance and reminder dates', () => {
    const item = newAsset('item');
    expect(assetSchema.parse({ ...item, lastItemEventId: undefined }).lastItemEventId).toBe('');
    expect(assetSchema.safeParse({ ...item, purchaseDate: '2024-02-29', warrantyDate: '2026-03-01' }).success).toBe(true);
    // A secondhand purchase may happen after the original warranty expired.
    expect(assetSchema.safeParse({ ...item, purchaseDate: '2026-03-01', warrantyDate: '2024-02-29' }).success).toBe(true);
    for (const badDate of ['2025-02-29', '2026-04-31', '2026-13-01', '2026-9-01']) {
      expect(assetSchema.safeParse({ ...item, purchaseDate: badDate }).success, badDate).toBe(false);
      expect(assetSchema.safeParse({ ...item, warrantyDate: badDate }).success, badDate).toBe(false);
      expect(historySchema.safeParse({ id: 'maintenance', assetId: item.id, action: 'maintenance', note: 'Serviced',
        eventDate: badDate, createdAt: item.createdAt }).success, badDate).toBe(false);
      expect(taskSchema.safeParse({ id: 'reminder', name: 'Service again', assetId: item.id,
        dueDate: badDate, createdAt: item.createdAt }).success, badDate).toBe(false);
    }
    expect(historySchema.safeParse({ id: 'legacy-maintenance', assetId: item.id, action: 'maintenance',
      note: 'Older record', createdAt: item.createdAt }).success).toBe(true);
    expect(historySchema.safeParse({ id: 'new-maintenance', assetId: item.id, action: 'maintenance',
      note: 'Cleaned', borrower: 'Ada', eventDate: '2026-09-29', createdAt: item.createdAt }).success).toBe(true);
    expect(taskSchema.safeParse({ id: 'reminder', name: 'Service again', assetId: item.id,
      dueDate: '2026-10-31', createdAt: item.createdAt }).success).toBe(true);
  });
});
