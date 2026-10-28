import { DatePicker } from "./components/ui/date-picker";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Task } from "../../../packages/domain/src";
import { saveTaskIfCurrent } from "../../../packages/local-db/src";
import { Badge } from "./components/ui/badge";
import { TaskCard } from "./components/ui/task-card";
import { TextLink } from "./components/ui/text-link";
import { Button } from "./components/ui/button";
import { date, useAppContext } from "./view-shared";

export function ImpactTaskRow({
	task,
	showTaskLink = false,
}: {
	task: Task;
	showTaskLink?: boolean;
}) {
	const snapshot = task.impactSnapshot;
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const [busy, setBusy] = useState(false);
	if (!snapshot) return null;
	const related = data.assets.find(
		(asset) => asset.id === snapshot.relatedAssetId && !asset.deleted,
	);
	const relation = data.relations.find((item) => item.id === snapshot.relationId);
	const relationInactive =
		!relation ||
		relation.deleted ||
		!data.assets.some((item) => item.id === snapshot.fromAssetId && !item.deleted) ||
		!data.assets.some((item) => item.id === snapshot.toAssetId && !item.deleted);
	const relationChanged =
		!relationInactive &&
		(relation.from !== snapshot.fromAssetId ||
			relation.to !== snapshot.toAssetId ||
			relation.label !== snapshot.label ||
			(relation.source ?? "") !== snapshot.source ||
			relation.verifiedAt !== snapshot.verifiedAt);
	const completionHistory = task.completionHistory?.length
		? task.completionHistory
		: task.done && task.completedAt ? [task.completedAt] : [];
	async function update(patch: Partial<Task>) {
		setBusy(true);
		try {
			await saveTaskIfCurrent(task, { ...task, ...patch });
			notify(t("saved"));
		} catch (cause) {
			notify(t(cause instanceof Error && cause.message === "task-stale" ? "workflowTaskStale" : "error"));
		} finally {
			setBusy(false);
		}
	}
	return (
		<TaskCard className="list-row impact-task-row" id={`task-${task.id}`}>
			<Button
				size="icon"
				variant="ghost"
				disabled={busy}
				aria-label={`${t(task.done ? "reopen" : "complete")} · ${snapshot.relatedName} · ${snapshot.label}`}
				onClick={() => {
					const now = new Date().toISOString();
					void update({
						done: !task.done,
						completedAt: task.done ? "" : now,
						completionHistory: task.done
							? completionHistory
							: [...completionHistory, now],
					});
				}}
			>
				{task.done ? <Check size={18} /> : <span className="check-circle" />}
			</Button>
			<div className="impact-task-info">
				<strong className={task.done ? "done" : ""}>
					{t("checkConnection")} · {snapshot.relatedName}
				</strong>
				<small>
					{t("related")}: {related ? (
						<TextLink asChild><Link
							to="/assets/$kind/$id"
							params={{ kind: related.kind, id: related.id }}
						>
							{related.name}
						</Link></TextLink>
					) : (
						snapshot.relatedName
					)}
				</small>
				<small>
					{snapshot.fromName} → {snapshot.toName} · {snapshot.label}
				</small>
				<small>
					{t("relationSource")}: {snapshot.source || "—"} · {t("verifiedAt")}: {date(snapshot.verifiedAt, i18n.language)}
				</small>
				<small>{t("impactSnapshotAt")}: {new Date(snapshot.generatedAt).toLocaleString(i18n.language)}</small>
				{relationInactive && <small className="field-error">{t("impactRelationInactive")}</small>}
				{relationChanged && <small className="field-error">{t("impactRelationChanged")}</small>}
				{completionHistory.length > 0 && (
					<small>{t("impactCompletedHistory")}: {completionHistory.map((value) => new Date(value).toLocaleString(i18n.language)).join(" · ")}</small>
				)}
				{showTaskLink && (
					<small><TextLink asChild><Link to="/tasks" hash={`task-${task.id}`}>{t("viewTask")}</Link></TextLink></small>
				)}
			</div>
			<div className="impact-task-actions">
				<label htmlFor={`impact-due-${task.id}`}>{t("remindLater")}</label>
				<DatePicker
					id={`impact-due-${task.id}`}

					value={task.dueDate}
					disabled={busy}
					onValueChange={(dateValue) => void update({ dueDate: dateValue })}
				/>
				<Badge tone={task.done ? "success" : "pending"}>{t(task.done ? "done" : "pending")}</Badge>
			</div>
		</TaskCard>
	);
}
