import type { Asset } from '../../../packages/domain/src';
import type { VaultEntrySummary } from '../../../packages/password-vault/src';

export type AccountCardMember = { asset: Asset; entries: VaultEntrySummary[]; virtual: boolean };

/** Group only explicitly copied accounts. No names, URLs or secrets establish membership. */
export function accountCardGroups(members: readonly AccountCardMember[], archived: readonly VaultEntrySummary[] = []) {
 const owners = new Map<string, number>();
 for (const member of members) for (const entry of member.entries) owners.set(entry.id, (owners.get(entry.id) ?? 0) + 1);
 const known = new Map(archived.map(entry => [entry.id, entry]));
 for (const member of members) for (const entry of member.entries) known.set(entry.id, entry);
 // Entry ownership connects a copied login back to its existing card, including
 // cards that already expose several independent logins through the old switch.
 const parents = new Map<string,string>();
 function root(id: string): string {
  const parent = parents.get(id);
  if (!parent || parent === id) return id;
  const value = root(parent); parents.set(id,value); return value;
 }
 function connect(a: string,b: string) {
  const left = root(a), right = root(b);
  if (left !== right) parents.set(left < right ? right : left,left < right ? left : right);
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
 const buckets = new Map<string, AccountCardMember[]>();
 for (const member of members) {
  const key = root(`asset:${member.asset.id}`);
  buckets.set(key, [...(buckets.get(key) ?? []), member]);
 }
 const groups = new Map<string, AccountCardMember[]>();
 const ids = new Map<string, string>();
 for (const bucket of buckets.values()) for (const member of bucket) {
  groups.set(member.asset.id, bucket);
  ids.set(member.asset.id, bucket[0].asset.id);
 }
 return { groups, ids };
}
