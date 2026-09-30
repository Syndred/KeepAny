import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { pdf } from "./fixtures/pdf";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "docs/evidence/2026-09-30";
mkdirSync(evidence, { recursive: true });


for (const locale of ["zh-CN", "en-US"]) for (const width of [390, 1280]) test(`${locale} ${width} PDF text requires explicit type and confirmation, retains decisions`, async ({ browser }) => {
	const context = await browser.newContext({ locale, viewport: { width, height: 844 } });
	const page = await context.newPage();
	const zh = locale === "zh-CN";
	try {
		await page.goto('/intake');
		await page.getByRole('button', { name: zh ? 'PDF 文档' : 'PDF document', exact: true }).click();
		const buffer = pdf(['Invoice reference 123', 'Service total USD 12.00']);
		await page.locator('#csv-file').setInputFiles({ name: 'invoice.pdf', mimeType: 'application/pdf', buffer });
		const row = page.locator('.intake-review-row');
		await expect(row).toHaveCount(1);
		await row.getByText(zh ? '查看提取原文' : 'View extracted text', { exact: true }).click();
		await expect(row.locator('pre')).toContainText('Service total USD 12.00');
		const confirm = row.getByRole('button', { name: zh ? '确认入库' : 'Confirm and save' });
		await expect(confirm).toBeDisabled();
		await page.screenshot({ path: `${evidence}/keepany-pdf-review-${process.env.KEEPANY_PDF_RELEASE === "1" ? "release-" : ""}${locale}-${width}.png`, fullPage: true });
		await row.getByLabel(zh ? '资料类型' : 'Record type').selectOption('subscription');
		await row.getByLabel(zh ? '名称' : 'Name', { exact: true }).fill('Reviewed invoice');
		await row.getByLabel(zh ? "简短描述" : "Short description").fill("Manually reviewed USD 12.00");
		await confirm.click();
		await expect(row).toContainText(zh ? '已确认' : 'Confirmed');
		await page.reload();
		await page.getByRole('button', { name: zh ? 'PDF 文档' : 'PDF document', exact: true }).click();
		await page.locator('#csv-file').setInputFiles({ name: 'renamed.pdf', mimeType: 'application/pdf', buffer });
		await expect(row).toHaveCount(1);
		await expect(row).toContainText(zh ? '已确认' : 'Confirmed');
		if (process.env.KEEPANY_PDF_RELEASE === "1") {
			await page.goto('/finance');
			await expect(page.locator('.finance-subscription')).toHaveCount(1);
			await expect(page.locator('.finance-entry')).toHaveCount(0);
			await expect(page.locator('.finance-linked-top > strong')).toContainText('0.00');
			await page.locator('.finance-subscription').filter({ hasText: 'Reviewed invoice' }).click();
			await expect(page.getByRole('heading', { name: 'Reviewed invoice', exact: true })).toBeVisible();
			await expect(page.getByText('Manually reviewed USD 12.00', { exact: true })).toBeVisible();
			await page.reload();
			await expect(page.getByRole('heading', { name: 'Reviewed invoice', exact: true })).toBeVisible();
			await expect(page.getByText('Manually reviewed USD 12.00', { exact: true })).toBeVisible();
			await page.goto('/intake');
			await page.getByRole('button', { name: zh ? 'PDF 文档' : 'PDF document', exact: true }).click();
			await expect(row).toHaveCount(1);
			await expect(row).toContainText(zh ? '已确认' : 'Confirmed');
		} else {
			const data = await page.evaluate(async (path) => {
				const { allRecords } = await import(path);
				return (await allRecords()).map((record: { type: string; payload: string }) => ({ type: record.type, value: JSON.parse(record.payload) }));
			}, `/@fs${process.cwd()}/packages/local-db/src/index.ts`);
			const assets = data.filter((record: {type: string}) => record.type === 'asset');
			expect(assets).toHaveLength(1);
			expect(assets[0].value).toMatchObject({ name: 'Reviewed invoice', kind: 'subscription', amount: 0, description: 'Manually reviewed USD 12.00' });
			expect(data.filter((record: {type: string}) => record.type === 'history')).toHaveLength(0);
		}
		await page.locator('#csv-file').setInputFiles({ name: 'blank.pdf', mimeType: 'application/pdf', buffer: pdf([]) });
		await expect(page.locator('.notice[role="status"]')).toContainText(zh ? '未读取到文字' : 'no readable text');
		await expect(row).toHaveCount(1);
		await page.locator('#csv-file').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n') });
		await expect(page.locator('.notice[role="status"]')).toContainText(zh ? '未生成候选' : 'No candidate');
		await expect(row).toHaveCount(1);
		await page.locator('#csv-file').setInputFiles({ name: 'oversize.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
		await expect(page.locator('.notice[role="status"]')).toContainText('10 MB');
		await expect(row).toHaveCount(1);
		const ignored = pdf(['中文账单服务费用'], true);
		await page.locator('#csv-file').setInputFiles({ name: 'ignore.pdf', mimeType: 'application/pdf', buffer: ignored });
		const ignoredRow = row.filter({ hasText: 'ignore.pdf' });
		await expect(ignoredRow.getByLabel(zh ? '简短描述' : 'Short description')).toHaveValue('中文账单服务费用');
		await ignoredRow.getByRole('button', { name: zh ? '忽略' : 'Ignore', exact: true }).click();
		await expect(ignoredRow).toContainText(zh ? '已忽略' : 'Ignored');
		await page.locator('#csv-file').setInputFiles({ name: 'ignore-again.pdf', mimeType: 'application/pdf', buffer: ignored });
		await expect(row).toHaveCount(2);
		await expect(ignoredRow).toContainText(zh ? '已忽略' : 'Ignored');
		expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
		await page.screenshot({ path: `${evidence}/keepany-pdf-${process.env.KEEPANY_PDF_RELEASE === "1" ? "release-" : ""}${locale}-${width}.png`, fullPage: true });
	} finally { await context.close(); }
});
