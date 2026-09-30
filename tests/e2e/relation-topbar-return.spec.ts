import { expect, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

test("topbar and detail return to the source list after opening a related asset", async ({ page }) => {
	async function add(kind: "project" | "account", name: string) {
		await page.goto(`/assets/${kind}`);
		await page.getByRole("button", { name: "Add", exact: true }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill(name);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
	}
	await add("account", "Linked login");
	await add("project", "Source project");
	await page.getByText("Source project", { exact: true }).first().click();
	await page.getByRole("button", { name: "Add connection" }).click();
	const relation = page.getByRole("dialog");
	await selectChoice(relation.getByLabel("Connect to"), { label: "Linked login" });
	await relation.getByLabel("Connection label").fill("Login account");
	await relation.getByRole("button", { name: "Save" }).click();
	await expect(relation).toBeHidden();
	async function openLinked() {
		await page.locator(".react-flow__node").filter({ hasText: "Linked login" }).click();
		await expect(page).toHaveURL(/\/assets\/account\//);
		await expect(page.getByRole("heading", { name: "Linked login" })).toBeVisible();
	}
	await openLinked();
	await page.locator(".topbar-back-link").click();
	await expect(page).toHaveURL(/\/assets\/project$/);
	await page.getByText("Source project", { exact: true }).first().click();
	await openLinked();
	await page.getByRole("main").getByRole("link", { name: "Back to list" }).click();
	await expect(page).toHaveURL(/\/assets\/project$/);
});
