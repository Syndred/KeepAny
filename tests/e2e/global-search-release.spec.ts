import { openBackupPage } from "./helpers/backup-restore";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import type { Asset, History, Task } from "../../packages/domain/src";
import type { ReviewedCandidate } from "../../packages/local-db/src/intake-review";
import { selectChoice } from "./helpers/select-choice";

const password = "global-search-fixed-package-backup";
const text = (zh: boolean) => zh ? {
	add: "新增", name: "名称", date: "日期", save: "保存", record: "记一笔", saveRecord: "保存记录",
	spreadsheet: "表格", confirmCandidate: "确认入库", confirmed: "已确认", pending: /^未完成/, intake: "收录",
	backup: "创建备份", download: "保存备份文件", preview: "预览", confirmRestore: /确认 ·/, restored: /已恢复 \d+ 条记录/,
} : {
	add: "Add", name: "Name", date: "Date", save: "Save", record: "Record transaction", saveRecord: "Save record",
	spreadsheet: "Spreadsheet", confirmCandidate: "Confirm and save", confirmed: "Confirmed", pending: /^Pending/, intake: "Intake",
	backup: "Create backup", download: "Save backup file", preview: "Preview", confirmRestore: /Confirm ·/, restored: /Restored \d+ records/,
};

async function query(page: Page, value: string) {
	if (!await page.locator("#top-search-query").isVisible()) await page.locator(".top-search-trigger").click();
	await page.locator("#top-search-query").fill(value);
}
async function locate(page: Page, value: string, id: string) {
	await query(page, value);
	const result = page.locator(".top-search-panel .search-results a");
	await expect(result).toHaveCount(1);
	await result.click();
	const row = page.locator(`[id="${id}"]`);
	await expect(row).toBeVisible();
	await expect(row).toBeFocused();
	await expect(page.locator(".top-search-panel")).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => sessionStorage.getItem("keepany-search"))).toBe("");
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function archive(page: Page, zh: boolean) {
	const copy = text(zh);
	await page.goto("/intake");
	await openBackupPage(page); await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: copy.backup, exact: true }).click();
	const link = page.getByRole("link", { name: copy.download, exact: true });
	await expect(link).toBeVisible();
	const downloading = page.waitForEvent("download");
	await link.click();
	const path = await (await downloading).path();
	if (!path) throw Error("search-backup-missing");
	const bytes = readFileSync(path);
	expect(bytes.subarray(0, 8).toString()).toBe("KEEPANY1");
	const entries = unzipSync(await decryptBackup(new Uint8Array(bytes), password));
	const rows = JSON.parse(strFromU8(entries["records.json"])) as Array<{ type: string; payload: string }>;
	return {
		path,
		assets: rows.filter((row) => row.type === "asset").map((row) => JSON.parse(row.payload) as Asset),
		history: rows.filter((row) => row.type === "history").map((row) => JSON.parse(row.payload) as History),
		tasks: rows.filter((row) => row.type === "task").map((row) => JSON.parse(row.payload) as Task),
		candidates: JSON.parse(strFromU8(entries["intake-review.json"])) as ReviewedCandidate[],
	};
}

for (const locale of ["en-US", "zh-CN"]) {
	test(`${locale} fixed package global search navigates UI records and encrypted clean restore`, async ({ browser }) => {
		const zh = locale === "zh-CN", copy = text(zh);
		const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, acceptDownloads: true });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await page.goto("/assets/account");
			await page.getByRole("button", { name: copy.add, exact: true }).click();
			let dialog = page.getByRole("dialog");
			await dialog.getByLabel(copy.name, { exact: true }).fill("Global wallet");
			await dialog.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(dialog).toBeHidden();
			const accountLink = page.locator("main .asset-account-card").filter({ hasText: "Global wallet" });
			const href = await accountLink.getAttribute("href");
			if (!href) throw Error("created-account-link-missing");
			const accountId = href.split("/").at(-1);
			if (!accountId) throw Error("created-account-id-missing");
			await accountLink.click();
			await page.locator(".asset-tasks-card").getByRole("button", { name: copy.add, exact: true }).click();
			dialog = page.getByRole("dialog");
			await dialog.getByLabel(copy.name, { exact: true }).fill("Global review payments");
			await dialog.getByLabel(copy.date, { exact: true }).fill("2026-11-01");
			await dialog.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.goto("/finance");
			await page.getByRole("button", { name: copy.record, exact: true }).click();
			dialog = page.getByRole("dialog");
			await selectChoice(dialog.locator("#finance-asset"), accountId);
			await dialog.locator("#finance-title").fill("Global dinner bill");
			await dialog.locator("#finance-amount").fill("12.34");
			await selectChoice(dialog.locator("#finance-currency"), "USD");
			await dialog.locator("#finance-date").fill("2026-10-01");
			await dialog.locator("#finance-source").fill("Global card statement");
			await dialog.locator("#finance-note").fill("private-fixed-history-note");
			await dialog.getByRole("button", { name: copy.saveRecord, exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.goto("/intake");
			await page.getByRole("button", { name: copy.spreadsheet, exact: true }).click();
			await page.locator("#csv-file").setInputFiles({ name: "global-confirmed.csv", mimeType: "text/csv", buffer: Buffer.from("name,kind,url\nGlobal CSV project,project,https://global.example.test/project") });
			const candidate = page.locator(".intake-review-row");
			await expect(candidate).toHaveCount(1);
			await candidate.getByRole("button", { name: copy.confirmCandidate, exact: true }).click();
			await expect(candidate).toContainText(copy.confirmed);
			// Accepted Dexie metadata must update this mounted topbar without a reload.
			await query(page, "global-confirmed.csv");
			await expect(page.locator(".top-search-panel .search-results a")).toHaveCount(1);
			await expect(page.locator(".global-search-result-source")).toHaveText(copy.intake);
			await page.locator(".top-search-panel .search-results a").click();
			await expect(candidate).toBeFocused();
			const saved = await archive(page, zh);
			const wallet = saved.assets.find((asset) => asset.name === "Global wallet");
			const history = saved.history.find((entry) => entry.title === "Global dinner bill");
			const task = saved.tasks.find((entry) => entry.name === "Global review payments");
			const receipt = saved.candidates.find((entry) => entry.fileName === "global-confirmed.csv");
			if (!wallet || !history || !task || !receipt) throw Error("search-archive-record-missing");
			expect(history).toMatchObject({ assetId: wallet.id, amount: 1234, currency: "USD" });
			expect(receipt.status).toBe("accepted");
			await locate(page, "dinner bill", `finance-entry-${history.id}`);
			await selectChoice(page.locator(".finance-filters").getByRole("combobox").first(), "refund");
			await expect(page.locator(".finance-entry")).toHaveCount(0);
			await locate(page, "dinner bill", `finance-entry-${history.id}`);
			await locate(page, "review payments", `task-${task.id}`);
			await locate(page, "global-confirmed.csv", `intake-review-${receipt.id}`);
			await query(page, "Global wallet");
			await page.locator(".top-search-panel .search-results a").filter({ has: page.locator(".global-search-result-source", { hasText: zh ? "资产" : "Asset" }) }).click();
			await expect(page).toHaveURL(new RegExp(`/assets/account/${wallet.id}$`));
			await query(page, "private-fixed-history-note");
			await expect(page.locator(".top-search-panel .search-results a")).toHaveCount(0);
			const destination = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, acceptDownloads: true });
			try {
				const restored = await destination.newPage();
				restored.on("pageerror", (error) => errors.push(error.message));
				await restored.goto("/assets/account");
				await expect(restored.locator("main .asset-account-card")).toHaveCount(0);
				await restored.goto("/intake");
				await openBackupPage(restored); await restored.locator("#backup-password").fill(password);
				await restored.locator("#restore-file").setInputFiles(saved.path);
				await restored.getByRole("button", { name: copy.preview, exact: true }).first().click();
				await restored.getByRole("button", { name: copy.confirmRestore }).click();
				await expect(restored.getByText(copy.restored)).toBeVisible();
				await locate(restored, "global-confirmed.csv", `intake-review-${receipt.id}`);
				await locate(restored, "dinner bill", `finance-entry-${history.id}`);
				await locate(restored, "review payments", `task-${task.id}`);
				await restored.reload();
				await expect(restored.locator(`[id="task-${task.id}"]`)).toBeFocused();
				await query(restored, "");
				await expect(restored.locator(".top-search-panel .search-results a")).toHaveCount(5);
				await restored.screenshot({ path: test.info().outputPath(`global-search-fixed-restored-${locale}-390.png`) });
				const readback = await archive(restored, zh);
				expect(readback.assets.map((asset) => asset.id).sort()).toEqual(saved.assets.map((asset) => asset.id).sort());
				expect(readback.history[0].id).toBe(history.id);
				expect(readback.tasks[0].id).toBe(task.id);
				expect(readback.candidates[0].id).toBe(receipt.id);
			} finally { await destination.close(); }
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
