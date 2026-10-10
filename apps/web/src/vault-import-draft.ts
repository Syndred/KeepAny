import { z } from "zod";
import type { WorkspaceDraftState } from "./components/PasswordImportWorkspace";
import type { FragmentDraftState } from "./components/VaultImportFragmentForm";
import type {
	VaultImportCandidate,
	VaultImportIssue,
} from "./vault-import-model";
import type { VaultMappedLine } from "./vault-import-mapping";

export type ImportDraft = {
	version: 1;
	source: string;
	reviewSource: string;
	reviewVersion: number;
	candidates: VaultImportCandidate[];
	savedCandidates: VaultImportCandidate[];
	issues: VaultImportIssue[];
	choices: Record<
		string,
		{ selected: boolean; action: "new" | "skip" | "update"; targetId?: string }
	>;
	stage: "input" | "mapping" | "review" | "saved";
	mappedLines: VaultMappedLine[];
	reviewOrigin:
		| { kind: "local" | "manual" }
		| { kind: "ai"; model: string; endpoint: string };
	receipt: { added: number; updated: number; skipped: number } | null;
	manualSequence: number;
	issueGroupIds: [string, string][];
	baseContentRevision: string | null;
	workspaceState?: WorkspaceDraftState;
	fragmentStates: Record<string, FragmentDraftState>;
};
const id = z.string().max(256);
const key = z.string().max(2048);
const text = z.string().max(2 * 1024 * 1024);
const field = z.enum([
	"title",
	"username",
	"usernameAliases",
	"password",
	"url",
	"notes",
]);
const draft = z.object({
	title: z.string().max(256),
	username: z.string().max(1024),
	password: z.string().max(65536),
	url: z.string().max(4096),
	notes: z.string().max(65536),
	usernameAliases: z.array(z.string().max(1024)).max(20).optional(),
	linkedAssetIds: z.array(id).max(100),
});
const issue = z.object({
	lineNumber: z.number().int().min(1).max(2000000),
	code: z.enum([
		"unknown-field",
		"unrecognized-line",
		"ambiguous-line",
		"duplicate-field",
		"missing-password",
		"missing-identity",
		"invalid-field",
		"invalid-url",
		"invalid-csv",
		"unsupported-type",
	]),
});
const reference = z.object({
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative(),
	line: z.number().int().positive(),
	endLine: z.number().int().positive(),
	encoding: z.literal("json-string").optional(),
});
const candidate = z.object({
	id,
	sourceLine: z.number().int().positive(),
	draft,
	aiEligible: z.boolean(),
	needsReview: z.boolean().optional(),
	reviewIssues: z.array(issue).max(10000).optional(),
	updateTargetId: id.optional(),
	aliasIds: z.array(id).max(200).optional(),
	explicitlyEdited: z.boolean().optional(),
	sourceSnapshot: text.optional(),
	sourceFields: z
		.object({
			title: reference.optional(),
			username: reference.optional(),
			password: reference.optional(),
			url: reference.optional(),
			notes: reference.optional(),
		})
		.optional(),
	sourceUsernameAliases: z.array(reference).max(20).optional(),
});
const record = <T extends z.ZodType>(value: T) =>
	z.record(key, value).refine((value) => Object.keys(value).length <= 2000);
const workspace = z.object({
	filter: z.enum(["pending", "reviewed", "all", "duplicate"]),
	activeId: key,
	targetFor: key.nullable(),
	targetSelection: key,
	targetEdits: record(
		z.object({ targetId: id.nullable(), draft, edited: z.array(field).max(6) }),
	),
});
const fragment = z.object({
	mode: z.enum(["new", "existing"]),
	targetId: key,
	drafts: record(draft),
	appended: z.array(key).max(2000),
	editedFields: record(z.array(field).max(6)),
	expanded: z.boolean(),
});
const schema = z.object({
	version: z.literal(1),
	source: text,
	reviewSource: text,
	reviewVersion: z.number().int().nonnegative(),
	candidates: z.array(candidate).max(200),
	savedCandidates: z.array(candidate).max(200),
	issues: z.array(issue).max(10000),
	choices: record(
		z.object({
			selected: z.boolean(),
			action: z.enum(["new", "skip", "update"]),
			targetId: id.optional(),
		}),
	),
	stage: z.enum(["input", "mapping", "review", "saved"]),
	mappedLines: z
		.array(
			z.object({
				lineNumber: z.number().int().positive(),
				value: text,
				field: z.enum([
					"",
					"ignore",
					"title",
					"username",
					"password",
					"url",
					"notes",
				]),
				startsEntry: z.boolean(),
			}),
		)
		.max(2000),
	reviewOrigin: z.union([
		z.object({ kind: z.enum(["local", "manual"]) }),
		z.object({
			kind: z.literal("ai"),
			model: z.string().max(1024),
			endpoint: z.string().max(4096),
		}),
	]),
	receipt: z
		.object({
			added: z.number().int().nonnegative(),
			updated: z.number().int().nonnegative(),
			skipped: z.number().int().nonnegative(),
		})
		.nullable(),
	manualSequence: z.number().int().nonnegative(),
	issueGroupIds: z.array(z.tuple([id, id])).max(10000),
	baseContentRevision: id.nullable(),
	workspaceState: workspace.optional(),
	fragmentStates: record(fragment),
});

export function readImportDraft(value: string | null): ImportDraft | null {
	if (value === null) return null;
	// Never log values or parse diagnostics: this payload includes passwords.
	if (new TextEncoder().encode(value).byteLength > 16 * 1024 * 1024)
		throw Error("vault-size");
	const parsed = schema.safeParse(JSON.parse(value));
	if (!parsed.success) throw Error("vault-invalid");
	return parsed.data as ImportDraft;
}
