import { Link } from "@tanstack/react-router";
import { PackageCheck, RefreshCw, Smartphone } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../packages/domain/src";
import { currentProjectWorkflowRound } from "../../../packages/domain/src/project-workflow";
import { Button } from "./components/ui/button";
import { PageTitle, useAppContext } from "./view-shared";
import "./change-impact.css";

type Scenario = "phone" | "brand" | "close";
const scenarios = ["phone", "brand", "close"] as const;
const icons = { phone: Smartphone, brand: RefreshCw, close: PackageCheck };

export function ChangeImpactPage() {
	const { data } = useAppContext();
	const { t } = useTranslation();
	const [scenario, setScenario] = useState<Scenario>("phone");
	const [selectedId, setSelectedId] = useState("");
	const targets = data.assets.filter((asset) => !asset.deleted &&
		(scenario === "phone" ? asset.kind === "account" && asset.category === "phone" : asset.kind === "project"));
	const selected = targets.find((asset) => asset.id === selectedId) ?? targets[0];
	const related = selected ? data.relations.filter((relation) => !relation.deleted &&
		(relation.from === selected.id || relation.to === selected.id))
		.map((relation) => data.assets.find((asset) => asset.id === (relation.from === selected.id ? relation.to : relation.from) && !asset.deleted))
		.filter((asset): asset is Asset => !!asset) : [];
	const projectRound = selected?.kind === "project"
		? currentProjectWorkflowRound(data.tasks, selected.id, scenario === "close" ? "close" : "brand") : [];
	const phoneTasks = selected?.kind === "account"
		? data.tasks.filter((task) => !task.deleted && task.impactSnapshot?.accountId === selected.id) : [];
	const tasks = scenario === "phone" ? phoneTasks : projectRound;
	const pending = scenario === "phone" ? tasks.filter((task) => !task.done).length
		: tasks.filter((task) => !["done", "na"].includes(task.projectWorkflow?.record?.outcome ?? "")).length;
	const stage = !tasks.length ? 0 : pending ? 1 : 2;
	const targetLabel = scenario === "phone" ? t("account") : t("project");

	return <main className="page change-impact-page">
		<PageTitle eyebrow={t("impactHubEyebrow")} title={t("impactHubTitle")} subtitle={t("impactHubSubtitle")} />
		<div className="change-impact-picker" aria-label={t("impactHubScenarios")}>
			{scenarios.map((choice) => {
				const Icon = icons[choice];
				return <button key={choice} type="button" aria-pressed={scenario === choice}
					onClick={() => { setScenario(choice); setSelectedId(""); }}>
					<Icon size={21} aria-hidden="true" /><strong>{t(`impactHub${choice}Title`)}</strong><small>{t(`impactHub${choice}Hint`)}</small>
				</button>;
			})}
		</div>
		<div className="change-impact-steps" aria-label={t("impactHubStages")}>
			{(["workflowPreview", "workflowPlan", "workflowReport"] as const).map((key, index) =>
				<span key={key} className={index === stage ? "current" : ""}>{t(key)}</span>)}
		</div>
		<div className="change-impact-grid">
			<div className="change-impact-main">
				<section className="card change-impact-card">
					<h2>{t(`impactHub${scenario}Title`)}</h2>
					<p>{t(`impactHub${scenario}Description`)}</p>
					{targets.length ? <label className="field" htmlFor="change-impact-target">
						<span>{t("impactHubChooseTarget", { target: targetLabel })}</span>
						<select id="change-impact-target" value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
							{targets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
						</select>
					</label> : <div className="change-impact-empty"><p>{t(scenario === "phone" ? "impactHubNoPhone" : "impactHubNoProject")}</p>
						<Button asChild><Link to="/assets/$kind" params={{ kind: scenario === "phone" ? "account" : "project" }}>{t("impactHubOpenAssets")}</Link></Button>
					</div>}
					{selected && <div className="change-impact-snapshot"><small>{t("workflowCurrentSnapshot")}</small>
						<strong>{selected.name}</strong><p>{selected.description || t("none")}</p>
						{selected.url && <p>{selected.url}</p>}
					</div>}
					<p className="change-impact-warning">{t(scenario === "phone" ? "impactSnapshotHint" : scenario === "brand" ? "workflowBrandManual" : "workflowCloseManual")}</p>
				</section>
				<section className="card change-impact-card">
					<div className="card-header"><div><h2>{t("workflowImpactList")}</h2><p>{t("impactHubCurrentCount", { count: tasks.length, pending })}</p></div></div>
					{tasks.length ? <div className="change-impact-tasks">{tasks.map((task) => <div key={task.id}>
						<strong>{task.name}</strong><small>{t(scenario === "phone" ? task.done ? "done" : "pending" : `workflowOutcome_${task.projectWorkflow?.record?.outcome ?? "pending"}`)}</small>
					</div>)}</div> : <p>{t("impactHubNoPlan")}</p>}
					{selected && <div className="actions">{scenario === "phone" ? <Button asChild variant="primary"><Link to="/assets/$kind/$id" params={{ kind: "account", id: selected.id }}>{t("impactHubOpenChecklist")}</Link></Button>
						: <Button asChild variant="primary"><Link to="/assets/project/$id/workflow/$flow" params={{ id: selected.id, flow: scenario }}>{t(projectRound.length ? "workflowBackToPlan" : "workflowCreatePlan")}</Link></Button>}</div>}
				</section>
			</div>
			<aside className="change-impact-side">
				<section className="card change-impact-card"><h2>{t("workflowRelatedAssets")}</h2>
					{related.length ? related.map((asset) => <Link key={asset.id} to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }}>{asset.name}<small>{t(asset.kind)}</small></Link>) : <p>{t("none")}</p>}
				</section>
				<section className="card change-impact-card"><h2>{t("workflowScope")}</h2><p>{t("impactHubScope")}</p></section>
			</aside>
		</div>
	</main>;
}
