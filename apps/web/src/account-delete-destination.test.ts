import { describe, expect, it } from 'vitest';
import { newAsset } from '../../../packages/domain/src';
import type { VaultEntrySummary } from '../../../packages/password-vault/src';
import { ACCOUNT_CARD_GROUPS_PREFERENCE_ID, type AccountCardMember } from './account-card-groups';
import { ACCOUNT_DEFAULTS_ID } from './account-defaults';
import { accountDeleteDestination } from './account-delete-destination';
const card=(id:string)=>({...newAsset('account'),id,name:id});
const anchor:AccountCardMember={asset:card('a'),entries:[],virtual:false};
const prefs=(groups:string[][],defaults:string[])=>[{id:ACCOUNT_CARD_GROUPS_PREFERENCE_ID,value:groups},{id:ACCOUNT_DEFAULTS_ID,value:defaults}];
describe('post-delete platform destination',()=>{
 it('includes a newly added member selected as the latest default',()=>{
  const next=accountDeleteDestination(anchor,[card('b'),card('new')],[],[],prefs([['a','b','new']],['new']));
  expect(next?.asset.id).toBe('new');
 });
 it('does not follow an old peer moved into another explicit platform',()=>{
  const next=accountDeleteDestination(anchor,[card('b'),card('c'),card('e')],[],[],prefs([['a','c'],['b','e']],['b','c']));
  expect(next?.asset.id).toBe('c');
 });
 it('finds a private successor through copy provenance and excludes the deleted default',()=>{
  const entry={id:'private-c',historyCount:0,title:'C',username:'private-c',url:'',modifiedAt:new Date().toISOString(),linkedAssetIds:[],templateSourceId:'card:a'} as VaultEntrySummary;
  const next=accountDeleteDestination(anchor,[],[entry],[],prefs([],['a','login-private-c']));
  expect(next?.virtual).toBe(true);expect(next?.entries[0].id).toBe('private-c');
 });
 it('returns no detail only after the platform has no remaining member',()=>{
  expect(accountDeleteDestination(anchor,[{...card('a'),deleted:true}],[],[],prefs([['a','missing']],['a']))).toBeUndefined();
 });
});
