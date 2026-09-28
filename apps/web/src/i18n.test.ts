import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resources } from "./i18n";

function sources(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory()
			? sources(path)
			: entry.name.endsWith(".tsx")
				? [readFileSync(path, "utf8")]
				: [];
	});
}

describe("two-language UI copy", () => {
	it("has matching nonempty keys for zh-CN and English", () => {
		const zh = resources["zh-CN"].translation;
		const en = resources.en.translation;
		expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
		for (const key of Object.keys(zh)) {
			expect(String(zh[key]).trim(), key).not.toBe("");
			expect(String(en[key]).trim(), key).not.toBe("");
		}
	});

	it("defines each literal translation key used by React views", () => {
		const keys = new Set(Object.keys(resources.en.translation));
		for (const source of sources(join(import.meta.dirname, "."))) {
			for (const match of source.matchAll(/\bt\(['"]([^'"]+)['"]/g)) {
				expect(keys.has(match[1]), `Missing translation: ${match[1]}`).toBe(
					true,
				);
			}
		}
	});
});
