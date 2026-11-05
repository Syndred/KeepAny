import { Link } from "@tanstack/react-router";
import { ChevronRight, UserRound } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import { rankRelatedAccounts } from "../related-accounts";
import { useAppContext } from "../view-shared";
import { usePasswordVault, type PasswordVaultEntrySummary } from "./PasswordVaultProvider";

export function RelatedAccounts({ asset, entry }: { asset: Asset; entry?: PasswordVaultEntrySummary }) {
    const { data } = useAppContext(), { snapshot } = usePasswordVault(), { t } = useTranslation();
    const rows = useMemo(() => snapshot.status === "unlocked" ? rankRelatedAccounts({ asset, entry, assets: data.assets, entries: snapshot.entries }, 3) : [], [asset, entry, data.assets, snapshot.status, snapshot.entries]);
    if (snapshot.status !== "unlocked" || !rows.length) return null;
    return <section className="card account-related-card" aria-labelledby="account-related-title"><header><h2 id="account-related-title">{t("accountRelatedTitle")}</h2></header><div className="account-related-grid">
        {rows.map(row => <Link key={row.key} className="account-related-link" data-related-key={row.key} {...(row.assetId ? { to: "/assets/$kind/$id" as const, params: { kind: "account", id: row.assetId }, hash: row.entryId ? `password-${row.entryId}` : "" } : { to: "/accounts" as const, hash: `login-detail-${row.entryId}` })}><span className="account-related-avatar"><UserRound size={18}/></span><span className="account-related-info"><strong title={row.name}>{row.name}</strong><small title={row.username}>{row.username || t("pwVaultValueEmpty")}</small><span className="account-related-reasons">{row.reasons.map(reason => <span key={reason}>{t(`accountRelated_${reason}`)}</span>)}</span></span><ChevronRight size={16} aria-hidden="true"/></Link>)}
    </div></section>;
}
