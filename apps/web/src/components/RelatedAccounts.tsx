import { ScrollArea } from "@base-ui/react/scroll-area";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, UserRound } from "lucide-react";
import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import { otherAccountRows } from "../related-accounts";
import { useAccountCardGroups } from "../use-account-card-groups";
import { useAppContext } from "../view-shared";
import { usePasswordVault, type PasswordVaultEntrySummary } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import "../account-other-accounts.css";

export function RelatedAccounts({ asset, entry }: { asset: Asset; entry?: PasswordVaultEntrySummary }) {
 const { data } = useAppContext(), { snapshot } = usePasswordVault(), { t } = useTranslation();
 const { cardGroups } = useAccountCardGroups();
 const viewport = useRef<HTMLDivElement>(null);
 const rows = useMemo(() => snapshot.status === "unlocked" ? otherAccountRows({ asset, entry, assets: data.assets, entries: snapshot.entries }, cardGroups.groups.get(asset.id) ?? []) : [], [asset, entry, data.assets, snapshot.status, snapshot.entries, cardGroups]);
 if (snapshot.status !== "unlocked" || !rows.length) return null;
 function move(direction: number) {
  const element = viewport.current;
  if (element) element.scrollBy({ left: direction * Math.max(240, element.clientWidth * .8), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
 }
 return <section className="card account-related-card account-other-card" aria-labelledby="account-related-title"><ScrollArea.Root className="account-other-scroll">
  <header className="account-other-header"><h2 id="account-related-title">{t("accountRelatedTitle")}</h2><div className="actions account-other-controls">
   <Button className="account-other-previous" variant="ghost" size="icon" aria-label={t("accountOtherPrevious")} title={t("accountOtherPrevious")} onClick={() => move(-1)}><ChevronLeft size={18}/></Button>
   <Button className="account-other-next" variant="ghost" size="icon" aria-label={t("accountOtherNext")} title={t("accountOtherNext")} onClick={() => move(1)}><ChevronRight size={18}/></Button>
  </div></header>
  <ScrollArea.Viewport ref={viewport} className="account-other-viewport" aria-labelledby="account-related-title">
   <ScrollArea.Content className="account-other-track">
    {rows.map(row => <Link key={row.key} className="account-related-link" onFocus={event => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })} data-related-key={row.key} data-same-platform={row.reasons.includes("platform") || undefined} {...(row.assetId ? { to: "/assets/$kind/$id" as const, params: { kind: "account", id: row.assetId }, hash: row.entryId ? `password-${row.entryId}` : "" } : { to: "/accounts" as const, hash: `login-detail-${row.entryId}` })}><span className="account-related-avatar"><UserRound size={18}/></span><span className="account-related-info"><strong title={row.name}>{row.name}</strong><small title={row.username}>{row.username || t("pwVaultValueEmpty")}</small><span className="account-related-reasons">{row.reasons.map(reason => <span key={reason}>{t(`accountRelated_${reason}`)}</span>)}</span></span><ChevronRight size={16} aria-hidden="true"/></Link>)}
   </ScrollArea.Content>
  </ScrollArea.Viewport>
 </ScrollArea.Root></section>;
}
