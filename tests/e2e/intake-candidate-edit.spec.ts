import { expect, test, type Page } from "@playwright/test";

const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

async function projectNames(page: Page): Promise<string[]> {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		return (await (await localRepository()).allRecords())
			.filter((row: { type: string }) => row.type === "asset")
			.map((row: { payload: string }) => JSON.parse(row.payload))
			.filter((asset: { kind: string; deleted: boolean }) => asset.kind === "project" && !asset.deleted)
			.map((asset: { name: string }) => asset.name);
	}, repositoryModuleUrl);
}

test("URL candidate name is edited before the RxDB write", async ({ page }) => {
	await page.goto("/intake");
	await page.locator("#import-url").fill("https://candidate.example.test/");
	await page.getByRole("button", { name: "Preview" }).first().click();
	const preview = page.locator(".import-preview");
	await expect(preview.getByRole("textbox", { name: "Name 1" })).toHaveValue("candidate.example.test");
	await preview.getByRole("textbox", { name: "Name 1" }).fill("Edited candidate");
	await preview.getByRole("button", { name: "Confirm import" }).click();
	await expect(page.getByText("Import complete · 1")).toBeVisible();
	expect(await projectNames(page)).toEqual(["Edited candidate"]);
});

test("CSV candidates are edited and confirmed individually with duplicate blocking", async ({ page }) => {
	await page.goto("/intake");
	await page.locator(".intake-mode-tabs").getByRole("button", { name: "Spreadsheet" }).click();
	await page.locator("#csv-file").setInputFiles({
		name: "candidate-edit.csv",
		mimeType: "text/csv",
		buffer: Buffer.from("name,kind\nAlpha,project\nAlpha,project"),
	});
	const rows = page.locator(".intake-review-row");
	await expect(rows).toHaveCount(2);
	const first = rows.first();
	const second = rows.nth(1);
	const name = first.getByLabel("Name");
	await name.fill("");
	await first.getByRole("button", { name: "Confirm and save" }).click();
	await expect(page.locator(".intake-review-message")).toContainText("Check the name");
	await name.fill("X".repeat(161));
	await first.getByRole("button", { name: "Confirm and save" }).click();
	await expect(page.locator(".intake-review-message")).toContainText("Check the name");
	await name.fill("Alpha");
	await first.getByRole("button", { name: "Confirm and save" }).click();
	await expect(first).toContainText("Confirmed");
	await second.getByRole("button", { name: "Confirm and save" }).click();
	await expect(page.locator(".intake-review-message")).toContainText("Duplicate");
	expect(await projectNames(page)).toEqual(["Alpha"]);
	await second.getByLabel("Name").fill("Beta");
	await second.getByRole("button", { name: "Confirm and save" }).click();
	await expect(second).toContainText("Confirmed");
	expect((await projectNames(page)).sort()).toEqual(["Alpha", "Beta"]);
});
