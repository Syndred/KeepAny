import {
	ArrowRight,
	Check,
	ChevronLeft,
	ChevronRight,
	CircleCheck,
	Plus,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	VaultEntryDraft,
	VaultImportPreviewRow,
} from "../../../../packages/password-vault/src";
import {
	VAULT_IMPORT_MAX_ENTRIES,
	type VaultImportCandidate,
	type VaultImportIssue,
	validateVaultImportFields,
} from "../vault-import-model";
import {
	buildVaultImportSourceExcerpt,
	type VaultImportSourceExcerpt as SourceExcerpt,
} from "../vault-import-source";
import {
	copyVaultImportDraft,
	orphanedVaultImportTargets,
	resolveVaultImportTarget,
} from "../vault-import-orphan";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Select, SelectOption } from "./ui/select";
import {
	type VaultImportDraftField,
	VaultImportDraftFields,
} from "./VaultImportDraftFields";
import {
	type FragmentDraftState,
	VaultImportFragmentForm,
} from "./VaultImportFragmentForm";
import { VaultImportSourceExcerpt } from "./VaultImportSourceExcerpt";
import "../password-import-workspace.css";

export type WorkspaceChoice = {
	selected: boolean;
	action: "new" | "skip" | "update";
	targetId?: string;
};
export type WorkspacePreview = {
	revision: string;
	rows: ((VaultImportPreviewRow & { updateOnly?: boolean }) | undefined)[];
};
export type WorkspaceIssueGroup = {
	id: string;
	issues: VaultImportIssue[];
	excerpt: SourceExcerpt;
	sourceLine?: number;
	sourceSnapshot?: string;
};
type Filter = "pending" | "reviewed" | "all" | "duplicate";
export type WorkspaceDraftState = {
	filter: Filter;
	reviewedOrder?: string[];
	activeId: string;
	targetSelection: string;
	targetEdits: Record<
		string,
		{
			targetId: string | null;
			draft: VaultEntryDraft;
			edited: VaultImportDraftField[];
		}
	>;
	targetFor: string | null;
};
export type PasswordImportWorkspaceProps = {
	candidates: VaultImportCandidate[];
	choices: Record<string, WorkspaceChoice>;
	preview: WorkspacePreview | null;
	issueGroups: WorkspaceIssueGroup[];
	fragmentTargets: VaultImportCandidate[];
	reviewSource: string;
	savedCandidates: VaultImportCandidate[];
	busy: boolean;
	outdated: boolean;
	existing: { id: string; title: string; username: string }[];
	onDraft: (
		id: string,
		field: keyof VaultEntryDraft,
		value: string | string[],
	) => void;
	onChoice: (id: string, choice: WorkspaceChoice) => void;
	onAddAnother: (id?: string) => void;
	onRemoveCandidate: (id: string) => void;
	onRemoveFragment: (id: string) => void;
	onApplyFragment: (
		group: WorkspaceIssueGroup,
		targetId: string | null,
		draft: VaultEntryDraft,
	) => boolean;
	onOrganize: () => void;
	canOrganize?: boolean;
	organizeRecords?: { id: string; host: string }[];
	initialState?: WorkspaceDraftState;
	onStateChange?: (state: WorkspaceDraftState) => void;
	fragmentStates?: Record<string, FragmentDraftState>;
	onFragmentStateChange?: (groupId: string, state: FragmentDraftState) => void;
};
type Item = {
	id: string;
	candidate?: VaultImportCandidate;
	group?: WorkspaceIssueGroup;
	index: number;
};
const emptyChoice: WorkspaceChoice = { selected: false, action: "new" };
function blankDraft(): VaultEntryDraft {
	return {
		title: "",
		username: "",
		password: "",
		url: "",
		notes: "",
		linkedAssetIds: [],
	};
}
function cloneDraft(draft: VaultEntryDraft): VaultEntryDraft {
	return {
		...draft,
		linkedAssetIds: [...draft.linkedAssetIds],
		usernameAliases: draft.usernameAliases
			? [...draft.usernameAliases]
			: undefined,
	};
}

export function PasswordImportWorkspace(props: PasswordImportWorkspaceProps) {
	const { t } = useTranslation();
	const {
		candidates,
		choices,
		preview,
		issueGroups,
		fragmentTargets,
		reviewSource,
		savedCandidates,
		busy,
		outdated,
		existing,
		onDraft,
		onChoice,
		onAddAnother,
		onRemoveCandidate,
		onRemoveFragment,
		onApplyFragment,
		onOrganize,
		canOrganize = true,
		initialState,
		onStateChange,
		fragmentStates,
		onFragmentStateChange,
	} = props;
	const disabled = busy || outdated;
	const [filter, setFilter] = useState<Filter>(
		() =>
			initialState?.filter ??
			(candidates.length > 0 &&
			!issueGroups.length &&
			candidates.every((row) => choices[row.id]?.selected)
				? "reviewed"
				: "pending"),
	);
	const [activeId, setActiveId] = useState(initialState?.activeId ?? "");
	const [reviewedOrder, setReviewedOrder] = useState(
		initialState?.reviewedOrder ?? [],
	);
	const previousReviewed = useRef(
		new Set(
			candidates
				.filter((row) => choices[row.id]?.selected)
				.map((row) => row.id),
		),
	);
	const [removeTarget, setRemoveTarget] = useState<Item | null>(null);
	const [bulkOpen, setBulkOpen] = useState(false);
	const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());
	const [notice, setNotice] = useState("");
	const [attempted, setAttempted] = useState<string | null>(null);
	const [targetOpen, setTargetOpen] = useState(false);
	const [targetSelection, setTargetSelection] = useState(
		initialState?.targetSelection ?? "new",
	);
	const [targetEdits, setTargetEdits] = useState<
		WorkspaceDraftState["targetEdits"]
	>(() =>
		Object.fromEntries(
			Object.entries(initialState?.targetEdits ?? {}).map(([key, value]) => [
				key,
				{
					...value,
					draft: cloneDraft(value.draft),
					edited: [...value.edited],
				},
			]),
		),
	);
	const [targetFor, setTargetFor] = useState<string | null>(
		initialState?.targetFor ?? null,
	);
	const draftState = useMemo<WorkspaceDraftState>(
		() => ({
			filter,
			activeId,
			reviewedOrder,
			targetSelection,
			targetEdits,
			targetFor,
		}),
		[filter, activeId, reviewedOrder, targetSelection, targetEdits, targetFor],
	);
	useEffect(() => {
		onStateChange?.(draftState);
	}, [draftState, onStateChange]);
	const addedFrom = useRef<string | null>(null);
	const focusAddedId = useRef<string | null>(null);
	const previousIds = useRef(new Set(candidates.map((row) => row.id)));
	const editorRef = useRef<HTMLDivElement>(null);
	const reviewed = (row: VaultImportCandidate, index: number) => {
		const choice = choices[row.id];
		const status = preview?.rows[index];
		return (
			!!choice?.selected &&
			!!status &&
			status.status !== "duplicate" &&
			(choice.action === "new" ||
				(choice.action === "update" &&
					status.existingIds.includes(choice.targetId ?? "")))
		);
	};
	const reviewedCount = candidates.filter(reviewed).length;
	const pendingCount = candidates.length - reviewedCount + issueGroups.length;
	const items: Item[] = [
		...candidates.map((candidate, index) => ({
			id: candidate.id,
			candidate,
			index,
		})),
		...issueGroups.map((group, index) => ({
			id: `fragment:${group.id}`,
			group,
			index,
		})),
	];
	const filtered = items.filter((item) =>
		item.candidate
			? filter === "all" ||
				(filter === "reviewed"
					? reviewed(item.candidate, item.index) || item.id === activeId
					: filter === "duplicate"
						? preview?.rows[item.index]?.status === "duplicate"
						: !reviewed(item.candidate, item.index))
			: filter === "pending" || filter === "all",
	);
	const visible =
		filter === "reviewed"
			? [...filtered].sort((a, b) => {
					const aRank = reviewedOrder.indexOf(a.id);
					const bRank = reviewedOrder.indexOf(b.id);
					return (
						(aRank < 0
							? reviewedOrder.length + candidates.length - a.index
							: aRank) -
						(bRank < 0
							? reviewedOrder.length + candidates.length - b.index
							: bRank)
					);
				})
			: filtered;
	const active = visible.find((item) => item.id === activeId) ?? visible[0];
	const activeIndex = active
		? visible.findIndex((item) => item.id === active.id)
		: -1;
	const row = active?.candidate;
	const plan = active && row ? preview?.rows[active.index] : undefined;
	const duplicateCandidate =
		plan?.duplicateOfIndex !== undefined
			? candidates[plan.duplicateOfIndex]
			: undefined;
	const choice: WorkspaceChoice = row
		? (choices[row.id] ?? {
				selected: false,
				action: row.updateTargetId
					? "update"
					: plan?.status === "new"
						? "new"
						: "skip",
				...(row.updateTargetId ? { targetId: row.updateTargetId } : {}),
			})
		: emptyChoice;
	const unresolvedConflict =
		plan?.status === "conflict" &&
		(choice.action === "skip" ||
			(choice.action === "update" &&
				!plan.existingIds.includes(choice.targetId ?? "")) ||
			(choice.action === "new" && !!plan.updateOnly));
	const isReviewed = !!row && !!active && reviewed(row, active.index);
	const activeSource = row?.sourceSnapshot ?? reviewSource;
	const sourceCandidates = candidates.filter(
		(candidate) => candidate.sourceSnapshot === row?.sourceSnapshot,
	);
	const excerpt = row
		? buildVaultImportSourceExcerpt(
				activeSource,
				[
					row.sourceFields?.username?.line ??
						row.sourceFields?.password?.line ??
						row.sourceLine,
				],
				sourceCandidates,
				row,
			)
		: undefined;
	const currentTarget =
		row && targetFor?.startsWith(`${row.id}:`)
			? targetEdits[targetFor]
			: undefined;
	const target = resolveVaultImportTarget(
		currentTarget?.targetId,
		fragmentTargets,
	);
	const targetOrphaned = !!currentTarget?.targetId && !target;
	const orphanedTargets = orphanedVaultImportTargets(
		Object.entries(targetEdits).filter(
			([key]) => row && key.startsWith(`${row.id}:`),
		),
		fragmentTargets,
	);
	const targetReadonly = !!target?.updateTargetId;
	const bulkEligible = candidates.filter(
		(candidate, index) =>
			preview?.rows[index]?.status === "new" &&
			!reviewed(candidate, index) &&
			!validateVaultImportFields(candidate.draft).issues.length &&
			!!candidate.draft.title.trim(),
	);
	const reviewedIds = candidates
		.filter(reviewed)
		.map((candidate) => candidate.id)
		.join("\n");
	useEffect(() => {
		const ids = reviewedIds ? reviewedIds.split("\n") : [];
		const current = new Set(ids);
		const added = ids
			.filter((id) => !previousReviewed.current.has(id))
			.reverse();
		previousReviewed.current = current;
		setReviewedOrder((before) => {
			const next = [
				...new Set([...added, ...before, ...ids.slice().reverse()]),
			].filter((id) => current.has(id));
			return next.join("\n") === before.join("\n") ? before : next;
		});
	}, [reviewedIds]);

	useEffect(() => {
		if (active?.id && active.id !== activeId) setActiveId(active.id);
	}, [active?.id, activeId]);

	useEffect(() => {
		const newRows = candidates.filter(
			(candidate) => !previousIds.current.has(candidate.id),
		);
		previousIds.current = new Set(candidates.map((candidate) => candidate.id));
		if (addedFrom.current && newRows.length) {
			focusAddedId.current = newRows[newRows.length - 1].id;
			setFilter("pending");
			setActiveId(newRows[newRows.length - 1].id);
			addedFrom.current = null;
		}
	}, [candidates]);
	useEffect(() => {
		if (
			!focusAddedId.current ||
			active?.id !== focusAddedId.current ||
			disabled
		)
			return;
		const input = document.getElementById(
			`pw-smart-${focusAddedId.current}-title`,
		);
		if (input && editorRef.current?.contains(input)) {
			input.focus();
			focusAddedId.current = null;
		}
	}, [active?.id, disabled]);
	useEffect(() => {
		if (!notice) return;
		const timer = window.setTimeout(() => setNotice(""), 3200);
		return () => window.clearTimeout(timer);
	}, [notice]);
	function navigate(delta: number) {
		if (!visible.length) return;
		setActiveId(
			visible[(activeIndex + delta + visible.length) % visible.length].id,
		);
		setTargetFor(null);
		setAttempted(null);
	}
	function nextAfterReview() {
		const next = visible[activeIndex + 1] ?? visible[activeIndex - 1];
		if (next) setActiveId(next.id);
		setTargetFor(null);
	}
	function finish() {
		if (!row || !active || disabled) return;
		const valid =
			!!plan &&
			!!row.draft.title.trim() &&
			!validateVaultImportFields(row.draft).issues.length;
		if (!valid) {
			setAttempted(row.id);
			const field = !row.draft.title.trim() ? "title" : "url";
			const input = document.getElementById(`pw-smart-${row.id}-${field}`);
			input?.focus();
			return;
		}
		if (plan.status === "duplicate" || unresolvedConflict) return;
		onChoice(row.id, {
			...choice,
			action: plan.status === "new" ? "new" : choice.action,
			selected: true,
		});
		setNotice(t("pwWorkDone"));
		nextAfterReview();
	}
	function statusKey(candidate: VaultImportCandidate, index: number) {
		if (reviewed(candidate, index)) return "pwWorkReviewed";
		if (!candidate.draft.title.trim()) return "pwWorkMissingName";
		if (candidate.updateTargetId) return "pwWorkUpdate";
		const status = preview?.rows[index]?.status;
		return status === "conflict"
			? "pwWorkConflict"
			: status === "duplicate"
				? "pwWorkDuplicate"
				: status === "new"
					? "pwWorkPendingBadge"
					: "pwWorkInvalid";
	}
	function changeTarget() {
		if (!row) return;
		setTargetSelection(currentTarget?.targetId ?? row.id);
		setTargetOpen(true);
	}
	function confirmTarget() {
		if (!row) return;
		if (targetSelection === row.id) {
			setTargetFor(null);
			setTargetOpen(false);
			return;
		}
		const selected = resolveVaultImportTarget(targetSelection, fragmentTargets);
		const existingKey = `${row.id}:${targetSelection}`;
		const aliasKey = selected
			? Object.entries(targetEdits).find(
					([key, state]) =>
						key.startsWith(`${row.id}:`) &&
						resolveVaultImportTarget(state.targetId, fragmentTargets)?.id ===
							selected.id,
				)?.[0]
			: undefined;
		const key = targetEdits[existingKey]
			? existingKey
			: (aliasKey ?? `${row.id}:${selected?.id ?? "new"}`);
		setTargetEdits((current) =>
			current[key]
				? current
				: {
						...current,
						[key]: {
							targetId: selected?.id ?? null,
							draft: selected ? cloneDraft(selected.draft) : blankDraft(),
							edited: [],
						},
					},
		);
		setTargetFor(key);
		setTargetOpen(false);
	}
	function updateTarget(
		field: VaultImportDraftField,
		value: string | string[],
	) {
		if (
			!row ||
			!currentTarget ||
			!targetFor ||
			(targetReadonly && ["title", "username", "url"].includes(field))
		)
			return;
		setTargetEdits((current) => ({
			...current,
			[targetFor]: {
				...current[targetFor],
				draft: { ...current[targetFor].draft, [field]: value },
				edited: [...new Set([...current[targetFor].edited, field])],
			},
		}));
	}
	const targetDraft =
		currentTarget && target
			? {
					...cloneDraft(target.draft),
					...Object.fromEntries(
						currentTarget.edited
							.filter(
								(field) =>
									!targetReadonly ||
									!["title", "username", "url"].includes(field),
							)
							.map((field) => [field, currentTarget.draft[field]]),
					),
				}
			: currentTarget?.draft;
	const displayDraft = targetDraft ?? row?.draft;
	return (
		<div className="pw-import-workspace" data-view={filter}>
			<div className="pw-work-toolbar">
				<span role="status">
					{notice ||
						t(
							filter === "reviewed"
								? "pwWorkLatestReviewed"
								: "pwWorkReviewHint",
						)}
				</span>
				<Button
					disabled={disabled || candidates.length >= VAULT_IMPORT_MAX_ENTRIES}
					onClick={() => {
						addedFrom.current = "new";
						setTargetFor(null);
						onAddAnother();
					}}
				>
					<Plus size={18} />
					{t("pwWorkAddAccount")}
				</Button>
			</div>
			<aside className="pw-work-list" aria-label={t("pwWorkAll")}>
				<div
					className="pw-work-tabs"
					role="tablist"
					aria-label={t("pwSmartReviewProgress", {
						complete: reviewedCount,
						pending: pendingCount,
					})}
				>
					<button
						type="button"
						role="tab"
						aria-selected={filter === "pending"}
						onClick={() => {
							setFilter("pending");
							setActiveId("");
							setTargetFor(null);
						}}
					>
						{t("pwWorkPending")} <span>{pendingCount}</span>
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={filter === "reviewed"}
						onClick={() => {
							setFilter("reviewed");
							setActiveId("");
							setTargetFor(null);
						}}
					>
						{t("pwWorkReviewed")} <span>{reviewedCount}</span>
					</button>
				</div>
				{(filter === "all" || filter === "duplicate") && (
					<div className="pw-work-filter-label">
						{t(filter === "all" ? "pwWorkAll" : "pwWorkDuplicates")}
					</div>
				)}
				<div className="pw-work-list-scroll">
					{visible.map((item) => {
						const candidate = item.candidate;
						const key = candidate
							? statusKey(candidate, item.index)
							: "pwWorkSourceReview";
						return (
							<button
								type="button"
								key={item.id}
								className="pw-work-list-row"
								data-row-id={candidate?.id}
								data-source-group={item.group?.id}
								aria-current={active?.id === item.id ? "true" : undefined}
								onClick={() => {
									setActiveId(item.id);
									setTargetFor(null);
									setAttempted(null);
								}}
							>
								{candidate && reviewed(candidate, item.index) && (
									<span className="pw-work-reviewed-mark">
										<Check size={14} />
									</span>
								)}
								<span className="pw-work-row-identity">
									<strong>
										{candidate?.draft.title ||
											item.group?.excerpt.title ||
											t(candidate ? "pwVaultEntryNew" : "pwWorkFragment")}
									</strong>
									<span>
										{candidate
											? candidate.draft.username || t("pwWorkNoUsername")
											: item.group?.excerpt.username ||
												t("pwWorkLine", {
													line: item.group?.issues[0]?.lineNumber ?? 1,
												})}
									</span>
								</span>
								{!(candidate && reviewed(candidate, item.index)) && (
									<span className="pw-work-badge" data-status={key}>
										{t(key)}
									</span>
								)}
								<ChevronRight size={18} />
							</button>
						);
					})}
				</div>
				<div className="pw-work-list-footer">
					<Button
						className="pw-work-bulk"
						disabled={disabled || !bulkEligible.length}
						onClick={() => {
							setBulkIds(
								new Set(bulkEligible.map((candidate) => candidate.id)),
							);
							setBulkOpen(true);
						}}
					>
						<CircleCheck size={20} />
						{t("pwWorkBulk")}
					</Button>
					<Select
						contentClassName="pw-smart-select-menu"
						className="pw-work-more"
						aria-label={t("pwWorkMore")}
						value={t("pwWorkMore")}
						disabled={disabled}
						onValueChange={(value) => {
							if (value === "all") setFilter("all");
							if (value === "duplicate") setFilter("duplicate");
							if (value === "organize") onOrganize();
						}}
					>
						<SelectOption value="all">{t("pwWorkViewAll")}</SelectOption>
						<SelectOption value="duplicate">
							{t("pwWorkViewDuplicates")}
						</SelectOption>
						<SelectOption value="organize" disabled={!canOrganize}>
							{t("pwWorkOrganize")}
						</SelectOption>
					</Select>
				</div>
			</aside>
			<div className="pw-work-editor" ref={editorRef}>
				{!active && (
					<div className="pw-work-empty">
						<strong>{t("pwWorkEmpty")}</strong>
						<p>{t("pwWorkEmptyHint")}</p>
					</div>
				)}
				{row && excerpt && displayDraft && (
					<article className="pw-work-candidate" data-row-id={row.id}>
						<div className="pw-work-editor-heading">
							<h3>
								{currentTarget
									? t(
											currentTarget.targetId
												? "pwWorkFillTitle"
												: "pwWorkTargetNewTitle",
											{ name: displayDraft.title || t("pwVaultEntryNew") },
										)
									: t(
											!plan || plan.status === "conflict"
												? "pwWorkFillTitle"
												: "pwWorkReviewTitle",
											{ name: row.draft.title || t("pwVaultEntryNew") },
										)}
							</h3>
							<div className="pw-work-nav">
								<Button
									size="small"
									disabled={
										disabled || candidates.length >= VAULT_IMPORT_MAX_ENTRIES
									}
									onClick={() => {
										addedFrom.current = row.id;
										onAddAnother(row.id);
									}}
								>
									<Plus size={17} />
									{t("pwVaultAddAnotherAccount")}
								</Button>
								<span>
									{activeIndex + 1} / {visible.length}
								</span>
								<Button
									size="icon"
									aria-label={t("pwWorkPrevious")}
									onClick={() => navigate(-1)}
									disabled={disabled || visible.length < 2}
								>
									<ChevronLeft size={21} />
								</Button>
								<Button
									size="icon"
									aria-label={t("pwWorkNext")}
									onClick={() => navigate(1)}
									disabled={disabled || visible.length < 2}
								>
									<ChevronRight size={21} />
								</Button>
							</div>
						</div>
						{activeSource ? (
							<VaultImportSourceExcerpt
								key={`source:${row.id}`}
								source={activeSource}
								excerpt={excerpt}
								candidates={sourceCandidates}
								disabled={disabled}
								onChangeTarget={changeTarget}
							/>
						) : (
							<div className="actions">
								<Button
									size="small"
									variant="ghost"
									disabled={disabled}
									onClick={changeTarget}
								>
									{t("pwSmartFragmentChangeTarget")}
								</Button>
							</div>
						)}
						{targetOrphaned && (
							<p className="notice" role="status">
								{t("pwWorkOrphanHint")}
							</p>
						)}
						<VaultImportDraftFields
							key={
								currentTarget
									? `target:${row.id}:${currentTarget.targetId ?? "new"}`
									: row.id
							}
							idPrefix={
								currentTarget ? `pw-target-${row.id}` : `pw-smart-${row.id}`
							}
							draft={displayDraft}
							validationErrors={
								!currentTarget && attempted === row.id
									? {
											...(!row.draft.title.trim()
												? { title: t("pwWorkNameRequired") }
												: {}),
											...(validateVaultImportFields(row.draft).issues.some(
												(issue) => issue.code === "invalid-url",
											)
												? { url: t("pwSmartIssue_invalid-url") }
												: {}),
										}
									: undefined
							}
							disabled={disabled}
							readOnlyIdentity={
								currentTarget ? targetReadonly : !!row.updateTargetId
							}
							onChange={(field, value) =>
								currentTarget
									? updateTarget(field, value)
									: onDraft(row.id, field, value)
							}
						/>
						{!currentTarget && attempted === row.id && !plan && (
							<p className="pw-work-error" role="alert">
								{t("pwWorkRequired")}
							</p>
						)}
						{!currentTarget && plan?.status === "duplicate" && (
							<div className="pw-work-conflict-note pw-work-duplicate-note">
								<span>
									{t(
										duplicateCandidate
											? "pwWorkBatchDuplicateHint"
											: "pwWorkDuplicateHint",
									)}
								</span>
								{duplicateCandidate && (
									<Button
										size="small"
										disabled={disabled}
										onClick={() => {
											setFilter("all");
											setActiveId(duplicateCandidate.id);
											setTargetFor(null);
											setAttempted(null);
										}}
									>
										{t("pwWorkViewBatchDuplicate")}
									</Button>
								)}
							</div>
						)}
						{!currentTarget &&
							plan?.status === "conflict" &&
							!row.updateTargetId && (
								<div className="pw-work-conflict">
									<label className="field" htmlFor={`pw-action-${row.id}`}>
										<span>{t("pwWorkSaveMethod")}</span>
										<Select
											contentClassName="pw-smart-select-menu"
											id={`pw-action-${row.id}`}
											aria-label={t("pwWorkSaveMethod")}
											value={
												choice.action === "update"
													? `update:${choice.targetId}`
													: choice.action
											}
											disabled={disabled}
											onValueChange={(value) =>
												onChoice(
													row.id,
													value === "skip"
														? { selected: false, action: "skip" }
														: value === "new"
															? { selected: false, action: "new" }
															: {
																	selected: false,
																	action: "update",
																	targetId: value.slice(7),
																},
												)
											}
										>
											<SelectOption value="skip">
												{t("pwSmartKeepExisting")}
											</SelectOption>
											<SelectOption value="new" disabled={plan.updateOnly}>
												{t("pwSmartCreateSeparate")}
											</SelectOption>
											{plan.existingIds.map((id) => {
												const entry = existing.find((item) => item.id === id);
												return (
													<SelectOption key={id} value={`update:${id}`}>
														{t("pwWorkUpdateTarget", {
															name: entry?.title ?? t("pwVaultEntryNew"),
															username: entry?.username ?? "",
														})}
													</SelectOption>
												);
											})}
										</Select>
									</label>
									<p className="pw-work-conflict-note">
										{t(
											choice.action === "update"
												? "pwWorkUpdateHistory"
												: "pwWorkConflictHint",
										)}
									</p>
								</div>
							)}
						<div className="pw-work-editor-footer">
							<Button
								variant="danger"
								className="pw-work-delete"
								disabled={disabled}
								onClick={() => setRemoveTarget(active ?? null)}
							>
								<Trash2 size={17} />
								{t("pwWorkDelete")}
							</Button>
							{currentTarget ? (
								<>
									<Button
										variant="ghost"
										disabled={disabled}
										onClick={() => setTargetFor(null)}
									>
										{t("pwWorkTargetReturn")}
									</Button>
									<Button
										variant="primary"
										disabled={disabled}
										onClick={() => {
											const applied = onApplyFragment(
												{
													id: `target:${row.id}`,
													issues: [],
													excerpt,
													sourceLine: row.sourceLine,
													sourceSnapshot: activeSource,
												},
												targetOrphaned
													? null
													: (target?.id ?? currentTarget.targetId),
												copyVaultImportDraft(displayDraft),
											);
											if (applied) {
												setTargetFor(null);
												setNotice(t("pwWorkApplied"));
												if (target) setActiveId(target.id);
											}
										}}
									>
										{t(
											targetOrphaned
												? "pwWorkOrphanApply"
												: "pwWorkTargetApply",
										)}
									</Button>
								</>
							) : (
								<>
									{isReviewed && (
										<Button
											disabled={disabled}
											onClick={() => {
												onChoice(row.id, { ...choice, selected: false });
												setNotice(t("pwWorkUndone"));
												setFilter("pending");
											}}
										>
											{t("pwWorkUndo")}
										</Button>
									)}
									{!isReviewed && (
										<Button
											variant="primary"
											disabled={
												disabled ||
												plan?.status === "duplicate" ||
												unresolvedConflict
											}
											onClick={finish}
										>
											{t("pwWorkCompleteNext")}
											<ArrowRight size={20} />
										</Button>
									)}
								</>
							)}
						</div>
					</article>
				)}
				{issueGroups.map((group) => (
					<article
						key={group.id}
						className="pw-work-fragment"
						data-source-group={group.id}
						hidden={active?.group?.id !== group.id}
					>
						<div className="pw-work-editor-heading">
							<h3>
								{t("pwWorkFillTitle", {
									name: group.excerpt.title || t("pwWorkFragment"),
								})}
							</h3>
							<div className="pw-work-nav">
								<span>
									{activeIndex + 1} / {visible.length}
								</span>
								<Button
									size="icon"
									aria-label={t("pwWorkPrevious")}
									disabled={disabled || visible.length < 2}
									onClick={() => navigate(-1)}
								>
									<ChevronLeft size={20} />
								</Button>
								<Button
									size="icon"
									aria-label={t("pwWorkNext")}
									disabled={disabled || visible.length < 2}
									onClick={() => navigate(1)}
								>
									<ChevronRight size={20} />
								</Button>
							</div>
						</div>
						<VaultImportFragmentForm
							idPrefix={`pw-fragment-${group.id}`}
							source={reviewSource}
							excerpt={group.excerpt}
							fragmentText={reviewSource.slice(
								group.excerpt.selection.start,
								group.excerpt.selection.end,
							)}
							candidates={fragmentTargets}
							disabled={disabled}
							initialState={fragmentStates?.[group.id]}
							onStateChange={
								onFragmentStateChange
									? (state) => onFragmentStateChange(group.id, state)
									: undefined
							}
							onApply={(targetId, draft) =>
								onApplyFragment(group, targetId, draft)
							}
						/>
						<div className="pw-work-editor-footer">
							<Button
								variant="danger"
								className="pw-work-delete"
								disabled={disabled}
								onClick={() =>
									setRemoveTarget({
										id: `fragment:${group.id}`,
										group,
										index: 0,
									})
								}
							>
								<Trash2 size={17} />
								{t("pwWorkDelete")}
							</Button>
						</div>
					</article>
				))}
			</div>
			{removeTarget && (
				<Dialog
					title={t("pwWorkDeleteTitle")}
					className="pw-work-modal"
					onClose={() => setRemoveTarget(null)}
				>
					<p className="pw-work-modal-hint">{t("pwWorkDeleteHint")}</p>
					<div className="actions">
						<Button onClick={() => setRemoveTarget(null)}>{t("cancel")}</Button>
						<Button
							variant="danger"
							disabled={disabled}
							onClick={() => {
								if (disabled) return;
								if (removeTarget.candidate) {
									onRemoveCandidate(removeTarget.candidate.id);
									setTargetEdits((current) =>
										Object.fromEntries(
											Object.entries(current).filter(
												([key]) =>
													!key.startsWith(`${removeTarget.candidate?.id}:`),
											),
										),
									);
								} else if (removeTarget.group)
									onRemoveFragment(removeTarget.group.id);
								setTargetFor(null);
								setRemoveTarget(null);
								setNotice(t("pwWorkDeleted"));
							}}
						>
							{t("pwWorkDeleteConfirm")}
						</Button>
					</div>
				</Dialog>
			)}
			{bulkOpen && (
				<Dialog
					title={t("pwWorkBulk")}
					className="pw-work-modal"
					onClose={() => setBulkOpen(false)}
				>
					<p className="pw-work-modal-hint">
						{t("pwWorkBulkHint", { count: bulkEligible.length })}
					</p>
					<div className="pw-work-bulk-list">
						{bulkEligible.map((candidate) => (
							<label key={candidate.id}>
								<input
									type="checkbox"
									checked={bulkIds.has(candidate.id)}
									onChange={(event) =>
										setBulkIds((current) => {
											const next = new Set(current);
											if (event.target.checked) next.add(candidate.id);
											else next.delete(candidate.id);
											return next;
										})
									}
								/>
								<span>
									<strong>{candidate.draft.title}</strong>
									<span>
										{candidate.draft.username || t("pwWorkNoUsername")}
									</span>
								</span>
							</label>
						))}
					</div>
					<p className="pw-work-modal-footnote">{t("pwWorkBulkPreserved")}</p>
					<div className="actions">
						<Button onClick={() => setBulkOpen(false)}>
							{t("pwSmartBack")}
						</Button>
						<Button
							variant="primary"
							disabled={
								disabled ||
								!bulkEligible.some((candidate) => bulkIds.has(candidate.id))
							}
							onClick={() => {
								for (const candidate of bulkEligible)
									if (bulkIds.has(candidate.id))
										onChoice(candidate.id, { selected: true, action: "new" });
								setBulkOpen(false);
								setNotice(t("pwWorkDone"));
							}}
						>
							{t("pwWorkBulkConfirm")}
						</Button>
					</div>
				</Dialog>
			)}
			{targetOpen && (
				<Dialog
					title={t("pwWorkTargetTitle")}
					className="pw-work-modal"
					onClose={() => setTargetOpen(false)}
				>
					<div className="pw-work-target-list">
						<button
							type="button"
							aria-pressed={targetSelection === "new"}
							onClick={() => setTargetSelection("new")}
						>
							{t("pwWorkTargetNew")}
						</button>
						<p>{t("pwWorkTargetBatch")}</p>
						{candidates.map((candidate) => (
							<button
								type="button"
								aria-pressed={targetSelection === candidate.id}
								key={candidate.id}
								onClick={() => setTargetSelection(candidate.id)}
							>
								{candidate.draft.title || t("pwVaultEntryNew")} ·{" "}
								{candidate.draft.username || t("pwWorkNoUsername")}
							</button>
						))}
						{!!savedCandidates.length && <p>{t("pwWorkTargetSaved")}</p>}
						{savedCandidates
							.filter(
								(saved) =>
									!candidates.some(
										(candidate) =>
											candidate.updateTargetId === saved.updateTargetId,
									),
							)
							.map((candidate) => (
								<button
									type="button"
									aria-pressed={targetSelection === candidate.id}
									key={candidate.id}
									onClick={() => setTargetSelection(candidate.id)}
								>
									{candidate.draft.title} ·{" "}
									{candidate.draft.username || t("pwWorkNoUsername")}
								</button>
							))}
						{!!orphanedTargets.length && <p>{t("pwWorkOrphanTargets")}</p>}
						{orphanedTargets.map(([key, state]) => (
							<button
								type="button"
								aria-pressed={targetSelection === state.targetId}
								key={key}
								onClick={() => setTargetSelection(state.targetId as string)}
							>
								{t("pwWorkOrphanTarget", {
									name: state.draft.title || t("pwVaultEntryNew"),
								})}
								{" · "}
								{state.draft.username || t("pwWorkNoUsername")}
							</button>
						))}
					</div>
					<p className="pw-work-modal-footnote">{t("pwWorkTargetPreserved")}</p>
					<div className="actions">
						<Button onClick={() => setTargetOpen(false)}>{t("cancel")}</Button>
						<Button
							variant="primary"
							disabled={disabled}
							onClick={confirmTarget}
						>
							{t("pwWorkTargetConfirm")}
						</Button>
					</div>
				</Dialog>
			)}
		</div>
	);
}
