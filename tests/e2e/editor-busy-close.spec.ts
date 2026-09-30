import { expect, test, type Page } from "@playwright/test";

const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

async function holdNextSave(page: Page, entity: "asset" | "task", reject = false) {
	const modulePath = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name).find((name) => name.includes("/packages/local-db/src/index.ts")));
	if (!modulePath) throw Error("local-repository-module-not-loaded");
	await page.evaluate(async ({ modulePath, entity, reject }) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		const original = repository.save.bind(repository);
		const host = window as typeof window & {
			__saveStarted?: boolean;
			__releaseSave?: () => void;
		};
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => { release = resolve; });
		host.__saveStarted = false;
		host.__releaseSave = release;
		let held = false;
		repository.save = async (type: import("../../packages/domain/src").EntityType, value: unknown) => {
			if (!held && type === entity) {
				held = true;
				host.__saveStarted = true;
				await gate;
				if (reject) throw Error("held-save-failure");
			}
			return original(type, value);
		};
	}, { modulePath, entity, reject });
}

async function waitForSave(page: Page) {
	await expect.poll(() => page.evaluate(() => (window as typeof window & { __saveStarted?: boolean }).__saveStarted)).toBe(true);
}

async function releaseSave(page: Page) {
	await page.evaluate(() => (window as typeof window & { __releaseSave?: () => void }).__releaseSave?.());
}

async function storedNames(page: Page, entity: "asset" | "task") {
	return page.evaluate(async ({ modulePath, entity }) => {
		const { localRepository } = await import(modulePath);
		return (await (await localRepository()).allRecords())
			.filter((row: { type: string }) => row.type === entity)
			.map((row: { payload: string }) => JSON.parse(row.payload))
			.filter((record: { deleted: boolean }) => !record.deleted)
			.map((record: { name: string }) => record.name);
	}, { modulePath: repositoryModuleUrl, entity });
}

test("AssetEditor cannot close from X, Escape, overlay or Cancel during a failed write", async ({ page }) => {
	await page.goto("/assets/account");
	await page.getByRole("main").getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name", { exact: true }).fill("Held asset");
	await holdNextSave(page, "asset", true);
	await dialog.getByRole("button", { name: "Save" }).click();
	await waitForSave(page);
	await dialog.getByRole("button", { name: "Close" }).click();
	await page.keyboard.press("Escape");
	await page.locator(".overlay").click({ position: { x: 5, y: 5 } });
	await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
	await expect(dialog).toBeVisible();
	await releaseSave(page);
	await expect(dialog.getByRole("alert")).toBeVisible();
	await expect(dialog).toBeVisible();
	expect(await storedNames(page, "asset")).not.toContain("Held asset");
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(dialog).toBeHidden();
});

test("TaskEditor remains open during save and closes only after the write succeeds", async ({ page }) => {
	await page.goto("/tasks");
	await page.getByRole("button", { name: "New task" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name", { exact: true }).fill("Held task");
	await holdNextSave(page, "task");
	await dialog.getByRole("button", { name: "Save" }).click();
	await waitForSave(page);
	await dialog.getByRole("button", { name: "Close" }).click();
	await page.keyboard.press("Escape");
	await page.locator(".overlay").click({ position: { x: 5, y: 5 } });
	await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
	await expect(dialog).toBeVisible();
	await releaseSave(page);
	await expect(dialog).toBeHidden();
	expect((await storedNames(page, "task")).filter((name: string) => name === "Held task")).toHaveLength(1);
});
