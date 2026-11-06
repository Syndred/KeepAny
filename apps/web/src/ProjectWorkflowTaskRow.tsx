import { TaskSummaryCells } from "./components/TaskSummaryCells";
import { Dialog } from "./components/ui/dialog";
import { DropdownMenuItem } from "./components/ui/dropdown-menu";
import { Textarea } from "./components/ui/textarea";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatMinorUnits, type Task } from "../../../packages/domain/src";
import {
	canRecordProjectWorkflowTask,
	recordProjectWorkflowTask,
} from "../../../packages/domain/src/project-workflow";
import { saveTaskIfCurrent } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { date, useAppContext } from "./view-shared";
import { Select, SelectOption } from "./components/ui/select";
import {
	ArrowUpRight,
	Check,
	Clock3,
	FileCheck2,
	LockKeyhole,
	Minus,
	TriangleAlert,
} from "lucide-react";
import { Badge } from "./components/ui/badge";
import { TextLink } from "./components/ui/text-link";
import { TaskCard, TaskReveal } from "./components/ui/task-card";
import "./project-workflow-task.css";

export function ProjectWorkflowTaskRow({
	task,
	round: suppliedRound,
}: {
	task: Task;
	round?: Task[];
}) {
	const { t, i18n } = useTranslation();
	const { data, notify } = useAppContext();
	const workflow = task.projectWorkflow;
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [editing, setEditing] = useState(false);
	const [outcome, setOutcome] = useState<"done" | "blocked" | "na">(
		workflow?.record?.outcome ??
			(workflow?.step === "brandSubmission" ||
			workflow?.step === "closeBacklink"
				? "na"
				: "done"),
	);
	const [evidence, setEvidence] = useState(workflow?.record?.evidence ?? "");
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const [error, setError] = useState("");
	if (!workflow) return null;
	const round =
		suppliedRound ??
		data.tasks.filter(
			(row) =>
				!row.deleted && row.projectWorkflow?.roundId === workflow.roundId,
		);
	const finalLocked = !canRecordProjectWorkflowTask(task, round);
	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (inFlight.current || !workflow) return;
		if (!evidence.trim()) {
			setError(t("workflowEvidenceRequired"));
			return;
		}
		if (finalLocked) {
			setError(t("workflowFinalLocked"));
			return;
		}
		inFlight.current = true;
		setBusy(true);
		setError("");
		try {
			const next = recordProjectWorkflowTask(
				task,
				outcome,
				evidence,
				new Date().toISOString(),
			);
			await saveTaskIfCurrent(task, next);
			setEditing(false);
			setDetailsOpen(false);
			notify(t("saved"));
		} catch (cause) {
			setError(
				cause instanceof Error && cause.message === "workflow-stale"
					? t("workflowRoundStale")
					: cause instanceof Error && cause.message === "task-stale"
						? t("workflowTaskStale")
						: t("error"),
			);
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	const retired =
		workflow.step === "brandSubmission" || workflow.step === "closeBacklink";
	const record = workflow.record;
	const linkedKind = workflow.sourceAssetKind;
	const linked =
		workflow.sourceAssetId &&
		linkedKind &&
		data.assets.some(
			(asset) => asset.id === workflow.sourceAssetId && !asset.deleted,
		);
	let sourceDetail = workflow.sourceDetail;
	if (workflow.step === "closeSubscription") {
		const match =
			/^(\d+) (CNY|USD|EUR|GBP|JPY) \/ (\d+) (month|year|week|day); (.*)$/.exec(
				sourceDetail,
			);
		sourceDetail = match
			? `${formatMinorUnits(Number(match[1]), match[2], i18n.language)} / ${match[3]} ${t(match[4])}${match[5] ? ` · ${t("dueDate")}: ${date(match[5], i18n.language)}` : ""}`
			: "";
	} else if (workflow.step === "closeDomain") {
		const parts = sourceDetail.split("; ");
		const renew = parts.pop() ?? "";
		const expiry = parts.pop() ?? "";
		const registrar = parts.join("; ");
		sourceDetail = [
			registrar && `${t("projectRegistrar")}: ${registrar}`,
			expiry && `${t("projectExpiry")}: ${date(expiry, i18n.language)}`,
			renew &&
				`${t(renew === "on" ? "projectAutoRenewOn" : renew === "off" ? "projectAutoRenewOff" : "projectAutoRenewUnknown")}`,
		]
			.filter(Boolean)
			.join(" · ");
	} else if (workflow.step === "closeBackup") {
		sourceDetail = `${sourceDetail} ${t("attachments")}`;
	} else if (
		[
			"brandSubmission",
			"closeBacklink",
			"closeRelated",
			"closeDecision",
		].includes(workflow.step)
	) {
		sourceDetail = t(sourceDetail);
	}
	function openDetails(edit: boolean) {
		setDetailsOpen(true);
		setEditing(edit);
		setOutcome(record?.outcome ?? (retired ? "na" : "done"));
		setEvidence(record?.evidence ?? "");
		setError("");
	}
	const StatusIcon =
		record?.outcome === "done"
			? Check
			: record?.outcome === "blocked"
				? TriangleAlert
				: record?.outcome === "na"
					? Minus
					: Clock3;
	const tone =
		record?.outcome === "done"
			? "success"
			: record?.outcome === "blocked"
				? "warning"
				: record?.outcome === "na"
					? "muted"
					: "pending";
	return (
		<TaskCard
			className="list-row simple-task-row account-compact-task project-workflow-task workflow-task-summary"
			id={`task-${task.id}`}
			data-outcome={record?.outcome ?? "pending"}
			data-task-busy={busy || undefined}
			aria-busy={busy || undefined}
		>
			<TaskSummaryCells
				name={
					<>
						{t(`workflowStep_${workflow.step}`)}
						{workflow.sourceName ? ` · ${workflow.sourceName}` : ""}
					</>
				}
				done={task.done}
				dueDate={task.dueDate}
				busy={busy}
				toggleDisabled={finalLocked}
				editDisabled={finalLocked}
				toggleLabel={t("workflowRecordResult")}
				editLabel={t(record ? "workflowEditRecord" : "workflowRecordResult")}
				onToggle={() => openDetails(true)}
				onEdit={() => openDetails(true)}
				summary={
					[
						retired && t("workflowRetiredStep"),
						finalLocked && t("workflowFinalLocked"),
						(record?.outcome === "blocked" || record?.outcome === "na") &&
							t(`workflowOutcome_${record.outcome}`),
					]
						.filter(Boolean)
						.join(" · ") || undefined
				}
				menu={
					<>
						<DropdownMenuItem onClick={() => openDetails(false)}>
							{t("taskViewDetails")}
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={finalLocked}
							onClick={() => openDetails(true)}
						>
							{t(record ? "workflowEditRecord" : "workflowRecordResult")}
						</DropdownMenuItem>
					</>
				}
			/>
			{detailsOpen && (
				<Dialog
					title={t(`workflowStep_${workflow.step}`)}
					onClose={() => {
						if (!busy) {
							setDetailsOpen(false);
							setEditing(false);
						}
					}}
					closeDisabled={busy}
				>
					<div className="project-workflow-detail task-detail-content">
						<div className="project-workflow-task-head">
							<div className="project-workflow-task-title">
								<span className="project-workflow-task-icon" aria-hidden="true">
									<FileCheck2 size={19} />
								</span>
								<div>
									<strong>{t(`workflowStep_${workflow.step}`)}</strong>
									{workflow.sourceName && (
										<span className="project-workflow-task-name">
											{workflow.sourceName}
										</span>
									)}
								</div>
							</div>
							<Badge
								tone={tone}
								className={`project-workflow-chip ${record?.outcome ?? "pending"}`}
							>
								<StatusIcon aria-hidden="true" />
								{t(`workflowOutcome_${record?.outcome ?? "pending"}`)}
							</Badge>
						</div>
						{retired && (
							<p className="project-workflow-warning">
								{t("workflowRetiredStep")}
							</p>
						)}
						{sourceDetail && (
							<p className="project-workflow-task-detail">{sourceDetail}</p>
						)}
						{(linked || workflow.sourceUrl) && (
							<div className="project-workflow-source">
								{linked && linkedKind ? (
									<TextLink asChild>
										<Link
											to="/assets/$kind/$id"
											params={{ kind: linkedKind, id: workflow.sourceAssetId }}
										>
											{t("workflowOpenRelated")}
											<ArrowUpRight aria-hidden="true" />
										</Link>
									</TextLink>
								) : null}
								{workflow.sourceUrl && (
									<TextLink
										href={workflow.sourceUrl}
										target="_blank"
										rel="noopener noreferrer"
									>
										{t("workflowOpenSource")}
										<ArrowUpRight aria-hidden="true" />
									</TextLink>
								)}
							</div>
						)}
						{record && (
							<div className="project-workflow-record">
								<span>{t("workflowEvidence")}</span>
								<p>{record.evidence}</p>
								<time dateTime={record.recordedAt}>
									{new Date(record.recordedAt).toLocaleString(i18n.language)}
								</time>
							</div>
						)}
						{finalLocked && (
							<p
								className="project-workflow-locked"
								id={`workflow-lock-${task.id}`}
							>
								<LockKeyhole size={15} aria-hidden="true" />
								<span>{t("workflowFinalLocked")}</span>
							</p>
						)}
						{editing ? (
							<TaskReveal>
								<form
									className="project-workflow-record-form"
									onSubmit={(event) => void submit(event)}
								>
									<label htmlFor={`workflow-result-${task.id}`}>
										{t("workflowResult")}
										<Select
											id={`workflow-result-${task.id}`}
											value={outcome}
											onValueChange={(selectValue) =>
												setOutcome(selectValue as typeof outcome)
											}
											disabled={busy}
										>
											<SelectOption value="done">
												{t("workflowOutcome_done")}
											</SelectOption>
											<SelectOption value="blocked">
												{t("workflowOutcome_blocked")}
											</SelectOption>
											<SelectOption value="na">
												{t("workflowOutcome_na")}
											</SelectOption>
										</Select>
									</label>
									<label>
										{t("workflowEvidence")}
										<Textarea
											value={evidence}
											maxLength={2000}
											rows={3}
											onChange={(event) => {
												setEvidence(event.target.value);
												setError("");
											}}
											required
											disabled={busy}
											placeholder={t("workflowEvidenceHint")}
										/>
									</label>
									{error && (
										<p className="field-error" role="alert">
											{error}
										</p>
									)}
									<div className="project-workflow-actions">
										<Button
											type="button"
											onClick={() => {
												setEditing(false);
												setDetailsOpen(false);
											}}
											disabled={busy}
										>
											{t("cancel")}
										</Button>
										<Button type="submit" variant="primary" disabled={busy}>
											{t("workflowSaveRecord")}
										</Button>
									</div>
								</form>
							</TaskReveal>
						) : (
							<div className="project-workflow-task-footer">
								<small>
									{t("workflowSnapshotAt")}:{" "}
									<time dateTime={workflow.generatedAt}>
										{new Date(workflow.generatedAt).toLocaleString(
											i18n.language,
										)}
									</time>
								</small>
								<Button
									size="small"
									aria-describedby={
										finalLocked ? `workflow-lock-${task.id}` : undefined
									}
									onClick={() => {
										setOutcome(record?.outcome ?? (retired ? "na" : "done"));
										setEvidence(record?.evidence ?? "");
										setEditing(true);
									}}
									disabled={finalLocked}
								>
									{t(record ? "workflowEditRecord" : "workflowRecordResult")}
								</Button>
							</div>
						)}
					</div>
				</Dialog>
			)}
		</TaskCard>
	);
}
