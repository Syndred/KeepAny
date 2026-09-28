import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { migrateSyncDatabase } from '../../apps/sync-server/src/migrate';

const databaseUrl = process.env.KEEPANY_TEST_DATABASE_URL;
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

async function waitForUrl(url: string, child: ChildProcess, logs: () => string): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw Error(`process-exit-${child.exitCode}: ${logs().slice(-2000)}`);
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`process-start-timeout: ${logs().slice(-2000)}`);
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function selectSession(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/settings`);
  await page.getByLabel('Connection method').selectOption('session');
  await expect(page.getByText('Not signed in to the self-hosted service')).toBeVisible();
}

async function signUp(page: Page, email: string, name: string, password: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(`Signed in: ${email}`)).toBeVisible();
}

async function createWorkspace(page: Page): Promise<{ workspaceId: string; key: string }> {
  await page.getByRole('button', { name: 'Create workspace and key' }).click();
  const form = page.locator('.sync-panel .form-grid');
  await expect(form.getByLabel('Workspace ID')).not.toHaveValue('');
  const workspaceId = await form.getByLabel('Workspace ID').inputValue();
  const key = await form.getByLabel('Workspace key').inputValue();
  expect(key.length).toBeGreaterThan(30);
  await page.getByLabel('I have saved the workspace key in a safe place').click();
  await expect(page.getByLabel('I have saved the workspace key in a safe place')).toHaveCount(0);
  return { workspaceId, key };
}

async function addRecordWithPhoto(page: Page, origin: string, name: string): Promise<void> {
  await page.goto(`${origin}/assets/project`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await page.getByText(name, { exact: true }).first().click();
  await page.getByLabel('Add image').setInputFiles({ name: 'session-test.png', mimeType: 'image/png', buffer: png });
  const preview = page.getByRole('dialog');
  await expect(preview.locator('img')).toHaveJSProperty('naturalWidth', 32);
  await preview.getByRole('button', { name: 'Confirm' }).click();
  await expect(preview).toBeHidden();
  await expect(page.locator('img.asset-image')).toHaveJSProperty('naturalWidth', 32);
}

async function sync(page: Page, origin: string, workspace: { workspaceId: string; key: string }, expected: string): Promise<void> {
  await page.goto(`${origin}/settings`);
  await expect(page.getByText('Signed in:')).toBeVisible();
  await page.getByLabel('Workspace ID').fill(workspace.workspaceId);
  await page.getByLabel('Workspace key').fill(workspace.key);
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.locator('.sync-panel .notice')).toHaveText(expected);
}

async function identity(page: Page): Promise<string> {
  const response = await page.evaluate(async () => {
    const result = await fetch('/sync/identity', { method: 'POST', credentials: 'include' });
    return { status: result.status, body: await result.json() };
  });
  expect(response.status).toBe(200);
  return (response.body as { accountId: string }).accountId;
}

async function requestAs(page: Page, path: string, options: { method?: string; accountId?: string; body?: unknown } = {}) {
  return page.evaluate(async ({ path, method, accountId, body }) => {
    const response = await fetch(path, { method: method ?? 'GET', credentials: 'include',
      headers: { ...(accountId ? { 'X-KeepAny-Account-Id': accountId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.text() };
  }, { path, ...options });
}

test('self-hosted sessions keep two users, encrypted records and photos in separate workspaces', async ({ browser }) => {
  test.skip(!databaseUrl, 'Requires a disposable PostgreSQL; creates and drops its own schema.');
  test.setTimeout(180_000);
  const schema = `keepany_session_browser_${crypto.randomUUID().replaceAll('-', '')}`;
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
      response.writeHead(200, { ETag: '"session-test"' }).end();
      return;
    }
    const bytes = objects.get(path);
    if (!bytes) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Length': bytes.length, 'Content-Type': 'application/vnd.keepany.ciphertext' }).end(bytes);
  });
  const contextA = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } });
  const contextB = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } });
  let contextC: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  pageA.setDefaultTimeout(10_000);
  pageB.setDefaultTimeout(10_000);
  const errors: string[] = [];
  pageA.on('pageerror', error => errors.push(`A: ${error.message}`));
  pageB.on('pageerror', error => errors.push(`B: ${error.message}`));
  let web: ChildProcess | undefined;
  let syncServer: ChildProcess | undefined;
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await migrateSyncDatabase(pool);
    s3Mock.listen(0, '127.0.0.1');
    await once(s3Mock, 'listening');
    const s3Address = s3Mock.address();
    if (!s3Address || typeof s3Address === 'string') throw Error('s3-address');
    const serverPort = await freePort();
    const webPort = await freePort();
    const serverOrigin = `http://127.0.0.1:${serverPort}`;
    const webOrigin = `http://127.0.0.1:${webPort}`;
    let serverLog = '';
    syncServer = spawn('node_modules/.bin/tsx', ['apps/sync-server/src/main.ts'], {
      cwd: process.cwd(), stdio: 'pipe', env: {
        ...process.env, DATABASE_URL: databaseUrl, PGOPTIONS: `-c search_path=${schema}`,
        KEEPANY_SYNC_AUTH_MODE: 'self-host-session', KEEPANY_SYNC_PUBLIC_ORIGIN: webOrigin,
        BETTER_AUTH_SECRET: `browser-session-only-${crypto.randomUUID()}-${crypto.randomUUID()}`,
        KEEPANY_SESSION_ALLOW_SIGNUP: 'true',
        KEEPANY_S3_BUCKET: 'private-session-test', KEEPANY_S3_REGION: 'us-east-1',
        KEEPANY_S3_ENDPOINT: `http://127.0.0.1:${s3Address.port}`,
        KEEPANY_S3_ACCESS_KEY_ID: 'session-test-key', KEEPANY_S3_SECRET_ACCESS_KEY: 'session-test-secret',
        HOST: '127.0.0.1', PORT: String(serverPort),
      },
    });
    syncServer.stdout?.on('data', chunk => { serverLog += String(chunk).slice(0, 1000); });
    syncServer.stderr?.on('data', chunk => { serverLog += String(chunk).slice(0, 1000); });
    await waitForUrl(`${serverOrigin}/healthz`, syncServer, () => serverLog);
    let webLog = '';
    web = spawn('node_modules/.bin/vite', ['apps/web', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
      cwd: process.cwd(), stdio: 'pipe', env: { ...process.env, KEEPANY_SELFHOST_DEV_PROXY_TARGET: serverOrigin },
    });
    web.stdout?.on('data', chunk => { webLog += String(chunk).slice(0, 1000); });
    web.stderr?.on('data', chunk => { webLog += String(chunk).slice(0, 1000); });
    await waitForUrl(webOrigin, web, () => webLog);

    const password = `session-test-${crypto.randomUUID()}-Safe1!`;
    const emailA = `session-a-${crypto.randomUUID()}@example.invalid`;
    const emailB = `session-b-${crypto.randomUUID()}@example.invalid`;
    const recordA = `Session A ${crypto.randomUUID().slice(0, 8)}`;
    const recordB = `Session B ${crypto.randomUUID().slice(0, 8)}`;
    await selectSession(pageA, webOrigin);
    await signUp(pageA, emailA, 'Session A', password);
    const accountA = await identity(pageA);
    const workspaceA = await createWorkspace(pageA);
    await addRecordWithPhoto(pageA, webOrigin, recordA);
    await sync(pageA, webOrigin, workspaceA, 'This sync completed');
    expect((await pool.query('SELECT count(*)::int AS count FROM sync_attachments WHERE workspace_id=$1', [workspaceA.workspaceId])).rows[0].count).toBe(2);
    expect([...objects.values()].every(bytes => !bytes.includes(png) && !bytes.includes(Buffer.from(recordA)))).toBe(true);

    await selectSession(pageB, webOrigin);
    await signUp(pageB, emailB, 'Session B', password);
    const accountB = await identity(pageB);
    expect(accountB).not.toBe(accountA);
    const workspaceB = await createWorkspace(pageB);
    await addRecordWithPhoto(pageB, webOrigin, recordB);
    await sync(pageB, webOrigin, workspaceB, 'This sync completed');
    expect((await pool.query('SELECT count(*)::int AS count FROM sync_attachments WHERE workspace_id=$1', [workspaceB.workspaceId])).rows[0].count).toBe(2);
    expect(objects.size).toBe(4);
    expect([...objects.values()].every(bytes => !bytes.includes(png) && !bytes.includes(Buffer.from(recordA)) &&
      !bytes.includes(Buffer.from(recordB)))).toBe(true);

    contextC = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } });
    const pageC = await contextC.newPage();
    pageC.setDefaultTimeout(10_000);
    pageC.on('pageerror', error => errors.push(`C: ${error.message}`));
    await selectSession(pageC, webOrigin);
    await pageC.getByLabel('Email address').fill(emailA);
    await pageC.getByLabel('Password', { exact: true }).fill(password);
    await pageC.getByRole('button', { name: 'Sign in' }).click();
    await expect(pageC.getByText(`Signed in: ${emailA}`)).toBeVisible();
    expect(await identity(pageC)).toBe(accountA);
    await expect(pageC.getByLabel('Choose an existing workspace').locator(`option[value="${workspaceA.workspaceId}"]`)).toHaveCount(1);
    await pageC.getByLabel('Choose an existing workspace').selectOption(workspaceA.workspaceId);
    await pageC.getByLabel('Workspace key').fill(workspaceA.key);
    await pageC.getByRole('button', { name: 'Sync now' }).click();
    await expect(pageC.locator('.sync-panel .notice')).toHaveText('This sync completed');
    await pageC.goto(`${webOrigin}/assets/project`);
    await pageC.getByText(recordA, { exact: true }).first().click();
    await expect(pageC.locator('img.asset-image')).toHaveJSProperty('naturalWidth', 32);
    expect(await pageC.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    const workspacesB = await requestAs(pageB, '/workspaces', { accountId: accountB });
    expect(workspacesB.status).toBe(200);
    expect(workspacesB.body).toContain(workspaceB.workspaceId);
    expect(workspacesB.body).not.toContain(workspaceA.workspaceId);
    expect((await requestAs(pageB, '/sync/pull', { method: 'POST', accountId: accountB,
      body: { workspaceId: workspaceA.workspaceId, cursor: 0, limit: 10 } })).status).toBe(403);
    expect((await requestAs(pageB, `/workspaces/${workspaceA.workspaceId}/attachments/${(await pool.query('SELECT attachment_id FROM sync_attachments WHERE workspace_id=$1', [workspaceA.workspaceId])).rows[0].attachment_id}`,
      { accountId: accountB })).status).toBe(403);
    expect((await requestAs(pageB, '/sync/preflight', { method: 'POST', accountId: accountB,
      body: { workspaceId: workspaceA.workspaceId } })).status).toBe(403);
    expect((await requestAs(pageB, '/workspaces', { accountId: accountA })).status).toBe(401);
    expect((await fetch(`${serverOrigin}/workspaces`, { headers: {
      Cookie: 'better-auth.session_token=invalid', 'X-KeepAny-Account-Id': accountB,
    } })).status).toBe(401);
    const cookiesB = (await contextB.cookies(webOrigin)).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    expect(cookiesB).toContain('session_token');
    expect((await fetch(`${serverOrigin}/workspaces`, { method: 'POST', headers: {
      Cookie: cookiesB, Origin: 'http://untrusted.example', 'X-KeepAny-Account-Id': accountB,
    } })).status).toBe(403);

    for (const [page, origin, record] of [[pageA, webOrigin, recordA], [pageB, webOrigin, recordB]] as const) {
      await page.reload();
      await expect(page.getByText('Signed in:')).toBeVisible();
      await page.goto(`${origin}/assets/project`);
      await expect(page.getByText(record, { exact: true })).toBeVisible();
      await page.getByText(record, { exact: true }).first().click();
      await expect(page.locator('img.asset-image')).toHaveJSProperty('naturalWidth', 32);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    }
    if (process.env.KEEPANY_SYNC_EVIDENCE_DIR) {
      await pageA.screenshot({ path: `${process.env.KEEPANY_SYNC_EVIDENCE_DIR}/session-record-photo-en-390.png`, fullPage: true });
    }
    await pageB.evaluate(() => localStorage.setItem('keepany-language', 'zh-CN'));
    await pageB.reload();
    await expect(pageB.locator('img.asset-image')).toHaveJSProperty('naturalWidth', 32);
    expect(await pageB.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    if (process.env.KEEPANY_SYNC_EVIDENCE_DIR) {
      await pageB.screenshot({ path: `${process.env.KEEPANY_SYNC_EVIDENCE_DIR}/session-record-photo-zh-390.png`, fullPage: true });
    }
    await pageB.goto(`${webOrigin}/settings`);
    await expect(pageB.getByText(`已登录：${emailB}`)).toBeVisible();
    await expect(pageB.getByLabel('选择已有工作区').locator(`option[value="${workspaceB.workspaceId}"]`)).toHaveCount(1);
    await pageB.getByLabel('选择已有工作区').selectOption(workspaceB.workspaceId);
    expect(await pageB.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    if (process.env.KEEPANY_SYNC_EVIDENCE_DIR) {
      await pageA.goto(`${webOrigin}/settings`);
      await expect(pageA.getByText(`Signed in: ${emailA}`)).toBeVisible();
      await expect(pageA.getByLabel('Choose an existing workspace').locator(`option[value="${workspaceA.workspaceId}"]`)).toHaveCount(1);
      await pageA.getByLabel('Choose an existing workspace').selectOption(workspaceA.workspaceId);
      await pageA.screenshot({ path: `${process.env.KEEPANY_SYNC_EVIDENCE_DIR}/session-en-390.png`, fullPage: true });
      await pageB.screenshot({ path: `${process.env.KEEPANY_SYNC_EVIDENCE_DIR}/session-zh-390.png`, fullPage: true });
    }

    await pageA.goto(`${webOrigin}/settings`);
    await pageA.getByRole('button', { name: 'Sign out' }).click();
    await expect(pageA.getByText('Not signed in to the self-hosted service')).toBeVisible();
    expect((await requestAs(pageA, '/sync/identity', { method: 'POST' })).status).toBe(401);
    expect((await requestAs(pageA, '/workspaces', { accountId: accountA })).status).toBe(401);
    await pageA.getByLabel('Email address').fill(emailB);
    await pageA.getByLabel('Password', { exact: true }).fill(password);
    await pageA.getByRole('button', { name: 'Sign in' }).click();
    await expect(pageA.getByText(`Signed in: ${emailB}`)).toBeVisible();
    const formA = pageA.locator('.sync-panel .form-grid');
    await formA.getByLabel('Workspace ID').fill(workspaceB.workspaceId);
    await formA.getByLabel('Workspace key').fill(workspaceB.key);
    await pageA.getByRole('button', { name: 'Sync now' }).click();
    await expect(pageA.locator('.sync-panel .notice')).toHaveText('This sync did not complete');
    await expect(pageA.getByRole('alert')).toContainText('linked to their original server, account, and workspace');
    expect((await pool.query('SELECT count(*)::int AS count FROM sync_operations WHERE workspace_id=$1', [workspaceB.workspaceId])).rows[0].count).toBe(1);
    await pageA.goto(`${webOrigin}/assets/project`);
    await expect(pageA.getByText(recordA, { exact: true })).toBeVisible();
    await expect(pageA.getByText(recordB, { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close(), contextC?.close()]);
    await Promise.allSettled([stop(web), stop(syncServer)]);
    if (s3Mock.listening) {
      s3Mock.closeAllConnections();
      await new Promise<void>((resolve, reject) => s3Mock.close(error => error ? reject(error) : resolve()));
    }
    await pool.end();
    if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
