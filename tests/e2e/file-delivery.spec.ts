import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';

// Inside Vite's web root use the same browser module URL as the real callers.
// /@fs for this in-root file would create a second ES-module instance.
const deliveryPath = '/src/file-delivery.ts';
const password = 'Synthetic-export-only-2026';

type DeliveryFeedback = { mode: string; calls: { name: string; magic: string; bytes: number }[];
  pending: Record<number, (status: 'saved' | 'opened' | 'cancelled') => void> };

for (const zh of [true, false]) {
  test(`${zh ? 'zh-CN' : 'en'} backup delivery result stays beside Save and belongs to its current file`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    try {
      await page.addInitScript(language => localStorage.setItem('keepany-language', language), zh ? 'zh-CN' : 'en');
      await page.goto('/intake?nativeDeliveryFixture=1');
      await page.evaluate(async path => {
        if ((window as unknown as { __deliveryFeedback?: DeliveryFeedback }).__deliveryFeedback) return;
        // Same supported registration as the existing delivery integration cases.
        // A production fixture may register before the real app entry instead.
        const state: DeliveryFeedback = { mode: 'saved', calls: [], pending: {} };
        Object.assign(window, { __deliveryFeedback: state });
        const { registerFileDeliveryHandler } = await import(path);
        registerFileDeliveryHandler(async (request: { name: string; bytes: Uint8Array }) => {
          const id = state.calls.push({ name: request.name, magic: new TextDecoder().decode(request.bytes.slice(0, 8)), bytes: request.bytes.length });
          if (state.mode === 'failure') throw Error('synthetic-delivery-failure');
          if (state.mode === 'pending') return new Promise(resolve => { state.pending[id] = status => { delete state.pending[id]; resolve({ status }); }; });
          return { status: state.mode };
        });
      }, deliveryPath);
      const mode = async (value: string) => page.evaluate(value => { (window as unknown as { __deliveryFeedback: DeliveryFeedback }).__deliveryFeedback.mode = value; }, value);
      const pendingId = async () => {
        await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as { __deliveryFeedback: DeliveryFeedback }).__deliveryFeedback.pending).length)).toBe(1);
        return page.evaluate(() => Number(Object.keys((window as unknown as { __deliveryFeedback: DeliveryFeedback }).__deliveryFeedback.pending)[0]));
      };
      const finish = async (id: number, status: 'saved' | 'opened' | 'cancelled') => page.evaluate(({ id, status }) => {
        (window as unknown as { __deliveryFeedback: DeliveryFeedback }).__deliveryFeedback.pending[id](status);
      }, { id, status });
      const create = page.getByRole('button', { name: zh ? '创建备份' : 'Create backup', exact: true });
      const save = page.getByRole('link', { name: zh ? '保存或分享文件' : 'Save or share file', exact: true });
      const hint = page.locator('.intake-backup-status');
      const readyText = zh ? '加密文件已生成' : 'Encrypted file ready';
      const savedText = zh ? '文件已保存，并已读回核对' : 'The file was saved and read back for verification';
      await page.locator('#backup-password').fill(password);
      await create.tap();
      await expect(save).toBeVisible();
      const firstUrl = await save.getAttribute('href');
      await expect(hint).toContainText(readyText);
      await save.tap();
      await expect(page.locator('.intake-tools')).toContainText(savedText);
      await page.screenshot({ path: info.outputPath('saved-near-link.png'), fullPage: false });
      await expect(hint).toContainText(savedText);
      await expect(hint).toBeInViewport();
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      const geometry = { save: await save.boundingBox(), hint: await hint.boundingBox(), viewport: page.viewportSize() };
      expect(geometry.hint!.y).toBeGreaterThanOrEqual(geometry.save!.y + geometry.save!.height);
      await info.attach('saved-hint-natural-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
      for (const [result, text] of [['cancelled', zh ? '已取消保存或分享' : 'Save or share cancelled'],
        ['opened', zh ? '返回应用不代表文件已保存' : 'returning to the app does not confirm it was saved'],
        ['failure', zh ? '无法打开文件保存或分享' : 'Could not prepare the file']] as const) {
        await mode(result); await save.tap(); await expect(hint).toContainText(text);
        await expect(hint).not.toContainText(savedText);
        await expect(save).not.toHaveAttribute('aria-disabled', 'true');
        expect(await save.getAttribute('href')).toBe(firstUrl);
      }
      expect(await page.evaluate(async url => { try { return (await fetch(url!)).ok; } catch { return false; } }, firstUrl)).toBe(true);
      await mode('pending'); await save.tap(); const oldId = await pendingId();
      await expect(hint).toContainText(zh ? '正在准备系统保存或分享界面' : 'Preparing the system save or share sheet');
      await page.locator('#backup-password').fill(`${password}-changed`);
      await expect(save).toHaveCount(0);
      await expect.poll(() => page.evaluate(async url => { try { return (await fetch(url!)).ok; } catch { return false; } }, firstUrl)).toBe(false);
      await create.tap(); await expect(save).toBeVisible(); await expect(hint).toContainText(readyText);
      const secondUrl = await save.getAttribute('href'); expect(secondUrl).not.toBe(firstUrl);
      await finish(oldId, 'saved'); await expect(hint).toContainText(readyText); await expect(hint).not.toContainText(savedText);
      // New backup while the previous delivery is unresolved; same filename,
      // distinct object URL. Its late result must not clear the new failure.
      await mode('pending'); await save.tap(); const staleId = await pendingId();
      await create.tap(); await expect(save).toBeVisible(); await expect(hint).toContainText(readyText);
      expect(await save.getAttribute('href')).not.toBe(secondUrl);
      await expect.poll(() => page.evaluate(async url => { try { return (await fetch(url!)).ok; } catch { return false; } }, secondUrl)).toBe(false);
      await mode('failure'); await save.tap();
      await expect(hint).toContainText(zh ? '无法打开文件保存或分享' : 'Could not prepare the file');
      await finish(staleId, 'saved');
      await expect(hint).toContainText(zh ? '无法打开文件保存或分享' : 'Could not prepare the file');
      await mode('opened'); await save.tap();
      await expect(hint).toContainText(zh ? '返回应用不代表文件已保存' : 'returning to the app does not confirm it was saved');
      const requests = await page.evaluate(() => (window as unknown as { __deliveryFeedback: DeliveryFeedback }).__deliveryFeedback.calls);
      expect(requests).toHaveLength(8);
      expect(requests.every(request => request.magic === 'KEEPANY1' && request.bytes > 52 && request.name.endsWith('.ka1'))).toBe(true);
    } finally { await context.close(); }
  });
}

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
    const notice = page.locator('.intake-backup-status[role=status]');
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
