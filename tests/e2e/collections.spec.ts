import { expect, test, type Page } from "@playwright/test";

const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainModuleUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
const preferenceId = "assetCollectionsV1";

async function seedAssets(page: Page) {
	return page.evaluate(async ({ repositoryPath, domainPath }) => {
		const { saveBatch } = await import(repositoryPath);
		const { newAsset } = await import(domainPath);
		const assets = (["project", "account", "subscription", "item"] as const).map((kind) => ({
			...newAsset(kind),
			name: `Collection ${kind}`,
		}));
		await saveBatch(assets.map((value) => ({ type: "asset", value })));
		return Object.fromEntries(assets.map((asset) => [asset.kind, asset.id])) as Record<string, string>;
	}, { repositoryPath: repositoryModuleUrl, domainPath: domainModuleUrl });
}

async function savedCollections(page: Page) {
	return page.evaluate(async ({ repositoryPath, id }) => {
		const { localRepository } = await import(repositoryPath);
		const preference = await (await localRepository()).get("preference", id) as { value: unknown } | null;
		return preference?.value as Array<{ id: string; name: string; assetIds: string[] }> | undefined;
	}, { repositoryPath: repositoryModuleUrl, id: preferenceId });
}

test("cross-type collection create, edit, asset links, refresh and delete use one preference", async ({ page }) => {
	await page.goto("/collections");
	const ids = await seedAssets(page);
	await page.getByRole("button", { name: "New collection" }).first().click();
	const editor = page.getByRole("region", { name: "New collection" });
	await editor.getByLabel("Collection name").fill("Operations");
	await editor.getByRole("checkbox", { name: "Collection project" }).check();
	await editor.getByRole("checkbox", { name: "Collection account" }).check();
	await editor.getByRole("button", { name: "Save collection" }).click();
	await expect(page).toHaveURL(/\/collections\/[0-9a-f-]+$/);
	await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
	await expect(page.getByText("2 assets")).toBeVisible();
	const first = await savedCollections(page);
	expect(first).toHaveLength(1);
	expect(first?.[0].assetIds).toEqual([ids.project, ids.account]);

	await page.reload();
	await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
	await expect(page.locator(".sidebar-collection").filter({ hasText: "Operations" })).toBeVisible();
	await page.evaluate(async ({ modulePath, id }) => {
		const { localRepository, saveAssetIfCurrent } = await import(modulePath);
		const project = await (await localRepository()).get("asset", id);
		await saveAssetIfCurrent(project, { ...project, deleted: true, updatedAt: new Date().toISOString() });
	}, { modulePath: repositoryModuleUrl, id: ids.project });
	await expect(page.getByRole("region", { name: "Operations" }).getByRole("link", { name: /Collection project/ })).toHaveCount(0);
	expect((await savedCollections(page))?.[0].assetIds).toContain(ids.project);
	await page.evaluate(async ({ modulePath, id }) => {
		const { restoreEntity } = await import(modulePath);
		await restoreEntity("asset", id);
	}, { modulePath: repositoryModuleUrl, id: ids.project });
	await expect(page.getByRole("region", { name: "Operations" }).getByRole("link", { name: /Collection project/ })).toBeVisible();
	await page.getByRole("region", { name: "Operations" }).getByRole("link", { name: /Collection project/ }).click();
	await expect(page).toHaveURL(new RegExp(`/assets/project/${ids.project}$`));
	await expect(page.getByRole("heading", { name: "Collection project" })).toBeVisible();
	await page.goto(`/collections/${first?.[0].id}`);
	await page.getByRole("button", { name: "Edit collection" }).click();
	const edit = page.getByRole("region", { name: "Edit collection" });
	await edit.getByLabel("Collection name").fill("Operations updated");
	await edit.getByRole("checkbox", { name: "Collection project" }).uncheck();
	await edit.getByRole("checkbox", { name: "Collection subscription" }).check();
	await edit.getByRole("button", { name: "Save collection" }).click();
	await expect(page.getByRole("heading", { name: "Operations updated" })).toBeVisible();
	await page.reload();
	const edited = await savedCollections(page);
	expect(edited?.[0]).toEqual({ id: first?.[0].id, name: "Operations updated", assetIds: [ids.account, ids.subscription] });
	await expect(page.getByRole("region", { name: "Operations updated" }).getByRole("link", { name: /Collection project/ })).toHaveCount(0);

	await page.getByRole("button", { name: "Edit collection" }).click();
	await page.getByRole("region", { name: "Edit collection" }).getByRole("button", { name: "Delete collection" }).click();
	const confirmation = page.getByRole("dialog", { name: "Delete collection" });
	await confirmation.getByRole("button", { name: "Delete collection" }).click();
	await expect(page).toHaveURL(/\/collections$/);
	expect(await savedCollections(page)).toEqual([]);
	await page.goto(`/assets/account/${ids.account}`);
	await expect(page.getByRole("heading", { name: "Collection account" })).toBeVisible();
});

test("collection names reject empty, overlong and case-folded duplicates", async ({ page }) => {
	await page.goto("/collections");
	await page.getByRole("button", { name: "New collection" }).first().click();
	let editor = page.getByRole("region", { name: "New collection" });
	await editor.getByRole("button", { name: "Save collection" }).click();
	await expect(editor.getByRole("alert")).toContainText("required");
	await editor.getByLabel("Collection name").fill("X".repeat(21));
	await editor.getByRole("button", { name: "Save collection" }).click();
	await expect(editor.getByRole("alert")).toContainText("20 characters");
	await editor.getByLabel("Collection name").fill("Planning");
	await editor.getByRole("button", { name: "Save collection" }).click();
	await expect(page).toHaveURL(/\/collections\/[0-9a-f-]+$/);
	await page.getByRole("link", { name: "Back to collections" }).click();
	await page.getByRole("button", { name: "New collection" }).click();
	editor = page.getByRole("region", { name: "New collection" });
	await editor.getByLabel("Collection name").fill(" planning ");
	await editor.getByRole("button", { name: "Save collection" }).click();
	await expect(editor.getByRole("alert")).toContainText("already exists");
	expect((await savedCollections(page))?.map((collection) => collection.name)).toEqual(["Planning"]);
});

test("a concurrent preference change stops a collection edit without losing the other write", async ({ page }) => {
	await page.goto("/collections");
	await page.getByRole("button", { name: "New collection" }).first().click();
	let editor = page.getByRole("region", { name: "New collection" });
	await editor.getByLabel("Collection name").fill("Shared");
	await editor.getByRole("button", { name: "Save collection" }).click();
	await page.getByRole("button", { name: "Edit collection" }).click();
	editor = page.getByRole("region", { name: "Edit collection" });
	await editor.getByLabel("Collection name").fill("Local edit");
	await page.evaluate(async ({ modulePath, id }) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		const originalCas = repository.savePreferenceIfCurrent.bind(repository);
		const originalSave = repository.save.bind(repository);
		let injected = false;
		repository.savePreferenceIfCurrent = async (expected: { id: string; value: unknown } | null, next: { id: string; value: unknown }) => {
			if (!injected) {
				injected = true;
				const entries = (expected?.value ?? []) as Array<{ id: string; name: string; assetIds: string[] }>;
				await originalSave("preference", { id, value: entries.map((entry) => ({ ...entry, name: "Concurrent edit" })) });
			}
			return originalCas(expected, next);
		};
	}, { modulePath: repositoryModuleUrl, id: preferenceId });
	await editor.getByRole("button", { name: "Save collection" }).click();
	await expect(editor.getByRole("alert")).toContainText("changed elsewhere");
	expect((await savedCollections(page))?.map((collection) => collection.name)).toEqual(["Concurrent edit"]);
});
