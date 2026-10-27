import { expect, test, type Page } from '@playwright/test';
import { selectChoice } from './helpers/select-choice';

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
