import { describe, expect, it } from "vitest";
import { renderPublicPage, type PublicLocale } from "./page";

const config = {
	siteUrl: "https://syndred.github.io/KeepAny/",
	downloadUrl: "https://github.com/Syndred/KeepAny/releases",
	repositoryUrl: "https://github.com/Syndred/KeepAny",
	screenshotSize: { width: 1280, height: 808 },
};

describe.each<PublicLocale>(["en", "zh-CN"])("public page in %s", (locale) => {
	it("describes KeepAny while preserving the old name and using the new canonical address", () => {
		const html = renderPublicPage(locale, config);
		const canonical = `${config.siteUrl}${locale === "en" ? "" : "zh/"}`;
		const schemaText = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1];
		expect(schemaText).toBeDefined();
		const schema = JSON.parse(schemaText ?? "");
		expect(schema).toMatchObject({ name: "KeepAny", alternateName: "StackPerch", url: canonical });
		expect(html).toContain('<title>KeepAny');
		expect(html).toContain('<meta name="keywords" content="KeepAny, StackPerch,');
		expect(html).toContain('<meta property="og:site_name" content="KeepAny"');
		expect(html).toContain(`<link rel="canonical" href="${canonical}"`);
		expect(html).toContain(`hrefLang="zh-CN" href="${config.siteUrl}zh/"`);
		expect(html).not.toContain("keepany.com");
	});

	it("keeps download, source, trial, and issue links on the KeepAny repository", () => {
		const html = renderPublicPage(locale, config);
		for (const url of [config.downloadUrl, config.repositoryUrl, `${config.repositoryUrl}/issues`]) {
			expect(html).toContain(`href="${url}"`);
		}
		expect(html).toContain(`${config.repositoryUrl}/blob/main/docs/试用指南.md`);
		expect(html).toContain(locale === "en" ? "previously published as StackPerch" : "曾以 StackPerch 名称发布");
		expect(html).toContain(locale === "en" ? "Older StackPerch GitHub links still redirect to KeepAny." : "旧 StackPerch GitHub 链接仍转到 KeepAny。");
		expect(html).not.toContain("github.com/Syndred/StackPerch");
		expect(html).not.toContain("syndred.github.io/StackPerch/");
		expect(html).toContain(".ka1");
		expect(html).toContain(".kdbx");
	});

	it("renders readable content without loading an application runtime", () => {
		const html = renderPublicPage(locale, config);
		expect(html).toContain('<h1 id="hero-title">');
		expect(html).toContain('<section id="try"');
		expect(html).toContain('aria-label="KeepAny"');
		expect(html).toContain("keepany.svg");
		expect(html.match(/<script\b/g)).toHaveLength(1);
		expect(html).not.toContain('type="module"');
		expect(html).not.toContain("service-worker");
	});
});
