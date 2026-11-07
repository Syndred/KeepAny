import type { Asset } from '../../../packages/domain/src';
import type { VaultEntrySummary } from '../../../packages/password-vault/src';
import { ACCOUNT_DEFAULTS_ID, parseAccountDefaults } from './account-defaults';
import { ACCOUNT_CARD_GROUPS_PREFERENCE_ID, accountCardGroups, accountCardMembers, parseAccountCardGroups, type AccountCardMember } from './account-card-groups';
import { ACCOUNT_CARD_MERGES_ID, effectiveAccountCardGroups, findAccountCardMerge, mergedAccountDefault, readAccountCardMerges } from './account-card-merge';
import { partitionAccountPasswords } from './workspace-summary';

/** Retain the deleted node only as an invisible provenance anchor, never as a destination. */
export function accountDeleteDestination(anchor: AccountCardMember, assets: readonly Asset[], entries: readonly VaultEntrySummary[], trash: readonly VaultEntrySummary[], preferences: readonly { id: string; value: unknown }[]): AccountCardMember | undefined {
 const live = accountCardMembers(assets, partitionAccountPasswords(entries, assets)).filter(member => member.asset.id !== anchor.asset.id);
 const legacy = parseAccountCardGroups(preferences.find(row => row.id === ACCOUNT_CARD_GROUPS_PREFERENCE_ID)?.value);
 const merges = readAccountCardMerges(preferences.find(row => row.id === ACCOUNT_CARD_MERGES_ID)?.value) ?? [];
 const groups = accountCardGroups([...live, anchor], trash, effectiveAccountCardGroups(legacy, merges));
 const peers = (groups.groups.get(anchor.asset.id) ?? []).filter(member => member.asset.id !== anchor.asset.id);
 const merge = findAccountCardMerge(merges, groups.explicitGroupFor.get(anchor.asset.id));
 const id = mergedAccountDefault(merge, peers, parseAccountDefaults(preferences.find(row => row.id === ACCOUNT_DEFAULTS_ID)?.value));
 return peers.find(member => member.asset.id === id);
}
