import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { newAsset, historySchema, type Asset, type History } from '../../domain/src';
import { openLocalRepository } from './index';

it('records an explicitly entered CNY receipt for a legacy foreign subscription and restores both currencies losslessly',async()=>{
 const db=await openLocalRepository(`cny-${crypto.randomUUID().slice(0,12)}`), restored=await openLocalRepository(`cny-${crypto.randomUUID().slice(0,12)}`);
 try {
  const original={...newAsset('subscription'),name:'Legacy annual subscription',amount:4900,currency:'USD' as const,cycle:'year' as const,dueDate:'2027-01-26',billingAnchor:'2027-01-26',subscriptionCny:{amount:32830,discountAmount:0,sourceAmount:4900,sourceDiscountAmount:0,sourceCurrency:'USD' as const,confirmedAt:'2026-11-05T00:00:00.000Z'}};
  await db.save('asset',original);
  const receipt=historySchema.parse({id:crypto.randomUUID(),assetId:original.id,action:'renew',billDate:original.dueDate,amount:32830,currency:'CNY',note:'CNY receipt',createdAt:new Date().toISOString()});
  const next={...original,dueDate:'2028-01-26',renewalCount:1,lastRenewalId:receipt.id};
  await expect(db.recordRenewal(original,next,{...receipt,currency:'EUR'})).rejects.toThrow('renewal-invalid');
  await db.recordRenewal(original,next,receipt);
  await restored.restoreArchive(await db.exportArchive());
  expect(await restored.get<Asset>('asset',original.id)).toMatchObject({amount:4900,currency:'USD',subscriptionCny:original.subscriptionCny});
  expect(await restored.get<History>('history',receipt.id)).toMatchObject({currency:'CNY',amount:32830});
 } finally {await db.close();await restored.close();}
});
