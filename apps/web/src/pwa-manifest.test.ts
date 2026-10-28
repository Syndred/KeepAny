import { describe, expect, it } from "vitest";
import { stablePrecacheManifest } from "./pwa-manifest";

describe("reproducible PWA precache manifest", () => {
	const entries = [
		{ url: "unsupported-webview.html", revision: "fallback-revision", size: 1200 },
		{ url: "index.html", revision: "html-revision", size: 2400 },
		{ url: "assets/__vite-browser-external-5eBdwsFd.js", revision: null, size: 100 },
		{ url: "assets/PasswordVaultPanel-CatLg0kO.js", revision: null, size: 300 },
		{ url: "assets/workflows-S8gDGp55.js", revision: null, size: 400 },
		{ url: "icons/keepany.svg", revision: "icon-revision", size: 500 },
	];

	it("makes the observed Windows and Linux glob orders produce identical identities", () => {
		const windows = [...entries];
		const linux = [entries[0], entries[1], entries[4], entries[3], entries[2], entries[5]];
		expect(windows.map(entry => entry.url)).not.toEqual(linux.map(entry => entry.url));
		expect(stablePrecacheManifest(windows)).toEqual(stablePrecacheManifest(linux));
		expect(stablePrecacheManifest(windows).manifest.map(entry => entry.url)).toEqual([
			"assets/PasswordVaultPanel-CatLg0kO.js",
			"assets/__vite-browser-external-5eBdwsFd.js",
			"assets/workflows-S8gDGp55.js",
			"icons/keepany.svg", "index.html", "unsupported-webview.html",
		]);
	});

	it("preserves every revision, size and additional field without mutating the input", () => {
		const first = Object.freeze({ url: "z", revision: null, size: 19, integrity: "test-integrity" });
		const second = Object.freeze({ url: "A", revision: "original", size: 31, integrity: "other-integrity" });
		const input = Object.freeze([first, second]);
		const result = stablePrecacheManifest(input);
		expect(input).toEqual([first, second]);
		expect(result.manifest[0]).toBe(second);
		expect(result.manifest[1]).toBe(first);
		expect(result.warnings).toEqual([]);
	});

	it("keeps duplicate entries and handles an empty manifest", () => {
		const entry = { url: "same", revision: "unchanged", size: 7 };
		expect(stablePrecacheManifest([entry, entry]).manifest).toEqual([entry, entry]);
		expect(stablePrecacheManifest([])).toEqual({ manifest: [], warnings: [] });
	});
});
