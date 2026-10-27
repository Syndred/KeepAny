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
  historyCalls: number; failHistory: boolean; deferHistory: boolean; resolveHistory?: () => void; rejectHistory?: () => void;
  failPrepareUnconfirmed: boolean; failPreparationCleanup: boolean; preparationCleanups: number;
  deferPrepareFailure: boolean; resolvePrepareFailure?: () => void;
  join(): Promise<number>; connect(): Promise<void>; read(): Promise<unknown>; close(): Promise<void>; grants(): Promise<number>; pendingReceipt(): Promise<void> };
declare global { interface Window { nativeMcpPanel: Fixture } }
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
async function install(page: Page, language: 'zh-CN' | 'en', historyMode?: 'retained' | 'failed' | 'empty') {
  await page.addInitScript(language => localStorage.setItem('keepany-language', language), language); await page.goto('/assets/project');
  await page.getByRole('button', { name: language === 'en' ? 'Add' : '新增', exact: true }).tap();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel(language === 'en' ? 'Name' : '名称', { exact: true }).fill('Mobile MCP selected record');
  await dialog.getByRole('button', { name: language === 'en' ? 'Save' : '保存', exact: true }).tap(); await expect(dialog).toBeHidden();
  await page.evaluate(async paths => {
    const [{ localRepository }, { RxdbMcpAssetStore }, { MemoryAuthorityStorage }, { prepareNativeMcpSession }, { registerPlatformMcp }, { registerFileDeliveryHandler }, sdkModule, { readNativeMcpHistory }] = await Promise.all([
      import(paths.repository), import(paths.store), import(paths.authority), import(paths.session), import(paths.platform), import(paths.delivery), import(paths.client), import(paths.history),
    ]);
    const repository = await localRepository(), store = new RxdbMcpAssetStore(repository), storage = new MemoryAuthorityStorage();
    let handler: NativeMcpRequestHandler | undefined, session: NativeMcpSession | undefined, sdk: Client | undefined, active = false;
    let grant: { grantId: string; grantSecret: string } | undefined;
    const clientNonce = crypto.randomUUID();
    const state: Fixture = { delivery: 'cancelled', deliveries: 0, prepares: 0, activated: 0, stops: 0,
      failPrepare: false, failActivate: false, failStop: false, historyCalls: 0, failHistory: paths.historyMode === 'failed', deferHistory: false,
      failPrepareUnconfirmed: false, failPreparationCleanup: false, preparationCleanups: 0, deferPrepareFailure: false,
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
      async pendingReceipt() {
        const activeGrant = grant, activeSession = session;
        if (!activeGrant || !activeSession) throw Error('no-active-grant');
        await storage.update((value: import('../../packages/mcp/src/authority').AuthorityState) => value.operations.push({
          operationId: 'history_uncertainty_fixture', grantId: activeGrant.grantId, previewId: crypto.randomUUID(), patchHash: 'c'.repeat(64),
          assetId: activeSession.pairingFile.scope.assetIds[0], state: 'pending', createdAt: Date.now(),
        }));
      },
    };
    window.nativeMcpPanel = state;
    if (paths.historyMode && paths.historyMode !== 'empty') {
      await storage.update((value: import('../../packages/mcp/src/authority').AuthorityState) => {
        const id = crypto.randomUUID(), at = Date.UTC(2026, 9, 20, 12);
        value.grants.push({ id, secretHash: 'b'.repeat(64), assetIds: ['history_fixture'], readFields: ['name'], writeFields: [],
          createdAt: at, expiresAt: at + 300000, revokedAt: at + 1234 });
        value.audit.push({ id: crypto.randomUUID(), grantId: id, at, action: 'grant', outcome: 'allowed' },
          { id: crypto.randomUUID(), grantId: id, at: at + 1234, action: 'revoke', outcome: 'allowed' });
      });
    }
    registerFileDeliveryHandler(async (request: FileDeliveryRequest) => {
      state.deliveries++; const text = new TextDecoder().decode(request.bytes), file = JSON.parse(text);
      if (text !== JSON.stringify(file) || file.kind !== 'keepany-mcp-mobile-pairing-v1' || file.scope.assetIds.length !== 1) throw Error('unexpected-export');
      if (state.delivery === 'failed') throw Error('synthetic-share-failure');
      if (state.delivery === 'deferred') { await new Promise<void>(resolve => { state.resolveDelivery = resolve; }); return { status: 'opened' }; }
      return { status: state.delivery };
    });
    registerPlatformMcp({ ...(paths.historyMode ? { async history() {
      state.historyCalls++; if (state.failHistory) throw Error('synthetic-history-private-diagnostic');
      const snapshot = await readNativeMcpHistory('browser-panel-fixture', { storageFactory: () => storage });
      if (state.deferHistory) { state.deferHistory = false; await new Promise<void>((resolve, reject) => {
        state.resolveHistory = resolve; state.rejectHistory = () => reject(Error('synthetic-history-private-diagnostic'));
      }); }
      return snapshot;
    } } : {}), async cleanupUnreturnedPreparation() {
      state.preparationCleanups++;
      if (state.failPreparationCleanup) { state.failPreparationCleanup = false; throw Error('mcp-native-revoke-unconfirmed'); }
    }, async prepare(options: Omit<NativeMcpSessionOptions, 'loadContext'>) {
      state.prepares++; if (state.failPrepare) { state.failPrepare = false; throw Error('synthetic-prepare-failure'); }
      if (state.failPrepareUnconfirmed) {
        state.failPrepareUnconfirmed = false;
        if (state.deferPrepareFailure) await new Promise<void>(resolve => { state.resolvePrepareFailure = resolve; });
        throw Error('mcp-native-revoke-unconfirmed');
      }
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
    client: sourceModuleUrl(fileURLToPath(import.meta.resolve('@modelcontextprotocol/client'))), platform: '/src/platform-mcp.ts', delivery: '/src/file-delivery.ts',
    history: sourceModuleUrl('packages/platform-native/src/native-mcp-history.ts'), historyMode });
  await page.locator('.mobile-tabbar a[href="/more"]').tap(); await page.locator('main a[href="/settings#assistant"]').tap();
  const panel = page.locator('.mcp-panel'); await expect(panel.locator('#mcp-native-address')).toBeVisible();
  await panel.getByLabel('Mobile MCP selected record', { exact: true }).check();
  await panel.locator('#mcp-native-address').fill('192.168.50.20'); return panel;
}

for (const language of ['zh-CN', 'en'] as const) {
  const copy = resources[language].translation;
  test(`${language} unreturned prepare cleanup needs a real stop acknowledgement and keeps late failures visible`, async ({ page }) => {
    const panel = await install(page, language), prepare = panel.getByRole('button', { name: copy.mcpNativePrepare, exact: true });
    await page.evaluate(() => { window.nativeMcpPanel.failPrepareUnconfirmed = true; window.nativeMcpPanel.failPreparationCleanup = true; });
    await prepare.tap(); await expect(panel.getByRole('alert')).toHaveText(copy.mcpNativeStopUnconfirmed);
    await expect(prepare).toBeDisabled(); await expect(panel.getByRole('link', { name: copy.exportFileOpen, exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: copy.mcpNativeStop, exact: true }).tap();
    await expect(panel.getByRole('alert')).toHaveText(copy.mcpNativeStopUnconfirmed); await expect(prepare).toBeDisabled();
    expect(await page.evaluate(() => window.nativeMcpPanel.preparationCleanups)).toBe(1);
    await panel.getByRole('button', { name: copy.mcpNativeStop, exact: true }).tap();
    await expect(panel.getByRole('alert')).toHaveCount(0); await expect(prepare).toBeEnabled();
    expect(await page.evaluate(() => window.nativeMcpPanel.preparationCleanups)).toBe(2);
    await page.evaluate(() => { window.nativeMcpPanel.failPrepareUnconfirmed = true; window.nativeMcpPanel.deferPrepareFailure = true; });
    await prepare.tap(); await page.waitForFunction(() => Boolean(window.nativeMcpPanel.resolvePrepareFailure));
    await page.evaluate(() => { window.dispatchEvent(new Event('keepany-native-background')); window.nativeMcpPanel.resolvePrepareFailure?.(); });
    await expect(panel.getByRole('alert')).toHaveText(copy.mcpNativeStopUnconfirmed); await expect(prepare).toBeDisabled();
    await panel.getByRole('button', { name: copy.mcpNativeStop, exact: true }).tap();
    await expect(panel.getByRole('alert')).toHaveCount(0); await expect(prepare).toBeEnabled();
    expect(await page.evaluate(() => window.nativeMcpPanel.preparationCleanups)).toBe(3);
    await prepare.tap(); await expect(panel.getByRole('link', { name: copy.exportFileOpen, exact: true })).toBeVisible();
    await page.evaluate(() => window.nativeMcpPanel.close());
  });

  test(`${language} native history reads retained metadata before pairing and ignores an obsolete refresh`, async ({ page }, info) => {
    await install(page, language, 'retained');
    await page.locator('.mobile-tabbar a[href="/more"]').tap(); await page.locator('main a[href="/assistant-access"]').tap();
    const history = page.locator('.assistant-access-history');
    await expect(history).toContainText(copy.mcpNativeAuditRetainedHint);
    await expect(history).not.toContainText(copy.mcpAuditRetainedHint);
    await expect(history.locator('ol > li')).toHaveCount(3);
    const stamp = await page.evaluate(language => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(Date.UTC(2026, 9, 20, 12) + 1234), language);
    await expect(history.locator('[data-mcp-revoked-receipt]')).toContainText(stamp);
    await expect(history.locator('[data-mcp-revoked-receipt]')).toContainText(copy.mcpNativeRevokedTime);
    expect(await page.evaluate(async () => ({ prepares: window.nativeMcpPanel.prepares, activated: window.nativeMcpPanel.activated, grants: await window.nativeMcpPanel.grants() }))).toEqual({ prepares: 0, activated: 0, grants: 0 });
    await page.evaluate(() => { window.nativeMcpPanel.deferHistory = true; window.dispatchEvent(new Event('keepany-native-foreground')); });
    await page.waitForFunction(() => Boolean(window.nativeMcpPanel.resolveHistory));
    await expect(history.getByRole('status')).toHaveText(copy.mcpNativeHistoryLoading);
    await page.evaluate(() => { window.nativeMcpPanel.failHistory = true; window.dispatchEvent(new Event('keepany-native-foreground')); });
    await expect(history.getByRole('status')).toHaveText(copy.mcpNativeHistoryUnavailable);
    await page.evaluate(() => window.nativeMcpPanel.resolveHistory?.());
    await expect(history.getByRole('status')).toHaveText(copy.mcpNativeHistoryUnavailable);
    await expect(history.locator('ol > li')).toHaveCount(3);
    await expect(page.getByRole('alert')).toHaveText(copy.mcpNativeStateUnavailable);
    await page.evaluate(() => { window.nativeMcpPanel.failHistory = false; });
    await history.getByRole('button', { name: copy.mcpNativeRefreshHistory, exact: true }).tap();
    await expect(history.getByRole('status')).toHaveCount(0); await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(history.locator('[data-mcp-revoked-receipt]')).toContainText(stamp);
    expect(await page.evaluate(() => window.nativeMcpPanel.stops)).toBe(0);
    const refreshBounds = await history.getByRole('button', { name: copy.mcpNativeRefreshHistory, exact: true }).boundingBox();
    if (!refreshBounds) throw Error('missing-history-refresh');
    expect(refreshBounds.width).toBeGreaterThanOrEqual(44); expect(refreshBounds.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await info.attach('history-touch-bounds', { body: JSON.stringify({ language, viewport: 390, refreshBounds }), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('native-history-retained.png'), fullPage: true });
  });

  test(`${language} unavailable cold history remains distinct from an empty history and can retry`, async ({ page }) => {
    await install(page, language, 'failed');
    await page.locator('.mobile-tabbar a[href="/more"]').tap(); await page.locator('main a[href="/assistant-access"]').tap();
    const history = page.locator('.assistant-access-history');
    await expect(history.getByRole('status')).toHaveText(copy.mcpNativeHistoryUnavailable);
    await expect(history).not.toContainText(copy.mcpNativeNoActivity);
    await expect(page.getByRole('alert')).toHaveText(copy.mcpNativeStateUnavailable);
    await expect(page.locator('body')).not.toContainText('synthetic-history-private-diagnostic');
    expect(await page.evaluate(() => window.nativeMcpPanel.prepares)).toBe(0);
    await page.evaluate(() => { window.nativeMcpPanel.failHistory = false; });
    await history.getByRole('button', { name: copy.mcpNativeRefreshHistory, exact: true }).tap();
    await expect(history.locator('ol > li')).toHaveCount(3); await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test(`${language} an active history read failure leaves the explicitly approved SDK scope usable`, async ({ page }) => {
    const panel = await install(page, language, 'empty');
    await panel.getByRole('button', { name: copy.mcpNativePrepare, exact: true }).tap();
    await page.evaluate(() => { window.nativeMcpPanel.delivery = 'saved'; });
    await panel.getByRole('link', { name: copy.exportFileOpen, exact: true }).tap();
    await panel.getByRole('button', { name: copy.mcpNativeActivate, exact: true }).tap();
    expect(await page.evaluate(() => window.nativeMcpPanel.join())).toBe(202);
    await page.getByRole('dialog', { name: copy.mcpNativeCompareTitle }).getByRole('button', { name: copy.mcpScopeApprovalApprove, exact: true }).tap();
    await expect(panel.getByRole('status')).toHaveText(copy.mcpNativeGranted);
    expect(await page.evaluate(() => window.nativeMcpPanel.join())).toBe(200);
    await page.evaluate(() => window.nativeMcpPanel.connect());
    await page.evaluate(() => { window.nativeMcpPanel.failHistory = true; window.dispatchEvent(new Event('keepany-native-foreground')); });
    await expect(panel.getByRole('alert')).toHaveText(copy.mcpNativeStateUnavailable);
    await expect(panel.getByRole('status')).toHaveText(copy.mcpNativeGranted);
    expect(JSON.stringify(await page.evaluate(() => window.nativeMcpPanel.read()))).toContain('Mobile MCP selected record');
    expect(await page.evaluate(() => ({ prepares: window.nativeMcpPanel.prepares, activated: window.nativeMcpPanel.activated, stops: window.nativeMcpPanel.stops }))).toEqual({ prepares: 1, activated: 1, stops: 0 });
    await page.evaluate(() => window.nativeMcpPanel.close());
  });

  for (const outcome of ['stop-unconfirmed', 'write-uncertain'] as const) {
    test(`${language} history failure preserves ${outcome} after leaving the foreground`, async ({ page }) => {
      const panel = await install(page, language, 'empty');
      await panel.getByRole('button', { name: copy.mcpNativePrepare, exact: true }).tap();
      await page.evaluate(() => { window.nativeMcpPanel.delivery = 'saved'; });
      await panel.getByRole('link', { name: copy.exportFileOpen, exact: true }).tap();
      await panel.getByRole('button', { name: copy.mcpNativeActivate, exact: true }).tap();
      expect(await page.evaluate(() => window.nativeMcpPanel.join())).toBe(202);
      await page.getByRole('dialog', { name: copy.mcpNativeCompareTitle }).getByRole('button', { name: copy.mcpScopeApprovalApprove, exact: true }).tap();
      await expect(panel.getByRole('status')).toHaveText(copy.mcpNativeGranted);
      expect(await page.evaluate(() => window.nativeMcpPanel.join())).toBe(200);
      if (outcome === 'stop-unconfirmed') {
        await page.evaluate(() => { window.nativeMcpPanel.deferHistory = true; window.dispatchEvent(new Event('keepany-native-foreground')); });
        await page.waitForFunction(() => Boolean(window.nativeMcpPanel.rejectHistory));
        await page.evaluate(() => { window.nativeMcpPanel.failStop = true; window.dispatchEvent(new Event('keepany-native-background')); });
        await expect(panel.getByRole('alert')).toHaveText(copy.mcpNativeStopUnconfirmed);
        await page.evaluate(() => window.nativeMcpPanel.rejectHistory?.());
        await expect(panel.getByRole('alert')).toHaveText(copy.mcpNativeStopUnconfirmed);
        await expect(panel.getByRole('button', { name: copy.mcpNativePrepare, exact: true })).toBeDisabled();
        await panel.getByRole('button', { name: copy.mcpNativeStop, exact: true }).tap();
        await expect(panel.getByRole('alert')).toHaveCount(0);
      } else {
        await page.evaluate(() => window.nativeMcpPanel.pendingReceipt());
        await page.evaluate(() => { window.nativeMcpPanel.failHistory = true; window.dispatchEvent(new Event('keepany-native-background')); });
        await expect(panel.getByRole('alert')).toHaveText(copy.mcpWriteMayHaveApplied);
      }
      await page.evaluate(() => window.nativeMcpPanel.close());
    });
  }

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
