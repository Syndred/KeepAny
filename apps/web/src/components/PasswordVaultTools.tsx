import { lazy } from "react";
import { useTranslation } from "react-i18next";
import { DeferredVaultTool } from "./DeferredVaultTool";

const VaultAccountLinksDialog = lazy(() => import("./VaultAccountLinksDialog").then(module => ({ default: module.VaultAccountLinksDialog })));
const PasswordSmartImportDialog = lazy(() => import("./PasswordSmartImportDialog").then(module => ({ default: module.PasswordSmartImportDialog })));

/** Own only deferred tool presentation. The panel keeps session and close state. */
export function PasswordVaultTools({ linksOpen, smartOpen, unlocked, lockedElsewhere, closeLinks, closeSmart, openLinks, returnFocusTo, notify }: {
  linksOpen: boolean;
  smartOpen: boolean;
  unlocked: boolean;
  lockedElsewhere: boolean;
  closeLinks: () => void;
  closeSmart: () => void;
  openLinks: () => void;
  returnFocusTo: (tool: "links" | "smart") => HTMLElement | null;
  notify?: (message: string) => void;
}) {
  const { t } = useTranslation();
  return <>
    {linksOpen && unlocked && <DeferredVaultTool title={t("pwConnectTitle")} onClose={closeLinks} returnFocusTo={() => returnFocusTo("links")}>
      <VaultAccountLinksDialog onClose={closeLinks} onSaved={() => notify?.(t("pwConnectSaved"))} returnFocusTo={() => returnFocusTo("links")} />
    </DeferredVaultTool>}
    {smartOpen && (unlocked || lockedElsewhere) && <DeferredVaultTool title={t("pwSmartTitle")} onClose={closeSmart} returnFocusTo={() => returnFocusTo("smart")}>
      <PasswordSmartImportDialog onClose={closeSmart} onLinkAccounts={openLinks} returnFocusTo={() => returnFocusTo("smart")} />
    </DeferredVaultTool>}
  </>;
}
