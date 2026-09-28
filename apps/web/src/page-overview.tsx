import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bell, Plus, WalletCards } from "lucide-react";
import { actualCharge, monthlyMinorUnits } from "../../../packages/domain/src";
import {
	AssetRow,
	Empty,
	PageTitle,
	date,
	liveAssets,
	money,
	useAppContext,
} from "./view-shared";
export function Overview() {
	const { data } = useAppContext();
	const { t, i18n } = useTranslation();
	const assets = liveAssets(data);
	const open = data.tasks.filter((x) => !x.done && !x.deleted);
	const upcoming = assets
		.filter((a) => a.kind === "subscription" && a.status === "active" && a.dueDate)
		.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
		.slice(0, 4);
	const totals = new Map<string, bigint>();
	for (const a of assets.filter(
		(x) => x.kind === "subscription" && x.status === "active",
	))
		totals.set(a.currency, (totals.get(a.currency) || 0n) + monthlyMinorUnits(a));
	return (
		<main className="page">
			<PageTitle
				eyebrow="KeepAny"
				title={t("overview")}
				subtitle={t("summary")}
				action={
					<Link className="button primary" to="/intake">
						<Plus size={17} />
						{t("add")}
					</Link>
				}
			/>
			<div className="stat-grid">
				<div className="card stat">
					<span>{t("assetCount")}</span>
					<strong>{assets.length}</strong>
				</div>
				<div className="card stat">
					<span>{t("openTasks")}</span>
					<strong>{open.length}</strong>
				</div>
				<div className="card stat">
					<span>{t("monthly")}</span>
					<strong>
						{totals.size
							? [...totals]
									.map(([c, n]) => money(n, c, i18n.language))
									.join(" · ")
							: "—"}
					</strong>
					<small>{t("balance")}</small>
				</div>
			</div>
			<div className="card-grid">
				<section className="card">
					<div className="card-header">
						<h2>{t("tasks")}</h2>
						<Link to="/tasks">{t("all")} →</Link>
					</div>
					{open.length ? (
						<div className="list">
							{open.slice(0, 5).map((task) => (
								<div className="list-row" key={task.id}>
									<Bell size={18} />
									<div>
										<strong>{task.name}</strong>
										<small>{date(task.dueDate, i18n.language)}</small>
									</div>
								</div>
							))}
						</div>
					) : (
						<Empty />
					)}
				</section>
				<section className="card">
					<div className="card-header">
						<h2>{t("due")}</h2>
						<Link to="/assets/$kind" params={{ kind: "subscription" }}>
							{t("all")} →
						</Link>
					</div>
					{upcoming.length ? (
						<div className="list">
							{upcoming.map((a) => (
								<Link
									className="list-row overview-subscription-row"
									key={a.id}
									to="/assets/$kind/$id"
									params={{ kind: a.kind, id: a.id }}
								>
									<WalletCards size={18} />
									<div>
										<strong>{a.name}</strong>
										<small>{date(a.dueDate, i18n.language)}</small>
									</div>
									<b>{money(actualCharge(a, a.dueDate) ?? 0, a.currency, i18n.language)}</b>
								</Link>
							))}
						</div>
					) : (
						<Empty />
					)}
				</section>
			</div>
			<section className="card">
				<div className="card-header">
					<h2>{t("recent")}</h2>
				</div>
				{assets.length ? (
					<div className="list">
						{[...assets]
							.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
							.slice(0, 6)
							.map((a) => (
								<AssetRow key={a.id} asset={a} />
							))}
					</div>
				) : (
					<Empty />
				)}
			</section>
		</main>
	);
}
