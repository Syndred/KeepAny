import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "./components/ui/button";
import { Empty, PageTitle, useAppContext } from "./view-shared";
import { TaskRow } from "./TaskRow";
import { maintenanceReminderDate } from "../../../packages/domain/src/task-repeat";
const TaskEditor = lazy(() =>
	import("./workflows").then((module) => ({ default: module.TaskEditor })),
);
export function TaskPage() {
	const { data } = useAppContext();
	const { t } = useTranslation();
	const [edit, setEdit] = useState<"simple" | "maintenance" | null>(null);
	const [filter, setFilter] = useState<"all" | "pending" | "done">("all");
	const tasks = data.tasks
		.filter((x) => !x.deleted)
		.sort(
			(a, b) =>
				Number(a.done) - Number(b.done) ||
				(a.maintenancePlan?.active ? maintenanceReminderDate(a.maintenancePlan.schedule, a.maintenancePlan.deferredUntil) : a.dueDate).localeCompare(b.maintenancePlan?.active ? maintenanceReminderDate(b.maintenancePlan.schedule, b.maintenancePlan.deferredUntil) : b.dueDate),
		);
	const counts = {
		all: tasks.length,
		pending: tasks.filter((task) => !task.done).length,
		done: tasks.filter((task) => task.done).length,
	};
	const visibleTasks = tasks.filter(
		(task) => filter === "all" || (filter === "done" ? task.done : !task.done),
	);
	return (
		<main className="page">
			<PageTitle
				title={t("tasks")}
				action={<>
					<Button onClick={() => setEdit("simple")}>{t("newTask")}</Button>
					<Button variant="primary" onClick={() => setEdit("maintenance")}><Plus size={17} />{t("newMaintenancePlan")}</Button>
				</>}
			/>
			<section className="card">
				<fieldset className="tabs task-filters" aria-label={t("taskFilter")}>
					{(["all", "pending", "done"] as const).map((value) => (
						<button
							type="button"
							key={value}
							aria-pressed={filter === value}
							onClick={() => setFilter(value)}
						>
							{t(value)} · {counts[value]}
						</button>
					))}
				</fieldset>
				{visibleTasks.length ? (
					<div className="list">
						{visibleTasks.map((task) => (
							<TaskRow task={task} key={task.id} />
						))}
					</div>
				) : (
					<Empty />
				)}
			</section>
			{edit && (
				<Suspense
					fallback={
						<div className="toast" role="status">
							{t("loading")}
						</div>
					}
				>
					<TaskEditor mode={edit} onClose={() => setEdit(null)} />
				</Suspense>
			)}
		</main>
	);
}
