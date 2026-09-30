import { expect, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

for (const locale of ["zh-CN", "en-US"] as const) {
	test(`${locale} backlink status, receipt, filter and explicit review survive reload`, async ({ browser }) => {
		const copy = locale === "zh-CN"
			? { add: "新增", save: "保存", backlink: "新增外链", filter: "状态筛选", verify: "待核验", indexed: "已收录", planned: "计划中", check: "核验", invalid: "请检查此项", evidence: "依据", name: "名称", url: "网址" }
			: { add: "Add", save: "Save", backlink: "Add backlink", filter: "Filter by status", verify: "To verify", indexed: "Indexed", planned: "Planned", check: "Verify", invalid: "Please check this field", evidence: "Evidence", name: "Name", url: "URL" };
		const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await page.goto("/assets/project");
			await page.getByRole("button", { name: copy.add, exact: true }).click();
			const editor = page.getByRole("dialog");
			await editor.locator("#name").fill("Backlink review project");
			await editor.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(editor).toBeHidden();
			await page.locator("main.page .list-row").filter({ hasText: "Backlink review project" }).click();
			await page.getByRole("button", { name: copy.backlink }).click();
			const dialog = page.getByRole("dialog", { name: copy.backlink });
			await dialog.locator("#submission-name").fill("Atlas listing");
			await dialog.locator("#submission-url").fill("https://directory.example/atlas");
			await selectChoice(dialog.locator("#submission-status"), "verify");
			await dialog.locator("#submission-date").fill("2026-09-28");
			await dialog.locator("#submission-evidence").fill("Email receipt 42");
			await dialog.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(dialog).toBeHidden();
			const ledger = page.locator(".asset-backlinks-card");
			const filters = ledger.getByRole("group", { name: copy.filter });
			await filters.getByRole("button", { name: copy.verify, exact: true }).click();
			const row = ledger.locator("tr").filter({ hasText: "Atlas listing" });
			await expect(row).toHaveCount(1);
			await expect(row.locator(".backlink-status")).toHaveText(copy.verify);
			await expect(row.getByRole("combobox")).toHaveCount(0);
			await expect(row.getByRole("button", { name: copy.check })).toBeInViewport();
			await filters.getByRole("button", { name: copy.planned, exact: true }).click();
			await expect(row).toHaveCount(0);
			await filters.getByRole("button", { name: copy.verify, exact: true }).click();
			await row.getByRole("button", { name: copy.check }).click();
			await row.getByLabel(`Atlas listing ${copy.name}`).fill("Atlas listing updated");
			await row.getByLabel(`Atlas listing ${copy.url}`).fill("https://directory.example/atlas-updated");
			await selectChoice(row.getByRole("combobox"), "indexed");
			const bounds = await ledger.locator(".table-wrap").boundingBox();
			expect(bounds).not.toBeNull();
			for (const action of await row.locator(".backlink-row-actions button").all()) {
				const button = await action.boundingBox();
				expect(button).not.toBeNull();
				if (bounds && button) expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width - 1);
			}
			await row.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(row.getByRole("alert")).toHaveText(copy.invalid);
			await row.getByLabel(`Atlas listing ${copy.evidence}`).fill("https://directory.example/atlas/live");
			await page.screenshot({ path: test.info().outputPath(`backlink-editor-${locale}-390.png`), fullPage: true });
			await row.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(row).toHaveCount(0);
			await filters.getByRole("button", { name: copy.indexed, exact: true }).click();
			await expect(row.locator(".backlink-status")).toHaveText(copy.indexed);
			await expect(row.getByRole("link", { name: "https://directory.example/atlas/live" })).toBeVisible();
			await page.reload();
			await ledger.locator("summary").click();
			await expect(row.locator(".backlink-status")).toHaveText(copy.indexed);
			const stored = await page.evaluate(async (path) => (await (await import(path)).localRepository()).list("submission"), repositoryPath);
			expect(stored).toHaveLength(1);
			expect(stored[0]).toMatchObject({ name: "Atlas listing updated", url: "https://directory.example/atlas-updated", status: "indexed", evidence: "https://directory.example/atlas/live", submittedAt: "2026-09-28" });
			await page.screenshot({ path: `/private/tmp/keepany-backlink-ledger-${locale}.png`, fullPage: true });
			expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
