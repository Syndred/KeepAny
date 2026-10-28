import { describe, expect, it } from "vitest";
import { entitySchemas } from "../../../packages/domain/src";
import { buildSampleLibrary, sampleImageNames } from "./sample-library";
import { resources } from "./i18n";

describe("complete sample library", () => {
	it.each(["zh-CN", "en"] as const)("%s records satisfy real save contracts and have complete references", (language) => {
		const images = Object.fromEntries(sampleImageNames.map((name) => [name, crypto.randomUUID()])) as Record<typeof sampleImageNames[number], string>;
		const copy = resources[language].translation as Record<string, string>;
		const { rows, assets } = buildSampleLibrary((key) => copy[key] ?? key, language, images, new Date("2026-10-28T04:00:00Z"));
		for (const row of rows) expect(() => entitySchemas[row.type].parse(row.value)).not.toThrow();
		expect(assets).toHaveLength(26);
		const ids = new Set(assets.map((asset) => asset.id));
		for (const row of rows) {
			const value = row.value as { assetId?: string; from?: string; to?: string };
			for (const id of [value.assetId, value.from, value.to]) if (id) expect(ids.has(id)).toBe(true);
		}
		expect(new Set(assets.flatMap((asset) => asset.attachments))).toEqual(new Set(Object.values(images)));
		expect(assets.some((asset) => asset.status === "loaned")).toBe(true);
		expect(assets.some((asset) => asset.kind === "account" && !asset.username)).toBe(true);
		expect(rows.some((row) => (row.value as { assetIds?: string[] }).assetIds?.length === 2)).toBe(true);
	});
});
