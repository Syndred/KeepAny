import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { resources } from "../../apps/web/src/i18n";
import { newAsset } from "../../packages/domain/src";
import { acceptanceCandidate } from "./helpers/acceptance-candidate";
import { prepareCompletionArchive, restoreCompletionArchive } from "./helpers/completion-archive";

const password = "Toolbar-fictional-only-2026";
const fixture = resolve(process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/asset-toolbar", "toolbar-fixture");
const longTag = "Reference-".repeat(6);
async function expectSingleEmptyFrame(page: import("@playwright/test").Page) {
	const empty = page.locator(".asset-list-content > .empty");
	await expect(empty).toBeVisible();
	const frames = await empty.evaluate(node => {
		const content = node.parentElement!;
		const styles = [getComputedStyle(content), getComputedStyle(node)];
		return {
			borders: styles.filter(style => parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none").length,
			shadows: styles.filter(style => style.boxShadow !== "none").length,
			width: node.getBoundingClientRect().width,
			availableWidth: content.clientWidth,
		};
	});
	expect(frames.borders, "empty state must have one frame, never a framed parent and framed child").toBe(1);
	expect(frames.shadows, "empty state must have one shadow").toBe(1);
	expect(Math.abs(frames.width - frames.availableWidth)).toBeLessThanOrEqual(1);
}
test.beforeAll(async () => {
	await prepareCompletionArchive(fixture, password, async db => {
		for (const kind of ["item", "subscription"] as const) {
			for (const [suffix, tags] of [["selected", ["Reference", longTag]], ["other", ["Other"]], ["untagged", []]] as const) {
				await db.save("asset", { ...newAsset(kind), name: `${kind}-${suffix}`, tags: [...tags] });
			}
		}
		return { kind: "synthetic-toolbar-records", assets: 6 };
	});
});

for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale}: AR01 AR02 AR03 AR04 current compact search and persistent tag search`, async ({ page }, info) => {
		const t = (key: string) => (resources[locale].translation as Record<string, string>)[key];
		const { release } = acceptanceCandidate();
		const index = await page.request.get("/");
		expect(createHash("sha256").update(await index.body()).digest("hex")).toBe(release.webFiles.find(file => file.path === "index.html")!.sha256);
		await info.attach("candidate.json", { body: JSON.stringify(release), contentType: "application/json" });
		await page.addInitScript(language => localStorage.setItem("keepany-language", language), locale);
		await page.goto("/assets/item");
		await expect(page.locator(".workspace-navigation")).toBeVisible();
		await expect(page.locator(".workspace-navigation").getByRole("button", { name: t("catalogNew"), exact: true })).toBeVisible();
		await expect(page.locator(".asset-view-toggle")).toHaveCount(0);
		await expect(page.locator("#asset-tag-filter-item")).toHaveCount(0);
		await page.screenshot({ path: info.outputPath("empty-item.png"), fullPage: true });
		await restoreCompletionArchive(page, password, resolve(fixture, "fixture.ka1"));
		for (const width of [390, 768, 1280, 1920, 2262]) {
			await page.setViewportSize({ width, height: 900 });
			for (const kind of ["item", "subscription"] as const) {
				await page.goto(`/assets/${kind}`);
                const filter = page.getByRole('searchbox',{name:t('workspaceSearch'),exact:true});
                const content = page.locator('.asset-list-content');
                await filter.fill('');
                await expect(content.locator('.asset-summary-card')).toHaveCount(3);
                await expect(page.locator('.asset-view-toggle')).toHaveCount(0);
                await page.screenshot({path:info.outputPath(`${kind}-${width}-default.png`),fullPage:true});
                const controls=page.locator('.workspace-catalog-controls');
                if(width>=1280) {
                    const f=(await filter.boundingBox())!;
                    for(const control of await controls.getByRole('combobox').all()) {const c=(await control.boundingBox())!;expect(Math.abs(f.y+f.height/2-c.y-c.height/2)).toBeLessThanOrEqual(1);}
                }
                await filter.fill(longTag);
                await expect(content.locator('.asset-summary-card')).toHaveCount(1);
                await expect(content).toContainText(`${kind}-selected`);
                await page.reload();
                await expect(filter).toHaveValue(longTag);
                await expect(content.locator('.asset-summary-card')).toHaveCount(1);
                await filter.fill('');
                await expect(content.locator('.asset-summary-card')).toHaveCount(3);
                expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
			}
		}
	});
	test(`${locale}: EF01 EF02 EF03 EF04 empty and filtered states have one frame`, async ({ page }, info) => {
		const t = (key: string) => (resources[locale].translation as Record<string, string>)[key];
		const { release } = acceptanceCandidate();
		const index = await page.request.get("/");
		expect(createHash("sha256").update(await index.body()).digest("hex")).toBe(release.webFiles.find(file => file.path === "index.html")!.sha256);
		await info.attach("candidate.json", { body: JSON.stringify(release), contentType: "application/json" });
		await page.addInitScript(language => localStorage.setItem("keepany-language", language), locale);
		for (const width of [390, 768, 1004, 1280, 1920]) {
			await page.setViewportSize({ width, height: 900 });
			for (const kind of ["item", "subscription"] as const) {
				await page.goto(`/assets/${kind}`);
                await expect(page.locator('.asset-view-toggle')).toHaveCount(0);
                await page.screenshot({path:info.outputPath(`${kind}-${width}-empty.png`),fullPage:true});
                await expectSingleEmptyFrame(page);
			}
		}
		await restoreCompletionArchive(page, password, resolve(fixture, "fixture.ka1"));
		for (const width of [390, 768, 1004, 1280, 1920]) {
			await page.setViewportSize({ width, height: 900 });
			for (const kind of ["item", "subscription"] as const) {
				await page.goto(`/assets/${kind}`);
                const content=page.locator('.asset-list-content');
                const search=page.getByRole('searchbox',{name:t('workspaceSearch'),exact:true});
                await expect(content.locator('.asset-summary-card')).toHaveCount(3);
                await search.fill('no-matching-fictional-record');
                await expect(content).toContainText(t('noMatches'));
                await expectSingleEmptyFrame(page);
                await page.screenshot({path:info.outputPath(`${kind}-${width}-no-match.png`),fullPage:true});
                await search.fill('');
                await expect(content.locator('.asset-summary-card')).toHaveCount(3);
                await page.reload();
                await expect(content.locator('.asset-summary-card')).toHaveCount(3);
                expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
			}
		}
	});
}
