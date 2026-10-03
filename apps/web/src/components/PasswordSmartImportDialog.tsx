import { Link } from "@tanstack/react-router";
import { Eye, EyeOff, Lock, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	VaultEntryDraft,
	VaultImportItem,
	VaultImportPreview,
} from "../../../../packages/password-vault/src";
import { acquireAiConnection, useAiConnection } from "../ai-settings-store";
import {
	buildVaultImportAiPreview,
	parseVaultImportText,
	requestVaultImportAiTitles,
	type VaultImportCandidate,
	type VaultImportResult,
} from "../vault-import-model";
import {
	createVaultMappedLines,
	parseVaultMappedLines,
	updateVaultMappedSource,
	type VaultMappedLine,
} from "../vault-import-mapping";
import { PasswordImportMapping } from "./PasswordImportMapping";
import { usePasswordVault } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { FilePicker } from "./ui/file-picker";
import { Select, SelectOption } from "./ui/select";
import { TextLink } from "./ui/text-link";
import "../password-smart-import.css";

type Issue = { lineNumber: number; code: string };
type Choice = {
	selected: boolean;
	action: "new" | "skip" | "update";
	targetId?: string;
};

function errorCopy(error: unknown) {
	const code = error instanceof Error ? error.message : "";
	if (code === "vault-stale") return "pwVaultConflict";
	if (code === "vault-locked") return "pwVaultLockedError";
	if (code === "vault-import-limit" || code === "vault-size")
		return "pwSmartLimit";
	return "pwSmartFailed";
}

export function PasswordSmartImportDialog({
	onClose,
	onSaved,
}: {
	onClose: () => void;
	onSaved: (message: string) => void;
}) {
	const { t } = useTranslation();
	const vault = usePasswordVault();
	const { connection, settings, revision: aiRevision } = useAiConnection();
	const [source, setSource] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [candidates, setCandidates] = useState<VaultImportCandidate[]>([]);
	const [issues, setIssues] = useState<Issue[]>([]);
	const [choices, setChoices] = useState<Record<string, Choice>>({});
	const [stage, setStage] = useState<"input" | "mapping" | "review" | "saved">(
		"input",
	);
	const [mappedLines, setMappedLines] = useState<VaultMappedLine[]>([]);
	const [busy, setBusy] = useState<"file" | "ai" | "save" | null>(null);
	const [message, setMessage] = useState("");
	const [receipt, setReceipt] = useState<{
		added: number;
		updated: number;
		skipped: number;
	} | null>(null);
	const running = useRef<"file" | "ai" | "save" | null>(null);
	const generation = useRef(0);
	const controller = useRef<AbortController | null>(null);
	const baseRevision = useRef<string | null>(null);
	const session = vault.session;

	useEffect(
		() => () => {
			generation.current++;
			controller.current?.abort();
		},
		[],
	);
	useEffect(() => {
		void aiRevision;
		if (running.current !== "ai") return;
		generation.current++;
		controller.current?.abort();
		running.current = null;
		setBusy(null);
		setMessage(t("pwSmartAiChanged"));
	}, [aiRevision, t]);
	useEffect(() => {
		if (vault.snapshot.status === "unlocked") return;
		generation.current++;
		controller.current?.abort();
		setSource("");
		setFile(null);
		setCandidates([]);
		setChoices({});
		setIssues([]);
		setMappedLines([]);
		onClose();
	}, [vault.snapshot.status, onClose]);

	const preview = useMemo(() => {
		void vault.snapshot.revision;
		if (!session || !candidates.length || vault.snapshot.status !== "unlocked")
			return null;
		try {
			return session.previewImport(candidates.map((row) => row.draft));
		} catch {
			return null;
		}
	}, [session, candidates, vault.snapshot.status, vault.snapshot.revision]);
	const aiPreview = useMemo(
		() => buildVaultImportAiPreview(candidates),
		[candidates],
	);
	const selected = candidates.filter(
		(row, index) =>
			choices[row.id]?.selected && preview?.rows[index]?.status !== "duplicate",
	);
	const outdated =
		stage === "review" && baseRevision.current !== vault.snapshot.revision;
	const invalid = candidates.some(
		(row) => !row.draft.title.trim() || !row.draft.password,
	);

	function close() {
		if (running.current === "save") return;
		generation.current++;
		controller.current?.abort();
		setSource("");
		setFile(null);
		setCandidates([]);
		setChoices({});
		setIssues([]);
		setMappedLines([]);
		onClose();
	}
	function resetInput(nextSource = source) {
		generation.current++;
		controller.current?.abort();
		running.current = null;
		setBusy(null);
		setMessage("");
		setCandidates([]);
		setChoices({});
		setIssues([]);
		setMappedLines([]);
		setStage("input");
		setSource(nextSource);
	}
	function recognize() {
		if (running.current || !session) return;
		setMessage("");
		try {
			showReview(parseVaultImportText(source));
		} catch (error) {
			setMessage(t(errorCopy(error)));
		}
	}
	function showReview(result: VaultImportResult) {
		if (!session) return;
		const plan = result.candidates.length
			? session.previewImport(result.candidates.map((row) => row.draft))
			: null;
		baseRevision.current = session.getSnapshot().revision;
		setCandidates(result.candidates);
		setIssues(result.issues);
		setChoices(
			Object.fromEntries(
				result.candidates.map((row, index) => [
					row.id,
					{
						selected: plan?.rows[index]?.status === "new" && !row.needsReview,
						action: plan?.rows[index]?.status === "new" ? "new" : "skip",
					},
				]),
			),
		);
		setStage("review");
		if (!result.candidates.length) setMessage(t("pwSmartNoRows"));
	}
	function startMapping() {
		if (running.current) return;
		try {
			if (!mappedLines.length) setMappedLines(createVaultMappedLines(source));
			setMessage("");
			setStage("mapping");
		} catch (error) {
			setMessage(t(errorCopy(error)));
		}
	}
	function reviewMapping() {
		if (running.current) return;
		setMessage("");
		try {
			showReview(parseVaultMappedLines(mappedLines));
			setSource(updateVaultMappedSource(source, mappedLines));
		} catch (error) {
			setMessage(t(errorCopy(error)));
		}
	}
	async function readFile(next: File | null) {
		if (running.current) return;
		resetInput("");
		setFile(next);
		if (!next) return;
		const current = ++generation.current;
		running.current = "file";
		setBusy("file");
		try {
			if (next.size > 2 * 1024 * 1024 || !/\.(csv|tsv|txt)$/i.test(next.name))
				throw Error("vault-import-limit");
			const text = new TextDecoder("utf-8", { fatal: true }).decode(
				await next.arrayBuffer(),
			);
			if (
				current === generation.current &&
				session?.getSnapshot().status === "unlocked"
			)
				setSource(text);
		} catch (error) {
			if (current === generation.current) setMessage(t(errorCopy(error)));
		} finally {
			if (current === generation.current) {
				running.current = null;
				setBusy(null);
			}
		}
	}
	async function organize() {
		if (
			running.current ||
			!connection ||
			!aiPreview.records.length ||
			outdated ||
			!session
		)
			return;
		running.current = "ai";
		setBusy("ai");
		setMessage("");
		const current = ++generation.current;
		const abort = new AbortController();
		controller.current = abort;
		let lease: ReturnType<typeof acquireAiConnection> | undefined;
		try {
			lease = acquireAiConnection(abort.signal);
			const rows = await requestVaultImportAiTitles(
				lease.connection,
				candidates,
				lease.signal,
			);
			if (
				current !== generation.current ||
				!lease.isCurrent() ||
				session.getSnapshot().status !== "unlocked" ||
				session.getSnapshot().revision !== baseRevision.current
			)
				return;
			setCandidates(rows);
			setMessage(t("pwSmartAiDone"));
		} catch {
			if (current === generation.current && !abort.signal.aborted)
				setMessage(t("pwSmartAiFailed"));
		} finally {
			lease?.release();
			if (current === generation.current) {
				running.current = null;
				setBusy(null);
				controller.current = null;
			}
		}
	}
	function updateDraft(
		id: string,
		field: keyof VaultEntryDraft,
		value: string,
	) {
		if (running.current) return;
		const rows = candidates.map((row) =>
			row.id === id
				? {
						...row,
						aiEligible: false,
						draft: { ...row.draft, [field]: value },
					}
				: row,
		);
		let nextPreview: VaultImportPreview | null = null;
		try {
			nextPreview =
				session?.previewImport(rows.map((row) => row.draft)) ?? null;
		} catch {
			/* Invalid edits must be corrected before any selection is accepted. */
		}
		setCandidates(rows);
		setChoices((current) =>
			Object.fromEntries(
				rows.map((row, index) => {
					const before = preview?.rows[index];
					const after = nextPreview?.rows[index];
					const changed =
						row.id === id ||
						!before ||
						!after ||
						before.status !== after.status ||
						JSON.stringify(before.existingIds) !==
							JSON.stringify(after.existingIds);
					return [
						row.id,
						changed
							? {
									selected: false,
									action: after?.status === "new" ? "new" : "skip",
								}
							: current[row.id],
					];
				}),
			),
		);
		setMessage("");
	}
	function choose(id: string, choice: Choice) {
		setChoices((current) => ({ ...current, [id]: choice }));
	}
	async function save() {
		if (
			running.current ||
			!session ||
			!preview ||
			!baseRevision.current ||
			outdated ||
			invalid ||
			!selected.length
		)
			return;
		running.current = "save";
		setBusy("save");
		setMessage("");
		const current = ++generation.current;
		try {
			const items: VaultImportItem[] = candidates.map((row, index) => {
				const choice = choices[row.id];
				const status = preview.rows[index]?.status;
				const action =
					!choice?.selected || status === "duplicate" ? "skip" : choice.action;
				return {
					draft: row.draft,
					action,
					...(action === "update" ? { targetId: choice?.targetId } : {}),
				};
			});
			const result = await session.importEntries(items, baseRevision.current);
			if (
				current !== generation.current ||
				session.getSnapshot().status !== "unlocked"
			)
				return;
			if (!issues.length) setSource("");
			setFile(null);
			setCandidates([]);
			setChoices({});
			setMappedLines([]);
			setReceipt(result);
			setStage("saved");
			onSaved(t("pwSmartSaved", result));
		} catch (error) {
			if (current === generation.current) setMessage(t(errorCopy(error)));
		} finally {
			if (current === generation.current) {
				running.current = null;
				setBusy(null);
			}
		}
	}

	return (
		<Dialog title={t("pwSmartTitle")} onClose={close}>
			<div className="password-smart-import">
				<p className="pw-smart-hint">{t("pwSmartHint")}</p>
				{message && (
					<p className="notice" role="status">
						{message}
					</p>
				)}
				{outdated && (
					<p className="notice" role="alert">
						{t("pwVaultConflict")}
					</p>
				)}
				{stage === "input" && (
					<>
						<label className="field" htmlFor="pw-smart-source">
							<span>{t("pwSmartSource")}</span>
							<textarea
								id="pw-smart-source"
								rows={8}
								value={source}
								onChange={(event) => {
									setSource(event.target.value);
									setFile(null);
									setMessage("");
								}}
								disabled={!!busy}
								autoComplete="off"
								spellCheck={false}
								placeholder={t("pwSmartPlaceholder")}
							/>
							<small>{t("pwSmartSyntax")}</small>
						</label>
						<FilePicker
							id="pw-smart-file"
							label={t("pwSmartFile")}
							chooseLabel={t("pwSmartChooseFile")}
							emptyLabel={t("pwSmartNoFile")}
							file={file}
							accept=".csv,.tsv,.txt,text/csv,text/plain"
							onFileChange={(next) => void readFile(next)}
							disabled={!!busy}
						/>
						<Button
							variant="primary"
							onClick={recognize}
							disabled={!!busy || !source.trim()}
						>
							<Sparkles size={16} />
							{t("pwSmartRecognize")}
						</Button>
						<Button onClick={startMapping} disabled={!!busy || !source.trim()}>
							{t("pwSmartMap")}
						</Button>
					</>
				)}
				{stage === "mapping" && (
					<PasswordImportMapping
						rows={mappedLines}
						onChange={setMappedLines}
						onReview={reviewMapping}
						onBack={() =>
							resetInput(updateVaultMappedSource(source, mappedLines))
						}
					/>
				)}
				{stage === "review" && (
					<>
						<p className="pw-smart-summary">
							{t("pwSmartReviewCount", { count: candidates.length })}
						</p>
						{issues.length > 0 && (
							<div className="pw-smart-issues" role="status">
								<strong>{t("pwSmartIssues")}</strong>
								<ul>
									{issues.map((issue) => (
										<li key={`${issue.lineNumber}-${issue.code}`}>
											{t("pwSmartIssueLine", { line: issue.lineNumber })} ·{" "}
											{t(`pwSmartIssue_${issue.code}`, {
												defaultValue: t("pwSmartIssueUnknown"),
											})}
										</li>
									))}
								</ul>
								<p>{t("pwSmartIssuesHint")}</p>
								<Button onClick={startMapping} disabled={!!busy}>
									{t("pwSmartMap")}
								</Button>
							</div>
						)}
						{candidates.length > 0 && (
							<>
								{candidates.some((row) => row.needsReview) && (
									<p className="notice">{t("pwSmartInferredHint")}</p>
								)}
								{aiPreview.records.length > 0 && (
									<div className="pw-smart-ai">
										<p>{t("pwSmartAiHint")}</p>
										<details>
											<summary>
												{t("pwSmartAiPreview", {
													count: aiPreview.records.length,
												})}
											</summary>
											<ul>
												{aiPreview.records.map((row) => (
													<li key={row.id}>
														{row.id} · {row.host}
													</li>
												))}
											</ul>
										</details>
										{connection ? (
											<Button
												onClick={() => void organize()}
												disabled={
													!!busy || outdated || !aiPreview.records.length
												}
											>
												<Sparkles size={16} />
												{t("pwSmartAiOrganize", { model: connection.model })}
											</Button>
										) : (
											<p>
												{t("pwSmartAiOptional")}{" "}
												<TextLink asChild>
													<Link to="/settings" hash="assistant" onClick={close}>
														{t(settings ? "aiEnableKey" : "aiConfigure")}
													</Link>
												</TextLink>
											</p>
										)}
									</div>
								)}
								<label className="pw-smart-check">
									<input
										type="checkbox"
										checked={
											preview?.rows.some((row) => row.status === "new") ===
												true &&
											preview.rows.every(
												(row, index) =>
													row.status !== "new" ||
													choices[candidates[index].id]?.selected === true,
											)
										}
										onChange={(event) => {
											const checked = event.target.checked;
											setChoices((current) =>
												Object.fromEntries(
													candidates.map((row, index) => [
														row.id,
														preview?.rows[index]?.status === "new"
															? { selected: checked, action: "new" }
															: current[row.id],
													]),
												),
											);
										}}
										disabled={!!busy || !preview || outdated}
									/>
									{t("pwSmartSelectNew")}
								</label>
								<div className="pw-smart-rows">
									{candidates.map((row, index) => (
										<ImportRow
											key={row.id}
											row={row}
											index={index}
											plan={preview}
											choice={
												choices[row.id] ?? { selected: false, action: "new" }
											}
											disabled={!!busy || outdated}
											onDraft={updateDraft}
											onChoice={choose}
											existing={vault.snapshot.entries}
										/>
									))}
								</div>
								{(!preview || invalid) && (
									<p className="notice" role="alert">
										{t("pwSmartInvalidRows")}
									</p>
								)}
							</>
						)}
						<div className="actions pw-smart-footer">
							<Button onClick={() => resetInput()} disabled={!!busy}>
								{t("pwSmartEditSource")}
							</Button>
							<Button
								variant="primary"
								onClick={() => void save()}
								disabled={
									!!busy || outdated || !preview || invalid || !selected.length
								}
							>
								{t("pwSmartConfirm", { count: selected.length })}
							</Button>
						</div>
					</>
				)}
				{stage === "saved" && receipt && (
					<p className="pw-smart-receipt" role="status">
						{t("pwSmartSaved", receipt)}
					</p>
				)}
				{stage === "saved" && issues.length > 0 && (
					<div className="pw-smart-issues">
						<p>{t("pwSmartRemaining")}</p>
						<Button onClick={() => resetInput()}>{t("pwSmartContinue")}</Button>
					</div>
				)}
				{busy && (
					<p role="status">
						{t(busy === "ai" ? "pwSmartAiBusy" : "pwVaultBusy")}
					</p>
				)}
				<div className="actions">
					<Button onClick={close} disabled={busy === "save"}>
						{t("pwVaultClose")}
					</Button>
					<Button
						variant="ghost"
						onClick={() => {
							vault.lock();
							close();
						}}
						disabled={busy === "save"}
					>
						<Lock size={15} />
						{t("pwSmartLockClose")}
					</Button>
				</div>
			</div>
		</Dialog>
	);
}

function ImportRow({
	row,
	index,
	plan,
	choice,
	disabled,
	onDraft,
	onChoice,
	existing,
}: {
	row: VaultImportCandidate;
	index: number;
	plan: VaultImportPreview | null;
	choice: Choice;
	disabled: boolean;
	onDraft: (id: string, field: keyof VaultEntryDraft, value: string) => void;
	onChoice: (id: string, choice: Choice) => void;
	existing: { id: string; title: string; username: string }[];
}) {
	const { t } = useTranslation();
	const [revealed, setRevealed] = useState(false);
	const multilinePassword = /[\r\n]/.test(row.draft.password);
	const status = plan?.rows[index]?.status;
	const ids = plan?.rows[index]?.existingIds ?? [];
	const fieldId = `pw-smart-${row.id}`;
	return (
		<article className="pw-smart-row" data-row-id={row.id}>
			<div className="pw-smart-row-header">
				<label className="pw-smart-check">
					<input
						type="checkbox"
						checked={choice.selected && status !== "duplicate"}
						disabled={
							disabled ||
							!status ||
							status === "duplicate" ||
							(status === "conflict" && choice.action === "skip")
						}
						onChange={(event) =>
							onChoice(row.id, {
								...choice,
								action: status === "new" ? "new" : choice.action,
								selected: event.target.checked,
							})
						}
					/>
					{t("pwSmartRow", { count: index + 1 })}
				</label>
				<span className="pw-smart-status">
					{t(`pwSmartStatus_${status ?? "invalid"}`)}
				</span>
			</div>
			<details open={index === 0}>
				<summary>{row.draft.title || t("pwVaultEntryNew")}</summary>
				<div className="pw-smart-fields">
					{(["title", "username", "url"] as const).map((field) => (
						<label
							className={`field pw-smart-field-${field}`}
							htmlFor={`${fieldId}-${field}`}
							key={field}
						>
							<span>
								{t(
									{
										title: "pwVaultTitleField",
										username: "pwVaultUsernameField",
										url: "pwVaultUrlField",
									}[field],
								)}
							</span>
							<input
								id={`${fieldId}-${field}`}
								value={row.draft[field]}
								onChange={(event) => onDraft(row.id, field, event.target.value)}
								disabled={disabled}
								autoComplete="off"
								spellCheck={false}
							/>
						</label>
					))}
					<label
						className="field pw-smart-field-password"
						htmlFor={`${fieldId}-password`}
					>
						<span>{t("pwVaultPasswordField")}</span>
						<div className="pw-smart-password">
							{multilinePassword ? (
								<textarea
									id={`${fieldId}-password`}
									value={revealed ? row.draft.password : "••••••••"}
									readOnly={!revealed}
									onChange={(event) =>
										onDraft(row.id, "password", event.target.value)
									}
									disabled={disabled}
									autoComplete="off"
									spellCheck={false}
									rows={3}
								/>
							) : (
								<input
									id={`${fieldId}-password`}
									value={row.draft.password}
									type={revealed ? "text" : "password"}
									onChange={(event) =>
										onDraft(row.id, "password", event.target.value)
									}
									disabled={disabled}
									autoComplete="new-password"
									spellCheck={false}
								/>
							)}
							<Button
								size="icon"
								variant="ghost"
								aria-label={t(
									revealed ? "pwVaultHidePassword" : "pwVaultShowPassword",
								)}
								onClick={() => setRevealed((value) => !value)}
								disabled={disabled}
							>
								{revealed ? <EyeOff size={16} /> : <Eye size={16} />}
							</Button>
						</div>
					</label>
					<label
						className="field pw-smart-field-notes"
						htmlFor={`${fieldId}-notes`}
					>
						<span>{t("pwVaultNotesField")}</span>
						<textarea
							id={`${fieldId}-notes`}
							value={row.draft.notes}
							onChange={(event) => onDraft(row.id, "notes", event.target.value)}
							disabled={disabled}
							autoComplete="off"
							spellCheck={false}
							rows={2}
						/>
					</label>
				</div>
			</details>
			{status === "conflict" && (
				<label className="field" htmlFor={`${fieldId}-action`}>
					<span>{t("pwSmartConflictHint")}</span>
					<Select
						id={`${fieldId}-action`}
						value={
							choice.action === "new"
								? "new"
								: choice.action === "update"
									? `update:${choice.targetId}`
									: "skip"
						}
						disabled={disabled}
						onValueChange={(value) =>
							onChoice(
								row.id,
								value === "skip"
									? { selected: false, action: "skip" }
									: value === "new"
										? { selected: true, action: "new" }
										: {
												selected: true,
												action: "update",
												targetId: value.slice(7),
											},
							)
						}
					>
						<SelectOption value="skip">{t("pwSmartKeepExisting")}</SelectOption>
						<SelectOption value="new">
							{t("pwSmartCreateSeparate")}
						</SelectOption>
						{ids.map((id) => (
							<SelectOption value={`update:${id}`} key={id}>
								{t("pwSmartUpdateExisting", {
									name: existing.find((entry) => entry.id === id)?.title ?? id,
								})}
							</SelectOption>
						))}
					</Select>
				</label>
			)}
		</article>
	);
}
