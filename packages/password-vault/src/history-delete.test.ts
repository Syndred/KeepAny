import { describe, expect, it } from 'vitest';
import { VaultSession } from './session';
import type { VaultEntryDraft, VaultPersistence, VaultRecord } from './types';

const master = 'SyntheticHistoryDeletion2026!';
const draft: VaultEntryDraft = { title:'Synthetic history account', username:'example@example.test', password:'SyntheticInitialSecret', notes:'First synthetic note', url:'https://example.test/', linkedAssetIds:[], usernameAliases:['synthetic-alias'], templateSourceId:'card:synthetic-platform' };
class MemoryStorage implements VaultPersistence {
 record: VaultRecord | null = null;
 failWrites = false;
 async read() { return this.record ? { ...this.record, bytes:this.record.bytes.slice() } : null; }
 async write(bytes:Uint8Array, expectedRevision:string|null) {
  if (this.failWrites) throw Error('vault-memory');
  if ((this.record?.revision ?? null) !== expectedRevision) throw Error('vault-stale');
  this.record = { id:'local',revision:crypto.randomUUID(),bytes:bytes.slice(),updatedAt:new Date().toISOString() };
  return this.record;
 }
}
async function setup() {
 const storage=new MemoryStorage(),session=new VaultSession(storage);
 await session.initialize();await session.create(master);
 const id=await session.saveEntry(draft);
 await session.saveEntry({...session.readEntry(id),notes:'Second synthetic note'});
 await session.saveEntry({...session.readEntry(id),notes:'Current synthetic note'});
 return {storage,session,id};
}
function selection(session:VaultSession,id:string,index:number) { return {contentRevision:session.getSnapshot().contentRevision!,at:session.history(id)[index].at}; }

describe('guarded removal of one encrypted login history version',()=>{
 it('removes only the chosen version and retains current and other entries across disk reopen',async()=>{
  const {storage,session,id}=await setup();
  try {
   const other=await session.saveEntry({...draft,title:'Other synthetic account'});
   await session.saveEntry({...session.readEntry(other),notes:'Other current note'});
   const current=session.readEntry(id),old=session.history(id),otherCurrent=session.readEntry(other),otherHistory=session.history(other);
   const metadata=session.getSnapshot().entries.find(row=>row.id===id)!.modifiedAt;
   await session.deleteHistory(id,0,selection(session,id,0));
   expect(session.history(id)).toEqual([old[1]]);expect(session.readEntry(id)).toEqual(current);
   expect(session.readEntry(other)).toEqual(otherCurrent);expect(session.history(other)).toEqual(otherHistory);
   expect(session.getSnapshot().entries.find(row=>row.id===id)?.modifiedAt).toBe(metadata);
   const reloaded=new VaultSession(storage);await reloaded.initialize();await reloaded.unlock(master);
   expect(reloaded.history(id)).toEqual([old[1]]);expect(reloaded.readEntry(id)).toEqual(current);
   reloaded.lock();
  } finally {session.lock();}
 },60000);
 it('removes the last historical version without deleting the current login',async()=>{
  const {storage,session,id}=await setup();
  try {
   const current=session.readEntry(id);
   await session.deleteHistory(id,1,selection(session,id,1));
   await session.deleteHistory(id,0,selection(session,id,0));
   expect(session.history(id)).toEqual([]);expect(session.readEntry(id)).toEqual(current);
   const reloaded=new VaultSession(storage);await reloaded.initialize();await reloaded.unlock(master);
   expect(reloaded.history(id)).toEqual([]);expect(reloaded.readEntry(id)).toEqual(current);reloaded.lock();
  } finally {session.lock();}
 },60000);
 it('rejects old revisions, wrong timestamps and invalid positions without writing',async()=>{
  const {storage,session,id}=await setup();
  try {
   const old=selection(session,id,0);await session.saveEntry({...session.readEntry(id),notes:'Newer current note'});
   const before=storage.record!.revision,history=session.history(id);
   await expect(session.deleteHistory(id,0,old)).rejects.toThrow('vault-stale');
   await expect(session.deleteHistory(id,0,{contentRevision:session.getSnapshot().contentRevision!,at:'2000-01-01T00:00:00Z'})).rejects.toThrow('vault-stale');
   for(const index of [-1,0.5,100]) await expect(session.deleteHistory(id,index,selection(session,id,0))).rejects.toThrow('vault-invalid');
   expect(storage.record!.revision).toBe(before);expect(session.history(id)).toEqual(history);
  } finally {session.lock();}
 },60000);
 it('retains both encrypted bytes and visible history after a write failure, then permits retry',async()=>{
  const {storage,session,id}=await setup();
  try {
   const expected=selection(session,id,0),before=await storage.read(),history=session.history(id),current=session.readEntry(id);
   storage.failWrites=true;await expect(session.deleteHistory(id,0,expected)).rejects.toThrow('vault-memory');
   expect(await storage.read()).toEqual(before);expect(session.history(id)).toEqual(history);expect(session.readEntry(id)).toEqual(current);
   storage.failWrites=false;await session.deleteHistory(id,0,expected);expect(session.history(id)).toEqual([history[1]]);
  } finally {session.lock();}
 },60000);
 it('rejects an external storage revision instead of deleting shifted or newer history',async()=>{
  const {storage,session,id}=await setup();
  const second=new VaultSession(storage);
  try {
   const expected=selection(session,id,0),visibleHistory=session.history(id);
   await second.initialize();await second.unlock(master);
   await second.saveEntry({...second.readEntry(id),notes:'Changed in another synthetic session'});
   const persisted=await storage.read();
   await expect(session.deleteHistory(id,0,expected)).rejects.toThrow('vault-stale');
   expect(await storage.read()).toEqual(persisted);expect(session.history(id)).toEqual(visibleHistory);
   session.lock();await session.unlock(master);expect(session.readEntry(id).notes).toBe('Changed in another synthetic session');expect(session.history(id)).toHaveLength(3);
  } finally {second.lock();session.lock();}
 },60000);
 it('rejects locked or recycled entries without deleting their history',async()=>{
  const {storage,session,id}=await setup();
  try {
   const expected=selection(session,id,0);await session.trashEntry(id);const revision=storage.record!.revision;
   await expect(session.deleteHistory(id,0,selection(session,id,0))).rejects.toThrow('vault-invalid');expect(storage.record!.revision).toBe(revision);
   session.lock();await expect(session.deleteHistory(id,0,expected)).rejects.toThrow('vault-locked');
  } finally {session.lock();}
 },60000);
});
