import { describe, expect, it } from 'vitest';
import { newAsset } from '../../../packages/domain/src';
import type { VaultEntrySummary } from '../../../packages/password-vault/src';
import { ACCOUNT_CARD_GROUPS_PREFERENCE_ID, parseAccountCardGroups, accountCardGroups, accountCardMembers, type AccountCardMember } from './account-card-groups';
const entry = (id: string, source?: string): VaultEntrySummary => ({id, title:'Same platform',username:id,url:'https://same.test',linkedAssetIds:[id],modifiedAt:'2026-11-05T00:00:00Z',historyCount:0,...(source?{templateSourceId:source}:{})});
const card = (id: string, source?: string): AccountCardMember => ({asset:{...newAsset('account'),id,name:'Same platform'},entries:[entry(id,source)],virtual:false});

it('preserves ordinary creation dates and uses only the vault creation date for a private card', () => {
 const ordinary = { ...card('ordinary').asset, createdAt: '2026-10-01T00:00:00Z' };
 const dated = { ...entry('dated'), linkedAssetIds: [], createdAt: '2026-10-02T00:00:00Z' };
 const undated = { ...entry('undated'), linkedAssetIds: [] };
 const members = accountCardMembers([ordinary], { linked: new Map(), unlinked: [dated, undated] });

 expect(members.map(({ asset }) => [asset.id, asset.createdAt, asset.updatedAt])).toEqual([
  ['ordinary', ordinary.createdAt, ordinary.updatedAt],
  ['login-dated', dated.createdAt, dated.modifiedAt],
  ['login-undated', '', undated.modifiedAt],
 ]);
});

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


describe('explicit account card preference groups', () => {
 it('uses a fixed preference ID and accepts opaque ordinary and virtual card IDs', () => {
  expect(ACCOUNT_CARD_GROUPS_PREFERENCE_ID).toBe('keepany-account-card-groups-v1');
  const groups = [['pw-account-abc', 'login-h/IFRNbHE6HEhrlCxrOhyg==']];
  expect(parseAccountCardGroups(JSON.stringify(groups))).toEqual(groups);
  expect(parseAccountCardGroups(groups)).toEqual(groups);
  expect(parseAccountCardGroups(groups)).not.toBe(groups);
 });
 it('rejects malformed structures, invalid identifiers and overlapping or duplicate members entirely', () => {
  for (const value of [undefined, null, {}, '{', {groups:[['a','b']]}, ['a','b'], [['a']], [['a','a']], [['a','b'],['b','c']], [['a',1]], [['a',' b']], [['a','b ']], [['a','']], [['a','b\u0000c']], [['a','b\nc']], [['a','x'.repeat(257)]]]) {
   expect(parseAccountCardGroups(value)).toEqual([]);
  }
  expect(parseAccountCardGroups([['a','b'], null])).toEqual([]);
 });
 it('bounds serialized size, individual groups, total members and number of groups', () => {
  expect(parseAccountCardGroups(' '.repeat(128 * 1024 + 1))).toEqual([]);
  expect(parseAccountCardGroups([Array.from({length:101},(_,i)=>`id-${i}`)])).toEqual([]);
  expect(parseAccountCardGroups(Array.from({length:101},(_,i)=>[`a-${i}`,`b-${i}`]))).toEqual([]);
  expect(parseAccountCardGroups(Array.from({length:11},(_,g)=>Array.from({length:100},(_,i)=>`id-${g}-${i}`)))).toEqual([]);
 });
 it('groups only selected ordinary and private cards while preserving all individual member data', () => {
  const a=card('a'),b={...card('login-private'),virtual:true},other=card('other');
  const before=JSON.stringify([a,b,other]);
  const groups=accountCardGroups([a,b,other],[],[['a','login-private']]).groups;
  expect(groups.get('a')).toEqual([a,b]);expect(groups.get('other')).toEqual([other]);
  expect(JSON.stringify([a,b,other])).toBe(before);
 });
 it('automatically includes new copies of an explicitly grouped parent after a preference reload', () => {
  const members=[card('a'),card('b'),card('child','card:b')];
  const saved=JSON.stringify([['a','b']]);
  const first=accountCardGroups(members,[],parseAccountCardGroups(saved));
  const reloaded=accountCardGroups(members,[],parseAccountCardGroups(saved));
  expect(first.groups.get('child')).toEqual(members);
  expect(reloaded.ids).toEqual(first.ids);
 });
 it('keeps missing member anchors so restoring a deleted account rejoins its original group', () => {
  const a=card('a'),b=card('b'),c=card('c');
  const explicit=[['a','b','c']];
  expect(accountCardGroups([a,c],[],explicit).groups.get('c')).toEqual([a,c]);
  expect(accountCardGroups([a,b,c],[],explicit).groups.get('b')).toEqual([a,b,c]);
 });
 it('keeps service-key cards outside explicit account display groups', () => {
  const a=card('a'),key=card('key');key.entries[0].isAiKey=true;
  expect(accountCardGroups([a,key],[],[['a','key']]).groups.get('a')).toEqual([a]);
 });
 it('keeps different explicit platforms apart despite direct legacy entry and card provenance', () => {
  for (const source of ['x-one', 'card:x-one']) {
   const x1=card('x-one'),x2=card('x-two'),tk1=card('tk-one',source),tk2=card('tk-two');
   const input=[x1,x2,tk1,tk2],before=JSON.stringify(input);
   const {groups}=accountCardGroups(input,[],[['x-one','x-two'],['tk-one','tk-two']]);
   expect(groups.get('x-one')).toEqual([x1,x2]);
   expect(groups.get('tk-one')).toEqual([tk1,tk2]);
   expect(JSON.stringify(input)).toBe(before);
  }
 });
 it('propagates explicit group labels so an unassigned provenance bridge cannot join platforms indirectly', () => {
  const x1=card('x-one'),x2=card('x-two'),bridge=card('bridge','x-one'),tk1=card('tk-one','bridge'),tk2=card('tk-two');
  for (const input of [[x1,x2,bridge,tk1,tk2],[tk2,tk1,bridge,x2,x1]]) {
   const {groups}=accountCardGroups(input,[],[['x-one','x-two'],['tk-one','tk-two']]);
   expect(groups.get('x-one')!.some(member=>member.asset.id==='x-two')).toBe(true);
   expect(groups.get('tk-one')!.some(member=>member.asset.id==='tk-two')).toBe(true);
   expect(groups.get('x-one')!.some(member=>member.asset.id.startsWith('tk-'))).toBe(false);
   expect(groups.get('tk-one')!.some(member=>member.asset.id.startsWith('x-'))).toBe(false);
  }
 });
 it('fails closed for invalid direct group input without altering existing copy provenance', () => {
  const a=card('a'),b=card('b','a'),c=card('c');
  expect(accountCardGroups([a,b,c],[],[['a','c'],['a','b']]).groups.get('a')).toEqual([a,b]);
 });
});
