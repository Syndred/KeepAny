import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { VaultEntryDraft } from "../../../../packages/password-vault/src";
import {
	type VaultImportCandidate,
	withFilledVaultIdentifiers,
} from "../vault-import-model";
import { resolveVaultImportQuickFill } from "../vault-import-quick-fill";
import type { VaultImportSourceExcerpt as SourceExcerpt } from "../vault-import-source";
import { Button } from "./ui/button";
import { Select, SelectOption } from "./ui/select";
import {
	type VaultImportDraftField,
	VaultImportDraftFields,
} from "./VaultImportDraftFields";
import { VaultImportSourceExcerpt } from "./VaultImportSourceExcerpt";

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

function copyDraft(draft: VaultEntryDraft): VaultEntryDraft {
	const copy = {
		...draft,
		linkedAssetIds: [...draft.linkedAssetIds],
		...(draft.usernameAliases
			? { usernameAliases: [...draft.usernameAliases] }
			: {}),
	};
	delete copy.id;
	return copy;
}

export function VaultImportFragmentForm({
	idPrefix,
	fragmentText,
	source,
	excerpt,
	candidates,
	disabled,
	onApply,
}: {
	idPrefix: string;
	fragmentText: string;
	source: string;
	excerpt: SourceExcerpt;
	candidates: VaultImportCandidate[];
	disabled: boolean;
	onApply: (targetId: string | null, draft: VaultEntryDraft) => boolean;
}) {
	const { t } = useTranslation();
	const [initial] = useState(() =>
		resolveVaultImportQuickFill(source, excerpt, candidates),
	);
	const [expanded, setExpanded] = useState(true);
	const [choosingTarget, setChoosingTarget] = useState(false);
	const [mode, setMode] = useState<"new" | "existing">(
		initial.targetId ? "existing" : "new",
	);
	const [targetId, setTargetId] = useState(initial.targetId ?? "");
	const [drafts, setDrafts] = useState<Map<string, VaultEntryDraft>>(() => {
		const newDraft = initial.targetId
			? {
					...blankDraft(),
					title: initial.draft.title,
					username: initial.draft.username,
				}
			: initial.draft;
		const result = new Map([["new", newDraft]]);
		if (initial.targetId)
			result.set(`target:${initial.targetId}`, initial.draft);
		return result;
	});
	const [appended, setAppended] = useState<Set<string>>(() => new Set());
	const [editedFields, setEditedFields] = useState<
		Map<string, Set<VaultImportDraftField>>
	>(() => new Map());
	const target = candidates.find(
		(candidate) =>
			candidate.id === targetId || candidate.aliasIds?.includes(targetId),
	);
	const draftKey = mode === "new" ? "new" : `target:${targetId}`;
	const savedDraft = drafts.get(draftKey);
	const readOnlyIdentity =
		mode === "existing" &&
		!!target &&
		"updateTargetId" in target &&
		!!target.updateTargetId;
	const currentDraft =
		mode === "existing" && target ? copyDraft(target.draft) : savedDraft;
	const draft =
		mode === "existing" && currentDraft && savedDraft
			? {
					...currentDraft,
					...Object.fromEntries(
						[...(editedFields.get(draftKey) ?? [])]
							.filter(
								(field) =>
									!readOnlyIdentity ||
									(field !== "title" &&
										field !== "username" &&
										field !== "url"),
							)
							.map((field) => [field, savedDraft[field]]),
					),
				}
			: currentDraft;
	const canEdit = mode === "new" || !!target;
	const hasContent =
		!!draft &&
		(["title", "username", "password", "url", "notes"] as const).some(
			(field) => draft[field].length > 0,
		);
	const hasChanges =
		mode === "new" ||
		(!!draft &&
			!!target &&
			((["title", "username", "password", "url", "notes"] as const).some(
				(field) => draft[field] !== target.draft[field],
			) ||
				JSON.stringify(
					withFilledVaultIdentifiers(draft).usernameAliases ?? [],
				) !== JSON.stringify(target.draft.usernameAliases ?? [])));

	function selectTarget(nextId: string) {
		if (nextId === "new") {
			setMode("new");
			return;
		}
		setMode("existing");
		setTargetId(nextId);
		const nextTarget = candidates.find((candidate) => candidate.id === nextId);
		if (!nextTarget) return;
		setDrafts((current) => {
			const nextKey = `target:${nextId}`;
			if (current.has(nextKey)) return current;
			const next = new Map(current);
			next.set(nextKey, copyDraft(nextTarget.draft));
			return next;
		});
	}

	function changeField(field: VaultImportDraftField, value: string | string[]) {
		if (
			readOnlyIdentity &&
			(field === "title" || field === "username" || field === "url")
		)
			return;
		setDrafts((current) => {
			const currentDraft = current.get(draftKey);
			if (!currentDraft) return current;
			const next = new Map(current);
			next.set(draftKey, { ...currentDraft, [field]: value });
			return next;
		});
		setEditedFields((current) => {
			const next = new Map(current);
			next.set(draftKey, new Set(current.get(draftKey)).add(field));
			return next;
		});
	}

	function addSourceToNotes() {
		if (!draft || !canEdit || !fragmentText || appended.has(draftKey)) return;
		changeField(
			"notes",
			draft.notes ? `${draft.notes}\n\n${fragmentText}` : fragmentText,
		);
		setAppended((current) => new Set(current).add(draftKey));
	}

	return (
		<div
			className="pw-smart-fragment-form"
			data-expanded={expanded}
			data-completion-target={mode === "new" ? "new" : (target?.id ?? targetId)}
		>
			<div className="pw-smart-quick-layout">
				<VaultImportSourceExcerpt
					excerpt={excerpt}
					source={source}
					candidates={candidates}
					disabled={disabled}
					readOnlyIdentity={readOnlyIdentity}
					onAssign={(field, value) => {
						if (!draft) return;
						if (field === "usernameAliases")
							changeField(field, [...(draft.usernameAliases ?? []), value]);
						else
							changeField(
								field,
								field === "notes" && draft.notes
									? `${draft.notes}\n\n${value}`
									: value,
							);
					}}
				/>
				{!expanded ? (
					<Button
						type="button"
						onClick={() => setExpanded(true)}
						disabled={disabled}
						aria-expanded={false}
						aria-controls={`${idPrefix}-editor`}
					>
						{t("pwSmartFragmentFill")}
					</Button>
				) : (
					<div className="pw-smart-fragment-editor" id={`${idPrefix}-editor`}>
						<div className="pw-smart-fragment-heading">
							<strong>{t("pwSmartFragmentFill")}</strong>
							<Button
								type="button"
								variant="ghost"
								size="small"
								disabled={disabled}
								onClick={() => setChoosingTarget((value) => !value)}
								aria-expanded={choosingTarget}
								aria-controls={`${idPrefix}-target-picker`}
							>
								{t("pwSmartFragmentChangeTarget")}
							</Button>
						</div>
						{choosingTarget && (
							<label
								className="field pw-smart-target-picker"
								id={`${idPrefix}-target-picker`}
								htmlFor={`${idPrefix}-target`}
							>
								<span>{t("pwSmartFragmentTarget")}</span>
								<Select
									id={`${idPrefix}-target`}
									value={mode === "new" ? "new" : (target?.id ?? targetId)}
									onValueChange={selectTarget}
									disabled={disabled}
								>
									<SelectOption value="new">
										{t("pwSmartFragmentNew")}
									</SelectOption>
									{candidates.map((candidate, index) => (
										<SelectOption key={candidate.id} value={candidate.id}>
											{t("pwSmartRow", { count: index + 1 })} ·{" "}
											{candidate.draft.title || t("pwVaultEntryNew")}
											{candidate.draft.username
												? ` · ${candidate.draft.username}`
												: ""}
										</SelectOption>
									))}
								</Select>
							</label>
						)}
						{draft && canEdit && (
							<VaultImportDraftFields
								key={draftKey}
								idPrefix={idPrefix}
								draft={draft}
								disabled={disabled}
								readOnlyIdentity={readOnlyIdentity}
								onChange={changeField}
							/>
						)}
						{mode === "existing" && target && !hasChanges && (
							<p className="pw-smart-hint">{t("pwSmartFragmentNoChange")}</p>
						)}
						<div className="actions pw-smart-fragment-actions">
							<Button
								type="button"
								variant="ghost"
								size="small"
								onClick={addSourceToNotes}
								disabled={
									disabled ||
									!canEdit ||
									!draft ||
									!fragmentText ||
									appended.has(draftKey)
								}
							>
								{t(
									appended.has(draftKey)
										? "pwSmartFragmentNotesAdded"
										: "pwSmartFragmentAddNotes",
								)}
							</Button>
							<Button
								type="button"
								variant="primary"
								onClick={() => {
									if (!draft || !canEdit || !hasContent || !hasChanges) return;
									const applyTargetId = mode === "new" ? null : target?.id;
									if (applyTargetId === undefined) return;
									if (onApply(applyTargetId, copyDraft(draft)))
										setExpanded(false);
								}}
								disabled={disabled || !canEdit || !hasContent || !hasChanges}
							>
								{t("pwSmartFragmentApply")}
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="small"
								onClick={() => setExpanded(false)}
								disabled={disabled}
								aria-expanded={true}
								aria-controls={`${idPrefix}-editor`}
							>
								{t("pwSmartFragmentCollapse")}
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
