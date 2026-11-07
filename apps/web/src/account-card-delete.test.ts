import 'fake-indexeddb/auto';
import { Int64, Kdbx, VarDictionary } from 'kdbxweb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newAsset, type Asset } from '../../../packages/domain/src';
import { openLocalRepository } from '../../../packages/local-db/src';
import { VaultSession, type VaultPersistence, type VaultRecord } from '../../../packages/password-vault/src';
import { clearDatabase, configureDatabase, credentials } from '../../../packages/password-vault/src/engine';
import {
 prepareAccountCardBatchDelete,
 prepareAccountCardDelete,
 recycleAccountCard,
 recycleAccountCardBatch,
 type AccountCardBatchDeleteProgress,
 type AccountCardDeleteProgress,
} from './account-card-delete';
const disposals: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); });
const master = 'Synthetic account recycle 2026!';
async function fixture() {
 const repository = await openLocalRepository(`account-recycle-${crypto.randomUUID().slice(0,8)}`);
 const storage: VaultPersistence & { fail: boolean; writes: number } = { fail: false, writes: 0, read: () => repository.readPasswordVault(), async write(bytes: Uint8Array, expected: string | null): Promise<VaultRecord> { if (this.fail) throw Error('synthetic-storage-failure'); this.writes++; return repository.savePasswordVault(bytes, expected); } };
 const session = new VaultSession(storage);
 disposals.push(async () => { session.lock(); await repository.close(); });
 const database = Kdbx.create(credentials(master), 'Synthetic account recycle');
 configureDatabase(database);
 // Use a low-cost encrypted fixture. Vault tests cover the production KDF separately.
 const parameters = database.header.kdfParameters!;
 parameters.set('M', VarDictionary.ValueType.UInt64, Int64.from(1024 * 1024));
 parameters.set('I', VarDictionary.ValueType.UInt64, Int64.from(1));
 try { await storage.write(new Uint8Array(await database.save()), null); }
 finally { clearDatabase(database); }
 await session.initialize();
 await session.unlock(master);
 const asset = { ...newAsset('account'), name: 'Synthetic A', username: 'a@example.test' };
 const sibling = { ...newAsset('account'), name: 'Synthetic B', username: 'b@example.test' };
 await repository.save('asset', asset); await repository.save('asset', sibling);
 const primary = await session.saveEntry({ title: asset.name, username: asset.username, usernameAliases: ['alias-a','alias-b'], password: 'Synthetic A password', notes: 'Synthetic A note', url: '', linkedAssetIds: [asset.id] });
 const siblingEntry = await session.saveEntry({ title: sibling.name, username: sibling.username, password: 'Synthetic B password', notes: '', url: '', linkedAssetIds: [sibling.id] });
 return { repository, storage, session, asset, sibling, primary, siblingEntry };
}

describe('whole account card recycling', () => {
 it('recycles every identifier and login while removing the ordinary card and preserving its sibling', async () => {
  const f = await fixture();
  const extra = await f.session.saveEntry({ title: 'Extra login A', username: 'extra-a', usernameAliases: ['extra-alias'], password: 'Synthetic extra', notes: '', url: '', linkedAssetIds: [f.asset.id] });
  const sibling = f.session.readEntry(f.siblingEntry), beforeWrites = f.storage.writes;
  const target = prepareAccountCardDelete(f.session, { asset: f.asset });
  const progress: AccountCardDeleteProgress = {};
  await recycleAccountCard(f.session, target, progress, f.repository);
  expect(f.storage.writes).toBe(beforeWrites + 1);
  expect(f.session.getSnapshot().entries.map(row => row.id)).toEqual([f.siblingEntry]);
  expect(f.session.getSnapshot().trash.map(row => row.id).sort()).toEqual([f.primary,extra].sort());
  expect(f.session.readEntry(f.primary).usernameAliases).toEqual(['alias-a','alias-b']);
  expect((await f.repository.get<Asset>('asset', f.asset.id))?.deleted).toBe(true);
  expect((await f.repository.get<Asset>('asset', f.sibling.id))?.deleted).toBe(false);
  expect(f.session.readEntry(f.siblingEntry)).toEqual(sibling); expect(progress.publicDone).toBe(true);
 });
 it('preserves shared credentials and history for the other owner, with a scoped recyclable copy', async () => {
  const f = await fixture(); await f.session.saveEntry({ ...f.session.readEntry(f.primary), linkedAssetIds: [f.asset.id,f.sibling.id] });
  await f.session.saveEntry({ ...f.session.readEntry(f.primary), password: 'Synthetic newer secret' });
  const shared = f.session.readEntry(f.primary);
  await recycleAccountCard(f.session, prepareAccountCardDelete(f.session, { asset: f.asset }), {}, f.repository);
  expect(f.session.readEntry(f.primary)).toEqual({ ...shared, linkedAssetIds: [f.sibling.id] });
  const scoped = f.session.getSnapshot().trash.find(row => row.linkedAssetIds.includes(f.asset.id))!;
  expect(scoped.id).not.toBe(f.primary);
  expect(f.session.readEntry(scoped.id)).toMatchObject({ username: shared.username, usernameAliases: shared.usernameAliases, password: shared.password, linkedAssetIds: [f.asset.id] });
  expect(f.session.history(scoped.id).map(row => row.draft.password)).toContain('Synthetic A password');
  expect(f.session.history(scoped.id).every(row => JSON.stringify(row.draft.linkedAssetIds) === JSON.stringify([f.asset.id]))).toBe(true);
  expect(f.session.getSnapshot().entries.every(row => row.linkedAssetIds.length > 0)).toBe(true);
 });
 it('recycles an account linked only to projects, items or deleted accounts without creating a private ghost', async () => {
  const f=await fixture();
  const project={...newAsset('project'),name:'Linked project'}, item={...newAsset('item'),name:'Linked item'}, deleted={...newAsset('account'),name:'Old deleted account',deleted:true};
  await f.repository.save('asset',project);await f.repository.save('asset',item);await f.repository.save('asset',deleted);
  await f.session.saveEntry({...f.session.readEntry(f.primary),linkedAssetIds:[f.asset.id,project.id,item.id,deleted.id]});
  const original=f.session.readEntry(f.primary);
  await recycleAccountCard(f.session,prepareAccountCardDelete(f.session,{asset:f.asset}),{},f.repository);
  expect(f.session.getSnapshot().entries.some(row=>row.id===f.primary)).toBe(false);
  expect(f.session.getSnapshot().trash.find(row=>row.id===f.primary)).toBeDefined();
  expect(f.session.readEntry(f.primary)).toEqual(original);
  expect((await f.repository.get<Asset>('asset',project.id))?.deleted).toBe(false);
  expect((await f.repository.get<Asset>('asset',item.id))?.deleted).toBe(false);
 });
 it('keeps a shared original with another live account even when it also links to non-account assets', async () => {
  const f=await fixture(),project={...newAsset('project'),name:'Shared project'};await f.repository.save('asset',project);
  await f.session.saveEntry({...f.session.readEntry(f.primary),linkedAssetIds:[f.asset.id,project.id,f.sibling.id]});
  const original=f.session.readEntry(f.primary);
  await recycleAccountCard(f.session,prepareAccountCardDelete(f.session,{asset:f.asset}),{},f.repository);
  expect(f.session.readEntry(f.primary)).toEqual({...original,linkedAssetIds:[project.id,f.sibling.id]});
  expect(f.session.getSnapshot().trash).toHaveLength(1);
 });
 it('makes an encrypted write failure atomic and retries with the same confirmation', async () => {
  const f=await fixture(), target=prepareAccountCardDelete(f.session,{asset:f.asset}), progress:AccountCardDeleteProgress={};
  const snapshot=f.session.getSnapshot(), original=f.session.readEntry(f.primary);
  f.storage.fail=true; await expect(recycleAccountCard(f.session,target,progress,f.repository)).rejects.toThrow();
  expect(f.session.getSnapshot()).toEqual(snapshot); expect(f.session.readEntry(f.primary)).toEqual(original);
  expect((await f.repository.get<Asset>('asset',f.asset.id))?.deleted).toBe(false); expect(progress.vaultDone).not.toBe(true);
  f.storage.fail=false; await recycleAccountCard(f.session,target,progress,f.repository); expect(progress.publicDone).toBe(true);
 });
 it('retries only the public tombstone when encryption already succeeded', async () => {
  const f=await fixture(), target=prepareAccountCardDelete(f.session,{asset:f.asset}), progress:AccountCardDeleteProgress={};
  const actual=f.repository.trashEmptyAccountIfCurrent.bind(f.repository);
  const spy=vi.spyOn(f.repository,'trashEmptyAccountIfCurrent').mockRejectedValueOnce(Error('synthetic-public-failure'));
  await expect(recycleAccountCard(f.session,target,progress,f.repository)).rejects.toThrow('synthetic-public-failure');
  expect(progress.vaultDone).toBe(true); expect(progress.publicDone).not.toBe(true);
  expect((await f.repository.get<Asset>('asset',f.asset.id))?.deleted).toBe(false);
  const writes=f.storage.writes; spy.mockImplementation(actual);
  await recycleAccountCard(f.session,target,progress,f.repository); expect(f.storage.writes).toBe(writes); expect(progress.publicDone).toBe(true);
  await recycleAccountCard(f.session,target,progress,f.repository); expect(f.storage.writes).toBe(writes); spy.mockRestore();
 });
 it('rejects stale public or encrypted confirmation before changing credentials', async () => {
  const f=await fixture(), target=prepareAccountCardDelete(f.session,{asset:f.asset}), before=f.session.readEntry(f.primary);
  await f.repository.saveAssetIfCurrent(f.asset,{...f.asset,name:'Changed after confirmation'});
  await expect(recycleAccountCard(f.session,target,{},f.repository)).rejects.toThrow('asset-stale'); expect(f.session.readEntry(f.primary)).toEqual(before);
  const current=(await f.repository.get<Asset>('asset',f.asset.id))!;
  const newer=prepareAccountCardDelete(f.session,{asset:current}); await f.session.saveEntry({...before,notes:'Changed after confirmation'});
  await expect(recycleAccountCard(f.session,newer,{},f.repository)).rejects.toThrow('vault-stale'); expect(f.session.getSnapshot().trash).toHaveLength(0);
 });
 it('recycles a private account without creating or changing ordinary assets', async () => {
  const f=await fixture(); const id=await f.session.saveEntry({title:'Private',username:'private-login',usernameAliases:['private-alias'],password:'Synthetic private',notes:'',url:'',linkedAssetIds:[]});
  const before=await f.repository.list<Asset>('asset');
  await recycleAccountCard(f.session,prepareAccountCardDelete(f.session,{entryId:id}),{},f.repository);
  expect(f.session.getSnapshot().entries.some(row=>row.id===id)).toBe(false); expect(f.session.getSnapshot().trash.find(row=>row.id===id)?.usernameAliases).toEqual(['private-alias']); expect(await f.repository.list('asset')).toEqual(before);
 });
 it('rejects a formerly private entry that now has a live ordinary owner even with a freshly prepared revision', async () => {
  const f=await fixture();const id=await f.session.saveEntry({title:'Former private',username:'private-login',password:'Synthetic private',notes:'',url:'',linkedAssetIds:[]});
  await f.session.saveEntry({...f.session.readEntry(id),linkedAssetIds:[f.sibling.id]});
  const target=prepareAccountCardDelete(f.session,{entryId:id}), before=f.session.readEntry(id);
  await expect(recycleAccountCard(f.session,target,{},f.repository)).rejects.toThrow('vault-stale');
  expect(f.session.readEntry(id)).toEqual(before);expect(f.session.getSnapshot().trash).toHaveLength(0);
 });
 it('supports intentional empty-card deletion and rejects locked or cross-target progress', async () => {
  const f=await fixture(), empty={...newAsset('account'),name:'Intentional empty'};await f.repository.save('asset',empty);
  const target=prepareAccountCardDelete(f.session,{asset:empty}), progress:AccountCardDeleteProgress={};
  await recycleAccountCard(f.session,target,progress,f.repository); expect((await f.repository.get<Asset>('asset',empty.id))?.deleted).toBe(true);
  await expect(recycleAccountCard(f.session,prepareAccountCardDelete(f.session,{asset:f.sibling}),progress,f.repository)).rejects.toThrow('asset-stale');
  f.session.lock(); expect(()=>prepareAccountCardDelete(f.session,{asset:f.asset})).toThrow('vault-locked');
 });
 it('recognizes a committed public tombstone after a lost acknowledgement without rewriting the vault', async () => {
  const f=await fixture(), target=prepareAccountCardDelete(f.session,{asset:f.asset}), progress:AccountCardDeleteProgress={};
  const actual=f.repository.trashEmptyAccountIfCurrent.bind(f.repository);const spy=vi.spyOn(f.repository,'trashEmptyAccountIfCurrent').mockImplementationOnce(async(...args)=>{await actual(...args);throw Error('synthetic-lost-ack');});
  await expect(recycleAccountCard(f.session,target,progress,f.repository)).rejects.toThrow('synthetic-lost-ack');const writes=f.storage.writes;
  await recycleAccountCard(f.session,target,progress,f.repository);expect(progress.publicDone).toBe(true);expect(f.storage.writes).toBe(writes);spy.mockRestore();
 });
});

describe('batch account recycling', () => {
 it('recycles ordinary and private selections while retaining a shared login for the unselected owner', async () => {
  const f = await fixture();
  const privateId = await f.session.saveEntry({
   title: 'Private example', username: 'private@example.test', password: 'Synthetic private',
   notes: '', url: '', linkedAssetIds: [],
  });
  await f.session.saveEntry({ ...f.session.readEntry(f.primary), linkedAssetIds: [f.asset.id, f.sibling.id] });
  const shared = f.session.readEntry(f.primary);
  const target = prepareAccountCardBatchDelete(f.session, [{ asset: f.asset }, { entryId: privateId }]);
  const progress: AccountCardBatchDeleteProgress = {};
  const completed: number[] = [];

  await recycleAccountCardBatch(f.session, target, progress, f.repository, count => completed.push(count));

  expect(completed).toEqual([1, 2]);
  expect(progress).toMatchObject({ completed: 2, partial: false });
  expect(f.session.readEntry(f.primary)).toEqual({ ...shared, linkedAssetIds: [f.sibling.id] });
  expect(f.session.getSnapshot().trash).toHaveLength(2);
  expect(f.session.getSnapshot().trash).toContainEqual(expect.objectContaining({ id: privateId }));
  const sharedCopy = f.session.getSnapshot().trash.find(entry => entry.linkedAssetIds.includes(f.asset.id))!;
  expect(sharedCopy.id).not.toBe(f.primary);
  expect(f.session.history(sharedCopy.id)).toHaveLength(1);
  expect(await f.repository.get<Asset>('asset', f.sibling.id)).toEqual(f.sibling);
  expect(await f.repository.get<Asset>('asset', f.asset.id)).toMatchObject({ deleted: true });
 });

 it('resumes a partial ordinary item without repeating a completed private recycle or writing encrypted copies again', async () => {
  const f = await fixture();
  const privateId = await f.session.saveEntry({
   title: 'Private example', username: 'private@example.test', password: 'Synthetic private',
   notes: '', url: '', linkedAssetIds: [],
  });
  const target = prepareAccountCardBatchDelete(f.session, [{ entryId: privateId }, { asset: f.asset }]);
  const progress: AccountCardBatchDeleteProgress = {};
  const fail = vi.spyOn(f.repository, 'trashEmptyAccountIfCurrent').mockRejectedValueOnce(Error('synthetic-tombstone-failure'));
  const completed: number[] = [];
  const run = () => recycleAccountCardBatch(f.session, target, progress, f.repository, count => completed.push(count));

  await expect(run()).rejects.toThrow('synthetic-tombstone-failure');

  expect(completed).toEqual([1]);
  expect(progress).toMatchObject({ completed: 1, partial: true });
  expect(await f.repository.get<Asset>('asset', f.asset.id)).toMatchObject({ deleted: false });
  const writes = f.storage.writes;
  const trash = f.session.getSnapshot().trash;
  await run();
  await run();
  expect(completed).toEqual([1, 2]);
  expect(progress).toMatchObject({ completed: 2, partial: false });
  expect(f.storage.writes).toBe(writes);
  expect(f.session.getSnapshot().trash).toEqual(trash);
  expect(await f.repository.get<Asset>('asset', f.asset.id)).toMatchObject({ deleted: true });
  expect(fail).toHaveBeenCalledTimes(2);
  fail.mockRestore();
 });

 it('rejects a batch before moving anything if a later selected card has changed', async () => {
  const f = await fixture();
  const target = prepareAccountCardBatchDelete(f.session, [{ asset: f.asset }, { asset: f.sibling }]);
  await f.repository.saveAssetIfCurrent(f.sibling, { ...f.sibling, name: 'Edited after confirmation' });
  const writes = f.storage.writes;

  await expect(recycleAccountCardBatch(f.session, target, {}, f.repository)).rejects.toThrow('asset-stale');

  expect(f.storage.writes).toBe(writes);
  expect(f.session.getSnapshot().trash).toHaveLength(0);
  expect(await f.repository.get<Asset>('asset', f.asset.id)).toMatchObject({ deleted: false });
 });

 it('stops after the completed item when a later login changes during the batch', async () => {
  const f = await fixture();
  const target = prepareAccountCardBatchDelete(f.session, [{ asset: f.asset }, { asset: f.sibling }]);
  const progress: AccountCardBatchDeleteProgress = {};
  const trash = f.repository.trashEmptyAccountIfCurrent.bind(f.repository);
  const interleave = vi.spyOn(f.repository, 'trashEmptyAccountIfCurrent').mockImplementationOnce(async (...args) => {
   const result = await trash(...args);
   await f.session.saveEntry({ ...f.session.readEntry(f.siblingEntry), notes: 'Concurrent update' });
   return result;
  });

  await expect(recycleAccountCardBatch(f.session, target, progress, f.repository)).rejects.toThrow('vault-stale');

  expect(progress).toMatchObject({ completed: 1, partial: false });
  expect(await f.repository.get<Asset>('asset', f.asset.id)).toMatchObject({ deleted: true });
  expect(await f.repository.get<Asset>('asset', f.sibling.id)).toMatchObject({ deleted: false });
  expect(f.session.readEntry(f.siblingEntry).notes).toBe('Concurrent update');
  const writes = f.storage.writes;
  await expect(recycleAccountCardBatch(f.session, target, progress, f.repository)).rejects.toThrow('vault-stale');
  expect(f.storage.writes).toBe(writes);
  interleave.mockRestore();
 });

 it('rejects duplicate targets and does not reuse a progress record for a different confirmation', async () => {
  const f = await fixture();
  const inputs = [{ asset: f.asset }];
  expect(() => prepareAccountCardBatchDelete(f.session, [...inputs, ...inputs])).toThrow('asset-stale');
  const target = prepareAccountCardBatchDelete(f.session, inputs);
  const progress: AccountCardBatchDeleteProgress = {};
  await recycleAccountCardBatch(f.session, target, progress, f.repository);
  const next = prepareAccountCardBatchDelete(f.session, [{ asset: f.sibling }]);

  await expect(recycleAccountCardBatch(f.session, next, progress, f.repository)).rejects.toThrow('asset-stale');

  expect(await f.repository.get<Asset>('asset', f.sibling.id)).toMatchObject({ deleted: false });
 });
});
