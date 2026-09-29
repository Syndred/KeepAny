import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import type { ReviewedCandidate } from '../../packages/local-db/src/intake-review';

const sourcePassword = 'candidate-source-migration-password', targetPassword = 'candidate-target-migration-password';
const token = 'candidate-migration-test-token-'.padEnd(40, 'x');
const workspaceKey = Buffer.from(new Uint8Array(32).fill(9)).toString('base64url');
const csv = Buffer.from('name,kind\nDraft conflict,project\nDecision conflict,project\nAccepted conflict,project');

// Static-token mode fixes the account ID; distinct endpoint/workspace scopes
// prove the same cross-remote local merge as archive-migration.spec.ts.
async function mockSync(context: BrowserContext, port: number, workspaceId: string) {
  const accepted = new Map<string, { version: number; sequence: number }>(), versions = new Map<string, number>();
  await context.route(`http://127.0.0.1:${port}/**`, async route => {
    const request = route.request(), body = JSON.parse(request.postData() || '{}') as Record<string, unknown>;
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type', 'content-type': 'application/json' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (body.workspaceId !== workspaceId) return route.fulfill({ status: 403, json: {}, headers });
    if (request.url().endsWith('/sync/preflight')) return route.fulfill({ json: { accountId: 'self-host-owner', workspaceId }, headers });
    if (request.url().endsWith('/sync/pull')) return route.fulfill({ json: { changes: [], nextCursor: Number(body.cursor) }, headers });
    if (request.url().endsWith('/sync/push')) {
      const results = (body.operations as { operationId: string; id: string }[]).map(operation => {
        const previous = accepted.get(operation.operationId);
        if (!previous) {
          const version = (versions.get(operation.id) ?? 0) + 1; versions.set(operation.id, version);
          accepted.set(operation.operationId, { version, sequence: accepted.size + 1 });
        }
        return { operationId: operation.operationId, status: previous ? 'duplicate' : 'accepted', ...accepted.get(operation.operationId) };
      });
      return route.fulfill({ json: { results }, headers });
    }
    return route.fulfill({ status: 404, json: {}, headers });
  });
}

async function configure(page: Page, port: number, workspaceId: string) {
  await page.goto('/settings#connections'); const inputs = page.locator('.sync-panel .form-grid input');
  await inputs.nth(0).fill(`http://127.0.0.1:${port}`); await inputs.nth(1).fill(token);
  await inputs.nth(2).fill(workspaceId); await inputs.nth(3).fill(workspaceKey);
}

async function contents(file: string, password: string) {
  const entries = unzipSync(await decryptBackup(new Uint8Array(readFileSync(file)), password));
  return { candidates: JSON.parse(strFromU8(entries['intake-review.json'])) as ReviewedCandidate[],
    records: JSON.parse(strFromU8(entries['records.json'])) as Array<{ id: string; type: string; payload: string }> };
}

async function saveDownload(page: Page, link: Locator, name: string) {
  const event = page.waitForEvent('download'); await link.click(); const result = await event;
  const file = path.join(test.info().outputDir, name); await result.saveAs(file); return file;
}

async function snapshot(page: Page, zh: boolean, name: string) {
  await page.goto('/intake'); await page.locator('#backup-password').fill(targetPassword);
  await page.getByRole('button', { name: zh ? '创建备份' : 'Create backup', exact: true }).click();
  const link = page.getByRole('link', { name: zh ? '保存备份文件' : 'Save backup file' }); await expect(link).toBeVisible();
  return contents(await saveDownload(page, link, name), targetPassword);
}

for (const locale of ['zh-CN', 'en-US']) test(`${locale} 390 candidate merge requires choices, keeps selected drafts and decisions, and survives refresh/undo`, async ({ browser }) => {
  test.setTimeout(90_000); const zh = locale === 'zh-CN';
  const source = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
  const target = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
  const sourcePage = await source.newPage(), targetPage = await target.newPage(), errors: string[] = [];
  sourcePage.setDefaultTimeout(10_000); targetPage.setDefaultTimeout(10_000);
  sourcePage.on('pageerror', error => errors.push(`source: ${error.message}`)); targetPage.on('pageerror', error => errors.push(`target: ${error.message}`));
  const sourceWorkspace = crypto.randomUUID(), targetWorkspace = crypto.randomUUID();
  await mockSync(source, 3212, sourceWorkspace); await mockSync(target, 3213, targetWorkspace);
  try {
    for (const [page, side] of [[sourcePage, 'Source'], [targetPage, 'Target']] as const) {
      await page.goto('/intake'); await page.locator('.intake-mode-tabs').getByRole('button', { name: zh ? '表格' : 'Spreadsheet', exact: true }).click();
      await page.locator('#csv-file').setInputFiles({ name: 'merge-review.csv', mimeType: 'text/csv', buffer: csv });
      const rows = page.locator('.intake-review-row'); await expect(rows).toHaveCount(3);
      await rows.nth(0).getByLabel(zh ? '名称' : 'Name', { exact: true }).fill('Shared draft');
      await rows.nth(0).getByLabel(zh ? '资料类型' : 'Record type').selectOption(side === 'Source' ? 'account' : 'item');
      await rows.nth(0).getByLabel(zh ? '网址' : 'URL', { exact: true }).fill(`https://${side.toLowerCase()}.example.test/`);
      await rows.nth(0).getByLabel(zh ? '简短描述' : 'Short description').fill(`${side} draft description`);
      if (side === 'Source') {
        await rows.nth(1).getByRole('button', { name: zh ? '忽略' : 'Ignore', exact: true }).click();
        await rows.nth(2).getByLabel(zh ? '名称' : 'Name', { exact: true }).fill('Source accepted');
        await rows.nth(2).getByRole('button', { name: zh ? '确认入库' : 'Confirm and save', exact: true }).click();
        await expect(rows.nth(2)).toContainText(zh ? '已确认' : 'Confirmed');
      } else {
        await rows.nth(1).getByLabel(zh ? '名称' : 'Name', { exact: true }).fill('Target pending decision');
        await rows.nth(1).getByLabel(zh ? '简短描述' : 'Short description').fill('Target decision description');
        await rows.nth(2).getByRole('button', { name: zh ? '忽略' : 'Ignore', exact: true }).click();
        await expect(rows.nth(2)).toContainText(zh ? '已忽略' : 'Ignored');
      }
    }
    await configure(sourcePage, 3212, sourceWorkspace);
    await sourcePage.locator('.sync-panel').getByRole('button', { name: zh ? '立即同步' : 'Sync now', exact: true }).click();
    await expect(sourcePage.locator('.sync-panel .notice')).toHaveText(zh ? '本次同步已完成' : 'This sync completed');
    await sourcePage.goto('/intake'); await sourcePage.locator('#backup-password').fill(sourcePassword);
    await sourcePage.getByRole('button', { name: zh ? '创建备份' : 'Create backup', exact: true }).click();
    const sourceLink = sourcePage.getByRole('link', { name: zh ? '保存备份文件' : 'Save backup file' }); await expect(sourceLink).toBeVisible();
    const sourceFile = await saveDownload(sourcePage, sourceLink, 'source-candidates.ka1'), sourceData = await contents(sourceFile, sourcePassword);
    let baseline: Awaited<ReturnType<typeof contents>> | undefined;
    for (const [round, choices] of [['first', ['source', 'target', 'source']], ['second', ['target', 'source', 'target']]] as const) {
      await configure(targetPage, 3213, targetWorkspace); const panel = targetPage.locator('.migration-panel');
      await panel.locator('input[type="file"]').first().setInputFiles(sourceFile);
      await panel.locator('input[type="password"]').first().fill(sourcePassword);
      await panel.getByRole('button', { name: zh ? '核对目标并预览' : 'Check target and preview', exact: true }).click();
      await expect(panel).toContainText('http://127.0.0.1:3212'); await expect(panel).toContainText('http://127.0.0.1:3213');
      await expect(panel).toContainText(sourceWorkspace); await expect(panel).toContainText(targetWorkspace);
      await expect(panel).toContainText(zh ? '收录审核 3 条：新增 0，相同 0，有差异 3' : 'Intake reviews: 3 — 0 new, 0 identical, 3 different');
      const conflicts = panel.locator('fieldset.migration-conflict'); await expect(conflicts).toHaveCount(3);
      await expect(conflicts.nth(0).getByRole('radio')).toHaveCount(2);
      await expect(conflicts.nth(0)).toContainText('Shared draft');
      await expect(conflicts.nth(1)).toContainText(zh ? '已忽略' : 'Ignored'); await expect(conflicts.nth(1)).toContainText(zh ? '待确认' : 'Pending');
      await expect(conflicts.nth(2)).toContainText(zh ? '已确认' : 'Confirmed'); await expect(conflicts.nth(2)).toContainText(zh ? '已忽略' : 'Ignored');
      await conflicts.nth(0).getByText(zh ? '查看字段差异' : 'Show field differences', { exact: true }).click();
      await expect(conflicts.nth(0)).toContainText('Source draft description'); await expect(conflicts.nth(0)).toContainText('Target draft description');
      const typeDifference = conflicts.nth(0).locator('.migration-field-difference').filter({ hasText: zh ? '资料类型' : 'Record type' });
      await expect(typeDifference).toContainText(zh ? '账号' : 'Account'); await expect(typeDifference).toContainText(zh ? '实物' : 'Item');
      const urlDifference = conflicts.nth(0).locator('.migration-field-difference').filter({ hasText: zh ? '网址' : 'URL' });
      await expect(urlDifference).toContainText('https://source.example.test/'); await expect(urlDifference).toContainText('https://target.example.test/');
      await panel.getByLabel(zh ? '我已核对来源和目标，确认这次合并' : 'I checked the source and target for this merge').check();
      await panel.getByLabel(zh ? '目标备份密码（至少 12 位）' : 'Target backup password (12 characters minimum)').fill(targetPassword);
      await panel.getByRole('button', { name: zh ? '生成目标备份' : 'Create target backup', exact: true }).click();
      const targetLink = panel.getByRole('link', { name: zh ? '下载目标备份' : 'Download target backup' }); await expect(targetLink).toBeVisible();
      const targetFile = await saveDownload(targetPage, targetLink, `target-before-${round}.ka1`), before = await contents(targetFile, targetPassword);
      if (baseline) expect(before).toEqual(baseline); else baseline = before;
      expect(before.records).toHaveLength(0);
      expect(before.candidates.map(row => row.id)).toEqual(sourceData.candidates.map(row => row.id));
      await panel.getByLabel(zh ? '选择已下载的目标备份' : 'Select the downloaded target backup').setInputFiles(targetFile);
      await panel.getByRole('button', { name: zh ? '回读验证' : 'Verify downloaded backup', exact: true }).click();
      await expect(panel).toContainText(zh ? '目标备份已回读验证' : 'Target backup verified from the downloaded file');
      const apply = panel.getByRole('button', { name: zh ? '确认合并到目标本机资料' : 'Merge into target local data', exact: true });
      await expect(apply).toBeDisabled();
      for (const [index, choice] of choices.entries()) {
        await conflicts.nth(index).getByRole('radio', { name: new RegExp(choice === 'source' ? (zh ? '采用来源版本' : 'Use source version') : (zh ? '保留目标版本' : 'Keep target version')) }).check();
        if (index < 2) await expect(apply).toBeDisabled();
      }
      await expect(apply).toBeEnabled();
      await panel.screenshot({ path: test.info().outputPath(`intake-review-merge-${locale}-${round}-choices.png`) });
      expect(await targetPage.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await apply.click(); await expect(panel).toContainText(zh ? '本机合并完成，尚未同步' : 'Local merge complete; sync not started');
      await targetPage.reload(); await expect(panel.getByRole('button', { name: zh ? '撤销本机合并' : 'Undo local merge', exact: true })).toBeVisible();
      const merged = await snapshot(targetPage, zh, `merged-${round}.ka1`);
      expect(merged.candidates).toEqual(sourceData.candidates.map((candidate, index) => choices[index] === 'source' ? candidate : before.candidates[index]));
      expect(merged.records).toEqual(sourceData.records);
      await targetPage.reload(); await expect(targetPage.locator('.intake-review-row')).toHaveCount(3);
      if (round === 'first') {
        await expect(targetPage.locator('.intake-review-row').nth(0).getByLabel(zh ? '资料类型' : 'Record type')).toHaveValue('account');
        await expect(targetPage.locator('.intake-review-row').nth(1).getByLabel(zh ? '名称' : 'Name', { exact: true })).toHaveValue('Target pending decision');
        await expect(targetPage.locator('.intake-review-row').nth(2)).toContainText(zh ? '已确认' : 'Confirmed');
      } else {
        await expect(targetPage.locator('.intake-review-row').nth(0).getByLabel(zh ? '资料类型' : 'Record type')).toHaveValue('item');
        await expect(targetPage.locator('.intake-review-row').nth(1)).toContainText(zh ? '已忽略' : 'Ignored');
        await expect(targetPage.locator('.intake-review-row').nth(2)).toContainText(zh ? '已忽略' : 'Ignored');
      }
      await targetPage.goto('/settings#connections');
      await panel.getByRole('button', { name: zh ? '撤销本机合并' : 'Undo local merge', exact: true }).click();
      await expect(panel).toContainText(zh ? '本机合并已撤销' : 'Local merge undone');
      await targetPage.reload();
      expect(await snapshot(targetPage, zh, `undone-${round}.ka1`)).toEqual(before);
      await targetPage.reload(); await expect(targetPage.locator('.intake-review-row').nth(0).getByLabel(zh ? '名称' : 'Name', { exact: true })).toHaveValue('Shared draft');
    }
    expect(errors).toEqual([]);
  } finally { await source.close(); await target.close(); }
});
