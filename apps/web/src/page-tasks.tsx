import { lazy, Suspense, useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "./components/ui/button";
import { Empty, PageTitle, date, money, useAppContext } from "./view-shared";
import { TaskRow } from "./TaskRow";
import { maintenanceReminderDate } from "../../../packages/domain/src/task-repeat";
import "./tasks-page.css";
import { useSearchRowLocation } from "./search-location";
import { Select, SelectOption } from "./components/ui/select";
import { Badge } from "./components/ui/badge";
import { taskWithinDateRange, validTaskDate, validTaskDateRange, type TaskDateRange } from "./task-edit";

const TaskEditor = lazy(() =>
	import("./workflows").then((module) => ({ default: module.TaskEditor })),
);

type TaskFilter = "all" | "pending" | "done";
const taskFilterKey = "keepany-task-filter";
const taskDateRangeKey = "keepany-task-date-range";
function readTaskDateRange(): TaskDateRange {
	try {
		const value = JSON.parse(sessionStorage.getItem(taskDateRangeKey) ?? "null");
		if (value && typeof value.from === "string" && typeof value.to === "string" && validTaskDate(value.from) && validTaskDate(value.to)) return { from: value.from, to: value.to };
	} catch { /* Invalid or unavailable preferences use an unfiltered list. */ }
	return { from: "", to: "" };
}
function readTaskFilter(): TaskFilter {
	try {
		const value = sessionStorage.getItem(taskFilterKey);
		return value === "pending" || value === "done" ? value : "all";
	} catch { return "all"; }
}

export function TaskPage() {
	const { data } = useAppContext();
	const { t, i18n } = useTranslation();
	const [edit, setEdit] = useState<"simple" | "maintenance" | null>(null);
	const [filter, setFilter] = useState<TaskFilter>(readTaskFilter);
	const [dateRange, setDateRange] = useState<TaskDateRange>(readTaskDateRange);
	useEffect(() => {
		try { sessionStorage.setItem(taskDateRangeKey, JSON.stringify(dateRange)); } catch { /* Preferences are optional. */ }
	}, [dateRange]);
	useEffect(() => {
		try { sessionStorage.setItem(taskFilterKey, filter); }
		catch { /* The task list remains usable when session storage is unavailable. */ }
	}, [filter]);
	const [selectedPlanId, setSelectedPlanId] = useState("");
	const taskHash = useRouterState({ select: (state) => state.location.hash });
	const tasks = data.tasks
		.filter((task) => !task.deleted)
		.sort((a, b) => {
			const aDue = a.maintenancePlan?.active
				? maintenanceReminderDate(a.maintenancePlan.schedule, a.maintenancePlan.deferredUntil)
				: a.dueDate;
			const bDue = b.maintenancePlan?.active
				? maintenanceReminderDate(b.maintenancePlan.schedule, b.maintenancePlan.deferredUntil)
				: b.dueDate;
			return Number(a.done) - Number(b.done) || aDue.localeCompare(bDue);
		});
	const counts = {
		all: tasks.length,
		pending: tasks.filter((task) => !task.done).length,
		done: tasks.filter((task) => task.done).length,
	};
	const visibleTasks = tasks.filter(
		(task) => (filter === "all" || (filter === "done" ? task.done : !task.done)) && taskWithinDateRange(task, dateRange),
	);
	const plans = tasks.filter((task) => task.maintenancePlan);
	useSearchRowLocation("task-", tasks.map((task) => task.id), visibleTasks.map((task) => task.id), () => {
		setFilter("all");
		setDateRange({ from: "", to: "" });
		try {
			const target = decodeURIComponent(taskHash.replace(/^#/, ""));
			if (target.startsWith("task-") && plans.some((task) => task.id === target.slice(5))) setSelectedPlanId(target.slice(5));
		} catch { /* Invalid hashes do not change the selected plan. */ }
	});
	const selectedPlan = plans.find((task) => task.id === selectedPlanId) ?? plans[0];
	const plan = selectedPlan?.maintenancePlan;
	const asset = data.assets.find((item) => item.id === selectedPlan?.assetId && !item.deleted);
	const lastRecord = plan?.records.at(-1);
	const rule = plan?.schedule.rule;
	const cadence = rule && (rule.mode === "once"
		? t("maintenanceOnce")
		: `${t(rule.mode === "fixed" ? "maintenanceFixed" : "maintenanceAfterCompletion")} · ${t("maintenanceEveryCount", { count: rule.every })} ${t(rule.unit)}`);

	return (
		<main className="page tasks-page">
			<PageTitle
				eyebrow={t("tasks")}
				title={t("tasksHeroTitle")}
				subtitle={t("tasksHeroSubtitle")}
			/>
			<div className="tasks-toolbar">
				<fieldset className="tabs task-filters" aria-label={t("taskFilter")}>
					{(["pending", "done", "all"] as const).map((value) => (
						<Button
							type="button"
							key={value}
							aria-pressed={filter === value}
							onClick={() => setFilter(value)}
						>
							{t(value)} · {counts[value]}
						</Button>
					))}
				</fieldset>
				<div className="tasks-toolbar-actions">
					<Button onClick={() => setEdit("simple")}>{t("newTask")}</Button>
					<Button variant="primary" onClick={() => setEdit("maintenance")}>
						<Plus size={17} />{t("newMaintenancePlan")}
					</Button>
				</div>
			</div>
			<fieldset className="task-date-range" aria-label={t("taskDateRange")}>
				<label htmlFor="task-date-from">{t("taskDateFrom")}<input className="field" id="task-date-from" type="date" value={dateRange.from} onChange={event => setDateRange({ ...dateRange, from: event.target.value })} /></label>
				<label htmlFor="task-date-to">{t("taskDateTo")}<input className="field" id="task-date-to" type="date" value={dateRange.to} onChange={event => setDateRange({ ...dateRange, to: event.target.value })} /></label>
				<Button disabled={!dateRange.from && !dateRange.to} onClick={() => setDateRange({ from: "", to: "" })}>{t("taskClearDates")}</Button>
			</fieldset>
			{!validTaskDateRange(dateRange) && <p className="field-error" role="alert">{t("taskDateRangeInvalid")}</p>}
			<div className="tasks-columns">
				<section className="card tasks-list-card" aria-labelledby="tasks-list-heading">
					<div className="tasks-cardhead">
						<h2 id="tasks-list-heading">{t("tasksRecent")}</h2>
						<Badge tone="pending">{visibleTasks.length}</Badge>
					</div>
					{visibleTasks.length ? (
						<div className="list">
							{visibleTasks.map((task) => <TaskRow task={task} key={task.id} />)}
						</div>
					) : <Empty />}
				</section>
				<section className="card tasks-plan-card" aria-labelledby="tasks-plan-heading">
					<div className="tasks-cardhead">
						<h2 id="tasks-plan-heading">{t("tasksPlanDetails")}</h2>
					</div>
					{plan && selectedPlan ? (
						<>
							{plans.length > 1 && (
								<label htmlFor="tasks-plan-select" className="tasks-plan-select">
									<span>{t("tasksPlanDetails")}</span>
									<Select id="tasks-plan-select" value={selectedPlan.id} onValueChange={(selectValue) => setSelectedPlanId(selectValue)}>
										{plans.map((task) => <SelectOption key={task.id} value={task.id}>{task.name}</SelectOption>)}
									</Select>
								</label>
							)}
							<strong className="tasks-plan-name">{selectedPlan.name}</strong>
							<dl className="tasks-plan-facts">
								<div><dt>{t("maintenanceAsset")}</dt><dd>{asset?.name ?? t("maintenanceAssetMissing")}</dd></div>
								<div><dt>{t("maintenanceAmount")}</dt><dd>{plan.schedule.plannedAmountMinor === null ? "—" : money(plan.schedule.plannedAmountMinor, plan.schedule.currency, i18n.language)}</dd></div>
								<div><dt>{t("maintenanceRule")}</dt><dd>{cadence}</dd></div>
								<div><dt>{t("maintenanceDue")}</dt><dd>{date(plan.deferredUntil || plan.schedule.dueDate, i18n.language)}</dd></div>
								<div><dt>{t("maintenanceReminder")}</dt><dd>{date(maintenanceReminderDate(plan.schedule, plan.deferredUntil), i18n.language)}</dd></div>
								{lastRecord && <div><dt>{t("maintenanceActionDate")}</dt><dd>{date(lastRecord.actionDate, i18n.language)} · {t(lastRecord.action === "complete" ? "maintenanceCompleted" : lastRecord.action === "skip" ? "maintenanceSkipped" : "maintenanceDeferred")}</dd></div>}
							</dl>
							{lastRecord && <p className="tasks-plan-note"><strong>{t("maintenanceEvidence")}</strong><br />{lastRecord.evidence}</p>}
							<button
							className="tasks-plan-jump"
							type="button"
							onClick={() => {
								setFilter("all");
									setDateRange({ from: "", to: "" });
								requestAnimationFrame(() => document.getElementById(`task-${selectedPlan.id}`)?.scrollIntoView({ block: "center" }));
							}}
						>{t("viewTasks")} →</button>
						</>
					) : <Empty hint={false} />}
				</section>
			</div>
			{edit && (
				<Suspense fallback={<div className="toast" role="status">{t("loading")}</div>}>
					<TaskEditor mode={edit} onClose={() => setEdit(null)} />
				</Suspense>
			)}
		</main>
	);
}
