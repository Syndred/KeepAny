import { expect, test } from "@playwright/test";
import { pdf } from "./fixtures/pdf";

const repositoryUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

// These are explicit fault injections in disposable development contexts.
// They test the UI recovery choices, rather than claim disk-full or power-loss evidence.
for (const locale of ["en-US", "zh-CN"]) for (const committed of [false, true]) {
	test(`${locale} fault-injected PDF expense ${committed ? "finishes a written receipt" : "can cancel an unwritten intent"}`, async ({ browser }) => {
		const zh = locale === "zh-CN";
		const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await page.goto("/assets/account");
			await page.getByRole("button", { name: zh ? "新增" : "Add", exact: true }).click();
			const dialog = page.getByRole("dialog");
			await dialog.getByLabel(zh ? "名称" : "Name", { exact: true }).fill("Billing account");
			await dialog.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.goto("/intake");
			await page.getByRole("button", { name: zh ? "PDF 文档" : "PDF document", exact: true }).click();
			await page.locator("#csv-file").setInputFiles({ name: "recovery-invoice.pdf", mimeType: "application/pdf", buffer: pdf(["Paid USD 8.00"]) });
			const row = page.locator(".intake-review-row");
			await row.getByLabel(zh ? "资料类型" : "Record type").selectOption("expense");
			await row.getByLabel(zh ? "关联订阅或账号" : "Subscription or account").selectOption({ label: zh ? "Billing account · 账号" : "Billing account · Accounts" });
			await row.getByLabel(zh ? "金额" : "Amount", { exact: true }).fill("8.00");
			await row.getByLabel(zh ? "日期" : "Date", { exact: true }).fill("2026-09-30");
			await expect(row.getByRole("button", { name: zh ? "确认支出" : "Confirm expense", exact: true })).toBeEnabled();
			await page.evaluate(async ({ url, committed }) => {
				const { localRepository } = await import(url);
				const repository = await localRepository();
				if (committed) {
					const table = repository.fileStore.intakeReview;
					const original = table.put.bind(table);
					table.put = async (candidate: { status: string; reviewMode?: string }) => {
						if (candidate.status === "accepted" && candidate.reviewMode === "expense") {
							table.put = original;
							throw Error("test-receipt-write-fault");
						}
						return original(candidate);
					};
				} else {
					const original = repository.db.records.insert.bind(repository.db.records);
					repository.db.records.insert = async (record: { type: string }) => {
						if (record.type === "history") {
							repository.db.records.insert = original;
							throw Error("test-history-write-fault");
						}
						return original(record);
					};
				}
			}, { url: repositoryUrl, committed });
			await row.getByRole("button", { name: zh ? "确认支出" : "Confirm expense", exact: true }).click();
			await expect(row.getByRole("button", { name: zh ? "重试保存" : "Retry saving", exact: true })).toBeVisible();
			await expect(row.getByLabel(zh ? "金额" : "Amount", { exact: true })).toBeDisabled();
			const cancel = row.getByRole("button", { name: zh ? "取消本次保存" : "Cancel this save", exact: true });
			if (committed) {
				await expect(cancel).toHaveCount(0);
				await row.getByRole("button", { name: zh ? "重试保存" : "Retry saving", exact: true }).click();
			} else {
				await cancel.click();
				await expect(row.getByLabel(zh ? "金额" : "Amount", { exact: true })).toBeEnabled();
				await expect(row.getByLabel(zh ? "金额" : "Amount", { exact: true })).toHaveValue("8.00");
				await row.getByRole("button", { name: zh ? "确认支出" : "Confirm expense", exact: true }).click();
			}
			await expect(row).toContainText(zh ? "已确认" : "Confirmed");
			const stored = await page.evaluate(async (url) => {
				const { localRepository } = await import(url);
				const repository = await localRepository();
				return { history: await repository.list("history"), journal: await repository.fileStore.importJournal.count() };
			}, repositoryUrl);
			expect(stored.history).toHaveLength(1);
			expect(stored.history[0]).toMatchObject({ action: "expense", amount: 800, source: "recovery-invoice.pdf" });
			expect(stored.journal).toBe(0);
			await page.goto("/finance");
			await expect(page.locator(".finance-entry")).toHaveCount(1);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
