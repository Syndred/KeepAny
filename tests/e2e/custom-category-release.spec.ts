import { openBackupPage } from "./helpers/backup-restore";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import type { Asset, Category } from "../../packages/domain/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";

const password = "category-fixed-package-backup-2026";
test.use({ actionTimeout: 15_000 });
type Kind = "project" | "account";
const renamedCategory = (kind: Kind) => `Renamed ${kind} ${"L".repeat(44)}`;
const copy = (zh: boolean) => zh ? {
	add: "新增", name: "名称", save: "保存", newCategory: "新增分类", category: "分类", categoryName: "分类名称", categorySave: "保存分类", manage: "管理", backup: "创建备份", download: "保存备份文件", preview: "预览", confirm: /确认 ·/, restored: /已恢复 \d+ 条记录/,
} : {
	add: "Add", name: "Name", save: "Save", newCategory: "New category", category: "Category", categoryName: "Category name", categorySave: "Save collection", manage: "Manage", backup: "Create backup", download: "Save backup file", preview: "Preview", confirm: /Confirm ·/, restored: /Restored \d+ records/,
};
async function addAsset(page: Page, kind: Kind, name: string, zh: boolean) {
	const text = copy(zh);
	await page.goto(`/assets/${kind}`);
	await page.getByRole("button", { name: text.add, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(text.name, { exact: true }).fill(name);
	await dialog.getByRole("button", { name: text.save, exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator("main .asset-list-content a").filter({ hasText: name })).toHaveCount(1);
}
async function download(page: Page, zh: boolean) {
	const text = copy(zh);
	await page.goto("/intake");
	await openBackupPage(page); await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: text.backup, exact: true }).click();
	const link = page.getByRole("link", { name: text.download, exact: true });
	await expect(link).toBeVisible();
	const downloaded = page.waitForEvent("download");
	await link.click();
	const result = await downloaded;
	const path = await result.path();
	if (!path) throw Error("backup-download-missing");
	expect(result.suggestedFilename()).toMatch(/\.ka1$/);
	const bytes = readFileSync(path);
	expect(bytes.subarray(0, 8).toString()).toBe("KEEPANY1");
	const entries = unzipSync(await decryptBackup(new Uint8Array(bytes), password));
	const rows = JSON.parse(strFromU8(entries["records.json"])) as Array<{ type: string; payload: string }>;
	return {
		path,
		categories: rows.filter((row) => row.type === "category").map((row) => JSON.parse(row.payload) as Category),
		assets: rows.filter((row) => row.type === "asset").map((row) => JSON.parse(row.payload) as Asset),
	};
}
async function sidebarCategory(page: Page, name: string) {
	// Every case uses 390px. Wait for hydration instead of treating an absent menu as desktop.
	await page.locator(".mobile-menu").click();
	await expect(page.locator(".sidebar")).toHaveClass(/\bopen\b/);
	const category = page.locator(".sidebar-custom").getByRole("button", { name, exact: true });
	await expect(category).toBeInViewport({ ratio: 1 });
	await category.click();
}
async function rename(page: Page, zh: boolean, name: string, add: string, remove: string) {
	const text = copy(zh);
	await page.getByRole("button", { name: text.manage, exact: true }).click();
	const editor = page.getByRole("region", { name: text.category, exact: true });
	await editor.getByLabel(text.categoryName).fill(name);
	await editor.getByRole("checkbox", { name: remove }).uncheck();
	await editor.getByRole("checkbox", { name: add }).check();
	await editor.getByRole("button", { name: text.categorySave, exact: true }).click();
	await expect(editor).toBeHidden();
	await page.reload();
	await expect(page.locator(".asset-category-scroll").getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator("main .asset-list-content a")).toHaveCount(1);
	await expect(page.locator("main .asset-list-content a")).toContainText(add);
}

for (const locale of ["en-US", "zh-CN"]) {
	test(`${locale} fixed package category identity survives UI rename and encrypted clean restore`, async ({ browser }) => {
		// Multiple encrypted downloads and a second browser context need a separate CI budget.
		test.setTimeout(150_000);
		const zh = locale === "zh-CN";
		const text = copy(zh);
		const source = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, acceptDownloads: true });
		const page = await source.newPage();
		const errors: string[] = [];
		let sourceFailure: unknown;
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			for (const kind of ["project", "account"] as const) {
				await addAsset(page, kind, `${kind} First`, zh);
				await addAsset(page, kind, `${kind} Second`, zh);
				await page.getByRole("button", { name: text.newCategory, exact: true }).click();
				const editor = page.getByRole("region", { name: text.category, exact: true });
				await editor.getByLabel(text.categoryName).fill(`Original ${kind}`);
				await editor.getByRole("checkbox", { name: `${kind} First` }).check();
				await editor.getByRole("button", { name: text.categorySave, exact: true }).click();
				await expect(editor).toBeHidden();
				await expect(page.locator("main .asset-list-content a")).toHaveCount(1);
			}
			const before = await download(page, zh);
			expect(before.categories).toHaveLength(2);
			for (const kind of ["project", "account"] as const) {
				await page.goto(`/assets/${kind}`);
				await rename(page, zh, renamedCategory(kind), `${kind} Second`, `${kind} First`);
				await page.locator("main .asset-list-content a").click();
				const category = page.locator(".asset-detail .eyebrow");
				await expect(category).toBeVisible();
				await expect(category).toContainText(renamedCategory(kind));
				expect(await category.evaluate(element => {
					const rect = element.getBoundingClientRect();
					const header = element.closest(".page-header")!.getBoundingClientRect();
					return rect.right <= header.right + 1 && element.scrollWidth <= element.clientWidth + 1;
				}), "Long custom categories wrap inside the detail header").toBe(true);
				await sidebarCategory(page, renamedCategory(kind));
				await expect(page.locator("main .asset-list-content a")).toHaveCount(1);
			}
			const after = await download(page, zh);
			expect(after.categories).toHaveLength(2);
			for (const kind of ["project", "account"] as const) {
				expect(after.categories.find((category) => category.kind === kind)).toMatchObject({ id: before.categories.find((category) => category.kind === kind)?.id, name: renamedCategory(kind), deleted: false });
				expect(after.assets.find((asset) => asset.name === `${kind} First`)?.category).toBe("");
				expect(after.assets.find((asset) => asset.name === `${kind} Second`)?.category).toBe(renamedCategory(kind));
			}
			const destination = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, acceptDownloads: true });
			let destinationFailure: unknown;
			try {
				const restored = await destination.newPage();
				restored.on("pageerror", (error) => errors.push(error.message));
				await restored.goto("/assets/project");
				await expect(restored.locator("main .asset-list-content a")).toHaveCount(0);
				await restored.goto("/intake");
				await openBackupPage(restored); await restored.locator("#backup-password").fill(password);
				await restored.locator("#restore-file").setInputFiles(after.path);
				await restored.getByRole("button", { name: text.preview, exact: true }).first().click();
				await restored.getByRole("button", { name: text.confirm }).click();
				await expect(restored.getByText(text.restored)).toBeVisible();
				for (const kind of ["project", "account"] as const) {
					await restored.goto(`/assets/${kind}`);
					await sidebarCategory(restored, renamedCategory(kind));
					await expect(restored.locator("main .asset-list-content a")).toHaveCount(1);
					await expect(restored.locator("main .asset-list-content a")).toContainText(`${kind} Second`);
					await rename(restored, zh, `Recovered ${kind}`, `${kind} First`, `${kind} Second`);
					await sidebarCategory(restored, `Recovered ${kind}`);
					await expect(restored.locator("main .asset-list-content a")).toContainText(`${kind} First`);
					expect(await restored.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
				}
				await restored.screenshot({ path: test.info().outputPath(`category-fixed-restored-${locale}-390.png`), fullPage: true });
				const final = await download(restored, zh);
				for (const kind of ["project", "account"] as const) {
					expect(final.categories.find((category) => category.kind === kind)).toMatchObject({ id: before.categories.find((category) => category.kind === kind)?.id, name: `Recovered ${kind}` });
					expect(final.assets.find((asset) => asset.name === `${kind} First`)?.category).toBe(`Recovered ${kind}`);
					expect(final.assets.find((asset) => asset.name === `${kind} Second`)?.category).toBe("");
				}
			} catch (error) {
				destinationFailure = error;
				throw error;
			} finally {
				if (destinationFailure) await destination.close().catch(() => undefined);
				else await destination.close();
			}
			expect(errors).toEqual([]);
		} catch (error) {
			sourceFailure = error;
			throw error;
		} finally {
			if (sourceFailure) await source.close().catch(() => undefined);
			else await source.close();
		}
	});
}
