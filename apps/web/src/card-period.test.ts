import { expect, it } from 'vitest';
import { newAsset } from '../../../packages/domain/src';
import { cardPeriod, periodRemaining } from './card-period';

it('draws only valid remaining periods and handles leap dates, expiry and future starts',()=>{
 expect(periodRemaining('2024-02-28','2024-03-01','2024-02-29')).toBe(50);
 for(const [start,end,today] of [['','2026-12-01','2026-11-05'],['2026-02-30','2026-12-01','2026-11-05'],['2026-11-01','2026-11-01','2026-11-01'],['2026-11-06','2026-12-01','2026-11-05'],['2026-10-01','2026-11-01','2026-11-05']]) expect(periodRemaining(start,end,today)).toBeNull();
 expect(cardPeriod(newAsset('project'),'2026-11-05')).toBeNull();
 expect(cardPeriod({...newAsset('item'),warrantyDate:'2027-01-01'},'2026-11-05')).toBeNull();
});
it('derives real recurring calendar periods and hides expired, paused or invalid schedules',()=>{
 expect(cardPeriod({...newAsset('subscription'),billingAnchor:'2026-01-31',renewalCount:1,dueDate:'2026-02-28'},'2026-02-01')).toBeCloseTo(27/28*100);
 const asset={...newAsset('subscription'),dueDate:'2026-11-12'};
 expect(cardPeriod(asset,'2026-11-05')).toBeCloseTo(7/31*100);
 expect(cardPeriod({...asset,dueDate:'2024-03-31'},'2024-03-15')).toBeCloseTo(16/31*100);
 expect(cardPeriod({...asset,dueDate:'2026-11-01'},'2026-11-05')).toBeNull();
 expect(cardPeriod({...asset,status:'paused'},'2026-11-05')).toBeNull();
 expect(cardPeriod({...asset,dueDate:'2026-02-30'},'2026-11-05')).toBeNull();
});
