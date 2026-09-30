import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { selectChoice } from "./helpers/select-choice";

const modulePath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? 'docs/evidence/2026-09-29';

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
    await expect(page.locator('main.page .list-row').filter({ hasText: localName })).toBeVisible();
    await page.goto('/intake');
    await page.locator('#backup-password').fill(password);
    await page.getByRole('button', { name: 'Create backup' }).click();
    const event = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Save backup file' }).click();
    const path = await (await event).path();
    if (!path) throw Error('backup download missing');

    // Fixture only: one image record was written before interruption. The bound local dataset has no proof of the journal source.
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
      const endpoint = 'https://sync.example.test', accountId = 'restore-warning-fixture', workspaceId = crypto.randomUUID();
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([endpoint, accountId])))), byte => byte.toString(16).padStart(2, '0')).join('');
      await repo.claimDatasetBinding({ endpoint, accountId, workspaceId, scope: `${digest}:${workspaceId}` });
      await repo.db.records.insert(row(partial));
      await repo.fileStore.journal.put({ id: 'partial-restore-fixture', rows: [row(partial), row(conflict)] });
      return { localId: local.id, partialId: partial.id, imageId, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
    }, { modulePath, localName, partialName });

    await page.reload();
    const panel = page.locator('.restore-recovery-panel');
    await expect(panel.getByRole('heading', { name: 'Restore needs attention', exact: true })).toBeVisible();
    await expect(panel.locator('.restore-recovery-counts dd')).toHaveText(['2', '0', '1', '0', '1']);
    await expect(panel.locator('.restore-recovery-reason')).toHaveText('The restore source does not match the current data ownership. Check the source before choosing an action.');
    await expect(panel.getByRole('button', { name: 'Continue restore', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Keep current data and abandon restore', exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${evidence}/restore-recovery-warning-en-390.png`, fullPage: true });
    await page.goto('/assets/project');
    await expect(page.locator('main.page .list-row').filter({ hasText: localName })).toBeVisible();
    await expect(page.locator('main.page .list-row').filter({ hasText: partialName })).toBeVisible();
    await page.locator('main.page .list-row').filter({ hasText: partialName }).click();
    await page.locator('#asset-project-materials > summary').click();
    await expect(page.locator('#asset-project-materials')).toHaveAttribute('open', '');
    await expect(page.locator('img.asset-image')).toBeVisible();
    await expect(page.locator('img.asset-image')).toHaveJSProperty('naturalWidth', 8);

    await page.goto('/intake');
    await page.locator('#backup-password').fill(password);
    await page.locator('#restore-file').setInputFiles(path);
    await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
    await page.getByRole('button', { name: /Confirm ·/ }).click();
    await expect(panel.getByRole('heading', { name: 'Restore needs attention', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Continue restore', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Keep current data and abandon restore', exact: true })).toHaveCount(0);
    const readback = await page.evaluate(async ({ modulePath, fixture }) => {
      const { localRepository } = await import(modulePath);
      const repo = await localRepository();
      const file = await repo.fileStore.blobs.get(fixture.imageId);
      const [recovery] = await repo.getPendingRestoreRecoveries();
      if (!recovery) throw Error('pending restore missing');
      const rejection = async (action: () => Promise<unknown>) => {
        try { await action(); return 'unexpected-success'; }
        catch (error) { return error instanceof Error ? error.message : String(error); }
      };
      const rejections = [await rejection(() => repo.retryRestoreRecovery(recovery.token)), await rejection(() => repo.abandonRestoreRecovery(recovery.token))];
      return {
        rejections, recovery,
        warning: repo.restoreRecoveryError,
        local: await repo.get('asset', fixture.localId),
        partial: await repo.get('asset', fixture.partialId),
        journalCount: await repo.fileStore.journal.count(),
        file: file && { name: file.name, type: file.blob.type, bytes: Array.from(new Uint8Array(await file.blob.arrayBuffer())) },
      };
    }, { modulePath, fixture });
    expect(readback.warning).toBe('restore-source-identity');
    expect(readback.recovery).toMatchObject({ canRetry: false, canAbandon: false, reason: 'restore-source-identity' });
    expect(readback.rejections).toEqual(['restore-source-identity', 'restore-source-identity']);
    expect(readback.local.name).toBe(localName);
    expect(readback.partial.name).toBe(partialName);
    expect(readback.journalCount).toBe(1);
    expect(readback.file).toEqual({ name: 'partial-original.png', type: 'image/png', bytes: fixture.bytes });

    await page.goto('/settings');
    await selectChoice(page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Language' }) }).getByRole("combobox"), 'zh-CN');
    await page.goto('/intake');
    await expect(panel.getByRole('heading', { name: '恢复待处理', exact: true })).toBeVisible();
    await expect(panel.locator('.restore-recovery-counts dd')).toHaveText(['2', '0', '1', '0', '1']);
    await expect(panel.locator('.restore-recovery-reason')).toHaveText('恢复来源与当前资料归属不一致。请核对来源后再决定操作。');
    await expect(panel.getByRole('button', { name: '继续恢复', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: '保留当前资料并放弃剩余恢复', exact: true })).toHaveCount(0);
    expect(await page.evaluate(async (modulePath) => (await (await import(modulePath)).localRepository()).fileStore.journal.count(), modulePath)).toBe(1);
    await page.screenshot({ path: `${evidence}/restore-recovery-warning-zh-390.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
