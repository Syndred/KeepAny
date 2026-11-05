import { calendarDayDistance, dueOnCycle, type Asset } from '../../../packages/domain/src';

export function periodRemaining(start: string, end: string, today: string): number | null {
 try {
  const total = calendarDayDistance(start, end), remaining = calendarDayDistance(today, end);
  if (total <= 0 || calendarDayDistance(start, today) < 0 || remaining < 0) return null;
  return Math.min(100, remaining / total * 100);
 } catch { return null; }
}
export function cardPeriod(asset: Asset, today: string) {
 if (asset.kind === 'item') return periodRemaining(asset.purchaseDate || asset.itemStartDate, asset.warrantyDate, today);
 if (asset.kind !== 'subscription' || asset.status !== 'active' || !asset.dueDate) return null;
 try {
  if (asset.billingAnchor && asset.renewalCount > 0) return periodRemaining(dueOnCycle(asset.billingAnchor,asset.cycle,asset.interval,asset.renewalCount-1),asset.dueDate,today);
  // Derive the previous calendar boundary of the recorded recurring cycle.
  calendarDayDistance(asset.dueDate, asset.dueDate);
  const end = new Date(`${asset.dueDate}T12:00:00Z`);
  if (asset.cycle === 'month' || asset.cycle === 'year') {
   const day = end.getUTCDate(); end.setUTCDate(1);
   end.setUTCMonth(end.getUTCMonth() - asset.interval * (asset.cycle === 'year' ? 12 : 1));
   const last = new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate();
   end.setUTCDate(Math.min(day,last));
  } else end.setUTCDate(end.getUTCDate() - asset.interval * (asset.cycle === 'week' ? 7 : 1));
  const start = end.toISOString().slice(0,10);
  return periodRemaining(start, asset.dueDate, today);
 } catch { return null; }
}
