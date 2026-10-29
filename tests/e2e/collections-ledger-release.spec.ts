import { openVaultReferences } from "./helpers/vault-access";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import type { Asset } from "../../packages/domain/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { selectChoice } from "./helpers/select-choice";

const password = "collection-user-flow-backup-2026";
test.use({ actionTimeout: 15_000 });
const kinds = ["project", "account", "subscription", "item", "vault"] as const;
const names = Object.fromEntries(kinds.map((kind) => [kind, `Travel ${kind}`]));
const longCategory = "C".repeat(60);
const copyFor = (zh: boolean) => zh ? {
	add: "新增", name: "名称", save: "保存", create: "新建分类", newCategory: "新增分类", edit: "编辑分类", collectionName: "分类名称", collectionSave: "保存分类", another: "新建另一个", cancel: "取消", move: "移至回收站", restore: "恢复", statusChange: "记录状态变更", statusSave: "保存状态", idle: "闲置", backup: "创建备份", download: "保存备份文件", preview: "预览", confirm: /确认 ·/, restored: /已恢复 \d+ 条记录/, sidebar: "侧边栏入口", hideAccounts: "显示侧栏入口: 账号", moveAssets: "上移 资产", item: "实物", subscription: "订阅", assets: "资产", tasks: "待办", duplicate: "已存在",
} : {
	add: "Add", name: "Name", save: "Save", create: "New collection", newCategory: "New category", edit: "Edit collection", collectionName: "Collection name", collectionSave: "Save collection", another: "Create another", cancel: "Cancel", move: "Move to trash", restore: "Restore", statusChange: "Record status change", statusSave: "Save status", idle: "Idle", backup: "Create backup", download: "Save backup file", preview: "Preview", confirm: /Confirm ·/, restored: /Restored \d+ records/, sidebar: "Sidebar sections", hideAccounts: "Show sidebar item: Accounts", moveAssets: "Move up Assets", item: "Items", subscription: "Subscriptions", assets: "Assets", tasks: "Tasks", duplicate: "already exists",
};
type Copy = ReturnType<typeof copyFor>;
type SavedCollection = { id: string; name: string; assetIds: string[] };
type SavedPreference = { id: string; value: unknown };

async function download(page: Page, copy: Copy) {
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: copy.backup, exact: true }).click();
	const link = page.getByRole("link", { name: copy.download, exact: true });
	await expect(link).toBeVisible();
	const pending = page.waitForEvent("download");
	await link.click();
	const file = await pending;
	const path = await file.path();
	if (!path) throw Error("collection-backup-download-missing");
	expect(file.suggestedFilename()).toMatch(/\.ka1$/);
	const archive = unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)), password));
	const rows = JSON.parse(strFromU8(archive["records.json"])) as Array<{ type: string; payload: string }>;
	const assets = rows.filter((row) => row.type === "asset").map((row) => JSON.parse(row.payload) as Asset);
	const preferences = rows.filter((row) => row.type === "preference").map((row) => JSON.parse(row.payload) as SavedPreference);
	const collectionRows = preferences.filter((row) => row.id === "assetCollectionsV1");
	expect(collectionRows).toHaveLength(1);
	return { path, assets, preferences, collections: collectionRows[0].value as SavedCollection[] };
}

async function assertCards(page: Page, name: string, count: number, copy: Copy, width: number) {
	await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
	const cards = page.locator(".collections-member-card");
	await expect(cards).toHaveCount(count);
	const item = cards.filter({ hasText: names.item });
	await expect(item).toContainText(copy.idle);
	const categoryLabel = item.locator(".collections-member-cover span");
	await expect(categoryLabel).toHaveText(longCategory);
	const labelGeometry = await categoryLabel.evaluate((element) => {
		const cover = element.parentElement?.getBoundingClientRect();
		const label = element.getBoundingClientRect();
		return {
			labelRight: label.right,
			coverRight: cover?.right ?? 0,
			scrollWidth: element.scrollWidth,
			clientWidth: element.clientWidth,
		};
	});
	expect(labelGeometry.labelRight).toBeLessThanOrEqual(labelGeometry.coverRight + 1);
	expect(labelGeometry.scrollWidth).toBeLessThanOrEqual(labelGeometry.clientWidth + 1);
	const geometry = await cards.evaluateAll((elements) => elements.map((element) => {
		const rect = element.getBoundingClientRect();
		return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
	}));
	expect(geometry.every((rect) => rect.x >= 0 && rect.x + rect.width <= width)).toBe(true);
	if (width === 390) for (let index = 1; index < geometry.length; index++) {
		expect(geometry[index].y).toBeGreaterThanOrEqual(geometry[index - 1].y + geometry[index - 1].height + 8);
	}
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

async function assertSidebarCategory(page: Page, width: number) {
	const sidebar = page.locator(".sidebar");
	if (width <= 760) {
		await page.locator(".mobile-menu").click();
		await expect(sidebar).toHaveClass(/open/);
	}
	const category = sidebar.locator(".sidebar-category").filter({ hasText: longCategory });
	await expect(category).toHaveCount(1);
	await expect(category).toHaveText(longCategory);
	await expect(category).toHaveAttribute("title", longCategory);
	const categoryLabel = category.locator(":scope > span");
	await expect(categoryLabel).toHaveText(longCategory);
	const categoryGeometry = await category.evaluate((element) => {
		const sidebarRect = element.closest(".sidebar")?.getBoundingClientRect();
		const label = element.querySelector(":scope > span");
		const rect = element.getBoundingClientRect();
		const labelRect = label?.getBoundingClientRect();
		const style = label ? getComputedStyle(label) : null;
		return {
			right: rect.right,
			sidebarRight: sidebarRect?.right ?? 0,
			labelRight: labelRect?.right ?? 0,
			scrollWidth: label?.scrollWidth ?? 0,
			clientWidth: label?.clientWidth ?? 0,
			overflow: style?.overflow ?? "",
			textOverflow: style?.textOverflow ?? "",
			whiteSpace: style?.whiteSpace ?? "",
		};
	});
	expect(categoryGeometry.right).toBeLessThanOrEqual(categoryGeometry.sidebarRight + 1);
	expect(categoryGeometry.labelRight).toBeLessThanOrEqual(categoryGeometry.right + 1);
	expect(categoryGeometry.scrollWidth).toBeGreaterThan(categoryGeometry.clientWidth);
	expect(categoryGeometry.overflow).toBe("hidden");
	expect(categoryGeometry.textOverflow).toBe("ellipsis");
	expect(categoryGeometry.whiteSpace).toBe("nowrap");
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
	if (width <= 760) await sidebar.locator(".mobile-close").click();
}

for (const variant of [{ locale: "zh-CN", width: 390 }, { locale: "en-US", width: 1280 }] as const) {
	test(`${variant.locale} ${variant.width} five asset types retain collection identity through trash and clean restore`, async ({ browser }) => {
		test.setTimeout(150_000);
		const copy = copyFor(variant.locale === "zh-CN");
		const source = await browser.newContext({ locale: variant.locale, viewport: { width: variant.width, height: 844 }, acceptDownloads: true });
		const page = await source.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			for (const kind of kinds) {
				await page.goto(`/assets/${kind}`);
				if (kind === "vault") await openVaultReferences(page);
				await page.getByRole("button", { name: kind === "vault" ? variant.locale === "zh-CN" ? "关联密码库条目" : "Link vault entry" : copy.add, exact: true }).click();
				const form = page.getByRole("dialog");
				await form.getByLabel(kind === "vault" ? variant.locale === "zh-CN" ? "条目名称" : "Entry name" : copy.name, { exact: true }).fill(names[kind]);
				await form.getByRole("button", { name: copy.save, exact: true }).click();
				await expect(form).toBeHidden();
			}
			await page.goto("/assets/item");
			await page.getByRole("button", { name: copy.newCategory, exact: true }).click();
			const categoryEditor = page.locator(".asset-category-inline");
			await expect(categoryEditor).toBeVisible();
			await categoryEditor.locator("#category-name").fill(longCategory);
			await categoryEditor.locator(".asset-category-member-list label").filter({ hasText: names.item }).locator("input[type=checkbox]").check();
			await categoryEditor.getByRole("button", { name: copy.collectionSave, exact: true }).click();
			await expect(categoryEditor).toHaveCount(0);
			await page.locator("main .asset-list-content a").filter({ hasText: names.item }).click();
			const itemHref = new URL(page.url()).pathname;
			await page.getByRole("button", { name: copy.statusChange, exact: true }).click();
			const status = page.getByRole("dialog");
			await selectChoice(status.locator("#item-lifecycle-status"), "idle");
			await status.locator("#item-status-date").fill("2026-09-30");
			await status.getByRole("button", { name: copy.statusSave, exact: true }).click();
			await expect(status).toBeHidden();
			await page.goto("/collections");
			await assertSidebarCategory(page, variant.width);
			const sections = page.getByRole("region", { name: copy.sidebar, exact: true });
			await expect(sections.getByRole("checkbox", { name: copy.hideAccounts, exact: true })).toHaveCSS("accent-color", "rgb(255, 210, 76)");
			await sections.getByRole("button", { name: copy.moveAssets, exact: true }).click();
			await sections.getByRole("checkbox", { name: copy.hideAccounts, exact: true }).uncheck();
			const editor = page.getByRole("region", { name: copy.create, exact: true });
			await editor.getByLabel(copy.collectionName, { exact: true }).fill("Travel cabinet");
			for (const kind of kinds) await editor.getByRole("checkbox", { name: names[kind], exact: true }).check();
			await editor.getByRole("button", { name: copy.collectionSave, exact: true }).click();
			await expect(page).toHaveURL(/\/collections\/[0-9a-f-]+$/);
			const collectionHref = new URL(page.url()).pathname;
			await page.reload();
			await assertSidebarCategory(page, variant.width);
			await assertCards(page, "Travel cabinet", 5, copy, variant.width);
			await page.locator(".collections-member-card").filter({ hasText: names.item }).click();
			await expect(page).toHaveURL(new RegExp(`${itemHref}$`));
			await page.getByRole("button", { name: copy.move, exact: true }).click();
			await page.getByRole("dialog").getByRole("button", { name: copy.move, exact: true }).click();
			await expect(page).toHaveURL(/\/assets\/item$/);
			await page.goto(collectionHref);
			await expect(page.locator(".collections-member-card")).toHaveCount(4);
			await expect(page.locator(".collections-member-card").filter({ hasText: names.item })).toHaveCount(0);
			await page.goto("/trash");
			await page.getByRole("button", { name: copy.restore, exact: true }).click();
			await expect(page.locator(".list-row").filter({ hasText: names.item })).toHaveCount(0);
			await page.goto(collectionHref);
			await assertCards(page, "Travel cabinet", 5, copy, variant.width);
			await page.getByRole("button", { name: copy.edit, exact: true }).click();
			const edit = page.getByRole("region", { name: copy.edit, exact: true });
			await edit.getByLabel(copy.collectionName, { exact: true }).fill("Travel cabinet v2");
			await edit.getByRole("checkbox", { name: names.vault, exact: true }).uncheck();
			await edit.getByRole("button", { name: copy.collectionSave, exact: true }).click();
			await expect(page).toHaveURL(new RegExp(`${collectionHref}$`));
			await expect(page.getByRole("heading", { name: "Travel cabinet v2", exact: true })).toBeVisible();
			await page.reload();
			await assertCards(page, "Travel cabinet v2", 4, copy, variant.width);
			await page.getByRole("button", { name: copy.edit, exact: true }).click();
			await edit.getByRole("button", { name: copy.another, exact: true }).click();
			await expect(page).toHaveURL(/\/collections$/);
			await editor.getByLabel(copy.collectionName, { exact: true }).fill("travel cabinet v2");
			await editor.getByRole("button", { name: copy.collectionSave, exact: true }).click();
			await expect(editor.getByRole("alert")).toContainText(copy.duplicate);
			await editor.getByRole("button", { name: copy.cancel, exact: true }).click();
			const before = await download(page, copy);
			expect(before.assets).toHaveLength(5);
			expect(before.assets.find((asset) => asset.kind === "item")).toMatchObject({ deleted: false, itemLifecycleStatus: "idle" });
			expect(before.collections).toHaveLength(1);
			expect(before.collections[0]).toMatchObject({ id: collectionHref.split("/").at(-1), name: "Travel cabinet v2" });
			expect(before.collections[0].assetIds.slice().sort()).toEqual(before.assets.filter((asset) => asset.kind !== "vault").map((asset) => asset.id).slice().sort());
			const destination = await browser.newContext({ locale: variant.locale, viewport: { width: variant.width, height: 844 }, acceptDownloads: true });
			try {
				const restored = await destination.newPage();
				restored.on("pageerror", (error) => errors.push(error.message));
				await restored.goto("/collections");
				await expect(restored.locator(".collections-member-card")).toHaveCount(0);
				await restored.goto("/intake");
				await restored.locator("#backup-password").fill(password);
				await restored.locator("#restore-file").setInputFiles(before.path);
				await restored.getByRole("button", { name: copy.preview, exact: true }).first().click();
				await restored.getByRole("button", { name: copy.confirm }).click();
				await expect(restored.getByText(copy.restored)).toBeVisible();
				await restored.goto(collectionHref);
				await assertSidebarCategory(restored, variant.width);
				await assertCards(restored, "Travel cabinet v2", 4, copy, variant.width);
				await restored.screenshot({ path: test.info().outputPath(`collection-five-types-${variant.locale}-${variant.width}.png`), fullPage: true });
				await restored.goto("/collections");
				await assertSidebarCategory(restored, variant.width);
				const restoredSections = restored.getByRole("region", { name: copy.sidebar, exact: true });
				await expect(restoredSections.getByRole("checkbox", { name: copy.hideAccounts, exact: true })).not.toBeChecked();
				const sectionOrder = await restoredSections.locator(".sortable-nav-link").allTextContents();
				// Read the saved preferences too, without relying on fixture writes or app internals.
				const after = await download(restored, copy);
				expect(after.collections).toEqual(before.collections);
				expect(after.assets.map((asset) => asset.id).slice().sort()).toEqual(before.assets.map((asset) => asset.id).slice().sort());
				for (const id of ["sidebarOrder", "sidebarHidden"]) {
					expect(before.preferences.find((row) => row.id === id)).toBeDefined();
					expect(after.preferences.find((row) => row.id === id)).toEqual(before.preferences.find((row) => row.id === id));
				}
				expect(sectionOrder.indexOf(copy.assets)).toBeLessThan(sectionOrder.indexOf(copy.tasks));
				expect(errors).toEqual([]);
			} finally { await destination.close(); }
		} finally { await source.close(); }
	});
}
