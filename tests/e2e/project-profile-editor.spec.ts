// User retired B2 promotional fields on 2026-10-29; retained basic profile assertions continue.
import { expect, test } from "@playwright/test";

const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

for (const locale of ["zh-CN", "en-US"] as const) {
	test(`${locale} project profile create, edit and reload at 390px`, async ({ browser }) => {
		const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await page.goto("/assets/project");
			await page.getByRole("button", { name: locale === "zh-CN" ? "新增" : "Add", exact: true }).click();
			let dialog = page.getByRole("dialog");
			await dialog.locator("#name").fill("Project profile test");
			await dialog.locator("#url").fill("https://example.test");
			await dialog.locator("#description").fill("Short description");
			await dialog.locator("#tags").fill("alpha, beta");
			await dialog.locator("#notes").fill("Contact manually");
			await expect(dialog.locator("#projectTitle, #projectLogoFile")).toHaveCount(0);
			await dialog.locator("#name").scrollIntoViewIfNeeded();
			await page.screenshot({ path: `test-results/keepany-project-profile-form-${locale}.png`, fullPage: true });
			await dialog.getByRole("button", { name: locale === "zh-CN" ? "保存" : "Save", exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			const saved = await page.evaluate(async (path) => {
				const { localRepository } = await import(path);
				const rows = await (await localRepository()).list("asset");
				return rows.find((row: { name: string }) => row.name === "Project profile test");
			}, repositoryPath);
			expect(saved).toMatchObject({ description: "Short description", notes: "Contact manually", tags: ["alpha", "beta"] });
			await page.goto(`/assets/project/${saved.id}`);
			await page.getByRole("button", { name: locale === "zh-CN" ? "编辑" : "Edit", exact: true }).first().click();
			dialog = page.getByRole("dialog");
			await dialog.locator("#notes").fill("Updated ordinary note");
			await dialog.getByRole("button", { name: locale === "zh-CN" ? "保存" : "Save", exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			const updated = await page.evaluate(async ({ path, id }) => (await (await import(path)).localRepository()).get("asset", id), { path: repositoryPath, id: saved.id });
			expect(updated.notes).toBe("Updated ordinary note");
			await page.screenshot({ path: `test-results/keepany-project-profile-${locale}.png`, fullPage: true });
			expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
