import { expect, test, type Page } from '@playwright/test';
import { selectChoice } from './helpers/select-choice';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { decryptBackup, encryptBackup } from '../../packages/local-db/src/backup-crypto';

// Production build: read only the existing records store, never create a DB,
// import dev source, or mutate the item through a test API.
async function records(page: Page) {
  return page.evaluate(async () => {
    const name = 'rxdb-dexie-keepany-v1--0--records';
    if (!(await indexedDB.databases()).some(db => db.name === name)) throw Error('records database missing');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => { request.transaction?.abort(); reject(Error('unexpected database creation')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    try {
      return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const request = db.transaction('docs', 'readonly').objectStore('docs').getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result.sort((a, b) => String(a.id).localeCompare(String(b.id))));
      });
    } finally { db.close(); }
  });
}

for (const language of ['en-US', 'zh-CN'] as const) {
  test(`F10-03 legacy missing borrower import uses a named generic confirmation ${language} 390`, async ({ browser }, info) => {
    const zh = language === 'zh-CN';
    const source = await browser.newContext({ locale: language, viewport: { width: 390, height: 844 }, hasTouch: true });
    const destination = await browser.newContext({ locale: language, viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await source.newPage();
    const restored = await destination.newPage();
    const password = 'Synthetic-legacy-loan-backup-2026';
    let before: Record<string, unknown>[] | undefined;
    try {
      for (const target of [page, restored]) {
        await target.goto('/settings');
        await selectChoice(target.locator('section.card').filter({ has: target.getByRole('heading', { name: /^(Language|语言)$/ }) }).getByRole('combobox'), { label: zh ? '简体中文' : 'English' });
      }
      await page.goto('/assets/item');
      await page.getByRole('button', { name: zh ? '新增' : 'Add', exact: true }).click();
      const name = `Legacy missing borrower ${language} ${crypto.randomUUID().slice(0, 8)}`;
      await page.getByRole('dialog').getByLabel(zh ? '名称' : 'Name', { exact: true }).fill(name);
      await page.getByRole('dialog').getByRole('button', { name: zh ? '保存' : 'Save', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
      await page.goto('/intake');
      await page.locator('#backup-password').fill(password);
      await page.getByRole('button', { name: zh ? '创建备份' : 'Create backup', exact: true }).click();
      const downloading = page.waitForEvent('download');
      await page.getByRole('link', { name: zh ? '保存备份文件' : 'Save backup file', exact: true }).click();
      const download = await downloading, file = await download.path();
      if (!file) throw Error('synthetic-backup-download-missing');
      // A synthetic compatibility file, not claimed to be a historical release.
      // Only the file bytes change; the destination writes through formal restore UI.
      const entries = unzipSync(await decryptBackup(new Uint8Array(readFileSync(file)), password));
      const rows = JSON.parse(strFromU8(entries['records.json'])) as Record<string, unknown>[];
      const row = rows.find(row => row.type === 'asset' && payload(row).name === name);
      expect(row).toBeTruthy();
      const item = { ...payload(row!), status: 'loaned' };
      delete (item as Record<string, unknown>).borrower;
      row!.payload = JSON.stringify(item);
      entries['records.json'] = strToU8(JSON.stringify(rows));
      const manifest = JSON.parse(strFromU8(entries['manifest.json']));
      manifest.recordsHash = createHash('sha256').update(entries['records.json']).digest('hex');
      entries['manifest.json'] = strToU8(JSON.stringify(manifest));
      const encrypted = await encryptBackup(zipSync(entries), password);
      await info.attach('synthetic-loaned-missing-borrower.ka1', { body: Buffer.from(encrypted), contentType: 'application/octet-stream' });
      await restored.goto('/intake');
      await restored.locator('#backup-password').fill(password);
      await restored.locator('#restore-file').setInputFiles({ name: 'synthetic-loaned-missing-borrower.ka1', mimeType: 'application/octet-stream', buffer: Buffer.from(encrypted) });
      await restored.getByRole('button', { name: zh ? '预览' : 'Preview', exact: true }).first().click();
      await restored.getByRole('button', { name: /^(确认|Confirm) ·/ }).click();
      await expect(restored.getByText(zh ? /已恢复 \d+ 条记录/ : /Restored \d+ records/)).toBeVisible();
      await restored.goto('/assets/item');
      await restored.getByText(name, { exact: true }).click();
      const returnButton = restored.getByRole('button', { name: zh ? '归还' : 'Return item', exact: true });
      await expect(returnButton).toBeVisible();
      before = await records(restored);
      await returnButton.click();
      const dialog = restored.getByRole('dialog', { name: zh ? '归还' : 'Return item', exact: true });
      await expect(dialog).toBeVisible();
      await restored.screenshot({ path: info.outputPath('legacy-borrower-confirmation.png'), fullPage: false });
      await expect(dialog.locator('p').first()).toHaveText(zh ? `确认收回“${name}”？` : `Confirm that “${name}” has been returned?`);
      expect(await dialog.innerText()).not.toMatch(/undefined|itemReturnConfirm|“”/);
      for (const [label, control] of [['dialog', dialog], ['cancel', dialog.getByRole('button', { name: zh ? '取消' : 'Cancel', exact: true })], ['confirm', dialog.getByRole('button', { name: zh ? '确认' : 'Confirm', exact: true })]] as const) {
        const box = await control.boundingBox();
        expect(box?.width, `${label} width`).toBeGreaterThanOrEqual(44);
        expect(box?.height, `${label} height`).toBeGreaterThanOrEqual(44);
      }
      const geometry = await dialog.evaluate(element => ({ viewport: { width: innerWidth, height: innerHeight }, dialog: element.getBoundingClientRect().toJSON(), buttons: Array.from(element.querySelectorAll('button')).map(button => ({ label: button.textContent, box: button.getBoundingClientRect().toJSON() })) }));
      await info.attach('legacy-dialog-actual-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
      expect(await records(restored)).toEqual(before);
      await dialog.getByRole('button', { name: zh ? '取消' : 'Cancel', exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(await records(restored)).toEqual(before);
      await returnButton.click();
      await dialog.getByRole('button', { name: zh ? '确认' : 'Confirm', exact: true }).dblclick();
      await expect(dialog).toBeHidden();
      await expect(returnButton).toHaveCount(0);
      const after = await records(restored);
      const original = before.find(row => row.type === 'asset')!;
      const returned = payload(after.find(row => row.id === original.id)!);
      const history = after.filter(row => row.type === 'history');
      expect(history).toHaveLength(1);
      expect(payload(history[0])).toMatchObject({ action: 'return', assetId: returned.id, borrower: '' });
      expect(after).toHaveLength(before.length + 1);
      expect(returned).toEqual({ ...payload(original), status: 'active', borrower: '', itemExpectedReturnDate: '', lastItemEventId: payload(history[0]).id, updatedAt: payload(history[0]).createdAt });
      await restored.reload();
      await expect(restored.getByRole('button', { name: zh ? '借出' : 'Lend item', exact: true })).toBeVisible();
      expect(await records(restored)).toEqual(after);
    } finally {
      await info.attach('legacy-full-raw-before-final', { body: JSON.stringify({ before, final: await records(restored).catch(() => null) }), contentType: 'application/json' });
      await Promise.all([source.close(), destination.close()]);
    }
  });
}
const payload = (row: Record<string, unknown>) => typeof row.payload === 'string'
  ? JSON.parse(row.payload) as Record<string, unknown> : row.payload as Record<string, unknown>;

for (const language of ['en-US', 'zh-CN'] as const) {
  test(`F10-03 return cancel and confirm preserve exact item history ${language} 390`, async ({ browser }, info) => {
    const zh = language === 'zh-CN';
    const context = await browser.newContext({ locale: language, viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let before: Record<string, unknown>[] | undefined;
    try {
      await page.goto('/settings');
      await selectChoice(page.locator('section.card').filter({ has: page.getByRole('heading', { name: /^(Language|语言)$/ }) }).getByRole('combobox'), { label: zh ? '简体中文' : 'English' });
      await page.goto('/assets/item');
      await page.getByRole('button', { name: zh ? '新增' : 'Add', exact: true }).click();
      const editor = page.getByRole('dialog');
      const name = `F10 return synthetic ${language} ${crypto.randomUUID().slice(0, 8)}`;
      const borrower = `Borrower ${language}`;
      await editor.getByLabel(zh ? '名称' : 'Name', { exact: true }).fill(name);
      await editor.getByRole('button', { name: zh ? '保存' : 'Save', exact: true }).click();
      await expect(editor).toBeHidden();
      await page.getByText(name, { exact: true }).click();
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      const lend = page.getByRole('button', { name: zh ? '借出' : 'Lend item', exact: true });
      await lend.click();
      await expect(page.getByRole('alert')).toContainText(zh ? '借用人' : "borrower's name");
      await page.getByLabel(zh ? '借用人' : 'Borrower', { exact: true }).fill(borrower);
      await page.getByLabel(zh ? '预计归还日期' : 'Expected return date', { exact: true }).fill('2030-01-31');
      await lend.click();
      const returnButton = page.getByRole('button', { name: zh ? '归还' : 'Return item', exact: true });
      await expect(returnButton).toBeVisible();
      await page.getByLabel(zh ? '借还备注（可选）' : 'Loan or return note (optional)').fill(`Return note ${language}`);
      before = await records(page);
      const original = before.find(row => row.type === 'asset' && payload(row).name === name);
      expect(original).toBeTruthy();
      const itemId = payload(original!).id;
      const originalHistory = before.filter(row => row.type === 'history' && payload(row).assetId === itemId);
      expect(originalHistory.map(row => payload(row).action)).toEqual(['loan']);
      await returnButton.click();
      await page.screenshot({ path: info.outputPath('after-return-click.png'), fullPage: false });
      const confirmation = page.getByRole('dialog', { name: zh ? '归还' : 'Return item', exact: true });
      await expect(confirmation).toBeVisible();
      expect(await records(page)).toEqual(before);
      await confirmation.getByRole('button', { name: zh ? '取消' : 'Cancel', exact: true }).click();
      await expect(confirmation).toBeHidden();
      expect(await records(page)).toEqual(before);
      await expect(page.getByLabel(zh ? '借还备注（可选）' : 'Loan or return note (optional)')).toHaveValue(`Return note ${language}`);
      await returnButton.click();
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole('button', { name: zh ? '确认' : 'Confirm', exact: true }).dblclick();
      await expect(confirmation).toBeHidden();
      await expect(returnButton).toHaveCount(0);
      await expect(lend).toBeVisible();
      const after = await records(page);
      expect(after).toHaveLength(before.length + 1);
      const returned = payload(after.find(row => row.id === original!.id)!);
      expect(returned).toMatchObject({ id: itemId, status: 'active', borrower: '', itemExpectedReturnDate: '' });
      const history = after.filter(row => row.type === 'history' && payload(row).assetId === itemId);
      expect(history.map(row => payload(row).action).sort()).toEqual(['loan', 'return']);
      expect(history.find(row => row.id === originalHistory[0].id)).toEqual(originalHistory[0]);
      expect(payload(history.find(row => payload(row).action === 'return')!)).toMatchObject({ borrower, note: `Return note ${language}` });
      const returnEvent = payload(history.find(row => payload(row).action === 'return')!);
      expect(returned).toEqual({ ...payload(original!), status: 'active', borrower: '', itemExpectedReturnDate: '', lastItemEventId: returnEvent.id, updatedAt: returnEvent.createdAt });
      const detailValue = (label: string) => page.locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('..').locator('dd');
      await expect(detailValue(zh ? '状态' : 'Status')).toContainText(zh ? '使用中' : 'Active');
      await expect(detailValue(zh ? '借用人' : 'Borrower')).toHaveCount(0);
      expect(after.filter(row => row.type !== 'asset' && row.type !== 'history')).toEqual(before.filter(row => row.type !== 'asset' && row.type !== 'history'));
      await page.reload();
      await expect(lend).toBeVisible();
      await expect(returnButton).toHaveCount(0);
      await expect(detailValue(zh ? '状态' : 'Status')).toContainText(zh ? '使用中' : 'Active');
      expect(await records(page)).toEqual(after);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.screenshot({ path: info.outputPath('returned-after-reload.png'), fullPage: false });
      if (!zh) {
        // Both writers use formal UI Pages sharing the same existing repository.
        await page.getByLabel('Borrower', { exact: true }).fill('Second synthetic borrower');
        await lend.click();
        await expect(returnButton).toBeVisible();
        await returnButton.click();
        await expect(confirmation).toBeVisible();
        const other = await context.newPage();
        await other.goto(page.url());
        await other.getByRole('button', { name: 'Return item', exact: true }).click();
        await other.getByRole('dialog', { name: 'Return item', exact: true }).getByRole('button', { name: 'Confirm', exact: true }).click();
        await expect(other.getByRole('button', { name: 'Lend item', exact: true })).toBeVisible();
        const otherCommitted = await records(other);
        await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click();
        await expect(confirmation.getByRole('alert')).toHaveText("This item's status changed. Refresh before continuing.");
        expect(await records(page)).toEqual(otherCommitted);
        expect(otherCommitted.filter(row => row.type === 'history').map(row => payload(row).action).sort()).toEqual(['loan', 'loan', 'return', 'return']);
        await page.screenshot({ path: info.outputPath('stale-return-confirmation-rejected.png'), fullPage: false });
        await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
        await other.close();
      }
      expect(errors).toEqual([]);
    } finally {
      await info.attach('before-and-final-raw-records', { body: JSON.stringify({ before, final: await records(page).catch(() => null) }), contentType: 'application/json' });
      await context.close();
    }
  });
}
