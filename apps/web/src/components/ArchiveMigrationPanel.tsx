import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	inspectArchive,
	localRepository,
	type ArchiveMergeChoice,
	type ArchiveMergePreview,
	type DatasetBinding,
	type PendingArchiveMerge,
} from "../../../../packages/local-db/src";
import { decryptBackup, encryptBackup } from "../../../../packages/local-db/src/backup-crypto";
import type { SyncReport } from "../../../../packages/sync-client/src";
import type { ReviewedCandidate } from "../../../../packages/local-db/src/intake-review";
import { Button } from "./ui/button";

interface Props {
	configurationKey: string;
	syncBusy: boolean;
	onBusyChange: (busy: boolean) => void;
	prepareTarget: () => Promise<DatasetBinding>;
	syncTarget: () => Promise<SyncReport | null>;
}

function brief(payload: string | null): string {
	if (!payload) return "—";
	try {
		const item = JSON.parse(payload) as Record<string, unknown>;
		for (const key of ["name", "title", "label", "description"]) {
			if (typeof item[key] === "string" && item[key]) return String(item[key]);
		}
		return typeof item.deleted === "boolean" && item.deleted ? "↳" : "#";
	} catch { return "#"; }
}

function changedFields(sourcePayload: string, targetPayload: string | null) {
	const source = JSON.parse(sourcePayload) as Record<string, unknown>;
	const target = JSON.parse(targetPayload ?? "{}") as Record<string, unknown>;
	return Object.keys({ ...source, ...target })
		.filter(key => JSON.stringify(source[key]) !== JSON.stringify(target[key]))
		.map(key => ({ key, source: source[key], target: target[key] }));
}

function fieldValue(value: unknown): string {
	if (value === undefined || value === null || value === "") return "—";
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}

const reviewStatusKey = (status: "pending" | "accepted" | "ignored") =>
	status === "pending" ? "reviewStatusPending" : status === "accepted" ? "reviewStatusAccepted" : "reviewStatusIgnored";

function reviewDifferences(source: ReviewedCandidate, target: ReviewedCandidate | null) {
	return [
		{ key: "migrationField_name", source: source.asset.name, target: target?.asset.name },
		{ key: "intakeRecordType", source: source.asset.kind, target: target?.asset.kind, translated: true },
		{ key: "migrationField_url", source: source.asset.url, target: target?.asset.url },
		{ key: "migrationField_description", source: source.asset.description, target: target?.asset.description },
		{ key: "reviewDecision", source: reviewStatusKey(source.status), target: target && reviewStatusKey(target.status), translated: true },
		{ key: "reviewKindChosen", source: source.kindSelected ? "reviewChosen" : "reviewNotChosen", target: target?.kindSelected ? "reviewChosen" : "reviewNotChosen", translated: true },
		{ key: "reviewSourceText", source: source.sourceText, target: target?.sourceText },
		{ key: "reviewFileName", source: source.fileName, target: target?.fileName },
	].filter(field => field.source !== field.target);
}

async function digest(bytes: Uint8Array): Promise<string> {
	return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)),
		value => value.toString(16).padStart(2, "0")).join("");
}

export function ArchiveMigrationPanel({ configurationKey, syncBusy, onBusyChange, prepareTarget, syncTarget }: Props) {
	const { t } = useTranslation();
	const [sourceFile, setSourceFile] = useState<File | null>(null);
	const [sourcePassword, setSourcePassword] = useState("");
	const [backupPassword, setBackupPassword] = useState("");
	const [backupFile, setBackupFile] = useState<File | null>(null);
	const [backupUrl, setBackupUrl] = useState<string | null>(null);
	const [target, setTarget] = useState<DatasetBinding | null>(null);
	const [sourceBinding, setSourceBinding] = useState<DatasetBinding | null>(null);
	const [legacySourceLabel, setLegacySourceLabel] = useState("");
	const [sourceAcknowledged, setSourceAcknowledged] = useState(false);
	const [sourceBytes, setSourceBytes] = useState<Uint8Array | null>(null);
	const [preview, setPreview] = useState<ArchiveMergePreview | null>(null);
	const [choices, setChoices] = useState<Record<string, ArchiveMergeChoice>>({});
	const [targetBackupHash, setTargetBackupHash] = useState<string | null>(null);
	const [backupVerified, setBackupVerified] = useState(false);
	const [pending, setPending] = useState<PendingArchiveMerge | null>(null);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const generation = useRef(0);
	const downloadUrl = useRef<string | null>(null);
	const running = useRef(false);

	const reset = () => {
		generation.current++;
		setTarget(null); setSourceBinding(null); setLegacySourceLabel(""); setSourceAcknowledged(false);
		setSourceBytes(null); setPreview(null); setChoices({});
		setTargetBackupHash(null); setBackupVerified(false); setBackupFile(null); setMessage("");
		if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
		downloadUrl.current = null;
		setBackupUrl(null);
	};
	useEffect(() => {
		void configurationKey;
		generation.current++;
		setTarget(null); setSourceBinding(null); setLegacySourceLabel(""); setSourceAcknowledged(false);
		setSourceBytes(null); setPreview(null); setChoices({});
		setTargetBackupHash(null); setBackupVerified(false); setBackupFile(null); setMessage("");
		if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
		downloadUrl.current = null; setBackupUrl(null);
		let current = true;
		void localRepository().then(repo => repo.pendingArchiveMerge())
			.then(value => { if (current) setPending(value); })
			.catch(() => { if (current) setMessage("migrationRecoveryError"); });
		return () => { current = false; generation.current++; if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current); };
	}, [configurationKey]);
	const doWork = async (action: () => Promise<void>) => {
		if (running.current || syncBusy) return;
		const startedGeneration = generation.current;
		running.current = true; setBusy(true); onBusyChange(true); setMessage("");
		try { await action(); }
		catch (error) {
			if (startedGeneration !== generation.current) return;
			const reason = error instanceof Error ? error.message : "migrationFailed";
			setMessage([
			"archive-merge-stale", "archive-merge-image-conflict", "archive-merge-recovery-pending",
			"archive-merge-choice", "archive-merge-pending", "archive-merge-sync-started",
			"archive-merge-rollback-conflict", "archive-merge-unbound",
			"archive-attachment-reference", "archive-references", "sync-dataset-bound",
			"restore-vault-conflict",
			"migrationTargetNotClean", "migrationTargetFailed", "migrationBackupMismatch",
			"migrationBackupPassword", "migrationBackupRequired", "migrationSourceInvalid",
			"migrationTargetChanged", "migrationSourceIdentity",
		].includes(reason) ? `migrationError_${reason}` : "migrationFailed");
		} finally { running.current = false; setBusy(false); onBusyChange(false); }
	};
	const refreshPending = async () => setPending(await (await localRepository()).pendingArchiveMerge());
	const previewSource = () => { reset(); void doWork(async () => {
		if (!sourceFile || !sourcePassword) throw Error("migrationSourceInvalid");
		const current = generation.current;
		const binding = await prepareTarget();
		if (current !== generation.current) return;
		const bytes = await decryptBackup(new Uint8Array(await sourceFile.arrayBuffer()), sourcePassword)
			.catch(() => { throw Error("migrationSourceInvalid"); });
		const inspected = await inspectArchive(bytes).catch(() => { throw Error("migrationSourceInvalid"); });
		const result = await (await localRepository()).previewArchiveMerge(bytes);
		if (current !== generation.current) return;
		setTarget(binding); setSourceBinding(inspected.manifest.sourceBinding ?? null);
		setSourceBytes(bytes); setPreview(result); setMessage("migrationPreviewReady");
	}); };
	const createBackup = () => void doWork(async () => {
		if (!target || !preview || !sourceBytes) throw Error("migrationTargetChanged");
		if (!sourceAcknowledged || (!sourceBinding && !legacySourceLabel.trim())) throw Error("migrationSourceIdentity");
		if (backupPassword.length < 12) throw Error("migrationBackupPassword");
		const currentGeneration = generation.current;
		const repo = await localRepository();
		const actual = await repo.getDatasetBinding();
		if (!actual || JSON.stringify(actual) !== JSON.stringify(target)) throw Error("migrationTargetChanged");
		const current = await repo.previewArchiveMerge(sourceBytes);
		if (current.targetFingerprint !== preview.targetFingerprint) throw Error("archive-merge-stale");
		const plain = await repo.exportArchive();
		const encrypted = await encryptBackup(plain, backupPassword);
		if (currentGeneration !== generation.current) return;
		const url = URL.createObjectURL(new Blob([encrypted as BlobPart], { type: "application/octet-stream" }));
		if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
		downloadUrl.current = url; setBackupUrl(url);
		setTargetBackupHash(await digest(plain)); setBackupVerified(false); setBackupFile(null);
		setMessage("migrationBackupReady");
	});
	const verifyBackup = () => void doWork(async () => {
		if (!backupFile || !targetBackupHash || !backupPassword) throw Error("migrationBackupRequired");
		const currentGeneration = generation.current;
		const plain = await decryptBackup(new Uint8Array(await backupFile.arrayBuffer()), backupPassword)
			.catch(() => { throw Error("migrationBackupMismatch"); });
		await inspectArchive(plain).catch(() => { throw Error("migrationBackupMismatch"); });
		if (await digest(plain) !== targetBackupHash) throw Error("migrationBackupMismatch");
		if (currentGeneration !== generation.current) return;
		setBackupVerified(true); setMessage("");
	});
	const apply = () => void doWork(async () => {
		if (!target || !preview || !sourceBytes || !backupVerified) throw Error("migrationBackupRequired");
		if (!sourceAcknowledged || (!sourceBinding && !legacySourceLabel.trim())) throw Error("migrationSourceIdentity");
		const conflicts = preview.rows.filter(row => row.status === "conflict");
		const reviewConflicts = preview.intakeReview.filter(row => row.status === "conflict");
		if ([...conflicts, ...reviewConflicts].some(row => !choices[row.id])) throw Error("archive-merge-choice");
		const verifiedTarget = await prepareTarget();
		if (JSON.stringify(verifiedTarget) !== JSON.stringify(target)) throw Error("migrationTargetChanged");
		const repo = await localRepository();
		const actual = await repo.getDatasetBinding();
		if (!actual || JSON.stringify(actual) !== JSON.stringify(target)) throw Error("migrationTargetChanged");
		await repo.applyArchiveMerge(sourceBytes, choices, preview.targetFingerprint);
		await refreshPending(); setMessage("migrationApplied");
	});
	const rollback = () => void doWork(async () => {
		await (await localRepository()).rollbackArchiveMerge();
		await refreshPending(); reset(); setMessage("migrationRolledBack");
	});
	const startSync = () => void doWork(async () => {
		const report = await syncTarget();
		await refreshPending();
		if (report?.status === "synced" && report.pending === 0) reset();
		setMessage(report?.status === "synced" && report.pending === 0 ? "migrationComplete" : "migrationRetry");
	});
	const conflicts = preview?.rows.filter(row => row.status === "conflict") ?? [];
	const reviewRows = preview?.intakeReview ?? [];
	const reviewConflicts = reviewRows.filter(row => row.status === "conflict");
	const unset = [...conflicts, ...reviewConflicts].filter(row => !choices[row.id]).length;
	return <section className="card padded migration-panel" aria-labelledby="migration-title">
		<h2 id="migration-title">{t("migrationTitle")}</h2>
		<p>{t("migrationHint")}</p>
		<p>{t("migrationProfiles")}</p>
		{pending ? <div className="migration-step" role="status">
			<h3>{t(`migrationPhase_${pending.phase}`)}</h3>
			<p>{t(pending.phase === "syncing" ? "migrationRetryHint" : "migrationRollbackHint")}</p>
			<p>{t("migrationChangedCount", { count: pending.changedRows })}</p>
			{pending.changedCandidates > 0 && <p>{t("migrationReviewChangedCount", { count: pending.changedCandidates })}</p>}
			<div className="actions">
				{pending.phase !== "syncing" && <Button disabled={busy || syncBusy} onClick={rollback}>{t("migrationRollback")}</Button>}
				{pending.phase === "applied" || pending.phase === "syncing" ? <Button disabled={busy || syncBusy} onClick={startSync}>{t(pending.phase === "syncing" ? "migrationRetrySync" : "migrationStartSync")}</Button> : null}
			</div>
		</div> : <>
			<div className="migration-step">
				<h3>{t("migrationSourceTitle")}</h3>
				<p>{t("migrationSourceHint")}</p>
				<div className="form-grid">
					<label className="field"><span>{t("migrationSourceFile")}</span><input type="file" accept=".ka1" disabled={busy || syncBusy} onChange={event => { reset(); setSourceFile(event.target.files?.[0] ?? null); }} /></label>
					<label className="field"><span>{t("migrationSourcePassword")}</span><input type="password" autoComplete="off" disabled={busy || syncBusy} value={sourcePassword} onChange={event => { reset(); setSourcePassword(event.target.value); }} /></label>
				</div>
				<Button disabled={busy || syncBusy || !sourceFile || !sourcePassword} onClick={previewSource}>{t("migrationCheckTarget")}</Button>
			</div>
			{target && preview && <>
				<div className="migration-step">
					<h3>{t("migrationTargetTitle")}</h3>
					<p>{t(sourceBinding ? "migrationSourceDeclared" : "migrationSourceUnverified")}</p>
					{sourceBinding ? <dl className="migration-identity"><dt>{t("syncServerUrl")}</dt><dd>{sourceBinding.endpoint}</dd><dt>{t("migrationSourceAccount")}</dt><dd>{sourceBinding.accountId}</dd><dt>{t("syncWorkspace")}</dt><dd>{sourceBinding.workspaceId}</dd></dl>
						: <label className="field"><span>{t("migrationLegacySourceLabel")}</span><input value={legacySourceLabel} disabled={busy || syncBusy} onChange={event => { setLegacySourceLabel(event.target.value); setSourceAcknowledged(false); }} autoComplete="off" /></label>}
					<label className="sync-key-check"><input type="checkbox" checked={sourceAcknowledged} disabled={busy || syncBusy} onChange={event => setSourceAcknowledged(event.target.checked)} />{t("migrationConfirmSource")}</label>
					<h4>{t("migrationTargetIdentity")}</h4>
					<dl className="migration-identity"><dt>{t("syncServerUrl")}</dt><dd>{target.endpoint}</dd><dt>{t("migrationTargetAccount")}</dt><dd>{target.accountId}</dd><dt>{t("syncWorkspace")}</dt><dd>{target.workspaceId}</dd></dl>
					<p>{t("migrationPreviewCount", { total: preview.rows.length, added: preview.rows.filter(row => row.status === "new").length, same: preview.rows.filter(row => row.status === "same").length, conflicts: conflicts.length })}</p>
					<p>{t("migrationLinksHint")}</p>
					{reviewRows.length > 0 && <>
						<p>{t("migrationReviewPreviewCount", { total: reviewRows.length, added: reviewRows.filter(row => row.status === "new").length, same: reviewRows.filter(row => row.status === "same").length, conflicts: reviewConflicts.length })}</p>
						<p>{t("migrationReviewBoundary")}</p>
					</>}
					{conflicts.length > 0 && <div className="migration-conflicts"><h4>{t("migrationConflictsTitle")}</h4>
						{conflicts.map(row => <fieldset key={row.id} className="migration-conflict">
							<legend>{t(`migrationType_${row.type}`)} · {row.id}</legend>
							<label><input type="radio" name={`merge-${row.id}`} checked={choices[row.id] === "source"} disabled={busy || syncBusy} onChange={() => setChoices(old => ({ ...old, [row.id]: "source" }))} />{t("migrationKeepSource")}: {brief(row.sourcePayload)}</label>
							<label><input type="radio" name={`merge-${row.id}`} checked={choices[row.id] === "target"} disabled={busy || syncBusy} onChange={() => setChoices(old => ({ ...old, [row.id]: "target" }))} />{t("migrationKeepTarget")}: {brief(row.targetPayload)}</label>
							<details><summary>{t("migrationShowDifferences")}</summary><div className="migration-field-differences">
								{changedFields(row.sourcePayload, row.targetPayload).map(field => <div key={field.key} className="migration-field-difference">
									<strong>{t(`migrationField_${field.key}`, { defaultValue: field.key })}</strong>
									<span>{t("migrationKeepSource")}: {fieldValue(field.source)}</span>
									<span>{t("migrationKeepTarget")}: {fieldValue(field.target)}</span>
								</div>)}
							</div></details>
						</fieldset>)}
					</div>}
					{reviewConflicts.length > 0 && <div className="migration-conflicts"><h4>{t("intakeBackupReview")}</h4>
						{reviewConflicts.map(row => <fieldset key={row.id} className="migration-conflict">
							<legend>{row.sourceCandidate.fileName} · {row.sourceCandidate.rowNumber}</legend>
							<label><input type="radio" name={`merge-${row.id}`} checked={choices[row.id] === "source"} disabled={busy || syncBusy} onChange={() => setChoices(old => ({ ...old, [row.id]: "source" }))} />{t("migrationKeepSource")}: {row.sourceCandidate.asset.name} · {t(reviewStatusKey(row.sourceCandidate.status))}</label>
							<label><input type="radio" name={`merge-${row.id}`} checked={choices[row.id] === "target"} disabled={busy || syncBusy} onChange={() => setChoices(old => ({ ...old, [row.id]: "target" }))} />{t("migrationKeepTarget")}: {row.targetCandidate?.asset.name} · {row.targetCandidate && t(reviewStatusKey(row.targetCandidate.status))}</label>
							<details><summary>{t("migrationShowDifferences")}</summary><div className="migration-field-differences">
								{reviewDifferences(row.sourceCandidate, row.targetCandidate).map(field => <div key={field.key} className="migration-field-difference">
									<strong>{t(field.key)}</strong>
									<span>{t("migrationKeepSource")}: {field.translated && field.source ? t(field.source) : fieldValue(field.source)}</span>
									<span>{t("migrationKeepTarget")}: {field.translated && field.target ? t(field.target) : fieldValue(field.target)}</span>
								</div>)}
							</div></details>
						</fieldset>)}
					</div>}
					{unset > 0 && <p role="status">{t("migrationChoicesRemaining", { count: unset })}</p>}
				</div>
				<div className="migration-step">
					<h3>{t("migrationBackupTitle")}</h3><p>{t("migrationBackupHint")}</p>
					<div className="form-grid">
						<label className="field"><span>{t("migrationBackupPassword")}</span><input type="password" autoComplete="new-password" disabled={busy || syncBusy} value={backupPassword} onChange={event => { setBackupPassword(event.target.value); setBackupVerified(false); setTargetBackupHash(null); setBackupFile(null); }} /></label>
						<label className="field"><span>{t("migrationVerifyFile")}</span><input type="file" accept=".ka1" disabled={busy || syncBusy} onChange={event => { setBackupFile(event.target.files?.[0] ?? null); setBackupVerified(false); }} /></label>
					</div>
					<div className="actions"><Button disabled={busy || syncBusy || backupPassword.length < 12 || !sourceAcknowledged || (!sourceBinding && !legacySourceLabel.trim())} onClick={createBackup}>{t("migrationCreateBackup")}</Button>
						{backupUrl && <a className="button" href={backupUrl} download={`stackperch-target-before-merge-${new Date().toISOString().slice(0, 10)}.ka1`}>{t("migrationDownloadBackup")}</a>}
						<Button disabled={busy || syncBusy || !backupFile || !targetBackupHash} onClick={verifyBackup}>{t("migrationVerifyBackup")}</Button></div>
					{backupVerified && <p role="status">{t("migrationBackupVerified")}</p>}
				</div>
				<div className="migration-step"><p>{t("migrationApplyHint")}</p><Button disabled={busy || syncBusy || !backupVerified || !sourceAcknowledged || (!sourceBinding && !legacySourceLabel.trim()) || unset > 0} onClick={apply}>{t("migrationApply")}</Button></div>
			</>}
		</>}
		{message && <p role={message.startsWith("migrationError_") || message === "migrationFailed" ? "alert" : "status"}>{t(message)}</p>}
	</section>;
}
