import { describe, expect, it } from 'vitest';
import { newAsset } from '../../../packages/domain/src';
import { chooseAccountDefault, defaultAccountId, parseAccountDefaults } from './account-defaults';
import type { AccountCardMember } from './account-card-groups';
const card = (id: string): AccountCardMember => ({ asset:{...newAsset('account'),id},entries:[],virtual:false });
describe('platform default display preference', () => {
 it('accepts opaque public and encrypted-only references, rejects malformed preferences', () => {
  expect(parseAccountDefaults(['login-private','ordinary','login-private'])).toEqual(['login-private','ordinary']);
  for(const bad of [{},[''],[' a'],['a\n'],[12],Array(1001).fill('a')]) expect(parseAccountDefaults(bad)).toEqual([]);
 });
 it('keeps a chosen member across reordered group anchors without changing cards', () => {
  const members=[card('a'),card('b')],before=JSON.stringify(members);
  const pref=chooseAccountDefault(members,['other-platform'],'b');
  expect(defaultAccountId(members,pref)).toBe('b');expect(defaultAccountId([...members].reverse(),pref)).toBe('b');
  expect(JSON.stringify(members)).toBe(before);expect(pref).toContain('other-platform');
 });
 it('falls back for missing or deleted members and restores the selection when they return', () => {
  expect(defaultAccountId([card('a')],['b'])).toBe('a');
  expect(defaultAccountId([card('a'),card('b')],['b'])).toBe('b');
  expect(defaultAccountId([],['b'])).toBeUndefined();
 });
 it('changes only the current group choice and safely rejects out-of-group IDs', () => {
  const members=[card('a'),card('b')];expect(chooseAccountDefault(members,['b','other','a'],'a')).toEqual(['a','other']);
  expect(()=>chooseAccountDefault(members,['other'],'outside')).toThrow('asset-stale');
 });
 it('uses the most recent choice if two explicitly selected groups later join', () => {
  expect(defaultAccountId([card('a'),card('b')],['b','a'])).toBe('b');
 });
});
