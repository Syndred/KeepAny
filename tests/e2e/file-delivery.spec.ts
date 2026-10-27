import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';

// Inside Vite's web root use the same browser module URL as the real callers.
// /@fs for this in-root file would create a second ES-module instance.
const deliveryPath = '/src/file-delivery.ts';
const password = 'Synthetic-export-only-2026';

test('Web keeps a real encrypted backup download without a native handler', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  await page.goto('/intake');
  await page.locator('#backup-password').fill(password);
  await page.getByRole('button', { name: 'Create backup', exact: true }).click();
  const save = page.getByRole('link', { name: 'Save backup file', exact: true });
  await expect(save).toBeVisible();
  const downloading = page.waitForEvent('download');
  await save.click();
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toMatch(/^keepany-\d{4}-\d{2}-\d{2}\.ka1$/);
  const path = await downloaded.path();
  if (!path) throw Error('synthetic-download-missing');
  const archive = await decryptBackup(new Uint8Array(readFileSync(path)), password);
  expect(archive.slice(0, 2)).toEqual(new Uint8Array([80, 75]));
});

for (const zh of [true, false]) {
  test(`${zh ? 'zh-CN' : 'en'} actual backup link uses the registered delivery boundary and distinguishes cancel/open/failure`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(language => localStorage.setItem('keepany-language', language), zh ? 'zh-CN' : 'en');
    await page.goto('/intake');
    await page.evaluate(async path => {
      const state: { count: number; result: string; name: string; magic: string; bytes: number; finish?: () => void } = { count: 0, result: 'cancelled', name: '', magic: '', bytes: 0 };
      Object.assign(window, { __deliveryTest: state });
      const { registerFileDeliveryHandler } = await import(path);
      registerFileDeliveryHandler(async (request: { name: string; bytes: Uint8Array }) => {
        state.count++; state.name = request.name; state.bytes = request.bytes.length;
        state.magic = new TextDecoder().decode(request.bytes.slice(0, 8));
        if (state.result === 'failure') throw Error('synthetic-share-failure');
        if (state.result === 'pending') return new Promise(resolve => { state.finish = () => resolve({ status: 'opened' }); });
        return { status: state.result };
      });
    }, deliveryPath);
    await page.locator('#backup-password').fill(password);
    await page.getByRole('button', { name: zh ? '创建备份' : 'Create backup', exact: true }).click();
    const save = page.getByRole('link', { name: zh ? '保存或分享文件' : 'Save or share file', exact: true });
    await expect(save).toBeVisible();
    await save.click();
    const notice = page.locator('.notice[role=status]');
    await expect(notice).toContainText(zh ? '已取消保存或分享' : 'Save or share cancelled');
    const first = await page.evaluate(() => (window as unknown as { __deliveryTest: { count: number; magic: string; name: string; bytes: number } }).__deliveryTest);
    expect(first).toMatchObject({ count: 1, magic: 'KEEPANY1' });
    expect(first.name).toMatch(/\.ka1$/); expect(first.bytes).toBeGreaterThan(52);
    await page.evaluate(() => { (window as unknown as { __deliveryTest: { result: string } }).__deliveryTest.result = 'pending'; });
    await save.click();
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await save.click({ force: true });
    expect(await page.evaluate(() => (window as unknown as { __deliveryTest: { count: number } }).__deliveryTest.count)).toBe(2);
    await page.evaluate(() => { (window as unknown as { __deliveryTest: { finish: () => void } }).__deliveryTest.finish(); });
    await expect(notice).toContainText(zh ? '返回应用不代表文件已保存' : 'returning to the app does not confirm it was saved');
    await page.evaluate(() => { (window as unknown as { __deliveryTest: { result: string } }).__deliveryTest.result = 'failure'; });
    await save.click();
    await expect(notice).toContainText(zh ? '无法打开文件保存或分享' : 'Could not prepare the file');
    await expect(save).not.toHaveAttribute('aria-disabled', 'true');
  });
}

test('KDBX export is explicit and cancellation does not announce an exported backup', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  await page.goto('/assets/vault');
  await page.locator('#password-vault-master').fill('Synthetic-export-master-2026');
  await page.locator('#password-vault-master-confirm').fill('Synthetic-export-master-2026');
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await expect(page.locator('.password-vault-toolbar')).toBeVisible();
  await page.evaluate(async path => {
    const state = { calls: 0, name: '', header: [] as number[] };
    Object.assign(window, { __vaultExport: state });
    const { registerFileDeliveryHandler } = await import(path);
    registerFileDeliveryHandler(async (request: { name: string; bytes: Uint8Array }) => {
      state.calls++; state.name = request.name; state.header = Array.from(request.bytes.slice(0, 8));
      return { status: 'cancelled' };
    });
  }, deliveryPath);
  expect(await page.evaluate(() => (window as unknown as { __vaultExport: { calls: number } }).__vaultExport.calls)).toBe(0);
  await page.getByRole('button', { name: 'Export backup', exact: true }).click();
  await expect(page.getByText('Save or share cancelled. You can try again with the generated file.', { exact: true }).first()).toBeVisible();
  const result = await page.evaluate(() => (window as unknown as { __vaultExport: { calls: number; name: string; header: number[] } }).__vaultExport);
  expect(result).toEqual({ calls: 1, name: 'keepany-password-vault.kdbx', header: [3, 217, 162, 154, 103, 251, 75, 181] });
  await expect(page.getByText('Backup exported.', { exact: true })).toHaveCount(0);
});
