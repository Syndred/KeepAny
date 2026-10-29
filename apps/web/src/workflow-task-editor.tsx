import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { taskSchema, currencies, parseMinorUnits, type Asset, type Task } from "../../../packages/domain/src";
import { createMaintenanceSchedule, type RepeatRule } from "../../../packages/domain/src/task-repeat";
import { localRepository, save } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { useAppContext } from "./view-shared";
import { Select, SelectOption } from "./components/ui/select";
import { manualTaskDedupeKey, prepareTaskEdit } from "./task-edit";
import { saveTaskIfCurrent } from "../../../packages/local-db/src";
import { Field } from "./workflow-field";
export function TaskEditor({
	assetId = "",
	task: initialTask,
	mode = "simple",
	className,
	onClose,
}: {
	assetId?: string;
	task?: Task;
	mode?: "simple" | "maintenance";
	className?: string;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const [task] = useState(initialTask);
	const [name, setName] = useState(task?.name ?? "");
	const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
	const [nameError, setNameError] = useState("");
	const [dueDateError, setDueDateError] = useState("");
	const [failure, setFailure] = useState("");
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	function closeIfIdle() {
		if (!inFlight.current) onClose();
	}
	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (inFlight.current) return;
		setNameError("");
		setDueDateError("");
		setFailure("");
		if (!name.trim()) {
			setNameError(t("required"));
			return;
		}
		const candidate = {
			id: crypto.randomUUID(),
			name: name.trim(),
			assetId,
			dueDate,
			done: false,
			completedAt: "",
			createdAt: new Date().toISOString(),
			dedupeKey: "",
			deleted: false,
		};
		const parsed = taskSchema.safeParse(candidate);
		if (!parsed.success) {
			const invalidDate = parsed.error.issues.some((issue) => issue.path[0] === "dueDate");
			if (invalidDate) setDueDateError(t("invalid"));
			else setNameError(t("invalid"));
			return;
		}
		inFlight.current = true;
		setBusy(true);
		try {
			if (task) await saveTaskIfCurrent(task, await prepareTaskEdit(task, name, dueDate));
			else await save("task", { ...parsed.data, dedupeKey: await manualTaskDedupeKey(name, assetId, dueDate) });
			onClose();
		} catch (error) {
			setFailure(error instanceof Error && error.message === "task-duplicate" ? t("taskDuplicatePending") : error instanceof Error && error.message === "task-stale" ? t("workflowTaskStale") : t("error"));
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	if (mode === "maintenance") return <MaintenancePlanEditor onClose={onClose} />;
	return (
		<Dialog title={t(task ? "editTask" : "newTask")} className={className} onClose={closeIfIdle} closeDisabled={busy}>
			<form onSubmit={(e) => void submit(e)}>
				<div className="form-grid">
					<Field
						name="taskName"
						disabled={busy}
						label={t("name")}
						value={name}
						onChange={(value) => { setName(value); setNameError(""); setFailure(""); }}
						error={nameError}
					/>
					<Field
						name="taskDue"
						disabled={busy}
						label={t("date")}
						type="date"
						value={dueDate}
						onChange={(value) => { setDueDate(value); setDueDateError(""); setFailure(""); }}
						error={dueDateError}
					/>
				</div>
				{failure && <p className="notice" role="alert">{failure}</p>}
				<div className="actions">
					<Button type="button" onClick={closeIfIdle} disabled={busy}>
						{t("cancel")}
					</Button>
					<Button variant="primary" type="submit" disabled={busy}>
						{t("save")}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}

function MaintenancePlanEditor({ onClose }: { onClose: () => void }) {
	const { t } = useTranslation();
	const { data } = useAppContext();
	const [name, setName] = useState("");
	const [assetId, setAssetId] = useState("");
	const [dueDate, setDueDate] = useState("");
	const [mode, setMode] = useState<RepeatRule["mode"]>("once");
	const [every, setEvery] = useState("1");
	const [unit, setUnit] = useState<"day" | "week" | "month" | "year">("month");
	const [leadDays, setLeadDays] = useState("7");
	const [amount, setAmount] = useState("");
	const [currency, setCurrency] = useState<(typeof currencies)[number]>("CNY");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const assets = data.assets.filter((asset) => !asset.deleted);
	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (inFlight.current) return;
		setError("");
		if (!name.trim() || !assetId || !assets.some((asset) => asset.id === assetId)) { setError(t("maintenanceRequired")); return; }
		const minor = amount.trim() ? parseMinorUnits(amount, currency) : null;
		if (minor !== null && !Number.isSafeInteger(minor)) { setError(t("maintenanceAmountInvalid")); return; }
		if (!leadDays.trim()) { setError(t("maintenanceScheduleInvalid")); return; }
		const rule: RepeatRule = mode === "once" ? { mode } : { mode, unit, every: Number(every) };
		let candidate: Task;
		try {
			const schedule = createMaintenanceSchedule({ dueDate, rule, leadDays: Number(leadDays), plannedAmountMinor: minor, currency });
			candidate = taskSchema.parse({ id: crypto.randomUUID(), name: name.trim(), assetId, dueDate: schedule.dueDate, done: false, completedAt: "", createdAt: new Date().toISOString(), dedupeKey: "", maintenancePlan: { schedule, active: true, records: [] }, deleted: false });
		} catch { setError(t("maintenanceScheduleInvalid")); return; }
		inFlight.current = true; setBusy(true);
		try {
			const currentAsset = await (await localRepository()).get<Asset>("asset", assetId);
			if (!currentAsset || currentAsset.deleted) throw Error("asset-missing");
			const normalized = name.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en");
			const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
			const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
			await save("task", { ...candidate, dedupeKey: `maintenance:${assetId}:${hash.slice(0, 48)}:${dueDate}` });
			onClose();
		} catch (cause) { setError(cause instanceof Error && cause.message === "task-duplicate" ? t("taskDuplicatePending") : cause instanceof Error && cause.message === "asset-missing" ? t("maintenanceAssetMissing") : t("error")); }
		finally { inFlight.current = false; setBusy(false); }
	}
	return <Dialog title={t("newMaintenancePlan")} onClose={() => { if (!inFlight.current) onClose(); }}>
		<form className="maintenance-editor" onSubmit={(event) => void submit(event)}>
			<div className="form-grid">
				<Field name="maintenanceName" label={t("maintenanceName")} value={name} onChange={(value) => setName(value)} />
				<div className="field"><label htmlFor="maintenanceAsset">{t("maintenanceAsset")}</label><Select id="maintenanceAsset" value={assetId} onValueChange={(selectValue) => setAssetId(selectValue)} required><SelectOption value="">{t("maintenanceSelectAsset")}</SelectOption>{assets.map((asset) => <SelectOption key={asset.id} value={asset.id}>{asset.name} · {t(asset.kind)}</SelectOption>)}</Select></div>
				<div className="field"><label htmlFor="maintenanceRule">{t("maintenanceRule")}</label><Select id="maintenanceRule" value={mode} onValueChange={(selectValue) => setMode(selectValue as RepeatRule["mode"])}><SelectOption value="once">{t("maintenanceOnce")}</SelectOption><SelectOption value="fixed">{t("maintenanceFixed")}</SelectOption><SelectOption value="afterCompletion">{t("maintenanceAfterCompletion")}</SelectOption></Select></div>
				<Field name="maintenanceDue" label={t("maintenanceDue")} type="date" value={dueDate} onChange={setDueDate} />
				{mode !== "once" && <><Field name="maintenanceEvery" label={t("maintenanceEvery")} type="number" value={every} onChange={setEvery} /><div className="field"><label htmlFor="maintenanceUnit">{t("maintenanceUnit")}</label><Select id="maintenanceUnit" value={unit} onValueChange={(selectValue) => setUnit(selectValue as typeof unit)}>{(["day", "week", "month", "year"] as const).map((value) => <SelectOption key={value} value={value}>{t(value)}</SelectOption>)}</Select></div></>}
				<Field name="maintenanceLead" label={t("maintenanceLead")} type="number" value={leadDays} onChange={setLeadDays} />
				<Field name="maintenanceAmount" label={t("maintenanceAmount")} value={amount} onChange={setAmount} />
				<div className="field"><label htmlFor="maintenanceCurrency">{t("currency")}</label><Select id="maintenanceCurrency" value={currency} onValueChange={(selectValue) => setCurrency(selectValue as typeof currency)}>{currencies.map((value) => <SelectOption key={value} value={value}>{value}</SelectOption>)}</Select></div>
			</div>
			<p className="maintenance-estimate-note">{t("maintenanceEstimateOnly")}</p>
			{!assets.length && <p className="field-error">{t("maintenanceNoAssets")}</p>}
			{error && <p className="field-error" role="alert">{error}</p>}
			<div className="actions"><Button type="button" onClick={onClose} disabled={busy}>{t("cancel")}</Button><Button type="submit" variant="primary" disabled={busy || !assets.length}>{t("maintenanceCreate")}</Button></div>
		</form>
	</Dialog>;
}
