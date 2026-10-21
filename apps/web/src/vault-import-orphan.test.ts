import { describe, expect, it } from "vitest";
import type { VaultEntryDraft } from "../../../packages/password-vault/src";
import { type ImportDraft, readImportDraft } from "./vault-import-draft";
import type { VaultImportCandidate } from "./vault-import-model";
import {
	copyVaultImportDraft,
	orphanedVaultImportTargets,
	resolveVaultImportTarget,
} from "./vault-import-orphan";

function draft(title: string): VaultEntryDraft {
	return {
		title,
		username: " synthetic@example.test ",
		usernameAliases: [" another ", ""],
		password: "  Synthetic secret\r\nsecond line  ",
		url: "https://example.test",
		notes: "  Unapplied note\r\n保持填写  ",
		linkedAssetIds: ["asset-1"],
	};
}

function candidate(id: string, aliasIds?: string[]): VaultImportCandidate {
	return { id, aliasIds, sourceLine: 1, aiEligible: false, draft: draft(id) };
}

describe("recoverable edits for removed import targets", () => {
	it("finds current targets and saved aliases without classifying them as removed", () => {
		const saved = candidate("saved-1", ["old-candidate-1", "old-candidate-2"]);
		const targets = [candidate("current-1"), saved];
		expect(resolveVaultImportTarget("current-1", targets)?.id).toBe(
			"current-1",
		);
		expect(resolveVaultImportTarget("old-candidate-2", targets)).toBe(saved);
		expect(resolveVaultImportTarget(null, targets)).toBeUndefined();
		expect(resolveVaultImportTarget("missing", targets)).toBeUndefined();
		expect(
			orphanedVaultImportTargets(
				[
					["current", { targetId: "current-1" }],
					["alias", { targetId: "old-candidate-1" }],
					["new", { targetId: null }],
					["removed", { targetId: "removed-1" }],
				],
				targets,
			).map(([key]) => key),
		).toEqual(["removed"]);
	});

	it("keeps multiple removed target edits and the independent new draft through schema recovery", () => {
		const first = draft("Removed first");
		const second = draft("Removed second");
		const independent = draft("Independent new");
		const payload: ImportDraft = {
			version: 1,
			source: "Synthetic original source",
			reviewSource: "Synthetic original source",
			reviewVersion: 1,
			candidates: [],
			savedCandidates: [],
			issues: [],
			choices: {},
			stage: "review",
			mappedLines: [],
			reviewOrigin: { kind: "local" },
			receipt: null,
			manualSequence: 2,
			issueGroupIds: [],
			baseContentRevision: "content-1",
			workspaceState: {
				filter: "pending",
				activeId: "owner",
				targetSelection: "removed-1",
				targetFor: "owner:removed-1",
				targetEdits: {
					"owner:removed-1": {
						targetId: "removed-1",
						draft: first,
						edited: ["password", "notes"],
					},
					"owner:removed-2": {
						targetId: "removed-2",
						draft: second,
						edited: ["usernameAliases"],
					},
					"owner:new": {
						targetId: null,
						draft: independent,
						edited: ["title"],
					},
				},
			},
			fragmentStates: {
				fragment: {
					mode: "existing",
					targetId: "removed-1",
					expanded: true,
					drafts: {
						new: independent,
						"target:removed-1": first,
						"target:removed-2": second,
					},
					appended: ["target:removed-1"],
					editedFields: {
						new: ["title"],
						"target:removed-1": ["notes", "password"],
						"target:removed-2": ["usernameAliases"],
					},
				},
			},
		};
		const restored = readImportDraft(JSON.stringify(payload));
		expect(restored).toEqual(payload);
		const edits = restored?.workspaceState?.targetEdits ?? {};
		const missing = orphanedVaultImportTargets(Object.entries(edits), []);
		expect(missing.map(([key]) => key)).toEqual([
			"owner:removed-1",
			"owner:removed-2",
		]);
		expect(missing[0][1]).toBe(edits["owner:removed-1"]);
		expect(missing[1][1].draft).toEqual(second);
		expect(edits["owner:new"].draft).toEqual(independent);
		expect(restored?.fragmentStates.fragment).toEqual(
			payload.fragmentStates.fragment,
		);
	});

	it("copies a recovered draft as a new account without retaining an existing entry id or changing field values", () => {
		const original = { ...draft("Removed target"), id: "existing-entry" };
		const recovered = copyVaultImportDraft(original);
		expect(recovered).toEqual(draft("Removed target"));
		expect(recovered).not.toHaveProperty("id");
		expect(recovered.linkedAssetIds).not.toBe(original.linkedAssetIds);
		expect(recovered.usernameAliases).not.toBe(original.usernameAliases);
		expect(original.id).toBe("existing-entry");
	});
});
