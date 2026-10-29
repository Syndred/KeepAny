import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import { newAsset, type Asset } from '../../packages/domain/src';
import { sourceModuleUrl } from './helpers/source-module-url';
import { selectChoice } from './helpers/select-choice';
import { openBackupRestorePanel } from './helpers/backup-restore';
import { prepareCompletionArchive, recordDevelopmentRequests } from './helpers/completion-archive';

const repositoryPath = sourceModuleUrl('packages/local-db/src/index.ts');
const portable = process.env.KEEPANY_T19_PORTABLE === '1';
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? 'docs/qa/2026-10-27/evidence/T19-completion';
const password = 'Synthetic-T19-merge-only';
const fixtureDirectory = resolve('test-results/T19-merge-fixture');
mkdirSync(fixtureDirectory, { recursive: true });
mkdirSync(evidence, { recursive: true });
let fixtureTarget: Asset;
const csv = '\ufeffname,kind,url,description\r\nT19 Existing,project,https://incoming.example.test/,Reviewed description\r\n';
async function downloadArchive(page: Page, zh: boolean) {
  await page.goto('/intake');
  await page.locator('#backup-password').fill(password);
  await page.getByRole('button', { name: zh ? '创建备份' : 'Create backup', exact: true }).click();
  const link = page.getByRole('link', { name: zh ? '保存备份文件' : 'Save backup file', exact: true });
  await expect(link).toBeVisible();
  const pending = page.waitForEvent('download'); await link.click(); const download = await pending;
  const path = await download.path(); if (!path) throw Error('missing-merge-backup-download');
  const files = unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)), password));
  const records = JSON.parse(strFromU8(files['records.json'])) as Array<{ type: string; payload: string }>;
  return { assets: records.filter(row => row.type === 'asset').map(row => JSON.parse(row.payload)),
    candidates: JSON.parse(strFromU8(files['intake-review.json'])), download };
}
async function restoreArchive(page: Page, zh: boolean, path: string) {
  await page.goto('/intake'); await page.locator('#backup-password').fill(password);
  await openBackupRestorePanel(page);
  await page.locator('#restore-file').setInputFiles(path);
  await page.getByRole('button', { name: zh ? '预览' : 'Preview', exact: true }).first().click();
  await page.getByRole('button', { name: zh ? /^确认 ·/ : /^Confirm ·/ }).click();
  await expect(page.getByText(zh ? /已恢复 \d+ 条记录/ : /Restored \d+ records/)).toBeVisible();
}
async function state(page: Page, zh = false) {
  if (portable) return { ...(await downloadArchive(page, zh)), journals: undefined };
  return page.evaluate(async path => {
    const repository = await (await import(path)).localRepository();
    return { assets: await repository.list('asset', true), candidates: await repository.fileStore.intakeReview.toArray(), journals: await repository.fileStore.importJournal.toArray() };
  }, repositoryPath);
}
async function prepare(page: Page, zh: boolean) {
  const target = fixtureTarget;
  await restoreArchive(page, zh, resolve(fixtureDirectory, 'fixture.ka1'));
  await page.goto('/intake');
  await page.locator('.intake-mode-tabs').getByRole('button', { name: zh ? '表格' : 'Spreadsheet', exact: true }).click();
  await page.locator('#csv-file').setInputFiles({ name: 'T19-field-review.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const row = page.locator('.intake-review-row');
  await expect(row).toHaveCount(1);
  return { target, row };
}
test.beforeAll(async () => {
    fixtureTarget = await prepareCompletionArchive(fixtureDirectory, password, async repository => {
    const value = { ...newAsset('project'), name: 'T19 Existing', url: 'https://original.example.test/', description: 'Original description', notes: 'Private synthetic note to keep', tags: ['keep'], category: 'existing category' };
    await repository.save('asset', value); return value;
    });
});
for (const zh of [true, false]) for (const width of [390, 1280]) {
  test(`${zh ? 'zh' : 'en'} ${width} T19-01 explicit selected-field merge, cancel and refresh`, async ({ browser }) => {
    const context = await browser.newContext({ locale: zh ? 'zh-CN' : 'en-US', viewport: { width, height: 900 } });
    const sourceRequests = recordDevelopmentRequests(context);
    await context.addInitScript(language => localStorage.setItem('keepany-language', language), zh ? 'zh-CN' : 'en');
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const c = { merge: zh ? '合并到已有资料' : 'Merge into existing record', title: zh ? '逐字段核对合并' : 'Review fields to merge',
      confirm: zh ? '确认合并' : 'Confirm merge', cancel: zh ? '取消' : 'Cancel', description: zh ? '使用候选值：简短描述' : 'Use candidate value: Short description' };
    try {
      const { target, row } = await prepare(page, zh);
      await page.getByText(zh ? '查看原始全文' : 'View original source', { exact: true }).click();
      expect(await page.locator('.intake-review-original pre').textContent()).toBe(csv);
      expect((await state(page, zh)).assets).toEqual([target]);
      await row.getByRole('button', { name: c.merge, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: c.title, exact: true });
      await selectChoice(dialog.locator('#candidate-merge-target'), target.id);
      await expect(dialog.locator('input[type=checkbox]:checked')).toHaveCount(0);
      await dialog.getByRole('button', { name: c.confirm, exact: true }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await dialog.getByRole('checkbox', { name: c.description, exact: true }).check();
      await dialog.getByRole('button', { name: c.cancel, exact: true }).click();
      await expect(row.getByRole('button', { name: c.merge, exact: true })).toBeFocused();
      const cancelled = await state(page, zh);
      expect(cancelled.assets).toEqual([target]);
      expect(cancelled.candidates[0].status).toBe('pending');
      await row.getByRole('button', { name: c.merge, exact: true }).click();
      await selectChoice(dialog.locator('#candidate-merge-target'), target.id);
      await dialog.getByRole('checkbox', { name: c.description, exact: true }).check();
      if ((zh && width === 390) || (!zh && width === 1280)) await dialog.screenshot({ path: `${evidence}/fields-${portable ? 'portable' : 'source'}-${zh ? 'zh' : 'en'}-${width}.png` });
      await dialog.getByRole('button', { name: c.confirm, exact: true }).dblclick();
      await expect(dialog).toBeHidden();
      await expect(row).toContainText(zh ? '已确认' : 'Confirmed');
      await page.reload();
      const actual = await state(page, zh);
      expect(actual.assets).toHaveLength(1);
      expect(actual.assets[0]).toEqual({ ...target, description: 'Reviewed description', updatedAt: actual.assets[0].updatedAt });
      expect(actual.candidates[0]).toMatchObject({ status: 'accepted', sourceText: csv,
        merge: { targetId: target.id, fields: ['description'], before: target, after: actual.assets[0] } });
      if (!portable) expect(actual.journals).toEqual([]);
      await row.getByText(zh ? '合并记录' : 'Merge record', { exact: true }).click();
      await expect(row.locator('.candidate-merge-receipt')).toContainText('Original description');
      await expect(row.locator('.candidate-merge-receipt')).toContainText('Reviewed description');
      const link = row.locator(`a[href="/assets/project/${target.id}"]`);
      await expect(link).toHaveCount(1);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/assets/project/${target.id}$`));
      const backup = await downloadArchive(page, zh);
      const finalPath = resolve(`test-results/T19-merge-final-${portable ? 'portable' : 'source'}-${zh ? 'zh' : 'en'}-${width}.ka1`);
      await backup.download.saveAs(finalPath);
      const restored = await browser.newContext({ locale: zh ? 'zh-CN' : 'en-US', acceptDownloads: true });
      const restoredSourceRequests = recordDevelopmentRequests(restored);
      await restored.addInitScript(language => localStorage.setItem('keepany-language', language), zh ? 'zh-CN' : 'en');
      try {
        const destination = await restored.newPage();
        await restoreArchive(destination, zh, finalPath); await destination.reload();
        const roundTrip = await downloadArchive(destination, zh);
        expect(roundTrip.assets).toEqual(backup.assets);
        expect(roundTrip.candidates).toEqual(backup.candidates);
        await expect(destination.locator('.intake-review-row').getByText(zh ? '合并记录' : 'Merge record', { exact: true })).toBeVisible();
        if (portable) expect(restoredSourceRequests).toEqual([]);
      } finally { await restored.close(); }
      if (portable) expect(sourceRequests).toEqual([]);
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

if (!portable) test('T19-01 keeps a newer target edit and retries a real failed storage write without duplicates', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const { target, row } = await prepare(page, false);
    const open = async () => {
      await row.getByRole('button', { name: 'Merge into existing record', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Review fields to merge', exact: true });
      await selectChoice(dialog.locator('#candidate-merge-target'), target.id);
      await dialog.getByRole('checkbox', { name: 'Use candidate value: Short description', exact: true }).check();
      return dialog;
    };
    let dialog = await open();
    await page.evaluate(async ([rp, id]) => {
      const repository = await (await import(rp)).localRepository();
      const value = await repository.get('asset', id);
      await repository.save('asset', { ...value, description: 'A later target edit', updatedAt: new Date().toISOString() });
    }, [repositoryPath, target.id]);
    await dialog.getByRole('button', { name: 'Confirm merge', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('changed');
    let actual = await state(page);
    expect(actual.assets[0].description).toBe('A later target edit');
    expect(actual.candidates[0].status).toBe('pending');
    expect(actual.journals).toEqual([]);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    dialog = await open();
    await page.evaluate(async rp => {
      const repository = await (await import(rp)).localRepository(), storage = repository.db.records.storageInstance;
      const original = storage.bulkWrite.bind(storage);
      let fail = true;
      storage.bulkWrite = async (rows: unknown[], context: string) => {
        if (context === 'intake-asset-merge' && fail) { fail = false; throw Error('synthetic-write-failure'); }
        return original(rows, context);
      };
    }, repositoryPath);
    await dialog.getByRole('button', { name: 'Confirm merge', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('did not finish');
    actual = await state(page);
    expect(actual.assets[0].description).toBe('A later target edit');
    expect(actual.journals).toHaveLength(1);
    await dialog.getByRole('button', { name: 'Confirm merge', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    actual = await state(page);
    expect(actual.assets).toHaveLength(1);
    expect(actual.assets[0].description).toBe('Reviewed description');
    expect(actual.candidates[0].merge.before.description).toBe('A later target edit');
    expect(actual.candidates[0].merge.fields).toEqual(['description']);
    expect(actual.journals).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
