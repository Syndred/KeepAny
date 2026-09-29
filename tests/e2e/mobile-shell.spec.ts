import { expect, test } from "@playwright/test";

test("project workflow stays above the fold with a usable mobile drawer in both languages", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	const projectId = await page.evaluate(async ([domainUrl, repositoryUrl]) => {
		const { newAsset } = await import(domainUrl);
		const { saveBatch } = await import(repositoryUrl);
		const project = { ...newAsset("project"), name: "Mobile Atlas" };
		await saveBatch([{ type: "asset", value: project }]);
		return project.id as string;
	}, [`/@fs${process.cwd()}/packages/domain/src/index.ts`, `/@fs${process.cwd()}/packages/local-db/src/index.ts`]);

	for (const [language, title] of [["en", "Close or hand over project"], ["zh-CN", "关闭与交接"]] as const) {
		await page.evaluate((value) => localStorage.setItem("keepany-language", value), language);
		await page.goto(`/assets/project/${projectId}/workflow/close`);
		await expect(page.getByRole("heading", { name: title })).toBeVisible();
		await expect.poll(() => page.locator(".project-workflow-hero").evaluate((element) => element.getBoundingClientRect().top)).toBeLessThan(200);
		const sidebar = page.locator("aside.sidebar");
		await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
		await page.getByRole("button", { name: language === "en" ? "Navigation" : "导航" }).click();
		await expect(sidebar).toHaveClass(/open/);
		await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().left)).toBeGreaterThanOrEqual(0);
		await expect(sidebar.getByRole("link", { name: language === "en" ? "Projects" : "项目" })).toBeVisible();
		await page.locator(".mobile-scrim").click({ position: { x: 375, y: 100 } });
		await expect(sidebar).not.toHaveClass(/open/);
		await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
	}
});
