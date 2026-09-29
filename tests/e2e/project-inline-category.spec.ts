import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainModuleUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;

for (const locale of ["en", "zh-CN"] as const) {
	test(`${locale} project category is edited inline with members and survives refresh`, async ({ page }) => {
		await page.setViewportSize({ width: locale === "en" ? 1144 : 390, height: 844 });
		await page.goto("/");
		await page.evaluate((language) => localStorage.setItem("keepany-language", language), locale);
		await page.goto("/assets/project");
		const projectId = await page.evaluate(async ({ repositoryPath, domainPath }) => {
			const { save } = await import(repositoryPath);
			const { newAsset } = await import(domainPath);
			const project = { ...newAsset("project"), name: "Inline category project" };
			await save("asset", project);
			return project.id as string;
		}, { repositoryPath: repositoryModuleUrl, domainPath: domainModuleUrl });
		const add = locale === "en" ? "New category" : "新增分类";
		const region = page.getByRole("region", { name: locale === "en" ? "Category" : "分类" });
		await page.getByRole("button", { name: add, exact: true }).click();
		await expect(region).toBeVisible();
		await region.getByLabel(locale === "en" ? "Category name" : "分类名称").fill("Studio set");
		await region.getByRole("checkbox", { name: "Inline category project" }).check();
		await page.screenshot({ path: join(tmpdir(), `keepany-project-category-inline-${locale}.png`), fullPage: true });
		await region.getByRole("button", { name: locale === "en" ? "Save collection" : "保存分类" }).click();
		await expect(region).toBeHidden();
		await expect(page.getByRole("main").getByRole("button", { name: "Studio set", exact: true })).toBeVisible();
		await page.reload();
		await page.getByRole("button", { name: locale === "en" ? "Manage" : "管理", exact: true }).click();
		await region.getByRole("button", { name: "Studio set", exact: true }).click();
		await expect(region.getByRole("checkbox", { name: "Inline category project" })).toBeChecked();
		const saved = await page.evaluate(async ({ repositoryPath, id }) => {
			const { localRepository } = await import(repositoryPath);
			return (await (await localRepository()).get("asset", id) as { category: string }).category;
		}, { repositoryPath: repositoryModuleUrl, id: projectId });
		expect(saved).toBe("Studio set");
		await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
	});
}
