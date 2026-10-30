import { validateCaptureImage } from "./workflow-image";
import { Textarea } from "./components/ui/textarea";
import { Input } from "./components/ui/input";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Download, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { assetSchema, duplicates, newAsset, type Asset, type AssetKind } from "../../../packages/domain/src";
import { decryptBackup, encryptBackup, BACKUP_CONTAINER_MAX_BYTES } from "../../../packages/local-db/src/backup-crypto";
import { allRecords, exportArchive, inspectArchive, localRepository, putFile, cleanupUnreferencedFile, restoreArchive, save, saveAssetIfCurrent, saveBatch } from "../../../packages/local-db/src";
import { Button } from "./components/ui/button";
import { RestoreRecoveryPanel } from "./components/RestoreRecoveryPanel";
import { useAppContext } from "./view-shared";
import { Select, SelectOption } from "./components/ui/select";
import { readUrlMetadata } from "./intake-url";
import { isPdfFile } from "./ai-import-input";
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

export function IntakeTools({ onCsvStaged, section = "capture" }: { onCsvStaged: () => void; section?: "capture" | "backup" }) {
 const navigate = useNavigate();
 const [lastSaved, setLastSaved] = useState<Asset | null>(null);
	const { t } = useTranslation();
	const { data, notify, setPendingAccountName } = useAppContext();
	const [mode, setMode] = useState<"url" | "image" | "csv" | "manual">("url");
	const [manualKind, setManualKind] = useState<AssetKind>("project");
	const [manualName, setManualName] = useState("");
	const [photoAssetId, setPhotoAssetId] = useState("");
	const [photoFile, setPhotoFile] = useState<File | null>(null);
	const [photoName, setPhotoName] = useState("");
	const [photoPreview, setPhotoPreview] = useState("");
	const [photoBusy, setPhotoBusy] = useState(false);
	const photoInFlight = useRef(false);
	const photoFileInput = useRef<HTMLInputElement>(null);
	const restoreFileInput = useRef<HTMLInputElement>(null);
	const [password, setPassword] = useState("");
	const [restoreFile, setRestoreFile] = useState<File | null>(null);
	const [readyArchive, setReadyArchive] = useState<Uint8Array | null>(null);
	const [readyArchiveGeneration, setReadyArchiveGeneration] = useState<number | null>(null);
	const [archiveCount, setArchiveCount] = useState(0);
	const [archiveReviewCount, setArchiveReviewCount] = useState(0);
	const [archiveHasVault, setArchiveHasVault] = useState(false);
	const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
	const [candidateGeneration, setCandidateGeneration] = useState<number | null>(null);
	const [url, setUrl] = useState("");
	const [message, setMessage] = useState("");
	const [urlLoading, setUrlLoading] = useState(false);
	const urlRequest = useRef<AbortController | null>(null);
	useEffect(() => () => urlRequest.current?.abort(), []);
	const [busy, setBusy] = useState(false);
	const [csvBusy, setCsvBusy] = useState(false);
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
		urlRequest.current?.abort();
		setUrlLoading(false);
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
			await validateCaptureImage(photoFile);
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
	async function createPhotoItem() {
		if (!photoFile || photoInFlight.current) return;
		const name = photoName.trim();
		if (!name) { notify(t("required")); return; }
		photoInFlight.current = true;
		setPhotoBusy(true);
		let fileId = "";
		try {
			await validateCaptureImage(photoFile);
			const existing = (await allRecords())
				.filter((row) => row.type === "asset")
				.map((row) => JSON.parse(row.payload) as Asset);
			const candidate = { ...newAsset("item"), name };
			if (duplicates(candidate, existing).length) { notify(t("duplicate")); return; }
			fileId = await putFile(photoFile);
			await save("asset", assetSchema.parse({
				...candidate,
				attachments: [fileId],
				itemMedia: { coverId: fileId, detailIds: [], receiptIds: [] },
			}));
			setPhotoFile(null);
			setPhotoName("");
			if (photoFileInput.current) photoFileInput.current.value = "";
			notify(t("saved"));
		} catch {
			if (fileId) await cleanupUnreferencedFile(fileId).catch(() => false);
			notify(t("uploadError"));
		} finally {
			photoInFlight.current = false;
			setPhotoBusy(false);
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
		setArchiveCount(0);
		setArchiveReviewCount(0);
		setArchiveHasVault(false);
		setMessage("");
		return generation;
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
		setArchiveCount(0);
		setArchiveReviewCount(0);
		try {
			if (restoreFile.size > BACKUP_CONTAINER_MAX_BYTES) {
				setMessage(t("backupTooLarge"));
				return;
			}
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
				setArchiveReviewCount(result.intakeReview.length);
				setArchiveHasVault(!!result.passwordVault);
				setMessage(t("preview"));
			} catch {
				if (generation === restoreGeneration.current) setMessage(t("archiveInvalid"));
			}
		} catch (error) {
			if (generation === restoreGeneration.current)
				setMessage(t(error instanceof Error && error.message === "backup-size" ? "backupTooLarge" : "decryptError"));
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
			onCsvStaged();
			setMessage(t(archiveReviewCount ? "restoreReadyReview" : "restoreReady", { count, reviewCount: archiveReviewCount }));
			setReadyArchive(null);
			setReadyArchiveGeneration(null);
			setRestoreFile(null);
			if (restoreFileInput.current) restoreFileInput.current.value = "";
		} catch (error) {
			const key = error instanceof Error && error.message === "restore-vault-conflict"
				? "restoreVaultConflict"
				: error instanceof Error && error.message === "restore-conflict"
				? "restoreConflict"
				: error instanceof Error && error.message === "restore-source-identity"
					? "restoreSourceIdentity"
				: error instanceof Error && error.message === "restore-recovery-pending"
					? "restoreRecoveryPending"
					: "error";
			setMessage(t(key));
		} finally {
			restoring.current = false;
			setBusy(false);
		}
	}
	async function stageCSV(file: File) {
		setMessage("");
		if (isPdfFile(file)) { setMessage(t("pdfImportRemoved")); return; }
		setCsvBusy(true);
		try {
			const count = await (await import("./intake-csv")).stageCsvForReview(file);
			onCsvStaged();
			setMessage(t("reviewCsvStaged", { count }));
		} catch (error) {
			const reason = error instanceof Error ? error.message : "";
			setMessage(t(reason === "pdf" ? "pdfImportRemoved" : reason === "limit" ? "reviewCsvLimit" : reason === "invalid" ? "reviewCsvInvalid" : "error"));
		} finally {
			setCsvBusy(false);
		}
	}
	async function previewUrl() {
		const generation = ++importGeneration.current;
		urlRequest.current?.abort();
		const controller = new AbortController();
		urlRequest.current = controller;
		setUrlLoading(true);
		setMessage("");
		setCandidates([]);
		setCandidateGeneration(null);
		try {
			const address = new URL(url);
			if (!["http:", "https:"].includes(address.protocol) || address.username || address.password || url.length > 2048) throw Error("url");
			let metadata: { title: string; description: string } | null = null;
			try { metadata = await readUrlMetadata(address.toString(), { signal: controller.signal }); }
			catch { if (controller.signal.aborted) return; }
			const existing = (await allRecords())
				.filter((r) => r.type === "asset")
				.map((r) => JSON.parse(r.payload) as Asset);
			if (generation !== importGeneration.current) return;
			const asset = {
				...newAsset("project"),
				name: metadata?.title || address.hostname,
				description: metadata?.description ?? "",
				category: "website",
				url: address.toString(),
			};
			const duplicate = duplicates(asset, existing).length > 0;
			previewExisting.current = existing;
			setCandidates([{ asset, duplicate, invalid: false, selected: !duplicate }]);
			setCandidateGeneration(generation);
			setMessage(t(metadata ? "preview" : "intakeUrlMetadataFallback"));
		} catch {
			if (generation === importGeneration.current) setMessage(t("invalid"));
		} finally {
			if (generation === importGeneration.current) setUrlLoading(false);
		}
	}
	async function saveManual() {
    if (importing.current) return;
    const name = manualName.trim();
    if (!name) { setMessage(t("required")); return; }
    if (manualKind === "account") { setPendingAccountName?.(name); void navigate({ to: "/accounts", hash: "new-account" }); return; }
    importing.current = true; setBusy(true); setMessage("");
    try {
      const existing = (await allRecords()).filter(row => row.type === "asset").map(row => JSON.parse(row.payload) as Asset);
      const asset = assetSchema.parse({ ...newAsset(manualKind), name });
      if (duplicates(asset, existing).length) { setMessage(t("duplicate")); return; }
      await save("asset", asset);
      setLastSaved(asset); setManualName(""); setMessage(t("saved"));
    } catch { setMessage(t("error")); }
    finally { importing.current = false; setBusy(false); }
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
			<div className="intake-primary-grid">
				{section === "capture" && <section className="card padded intake-quick-card">
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
							<button key={value} type="button" aria-pressed={mode === value} disabled={busy || inspecting || csvBusy} onClick={() => changeMode(value)}>
								{t(key)}
							</button>
						))}
					</fieldset>
					{mode === "url" && (
						<>
							<div className="field">
								<label htmlFor="import-url">{t("url")}</label>
								<Input
									id="import-url"
									type="url"
									value={url}
									disabled={busy || inspecting}
									onChange={(event) => {
										urlRequest.current?.abort();
										setUrlLoading(false);
										importGeneration.current++;
										setUrl(event.target.value);
										setCandidates([]);
										setCandidateGeneration(null);
									}}
									placeholder="https://your-project.com"
								/>
							</div>
							<Button variant="primary" onClick={() => void previewUrl()} disabled={busy || inspecting || urlLoading || !url}>
								<Link2 size={16} />{t(urlLoading ? "loading" : "intakePreviewRecords")}
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
									disabled={busy || inspecting || csvBusy}
									onChange={(event) => {
										const file = event.target.files?.[0];
										event.currentTarget.value = "";
										if (file) void stageCSV(file);
									}}
								/>
							</div>
						</>
					)}
					{mode === "manual" && (
						<>
							<div className="field">
								<label htmlFor="intake-manual-name">{t("name")}</label>
								<Input id="intake-manual-name" value={manualName} maxLength={160} disabled={busy || inspecting} onChange={event => {
									importGeneration.current++;
									setManualName(event.target.value);
									setCandidates([]);
									setCandidateGeneration(null);
								}} />
							</div>
							<div className="field">
								<label htmlFor="intake-manual-kind">{t("intakeRecordType")}</label>
								<Select id="intake-manual-kind" value={manualKind} disabled={busy || inspecting} onValueChange={selectValue => {
									importGeneration.current++;
									setManualKind(selectValue as AssetKind);
									setCandidates([]);
									setCandidateGeneration(null);
								}}>
									{(["project", "account", "subscription", "item"] as const).map(kind => <SelectOption key={kind} value={kind}>{t(kind)}</SelectOption>)}
								</Select>
							</div>
							<Button variant="primary" onClick={() => void saveManual()} disabled={busy || inspecting || !manualName.trim()}>{t(manualKind === "account" ? "accountsWorkspace" : "save")}</Button>
						</>
					)}
					{mode === "image" && (
						<>
							<p>{t("intakeImageHint")}</p>
							<div className="field">
								<label htmlFor="intake-photo-asset">{t("selectAsset")}</label>
								<Select id="intake-photo-asset" value={photoAssetId} disabled={photoBusy} onValueChange={selectValue => setPhotoAssetId(selectValue)}>
									<SelectOption value="">{t("intakePhotoNewItem")}</SelectOption>
									{activeAssets.map(asset => <SelectOption key={asset.id} value={asset.id}>{asset.name}</SelectOption>)}
								</Select>
							</div>
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
										if (isPdfFile(file)) {
											setPhotoFile(null);
											setPhotoName("");
											event.currentTarget.value = "";
											setMessage(t("pdfImportRemoved"));
											return;
										}
										if (file && (file.size > 20 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type))) {
											setPhotoFile(null);
											event.currentTarget.value = "";
											notify(t("uploadError"));
											return;
										}
										setPhotoFile(file);
										setMessage("");
										setPhotoName(file ? (file.name.replace(/\.[^.]+$/, "").slice(0, 160) || file.name.slice(0, 160)) : "");
									}}
								/>
							</div>
							{photoPreview && photoFile && <img className="image-preview" src={photoPreview} alt={photoFile.name} />}
							{photoFile && !photoAssetId && <div className="field"><label htmlFor="intake-photo-name">{t("name")}</label><Input id="intake-photo-name" value={photoName} maxLength={160} disabled={photoBusy} onChange={event => setPhotoName(event.target.value)} /></div>}
							<Button variant="primary" disabled={photoBusy || !photoFile || (!photoAssetId && !photoName.trim())} onClick={() => void (photoAssetId ? addPhoto() : createPhotoItem())}>{t(photoAssetId ? "addPhoto" : "confirmImport")}</Button>
						</>
					)}
					{candidates.length > 0 && (mode === "url" || mode === "manual") && (
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
										<Input
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
										{mode === "url" && <>
											<label htmlFor={`url-description-${candidate.asset.id}`}>{t("description")}</label>
											<Textarea id={`url-description-${candidate.asset.id}`} value={candidate.asset.description} disabled={busy} maxLength={2000} onChange={event => {
												const description = event.target.value;
												setCandidates(current => validateImportCandidates(current.map(item => item.asset.id === candidate.asset.id ? { ...item, asset: { ...item.asset, description } } : item), previewExisting.current));
											}} />
											<small>{candidate.asset.url}</small>
										</>}
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
				</section>}
				{section === "backup" && <section className="card padded intake-backup-card">
					<div className="intake-card-title">
						<h2>{t("intakeBackupTitle")}</h2>
						<p>{t("backupHint")}</p>
					</div>
					<div className="chips">
						<span className="chip">{t("intakeBackupRecords")}</span>
						<span className="chip">{t("relations")}</span>
						<span className="chip">{t("intakeBackupFiles")}</span>
						<span className="chip">{t("intakeBackupReview")}</span>
					</div>
					<div className="field">
						<label htmlFor="backup-password">{t("backupPassword")}</label>
						<Input
							id="backup-password"
							type="password"
							aria-describedby="backup-password-hint"
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
						<small id="backup-password-hint">{t("backupWarning")}</small>
					</div>
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
					<RestoreRecoveryPanel />
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
						{readyArchive && <p role="status">{t("restorePreviewSummary", { count: archiveCount, reviewCount: archiveReviewCount })}</p>}
						{readyArchive && archiveHasVault && <p>{t("restoreContainsVault")}</p>}
						<div className="actions">
							<Button onClick={() => void inspect()} disabled={busy || inspecting || !restoreFile || !password}>{t("preview")}</Button>
              {readyArchive && <><Button variant="primary" onClick={() => void restore()} disabled={busy || inspecting || readyArchiveGeneration !== restoreGeneration.current}>{t("confirm")} · {archiveCount}</Button><Button disabled={busy || inspecting} onClick={() => invalidateRestorePreview()}>{t("cancel")}</Button></>}
						</div>
					</details>
				</section>}
			</div>
			{section === "capture" && <section className="card intake-recent">
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
			</section>}
			{lastSaved && <Link className="button" to="/assets/$kind/$id" params={{ kind: lastSaved.kind, id: lastSaved.id }}>{t("openSavedRecord")}</Link>}
			{message && <div className="notice" role="status">{message}</div>}
		</div>
	);
}
