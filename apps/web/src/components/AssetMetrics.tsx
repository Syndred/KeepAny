import { useTranslation } from "react-i18next";
import type { Asset } from "../../../../packages/domain/src";
import type { AssetSummary, MoneyTotals } from "../workspace-summary";
import { date, money } from "../view-shared";

export function MoneyTotal({ totals, empty = "—" }: { totals: MoneyTotals; empty?: string }) {
	const { i18n } = useTranslation();
	return <>{totals.size ? [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => <span key={currency}>{money(value, currency, i18n.language)}</span>) : <span>{empty}</span>}</>;
}

export function RemainingDays({ days }: { days: number | null }) {
	const { t } = useTranslation();
	return <span className={days !== null && days <= 30 ? "workspace-due" : undefined}>{days === null ? t("workspaceDateMissing") : days === 0 ? t("workspaceDueToday") : days < 0 ? t("workspaceOverdueDays", { count: -days }) : t("workspaceRemainingDays", { count: days })}</span>;
}

export function AssetMetrics({ asset, summary }: { asset: Asset; summary?: AssetSummary }) {
	const { t, i18n } = useTranslation();
	if (!summary) return null;
	return <div className="workspace-asset-metrics">
		{asset.kind === "project" && <>
			<strong>{summary.tasks.total ? t("workspaceProgress", summary.tasks) : t("workspaceNoProgress")}</strong>
			{summary.tasks.total > 0 && <progress aria-label={t("tasks")} value={summary.tasks.done} max={summary.tasks.total} />}
			{summary.annual.size > 0 && <div className="workspace-cost-line"><span>{t("workspaceProjectPlan")}</span><MoneyTotal totals={summary.annual} /></div>}
			{(asset.projectDomains ?? []).some((domain) => domain.annualAmount === null) && <small>{t("projectCostPartial")}</small>}
		</>}
		{asset.kind === "item" && <>
			<strong>{summary.ownedDays === null ? asset.purchaseDate ? t("workspacePurchaseDateLabel", { date: date(asset.purchaseDate, i18n.language) }) : t("workspacePurchaseDateMissing") : t("workspaceOwnedDays", { count: summary.ownedDays })}</strong>
			<div className="workspace-cost-line"><span>{t("itemPurchasePrice")}</span><span>{asset.itemPurchasePriceKnown ? money(asset.amount, asset.currency, i18n.language) : t("workspaceAmountMissing")}</span></div>
		</>}
		{asset.kind === "subscription" && <strong><RemainingDays days={summary.remainingDays} /></strong>}
		{summary.spending.size > 0 && <div className="workspace-cost-line"><span>{t("workspaceRecordedSpending")}</span><MoneyTotal totals={summary.spending} /></div>}
	</div>;
}
