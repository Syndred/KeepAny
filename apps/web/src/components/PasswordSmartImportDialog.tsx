import { Link } from "@tanstack/react-router";
import { Eye, EyeOff, Lock, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	VaultEntryDraft,
	VaultImportItem,
	VaultImportPreviewRow,
	VaultSession,
} from "../../../../packages/password-vault/src";
import { acquireAiConnection, useAiConnection } from "../ai-settings-store";
import { requestVaultImportAiRecognition } from "../vault-import-ai";
import {
	createVaultMappedLines,
	parseVaultMappedLines,
	updateVaultMappedSource,
	type VaultMappedLine,
} from "../vault-import-mapping";
import {
	buildVaultImportAiPreview,
	parseVaultImportText,
	requestVaultImportAiTitles,
	type VaultImportCandidate,
	type VaultImportIssue,
	type VaultImportResult,
	validateVaultImportFields,
} from "../vault-import-model";
import {
	buildVaultImportSourceExcerpt,
	groupVaultImportIssues,
} from "../vault-import-source";
import { PasswordImportMapping } from "./PasswordImportMapping";
import { usePasswordVault } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { FilePicker } from "./ui/file-picker";
import { Select, SelectOption } from "./ui/select";
import { TextLink } from "./ui/text-link";
import { VaultImportSourceExcerpt } from "./VaultImportSourceExcerpt";
import "../password-smart-import.css";

type Choice = {
	selected: boolean;
	action: "new" | "skip" | "update";
	targetId?: string;
};
type ReviewOrigin =
	| { kind: "local" | "manual" }
	| { kind: "ai"; model: string; endpoint: string };
type ReviewPreview = {
	revision: string;
	rows: (VaultImportPreviewRow | undefined)[];
};

function previewCandidates(
	session: VaultSession,
	candidates: VaultImportCandidate[],
): ReviewPreview | null {
	let indexes = candidates.flatMap((row, index) =>
		row.draft.title.trim() && row.draft.password ? [index] : [],
	);
	try {
		let plan: ReturnType<VaultSession["previewImport"]>;
		try {
			plan = session.previewImport(
				indexes.map((index) => candidates[index].draft),
			);
		} catch {
			// One invalid edit must not prevent other entries from being reviewed.
			indexes = indexes.filter((index) => {
				try {
					session.previewImport([candidates[index].draft]);
					return true;
				} catch {
					return false;
				}
			});
			plan = session.previewImport(
				indexes.map((index) => candidates[index].draft),
			);
		}
		const rows: ReviewPreview["rows"] = Array.from({
			length: candidates.length,
		});
		for (const [index, row] of plan.rows.entries()) {
			rows[indexes[index]] = { ...row, index: indexes[index] };
		}
		return { revision: plan.revision, rows };
	} catch {
		return null;
	}
}

function currentRowIssues(
	row: VaultImportCandidate,
	valid: boolean,
): VaultImportIssue[] {
	const codes = new Set(
		validateVaultImportFields(row.draft).issues.map((issue) => issue.code),
	);
	if (!row.draft.title.trim()) codes.add("missing-identity");
	if (!valid && !codes.size) codes.add("invalid-field");
	return [...codes].map((code) => ({
		code,
		lineNumber:
			row.reviewIssues?.find((issue) => issue.code === code)?.lineNumber ??
			row.sourceLine,
	}));
}

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
	const {
		connection,
		settings,
		revision: aiRevision,
		activateVaultKey,
	} = useAiConnection();
	const [source, setSource] = useState("");
	const [reviewSource, setReviewSource] = useState("");
	const [editingSource, setEditingSource] = useState(false);
	const [sourceSelection, setSourceSelection] = useState<{
		start: number;
		end: number;
	} | null>(null);
	const sourceInput = useRef<HTMLTextAreaElement | null>(null);
	const [file, setFile] = useState<File | null>(null);
	const [candidates, setCandidates] = useState<VaultImportCandidate[]>([]);
	const [issues, setIssues] = useState<VaultImportIssue[]>([]);
	const [choices, setChoices] = useState<Record<string, Choice>>({});
	const [stage, setStage] = useState<"input" | "mapping" | "review" | "saved">(
		"input",
	);
	const [mappedLines, setMappedLines] = useState<VaultMappedLine[]>([]);
	const [busy, setBusy] = useState<"file" | "ai" | "save" | null>(null);
	const [aiMode, setAiMode] = useState<"recognize" | "titles">("recognize");
	const [reviewOrigin, setReviewOrigin] = useState<ReviewOrigin>({
		kind: "local",
	});
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
		setReviewSource("");
		setSourceSelection(null);
		setFile(null);
		setCandidates([]);
		setChoices({});
		setIssues([]);
		setMappedLines([]);
		onClose();
	}, [vault.snapshot.status, onClose]);
	useEffect(() => {
		if (stage !== "input" || !sourceSelection || !sourceInput.current) return;
		const input = sourceInput.current;
		input.focus();
		input.setSelectionRange(
			source.slice(0, sourceSelection.start).replace(/\r\n?/g, "\n").length,
			source.slice(0, sourceSelection.end).replace(/\r\n?/g, "\n").length,
		);
		const before = source.slice(0, sourceSelection.start);
		const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight);
		input.scrollTop = Math.max(
			0,
			before.split(/\r\n|\r|\n/).length * (lineHeight || 22) -
				input.clientHeight / 3,
		);
	}, [stage, sourceSelection, source]);

	const preview = useMemo(() => {
		void vault.snapshot.revision;
		if (!session || !candidates.length || vault.snapshot.status !== "unlocked")
			return null;
		return previewCandidates(session, candidates);
	}, [session, candidates, vault.snapshot.status, vault.snapshot.revision]);
	const aiPreview = useMemo(
		() => buildVaultImportAiPreview(candidates),
		[candidates],
	);
	const issueGroups = useMemo(
		() =>
			groupVaultImportIssues(issues).map((group) => ({
				issues: group,
				excerpt: buildVaultImportSourceExcerpt(
					reviewSource,
					group.map((issue) => issue.lineNumber),
					candidates,
				),
			})),
		[issues, reviewSource, candidates],
	);
	const selected = candidates.filter((row, index) => {
		const choice = choices[row.id];
		const plan = preview?.rows[index];
		return (
			choice?.selected &&
			plan &&
			plan.status !== "duplicate" &&
			(choice.action === "new" ||
				(choice.action === "update" &&
					plan.status === "conflict" &&
					plan.existingIds.includes(choice.targetId ?? "")))
		);
	});
	const completeCount = preview?.rows.filter(Boolean).length ?? 0;
	const pendingCount = candidates.length - completeCount;
	const outdated =
		stage === "review" && baseRevision.current !== vault.snapshot.revision;

	function close() {
		if (running.current === "save") return;
		generation.current++;
		controller.current?.abort();
		setSource("");
		setReviewSource("");
		setSourceSelection(null);
		setFile(null);
		setCandidates([]);
		setChoices({});
		setIssues([]);
		setMappedLines([]);
		setReceipt(null);
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
		setReceipt(null);
		setStage("input");
		setSource(nextSource);
		setReviewSource("");
		setEditingSource(false);
		setSourceSelection(null);
	}
	function editSource(selection?: { start: number; end: number }) {
		if (running.current) return;
		let nextSelection = selection ?? null;
		if (selection && source !== reviewSource) {
			const original = reviewSource.slice(selection.start, selection.end);
			const start = original ? source.indexOf(original) : -1;
			nextSelection =
				start >= 0 && source.indexOf(original, start + 1) === -1
					? { start, end: start + original.length }
					: null;
		}
		setSourceSelection(nextSelection);
		setEditingSource(true);
		setMessage("");
		setStage("input");
	}
	function recognize() {
		if (running.current || !session) return;
		setMessage("");
		try {
			showReview(parseVaultImportText(source), { kind: "local" });
		} catch (error) {
			setMessage(t(errorCopy(error)));
		}
	}
	function activateModel() {
		if (running.current) return;
		try {
			activateVaultKey();
			setMessage(t("aiSettingsVaultActivated"));
		} catch {
			setMessage(t("pwSmartAiKeyFailed"));
		}
	}
	async function recognizeWithAi() {
		if (running.current || !connection || !source.trim() || !session) return;
		const startingRevision = session.getSnapshot().revision;
		running.current = "ai";
		setAiMode("recognize");
		setBusy("ai");
		setMessage("");
		const current = ++generation.current;
		const abort = new AbortController();
		controller.current = abort;
		let lease: ReturnType<typeof acquireAiConnection> | undefined;
		try {
			lease = acquireAiConnection(abort.signal);
			const result = await requestVaultImportAiRecognition(
				lease.connection,
				source,
				lease.signal,
			);
			if (
				current !== generation.current ||
				!lease.isCurrent() ||
				session.getSnapshot().status !== "unlocked"
			)
				return;
			if (session.getSnapshot().revision !== startingRevision) {
				setMessage(t("pwVaultConflict"));
				return;
			}
			showReview(result, {
				kind: "ai",
				model: lease.connection.model,
				endpoint: lease.connection.baseURL,
			});
		} catch (error) {
			if (current === generation.current && !abort.signal.aborted) {
				setMessage(
					t(
						error instanceof Error && error.message === "vault-import-ai-limit"
							? "pwSmartAiLimit"
							: "pwSmartAiRecognitionFailed",
					),
				);
			}
		} finally {
			lease?.release();
			if (current === generation.current) {
				running.current = null;
				setBusy(null);
				controller.current = null;
			}
		}
	}
	function showReview(
		result: VaultImportResult,
		origin: ReviewOrigin,
		resultSource = source,
	) {
		if (!session) return;
		const plan = previewCandidates(session, result.candidates);
		baseRevision.current = session.getSnapshot().revision;
		setCandidates(result.candidates);
		setIssues(result.issues);
		setReviewOrigin(origin);
		setReviewSource(resultSource);
		setEditingSource(false);
		setSourceSelection(null);
		setReceipt(null);
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
			if (stage === "review") setEditingSource(true);
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
			const nextSource = updateVaultMappedSource(source, mappedLines);
			showReview(
				parseVaultMappedLines(mappedLines),
				{ kind: "manual" },
				nextSource,
			);
			setSource(nextSource);
		} catch (error) {
			setMessage(t(errorCopy(error)));
		}
	}
	async function readFile(next: File | null) {
		if (running.current) return;
		if (!editingSource) resetInput("");
		else {
			setSourceSelection(null);
			setMappedLines([]);
			setMessage("");
		}
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
		setAiMode("titles");
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
		const nextPreview = session ? previewCandidates(session, rows) : null;
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
			!selected.length
		)
			return;
		running.current = "save";
		setBusy("save");
		setMessage("");
		const current = ++generation.current;
		try {
			const selectedIds = new Set(selected.map((row) => row.id));
			const selectedPlan = previewCandidates(session, selected);
			if (!selectedPlan || selectedPlan.rows.some((row) => !row))
				throw Error("vault-invalid");
			const items: VaultImportItem[] = selected.map((row) => {
				const choice = choices[row.id];
				const action = choice.action;
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
			const remaining = candidates.filter((row) => !selectedIds.has(row.id));
			const nextPlan = previewCandidates(session, remaining);
			baseRevision.current = result.revision;
			setCandidates(remaining);
			setChoices(
				Object.fromEntries(
					remaining.map((row, index) => {
						const status = nextPlan?.rows[index]?.status;
						return [
							row.id,
							{ selected: false, action: status === "new" ? "new" : "skip" },
						];
					}),
				),
			);
			if (!remaining.length && !issues.length) {
				setSource("");
				setReviewSource("");
				setSourceSelection(null);
				setFile(null);
				setMappedLines([]);
			}
			setReceipt(result);
			setStage(remaining.length ? "review" : "saved");
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
						{editingSource && (
							<div className="pw-smart-edit-source">
								<p className="notice">
									{t(
										source === reviewSource
											? sourceSelection
												? "pwSmartSourceEditHint"
												: "pwSmartSourceEditKeepHint"
											: "pwSmartSourceChangedHint",
									)}
								</p>
								<Button
									onClick={() => {
										setStage("review");
										setSourceSelection(null);
									}}
									disabled={!!busy}
								>
									{t("pwSmartBackToReview")}
								</Button>
							</div>
						)}
						<label className="field" htmlFor="pw-smart-source">
							<span>{t("pwSmartSource")}</span>
							<textarea
								ref={sourceInput}
								id="pw-smart-source"
								rows={8}
								value={source}
								onChange={(event) => {
									setSource(event.target.value);
									setSourceSelection(null);
									setMappedLines([]);
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
						<div className="pw-smart-ai pw-smart-ai-recognition">
							<p>{t("pwSmartAiRecognitionHint")}</p>
							{settings && (
								<p className="pw-smart-ai-target">
									{t("pwSmartAiTarget", {
										model: settings.model,
										endpoint: settings.baseURL,
									})}
								</p>
							)}
							{connection ? (
								<Button
									variant="primary"
									onClick={() => void recognizeWithAi()}
									disabled={!!busy || !source.trim()}
								>
									<Sparkles size={16} />
									{t("pwSmartAiRecognize", { model: connection.model })}
								</Button>
							) : settings?.keySource === "vault" ? (
								<Button onClick={activateModel} disabled={!!busy}>
									{t("aiSettingsActivateVaultKey")}
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
						<Button onClick={recognize} disabled={!!busy || !source.trim()}>
							{t("pwSmartRecognize")}
						</Button>
						<Button onClick={startMapping} disabled={!!busy || !source.trim()}>
							{t("pwSmartMap")}
						</Button>
					</>
				)}
				{stage === "mapping" && (
					<>
						{editingSource && (
							<p className="notice">{t("pwSmartSourceEditKeepHint")}</p>
						)}
						<PasswordImportMapping
							rows={mappedLines}
							onChange={setMappedLines}
							onReview={reviewMapping}
							onBack={() => {
								setSource(updateVaultMappedSource(source, mappedLines));
								setSourceSelection(null);
								setStage("input");
								setMessage("");
							}}
						/>
					</>
				)}
				{stage === "review" && (
					<>
						<p className="pw-smart-mode">
							{t(
								`pwSmartReviewMode_${reviewOrigin.kind}`,
								reviewOrigin.kind === "ai"
									? {
											model: reviewOrigin.model,
											endpoint: reviewOrigin.endpoint,
										}
									: {},
							)}
						</p>
						{source !== reviewSource && (
							<p className="notice">{t("pwSmartSourceChangedHint")}</p>
						)}
						<p className="pw-smart-summary">
							{t("pwSmartReviewProgress", {
								complete: completeCount,
								pending: pendingCount,
							})}
						</p>
						{receipt && (
							<p className="pw-smart-receipt" role="status">
								{t("pwSmartSaved", receipt)}
							</p>
						)}
						{issues.length > 0 && (
							<div className="pw-smart-issues" role="status">
								<strong>{t("pwSmartIssues")}</strong>
								<div className="pw-smart-source-groups">
									{issueGroups.map((group) => (
										<div
											className="pw-smart-source-group"
											key={group.excerpt.id}
										>
											<p className="pw-smart-source-group-reasons">
												{[...new Set(group.issues.map((issue) => issue.code))]
													.map((code) =>
														t(`pwSmartIssue_${code}`, {
															defaultValue: t("pwSmartIssueUnknown"),
														}),
													)
													.join(" · ")}
											</p>
											<VaultImportSourceExcerpt
												excerpt={group.excerpt}
												source={reviewSource}
												disabled={!!busy}
												onEdit={editSource}
											/>
										</div>
									))}
								</div>
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
											preview?.rows.some((row) => row?.status === "new") ===
												true &&
											preview.rows.every(
												(row, index) =>
													row?.status !== "new" ||
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
										disabled={
											!!busy ||
											!preview?.rows.some((row) => row?.status === "new") ||
											outdated
										}
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
											source={reviewSource}
											candidates={candidates}
											onEditSource={editSource}
										/>
									))}
								</div>
								{pendingCount > 0 && (
									<p className="notice" role="alert">
										{t("pwSmartInvalidRows")}
									</p>
								)}
							</>
						)}
						<div className="actions pw-smart-footer">
							<Button onClick={() => editSource()} disabled={!!busy}>
								{t("pwSmartEditSource")}
							</Button>
							<Button
								variant="primary"
								onClick={() => void save()}
								disabled={!!busy || outdated || !preview || !selected.length}
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
						<Button onClick={() => editSource()}>{t("pwSmartContinue")}</Button>
					</div>
				)}
				{busy && (
					<p role="status">
						{t(
							busy === "ai"
								? aiMode === "recognize"
									? "pwSmartAiRecognitionBusy"
									: "pwSmartAiBusy"
								: "pwVaultBusy",
						)}
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
	source,
	candidates,
	onEditSource,
}: {
	row: VaultImportCandidate;
	index: number;
	plan: ReviewPreview | null;
	choice: Choice;
	disabled: boolean;
	onDraft: (id: string, field: keyof VaultEntryDraft, value: string) => void;
	onChoice: (id: string, choice: Choice) => void;
	existing: { id: string; title: string; username: string }[];
	source: string;
	candidates: VaultImportCandidate[];
	onEditSource: (selection: { start: number; end: number }) => void;
}) {
	const { t } = useTranslation();
	const [revealed, setRevealed] = useState(false);
	const multilinePassword = /[\r\n]/.test(row.draft.password);
	const status = plan?.rows[index]?.status;
	const ids = plan?.rows[index]?.existingIds ?? [];
	const rowIssues = currentRowIssues(row, !!status);
	const [expanded, setExpanded] = useState(index === 0 || rowIssues.length > 0);
	const [optionalExpanded, setOptionalExpanded] = useState(
		!!row.draft.url || !!row.draft.notes,
	);
	const sourceAnchor =
		row.sourceFields?.username?.line ??
		row.sourceFields?.password?.line ??
		row.sourceLine;
	const fieldId = `pw-smart-${row.id}`;
	return (
		<article className="pw-smart-row" data-row-id={row.id}>
			<div className="pw-smart-row-header">
				<label className="pw-smart-check">
					<input
						type="checkbox"
						checked={!!status && choice.selected && status !== "duplicate"}
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
			{rowIssues.length > 0 && (
				<ul className="pw-smart-row-issues">
					{rowIssues.map((issue) => (
						<li key={`${issue.lineNumber}-${issue.code}`}>
							{t(`pwSmartIssue_${issue.code}`, {
								defaultValue: t("pwSmartIssueUnknown"),
							})}
						</li>
					))}
				</ul>
			)}
			<details
				className="pw-smart-row-editor"
				open={expanded}
				onToggle={(event) => setExpanded(event.currentTarget.open)}
			>
				<summary className="pw-smart-row-summary">
					<span>{row.draft.title || t("pwVaultEntryNew")}</span>
					{row.draft.username && (
						<span className="pw-smart-row-username">{row.draft.username}</span>
					)}
				</summary>
				<div className="pw-smart-fields">
					{(["title", "username"] as const).map((field) => (
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
									}[field],
								)}
							</span>
							<input
								id={`${fieldId}-${field}`}
								value={row.draft[field]}
								placeholder={
									field === "title" ? t("pwVaultNamePlaceholder") : undefined
								}
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
				</div>
				<details
					className="pw-smart-optional"
					open={optionalExpanded}
					onToggle={(event) => setOptionalExpanded(event.currentTarget.open)}
				>
					<summary>{t("pwVaultOptionalDetails")}</summary>
					<div className="pw-smart-fields">
						<label
							className="field pw-smart-field-url"
							htmlFor={`${fieldId}-url`}
						>
							<span>{t("pwVaultUrlOptionalField")}</span>
							<input
								id={`${fieldId}-url`}
								value={row.draft.url}
								onChange={(event) => onDraft(row.id, "url", event.target.value)}
								disabled={disabled}
								autoComplete="off"
								spellCheck={false}
							/>
						</label>
						<label
							className="field pw-smart-field-notes"
							htmlFor={`${fieldId}-notes`}
						>
							<span>{t("pwVaultNotesOptionalField")}</span>
							<textarea
								id={`${fieldId}-notes`}
								value={row.draft.notes}
								onChange={(event) =>
									onDraft(row.id, "notes", event.target.value)
								}
								disabled={disabled}
								autoComplete="off"
								spellCheck={false}
								rows={2}
							/>
						</label>
					</div>
				</details>
				{expanded && (
					<VaultImportSourceExcerpt
						excerpt={buildVaultImportSourceExcerpt(
							source,
							rowIssues.length
								? rowIssues.map((issue) =>
										issue.code === "missing-password" ||
										issue.code === "missing-identity"
											? sourceAnchor
											: issue.lineNumber,
									)
								: [sourceAnchor],
							candidates,
							row,
						)}
						source={source}
						disabled={disabled}
						onEdit={onEditSource}
					/>
				)}
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
