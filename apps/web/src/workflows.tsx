import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Download, FileUp, Link2, LockKeyhole, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	assetSchema,
	taskSchema,
	duplicates,
	inputFromMinorUnits,
	newAsset,
	parseMinorUnits,
	type Asset,
	type AssetKind,
	type Category,
} from "../../../packages/domain/src";
import {
	decryptBackup,
	encryptBackup,
} from "../../../packages/local-db/src/backup-crypto";
import {
	allRecords,
	exportArchive,
	inspectArchive,
	localRepository,
	restoreArchive,
	save,
	saveAssetIfCurrent,
	saveBatch,
} from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";

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
	error,
	children,
}: {
	label: string;
	name: string;
	value?: string | number;
	onChange?: (s: string) => void;
	type?: string;
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
		asset?.amount != null
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
	function set<K extends FieldName>(key: K, value: Asset[K]) {
		setDraft((prev) => ({ ...prev, [key]: value }));
		setErrors((prev) => ({ ...prev, [key]: "" }));
	}
	async function submit(e: React.FormEvent) {
		e.preventDefault();
		const parsedAmount = parseMinorUnits(amount, draft.currency);
		const parsedDiscount = parseMinorUnits(discount, draft.currency);
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
			setBusy(false);
		}
	}
	return (
		<Dialog title={asset ? t("edit") : t("newRecord")} onClose={onClose}>
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
								name="purchaseDate"
								label={t("purchaseDate")}
								value={draft.purchaseDate}
								type="date"
								onChange={(v) => set("purchaseDate", v)}
								error={errors.purchaseDate}
							/>
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
					<Button type="button" onClick={onClose}>
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
	onClose,
}: {
	assetId?: string;
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
	return (
		<Dialog title={t("newTask")} onClose={onClose}>
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
					<Button type="button" onClick={onClose} disabled={busy}>
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

type ImportCandidate = { asset: Asset; duplicate: boolean; selected: boolean };
export function IntakeTools() {
	const { t } = useTranslation();
	const restoreFileInput = useRef<HTMLInputElement>(null);
	const [password, setPassword] = useState("");
	const [restoreFile, setRestoreFile] = useState<File | null>(null);
	const [readyArchive, setReadyArchive] = useState<Uint8Array | null>(null);
	const [readyArchiveGeneration, setReadyArchiveGeneration] = useState<number | null>(null);
	const [archiveCount, setArchiveCount] = useState(0);
	const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
	const [candidateGeneration, setCandidateGeneration] = useState<number | null>(null);
	const [url, setUrl] = useState("");
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [inspecting, setInspecting] = useState(false);
	const importGeneration = useRef(0);
	const restoreGeneration = useRef(0);
	const [readyDownload, setReadyDownload] = useState<{
		url: string;
		name: string;
	} | null>(null);
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
		if (!readyArchive || readyArchiveGeneration !== restoreGeneration.current) return;
		setBusy(true);
		try {
			const count = await restoreArchive(readyArchive);
			setMessage(t("restoreReady", { count }));
			setReadyArchive(null);
			setReadyArchiveGeneration(null);
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
					preview.push({ asset: parsed.data, duplicate, selected: !duplicate });
				}
			}
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
			setCandidates([{ asset, duplicate, selected: !duplicate }]);
			setCandidateGeneration(generation);
			setMessage(t("preview"));
		} catch {
			if (generation === importGeneration.current) setMessage(t("invalid"));
		}
	}
	async function importCandidates() {
		if (candidateGeneration !== importGeneration.current) return;
		setBusy(true);
		try {
			const selected = candidates.filter((c) => c.selected && !c.duplicate);
			await saveBatch(selected.map((c) => ({ type: "asset", value: c.asset })));
			importGeneration.current++;
			setCandidates([]);
			setCandidateGeneration(null);
			setMessage(`${t("imported")} · ${selected.length}`);
		} catch {
			setMessage(t("error"));
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="card-grid">
			<section className="card padded">
				<div className="card-header">
					<h2>
						<LockKeyhole size={20} />
						{t("secureBackup")}
					</h2>
				</div>
				<p>{t("backupHint")}</p>
				<div className="field">
					<label htmlFor="backup-password">{t("backupPassword")}</label>
					<input
						id="backup-password"
						type="password"
						minLength={12}
						autoComplete="new-password"
						disabled={busy}
						value={password}
						onChange={(e) => {
							restoreGeneration.current++;
							setInspecting(false);
							setPassword(e.target.value);
							setReadyArchive(null);
							setReadyArchiveGeneration(null);
							setArchiveCount(0);
							setReadyDownload(null);
						}}
					/>
				</div>
				<small>{t("backupWarning")}</small>
				<div className="actions">
					<Button
						onClick={() => void download()}
						disabled={busy || inspecting || password.length < 12}
					>
						<Download size={16} />
						{t("backup")}
					</Button>
					{readyDownload && (
						<Button asChild variant="primary">
							<a href={readyDownload.url} download={readyDownload.name}>
								<Download size={16} />
								{t("saveBackupFile")}
							</a>
						</Button>
					)}
				</div>
				<div className="field">
					<label htmlFor="restore-file">{t("restoreBackup")}</label>
					<input
						ref={restoreFileInput}
						id="restore-file"
						type="file"
						accept=".ka1"
						disabled={busy}
						onChange={(e) => {
							restoreGeneration.current++;
							setInspecting(false);
							setRestoreFile(e.target.files?.[0] || null);
							setReadyArchive(null);
							setReadyArchiveGeneration(null);
							setArchiveCount(0);
						}}
					/>
				</div>
				<small>{t("restoreHint")}</small>
				<div className="actions">
					<Button
						onClick={() => void inspect()}
						disabled={busy || inspecting || !restoreFile || !password}
					>
						{t("preview")}
					</Button>
					{readyArchive && (
						<Button
							variant="primary"
							onClick={() => void restore()}
							disabled={busy || inspecting || readyArchiveGeneration !== restoreGeneration.current}
						>
							{t("confirm")} · {archiveCount}
						</Button>
					)}
				</div>
			</section>
			<section className="card padded">
				<div className="card-header">
					<h2>
						<FileUp size={20} />
						{t("confirmImport")}
					</h2>
				</div>
				<p>{t("csvHint")}</p>
				<div className="field">
					<label htmlFor="csv-file">{t("csv")}</label>
					<input
						id="csv-file"
						type="file"
						accept=".csv,text/csv"
						disabled={busy || inspecting}
						onChange={(e) => {
							const file = e.target.files?.[0];
							importGeneration.current++;
							setCandidates([]);
							setCandidateGeneration(null);
							if (file) void parseCSV(file);
						}}
					/>
				</div>
				<div className="field">
					<label htmlFor="import-url">{t("url")}</label>
					<input
						id="import-url"
						type="url"
						value={url}
						disabled={busy || inspecting}
						onChange={(e) => {
							importGeneration.current++;
							setUrl(e.target.value);
							setCandidates([]);
							setCandidateGeneration(null);
					}}
						placeholder="https://"
					/>
				</div>
				<Button onClick={() => void previewUrl()} disabled={busy || inspecting || !url}>
					<Link2 size={16} />
					{t("preview")}
				</Button>
				{candidates.length > 0 && (
					<div className="import-preview">
						<h3>{t("preview")}</h3>
						{candidates.map((c) => (
							<label className="list-row" key={c.asset.id}>
								<input
									type="checkbox"
									checked={c.selected}
									disabled={c.duplicate}
									onChange={(e) =>
										setCandidates((current) =>
											current.map((item) =>
												item.asset.id === c.asset.id
													? { ...item, selected: e.target.checked }
													: item,
											),
										)
									}
								/>
								<strong>{c.asset.name}</strong>
								<span className={`chip ${c.duplicate ? "warn" : ""}`}>
									{t(c.duplicate ? "duplicate" : "ready")}
								</span>
							</label>
						))}
						<Button
							variant="primary"
							onClick={() => void importCandidates()}
							disabled={
								busy || inspecting || candidateGeneration !== importGeneration.current ||
								!candidates.some((c) => c.selected && !c.duplicate)
							}
						>
							{t("confirmImport")}
						</Button>
					</div>
				)}
			</section>
			{message && (
				<div className="notice" role="status">
					{message}
				</div>
			)}
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
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
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
		if (!allowed || !model.trim() || !question.trim() || selected.length === 0)
			return;
		setBusy(true);
		setAnswer("");
		setError("");
		try {
			const chosen = assets
				.filter((a) => selected.includes(a.id))
				.map((a) => ({
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
				headers: {
					"Content-Type": "application/json",
					...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
				},
				body: JSON.stringify({
					model,
					messages: [
						{
							role: "system",
							content:
								"Use only the supplied KeepAny records. If the answer is absent, say so.",
						},
						{
							role: "user",
							content: JSON.stringify({ records: chosen, question }),
						},
					],
				}),
			});
			if (!res.ok) throw Error("remote");
			const body = (await res.json()) as {
				choices?: { message?: { content?: string } }[];
			};
			setAnswer(body.choices?.[0]?.message?.content || t("noMatches"));
		} catch {
			setError(t("aiError"));
		} finally {
			setBusy(false);
		}
	}
	return (
		<Dialog title={t("assistant")} onClose={onClose}>
			<div className="notice">{t("aiDisclosure")}</div>
			<div className="form-grid">
				<Field
					name="ai-endpoint"
					label={t("endpoint")}
					value={endpoint}
					onChange={setEndpoint}
					error={endpoint && !allowed ? t("allowedEndpoint") : ""}
				/>
				<Field
					name="ai-model"
					label={t("model")}
					value={model}
					onChange={setModel}
				/>
				<Field
					name="ai-key"
					label={t("apiKey")}
					type="password"
					value={apiKey}
					onChange={setApiKey}
				/>
			</div>
			<div className="field">
				<div className="field-label">{t("aiSelect")}</div>
				<div className="select-list">
					{assets.map((a) => (
						<label key={a.id}>
							<input
								type="checkbox"
								checked={selected.includes(a.id)}
								onChange={(e) =>
									setSelected((s) =>
										e.target.checked
											? [...s, a.id]
											: s.filter((id) => id !== a.id),
									)
								}
							/>
							{a.name}
						</label>
					))}
				</div>
			</div>
			<div className="field">
				<label htmlFor="ai-question">{t("question")}</label>
				<textarea
					id="ai-question"
					value={question}
					onChange={(e) => setQuestion(e.target.value)}
					rows={3}
				/>
			</div>
			<div className="actions">
				<Button
					variant="primary"
					onClick={() => void ask()}
					disabled={busy || !allowed || !model || !question || !selected.length}
				>
					<Sparkles size={16} />
					{busy ? t("aiBusy") : t("ask")}
				</Button>
			</div>
			{error && (
				<p className="field-error" role="alert">
					{error}
				</p>
			)}
			{answer && (
				<div className="notice">
					<strong>{t("aiResponse")}</strong>
					<p>{answer}</p>
				</div>
			)}
		</Dialog>
	);
}
