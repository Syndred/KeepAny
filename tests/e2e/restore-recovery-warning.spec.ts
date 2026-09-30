import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { selectChoice } from "./helpers/select-choice";

const modulePath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const evidence = 'docs/evidence/2026-09-29';

test('a partial image restore keeps local data readable and warns after refresh in both languages', async ({ browser }) => {
  test.setTimeout(90_000);
  mkdirSync(evidence, { recursive: true });
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const suffix = crypto.randomUUID().slice(0, 8);
  const localName = `Local survivor ${suffix}`;
  const partialName = `Partial image ${suffix}`;
  const password = `recovery-fixture-${suffix}-2026`;
  try {
    await page.goto('/assets/project');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(localName);
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(localName, { exact: true })).toBeVisible();
    await page.goto('/intake');
    await page.locator('#backup-password').fill(password);
    await page.getByRole('button', { name: 'Create backup' }).click();
    const event = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Save backup file' }).click();
    const path = await (await event).path();
    if (!path) throw Error('backup download missing');

    // Fixture only: the image and restore journal are committed, then replay stops on a conflicting row.
    const fixture = await page.evaluate(async ({ modulePath, localName, partialName }) => {
      const { localRepository } = await import(modulePath);
      const repo = await localRepository();
      const local = (await repo.list('asset')).find((asset: { name: string }) => asset.name === localName);
      if (!local) throw Error('local asset missing');
      const canvas = document.createElement('canvas');
      canvas.width = 8; canvas.height = 8;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw Error('canvas unavailable');
      ctx.fillStyle = '#317cc0'; ctx.fillRect(0, 0, 8, 8);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('png unavailable')), 'image/png'));
      const imageId = crypto.randomUUID();
      await repo.fileStore.blobs.put({ id: imageId, name: 'partial-original.png', blob });
      const partial = { ...local, id: crypto.randomUUID(), name: partialName, attachments: [imageId] };
      const conflict = { ...local, name: `Archived change ${localName}` };
      const row = (value: typeof local) => ({ id: `asset:${value.id}`, type: 'asset', payload: JSON.stringify(value), updatedAt: Date.now() });
      await repo.fileStore.journal.put({ id: 'partial-restore-fixture', rows: [row(partial), row(conflict)] });
      return { localId: local.id, partialId: partial.id, imageId, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
    }, { modulePath, localName, partialName });

    await page.reload();
    await expect(page.getByRole('status').getByText('A previous restore needs attention. You can still view local records. Keep this device\'s data and seek help.')).toBeVisible();
    await page.screenshot({ path: `${evidence}/restore-recovery-warning-en-390.png`, fullPage: true });
    await page.goto('/assets/project');
    await expect(page.getByText(localName, { exact: true })).toBeVisible();
    await expect(page.getByText(partialName, { exact: true })).toBeVisible();
    await page.getByText(partialName, { exact: true }).click();
    await expect(page.locator('img.asset-image')).toHaveJSProperty('naturalWidth', 8);

    await page.goto('/intake');
    await page.locator('#backup-password').fill(password);
    await page.locator('#restore-file').setInputFiles(path);
    await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
    await page.getByRole('button', { name: /Confirm ·/ }).click();
    await expect(page.getByRole('status').getByText('A previous restore needs attention. You can still view local records. Keep this device\'s data and seek help.')).toBeVisible();
    const readback = await page.evaluate(async ({ modulePath, fixture }) => {
      const { localRepository } = await import(modulePath);
      const repo = await localRepository();
      const file = await repo.fileStore.blobs.get(fixture.imageId);
      return {
        warning: repo.restoreRecoveryError,
        local: await repo.get('asset', fixture.localId),
        partial: await repo.get('asset', fixture.partialId),
        journalCount: await repo.fileStore.journal.count(),
        file: file && { name: file.name, type: file.blob.type, bytes: Array.from(new Uint8Array(await file.blob.arrayBuffer())) },
      };
    }, { modulePath, fixture });
    expect(readback.warning).toBe('restore-conflict');
    expect(readback.local.name).toBe(localName);
    expect(readback.partial.name).toBe(partialName);
    expect(readback.journalCount).toBe(1);
    expect(readback.file).toEqual({ name: 'partial-original.png', type: 'image/png', bytes: fixture.bytes });

    await page.goto('/settings');
    await selectChoice(page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Language' }) }).getByRole("combobox"), 'zh-CN');
    await page.goto('/intake');
    await expect(page.getByRole('status').getByText('上次恢复尚未完成，当前资料可查看。请保留本机数据并寻求协助。')).toBeVisible();
    await page.screenshot({ path: `${evidence}/restore-recovery-warning-zh-390.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
