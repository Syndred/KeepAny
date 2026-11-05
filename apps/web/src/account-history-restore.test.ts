import "fake-indexeddb/auto";
import {describe,it,expect} from "vitest";
import {newAsset,type Asset} from "../../../packages/domain/src";
import {openLocalRepository} from "../../../packages/local-db/src";
import {VaultSession,type VaultPersistence,type VaultRecord,type VaultEntryDraft} from "../../../packages/password-vault/src";
import {saveAccountEntry} from "./account-entry-save";
import {saveMergedAccount} from "./account-entry-edit";
import {restoreAccountHistory,type AccountHistoryRestoreProgress} from "./account-history-restore";

const master="SyntheticRestoreMaster2026!",label=()=>"Login";
class Storage implements VaultPersistence {
 record:VaultRecord|null=null; failAfterWrite=false;
 async read(){return this.record}
 async write(bytes:Uint8Array,expected:string|null){
  if((this.record?.revision??null)!==expected)throw Error("stale");
  this.record={id:"local",revision:crypto.randomUUID(),bytes:bytes.slice(),updatedAt:new Date().toISOString()};
  if(this.failAfterWrite){this.failAfterWrite=false;throw Error("synthetic post-write failure")}
  return this.record;
 }
}
async function setup(oldUrl="https://old.example.test/",legacyNotes=""){
 const repository=await openLocalRepository(`history-${crypto.randomUUID()}`),storage=new Storage(),session=new VaultSession(storage);
 await session.initialize();await session.create(master);
 const profile={...newAsset("account"),name:"Old account",notes:legacyNotes};
 const draft:VaultEntryDraft={title:"Old account",username:"old@example.test",password:"Old synthetic secret",url:oldUrl,notes:"Old encrypted notes",linkedAssetIds:[]};
 await saveAccountEntry({profile,draft,session,progress:{account:null,needsVault:false},label,repository});
 const original=(await repository.get<Asset>("asset",profile.id))!,originalEntry=session.readEntry(session.getSnapshot().entries[0].id);
 await saveMergedAccount({original,originalEntry,baseProfile:original,profile:original,draft:{...originalEntry,title:"New account",username:"new@example.test",url:"https://new.example.test/",notes:"New encrypted notes"},session,progress:{account:original,accountChanged:false},label,repository});
 const asset=(await repository.get<Asset>("asset",profile.id))!,entryId=originalEntry.id!,expected={contentRevision:session.getSnapshot().contentRevision!,at:session.history(entryId)[0].at};
 return{repository,storage,session,asset,entryId,expected};
}
describe("unified account history restore",()=>{
 it("restores public identity and encrypted details together and after reopen",async()=>{
  const f=await setup();try{
   await restoreAccountHistory({...f,index:0,progress:{account:f.asset,accountChanged:false},label});
   expect(await f.repository.get("asset",f.asset.id)).toMatchObject({name:"Old account",username:"old@example.test",url:"https://old.example.test/"});
   expect(f.session.readEntry(f.entryId)).toMatchObject({title:"Old account",username:"old@example.test",notes:"Old encrypted notes"});
   expect(f.session.history(f.entryId)).toHaveLength(2);f.session.lock();await f.session.unlock(master);
   expect(f.session.readEntry(f.entryId).title).toBe("Old account");
  }finally{f.session.lock();await f.repository.close()}
 });
 it("preserves legacy notes while restoring an explicitly empty URL",async()=>{
  const f=await setup("","Legacy ordinary note");try{
   // The merged editor has already encrypted legacy notes; restore preserves them from the frozen public baseline when present.
   const legacy={...f.asset,notes:"Legacy ordinary note"};await f.repository.save("asset",legacy);
   await restoreAccountHistory({...f,asset:legacy,index:0,progress:{account:legacy,accountChanged:false},label});
   expect(await f.repository.get("asset",f.asset.id)).toMatchObject({url:"",notes:"",longDescription:""});
   expect(f.session.readEntry(f.entryId).url).toBe("");expect(f.session.readEntry(f.entryId).notes).toContain("Legacy ordinary note");
  }finally{f.session.lock();await f.repository.close()}
 });
 it("rejects a stale selection without altering either store",async()=>{
  const f=await setup();try{
   const current=f.session.readEntry(f.entryId);await f.session.saveEntry({...current,notes:"Concurrent edit"});
   await expect(restoreAccountHistory({...f,index:0,progress:{account:f.asset,accountChanged:false},label})).rejects.toThrow("vault-stale");
   expect((await f.repository.get<Asset>("asset",f.asset.id))!.name).toBe("New account");expect(f.session.readEntry(f.entryId).notes).toBe("Concurrent edit");
  }finally{f.session.lock();await f.repository.close()}
 });
 it("finishes its own persisted restore after a post-write failure and reload",async()=>{
  const f=await setup(),progress:AccountHistoryRestoreProgress={account:f.asset,accountChanged:false};try{
   f.storage.failAfterWrite=true;await expect(restoreAccountHistory({...f,index:0,progress,label})).rejects.toThrow();
   await f.session.initialize();await f.session.unlock(master);
   await restoreAccountHistory({...f,index:0,progress,label});
   expect((await f.repository.get<Asset>("asset",f.asset.id))!.name).toBe("Old account");expect(f.session.readEntry(f.entryId).title).toBe("Old account");expect(f.session.history(f.entryId)).toHaveLength(2);
  }finally{f.session.lock();await f.repository.close()}
 });
});
