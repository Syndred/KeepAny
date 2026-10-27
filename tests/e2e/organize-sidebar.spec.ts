import { expect, test, type Page } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainModuleUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;

async function seedAssets(page: Page) {
	return page.evaluate(async ({ repositoryPath, domainPath }) => {
		const { saveBatch } = await import(repositoryPath);
		const { newAsset } = await import(domainPath);
		const assets = (["project", "account"] as const).map((kind) => ({ ...newAsset(kind), name: `Organize ${kind}` }));
		await saveBatch(assets.map((value) => ({ type: "asset", value })));
		return assets.map((asset) => asset.id);
	}, { repositoryPath: repositoryModuleUrl, domainPath: domainModuleUrl });
}

async function preference(page: Page, id: string) {
	return page.evaluate(async ({ repositoryPath, preferenceId }) => {
		const { localRepository } = await import(repositoryPath);
		return (await (await localRepository()).get("preference", preferenceId) as { value?: string[] } | null)?.value;
	}, { repositoryPath: repositoryModuleUrl, preferenceId: id });
}

test("sidebar organizer shows the original two-column workflow and saves order, visibility and a cross-type collection", async ({ page }) => {
	await page.setViewportSize({ width: 1144, height: 768 });
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("keepany-language", "en"));
	await page.goto("/collections");
	const ids = await seedAssets(page);
	await expect(page.getByRole("heading", { name: "Organize it your way." })).toBeVisible();
	const nav = page.getByRole("region", { name: "Sidebar sections" });
	const editor = page.getByRole("region", { name: "New collection" });
	await expect(nav).toBeVisible();
	await expect(editor).toBeVisible();
	await expect(nav.getByRole("checkbox", { name: "Show sidebar item: Overview" })).toBeDisabled();
	await expect(editor.getByRole("checkbox", { name: "Organize project" })).toBeVisible();
	await expect(editor.getByRole("checkbox", { name: "Organize account" })).toBeVisible();
	await page.screenshot({ path: join(tmpdir(), "keepany-organize-en-1144.png"), fullPage: true });

	await nav.getByRole("checkbox", { name: "Show sidebar item: Accounts" }).uncheck();
	await expect.poll(() => preference(page, "sidebarHidden")).toContain("accounts");
	await nav.getByRole("button", { name: "Move up Assets" }).click();
	await expect.poll(() => preference(page, "sidebarOrder")).toEqual(["overview", "assets", "tasks", "accounts"]);
	await page.reload();
	await expect(nav.getByRole("checkbox", { name: "Show sidebar item: Accounts" })).not.toBeChecked();
	await expect(nav.locator(".sortable-nav-item").nth(1)).toContainText("Assets");

	await editor.getByLabel("Collection name").fill("Creative studio");
	await expect(editor.getByLabel("Collection name")).toHaveValue("Creative studio");
	await editor.getByRole("checkbox", { name: "Organize project" }).check();
	await editor.getByRole("checkbox", { name: "Organize account" }).check();
	await expect(editor.getByLabel("Collection name")).toHaveValue("Creative studio");
	await editor.getByRole("button", { name: "Save collection" }).click();
	await expect(page).toHaveURL(/\/collections\/[0-9a-f-]+$/);
	await expect(page.getByText("2 assets")).toBeVisible();
	await page.goto("/collections");
	await expect(page.getByRole("region", { name: "New collection" })).toBeVisible();
	await expect(page.getByRole("region", { name: "Collections" }).getByRole("link", { name: "Creative studio" })).toBeVisible();
	await page.getByRole("button", { name: "Create another" }).click();
	await expect(page.getByLabel("Collection name")).toHaveValue("");
	const saved = await page.evaluate(async ({ repositoryPath }) => {
		const { localRepository } = await import(repositoryPath);
		return (await (await localRepository()).get("preference", "assetCollectionsV1") as { value: Array<{ assetIds: string[] }> }).value;
	}, { repositoryPath: repositoryModuleUrl });
	expect(saved[0].assetIds).toEqual(ids);
});

test("Chinese organizer renders the same two-column layout without horizontal overflow", async ({ page }) => {
	await page.setViewportSize({ width: 1144, height: 768 });
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("keepany-language", "zh-CN"));
	await page.goto("/collections");
	await seedAssets(page);
	await expect(page.getByRole("heading", { name: "按你的习惯整理。" })).toBeVisible();
	await expect(page.getByRole("region", { name: "侧边栏入口" })).toBeVisible();
	await expect(page.getByRole("region", { name: "新建分类" })).toBeVisible();
	await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
	await page.screenshot({ path: join(tmpdir(), "keepany-organize-zh-1144.png"), fullPage: true });
});
