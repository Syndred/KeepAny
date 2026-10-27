import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { sourceModuleUrl } from './helpers/source-module-url';
import type { NativeMcpSession, NativeMcpSessionOptions } from '../../packages/platform-native/src/native-mcp-session';
import type { NativeMcpRequestHandler, prepareNativeMcpTransport } from '../../packages/platform-native/src/native-mcp-transport';
import type { Client } from '@modelcontextprotocol/client';
import type { FileDeliveryRequest } from '../../apps/web/src/file-delivery';
import { resources } from '../../apps/web/src/i18n';

type Fixture = { delivery: 'saved' | 'opened' | 'cancelled' | 'failed' | 'deferred'; deliveries: number; prepares: number; activated: number; stops: number;
  failPrepare: boolean; failActivate: boolean; failStop: boolean; resolveDelivery?: () => void;
  join(): Promise<number>; connect(): Promise<void>; read(): Promise<unknown>; close(): Promise<void>; grants(): Promise<number> };
declare global { interface Window { nativeMcpPanel: Fixture } }
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
async function install(page: Page, language: 'zh-CN' | 'en') {
  await page.addInitScript(language => localStorage.setItem('keepany-language', language), language); await page.goto('/assets/project');
  await page.getByRole('button', { name: language === 'en' ? 'Add' : '新增', exact: true }).tap();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel(language === 'en' ? 'Name' : '名称', { exact: true }).fill('Mobile MCP selected record');
  await dialog.getByRole('button', { name: language === 'en' ? 'Save' : '保存', exact: true }).tap(); await expect(dialog).toBeHidden();
  await page.evaluate(async paths => {
    const [{ localRepository }, { RxdbMcpAssetStore }, { MemoryAuthorityStorage }, { prepareNativeMcpSession }, { registerPlatformMcp }, { registerFileDeliveryHandler }, sdkModule] = await Promise.all([
      import(paths.repository), import(paths.store), import(paths.authority), import(paths.session), import(paths.platform), import(paths.delivery), import(paths.client),
    ]);
    const repository = await localRepository(), store = new RxdbMcpAssetStore(repository), storage = new MemoryAuthorityStorage();
    let handler: NativeMcpRequestHandler | undefined, session: NativeMcpSession | undefined, sdk: Client | undefined, active = false;
    let grant: { grantId: string; grantSecret: string } | undefined;
    const clientNonce = crypto.randomUUID();
    const state: Fixture = { delivery: 'cancelled', deliveries: 0, prepares: 0, activated: 0, stops: 0,
      failPrepare: false, failActivate: false, failStop: false,
      async join() {
        if (!handler || !session) throw Error('not-active'); const file = session.pairingFile;
        const response = await handler.fetch(new Request(new URL('/pair', file.endpoint), { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'keepany-mcp-mobile-join-v1', requestNonce: file.requestNonce, pairingSecret: file.pairingSecret,
            clientNonce, clientName: 'Controlled browser SDK' }) }), { host: new URL(file.endpoint).host });
        const value = await response.json(); if (value.state === 'approved') grant = value; return response.status;
      },
      async connect() {
        if (!session || !handler || !grant) throw Error('not-approved');
        sdk = new sdkModule.Client({ name: 'controlled-browser-client', version: '1' }); const endpoint = session.pairingFile.endpoint;
        await sdk?.connect(new sdkModule.StreamableHTTPClientTransport(new URL(endpoint), { fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          if (!handler || !active) throw Error('stopped'); return handler.fetch(new Request(input, init), { host: new URL(endpoint).host });
        }, requestInit: { headers: { authorization: `Bearer ${grant.grantId}.${grant.grantSecret}` } } }));
      },
      async read() { if (!sdk) throw Error('not-connected'); return sdk.callTool({ name: 'list_assets', arguments: {} }); },
      async close() { await sdk?.close(); await session?.close(); },
      async grants() { return (await storage.read()).grants.filter((g: { revokedAt?: number }) => !g.revokedAt).length; },
    };
    window.nativeMcpPanel = state;
    registerFileDeliveryHandler(async (request: FileDeliveryRequest) => {
      state.deliveries++; const text = new TextDecoder().decode(request.bytes), file = JSON.parse(text);
      if (text !== JSON.stringify(file) || file.kind !== 'keepany-mcp-mobile-pairing-v1' || file.scope.assetIds.length !== 1) throw Error('unexpected-export');
      if (state.delivery === 'failed') throw Error('synthetic-share-failure');
      if (state.delivery === 'deferred') { await new Promise<void>(resolve => { state.resolveDelivery = resolve; }); return { status: 'opened' }; }
      return { status: state.delivery };
    });
    registerPlatformMcp({ async prepare(options: Omit<NativeMcpSessionOptions, 'loadContext'>) {
      state.prepares++; if (state.failPrepare) { state.failPrepare = false; throw Error('synthetic-prepare-failure'); }
      session = await prepareNativeMcpSession({ ...options, loadContext: async () => ({ datasetName: 'browser-panel-fixture', store,
        assertCurrent() {}, onInvalidated() { return () => {}; } }) }, {
        authorityStorage: () => storage,
        prepareTransport: async (address: string) => {
          const endpoint = { instanceId: crypto.randomUUID(), endpoint: `https://${address}:49591/mcp`, certificatePem: `-----BEGIN CERTIFICATE-----\n${'A'.repeat(64)}\n-----END CERTIFICATE-----\n`, spkiSha256: 'a'.repeat(64) };
          const ticket: Awaited<ReturnType<typeof prepareNativeMcpTransport>> = { endpoint,
            async activate(options) {
              if (state.failActivate) { state.failActivate = false; throw Error('synthetic-activation-failure'); }
              active = true; state.activated++; const assertAvailable = () => { if (!active) throw Error('stopped'); };
              handler = options.createHandler(endpoint, assertAvailable);
              return { endpoint, assertAvailable, close: async () => { active = false; await handler?.close(); } };
            },
            async close() { state.stops++; if (state.failStop) { state.failStop = false; throw Error('synthetic-stop-failure'); } active = false; await handler?.close(); },
          }; return ticket;
        },
      }); return session;
    } });
    const asset = (await repository.list('asset')).find((asset: { name: string }) => asset.name === 'Mobile MCP selected record');
    await repository.saveAssetIfCurrent(asset, { ...asset, notes: 'excluded-private-note' });
  }, { repository: sourceModuleUrl('packages/local-db/src/index.ts'), store: sourceModuleUrl('packages/mcp/src/rxdb-store.ts'),
    authority: sourceModuleUrl('packages/mcp/src/authority.ts'), session: sourceModuleUrl('packages/platform-native/src/native-mcp-session.ts'),
    client: sourceModuleUrl(fileURLToPath(import.meta.resolve('@modelcontextprotocol/client'))), platform: '/src/platform-mcp.ts', delivery: '/src/file-delivery.ts' });
  await page.locator('.mobile-tabbar a[href="/more"]').tap(); await page.locator('main a[href="/settings#assistant"]').tap();
  const panel = page.locator('.mcp-panel'); await expect(panel.locator('#mcp-native-address')).toBeVisible();
  await panel.getByLabel('Mobile MCP selected record', { exact: true }).check();
  await panel.locator('#mcp-native-address').fill('192.168.50.20'); return panel;
}

for (const language of ['zh-CN', 'en'] as const) {
  const copy = resources[language].translation;
  test(`${language} 390 native panel requires system delivery and explicit activation before trusted SDK approval`, async ({ page }, info) => {
    const panel = await install(page, language), prepare = panel.getByRole('button', { name: copy.mcpNativePrepare, exact: true });
    await expect(panel.locator('input[type=file]')).toHaveCount(0); await prepare.tap();
    const activate = panel.getByRole('button', { name: copy.mcpNativeActivate, exact: true }), exportFile = panel.getByRole('link', { name: copy.exportFileOpen, exact: true });
    await expect(activate).toBeDisabled(); expect(await page.evaluate(() => window.nativeMcpPanel.activated)).toBe(0);
    await exportFile.tap(); await expect(panel.getByRole('status')).toHaveText(copy.exportFileCancelled); await expect(activate).toBeDisabled();
    await page.evaluate(() => { window.nativeMcpPanel.delivery = 'failed'; }); await exportFile.tap(); await expect(panel.getByRole('status')).toHaveText(copy.exportFileFailed); await expect(activate).toBeDisabled();
    await page.evaluate(() => { window.nativeMcpPanel.delivery = 'opened'; }); await exportFile.tap(); await expect(panel.getByRole('status')).toHaveText(copy.exportFileOpened);
    await expect(activate).toBeEnabled(); expect(await page.evaluate(() => window.nativeMcpPanel.activated)).toBe(0);
    const inputBox = await panel.locator('#mcp-native-address').boundingBox(); if (!inputBox) throw Error('missing-input'); expect(inputBox.height).toBeGreaterThanOrEqual(44);
    expect(await panel.locator('#mcp-native-address').evaluate(e => getComputedStyle(e).fontSize)).toBe('16px');
    const controls = await panel.locator('#mcp-native-address, .actions .button').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect(); return { width: box.width, height: box.height, x: box.x, right: box.right };
    }));
    for (const box of controls) { expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(390); }
    await info.attach('native-panel-controls', { body: JSON.stringify(controls), contentType: 'application/json' });
    await activate.tap(); await expect(panel.getByRole('status')).toHaveText(copy.mcpNativeWaiting); await expect(exportFile).toHaveCount(0);
    expect(await page.evaluate(() => window.nativeMcpPanel.grants())).toBe(0); expect(await page.evaluate(() => window.nativeMcpPanel.join())).toBe(202);
    const approval = page.getByRole('dialog', { name: copy.mcpNativeCompareTitle }); await expect(approval).toContainText('Controlled browser SDK'); await expect(approval).toContainText('Mobile MCP selected record');
    await approval.getByRole('button', { name: copy.mcpScopeApprovalApprove, exact: true }).tap(); await expect(approval).toBeHidden();
    await expect(panel.getByRole('status')).toHaveText(copy.mcpNativeGranted); expect(await page.evaluate(() => window.nativeMcpPanel.join())).toBe(200);
    const read = await page.evaluate(async () => { await window.nativeMcpPanel.connect(); return window.nativeMcpPanel.read(); });
    expect(JSON.stringify(read)).toContain('Mobile MCP selected record'); expect(JSON.stringify(read)).not.toContain('excluded-private-note');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('native-panel-authorized.png'), fullPage: true });
    await panel.getByRole('button', { name: copy.mcpRevoke, exact: true }).tap(); await page.getByRole('dialog').getByRole('button', { name: copy.cancel, exact: true }).tap();
    expect((await page.evaluate(() => window.nativeMcpPanel.read()) as { isError?: boolean }).isError).not.toBe(true);
    await panel.getByRole('button', { name: copy.mcpRevoke, exact: true }).tap(); await page.getByRole('dialog').getByRole('button', { name: copy.mcpRevoke, exact: true }).tap();
    await expect(panel.locator('.mcp-active')).toHaveCount(0);
    expect(await page.evaluate(async () => { try { const result = await window.nativeMcpPanel.read() as { isError?: boolean }; return result.isError === true; } catch { return true; } })).toBe(true);
    await page.evaluate(() => window.nativeMcpPanel.close());
    await info.attach('scope', { body: JSON.stringify({ language, width: 390, syntheticPlatformAdapter: true, realSessionController: true, browserRxdb: true, nativeEvidence: false, tlsListener: false }), contentType: 'application/json' });
  });

  test(`${language} panel invalidates delivered tickets on scope or IP changes and rejects a late share acknowledgement`, async ({ page }) => {
    const panel = await install(page, language), prepare = panel.getByRole('button', { name: copy.mcpNativePrepare, exact: true });
    await prepare.tap(); await page.evaluate(() => { window.nativeMcpPanel.delivery = 'deferred'; }); await panel.getByRole('link', { name: copy.exportFileOpen, exact: true }).tap();
    await panel.locator('#mcp-native-address').fill('192.168.50.21'); await page.evaluate(() => window.nativeMcpPanel.resolveDelivery?.());
    await expect(panel.getByRole('link', { name: copy.exportFileOpen, exact: true })).toHaveCount(0); await expect(panel.getByRole('button', { name: copy.mcpNativeActivate, exact: true })).toHaveCount(0);
    await prepare.tap(); const activate = panel.getByRole('button', { name: copy.mcpNativeActivate, exact: true }); await expect(activate).toBeDisabled();
    await page.evaluate(() => { window.nativeMcpPanel.delivery = 'saved'; }); await panel.getByRole('link', { name: copy.exportFileOpen, exact: true }).tap(); await expect(activate).toBeEnabled();
    await panel.getByRole('group', { name: copy.mcpReadFields, exact: true }).getByLabel(copy.mcpField_description, { exact: true }).check();
    await expect(panel.getByRole('link', { name: copy.exportFileOpen, exact: true })).toHaveCount(0); expect(await page.evaluate(() => window.nativeMcpPanel.activated)).toBe(0);
    await page.evaluate(() => window.nativeMcpPanel.close());
  });

  test(`${language} panel reports prepare, activation and unconfirmed stop failures and permits explicit retry`, async ({ page }, info) => {
    const panel = await install(page, language), prepare = panel.getByRole('button', { name: copy.mcpNativePrepare, exact: true });
    await page.evaluate(() => { window.nativeMcpPanel.failPrepare = true; }); await prepare.tap(); await expect(panel.getByRole('alert')).toHaveText(copy.mcpNativePrepareFailed);
    await prepare.tap(); await page.evaluate(() => { window.nativeMcpPanel.delivery = 'saved'; window.nativeMcpPanel.failActivate = true; });
    await panel.getByRole('link', { name: copy.exportFileOpen, exact: true }).tap(); await panel.getByRole('button', { name: copy.mcpNativeActivate, exact: true }).tap();
    await expect(panel.getByRole('alert')).toHaveText(copy.mcpNativeActivationFailed); await expect(panel.getByRole('link', { name: copy.exportFileOpen, exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: copy.mcpNativeStop, exact: true }).tap(); await prepare.tap();
    await page.evaluate(() => { window.nativeMcpPanel.failStop = true; }); await panel.getByRole('button', { name: copy.mcpNativeStop, exact: true }).tap();
    await expect(panel.getByRole('alert')).toHaveText(copy.mcpNativeStopUnconfirmed); await expect(prepare).toBeDisabled();
    await expect(panel.getByRole('link', { name: copy.exportFileOpen, exact: true })).toHaveCount(0);
    await expect(panel.getByRole('alert')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath('native-panel-stop-unconfirmed.png'), fullPage: true });
    await panel.getByRole('button', { name: copy.mcpNativeStop, exact: true }).tap(); await expect(panel.getByRole('alert')).toHaveCount(0); await expect(prepare).toBeEnabled();
    await page.evaluate(() => window.nativeMcpPanel.close());
  });
}
