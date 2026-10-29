// 2026-10-29: user removed B1 backlinks and B2 promotional fields/materials.
// Prior expectations/evidence remain in Git and the private pre-change snapshot; retained core checks are unchanged.
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { sourceModuleUrl } from "./helpers/source-module-url";

const repo = sourceModuleUrl("packages/local-db/src/index.ts");
const domain = sourceModuleUrl("packages/domain/src/index.ts");
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/T19-retained-core";
mkdirSync(evidence, { recursive: true });
async function state(page: Page) {
	return page.evaluate(async path => {
		const { localRepository } = await import(path);
		const db = await localRepository();
		return { assets: await db.list("asset", true), submissions: await db.list("submission", true), candidates: await db.fileStore.intakeReview.toArray() };
	}, repo);
}

for (const locale of ["zh-CN", "en-US"] as const) for (const width of [390, 1280]) {
	test(`${locale} ${width}px T19 retained CSV bulk correction`, async ({ browser }) => {
		test.setTimeout(130_000);
		const zh = locale === "zh-CN";
		const c = { name: zh ? "名称" : "Name", url: zh ? "网址" : "URL", description: zh ? "简短描述" : "Short description", save: zh ? "保存" : "Save", confirm: zh ? "已确认" : "Confirmed", cancel: zh ? "取消" : "Cancel", addBacklink: zh ? "新增外链" : "Add backlink", check: zh ? "核验" : "Verify", update: zh ? "更新" : "Update", invalid: zh ? "请检查此项" : "Please check this field", evidence: zh ? "依据" : "Evidence" };
		const context = await browser.newContext({ locale, timezoneId: "Asia/Shanghai", viewport: { width, height: 900 } });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
		const page = await context.newPage();
		await page.clock.setFixedTime(new Date("2026-10-27T04:00:00Z"));
		const errors: string[] = [], remote: string[] = [];
		page.on("pageerror", e => errors.push(e.message));
		page.on("request", request => { if (new URL(request.url()).hostname.endsWith(".example")) remote.push(request.url()); });
		try {
			await page.goto("/intake");
			const existing = await page.evaluate(async ([repositoryPath, domainPath]) => {
				const { newAsset } = await import(domainPath);
				const { save } = await import(repositoryPath);
				const asset = { ...newAsset("project"), name: "T19 Similar", url: "https://existing.example/", description: "Original retained description", notes: "Original retained note" };
				await save("asset", asset);
				return asset;
			}, [repo, domain]);
			// T19-01/02: duplicate refuses overwrite; batch keeps per-row failures retryable.
			await page.locator(".intake-mode-tabs").getByRole("button", { name: zh ? "表格" : "Spreadsheet", exact: true }).click();
			await page.locator("#csv-file").setInputFiles({ name: "T19-review.csv", mimeType: "text/csv", buffer: Buffer.from("name,kind,url\nT19 Similar,project,https://reviewed.example/\nT19 Valid,project,https://valid.example/\nT19 Invalid,project,https://initial.example/") });
			const batch = page.getByRole("region", { name: "T19-review.csv", exact: true });
			const rows = batch.locator(".intake-review-row");
			await expect(rows).toHaveCount(3);
			await rows.nth(2).getByLabel(c.url, { exact: true }).fill("javascript:alert(1)");
			await rows.nth(0).getByLabel(c.description, { exact: true }).fill("Only explicitly edited candidate description");
			await batch.getByRole("checkbox", { name: zh ? "全选待确认" : "Select all pending", exact: true }).check();
			await batch.getByRole("button", { name: zh ? "确认所选（3）" : "Confirm selected (3)", exact: true }).click();
			await expect(rows.nth(1)).toContainText(c.confirm);
			await expect(rows.nth(0).getByRole("alert")).toBeVisible();
			await expect(rows.nth(2).getByRole("alert")).toBeVisible();
			expect((await state(page)).assets.find((a: { id: string }) => a.id === existing.id)).toEqual(existing);
			const firstSaved = (await state(page)).assets.find((a: { name: string }) => a.name === "T19 Valid");
			await rows.nth(0).getByLabel(c.name, { exact: true }).fill("T19 Reviewed distinct");
			await rows.nth(2).getByLabel(c.url, { exact: true }).fill("https://corrected.example/");
			await expect.poll(async () => (await state(page)).candidates.find((v: { asset: { name: string } }) => v.asset.name === "T19 Invalid")?.asset.url).toBe("https://corrected.example/");
			await page.reload();
			await expect(rows.nth(0).getByLabel(c.name, { exact: true })).toHaveValue("T19 Reviewed distinct");
			await expect(rows.nth(0).getByLabel(c.description, { exact: true })).toHaveValue("Only explicitly edited candidate description");
			await batch.getByRole("checkbox", { name: zh ? "全选待确认" : "Select all pending", exact: true }).check();
			await batch.getByRole("button", { name: zh ? "确认所选（2）" : "Confirm selected (2)", exact: true }).click();
			await expect(rows.filter({ hasText: c.confirm })).toHaveCount(3);
			await page.reload();
			const accepted = await state(page);
			expect(accepted.assets).toHaveLength(4);
			expect(accepted.assets.find((a: { id: string }) => a.id === existing.id)).toEqual(existing);
			expect(accepted.assets.find((a: { id: string }) => a.id === firstSaved.id)).toEqual(firstSaved);
			expect(accepted.candidates.every((v: { status: string }) => v.status === "accepted")).toBe(true);
			await expect(page.locator(".external-link-import-panel")).toHaveCount(0);
			expect(remote).toEqual([]);
			expect(errors).toEqual([]);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
		} finally { await context.close(); }
	});
}
