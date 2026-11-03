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
	test(`${locale}: AR01 AR02 AR03 AR04 latest navigation and aligned working filters`, async ({ page }, info) => {
		const t = (key: string) => (resources[locale].translation as Record<string, string>)[key];
		const { release } = acceptanceCandidate();
		const index = await page.request.get("/");
		expect(createHash("sha256").update(await index.body()).digest("hex")).toBe(release.webFiles.find(file => file.path === "index.html")!.sha256);
		await info.attach("candidate.json", { body: JSON.stringify(release), contentType: "application/json" });
		await page.addInitScript(language => localStorage.setItem("keepany-language", language), locale);
		await page.goto("/assets/item");
		await expect(page.locator(".workspace-navigation")).toBeVisible();
		await expect(page.locator(".workspace-navigation").getByRole("button", { name: t("catalogNew"), exact: true })).toBeVisible();
		await expect(page.locator(".asset-view-toggle")).toBeVisible();
		await expect(page.locator("#asset-tag-filter-item")).toHaveCount(0);
		await page.screenshot({ path: info.outputPath("empty-item.png"), fullPage: true });
		await restoreCompletionArchive(page, password, resolve(fixture, "fixture.ka1"));
		for (const width of [390, 768, 1280, 1920, 2262]) {
			await page.setViewportSize({ width, height: 900 });
			for (const kind of ["item", "subscription"] as const) {
				await page.goto(`/assets/${kind}`);
				const filter = page.locator(`#asset-tag-filter-${kind}`);
				const toggle = page.locator(".asset-view-toggle");
				const content = page.locator(".asset-list-content");
				await expect(filter).toBeVisible();
				await expect(content.locator(".asset-library-card")).toHaveCount(3);
				await page.screenshot({ path: info.outputPath(`${kind}-${width}-default.png`), fullPage: true });
				const f = (await filter.boundingBox())!;
				const v = (await toggle.boundingBox())!;
				if (width >= 1280) {
					expect(Math.abs(f.y + f.height / 2 - v.y - v.height / 2), "tag selector and view toggle must share a horizontal centre line").toBeLessThanOrEqual(1);
				}
				expect(Math.abs(v.x + v.width - ((await content.boundingBox())!.x + (await content.boundingBox())!.width))).toBeLessThanOrEqual(2);
				expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
				await filter.click();
				await page.getByRole("option", { name: longTag, exact: true }).click();
				await expect(content.locator(".asset-library-card")).toHaveCount(1);
				await expect(content).toContainText(`${kind}-selected`);
				await toggle.getByRole("button", { name: t("assetCardView"), exact: true }).click();
				await expect(content).not.toHaveClass(/asset-dense-list/);
				await page.screenshot({ path: info.outputPath(`${kind}-${width}-selected-cards.png`), fullPage: true });
				await page.reload();
				await expect(filter).toContainText(longTag);
				await expect(content.locator(".asset-library-card")).toHaveCount(1);
				await expect(toggle.getByRole("button", { name: t("assetCardView"), exact: true })).toHaveAttribute("aria-pressed", "true");
				await toggle.getByRole("button", { name: t("assetListView"), exact: true }).click();
				await expect(content).toHaveClass(/asset-dense-list/);
				await filter.click();
				await page.getByRole("option", { name: t("allTags"), exact: true }).click();
				await expect(content.locator(".asset-library-card")).toHaveCount(3);
			}
		}
	});
}
