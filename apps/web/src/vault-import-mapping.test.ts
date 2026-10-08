import { describe, expect, it } from "vitest";
import {
	createVaultMappedLines,
	parseVaultMappedLines,
	updateVaultMappedSource,
	type VaultMappedField,
} from "./vault-import-mapping";

describe("local password line mapping", () => {
	it("keeps blank and whitespace-only rows visible with their original numbers", () => {
		const rows = createVaultMappedLines("A\n  \n\nB");
		expect(rows).toEqual([
			{ lineNumber: 1, value: "A", field: "", startsEntry: true },
			{ lineNumber: 2, value: "  ", field: "ignore", startsEntry: false },
			{ lineNumber: 3, value: "", field: "ignore", startsEntry: false },
			{ lineNumber: 4, value: "B", field: "", startsEntry: true },
		]);
	});
	it("keeps corrected unresolved lines and source separators when returning to the source", () => {
		const source = "\uFEFFA\r\np\r\n\r\nextra";
		const rows = createVaultMappedLines(source).map((row) =>
			row.lineNumber === 4 ? { ...row, value: "corrected" } : row,
		);
		expect(updateVaultMappedSource(source, rows)).toBe(
			"\uFEFFA\r\np\r\n\r\ncorrected",
		);
	});
	it("preserves credentials and retains an unassigned extra email for review", () => {
		const lines = createVaultMappedLines(
			"Example\ndemo@example.test\n  punctuation;|,secret  \nother@example.test",
		);
		const fields: VaultMappedField[] = ["title", "username", "password", ""];
		const result = parseVaultMappedLines(
			lines.map((row, index) => ({ ...row, field: fields[index] })),
		);
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]).toMatchObject({
			aiEligible: false,
			draft: { password: "  punctuation;|,secret  " },
		});
		expect(result.issues).toEqual([
			{ lineNumber: 4, code: "unrecognized-line" },
		]);
		expect(lines[3].value).toBe("other@example.test");
	});
	it("separates blank-line groups and explicit boundaries while mapping original line numbers", () => {
		const lines = createVaultMappedLines("A\np1\n\nB\np2\nC\np3");
		const result = parseVaultMappedLines(
			lines.map((row) => ({
				...row,
				field:
					row.lineNumber === 3
						? "ignore"
						: [1, 4, 6].includes(row.lineNumber)
							? "title"
							: "password",
				startsEntry: [1, 4, 6].includes(row.lineNumber),
			})),
		);
		expect(
			result.candidates.map((row) => [
				row.sourceLine,
				row.draft.title,
				row.draft.password,
			]),
		).toEqual([
			[1, "A", "p1"],
			[4, "B", "p2"],
			[6, "C", "p3"],
		]);
		expect(result.issues).toEqual([]);
	});
	it("accepts passwordless entries while rejecting duplicate fields at their source locations", () => {
		const rows = createVaultMappedLines("A\none\ntwo\n\nB").map((row) => ({
			...row,
			field: (row.lineNumber === 4
				? "ignore"
				: row.lineNumber === 1 || row.lineNumber === 5
					? "title"
					: "password") as VaultMappedField,
		}));
		const result = parseVaultMappedLines(rows);
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]).toMatchObject({
			sourceLine: 5,
			needsReview: true,
			draft: { title: "B", password: "" },
		});
		expect(result.issues).toEqual([{ lineNumber: 3, code: "duplicate-field" }]);
	});
	it("allows an explicit ignore without assigning unknown lines to credentials", () => {
		const fields: VaultMappedField[] = ["title", "password", "ignore"];
		const result = parseVaultMappedLines(
			createVaultMappedLines("A\np\nspare").map((row, i) => ({
				...row,
				field: fields[i],
			})),
		);
		expect(result.issues).toEqual([]);
		expect(result.candidates[0].draft.notes).toBe("");
		expect(result.handledLines).toEqual([3, 1, 2]);
	});
	it("only consumes successfully assigned blocks and explicitly ignored lines", () => {
		const fields: VaultMappedField[] = [
			"title",
			"password",
			"ignore",
			"title",
			"username",
			"password",
			"url",
			"ignore",
			"ignore",
		];
		const result = parseVaultMappedLines(
			createVaultMappedLines(
				"Good\np1\n\nIncomplete\nsecond@example.test\np2\nftp://example.test\n\nDiscarded",
			).map((row, index) => ({ ...row, field: fields[index] })),
		);
		expect(result.candidates).toHaveLength(1);
		expect(result.handledLines).toEqual([3, 8, 9, 1, 2]);
		expect(result.issues).toContainEqual({
			lineNumber: 4,
			code: "invalid-url",
		});
	});
	it("does not infer an entry boundary from repeated mapped titles or URLs", () => {
		for (const field of ["title", "url"] as const) {
			const fields: VaultMappedField[] = [field, "password", field, "password"];
			const values =
				field === "title"
					? "A\np1\nB\np2"
					: "https://a.example.test\np1\nhttps://b.example.test\np2";
			const result = parseVaultMappedLines(
				createVaultMappedLines(values).map((row, index) => ({
					...row,
					field: fields[index],
				})),
			);
			expect(result.candidates).toEqual([]);
			expect(result.issues).toEqual([
				{ lineNumber: 3, code: "duplicate-field" },
				{ lineNumber: 4, code: "duplicate-field" },
			]);
		}
	});
});
