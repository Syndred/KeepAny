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

test("CSV candidate edit checks empty, length and duplicate names before batch import", async ({ page }) => {
	await page.goto("/intake");
	await page.locator(".intake-mode-tabs").getByRole("button", { name: "Spreadsheet" }).click();
	await page.locator("#csv-file").setInputFiles({
		name: "candidate-edit.csv",
		mimeType: "text/csv",
		buffer: Buffer.from("name,kind\nAlpha,project\nAlpha,project"),
	});
	const preview = page.locator(".import-preview");
	await expect(preview.locator(".list-row")).toHaveCount(2);
	await expect(preview.locator(".list-row").nth(1)).toContainText("Duplicate");
	await preview.getByRole("textbox", { name: "Name 2" }).fill("Beta");
	await expect(preview.locator(".list-row").nth(1).getByRole("checkbox")).toBeChecked();
	const first = preview.getByRole("textbox", { name: "Name 1" });
	await first.fill("");
	await expect(preview.getByRole("button", { name: "Confirm import" })).toBeDisabled();
	await first.fill("X".repeat(161));
	await expect(preview.getByRole("button", { name: "Confirm import" })).toBeDisabled();
	await first.fill("Beta");
	await expect(preview.locator(".list-row").nth(1)).toContainText("Duplicate");
	await expect(preview.getByRole("button", { name: "Confirm import" })).toBeDisabled();
	await first.fill("Alpha edited");
	await expect(preview.getByRole("button", { name: "Confirm import" })).toBeEnabled();
	await page.evaluate(async ({ repositoryPath, domainPath }) => {
		const { save } = await import(repositoryPath);
		const { newAsset } = await import(domainPath);
		await save("asset", { ...newAsset("project"), name: "Alpha edited" });
	}, {
		repositoryPath: repositoryModuleUrl,
		domainPath: `/@fs${process.cwd()}/packages/domain/src/index.ts`,
	});
	await preview.getByRole("button", { name: "Confirm import" }).click();
	await expect(preview.locator(".list-row").first()).toContainText("Duplicate");
	expect(await projectNames(page)).toEqual(["Alpha edited"]);
	await preview.locator(".list-row").first().getByRole("checkbox").uncheck();
	await expect(preview.getByRole("button", { name: "Confirm import" })).toBeEnabled();
	await first.fill("Alpha imported");
	await preview.getByRole("button", { name: "Confirm import" }).click();
	await expect(page.getByText("Import complete · 2")).toBeVisible();
	expect((await projectNames(page)).sort()).toEqual(["Alpha edited", "Alpha imported", "Beta"]);
});
