import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileText, LoaderCircle, Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	VaultEntryDraft,
	VaultImportItem,
	VaultImportPreviewRow,
	VaultSession,
} from "../../../../packages/password-vault/src";
import { acquireAiConnection, useAiConnection } from "../ai-settings-store";
import {
	requestVaultImportAiRecognition,
	VaultImportAiError,
} from "../vault-import-ai";
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
	VAULT_IMPORT_MAX_ENTRIES,
	type VaultImportCandidate,
	type VaultImportIssue,
	type VaultImportResult,
	validateVaultImportFields,
	withFilledVaultIdentifiers,
} from "../vault-import-model";
import {
	buildVaultImportSourceExcerpt,
	groupVaultImportIssues,
} from "../vault-import-source";
import { readImportDraft, type ImportDraft } from "../vault-import-draft";
import { useVaultImportDraft } from "../use-vault-import-draft";
import type { WorkspaceDraftState } from "./PasswordImportWorkspace";
import type { FragmentDraftState } from "./VaultImportFragmentForm";
import { PasswordImportMapping } from "./PasswordImportMapping";
import { PasswordImportWorkspace } from "./PasswordImportWorkspace";
import { usePasswordVault } from "./PasswordVaultProvider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { FilePicker } from "./ui/file-picker";
import { Select, SelectOption } from "./ui/select";
import { TextLink } from "./ui/text-link";
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
	rows: ((VaultImportPreviewRow & { updateOnly?: boolean }) | undefined)[];
};

function previewCandidates(
	session: VaultSession,
	candidates: VaultImportCandidate[],
): ReviewPreview | null {
	let indexes = candidates.flatMap((row, index) =>
		row.draft.title.trim() ? [index] : [],
	);
	try {
		let plan: ReturnType<VaultSession["previewImport"]>;
		try {
			plan = session.previewImport(
				indexes.map((index) =>
					withFilledVaultIdentifiers(candidates[index].draft),
				),
			);
		} catch {
			// One invalid edit must not prevent other entries from being reviewed.
			indexes = indexes.filter((index) => {
				try {
					session.previewImport([
						withFilledVaultIdentifiers(candidates[index].draft),
					]);
					return true;
				} catch {
					return false;
				}
			});
			plan = session.previewImport(
				indexes.map((index) =>
					withFilledVaultIdentifiers(candidates[index].draft),
				),
			);
		}
		const rows: ReviewPreview["rows"] = Array.from({
			length: candidates.length,
		});
		for (const [index, row] of plan.rows.entries()) {
			const candidate = candidates[indexes[index]];
			rows[indexes[index]] = {
				...row,
				index: indexes[index],
				...(row.duplicateOfIndex !== undefined
					? { duplicateOfIndex: indexes[row.duplicateOfIndex] }
					: {}),
				...((candidate.updateTargetId &&
					row.existingIds.includes(candidate.updateTargetId)) ||
				(candidate.explicitlyEdited &&
					row.status === "duplicate" &&
					row.duplicateOfIndex === undefined &&
					row.existingIds.length)
					? { status: "conflict" as const }
					: {}),
				...(candidate.explicitlyEdited &&
				row.status === "duplicate" &&
				row.duplicateOfIndex === undefined &&
				row.existingIds.length
					? { updateOnly: true }
					: {}),
			};
		}
		return { revision: plan.revision, rows };
	} catch {
		return null;
	}
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
	onLinkAccounts,
	returnFocusTo,
}: {
	onClose: () => void;
	onLinkAccounts: () => void;
	returnFocusTo?: () => HTMLElement | null;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const vault = usePasswordVault();
	const {
		connection,
		settings,
		revision: aiRevision,
		activateVaultKey,
	} = useAiConnection();
	const [initialDraft] = useState(() => {
		let raw: string | null = null;
		try {
			raw = vault.session?.readImportDraft() ?? null;
			return { raw, value: readImportDraft(raw), failed: false };
		} catch {
			return { raw, value: null, failed: true };
		}
	});
	const restored = initialDraft.value;
	const [workspaceState, setWorkspaceState] = useState<
		WorkspaceDraftState | undefined
	>(restored?.workspaceState);
	const [fragmentStates, setFragmentStates] = useState<
		Record<string, FragmentDraftState>
	>(restored?.fragmentStates ?? {});
	const [draftClosing, setDraftClosing] = useState(false);
	const keepWorkspaceState = useCallback((next: WorkspaceDraftState) => {
		setWorkspaceState((before) =>
			JSON.stringify(before) === JSON.stringify(next) ? before : next,
		);
	}, []);
	const keepFragmentState = useCallback(
		(id: string, next: FragmentDraftState) => {
			setFragmentStates((before) =>
				JSON.stringify(before[id]) === JSON.stringify(next)
					? before
					: { ...before, [id]: next },
			);
		},
		[],
	);
	const [confirmation, setConfirmation] = useState<
		| "ai"
		| "titles"
		| "save"
		| "close"
		| "lock"
		| "model"
		| "replace-local"
		| "replace-ai"
		| null
	>(null);
	const [unlockPassword, setUnlockPassword] = useState("");
	const [unlockBusy, setUnlockBusy] = useState(false);
	const [source, setSource] = useState(restored?.source ?? "");
	const [reviewSource, setReviewSource] = useState(
		restored?.reviewSource ?? "",
	);
	const [reviewVersion, setReviewVersion] = useState(
		restored?.reviewVersion ?? 0,
	);
	const [sourceSelection, setSourceSelection] = useState<{
		start: number;
		end: number;
	} | null>(null);
	const sourceInput = useRef<HTMLTextAreaElement | null>(null);
	const [file, setFile] = useState<File | null>(null);
	const [candidates, setCandidates] = useState<VaultImportCandidate[]>(
		restored?.candidates ?? [],
	);
	const [savedCandidates, setSavedCandidates] = useState<
		VaultImportCandidate[]
	>(restored?.savedCandidates ?? []);
	const manualSequence = useRef(restored?.manualSequence ?? 0);
	const issueGroupIds = useRef(
		new Map<string, string>(restored?.issueGroupIds ?? []),
	);
	const [issues, setIssues] = useState<VaultImportIssue[]>(
		restored?.issues ?? [],
	);
	const [choices, setChoices] = useState<Record<string, Choice>>(
		restored?.choices ?? {},
	);
	const [stage, setStage] = useState<"input" | "mapping" | "review" | "saved">(
		restored?.stage ?? "input",
	);
	const [mappedLines, setMappedLines] = useState<VaultMappedLine[]>(
		restored?.mappedLines ?? [],
	);
	const [busy, setBusy] = useState<"file" | "ai" | "save" | null>(null);
	const [reviewOrigin, setReviewOrigin] = useState<ReviewOrigin>(
		restored?.reviewOrigin ?? { kind: "local" },
	);
	const [message, setMessage] = useState("");
	const [receipt, setReceipt] = useState<{
		added: number;
		updated: number;
		skipped: number;
	} | null>(restored?.receipt ?? null);
	const running = useRef<"file" | "ai" | "save" | null>(null);
	const generation = useRef(0);
	const controller = useRef<AbortController | null>(null);
	const baseRevision = useRef<string | null>(
		restored?.baseContentRevision ?? null,
	);
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
		if (vault.notice === "pwVaultLockedElsewhere") {
			generation.current++;
			controller.current?.abort();
			running.current = null;
			setBusy(null);
			setConfirmation(null);
			setMessage(t("pwSmartStaleDraft"));
			return;
		}
		generation.current++;
		controller.current?.abort();
		setSource("");
		setReviewSource("");
		setSourceSelection(null);
		setFile(null);
		setCandidates([]);
		setSavedCandidates([]);
		setChoices({});
		setIssues([]);
		setMappedLines([]);
		onClose();
	}, [vault.snapshot.status, vault.notice, onClose, t]);
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
			[
				...[...issues]
					.sort((a, b) => a.lineNumber - b.lineNumber)
					.reduce((groups, issue) => {
						const id =
							issueGroupIds.current.get(`${issue.lineNumber}:${issue.code}`) ??
							`source-${issue.lineNumber}`;
						groups.set(id, [...(groups.get(id) ?? []), issue]);
						return groups;
					}, new Map<string, VaultImportIssue[]>()),
			].map(([id, group]) => ({
				id,
				issues: group,
				excerpt: buildVaultImportSourceExcerpt(
					reviewSource,
					group.map((issue) => issue.lineNumber),
					[...candidates, ...savedCandidates].filter(
						(row) => !row.sourceSnapshot || row.sourceSnapshot === reviewSource,
					),
				),
			})),
		[issues, reviewSource, candidates, savedCandidates],
	);
	const hasReview = !!reviewSource;
	const fragmentTargets = [
		...candidates,
		...savedCandidates.filter(
			(saved) =>
				!candidates.some(
					(candidate) => candidate.updateTargetId === saved.updateTargetId,
				),
		),
	];
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
	const pendingCount = candidates.length - selected.length + issueGroups.length;
	const outdated =
		vault.snapshot.status !== "unlocked" ||
		(!!reviewSource && baseRevision.current !== vault.snapshot.contentRevision);

	const draftValue = useMemo(() => {
		if (!source && !reviewSource && !candidates.length && !issues.length)
			return null;
		const value: ImportDraft = {
			version: 1,
			source,
			reviewSource,
			reviewVersion,
			candidates,
			savedCandidates,
			issues,
			choices,
			stage,
			mappedLines,
			reviewOrigin,
			receipt,
			manualSequence: manualSequence.current,
			issueGroupIds: [...issueGroupIds.current],
			baseContentRevision: baseRevision.current,
			workspaceState,
			fragmentStates,
		};
		return JSON.stringify(value);
	}, [
		source,
		reviewSource,
		reviewVersion,
		candidates,
		savedCandidates,
		issues,
		choices,
		stage,
		mappedLines,
		reviewOrigin,
		receipt,
		workspaceState,
		fragmentStates,
	]);
	const draftStore = useVaultImportDraft(
		session,
		draftValue,
		initialDraft.raw,
		!initialDraft.failed &&
			vault.snapshot.status === "unlocked" &&
			busy !== "save" &&
			!draftClosing,
	);
	async function preserveAndClose(lock = false, discard = false) {
		if (running.current === "save" || draftClosing) return false;
		if (initialDraft.failed && !discard) {
			if (lock) vault.lock();
			close();
			return true;
		}
		generation.current++;
		controller.current?.abort();
		running.current = null;
		setBusy(null);
		setDraftClosing(true);
		try {
			await draftStore.flush(discard ? null : undefined);
			if (lock) vault.lock();
			close();
			return true;
		} catch {
			setMessage(t("pwSmartDraftFailed"));
			return false;
		} finally {
			setDraftClosing(false);
		}
	}

	function close() {
		if (running.current === "save") return;
		generation.current++;
		controller.current?.abort();
		setSource("");
		setReviewSource("");
		setSourceSelection(null);
		setFile(null);
		setCandidates([]);
		setSavedCandidates([]);
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
		setSavedCandidates([]);
		setChoices({});
		setIssues([]);
		setMappedLines([]);
		setReceipt(null);
		setWorkspaceState(undefined);
		setFragmentStates({});
		setStage("input");
		setSource(nextSource);
		setReviewSource("");
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
		setMessage("");
		setStage("input");
	}
	function recognize() {
		if (running.current || !session) return;
		setMessage("");
		try {
			const result = parseVaultImportText(source);
			if (hasReview && !result.candidates.length) {
				setMessage(t("pwSmartNoRows"));
				return;
			}
			showReview(result, { kind: "local" });
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
		const startingRevision = session.getSnapshot().contentRevision;
		running.current = "ai";
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
			if (session.getSnapshot().contentRevision !== startingRevision) {
				setMessage(t("pwVaultConflict"));
				return;
			}
			if (hasReview && !result.candidates.length) {
				setMessage(t("pwSmartNoRows"));
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
							: error instanceof VaultImportAiError &&
									error.category === "timeout"
								? "pwSmartAiTimeout"
								: error instanceof VaultImportAiError &&
										error.category === "output-limit"
									? "pwSmartAiOutputLimit"
									: error instanceof VaultImportAiError &&
											error.category === "response-format"
										? "pwSmartAiResponseFormat"
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
		baseRevision.current = session.getSnapshot().contentRevision;
		setCandidates(result.candidates);
		setReviewVersion((current) => current + 1);
		setWorkspaceState(undefined);
		setFragmentStates({});
		setSavedCandidates([]);
		issueGroupIds.current = new Map(
			groupVaultImportIssues(result.issues).flatMap((group) =>
				group.map((issue) => [
					`${issue.lineNumber}:${issue.code}`,
					`source-${group[0].lineNumber}-${group[group.length - 1].lineNumber}`,
				]),
			),
		);
		setIssues(result.issues);
		setReviewOrigin(origin);
		setReviewSource(resultSource);
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
			const result = parseVaultMappedLines(mappedLines);
			if (hasReview) {
				if (nextSource !== reviewSource && result.issues.length) {
					setMessage(t("pwSmartMapRemaining"));
					return;
				}
				const handled = new Set(
					source === reviewSource && nextSource === reviewSource
						? result.handledLines
						: [],
				);
				if (!result.candidates.length && !handled.size) {
					setMessage(t("pwSmartNoRows"));
					return;
				}
				if (
					candidates.length + result.candidates.length >
					VAULT_IMPORT_MAX_ENTRIES
				)
					throw Error("vault-import-limit");
				const additions = result.candidates.map((row) => ({
					...row,
					sourceSnapshot: nextSource,
					id: `vault-manual-${++manualSequence.current}`,
					needsReview: true,
				}));
				setCandidates([...candidates, ...additions]);
				setSource(nextSource);
				setIssues(issues.filter((issue) => !handled.has(issue.lineNumber)));
				setChoices((current) => ({
					...current,
					...Object.fromEntries(
						additions.map((row) => [
							row.id,
							{ selected: false, action: "new" as const },
						]),
					),
				}));
				setStage("review");
				setSourceSelection(null);
				setMessage(additions.length ? t("pwSmartManualAdded") : "");
				return;
			}
			showReview(result, { kind: "manual" }, nextSource);
			setSource(nextSource);
		} catch (error) {
			setMessage(t(errorCopy(error)));
		}
	}
	async function readFile(next: File | null) {
		if (running.current) return;
		if (!hasReview) resetInput("");
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
				session.getSnapshot().contentRevision !== baseRevision.current
			)
				return;
			const changed = new Set(
				rows
					.filter(
						(row, index) => row.draft.title !== candidates[index]?.draft.title,
					)
					.map((row) => row.id),
			);
			const nextPreview = previewCandidates(session, rows);
			setCandidates(
				rows.map((row) =>
					changed.has(row.id) ? { ...row, needsReview: true } : row,
				),
			);
			setChoices((currentChoices) =>
				Object.fromEntries(
					rows.map((row, index) => [
						row.id,
						changed.has(row.id)
							? {
									selected: false,
									action:
										nextPreview?.rows[index]?.status === "new" ? "new" : "skip",
								}
							: currentChoices[row.id],
					]),
				),
			);
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
		value: string | string[],
	) {
		if (running.current) return;
		const rows = candidates.map((row) =>
			row.id === id
				? {
						...row,
						aiEligible: false,
						explicitlyEdited: true,
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
									action: row.updateTargetId
										? "update"
										: after?.status === "new"
											? "new"
											: "skip",
									...(row.updateTargetId
										? { targetId: row.updateTargetId }
										: {}),
								}
							: current[row.id],
					];
				}),
			),
		);
		setMessage("");
	}
	function choose(id: string, choice: Choice) {
		if (choice.selected)
			setCandidates((current) =>
				current.map((row) =>
					row.id === id ? { ...row, needsReview: false } : row,
				),
			);
		setChoices((current) => ({ ...current, [id]: choice }));
	}
	function addAnotherAccount(id?: string) {
		if (running.current || outdated) return;
		const target = candidates.find((row) => row.id === id);
		if (id && !target) return;
		if (candidates.length >= VAULT_IMPORT_MAX_ENTRIES) {
			setMessage(t("pwSmartLimit"));
			return;
		}
		const row: VaultImportCandidate = {
			id: `vault-manual-${++manualSequence.current}`,
			sourceLine: target?.sourceLine ?? 1,
			// A blank manual entry must not claim an unrelated source passage.
			...(!target
				? { sourceSnapshot: "" }
				: target.sourceSnapshot !== undefined
					? { sourceSnapshot: target.sourceSnapshot }
					: {}),
			draft: {
				title: target?.draft.title ?? "",
				url: target?.draft.url ?? "",
				username: "",
				password: "",
				notes: "",
				linkedAssetIds: [],
			},
			aiEligible: false,
			explicitlyEdited: true,
			needsReview: true,
		};
		setCandidates((current) => [...current, row]);
		setChoices((current) => ({
			...current,
			[row.id]: { selected: false, action: "new" },
		}));
		setMessage(t("pwSmartManualAdded"));
	}
	function removeCandidate(id: string) {
		if (running.current || outdated || !session) return;
		const rows = candidates.filter((row) => row.id !== id);
		if (rows.length === candidates.length) return;
		const nextPreview = previewCandidates(session, rows);
		setChoices((current) =>
			Object.fromEntries(
				rows.map((row, index) => {
					const beforeIndex = candidates.findIndex(
						(before) => before.id === row.id,
					);
					const before = preview?.rows[beforeIndex];
					const after = nextPreview?.rows[index];
					const unchanged =
						before &&
						after &&
						before.status === after.status &&
						before.updateOnly === after.updateOnly &&
						JSON.stringify(before.existingIds) ===
							JSON.stringify(after.existingIds);
					return [
						row.id,
						unchanged && current[row.id]
							? current[row.id]
							: {
									selected: false,
									action: row.updateTargetId
										? "update"
										: after?.status === "new"
											? "new"
											: "skip",
									...(row.updateTargetId
										? { targetId: row.updateTargetId }
										: {}),
								},
					];
				}),
			),
		);
		setCandidates(rows);
		setMessage("");
	}
	function removeFragment(id: string) {
		if (running.current || outdated) return;
		const group = issueGroups.find((item) => item.id === id);
		if (!group) return;
		const removed = new Set(
			group.issues.map((issue) => `${issue.lineNumber}:${issue.code}`),
		);
		setIssues((current) =>
			current.filter(
				(issue) => !removed.has(`${issue.lineNumber}:${issue.code}`),
			),
		);
		setFragmentStates((current) =>
			Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)),
		);
		setMessage("");
	}
	function applyFragment(
		group: (typeof issueGroups)[number] & {
			sourceLine?: number;
			sourceSnapshot?: string;
		},
		targetId: string | null,
		draft: VaultEntryDraft,
	): boolean {
		if (running.current || !session || outdated) return false;
		const target = targetId
			? fragmentTargets.find((row) => row.id === targetId)
			: undefined;
		if (targetId && !target) return false;
		const validated = validateVaultImportFields(draft);
		if (
			!validated.candidates.length ||
			![
				draft.title.trim(),
				draft.username.trim(),
				draft.password,
				draft.notes,
			].some(Boolean)
		) {
			setMessage(t("pwSmartIssue_invalid-field"));
			return false;
		}
		if (
			target &&
			(["title", "username", "password", "url", "notes"] as const).every(
				(field) => validated.candidates[0].draft[field] === target.draft[field],
			) &&
			JSON.stringify(validated.candidates[0].draft.usernameAliases ?? []) ===
				JSON.stringify(target.draft.usernameAliases ?? [])
		) {
			// Reviewing an already complete entry must not require a dummy edit.
			const handled = new Set(
				group.issues.map((issue) => `${issue.lineNumber}:${issue.code}`),
			);
			setIssues((current) =>
				current.filter(
					(issue) => !handled.has(`${issue.lineNumber}:${issue.code}`),
				),
			);
			const index = candidates.findIndex((row) => row.id === target.id);
			if (index >= 0 && preview?.rows[index]?.status === "new") {
				setChoices((current) => ({
					...current,
					[target.id]: { selected: true, action: "new" },
				}));
			}
			setMessage(t("pwSmartFragmentReviewed"));
			return true;
		}
		const existingIndex = target
			? candidates.findIndex((row) => row.id === target.id)
			: -1;
		if (existingIndex < 0 && candidates.length >= VAULT_IMPORT_MAX_ENTRIES) {
			setMessage(t("pwSmartLimit"));
			return false;
		}
		const row: VaultImportCandidate = {
			...(target ?? validated.candidates[0]),
			id: target?.id ?? `vault-manual-${++manualSequence.current}`,
			sourceLine:
				target?.sourceLine ??
				group.sourceLine ??
				group.issues[0]?.lineNumber ??
				1,
			sourceSnapshot:
				target?.sourceSnapshot ?? group.sourceSnapshot ?? reviewSource,
			draft: {
				...validated.candidates[0].draft,
				linkedAssetIds: [...draft.linkedAssetIds],
			},
			aiEligible: false,
			explicitlyEdited: true,
			needsReview: true,
			reviewIssues: validated.issues.map((issue) => ({
				...issue,
				lineNumber: group.sourceLine ?? group.issues[0]?.lineNumber ?? 1,
			})),
		};
		const rows =
			existingIndex < 0
				? [...candidates, row]
				: candidates.map((candidate) =>
						candidate.id === row.id ? row : candidate,
					);
		const nextPlan = previewCandidates(session, rows);
		const appliedPlan =
			nextPlan?.rows[rows.findIndex((candidate) => candidate.id === row.id)];
		const ready =
			!!appliedPlan && (appliedPlan.status === "new" || !!row.updateTargetId);
		const handled = new Set(
			group.issues.map((issue) => `${issue.lineNumber}:${issue.code}`),
		);
		setCandidates(rows);
		setIssues(
			issues.filter(
				(issue) => !handled.has(`${issue.lineNumber}:${issue.code}`),
			),
		);
		setChoices((current) =>
			Object.fromEntries(
				rows.map((candidate, index) => {
					const beforeIndex = candidates.findIndex(
						(before) => before.id === candidate.id,
					);
					const before =
						beforeIndex < 0 ? undefined : preview?.rows[beforeIndex];
					const after = nextPlan?.rows[index];
					const changed =
						candidate.id === row.id ||
						!before ||
						!after ||
						before.status !== after.status ||
						JSON.stringify(before.existingIds) !==
							JSON.stringify(after.existingIds);
					return [
						candidate.id,
						changed
							? {
									selected: candidate.id === row.id && ready,
									action: candidate.updateTargetId
										? "update"
										: after?.status === "new"
											? "new"
											: "skip",
									...(candidate.updateTargetId
										? { targetId: candidate.updateTargetId }
										: {}),
								}
							: current[candidate.id],
					];
				}),
			),
		);
		setStage("review");
		setMessage(
			t(
				ready
					? "pwSmartFragmentCompleted"
					: appliedPlan
						? "pwSmartManualAdded"
						: "pwSmartFragmentPending",
			),
		);
		return true;
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
					draft: withFilledVaultIdentifiers(row.draft),
					action,
					...(action === "update" ? { targetId: choice?.targetId } : {}),
				};
			});
			await draftStore.flush();
			if (session.getSnapshot().contentRevision !== baseRevision.current)
				throw Error("vault-stale");
			const physicalRevision = session.getSnapshot().revision;
			if (!physicalRevision) throw Error("vault-missing");
			const result = await session.importEntries(items, physicalRevision);
			if (
				current !== generation.current ||
				session.getSnapshot().status !== "unlocked"
			)
				return;
			const remaining = candidates.filter((row) => !selectedIds.has(row.id));
			const savedById = new Map<string, VaultImportCandidate>();
			selected.forEach((row, index) => {
				const entryId = result.entryIdsByRow[index];
				if (!entryId) return;
				const draft = session.readEntry(entryId);
				delete draft.id;
				const previous =
					savedById.get(entryId) ??
					savedCandidates.find((saved) => saved.updateTargetId === entryId);
				savedById.set(entryId, {
					...row,
					id: previous?.id ?? row.id,
					aliasIds: [...new Set([...(previous?.aliasIds ?? []), row.id])],
					updateTargetId: entryId,
					draft,
				});
			});
			const justSaved = [...savedById.values()];
			setSavedCandidates((previous) => [
				...previous.filter(
					(row) =>
						!justSaved.some(
							(saved) => saved.updateTargetId === row.updateTargetId,
						),
				),
				...justSaved,
			]);
			const nextPlan = previewCandidates(session, remaining);
			baseRevision.current = session.getSnapshot().contentRevision;
			setCandidates(remaining);
			setChoices(
				Object.fromEntries(
					remaining.map((row, index) => {
						const status = nextPlan?.rows[index]?.status;
						return [
							row.id,
							{
								selected: false,
								action: row.updateTargetId
									? "update"
									: status === "new"
										? "new"
										: "skip",
								...(row.updateTargetId ? { targetId: row.updateTargetId } : {}),
							},
						];
					}),
				),
			);
			if (!remaining.length && !issues.length) {
				setSource("");
				setReviewSource("");
				setSavedCandidates([]);
				setSourceSelection(null);
				setFile(null);
				setMappedLines([]);
			}
			setReceipt(result);
			setStage(remaining.length || issues.length ? "review" : "saved");
		} catch (error) {
			if (current === generation.current) setMessage(t(errorCopy(error)));
		} finally {
			if (current === generation.current) {
				running.current = null;
				setBusy(null);
			}
		}
	}

	function cancelRecognition() {
		generation.current++;
		controller.current?.abort();
		controller.current = null;
		running.current = null;
		setBusy(null);
		setMessage(t("pwSmartCancelled"));
	}
	function requestRecognition(ai: boolean) {
		if (running.current || outdated) return;
		setConfirmation(
			ai ? "ai" : hasReview && source !== reviewSource ? "replace-local" : null,
		);
		if (!ai && (!hasReview || source === reviewSource)) recognize();
	}
	function requestClose() {
		if (running.current === "save") return;
		if (source || candidates.length || issues.length || initialDraft.failed)
			setConfirmation("close");
		else void preserveAndClose();
	}
	function recheckDraft() {
		if (session?.getSnapshot().status !== "unlocked") return;
		baseRevision.current = session.getSnapshot().contentRevision;
		setChoices({});
		setMessage(t("pwSmartReviewAgain"));
	}
	async function unlockForReview() {
		if (!session || unlockBusy) return;
		setUnlockBusy(true);
		try {
			await session.unlock(unlockPassword);
			recheckDraft();
		} catch {
			setMessage(t("pwVaultUnlockFailed"));
		} finally {
			setUnlockPassword("");
			setUnlockBusy(false);
		}
	}
	const saveNewCount = selected.filter(
		(row) => choices[row.id]?.action === "new",
	).length;
	return (
		<Dialog
			className={`password-smart-import-dialog${stage === "review" ? " password-smart-import-dialog-wide" : ""}`}
			title={t(stage === "mapping" ? "pwSmartMap" : "pwSmartTitle")}
			onClose={requestClose}
			returnFocusTo={returnFocusTo}
			closeDisabled={busy === "save" || draftClosing}
			headerActions={
				<div className="pw-smart-header-actions">
					{(draftValue ||
						initialDraft.failed ||
						draftStore.status === "failed") && (
						<div className="pw-smart-draft-status" role="status">
							<span>
								{t(
									initialDraft.failed
										? "pwSmartDraftUnreadable"
										: draftStore.status === "failed"
											? "pwSmartDraftFailed"
											: draftStore.status === "saving"
												? "pwSmartDraftSaving"
												: "pwSmartDraftSaved",
								)}
							</span>
							{draftStore.status === "failed" && (
								<Button
									size="small"
									onClick={() => void draftStore.flush().catch(() => {})}
								>
									{t("pwSmartDraftRetry")}
								</Button>
							)}
						</div>
					)}
					{stage !== "saved" && (stage !== "input" || hasReview) && (
						<Select
							contentClassName="pw-smart-select-menu"
							className="pw-smart-input-menu"
							value="input"
							aria-label={t("pwSmartOtherInput")}
							disabled={!!busy || outdated}
							onValueChange={(value) => {
								if (value === "paste") editSource();
								if (value === "mapping") startMapping();
							}}
						>
							<SelectOption value="input" disabled>
								{t("pwSmartInputMethods")}
							</SelectOption>
							<SelectOption value="paste">{t("pwSmartPasteList")}</SelectOption>
							<SelectOption value="mapping">{t("pwSmartMap")}</SelectOption>
						</Select>
					)}
					<Select
						contentClassName="pw-smart-select-menu"
						className="pw-smart-top-menu"
						value="menu"
						aria-label={t("pwSmartImportMenu")}
						disabled={busy === "save"}
						onValueChange={(value) => {
							if (value === "model") setConfirmation("model");
							if (value === "lock") setConfirmation("lock");
						}}
					>
						<SelectOption value="menu" disabled>
							•••
						</SelectOption>
						<SelectOption value="model">
							{t("pwSmartModelDetails")}
						</SelectOption>
						<SelectOption value="lock">{t("pwSmartLockClose")}</SelectOption>
					</Select>
				</div>
			}
		>
			<div className="password-smart-import">
				{message && (
					<p className="notice pw-smart-message" role="status">
						{message}
					</p>
				)}
				{outdated && (
					<div className="pw-smart-stale" role="alert">
						<p>
							{t(
								vault.snapshot.status === "unlocked"
									? "pwSmartDraftVaultChanged"
									: "pwSmartStaleDraft",
							)}
						</p>
						{vault.snapshot.status === "unlocked" && (
							<Button onClick={recheckDraft}>{t("pwSmartRecheckDraft")}</Button>
						)}
						{vault.snapshot.status === "locked" && (
							<form
								onSubmit={(event) => {
									event.preventDefault();
									void unlockForReview();
								}}
							>
								<label className="field" htmlFor="pw-smart-unlock">
									<span>{t("pwVaultMasterPassword")}</span>
									<Input
										id="pw-smart-unlock"
										type="password"
										autoComplete="current-password"
										value={unlockPassword}
										onChange={(event) => setUnlockPassword(event.target.value)}
										disabled={unlockBusy}
									/>
								</label>
								<Button type="submit" disabled={unlockBusy || !unlockPassword}>
									{t("pwVaultUnlock")}
								</Button>
							</form>
						)}
					</div>
				)}
				{stage === "input" && !initialDraft.failed && (
					<div className="pw-smart-input-page">
						{hasReview && source !== reviewSource && (
							<p className="notice">{t("pwSmartSourceChangedHint")}</p>
						)}
						{!connection && (
							<div className="pw-smart-model-unavailable">
								<strong>
									{t(settings ? "pwSmartKeyInactive" : "pwSmartModelMissing")}
								</strong>
								{settings?.keySource === "vault" ? (
									<Button onClick={activateModel} disabled={!!busy}>
										{t("aiSettingsActivateVaultKey")}
									</Button>
								) : (
									<TextLink asChild>
										<Link
											to="/settings"
											hash="assistant"
											onClick={(event) => {
												event.preventDefault();
												void preserveAndClose().then((saved) => {
													if (saved)
														void navigate({
															to: "/settings",
															hash: "assistant",
														});
												});
											}}
										>
											{t(settings ? "aiEnableKey" : "aiConfigure")}
										</Link>
									</TextLink>
								)}
							</div>
						)}
						{file && (
							<div className="pw-smart-file-summary">
								<FileText size={24} />
								<span>
									<strong>{file.name}</strong>
									<small>{Math.ceil(file.size / 1024)} KB</small>
								</span>
								<Button
									variant="ghost"
									disabled={!!busy}
									onClick={() =>
										document.getElementById("pw-smart-file")?.click()
									}
								>
									{t("pwSmartReplaceFile")}
								</Button>
								<Button
									variant="ghost"
									disabled={!!busy}
									onClick={() => {
										setFile(null);
										setSource("");
									}}
								>
									{t("pwSmartRemoveFile")}
								</Button>
							</div>
						)}
						<label className="field" htmlFor="pw-smart-source">
							<span>{t("pwSmartSource")}</span>
							<Textarea
								ref={sourceInput}
								id="pw-smart-source"
								rows={6}
								value={source}
								onChange={(event) => {
									setSource(event.target.value);
									setSourceSelection(null);
									setMappedLines([]);
									setFile(null);
									setMessage("");
								}}
								disabled={!!busy || outdated}
								autoComplete="off"
								spellCheck={false}
								placeholder={t("pwSmartPlaceholder")}
							/>
						</label>
						<div
							className={`pw-smart-file-picker${file ? " pw-smart-file-picker-loaded" : ""}`}
						>
							<FilePicker
								compact
								id="pw-smart-file"
								label={t("pwSmartFile")}
								chooseLabel={t("pwSmartChooseFile")}
								emptyLabel={t("pwSmartFileTypes")}
								file={file}
								accept=".csv,.tsv,.txt,text/csv,text/plain"
								onFileChange={(next) => void readFile(next)}
								disabled={!!busy || outdated}
							/>
						</div>
						{busy === "ai" && (
							<div className="pw-smart-recognizing" role="status">
								<LoaderCircle className="pw-smart-spinner" size={32} />
								<strong>{t("pwSmartAiRecognitionBusy")}</strong>
								<Button onClick={cancelRecognition}>
									{t("pwSmartCancelRecognition")}
								</Button>
								<small>{t("pwSmartCancelKeeps")}</small>
							</div>
						)}
						<div className="actions pw-smart-input-footer">
							{hasReview ? (
								<Button
									onClick={() => {
										setStage("review");
										setSourceSelection(null);
									}}
									disabled={!!busy}
								>
									{t("pwSmartBackToReview")}
								</Button>
							) : (
								<Button
									variant="ghost"
									onClick={startMapping}
									disabled={!!busy || !source.trim() || outdated}
								>
									{t("pwSmartMap")}
								</Button>
							)}
							<Button
								onClick={() => requestRecognition(false)}
								disabled={!!busy || !source.trim() || outdated}
							>
								{t("pwSmartRecognize")}
							</Button>
							<Button
								variant="primary"
								onClick={() => requestRecognition(true)}
								disabled={!!busy || !source.trim() || !connection || outdated}
							>
								{t("pwSmartUseAi")}
							</Button>
						</div>
					</div>
				)}
				{stage === "mapping" && (
					<PasswordImportMapping
						rows={mappedLines}
						onChange={setMappedLines}
						onReview={reviewMapping}
						{...(hasReview
							? {
									onBackToReview: () => {
										setStage("review");
										setMessage("");
									},
									reviewLabel: t("pwSmartMapAdd"),
								}
							: {})}
						onBack={() => {
							setSource(updateVaultMappedSource(source, mappedLines));
							setSourceSelection(null);
							setStage("input");
							setMessage("");
						}}
					/>
				)}
				{hasReview && (
					<div
						className="pw-smart-review"
						key={reviewVersion}
						hidden={stage !== "review"}
					>
						{receipt && (
							<p className="pw-smart-receipt" role="status">
								{t("pwSmartSaved", receipt)}
							</p>
						)}
						<PasswordImportWorkspace
							initialState={workspaceState}
							onStateChange={keepWorkspaceState}
							fragmentStates={fragmentStates}
							onFragmentStateChange={keepFragmentState}
							candidates={candidates}
							choices={choices}
							preview={preview}
							issueGroups={issueGroups}
							fragmentTargets={fragmentTargets}
							reviewSource={reviewSource}
							savedCandidates={savedCandidates}
							busy={!!busy}
							outdated={outdated}
							existing={vault.snapshot.entries}
							onDraft={updateDraft}
							onChoice={choose}
							onAddAnother={addAnotherAccount}
							onRemoveCandidate={removeCandidate}
							onRemoveFragment={removeFragment}
							onApplyFragment={applyFragment}
							onOrganize={() => setConfirmation("titles")}
							organizeRecords={aiPreview.records}
							canOrganize={!!connection && !!aiPreview.records.length}
						/>
						<div className="pw-smart-footer">
							<div className="pw-smart-counts">
								{pendingCount > 0 && (
									<span>
										{t("pwSmartPendingCount", { count: pendingCount })}
									</span>
								)}
							</div>
							<div className="actions">
								<Button
									variant="primary"
									onClick={() => setConfirmation("save")}
									disabled={!!busy || outdated || !selected.length}
								>
									<Lock size={18} />
									{t("pwSmartImportReviewed", { count: selected.length })}
								</Button>
							</div>
						</div>
					</div>
				)}
				{stage === "saved" && receipt && (
					<>
						<p className="pw-smart-receipt" role="status">
							{t("pwSmartSaved", receipt)}
						</p>
						<div className="actions">
							<Button onClick={() => resetInput("")}>
								{t("pwSmartPasteList")}
							</Button>
							<Button
								variant="primary"
								disabled={draftClosing}
								onClick={async () => {
									if (await preserveAndClose()) onLinkAccounts();
								}}
							>
								{t("pwConnectTitle")}
							</Button>
						</div>
					</>
				)}
				{busy && stage !== "input" && (
					<div className="pw-smart-recognizing" role="status">
						<LoaderCircle className="pw-smart-spinner" />
						{t(busy === "ai" ? "pwSmartAiBusy" : "pwVaultBusy")}
						{busy === "ai" && (
							<Button onClick={cancelRecognition}>
								{t("pwSmartCancelRecognition")}
							</Button>
						)}
					</div>
				)}
			</div>
			{confirmation && (
				<Dialog
					className="pw-smart-confirm-dialog"
					title={t(
						confirmation === "ai"
							? "pwSmartAiConfirmTitle"
							: confirmation === "titles"
								? "pwSmartOrganizeTitle"
								: confirmation === "save"
									? "pwSmartSaveTitle"
									: confirmation === "close"
										? "pwSmartCloseTitle"
										: confirmation === "lock"
											? "pwSmartLockTitle"
											: confirmation === "model"
												? "pwSmartModelDetails"
												: "pwSmartReplaceTitle",
					)}
					onClose={() => setConfirmation(null)}
					closeDisabled={busy === "save" || draftClosing}
				>
					{(confirmation === "ai" || confirmation === "model") && (
						<>
							<div className="pw-smart-model-details">
								<strong>
									{(confirmation === "model" &&
									hasReview &&
									reviewOrigin.kind === "ai"
										? reviewOrigin.model
										: (connection?.model ?? settings?.model)) ??
										t("pwSmartModelMissing")}
								</strong>
								<span>
									{confirmation === "model" &&
									hasReview &&
									reviewOrigin.kind === "ai"
										? reviewOrigin.endpoint
										: (connection?.baseURL ?? settings?.baseURL ?? "")}
								</span>
							</div>
							<p>{t("pwSmartSendScope")}</p>
							<p>{t("pwSmartExcludedScope")}</p>
							{hasReview && source !== reviewSource && (
								<p className="notice">{t("pwSmartSourceChangedHint")}</p>
							)}
						</>
					)}
					{confirmation === "titles" && (
						<>
							<p>{t("pwSmartOrganizeScope")}</p>
							<div className="pw-smart-domain-table">
								<div>
									<strong>{t("pwSmartTempId")}</strong>
									<strong>{t("pwSmartDomain")}</strong>
								</div>
								{aiPreview.records.map((row) => (
									<div key={row.id}>
										<span>{row.id}</span>
										<span>{row.host}</span>
									</div>
								))}
							</div>
							<p>{t("pwSmartAiHint")}</p>
						</>
					)}
					{confirmation === "save" && (
						<>
							<p>{t("pwSmartSaveCount", { count: selected.length })}</p>
							<div className="pw-smart-save-counts">
								<span>
									{t("pwSmartAdded")}
									<strong>{saveNewCount}</strong>
								</span>
								<span>
									{t("pwSmartUpdated")}
									<strong>{selected.length - saveNewCount}</strong>
								</span>
							</div>
							<p>{t("pwSmartRemainingOpen", { count: pendingCount })}</p>
						</>
					)}
					{(confirmation === "close" || confirmation === "lock") && (
						<p>{t("pwSmartCloseKeepsDraft")}</p>
					)}
					{confirmation.startsWith("replace-") && (
						<p>{t("pwSmartSourceChangedHint")}</p>
					)}
					<div className="actions">
						<Button
							onClick={() => setConfirmation(null)}
							disabled={busy === "save" || draftClosing}
						>
							{t(
								confirmation === "close"
									? "pwSmartKeepReviewing"
									: confirmation === "save"
										? "pwSmartBackToReview"
										: "cancel",
							)}
						</Button>
						{confirmation === "close" && (
							<Button
								variant="ghost"
								disabled={draftClosing || busy === "save"}
								onClick={() => void preserveAndClose(false, true)}
							>
								{t("pwSmartCloseAndClear")}
							</Button>
						)}
						{confirmation !== "model" && (
							<Button
								variant="primary"
								disabled={
									draftClosing ||
									busy === "save" ||
									(!!busy &&
										confirmation !== "close" &&
										confirmation !== "lock") ||
									(confirmation === "save" && (outdated || !selected.length))
								}
								onClick={() => {
									const action = confirmation;
									if (action !== "close" && action !== "lock")
										setConfirmation(null);
									if (action === "ai" || action === "replace-ai")
										void recognizeWithAi();
									if (action === "titles") void organize();
									if (action === "save") void save();
									if (action === "close") void preserveAndClose();
									if (action === "lock") {
										void preserveAndClose(true);
									}
									if (action === "replace-local") recognize();
								}}
							>
								{t(
									confirmation === "ai"
										? "pwSmartConfirmRecognition"
										: confirmation === "titles"
											? "pwSmartConfirmOrganize"
											: confirmation === "save"
												? "pwSmartSaveTitle"
												: confirmation === "close"
													? "pwSmartCloseKeepDraft"
													: confirmation === "lock"
														? "pwSmartLockClose"
														: "pwSmartRecognize",
								)}
							</Button>
						)}
					</div>
				</Dialog>
			)}
		</Dialog>
	);
}
