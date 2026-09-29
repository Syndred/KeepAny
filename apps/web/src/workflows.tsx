import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import Papa from "papaparse";
import { Download, Link2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	assetSchema,
	taskSchema,
	currencies,
	duplicates,
	inputFromMinorUnits,
	newAsset,
	parseMinorUnits,
	type Asset,
	type AssetKind,
	type Category,
	type Task,
} from "../../../packages/domain/src";
import { createMaintenanceSchedule, type RepeatRule } from "../../../packages/domain/src/task-repeat";
import {
	decryptBackup,
	encryptBackup,
} from "../../../packages/local-db/src/backup-crypto";
import {
	allRecords,
	exportArchive,
	inspectArchive,
	localRepository,
	putFile,
	cleanupUnreferencedFile,
	restoreArchive,
	save,
	saveAssetIfCurrent,
	saveBatch,
} from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { RemoteBackupPanel } from "./components/RemoteBackupPanel";
import { ExternalLinkImportPanel } from "./components/ExternalLinkImportPanel";
import { estimateAiCost, readAiUsage, type AiUsage } from "./ai-usage";
import { useAppContext } from "./view-shared";

const categoryOptions: Record<AssetKind, string[]> = {
	project: ["website", "repository", "tool"],
	account: ["email", "phone", "social"],
	subscription: ["software", "service"],
	item: ["device", "other"],
	vault: ["other"],
};
type FieldName = keyof Asset;
function Field({
	label,
	name,
	value,
	onChange,
	type = "text",
	autoComplete,
	error,
	children,
}: {
	label: string;
	name: string;
	value?: string | number;
	onChange?: (s: string) => void;
	type?: string;
	autoComplete?: string;
	error?: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="field">
			<label htmlFor={name}>{label}</label>
			{children ?? (
				<input
					id={name}
					name={name}
					type={type}
					autoComplete={autoComplete}
					step={type === "number" ? "any" : undefined}
					value={value ?? ""}
					onChange={(e) => onChange?.(e.target.value)}
					aria-invalid={!!error}
					aria-describedby={error ? `${name}-error` : undefined}
				/>
			)}
			{error && (
				<small id={`${name}-error`} className="field-error">
					{error}
				</small>
			)}
		</div>
	);
}

export function AssetEditor({
	kind,
	asset,
	categories = [],
	onClose,
}: {
	kind: AssetKind;
	asset?: Asset;
	categories?: Category[];
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const original = useRef(asset).current;
	const [draft, setDraft] = useState<Asset>(
		() =>
			original ?? {
				...newAsset(kind),
				name: "",
				category: categoryOptions[kind][0],
			},
	);
	const [amount, setAmount] = useState(
		kind === "item" && !asset?.itemPurchasePriceKnown
			? ""
			: asset?.amount != null
			? inputFromMinorUnits(asset.amount, asset.currency)
			: "0",
	);
	const [discount, setDiscount] = useState(
		asset?.discountAmount != null
			? inputFromMinorUnits(asset.discountAmount, asset.currency)
			: "0",
	);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [tagsInput, setTagsInput] = useState(() => original?.tags.join(", ") ?? "");
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState("");
	const inFlight = useRef(false);
	function closeIfIdle() {
		if (!inFlight.current) onClose();
	}
	function set<K extends FieldName>(key: K, value: Asset[K]) {
		setDraft((prev) => ({ ...prev, [key]: value }));
		setErrors((prev) => ({ ...prev, [key]: "" }));
	}
	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (inFlight.current) return;
		const parsedAmount = kind === "item" && !amount.trim() ? 0 : parseMinorUnits(amount, draft.currency);
		const parsedDiscount = kind === "subscription" ? parseMinorUnits(discount, draft.currency) : draft.discountAmount;
		const scheduleChanged =
			kind === "subscription" &&
			original !== undefined &&
			(draft.dueDate !== original.dueDate ||
				draft.cycle !== original.cycle ||
				draft.interval !== original.interval);
		const parsed = assetSchema.safeParse({
			...draft,
			tags: tagsInput.split(",").map((tag) => tag.trim()).filter(Boolean),
			name: draft.name.trim(),
			amount: parsedAmount,
			itemPurchasePriceKnown: kind === "item" ? !!amount.trim() : draft.itemPurchasePriceKnown,
			discountAmount: parsedDiscount,
			billingAnchor:
				kind === "subscription" && (scheduleChanged || !draft.billingAnchor)
					? draft.dueDate
					: draft.billingAnchor,
			renewalCount: scheduleChanged ? 0 : draft.renewalCount,
			cancelledAt:
				kind === "subscription" &&
				draft.status === "cancelled" &&
				original?.status !== "cancelled"
					? new Date().toISOString()
					: kind === "subscription" && draft.status !== "cancelled"
						? ""
						: draft.cancelledAt,
			updatedAt: new Date().toISOString(),
		});
		if (!parsed.success) {
			setErrors(
				Object.fromEntries(
					parsed.error.issues.map((issue) => [
						String(issue.path[0]),
						t("invalid"),
					]),
				),
			);
			return;
		}
		inFlight.current = true;
		setBusy(true);
		setFailure("");
		try {
			if (original) await saveAssetIfCurrent(original, parsed.data);
			else await save("asset", parsed.data);
			onClose();
		} catch (error) {
			const reason = error instanceof Error ? error.message : "";
			setFailure(t(reason === "asset-stale" ? "assetStale" :
				reason === "asset-stale-renewal" ? "renewalStale" :
				reason === "item-stale" ? "itemStale" :
				reason === "renewal-recovery-pending" && kind === "item" ? "itemRecoveryPending" : "error"));
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	return (
		<Dialog title={asset ? t("edit") : t("newRecord")} onClose={closeIfIdle}>
			<form onSubmit={(e) => void submit(e)}>
				<div className="form-grid">
					<Field
						name="name"
						label={t("name")}
						value={draft.name}
						onChange={(v) => set("name", v)}
						error={errors.name}
					/>
					<Field name="category" label={t("category")} error={errors.category}>
						<select
							id="category"
							value={draft.category}
							onChange={(e) => set("category", e.target.value)}
						>
							{[
								...new Set([
									draft.category,
									...categoryOptions[kind],
									...categories
										.filter((c) => c.kind === kind && !c.deleted)
										.map((c) => c.name),
								]),
							].map((c) => (
								<option key={c} value={c}>
									{t(c)}
								</option>
							))}
						</select>
					</Field>
					{kind !== "item" && (
						<Field
							name="url"
							label={t("url")}
							value={draft.url}
							onChange={(v) => set("url", v)}
							type="url"
							error={errors.url}
						/>
					)}
					{kind === "project" && (
						<>
							<Field
								name="projectLaunchMonth"
								label={t("projectLaunchMonth")}
								type="month"
								value={draft.projectLaunchMonth}
								onChange={(v) => set("projectLaunchMonth", v)}
								error={errors.projectLaunchMonth}
							/>
							<Field
								name="projectInspectionDate"
								label={t("projectNextInspection")}
								type="date"
								value={draft.projectInspectionDate}
								onChange={(v) => set("projectInspectionDate", v)}
								error={errors.projectInspectionDate}
							/>
							<Field
								name="contact"
								label={t("contact")}
								value={draft.contact}
								onChange={(v) => set("contact", v)}
								error={errors.contact}
							/>
							<Field
								name="description"
								label={t("description")}
								value={draft.description}
								onChange={(v) => set("description", v)}
								error={errors.description}
							/>
						</>
					)}
					{kind === "account" && (
						<>
							<Field
								name="username"
								label={t("username")}
								value={draft.username}
								onChange={(v) => set("username", v)}
								error={errors.username}
							/>
							<Field
								name="contact"
								label={t("contact")}
								value={draft.contact}
								onChange={(v) => set("contact", v)}
								error={errors.contact}
							/>
						</>
					)}
					{kind === "subscription" && (
						<>
							<Field
								name="amount"
								label={t("amount")}
								value={amount}
								type="number"
								onChange={setAmount}
								error={errors.amount}
							/>
							<Field name="currency" label={t("currency")}>
								<select
									id="currency"
									value={draft.currency}
									onChange={(e) =>
										set("currency", e.target.value as Asset["currency"])
									}
								>
									{["CNY", "USD", "EUR", "GBP", "JPY"].map((v) => (
										<option key={v} value={v}>
											{v}
										</option>
									))}
								</select>
							</Field>
							<Field name="cycle" label={t("cycle")}>
								<select
									id="cycle"
									value={draft.cycle}
									onChange={(e) =>
										set("cycle", e.target.value as Asset["cycle"])
									}
								>
									{["month", "year", "week", "day"].map((v) => (
										<option key={v} value={v}>
											{t(v)}
										</option>
									))}
								</select>
							</Field>
							<Field
								name="interval"
								label={t("interval")}
								value={draft.interval}
								type="number"
								onChange={(v) => set("interval", Number(v))}
								error={errors.interval}
							/>
							<Field
								name="dueDate"
								label={t("dueDate")}
								value={draft.dueDate}
								type="date"
								onChange={(v) => set("dueDate", v)}
								error={errors.dueDate}
							/>
							<Field
								name="trialEndsAt"
								label={t("trialEndsAt")}
								value={draft.trialEndsAt}
								type="date"
								onChange={(v) => set("trialEndsAt", v)}
								error={errors.trialEndsAt}
							/>
							<Field
								name="discountAmount"
								label={t("discountAmount")}
								value={discount}
								type="number"
								onChange={setDiscount}
								error={errors.discountAmount}
							/>
							<Field
								name="discountUntil"
								label={t("discountUntil")}
								value={draft.discountUntil}
								type="date"
								onChange={(v) => set("discountUntil", v)}
								error={errors.discountUntil}
							/>
							<Field name="status" label={t("status")}>
								<select
									id="status"
									value={draft.status}
									onChange={(e) =>
										set("status", e.target.value as Asset["status"])
									}
								>
									{["active", "paused", "cancelled"].map((v) => (
										<option key={v} value={v}>
											{t(v)}
										</option>
									))}
								</select>
							</Field>
						</>
					)}
					{kind === "item" && (
						<>
							<Field
								name="amount"
								label={t("itemPurchasePrice")}
								value={amount}
								type="number"
								onChange={setAmount}
								error={errors.amount}
							/>
							<Field name="currency" label={t("currency")}>
								<select id="currency" value={draft.currency} onChange={(event) => set("currency", event.target.value as Asset["currency"])}>
									{["CNY", "USD", "EUR", "GBP", "JPY"].map((value) => <option key={value} value={value}>{value}</option>)}
								</select>
							</Field>
							<Field
								name="purchaseDate"
								label={t("purchaseDate")}
								value={draft.purchaseDate}
								type="date"
								onChange={(v) => set("purchaseDate", v)}
								error={errors.purchaseDate}
							/>
							<Field
								name="itemStartDate"
								label={t("itemStartDate")}
								value={draft.itemStartDate}
								type="date"
								onChange={(value) => set("itemStartDate", value)}
								error={errors.itemStartDate}
							/>
							<Field name="itemWarrantyStatus" label={t("itemWarrantyStatus")}>
								<select id="itemWarrantyStatus" value={draft.itemWarrantyStatus ?? ""} onChange={(event) => set("itemWarrantyStatus", event.target.value ? event.target.value as NonNullable<Asset["itemWarrantyStatus"]> : null)}>
									<option value="">{t("itemStatusUnrecorded")}</option>
									{["unverified", "inWarranty", "outOfWarranty", "notApplicable"].map((value) => <option key={value} value={value}>{t(`itemWarranty_${value}`)}</option>)}
								</select>
							</Field>
							<Field
								name="warrantyDate"
								label={t("warrantyDate")}
								value={draft.warrantyDate}
								type="date"
								onChange={(v) => set("warrantyDate", v)}
								error={errors.warrantyDate}
							/>
							<Field
								name="location"
								label={t("location")}
								value={draft.location}
								onChange={(v) => set("location", v)}
								error={errors.location}
							/>
						</>
					)}
					<Field
						name="tags"
						label={t("tags")}
						value={tagsInput}
						onChange={(value) => {
							setTagsInput(value);
							setErrors((previous) => ({ ...previous, tags: "" }));
						}}
						error={errors.tags}
					/>
				</div>
				{kind === "vault" && <p className="notice">{t("vaultHint")}</p>}
				<div className="field">
					<label htmlFor="longDescription">{t("longDescription")}</label>
					<textarea
						id="longDescription"
						rows={3}
						value={draft.longDescription}
						onChange={(e) => set("longDescription", e.target.value)}
						aria-invalid={!!errors.longDescription}
						aria-describedby={errors.longDescription ? "longDescription-error" : undefined}
					/>
					{errors.longDescription && <small id="longDescription-error" className="field-error">{errors.longDescription}</small>}
				</div>
				<div className="field">
					<label htmlFor="notes">{t("notes")}</label>
					<textarea
						id="notes"
						rows={3}
						value={draft.notes}
						onChange={(e) => set("notes", e.target.value)}
						aria-invalid={!!errors.notes}
						aria-describedby={errors.notes ? "notes-error" : undefined}
					/>
					{errors.notes && <small id="notes-error" className="field-error">{errors.notes}</small>}
				</div>
				{failure && (
					<p className="field-error" role="alert">
						{failure}
					</p>
				)}
				<div className="actions">
					<Button type="button" onClick={closeIfIdle} disabled={busy}>
						{t("cancel")}
					</Button>
					<Button type="submit" variant="primary" disabled={busy}>
						{busy ? t("loading") : t("save")}
					</Button>
				</div>
			</form>
		</Dialog>
	);
}

export function TaskEditor({
	assetId = "",
	mode = "simple",
	onClose,
}: {
	assetId?: string;
	mode?: "simple" | "maintenance";
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const [name, setName] = useState("");
	const [dueDate, setDueDate] = useState("");
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
			const normalizedName = name.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("en");
			const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedName));
			const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
			const dedupeKey = `manual:${assetId || "global"}:${hash}:${dueDate || "none"}`;
			await save("task", {
				...parsed.data,
				dedupeKey,
			});
			onClose();
		} catch (error) {
			setFailure(error instanceof Error && error.message === "task-duplicate" ? t("taskDuplicatePending") : t("error"));
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	if (mode === "maintenance") return <MaintenancePlanEditor onClose={onClose} />;
	return (
		<Dialog title={t("newTask")} onClose={closeIfIdle}>
			<form onSubmit={(e) => void submit(e)}>
				<div className="form-grid">
					<Field
						name="taskName"
						label={t("name")}
						value={name}
						onChange={(value) => { setName(value); setNameError(""); setFailure(""); }}
						error={nameError}
					/>
					<Field
						name="taskDue"
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
				<div className="field"><label htmlFor="maintenanceAsset">{t("maintenanceAsset")}</label><select id="maintenanceAsset" value={assetId} onChange={(event) => setAssetId(event.target.value)} required><option value="">{t("maintenanceSelectAsset")}</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {t(asset.kind)}</option>)}</select></div>
				<div className="field"><label htmlFor="maintenanceRule">{t("maintenanceRule")}</label><select id="maintenanceRule" value={mode} onChange={(event) => setMode(event.target.value as RepeatRule["mode"])}><option value="once">{t("maintenanceOnce")}</option><option value="fixed">{t("maintenanceFixed")}</option><option value="afterCompletion">{t("maintenanceAfterCompletion")}</option></select></div>
				<Field name="maintenanceDue" label={t("maintenanceDue")} type="date" value={dueDate} onChange={setDueDate} />
				{mode !== "once" && <><Field name="maintenanceEvery" label={t("maintenanceEvery")} type="number" value={every} onChange={setEvery} /><div className="field"><label htmlFor="maintenanceUnit">{t("maintenanceUnit")}</label><select id="maintenanceUnit" value={unit} onChange={(event) => setUnit(event.target.value as typeof unit)}>{(["day", "week", "month", "year"] as const).map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></div></>}
				<Field name="maintenanceLead" label={t("maintenanceLead")} type="number" value={leadDays} onChange={setLeadDays} />
				<Field name="maintenanceAmount" label={t("maintenanceAmount")} value={amount} onChange={setAmount} />
				<div className="field"><label htmlFor="maintenanceCurrency">{t("currency")}</label><select id="maintenanceCurrency" value={currency} onChange={(event) => setCurrency(event.target.value as typeof currency)}>{currencies.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
			</div>
			<p className="maintenance-estimate-note">{t("maintenanceEstimateOnly")}</p>
			{!assets.length && <p className="field-error">{t("maintenanceNoAssets")}</p>}
			{error && <p className="field-error" role="alert">{error}</p>}
			<div className="actions"><Button type="button" onClick={onClose} disabled={busy}>{t("cancel")}</Button><Button type="submit" variant="primary" disabled={busy || !assets.length}>{t("maintenanceCreate")}</Button></div>
		</form>
	</Dialog>;
}

type ImportCandidate = { asset: Asset; duplicate: boolean; invalid: boolean; selected: boolean };

function validateImportCandidates(candidates: ImportCandidate[], existing: Asset[]): ImportCandidate[] {
	const preceding: Asset[] = [];
	return candidates.map((candidate) => {
		const parsed = assetSchema.safeParse({ ...candidate.asset, name: candidate.asset.name.trim() });
		const invalid = !parsed.success;
		const duplicate = parsed.success && duplicates(parsed.data, [...existing, ...preceding]).length > 0;
		if (parsed.success) preceding.push(parsed.data);
		return {
			...candidate,
			invalid,
			duplicate,
			selected: candidate.selected || (!invalid && !duplicate && (candidate.invalid || candidate.duplicate)),
		};
	});
}
export function IntakeTools() {
	const { t } = useTranslation();
	const { data, notify } = useAppContext();
	const [mode, setMode] = useState<"url" | "image" | "csv" | "manual">("url");
	const [manualKind, setManualKind] = useState<AssetKind>("project");
	const [manualOpen, setManualOpen] = useState(false);
	const [photoAssetId, setPhotoAssetId] = useState("");
	const [photoFile, setPhotoFile] = useState<File | null>(null);
	const [photoPreview, setPhotoPreview] = useState("");
	const [photoBusy, setPhotoBusy] = useState(false);
	const photoInFlight = useRef(false);
	const photoFileInput = useRef<HTMLInputElement>(null);
	const restoreFileInput = useRef<HTMLInputElement>(null);
	const [password, setPassword] = useState("");
	const [restoreFile, setRestoreFile] = useState<File | null>(null);
	const [readyArchive, setReadyArchive] = useState<Uint8Array | null>(null);
	const [readyArchiveGeneration, setReadyArchiveGeneration] = useState<number | null>(null);
	const [readyArchiveOrigin, setReadyArchiveOrigin] = useState<"local" | "remote" | null>(null);
	const [archiveCount, setArchiveCount] = useState(0);
	const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
	const [candidateGeneration, setCandidateGeneration] = useState<number | null>(null);
	const [url, setUrl] = useState("");
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [inspecting, setInspecting] = useState(false);
	const importing = useRef(false);
	const previewExisting = useRef<Asset[]>([]);
	const restoring = useRef(false);
	const importGeneration = useRef(0);
	const restoreGeneration = useRef(0);
	const [readyDownload, setReadyDownload] = useState<{
		url: string;
		name: string;
	} | null>(null);
	const activeAssets = data.assets.filter(asset => !asset.deleted && asset.kind !== "vault");
	const recentAssets = [...activeAssets].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
	useEffect(() => {
		if (!photoFile) { setPhotoPreview(""); return; }
		const address = URL.createObjectURL(photoFile);
		setPhotoPreview(address);
		return () => URL.revokeObjectURL(address);
	}, [photoFile]);
	function changeMode(next: typeof mode) {
		if (importing.current) return;
		importGeneration.current++;
		setCandidates([]);
		setCandidateGeneration(null);
		setMessage("");
		setMode(next);
	}
	async function addPhoto() {
		const asset = activeAssets.find(item => item.id === photoAssetId);
		if (!asset || !photoFile || photoInFlight.current) return;
		photoInFlight.current = true;
		setPhotoBusy(true);
		let fileId = "";
		try {
			fileId = await putFile(photoFile);
			await saveAssetIfCurrent(asset, {
				...asset,
				attachments: [...asset.attachments, fileId],
				updatedAt: new Date().toISOString(),
			});
			setPhotoFile(null);
			if (photoFileInput.current) photoFileInput.current.value = "";
			notify(t("saved"));
		} catch (error) {
			if (fileId) await cleanupUnreferencedFile(fileId).catch(() => false);
			notify(t(error instanceof Error && error.message === "asset-stale" ? "assetStale" : "uploadError"));
		} finally {
			setPhotoBusy(false);
			photoInFlight.current = false;
		}
	}
	useEffect(() => {
		let active = true;
		void localRepository().then((repository) => {
			if (active && repository.restoreRecoveryError)
				setMessage((current) => current || t("restoreRecoveryPending"));
		}).catch(() => undefined);
		return () => { active = false; };
	}, [t]);
	useEffect(() => {
		return () => {
			if (readyDownload) URL.revokeObjectURL(readyDownload.url);
		};
	}, [readyDownload]);
	function invalidateRestorePreview() {
		const generation = ++restoreGeneration.current;
		setInspecting(false);
		setReadyArchive(null);
		setReadyArchiveGeneration(null);
		setReadyArchiveOrigin(null);
		setArchiveCount(0);
		setMessage("");
		return generation;
	}
	function acceptRemotePreview(archive: Uint8Array, count: number, generation: number) {
		if (generation !== restoreGeneration.current) return false;
		setReadyArchive(archive);
		setReadyArchiveGeneration(generation);
		setReadyArchiveOrigin("remote");
		setArchiveCount(count);
		return true;
	}
	async function download() {
		if (password.length < 12) {
			setMessage(t("backupPassword"));
			return;
		}
		setBusy(true);
		setReadyDownload(null);
		try {
			const plain = await exportArchive();
			const encrypted = await encryptBackup(plain, password);
			const blob = new Blob([encrypted as BlobPart], {
				type: "application/octet-stream",
			});
			const address = URL.createObjectURL(blob);
			setReadyDownload({
				url: address,
				name: `keepany-${new Date().toISOString().slice(0, 10)}.ka1`,
			});
			setMessage(t("backupReady"));
		} catch {
			setMessage(t("error"));
		} finally {
			setBusy(false);
		}
	}
	async function inspect() {
		if (!restoreFile || !password) return;
		const generation = ++restoreGeneration.current;
		setInspecting(true);
		setReadyArchive(null);
		setReadyArchiveGeneration(null);
		setReadyArchiveOrigin(null);
		setArchiveCount(0);
		try {
			const decrypted = await decryptBackup(
				new Uint8Array(await restoreFile.arrayBuffer()),
				password,
			);
			if (generation !== restoreGeneration.current) return;
			try {
				const result = await inspectArchive(decrypted);
				if (generation !== restoreGeneration.current) return;
				setReadyArchive(decrypted);
				setReadyArchiveGeneration(generation);
				setReadyArchiveOrigin("local");
				setArchiveCount(result.rows.length);
				setMessage(t("preview"));
			} catch {
				if (generation === restoreGeneration.current) setMessage(t("archiveInvalid"));
			}
		} catch {
			if (generation === restoreGeneration.current) setMessage(t("decryptError"));
		} finally {
			if (generation === restoreGeneration.current) setInspecting(false);
		}
	}
	async function restore() {
		if (restoring.current || !readyArchive || readyArchiveGeneration !== restoreGeneration.current) return;
		restoring.current = true;
		setBusy(true);
		try {
			const count = await restoreArchive(readyArchive);
			setMessage(t("restoreReady", { count }));
			setReadyArchive(null);
			setReadyArchiveGeneration(null);
			setReadyArchiveOrigin(null);
			setRestoreFile(null);
			if (restoreFileInput.current) restoreFileInput.current.value = "";
		} catch (error) {
			const key = error instanceof Error && error.message === "restore-conflict"
				? "restoreConflict"
				: error instanceof Error && error.message === "restore-recovery-pending"
					? "restoreRecoveryPending"
					: "error";
			setMessage(t(key));
		} finally {
			restoring.current = false;
			setBusy(false);
		}
	}
	async function parseCSV(file: File) {
		const generation = ++importGeneration.current;
		setMessage("");
		setCandidates([]);
		setCandidateGeneration(null);
		try {
			const text = await file.text();
			if (generation !== importGeneration.current) return;
			const result = Papa.parse<Record<string, string>>(text, {
				header: true,
				skipEmptyLines: true,
			});
			if (result.errors.length) throw Error("csv");
			const records = await allRecords();
			if (generation !== importGeneration.current) return;
			const existing = records
				.filter((r) => r.type === "asset")
				.map((r) => JSON.parse(r.payload) as Asset);
			const preview: ImportCandidate[] = [];
			for (const row of result.data.slice(0, 1000)) {
				if (
					!row.name?.trim() ||
					!["project", "account", "subscription", "item"].includes(row.kind)
				)
					continue;
				const asset = {
					...newAsset(row.kind as AssetKind),
					name: row.name.trim(),
					url: row.url?.trim() || "",
					category: row.category?.trim() || "",
					description: row.description?.trim() || "",
				};
				const parsed = assetSchema.safeParse(asset);
				if (parsed.success) {
					const duplicate =
						duplicates(parsed.data, [
							...existing,
							...preview.map((c) => c.asset),
						]).length > 0;
					preview.push({ asset: parsed.data, duplicate, invalid: false, selected: !duplicate });
				}
			}
			previewExisting.current = existing;
			setCandidates(preview);
			setCandidateGeneration(generation);
			setMessage(`${preview.length} ${t("preview")}`);
		} catch {
			if (generation === importGeneration.current) setMessage(t("error"));
		}
	}
	async function previewUrl() {
		const generation = ++importGeneration.current;
		setCandidates([]);
		setCandidateGeneration(null);
		try {
			const address = new URL(url);
			if (!["http:", "https:"].includes(address.protocol)) throw Error("url");
			const existing = (await allRecords())
				.filter((r) => r.type === "asset")
				.map((r) => JSON.parse(r.payload) as Asset);
			if (generation !== importGeneration.current) return;
			const asset = {
				...newAsset("project"),
				name: address.hostname,
				category: "website",
				url: address.toString(),
			};
			const duplicate = duplicates(asset, existing).length > 0;
			previewExisting.current = existing;
			setCandidates([{ asset, duplicate, invalid: false, selected: !duplicate }]);
			setCandidateGeneration(generation);
			setMessage(t("preview"));
		} catch {
			if (generation === importGeneration.current) setMessage(t("invalid"));
		}
	}
	async function importCandidates() {
		if (importing.current || candidateGeneration !== importGeneration.current) return;
		importing.current = true;
		setBusy(true);
		try {
			const requested = new Set(candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.asset.id));
			const existing = (await allRecords())
				.filter((row) => row.type === "asset")
				.map((row) => JSON.parse(row.payload) as Asset);
			if (candidateGeneration !== importGeneration.current) return;
			previewExisting.current = existing;
			const checked = validateImportCandidates(candidates, existing);
			setCandidates(checked);
			const blocked = checked.find((candidate) => requested.has(candidate.asset.id) && (candidate.invalid || candidate.duplicate));
			if (blocked) {
				setMessage(t(blocked.invalid ? "invalid" : "duplicate"));
				return;
			}
			const selected = checked.filter((candidate) => requested.has(candidate.asset.id));
			if (!selected.length) return;
			await saveBatch(selected.map((candidate) => ({
				type: "asset",
				value: { ...candidate.asset, name: candidate.asset.name.trim() },
			})));
			importGeneration.current++;
			setCandidates([]);
			setCandidateGeneration(null);
			setMessage(`${t("imported")} · ${selected.length}`);
		} catch {
			setMessage(t("error"));
		} finally {
			importing.current = false;
			setBusy(false);
		}
	}
	return (
		<div className="intake-tools">
			<div className="card-grid intake-primary-grid">
				<section className="card padded intake-quick-card">
					<div className="intake-card-title">
						<h2>{t("intakeQuickTitle")}</h2>
					</div>
					<fieldset className="tabs intake-mode-tabs">
						<legend>{t("intakeMode")}</legend>
						{([
							["url", "intakeModeUrl"],
							["image", "intakeModeImage"],
							["csv", "intakeModeCsv"],
							["manual", "intakeModeManual"],
						] as const).map(([value, key]) => (
							<button key={value} type="button" aria-pressed={mode === value} disabled={busy || inspecting} onClick={() => changeMode(value)}>
								{t(key)}
							</button>
						))}
					</fieldset>
					{mode === "url" && (
						<>
							<div className="field">
								<label htmlFor="import-url">{t("url")}</label>
								<input
									id="import-url"
									type="url"
									value={url}
									disabled={busy || inspecting}
									onChange={(event) => {
										importGeneration.current++;
										setUrl(event.target.value);
										setCandidates([]);
										setCandidateGeneration(null);
									}}
									placeholder="https://your-project.com"
								/>
							</div>
							<Button variant="primary" onClick={() => void previewUrl()} disabled={busy || inspecting || !url}>
								<Link2 size={16} />{t("intakePreviewRecords")}
							</Button>
						</>
					)}
					{mode === "csv" && (
						<>
							<p>{t("csvHint")}</p>
							<div className="field">
								<label htmlFor="csv-file">{t("csv")}</label>
								<input
									id="csv-file"
									type="file"
									accept=".csv,text/csv"
									disabled={busy || inspecting}
									onChange={(event) => {
										const file = event.target.files?.[0];
										importGeneration.current++;
										setCandidates([]);
										setCandidateGeneration(null);
										if (file) void parseCSV(file);
									}}
								/>
							</div>
						</>
					)}
					{mode === "manual" && (
						<>
							<div className="field">
								<label htmlFor="intake-manual-kind">{t("intakeRecordType")}</label>
								<select id="intake-manual-kind" value={manualKind} onChange={event => setManualKind(event.target.value as AssetKind)}>
									{(["project", "account", "subscription", "item"] as const).map(kind => <option key={kind} value={kind}>{t(kind)}</option>)}
								</select>
							</div>
							<Button variant="primary" onClick={() => setManualOpen(true)}>{t("newRecord")}</Button>
						</>
					)}
					{mode === "image" && (
						<>
							<p>{t("intakeImageHint")}</p>
							<div className="field">
								<label htmlFor="intake-photo-asset">{t("selectAsset")}</label>
								<select id="intake-photo-asset" value={photoAssetId} onChange={event => setPhotoAssetId(event.target.value)}>
									<option value="">{t("selectAsset")}</option>
									{activeAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
								</select>
							</div>
							{activeAssets.length === 0 && <div className="intake-photo-empty"><p>{t("intakePhotoNoAssets")}</p><Button onClick={() => { setManualKind("item"); setManualOpen(true); }}>{t("newRecord")}</Button></div>}
							<div className="field">
								<label htmlFor="intake-photo-file">{t("attachments")}</label>
								<input
									ref={photoFileInput}
									id="intake-photo-file"
									type="file"
									accept="image/jpeg,image/png,image/webp,image/gif"
									disabled={photoBusy}
									onChange={event => {
										const file = event.target.files?.[0] ?? null;
										if (file && (file.size > 20 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type))) {
											setPhotoFile(null);
											event.currentTarget.value = "";
											notify(t("uploadError"));
											return;
										}
										setPhotoFile(file);
									}}
								/>
							</div>
							{photoPreview && photoFile && <img className="image-preview" src={photoPreview} alt={photoFile.name} />}
							<Button variant="primary" disabled={photoBusy || !photoAssetId || !photoFile} onClick={() => void addPhoto()}>{t("addPhoto")}</Button>
						</>
					)}
					{candidates.length > 0 && (mode === "url" || mode === "csv") && (
						<div className="import-preview" aria-live="polite">
							<h3>{t("preview")}</h3>
							{candidates.map((candidate, index) => (
								<div className="list-row" key={candidate.asset.id}>
									<input
										type="checkbox"
										checked={candidate.selected}
										aria-label={`${t("select")} ${candidate.asset.name || index + 1}`}
										disabled={busy || ((candidate.duplicate || candidate.invalid) && !candidate.selected)}
										onChange={event => setCandidates(current => current.map(item =>
											item.asset.id === candidate.asset.id ? { ...item, selected: event.target.checked } : item
										))}
									/>
									<div style={{ gridColumn: 2, minWidth: 0 }}>
										<input
											aria-label={`${t("name")} ${index + 1}`}
											value={candidate.asset.name}
											aria-invalid={candidate.invalid}
											disabled={busy}
											style={{ width: "100%" }}
											onChange={event => {
												const name = event.target.value;
												setCandidates(current => validateImportCandidates(current.map(item =>
													item.asset.id === candidate.asset.id ? { ...item, asset: { ...item.asset, name } } : item
												), previewExisting.current));
											}}
										/>
										{candidate.invalid && <small className="field-error">{t(candidate.asset.name.trim() ? "invalid" : "required")}</small>}
									</div>
									<span className={`chip ${candidate.duplicate || candidate.invalid ? "warn" : ""}`}>{t(candidate.invalid ? "invalid" : candidate.duplicate ? "duplicate" : "ready")}</span>
								</div>
							))}
							<Button variant="primary" onClick={() => void importCandidates()} disabled={
								busy || inspecting || candidateGeneration !== importGeneration.current ||
				!candidates.some(candidate => candidate.selected) ||
				candidates.some(candidate => candidate.selected && (candidate.duplicate || candidate.invalid))
							}>{t("confirmImport")}</Button>
						</div>
					)}
				</section>
				<section className="card padded intake-backup-card">
					<div className="intake-card-title">
						<h2>{t("intakeBackupTitle")}</h2>
						<p>{t("backupHint")}</p>
					</div>
					<div className="chips">
						<span className="chip">{t("intakeBackupRecords")}</span>
						<span className="chip">{t("relations")}</span>
						<span className="chip">{t("intakeBackupFiles")}</span>
					</div>
					<div className="field">
						<label htmlFor="backup-password">{t("backupPassword")}</label>
						<input
							id="backup-password"
							type="password"
							minLength={12}
							autoComplete="new-password"
							disabled={busy}
							value={password}
							onChange={event => {
								invalidateRestorePreview();
								setPassword(event.target.value);
								setReadyDownload(null);
							}}
						/>
					</div>
					<small>{t("backupWarning")}</small>
					<div className="actions">
						<Button onClick={() => void download()} disabled={busy || inspecting || password.length < 12}>
							<Download size={16} />{t("backup")}
						</Button>
						{readyDownload && (
							<Button asChild variant="primary">
								<a href={readyDownload.url} download={readyDownload.name}><Download size={16} />{t("saveBackupFile")}</a>
							</Button>
						)}
					</div>
					<p className="intake-backup-status" role="status">{readyDownload ? t("backupReady") : t("intakeBackupIdle")}</p>
					<details className="intake-secondary">
						<summary>{t("restoreBackup")}</summary>
						<div className="field">
							<label htmlFor="restore-file">{t("restoreBackup")}</label>
							<input
								ref={restoreFileInput}
								id="restore-file"
								type="file"
								accept=".ka1"
								disabled={busy}
								onChange={event => {
									invalidateRestorePreview();
									setRestoreFile(event.target.files?.[0] || null);
									if (event.target.files?.length) event.currentTarget.closest("details")?.setAttribute("open", "");
								}}
							/>
						</div>
						<small>{t("restoreHint")}</small>
						<div className="actions">
							<Button onClick={() => void inspect()} disabled={busy || inspecting || !restoreFile || !password}>{t("preview")}</Button>
							{readyArchive && readyArchiveOrigin === "local" && (
								<Button variant="primary" onClick={() => void restore()} disabled={busy || inspecting || readyArchiveGeneration !== restoreGeneration.current}>
									{t("confirm")} · {archiveCount}
								</Button>
							)}
						</div>
					</details>
					<details className="intake-secondary">
						<summary>{t("intakeBackupLocation")}</summary>
						<RemoteBackupPanel
							password={password}
							busy={busy || inspecting}
							setBusy={setBusy}
							invalidatePreview={invalidateRestorePreview}
							acceptPreview={acceptRemotePreview}
							canConfirm={!!readyArchive && readyArchiveOrigin === "remote" && readyArchiveGeneration === restoreGeneration.current}
							restoreCount={archiveCount}
							confirmRestore={() => void restore()}
						/>
					</details>
				</section>
			</div>
			<section className="card intake-recent">
				<h2>{t("intakeRecent")}</h2>
				{recentAssets.length ? (
					<ul className="list">
						{recentAssets.map(asset => (
							<li className="list-row" key={asset.id}>
								<Link to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }}>{asset.name}</Link>
								<span>{t(asset.kind)}</span>
							</li>
						))}
					</ul>
				) : <p>{t("intakeRecentEmpty")}</p>}
			</section>
			<details className="card intake-secondary">
				<summary>{t("intakeExternalLinkImport")}</summary>
				<ExternalLinkImportPanel />
			</details>
			{message && <div className="notice" role="status">{message}</div>}
			{manualOpen && <AssetEditor kind={manualKind} categories={data.categories} onClose={() => setManualOpen(false)} />}
		</div>
	);
}

export function AiDialog({
	assets,
	onClose,
}: {
	assets: Asset[];
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const [endpoint, setEndpoint] = useState("");
	const [model, setModel] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [question, setQuestion] = useState("");
	const [selected, setSelected] = useState<string[]>([]);
	const [answer, setAnswer] = useState("");
	const [usage, setUsage] = useState<AiUsage | null>(null);
	const [returnedModel, setReturnedModel] = useState<string | null>(null);
	const [inputPrice, setInputPrice] = useState("");
	const [outputPrice, setOutputPrice] = useState("");
	const [priceCurrency, setPriceCurrency] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const requestGeneration = useRef(0);
	const requestAbort = useRef<AbortController | null>(null);
	const available = assets.filter((asset) => !asset.deleted);
	const chosen = available.filter((asset) => selected.includes(asset.id));
	const assetsFingerprint = JSON.stringify(
		available.map((asset) => [
			asset.id,
			asset.kind,
			asset.name,
			asset.description,
			asset.url,
			asset.dueDate,
			asset.amount,
			asset.currency,
		]),
	);
	const previousAssetsFingerprint = useRef(assetsFingerprint);
	const availableIds = useRef(new Set<string>());
	availableIds.current = new Set(available.map((asset) => asset.id));
	function invalidateRequest() {
		requestGeneration.current += 1;
		requestAbort.current?.abort();
		requestAbort.current = null;
		setBusy(false);
		setAnswer("");
		setUsage(null);
		setReturnedModel(null);
		setError("");
	}
	useEffect(() => {
		if (previousAssetsFingerprint.current === assetsFingerprint) return;
		previousAssetsFingerprint.current = assetsFingerprint;
		requestGeneration.current += 1;
		requestAbort.current?.abort();
		requestAbort.current = null;
		setBusy(false);
		setAnswer("");
		setUsage(null);
		setReturnedModel(null);
		setError("");
		setSelected((current) => {
			const next = current.filter((id) => availableIds.current.has(id));
			return next.length === current.length ? current : next;
		});
	}, [assetsFingerprint]);
	useEffect(
		() => () => {
			requestGeneration.current += 1;
			requestAbort.current?.abort();
		},
		[],
	);
	const allowed = useMemo(() => {
		try {
			const u = new URL(endpoint);
			return (
				u.protocol === "https:" ||
				(u.protocol === "http:" &&
					["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
			);
		} catch {
			return false;
		}
	}, [endpoint]);
	async function ask() {
		if (
			busy ||
			requestAbort.current ||
			!allowed ||
			!model.trim() ||
			!question.trim() ||
			chosen.length === 0
		)
			return;
		const generation = ++requestGeneration.current;
		const controller = new AbortController();
		requestAbort.current = controller;
		setBusy(true);
		setAnswer("");
		setUsage(null);
		setReturnedModel(null);
		setError("");
		try {
			const records = chosen.map((a) => ({
					kind: a.kind,
					name: a.name,
					description: a.description,
					url: a.url,
					dueDate: a.dueDate,
					amount: a.amount,
					currency: a.currency,
			}));
			const res = await fetch(endpoint, {
				method: "POST",
				credentials: "omit",
				redirect: "error",
				referrerPolicy: "no-referrer",
				headers: {
					"Content-Type": "application/json",
					...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
				},
				body: JSON.stringify({
					model: model.trim(),
					messages: [
						{
							role: "system",
							content:
								"Use only the supplied KeepAny records. If the answer is absent, say so.",
						},
						{
							role: "user",
							content: JSON.stringify({ records, question: question.trim() }),
						},
					],
				}),
				signal: controller.signal,
			});
			if (!res.ok) throw Error("remote");
			let parsed: unknown;
			try {
				parsed = await res.json();
			} catch {
				throw Error("invalid-response");
			}
			const body = parsed as {
				choices?: { message?: { content?: unknown } }[];
				model?: unknown;
			};
			const content = body?.choices?.[0]?.message?.content;
			if (typeof content !== "string" || !content.trim())
				throw Error("invalid-response");
			if (generation === requestGeneration.current) {
				setAnswer(content);
				setUsage(readAiUsage(parsed));
				setReturnedModel(typeof body.model === "string" && body.model.trim() ? body.model.trim() : null);
			}
		} catch (error) {
			if (generation === requestGeneration.current)
				setError(
					t(error instanceof Error && error.message === "invalid-response" ? "aiInvalidResponse" : "aiError"),
				);
		} finally {
			if (generation === requestGeneration.current) {
				requestAbort.current = null;
				setBusy(false);
			}
		}
	}
	const modelMismatch = Boolean(returnedModel && returnedModel !== model.trim());
	const estimate = usage && !modelMismatch
		? estimateAiCost(usage, inputPrice, outputPrice, priceCurrency)
		: null;
	return (
		<Dialog
			title={t("assistant")}
			onClose={() => {
				requestGeneration.current += 1;
				requestAbort.current?.abort();
				onClose();
			}}
		>
			<div className="notice ai-disclosure">{t("aiDisclosure")}</div>
			<div className="form-grid">
				<Field
					name="ai-endpoint"
					label={t("endpoint")}
					value={endpoint}
					onChange={(value) => {
						invalidateRequest();
						setEndpoint(value);
					}}
					error={endpoint && !allowed ? t("allowedEndpoint") : ""}
				/>
				<Field
					name="ai-model"
					label={t("model")}
					value={model}
					onChange={(value) => {
						invalidateRequest();
						setModel(value);
					}}
				/>
				<Field
					name="ai-key"
					label={t("apiKey")}
					type="password"
					autoComplete="off"
					value={apiKey}
					onChange={(value) => {
						invalidateRequest();
						setApiKey(value);
					}}
				/>
			</div>
			<fieldset className="field ai-selection">
				<legend className="field-label">{t("aiSelect")}</legend>
				<div className="select-list ai-select-list">
					{available.map((a) => (
						<label key={a.id}>
							<input
								type="checkbox"
								checked={selected.includes(a.id)}
								onChange={(e) => {
									invalidateRequest();
									setSelected((s) =>
										e.target.checked
											? [...s, a.id]
											: s.filter((id) => id !== a.id),
									);
								}}
							/>
							{a.name}
						</label>
					))}
				</div>
			</fieldset>
			<div className="field">
				<label htmlFor="ai-question">{t("question")}</label>
				<textarea
					className="ai-question"
					id="ai-question"
					value={question}
					onChange={(e) => {
						invalidateRequest();
						setQuestion(e.target.value);
					}}
					rows={2}
				/>
			</div>
			<div className="actions">
				<Button
					variant="primary"
					onClick={() => void ask()}
					disabled={
						busy || !allowed || !model.trim() || !question.trim() || !chosen.length
					}
				>
					<Sparkles size={16} />
					{busy ? t("aiBusy") : t("ask")}
				</Button>
			</div>
			<details className="ai-pricing">
				<summary>{t("aiPricing")}</summary>
				<p className="ai-price-hint">{t("aiPriceHint")}</p>
				<div className="form-grid">
					<Field name="ai-price-input" label={t("aiInputPrice")} value={inputPrice} onChange={setInputPrice} />
					<Field name="ai-price-output" label={t("aiOutputPrice")} value={outputPrice} onChange={setOutputPrice} />
					<Field name="ai-price-currency" label={t("aiPriceCurrency")} value={priceCurrency}
						onChange={(value) => setPriceCurrency(value.toUpperCase())} />
				</div>
			</details>
			{error && (
				<p className="field-error" role="alert">
					{error}
				</p>
			)}
			{answer && (
				<>
					<div className="notice ai-answer">
						<strong>{t("aiResponse")}</strong>
						<p>{answer}</p>
					</div>
					<div className="notice ai-cost">
						<strong>{t("aiUsageTitle")}</strong>
						<p>{t("aiInputTokens")}: {usage?.inputTokens === null || usage?.inputTokens === undefined ? t("aiUnknown") : usage.inputTokens.toLocaleString()}</p>
						<p>{t("aiOutputTokens")}: {usage?.outputTokens === null || usage?.outputTokens === undefined ? t("aiUnknown") : usage.outputTokens.toLocaleString()}</p>
						<p>{t("aiEstimatedCost")}: {estimate === null ? t("aiUnknown") : `${priceCurrency.trim()} ${Number(estimate.toPrecision(6))}`}</p>
						{modelMismatch && <p>{t("aiModelMismatch", { model: returnedModel })}</p>}
						<p>{t("aiCostBoundary")}</p>
					</div>
				</>
			)}
		</Dialog>
	);
}
