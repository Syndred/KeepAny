import { expect, test } from '@playwright/test';
import { sourceModuleUrl } from './helpers/source-module-url';
import { selectChoice } from './helpers/select-choice';

const origin = 'https://session.example.test';
const workspace = '11111111-1111-4111-8111-111111111111';
const readOnlyWorkspace = '22222222-2222-4222-8222-222222222222';
test.use({ hasTouch: true });
for (const zh of [true, false]) test(`${zh ? 'zh-CN' : 'en'} 390 native session explicitly confirms HTTPS, signs in and loads the actual server workspace`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(language => localStorage.setItem('keepany-language', language), zh ? 'zh-CN' : 'en');
  await page.goto('/');
  await page.evaluate(async paths => {
    const { Capacitor } = await import(paths.capacitor);
    Capacitor.isNativePlatform = () => true;
    Capacitor.isPluginAvailable = () => true;
    const { createNativeConnections } = await import(paths.native);
    const { registerPlatformConnections } = await import(paths.platform);
    const { registerSyncFetchFactory } = await import(paths.sync);
    const { createNativeSyncFetchFactory } = await import(paths.binding);
    Object.assign(window, { androidBridge: {} });
    Object.assign(Capacitor, { PluginHeaders: [{ name: 'KeepAnyConnections', methods: [] }] });
    Capacitor.isNativePlatform = () => true;
    Capacitor.isPluginAvailable = () => true;
    const state = { attempts: 0, opened: 0, closed: 0, requests: 0, signedIn: false, passwordOnlyAtSignin: true, urls: [] as string[] };
    Object.assign(window, { nativeConnectionChecks: state });
    const user = { id: 'synthetic-user', email: 'native@example.test', name: 'Native fixture', emailVerified: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const adapter = createNativeConnections({
      async openSession() { state.attempts++; if (state.attempts === 1) throw Error('synthetic-open-failure'); state.opened++; state.signedIn = false; return { sessionId: crypto.randomUUID() }; },
      async closeSession() { state.closed++; state.signedIn = false; },
      async sessionRequest(options: { url: string; bodyBase64: string }) {
        state.requests++; state.urls.push(options.url);
        const path = new URL(options.url).pathname;
        if (path !== '/api/auth/sign-in/email' && atob(options.bodyBase64).includes('Synthetic-session-password')) state.passwordOnlyAtSignin = false;
        let body: unknown;
        if (path === '/api/auth/sign-in/email') { state.signedIn = true; body = { token: 'synthetic-session', user }; }
        else if (path === '/api/auth/sign-out') { state.signedIn = false; body = { success: true }; }
        else if (path === '/api/auth/get-session') body = state.signedIn ? { user, session: { id: 'synthetic-session', userId: user.id, expiresAt: new Date(Date.now() + 3600_000).toISOString() } } : null;
        else if (path === '/sync/identity') body = { accountId: 'selfhost:synthetic-user' };
        else if (path === '/workspaces') body = { workspaces: [{ workspaceId: '11111111-1111-4111-8111-111111111111', canRead: true, canWrite: true }, { workspaceId: '22222222-2222-4222-8222-222222222222', canRead: true, canWrite: false }] };
        else throw Error('unexpected-fixture-route');
        const text = JSON.stringify(body); return { status: 200, headers: { 'content-type': 'application/json' }, size: new TextEncoder().encode(text).length, bodyBase64: btoa(text) };
      },
      async backupWrite() {}, async backupRead() { return { bodyBase64: '' }; },
      async backupRequest() { throw Error('unexpected-backup'); }, async cancel() {},
    });
    registerPlatformConnections(adapter); registerSyncFetchFactory(createNativeSyncFetchFactory(adapter.sessionFetch));
  }, { capacitor: sourceModuleUrl('node_modules/@capacitor/core/dist/index.js'), native: sourceModuleUrl('packages/platform-native/src/connections.ts'), platform: '/src/platform-connections.ts', sync: sourceModuleUrl('packages/sync-client/src/platform-fetch.ts'), binding: sourceModuleUrl('packages/platform-native/src/binding-transport.ts') });
  await page.getByRole('navigation', { name: zh ? '主要导航' : 'Main navigation', exact: true }).getByRole('link', { name: zh ? '更多' : 'More', exact: true }).click();
  await page.getByRole('main').getByRole('link', { name: zh ? /^设置/ : /^Settings/ }).click();
  const details = page.locator('#connections'); if (await details.getAttribute('open') === null) await details.locator('summary').click();
  await selectChoice(page.locator('#sync-access-mode'), 'session');
  const panel = page.locator('.sync-session');
  await expect(panel.getByText(zh ? /重新启动后需再次登录/ : /Sign in again after restarting/)).toBeVisible();
  await expect(panel.getByLabel(zh ? '邮箱地址' : 'Email address', { exact: true })).toHaveCount(0);
  const geometry = await panel.locator('input,button').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { tag: element.tagName, x: box.x, y: box.y, width: box.width, height: box.height }; }));
  for (const box of geometry) { expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390); }
  expect(geometry[1].y - geometry[0].y - geometry[0].height).toBeGreaterThanOrEqual(8);
  await test.info().attach('confirm-touch-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
  expect(await page.evaluate(() => (window as unknown as { nativeConnectionChecks: { requests: number } }).nativeConnectionChecks.requests)).toBe(0);
  await panel.getByLabel(zh ? '服务地址' : 'Server URL').fill('http://session.example.test');
  await panel.getByRole('button', { name: zh ? '确认服务器' : 'Confirm server' }).tap();
  await expect(panel.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { nativeConnectionChecks: { opened: number } }).nativeConnectionChecks.opened)).toBe(0);
  await panel.getByLabel(zh ? '服务地址' : 'Server URL').fill(origin);
  await panel.getByRole('button', { name: zh ? '确认服务器' : 'Confirm server' }).click();
  await expect(panel.getByRole('alert')).toHaveText(zh ? '无法检查服务登录状态，请检查连接。' : 'Could not check the server session. Check the connection.');
  await panel.getByRole('button', { name: zh ? '确认服务器' : 'Confirm server' }).click();
  await panel.getByLabel(zh ? '邮箱地址' : 'Email address', { exact: true }).fill('native@example.test');
  await panel.getByLabel(zh ? '密码' : 'Password', { exact: true }).fill('Synthetic-session-password');
  const controls = await panel.locator('input,button').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height, x: box.x }; }));
  for (const box of controls) { expect(box.height).toBeGreaterThanOrEqual(44); expect(box.x + box.width).toBeLessThanOrEqual(390); }
  await panel.getByRole('button', { name: zh ? '登录' : 'Sign in', exact: true }).tap();
  await expect(panel.getByText(zh ? /已登录：/ : /Signed in:/)).toBeVisible();
  await expect(page.locator('#sync-select-workspace')).toBeEnabled();
  await selectChoice(page.locator('#sync-select-workspace'), workspace);
  await expect(page.getByLabel(zh ? '工作区 ID' : 'Workspace ID', { exact: true })).toHaveValue(workspace);
  const state = await page.evaluate(() => (window as unknown as { nativeConnectionChecks: { urls: string[]; passwordOnlyAtSignin: boolean } }).nativeConnectionChecks);
  expect(state.urls.every(url => url.startsWith(origin))).toBe(true); expect(state.passwordOnlyAtSignin).toBe(true);
  expect(state.urls).toContain(`${origin}/workspaces`);
  expect(await page.locator('#sync-select-workspace').textContent()).not.toContain(readOnlyWorkspace);
  await page.screenshot({ path: `${test.info().outputDir}/session-connected-${zh ? 'zh' : 'en'}-390.png` });
  await panel.getByRole('button', { name: zh ? '退出登录' : 'Sign out', exact: true }).click();
  await expect(panel.getByText(zh ? '尚未登录自部署服务' : 'Not signed in to the self-hosted service', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: zh ? '更换服务器' : 'Change server' }).click();
  await expect(panel.getByRole('button', { name: zh ? '确认服务器' : 'Confirm server' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { nativeConnectionChecks: { closed: number } }).nativeConnectionChecks.closed)).toBe(1);
  await panel.getByRole('button', { name: zh ? '确认服务器' : 'Confirm server' }).click();
  await expect(panel.getByText(zh ? '尚未登录自部署服务' : 'Not signed in to the self-hosted service', { exact: true })).toBeVisible();
  await panel.getByLabel(zh ? '邮箱地址' : 'Email address', { exact: true }).fill('native@example.test');
  await panel.getByLabel(zh ? '密码' : 'Password', { exact: true }).fill('Synthetic-session-password');
  await panel.getByRole('button', { name: zh ? '登录' : 'Sign in', exact: true }).click();
  await expect(panel.getByText(zh ? /已登录：/ : /Signed in:/)).toBeVisible();
  await selectChoice(page.locator('#sync-access-mode'), 'token');
  await expect.poll(() => page.evaluate(() => (window as unknown as { nativeConnectionChecks: { closed: number } }).nativeConnectionChecks.closed)).toBe(2);
  const count = await page.evaluate(() => (window as unknown as { nativeConnectionChecks: { requests: number } }).nativeConnectionChecks.requests);
  await selectChoice(page.locator('#sync-access-mode'), 'session');
  await expect(panel.getByRole('button', { name: zh ? '确认服务器' : 'Confirm server' })).toBeVisible();
  await expect(page.getByRole('button', { name: zh ? '创建新工作区和密钥' : 'Create workspace and key', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { nativeConnectionChecks: { requests: number } }).nativeConnectionChecks.requests)).toBe(count);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('Synthetic-session-password');
});

test('en Web session retains same-origin login and registered workspace loading at 1280', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  let signedIn = false; const calls: string[] = [];
  const user = { id: 'web-user', email: 'web@example.test', name: 'Web fixture', emailVerified: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await page.route('**/api/auth/**', async route => {
    calls.push(route.request().url()); const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/sign-in/email') { signedIn = true; return route.fulfill({ json: { token: 'synthetic-session', user } }); }
    if (path === '/api/auth/sign-out') { signedIn = false; return route.fulfill({ json: { success: true } }); }
    return route.fulfill({ json: signedIn ? { user, session: { id: 'web-session', userId: user.id, expiresAt: new Date(Date.now()+3600_000).toISOString() } } : null });
  });
  await page.route('**/sync/identity', route => { calls.push(route.request().url()); return route.fulfill({ json: { accountId: 'selfhost:web-user' } }); });
  await page.route('**/workspaces', route => { calls.push(route.request().url()); return route.fulfill({ json: { workspaces: [{ workspaceId: workspace, canRead: true, canWrite: true }] } }); });
  await page.goto('/settings#connections'); await selectChoice(page.locator('#sync-access-mode'), 'session');
  const panel = page.locator('.sync-session');
  await expect(panel.getByText('Not signed in to the self-hosted service', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Confirm server' })).toHaveCount(0);
  await panel.getByLabel('Email address', { exact: true }).fill(user.email); await panel.getByLabel('Password', { exact: true }).fill('Synthetic-Web-password');
  await panel.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(panel.getByText(`Signed in: ${user.email}`)).toBeVisible();
  await selectChoice(page.locator('#sync-select-workspace'), workspace);
  await expect(page.getByLabel('Workspace ID', { exact: true })).toHaveValue(workspace);
  expect(calls.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
});
