import { useState } from "react";
import type { Asset } from "../../../../packages/domain/src";
import { useAccountCardGroups } from "../use-account-card-groups";
import { usePasswordVault } from "./PasswordVaultProvider";
import { AccountEntryDialog } from "./AccountEntryDialog";

type Props = Parameters<typeof AccountEntryDialog>[0];
/** Keeps list editing in the existing modal while selecting a whole platform member. */
export function AccountCardEditDialog(props: Props) {
 const { cardGroups } = useAccountCardGroups();
 const { snapshot } = usePasswordVault();
 const [target, setTarget] = useState<{ asset?: Asset; entryId?: string }>(() => ({ asset: props.asset, entryId: props.entryId }));
 const id = target.asset?.id ?? (target.entryId ? `login-${target.entryId}` : "");
 const members = cardGroups.groups.get(id) ?? [];
 const index = members.findIndex(member => member.asset.id === id);
 if (snapshot.status !== "unlocked") return null;
 return <AccountEntryDialog {...props} {...target} key={`${id}:${target.entryId ?? ""}`} platformAccount={{ id, position: index + 1, total: members.length, onNext: () => {
  const next = members[(index + 1) % members.length];
  if (!next || index < 0) return;
  setTarget({ asset: next.virtual ? undefined : next.asset, entryId: next.entries[0]?.id });
 } }} />;
}
