import { useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAccountCardGroups } from "../use-account-card-groups";
import { usePasswordVault } from "./PasswordVaultProvider";
import { Button } from "./ui/button";

export function AccountPlatformSwitch({ assetId }: { assetId: string }) {
 const { t } = useTranslation();
 const navigate = useNavigate();
 const { cardGroups } = useAccountCardGroups();
 const { snapshot } = usePasswordVault();
 const members = cardGroups.groups.get(assetId) ?? [];
 const index = members.findIndex(member => member.asset.id === assetId);
 const label = t("compactAccountNextAccount", { index: Math.max(0, index) + 1, total: Math.max(1, members.length) });
 // Route remounts reset revealed secrets, history, dialogs and selected aliases.
 // Restore focus only for keyboard activation of this control, never ordinary visits.
 useLayoutEffect(() => {
  if (sessionStorage.getItem("keepany-detail-switch-focus") !== assetId) return;
  sessionStorage.removeItem("keepany-detail-switch-focus");
  document.querySelector<HTMLButtonElement>("[data-account-detail-switch]")?.focus();
 }, [assetId]);
 return <Button size="icon" variant="ghost" data-account-detail-switch aria-label={label} title={label} disabled={snapshot.status !== "unlocked" || members.length < 2} onClick={event => {
  const next = members[(index + 1) % members.length];
  if (!next) return;
  if (event.detail === 0) sessionStorage.setItem("keepany-detail-switch-focus", next.asset.id);
  void navigate(next.virtual
   ? { to: "/accounts", hash: `login-detail-${next.entries[0].id}` }
   : { to: "/assets/$kind/$id", params: { kind: "account", id: next.asset.id }, hash: "" });
 }}><RefreshCw size={17}/></Button>;
}
