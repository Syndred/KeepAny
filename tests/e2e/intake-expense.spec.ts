import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import type { Asset, History } from "../../packages/domain/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import type { ReviewedCandidate } from "../../packages/local-db/src/intake-review";
import { pdf } from "./fixtures/pdf";
import { selectChoice } from "./helpers/select-choice";

test.use({ timezoneId: "Asia/Shanghai" });

const password = "reviewed-expense-test-only-password";

async function backup(page: Page, zh: boolean) {
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: zh ? "创建备份" : "Create backup", exact: true }).click();
	const link = page.getByRole("link", { name: zh ? "保存备份文件" : "Save backup file" });
	await expect(link).toBeVisible();
	const downloaded = page.waitForEvent("download");
	await link.click();
	const path = await (await downloaded).path();
	if (!path) throw Error("download-missing");
	const entries = unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)), password));
	const records = JSON.parse(strFromU8(entries["records.json"])) as Array<{ type: string; payload: string }>;
	return {
		path,
		assets: records.filter((row) => row.type === "asset").map((row) => JSON.parse(row.payload) as Asset),
		history: records.filter((row) => row.type === "history").map((row) => JSON.parse(row.payload) as History),
		reviews: JSON.parse(strFromU8(entries["intake-review.json"])) as ReviewedCandidate[],
	};
}

async function restore(page: Page, path: string, zh: boolean) {
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.locator("#restore-file").setInputFiles(path);
	await page.getByRole("button", { name: zh ? "预览" : "Preview", exact: true }).first().click();
	await page.getByRole("button", { name: /^(确认|Confirm) ·/ }).click();
	await expect(page.getByText(/(已恢复|Restored) \d+/)).toBeVisible();
}

for (const locale of ["zh-CN", "en-US"]) for (const width of [390, 1280]) {
	test(`${locale} ${width} PDF expense retains a draft, confirms once, and restores its receipt`, async ({ browser }) => {
		const zh = locale === "zh-CN";
		const contexts: BrowserContext[] = [];
		const errors: string[] = [];
		const open = async () => {
			const context = await browser.newContext({ locale, viewport: { width, height: 844 }, acceptDownloads: true });
			contexts.push(context);
			const page = await context.newPage();
			await page.clock.setFixedTime(new Date("2026-09-30T04:00:00Z"));
			page.on("pageerror", (error) => errors.push(error.message));
			return page;
		};
		try {
			const source = await open();
			await source.goto("/assets/subscription");
			await source.getByRole("button", { name: zh ? "新增" : "Add", exact: true }).click();
			const editor = source.getByRole("dialog");
			await editor.getByLabel(zh ? "名称" : "Name", { exact: true }).fill("Cloud service");
			await editor.locator("#amount").fill("12.50");
			await editor.locator("#dueDate").fill("2026-10-31");
			await editor.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
			await expect(editor).toBeHidden();
			await source.goto("/intake");
			await source.getByRole("button", { name: zh ? "PDF 文档" : "PDF document", exact: true }).click();
			const buffer = pdf(["Cloud service invoice", "Paid USD 98.00 on 2026-09-30"]);
			await source.locator("#csv-file").setInputFiles({ name: "cloud-invoice.pdf", mimeType: "application/pdf", buffer });
			const row = source.locator(".intake-review-row");
			await selectChoice(row.getByLabel(zh ? "资料类型" : "Record type"), "expense");
			await row.getByRole("button", { name: zh ? "确认支出" : "Confirm expense", exact: true }).click();
			await expect(row.getByRole("alert")).toContainText(zh ? "金额" : "amount");
			await selectChoice(row.getByLabel(zh ? "关联资产" : "Related asset"), { label: zh ? "Cloud service · 订阅" : "Cloud service · Subscriptions" });
			await row.getByLabel(zh ? "名称" : "Title", { exact: true }).fill("September cloud invoice");
			await row.getByLabel(zh ? "金额" : "Amount", { exact: true }).fill("98.xx");
			await selectChoice(row.getByLabel(zh ? "币种" : "Currency", { exact: true }), "USD");
			await row.getByLabel(zh ? "日期" : "Date", { exact: true }).fill("2026-09-30");
			await row.getByLabel(zh ? "备注" : "Note", { exact: true }).fill("Manually checked against the PDF");
			await expect(row.getByRole("button", { name: zh ? "确认支出" : "Confirm expense", exact: true })).toBeEnabled();
			// Verify the actual downloaded archive, including invalid editable text.
			const pending = await backup(source, zh);
			expect(pending.assets).toHaveLength(1);
			expect(pending.history).toHaveLength(0);
			expect(pending.reviews).toHaveLength(1);
			expect(pending.reviews[0]).toMatchObject({ status: "pending", reviewMode: "expense", expenseDraft: { amount: "98.xx", currency: "USD", eventDate: "2026-09-30" } });

			const reviewed = await open();
			await restore(reviewed, pending.path, zh);
			await reviewed.reload();
			const restoredRow = reviewed.locator(".intake-review-row");
			await expect(restoredRow.getByLabel(zh ? "金额" : "Amount", { exact: true })).toHaveValue("98.xx");
			const restoredBatch = reviewed.locator(".intake-review-batch").filter({ has: restoredRow });
			await restoredBatch.getByText(zh ? "查看提取原文" : "View extracted text", { exact: true }).click();
			await expect(restoredBatch.locator(".intake-review-original pre")).toContainText("Paid USD 98.00");
			await restoredRow.getByRole("button", { name: zh ? "确认支出" : "Confirm expense", exact: true }).click();
			await expect(restoredRow.getByRole("alert")).toContainText(zh ? "金额" : "amount");
			await restoredRow.getByLabel(zh ? "金额" : "Amount", { exact: true }).fill("98.00");
			expect(await reviewed.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
			await reviewed.screenshot({ path: test.info().outputPath(`pdf-expense-review-${locale}-${width}.png`), fullPage: true });
			await restoredRow.getByRole("button", { name: zh ? "确认支出" : "Confirm expense", exact: true }).click();
			await expect(restoredRow).toContainText(zh ? "已确认" : "Confirmed");
			await restoredRow.getByRole("link", { name: zh ? "查看财务流水" : "View transactions" }).click();
			await expect(reviewed.locator(".finance-entry")).toHaveCount(1);
			await expect(reviewed.locator(".finance-entry")).toContainText("September cloud invoice");
			await expect(reviewed.locator(".finance-entry")).toContainText("98.00");
			await expect(reviewed.locator(".finance-entry")).toContainText("cloud-invoice.pdf");
			await expect(reviewed.locator(".finance-linked-top > strong")).toContainText("12.50");
			await expect(reviewed.locator(".finance-summary .card").nth(1)).toContainText("98.00");
			await reviewed.screenshot({ path: test.info().outputPath(`pdf-expense-finance-${locale}-${width}.png`), fullPage: true });
			await reviewed.goto("/intake");
			await reviewed.getByRole("button", { name: zh ? "PDF 文档" : "PDF document", exact: true }).click();
			await reviewed.locator("#csv-file").setInputFiles({ name: "renamed-invoice.pdf", mimeType: "application/pdf", buffer });
			await expect(restoredRow).toHaveCount(1);
			await expect(restoredRow).toContainText(zh ? "已确认" : "Confirmed");
			const accepted = await backup(reviewed, zh);
			expect(accepted.assets).toEqual(pending.assets);
			expect(accepted.history).toHaveLength(1);
			expect(accepted.history[0]).toMatchObject({ action: "expense", assetId: pending.assets[0].id, title: "September cloud invoice", amount: 9800, currency: "USD", eventDate: "2026-09-30", source: "cloud-invoice.pdf" });
			expect(accepted.reviews[0]).toMatchObject({ status: "accepted", historyId: accepted.history[0].id });

			const final = await open();
			await restore(final, accepted.path, zh);
			await final.reload();
			await expect(final.locator(".intake-expense-receipt")).toContainText("98.00");
			await final.getByRole("button", { name: zh ? "PDF 文档" : "PDF document", exact: true }).click();
			await final.locator("#csv-file").setInputFiles({ name: "restored-renamed.pdf", mimeType: "application/pdf", buffer });
			await expect(final.locator(".intake-review-row")).toHaveCount(1);
			const readback = await backup(final, zh);
			expect(readback.history).toEqual(accepted.history);
			expect(readback.reviews).toEqual(accepted.reviews);
			await final.goto("/finance");
			await expect(final.locator(".finance-entry")).toHaveCount(1);
			expect(errors).toEqual([]);
		} finally { for (const context of contexts) await context.close(); }
	});
}
