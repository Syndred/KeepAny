import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import { sourceModuleUrl } from './helpers/source-module-url';
import { selectChoice } from './helpers/select-choice';

const repositoryPath = sourceModuleUrl('packages/local-db/src/index.ts');
const domainPath = sourceModuleUrl('packages/domain/src/index.ts');
const evidence = process.env.KEEPANY_MOBILE_SERVICES_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
test.use({ viewport: { width: 390, height: 844 }, actionTimeout: 15_000 });
test.beforeEach(async ({ page }, info) => { await page.addInitScript(value => localStorage.setItem('keepany-language', value), info.title.startsWith('zh-CN') ? 'zh-CN' : 'en'); });

async function records(page: Page, type = 'asset') {
  return page.evaluate(async ({ path, type }) => (await (await import(path)).localRepository()).list(type, true), { path: repositoryPath, type });
}
async function capture(page: Page, name: string) {
  await page.screenshot({ path: evidence ? join(evidence, `${name}.png`) : test.info().outputPath(`${name}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
const backupPassword = 'Synthetic-mobile-services-backup';
async function downloadArchive(page: Page, zh: boolean) {
  await page.goto('/intake'); await page.locator('#backup-password').fill(backupPassword);
  await page.getByRole('button', { name: zh ? '创建备份' : 'Create backup', exact: true }).click();
  const link = page.getByRole('link', { name: zh ? '保存备份文件' : 'Save backup file', exact: true });
  await expect(link).toBeVisible();
  const pending = page.waitForEvent('download'); await link.click(); const download = await pending;
  const path = await download.path(); if (!path) throw Error('backup-download-missing');
  const bytes = new Uint8Array(readFileSync(path));
  expect(Buffer.from(bytes.subarray(0, 8)).toString()).toBe('KEEPANY1');
  const files = unzipSync(await decryptBackup(bytes, backupPassword));
  return { path, files };
}
async function restoreArchive(browser: Browser, zh: boolean, path: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(value => localStorage.setItem('keepany-language', value), zh ? 'zh-CN' : 'en');
  const page = await context.newPage();
  await page.goto('/intake'); await page.locator('#backup-password').fill(backupPassword);
  await page.locator('#restore-file').setInputFiles(path);
  await page.getByRole('button', { name: zh ? '预览' : 'Preview', exact: true }).first().click();
  await page.getByRole('button', { name: zh ? /^确认 ·/ : /^Confirm ·/ }).click();
  await expect(page.getByText(zh ? /已恢复 \d+ 条记录/ : /Restored \d+ records/)).toBeVisible();
  return { context, page };
}

for (const zh of [true, false]) {
  const language = zh ? 'zh-CN' : 'en';
  const c = { save: zh ? '保存' : 'Save', name: zh ? '名称' : 'Name', confirm: zh ? '确认入库' : 'Confirm and save', spreadsheet: zh ? '表格' : 'Spreadsheet', cancel: zh ? '取消' : 'Cancel', create: zh ? '新建分类' : 'New collection', edit: zh ? '编辑分类' : 'Edit collection', collectionName: zh ? '分类名称' : 'Collection name', collectionSave: zh ? '保存分类' : 'Save collection', remove: zh ? '删除分类' : 'Delete collection' };

  test(`${language} F14-01 local multiline text keeps exact source and unselected drafts at 390`, async ({ page, browser }) => {
    await page.goto('/intake');
    const quick = page.locator('.intake-quick-card');
    await quick.getByRole('button', { name: zh ? '文字' : 'Text', exact: true }).click();
    const source = 'First ordinary record\r\n\r\nSecond ordinary record\n第三项资料';
    await quick.getByLabel(zh ? '原始文字' : 'Original text', { exact: true }).fill(source);
    await quick.getByRole('button', { name: zh ? '预览资料' : 'Preview records', exact: true }).click();
    const rows = page.locator('.intake-review-row'); await expect(rows).toHaveCount(3);
    expect(await records(page)).toHaveLength(0);
    await rows.first().getByLabel(c.name, { exact: true }).fill('Reviewed text record');
    await rows.first().locator('.intake-review-select input').check();
    await page.getByRole('button', { name: zh ? '确认所选（1）' : 'Confirm selected (1)', exact: true }).click();
    await expect(rows.first()).toContainText(zh ? '已确认' : 'Confirmed');
    expect(await records(page)).toHaveLength(1);
    await page.reload(); await expect(rows).toHaveCount(3);
    await expect(rows.nth(1).getByLabel(c.name, { exact: true })).toHaveValue('Second ordinary record');
    await expect(rows.nth(2).getByLabel(c.name, { exact: true })).toHaveValue('第三项资料');
    const staged = await page.evaluate(async path => (await (await import(path)).listReviewedCandidates()), '/src/intake-review-store.ts');
    expect(staged.map((row: { status: string }) => row.status)).toEqual(['accepted', 'pending', 'pending']);
    expect(staged.every((row: { sourceText: string }) => row.sourceText === source.replaceAll('\r\n', '\n'))).toBe(true);
    await capture(page, `${language}-F14-01-text-persistent-drafts`);
    const archive = await downloadArchive(page, zh);
    expect(JSON.parse(strFromU8(archive.files['intake-review.json']))).toEqual(staged);
    const restored = await restoreArchive(browser, zh, archive.path);
    try {
      const readback = await restored.page.evaluate(async path => (await (await import(path)).listReviewedCandidates()), '/src/intake-review-store.ts');
      expect(readback).toEqual(staged);
      await restored.page.locator('.intake-review-row').nth(1).getByRole('button', { name: c.confirm, exact: true }).click();
      await expect.poll(async () => (await records(restored.page)).length).toBe(2);
      await capture(restored.page, `${language}-F14-text-ka1-continued`);
    } finally { await restored.context.close(); }
  });

  test(`${language} F19-04 deletion preserves a restorable collection identity at 390`, async ({ page, browser }) => {
    await page.goto('/collections');
    await page.getByRole('button', { name: c.create, exact: true }).first().click();
    const editor = page.locator('.collections-editor');
    await editor.getByLabel(c.collectionName).fill('Restore original');
    await editor.getByRole('button', { name: c.collectionSave, exact: true }).click();
    await expect(page).toHaveURL(/\/collections\/[0-9a-f-]+$/);
    const collectionId = page.url().split('/').at(-1);
    await page.getByRole('button', { name: c.edit, exact: true }).click();
    await editor.getByRole('button', { name: c.remove, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: c.remove, exact: true });
    await dialog.getByRole('button', { name: c.cancel, exact: true }).click();
    expect((await records(page, 'preference')).find((row: { id: string }) => row.id === 'assetCollectionsV1')?.value).toEqual([{ id: collectionId, name: 'Restore original', assetIds: [] }]);
    await editor.getByRole('button', { name: c.remove, exact: true }).click();
    await dialog.getByRole('button', { name: c.remove, exact: true }).click();
    await expect(page).toHaveURL(/\/collections$/);
    await capture(page, `${language}-F19-04-deleted-before-restore`);
    const archive = await downloadArchive(page, zh);
    const saved = JSON.parse(strFromU8(archive.files['records.json'])) as Array<{ type: string; payload: string }>;
    expect(saved.filter(row => row.type === 'preference').map(row => JSON.parse(row.payload)).find(row => row.id === 'assetCollectionsV1').value[0]).toMatchObject({ id: collectionId, name: 'Restore original', assetIds: [], deleted: true });
    const restored = await restoreArchive(browser, zh, archive.path);
    try {
      await restored.page.goto('/collections');
      await restored.page.getByRole('button', { name: `${zh ? '恢复' : 'Restore'} · Restore original`, exact: true }).click();
      await expect(restored.page).toHaveURL(new RegExp(`/collections/${collectionId}$`));
      await expect(restored.page.getByRole('heading', { name: 'Restore original', exact: true })).toBeVisible();
    } finally { await restored.context.close(); }
    await page.goto('/collections');
    await page.getByRole('button', { name: `${zh ? '恢复' : 'Restore'} · Restore original`, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Restore original', exact: true })).toBeVisible();
    expect(page.url()).toMatch(new RegExp(`/collections/${collectionId}$`));
    expect((await records(page, 'preference')).find((row: { id: string }) => row.id === 'assetCollectionsV1')?.value).toEqual([{ id: collectionId, name: 'Restore original', assetIds: [] }]);
    await capture(page, `${language}-F19-04-restored-original`);
  });

  test(`${language} F19-04 restore keeps tombstones on capacity, duplicate, CAS and write failures at 390`, async ({ page }) => {
    await page.goto('/collections');
    const original = { id: 'recoverable-collection', name: 'Recoverable', assetIds: ['missing-retained-member'], deleted: true, deletedAt: '2026-10-27T00:00:00Z' };
    const active = Array.from({ length: 8 }, (_, index) => ({ id: `slot-${index}`, name: `Slot ${index}`, assetIds: [] }));
    await page.evaluate(async ({ rp, value }) => (await (await import(rp)).localRepository()).save('preference', { id: 'assetCollectionsV1', value }), { rp: repositoryPath, value: [...active, original] });
    await page.reload();
    const restore = page.getByRole('button', { name: `${zh ? '恢复' : 'Restore'} · Recoverable`, exact: true });
    await restore.click(); await expect(page.getByRole('alert')).toBeVisible();
    expect((await records(page, 'preference')).find((row: { id: string }) => row.id === 'assetCollectionsV1').value).toEqual([...active, original]);
    await page.evaluate(async ({ rp, original }) => (await (await import(rp)).localRepository()).save('preference', { id: 'assetCollectionsV1', value: [{ id: 'other', name: 'Recoverable', assetIds: [] }, original] }), { rp: repositoryPath, original });
    await restore.click(); await expect(page.getByRole('alert')).toContainText(zh ? '同名' : 'name already exists');
    await page.evaluate(async ({ rp, original }) => {
      const repository = await (await import(rp)).localRepository();
      await repository.save('preference', { id: 'assetCollectionsV1', value: [original] });
      const modify = repository.records.modify.bind(repository.records);
      repository.records.modify = async (id: string, modifier: (row: { payload: string }) => unknown) => {
        repository.records.modify = modify;
        await modify(id, (row: { payload: string }) => ({ ...row, payload: JSON.stringify({ id: 'assetCollectionsV1', value: [original, { id: 'concurrent', name: 'Concurrent', assetIds: [] }] }) }));
        return modify(id, modifier);
      };
    }, { rp: repositoryPath, original });
    await restore.click(); await expect(page.getByRole('alert')).toBeVisible();
    expect((await records(page, 'preference')).find((row: { id: string }) => row.id === 'assetCollectionsV1').value).toEqual([original, { id: 'concurrent', name: 'Concurrent', assetIds: [] }]);
    await page.evaluate(async ({ rp, original }) => {
      const repository = await (await import(rp)).localRepository();
      await repository.save('preference', { id: 'assetCollectionsV1', value: [original] });
      const modify = repository.records.modify.bind(repository.records);
      repository.records.modify = async () => { repository.records.modify = modify; throw Error('synthetic-preference-write-failure'); };
    }, { rp: repositoryPath, original });
    await restore.click(); await expect(page.getByRole('alert')).toBeVisible();
    expect((await records(page, 'preference')).find((row: { id: string }) => row.id === 'assetCollectionsV1').value).toEqual([original]);
    await restore.click(); await expect(page).toHaveURL(/\/collections\/recoverable-collection$/);
    expect((await records(page, 'preference')).find((row: { id: string }) => row.id === 'assetCollectionsV1').value).toEqual([{ id: original.id, name: original.name, assetIds: original.assetIds }]);
  });

  test(`${language} F14-02 URL transport fixture remains inert, cancel-safe and editable at 390`, async ({ page }) => {
    let unsafeRequests = 0, requests = 0, fail = false;
    await page.route('**/must-not-load-acceptance*', route => { unsafeRequests++; return route.abort(); });
    await page.route('**/__keepany_intake__/url-metadata', route => {
      requests++;
      expect(route.request().postDataJSON()).toEqual({ url: 'https://metadata.synthetic.test/start' });
      return route.fulfill({ status: fail ? 422 : 200, contentType: 'application/json', body: JSON.stringify(fail ? { error: 'metadata-private' } : {
        url: 'https://metadata.synthetic.test/final', html: '<title>Controlled &amp; reviewed</title><meta name="description" content="Original controlled description"><script>window.acceptanceUnsafe=true</script><img src="/must-not-load-acceptance-image"><iframe src="/must-not-load-acceptance-frame"></iframe>',
      }) });
    });
    await page.goto('/intake');
    const quick = page.locator('.intake-quick-card'), preview = quick.locator('.import-preview');
    const previewButton = quick.getByRole('button', { name: zh ? '预览资料' : 'Preview records', exact: true });
    await quick.locator('#import-url').fill('https://metadata.synthetic.test/start#excluded-fragment');
    await previewButton.click();
    await expect(preview.locator('input:not([type=checkbox])')).toHaveValue('Controlled & reviewed');
    await expect(preview.locator('textarea')).toHaveValue('Original controlled description');
    expect(await records(page)).toHaveLength(0);
    expect(await page.evaluate(() => 'acceptanceUnsafe' in window)).toBe(false);
    expect(unsafeRequests).toBe(0);
    await capture(page, `${language}-F14-02-url-review`);
    await quick.getByRole('button', { name: zh ? '手动' : 'Manual', exact: true }).click();
    await expect(preview).toHaveCount(0); expect(await records(page)).toHaveLength(0);
    await quick.locator('.intake-mode-tabs button').first().click();
    await previewButton.click();
    await preview.locator('input:not([type=checkbox])').fill('Explicitly reviewed title');
    await preview.locator('textarea').fill('Explicitly reviewed description');
    await preview.getByRole('button', { name: zh ? '确认导入' : 'Confirm import', exact: true }).click();
    await expect.poll(async () => (await records(page)).length).toBe(1);
    expect((await records(page))[0]).toMatchObject({ name: 'Explicitly reviewed title', description: 'Explicitly reviewed description', url: 'https://metadata.synthetic.test/start#excluded-fragment' });
    fail = true;
    await quick.locator('#import-url').fill('https://metadata.synthetic.test/start');
    await previewButton.click();
    await expect(page.locator('.notice[role=status]')).toContainText(zh ? '未能读取网页内容' : 'The page could not be read');
    expect(await records(page)).toHaveLength(1); expect(requests).toBe(3);
    await capture(page, `${language}-F14-02-url-failure`);
  });

  test(`${language} F14-03 exact CSV source, duplicate rejection and pending continuation at 390`, async ({ page }) => {
    const original = '\ufeffname,kind,url,description\r\nAlpha,project,https://alpha.example.test/,"first\r\nsecond"\r\nAlpha,project,https://alpha.example.test/,duplicate\r\nPending,item,,retain draft\r\n';
    await page.goto('/intake');
    await page.locator('.intake-mode-tabs').getByRole('button', { name: c.spreadsheet, exact: true }).click();
    await page.locator('#csv-file').setInputFiles({ name: 'mobile-exact-source.csv', mimeType: 'text/csv', buffer: Buffer.from(original) });
    const rows = page.locator('.intake-review-row'); await expect(rows).toHaveCount(3);
    await page.getByText(zh ? '查看原始全文' : 'View original source', { exact: true }).click();
    expect(await page.locator('.intake-review-original pre').textContent()).toBe(original);
    expect(await records(page)).toHaveLength(0);
    await rows.nth(0).getByLabel(zh ? '简短描述' : 'Short description', { exact: true }).fill('Reviewed first description');
    await rows.nth(0).getByRole('button', { name: c.confirm, exact: true }).click();
    await expect(rows.nth(0)).toContainText(zh ? '已确认' : 'Confirmed');
    await rows.nth(1).getByRole('button', { name: c.confirm, exact: true }).click();
    await expect(rows.nth(1).getByRole('alert')).toContainText(zh ? '重复' : 'Duplicate');
    await rows.nth(2).getByLabel(c.name, { exact: true }).fill('Pending edited draft');
    await expect.poll(async () => page.evaluate(async path => (await (await import(path)).listReviewedCandidates()).at(2)?.asset.name, '/src/intake-review-store.ts')).toBe('Pending edited draft');
    const accepted = (await records(page))[0];
    await page.reload(); await expect(rows).toHaveCount(3);
    await expect(rows.nth(2).getByLabel(c.name, { exact: true })).toHaveValue('Pending edited draft');
    expect(await records(page)).toEqual([accepted]);
    await page.getByText(zh ? '查看原始全文' : 'View original source', { exact: true }).click();
    expect(await page.locator('.intake-review-original pre').textContent()).toBe(original);
    await capture(page, `${language}-F14-03-csv-persistent-review`);
  });

  test(`${language} F19-01-03 collection cross-type edit cancel, empty state and member identity at 390`, async ({ page }) => {
    await page.goto('/collections');
    const ids = await page.evaluate(async ({ rp, dp }) => {
      const repository = await (await import(rp)).localRepository(), { newAsset } = await import(dp);
      const assets = ['project', 'account', 'subscription', 'item', 'vault'].map(kind => ({ ...newAsset(kind), name: `Member ${kind}` }));
      for (const asset of assets) await repository.save('asset', asset);
      return assets.map(asset => asset.id);
    }, { rp: repositoryPath, dp: domainPath });
    await page.getByRole('button', { name: c.create, exact: true }).first().click();
    const editor = page.locator('.collections-editor'); await editor.getByLabel(c.collectionName).fill('Mobile collection');
    for (const kind of ['project', 'account', 'subscription', 'item', 'vault']) await editor.getByRole('checkbox', { name: `Member ${kind}`, exact: true }).check();
    await editor.getByRole('button', { name: c.collectionSave, exact: true }).click();
    await expect(page.locator('.collections-member-card')).toHaveCount(5);
    const url = page.url(), collectionId = url.split('/').at(-1);
    await page.reload(); await expect(page.locator('.collections-member-card')).toHaveCount(5);
    const preference = (await records(page, 'preference')).find((row: { id: string }) => row.id === 'assetCollectionsV1');
    expect(preference.value).toEqual([{ id: collectionId, name: 'Mobile collection', assetIds: ids }]);
    await page.getByRole('button', { name: c.edit, exact: true }).click();
    await editor.getByLabel(c.collectionName).fill('Cancelled name'); await editor.getByRole('checkbox', { name: 'Member project', exact: true }).uncheck();
    await editor.getByRole('button', { name: c.cancel, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Mobile collection', exact: true })).toBeVisible();
    await expect(page.locator('.collections-member-card')).toHaveCount(5);
    await page.getByRole('button', { name: c.edit, exact: true }).click();
    await editor.getByLabel(c.collectionName).fill('Updated collection'); await editor.getByRole('checkbox', { name: 'Member subscription', exact: true }).uncheck();
    await editor.getByRole('button', { name: c.collectionSave, exact: true }).click();
    await expect(page.locator('.collections-member-card')).toHaveCount(4);
    await page.locator('.collections-member-card').filter({ hasText: 'Member project' }).click();
    await expect(page).toHaveURL(new RegExp(`/assets/project/${ids[0]}$`));
    await page.goBack(); await expect(page.getByRole('heading', { name: 'Updated collection', exact: true })).toBeVisible();
    await page.evaluate(async ({ rp, id }) => { const repository = await (await import(rp)).localRepository(); const asset = await repository.get('asset', id); await repository.save('asset', { ...asset, deleted: true }); }, { rp: repositoryPath, id: ids[0] });
    await expect(page.locator('.collections-member-card')).toHaveCount(3);
    await page.evaluate(async ({ rp, id }) => (await (await import(rp)).localRepository()).restoreEntity('asset', id), { rp: repositoryPath, id: ids[0] });
    await expect(page.locator('.collections-member-card')).toHaveCount(4);
    expect((await records(page)).map((row: { id: string }) => row.id)).toEqual(expect.arrayContaining(ids));
    await capture(page, `${language}-F19-members-restored`);
    await page.goto('/collections'); await page.getByRole('button', { name: c.create, exact: true }).first().click();
    await editor.getByLabel(c.collectionName).fill('Empty collection'); await editor.getByRole('button', { name: c.collectionSave, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Empty collection', exact: true })).toBeVisible();
    await expect(page.locator('.collections-member-card')).toHaveCount(0);
    await capture(page, `${language}-F19-empty-collection`);
  });

  test(`${language} F15-01-04 ExternalLink import retains scoped evidence and independent ledger identities at 390`, async ({ page }) => {
    await page.goto('/intake');
    const project = await page.evaluate(async ({ rp, dp }) => {
      const asset = { ...(await import(dp)).newAsset('project'), name: 'ExternalLink target' };
      await (await (await import(rp)).localRepository()).save('asset', asset); return asset;
    }, { rp: repositoryPath, dp: domainPath });
    const receipt = { status: 'success', confirmedBy: 'agent', evidence: 'Synthetic receipt', evidenceUrl: 'https://receipt.synthetic.test/42', submittedAt: '2026-10-20T00:00:00Z' };
    const fixture = {
      format: 'externallink-submission-backup', version: 2,
      siteProfiles: {
        One: { id: 'One', name: 'Profile one', fields: { Name: 'Profile one', URL: 'https://one.synthetic.test/', Title: 'Selected profile title', 'Short description(20-30 words)': 'Selected field alias', 'Cloud LOGO': 'https://images.synthetic.test/logo.png', 'Screenshot 1': 'https://images.synthetic.test/one.png' } },
        Two: { id: 'Two', name: 'Profile two', fields: { Name: 'Private profile two', Title: 'Unselected title sentinel' } },
      },
      submissionRecords: Object.fromEntries([
        ['migration.synthetic.test', 'One', { ...receipt, confirmedBy: 'migration' }],
        ['submitted.synthetic.test', 'One', { ...receipt, publicationStatus: 'submitted' }],
        ['published.synthetic.test', 'One', { ...receipt, publicationStatus: 'published' }],
        ['indexed.synthetic.test', 'One', { ...receipt, publicationStatus: 'published', publicUrl: 'https://indexed.synthetic.test/listing', verifiedAt: '2026-10-21T00:00:00Z', indexedAt: '2026-10-22T00:00:00Z', indexEvidenceUrl: 'https://search.synthetic.test/evidence' }],
        ['submitted.synthetic.test', 'Two', { ...receipt, confirmedBy: 'manual' }],
      ].map(([destination, profile, record]) => [`${destination}::${profile}`, { ...record as object, destinationKey: destination, profileId: profile }])),
      sheetTableData: { privateValue: 'PRIVATE-SHEET-NOT-IMPORTED' },
    };
    let externalRequests = 0;
    await page.route('https://**.synthetic.test/**', route => { externalRequests++; return route.abort(); });
    const container = page.locator('details').filter({ has: page.locator('.external-import-panel') });
    await container.locator('summary').click(); const panel = page.locator('.external-import-panel');
    await selectChoice(panel.getByLabel(zh ? '选择本机项目' : 'Choose local project'), { label: project.name });
    await panel.locator('#ext-file').setInputFiles({ name: 'external-evidence-v2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    await selectChoice(panel.getByLabel(zh ? '选择来源资料' : 'Choose source profile'), 'One');
    await panel.getByRole('button', { name: zh ? '预览' : 'Preview', exact: true }).click();
    await expect(panel).toContainText('Selected profile title'); await expect(panel).toContainText('Selected field alias');
    await expect(panel).not.toContainText('Unselected title sentinel'); await expect(panel).not.toContainText('PRIVATE-SHEET');
    const importedRows = panel.locator('.external-import-row'); await expect(importedRows).toHaveCount(4);
    await expect(importedRows.filter({ hasText: 'migration.synthetic.test' }).getByRole('checkbox')).toBeDisabled();
    for (const host of ['submitted', 'published', 'indexed']) await importedRows.filter({ hasText: `${host}.synthetic.test` }).getByRole('checkbox').check();
    await capture(page, `${language}-F15-scoped-evidence-preview`);
    expect(await records(page, 'submission')).toHaveLength(0);
    await container.locator('summary').click(); expect(await records(page, 'submission')).toHaveLength(0);
    await container.locator('summary').click();
    await panel.getByRole('button', { name: zh ? '导入所选 3 条' : 'Import 3 selected', exact: true }).click();
    await expect.poll(async () => (await records(page, 'submission')).length).toBe(3);
    const first = await records(page, 'submission');
    expect(first.find((row: { name: string }) => row.name === 'submitted.synthetic.test')).toMatchObject({ status: 'submitted', submittedAt: '2026-10-20', externalLink: { profileId: 'One', evidenceUrl: receipt.evidenceUrl } });
    expect(first.find((row: { name: string }) => row.name === 'published.synthetic.test')).toMatchObject({ status: 'verify', externalLink: { listingClaim: 'claimed' } });
    expect(first.find((row: { name: string }) => row.name === 'indexed.synthetic.test')).toMatchObject({ status: 'indexed', verifiedAt: '2026-10-22', externalLink: { indexEvidenceUrl: 'https://search.synthetic.test/evidence' } });
    await importedRows.filter({ hasText: 'submitted.synthetic.test' }).getByRole('checkbox').check();
    await panel.getByRole('button', { name: zh ? '导入所选 1 条' : 'Import 1 selected', exact: true }).click();
    expect(await records(page, 'submission')).toEqual(first);
    await selectChoice(panel.getByLabel(zh ? '选择来源资料' : 'Choose source profile'), 'Two');
    await panel.getByRole('button', { name: zh ? '预览' : 'Preview', exact: true }).click();
    await expect(importedRows).toHaveCount(1); await importedRows.getByRole('checkbox').check();
    await panel.getByRole('button', { name: zh ? '导入所选 1 条' : 'Import 1 selected', exact: true }).click();
    await expect.poll(async () => (await records(page, 'submission')).length).toBe(4);
    const all = await records(page, 'submission');
    const parallel = all.filter((row: { name: string }) => row.name === 'submitted.synthetic.test');
    expect(parallel.map((row: { externalLink: { profileId: string } }) => row.externalLink.profileId).sort()).toEqual(['One', 'Two']);
    await page.goto(`/assets/project/${project.id}`); await page.locator('#asset-backlinks > summary').click();
    const table = page.locator('#asset-backlinks');
    const row = table.locator('tr').filter({ hasText: 'submitted.synthetic.test' }).filter({ hasText: 'One' });
    await row.getByRole('button', { name: zh ? '更新' : 'Update', exact: true }).click();
    await row.getByLabel(`submitted.synthetic.test ${zh ? '依据' : 'Evidence'}`).fill('Cancelled receipt');
    await row.getByRole('button', { name: c.cancel, exact: true }).click();
    expect(await records(page, 'submission')).toEqual(all);
    await row.getByRole('button', { name: zh ? '更新' : 'Update', exact: true }).click();
    await row.getByLabel(`submitted.synthetic.test ${zh ? '依据' : 'Evidence'}`).fill('Explicitly updated receipt');
    await row.getByRole('button', { name: c.save, exact: true }).click();
    await expect(row).toContainText('Explicitly updated receipt');
    await row.getByRole('button', { name: zh ? '删除' : 'Delete', exact: true }).click();
    const deletion = page.getByRole('dialog', { name: zh ? '删除外链记录' : 'Delete link record', exact: true });
    await deletion.getByRole('button', { name: c.cancel, exact: true }).click(); await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: zh ? '删除' : 'Delete', exact: true }).click();
    await deletion.getByRole('button', { name: zh ? '删除' : 'Delete', exact: true }).click(); await expect(row).toHaveCount(0);
    const deleted = await records(page, 'submission'); expect(deleted.filter((entry: { deleted: boolean }) => entry.deleted)).toHaveLength(1);
    expect(deleted.filter((entry: { deleted: boolean }) => !entry.deleted)).toHaveLength(3);
    await capture(page, `${language}-F15-one-record-deleted`);
    await page.reload(); await page.locator('#asset-backlinks > summary').click(); await expect(table.locator('tr').filter({ hasText: 'submitted.synthetic.test' })).toHaveCount(1);
    expect(externalRequests).toBe(0);
    await page.getByText(zh ? '已删除的外链记录' : 'Deleted link records', { exact: true }).click();
    await page.getByRole('button', { name: `${zh ? '恢复' : 'Restore'} · submitted.synthetic.test`, exact: true }).click();
    await expect(table.locator('tr').filter({ hasText: 'submitted.synthetic.test' })).toHaveCount(2);
    const restored = await records(page, 'submission');
    expect(restored.find((entry: { id: string }) => entry.id === parallel.find((entry: { externalLink: { profileId: string } }) => entry.externalLink.profileId === 'One')?.id)).toMatchObject({ deleted: false, evidence: 'Explicitly updated receipt' });
    expect(restored.filter((entry: { deleted: boolean }) => entry.deleted)).toHaveLength(0);
    await capture(page, `${language}-F15-original-record-restored`);
  });

  test(`${language} F22-06 F23-01 unconfigured services keep local records usable without claiming a connection at 390`, async ({ page }) => {
    let remoteRequests = 0;
    page.on('request', request => { if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname) && /^https?:/.test(request.url())) remoteRequests++; });
    await page.goto('/intake');
    const importer = page.locator('.ai-import-panel');
    await expect(importer).toContainText(zh ? '尚未配置' : 'No AI model is configured');
    await expect(importer.getByRole('button', { name: zh ? '生成待审核资料' : 'Generate records to review', exact: true })).toBeDisabled();
    await page.goto('/assistant-access');
    await expect(page.locator('.assistant-access-empty')).toBeVisible();
    await expect(page.locator('.assistant-access-connection')).toHaveCount(0);
    await page.getByRole('button', { name: zh ? '提问助手' : 'Ask assistant', exact: true }).click();
    const assistant = page.getByRole('dialog', { name: zh ? 'AI 助手' : 'AI assistant', exact: true });
    await assistant.getByLabel(zh ? '问题' : 'Question', { exact: true }).fill('Keep this unsent question');
    await expect(assistant.getByRole('button', { name: zh ? '发送' : 'Send', exact: true })).toBeDisabled();
    await capture(page, `${language}-F22-unconfigured`);
    await assistant.getByRole('button', { name: zh ? '关闭' : 'Close', exact: true }).click();
    await page.goto('/assets/project'); await page.getByRole('button', { name: zh ? '新增' : 'Add', exact: true }).click();
    const editor = page.getByRole('dialog'); await editor.getByLabel(c.name, { exact: true }).fill('Offline independent project');
    await editor.getByRole('button', { name: c.save, exact: true }).click(); await expect(editor).toBeHidden();
    expect((await records(page))[0]).toMatchObject({ name: 'Offline independent project' });
    await page.goto('/settings#assistant');
    const section = page.locator('details#assistant'); if (await section.getAttribute('open') === null) await section.locator('summary').click();
    const panel = page.locator('.mcp-panel');
    await expect(panel.getByRole('button', { name: zh ? '生成连接请求' : 'Create connection request', exact: true })).toBeDisabled();
    await expect(panel.getByText(zh ? '本机连接已授权' : 'Local connection authorized', { exact: true })).toHaveCount(0);
    expect(remoteRequests).toBe(0);
    await capture(page, `${language}-F23-unconfigured-local-access`);
  });

  test(`${language} F14-07 slow file read cannot replace a newer URL preview after navigation at 390`, async ({ page }) => {
    await page.route('**/__keepany_intake__/url-metadata', route => route.fulfill({ json: { url: 'https://fresh.synthetic.test/', html: '<title>Newer URL candidate</title><meta name="description" content="Newer description">' } }));
    await page.goto('/intake');
    await page.evaluate(() => {
      const arrayBuffer = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function () {
        if (this.name === 'slow-acceptance.csv') await new Promise<void>(resolve => Object.assign(window, { releaseMobileCsvRead: resolve }));
        return arrayBuffer.call(this);
      };
    });
    const quick = page.locator('.intake-quick-card');
    await quick.getByRole('button', { name: c.spreadsheet, exact: true }).click();
    await page.locator('#csv-file').setInputFiles({ name: 'slow-acceptance.csv', mimeType: 'text/csv', buffer: Buffer.from('name,kind\nOlder CSV draft,project') });
    await expect(quick.locator('.intake-mode-tabs button').first()).toBeDisabled();
    await page.getByRole('navigation', { name: zh ? '主要导航' : 'Main navigation', exact: true }).getByRole('link', { name: zh ? '更多' : 'More', exact: true }).click();
    await page.locator('main a[href="/intake"]').click();
    await quick.locator('#import-url').fill('https://fresh.synthetic.test/');
    await quick.getByRole('button', { name: zh ? '预览资料' : 'Preview records', exact: true }).click();
    const name = quick.locator('.import-preview input:not([type=checkbox])');
    await expect(name).toHaveValue('Newer URL candidate');
    await page.evaluate(() => (window as typeof window & { releaseMobileCsvRead: () => void }).releaseMobileCsvRead());
    await expect.poll(async () => page.evaluate(async path => (await (await import(path)).listReviewedCandidates()).length, '/src/intake-review-store.ts')).toBe(1);
    await expect(name).toHaveValue('Newer URL candidate');
    expect(await records(page)).toHaveLength(0);
    await capture(page, `${language}-F14-07-late-file-keeps-newer-preview`);
  });
}
