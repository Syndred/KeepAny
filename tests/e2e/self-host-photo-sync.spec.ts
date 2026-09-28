import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { PostgresSyncService } from '../../packages/sync-core/src/postgres';
import { migrateSyncDatabase } from '../../apps/sync-server/src/migrate';

const databaseUrl = process.env.KEEPANY_TEST_DATABASE_URL;
const token = 'photo-browser-token-'.padEnd(40, 'x');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAAhUlEQVR4nLXNuRXCQBAE0WJCIQlZikEJYZLZ5iGfLOTyYI85Wu3NlPEfn2Pja/vzhXT2c7fzfS+A2rDuV2jYKKgMmzSJYfPcysYCoGysAWqGC6BgeAGyRgAgZcQA4kYYIGhkACJGEsBt5AF8RgnAYVQBVoYAYGpoAMaGDGBgKIGuIQb+jQtZ/TPNXBjnggAAAABJRU5ErkJggg==', 'base64');

async function freePort(): Promise<number> {
  const server = createNetServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('port-address');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function configure(page: Page, endpoint: string, workspaceId: string, key: string): Promise<void> {
  await page.goto('/settings');
  const inputs = page.locator('.sync-panel .form-grid input');
  await inputs.nth(0).fill(endpoint);
  await inputs.nth(1).fill(token);
  await inputs.nth(2).fill(workspaceId);
  await inputs.nth(3).fill(key);
}

async function sync(page: Page, result: string): Promise<void> {
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.locator('.sync-panel .notice')).toHaveText(result);
}

test('encrypted photo survives lost upload acknowledgment and rejects missing or changed objects before pull', async ({ browser }) => {
  test.skip(!databaseUrl, 'Requires disposable PostgreSQL; the test creates and drops its own schema.');
  test.setTimeout(180_000);
  const schema = `keepany_photo_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 4 });
  const objects = new Map<string, Buffer>();
  const s3Mock = createHttpServer(async (request, response) => {
    if (!request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) { response.writeHead(403).end(); return; }
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      objects.set(path, Buffer.concat(chunks));
      response.writeHead(200, { ETag: '"photo-test"' }).end();
      return;
    }
    const bytes = objects.get(path);
    if (!bytes) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Length': bytes.length,
      'Content-Type': 'application/vnd.keepany.ciphertext' }).end(bytes);
  });
  const contextA = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
  const contextB = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } });
  let contextC: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let contextD: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let releaseBlockedUpload = () => {};
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const errors: string[] = [];
  pageA.on('pageerror', error => errors.push(`A: ${error.message}`));
  pageB.on('pageerror', error => errors.push(`B: ${error.message}`));
  let child: ChildProcess | undefined;
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await migrateSyncDatabase(pool);
    s3Mock.listen(0, '127.0.0.1');
    await once(s3Mock, 'listening');
    const s3Address = s3Mock.address();
    if (!s3Address || typeof s3Address === 'string') throw Error('s3-address');
    const port = await freePort();
    const endpoint = `http://127.0.0.1:${port}`;
    child = spawn('node_modules/.bin/tsx', ['apps/sync-server/src/main.ts'], {
      cwd: process.cwd(), stdio: 'pipe', env: {
        ...process.env, DATABASE_URL: databaseUrl, PGOPTIONS: `-c search_path=${schema}`,
        KEEPANY_SYNC_AUTH_MODE: 'self-host', KEEPANY_SYNC_TOKEN: token,
        KEEPANY_SYNC_WEB_ORIGIN: test.info().project.use.baseURL as string,
        KEEPANY_S3_BUCKET: 'private-test-bucket', KEEPANY_S3_REGION: 'us-east-1',
        KEEPANY_S3_ENDPOINT: `http://127.0.0.1:${s3Address.port}`,
        KEEPANY_S3_ACCESS_KEY_ID: 'photo-test-key', KEEPANY_S3_SECRET_ACCESS_KEY: 'photo-test-secret',
        HOST: '127.0.0.1', PORT: String(port),
      },
    });
    let serverLog = '';
    child.stdout?.on('data', chunk => { serverLog += String(chunk).slice(0, 1000); });
    child.stderr?.on('data', chunk => { serverLog += String(chunk).slice(0, 1000); });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw Error(`server-exit-${child.exitCode}: ${serverLog.slice(-2000)}`);
      try { if ((await fetch(`${endpoint}/healthz`)).ok) break; } catch { /* starting */ }
      if (attempt === 99) throw Error(`server-start-timeout: ${serverLog.slice(-2000)}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const workspaceResponse = await fetch(`${endpoint}/workspaces`, { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    }, body: '{}' });
    expect(workspaceResponse.status).toBe(201);
    const { workspaceId } = await workspaceResponse.json() as { workspaceId: string };
    const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const assetName = `Photo ${crypto.randomUUID().slice(0, 8)}`;
    await pageA.goto('/assets/project');
    await pageA.getByRole('button', { name: 'Add', exact: true }).click();
    const dialog = pageA.getByRole('dialog');
    await dialog.getByLabel('Name', { exact: true }).fill(assetName);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await pageA.getByText(assetName, { exact: true }).first().click();
    await pageA.getByLabel('Add image').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
    const preview = pageA.getByRole('dialog');
    await expect(preview.locator('img')).toHaveJSProperty('naturalWidth', 32);
    await preview.getByRole('button', { name: 'Confirm' }).click();
    await expect(preview).toBeHidden();
    await expect(pageA.locator('img.asset-image')).toHaveJSProperty('naturalWidth', 32);

    await configure(pageA, endpoint, workspaceId, key);
    let dropped = false;
    await pageA.route(`${endpoint}/workspaces/${workspaceId}/attachments/**`, async route => {
      if (dropped || route.request().method() !== 'PUT') return route.continue();
      dropped = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    });
    await sync(pageA, 'This sync did not complete');
    expect(dropped).toBe(true);
    expect(objects.size).toBe(1);
    const firstCiphertext = Buffer.from(objects.values().next().value ?? []);
    const service = new PostgresSyncService(pool);
    expect((await service.pull({ workspaceId, cursor: 0, limit: 10 }, 'self-host-owner')).changes).toHaveLength(0);
    await pageA.unroute(`${endpoint}/workspaces/${workspaceId}/attachments/**`);
    await pageA.reload();
    await configure(pageA, endpoint, workspaceId, key);
    await sync(pageA, 'This sync completed');
    expect(objects.size).toBe(2);
    expect(objects.values().next().value).toEqual(firstCiphertext);
    expect(Array.from(objects.values()).every(bytes => !bytes.includes(png) && !bytes.toString().includes('photo.png'))).toBe(true);
    expect((await service.pull({ workspaceId, cursor: 0, limit: 10 }, 'self-host-owner')).changes).toHaveLength(1);

    const firstPath = objects.keys().next().value as string;
    const chunk = Buffer.from(objects.get(firstPath) ?? []);
    objects.delete(firstPath);
    await configure(pageB, endpoint, workspaceId, key);
    await sync(pageB, 'This sync did not complete');
    await pageB.goto('/assets/project');
    await expect(pageB.getByText(assetName, { exact: true })).toHaveCount(0);
    objects.set(firstPath, Buffer.concat([chunk.subarray(0, -1), Buffer.from([(chunk.at(-1) ?? 0) ^ 1])]));
    await configure(pageB, endpoint, workspaceId, key);
    await sync(pageB, 'This sync did not complete');
    await pageB.goto('/assets/project');
    await expect(pageB.getByText(assetName, { exact: true })).toHaveCount(0);
    objects.set(firstPath, chunk);
    await configure(pageB, endpoint, workspaceId, key);
    await sync(pageB, 'This sync completed');
    await pageB.goto('/assets/project');
    await pageB.getByText(assetName, { exact: true }).first().click();
    await expect(pageB.locator('img.asset-image')).toHaveJSProperty('naturalWidth', 32);
    expect(await pageB.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    if (process.env.KEEPANY_SYNC_EVIDENCE_DIR) {
      await pageB.screenshot({ path: `${process.env.KEEPANY_SYNC_EVIDENCE_DIR}/photo-sync-en-390.png`, fullPage: true });
      await pageB.evaluate(() => localStorage.setItem('keepany-language', 'zh-CN'));
      await pageB.reload();
      await expect(pageB.getByRole('heading', { name: assetName })).toBeVisible();
      await expect(pageB.locator('img.asset-image')).toHaveJSProperty('naturalWidth', 32);
      expect(await pageB.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await pageB.screenshot({ path: `${process.env.KEEPANY_SYNC_EVIDENCE_DIR}/photo-sync-zh-390.png`, fullPage: true });
    }

    // Two fresh devices restored from one backup retain the same logical attachment ID.
    await pageA.goto('/intake');
    const backupPassword = `test-only-photo-${crypto.randomUUID()}`;
    await pageA.locator('#backup-password').fill(backupPassword);
    await pageA.getByRole('button', { name: 'Create backup' }).click();
    const saveFile = pageA.getByRole('link', { name: 'Save backup file' });
    await expect(saveFile).toBeVisible();
    const downloadPromise = pageA.waitForEvent('download');
    await saveFile.click();
    const backupPath = await (await downloadPromise).path();
    if (!backupPath) throw Error('backup-path');
    const secondWorkspace = await fetch(`${endpoint}/workspaces`, { method: 'POST', headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
    }, body: '{}' }).then(response => response.json()) as { workspaceId: string };
    const secondKey = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    contextC = await browser.newContext({ locale: 'en-US' });
    contextD = await browser.newContext({ locale: 'en-US' });
    const pageC = await contextC.newPage();
    const pageD = await contextD.newPage();
    pageC.on('pageerror', error => errors.push(`C: ${error.message}`));
    pageD.on('pageerror', error => errors.push(`D: ${error.message}`));
    for (const page of [pageC, pageD]) {
      await page.goto('/intake');
      await page.locator('#backup-password').fill(backupPassword);
      await page.locator('#restore-file').setInputFiles(backupPath);
      await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
      await page.getByRole('button', { name: /Confirm ·/ }).click();
      await expect(page.getByText(/Restored \d+ records/)).toBeVisible();
      await configure(page, endpoint, secondWorkspace.workspaceId, secondKey);
    }
    let blockedUpload = false;
    let lostAck = false;
    const holdUpload = new Promise<void>(resolve => { releaseBlockedUpload = resolve; });
    const routePattern = `${endpoint}/workspaces/${secondWorkspace.workspaceId}/attachments/**`;
    await pageD.route(routePattern, async route => {
      if (route.request().method() !== 'PUT' || lostAck) return route.continue();
      blockedUpload = true;
      await holdUpload;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      lostAck = true;
      await route.abort('failed');
    });
    await pageD.getByRole('button', { name: 'Sync now' }).click();
    await expect.poll(() => blockedUpload).toBe(true);
    await sync(pageC, 'This sync completed');
    releaseBlockedUpload();
    await expect(pageD.locator('.sync-panel .notice')).toHaveText('This sync did not complete');
    await pageD.unroute(routePattern);
    await pageD.reload();
    await configure(pageD, endpoint, secondWorkspace.workspaceId, secondKey);
    await sync(pageD, 'This sync completed');
    expect((await service.pull({ workspaceId: secondWorkspace.workspaceId, cursor: 0, limit: 10 }, 'self-host-owner')).changes)
      .toHaveLength(1);
    await pageD.goto('/assets/project');
    await pageD.getByText(assetName, { exact: true }).first().click();
    await expect(pageD.locator('img.asset-image')).toHaveJSProperty('naturalWidth', 32);
    expect(errors).toEqual([]);
  } finally {
    releaseBlockedUpload();
    await Promise.allSettled([contextA.close(), contextB.close(), contextC?.close(), contextD?.close()]);
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    if (s3Mock.listening) {
      s3Mock.closeAllConnections();
      await new Promise<void>((resolve, reject) => s3Mock.close(error => error ? reject(error) : resolve()));
    }
    await pool.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
