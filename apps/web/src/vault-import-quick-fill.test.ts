import { describe, expect, it } from "vitest";
import type {
	VaultImportCandidate,
	VaultImportSourceReference,
} from "./vault-import-model";
import {
	readVaultImportSourceSelection,
	resolveVaultImportQuickFill,
} from "./vault-import-quick-fill";
import {
	buildVaultImportSourceExcerpt,
	getVaultImportSourceLineSelection,
	getVaultImportSourceSectionSelection,
	readVaultImportSourceRange,
} from "./vault-import-source";

function reference(
	source: string,
	value: string,
	encoding?: "json-string",
): VaultImportSourceReference {
	const start = source.indexOf(value);
	return {
		start,
		end: start + value.length,
		line: source.slice(0, start).split(/\r\n|\r|\n/).length,
		endLine: source.slice(0, start + value.length).split(/\r\n|\r|\n/).length,
		...(encoding ? { encoding } : {}),
	};
}

function candidate(
	source: string,
	id: string,
	username: string,
	password = "",
): VaultImportCandidate {
	return {
		id,
		sourceLine: 1,
		aiEligible: false,
		draft: {
			title: "Example",
			username,
			password,
			url: "",
			notes: "",
			linkedAssetIds: [],
		},
		sourceFields: {
			title: reference(source, "Example"),
			...(username ? { username: reference(source, username) } : {}),
			...(password ? { password: reference(source, password) } : {}),
		},
	};
}

describe("password import quick completion", () => {
	it("edits the unique account in the fragment with all reviewed values and isolated array copies", () => {
		const source = "Example\nreader@example.test\nhandle\nunknown information";
		const owner = candidate(source, "owner", "reader@example.test");
		owner.draft.usernameAliases = ["handle"];
		owner.draft.notes = "manually reviewed note";
		owner.draft.linkedAssetIds = ["asset-one"];
		owner.draft.id = "stored-entry";
		owner.sourceUsernameAliases = [reference(source, "handle")];
		const excerpt = buildVaultImportSourceExcerpt(source, [4], [owner]);
		const fill = resolveVaultImportQuickFill(source, excerpt, [owner]);
		expect(fill.targetId).toBe("owner");
		expect(fill.ambiguousTargetIds).toEqual([]);
		expect(fill.draft).toEqual({
			...owner.draft,
			id: undefined,
		});
		expect(fill.draft).not.toHaveProperty("id");
		fill.draft.usernameAliases?.push("next-handle");
		fill.draft.linkedAssetIds.push("asset-two");
		expect(owner.draft.usernameAliases).toEqual(["handle"]);
		expect(owner.draft.linkedAssetIds).toEqual(["asset-one"]);
	});

	it("never selects the nearest small account under a shared heading", () => {
		const source =
			"Example\none@example.test\none-password\ntwo@example.test\ntwo-password\nunknown information";
		const first = candidate(source, "one", "one@example.test", "one-password");
		const second = candidate(source, "two", "two@example.test", "two-password");
		const excerpt = buildVaultImportSourceExcerpt(source, [6], [first, second]);
		const fill = resolveVaultImportQuickFill(source, excerpt, [first, second]);
		expect(fill.targetId).toBeNull();
		expect(fill.ambiguousTargetIds).toEqual(["one", "two"]);
		expect(fill.draft).toMatchObject({
			title: "Example",
			username: "",
			password: "",
			notes: "",
		});
	});

	it("uses the focused credential span to choose the correct shared-heading account", () => {
		const source =
			"Example\none@example.test\none-password\ntwo@example.test\ntwo-password";
		const first = candidate(source, "one", "one@example.test", "one-password");
		const second = candidate(source, "two", "two@example.test", "two-password");
		const excerpt = buildVaultImportSourceExcerpt(source, [4], [first, second]);
		const fill = resolveVaultImportQuickFill(source, excerpt, [first, second]);
		expect(fill.targetId).toBe("two");
		expect(fill.draft.password).toBe("two-password");
	});

	it("uses an explicit review issue before section proximity and keeps conflicting owners explicit", () => {
		const source =
			"Example\none@example.test\none-password\ntwo@example.test\nunknown information";
		const first = candidate(source, "one", "one@example.test", "one-password");
		const second = candidate(source, "two", "two@example.test");
		second.reviewIssues = [{ lineNumber: 5, code: "missing-password" }];
		const excerpt = buildVaultImportSourceExcerpt(source, [5], [first, second]);
		expect(
			resolveVaultImportQuickFill(source, excerpt, [first, second]).targetId,
		).toBe("two");
		first.reviewIssues = [{ lineNumber: 5, code: "unknown-field" }];
		expect(
			resolveVaultImportQuickFill(source, excerpt, [first, second])
				.ambiguousTargetIds,
		).toEqual(["one", "two"]);
	});

	it("does not carry another account across a blank section or rely on a shared title anchor", () => {
		const source =
			"Example\r\none@example.test\r\none-password\r\n\r\ntwo@example.test\r\nunknown information";
		const first = candidate(source, "one", "one@example.test", "one-password");
		const second = candidate(source, "two", "two@example.test");
		const excerpt = buildVaultImportSourceExcerpt(source, [6], [first, second]);
		const fill = resolveVaultImportQuickFill(source, excerpt, [first, second]);
		expect(fill.targetId).toBe("two");
		expect(fill.draft).toMatchObject({
			title: "Example",
			username: "two@example.test",
			password: "",
		});
	});

	it("leaves unrelated unknown fragments empty rather than guessing their password or identity", () => {
		const source =
			"Example\nreader@example.test\nknown-password\n\nunknown-secret";
		const owner = candidate(
			source,
			"owner",
			"reader@example.test",
			"known-password",
		);
		const excerpt = buildVaultImportSourceExcerpt(source, [5], [owner]);
		const fill = resolveVaultImportQuickFill(source, excerpt, [owner]);
		expect(fill.targetId).toBeNull();
		expect(
			Object.values(fill.draft).filter((value) => typeof value === "string"),
		).toEqual(["", "", "", "", ""]);
	});

	it("seeds only a proven JSON identity on a new row, preserving its declared decoding", () => {
		const source = '"Example"\nunknown-secret';
		const owner = candidate(source, "heading", "");
		owner.sourceFields = {
			title: reference(source, '"Example"', "json-string"),
		};
		const excerpt = buildVaultImportSourceExcerpt(source, [2], [owner]);
		const fill = resolveVaultImportQuickFill(source, excerpt, [owner]);
		expect(fill.targetId).toBeNull();
		expect(fill.draft).toMatchObject({
			title: "Example",
			username: "",
			password: "",
			notes: "",
		});
		delete owner.sourceFields.title?.encoding;
		const literal = buildVaultImportSourceExcerpt(source, [2], [owner]);
		expect(
			resolveVaultImportQuickFill(source, literal, [owner]).draft.title,
		).toBe("");
	});

	it("does not seed an identity that the excerpt masks as private text", () => {
		const source = "Example\nunknown information";
		const owner = candidate(source, "heading", "");
		owner.draft.notes = "Example";
		const excerpt = buildVaultImportSourceExcerpt(source, [2], [owner]);
		expect(excerpt.title).toBeUndefined();
		expect(
			resolveVaultImportQuickFill(source, excerpt, [owner]).draft.title,
		).toBe("");
	});

	it("ignores stale snapshots and malformed references even when a review issue matches", () => {
		const source = "Example\nreader@example.test\nunknown information";
		const owner = candidate(source, "owner", "reader@example.test");
		owner.reviewIssues = [{ lineNumber: 3, code: "missing-password" }];
		owner.sourceSnapshot = "previous source";
		const excerpt = buildVaultImportSourceExcerpt(source, [3], [owner]);
		expect(
			resolveVaultImportQuickFill(source, excerpt, [owner]).targetId,
		).toBeNull();
		delete owner.sourceSnapshot;
		owner.sourceFields = {
			title: { start: -1, end: 7, line: 1, endLine: 1 },
			username: { start: 8, end: source.length + 1, line: 2, endLine: 2 },
		};
		expect(
			resolveVaultImportQuickFill(source, excerpt, [owner]).targetId,
		).toBeNull();
	});
});

describe("explicit source-to-field filling", () => {
	it("reads original spaces, line endings and literal unlabelled quotes", () => {
		const source = '  literal-password  \r\n"quoted-password"\rnext\n';
		const first = getVaultImportSourceLineSelection(source, 1);
		const second = getVaultImportSourceLineSelection(source, 2);
		const whole = getVaultImportSourceLineSelection(source, 1, 3);
		expect(
			first &&
				readVaultImportSourceSelection(source, first, { field: "password" }),
		).toBe("  literal-password  ");
		expect(
			second &&
				readVaultImportSourceSelection(source, second, { field: "password" }),
		).toBe('"quoted-password"');
		expect(
			whole &&
				readVaultImportSourceSelection(source, whole, { field: "notes" }),
		).toBe(source.slice(0, -1));
		expect(getVaultImportSourceLineSelection(source, 4)).toEqual({
			start: source.length,
			end: source.length,
		});
	});

	it("reuses explicit field parsing without losing JSON escapes or password whitespace", () => {
		const source =
			'username=reader;password="  a;b\\r\\nend  ";notes="keep\\tthis"';
		const selection = { start: 0, end: source.length };
		expect(
			readVaultImportSourceSelection(source, selection, {
				field: "usernameAliases",
			}),
		).toBe("reader");
		expect(
			readVaultImportSourceSelection(source, selection, { field: "password" }),
		).toBe("  a;b\r\nend  ");
		expect(
			readVaultImportSourceSelection(source, selection, { field: "notes" }),
		).toBe("keep\tthis");
		expect(
			readVaultImportSourceSelection(
				"密码=  original  ",
				{ start: 0, end: 15 },
				{ field: "password" },
			),
		).toBe("  original  ");
	});

	it("uses an exact declared JSON reference only for the explicitly named field", () => {
		const quoted = JSON.stringify("  synthetic\r\npassword  ");
		const source = `Example\nreader\n${quoted}`;
		const owner = candidate(source, "owner", "reader");
		owner.draft.password = "  synthetic\r\npassword  ";
		owner.sourceFields = {
			...owner.sourceFields,
			password: reference(source, quoted, "json-string"),
		};
		const selection = getVaultImportSourceLineSelection(source, 3);
		expect(
			selection &&
				readVaultImportSourceSelection(source, selection, {
					field: "password",
					candidates: [owner],
				}),
		).toBe(owner.draft.password);
		expect(
			selection &&
				readVaultImportSourceSelection(source, selection, {
					field: "notes",
					candidates: [owner],
				}),
		).toBe(quoted);
		delete owner.sourceFields.password?.encoding;
		expect(
			selection &&
				readVaultImportSourceSelection(source, selection, {
					field: "password",
					candidates: [owner],
				}),
		).toBe(quoted);
	});

	it("does not copy source outside the selection or use manually edited stale values", () => {
		const source = "Example\nreader\nfirst\r\nsecond";
		const owner = candidate(source, "owner", "reader");
		owner.draft.password = "first\r\nsecond";
		owner.sourceFields = {
			...owner.sourceFields,
			password: reference(source, owner.draft.password),
		};
		const firstLine = getVaultImportSourceLineSelection(source, 3);
		expect(
			firstLine &&
				readVaultImportSourceSelection(source, firstLine, {
					field: "password",
					candidates: [owner],
				}),
		).toBe("first");
		const all = getVaultImportSourceLineSelection(source, 3, 4);
		owner.draft.password = "manually changed password";
		expect(
			all &&
				readVaultImportSourceSelection(source, all, {
					field: "password",
					candidates: [owner],
				}),
		).toBe("first\r\nsecond");
	});

	it("retains multiple selected account values instead of choosing the first small account", () => {
		const source = "Example\none@example.test\ntwo@example.test";
		const first = candidate(source, "one", "one@example.test");
		const second = candidate(source, "two", "two@example.test");
		const selection = getVaultImportSourceLineSelection(source, 2, 3);
		expect(
			selection &&
				readVaultImportSourceSelection(source, selection, {
					field: "username",
					candidates: [first, second],
				}),
		).toBe("one@example.test\ntwo@example.test");
	});

	it("can fill an individually proven alias despite deduplicated earlier aliases", () => {
		const source = "Example\nreader\nhandle\nphone";
		const owner = candidate(source, "owner", "reader");
		owner.draft.usernameAliases = ["handle", "phone"];
		owner.sourceUsernameAliases = [
			reference(source, "handle"),
			reference(source, "handle"),
			reference(source, "phone"),
		];
		const selection = getVaultImportSourceLineSelection(source, 4);
		expect(
			selection &&
				readVaultImportSourceSelection(source, selection, {
					field: "usernameAliases",
					candidates: [owner],
				}),
		).toBe("phone");
	});

	it("keeps ambiguous labels and unselected destination fields as literal source text", () => {
		const source = "password=one;password=two";
		const selection = { start: 0, end: source.length };
		expect(
			readVaultImportSourceSelection(source, selection, { field: "password" }),
		).toBe(source);
		expect(
			readVaultImportSourceSelection(
				"password=one;",
				{ start: 0, end: 13 },
				{ field: "password" },
			),
		).toBe("password=one;");
		expect(
			readVaultImportSourceSelection(
				"username=reader",
				{ start: 0, end: 15 },
				{ field: "password" },
			),
		).toBe("username=reader");
		expect(
			readVaultImportSourceSelection("password=one", { start: 0, end: 12 }),
		).toBe("password=one");
	});

	it("rejects invalid ranges and invalid explicit JSON without leaking a fallback guess", () => {
		for (const selection of [
			{ start: -1, end: 2 },
			{ start: 0.5, end: 2 },
			{ start: 2, end: 1 },
			{ start: 0, end: 10 },
		])
			expect(readVaultImportSourceSelection("abc", selection)).toBeUndefined();
		expect(
			readVaultImportSourceSelection("123", {
				start: 0,
				end: 3,
				encoding: "json-string",
			}),
		).toBeUndefined();
		expect(
			readVaultImportSourceSelection('"invalid', {
				start: 0,
				end: 8,
				encoding: "json-string",
			}),
		).toBeUndefined();
		expect(
			readVaultImportSourceRange('"ok\\tvalue"', {
				start: 0,
				end: 11,
				encoding: "json-string",
			}),
		).toBe("ok\tvalue");
		for (const [line, endLine] of [
			[0, 1],
			[1.5, 2],
			[2, 1],
			[1, 4],
		])
			expect(
				getVaultImportSourceLineSelection("a\r\nb\nc", line, endLine),
			).toBeUndefined();
	});

	it("treats an empty separator as its own range instead of merging adjacent accounts", () => {
		const source = "first\n\nsecond";
		const selection = getVaultImportSourceLineSelection(source, 2);
		expect(
			selection && getVaultImportSourceSectionSelection(source, selection),
		).toEqual(selection);
		expect(
			selection &&
				readVaultImportSourceSelection(source, selection, { field: "notes" }),
		).toBe("");
	});
});
