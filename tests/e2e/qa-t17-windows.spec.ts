import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const repo = `/@fs/${resolve("packages/local-db/src/index.ts").replaceAll("\\", "/")}`;
const domain = `/@fs/${resolve("packages/domain/src/index.ts").replaceAll("\\", "/")}`;
const evidence = "test-results/qa/2026-10-27/evidence/T17-windows";
mkdirSync(evidence, { recursive: true });
async function state(page: Page) {
	return page.evaluate(async path => {
		const { localRepository } = await import(path);
		const db = await localRepository();
		return { assets: await db.list("asset", true), categories: await db.list("category", true), preferences: await db.list("preference") };
	}, repo);
}
for (const locale of ["zh-CN", "en-US"] as const) for (const width of [390, 1280]) {
	test(`${locale} ${width}px T17 category membership, normalized race, exact tags and collection CAS`, async ({ browser }) => {
		test.setTimeout(150_000);
		const zh = locale === "zh-CN";
		const c = { category: zh ? "分类" : "Category", categoryName: zh ? "分类名称" : "Category name", newCategory: zh ? "新增分类" : "New category", manage: zh ? "管理" : "Manage", save: zh ? "保存分类" : "Save collection", duplicate: zh ? "该分类已存在。" : "This category already exists.", collapse: zh ? "收起" : "Collapse", edit: zh ? "编辑" : "Edit", saveAsset: zh ? "保存" : "Save", all: zh ? "全部" : "All", collectionCreate: zh ? "新建分类" : "New collection", collectionEdit: zh ? "编辑分类" : "Edit collection", collectionName: zh ? "分类名称" : "Collection name", collectionDelete: zh ? "删除分类" : "Delete collection", cancel: zh ? "取消" : "Cancel" };
		const context = await browser.newContext({ locale, viewport: { width, height: 900 } });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", e => errors.push(e.message));
		try {
			await page.goto("/");
			const assets = await page.evaluate(async ([repositoryPath, domainPath]) => {
				const { newAsset } = await import(domainPath);
				const { saveBatch } = await import(repositoryPath);
				const data = ["account", "project"].flatMap(kind => ["A", "B", "C"].map(suffix => ({ ...newAsset(kind), name: `T17 ${kind} ${suffix}`, tags: suffix === "A" ? ["Exact", "extra"] : ["ExactSuffix"] }))).concat(["subscription", "item"].map(kind => ({ ...newAsset(kind), name: `T17 ${kind}` })));
				await saveBatch([...data.map(value => ({ type: "asset", value })), { type: "preference", value: { id: "qa-t17-unrelated", value: { keep: true } } }]);
				return data;
			}, [repo, domain]);
			// T17-01: rename both account/project categories, retaining IDs and moving members.
			for (const kind of ["account", "project"]) {
				await page.goto(`/assets/${kind}`);
				await page.getByRole("button", { name: c.newCategory, exact: true }).click();
				const editor = page.getByRole("region", { name: c.category, exact: true });
				await editor.getByLabel(c.categoryName, { exact: true }).fill(`T17 ${kind}`);
				for (const suffix of ["A", "B"]) await editor.getByRole("checkbox", { name: `T17 ${kind} ${suffix}`, exact: true }).check();
				await editor.getByRole("button", { name: c.save, exact: true }).click();
				await expect(editor).toBeHidden();
				const original = (await state(page)).categories.find((v: { kind: string }) => v.kind === kind);
				await page.getByRole("button", { name: c.manage, exact: true }).click();
				await editor.getByLabel(c.categoryName, { exact: true }).fill(`T17 ${kind} renamed`);
				await editor.getByRole("checkbox", { name: `T17 ${kind} B`, exact: true }).uncheck();
				await editor.getByRole("checkbox", { name: `T17 ${kind} C`, exact: true }).check();
				await editor.getByRole("button", { name: c.save, exact: true }).click();
				await expect(editor).toBeHidden();
				await page.reload();
				const saved = await state(page);
				expect(saved.categories.find((v: { id: string }) => v.id === original.id)).toMatchObject({ name: `T17 ${kind} renamed`, deleted: false });
				for (const suffix of ["A", "C"]) expect(saved.assets.find((v: { name: string }) => v.name === `T17 ${kind} ${suffix}`)?.category).toBe(`T17 ${kind} renamed`);
				expect(saved.assets.find((v: { name: string }) => v.name === `T17 ${kind} B`)?.category).toBe("");
				const builtin = kind === "account" ? (zh ? "邮箱" : "Email") : (zh ? "网站" : "Websites");
				await page.locator(".asset-category-scroll").getByRole("button", { name: builtin, exact: true }).click();
				await expect(page.locator(".asset-category-scroll").getByRole("button", { name: builtin, exact: true })).toHaveAttribute("aria-pressed", "true");
			}
			// T17-02: double save and two actual tabs competing for normalized names.
			await page.getByRole("button", { name: c.newCategory, exact: true }).click();
			const category = page.getByRole("region", { name: c.category, exact: true });
			await category.getByLabel(c.categoryName, { exact: true }).fill("T17 Double");
			await category.getByRole("button", { name: c.save, exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
			await expect(category).toBeHidden();
			expect((await state(page)).categories.filter((v: { name: string }) => v.name === "T17 Double")).toHaveLength(1);
			await page.getByRole("button", { name: c.newCategory, exact: true }).click();
			await category.getByLabel(c.categoryName, { exact: true }).fill(" t17 DOUBLE ");
			await category.getByRole("button", { name: c.save, exact: true }).click();
			await expect(category.getByRole("alert")).toHaveText(c.duplicate);
			await expect(category.getByLabel(c.categoryName, { exact: true })).toHaveValue(" t17 DOUBLE ");
			await category.getByRole("button", { name: c.collapse, exact: true }).click();
			const other = await context.newPage();
			other.on("pageerror", e => errors.push(e.message));
			await other.goto("/assets/project");
			const pages = [page, other];
			const editors = await Promise.all(pages.map(async current => { await current.getByRole("button", { name: c.newCategory, exact: true }).click(); return current.getByRole("region", { name: c.category, exact: true }); }));
			await editors[0].getByLabel(c.categoryName, { exact: true }).fill(" T17 Race ");
			await editors[1].getByLabel(c.categoryName, { exact: true }).fill("t17 race");
			await Promise.all(editors.map(editor => editor.getByRole("button", { name: c.save, exact: true }).click()));
			await expect.poll(async () => Number(await editors[0].isVisible()) + Number(await editors[1].isVisible())).toBe(1);
			const loser = await editors[0].isVisible() ? editors[0] : editors[1];
			await expect(loser.getByRole("alert")).toHaveText(c.duplicate);
			await expect(loser.getByLabel(c.categoryName, { exact: true })).toHaveValue(/T17 Race|t17 race/);
			expect((await state(page)).categories.filter((v: { name: string }) => v.name.trim().toLowerCase() === "t17 race")).toHaveLength(1);
			await other.close();
			// T17-03: ordinary asset editor adds/removes tags, then exact intersection.
			const account = assets.find((v: { name: string }) => v.name === "T17 account A");
			await page.goto(`/assets/account/${account.id}`);
			await page.locator(".page-header").getByRole("button", { name: c.edit, exact: true }).click();
			await page.locator("#tags").fill("Exact, retained");
			await page.getByRole("dialog").getByRole("button", { name: c.saveAsset, exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			expect((await state(page)).assets.find((v: { id: string }) => v.id === account.id)?.tags).toEqual(["Exact", "retained"]);
			await page.goto("/assets/account");
			await page.locator(".asset-category-scroll").getByRole("button", { name: "T17 account renamed", exact: true }).click();
			await selectChoice(page.locator("#asset-tag-filter"), "Exact");
			const search = page.locator(".asset-account-search input[type=search]");
			await search.fill("T17 account");
			await expect(page.locator(".asset-account-card strong")).toHaveText(["T17 account A"]);
			await page.reload();
			await expect(search).toHaveValue("T17 account");
			await expect(page.locator("#asset-tag-filter")).toHaveAttribute("data-value", "Exact");
			await expect(page.locator(".asset-account-card strong")).toHaveText(["T17 account A"]);
			await search.fill("no match");
			await expect(page.locator(".asset-account-card")).toHaveCount(0);
			await search.fill("");
			await selectChoice(page.locator("#asset-tag-filter"), "");
			await page.locator(".asset-category-scroll").getByRole("button", { name: c.all, exact: true }).click();
			await expect(page.locator(".asset-account-card")).toHaveCount(3);
			// T17-04: all four kinds; organizer order; two-tab edit rejects stale write.
			await page.goto("/collections");
			const nav = page.getByRole("region", { name: zh ? "侧边栏入口" : "Sidebar sections", exact: true });
			await nav.getByRole("button", { name: zh ? "上移 资产" : "Move up Assets", exact: true }).click();
			const navOrder = (await state(page)).preferences.find((v: { id: string }) => v.id === "sidebarOrder");
			const collectionEditor = page.getByRole("region", { name: c.collectionCreate, exact: true });
			await collectionEditor.getByLabel(c.collectionName, { exact: true }).fill("T17 Operations");
			const members = [assets[3], assets[0], assets[6], assets[7]];
			for (const member of members) await collectionEditor.getByRole("checkbox", { name: member.name, exact: true }).check();
			await collectionEditor.getByRole("button", { name: c.save, exact: true }).click();
			await expect(page.getByRole("heading", { name: "T17 Operations", exact: true })).toBeVisible();
			const collectionPath = new URL(page.url()).pathname;
			await page.reload();
			const beforeCollections = await state(page);
			const collection = beforeCollections.preferences.find((v: { id: string }) => v.id === "assetCollectionsV1").value[0];
			expect(collection.assetIds).toEqual(members.map(v => v.id));
			const concurrent = await context.newPage();
			concurrent.on("pageerror", e => errors.push(e.message));
			await concurrent.goto(collectionPath);
			await Promise.all([page, concurrent].map(current => current.getByRole("button", { name: c.collectionEdit, exact: true }).click()));
			await page.getByLabel(c.collectionName, { exact: true }).fill("T17 Local draft");
			await concurrent.getByLabel(c.collectionName, { exact: true }).fill("T17 Remote update");
			await concurrent.getByRole("region", { name: c.collectionEdit, exact: true }).getByRole("button", { name: c.save, exact: true }).click();
			await expect(concurrent.getByRole("heading", { name: "T17 Remote update", exact: true })).toBeVisible();
			const edit = page.getByRole("region", { name: c.collectionEdit, exact: true });
			await edit.getByRole("button", { name: c.save, exact: true }).click();
			await expect(edit.getByRole("alert")).toContainText(zh ? "集合已在别处更新，请重新打开。" : "changed elsewhere");
			await expect(edit.getByLabel(c.collectionName, { exact: true })).toHaveValue("T17 Local draft");
			expect((await state(page)).preferences.find((v: { id: string }) => v.id === "assetCollectionsV1").value[0].name).toBe("T17 Remote update");
			await concurrent.close();
			await edit.getByRole("button", { name: c.cancel, exact: true }).click();
			await page.getByRole("button", { name: c.collectionEdit, exact: true }).click();
			for (const member of members) await edit.getByRole("checkbox", { name: member.name, exact: true }).uncheck();
			for (const member of members.slice(1).reverse()) await edit.getByRole("checkbox", { name: member.name, exact: true }).check();
			await edit.getByRole("button", { name: c.save, exact: true }).click();
			await expect(edit).toBeHidden();
			await page.reload();
			const saved = await state(page);
			expect(saved.preferences.find((v: { id: string }) => v.id === "assetCollectionsV1").value[0]).toEqual({ ...collection, name: "T17 Remote update", assetIds: members.slice(1).reverse().map(v => v.id) });
			expect(saved.preferences.find((v: { id: string }) => v.id === "sidebarOrder")).toEqual(navOrder);
			expect(saved.preferences.find((v: { id: string }) => v.id === "qa-t17-unrelated")).toEqual(beforeCollections.preferences.find((v: { id: string }) => v.id === "qa-t17-unrelated"));
			expect(saved.assets).toEqual(beforeCollections.assets);
			if ((zh && width === 390) || (!zh && width === 1280)) await page.locator(".collections-members").screenshot({ path: `${evidence}/T17-${locale}-${width}.png` });
			await page.getByRole("button", { name: c.collectionEdit, exact: true }).click();
			await edit.getByRole("button", { name: c.collectionDelete, exact: true }).click();
			await page.getByRole("dialog").getByRole("button", { name: c.collectionDelete, exact: true }).click();
			await expect(page).toHaveURL(/\/collections$/);
			await page.reload();
			const deleted = await state(page);
			expect(deleted.preferences.find((v: { id: string }) => v.id === "assetCollectionsV1").value).toEqual([]);
			expect(deleted.assets).toEqual(beforeCollections.assets);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}


