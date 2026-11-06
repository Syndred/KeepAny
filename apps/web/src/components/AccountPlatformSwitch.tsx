import { useNavigate } from "@tanstack/react-router";
import { RefreshCw, Star } from "lucide-react";
import { savePreferenceIfCurrent } from "../../../../packages/local-db/src";
import { ACCOUNT_DEFAULTS_ID, chooseAccountDefault } from "../account-defaults";
import { useAppContext } from "../view-shared";
import { useLayoutEffect, useRef, useState } from "react";
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
 return <Button data-account-detail-switch aria-label={label} title={label} disabled={snapshot.status !== "unlocked" || members.length < 2} onClick={event => {
  const next = members[(index + 1) % members.length];
  if (!next) return;
  if (event.detail === 0) sessionStorage.setItem("keepany-detail-switch-focus", next.asset.id);
  void navigate(next.virtual
   ? { to: "/accounts", hash: `login-detail-${next.entries[0].id}` }
   : { to: "/assets/$kind/$id", params: { kind: "account", id: next.asset.id }, hash: "" });
 }}><RefreshCw size={17}/>{t("accountSwitchAction")}</Button>;
}


export function AccountDefaultButton({ assetId }: { assetId: string }) {
 const { t } = useTranslation();
 const { notify } = useAppContext();
 const { snapshot, session } = usePasswordVault();
 const { cardGroups, defaults, defaultFor, defaultPreference } = useAccountCardGroups();
 const [busy, setBusy] = useState(false);
 const running = useRef(false);
 const selected = defaultFor(assetId) === assetId;
 async function choose() {
  if (running.current || selected || session?.getSnapshot().status !== "unlocked") return;
  running.current = true; setBusy(true);
  try {
   const value = chooseAccountDefault(cardGroups.groups.get(assetId) ?? [], defaults, assetId);
   await savePreferenceIfCurrent(defaultPreference ?? null, { id: ACCOUNT_DEFAULTS_ID, value });
   notify(t("saved"));
  } catch { notify(t("error")); }
  finally { running.current = false; setBusy(false); }
 }
 return <Button data-account-default aria-pressed={selected} aria-label={t("accountDefaultAction")} title={t(selected ? "accountIsDefault" : "accountSetDefault")} className={selected ? "account-default-selected" : undefined} disabled={busy || selected || snapshot.status !== "unlocked"} onClick={() => void choose()}><Star size={17}/>{t("accountDefaultAction")}</Button>;
}
