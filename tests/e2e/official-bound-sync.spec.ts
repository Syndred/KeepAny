/**
 * Real, isolated official-bound browser acceptance. The commercial account is
 * an archived synthetic Plus fixture, never a route mock or the live checkout.
 * Run with KEEPANY_TEST_DATABASE_URL pointing at a disposable PostgreSQL DB.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import pg from 'pg';
import { migrateSyncDatabase } from '../../apps/sync-server/src/migrate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const commercialCheckout = resolve(root, '../KeepAnyAdm');
const commercialCommit = '7589b6d';
const databaseUrl = process.env.KEEPANY_TEST_DATABASE_URL;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAAhUlEQVR4nLXNuRXCQBAE0WJCIQlZikEJYZLZ5iGfLOTyYI85Wu3NlPEfn2Pja/vzhXT2c7fzfS+A2rDuV2jYKKgMmzSJYfPcysYCoGysAWqGC6BgeAGyRgAgZcQA4kYYIGhkACJGEsBt5AF8RgnAYVQBVoYAYGpoAMaGDGBgKIGuIQb+jQtZ/TPNXBjnggAAAABJRU5ErkJggg==', 'base64');
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

async function bounded(label: string, work: Promise<unknown>, timeoutMs = 7_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error(`${label}-cleanup-timeout`)), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function freePort(): Promise<number> {
  const listener = createNetServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw Error('loopback-port');
  await new Promise<void>((done, reject) => listener.close(error => error ? reject(error) : done()));
  return address.port;
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(done => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 7_000);
    child.once('exit', () => { clearTimeout(timeout); done(); });
    child.kill('SIGTERM');
  });
}

async function ready(origin: string, child: ChildProcess, path = '/', headers?: Record<string, string>): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw Error(`service-exited-${child.exitCode}`);
    try {
      if ((await fetch(`${origin}${path}`, { headers, signal: AbortSignal.timeout(1_000) })).ok) return;
    } catch { /* startup */ }
    await pause(200);
  }
  throw Error(`service-start-timeout-${new URL(origin).port}`);
}

async function snapshotCommercial(destination: string): Promise<void> {
  assert.equal(execFileSync('git', ['cat-file', '-t', commercialCommit], { cwd: commercialCheckout, encoding: 'utf8' }).trim(), 'commit');
  const lock = execFileSync('git', ['show', `${commercialCommit}:pnpm-lock.yaml`], { cwd: commercialCheckout });
  assert.ok(lock.equals(await readFile(join(commercialCheckout, 'pnpm-lock.yaml'))), 'Commercial dependencies differ from fixed commit');
  await mkdir(destination);
  const archive = execFileSync('git', ['archive', '--format=tar', commercialCommit], {
    cwd: commercialCheckout, maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync('tar', ['-xf', '-', '-C', destination], { input: archive });
  execFileSync('cp', [process.platform === 'darwin' ? '-cR' : '-R',
    join(commercialCheckout, 'node_modules'), join(destination, 'node_modules')]);
  await copyFile(join(destination, 'src/config/db/schema.sqlite.ts'), join(destination, 'src/config/db/schema.ts'));
  await mkdir(join(destination, '.accept-bin'));
  await writeFile(join(destination, '.accept-bin/pnpm'),
    '#!/bin/sh\n[ "$1" = exec ] && [ "$2" = drizzle-kit ] || exit 64\nshift 2\nexec "$PWD/node_modules/.bin/drizzle-kit" "$@"\n',
    { mode: 0o755 });
  execFileSync(join(destination, 'node_modules/.bin/paraglide-js'), [
    'compile', '--project', './project.inlang', '--outdir', './src/paraglide',
    '--strategy', 'url', 'cookie', 'baseLocale', '--output-structure', 'message-modules', '--silent',
  ], { cwd: destination, timeout: 45_000, maxBuffer: 2 * 1024 * 1024 });
}

async function startCommercial(snapshot: string, fixtureRoot: string): Promise<{
  child: ChildProcess; origin: string; secretsPath: string;
}> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/binding-integration-server.ts', '--bound-state-fixture'], {
    cwd: snapshot, env: { ...process.env, TMPDIR: fixtureRoot,
      PATH: `${join(snapshot, '.accept-bin')}:${process.env.PATH ?? ''}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errorBytes = 0;
  child.stdout?.on('data', chunk => { output = `${output}${String(chunk)}`.slice(-16_000); });
  child.stderr?.on('data', chunk => { errorBytes += Buffer.byteLength(chunk); });
  try {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (child.exitCode !== null) throw Error(`commercial-exited-${child.exitCode}-stderr-bytes-${errorBytes}`);
      const origin = output.match(/^Commercial fixture: (http:\/\/127\.0\.0\.1:\d+)$/m)?.[1];
      const secretsPath = output.match(/^Private test material \(mode 0600, read locally if needed\): (.+)$/m)?.[1];
      if (origin && secretsPath && output.includes('Synthetic binding ID:')) {
        assert.ok(secretsPath.startsWith(fixtureRoot), 'fixture-secret-outside-private-root');
        assert.equal((await stat(secretsPath)).mode & 0o077, 0, 'fixture-secret-not-private');
        return { child, origin, secretsPath };
      }
      await pause(200);
    }
    throw Error('commercial-start-timeout');
  } catch (error) { await stop(child); throw error; }
}

async function addProjectWithPhoto(page: Page, webOrigin: string, name: string): Promise<void> {
  await page.goto(`${webOrigin}/assets/project`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByText(name, { exact: true }).first().click();
  await page.getByLabel('Add image').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
  const imageDialog = page.getByRole('dialog');
  await expect(imageDialog.locator('img')).toHaveJSProperty('naturalWidth', 32);
  await imageDialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(imageDialog).toBeHidden();
  await expect(page.locator('img.asset-image')).toHaveJSProperty('naturalWidth', 32);
}

async function approve(accountPage: Page, commercialOrigin: string, code: string): Promise<void> {
  await accountPage.goto(`${commercialOrigin}/settings/connect`);
  await accountPage.getByLabel('Connection code').fill(code);
  await accountPage.getByRole('button', { name: 'Review request' }).click();
  await expect(accountPage.getByText('KeepAny Web', { exact: true })).toBeVisible();
  await accountPage.getByRole('button', { name: 'Approve request' }).click();
  const confirm = accountPage.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Approve request' }).click();
  await expect(accountPage.getByText('Request approved. Finish connecting in the asset app.')).toBeVisible();
}

async function bind(page: Page, accountPage: Page, webOrigin: string, commercialOrigin: string): Promise<void> {
  await page.goto(`${webOrigin}/settings`);
  await page.getByRole('button', { name: 'Authorize official sync read and write' }).click();
  const code = (await page.locator('.binding-code').textContent())?.trim();
  assert.ok(code, 'approval-code-missing');
  await approve(accountPage, commercialOrigin, code);
  await pause(5_200); // Frozen HTTP v1 enforces its five-second poll interval.
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByText('Connection saved on this device').first()).toBeVisible();
  await expect(page.getByText('Read and write access is approved.')).toBeVisible();
  await page.locator('.sync-panel select').first().selectOption('official');
  await expect(page.locator('.sync-panel')).toContainText('Read and write access is approved.');
}

async function sync(page: Page, expected: string): Promise<void> {
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.locator('.sync-panel .notice')).toHaveText(expected, { timeout: 20_000 });
}

async function activeBindingId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((done, reject) => {
      const request = indexedDB.open('keepany-binding-v1');
      request.onsuccess = () => done(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise<Array<{ bindingId: string; status: string }>>((done, reject) => {
        const request = db.transaction('bindings').objectStore('bindings').getAll();
        request.onsuccess = () => done(request.result);
        request.onerror = () => reject(request.error);
      });
      const active = rows.find(row => row.status === 'active');
      if (!active) throw Error('active-binding-not-found');
      return active.bindingId;
    } finally { db.close(); }
  });
}

async function revoke(accountPage: Page, commercialOrigin: string, bindingId: string): Promise<void> {
  const response = await accountPage.context().request.post(`${commercialOrigin}/api/keepany/v1/bindings/revoke`, {
    headers: { Origin: commercialOrigin }, data: { bindingId },
  });
  assert.equal(response.status(), 200, 'real commercial revoke HTTP status');
  const envelope = await response.json() as { code: number; data?: { status: string } };
  assert.equal(envelope.code, 0, 'real commercial revoke response');
  assert.equal(envelope.data?.status, 'revoked');
}

test('official bound sync preserves encrypted records and photos across devices, retries and revocation', async ({ browser }) => {
  test.skip(!databaseUrl, 'Requires KEEPANY_TEST_DATABASE_URL; creates and drops a random schema.');
  test.setTimeout(420_000);
  const temporary = await mkdtemp(join(tmpdir(), 'keepany-official-e2e-'));
  const snapshot = join(temporary, 'commercial');
  const fixtureRoot = join(temporary, 'fixture');
  const schema = `keepany_official_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 });
  const scoped = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 4,
    connectionTimeoutMillis: 5_000 });
  const objects = new Map<string, Buffer>();
  const s3 = createHttpServer(async (request, response) => {
    if (!request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) { response.writeHead(403).end(); return; }
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      objects.set(path, Buffer.concat(chunks));
      response.writeHead(200, { ETag: '"official-photo-test"' }).end();
      return;
    }
    const bytes = objects.get(path);
    if (!bytes) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Length': bytes.length,
      'Content-Type': 'application/vnd.keepany.ciphertext' }).end(bytes);
  });
  let created = false;
  let commercial: Awaited<ReturnType<typeof startCommercial>> | undefined;
  let bridge: ChildProcess | undefined;
  let syncServer: ChildProcess | undefined;
  let web: ChildProcess | undefined;
  const contexts: BrowserContext[] = [];
  try {
    await snapshotCommercial(snapshot);
    await mkdir(fixtureRoot);
    commercial = await startCommercial(snapshot, fixtureRoot);
    await ready(commercial.origin, commercial.child, '/.well-known/jwks.json');
    const secrets = JSON.parse(await readFile(commercial.secretsPath, 'utf8')) as {
      email: string; password: string; readerPrivatePem: string;
    };
    assert.ok(secrets.email && secrets.password && secrets.readerPrivatePem);
    const readerKeyPath = join(temporary, 'reader.pem');
    await writeFile(readerKeyPath, secrets.readerPrivatePem, { mode: 0o600 });
    const jwks = await fetch(`${commercial.origin}/.well-known/jwks.json`).then(response => response.json());

    await admin.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await migrateSyncDatabase(scoped);
    s3.listen(0, '127.0.0.1');
    await once(s3, 'listening');
    const s3Address = s3.address();
    if (!s3Address || typeof s3Address === 'string') throw Error('s3-port');
    const syncOrigin = `http://127.0.0.1:${await freePort()}`;
    const bridgeOrigin = `http://127.0.0.1:${await freePort()}`;
    const webOrigin = `http://127.0.0.1:${await freePort()}`;
    syncServer = spawn(process.execPath, ['--import', 'tsx', 'apps/sync-server/src/main.ts'], {
      cwd: root, stdio: 'ignore', env: {
        ...process.env, DATABASE_URL: databaseUrl, PGOPTIONS: `-c search_path=${schema}`,
        KEEPANY_SYNC_AUTH_MODE: 'bound', KEEPANY_SYNC_TOKEN: '',
        KEEPANY_BOUND_ISSUER: commercial.origin, KEEPANY_SYNC_PUBLIC_ORIGIN: webOrigin,
        KEEPANY_BOUND_JWKS_JSON: JSON.stringify(jwks),
        KEEPANY_BOUND_STATE_COMMERCIAL_ORIGIN: commercial.origin,
        KEEPANY_BOUND_STATE_READER_ISSUER: commercial.origin,
        KEEPANY_BOUND_STATE_READER_KID: 'binding-state-reader-local',
        KEEPANY_BOUND_STATE_READER_PRIVATE_KEY_FILE: readerKeyPath,
        KEEPANY_S3_BUCKET: 'private-official-test', KEEPANY_S3_REGION: 'us-east-1',
        KEEPANY_S3_ENDPOINT: `http://127.0.0.1:${s3Address.port}`,
        KEEPANY_S3_ACCESS_KEY_ID: 'official-test-key', KEEPANY_S3_SECRET_ACCESS_KEY: 'official-test-secret',
        HOST: '127.0.0.1', PORT: new URL(syncOrigin).port,
      },
    });
    bridge = spawn(process.execPath, ['--import', 'tsx', 'apps/binding-bridge/src/main.ts'], {
      cwd: root, stdio: 'ignore', env: { ...process.env,
        KEEPANY_BINDING_ISSUER: commercial.origin,
        KEEPANY_BINDING_WEB_ORIGIN: webOrigin,
        KEEPANY_BINDING_BRIDGE_PORT: new URL(bridgeOrigin).port },
    });
    web = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'apps/web',
      '--host', '127.0.0.1', '--port', new URL(webOrigin).port, '--strictPort'], {
      cwd: root, stdio: 'ignore', env: { ...process.env,
        KEEPANY_SELFHOST_DEV_PROXY_TARGET: syncOrigin,
        VITE_KEEPANY_BINDING_ISSUER: commercial.origin,
        VITE_KEEPANY_BINDING_BRIDGE_ORIGIN: bridgeOrigin,
        VITE_KEEPANY_OFFICIAL_SYNC_ORIGIN: webOrigin },
    });
    await Promise.all([
      ready(syncOrigin, syncServer, '/healthz'),
      ready(bridgeOrigin, bridge, '/.well-known/jwks.json', { Origin: webOrigin }),
      ready(webOrigin, web),
    ]);
    const contextA = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
    const contextB = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 } });
    const accountContext = await browser.newContext({ locale: 'en-US' });
    contexts.push(contextA, contextB, accountContext);
    for (const context of [contextA, contextB]) {
      await context.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
    }
    const login = await accountContext.request.post(`${commercial.origin}/api/auth/sign-in/email`, {
      headers: { Origin: commercial.origin }, data: { email: secrets.email, password: secrets.password },
    });
    assert.equal(login.status(), 200, 'synthetic-account-login');
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const accountPage = await accountContext.newPage();
    for (const page of [pageA, pageB, accountPage]) page.setDefaultTimeout(10_000);
    let refreshB = 0;
    pageB.on('request', request => {
      if (new URL(request.url()).pathname === '/api/keepany/v1/bindings/refresh') refreshB++;
    });
    const errors: string[] = [];
    pageA.on('pageerror', error => errors.push(`A: ${error.message}`));
    pageB.on('pageerror', error => errors.push(`B: ${error.message}`));
    const assetName = `Official photo ${randomUUID().slice(0, 8)}`;
    await addProjectWithPhoto(pageA, webOrigin, assetName);
    await bind(pageA, accountPage, webOrigin, commercial.origin);
    await pageA.getByRole('button', { name: 'Create workspace and key' }).click();
    await expect(pageA.locator('.sync-panel .form-grid input').nth(1)).toHaveValue(/^[0-9a-f-]{36}$/i, { timeout: 20_000 });
    const workspaceId = await pageA.locator('.sync-panel .form-grid input').nth(1).inputValue();
    const workspaceKey = await pageA.locator('.sync-panel .form-grid input').nth(2).inputValue();
    assert.match(workspaceId, /^[0-9a-f-]{36}$/i);
    assert.ok(workspaceKey.length >= 43, 'workspace-key-missing');
    await pageA.getByLabel('I have saved the workspace key in a safe place').click();
    await expect(pageA.getByLabel('I have saved the workspace key in a safe place')).toBeHidden();
    await pageA.getByRole('button', { name: 'Check local status' }).click();
    await expect(pageA.locator('.sync-panel .notice')).toHaveText('Changes waiting to sync');
    await expect(pageA.getByRole('button', { name: 'Sync now' })).toBeEnabled();

    let dropped = false;
    await pageA.route(`${webOrigin}/sync/push`, async route => {
      if (dropped || route.request().method() !== 'POST') return route.continue();
      dropped = true;
      const accepted = await route.fetch();
      expect(accepted.ok()).toBe(true);
      await route.abort('failed');
    });
    await sync(pageA, 'This sync did not complete');
    assert.equal(dropped, true, 'accepted-push-response-not-dropped');
    await pageA.unroute(`${webOrigin}/sync/push`);
    await sync(pageA, 'This sync completed');
    const changes = await scoped.query<{ ciphertext: string }>(
      'SELECT ciphertext FROM sync_changes WHERE workspace_id=$1 ORDER BY sequence', [workspaceId]);
    assert.equal(changes.rowCount, 1, 'retry must not duplicate accepted operation');
    assert.ok(!JSON.stringify(changes.rows).includes(assetName), 'server saw cleartext asset');
    assert.equal((await scoped.query('SELECT 1 FROM sync_operations WHERE workspace_id=$1', [workspaceId])).rowCount, 1,
      'retry must retain one operation ID');
    assert.ok(objects.size > 0, 'encrypted photo not uploaded');
    for (const bytes of objects.values()) assert.ok(!bytes.includes(png), 'S3 saw cleartext photo');

    await bind(pageB, accountPage, webOrigin, commercial.origin);
    const fieldsB = pageB.locator('.sync-panel .form-grid input');
    const foreignWorkspace = randomUUID();
    await scoped.query('INSERT INTO sync_workspaces (workspace_id) VALUES ($1)', [foreignWorkspace]);
    await scoped.query('INSERT INTO sync_memberships (workspace_id,subject_id,can_read,can_write) VALUES ($1,$2,true,true)',
      [foreignWorkspace, 'keepanyadm:other']);
    await fieldsB.nth(1).fill(foreignWorkspace);
    await fieldsB.nth(2).fill(workspaceKey);
    await sync(pageB, 'This sync did not complete');
    assert.equal((await scoped.query('SELECT 1 FROM sync_changes WHERE workspace_id=$1', [foreignWorkspace])).rowCount, 0);
    await fieldsB.nth(1).fill(workspaceId);
    await fieldsB.nth(2).fill(Buffer.alloc(32, 7).toString('base64url'));
    await sync(pageB, 'This sync did not complete');
    await pageB.goto(`${webOrigin}/assets/project`);
    await expect(pageB.getByText(assetName, { exact: true })).toHaveCount(0);
    await pageB.goto(`${webOrigin}/settings`);
    await pageB.locator('.sync-panel .form-grid input').nth(1).fill(workspaceId);
    await pageB.locator('.sync-panel .form-grid input').nth(2).fill(workspaceKey);
    await sync(pageB, 'This sync completed');
    const bindingIdA = await activeBindingId(pageA);
    const bindingIdB = await activeBindingId(pageB);
    await pageB.getByRole('button', { name: 'View device access' }).click();
    await expect(pageB.locator('.binding-devices')).toContainText(bindingIdA);
    await expect(pageB.locator('.binding-devices')).toContainText(bindingIdB);
    await expect(pageB.locator('.binding-devices')).toContainText('This browser');
    await pageB.goto(`${webOrigin}/assets/project`);
    await pageB.getByText(assetName, { exact: true }).first().click();
    await expect(pageB.locator('img.asset-image')).toHaveJSProperty('naturalWidth', 32);
    assert.ok(await scoped.query('SELECT 1 FROM sync_bound_bindings WHERE status=$1', ['active']).then(result => (result.rowCount ?? 0) >= 2));

    // A trusted dataset also refuses later key replacement without local loss.
    await pageB.goto(`${webOrigin}/settings`);
    await pageB.locator('.sync-panel .form-grid input').nth(2).fill(Buffer.alloc(32, 7).toString('base64url'));
    await sync(pageB, 'This sync did not complete');
    await pageB.locator('.sync-panel .form-grid input').nth(2).fill(workspaceKey);
    await sync(pageB, 'This sync completed');
    await pageB.getByRole('button', { name: 'View device access' }).click();
    await expect(pageB.locator('.binding-devices')).toContainText(bindingIdA);
    await expect(pageB.locator('.binding-devices')).toContainText(bindingIdB);
    const evidenceDir = resolve(root, 'docs/evidence/2026-09-29');
    await mkdir(evidenceDir, { recursive: true });
    for (const width of [390, 1280]) {
      await pageB.setViewportSize({ width, height: 844 });
      for (const language of ['en', 'zh-CN'] as const) {
        await pageB.locator('select').first().selectOption(language);
        await expect(pageB.locator('.sync-panel')).toContainText(
          language === 'en' ? 'Official account connection' : '官方账号连接');
        expect(await pageB.evaluate(() => document.documentElement.scrollWidth))
          .toBeLessThanOrEqual(width + 1);
        await pageB.screenshot({ path: join(evidenceDir, `device-access-${language}-${width}.png`), fullPage: true });
      }
    }
    await pageB.locator('select').first().selectOption('en');
    const refreshBeforeExpiry = refreshB;
    await pause(61_000); // The commercial access JWT is valid for at most 60 seconds.
    await sync(pageB, 'This sync completed');
    assert.ok(refreshB > refreshBeforeExpiry, 'browser did not refresh the short bound access token');

    // The saved browser profile retains local CRUD and a genuine .ka1 backup
    // even after the commercial account has revoked its cloud binding.
    await revoke(accountPage, commercial.origin, bindingIdB);
    for (let attempt = 0; attempt < 40; attempt++) {
      const state = await scoped.query<{ status: string }>('SELECT status FROM sync_bound_bindings WHERE binding_id=$1', [bindingIdB]);
      if (state.rows[0]?.status === 'revoked') break;
      await pause(250);
    }
    assert.equal((await scoped.query<{ status: string }>('SELECT status FROM sync_bound_bindings WHERE binding_id=$1',
      [bindingIdB])).rows[0]?.status, 'revoked', 'commercial revoke must reach bound-state tombstone');
    await pageA.goto(`${webOrigin}/settings`);
    await pageA.getByRole('button', { name: 'View device access' }).click();
    await expect(pageA.locator('.binding-devices li').filter({ hasText: bindingIdB })).toContainText('Authorization revoked');
    await pageA.locator('.sync-panel .form-grid input').nth(2).fill(workspaceKey);
    await sync(pageB, 'This sync did not complete');
    const sqliteUrl = `file:${join(dirname(commercial.secretsPath), 'fixture.db')}`;
    execFileSync(process.execPath, ['--input-type=module', '-e',
      'import { createClient } from "@libsql/client"; const db=createClient({url:process.argv[1]}); const result=await db.execute({sql:"UPDATE subscription SET current_period_end=?",args:[Date.now()-1000]}); db.close(); if(result.rowsAffected<1) process.exit(2);',
      sqliteUrl], { cwd: snapshot, timeout: 10_000, stdio: 'ignore' });
    let expiredEntitlement = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const row = await scoped.query<{ status: string; expired: boolean }>(
        'SELECT status,state_expires_at<=now() AS expired FROM sync_bound_bindings WHERE binding_id=$1', [bindingIdA]);
      if (row.rows[0] && (row.rows[0].status !== 'active' || row.rows[0].expired)) {
        expiredEntitlement = true;
        break;
      }
      await pause(300);
    }
    assert.equal(expiredEntitlement, true, 'expired synthetic Plus did not invalidate bound state lease');
    await sync(pageA, 'This sync did not complete');
    await pageB.goto(`${webOrigin}/assets/project`);
    await expect(pageB.getByText(assetName, { exact: true }).first()).toBeVisible();
    await pageB.getByRole('button', { name: 'Add', exact: true }).click();
    const localDialog = pageB.getByRole('dialog');
    await localDialog.getByLabel('Name', { exact: true }).fill('Still local after revoke');
    await localDialog.getByRole('button', { name: 'Save' }).click();
    await expect(pageB.getByText('Still local after revoke', { exact: true }).first()).toBeVisible();
    await pageB.goto(`${webOrigin}/intake`);
    const backupPassword = `test-only-${randomUUID()}`;
    await pageB.locator('#backup-password').fill(backupPassword);
    await pageB.getByRole('button', { name: 'Create backup' }).click();
    const link = pageB.getByRole('link', { name: 'Save backup file' });
    await expect(link).toBeVisible();
    const download = await Promise.all([pageB.waitForEvent('download'), link.click()]).then(([item]) => item);
    assert.ok(download.suggestedFilename().endsWith('.ka1'), 'not a .ka1 backup');
    const backupPath = await download.path();
    assert.ok(backupPath);
    const contextC = await browser.newContext({ locale: 'en-US' });
    contexts.push(contextC);
    await contextC.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
    const pageC = await contextC.newPage();
    await pageC.goto(`${webOrigin}/intake`);
    await pageC.locator('#backup-password').fill(backupPassword);
    await pageC.locator('#restore-file').setInputFiles(backupPath);
    await pageC.getByRole('button', { name: 'Preview', exact: true }).first().click();
    await pageC.getByRole('button', { name: /Confirm ·/ }).click();
    await expect(pageC.getByText(/Restored \d+ records/)).toBeVisible();
    await pageC.goto(`${webOrigin}/assets/project`);
    await expect(pageC.getByText('Still local after revoke', { exact: true }).first()).toBeVisible();
    await pageC.getByText(assetName, { exact: true }).first().click();
    await expect(pageC.locator('img.asset-image')).toHaveJSProperty('naturalWidth', 32);
    assert.deepEqual(errors, [], 'uncaught browser error');
  } finally {
    const cleanupFailures: string[] = [];
    const clean = async (label: string, work: Promise<unknown>) => {
      try { await bounded(label, work); } catch { cleanupFailures.push(label); }
    };
    await Promise.all(contexts.map(context => clean('browser-context', context.close())));
    await Promise.all([stop(web), stop(bridge), stop(syncServer), stop(commercial?.child)].map(
      work => clean('child-process', work)));
    if (s3.listening) {
      s3.closeAllConnections();
      await clean('s3', new Promise<void>(done => s3.close(() => done())));
    }
    await clean('scoped-pg', scoped.end());
    try { if (created) await clean('schema-drop', admin.query(`DROP SCHEMA "${schema}" CASCADE`)); }
    finally {
      await clean('admin-pg', admin.end());
      await clean('temporary-files', rm(temporary, { recursive: true, force: true }));
    }
    expect(cleanupFailures, 'isolated services, schema and files must be cleaned').toEqual([]);
  }
});
