import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { resources } from '../../apps/web/src/i18n';
import { sourceModuleUrl } from './helpers/source-module-url';
import { selectChoice } from './helpers/select-choice';

const repo = sourceModuleUrl('packages/local-db/src/index.ts');
const domain = sourceModuleUrl('packages/domain/src/index.ts');
const stored = (page: Page, type: 'task' | 'history' | 'asset', id: string) => page.evaluate(async ({ repo, type, id }) => (await (await import(repo)).localRepository()).get(type, id), { repo, type, id });

test('F18 ordinary trash has its own search and type filter', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/trash');
  await expect(page.locator('#trash-filter-query')).toBeVisible();
  await expect(page.locator('#trash-filter-type')).toBeVisible();
});

for (const locale of ['zh-CN', 'en'] as const) {
  test(`${locale} mobile trash search, type intersection, zero results, reopen and filtered purge`, async ({ browser }, info) => {
    const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
    await context.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
    const page = await context.newPage(), t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
    try {
      await page.goto('/trash');
      const fixture = await page.evaluate(async ({ repo, domain }) => {
        const { newAsset, taskSchema, historySchema, relationSchema } = await import(domain), db = await (await import(repo)).localRepository();
        const owner = { ...newAsset('project'), name: 'Live filter owner' };
        const deleted = { ...newAsset('project'), name: 'Erase project', notes: 'InvisiblePrivateNote', deleted: true };
        const account = { ...newAsset('account'), name: 'Keep account', deleted: true };
        const task = taskSchema.parse({ id: crypto.randomUUID(), assetId: owner.id, name: 'Erase selected task', createdAt: '2026-10-27T00:00:00Z', deleted: true });
        const other = { ...task, id: crypto.randomUUID(), name: 'Keep other task' };
        const bill = historySchema.parse({ id: crypto.randomUUID(), assetId: owner.id, action: 'expense', title: 'Erase invoice', note: '', amount: 1234, currency: 'USD', eventDate: '2026-10-27', createdAt: '2026-10-27T00:00:00Z', deleted: true });
        const relation = relationSchema.parse({ id: crypto.randomUUID(), from: owner.id, to: deleted.id, label: 'Filter relation', createdAt: '2026-10-27T00:00:00Z', deleted: true });
        await db.saveBatch([{ type: 'asset', value: owner }, { type: 'asset', value: deleted }, { type: 'asset', value: account }, { type: 'task', value: task }, { type: 'task', value: other }, { type: 'history', value: bill }, { type: 'relation', value: relation }]);
        return { owner, deleted, account, task, other, bill, relation };
      }, { repo, domain });
      await page.reload();
      const rows = () => page.locator('.trash-row');
      await expect(rows()).toHaveCount(6);
      await page.locator('#trash-filter-query').fill('InvisiblePrivateNote'); await expect(rows()).toHaveCount(0); await expect(page.getByText(t('trashNoMatches'), { exact: true })).toBeVisible();
      await page.getByRole('button', { name: t('trashClearFilters'), exact: true }).click(); await expect(rows()).toHaveCount(6);
      await selectChoice(page.locator('#trash-filter-type'), 'task'); await page.locator('#trash-filter-query').fill('ＥＲＡＳＥ'); await expect(rows()).toHaveCount(1); await expect(rows()).toContainText(fixture.task.name);
      await page.locator('.mobile-tabbar a[href="/tasks"]').click(); await page.locator('.mobile-tabbar a[href="/more"]').click(); await page.locator('.mobile-more-page a[href="/trash"]').click(); await page.reload();
      await expect(page.locator('#trash-filter-query')).toHaveValue('ＥＲＡＳＥ'); await expect(rows()).toHaveCount(1);
      await page.getByRole('button', { name: t('trashDeleteFiltered'), exact: true }).click(); await expect(page.getByRole('dialog')).toContainText(t('trashDeleteFilteredConfirm').replace('{{count}}', '1'));
      await page.getByRole('dialog').getByRole('button', { name: t('cancel'), exact: true }).click(); await expect(rows()).toHaveCount(1); expect(await stored(page, 'task', fixture.task.id)).toEqual(fixture.task);
      await page.getByRole('button', { name: t('trashDeleteFiltered'), exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: t('trashDeleteFiltered'), exact: true }).dblclick(); await expect(page.getByRole('dialog')).toBeHidden(); await expect(rows()).toHaveCount(0);
      expect(await stored(page, 'task', fixture.task.id)).toMatchObject({ purged: true }); expect(await stored(page, 'task', fixture.other.id)).toEqual(fixture.other); expect(await stored(page, 'asset', fixture.owner.id)).toEqual(fixture.owner); expect(await stored(page, 'history', fixture.bill.id)).toEqual(fixture.bill);
      await page.getByRole('button', { name: t('trashClearFilters'), exact: true }).click(); await expect(rows()).toHaveCount(5);
      await selectChoice(page.locator('#trash-filter-type'), 'history'); await page.locator('#trash-filter-query').fill('Erase'); await expect(rows()).toHaveCount(1); await expect(rows()).toContainText(fixture.bill.title);
      await selectChoice(page.locator('#trash-filter-type'), 'project'); await expect(rows()).toHaveCount(1); await expect(rows()).toContainText(fixture.deleted.name);
      for (const width of [360, 390, 430]) { await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: info.outputPath(`trash-filter-${locale}-${width}.png`), fullPage: true }); }
      await page.getByRole('button', { name: t('trashClearFilters'), exact: true }).click(); await page.reload(); await expect(rows()).toHaveCount(5); await expect(page.locator('#trash-filter-query')).toHaveValue('');
    } finally { await context.close(); }
  });
  test(`${locale} mobile task target, cancellation, duplicate restore, missing parent and exact-scope purge`, async ({ browser }, info) => {
    test.setTimeout(150_000);
    const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
    await context.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
    const page = await context.newPage(), t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
    const name = 'Mobile task identity';
    try {
      await page.goto('/tasks');
      const owners = await page.evaluate(async ({ repo, domain }) => {
        const { newAsset } = await import(domain), { saveBatch } = await import(repo);
        const first = { ...newAsset('project'), name: 'First task owner' }, second = { ...newAsset('project'), name: 'Second task owner' };
        await saveBatch([first, second].map(value => ({ type: 'asset', value }))); return { first, second };
      }, { repo, domain });
      async function prepareTask() {
        await page.getByRole('button', { name: t('newTask'), exact: true }).click();
        const form = page.getByRole('dialog');
        await form.getByLabel(t('name'), { exact: true }).fill(name);
        await form.getByLabel(t('date'), { exact: true }).fill('2026-10-27');
        await selectChoice(form.locator('#taskAsset'), owners.first.id); return form;
      }
      let form = await prepareTask();
      await form.getByRole('button', { name: t('cancel'), exact: true }).click();
      await expect(page.locator('.impact-task-row')).toHaveCount(0);
      form = await prepareTask(); await form.getByRole('button', { name: t('save'), exact: true }).dblclick(); await expect(form).toBeHidden();
      const initial = await page.evaluate(async ({ repo, name }) => (await (await (await import(repo)).localRepository()).list('task')).find((row: { name: string }) => row.name === name), { repo, name });
      expect(initial.assetId).toBe(owners.first.id);
      let row = page.locator(`#task-${initial.id}`);
      await row.getByRole('button', { name: t('edit'), exact: true }).click(); form = page.getByRole('dialog');
      await selectChoice(form.locator('#taskAsset'), owners.second.id); await form.getByRole('button', { name: t('cancel'), exact: true }).click();
      expect(await stored(page, 'task', initial.id)).toEqual(initial);
      await row.getByRole('button', { name: t('edit'), exact: true }).click(); form = page.getByRole('dialog');
      await selectChoice(form.locator('#taskAsset'), owners.second.id); await form.getByRole('button', { name: t('save'), exact: true }).click(); await expect(form).toBeHidden();
      const retargeted = await stored(page, 'task', initial.id);
      expect(retargeted).toMatchObject({ id: initial.id, assetId: owners.second.id, createdAt: initial.createdAt, completionHistory: initial.completionHistory });
      for (let index = 0; index < 2; index++) {
        await row.getByRole('button', { name: t('complete'), exact: true }).click();
        await expect(row.getByRole('button', { name: t('reopen'), exact: true })).toBeVisible();
        await row.getByRole('button', { name: t('reopen'), exact: true }).click(); await expect(row.getByRole('button', { name: t('complete'), exact: true })).toBeVisible();
      }
      const beforeDelete = await stored(page, 'task', initial.id); expect(beforeDelete.completionHistory).toHaveLength(2);
      await row.getByRole('button', { name: t('taskDeleteAction'), exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: t('cancel'), exact: true }).click(); expect(await stored(page, 'task', initial.id)).toEqual(beforeDelete);
      await row.getByRole('button', { name: t('taskDeleteAction'), exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: t('taskDeleteAction'), exact: true }).dblclick(); await expect(page.getByRole('dialog')).toBeHidden(); await expect(row).toHaveCount(0);
      form = await prepareTask(); await selectChoice(form.locator('#taskAsset'), owners.second.id);
      await form.getByRole('button', { name: t('save'), exact: true }).click(); await expect(form).toBeHidden();
      const competing = await page.evaluate(async ({ repo, id }) => (await (await (await import(repo)).localRepository()).list('task')).find((row: { id: string }) => row.id !== id), { repo, id: initial.id });
      await page.locator('.mobile-tabbar a[href="/more"]').click(); await page.locator('.mobile-more-page a[href="/trash"]').click();
      const trashed = () => page.locator(`[data-task-id="${initial.id}"]`);
      await trashed().getByRole('button', { name: t('restore'), exact: true }).click(); await expect(trashed().getByRole('alert')).toHaveText(t('trashTaskDuplicate'));
      await page.locator('.mobile-tabbar a[href="/tasks"]').click(); row = page.locator(`#task-${competing.id}`);
      await row.getByRole('button', { name: t('taskDeleteAction'), exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: t('taskDeleteAction'), exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
      await page.goto(`/assets/project/${owners.second.id}`);
      await page.locator('.asset-project-action-bar').getByRole('button', { name: t('delete'), exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: t('delete'), exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
      await page.locator('.mobile-tabbar a[href="/more"]').click(); await page.locator('.mobile-more-page a[href="/trash"]').click();
      await trashed().getByRole('button', { name: t('restore'), exact: true }).click(); await expect(trashed().getByRole('alert')).toHaveText(t('trashTaskTargetUnavailable'));
      await page.locator(`[data-asset-id="${owners.second.id}"]`).getByRole('button', { name: t('restore'), exact: true }).click();
      await expect(page.locator(`[data-asset-id="${owners.second.id}"]`)).toHaveCount(0);
      await trashed().getByRole('button', { name: t('restore'), exact: true }).click(); await expect(trashed()).toHaveCount(0);
      expect(await stored(page, 'task', initial.id)).toEqual(beforeDelete);
      const otherTrash = page.locator(`[data-task-id="${competing.id}"]`);
      await otherTrash.getByRole('button', { name: t('deletePermanently'), exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: t('cancel'), exact: true }).click(); await expect(otherTrash).toBeVisible();
      await otherTrash.getByRole('button', { name: t('deletePermanently'), exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: t('deletePermanently'), exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden(); await expect(otherTrash).toHaveCount(0);
      expect(await stored(page, 'task', competing.id)).toMatchObject({ purged: true, name: '—' }); expect(await stored(page, 'task', initial.id)).toEqual(beforeDelete);
      await page.locator('.mobile-tabbar a[href="/tasks"]').click(); await page.reload();
      await expect(page.locator(`#task-${initial.id}`)).toContainText(owners.second.name);
      for (const width of [360, 390, 430]) { await page.setViewportSize({ width, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: info.outputPath(`task-restored-${locale}-${width}.png`), fullPage: true }); }
    } finally { await context.close(); }
  });

  test(`${locale} mobile bill restoration, renewal display purge and encrypted clean restore preserve facts`, async ({ browser }, info) => {
    test.setTimeout(150_000);
    const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, acceptDownloads: true });
    await context.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
    const page = await context.newPage(), t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
    const password = 'Synthetic-ledger-trash-backup';
    try {
      await page.goto('/finance');
      const fixture = await page.evaluate(async ({ repo, domain }) => {
        const { newAsset, historySchema } = await import(domain), db = await (await import(repo)).localRepository();
        const project = { ...newAsset('project'), name: 'Ledger first owner' }, item = { ...newAsset('item'), name: 'Ledger second owner' };
        const subscription = { ...newAsset('subscription'), name: 'Renewal fact owner', dueDate: '2026-10-27', billingAnchor: '2026-10-27', amount: 1200, currency: 'USD' };
        await db.saveBatch([project, item, subscription].map(value => ({ type: 'asset', value })));
        const bill = historySchema.parse({ id: crypto.randomUUID(), assetId: project.id, assetIds: [project.id, item.id], action: 'expense', title: 'Shared restore invoice', source: 'Synthetic receipt', note: 'Complete original note', amount: 3456, currency: 'USD', eventDate: '2026-10-27', createdAt: '2026-10-27T00:00:00Z' });
        const other = { ...bill, id: crypto.randomUUID(), title: 'Keep unrelated invoice' }; await db.createFinanceEntry(bill); await db.createFinanceEntry(other);
        const fact = historySchema.parse({ id: crypto.randomUUID(), assetId: subscription.id, action: 'renew', billDate: '2026-10-27', amount: 1200, currency: 'USD', note: 'Original immutable renewal fact', createdAt: '2026-10-27T00:00:00Z' });
        const current = { ...subscription, dueDate: '2026-11-27', renewalCount: 1, lastRenewalId: fact.id, updatedAt: '2026-10-27T00:00:01Z' }; await db.recordRenewal(subscription, current, fact);
        return { bill, other, fact, current, project, item };
      }, { repo, domain });
      await page.reload();
      async function hide(id: string) {
        await page.goto('/finance'); await page.locator(`#finance-entry-${id}`).getByRole('button', { name: t('financeDeleteAction'), exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: t('financeDeleteAction'), exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
        await page.locator('.mobile-tabbar a[href="/more"]').click(); await page.locator('.mobile-more-page a[href="/trash"]').click();
      }
      await hide(fixture.bill.id);
      let trash = page.locator(`[data-history-id="${fixture.bill.id}"]`); await expect(trash).toContainText('Shared restore invoice');
      // C injection: a failed write must keep the tombstone and expose retry.
      await page.evaluate(async repo => { const db = await (await import(repo)).localRepository(), original = db.restoreFinanceEntryIfCurrent.bind(db); db.restoreFinanceEntryIfCurrent = async () => { db.restoreFinanceEntryIfCurrent = original; throw Error('synthetic-storage-full'); }; }, repo);
      await trash.getByRole('button', { name: t('restore'), exact: true }).click(); await expect(trash.getByRole('alert')).toBeVisible(); expect(await stored(page, 'history', fixture.bill.id)).toEqual({ ...fixture.bill, deleted: true });
      await trash.getByRole('button', { name: t('restore'), exact: true }).click(); await expect(trash).toHaveCount(0); expect(await stored(page, 'history', fixture.bill.id)).toEqual(fixture.bill);
      await hide(fixture.bill.id); trash = page.locator(`[data-history-id="${fixture.bill.id}"]`);
      await trash.getByRole('button', { name: t('deletePermanently'), exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: t('cancel'), exact: true }).click(); await expect(trash).toBeVisible();
      await trash.getByRole('button', { name: t('deletePermanently'), exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: t('deletePermanently'), exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden(); await expect(trash).toHaveCount(0);
      expect(await stored(page, 'history', fixture.bill.id)).toMatchObject({ purged: true, deleted: true, action: 'maintenance', note: '' }); expect(await stored(page, 'history', fixture.other.id)).toEqual(fixture.other);
      await hide(fixture.fact.id); trash = page.locator(`[data-history-id="${fixture.fact.id}"]`); await expect(trash).toContainText(t('trashRenewalProjectionHint'));
      await trash.getByRole('button', { name: t('restore'), exact: true }).click(); await expect(trash).toHaveCount(0);
      expect(await stored(page, 'asset', fixture.current.id)).toEqual(fixture.current);
      const visibleFact = await stored(page, 'history', fixture.fact.id), { financeCorrection: correction, ...originalFact } = visibleFact; expect(originalFact).toEqual(fixture.fact); expect(correction.hidden).toBe(false);
      await hide(fixture.fact.id); trash = page.locator(`[data-history-id="${fixture.fact.id}"]`);
      await trash.getByRole('button', { name: t('deletePermanently'), exact: true }).click(); await expect(page.getByRole('dialog')).toContainText(t('trashRenewalProjectionPurge'));
      await page.screenshot({ path: info.outputPath(`renewal-purge-decision-${locale}.png`), fullPage: true });
      await page.getByRole('dialog').getByRole('button', { name: t('cancel'), exact: true }).click(); await expect(trash).toBeVisible();
      await trash.getByRole('button', { name: t('deletePermanently'), exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: t('deletePermanently'), exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden(); await expect(trash).toHaveCount(0);
      const erasedFact = await stored(page, 'history', fixture.fact.id), { financeCorrection: erasedCorrection, ...unchangedFact } = erasedFact; expect(unchangedFact).toEqual(fixture.fact); expect(erasedCorrection).toMatchObject({ purged: true, hidden: true });
      expect(await stored(page, 'asset', fixture.current.id)).toEqual(fixture.current); expect(await stored(page, 'asset', fixture.project.id)).toEqual(fixture.project); expect(await stored(page, 'asset', fixture.item.id)).toEqual(fixture.item);
      await page.goto('/intake'); await page.locator('#backup-password').fill(password); await page.getByRole('button', { name: t('backup'), exact: true }).click();
      const pending = page.waitForEvent('download'); await page.getByRole('link', { name: t('saveBackupFile'), exact: true }).click();
      const download = await pending, path = await download.path(); if (!path) throw Error('missing-download'); expect(readFileSync(path).subarray(0, 8).toString()).toBe('KEEPANY1');
      const restoredContext = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
      await restoredContext.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
      try {
        const restored = await restoredContext.newPage(); await restored.goto('/intake'); await restored.locator('#backup-password').fill(password); await restored.locator('#restore-file').setInputFiles(path);
        await restored.getByRole('button', { name: t('preview'), exact: true }).first().click(); await restored.getByRole('button', { name: locale === 'en' ? /^Confirm ·/ : /^确认 ·/ }).click();
        await expect.poll(() => stored(restored, 'history', fixture.fact.id)).toEqual(erasedFact); expect(await stored(restored, 'asset', fixture.current.id)).toEqual(fixture.current);
        await restored.goto('/trash'); await expect(restored.locator('[data-history-id]')).toHaveCount(0);
        await restored.goto('/finance'); await expect(restored.locator('.finance-entry')).toHaveCount(1); await expect(restored.locator('.finance-entry')).toContainText('Keep unrelated invoice');
        for (const width of [360, 390, 430]) { await restored.setViewportSize({ width, height: 844 }); expect(await restored.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await restored.screenshot({ path: info.outputPath(`ledger-restored-${locale}-${width}.png`), fullPage: true }); }
      } finally { await restoredContext.close(); }
    } finally { await context.close(); }
  });
}
