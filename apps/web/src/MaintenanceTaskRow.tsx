import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { taskSchema, type Task } from "../../../packages/domain/src";
import { advanceMaintenanceSchedule, deferMaintenanceSchedule, maintenanceReminderDate, type MaintenanceAction } from "../../../packages/domain/src/task-repeat";
import { saveTaskIfCurrent } from "../../../packages/local-db/src";
import { Badge } from "./components/ui/badge";
import { TaskCard } from "./components/ui/task-card";
import { TextLink } from "./components/ui/text-link";
import { Button } from "./components/ui/button";
import { date, money, useAppContext } from "./view-shared";
import "./maintenance-plan.css";

function today() {
	const now = new Date();
	return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function MaintenanceTaskRow({ task }: { task: Task }) {
	const plan = task.maintenancePlan;
	const { data, notify } = useAppContext();
	const { t, i18n } = useTranslation();
	const [action, setAction] = useState<MaintenanceAction | "defer" | null>(null);
	const [actionDate, setActionDate] = useState(today);
	const [evidence, setEvidence] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	if (!plan) return null;
	const { schedule } = plan;
	const asset = data.assets.find((item) => item.id === task.assetId);
	const latest = plan.records.at(-1);
	const effectiveDueDate = plan.active ? plan.deferredUntil || schedule.dueDate : task.dueDate;
	const reminderDate = maintenanceReminderDate(schedule, effectiveDueDate === schedule.dueDate ? "" : effectiveDueDate);
	const todayDate = today();
	const reminderState = plan.active && todayDate > effectiveDueDate ? "maintenanceOverdue" : plan.active && todayDate >= reminderDate ? "maintenanceReminderActive" : "";
	const cadence = schedule.rule.mode === "once" ? t("maintenanceOnce") : `${t(schedule.rule.mode === "fixed" ? "maintenanceFixed" : "maintenanceAfterCompletion")} · ${t("maintenanceEveryCount", { count: schedule.rule.every })} ${t(schedule.rule.unit)}`;
	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (inFlight.current || !action || !plan?.active) return;
		if (!evidence.trim()) { setError(t("maintenanceEvidenceRequired")); return; }
		if (actionDate > today()) { setError(t("maintenanceFutureAction")); return; }
		if (plan.records.length >= 1000) { setError(t("maintenanceRecordLimit")); return; }
		inFlight.current = true; setBusy(true); setError("");
		try {
			const recordedAt = new Date().toISOString();
			const next = action === "defer" ? (() => {
				const transition = deferMaintenanceSchedule(schedule, plan.deferredUntil, actionDate);
				return taskSchema.parse({ ...task, dueDate: transition.nextDueDate, maintenancePlan: { ...plan, deferredUntil: transition.nextDueDate, records: [...plan.records, { ...transition.record, evidence: evidence.trim(), recordedAt }] } });
			})() : (() => {
				const transition = advanceMaintenanceSchedule(schedule, action, actionDate, plan.deferredUntil);
				return taskSchema.parse({ ...task, dueDate: transition.schedule?.dueDate ?? transition.record.previousDueDate, done: !transition.schedule,
					completedAt: transition.schedule ? "" : recordedAt,
					completionHistory: action === "complete" ? [...task.completionHistory, recordedAt] : task.completionHistory,
					maintenancePlan: { schedule: transition.schedule ?? schedule, active: !!transition.schedule, deferredUntil: "", records: [...plan.records, { ...transition.record, evidence: evidence.trim(), recordedAt }] } });
			})();
			await saveTaskIfCurrent(task, next);
			setAction(null); setEvidence(""); notify(t("saved"));
		} catch (cause) {
			setError(cause instanceof Error && cause.message === "task-stale" ? t("maintenanceTaskStale") : cause instanceof Error && cause.message === "schedule-overflow" ? t("maintenanceScheduleOverflow") : t("error"));
		} finally { inFlight.current = false; setBusy(false); }
	}
	return <TaskCard className="list-row maintenance-task-row" id={`task-${task.id}`}>
		<div className="maintenance-task-head"><div><strong>{task.name}</strong><small>{t("maintenanceAsset")}: {asset && !asset.deleted ? <TextLink asChild><Link to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }}>{asset.name}</Link></TextLink> : asset?.name ?? t("maintenanceAssetMissing")}</small></div><Badge tone={plan.active ? "pending" : "success"}>{plan.active ? t("pending") : t(latest?.action === "skip" ? "maintenanceSkipped" : "done")}</Badge></div>
		<div className="maintenance-task-facts"><span>{t("maintenanceDue")}: {date(effectiveDueDate, i18n.language)}</span><span>{t("maintenanceReminder")}: {date(reminderDate, i18n.language)}</span><span>{t("maintenanceRule")}: {cadence}</span>{schedule.plannedAmountMinor !== null && <span>{t("maintenanceAmount")}: {money(schedule.plannedAmountMinor, schedule.currency, i18n.language)}</span>}</div>
		{effectiveDueDate !== schedule.dueDate && <small className="maintenance-estimate-note">{t("maintenanceOriginalDue")}: {date(schedule.dueDate, i18n.language)}</small>}
		{reminderState && <p className="maintenance-reminder-state">{t(reminderState)}</p>}
		{schedule.plannedAmountMinor !== null && <small className="maintenance-estimate-note">{t("maintenanceEstimateOnly")}</small>}
		{plan.active && plan.records.length < 1000 && <div className="maintenance-task-actions"><Button size="small" onClick={() => { setAction("complete"); setActionDate(today()); setError(""); }}>{t("maintenanceComplete")}</Button><Button size="small" onClick={() => { setAction("defer"); setActionDate(today()); setError(""); }}>{t("maintenanceDefer")}</Button><Button size="small" onClick={() => { setAction("skip"); setActionDate(today()); setError(""); }}>{t("maintenanceSkip")}</Button></div>}
		{plan.active && plan.records.length >= 1000 && <p className="field-error">{t("maintenanceRecordLimit")}</p>}
		{action && <form className="maintenance-action-form" onSubmit={(event) => void submit(event)}><strong>{t(action === "complete" ? "maintenanceComplete" : action === "defer" ? "maintenanceDefer" : "maintenanceSkip")}</strong><label>{t("maintenanceActionDate")}<input type="date" value={actionDate} onChange={(event) => setActionDate(event.target.value)} required disabled={busy} /></label><label>{t("maintenanceEvidence")}<textarea value={evidence} maxLength={1000} onChange={(event) => { setEvidence(event.target.value); setError(""); }} required disabled={busy} rows={2} placeholder={t("maintenanceEvidenceHint")} /></label>{error && <p className="field-error" role="alert">{error}</p>}<div className="maintenance-task-actions"><Button type="button" onClick={() => setAction(null)} disabled={busy}>{t("cancel")}</Button><Button type="submit" variant="primary" disabled={busy}>{t("maintenanceSaveRecord")}</Button></div></form>}
		{plan.records.length > 0 && <details className="maintenance-history"><summary>{t("maintenanceHistory", { count: plan.records.length })}</summary>{[...plan.records].reverse().map((record) => <div key={`${record.previousDueDate}-${record.recordedAt}`} className="maintenance-history-item"><strong>{t(record.action === "complete" ? "maintenanceCompleted" : record.action === "defer" ? "maintenanceDeferred" : "maintenanceSkipped")} · {date(record.actionDate, i18n.language)}</strong><p>{record.evidence}</p><small>{t("maintenancePreviousDue")}: {date(record.previousDueDate, i18n.language)} · {t("maintenanceNextDue")}: {record.nextDueDate ? date(record.nextDueDate, i18n.language) : t("maintenanceFinished")}</small><small>{new Date(record.recordedAt).toLocaleString(i18n.language)}</small></div>)}</details>}
	</TaskCard>;
}
