import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newAsset, type Asset } from '../../../packages/domain/src';
import { openLocalRepository } from '../../../packages/local-db/src';
import { VaultSession, type VaultPersistence, type VaultRecord } from '../../../packages/password-vault/src';
import { prepareAccountCardDelete, recycleAccountCard, type AccountCardDeleteProgress } from './account-card-delete';
const disposals: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposals.splice(0)) await dispose(); });
const master = 'Synthetic account recycle 2026!';
async function fixture() {
 const repository = await openLocalRepository(`account-recycle-${crypto.randomUUID().slice(0,8)}`);
 const storage: VaultPersistence & { fail: boolean; writes: number } = { fail: false, writes: 0, read: () => repository.readPasswordVault(), async write(bytes: Uint8Array, expected: string | null): Promise<VaultRecord> { if (this.fail) throw Error('synthetic-storage-failure'); this.writes++; return repository.savePasswordVault(bytes, expected); } };
 const session = new VaultSession(storage); await session.initialize(); await session.create(master);
 disposals.push(async () => { session.lock(); await repository.close(); });
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
