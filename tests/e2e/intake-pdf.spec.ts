import { expect, test } from "@playwright/test";

function pdf(lines: string[], chinese = false) {
	const stream = `BT /F1 12 Tf 50 750 Td ${lines.map((line, i) => `${i ? '0 -20 Td ' : ''}${chinese ? `<${Array.from(line).map(char => char.charCodeAt(0).toString(16).padStart(4, "0")).join("")}>` : `(${line})`} Tj`).join('\n')} ET`;
	const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
	if (chinese) {
		objects[3] = "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /Identity-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>] /ToUnicode 6 0 R >>";
		const cmap = "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0000> <FFFF> <0000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end";
		objects.push(`<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}\nendstream`);
	}
	let body = "%PDF-1.4\n";
	const offsets = [0];
	objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
	const xref = Buffer.byteLength(body);
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF`;
	return Buffer.from(body);
}

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
		await page.screenshot({ path: `docs/evidence/2026-09-30/keepany-pdf-review-${locale}-${width}.png`, fullPage: true });
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
		const data = await page.evaluate(async (path) => {
			const { allRecords } = await import(path);
			return (await allRecords()).map((record: { type: string; payload: string }) => ({ type: record.type, value: JSON.parse(record.payload) }));
		}, `/@fs${process.cwd()}/packages/local-db/src/index.ts`);
		const assets = data.filter((record: {type: string}) => record.type === 'asset');
		expect(assets).toHaveLength(1);
		expect(assets[0].value).toMatchObject({ name: 'Reviewed invoice', kind: 'subscription', amount: 0, description: 'Manually reviewed USD 12.00' });
		expect(data.filter((record: {type: string}) => record.type === 'history')).toHaveLength(0);
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
		await page.screenshot({ path: `docs/evidence/2026-09-30/keepany-pdf-${locale}-${width}.png`, fullPage: true });
	} finally { await context.close(); }
});
