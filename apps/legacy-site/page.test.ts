import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
	knownLegacyPaths,
	renderLegacyNotFound,
	renderLegacyRedirect,
	renderMirrorIndex,
	TARGET_SITE_URL,
} from "./page";

const scriptFrom = (html: string) =>
	html.match(/<script>(.*?)<\/script>/s)?.[1] ?? "";

describe.each(["en", "zh-CN"] as const)("legacy redirect in %s", (locale) => {
	it("has a fixed canonical, zero-second no-JS refresh and usable link", () => {
		const html = renderLegacyRedirect(locale);
		const destination = `${TARGET_SITE_URL}${locale === "en" ? "" : "zh/"}`;
		expect(html).toContain(`<link rel="canonical" href="${destination}"`);
		expect(html).toContain(
			`<meta http-equiv="refresh" content="0; url=${destination}"`,
		);
		expect(html).toContain(`href="${destination}"`);
		expect(html).toContain('<meta name="robots" content="noindex,follow"');
		expect(html).toContain(
			'<meta name="viewport" content="width=device-width, initial-scale=1"',
		);
	});

	it("preserves search and hash while rejecting an externally selected destination", () => {
		const replace = (value: string) => {
			destination = value;
		};
		let destination = "";
		const search = "?redirect=https://evil.example/&next=//evil.example";
		const hash = "#//evil.example";
		runInNewContext(scriptFrom(renderLegacyRedirect(locale)), {
			location: { search, hash, replace },
		});
		const actual = new URL(destination, TARGET_SITE_URL);
		expect(actual.origin).toBe("https://syndred.github.io");
		expect(actual.pathname).toBe(
			locale === "en" ? "/StackPerch/" : "/StackPerch/zh/",
		);
		expect(actual.search).toBe(search);
		expect(actual.hash).toBe(hash);
	});
});

describe("known routes and mirror root", () => {
	it("handles only the explicit previous home and language entry paths", () => {
		const script = scriptFrom(renderLegacyNotFound());
		for (const [pathname, path] of Object.entries(knownLegacyPaths)) {
			let destination = "";
			runInNewContext(script, {
				location: {
					pathname,
					search: "?a=1",
					hash: "#try",
					replace: (value: string) => {
						destination = value;
					},
				},
			});
			expect(destination).toBe(`${path}?a=1#try`);
		}
		for (const pathname of [
			"/unknown",
			"/KeepAny/unknown",
			"/KeepAnyish",
			"/StackPerch/unknown",
			"/__proto__",
			"/constructor",
		]) {
			let replaced = false;
			runInNewContext(script, {
				location: {
					pathname,
					search: "?next=//evil.example",
					hash: "",
					replace: () => {
						replaced = true;
					},
				},
			});
			expect(replaced).toBe(false);
		}
	});

	it("shows both languages without automatic redirect during the mirror stage", () => {
		const html = renderMirrorIndex();
		expect(html).toContain('href="/KeepAny/"');
		expect(html).toContain('href="/KeepAny/zh/"');
		expect(html).not.toContain("<script");
		expect(html).not.toContain('http-equiv="refresh"');
		expect(renderLegacyNotFound()).not.toContain('http-equiv="refresh"');
	});
});
