import { assetSchema, type Asset } from '../../../packages/domain/src';
import { localRepository } from '../../../packages/local-db/src';
import type { VaultEntrySummary, VaultSession } from '../../../packages/password-vault/src';
import { ACCOUNT_CARD_GROUPS_PREFERENCE_ID, accountCardGroups, parseAccountCardGroups, type AccountCardMember } from './account-card-groups';
import { defaultAccountId, parseAccountDefaults } from './account-defaults';

// A merge and its default are one preference write. Old grouping/default rows
// stay readable by previous versions and remain the fallback for other cards.
export const ACCOUNT_CARD_MERGES_ID = 'keepany-account-card-merges-v1';

type AccountCardPreference = { id: string; value: unknown; deleted?: boolean };
type AccountCardMerge = { ids: string[]; defaultId: string };

export function readAccountCardMerges(value: unknown): AccountCardMerge[] | null {
 if (!Array.isArray(value) || value.length > 100) return null;
 const parsed: AccountCardMerge[] = [];
 for (const item of value as unknown[]) {
  if (!item || typeof item !== 'object' || !('ids' in item) || !('defaultId' in item)
   || !Array.isArray(item.ids) || typeof item.defaultId !== 'string' || !parseAccountDefaults([item.defaultId]).length) return null;
  parsed.push({ ids: item.ids, defaultId: item.defaultId });
 }
 const groups = parseAccountCardGroups(parsed.map(item => item.ids));
 return groups.length === parsed.length ? groups.map((ids, index) => ({ ids, defaultId: parsed[index].defaultId })) : null;
}

export function effectiveAccountCardGroups(legacy: readonly (readonly string[])[], merges: readonly AccountCardMerge[]): string[][] {
 const mergedIds = new Set(merges.flatMap(merge => merge.ids));
 return [
  ...legacy.map(group => group.filter(id => !mergedIds.has(id))).filter(group => group.length > 1),
  ...merges.map(merge => merge.ids),
 ];
}

export function mergedAccountDefault(merge: AccountCardMerge | undefined, members: readonly AccountCardMember[], defaults: readonly string[]): string | undefined {
 return defaultAccountId(members, merge ? [merge.defaultId, ...defaults] : defaults);
}

export function findAccountCardMerge(merges: readonly AccountCardMerge[], explicitGroup: readonly string[] | undefined): AccountCardMerge | undefined {
 const id = explicitGroup?.[0];
 return id === undefined ? undefined : merges.find(merge => merge.ids[0] === id);
}

export type AccountCardMergePlan = Readonly<{
 members: readonly AccountCardMember[];
 ids: readonly string[];
 untouched: readonly AccountCardMerge[];
 expectedAccounts: readonly Asset[];
 expectedMerge: AccountCardPreference | null;
 expectedLegacy: AccountCardPreference | null;
 revision: string;
 contentRevision: string;
}>;
type Inspection =
 | { kind: 'missing'; members: AccountCardMember[] }
 | { kind: 'ready'; plan: AccountCardMergePlan }
 | { kind: 'blocked'; reason: 'stale' | 'limit' | 'unsupported' };

export function inspectAccountCardMerge(
 selectedIds: readonly string[],
 members: readonly AccountCardMember[],
 archived: readonly VaultEntrySummary[],
 preferences: readonly AccountCardPreference[],
 vault: { revision: string | null; contentRevision: string | null },
): Inspection {
 const { revision, contentRevision } = vault;
 const selected = new Set(selectedIds);
 const byId = new Map(members.map(member => [member.asset.id, member]));
 const chosen = selectedIds.map(id => byId.get(id)).filter((member): member is AccountCardMember => Boolean(member));
 if (!revision || !contentRevision || selected.size < 2 || chosen.length !== selected.size) return { kind: 'blocked', reason: 'stale' };
 if (chosen.some(member => member.entries.some(entry => entry.isAiKey))) return { kind: 'blocked', reason: 'unsupported' };

 const expectedLegacy = preferences.find(preference => preference.id === ACCOUNT_CARD_GROUPS_PREFERENCE_ID) ?? null;
 const expectedMerge = preferences.find(preference => preference.id === ACCOUNT_CARD_MERGES_ID) ?? null;
 const legacy = parseAccountCardGroups(expectedLegacy?.deleted ? undefined : expectedLegacy?.value);
 const merges = expectedMerge ? readAccountCardMerges(expectedMerge.value) : [];
 if (!merges || expectedMerge?.deleted) return { kind: 'blocked', reason: 'unsupported' };
 const groups = accountCardGroups(members, archived, effectiveAccountCardGroups(legacy, merges));
 const ids = new Set(selected);
 const missing = new Map<string, AccountCardMember>();
 for (const id of selected) {
  for (const peer of groups.groups.get(id) ?? []) {
   if (!selected.has(peer.asset.id)) missing.set(peer.asset.id, peer);
  }
  // Retain archived and otherwise absent anchors when extending a platform.
  for (const anchor of groups.explicitGroupFor.get(id) ?? []) ids.add(anchor);
 }
 if (missing.size) return { kind: 'missing', members: [...missing.values()] };

 const untouched = merges.filter(merge => !merge.ids.some(id => ids.has(id)));
 const candidate = [...untouched, { ids: [...ids], defaultId: selectedIds[0] }];
 const explicit = effectiveAccountCardGroups(legacy, candidate);
 if (parseAccountCardGroups(explicit).length !== explicit.length) return { kind: 'blocked', reason: 'limit' };

 // Combining explicit roots can change which provenance edge wins. Verify
 // the resulting groups rather than assuming the union of old live members.
 const next = accountCardGroups(members, archived, explicit);
 const merged = next.groups.get(selectedIds[0]) ?? [];
 const extra = merged.filter(member => !selected.has(member.asset.id));
 if (extra.length) return { kind: 'missing', members: extra };
 if (merged.length !== selected.size) return { kind: 'blocked', reason: 'unsupported' };
 for (const member of members) {
  const id = member.asset.id;
  if (selected.has(id)) continue;
  const before = groups.groups.get(id) ?? [];
  const after = next.groups.get(id) ?? [];
  if (before.length !== after.length || before.some((peer, index) => peer.asset.id !== after[index]?.asset.id))
   return { kind: 'blocked', reason: 'unsupported' };
 }

 return { kind: 'ready', plan: {
  members: chosen, ids: [...ids], untouched,
  expectedAccounts: members.filter(member => !member.virtual).map(member => assetSchema.parse(member.asset)),
  expectedLegacy: structuredClone(expectedLegacy), expectedMerge: structuredClone(expectedMerge),
  revision, contentRevision,
 } };
}

type AccountCardMergeRepository = Pick<Awaited<ReturnType<typeof localRepository>>, 'saveAccountCardMergeIfCurrent'>;

export async function mergeAccountCards(session: VaultSession, plan: AccountCardMergePlan, defaultId: string, repository?: AccountCardMergeRepository): Promise<void> {
 const repo = repository ?? await localRepository();
 const snapshot = session.getSnapshot();
 if (snapshot.status !== 'unlocked' || snapshot.revision !== plan.revision || snapshot.contentRevision !== plan.contentRevision) throw Error('vault-stale');
 if (!plan.members.some(member => member.asset.id === defaultId)) throw Error('asset-stale');
 const value = [...plan.untouched, { ids: [...plan.ids], defaultId }];
 await repo.saveAccountCardMergeIfCurrent({
  expectedAccounts: plan.expectedAccounts, expectedVaultRevision: plan.revision,
  expectedLegacy: plan.expectedLegacy, expectedMerge: plan.expectedMerge, value,
 });
}
