import type { VaultEntryDraft } from "../../../packages/password-vault/src";
import {
	parseVaultImportLine,
	type VaultImportCandidate,
	type VaultImportSourceReference,
} from "./vault-import-model";
import {
	getVaultImportSourceSectionSelection,
	readVaultImportSourceRange,
	type VaultImportSourceExcerpt,
	type VaultImportSourceSelection,
} from "./vault-import-source";

export type VaultImportQuickFillField =
	| "title"
	| "username"
	| "usernameAliases"
	| "password"
	| "url"
	| "notes";

export type VaultImportQuickFillResult = {
	targetId: string | null;
	ambiguousTargetIds: string[];
	draft: VaultEntryDraft;
};

type ProvenReference = {
	field: VaultImportQuickFillField;
	reference: VaultImportSourceReference;
	value: string;
};

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

function provenReferences(
	source: string,
	candidate: VaultImportCandidate,
): ProvenReference[] {
	if (candidate.sourceSnapshot && candidate.sourceSnapshot !== source)
		return [];
	const references: ProvenReference[] = [];
	function add(
		field: VaultImportQuickFillField,
		reference: VaultImportSourceReference | undefined,
		expected: string | undefined,
	) {
		if (!reference || !expected || reference.start >= reference.end) return;
		const value = readVaultImportSourceRange(source, reference);
		if (
			value === undefined ||
			(value !== expected && !(field === "title" && value.trim() === expected))
		)
			return;
		references.push({ field, reference, value });
	}
	for (const field of [
		"title",
		"username",
		"password",
		"url",
		"notes",
	] as const)
		add(field, candidate.sourceFields?.[field], candidate.draft[field]);
	for (const reference of candidate.sourceUsernameAliases ?? []) {
		const value = readVaultImportSourceRange(source, reference);
		if (value && candidate.draft.usernameAliases?.includes(value))
			add("usernameAliases", reference, value);
	}
	return references;
}

function overlaps(
	left: VaultImportSourceSelection,
	right: VaultImportSourceSelection,
): boolean {
	return left.start < right.end && right.start < left.end;
}

function credential(reference: ProvenReference): boolean {
	return (
		reference.field === "username" ||
		reference.field === "usernameAliases" ||
		reference.field === "password"
	);
}

/** Default only a proven owner; shared platform names never merge small accounts. */
export function resolveVaultImportQuickFill(
	source: string,
	excerpt: VaultImportSourceExcerpt,
	candidates: VaultImportCandidate[],
): VaultImportQuickFillResult {
	const result: VaultImportQuickFillResult = {
		targetId: null,
		ambiguousTargetIds: [],
		draft: blankDraft(),
	};
	const section = getVaultImportSourceSectionSelection(
		source,
		excerpt.selection,
	);
	if (!section) return result;
	const focusLines = new Set(
		excerpt.rows.filter((row) => row.focused).map((row) => row.lineNumber),
	);
	const proven = [...new Map(candidates.map((row) => [row.id, row])).values()]
		.map((candidate) => ({
			candidate,
			references: provenReferences(source, candidate),
		}))
		.filter(({ references }) => references.length > 0);
	const direct = proven.filter(
		({ candidate, references }) =>
			candidate.reviewIssues?.some((issue) =>
				focusLines.has(issue.lineNumber),
			) ||
			references.some(
				(reference) =>
					credential(reference) &&
					overlaps(reference.reference, excerpt.selection),
			),
	);
	const matches = direct.length
		? direct
		: proven.filter(({ references }) =>
				references.some(
					(reference) =>
						credential(reference) && overlaps(reference.reference, section),
				),
			);
	if (matches.length === 1) {
		result.targetId = matches[0].candidate.id;
		result.draft = copyDraft(matches[0].candidate.draft);
		return result;
	}
	if (matches.length > 1)
		result.ambiguousTargetIds = matches.map(({ candidate }) => candidate.id);

	// The excerpt already applies secret masking. Only its proven visible identity
	// may seed a new row; unknown text, passwords, URLs and notes remain untouched.
	for (const field of ["title", "username"] as const) {
		const visible = excerpt[field];
		if (!visible || (field === "username" && matches.length > 1)) continue;
		const values = proven.flatMap(({ references }) =>
			references
				.filter(
					(reference) =>
						reference.field === field &&
						overlaps(reference.reference, section) &&
						reference.value === visible,
				)
				.map((reference) => reference.value),
		);
		if (!values.length) continue;
		if (
			matches.length > 1 &&
			!matches.every(({ references }) =>
				references.some(
					(reference) =>
						reference.field === field && reference.value === visible,
				),
			)
		)
			continue;
		result.draft[field] = values[0];
	}
	return result;
}

/** Called only after the user selects source text and names its destination field. */
export function readVaultImportSourceSelection(
	source: string,
	selection: VaultImportSourceSelection,
	options: {
		field?: VaultImportQuickFillField;
		candidates?: VaultImportCandidate[];
	} = {},
): string | undefined {
	const raw = readVaultImportSourceRange(source, selection);
	if (raw === undefined || selection.encoding !== undefined || !options.field)
		return raw;
	const field = options.field;
	const references = new Map<string, ProvenReference>();
	for (const candidate of options.candidates ?? []) {
		for (const reference of provenReferences(source, candidate)) {
			const sameField =
				reference.field === field ||
				((field === "username" || field === "usernameAliases") &&
					(reference.field === "username" ||
						reference.field === "usernameAliases"));
			if (
				!sameField ||
				reference.reference.start < selection.start ||
				reference.reference.end > selection.end
			)
				continue;
			references.set(
				`${reference.reference.start}:${reference.reference.end}:${reference.reference.encoding ?? "literal"}`,
				reference,
			);
		}
	}
	if (references.size === 1) return [...references.values()][0].value;
	if (references.size > 1 || /[\r\n]/.test(raw)) return raw;
	const parsed = parseVaultImportLine(raw);
	const destination = field === "usernameAliases" ? "username" : field;
	const fields = parsed.fields.filter(({ field }) => field === destination);
	if (!parsed.problem && fields.length === 1) return fields[0].value;
	return raw;
}
