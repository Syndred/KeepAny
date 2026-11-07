import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { newAsset, type Asset } from '../../../packages/domain/src';
import { openLocalRepository } from '../../../packages/local-db/src';
import { VaultSession, type VaultEntrySummary } from '../../../packages/password-vault/src';
import { accountCardGroups, accountCardMembers, ACCOUNT_CARD_GROUPS_PREFERENCE_ID, type AccountCardMember } from './account-card-groups';
import { ACCOUNT_CARD_MERGES_ID, effectiveAccountCardGroups, findAccountCardMerge, inspectAccountCardMerge, mergeAccountCards, mergedAccountDefault, readAccountCardMerges } from './account-card-merge';
import { ACCOUNT_DEFAULTS_ID } from './account-defaults';
import { accountDeleteDestination } from './account-delete-destination';
import { partitionAccountPasswords } from './workspace-summary';

const member = (id: string, entries: VaultEntrySummary[] = []): AccountCardMember => ({
 asset: { ...newAsset('account'), id, name: id },
 entries,
 virtual: false,
});
const inherited = (id: string, source: string): VaultEntrySummary => ({
 id, title: id, username: 'same@example.test', url: '',
 linkedAssetIds: [id], modifiedAt: '2026-11-07T00:00:00Z', historyCount: 0, templateSourceId: source,
});
const revision = { revision: 'vault', contentRevision: 'content' };
const legacy = (value: string[][]) => ({ id: ACCOUNT_CARD_GROUPS_PREFERENCE_ID, value });

describe('account card merge preview', () => {
 it('lists every unselected member of a platform, including provenance peers', () => {
  const a = member('a'), b = member('b', [inherited('b', 'card:a')]), c = member('c'), d = member('d');
  const result = inspectAccountCardMerge(['a', 'c'], [a, b, c, d], [], [legacy([['a', 'd']])], revision);
  expect(result).toEqual({ kind: 'missing', members: [b, d] });
 });

 it('retains dormant anchors and unrelated groups when extending an existing platform', () => {
  const a = member('a'), b = member('b'), c = member('c'), d = member('d'), e = member('e');
  const oldGroups = [['a', 'previously-recycled'], ['d', 'e']];
  const preview = inspectAccountCardMerge(['a', 'b', 'c'], [a, b, c, d, e], [], [legacy(oldGroups)], revision);
  if (preview.kind !== 'ready') throw Error('Expected ready preview');
  expect(preview.plan.ids).toEqual(['a', 'b', 'c', 'previously-recycled']);
  const revived = member('previously-recycled');
  const groups = accountCardGroups([a, b, c, d, e, revived], [], effectiveAccountCardGroups(oldGroups, [{ ids: [...preview.plan.ids], defaultId: 'b' }]));
  expect(groups.groups.get('a')).toEqual([a, b, c, revived]);
  expect(groups.groups.get('d')).toEqual([d, e]);
 });

 it('blocks AI keys, malformed preferences and a selection outside the reviewed snapshot', () => {
  const a = member('a'), b = member('b', [{ ...inherited('b', 'card:a'), isAiKey: true }]), c = member('c');
  expect(inspectAccountCardMerge(['a', 'b'], [a, b, c], [], [], revision)).toEqual({ kind: 'blocked', reason: 'unsupported' });
  expect(inspectAccountCardMerge(['a', 'c'], [a, b, c], [], [{ id: ACCOUNT_CARD_MERGES_ID, value: [{ ids: ['a', 'a'], defaultId: 'a' }] }], revision)).toEqual({ kind: 'blocked', reason: 'unsupported' });
  expect(inspectAccountCardMerge(['a', 'missing'], [a, b, c], [], [], revision)).toEqual({ kind: 'blocked', reason: 'stale' });
 });
});

async function fixture() {
 const repository = await openLocalRepository(`account-card-merge-${crypto.randomUUID().slice(0, 8)}`);
 const session = new VaultSession({
  read: () => repository.readPasswordVault(),
  write: (bytes, expected) => repository.savePasswordVault(bytes, expected),
 });
 await session.initialize();
 await session.create('Synthetic merge account master 2026!');
 const a = { ...newAsset('account'), id: 'a', name: 'Cloud team', username: 'same@example.test', category: 'email', url: 'https://cloud.example.test/', notes: 'Team note' };
 const b = { ...newAsset('account'), id: 'b', name: 'Cloud personal', username: 'same@example.test', category: 'other', url: 'https://personal.example.test/', notes: 'Personal note' };
 await repository.save('asset', a);
 await repository.save('asset', b);
 await repository.save('relation', { id: 'relation', from: a.id, to: b.id, label: 'Shared team', createdAt: '2026-11-07' });
 await repository.save('history', { id: 'history', assetId: b.id, action: 'maintenance', note: 'Personal history', createdAt: '2026-11-07' });
 await repository.save('preference', legacy([[a.id, 'recycled']]));
 await repository.save('preference', { id: ACCOUNT_DEFAULTS_ID, value: [a.id] });
 const aEntry = await session.saveEntry({ title: a.name, username: a.username, url: a.url, notes: 'Team login note', password: 'Synthetic first password', linkedAssetIds: [a.id] });
 const bEntry = await session.saveEntry({ title: b.name, username: b.username, url: b.url, notes: 'Personal login note', password: 'Synthetic other password', linkedAssetIds: [b.id] });
 await session.saveEntry({ ...session.readEntry(bEntry), password: 'Synthetic personal updated password' });
 const privateEntry = await session.saveEntry({ title: 'Private synthetic', username: a.username, url: '', notes: 'Private note', password: 'Synthetic private password', linkedAssetIds: [] });

 async function preview(ids = [a.id, b.id, `login-${privateEntry}`]) {
  const assets = await repository.list<Asset>('asset');
  const preferences = await repository.list<{ id: string; value: unknown }>('preference');
  const snapshot = session.getSnapshot();
  const cards = accountCardMembers(assets, partitionAccountPasswords(snapshot.entries, assets));
  const result = inspectAccountCardMerge(ids, cards, snapshot.trash, preferences, snapshot);
  if (result.kind !== 'ready') throw Error(`Expected ready preview, got ${result.kind}`);
  return result.plan;
 }
 async function close() { session.lock(); await repository.close(); }
 return { repository, session, a, b, aEntry, bEntry, privateEntry, preview, close };
}

describe('lossless account card merge persistence', () => {
 it('writes only a preference and preserves both same-name logins, notes, relationships and history', async () => {
  const f = await fixture();
  try {
   const { repository, session, a, b, aEntry, bEntry, privateEntry } = f;
   const plan = await f.preview();
   const ordinary = await Promise.all([repository.list('asset'), repository.list('relation'), repository.list('history')]);
   const vault = await repository.readPasswordVault();
   const history = session.history(bEntry);
   await mergeAccountCards(session, plan, b.id, repository);
   expect(await repository.readPasswordVault()).toEqual(vault);
   expect(session.history(bEntry)).toEqual(history);
   expect([aEntry, bEntry, privateEntry].map(id => session.readEntry(id).username)).toEqual(Array(3).fill(a.username));
   expect(await Promise.all([repository.list('asset'), repository.list('relation'), repository.list('history')])).toEqual(ordinary);
   const legacyValue = (await repository.get<{ value: string[][] }>('preference', ACCOUNT_CARD_GROUPS_PREFERENCE_ID))!.value;
   expect(legacyValue).toEqual([[a.id, 'recycled']]);
   expect(await repository.get('preference', ACCOUNT_DEFAULTS_ID)).toMatchObject({ value: [a.id] });
   const value = (await repository.get<{ value: unknown }>('preference', ACCOUNT_CARD_MERGES_ID))!.value;
   const merges = readAccountCardMerges(value)!;
   expect(merges).toEqual([{ ids: [a.id, b.id, `login-${privateEntry}`, 'recycled'], defaultId: b.id }]);
   const groups = accountCardGroups(plan.members, [], effectiveAccountCardGroups(legacyValue, merges));
   const effective = findAccountCardMerge(merges, groups.explicitGroupFor.get(a.id));
   expect(mergedAccountDefault(effective, groups.groups.get(a.id)!, [a.id])).toBe(b.id);
   expect(accountDeleteDestination(plan.members[0], [b], session.getSnapshot().entries, [], [
    legacy(legacyValue), { id: ACCOUNT_CARD_MERGES_ID, value },
   ])?.asset.id).toBe(b.id);
  } finally { await f.close(); }
 });

 it('rejects stale asset, vault and grouping changes before writing', async () => {
  const f = await fixture();
  try {
   const { repository, session, a, aEntry } = f;
   const oldAsset = await f.preview();
   await repository.saveAssetIfCurrent(a, { ...a, name: 'Edited meanwhile' });
   await expect(mergeAccountCards(session, oldAsset, a.id, repository)).rejects.toThrow('asset-stale');
   const oldVault = await f.preview();
   // Write with a separate session so the dialog session still holds the old snapshot.
   const other = new VaultSession({ read: () => repository.readPasswordVault(), write: (bytes, expected) => repository.savePasswordVault(bytes, expected) });
   await other.initialize();
   await other.unlock('Synthetic merge account master 2026!');
   await other.saveEntry({ ...other.readEntry(aEntry), notes: 'Changed elsewhere' });
   await expect(mergeAccountCards(session, oldVault, a.id, repository)).rejects.toThrow('vault-stale');
   other.lock();
   session.lock();
   await session.unlock('Synthetic merge account master 2026!');
   const oldGroups = await f.preview();
   await repository.save('preference', legacy([[a.id, 'recycled', 'another-recycled']]));
   await expect(mergeAccountCards(session, oldGroups, a.id, repository)).rejects.toThrow('preference-stale');
   expect(await repository.get('preference', ACCOUNT_CARD_MERGES_ID)).toBeNull();
  } finally { await f.close(); }
 });

 it('safely acknowledges the same write again and rejects a conflicting default from the stale plan', async () => {
  const f = await fixture();
  try {
   const { repository, session, a, b } = f;
   const plan = await f.preview();
   const write = repository.saveAccountCardMergeIfCurrent.bind(repository);
   vi.spyOn(repository, 'saveAccountCardMergeIfCurrent').mockImplementationOnce(async input => {
    await write(input);
    throw Error('Synthetic lost acknowledgement');
   });
   await expect(mergeAccountCards(session, plan, b.id, repository)).rejects.toThrow('Synthetic lost acknowledgement');
   await mergeAccountCards(session, plan, b.id, repository);
   await expect(mergeAccountCards(session, plan, a.id, repository)).rejects.toThrow('preference-stale');
   expect(await repository.get('preference', ACCOUNT_CARD_MERGES_ID)).toMatchObject({
    value: [expect.objectContaining({ defaultId: b.id })],
   });
  } finally { await f.close(); }
 });
});
