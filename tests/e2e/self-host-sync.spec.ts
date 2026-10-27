import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { PostgresSyncService } from '../../packages/sync-core/src/postgres';
import { migrateSyncDatabase } from '../../apps/sync-server/src/migrate';
import { selectChoice } from "./helpers/select-choice";

const databaseUrl = process.env.KEEPANY_TEST_DATABASE_URL;
const token = 'browser-test-token-'.padEnd(40, 'x');
const accountId = 'self-host-owner';

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('port-address');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function ready(endpoint: string, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw Error(`sync-server-exited-${child.exitCode}`);
    try { if ((await fetch(`${endpoint}/healthz`)).ok) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('sync-server-start-timeout');
}

async function createWorkspace(endpoint: string): Promise<string> {
  const response = await fetch(`${endpoint}/workspaces`, { method: 'POST', headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
  }, body: '{}' });
  if (!response.ok) throw Error(`workspace-${response.status}`);
  return (await response.json() as { workspaceId: string }).workspaceId;
}

async function configure(page: Page, endpoint: string, workspaceId: string, key: string): Promise<void> {
  await page.goto('/settings#connections');
  const inputs = page.locator('.sync-panel .form-grid input');
  await inputs.nth(0).fill(endpoint);
  await inputs.nth(1).fill(token);
  await inputs.nth(2).fill(workspaceId);
  await inputs.nth(3).fill(key);
}

async function sync(page: Page, expected: 'This sync completed' | 'Choose which changes to keep' | 'This sync did not complete') {
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.locator('.sync-panel .notice')).toHaveText(expected);
}

async function editProject(page: Page, name: string, replacement: string): Promise<void> {
  await page.goto('/assets/project');
  await page.locator('main .list-row').filter({ hasText: name }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(replacement);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: replacement })).toBeVisible();
}

test('isolated browsers keep one local dataset on its remote through retry, conflict, tombstone and A-B-A configuration', async ({ browser }) => {
  test.skip(!databaseUrl, 'Requires KEEPANY_TEST_DATABASE_URL; creates and drops its own PostgreSQL schema.');
  test.setTimeout(180_000);
  const schema = `keepany_browser_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 4 });
  let created = false;
  let child: ChildProcess | undefined;
  const errors: string[] = [];
  const contextA = await browser.newContext({ locale: 'en-US' });
  const contextB = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } });
  let contextC: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let contextE: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  pageA.setDefaultTimeout(10_000);
  pageB.setDefaultTimeout(10_000);
  pageA.on('pageerror', error => errors.push(`A: ${error.message}`));
  pageB.on('pageerror', error => errors.push(`B: ${error.message}`));
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await migrateSyncDatabase(pool);
    const port = await freePort();
    const endpoint = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['--import', 'tsx', 'apps/sync-server/src/main.ts'], {
      cwd: process.cwd(), stdio: 'pipe', env: {
        ...process.env, DATABASE_URL: databaseUrl, PGOPTIONS: `-c search_path=${schema}`,
        KEEPANY_SYNC_AUTH_MODE: 'self-host', KEEPANY_SYNC_TOKEN: token,
        KEEPANY_SYNC_WEB_ORIGIN: test.info().project.use.baseURL as string,
        HOST: '127.0.0.1', PORT: String(port),
      },
    });
    let serverLog = '';
    child.stdout?.on('data', chunk => { serverLog += String(chunk).slice(0, 1000); });
    child.stderr?.on('data', chunk => { serverLog += String(chunk).slice(0, 1000); });
    await ready(endpoint, child).catch(error => { throw Error(`${String(error)}: ${serverLog.slice(-2000)}`); });
    const workspaceA = await createWorkspace(endpoint);
    const workspaceB = await createWorkspace(endpoint);
    const keyA = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const keyB = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const firstName = `Browser A ${crypto.randomUUID().slice(0, 8)}`;
    const fromA = `${firstName} changed`;
    const fromB = `${firstName} local`;

    await pageA.goto('/assets/project');
    await pageA.getByRole('button', { name: 'Add', exact: true }).click();
    const addDialog = pageA.getByRole('dialog');
    await addDialog.getByLabel('Name', { exact: true }).fill(firstName);
    await addDialog.getByRole('button', { name: 'Save' }).click();
    await expect(addDialog).toBeHidden();
    await configure(pageA, endpoint, crypto.randomUUID(), keyA);
    await sync(pageA, 'This sync did not complete');
    await pageA.reload();
    await configure(pageA, endpoint, workspaceA, keyA);
    await sync(pageA, 'This sync completed');
    await pageA.reload();
    await pageA.goto('/assets/project');
    await expect(pageA.locator('main .list-row').filter({ hasText: firstName })).toBeVisible();

    await configure(pageB, endpoint, workspaceA, keyA);
    await sync(pageB, 'This sync completed');
    await pageB.reload();
    await pageB.goto('/assets/project');
    await expect(pageB.locator('main .list-row').filter({ hasText: firstName })).toBeVisible();

    contextE = await browser.newContext({ locale: 'en-US' });
    const pageE = await contextE.newPage();
    pageE.setDefaultTimeout(10_000);
    pageE.on('pageerror', error => errors.push(`E: ${error.message}`));
    await configure(pageE, endpoint, workspaceA, keyB);
    await sync(pageE, 'This sync did not complete');
    await pageE.reload();
    await configure(pageE, endpoint, workspaceA, keyA);
    await sync(pageE, 'This sync completed');
    await pageE.goto('/assets/project');
    await expect(pageE.locator('main .list-row').filter({ hasText: firstName })).toBeVisible();
    await configure(pageE, endpoint, workspaceA, keyB);
    await sync(pageE, 'This sync did not complete');
    await pageE.goto('/assets/project');
    await expect(pageE.locator('main .list-row').filter({ hasText: firstName })).toBeVisible();

    await editProject(pageA, firstName, fromA);
    let dropped = false;
    await pageA.route(`${endpoint}/sync/push`, async route => {
      if (dropped || route.request().method() !== 'POST') return route.continue();
      dropped = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    });
    await configure(pageA, endpoint, workspaceA, keyA);
    await sync(pageA, 'This sync did not complete');
    expect(dropped).toBe(true);
    const service = new PostgresSyncService(pool);
    const acceptedOperation = (await service.pull({ workspaceId: workspaceA, cursor: 0, limit: 20 }, accountId)).changes.at(-1)?.operationId;
    expect(acceptedOperation).toBeTruthy();
    await pageA.unroute(`${endpoint}/sync/push`);
    await pageA.reload();
    await configure(pageA, endpoint, workspaceA, keyA);
    await sync(pageA, 'This sync completed');
    const retriedChanges = (await service.pull({ workspaceId: workspaceA, cursor: 0, limit: 20 }, accountId)).changes;
    expect(retriedChanges).toHaveLength(2);
    expect(retriedChanges.at(-1)?.operationId).toBe(acceptedOperation);

    await editProject(pageB, firstName, fromB);
    await configure(pageB, endpoint, workspaceA, keyA);
    await sync(pageB, 'Choose which changes to keep');
    await pageB.locator('.sync-panel .form-grid input').nth(2).fill(workspaceB);
    await pageB.locator('.sync-panel .form-grid input').nth(3).fill(keyB);
    await expect(pageB.getByRole('button', { name: "Keep this device's version" })).toHaveCount(0);
    await sync(pageB, 'This sync did not complete');
    await expect(pageB.getByRole('alert')).toContainText('original server, account, and workspace');
    expect(await pageB.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    if (process.env.KEEPANY_SYNC_EVIDENCE_DIR) {
      await pageB.screenshot({ path: `${process.env.KEEPANY_SYNC_EVIDENCE_DIR}/sync-bound-en.png`, fullPage: true });
      await selectChoice(pageB.getByRole("combobox").first(), 'zh-CN');
      await expect(pageB.getByRole('alert')).toContainText('原服务');
      expect(await pageB.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await pageB.screenshot({ path: `${process.env.KEEPANY_SYNC_EVIDENCE_DIR}/sync-bound-zh.png`, fullPage: true });
      await selectChoice(pageB.getByRole("combobox").first(), 'en');
    }
    expect((await service.pull({ workspaceId: workspaceB, cursor: 0, limit: 20 }, accountId)).changes).toHaveLength(0);
    await pageB.locator('.sync-panel .form-grid input').nth(2).fill(workspaceA);
    await pageB.locator('.sync-panel .form-grid input').nth(3).fill(keyA);
    await sync(pageB, 'Choose which changes to keep');
    await pageB.getByRole('button', { name: "Keep this device's version" }).click();
    await expect(pageB.locator('.sync-panel .notice')).toHaveText('This sync completed');
    expect((await service.pull({ workspaceId: workspaceA, cursor: 0, limit: 20 }, accountId)).changes).toHaveLength(3);

    await pageB.goto('/assets/project');
    await pageB.locator('main .list-row').filter({ hasText: fromB }).click();
    await pageB.getByRole('button', { name: 'Move to trash', exact: true }).click();
    const deleteDialog = pageB.getByRole('dialog');
    await deleteDialog.getByRole('button', { name: 'Move to trash', exact: true }).click();
    await expect(deleteDialog).toBeHidden();
    await pageB.goto('/trash');
    await expect(pageB.locator('main .list-row').filter({ hasText: fromB })).toBeVisible();
    await configure(pageB, endpoint, workspaceA, keyA);
    await sync(pageB, 'This sync completed');
    await configure(pageA, endpoint, workspaceA, keyA);
    await sync(pageA, 'This sync completed');
    await pageA.goto('/assets/project');
    await expect(pageA.locator('main .list-row').filter({ hasText: fromB })).toHaveCount(0);
    const changes = (await service.pull({ workspaceId: workspaceA, cursor: 0, limit: 20 }, accountId)).changes;
    expect(changes.map(change => change.version)).toEqual([1, 2, 3, 4]);
    expect(changes.at(-1)?.tombstone).toBe(true);

    await configure(pageA, endpoint, workspaceB, keyB);
    await sync(pageA, 'This sync did not complete');
    expect((await service.pull({ workspaceId: workspaceB, cursor: 0, limit: 20 }, accountId)).changes).toHaveLength(0);
    await pageA.locator('.sync-panel .form-grid input').nth(2).fill(workspaceA);
    await pageA.locator('.sync-panel .form-grid input').nth(3).fill(keyA);
    await sync(pageA, 'This sync completed');

    const workspaceC = await createWorkspace(endpoint);
    const workspaceD = await createWorkspace(endpoint);
    const keyC = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const keyD = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    contextC = await browser.newContext({ locale: 'en-US' });
    const tabC = await contextC.newPage();
    const tabD = await contextC.newPage();
    tabC.setDefaultTimeout(10_000);
    tabD.setDefaultTimeout(10_000);
    tabC.on('pageerror', error => errors.push(`C: ${error.message}`));
    tabD.on('pageerror', error => errors.push(`D: ${error.message}`));
    await tabC.goto('/assets/project');
    await tabC.getByRole('button', { name: 'Add', exact: true }).click();
    const raceDialog = tabC.getByRole('dialog');
    await raceDialog.getByLabel('Name', { exact: true }).fill('Concurrent local record');
    await raceDialog.getByRole('button', { name: 'Save' }).click();
    await expect(raceDialog).toBeHidden();
    await configure(tabC, endpoint, workspaceC, keyC);
    await configure(tabD, endpoint, workspaceD, keyD);
    await Promise.all([
      tabC.getByRole('button', { name: 'Sync now' }).click(),
      tabD.getByRole('button', { name: 'Sync now' }).click(),
    ]);
    await expect.poll(async () => [
      await tabC.locator('.sync-panel .notice').textContent(),
      await tabD.locator('.sync-panel .notice').textContent(),
    ].sort()).toEqual(['This sync completed', 'This sync did not complete']);
    const cChanges = (await service.pull({ workspaceId: workspaceC, cursor: 0, limit: 10 }, accountId)).changes;
    const dChanges = (await service.pull({ workspaceId: workspaceD, cursor: 0, limit: 10 }, accountId)).changes;
    expect(cChanges.length + dChanges.length).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close(), contextC?.close(), contextE?.close()]);
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await pool.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
