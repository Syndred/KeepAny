import { describe, expect, it } from "vitest";
import {
	createVaultMappedLines,
	updateVaultMappedSource,
	parseVaultMappedLines,
	type VaultMappedField,
} from "./vault-import-mapping";

describe("local password line mapping", () => {
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
			lines.map((row, index) => ({
				...row,
				field: index % 2 ? "password" : "title",
				startsEntry: index % 2 === 0,
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
	it("rejects missing passwords and duplicate fields without losing their source locations", () => {
		const rows = createVaultMappedLines("A\none\ntwo\n\nB").map(
			(row, index) => ({
				...row,
				field: (index === 0 || index === 3
					? "title"
					: "password") as VaultMappedField,
			}),
		);
		const result = parseVaultMappedLines(rows);
		expect(result.candidates).toEqual([]);
		expect(result.issues).toEqual([
			{ lineNumber: 3, code: "duplicate-field" },
			{ lineNumber: 5, code: "missing-password" },
		]);
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
