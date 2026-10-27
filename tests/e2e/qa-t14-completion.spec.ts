import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import type { Asset, History } from '../../packages/domain/src';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import { selectChoice } from './helpers/select-choice';
import { sourceModuleUrl } from './helpers/source-module-url';

const repo = sourceModuleUrl('packages/local-db/src/index.ts');
const domain = sourceModuleUrl('packages/domain/src/index.ts');
const portable = process.env.KEEPANY_T14_PORTABLE === '1';
const fixtureDirectory = resolve('test-results/T14-completion-fixture');
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? 'docs/qa/2026-10-27/evidence/T14-completion';
const password = 'Synthetic-T14-only-backup';
mkdirSync(fixtureDirectory, { recursive: true }); mkdirSync(evidence, { recursive: true });
type Fixture = { project: Asset; item: Asset; account: Asset; subscription: Asset; renewed: Asset; renewal: History; dollar: History; yen: History };
let fixture: Fixture;
const copy = (zh: boolean) => ({
  add: zh ? '记一笔' : 'Record transaction', title: zh ? '名称' : 'Title', amount: zh ? '金额' : 'Amount',
  asset: zh ? '关联资产' : 'Related asset', date: zh ? '日期' : 'Date', currency: zh ? '币种' : 'Currency', note: zh ? '备注' : 'Note',
  source: zh ? '付款来源（选填）' : 'Payment source (optional)', save: zh ? '保存记录' : 'Save record', cancel: zh ? '取消' : 'Cancel',
  edit: zh ? '编辑' : 'Edit', editDialog: zh ? '编辑账单' : 'Edit transaction', remove: zh ? '删除' : 'Delete',
  deleteDialog: zh ? '删除账单' : 'Delete transaction', backup: zh ? '创建备份' : 'Create backup',
  download: zh ? '保存备份文件' : 'Save backup file', preview: zh ? '预览' : 'Preview',
  confirm: zh ? /^确认 ·/ : /^Confirm ·/, restored: zh ? /已恢复 \d+ 条记录/ : /Restored \d+ records/,
});

async function downloadArchive(page: Page, zh = false) {
  const c = copy(zh); await page.goto('/intake');
  await page.locator('#backup-password').fill(password);
  await page.getByRole('button', { name: c.backup, exact: true }).click();
  const link = page.getByRole('link', { name: c.download, exact: true }); await expect(link).toBeVisible();
  const pending = page.waitForEvent('download'); await link.click(); const download = await pending;
  const path = await download.path(); if (!path) throw Error('missing-backup-download');
  const files = unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)), password));
  const rows = JSON.parse(strFromU8(files['records.json'])) as { type: string; payload: string }[];
  return { download, assets: rows.filter(row => row.type === 'asset').map(row => JSON.parse(row.payload) as Asset),
    history: rows.filter(row => row.type === 'history').map(row => JSON.parse(row.payload) as History) };
}

async function restoreFixture(page: Page, zh: boolean, path = resolve(fixtureDirectory, 'fixture.ka1')) {
  const c = copy(zh); await page.goto('/intake'); await page.locator('#backup-password').fill(password);
  await page.locator('#restore-file').setInputFiles(path); await page.getByRole('button', { name: c.preview, exact: true }).first().click();
  await page.getByRole('button', { name: c.confirm }).click(); await expect(page.getByText(c.restored)).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  if (portable) { fixture = JSON.parse(readFileSync(resolve(fixtureDirectory, 'fixture.json'), 'utf8')); return; }
  const context = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
  await context.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  const page = await context.newPage();
  try {
    await page.goto('/finance');
    fixture = await page.evaluate(async ({ repo, domain }) => {
      const { localRepository } = await import(repo), { newAsset, historySchema } = await import(domain);
      const db = await localRepository();
      const project = { ...newAsset('project'), name: 'T14 Project owner' }, item = { ...newAsset('item'), name: 'T14 Equipment owner' };
      const account = { ...newAsset('account'), name: 'T14 Account owner' }, subscription = { ...newAsset('subscription'), name: 'T14 Subscription source',
        dueDate: '2026-10-27', billingAnchor: '2026-10-27', amount: 500, currency: 'CNY' };
      await db.saveBatch([project,item,account,subscription].map(value => ({ type: 'asset', value })));
      const renewal = historySchema.parse({ id: crypto.randomUUID(), assetId: subscription.id, action: 'renew', note: 'Preserved renewal fact',
        amount: 500, currency: 'CNY', billDate: '2026-10-27', createdAt: '2026-10-27T00:00:00.000Z' });
      const renewed = { ...subscription, dueDate: '2026-11-27', renewalCount: 1, lastRenewalId: renewal.id, updatedAt: '2026-10-27T00:00:01.000Z' };
      await db.recordRenewal(subscription, renewed, renewal);
      const dollar = historySchema.parse({ id: crypto.randomUUID(), assetId: account.id, action: 'expense', title: 'T14 USD reference', note: '',
        amount: 1200, currency: 'USD', eventDate: '2026-10-27', createdAt: '2026-10-27T00:00:00.000Z' });
      const yen = historySchema.parse({ ...dollar, id: crypto.randomUUID(), assetId: item.id, title: 'T14 JPY reference', amount: 300, currency: 'JPY' });
      await db.createFinanceEntry(dollar); await db.createFinanceEntry(yen);
      return { project,item,account,subscription,renewed,renewal,dollar,yen };
    }, { repo, domain });
    const archive = await downloadArchive(page); await archive.download.saveAs(resolve(fixtureDirectory, 'fixture.ka1'));
    writeFileSync(resolve(fixtureDirectory, 'fixture.json'), JSON.stringify(fixture, null, 2));
  } finally { await context.close(); }
});

for (const locale of ['zh-CN','en-US'] as const) for (const width of [390,1280]) {
  test(`${locale} ${width} T14-01..04 shared bill editing deletion renewal preservation and backup`, async ({ browser }) => {
    test.setTimeout(150_000);
    const zh = locale === 'zh-CN', c = copy(zh), errors: string[] = [];
    const context = await browser.newContext({ locale, timezoneId: 'Asia/Shanghai', viewport: { width, height: 900 }, acceptDownloads: true });
    await context.addInitScript(value => localStorage.setItem('keepany-language', value), zh ? 'zh-CN' : 'en');
    const page = await context.newPage(); page.setDefaultTimeout(15_000); page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-27T04:00:00.000Z'));
    try {
      await restoreFixture(page, zh); await page.goto('/finance');
      const rows = page.locator('.finance-entry'); await expect(rows).toHaveCount(3);
      await page.getByRole('button', { name: c.add, exact: true }).click();
      let form = page.getByRole('dialog', { name: c.add, exact: true });
      await selectChoice(form.getByLabel(c.asset, { exact: true }), fixture.project.id);
      await form.getByRole('checkbox', { name: fixture.item.name, exact: true }).check();
      await form.getByLabel(c.title, { exact: true }).fill('T14 Shared project equipment invoice');
      await form.getByLabel(c.amount, { exact: true }).fill('1.234');
      await form.getByLabel(c.date, { exact: true }).fill('2026-10-27');
      await form.getByLabel(c.source, { exact: true }).fill('T14 synthetic statement');
      await form.getByRole('button', { name: c.save, exact: true }).click();
      await expect(form.getByRole('alert')).toContainText(zh ? '有效金额' : 'valid amount');
      await form.getByLabel(c.amount, { exact: true }).fill('12.34');
      await form.getByRole('button', { name: c.save, exact: true }).dblclick(); await expect(form).toBeHidden();
      const shared = rows.filter({ hasText: 'T14 Shared project equipment invoice' }); await expect(shared).toHaveCount(1);
      const sharedRowId = await shared.getAttribute('id'); if (!sharedRowId) throw Error('missing-bill-id');
      const sharedId = sharedRowId.slice('finance-entry-'.length);
      await expect(shared).toContainText(fixture.project.name); await expect(shared).toContainText(fixture.item.name);
      await expect(page.locator('.finance-summary > .card').nth(1)).toContainText('17.34');
      await expect(page.locator('.finance-summary > .card').nth(1)).toContainText('12.00');
      await expect(page.locator('.finance-summary > .card').nth(1)).toContainText('300');
      for (const owner of [fixture.project, fixture.item]) { await page.goto(`/assets/${owner.kind}/${owner.id}`);
        await expect(page.locator(`.asset-finance-card [data-bill-id="${sharedId}"]`)).toContainText('12.34'); }
      await page.goto('/finance');

      // Review a failed edit and cancel; neither the amount nor ownership changes.
      await shared.getByRole('button', { name: c.edit, exact: true }).click(); form = page.getByRole('dialog', { name: c.editDialog, exact: true });
      await form.getByLabel(c.amount, { exact: true }).fill('-2'); await form.getByRole('button', { name: c.save, exact: true }).click();
      await expect(form.getByRole('alert')).toBeVisible(); await form.getByRole('button', { name: c.cancel, exact: true }).click();
      await expect(shared).toContainText('12.34');
      await shared.getByRole('button', { name: c.edit, exact: true }).click(); form = page.getByRole('dialog', { name: c.editDialog, exact: true });
      await form.getByLabel(c.amount, { exact: true }).fill('45.67'); await form.getByLabel(c.date, { exact: true }).fill('2026-10-26');
      await form.getByLabel(c.note, { exact: true }).fill('  Evidence kept exactly\nsecond line  ');
      await form.getByRole('button', { name: c.save, exact: true }).click(); await expect(form).toBeHidden(); await page.reload();
      await expect(shared).toContainText('45.67');
      await shared.getByRole('button', { name: c.edit, exact: true }).click(); form = page.getByRole('dialog', { name: c.editDialog, exact: true });
      await expect(form.getByLabel(c.date, { exact: true })).toHaveValue('2026-10-26');
      await selectChoice(form.getByLabel(c.asset, { exact: true }), fixture.item.id);
      await form.getByRole('checkbox', { name: fixture.project.name, exact: true }).uncheck();
      await form.getByRole('button', { name: c.save, exact: true }).click(); await expect(form).toBeHidden(); await page.reload();
      await expect(shared).toContainText(fixture.item.name); await expect(shared).not.toContainText(fixture.project.name);
      await expect(page.locator('.finance-summary > .card').nth(1)).toContainText('50.67');
      await page.goto(`/assets/project/${fixture.project.id}`); await expect(page.locator(`[data-bill-id="${sharedId}"]`)).toHaveCount(0);
      await page.goto(`/assets/item/${fixture.item.id}`); await expect(page.locator(`.asset-finance-card [data-bill-id="${sharedId}"]`)).toContainText('45.67');
      await page.goto('/finance');

      // Correct renewal accounting separately and remove its original source from financial ownership.
      const renewal = page.locator(`#finance-entry-${fixture.renewal.id}`);
      await renewal.getByRole('button', { name: c.edit, exact: true }).click(); form = page.getByRole('dialog', { name: c.editDialog, exact: true });
      await form.getByLabel(c.amount, { exact: true }).fill('7.89'); await form.getByLabel(c.date, { exact: true }).fill('2026-10-25');
      await selectChoice(form.getByLabel(c.asset, { exact: true }), fixture.project.id);
      await form.getByRole('checkbox', { name: fixture.subscription.name, exact: true }).uncheck();
      await form.getByRole('button', { name: c.save, exact: true }).click(); await expect(form).toBeHidden(); await page.reload();
      await expect(renewal).toContainText('7.89'); await expect(renewal).toContainText(fixture.project.name);
      await expect(renewal).not.toContainText(fixture.subscription.name);
      if ((zh && width === 390) || (!zh && width === 1280)) {
        await page.locator('.finance-columns').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${evidence}/T14-${portable ? 'portable' : 'source'}-${locale}-${width}.png` });
        await shared.getByRole('button', { name: c.edit, exact: true }).click();
        const reviewDialog = page.getByRole('dialog', { name: c.editDialog, exact: true });
        await reviewDialog.screenshot({ path: `${evidence}/T14-${portable ? 'portable' : 'source'}-editor-${locale}-${width}.png` });
        await reviewDialog.getByRole('button', { name: c.cancel, exact: true }).click();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      const beforeDelete = await downloadArchive(page, zh);
      const bill = beforeDelete.history.find(entry => entry.title === 'T14 Shared project equipment invoice'); if (!bill) throw Error('missing-shared-bill');
      expect(bill).toMatchObject({ assetId: fixture.item.id, assetIds: [fixture.item.id], amount: 4567, eventDate: '2026-10-26', note: '  Evidence kept exactly\nsecond line  ' });
      const correctedRenewal = beforeDelete.history.find(entry => entry.id === fixture.renewal.id);
      expect(correctedRenewal).toMatchObject(fixture.renewal);
      expect(correctedRenewal?.financeCorrection).toMatchObject({ amount: 789, eventDate: '2026-10-25', assetIds: [fixture.project.id], hidden: false });
      expect(beforeDelete.assets.find(asset => asset.id === fixture.subscription.id)).toEqual(fixture.renewed);
      await page.goto('/finance');
      await shared.getByRole('button', { name: c.remove, exact: true }).click();
      let confirmation = page.getByRole('dialog', { name: c.deleteDialog, exact: true }); await confirmation.getByRole('button', { name: c.cancel, exact: true }).click();
      await expect(shared).toHaveCount(1); await shared.getByRole('button', { name: c.remove, exact: true }).click();
      confirmation = page.getByRole('dialog', { name: c.deleteDialog, exact: true }); await confirmation.getByRole('button', { name: c.remove, exact: true }).click();
      await expect(confirmation).toBeHidden(); await expect(shared).toHaveCount(0);
      await renewal.getByRole('button', { name: c.remove, exact: true }).click(); confirmation = page.getByRole('dialog', { name: c.deleteDialog, exact: true });
      await expect(confirmation).toContainText(zh ? '不会撤销续费' : 'keeps the renewal record');
      await confirmation.getByRole('button', { name: c.remove, exact: true }).click(); await expect(confirmation).toBeHidden(); await page.reload();
      await expect(rows).toHaveCount(2); await expect(rows.filter({ hasText: 'T14 USD reference' })).toHaveCount(1);
      await expect(rows.filter({ hasText: 'T14 JPY reference' })).toHaveCount(1);
      const final = await downloadArchive(page, zh);
      expect(final.history.find(entry => entry.id === bill.id)).toEqual({ ...bill, deleted: true });
      expect(final.history.find(entry => entry.id === fixture.renewal.id)).toEqual({ ...correctedRenewal,
        financeCorrection: { ...correctedRenewal?.financeCorrection, hidden: true } });
      expect(final.history.find(entry => entry.id === fixture.dollar.id)).toEqual(fixture.dollar);
      expect(final.history.find(entry => entry.id === fixture.yen.id)).toEqual(fixture.yen);
      expect(final.assets.find(asset => asset.id === fixture.subscription.id)).toEqual(fixture.renewed);
      const finalPath = resolve(fixtureDirectory, `final-${locale}-${width}.ka1`); await final.download.saveAs(finalPath);
      const restored = await browser.newContext({ locale, acceptDownloads: true });
      await restored.addInitScript(value => localStorage.setItem('keepany-language', value), zh ? 'zh-CN' : 'en');
      try { const target = await restored.newPage(); await restoreFixture(target, zh, finalPath); await target.goto('/finance');
        await expect(target.locator('.finance-entry')).toHaveCount(2); const restoredData = await downloadArchive(target, zh);
        expect(restoredData.history.sort((a,b) => a.id.localeCompare(b.id))).toEqual(final.history.sort((a,b) => a.id.localeCompare(b.id)));
      } finally { await restored.close(); }
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test('T14 true second-tab edits and deletion reject stale review without overwriting latest bill', async ({ browser }) => {
  test.setTimeout(100_000); const c = copy(false);
  const context = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
  await context.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  try {
    const first = await context.newPage(); first.setDefaultTimeout(15_000); await restoreFixture(first, false); await first.goto('/finance');
    const second = await context.newPage(); second.setDefaultTimeout(15_000); await second.goto('/finance');
    const row1 = first.locator(`#finance-entry-${fixture.dollar.id}`), row2 = second.locator(`#finance-entry-${fixture.dollar.id}`);
    await row1.getByRole('button', { name: c.edit, exact: true }).click();
    await first.getByRole('dialog').getByLabel(c.amount, { exact: true }).fill('20.01');
    await row2.getByRole('button', { name: c.edit, exact: true }).click();
    await second.getByRole('dialog').getByLabel(c.amount, { exact: true }).fill('30.02');
    await second.getByRole('dialog').getByRole('button', { name: c.save, exact: true }).click(); await expect(second.getByRole('dialog')).toBeHidden();
    await first.getByRole('dialog').getByRole('button', { name: c.save, exact: true }).click();
    await expect(first.getByRole('dialog').getByRole('alert')).toContainText('changed in another tab');
    await expect(first.getByRole('dialog').getByLabel(c.amount, { exact: true })).toHaveValue('20.01');
    await first.getByRole('dialog').getByRole('button', { name: c.cancel, exact: true }).click();
    await expect(row1).toContainText('30.02');
    await row1.getByRole('button', { name: c.remove, exact: true }).click();
    await row2.getByRole('button', { name: c.edit, exact: true }).click(); await second.getByRole('dialog').getByLabel(c.amount, { exact: true }).fill('40.03');
    await second.getByRole('dialog').getByRole('button', { name: c.save, exact: true }).click(); await expect(second.getByRole('dialog')).toBeHidden();
    await first.getByRole('dialog').getByRole('button', { name: c.remove, exact: true }).click();
    await expect(first.getByRole('dialog').getByRole('alert')).toContainText('changed in another tab');
    await first.getByRole('dialog').getByRole('button', { name: c.cancel, exact: true }).click();
    await first.reload(); await expect(row1).toContainText('40.03'); const snapshot = await downloadArchive(first);
    expect(snapshot.history.find(entry => entry.id === fixture.dollar.id)).toMatchObject({ amount: 4003, deleted: false });
  } finally { await context.close(); }
});

test('T14 360 768 1440 keyboard cancellation and layout keep fields and actions reachable', async ({ browser }) => {
  test.setTimeout(80_000); const c = copy(false);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15_000); await restoreFixture(page, false); await page.goto('/finance');
    for (const width of [360,768,1440]) {
      await page.setViewportSize({ width, height: 900 }); const opener = page.getByRole('button', { name: c.add, exact: true });
      await opener.click(); const form = page.getByRole('dialog', { name: c.add, exact: true });
      await expect(form.getByLabel(c.title, { exact: true })).toBeVisible();
      const dialogBounds = await form.boundingBox(); if (!dialogBounds) throw Error('missing-dialog-layout');
      expect(dialogBounds.x).toBeGreaterThanOrEqual(0); expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(width + 1);
      await form.getByRole('button', { name: c.cancel, exact: true }).scrollIntoViewIfNeeded();
      await expect(form.getByRole('button', { name: c.cancel, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await form.getByLabel(c.title, { exact: true }).focus(); await page.keyboard.press('Escape'); await expect(form).toBeHidden();
      await expect(opener).toBeFocused(); await expect(page.locator('.finance-entry')).toHaveCount(3);
    }
  } finally { await context.close(); }
});
