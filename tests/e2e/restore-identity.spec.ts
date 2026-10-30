import { openBackupPage } from "./helpers/backup-restore";
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { newAsset, type Asset } from '../../packages/domain/src';
import { prepareCompletionArchive, recordDevelopmentRequests } from './helpers/completion-archive';
import { openBackupRestorePanel } from './helpers/backup-restore';
import { open } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { BACKUP_CONTAINER_MAX_BYTES, decryptBackup } from '../../packages/local-db/src/backup-crypto';
import type { DatasetBinding, RecordRow } from '../../packages/local-db/src';

const password = 'synthetic-restore-identity-password';
test.use({ actionTimeout: 15_000 });

// Synthetic legacy provenance is prepared only in Node. Both candidate stores
// become bound solely through their real KA1 restore UI; no browser DB writes.
type LegacyFixture = { asset: Asset; binding: DatasetBinding };
const sourceDirectory = resolve("test-results/restore-identity-legacy-source");
const targetDirectory = resolve("test-results/restore-identity-legacy-target");
let sourceFixture: LegacyFixture;
let targetFixture: LegacyFixture;
test.beforeAll(async () => {
  async function prepare(directory: string, kind: "project" | "item", name: string, endpoint: string) {
    return prepareCompletionArchive(directory, password, async repository => {
      const asset = { ...newAsset(kind), name };
      await repository.saveBatch([{ type: "asset", value: asset }]);
      const accountId = "legacy-synthetic-owner", workspaceId = crypto.randomUUID();
      const digest = createHash("sha256").update(JSON.stringify([endpoint, accountId])).digest("hex");
      const binding: DatasetBinding = { endpoint, accountId, workspaceId, scope: digest + ":" + workspaceId };
      await repository.claimDatasetBinding(binding);
      return { asset, binding };
    });
  }
  sourceFixture = await prepare(sourceDirectory, "project", "Synthetic source project", "https://source-legacy.example.test");
  targetFixture = await prepare(targetDirectory, "item", "Synthetic target item", "https://target-legacy.example.test");
});

async function download(page: Page, zh: boolean, filename: string) {
  await page.goto('/intake'); await openBackupPage(page); await page.locator('#backup-password').fill(password);
  await page.getByRole('button', { name: zh ? '创建备份' : 'Create backup', exact: true }).click();
  const link = page.getByRole('link', { name: zh ? '保存备份文件' : 'Save backup file' });
  await expect(link).toBeVisible();
  const downloading = page.waitForEvent('download'); await link.click();
  const path = test.info().outputPath(filename); await (await downloading).saveAs(path);
  const entries = unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)), password));
  return { path, rows: JSON.parse(strFromU8(entries['records.json'])) as RecordRow[],
    manifest: JSON.parse(strFromU8(entries['manifest.json'])) as { sourceBinding?: DatasetBinding } };
}

async function restore(page: Page, file: string, zh: boolean, expectSuccess = true) {
  await page.goto('/intake'); await openBackupPage(page); await page.locator('#backup-password').fill(password);
  await openBackupRestorePanel(page);
  await page.locator('#restore-file').setInputFiles(file);
  await page.getByRole('button', { name: zh ? '预览' : 'Preview', exact: true }).first().click();
  const confirm = page.getByRole('button', { name: zh ? '确认 · 1' : 'Confirm · 1', exact: true });
  await expect(confirm).toBeVisible(); await confirm.click();
  if (expectSuccess) await expect(page.getByRole('status').filter({ hasText: zh ? '已恢复 1 条记录' : 'Restored 1 records' })).toBeVisible();
}

for (const locale of ['zh-CN', 'en-US']) test(`${locale} ordinary restore preserves source identity and blocks a cross-workspace import`, async ({ browser }) => {
  test.setTimeout(90_000);
  const zh = locale === 'zh-CN';
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const developmentRequests: string[][] = [];
  async function isolated() {
    const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, acceptDownloads: true });
    contexts.push(context);
    developmentRequests.push(recordDevelopmentRequests(context));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    return { context, page };
  }
  try {
    const source = await isolated(), target = await isolated(), clean = await isolated();
    const sourceWorkspace = sourceFixture.binding.workspaceId, targetWorkspace = targetFixture.binding.workspaceId;
    await restore(source.page, resolve(sourceDirectory, 'fixture.ka1'), zh);
    const sourceBackup = await download(source.page, zh, 'source.ka1');
    expect(sourceBackup.manifest.sourceBinding?.workspaceId).toBe(sourceWorkspace);
    await restore(target.page, resolve(targetDirectory, 'fixture.ka1'), zh);
    const before = await download(target.page, zh, 'target-before.ka1');
    expect(before.manifest.sourceBinding?.workspaceId).toBe(targetWorkspace);
    await restore(target.page, sourceBackup.path, zh, false);
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
    await clean.page.goto('/intake'); await openBackupPage(clean.page); await clean.page.locator('#backup-password').fill(password);
    await openBackupRestorePanel(clean.page);
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
    expect(developmentRequests.flat()).toEqual([]);
  } finally { for (const context of contexts) await context.close(); }
});
