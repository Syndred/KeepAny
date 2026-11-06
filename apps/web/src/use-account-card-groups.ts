import { ACCOUNT_ORDER_ID, orderedAccountMembers, parseAccountOrder } from "./account-order";
import { ACCOUNT_DEFAULTS_ID, defaultAccountId, parseAccountDefaults } from "./account-defaults";
import { useMemo } from "react";
import { newAsset } from "../../../packages/domain/src";
import { useAppContext } from "./view-shared";
import { usePasswordVault } from "./components/PasswordVaultProvider";
import { partitionAccountPasswords } from "./workspace-summary";
import { ACCOUNT_CARD_GROUPS_PREFERENCE_ID, accountCardGroups, parseAccountCardGroups } from "./account-card-groups";

/** The list and both detail routes consume the same live, explicit membership. */
export function useAccountCardGroups() {
 const { data } = useAppContext();
 const { snapshot } = usePasswordVault();
 const grouped = useMemo(() => partitionAccountPasswords(snapshot.status === "unlocked" ? snapshot.entries : [], data.assets), [snapshot.status, snapshot.entries, data.assets]);
 const virtualAccounts = useMemo(() => grouped.unlinked.map(entry => ({ ...newAsset("account"), id: `login-${entry.id}`, name: entry.title, category: "other", username: entry.username, url: entry.url, updatedAt: entry.modifiedAt })), [grouped.unlinked]);
 const virtualEntries = useMemo(() => new Map(grouped.unlinked.map(entry => [`login-${entry.id}`, entry])), [grouped.unlinked]);
 const members = useMemo(() => [
  ...data.assets.filter(asset => !asset.deleted && !asset.purged && asset.kind === "account").map(asset => ({ asset, entries: grouped.linked.get(asset.id) ?? [], virtual: false })),
  ...virtualAccounts.map(asset => ({ asset, entries: [virtualEntries.get(asset.id)!], virtual: true })),
 ], [data.assets, grouped.linked, virtualAccounts, virtualEntries]);
 const value = data.preferences.find(preference => preference.id === ACCOUNT_CARD_GROUPS_PREFERENCE_ID && !("deleted" in preference && preference.deleted === true))?.value;
 const explicitGroups = useMemo(() => parseAccountCardGroups(value), [value]);
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
 const defaultFor = (id: string) => defaultAccountId(baseGroups.groups.get(id) ?? [], defaults);
 return { grouped, virtualAccounts, virtualEntries, cardGroups, defaultPreference, defaults, defaultFor, orderPreference, order };
}
