import { ACCOUNT_ORDER_ID, orderedAccountMembers, parseAccountOrder } from "./account-order";
import { ACCOUNT_DEFAULTS_ID, parseAccountDefaults } from "./account-defaults";
import { useMemo } from "react";
import { useAppContext } from "./view-shared";
import { usePasswordVault } from "./components/PasswordVaultProvider";
import { partitionAccountPasswords } from "./workspace-summary";
import { ACCOUNT_CARD_MERGES_ID, effectiveAccountCardGroups, findAccountCardMerge, mergedAccountDefault, readAccountCardMerges } from "./account-card-merge";
import { ACCOUNT_CARD_GROUPS_PREFERENCE_ID, accountCardGroups, accountCardMembers, parseAccountCardGroups } from "./account-card-groups";

/** The list and both detail routes consume the same live, explicit membership. */
export function useAccountCardGroups() {
 const { data } = useAppContext();
 const { snapshot } = usePasswordVault();
 const grouped = useMemo(() => partitionAccountPasswords(snapshot.status === "unlocked" ? snapshot.entries : [], data.assets), [snapshot.status, snapshot.entries, data.assets]);
 const members = useMemo(() => accountCardMembers(data.assets, grouped), [data.assets, grouped]);
 const virtualAccounts = useMemo(() => members.filter(member => member.virtual).map(member => member.asset), [members]);
 const virtualEntries = useMemo(() => new Map(members.filter(member => member.virtual).map(member => [member.asset.id, member.entries[0]])), [members]);
 const value = data.preferences.find(preference => preference.id === ACCOUNT_CARD_GROUPS_PREFERENCE_ID && !("deleted" in preference && preference.deleted === true))?.value;
 const mergePreference = data.preferences.find(preference => preference.id === ACCOUNT_CARD_MERGES_ID && !("deleted" in preference && preference.deleted === true));
 const merges = useMemo(() => readAccountCardMerges(mergePreference?.value) ?? [], [mergePreference?.value]);
 const explicitGroups = useMemo(() => effectiveAccountCardGroups(parseAccountCardGroups(value), merges), [value, merges]);
 const baseGroups = useMemo(() => accountCardGroups(members, snapshot.status === "unlocked" ? snapshot.trash : [], explicitGroups), [members, snapshot.status, snapshot.trash, explicitGroups]);
 const orderPreference = data.preferences.find(preference => preference.id === ACCOUNT_ORDER_ID);
 const order = useMemo(() => parseAccountOrder(orderPreference && "deleted" in orderPreference && orderPreference.deleted === true ? undefined : orderPreference?.value), [orderPreference]);
 const cardGroups = useMemo(() => {
  const sorted = new Map<string, ReturnType<typeof orderedAccountMembers>>();
  const cached = new Map<ReturnType<typeof orderedAccountMembers>, ReturnType<typeof orderedAccountMembers>>();
  for (const [id, bucket] of baseGroups.groups) {
   let ordered = cached.get(bucket);
   if (!ordered) { ordered = orderedAccountMembers(bucket, order); cached.set(bucket, ordered); }
   sorted.set(id, ordered);
  }
  return { groups: sorted, ids: baseGroups.ids };
 }, [baseGroups, order]);
 const defaultPreference = data.preferences.find(preference => preference.id === ACCOUNT_DEFAULTS_ID);
 const defaults = useMemo(() => parseAccountDefaults(defaultPreference && "deleted" in defaultPreference && defaultPreference.deleted === true ? undefined : defaultPreference?.value), [defaultPreference]);
 const mergeFor = (id: string) => findAccountCardMerge(merges, baseGroups.explicitGroupFor.get(id));
 const defaultFor = (id: string) => mergedAccountDefault(mergeFor(id), baseGroups.groups.get(id) ?? [], defaults);
 return { members, merges, mergeFor, mergePreference, grouped, virtualAccounts, virtualEntries, baseGroups, cardGroups, defaultPreference, defaults, defaultFor, orderPreference, order };
}
