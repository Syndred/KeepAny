import { expect, type Page } from "@playwright/test";

/** Seed through the shipped UI so shell checks work against release packages. */
export async function createProject(page: Page, name: string) {
	await page.goto("/assets/project");
	await page.getByRole("button", { name: /^(Add|新增)$/, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(/^(Name|名称)$/, { exact: true }).fill(name);
	await dialog
		.getByRole("button", { name: /^(Save|保存)$/, exact: true })
		.click();
	await expect(dialog).toBeHidden();
	await page.locator("main.page .asset-project-card").filter({ hasText: name }).click();
	await expect(page).toHaveURL(/\/assets\/project\/[^/]+$/);
	const id = new URL(page.url()).pathname.split("/").at(-1);
	if (!id) throw new Error("Project detail has no ID");
	return id;
}
