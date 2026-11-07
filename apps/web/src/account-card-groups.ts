import { newAsset, type Asset } from '../../../packages/domain/src';
import type { VaultEntrySummary } from '../../../packages/password-vault/src';

export type AccountCardMember = { asset: Asset; entries: VaultEntrySummary[]; virtual: boolean };

/** Shared materialization for list display and post-delete navigation. */
export function accountCardMembers(assets: readonly Asset[], grouped: { linked: ReadonlyMap<string, VaultEntrySummary[]>; unlinked: readonly VaultEntrySummary[] }): AccountCardMember[] {
 return [
  ...assets.filter(asset => !asset.deleted && !asset.purged && asset.kind === 'account').map(asset => ({ asset, entries: grouped.linked.get(asset.id) ?? [], virtual: false })),
  ...grouped.unlinked.map(entry => ({ asset: { ...newAsset('account'), id: `login-${entry.id}`, name: entry.title, category: 'other', username: entry.username, url: entry.url, updatedAt: entry.modifiedAt }, entries: [entry], virtual: true })),
 ];
}


export const ACCOUNT_CARD_GROUPS_PREFERENCE_ID = 'keepany-account-card-groups-v1';
const MAX_EXPLICIT_GROUPS = 100;
const MAX_EXPLICIT_MEMBERS = 1_000;
const MAX_GROUP_MEMBERS = 100;
const MAX_GROUPS_JSON_LENGTH = 128 * 1024;

/** Persist only opaque UI card references; callers provide IDs, never credential fields. */
export function parseAccountCardGroups(value: unknown): string[][] {
 if (typeof value === 'string') {
  if (value.length > MAX_GROUPS_JSON_LENGTH) return [];
  try { value = JSON.parse(value); } catch { return []; }
 }
 if (!Array.isArray(value) || value.length > MAX_EXPLICIT_GROUPS) return [];
 const seen = new Set<string>();
 const groups: string[][] = [];
 for (const group of value) {
  if (!Array.isArray(group) || group.length < 2 || group.length > MAX_GROUP_MEMBERS) return [];
  const ids: string[] = [];
  for (const id of group) {
   if (typeof id !== 'string' || !id || id.length > 256 || id.trim() !== id || /[\u0000-\u001f\u007f-\u009f]/.test(id) || seen.has(id)) return [];
   seen.add(id);
   if (seen.size > MAX_EXPLICIT_MEMBERS) return [];
   ids.push(id);
  }
  groups.push(ids);
 }
 return groups;
}


/** Group only explicit card references or copy provenance. Names and URLs never establish membership. */
export function accountCardGroups(members: readonly AccountCardMember[], archived: readonly VaultEntrySummary[] = [], explicitGroups: readonly (readonly string[])[] = []) {
 const owners = new Map<string, number>();
 for (const member of members) for (const entry of member.entries) owners.set(entry.id, (owners.get(entry.id) ?? 0) + 1);
 const known = new Map(archived.map(entry => [entry.id, entry]));
 for (const member of members) for (const entry of member.entries) known.set(entry.id, entry);
 // Entry ownership connects a copied login back to its existing card, including
 // cards that already expose several independent logins through the old switch.
 const parents = new Map<string,string>();
 const serviceKeyCards = new Set(members.filter(member => member.entries.some(entry => entry.isAiKey)).map(member => member.asset.id));
 const validExplicitGroups = parseAccountCardGroups(explicitGroups).filter(group => !group.some(id => serviceKeyCards.has(id)));
 // Manual grouping is authoritative. Seed every member before copy edges so
 // even a missing/intermediate source cannot bridge two different platforms.
 const explicitLabels = new Map<string,number>();
 validExplicitGroups.forEach((group,index) => {
  for (const id of group) explicitLabels.set(`asset:${id}`,index);
 });
 function root(id: string): string {
  const parent = parents.get(id);
  if (!parent || parent === id) return id;
  const value = root(parent); parents.set(id,value); return value;
 }
 function connect(a: string,b: string) {
  const left = root(a), right = root(b);
  if (left === right) return;
  const leftLabel = explicitLabels.get(left), rightLabel = explicitLabels.get(right);
  if (leftLabel !== undefined && rightLabel !== undefined && leftLabel !== rightLabel) return;
  const winner = left < right ? left : right, loser = left < right ? right : left;
  parents.set(loser,winner);
  explicitLabels.delete(loser);
  const label = leftLabel ?? rightLabel;
  if (label !== undefined) explicitLabels.set(winner,label);
 }
 for (const member of members) for (const entry of member.entries) {
  if (!entry.isAiKey && owners.get(entry.id) === 1) connect(`asset:${member.asset.id}`,`entry:${entry.id}`);
 }
 for (const entry of known.values()) {
  const source = entry.templateSourceId;
  if (!source || entry.isAiKey || (owners.get(entry.id) ?? 0) > 1) continue;
  if (source.startsWith("card:") && source.length > 5) {
   // The explicit card source is kept encrypted and does not inherit ambiguous
   // ownership when the same vault entry is referenced by several public cards.
   connect(`entry:${entry.id}`,`asset:${source.slice(5)}`);
  } else if (!known.get(source)?.isAiKey && (owners.get(source) ?? 0) <= 1) {
   connect(`entry:${entry.id}`,`entry:${source}`);
  }
 }
 // Preferences contain only opaque card IDs. Keep missing nodes as anchors so
 // restoring a deleted member or creating a copied child preserves membership.
 for (const group of validExplicitGroups) {
  for (const id of group.slice(1)) connect(`asset:${group[0]}`, `asset:${id}`);
 }
 const buckets = new Map<string, AccountCardMember[]>();
 for (const member of members) {
  const key = root(`asset:${member.asset.id}`);
  buckets.set(key, [...(buckets.get(key) ?? []), member]);
 }
 const groups = new Map<string, AccountCardMember[]>();
 const ids = new Map<string, string>();
 const explicitGroupFor = new Map<string, readonly string[]>();
 for (const [key, bucket] of buckets) {
  const label = explicitLabels.get(key);
  for (const member of bucket) {
   groups.set(member.asset.id, bucket);
   ids.set(member.asset.id, bucket[0].asset.id);
   if (label !== undefined) explicitGroupFor.set(member.asset.id, validExplicitGroups[label]);
  }
 }
 return { groups, ids, explicitGroupFor };
}
