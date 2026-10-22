import { describe, expect, it } from "vitest";
import { assetSchema, newAsset } from "../../../packages/domain/src";
import { assetNotes, editAssetNotes } from "./asset-notes";
import { matchesAssetSearch } from "./asset-search";

describe("one supplemental notes field", () => {
	it.each([
		["", "", ""],
		["Full text", "", "Full text"],
		["", "Note", "Note"],
		["Same", "Same", "Same"],
		[" Same ", "Same", "Same"],
		[
			"Line one\nLine two",
			"Private note",
			"Line one\nLine two\n\nPrivate note",
		],
	])(
		"preserves and deduplicates legacy text",
		(longDescription, notes, expected) => {
			expect(assetNotes({ longDescription, notes })).toBe(expected);
		},
	);
	it("leaves both legacy values untouched when other fields are edited", () => {
		const asset = {
			...newAsset("account"),
			longDescription: "Public",
			notes: "Private",
		};
		expect(editAssetNotes(asset, assetNotes(asset))).toBe(asset);
	});
	it("keeps changed combined text private, supports clearing, and survives schema roundtrip", () => {
		const asset = {
			...newAsset("account"),
			longDescription: "Original",
			notes: "Private token",
		};
		const edited = assetSchema.parse(
			editAssetNotes(asset, `${assetNotes(asset)}\nAdded`),
		);
		expect(assetNotes(edited)).toBe("Original\n\nPrivate token\nAdded");
		expect(edited.longDescription).toBe("");
		expect(matchesAssetSearch(edited, "Private token")).toBe(false);
		expect(assetNotes(editAssetNotes(edited, ""))).toBe("");
	});
	it("preserves the maximum combined legacy content", () => {
		const asset = {
			...newAsset("account"),
			longDescription: "a".repeat(30_000),
			notes: "b".repeat(20_000),
		};
		const combined = assetNotes(asset);
		expect(combined).toHaveLength(50_002);
		expect(
			assetNotes(
				assetSchema.parse(editAssetNotes(asset, `c${combined.slice(1)}`)),
			),
		).toHaveLength(50_002);
	});
});
