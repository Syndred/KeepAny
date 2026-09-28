import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "./components/ui/button";
import { Empty, PageTitle, useAppContext } from "./view-shared";
import { TaskRow } from "./TaskRow";
const TaskEditor = lazy(() =>
	import("./workflows").then((module) => ({ default: module.TaskEditor })),
);
export function TaskPage() {
	const { data } = useAppContext();
	const { t } = useTranslation();
	const [edit, setEdit] = useState(false);
	const tasks = data.tasks
		.filter((x) => !x.deleted)
		.sort(
			(a, b) =>
				Number(a.done) - Number(b.done) || a.dueDate.localeCompare(b.dueDate),
		);
	return (
		<main className="page">
			<PageTitle
				title={t("tasks")}
				action={
					<Button variant="primary" onClick={() => setEdit(true)}>
						<Plus size={17} />
						{t("newTask")}
					</Button>
				}
			/>
			<section className="card">
				{tasks.length ? (
					<div className="list">
						{tasks.map((task) => (
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
					<TaskEditor onClose={() => setEdit(false)} />
				</Suspense>
			)}
		</main>
	);
}
