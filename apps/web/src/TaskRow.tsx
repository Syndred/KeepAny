import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import type { Task } from "../../../packages/domain/src";
import { save } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { date, useAppContext } from "./view-shared";
export function TaskRow({ task }: { task: Task }) {
	const { t, i18n } = useTranslation();
	const { notify } = useAppContext();
	return (
		<div className="list-row">
			<Button
				size="icon"
				variant="ghost"
				aria-label={t(task.done ? "reopen" : "complete")}
				onClick={async () => {
					await save("task", {
						...task,
						done: !task.done,
						completedAt: task.done ? "" : new Date().toISOString(),
					});
					notify(t("saved"));
				}}
			>
				{task.done ? <Check size={18} /> : <span className="check-circle" />}
			</Button>
			<div>
				<strong className={task.done ? "done" : ""}>{task.name}</strong>
				<small>{date(task.dueDate, i18n.language)}</small>
			</div>
			<span className="chip">{t(task.done ? "done" : "pending")}</span>
		</div>
	);
}
