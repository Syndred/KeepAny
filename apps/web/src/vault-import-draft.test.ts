import { describe, expect, it } from "vitest";
import type { VaultEntryDraft } from "../../../packages/password-vault/src";
import { type ImportDraft, readImportDraft } from "./vault-import-draft";

function entryDraft(overrides: Partial<VaultEntryDraft> = {}): VaultEntryDraft {
	return {
		title: "Synthetic app",
		username: "reader@example.test",
		password: "  synthetic-secret\r\nsecond line  ",
		url: "https://example.test/login?token=synthetic#fragment",
		notes: "Original note\r\n第二行",
		usernameAliases: ["Reader", " reader ", ""],
		linkedAssetIds: ["asset-synthetic"],
		...overrides,
	};
}

function importDraft(): ImportDraft {
	const source =
		"Synthetic app\r\nreader@example.test\r\n  synthetic-secret\r\nsecond line  \r\nUnmapped source";
	const targetDraft = entryDraft({
		notes: "Unapplied target edit\r\n保持空格  ",
	});
	return {
		version: 1,
		source: `${source}\r\nMore input not recognized yet`,
		reviewSource: source,
		reviewVersion: 7,
		candidates: [
			{
				id: "recognized-1",
				sourceLine: 1,
				draft: entryDraft(),
				aiEligible: false,
				needsReview: true,
				reviewIssues: [{ lineNumber: 6, code: "unrecognized-line" }],
				explicitlyEdited: true,
				sourceSnapshot: source,
				sourceFields: {
					title: { start: 0, end: 13, line: 1, endLine: 1 },
					username: { start: 15, end: 34, line: 2, endLine: 2 },
					password: { start: 36, end: 77, line: 3, endLine: 4 },
				},
				sourceUsernameAliases: [
					{ start: 15, end: 34, line: 2, endLine: 2, encoding: "json-string" },
				],
			},
			{
				id: "recognized-2",
				sourceLine: 7,
				draft: entryDraft({ title: "Google sign-in app", password: "" }),
				aiEligible: false,
				needsReview: true,
				updateTargetId: "stored-2",
				aliasIds: ["recognized-2-original"],
			},
			{
				id: "recognized-3",
				sourceLine: 10,
				draft: entryDraft({ title: "Skipped synthetic app" }),
				aiEligible: false,
			},
		],
		savedCandidates: [
			{
				id: "saved-1",
				sourceLine: 1,
				draft: entryDraft({ title: "Saved synthetic app" }),
				aiEligible: false,
				updateTargetId: "stored-1",
				aliasIds: ["saved-1-alias"],
			},
		],
		issues: [{ lineNumber: 6, code: "unrecognized-line" }],
		choices: {
			"recognized-1": { selected: true, action: "new" },
			"recognized-2": {
				selected: true,
				action: "update",
				targetId: "stored-2",
			},
			"recognized-3": { selected: false, action: "skip" },
		},
		stage: "review",
		mappedLines: [
			{
				lineNumber: 6,
				value: "Unmapped source",
				field: "",
				startsEntry: false,
			},
			{
				lineNumber: 7,
				value: "Google sign-in app",
				field: "title",
				startsEntry: true,
			},
		],
		reviewOrigin: {
			kind: "ai",
			model: "synthetic-model",
			endpoint: "https://ai.example.test/v1",
		},
		receipt: { added: 1, updated: 2, skipped: 1 },
		manualSequence: 4,
		issueGroupIds: [["source-group-key", "fragment-1"]],
		baseContentRevision: "content-revision-synthetic",
		workspaceState: {
			filter: "all",
			activeId: "recognized-1",
			targetSelection: "saved-1",
			targetFor: "recognized-1:saved-1",
			targetEdits: {
				"recognized-1:saved-1": {
					targetId: "saved-1",
					draft: targetDraft,
					edited: ["password", "notes", "usernameAliases"],
				},
				"recognized-1:new": {
					targetId: null,
					draft: entryDraft({ title: "Unapplied new account" }),
					edited: ["title"],
				},
			},
		},
		fragmentStates: {
			"fragment-1": {
				mode: "existing",
				targetId: "saved-1",
				drafts: {
					new: entryDraft({ title: "", username: "", password: "" }),
					"target:saved-1": targetDraft,
				},
				appended: ["target:saved-1"],
				editedFields: {
					new: ["title"],
					"target:saved-1": ["notes", "password", "usernameAliases"],
				},
				expanded: true,
			},
		},
	};
}

describe("encrypted import draft payload", () => {
	it("restores AI results, source references, review choices and unapplied workspace edits", () => {
		const draft = importDraft();
		const restored = readImportDraft(JSON.stringify(draft));

		expect(restored).toEqual(draft);
		expect(restored?.source).not.toBe(restored?.reviewSource);
		expect(restored?.choices["recognized-2"]).toEqual({
			selected: true,
			action: "update",
			targetId: "stored-2",
		});
		expect(restored?.workspaceState?.targetFor).toBe("recognized-1:saved-1");
		expect(
			restored?.workspaceState?.targetEdits["recognized-1:saved-1"],
		).toEqual(draft.workspaceState?.targetEdits["recognized-1:saved-1"]);
		expect(restored?.candidates[1].draft.password).toBe("");
	});

	it("preserves unfinished fragment fields, CRLF, aliases and per-target edits exactly", () => {
		const restored = readImportDraft(JSON.stringify(importDraft()));
		const fragment = restored?.fragmentStates["fragment-1"];

		expect(fragment?.mode).toBe("existing");
		expect(fragment?.targetId).toBe("saved-1");
		expect(fragment?.drafts["target:saved-1"].password).toBe(
			"  synthetic-secret\r\nsecond line  ",
		);
		expect(fragment?.drafts["target:saved-1"].notes).toBe(
			"Unapplied target edit\r\n保持空格  ",
		);
		expect(fragment?.drafts["target:saved-1"].usernameAliases).toEqual([
			"Reader",
			" reader ",
			"",
		]);
		expect(fragment?.drafts.new).toMatchObject({
			title: "",
			username: "",
			password: "",
		});
		expect(fragment?.appended).toEqual(["target:saved-1"]);
		expect(fragment?.editedFields).toEqual({
			new: ["title"],
			"target:saved-1": ["notes", "password", "usernameAliases"],
		});
	});

	it("accepts compound workspace and fragment keys built from valid maximum-length IDs", () => {
		const draft = importDraft();
		const candidateId = "c".repeat(256);
		const targetId = "t".repeat(256);
		const workspaceKey = `${candidateId}:${targetId}`;
		const fragmentKey = `target:${targetId}`;
		draft.workspaceState = {
			filter: "pending",
			activeId: `fragment:${candidateId}`,
			targetSelection: targetId,
			targetFor: workspaceKey,
			targetEdits: {
				[workspaceKey]: { targetId, draft: entryDraft(), edited: ["notes"] },
			},
		};
		draft.fragmentStates[candidateId] = {
			mode: "existing",
			targetId,
			drafts: { [fragmentKey]: entryDraft() },
			appended: [fragmentKey],
			editedFields: { [fragmentKey]: ["notes"] },
			expanded: false,
		};

		expect(readImportDraft(JSON.stringify(draft))).toEqual(draft);
	});

	it("returns null when no encrypted draft exists", () => {
		expect(readImportDraft(null)).toBeNull();
	});

	it("rejects unsupported versions and malformed JSON", () => {
		expect(() =>
			readImportDraft(JSON.stringify({ ...importDraft(), version: 2 })),
		).toThrow("vault-invalid");
		for (const value of ["", "{", '{"version":1', "null", "[]"]) {
			expect(() => readImportDraft(value)).toThrow();
		}
	});

	it.each([
		[
			"source length",
			(draft: ImportDraft) => ({
				...draft,
				source: "x".repeat(2 * 1024 * 1024 + 1),
			}),
		],
		[
			"candidate count",
			(draft: ImportDraft) => ({
				...draft,
				candidates: Array.from({ length: 201 }, (_, index) => ({
					...draft.candidates[0],
					id: `candidate-${index}`,
				})),
			}),
		],
		[
			"password length",
			(draft: ImportDraft) => ({
				...draft,
				candidates: [
					{
						...draft.candidates[0],
						draft: entryDraft({ password: "x".repeat(65537) }),
					},
				],
			}),
		],
		[
			"unfinished aliases count",
			(draft: ImportDraft) => ({
				...draft,
				fragmentStates: {
					"fragment-1": {
						...draft.fragmentStates["fragment-1"],
						drafts: {
							new: entryDraft({ usernameAliases: Array(21).fill("alias") }),
						},
					},
				},
			}),
		],
		[
			"choice record size",
			(draft: ImportDraft) => ({
				...draft,
				choices: Object.fromEntries(
					Array.from({ length: 2001 }, (_, index) => [
						`candidate-${index}`,
						{ selected: false, action: "new" },
					]),
				),
			}),
		],
		[
			"invalid source line",
			(draft: ImportDraft) => ({
				...draft,
				issues: [{ lineNumber: 0, code: "invalid-field" }],
			}),
		],
		[
			"invalid save choice",
			(draft: ImportDraft) => ({
				...draft,
				choices: { "recognized-1": { selected: true, action: "unsupported" } },
			}),
		],
	])("rejects %s outside the supported draft contract", (_name, invalidate) => {
		expect(() =>
			readImportDraft(JSON.stringify(invalidate(importDraft()))),
		).toThrow("vault-invalid");
	});

	it("rejects payloads over the encrypted draft UTF-8 byte budget before parsing JSON", () => {
		const oversizedUtf8 = "界".repeat(Math.floor((16 * 1024 * 1024) / 3) + 1);

		expect(oversizedUtf8.length).toBeLessThan(16 * 1024 * 1024);
		expect(() => readImportDraft(oversizedUtf8)).toThrow("vault-size");
	});
});
