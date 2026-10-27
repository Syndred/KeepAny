import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { dueOnCycle, type Task } from "../../../packages/domain/src";
import { rescheduleTaskReminder, zonedParts } from "../../../packages/domain/src/task-reminder";
import { saveTaskIfCurrent, setTaskDone, deleteTaskIfCurrent } from "../../../packages/local-db/src";
import { Badge } from "./components/ui/badge";
import { TaskCard } from "./components/ui/task-card";
import { TextLink } from "./components/ui/text-link";
import { Button } from "./components/ui/button";
import { Dialog } from './components/ui/dialog';
import { ImpactTaskRow } from "./ImpactTaskRow";
import { ProjectWorkflowTaskRow } from "./ProjectWorkflowTaskRow";
import { MaintenanceTaskRow } from "./MaintenanceTaskRow";
import { date, useAppContext } from "./view-shared";
const TaskEditor = lazy(() => import("./workflows").then(module => ({ default: module.TaskEditor })));
export function TaskRow({ task, hideRelated = false }: { task: Task; hideRelated?: boolean }) {
	const { t, i18n } = useTranslation();
	const { data, notify } = useAppContext();
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const [editing, setEditing] = useState(false);
	const [deleteBase, setDeleteBase] = useState<Task | null>(null);
	const [deleteError, setDeleteError] = useState('');
	if (task.impactSnapshot) return <ImpactTaskRow task={task} />;
	if (task.projectWorkflow) return <ProjectWorkflowTaskRow task={task} />;
	if (task.maintenancePlan) return <MaintenanceTaskRow task={task} />;
	const related = data.assets.find((asset) => asset.id === task.assetId && !asset.deleted);
	async function reschedule(dueDate: string) {
		if (inFlight.current || task.done || task.dueDate === dueDate) return;
		inFlight.current = true;
		setBusy(true);
		try {
			const dedupeKey = task.dedupeKey.startsWith("manual:")
				? `${task.dedupeKey.slice(0, task.dedupeKey.lastIndexOf(":"))}:${dueDate || "none"}`
				: task.dedupeKey;
			const reminder = task.reminder && dueDate ? rescheduleTaskReminder(task.reminder, dueDate) : undefined;
			await saveTaskIfCurrent(task, { ...task, ...(task.reminder ? { reminder } : {}), dueDate, dedupeKey });
			notify(t("saved"));
		} catch (error) {
			notify(t(error instanceof Error && error.message === "task-stale" ? "workflowTaskStale" : error instanceof Error && error.message === "task-duplicate" ? "taskDuplicatePending" : "error"));
		} finally { inFlight.current = false; setBusy(false); }
	}
	function postponeDay() {
		try {
			const now = new Date();
			const today = task.reminder ? zonedParts(now.toISOString(), task.reminder.timeZone).date : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
			void reschedule(dueOnCycle(task.dueDate > today ? task.dueDate : today, "day", 1, 1));
		} catch { notify(t("error")); }
	}
	const completionHistory = task.completionHistory?.length
		? task.completionHistory
		: task.done && task.completedAt ? [task.completedAt] : [];
	const reminderAt = task.reminder ? new Date(Date.parse(task.reminder.at) - task.reminder.leadMinutes * 60_000).toISOString() : null;
	const formatReminderTime = (at: string) => new Date(at).toLocaleString(i18n.language, { timeZone: task.reminder?.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
	return (
		<TaskCard className="list-row impact-task-row" id={`task-${task.id}`} tabIndex={-1}>
			<Button
				size="icon"
				variant="ghost"
				disabled={busy}
				aria-label={t(task.done ? "reopen" : "complete")}
				onClick={async () => {
					if (inFlight.current) return;
					inFlight.current = true;
					setBusy(true);
					try {
						const updated = await setTaskDone(task.id, task.done, task.reminder?.at);
						notify(t(updated.reminder && !updated.done && !task.done ? "reminderRepeatNext" : "saved"));
					} catch (error) {
						notify(t(error instanceof Error && error.message === "task-stale" ? "workflowTaskStale" : error instanceof Error && error.message === "task-duplicate" ? "taskDuplicatePending" : "error"));
					} finally {
						inFlight.current = false;
						setBusy(false);
					}
				}}
			>
				{task.done ? <Check size={18} /> : <span className="check-circle" />}
			</Button>
			<div className="impact-task-info">
				<strong className={task.done ? "done" : ""}>{task.name}</strong>
				{task.reminder && reminderAt ? <>
					<small>{t("reminderSavedDue")}: <time dateTime={task.reminder.at}>{formatReminderTime(task.reminder.at)}</time></small>
					<small>{t("reminderSavedTime")}: <time dateTime={reminderAt}>{formatReminderTime(reminderAt)}</time></small>
					<small>{t("reminderSavedZone", { timeZone: task.reminder.timeZone })}</small>
					<small>{t("reminderSavedLead", { count: task.reminder.leadMinutes })} · {task.reminder.rule.mode === "once" ? t("reminderSavedOnce") : t(`reminderSavedRepeat_${task.reminder.rule.mode}_${task.reminder.rule.unit}`, { count: task.reminder.rule.every })}</small>
				</> : <small>{date(task.dueDate, i18n.language)}</small>}
				{task.assetId && !hideRelated && <small>{t("related")}: {related ? <TextLink asChild><Link to="/assets/$kind/$id" params={{ kind: related.kind, id: related.id }}>{related.name}</Link></TextLink> : t("taskRelatedMissing")}</small>}
				{completionHistory.length ? (
					<small>{t("impactCompletedHistory")}: {completionHistory.map((value) => new Date(value).toLocaleString(i18n.language)).join(" · ")}</small>
				) : null}
			</div>
			<div className="impact-task-actions">
				<Button size="small" disabled={busy} onClick={() => setEditing(true)}>{t("edit")}</Button>
				<Button size="small" variant="danger" disabled={busy} onClick={() => { setDeleteBase(task); setDeleteError(''); }}>{t('taskDeleteAction')}</Button>
				{!task.done && <>
					<label htmlFor={`task-due-${task.id}`}>{t("remindLater")}</label>
					<input className="field" id={`task-due-${task.id}`} type="date" value={task.dueDate} disabled={busy} onChange={(event) => void reschedule(event.target.value)} />
					<Button size="small" disabled={busy} onClick={postponeDay}>{t("taskPostponeDay")}</Button>
				</>}
				<Badge tone={task.done ? "success" : "pending"}>{t(task.done ? "done" : "pending")}</Badge>
			</div>
			{editing && <Suspense fallback={null}><TaskEditor task={task} onClose={() => setEditing(false)} /></Suspense>}
			{deleteBase && <Dialog title={t('taskDeleteTitle')} closeDisabled={busy} onClose={() => { if (!inFlight.current) setDeleteBase(null); }}>
				<p>{t('taskDeletePrompt', { name: deleteBase.name })}</p>
				{deleteError && <p className="field-error" role="alert">{deleteError}</p>}
				<div className="actions"><Button disabled={busy} onClick={() => setDeleteBase(null)}>{t('cancel')}</Button><Button variant="danger" disabled={busy} onClick={() => {
					if (inFlight.current) return;
					inFlight.current = true; setBusy(true); setDeleteError('');
					void deleteTaskIfCurrent(deleteBase).then(() => { setDeleteBase(null); notify(t('saved')); }).catch(error => setDeleteError(t(error instanceof Error && error.message === 'task-stale' ? 'workflowTaskStale' : 'error'))).finally(() => { inFlight.current = false; setBusy(false); });
				}}>{t('taskDeleteAction')}</Button></div>
			</Dialog>}
		</TaskCard>
	);
}
