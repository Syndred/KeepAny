import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import type { Asset } from '../../packages/domain/src';

// Opt-in browser-boundary probe, excluded from normal delivery acceptance.
// On 2026-09-30, Chromium 153 confirmed an override on the existing application
// databases but saved both valid 2048px PNGs (~14 MiB) without QuotaExceededError.
// Those two failures do not establish recovery acceptance or an application bug.
// Reproduce against an isolated portable production package on 4403:
// KEEPANY_STORAGE_QUOTA_ACCEPTANCE=1 pnpm exec playwright test --config playwright.quota.config.ts --reporter=line
test.skip(process.env.KEEPANY_STORAGE_QUOTA_ACCEPTANCE !== '1',
  'Opt-in: Chromium may confirm an origin quota override without enforcing it on existing application databases; recovery must remain unverified unless a native QuotaExceededError occurs');

const evidence = path.resolve(process.env.KEEPANY_EVIDENCE_DIR ?? 'test-results/quota-review/evidence');
const password = 'storage-quota-recovery-password';
const reproductionCommand = 'KEEPANY_STORAGE_QUOTA_ACCEPTANCE=1 pnpm exec playwright test --config playwright.quota.config.ts --reporter=line';
const releaseEntry = process.env.KEEPANY_QUOTA_PACKAGE_ENTRY;
type QuotaEvent = { source: string; database: string; errorName: string | null; message: string | null };
type QuotaWindow = Window & { __nativeQuotaEvents?: QuotaEvent[] };
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// Reuse the media tests' browser Canvas PNG fixture. RGB noise creates a valid
// large image that cannot be compressed below the small remaining quota.
async function png(page: Page, large = false): Promise<Buffer> {
  const base64 = await page.evaluate((large) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = large ? 2048 : 24;
    const context = canvas.getContext('2d'); if (!context) throw Error('canvas-unavailable');
    if (large) {
      const pixels = context.createImageData(canvas.width, canvas.height);
      for (let offset = 0; offset < pixels.data.length; offset += 65536) {
        crypto.getRandomValues(pixels.data.subarray(offset, Math.min(offset + 65536, pixels.data.length)));
      }
      for (let offset = 3; offset < pixels.data.length; offset += 4) pixels.data[offset] = 255;
      context.putImageData(pixels, 0, 0);
    } else { context.fillStyle = '#235ac8'; context.fillRect(0, 0, canvas.width, canvas.height); }
    return canvas.toDataURL('image/png').split(',')[1];
  }, large);
  return Buffer.from(base64, 'base64');
}

async function backup(page: Page, zh: boolean, fileName: string) {
  await page.goto('/intake'); await page.locator('#backup-password').fill(password);
  await page.getByRole('button', { name: zh ? '创建备份' : 'Create backup', exact: true }).click();
  const link = page.getByRole('link', { name: zh ? '保存备份文件' : 'Save backup file' }); await expect(link).toBeVisible();
  const event = page.waitForEvent('download'); await link.click(); const downloaded = await event;
  const file = path.join(test.info().outputDir, fileName); await downloaded.saveAs(file);
  const encrypted = readFileSync(file); expect(encrypted.subarray(0, 8).toString()).toBe('KEEPANY1');
  const entries = unzipSync(await decryptBackup(new Uint8Array(encrypted), password));
  const records = JSON.parse(strFromU8(entries['records.json'])) as Array<{ id: string; type: string; payload: string }>;
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as { attachments: Array<{ id: string; sha256: string; size: number }> };
  return { file, records, manifest, entries };
}

async function imageBytes(page: Page): Promise<Buffer> {
  const image = page.locator('.asset-project-hero-visual img'); await expect(image).toBeVisible();
  const base64 = await image.evaluate(async (image: HTMLImageElement) => {
    await image.decode();
    const blob = await (await fetch(image.currentSrc)).blob();
    // Transfer bytes as base64 instead of millions of JSON array elements.
    // Node still compares every byte against the original PNG below.
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  });
  return Buffer.from(base64, 'base64');
}

for (const locale of ['zh-CN', 'en-US']) test(`${locale} 390 actual Chromium quota failure preserves the project draft and retries after quota recovery`, async ({ browser, baseURL }) => {
  test.setTimeout(120_000); const zh = locale === 'zh-CN';
  if (!baseURL) throw Error('base-url-missing'); const origin = new URL(baseURL).origin;
  const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  // Observe original native events only. No quota errors or storage outcomes are mocked.
  await context.addInitScript(() => {
    const state = window as QuotaWindow; state.__nativeQuotaEvents = [];
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) {
      const transaction = Reflect.apply(original, this, args) as IDBTransaction;
      for (const eventName of ['error', 'abort']) transaction.addEventListener(eventName, event => {
        const requestError = (event.target as IDBRequest)?.error;
        const error = requestError ?? transaction.error;
        state.__nativeQuotaEvents?.push({ source: `transaction-${eventName}`, database: this.name,
          errorName: error?.name ?? null, message: error?.message ?? null });
      });
      return transaction;
    };
  });
  const page = await context.newPage(), errors: string[] = []; page.setDefaultTimeout(10_000);
  page.on('pageerror', error => errors.push(error.message)); const cdp = await context.newCDPSession(page);
  let overrideSet = false;
  let attempt: Record<string, unknown> | undefined;
  let primaryFailure: unknown;
  const stages: Array<{ stage: string; elapsedMs: number }> = [];
  const started = Date.now();
  function stage(name: string) {
    stages.push({ stage: name, elapsedMs: Date.now() - started });
    writeFileSync(path.join(evidence, `storage-quota-${locale}-stages.json`), `${JSON.stringify(stages, null, 2)}\n`);
    console.log(`[quota ${locale}] ${name}`);
  }
  mkdirSync(evidence, { recursive: true });
  try {
    stage('prepare original project and valid image fixtures');
    const originalName = `Quota original ${locale}`, recoveredName = `Quota recovered ${locale}`;
    await page.goto('/assets/project');
    if (!releaseEntry) throw Error('release-entry-missing');
    expect(await page.locator('script[src]').evaluateAll(scripts => scripts.map(script => script.getAttribute('src')))).toContain(releaseEntry);
    const oldPng = await png(page), largePng = await png(page, true);
    expect(largePng.length).toBeGreaterThan(12 * 1024 * 1024); expect(largePng.length).toBeLessThan(20 * 1024 * 1024);
    await page.getByRole('button', { name: zh ? '新增' : 'Add', exact: true }).click();
    let dialog = page.getByRole('dialog'); await dialog.locator('#name').fill(originalName);
    await dialog.locator('#projectHomeFile').setInputFiles({ name: 'quota-old.png', mimeType: 'image/png', buffer: oldPng });
    await expect(dialog.locator('.project-editor-image')).toHaveCount(1);
    await dialog.getByRole('button', { name: zh ? '保存' : 'Save', exact: true }).click(); await expect(dialog).toBeHidden();
    await page.getByText(originalName, { exact: true }).first().click();
    const assetId = new URL(page.url()).pathname.split('/').at(-1); if (!assetId) throw Error('asset-id-missing');
    expect(await imageBytes(page)).toEqual(oldPng);
    const initial = await backup(page, zh, `quota-initial-${locale}.ka1`);
    const initialRow = initial.records.find(row => row.id === `asset:${assetId}`); if (!initialRow) throw Error('asset-row-missing');
    const initialAsset = JSON.parse(initialRow.payload) as Asset;
    expect(initial.entries[`files/${initialAsset.projectMedia.homeScreenshotId}`]).toEqual(new Uint8Array(oldPng));
    stage('original project and actual encrypted backup verified');
    await page.goto(`/assets/project/${assetId}`);
    const beforeQuota = await cdp.send('Storage.getUsageAndQuota', { origin });
    const requestedQuota = Math.ceil(beforeQuota.usage) + 256 * 1024;
    await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: requestedQuota }); overrideSet = true;
    const limited = await cdp.send('Storage.getUsageAndQuota', { origin });
    expect(limited.overrideActive).toBe(true); expect(limited.quota).toBe(requestedQuota);
    // Open the existing project with fresh database connections under the limit.
    await page.reload();
    await expect(page.getByRole('heading', { name: originalName, exact: true })).toBeVisible();
    // Chromium keeps a previously approved disk-space budget for 30 seconds.
    // Reloading does not invalidate this bucket cache, especially in-memory
    // contexts. Wait for that genuine browser cache to expire before the write.
    // Source: Chromium c0811f657d5ae8c42a9fb827e7e36e7e58a16bab,
    // content/browser/indexed_db/instance/bucket_context.h,
    // BucketContext::kBucketSpaceCacheTimeLimit (30 seconds).
    stage('wait for Chromium native 30-second quota budget cache expiry');
    await page.waitForTimeout(31_000);
    await page.getByRole('button', { name: zh ? '编辑' : 'Edit', exact: true }).first().click();
    dialog = page.getByRole('dialog'); await dialog.locator('#name').fill(recoveredName);
    await dialog.locator('#description').fill('Retained quota recovery draft');
    await dialog.locator('#projectHomeFile').setInputFiles({ name: 'quota-large.png', mimeType: 'image/png', buffer: largePng });
    const preview = dialog.locator('img.project-editor-image').first(); await expect(preview).toBeVisible();
    expect(await preview.evaluate(async (image: HTMLImageElement) => { await image.decode(); return image.naturalWidth; })).toBe(2048);
    await page.evaluate(() => { (window as QuotaWindow).__nativeQuotaEvents = []; });
    stage('save the retained project draft under the confirmed quota');
    await dialog.getByRole('button', { name: zh ? '保存' : 'Save', exact: true }).click();
    await Promise.race([dialog.waitFor({ state: 'hidden' }), dialog.getByRole('alert').waitFor({ state: 'visible' })]);
    attempt = {
      locale, viewport: { width: 390, height: 844 }, origin, servedPackage: 'portable production package', sourceCommit: process.env.KEEPANY_QUOTA_PACKAGE_COMMIT, browser: browser.version(), reproductionCommand,
      beforeQuota, requestedQuota, limited, imageBytes: largePng.length,
      quotaCacheWaitMs: 31_000,
      afterSave: await cdp.send('Storage.getUsageAndQuota', { origin }),
      quotaEvents: await page.evaluate(() => (window as QuotaWindow).__nativeQuotaEvents ?? []),
      editorRetained: await dialog.isVisible(),
      instrumentation: 'Native IndexedDB transaction events observed; no errors or outcomes mocked',
    };
    writeFileSync(path.join(evidence, `storage-quota-${locale}-attempt.json`), `${JSON.stringify(attempt, null, 2)}\n`);
    if (!await dialog.isVisible()) {
      // Preserve the browser boundary as a failure, with actual persisted-image
      // and archive readback. It cannot count as quota-error recovery acceptance.
      await expect(page.getByRole('heading', { name: recoveredName, exact: true })).toBeVisible();
      stage('quota was not enforced: verify persisted bytes and actual backup');
      await page.reload(); expect((await imageBytes(page)).equals(largePng)).toBe(true);
      await page.screenshot({ path: path.join(evidence, `storage-quota-${locale}-not-enforced.png`), fullPage: true });
      await cdp.send('Storage.overrideQuotaForOrigin', { origin }); overrideSet = false;
      const cleared = await cdp.send('Storage.getUsageAndQuota', { origin }); expect(cleared.overrideActive).toBe(false);
      const saved = await backup(page, zh, `quota-not-enforced-${locale}.ka1`);
      const savedRow = saved.records.find(row => row.id === `asset:${assetId}`); if (!savedRow) throw Error('unexpected-save-row-missing');
      const savedAsset = JSON.parse(savedRow.payload) as Asset;
      expect(savedAsset).toMatchObject({ id: assetId, name: recoveredName, description: 'Retained quota recovery draft' });
      expect(Buffer.from(saved.entries[`files/${savedAsset.projectMedia.homeScreenshotId}`]).equals(largePng)).toBe(true);
      Object.assign(attempt, { outcome: 'quota-not-enforced', cleared, assetId, pageErrors: errors,
        originalImage: { id: initialAsset.projectMedia.homeScreenshotId, bytes: oldPng.length, sha256: sha(oldPng), browserDownloadedArchiveVerified: true },
        savedImage: { id: savedAsset.projectMedia.homeScreenshotId, bytes: largePng.length, sha256: sha(largePng), refreshedAndBrowserDownloadedArchiveVerified: true },
        quotaRecoveryVerified: false });
      throw Error('quota-not-enforced: Chromium confirmed the quota override but saved the image without QuotaExceededError; recovery remains unverified');
    }
    await expect(dialog.getByRole('alert')).toBeVisible(); await expect(dialog).toBeVisible();
    const quotaEvents = await page.evaluate(() => (window as QuotaWindow).__nativeQuotaEvents ?? []);
    expect(quotaEvents.some(event => event.errorName === 'QuotaExceededError')).toBe(true);
    stage('native QuotaExceededError observed; verify retained draft and old data');
    await expect(dialog.locator('#name')).toHaveValue(recoveredName); await expect(dialog.locator('#description')).toHaveValue('Retained quota recovery draft');
    expect(await dialog.locator('#projectHomeFile').evaluate((input: HTMLInputElement) => ({ name: input.files?.[0]?.name, size: input.files?.[0]?.size })))
      .toEqual({ name: 'quota-large.png', size: largePng.length });
    // Radix deliberately hides background content from the accessibility tree
    // while the retained modal is open; inspect its DOM without weakening the
    // old-title-present/new-title-absent assertions.
    await expect(page.getByRole('heading', { name: originalName, exact: true, includeHidden: true })).toBeAttached();
    await expect(page.getByRole('heading', { name: recoveredName, exact: true, includeHidden: true })).toHaveCount(0);
    await dialog.getByRole('alert').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, `storage-quota-${locale}-failed.png`), fullPage: true });
    const readback = await context.newPage(); readback.on('pageerror', error => errors.push(error.message));
    await readback.goto(`/assets/project/${assetId}`);
    await expect(readback.getByRole('heading', { name: originalName, exact: true })).toBeVisible(); expect(await imageBytes(readback)).toEqual(oldPng);
    const afterFailure = await backup(readback, zh, `quota-failed-${locale}.ka1`);
    expect(afterFailure.records).toEqual(initial.records);
    expect(afterFailure.entries[`files/${initialAsset.projectMedia.homeScreenshotId}`]).toEqual(new Uint8Array(oldPng));
    await readback.close();
    await cdp.send('Storage.overrideQuotaForOrigin', { origin }); overrideSet = false;
    const cleared = await cdp.send('Storage.getUsageAndQuota', { origin }); expect(cleared.overrideActive).toBe(false);
    stage('quota restored: retry the exact retained draft and file');
    // Retry the exact retained form and selected file, without re-entering the draft.
    await dialog.getByRole('button', { name: zh ? '保存' : 'Save', exact: true }).click(); await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: recoveredName, exact: true })).toBeVisible(); await page.reload();
    await expect(page.getByRole('heading', { name: recoveredName, exact: true })).toBeVisible(); expect((await imageBytes(page)).equals(largePng)).toBe(true);
    await page.screenshot({ path: path.join(evidence, `storage-quota-${locale}-recovered.png`), fullPage: true });
    const recovered = await backup(page, zh, `quota-recovered-${locale}.ka1`);
    const finalRow = recovered.records.find(row => row.id === `asset:${assetId}`); if (!finalRow) throw Error('recovered-row-missing');
    const finalAsset = JSON.parse(finalRow.payload) as Asset;
    expect(finalAsset).toMatchObject({ id: assetId, name: recoveredName, description: 'Retained quota recovery draft' });
    expect(finalAsset.projectMedia.homeScreenshotId).not.toBe(initialAsset.projectMedia.homeScreenshotId);
    expect(finalAsset.attachments).toEqual([finalAsset.projectMedia.homeScreenshotId]);
    expect(Buffer.from(recovered.entries[`files/${finalAsset.projectMedia.homeScreenshotId}`]).equals(largePng)).toBe(true);
    expect(recovered.entries[`files/${initialAsset.projectMedia.homeScreenshotId}`]).toBeUndefined();
    expect(errors).toEqual([]);
    writeFileSync(path.join(evidence, `storage-quota-${locale}.json`), JSON.stringify({
      locale, viewport: { width: 390, height: 844 }, servedPackage: 'portable production package', sourceCommit: process.env.KEEPANY_QUOTA_PACKAGE_COMMIT, origin, assetId,
      beforeQuota, requestedQuota, limited, cleared, quotaEvents, draftRetained: true, oldAssetUnchanged: true,
      quotaCacheWaitMs: 31_000,
      retryUsedSameDraftAndFile: true, pageErrors: errors,
      originalImage: { id: initialAsset.projectMedia.homeScreenshotId, bytes: oldPng.length, sha256: sha(oldPng) },
      recoveredImage: { id: finalAsset.projectMedia.homeScreenshotId, bytes: largePng.length, sha256: sha(largePng) },
      archive: { records: recovered.records.length, currentImageBytesVerified: true, browserDownloaded: true },
      instrumentation: 'Native IndexedDB transaction events observed; no errors or outcomes mocked',
    }, null, 2));
    stage('native quota failure, unchanged archive, same-draft retry and exact recovered bytes verified');
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    try {
      if (overrideSet) {
        await cdp.send('Storage.overrideQuotaForOrigin', { origin });
        const cleared = await cdp.send('Storage.getUsageAndQuota', { origin });
        if (attempt) attempt.clearedAfterFailure = cleared;
        expect(cleared.overrideActive).toBe(false);
      }
    } catch (error) {
      if (attempt) attempt.cleanupError = String(error);
      if (!primaryFailure) throw error;
    } finally {
      if (attempt) writeFileSync(path.join(evidence, `storage-quota-${locale}-attempt.json`), `${JSON.stringify(attempt, null, 2)}\n`);
      await cdp.detach().catch(() => undefined);
      await context.close();
    }
  }
});
