import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { newAsset, historySchema, type Asset, type History } from '../../packages/domain/src';
import { reviewedCandidateSchema, stageReviewedCandidates } from '../../packages/local-db/src/intake-review';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import { selectChoice } from './helpers/select-choice';
import { openBackupRestorePanel } from './helpers/backup-restore';
import { prepareCompletionArchive, recordDevelopmentRequests } from './helpers/completion-archive';
const portable = process.env.KEEPANY_T14_PORTABLE === '1';
const fixtureDirectory = resolve('test-results/T14-completion-fixture');
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? 'docs/qa/2026-10-27/evidence/T14-completion';
const password = 'Synthetic-T14-only-backup';
mkdirSync(fixtureDirectory, { recursive: true }); mkdirSync(evidence, { recursive: true });
type Fixture = { project: Asset; item: Asset; account: Asset; subscription: Asset; renewed: Asset; renewal: History; dollar: History; yen: History; pdfNameId: string; pdfDescriptionId: string };
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
  await openBackupRestorePanel(page);
  await page.locator('#restore-file').setInputFiles(path); await page.getByRole('button', { name: c.preview, exact: true }).first().click();
  await page.getByRole('button', { name: c.confirm }).click(); await expect(page.getByText(c.restored)).toBeVisible();
}

async function searchBill(page: Page, query: string, id: string, visible = true) {
  await page.locator('.top-search-trigger').click(); await page.locator('#top-search-query').fill(query);
  const billLink = page.locator(`.top-search-panel .search-results a[href="/finance#finance-entry-${id}"]`);
  await expect(billLink).toHaveCount(visible ? 1 : 0);
  if (visible) { await billLink.click(); await expect(page.locator(`#finance-entry-${id}`)).toBeFocused(); }
  else await page.keyboard.press('Escape');
}

test.beforeAll(async () => {
    fixture = await prepareCompletionArchive(fixtureDirectory, password, async db => {
      const project = { ...newAsset('project'), name: 'T14 Project owner', description: 'T14 ordinary original description', contact: 'T14 public contact marker', tags: ['T14 public tag marker'], longDescription: 'T14 ordinary unselected long description' }, item = { ...newAsset('item'), name: 'T14 Equipment owner' };
      const account = { ...newAsset('account'), name: 'T14 Account owner' }, subscription: Asset = { ...newAsset('subscription'), name: 'T14 Subscription source',
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
      const pdfs = ['a','b'].map((char,index) => reviewedCandidateSchema.parse({ id: `pdf-${char.repeat(64)}`, fileHash: char.repeat(64),
        fileName: `T14-${index ? 'description' : 'name'}-review.pdf`, rowNumber: 1, source: 'pdf', sourceText: 'T14 synthetic raw PDF source marker', kindSelected: true,
        status: 'pending', asset: { ...newAsset('project'), id: `pdf-${char.repeat(48)}`, name: index ? 'T14 description-only proposal' : 'T14 renamed project',
          description: 'T14 merged PDF description marker' } }));
      for (const row of pdfs) await stageReviewedCandidates(db.fileStore, [row]);
      return { project,item,account,subscription,renewed,renewal,dollar,yen,pdfNameId: pdfs[0].id,pdfDescriptionId: pdfs[1].id };
    });
});

for (const locale of ['zh-CN','en-US'] as const) for (const width of [390,1280]) {
  test(`${locale} ${width} T14-01..04 shared bill editing deletion renewal preservation and backup`, async ({ browser }) => {
    test.setTimeout(150_000);
    const zh = locale === 'zh-CN', c = copy(zh), errors: string[] = [];
    const context = await browser.newContext({ locale, timezoneId: 'Asia/Shanghai', viewport: { width, height: 900 }, acceptDownloads: true });
    const sourceRequests = recordDevelopmentRequests(context);
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
      for (const owner of [fixture.project,fixture.item]) await searchBill(page, owner.name, sharedId);

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
      await searchBill(page, '7.89', fixture.renewal.id);
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
      await searchBill(page, 'T14 Shared project equipment invoice', sharedId, false);
      await searchBill(page, '7.89', fixture.renewal.id, false);
      const final = await downloadArchive(page, zh);
      expect(final.history.find(entry => entry.id === bill.id)).toEqual({ ...bill, deleted: true });
      expect(final.history.find(entry => entry.id === fixture.renewal.id)).toEqual({ ...correctedRenewal,
        financeCorrection: { ...correctedRenewal?.financeCorrection, hidden: true } });
      expect(final.history.find(entry => entry.id === fixture.dollar.id)).toEqual(fixture.dollar);
      expect(final.history.find(entry => entry.id === fixture.yen.id)).toEqual(fixture.yen);
      expect(final.assets.find(asset => asset.id === fixture.subscription.id)).toEqual(fixture.renewed);
      const finalPath = resolve(fixtureDirectory, `final-${locale}-${width}.ka1`); await final.download.saveAs(finalPath);
      const restored = await browser.newContext({ locale, acceptDownloads: true });
      const restoredSourceRequests = recordDevelopmentRequests(restored);
      await restored.addInitScript(value => localStorage.setItem('keepany-language', value), zh ? 'zh-CN' : 'en');
      try { const target = await restored.newPage(); await restoreFixture(target, zh, finalPath); await target.goto('/finance');
        await expect(target.locator('.finance-entry')).toHaveCount(2); const restoredData = await downloadArchive(target, zh);
        expect(restoredData.history.sort((a,b) => a.id.localeCompare(b.id))).toEqual(final.history.sort((a,b) => a.id.localeCompare(b.id)));
        if (portable) expect(restoredSourceRequests).toEqual([]);
      } finally { await restored.close(); }
      if (portable) expect(sourceRequests).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test('T14 true second-tab edits and deletion reject stale review without overwriting latest bill', async ({ browser }) => {
  test.setTimeout(100_000); const c = copy(false);
  const context = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
  const sourceRequests = recordDevelopmentRequests(context);
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
    if (portable) expect(sourceRequests).toEqual([]);
  } finally { await context.close(); }
});

test('T14 360 768 1440 keyboard cancellation and layout keep fields and actions reachable', async ({ browser }) => {
  test.setTimeout(80_000); const c = copy(false);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
  const sourceRequests = recordDevelopmentRequests(context);
  await context.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15_000); await restoreFixture(page, false); await page.goto('/finance');
    for (const width of [360,768,1440]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 360) {
        const row = page.locator('.finance-entry').first(); await row.scrollIntoViewIfNeeded();
        const content = await row.locator('.finance-entry-content').boundingBox(), actions = await row.locator('.finance-entry-actions').boundingBox();
        if (!content || !actions) throw Error('missing-finance-row-layout');
        expect(actions.y).toBeGreaterThanOrEqual(content.y + content.height);
      }
      const opener = page.getByRole('button', { name: c.add, exact: true });
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
    if (portable) expect(sourceRequests).toEqual([]);
  } finally { await context.close(); }
});

for (const zh of [true,false]) test(`${zh ? 'zh' : 'en'} legacy PDF candidate merge preserves search privacy, ordinary unselected fields and clean restore`, async ({ browser }) => {
  test.setTimeout(100_000);
  const context = await browser.newContext({ locale: zh ? 'zh-CN' : 'en-US', acceptDownloads: true, viewport: { width: zh ? 390 : 1280, height: 900 } });
  const sourceRequests = recordDevelopmentRequests(context);
  await context.addInitScript(language => localStorage.setItem('keepany-language', language), zh ? 'zh-CN' : 'en');
  const page = await context.newPage(); page.setDefaultTimeout(15_000); const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  async function assertSearch(target: Page, value: string, visible: boolean) {
    await target.locator('.top-search-trigger').click(); await target.locator('#top-search-query').fill(value);
    await expect(target.locator(`.top-search-panel .search-results a[href="/assets/project/${fixture.project.id}"]`)).toHaveCount(visible ? 1 : 0);
    await target.keyboard.press('Escape');
  }
  try {
    await restoreFixture(page, zh);
    for (const [id,field] of [[fixture.pdfNameId,'name'],[fixture.pdfDescriptionId,'description']]) {
      await page.goto('/intake'); const row = page.locator(`#intake-review-${id}`);
      await row.getByRole('button', { name: zh ? '合并到已有资料' : 'Merge into existing record', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: zh ? '逐字段核对合并' : 'Review fields to merge', exact: true });
      await selectChoice(dialog.locator('#candidate-merge-target'), fixture.project.id);
      await dialog.getByRole('checkbox', { name: zh ? `使用候选值：${field === 'name' ? '名称' : '简短描述'}` : `Use candidate value: ${field === 'name' ? 'Name' : 'Short description'}`, exact: true }).check();
      await dialog.getByRole('button', { name: zh ? '确认合并' : 'Confirm merge', exact: true }).click(); await expect(dialog).toBeHidden();
      // B2 retired project promotion fields from current UI/search; their old values remain in KA1.
      await page.reload(); await assertSearch(page, 'T14 ordinary unselected long description', false);
      await assertSearch(page, 'T14 ordinary original description', field === 'name');
      await assertSearch(page, 'T14 public contact marker', true);
      await assertSearch(page, 'T14 public tag marker', true);
      await assertSearch(page, 'T14 merged PDF description marker', false);
      await assertSearch(page, 'T14 synthetic raw PDF source marker', false);
    }
    const snapshot = await downloadArchive(page, zh);
    expect(snapshot.assets.find(asset => asset.id === fixture.project.id)).toMatchObject({ name: 'T14 renamed project',
      description: 'T14 merged PDF description marker', contact: 'T14 public contact marker', tags: ['T14 public tag marker'], longDescription: 'T14 ordinary unselected long description' });
    const path = resolve(fixtureDirectory, `pdf-privacy-${zh ? 'zh' : 'en'}.ka1`); await snapshot.download.saveAs(path);
    const restored = await browser.newContext({ locale: zh ? 'zh-CN' : 'en-US' });
    const restoredSourceRequests = recordDevelopmentRequests(restored);
    await restored.addInitScript(language => localStorage.setItem('keepany-language', language), zh ? 'zh-CN' : 'en');
    try { const target = await restored.newPage(); await restoreFixture(target, zh, path);
      await assertSearch(target, 'T14 merged PDF description marker', false);
      await assertSearch(target, 'T14 ordinary unselected long description', false);
      await assertSearch(target, 'T14 public contact marker', true);
      await assertSearch(target, 'T14 public tag marker', true);
      const roundTrip = await downloadArchive(target, zh);
      expect(roundTrip.assets.find(asset => asset.id === fixture.project.id)).toEqual(snapshot.assets.find(asset => asset.id === fixture.project.id));
      if (portable) expect(restoredSourceRequests).toEqual([]);
    } finally { await restored.close(); }
    if (portable) expect(sourceRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
