import { describe, expect, it } from 'vitest';
import { newAsset } from '../../../packages/domain/src';
import type { AccountCardMember } from './account-card-groups';
import { defaultAccountId } from './account-defaults';
import { ACCOUNT_ORDER_ID, compareAccountCreationNewestFirst, orderedAccountMembers, parseAccountOrder, reorderAccountPeers } from './account-order';
const member = (id: string, virtual = false): AccountCardMember => ({ asset: { ...newAsset('account'), id, name: id }, entries: [], virtual });
const ids = (rows: readonly AccountCardMember[]) => rows.map(row => row.asset.id);

describe('account creation order', () => {
 it('sorts creation instants newest first, breaks ties by ID, and puts unknown dates last', () => {
  const rows = [
   { id: 'missing', createdAt: '' },
   { id: 'private', createdAt: '2026-11-06T00:00:00Z' },
   { id: 'legacy', createdAt: '1970-01-01T00:00:00Z', updatedAt: '2026-11-07T00:00:00Z' },
   { id: 'account', createdAt: '2026-11-06T08:00:00+08:00' },
   { id: 'newest', createdAt: '2026-11-06T19:00:00-07:00' },
   { id: 'invalid', createdAt: 'not a date' },
  ];
  expect(rows.sort(compareAccountCreationNewestFirst).map(row => row.id))
   .toEqual(['newest', 'account', 'private', 'legacy', 'invalid', 'missing']);
 });
});

describe('account cycle order', () => {
 it('accepts only bounded opaque IDs and rejects malformed preferences', () => {
  expect(ACCOUNT_ORDER_ID).toBe('keepany-account-order-v1');
  expect(parseAccountOrder(['a', 'a', 'login-private'])).toEqual(['a', 'login-private']);
  for (const value of [null, {}, '["a"]', [''], [' a'], ['b\n'], [3], ['x'.repeat(257)], Array(1001).fill('a')]) expect(parseAccountOrder(value)).toEqual([]);
 });
 it('uses stored order and appends new members without mutating source members', () => {
  const members = [member('a'), member('b'), member('login-private', true), member('new')];
  const before = JSON.stringify(members);
  expect(ids(orderedAccountMembers(members, ['login-private', 'b', 'absent', 'a']))).toEqual(['login-private', 'b', 'a', 'new']);
  expect(JSON.stringify(members)).toBe(before);
 });
 it('preserves the viewed account index when peers move in either direction', () => {
  const members = ['a','current','b','c'].map(id => member(id));
  expect(reorderAccountPeers(members, [], 'current', 'c', 'a')).toEqual(['c','current','a','b']);
  expect(reorderAccountPeers(members, [], 'current', 'a', 'c')).toEqual(['b','current','c','a']);
 });
 it('keeps current at the beginning or end while peers reorder', () => {
  expect(reorderAccountPeers(['current','a','b'].map(id => member(id)), [], 'current', 'b', 'a')).toEqual(['current','b','a']);
  expect(reorderAccountPeers(['a','b','current'].map(id => member(id)), [], 'current', 'b', 'a')).toEqual(['b','a','current']);
 });
 it('retains other platform and missing-member slots while saving the full live group', () => {
  const previous = ['other-a','a','deleted','current','other-b','b'];
  const result = reorderAccountPeers(['a','current','b'].map(id => member(id)), previous, 'current', 'b', 'a');
  expect(result).toEqual(['other-a','b','deleted','current','other-b','a']);
  expect(previous).toEqual(['other-a','a','deleted','current','other-b','b']);
  expect(ids(orderedAccountMembers(['a','deleted','current','b','new'].map(id => member(id)), result))).toEqual(['b','deleted','current','a','new']);
 });
 it('does not change the base default when cycle order changes, including private members', () => {
  const base = [member('a'), member('login-private', true), member('b')];
  const order = reorderAccountPeers(base, [], 'login-private', 'b', 'a');
  expect(ids(orderedAccountMembers(base, order))).toEqual(['b','login-private','a']);
  expect(defaultAccountId(base, [])).toBe('a');
  expect(defaultAccountId(base, ['login-private'])).toBe('login-private');
 });
 it('refuses stale current, target, active and moving the hidden current itself', () => {
  const members = ['a','b','c'].map(id => member(id));
  for (const args of [['missing','a','b'], ['a','missing','b'], ['a','b','missing'], ['a','a','b'], ['a','b','a']]) expect(() => reorderAccountPeers(members, [], args[0], args[1], args[2])).toThrow('asset-stale');
 });
 it('keeps the same order for a no-op move and rejects preferences exceeding the storage bound', () => {
  const members = ['a','b','c'].map(id => member(id));
  expect(reorderAccountPeers(members, ['other','a','b','c'], 'a', 'b', 'b')).toEqual(['other','a','b','c']);
  expect(() => reorderAccountPeers(members, Array.from({length:1000},(_,i)=>`other-${i}`), 'a', 'b', 'c')).toThrow('account-order-limit');
 });
});
