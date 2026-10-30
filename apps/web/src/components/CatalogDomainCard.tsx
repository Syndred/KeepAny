import { Link } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Asset, ProjectDomain } from "../../../../packages/domain/src";
import { date, money } from "../view-shared";
import { RemainingDays } from "./AssetMetrics";
export function CatalogDomainCard({ project, domain, remainingDays, onOpen }: { project: Asset; domain: ProjectDomain; remainingDays: number | null; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  return <Link className="card workspace-domain-card" to="/assets/$kind/$id" params={{ kind: "project", id: project.id }} hash={`project-domain-${domain.id}`} onClick={onOpen}>
    <div className="workspace-domain-heading"><Globe size={22}/><strong>{domain.name}</strong></div><span className="subtitle">{t("workspaceDomains")} · {project.name}</span>
    <strong><RemainingDays days={remainingDays}/></strong><span>{t("projectExpiry")}: {date(domain.expiryDate, i18n.language)}</span>
    <div className="workspace-cost-line"><span>{t("projectAnnualFee")}</span><strong>{domain.annualAmount === null ? t("workspaceAmountMissing") : money(domain.annualAmount, domain.currency, i18n.language)}</strong></div>
    {domain.registrar ? <span className="subtitle">{domain.registrar}</span> : null}<span className="workspace-domain-action">{t("workspaceManageDomain")} ↗</span>
  </Link>;
}
