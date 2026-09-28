/**
 * Isolated real-service browser acceptance for the frozen binding HTTP v1 protocol.
 * Strict dialog gate: pnpm exec tsx scripts/binding-web-cross-process.ts
 * Protocol-only gate: pnpm exec tsx scripts/binding-web-cross-process.ts --protocol-only
 * The commercial app is archived from the reviewed commit into a temporary tree.
 * Its fixture account, SQLite database, bridge, and Web instance are all ephemeral.
 * Nothing is written into the adjacent KeepAnyAdm checkout.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, type Page } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commercialCheckout = resolve(root, '../KeepAnyAdm');
const reviewedCommit = '7589b6d';
const commercialPort = 3199;
const protocolOnly = process.argv.includes('--protocol-only');
const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

async function freePort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw Error('No loopback port');
  await new Promise<void>(done => listener.close(() => done()));
  return address.port;
}

async function requireFreePort(port: number): Promise<void> {
  const listener = createServer();
  try {
    listener.listen(port, '127.0.0.1');
    await once(listener, 'listening');
  } catch {
    throw Error(`Port ${port} is occupied; existing process left untouched`);
  } finally {
    if (listener.listening) await new Promise<void>(done => listener.close(() => done()));
  }
}

async function stop(child?: ChildProcess): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(done => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 7_000);
    child.once('exit', () => { clearTimeout(timeout); done(); });
    child.kill('SIGTERM');
  });
}

async function snapshotCommercial(destination: string): Promise<void> {
  assert.equal(execFileSync('git', ['cat-file', '-t', reviewedCommit], { cwd: commercialCheckout, encoding: 'utf8' }).trim(), 'commit');
  const lock = execFileSync('git', ['show', `${reviewedCommit}:pnpm-lock.yaml`], { cwd: commercialCheckout });
  assert.ok(lock.equals(await readFile(join(commercialCheckout, 'pnpm-lock.yaml'))), 'Installed commercial dependencies differ from reviewed lockfile');
  await mkdir(destination);
  const archive = execFileSync('git', ['archive', '--format=tar', reviewedCommit], {
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

async function ready(origin: string, child: ChildProcess, path = '/', headers?: Record<string, string>): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw Error(`Service exited during startup (${child.exitCode})`);
    try {
      const response = await fetch(`${origin}${path}`, { headers, signal: AbortSignal.timeout(800) });
      if (response.ok) return;
    } catch { /* still starting */ }
    await pause(200);
  }
  throw Error(`Service startup timed out: ${origin}`);
}

async function fixtureSecretPath(child: ChildProcess, fixtureRoot: string): Promise<string> {
  let output = '';
  let errorTail = '';
  child.stdout?.on('data', chunk => { output = `${output}${String(chunk)}`.slice(-16_000); });
  child.stderr?.on('data', chunk => { errorTail = `${errorTail}${String(chunk)}`.slice(-400); });
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) {
      const hint = /Cannot find package|Cannot find module|Temporary fixture schema setup failed|Run pnpm db:setup|spawn pnpm ENOENT/.exec(errorTail)?.[0] ?? '';
      throw Error(`Commercial fixture exited (${child.exitCode})${hint ? `: ${hint}` : ''}`);
    }
    const origin = output.match(/^Commercial fixture: (http:\/\/127\.0\.0\.1:\d+)/m)?.[1];
    const path = output.match(/^Private test material \(mode 0600, read locally if needed\): (.+)$/m)?.[1];
    if (origin && path) {
      assert.equal(origin, `http://127.0.0.1:${commercialPort}`, 'Commercial fixture must use isolated port 3199');
      assert.ok(path.startsWith(fixtureRoot), 'Fixture secret escaped its private temp root');
      assert.equal((await stat(path)).mode & 0o077, 0, 'Fixture secrets must be mode 0600');
      return path;
    }
    await pause(200);
  }
  const directories = await readdir(fixtureRoot);
  throw Error(`Commercial fixture startup timed out (${directories.length} temporary directories)`);
}

async function addLocalProject(page: Page, name: string, webOrigin: string): Promise<void> {
  await page.goto(`${webOrigin}/assets/project`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(name).first()).toBeVisible();
}

async function localCredentialCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((done, reject) => {
      const request = indexedDB.open('keepany-binding-v1');
      request.onsuccess = () => done(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((done, reject) => {
        const request = db.transaction('credentials').objectStore('credentials').count();
        request.onsuccess = () => done(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

async function approveInAccount(page: Page, commercialOrigin: string, code: string, account: string): Promise<void> {
  await page.goto(`${commercialOrigin}/settings/connect`);
  await page.getByLabel('Connection code').fill(code);
  await page.getByRole('button', { name: 'Review request' }).click();
  await expect(page.getByText('KeepAny Web', { exact: true })).toBeVisible();
  await expect.poll(async () => (await page.locator('body').innerText()).includes(account),
    { timeout: 10_000 }).toBe(true);
  await page.getByRole('button', { name: 'Approve request' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByText(/KeepAny Web/)).toBeVisible();
  await expect.poll(async () => (await confirm.innerText()).includes(account)).toBe(true);
  await confirm.getByRole('button', { name: 'Approve request' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText('Request approved. Finish connecting in the asset app.')).toBeVisible();
}

async function bindInWeb(webPage: Page, accountPage: Page, webOrigin: string,
  commercialOrigin: string, account: string): Promise<void> {
  await webPage.goto(`${webOrigin}/settings`);
  await webPage.getByRole('button', { name: 'Start connecting' }).click();
  const code = (await webPage.locator('.binding-code').textContent())?.trim();
  assert.ok(code, 'Web did not display approval code');
  await approveInAccount(accountPage, commercialOrigin, code, account);
  await pause(5_200); // v1 server and local repository both enforce a five-second poll interval.
  await webPage.getByRole('button', { name: 'Check status' }).click();
  await expect(webPage.getByText('Connection saved on this device').first()).toBeVisible();
  await webPage.reload();
  await expect(webPage.getByText('Connection saved on this device').first()).toBeVisible();
  await webPage.getByRole('button', { name: 'Check status' }).click();
  await expect(webPage.getByText('Authorization is active')).toBeVisible();
}

async function revokeInAccount(page: Page, commercialOrigin: string, instanceName = 'KeepAny Web'): Promise<void> {
  await page.goto(`${commercialOrigin}/settings/connect`);
  const remove = page.getByRole('button', { name: 'Remove access' });
  await expect(remove).toHaveCount(1);
  await remove.click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByText(instanceName, { exact: false })).toBeVisible();
  await confirm.getByRole('button', { name: 'Remove access' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText('No approved app access yet.')).toBeVisible();
}

async function auditCommercialDialogs(page: Page, commercialOrigin: string, account: string): Promise<string[]> {
  const layoutFailures: string[] = [];
  const publicJwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
  const longName = `KeepAny ${'L'.repeat(72)}`; // Protocol maximum is 80 characters.
  const request = await fetch(`${commercialOrigin}/api/keepany/v1/bindings/device`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instanceId: randomBytes(32).toString('base64url'), instanceName: longName,
      scopes: ['sync:read'], devicePublicKey: publicJwk,
    }),
  });
  assert.equal(request.status, 200, 'Real commercial device endpoint rejected matrix challenge');
  const envelope = await request.json() as { code: number; data?: { userCode: string } };
  assert.equal(envelope.code, 0);
  const code = envelope.data?.userCode;
  assert.ok(code);
  for (const language of ['en', 'zh'] as const) {
    const label = language === 'en' ? 'Connection code' : '连接验证码';
    const review = language === 'en' ? 'Review request' : '查看请求';
    const approve = language === 'en' ? 'Approve request' : '批准请求';
    const cancel = language === 'en' ? 'Cancel' : '取消';
    for (const width of [360, 390, 768, 1280, 1440]) {
      console.info(`Commercial dialog audit: ${language}/${width}`);
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${commercialOrigin}${language === 'zh' ? '/zh' : ''}/settings/connect`);
      if (language === 'en' && width === 360) {
        await page.getByLabel(label).fill('INVALID-0000');
        await page.getByRole('button', { name: review }).click();
        await expect(page.getByText('Could not find this request. Check the code and try again.')).toBeVisible();
      }
      await page.getByLabel(label).fill(code);
      await page.getByRole('button', { name: review }).click();
      await expect(page.getByText(longName, { exact: true })).toBeVisible();
      await expect.poll(async () => (await page.locator('body').innerText()).includes(account),
        { timeout: 10_000 }).toBe(true);
      const approveTrigger = page.getByRole('button', { name: approve });
      await approveTrigger.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(longName, { exact: false })).toBeVisible();
      await expect.poll(async () => page.evaluate(() =>
        document.activeElement?.closest('[role="dialog"]') !== null),
      { timeout: 2_000, message: `Commercial dialog did not receive focus at ${language}/${width}` }).toBe(true);
      const geometry = await page.evaluate(() => ({
        width: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        dialog: document.querySelector('[role="dialog"]')?.getBoundingClientRect().toJSON() as DOMRect | undefined,
      }));
      if (!geometry.dialog || geometry.dialog.left < -1 || geometry.dialog.right > geometry.width + 1)
        layoutFailures.push(`${language}/${width}: dialog outside viewport`);
      if (geometry.documentWidth > geometry.width + 1)
        layoutFailures.push(`${language}/${width}: document horizontal overflow ${geometry.documentWidth}px`);
      const actionBounds = await dialog.getByRole('button', { name: approve }).boundingBox();
      const cancelButton = dialog.getByRole('button', { name: cancel });
      const cancelBounds = await cancelButton.boundingBox();
      const reachable = (bounds: typeof actionBounds) => Boolean(bounds && bounds.x >= -1 &&
        bounds.x + bounds.width <= width + 1 && bounds.y >= -1 && bounds.y + bounds.height <= 845);
      if (!reachable(actionBounds))
        layoutFailures.push(`${language}/${width}: approve button outside viewport ${JSON.stringify(actionBounds)}`);
      if (!reachable(cancelBounds))
        layoutFailures.push(`${language}/${width}: cancel button outside viewport ${JSON.stringify(cancelBounds)}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(approveTrigger).toBeFocused({ timeout: 2_000 }).catch(() => {
        layoutFailures.push(`${language}/${width}: focus not restored after Escape`);
      });
      await approveTrigger.click();
      if (reachable(cancelBounds)) await cancelButton.click();
      else await cancelButton.press('Enter');
      await expect(dialog).toBeHidden();
      await expect(approveTrigger).toBeFocused({ timeout: 2_000 }).catch(() => {
        layoutFailures.push(`${language}/${width}: focus not restored after cancel`);
      });
    }
  }
  // Final approval exercises the same real challenge after all ten cancel paths.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${commercialOrigin}/settings/connect`);
  await page.getByLabel('Connection code').fill(code);
  await page.getByRole('button', { name: 'Review request' }).click();
  await page.getByRole('button', { name: 'Approve request' }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Approve request' }).click({ clickCount: 2 });
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('button', { name: 'Remove access' })).toHaveCount(1);
  await revokeInAccount(page, commercialOrigin, longName);
  console.info(`Real commercial EN/ZH × five widths: failure retry, long-name dialog, focus, Escape, cancel, double-click approve, and revoke checked; layout findings: ${layoutFailures.length}.`);
  return layoutFailures;
}

async function main(): Promise<void> {
  await requireFreePort(commercialPort);
  const temporary = await mkdtemp(join(tmpdir(), 'keepany-binding-web-cross-'));
  const snapshot = join(temporary, 'commercial');
  const fixtureRoot = join(temporary, 'fixture');
  const commercialOrigin = `http://127.0.0.1:${commercialPort}`;
  let commercial: ChildProcess | undefined;
  let bridge: ChildProcess | undefined;
  let web: ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await snapshotCommercial(snapshot);
    await mkdir(fixtureRoot);
    commercial = spawn(process.execPath, ['--import', 'tsx', 'scripts/binding-integration-server.ts'], {
      cwd: snapshot,
      env: { ...process.env, TMPDIR: fixtureRoot,
        PATH: `${join(snapshot, '.accept-bin')}:${process.env.PATH ?? ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const secretsPath = await fixtureSecretPath(commercial, fixtureRoot);
    await ready(commercialOrigin, commercial, '/.well-known/jwks.json');
    const { email, password } = JSON.parse(await readFile(secretsPath, 'utf8')) as { email: string; password: string };
    assert.ok(email && password, 'Fixture account material missing');
    const bridgeOrigin = `http://127.0.0.1:${await freePort()}`;
    const webOrigin = `http://127.0.0.1:${await freePort()}`;
    bridge = spawn(process.execPath, ['--import', 'tsx', 'apps/binding-bridge/src/main.ts'], {
      cwd: root,
      env: { ...process.env, KEEPANY_BINDING_ISSUER: commercialOrigin,
        KEEPANY_BINDING_WEB_ORIGIN: webOrigin,
        KEEPANY_BINDING_BRIDGE_PORT: new URL(bridgeOrigin).port },
      stdio: 'ignore',
    });
    web = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'apps/web',
      '--host', '127.0.0.1', '--port', new URL(webOrigin).port, '--strictPort'], {
      cwd: root,
      env: { ...process.env, VITE_KEEPANY_BINDING_ISSUER: commercialOrigin,
        VITE_KEEPANY_BINDING_BRIDGE_ORIGIN: bridgeOrigin },
      stdio: 'ignore',
    });
    await Promise.all([
      ready(bridgeOrigin, bridge, '/.well-known/jwks.json', { Origin: webOrigin }),
      ready(webOrigin, web),
    ]);
    browser = await chromium.launch();
    const webContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await webContext.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
    const accountContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const login = await accountContext.request.post(`${commercialOrigin}/api/auth/sign-in/email`, {
      headers: { Origin: commercialOrigin }, data: { email, password },
    });
    assert.equal(login.status(), 200, 'Fixture account login failed');
    const webPage = await webContext.newPage();
    const accountPage = await accountContext.newPage();
    const errors: string[] = [];
    webPage.on('pageerror', error => errors.push(error.message));
    const layoutFailures = await auditCommercialDialogs(accountPage, commercialOrigin, email);
    const projectName = `Binding retained asset ${crypto.randomUUID().slice(0, 8)}`;
    await addLocalProject(webPage, projectName, webOrigin);
    await bindInWeb(webPage, accountPage, webOrigin, commercialOrigin, email);
    const bindingModule = `/@fs${root}/packages/binding/src`;
    const refreshed = await webPage.evaluate(async ({ modulePath, issuer, bridgeOrigin }) => {
      const { defaultBindingRepository } = await import(/* @vite-ignore */ `${modulePath}/store.ts`);
      const { BindingTransport, refreshAndStoreBoundAccess } = await import(/* @vite-ignore */ `${modulePath}/remote.ts`);
      const { bridgeBindingKeys, createBindingBridgeFetch } = await import(/* @vite-ignore */ `${modulePath}/bridge.ts`);
      const result = await refreshAndStoreBoundAccess({
        repository: defaultBindingRepository(),
        transport: new BindingTransport(issuer, createBindingBridgeFetch(issuer, bridgeOrigin)),
        keys: bridgeBindingKeys(issuer, bridgeOrigin),
      });
      return { scope: result.scope, expiresAt: result.accessExpiresAt };
    }, { modulePath: bindingModule, issuer: commercialOrigin, bridgeOrigin });
    assert.ok(refreshed.scope.includes('sync:read'));
    assert.ok(Date.parse(refreshed.expiresAt) > Date.now());
    assert.equal(await localCredentialCount(webPage), 1, 'Active binding must retain exactly one local credential');
    console.info('Real commercial approve, Web reload/state active, and DPoP refresh passed.');

    await webPage.getByRole('button', { name: 'Remove from this device' }).click();
    const localConfirm = webPage.getByRole('dialog');
    await expect(localConfirm.getByText('This removes the local connection only. Revoke device access in your account settings.')).toBeVisible();
    await localConfirm.getByRole('button', { name: 'Remove from this device' }).click();
    await expect(webPage.getByText('Connection removed from this device')).toBeVisible();
    await webPage.reload();
    await expect(webPage.getByRole('button', { name: 'Start connecting' })).toBeVisible();
    assert.equal(await localCredentialCount(webPage), 0, 'Local removal must delete the credential');
    await accountPage.reload();
    await expect(accountPage.getByRole('button', { name: 'Remove access' })).toHaveCount(1);
    await webPage.goto(`${webOrigin}/assets/project`);
    await expect(webPage.getByText(projectName).first()).toBeVisible();
    console.info('Local removal retained the local project and remote account authorization.');

    // The frozen service allows one approved binding per instance. Revoke the
    // first remote authorization before requesting the second real connection.
    await revokeInAccount(accountPage, commercialOrigin);
    await bindInWeb(webPage, accountPage, webOrigin, commercialOrigin, email);
    assert.equal(await localCredentialCount(webPage), 1);
    await revokeInAccount(accountPage, commercialOrigin);
    await webPage.getByRole('button', { name: 'Check status' }).click();
    await expect(webPage.getByText('Authorization revoked')).toBeVisible();
    await expect(webPage.getByRole('button', { name: 'Start connecting' })).toBeVisible();
    await webPage.reload();
    await expect(webPage.getByRole('button', { name: 'Start connecting' })).toBeVisible();
    assert.equal(await localCredentialCount(webPage), 0, 'Remote revoke must delete the local credential after state readback');
    await webPage.goto(`${webOrigin}/assets/project`);
    await expect(webPage.getByText(projectName).first()).toBeVisible();
    assert.deepEqual(errors, [], 'Web page console had uncaught errors');
    console.info('Remote account revoke reached Web revoked state; credential cleared and local project retained.');
    if (layoutFailures.length) {
      const findings = `Commercial dialog layout/focus findings: ${layoutFailures.join('; ')}`;
      if (protocolOnly) console.info(`Protocol-only pass; ${findings}`);
      else throw Error(findings);
    }
  } finally {
    await Promise.allSettled([browser?.close(), stop(web), stop(bridge), stop(commercial)]);
    await rm(temporary, { recursive: true, force: true });
  }
}

await main().catch(error => {
  console.error(`Binding Web cross-process acceptance failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
