import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import { pdf as makePdf } from "./fixtures/pdf";
import type { ReviewedCandidate } from '../../packages/local-db/src/intake-review';
import { selectChoice } from "./helpers/select-choice";
import { prepareLegacyPdfArchive, restoreCompletionArchive } from "./helpers/completion-archive";
import { openBackupRestorePanel } from "./helpers/backup-restore";

const password = 'intake-review-backup-test-password';
const csv = Buffer.from('name,kind\nPending CSV,project\nAccepted CSV,project\nIgnored CSV,item');


async function download(page: Page, zh: boolean) {
  await page.locator('#backup-password').fill(password);
  await page.getByRole('button', { name: zh ? '创建备份' : 'Create backup', exact: true }).click();
  const link = page.getByRole('link', { name: zh ? '保存备份文件' : 'Save backup file' });
  await expect(link).toBeVisible();
  const downloaded = page.waitForEvent('download'); await link.click();
  const result = await downloaded, path = await result.path();
  if (!path) throw Error('download-missing');
  expect(result.suggestedFilename()).toMatch(/\.ka1$/);
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).toString()).toBe('KEEPANY1');
  const entries = unzipSync(await decryptBackup(new Uint8Array(bytes), password));
  return { path, rows: JSON.parse(strFromU8(entries['records.json'])) as Array<{ id: string; payload: string }>,
    candidates: JSON.parse(strFromU8(entries['intake-review.json'])) as ReviewedCandidate[] };
}

for (const locale of ['zh-CN', 'en-US']) test(`${locale} downloaded encrypted backup restores CSV and legacy PDF drafts, receipts and stable IDs`, async ({ browser }) => {
  const zh = locale === 'zh-CN';
  const source = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
  const page = await source.newPage(); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const pendingPdf = makePdf(['Original PDF reference USD 12.00']), ignoredPdf = makePdf(['Ignored PDF reference USD 99.00']);
  const legacy = await prepareLegacyPdfArchive(test.info().outputPath('legacy-pdf-fixture'), password, [
    { fileName: 'invoice-pending.pdf', text: 'Original PDF reference USD 12.00' },
    { fileName: 'invoice-ignored.pdf', text: 'Ignored PDF reference USD 99.00' },
  ]);
  try {
    await page.goto('/intake');
    await page.locator('.intake-mode-tabs').getByRole('button', { name: zh ? '表格' : 'Spreadsheet', exact: true }).click();
    await page.locator('#csv-file').setInputFiles({ name: 'intake-backup.csv', mimeType: 'text/csv', buffer: csv });
    const rows = page.locator('.intake-review-row'); await expect(rows).toHaveCount(3);
    await rows.nth(0).getByLabel(zh ? '名称' : 'Name', { exact: true }).fill('Edited pending CSV');
    await rows.nth(0).getByLabel(zh ? '简短描述' : 'Short description').fill('CSV pending manual edit');
    await rows.nth(1).getByLabel(zh ? '名称' : 'Name', { exact: true }).fill('Edited accepted CSV');
    await rows.nth(1).getByRole('button', { name: zh ? '确认入库' : 'Confirm and save', exact: true }).click();
    await expect(rows.nth(1)).toContainText(zh ? '已确认' : 'Confirmed');
    await rows.nth(2).getByRole('button', { name: zh ? '忽略' : 'Ignore', exact: true }).click();
    await expect(rows.nth(2)).toContainText(zh ? '已忽略' : 'Ignored');
    // The English candidate name itself contains "Ignored"; wait for the actual decision chip.
    await expect(rows.nth(2).locator('.intake-review-source > .chip')).toHaveText(zh ? '已忽略' : 'Ignored');
    // Historical PDF rows are test preparation; only the candidate's visible KA1 restore consumes them.
    await restoreCompletionArchive(page, password, legacy.path);
    const pendingBatch = page.getByRole('region', { name: 'invoice-pending.pdf', exact: true });
    const pending = pendingBatch.locator('.intake-review-row');
    await expect(pending).toBeVisible();
    await selectChoice(pending.getByLabel(zh ? '资料类型' : 'Record type'), 'account');
    await pending.getByLabel(zh ? '名称' : 'Name', { exact: true }).fill('Edited pending PDF');
    await pending.getByLabel(zh ? '简短描述' : 'Short description').fill('PDF manual edit');
    await pendingBatch.getByText(zh ? '查看提取原文' : 'View extracted text', { exact: true }).click();
    await expect(pendingBatch.locator('.intake-review-original pre')).toContainText('Original PDF reference USD 12.00');
    await page.getByRole('region', { name: 'invoice-ignored.pdf', exact: true }).locator('.intake-review-row').getByRole('button', { name: zh ? '忽略' : 'Ignore', exact: true }).click();
    await expect(page.getByRole('region', { name: 'invoice-ignored.pdf', exact: true }).locator('.intake-review-source > .chip')).toHaveText(zh ? '已忽略' : 'Ignored');
    await expect(rows).toHaveCount(5);
    const before = await download(page, zh);
    expect(before.rows).toHaveLength(1); expect(before.candidates).toHaveLength(5);
    expect(before.candidates.filter(row => row.status === 'accepted')).toHaveLength(1);
    expect(before.candidates.filter(row => row.status === 'ignored')).toHaveLength(2);
    expect(before.candidates.find(row => row.source === 'pdf' && row.status === 'pending')).toMatchObject({
      kindSelected: true, sourceText: expect.stringContaining('Original PDF reference USD 12.00'),
      asset: { name: 'Edited pending PDF', kind: 'account', description: 'PDF manual edit' },
    });
    const destination = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
    const restored = await destination.newPage(); restored.on('pageerror', error => errors.push(error.message));
    try {
      await restored.goto('/intake'); await expect(restored.locator('.intake-review-row')).toHaveCount(0);
      await restored.locator('#backup-password').fill(password);
      await openBackupRestorePanel(restored);
      await restored.locator('#restore-file').setInputFiles(before.path);
      await restored.getByRole('button', { name: zh ? '预览' : 'Preview', exact: true }).first().click();
      const confirm = restored.getByRole('button', { name: /^(确认|Confirm) · 1/ });
      await expect(restored.getByRole('status').filter({ hasText: zh ? '资料记录：1 · 收录审核：5' : 'Records: 1 · Intake reviews: 5' })).toBeVisible();
      await confirm.click();
      const restoredRows = restored.locator('.intake-review-row'); await expect(restoredRows).toHaveCount(5);
      await restored.reload(); await expect(restoredRows).toHaveCount(5);
      expect((await download(restored, zh)).candidates).toEqual(before.candidates);
      await restored.locator('.intake-mode-tabs').getByRole('button', { name: zh ? '表格' : 'Spreadsheet', exact: true }).click();
      await restored.locator('#csv-file').setInputFiles({ name: 'renamed.csv', mimeType: 'text/csv', buffer: csv });
      await restored.locator('#csv-file').setInputFiles({ name: 'renamed-pending.pdf', mimeType: 'application/pdf', buffer: pendingPdf });
      await expect(restored.getByText(zh ? /不再支持导入 PDF/ : /PDF import is no longer supported/)).toBeVisible();
      await restored.locator('#csv-file').setInputFiles({ name: 'renamed-ignored.pdf', mimeType: 'application/pdf', buffer: ignoredPdf });
      await expect(restored.getByText(zh ? /不再支持导入 PDF/ : /PDF import is no longer supported/)).toBeVisible();
      await expect(restoredRows).toHaveCount(5);
      const after = await download(restored, zh); expect(after).toEqual({ ...before, path: after.path });
      const restoredBatch = restored.getByRole('region', { name: 'invoice-pending.pdf', exact: true });
      const restoredPdf = restoredBatch.locator('.intake-review-row');
      await restoredBatch.getByText(zh ? '查看提取原文' : 'View extracted text', { exact: true }).click();
      await expect(restoredBatch.locator('.intake-review-original pre')).toContainText('Original PDF reference USD 12.00');
      await expect(restoredPdf.getByLabel(zh ? '资料类型' : 'Record type')).toHaveAttribute("data-value", 'account');
      await restored.screenshot({ path: test.info().outputPath(`intake-review-backup-${locale}.png`), fullPage: true });
      expect(await restored.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await restoredPdf.getByRole('button', { name: zh ? '确认入库' : 'Confirm and save', exact: true }).click();
      await expect(restoredPdf).toContainText(zh ? '已确认' : 'Confirmed');
      await restored.goto('/assets/account'); await expect(restored.getByText('Edited pending PDF', { exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    } finally { await destination.close(); }
  } finally { await source.close(); }
});
