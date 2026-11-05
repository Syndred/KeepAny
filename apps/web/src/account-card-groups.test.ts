import { describe, expect, it } from 'vitest';
import { newAsset } from '../../../packages/domain/src';
import type { VaultEntrySummary } from '../../../packages/password-vault/src';
import { accountCardGroups, type AccountCardMember } from './account-card-groups';
const entry = (id: string, source?: string): VaultEntrySummary => ({id, title:'Same platform',username:id,url:'https://same.test',linkedAssetIds:[id],modifiedAt:'2026-11-05T00:00:00Z',historyCount:0,...(source?{templateSourceId:source}:{})});
const card = (id: string, source?: string): AccountCardMember => ({asset:{...newAsset('account'),id,name:'Same platform'},entries:[entry(id,source)],virtual:false});
describe('explicit account card copy groups',()=>{
 it('keeps matching platform names and URLs independent without a copy source',()=>{
  const a=card('a'),b=card('b');const {groups,ids}=accountCardGroups([a,b]);
  expect(groups.get('a')).toEqual([a]);expect(ids.get('a')).not.toBe(ids.get('b'));
 });
 it('groups siblings and nested copies without changing original identities or connections',()=>{
  const a=card('a'),b=card('b','a'),c=card('c','b'); const before=JSON.stringify([a,b,c]);
  const {groups,ids}=accountCardGroups([a,b,c]); expect(groups.get('b')).toEqual([a,b,c]);expect(new Set(ids.values()).size).toBe(1);expect(JSON.stringify([a,b,c])).toBe(before);
 });
 it('retains sibling membership after source deletion and follows archived ancestors',()=>{
  const a=card('a','deleted'),b=card('b','ancestor');
  expect(accountCardGroups([a,b],[entry('deleted','ancestor')]).groups.get('a')).toEqual([a,b]);
  expect(accountCardGroups([card('a','missing'),card('b','missing')]).ids.get('a')).toBe('a');
 });
 it('resolves imported cycles deterministically and still retains all members',()=>{
  const a=card('a','b'),b=card('b','a'),c=card('c','a');
  expect(accountCardGroups([a,b,c]).groups.get('c')).toEqual([a,b,c]);
 });
 it('keeps a multi-entry source intact while grouping its explicitly created child',()=>{
  const a=card('a'),b=card('b','a'); a.entries.push(entry('second'));
  expect(accountCardGroups([a,b]).groups.get('a')).toEqual([a,b]);
  expect(a.entries.map(row=>row.id)).toEqual(['a','second']);
 });
 it('keeps ambiguous shared-entry owners separate',()=>{
  const b=card('b','a');
  const x=card('x');x.entries=[entry('a')]; const first=card('a');
  expect(accountCardGroups([first,x,b]).groups.get('x')).toEqual([x]);
 });
 it('keeps copies from two cards sharing one entry in their chosen source card',()=>{
  const a=card('a'),b=card('b');a.entries=[entry('shared')];b.entries=[entry('shared')];
  const childA=card('child-a','card:a'),childB=card('child-b','card:b');
  const {groups}=accountCardGroups([a,b,childA,childB]);
  expect(groups.get('a')).toEqual([a,childA]);expect(groups.get('b')).toEqual([b,childB]);
  expect(groups.get('child-a')).not.toBe(groups.get('child-b'));
 });
 it('retains explicitly card-scoped siblings after source removal without joining other platforms',()=>{
  const a=card('a','card:removed'),b=card('b','card:removed'),c=card('c','card:other');
  expect(accountCardGroups([a,b,c]).groups.get('a')).toEqual([a,b]);
  expect(accountCardGroups([a,b,c]).groups.get('c')).toEqual([c]);
 });
 it('groups virtual and ordinary copied accounts but excludes service keys',()=>{
  const a=card('a'),b={...card('b','a'),virtual:true};
  expect(accountCardGroups([a,b]).groups.get('b')).toEqual([a,b]);
  b.entries[0].isAiKey=true;expect(accountCardGroups([a,b]).groups.get('b')).toEqual([b]);
 });
});
