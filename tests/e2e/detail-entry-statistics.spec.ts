import { openBackupPage } from "./helpers/backup-restore";
// 2026-10-29: user removed B1 backlinks and B2 promotional fields/materials.
// Prior expectations/evidence remain in Git and the private pre-change snapshot; retained core checks are unchanged.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import type { Task } from "../../packages/domain/src";
import { selectChoice } from "./helpers/select-choice";

const password = "detail-entries-real-backup";
test.use({ actionTimeout: 15_000 });
const copy = (zh: boolean) => zh ? {
	add: "新增", name: "名称", save: "保存", url: "网址", addBacklink: "新增外链", verify: "核验",
	viewBills: "查看账单", maintenance: "打开维护计划", newPlan: "新建维护计划", planName: "计划名称",
	linkedAsset: "关联资产", due: "下次日期", createPlan: "创建计划", backup: "创建备份", download: "保存备份文件",
	preview: "预览", confirmRestore: /确认 ·/, restored: /已恢复 \d+ 条记录/,
	stats: (total: number, pending: number) => `外链 ${total} 条 · ${pending} 条待核验`,
} : {
	add: "Add", name: "Name", save: "Save", url: "URL", addBacklink: "Add backlink", verify: "Verify",
	viewBills: "View bills", maintenance: "Open maintenance plan", newPlan: "New maintenance plan", planName: "Plan name",
	linkedAsset: "Linked asset", due: "Next date", createPlan: "Create plan", backup: "Create backup", download: "Save backup file",
	preview: "Preview", confirmRestore: /Confirm ·/, restored: /Restored \d+ records/,
	stats: (total: number, pending: number) => `Backlinks: ${total} · ${pending} to verify`,
};
type Copy = ReturnType<typeof copy>;
type Row = { id: string; type: string; payload: string; updatedAt: number };

async function fits(page: Page) {
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function createAsset(page: Page, kind: "project" | "item", name: string, text: Copy) {
	await page.goto(`/assets/${kind}`);
	await page.getByRole("button", { name: text.add, exact: true }).click();
	const editor = page.getByRole("dialog");
	await editor.getByLabel(text.name, { exact: true }).fill(name);
	await editor.getByRole("button", { name: text.save, exact: true }).click();
	await expect(editor).toBeHidden();
	const card = page.locator("main .list-row").filter({ hasText: name });
	const href = await card.getAttribute("href");
	if (!href) throw Error("created-asset-link-missing");
	await card.click();
	await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
	return { id: href.split("/").at(-1) as string, href };
}

async function downloadArchive(page: Page, text: Copy) {
	await page.goto("/intake");
	await openBackupPage(page); await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: text.backup, exact: true }).click();
	const link = page.getByRole("link", { name: text.download, exact: true });
	await expect(link).toBeVisible();
	const downloading = page.waitForEvent("download");
	await link.click();
	const path = await (await downloading).path();
	if (!path) throw Error("detail-backup-download-missing");
	const bytes = readFileSync(path);
	expect(bytes.subarray(0, 8).toString()).toBe("KEEPANY1");
	const entries = unzipSync(await decryptBackup(new Uint8Array(bytes), password));
	return { entries, rows: JSON.parse(strFromU8(entries["records.json"])) as Row[] };
}

async function createPlan(page: Page, assetId: string, name: string, date: string, text: Copy) {
	await page.getByRole("button", { name: text.newPlan, exact: true }).click();
	const editor = page.getByRole("dialog");
	await editor.getByLabel(text.planName).fill(name);
	await selectChoice(editor.getByLabel(text.linkedAsset), assetId);
	await editor.getByLabel(text.due).fill(date);
	await fits(page);
	await editor.getByRole("button", { name: text.createPlan, exact: true }).click();
	await expect(editor).toBeHidden();
	const row = page.locator(".maintenance-task-row").filter({ hasText: name });
	await expect(row).toBeVisible();
	const id = await row.getAttribute("id");
	if (!id) throw Error("maintenance-row-id-missing");
	return id;
}

for (const locale of ["zh-CN", "en-US"]) {
	for (const width of [390, 1280]) {
		test(`${locale} retained bill and maintenance entries at ${width}px`, async ({ browser }) => {
			test.setTimeout(150_000);
			const text = copy(locale === "zh-CN");
			const context = await browser.newContext({ locale, viewport: { width, height: 844 }, acceptDownloads: true });
			const contexts = [context];
			let page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			try {
				const project = await createAsset(page, "project", "Entry project", text);
				const bills = page.locator(".asset-project-related").getByRole("link", { name: text.viewBills });
				await expect(bills).toHaveAttribute("href", "/finance");
				await bills.scrollIntoViewIfNeeded();
				await expect(bills).toBeInViewport({ ratio: 1 });
				await fits(page);
				await page.screenshot({ path: test.info().outputPath(`project-bills-entry-${locale}-${width}.png`) });
				await bills.click();
				await expect(page).toHaveURL(/\/finance$/);
				await expect(page.locator("main.finance-page")).toBeVisible();
				await page.goto(project.href);
				await expect(page.locator(".asset-backlinks-card, .asset-project-stats")).toHaveCount(0);

				const firstItem = await createAsset(page, "item", "Earlier maintenance item", text);
				await page.locator(".asset-tasks-card").getByRole("link", { name: text.maintenance, exact: true }).click();
				await expect(page).toHaveURL(/\/tasks$/);
				await createPlan(page, firstItem.id, "Earlier plan", "2026-10-02", text);
				const item = await createAsset(page, "item", "Target maintenance item", text);
				const maintenance = page.locator(".asset-tasks-card").getByRole("link", { name: text.maintenance, exact: true });
				await expect(maintenance).toHaveAttribute("href", "/tasks");
				await maintenance.click();
				const taskRowId = await createPlan(page, item.id, "Target maintenance plan", "2026-11-02", text);
				await page.goto(item.href);
				await expect(maintenance).toHaveAttribute("href", `/tasks#${taskRowId}`);
				await maintenance.scrollIntoViewIfNeeded();
				await expect(maintenance).toBeInViewport({ ratio: 1 });
				await fits(page);
				await page.waitForTimeout(350);
				await page.screenshot({ path: test.info().outputPath(`item-maintenance-entry-${locale}-${width}.png`) });
				await maintenance.click();
				await expect(page).toHaveURL(new RegExp(`/tasks#${taskRowId}$`));
				await expect(page.locator(".tasks-plan-name")).toHaveText("Target maintenance plan");
				await expect(page.locator(".tasks-plan-select").getByRole("combobox")).toHaveAttribute("data-value", taskRowId.slice(5));
				await expect(page.locator(".tasks-plan-facts")).toContainText("Target maintenance item");
				await expect(page.locator(`[id="${taskRowId}"]`)).toBeInViewport();
				await fits(page);
				await page.reload();
				await expect(page.locator(".tasks-plan-name")).toHaveText("Target maintenance plan");
				await page.locator(".tasks-plan-card").scrollIntoViewIfNeeded();
				await expect(page.locator(".tasks-plan-name")).toBeInViewport({ ratio: 1 });
				await fits(page);
				await page.waitForTimeout(350);
				await page.screenshot({ path: test.info().outputPath(`maintenance-plan-location-${locale}-${width}.png`) });
				const final = await downloadArchive(page, text);
				const tasks = final.rows.filter((value) => value.type === "task").map((value) => JSON.parse(value.payload) as Task);
				expect(tasks.find((task) => `task-${task.id}` === taskRowId)).toMatchObject({ assetId: item.id, name: "Target maintenance plan", deleted: false });
				expect(errors).toEqual([]);
			} finally {
				for (const opened of contexts) await opened.close();
			}
		});
	}
}
