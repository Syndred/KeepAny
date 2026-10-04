import { describe, expect, it } from "vitest";
import type {
	VaultImportCandidate,
	VaultImportSourceReference,
} from "./vault-import-model";
import {
	buildVaultImportSourceExcerpt,
	groupVaultImportIssues,
} from "./vault-import-source";

function reference(source: string, text: string): VaultImportSourceReference {
	const start = source.indexOf(text);
	const line = source.slice(0, start).split(/\r\n|\r|\n/).length;
	return {
		start,
		end: start + text.length,
		line,
		endLine: line + text.split(/\r\n|\r|\n/).length - 1,
	};
}
function candidate(
	source: string,
	title: string,
	username: string,
	password: string,
	id = "first",
): VaultImportCandidate {
	return {
		id,
		sourceLine: 1,
		aiEligible: false,
		draft: {
			title,
			username,
			password,
			url: "",
			notes: "",
			linkedAssetIds: [],
		},
		sourceFields: {
			title: reference(source, title),
			username: reference(source, username),
			...(password ? { password: reference(source, password) } : {}),
		},
	};
}

describe("password import source excerpts", () => {
	it("groups adjacent warnings and removes duplicate messages", () => {
		expect(
			groupVaultImportIssues([
				{ lineNumber: 8, code: "ambiguous-line" },
				{ lineNumber: 4, code: "missing-password" },
				{ lineNumber: 5, code: "unknown-field" },
				{ lineNumber: 4, code: "missing-password" },
			]),
		).toEqual([
			[
				{ lineNumber: 4, code: "missing-password" },
				{ lineNumber: 5, code: "unknown-field" },
			],
			[{ lineNumber: 8, code: "ambiguous-line" }],
		]);
	});
	it("shows the current account under a shared heading while selecting only its own CRLF fragment", () => {
		const source =
			"Gmail\r\none@example.test\r\nfirst-secret\r\n\r\ntwo@example.test\r\nuncertain text\r\n";
		const first = candidate(
			source,
			"Gmail",
			"one@example.test",
			"first-secret",
		);
		const second = candidate(source, "Gmail", "two@example.test", "", "second");
		const excerpt = buildVaultImportSourceExcerpt(
			source,
			[6],
			[first, second],
			second,
		);
		expect(excerpt.rows.map((row) => row.text)).toEqual([
			"Gmail",
			"two@example.test",
			"uncertain text",
		]);
		expect(excerpt.rows.map((row) => row.maskedText)).toEqual([
			"Gmail",
			"two@example.test",
			"••••••",
		]);
		expect(source.slice(excerpt.selection.start, excerpt.selection.end)).toBe(
			"uncertain text",
		);
		expect(excerpt.username).toBe("two@example.test");
	});
	it("exposes proven identity spans but masks the password and unknown text on the same line", () => {
		const source = "App account=reader password=keep-secret extra=<img src=x>";
		const owner = candidate(source, "App", "reader", "keep-secret");
		const excerpt = buildVaultImportSourceExcerpt(source, [1], [owner], owner);
		expect(excerpt.rows[0].text).toBe(source);
		expect(excerpt.rows[0].maskedText).toBe("App••••••reader••••••");
		expect(excerpt.rows[0].maskedText).not.toContain("secret");
		expect(excerpt.rows[0].maskedText).not.toContain("<img");
	});
	it("masks private values even when another candidate claims them as an identity", () => {
		const source = "App\nreader\nshared-secret\nother";
		const first = candidate(source, "App", "reader", "shared-secret");
		const other = candidate(source, "App", "shared-secret", "other", "other");
		const excerpt = buildVaultImportSourceExcerpt(source, [3], [first, other]);
		expect(excerpt.rows.find((row) => row.lineNumber === 3)?.maskedText).toBe(
			"••••••",
		);
	});
	it("keeps notes and URLs private and ignores malformed source references", () => {
		const source =
			"App\nreader\npass-secret\nhttps://example.test/?token=secret\nprivate-note";
		const owner = candidate(source, "App", "reader", "pass-secret");
		owner.sourceFields = {
			...owner.sourceFields,
			url: reference(source, "https://example.test/?token=secret"),
			notes: reference(source, "private-note"),
			title: { start: -1, end: 10000, line: 1, endLine: 1 },
		};
		const excerpt = buildVaultImportSourceExcerpt(source, [4, 5], [owner]);
		expect(
			excerpt.rows
				.filter((row) => row.lineNumber >= 3)
				.every((row) => row.maskedText === "••••••"),
		).toBe(true);
	});
	it("does not guess source fields from edited drafts or reveal unknown text in local imports", () => {
		const source = "old-name\nold-user\nunknown-secret";
		const owner: VaultImportCandidate = {
			id: "local",
			sourceLine: 1,
			aiEligible: false,
			draft: {
				title: "edited-name",
				username: "edited-user",
				password: "",
				url: "",
				notes: "",
				linkedAssetIds: [],
			},
		};
		const excerpt = buildVaultImportSourceExcerpt(source, [3], [owner], owner);
		expect(excerpt.rows.every((row) => row.maskedText === "••••••")).toBe(true);
		expect(excerpt.rows.every((row) => !row.text.includes("edited-"))).toBe(
			true,
		);
		expect(excerpt.title).toBeUndefined();
		expect(excerpt.username).toBeUndefined();
		expect(excerpt.selection).toEqual({ start: 18, end: source.length });
	});
	it("clamps invalid focus positions and bounds excerpts for large paragraphs", () => {
		const source = Array.from(
			{ length: 100 },
			(_, index) => `unknown ${index}`,
		).join("\n");
		const excerpt = buildVaultImportSourceExcerpt(
			source,
			[-1, 101, Number.NaN],
			[],
		);
		expect(excerpt.rows.length).toBeLessThanOrEqual(12);
		expect(source.slice(excerpt.selection.start, excerpt.selection.end)).toBe(
			"unknown 0",
		);
		expect(excerpt.rows.every((row) => row.maskedText === "••••••")).toBe(true);
	});
});
