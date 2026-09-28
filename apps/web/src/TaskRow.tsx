import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { useState } from "react";
import type { Task } from "../../../packages/domain/src";
import { save } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { ImpactTaskRow } from "./ImpactTaskRow";
import { date, useAppContext } from "./view-shared";
export function TaskRow({ task }: { task: Task }) {
	const { t, i18n } = useTranslation();
	const { notify } = useAppContext();
	const [busy, setBusy] = useState(false);
	if (task.impactSnapshot) return <ImpactTaskRow task={task} />;
	const completionHistory = task.completionHistory?.length
		? task.completionHistory
		: task.done && task.completedAt ? [task.completedAt] : [];
	return (
		<div className="list-row" id={`task-${task.id}`}>
			<Button
				size="icon"
				variant="ghost"
				disabled={busy}
				aria-label={t(task.done ? "reopen" : "complete")}
				onClick={async () => {
					setBusy(true);
					try {
						const now = new Date().toISOString();
						await save("task", {
							...task,
							done: !task.done,
							completedAt: task.done ? "" : now,
							completionHistory: task.done
								? completionHistory
								: [...completionHistory, now],
						});
						notify(t("saved"));
					} catch {
						notify(t("error"));
					} finally {
						setBusy(false);
					}
				}}
			>
				{task.done ? <Check size={18} /> : <span className="check-circle" />}
			</Button>
			<div>
				<strong className={task.done ? "done" : ""}>{task.name}</strong>
				<small>{date(task.dueDate, i18n.language)}</small>
				{completionHistory.length ? (
					<small>{t("impactCompletedHistory")}: {completionHistory.map((value) => new Date(value).toLocaleString(i18n.language)).join(" · ")}</small>
				) : null}
			</div>
			<span className="chip">{t(task.done ? "done" : "pending")}</span>
		</div>
	);
}
