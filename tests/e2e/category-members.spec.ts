import { expect, test } from "@playwright/test";

test.use({ locale: "en-US" });

test("project category members are saved to the local asset records", async ({ page }) => {
	await page.goto("/assets/project");
	const first = `Category member ${crypto.randomUUID().slice(0, 8)}`;
	const second = `Other member ${crypto.randomUUID().slice(0, 8)}`;
	for (const name of [first, second]) {
		await page.getByRole("button", { name: "Add", exact: true }).click();
		const editor = page.getByRole("dialog");
		await editor.getByLabel("Name", { exact: true }).fill(name);
		await editor.getByRole("button", { name: "Save", exact: true }).click();
		await expect(editor).toBeHidden();
	}
	await page.getByRole("button", { name: "New category", exact: true }).click();
	const manager = page.getByRole("region", { name: "Category", exact: true });
	await manager.getByLabel("Category name").fill("Launch group");
	await manager.getByRole("button", { name: "Save collection", exact: true }).click();
	await expect(manager).toBeHidden();
	await page.getByRole("button", { name: "Manage", exact: true }).click();
	const members = manager.locator(".asset-category-member-list");
	await members.getByLabel(first).check();
	await manager.getByRole("button", { name: "Save collection", exact: true }).click();
	await expect(manager).toBeHidden();
	await page.reload();
	await page.getByRole("button", { name: "Launch group", exact: true }).first().click();
	await expect(page.locator("main.page .asset-project-card").filter({ hasText: first })).toBeVisible();
	await expect(page.locator("main.page .asset-project-card").filter({ hasText: second })).toHaveCount(0);
	await page.getByRole("button", { name: "Manage", exact: true }).click();
	await members.getByLabel(first).uncheck();
	await manager.getByRole("button", { name: "Save collection", exact: true }).click();
	await expect(manager).toBeHidden();
	await page.reload();
	await expect(page.locator("main.page .asset-project-card")).toHaveCount(0);
	await page.getByRole("button", { name: "All", exact: true }).first().click();
	await expect(page.locator("main.page .asset-project-card").filter({ hasText: first })).toBeVisible();
	await expect(page.locator("main.page .asset-project-card").filter({ hasText: second })).toBeVisible();
});
