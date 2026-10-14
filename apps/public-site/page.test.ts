import { describe, expect, it } from "vitest";
import { renderPublicPage, type PublicLocale } from "./page";

const config = {
	siteUrl: "https://syndred.github.io/StackPerch/",
	downloadUrl: "https://github.com/Syndred/StackPerch/releases",
	repositoryUrl: "https://github.com/Syndred/StackPerch",
	screenshotSize: { width: 1280, height: 808 },
};

describe.each<PublicLocale>(["en", "zh-CN"])("public page in %s", (locale) => {
	it("describes StackPerch while preserving the old name and using the new canonical address", () => {
		const html = renderPublicPage(locale, config);
		const canonical = `${config.siteUrl}${locale === "en" ? "" : "zh/"}`;
		const schemaText = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1];
		expect(schemaText).toBeDefined();
		const schema = JSON.parse(schemaText ?? "");
		expect(schema).toMatchObject({ name: "StackPerch", alternateName: "KeepAny", url: canonical });
		expect(html).toContain('<title>StackPerch');
		expect(html).toContain('<meta name="keywords" content="StackPerch, KeepAny,');
		expect(html).toContain('<meta property="og:site_name" content="StackPerch"');
		expect(html).toContain(`<link rel="canonical" href="${canonical}"`);
		expect(html).toContain(`hrefLang="zh-CN" href="${config.siteUrl}zh/"`);
		expect(html).not.toContain("stackperch.com");
	});

	it("keeps download, source, trial, and issue links on the StackPerch repository", () => {
		const html = renderPublicPage(locale, config);
		for (const url of [config.downloadUrl, config.repositoryUrl, `${config.repositoryUrl}/issues`]) {
			expect(html).toContain(`href="${url}"`);
		}
		expect(html).toContain(`${config.repositoryUrl}/blob/main/docs/试用指南.md`);
		expect(html).toContain(locale === "en" ? "formerly KeepAny" : "原名 KeepAny");
		expect(html).toContain(locale === "en" ? "Older KeepAny GitHub links still redirect to StackPerch." : "旧 KeepAny GitHub 链接仍转到 StackPerch。");
		expect(html).not.toContain("github.com/Syndred/KeepAny");
		expect(html).not.toContain("syndred.github.io/KeepAny/");
		expect(html).toContain(".ka1");
		expect(html).toContain(".kdbx");
	});

	it("renders readable content without loading an application runtime", () => {
		const html = renderPublicPage(locale, config);
		expect(html).toContain('<h1 id="hero-title">');
		expect(html).toContain('<section id="try"');
		expect(html).toContain('aria-label="StackPerch"');
		expect(html).toContain("stackperch.svg");
		expect(html.match(/<script\b/g)).toHaveLength(1);
		expect(html).not.toContain('type="module"');
		expect(html).not.toContain("service-worker");
	});
});
