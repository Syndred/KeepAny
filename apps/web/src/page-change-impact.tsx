import { Link } from "@tanstack/react-router";
import { PackageCheck, RefreshCw, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Asset } from "../../../packages/domain/src";
import {
	buildImpactTasks,
	upgradeLegacyImpactTasks,
} from "../../../packages/domain/src/impact";
import { currentProjectWorkflowRound } from "../../../packages/domain/src/project-workflow";
import { save, saveBatch } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { ImpactTaskRow } from "./ImpactTaskRow";
import { ProjectWorkflowPage } from "./page-project-workflow";
import { PageTitle, useAppContext } from "./view-shared";
import "./change-impact.css";
import { Select, SelectOption } from "./components/ui/select";

type Scenario = "phone" | "brand" | "close";
const scenarios = ["phone", "brand", "close"] as const;
const icons = { phone: Smartphone, brand: RefreshCw, close: PackageCheck };

export function ChangeImpactPage() {
	const { data, notify } = useAppContext();
	const { t } = useTranslation();
	const [scenario, setScenario] = useState<Scenario>("phone");
	const [selectedId, setSelectedId] = useState("");
	const [phoneBusy, setPhoneBusy] = useState(false);
	const [phoneError, setPhoneError] = useState("");
	const phoneInFlight = useRef(false);
	const generatedKeys = useRef(new Set<string>());
	useEffect(() => {
		for (const task of data.tasks) {
			if (task.dedupeKey) generatedKeys.current.delete(task.dedupeKey);
		}
	}, [data.tasks]);
	const targets = data.assets.filter(
		(asset) =>
			!asset.deleted &&
			(scenario === "phone"
				? asset.kind === "account" && asset.category === "phone"
				: asset.kind === "project"),
	);
	const selected =
		targets.find((asset) => asset.id === selectedId) ?? targets[0];
	const related = selected
		? data.relations
				.filter(
					(relation) =>
						!relation.deleted &&
						(relation.from === selected.id || relation.to === selected.id),
				)
				.map((relation) =>
					data.assets.find(
						(asset) =>
							asset.id ===
								(relation.from === selected.id ? relation.to : relation.from) &&
							!asset.deleted,
					),
				)
				.filter((asset): asset is Asset => !!asset)
		: [];
	const projectRound =
		selected?.kind === "project"
			? currentProjectWorkflowRound(
					data.tasks,
					selected.id,
					scenario === "close" ? "close" : "brand",
				)
			: [];
	const phoneTasks =
		selected?.kind === "account"
			? data.tasks.filter(
					(task) =>
						!task.deleted && task.impactSnapshot?.accountId === selected.id,
				)
			: [];
	const phoneToGenerate =
		selected?.kind === "account"
			? buildImpactTasks(
					selected,
					data.relations,
					data.assets.filter((asset) => !asset.deleted),
					data.tasks,
					new Date().toISOString(),
					(linked) => `${t("checkConnection")}: ${linked.name}`,
				).filter((task) => !generatedKeys.current.has(task.dedupeKey))
			: [];
	const phoneToUpgrade =
		selected?.kind === "account"
			? upgradeLegacyImpactTasks(
					selected,
					data.relations,
					data.assets.filter((asset) => !asset.deleted),
					data.tasks,
					new Date().toISOString(),
				).filter((task) => !generatedKeys.current.has(task.dedupeKey))
			: [];
	const tasks = scenario === "phone" ? phoneTasks : projectRound;
	const pending =
		scenario === "phone"
			? tasks.filter((task) => !task.done).length
			: tasks.filter(
					(task) =>
						!["done", "na"].includes(
							task.projectWorkflow?.record?.outcome ?? "",
						),
				).length;
	const stage = !tasks.length ? 0 : pending ? 1 : 2;
	const targetLabel = t(
		scenario === "phone" ? "impactHubTargetAccount" : "impactHubTargetProject",
	);
	async function createPhonePlan() {
		if (
			selected?.kind !== "account" ||
			phoneInFlight.current ||
			(!phoneToGenerate.length && !phoneToUpgrade.length)
		)
			return;
		phoneInFlight.current = true;
		setPhoneBusy(true);
		setPhoneError("");
		try {
			for (const task of phoneToUpgrade) {
				await save("task", task);
				generatedKeys.current.add(task.dedupeKey);
			}
			if (phoneToGenerate.length) {
				await saveBatch(
					phoneToGenerate.map((value) => ({ type: "task" as const, value })),
				);
				for (const task of phoneToGenerate)
					generatedKeys.current.add(task.dedupeKey);
			}
			notify(t("saved"));
		} catch {
			setPhoneError(t("error"));
		} finally {
			phoneInFlight.current = false;
			setPhoneBusy(false);
		}
	}

	return (
		<main className="page change-impact-page">
			<PageTitle
				eyebrow={t("impactHubEyebrow")}
				title={t("impactHubTitle")}
				subtitle={t("impactHubSubtitle")}
			/>
			<section
				className="change-impact-picker"
				aria-label={t("impactHubScenarios")}
			>
				{scenarios.map((choice) => {
					const Icon = icons[choice];
					return (
						<button
							key={choice}
							type="button"
							aria-pressed={scenario === choice}
							onClick={() => {
								setScenario(choice);
								setSelectedId("");
							}}
						>
							<Icon size={21} aria-hidden="true" />
							<strong>{t(`impactHub${choice}Title`)}</strong>
							<small>{t(`impactHub${choice}Hint`)}</small>
						</button>
					);
				})}
			</section>
			{scenario !== "phone" && targets.length > 0 && (
				<section className="card change-impact-target-card">
					<label className="field" htmlFor="change-impact-target">
						<span>{t("impactHubChooseTarget", { target: targetLabel })}</span>
						<Select
							id="change-impact-target"
							value={selected?.id ?? ""}
							onValueChange={(selectValue) => setSelectedId(selectValue)}
						>
							{targets.map((asset) => (
								<SelectOption key={asset.id} value={asset.id}>
									{asset.name}
								</SelectOption>
							))}
						</Select>
					</label>
				</section>
			)}
			{scenario === "phone" && (
				<section
					className="change-impact-steps"
					aria-label={t("impactHubStages")}
				>
					{(["workflowPreview", "workflowPlan", "workflowReport"] as const).map(
						(key, index) => (
							<span key={key} className={index === stage ? "current" : ""}>
								{t(key)}
							</span>
						),
					)}
				</section>
			)}
			{scenario !== "phone" && selected?.kind === "project" ? (
				<ProjectWorkflowPage
					key={`${scenario}:${selected.id}`}
					projectId={selected.id}
					flow={scenario}
					embedded
				/>
			) : (
				<div className="change-impact-grid">
					<div className="change-impact-main">
						<section className="card change-impact-card">
							<h2>{t(`impactHub${scenario}Title`)}</h2>
							<p>{t(`impactHub${scenario}Description`)}</p>
							{targets.length ? (
								<label className="field" htmlFor="change-impact-target">
									<span>
										{t("impactHubChooseTarget", { target: targetLabel })}
									</span>
									<Select
										id="change-impact-target"
										value={selected?.id ?? ""}
										onValueChange={(selectValue) => setSelectedId(selectValue)}
									>
										{targets.map((asset) => (
											<SelectOption key={asset.id} value={asset.id}>
												{asset.name}
											</SelectOption>
										))}
									</Select>
								</label>
							) : (
								<div className="change-impact-empty">
									<p>
										{t(
											scenario === "phone"
												? "impactHubNoPhone"
												: "impactHubNoProject",
										)}
									</p>
									<Button asChild>
										<Link
											to="/assets/$kind"
											params={{
												kind: scenario === "phone" ? "account" : "project",
											}}
										>
											{t("impactHubOpenAssets")}
										</Link>
									</Button>
								</div>
							)}
							{selected && (
								<div className="change-impact-snapshot">
									<small>{t("workflowCurrentSnapshot")}</small>
									<strong>{selected.name}</strong>
									<p>{selected.description || t("none")}</p>
									{selected.url && <p>{selected.url}</p>}
								</div>
							)}
							<p className="change-impact-warning">
								{t(
									scenario === "phone"
										? "impactSnapshotHint"
										: scenario === "brand"
											? "workflowBrandManual"
											: "workflowCloseManual",
								)}
							</p>
						</section>
						<section className="card change-impact-card">
							<div className="card-header">
								<div>
									<h2>{t("workflowImpactList")}</h2>
									<p>
										{t("impactHubCurrentCount", {
											count: tasks.length,
											pending,
										})}
									</p>
								</div>
							</div>
							{scenario === "phone" && tasks.length ? (
								<div className="change-impact-task-records">
									{tasks.map((task) => (
										<ImpactTaskRow task={task} key={task.id} />
									))}
								</div>
							) : tasks.length ? (
								<div className="change-impact-tasks">
									{tasks.map((task) => (
										<div key={task.id}>
											<strong>{task.name}</strong>
											<small>
												{t(
													`workflowOutcome_${task.projectWorkflow?.record?.outcome ?? "pending"}`,
												)}
											</small>
										</div>
									))}
								</div>
							) : (
								<p>{t("impactHubNoPlan")}</p>
							)}
							{selected && scenario === "phone" && (
								<div className="actions">
									<Button
										variant="primary"
										onClick={() => void createPhonePlan()}
										disabled={
											phoneBusy ||
											(!phoneToGenerate.length && !phoneToUpgrade.length)
										}
									>
										{t("makeChecklist")} ·{" "}
										{phoneToGenerate.length + phoneToUpgrade.length}
									</Button>
									<Button asChild>
										<Link
											to="/assets/$kind/$id"
											params={{ kind: "account", id: selected.id }}
										>
											{t("impactHubOpenChecklist")}
										</Link>
									</Button>
								</div>
							)}
							{phoneError && (
								<p className="field-error" role="alert">
									{phoneError}
								</p>
							)}
						</section>
					</div>
					<aside className="change-impact-side">
						<section className="card change-impact-card">
							<h2>{t("workflowRelatedAssets")}</h2>
							{related.length ? (
								related.map((asset) => (
									<Link
										key={asset.id}
										to="/assets/$kind/$id"
										params={{ kind: asset.kind, id: asset.id }}
									>
										{asset.name}
										<small>{t(asset.kind)}</small>
									</Link>
								))
							) : (
								<p>{t("none")}</p>
							)}
						</section>
						<section className="card change-impact-card">
							<h2>{t("workflowScope")}</h2>
							<p>{t("impactHubScope")}</p>
						</section>
					</aside>
				</div>
			)}
		</main>
	);
}
