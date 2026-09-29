import { expect, test } from "@playwright/test";

test("mobile collection sidebar link survives reload and returns to collection management", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("keepany-language", "en"));
	await page.goto("/collections");
	const sidebar = page.locator("aside.sidebar");
	await expect(sidebar.getByRole("link", { name: "Manage collections" })).toBeVisible();
	await page.getByRole("button", { name: "New collection" }).first().click();
	await page.getByLabel("Collection name").fill("Launch set");
	await page.getByRole("button", { name: "Save collection" }).click();
	await expect(page).toHaveURL(/\/collections\/[^/]+$/);
	const collectionLink = sidebar.getByRole("link", { name: "Launch set" });
	await expect(collectionLink).toBeVisible();
	await expect(collectionLink).toHaveAttribute("aria-current", "page");
	await page.locator(".topbar-back-link").click();
	await expect(page).toHaveURL(/\/collections$/);
	await expect(sidebar.getByRole("link", { name: "Manage collections" })).toHaveAttribute("aria-current", "page");
	await collectionLink.click();
	await expect(page.getByRole("heading", { name: "Launch set" })).toBeVisible();
	await page.reload();
	await expect(collectionLink).toHaveAttribute("aria-current", "page");
	await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
});
