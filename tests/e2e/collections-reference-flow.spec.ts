import { expect, test, type Page } from "@playwright/test";

const domainPath = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

async function seedAssets(page: Page) {
	return page.evaluate(async ({ domainPath, repositoryPath }) => {
		const { newAsset } = await import(domainPath);
		const { saveBatch } = await import(repositoryPath);
		const project = { ...newAsset("project"), name: "Studio project" };
		const account = { ...newAsset("account"), name: "Studio account" };
		await saveBatch([{ type: "asset", value: project }, { type: "asset", value: account }]);
		return { projectId: project.id, accountId: account.id };
	}, { domainPath, repositoryPath });
}

for (const locale of ["zh-CN", "en"] as const) {
	for (const width of [390, 1280] as const) {
		test(`${locale} ${width}px collection save, detail, edit and another use one preference`, async ({ page }) => {
			await page.setViewportSize({ width, height: width === 390 ? 844 : 720 });
			await page.goto("/");
			await page.evaluate((value) => localStorage.setItem("keepany-language", value), locale);
			const ids = await seedAssets(page);
			await page.goto("/collections");
			const createLabel = locale === "en" ? "New collection" : "新建分类";
			const editLabel = locale === "en" ? "Edit collection" : "编辑分类";
			const saveLabel = locale === "en" ? "Save collection" : "保存分类";
			const nameLabel = locale === "en" ? "Collection name" : "分类名称";
			const anotherLabel = locale === "en" ? "Create another" : "新建另一个";
			await expect(page.locator(".collections-organize-nav")).toBeVisible();
			await page.screenshot({ path: `/tmp/keepany-collections-organize-${locale}-${width}.png`, fullPage: true });
			const editor = page.getByRole("region", { name: createLabel });
			await editor.getByLabel(nameLabel).fill("Studio work");
			await editor.getByRole("checkbox", { name: "Studio project" }).check();
			await editor.getByRole("checkbox", { name: "Studio account" }).check();
			await editor.getByRole("button", { name: saveLabel }).click();
			await expect(page).toHaveURL(/\/collections\/[0-9a-f-]+$/);
			const firstId = page.url().split("/").at(-1);
			await page.reload();
			const detail = page.locator(".collections-member-grid");
			await expect(detail.locator(".collections-member-card")).toHaveCount(2);
			await expect(detail.getByRole("link", { name: /Studio project/ })).toHaveAttribute("href", `/assets/project/${ids.projectId}`);
			await expect(detail.getByRole("link", { name: /Studio account/ })).toHaveAttribute("href", `/assets/account/${ids.accountId}`);
			const cards = await detail.locator(".collections-member-card").all();
			const first = await cards[0].boundingBox();
			const second = await cards[1].boundingBox();
			expect(first && second && (width === 390 ? second.y >= first.y + first.height : second.x >= first.x + first.width)).toBeTruthy();
			await page.screenshot({ path: `/tmp/keepany-collections-detail-${locale}-${width}.png`, fullPage: true });
			await page.getByRole("button", { name: editLabel }).click();
			await expect(page.locator(".collections-organize-nav")).toBeVisible();
			await expect(detail).toHaveCount(0);
			const edit = page.getByRole("region", { name: editLabel });
			await edit.getByLabel(nameLabel).fill("Studio work updated");
			await edit.getByRole("button", { name: saveLabel }).click();
			await expect(page.getByRole("heading", { name: "Studio work updated" })).toBeVisible();
			await page.getByRole("button", { name: editLabel }).click();
			await page.getByRole("region", { name: editLabel }).getByRole("button", { name: anotherLabel }).click();
			await expect(page).toHaveURL(/\/collections$/);
			const secondEditor = page.getByRole("region", { name: createLabel });
			await expect(secondEditor.getByLabel(nameLabel)).toHaveValue("");
			await secondEditor.getByLabel(nameLabel).fill("Personal archive");
			await secondEditor.getByRole("checkbox", { name: "Studio account" }).check();
			await secondEditor.getByRole("button", { name: saveLabel }).click();
			await expect(page).toHaveURL(/\/collections\/[0-9a-f-]+$/);
			await page.reload();
			await expect(page.getByRole("heading", { name: "Personal archive" })).toBeVisible();
			await expect(page.evaluate(async (repositoryPath) => {
				const { localRepository } = await import(repositoryPath);
				const rows = await (await localRepository()).list("preference") as Array<{ id: string; value: unknown }>;
				const collectionRows = rows.filter((row) => row.id === "assetCollectionsV1");
				const collections = collectionRows[0]?.value as Array<{ id: string; name: string; assetIds: string[] }>;
				return { preferenceRows: collectionRows.length, names: collections?.map((item) => item.name), originalId: collections?.[0]?.id };
			}, repositoryPath)).resolves.toEqual({ preferenceRows: 1, names: ["Studio work updated", "Personal archive"], originalId: firstId });
			await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
		});
	}
}
