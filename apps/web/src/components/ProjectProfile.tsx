import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import { niceCategory } from "../view-shared";
import { TextLink } from "./ui/text-link";
import { Button } from "./ui/button";

export function ProjectProfile({ asset, accounts, onVisit, onEdit }: { asset: Asset; accounts: Asset[]; onVisit: (asset: Asset) => void; onEdit: () => void }) {
  const { t, i18n } = useTranslation();
  const rows = [
    ["projectOfficialUrl", asset.url ? <TextLink href={asset.url} target="_blank" rel="noopener noreferrer">{asset.url}</TextLink> : null],
    ["projectType", asset.category ? niceCategory(asset.category, t) : null],
    ["projectLaunchMonth", asset.projectLaunchMonth ? new Intl.DateTimeFormat(i18n.language, { year: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${asset.projectLaunchMonth}-01T12:00:00Z`)) : null],
    ["contact", asset.contact || null], ["tagsLabel", asset.tags.length ? asset.tags.join(", ") : null], ["notes", asset.notes || null],
    ["projectAccount", accounts.length ? accounts.map((account, index) => <span key={account.id}>{index ? " · " : ""}<TextLink asChild><Link to="/assets/$kind/$id" params={{ kind: "account", id: account.id }} onClick={event => { event.preventDefault(); onVisit(account); }}>{account.name}</Link></TextLink></span>) : null],
  ] as const;
  const visible = rows.filter(([, value]) => value !== null);
  return <section className="card asset-profile-card asset-project-profile-card">
    <div className="card-header"><h2>{t("profile")}</h2><Button size="small" onClick={onEdit}>{t("supplementProfile")}</Button></div>
    {visible.length ? <dl className="asset-project-facts">{visible.map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}</dl> : <p className="asset-quiet-empty">{t("overviewNoProjectDetails")}</p>}
  </section>;
}
