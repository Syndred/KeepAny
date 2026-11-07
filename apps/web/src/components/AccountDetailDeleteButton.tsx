import { useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import { localRepository } from "../../../../packages/local-db/src";
import { prepareAccountCardDelete, type AccountCardDeleteTarget } from "../account-card-delete";
import { accountDeleteDestination } from "../account-delete-destination";
import type { AccountCardMember } from "../account-card-groups";
import { useAccountCardGroups } from "../use-account-card-groups";
import { useAppContext } from "../view-shared";
import { usePasswordVault, type PasswordVaultEntrySummary } from "./PasswordVaultProvider";
import { AccountDeleteDialog } from "./AccountDeleteDialog";
import { Button } from "./ui/button";
import "../account-detail-delete.css";

/** Delete one platform member, then show the surviving platform default. */
export function AccountDetailDeleteButton({ asset, entry, privateOnly = false }: { asset: Asset; entry?: PasswordVaultEntrySummary; username?: string; privateOnly?: boolean }) {
 const { t } = useTranslation(), { notify } = useAppContext(), { snapshot, session } = usePasswordVault();
 const { baseGroups } = useAccountCardGroups();
 const navigate = useNavigate();
 const [target, setTarget] = useState<{ request: AccountCardDeleteTarget; anchor: AccountCardMember; name: string } | null>(null);
 useEffect(() => { if (snapshot.status !== "unlocked") setTarget(null); }, [snapshot.status]);
 function open() {
  if (!session || session.getSnapshot().status !== "unlocked") return;
  try { setTarget({ request: prepareAccountCardDelete(session, privateOnly ? { entryId: entry?.id } : { asset }), anchor: (baseGroups.groups.get(asset.id) ?? []).find(member => member.asset.id === asset.id) ?? { asset, entries: entry ? [entry] : [], virtual: privateOnly }, name: asset.name }); }
  catch { notify(t("assetStale")); }
 }
 async function showDefault(anchor: AccountCardMember) {
  try {
   const repo = await localRepository();
   const [assets, preferences] = await Promise.all([repo.list<Asset>("asset"), repo.list<{ id: string; value: unknown }>("preference")]);
   const current = session?.getSnapshot();
   const next = current?.status === "unlocked" ? accountDeleteDestination(anchor, assets, current.entries, current.trash, preferences) : undefined;
   if (next) { void navigate(next.virtual ? { to: "/accounts", hash: `login-detail-${next.entries[0].id}`, replace: true } : { to: "/assets/$kind/$id", params: { kind: "account", id: next.asset.id }, hash: "", replace: true }); return; }
  } catch { notify(t("error")); }
  void navigate({ to: "/accounts", hash: "", replace: true });
 }
 return <span className="account-detail-delete-control"><Button data-account-detail-delete disabled={snapshot.status !== "unlocked"} onClick={open}><Trash2 size={17}/>{t("accountDetailDelete")}</Button>{target && <AccountDeleteDialog target={target.request} name={target.name} onClose={() => setTarget(null)} onDeleted={() => void showDefault(target.anchor)}/>}</span>;
}
