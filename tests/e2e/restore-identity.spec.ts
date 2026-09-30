import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { BACKUP_CONTAINER_MAX_BYTES, decryptBackup } from '../../packages/local-db/src/backup-crypto';
import type { DatasetBinding, RecordRow } from '../../packages/local-db/src';

const password = 'synthetic-restore-identity-password';
const token = 'synthetic-identity-token-'.padEnd(40, 'x');
const key = Buffer.from(new Uint8Array(32).fill(8)).toString('base64url');
test.use({ actionTimeout: 15_000 });

// Reuse the existing migration fixture's HTTP contract. Records enter through
// actual UI, and proof of the resulting local dataset comes from real downloads.
async function mockSync(context: BrowserContext, port: number, workspaceId: string) {
  let sequence = 0;
  await context.route(`http://127.0.0.1:${port}/**`, async route => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type', 'content-type': 'application/json' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = JSON.parse(request.postData() || '{}');
    if (body.workspaceId !== workspaceId) return route.fulfill({ status: 403, json: {}, headers });
    if (request.url().endsWith('/sync/preflight')) return route.fulfill({ json: { accountId: 'self-host-owner', workspaceId }, headers });
    if (request.url().endsWith('/sync/pull')) return route.fulfill({ json: { changes: [], nextCursor: Number(body.cursor) }, headers });
    if (request.url().endsWith('/sync/push')) return route.fulfill({ json: {
      results: body.operations.map((operation: { operationId: string }) => ({
        operationId: operation.operationId, status: 'accepted', version: 1, sequence: ++sequence,
      })),
    }, headers });
    return route.fulfill({ status: 404, json: {}, headers });
  });
}

async function connect(page: Page, port: number, workspaceId: string, zh: boolean) {
  await page.goto('/settings#connections');
  const inputs = page.locator('.sync-panel .form-grid input');
  await inputs.nth(0).fill(`http://127.0.0.1:${port}`); await inputs.nth(1).fill(token);
  await inputs.nth(2).fill(workspaceId); await inputs.nth(3).fill(key);
  await page.locator('.sync-panel').getByRole('button', { name: zh ? '立即同步' : 'Sync now', exact: true }).click();
  await expect(page.locator('.sync-panel .notice')).toHaveText(zh ? '本次同步已完成' : 'This sync completed');
}

async function add(page: Page, kind: 'project' | 'item', name: string, zh: boolean) {
  await page.goto(`/assets/${kind}`);
  await page.getByRole('button', { name: zh ? '新增' : 'Add', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel(zh ? '名称' : 'Name', { exact: true }).fill(name);
  await editor.getByRole('button', { name: zh ? '保存' : 'Save', exact: true }).click();
  await expect(editor).toBeHidden();
}

async function download(page: Page, zh: boolean, filename: string) {
  await page.goto('/intake'); await page.locator('#backup-password').fill(password);
  await page.getByRole('button', { name: zh ? '创建备份' : 'Create backup', exact: true }).click();
  const link = page.getByRole('link', { name: zh ? '保存备份文件' : 'Save backup file' });
  await expect(link).toBeVisible();
  const downloading = page.waitForEvent('download'); await link.click();
  const path = test.info().outputPath(filename); await (await downloading).saveAs(path);
  const entries = unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)), password));
  return { path, rows: JSON.parse(strFromU8(entries['records.json'])) as RecordRow[],
    manifest: JSON.parse(strFromU8(entries['manifest.json'])) as { sourceBinding?: DatasetBinding } };
}

async function restore(page: Page, file: string, zh: boolean) {
  await page.goto('/intake'); await page.locator('#backup-password').fill(password);
  await page.locator('#restore-file').setInputFiles(file);
  await page.getByRole('button', { name: zh ? '预览' : 'Preview', exact: true }).first().click();
  const confirm = page.getByRole('button', { name: zh ? '确认 · 1' : 'Confirm · 1', exact: true });
  await expect(confirm).toBeVisible(); await confirm.click();
}

for (const locale of ['zh-CN', 'en-US']) test(`${locale} ordinary restore preserves source identity and blocks a cross-workspace import`, async ({ browser }) => {
  test.setTimeout(90_000);
  const zh = locale === 'zh-CN';
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  async function isolated() {
    const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, acceptDownloads: true });
    contexts.push(context);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    return { context, page };
  }
  try {
    const source = await isolated(), target = await isolated(), clean = await isolated();
    const sourceWorkspace = crypto.randomUUID(), targetWorkspace = crypto.randomUUID();
    await mockSync(source.context, 3216, sourceWorkspace); await mockSync(target.context, 3217, targetWorkspace);
    await add(source.page, 'project', 'Synthetic source project', zh);
    await connect(source.page, 3216, sourceWorkspace, zh);
    const sourceBackup = await download(source.page, zh, 'source.ka1');
    expect(sourceBackup.manifest.sourceBinding?.workspaceId).toBe(sourceWorkspace);
    await add(target.page, 'item', 'Synthetic target item', zh);
    await connect(target.page, 3217, targetWorkspace, zh);
    const before = await download(target.page, zh, 'target-before.ka1');
    await restore(target.page, sourceBackup.path, zh);
    const refusal = target.page.getByRole('status').filter({ hasText: zh
      ? '备份来源与当前同步身份不一致，或没有来源标识，未恢复资料。'
      : 'The backup has a different or unknown sync identity. No records were restored.' });
    await expect(refusal).toBeVisible();
    expect(await target.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await target.page.screenshot({ path: test.info().outputPath(`restore-refused-${locale}.png`), fullPage: true });
    const after = await download(target.page, zh, 'target-after.ka1');
    expect(after.rows).toEqual(before.rows); expect(after.manifest.sourceBinding).toEqual(before.manifest.sourceBinding);
    await target.page.reload();
    const reloaded = await download(target.page, zh, 'target-reloaded.ka1');
    expect(reloaded.rows).toEqual(before.rows);
    const oversized = test.info().outputPath('synthetic-oversized.ka1');
    const sparse = await open(oversized, 'w');
    try { await sparse.truncate(BACKUP_CONTAINER_MAX_BYTES + 1); } finally { await sparse.close(); }
    await clean.page.goto('/intake'); await clean.page.locator('#backup-password').fill(password);
    await clean.page.locator('#restore-file').setInputFiles(oversized);
    await clean.page.getByRole('button', { name: zh ? '预览' : 'Preview', exact: true }).first().click();
    await expect(clean.page.getByRole('status').filter({ hasText: zh ? '备份超过恢复大小上限' : 'This backup exceeds the restore limit' })).toBeVisible();
    await expect(clean.page.getByRole('button', { name: /^(确认|Confirm) ·/ })).toHaveCount(0);
    await restore(clean.page, sourceBackup.path, zh);
    await expect(clean.page.getByRole('status').filter({ hasText: zh ? '已恢复 1 条记录' : 'Restored 1 records' })).toBeVisible();
    await clean.page.reload();
    const restored = await download(clean.page, zh, 'restored.ka1');
    expect(restored.rows).toEqual(sourceBackup.rows);
    expect(restored.manifest.sourceBinding).toEqual(sourceBackup.manifest.sourceBinding);
    await restore(clean.page, sourceBackup.path, zh);
    await expect(clean.page.getByRole('status').filter({ hasText: zh ? '已恢复 1 条记录' : 'Restored 1 records' })).toBeVisible();
    expect(await clean.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await clean.page.screenshot({ path: test.info().outputPath(`restore-same-source-${locale}.png`), fullPage: true });
    expect(errors).toEqual([]);
  } finally { for (const context of contexts) await context.close(); }
});
