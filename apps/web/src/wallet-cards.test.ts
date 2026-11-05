import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { assetSchema, newAsset } from '../../../packages/domain/src';
import { openLocalRepository } from '../../../packages/local-db/src';
import { addWalletSamples, buildWalletSamples, newWalletCard } from './wallet-cards';
import { catalogRecords, applyCatalogEdit } from './catalog-records';
import { unzipSync, strFromU8 } from 'fflate';

test('wallet metadata is optional, constrained to ordinary assets, and preserves zero vs missing', () => {
 const old = newAsset('project'); expect(assetSchema.parse(old).walletCard).toBeUndefined();
 const draft = {...newWalletCard(), name:'Transit'};
 const card = assetSchema.parse(draft); expect(card.walletCard?.balanceMinor).toBeNull();
 expect(assetSchema.parse({...card,walletCard:{...card.walletCard,balanceMinor:0,remainingUses:0}}).walletCard).toMatchObject({balanceMinor:0,remainingUses:0});
 for (const patch of [{balanceMinor:-1},{balanceMinor:1.5},{remainingUses:-1},{remainingUses:1.5},{lastFour:'12345'}]) expect(assetSchema.safeParse({...card,walletCard:{...card.walletCard,...patch}}).success).toBe(false);
 expect(assetSchema.safeParse({...card,kind:'subscription'}).success).toBe(false);
 expect(assetSchema.safeParse({...card,dueDate:'2026-02-30'}).success).toBe(false);
 const record = catalogRecords([card],[])[0]; expect(applyCatalogEdit(record,{...card,name:'Edited'},'').walletCard).toEqual(card.walletCard);
 const withDomain=assetSchema.parse({...card,projectDomains:[{id:crypto.randomUUID(),name:'example.test'}]});
 expect(catalogRecords([withDomain],[]).filter(row=>row.asset.walletCard)).toHaveLength(1);
});

test('explicit sample addition is idempotent, retains edits/deletions and archive metadata', async () => {
 const db = await openLocalRepository(`wallet-test-${crypto.randomUUID().slice(0,8)}`);
 try {
  const t=(key:string)=>key;
  const existing = {...buildWalletSamples(t)[0],name:'User edited sample',deleted:true};
  await db.save('asset',existing);
  expect(await addWalletSamples(t,db)).toBe(true); expect(await addWalletSamples(t,db)).toBe(false);
  expect(await db.get('asset',existing.id)).toMatchObject({name:existing.name,deleted:true});
  const archive=await db.exportArchive();
  expect(strFromU8(unzipSync(archive)['records.json'])).toContain('walletCard');
  const samples=buildWalletSamples(t,new Date('2026-11-05T04:00:00Z'));
  expect(new Set(samples.map(a=>a.id)).size).toBe(4);
  expect(samples.map(a=>a.walletCard?.type)).toEqual(['storedValue','membership','gift','countPass']);
 } finally {await db.close();}
});
