import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, type Page, test } from '@playwright/test';
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve('.');
const packagedExecutable = process.env.KEEPANY_MCP_EXECUTABLE;
const evidence = process.env.KEEPANY_MCP_EVIDENCE_DIR ?? join(repo, 'docs/evidence/2026-09-29', packagedExecutable ? 'mcp-packaged' : '');
const exists = (path: string) => access(path).then(() => true, () => false);

async function wrongHostStatus(url: string, origin: string, pairingSecret: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ secret: pairingSecret });
    const request = httpRequest(`${url}/pair`, { method: 'POST', headers: {
      Host: 'untrusted.example', Origin: origin, 'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode ?? 0)); });
    request.on('error', reject);
    request.end(body);
  });
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise(done => setTimeout(done, 40));
  }
  throw Error('condition-timeout');
}

async function addProject(page: Page, name: string, description: string) {
  await page.goto('/assets/project');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Short description').fill(description);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}

function result<T>(reply: Awaited<ReturnType<Client['callTool']>>): T {
  expect(reply.isError).not.toBe(true);
  const structured = reply.structuredContent as { result?: T } | undefined;
  expect(structured).toHaveProperty('result');
  return structured?.result as T;
}

async function mobileWidth(page: Page) {
  const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  expect(width).toBeLessThanOrEqual(390);
}

test('formal Web grants one RxDB record to an isolated official SDK stdio client and requires exact write approval', async ({ browser }) => {
  test.setTimeout(150_000);
  const context = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors: string[] = [];
  let abortedWriteCheck = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => {
    if (request.url().endsWith('/check-write')) abortedWriteCheck = true;
  });
  const privateDir = await mkdtemp(join(tmpdir(), 'keepany-mcp-web-'));
  await chmod(privateDir, 0o700);
  const pairingPath = join(privateDir, 'pairing.json');
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  let releasePausedWrite: () => void = () => undefined;
  const unique = crypto.randomUUID().slice(0, 8);
  const before = `MCP selected ${unique}`;
  const after = `MCP approved ${unique}`;
  const hidden = `private description ${unique}`;
  const other = `MCP not shared ${unique}`;
  const otherDescription = `other private description ${unique}`;
  try {
    await mkdir(evidence, { recursive: true });
    await page.goto('/settings#assistant');
    if (packagedExecutable) {
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await page.reload();
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    }
    await page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Language' }) }).locator('select').selectOption('en');
    await addProject(page, before, hidden);
    await addProject(page, other, otherDescription);
    await page.goto('/settings#assistant');
    const panel = page.locator('.mcp-panel');
    await expect(panel.getByRole('heading', { name: 'Local MCP access' })).toBeVisible();
    await panel.getByRole('group', { name: 'Accessible records' }).getByLabel(before).check();
    await expect(panel.getByRole('group', { name: 'Readable fields' }).getByLabel('Name')).toBeChecked();
    await panel.getByRole('group', { name: 'Editable fields' }).getByLabel('Name').check();
    await panel.getByLabel('Access duration').selectOption(String(15 * 60_000));
    await mobileWidth(page);
    await page.screenshot({ path: join(evidence, 'mcp-settings-en-390.png'), fullPage: true });

    const downloadPromise = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Create connection request' }).click();
    const download = await downloadPromise;
    const requestPath = await download.path();
    if (!requestPath) throw Error('request-download-missing');
    const request = JSON.parse(await readFile(requestPath, 'utf8')) as {
      kind: string; appOrigin: string; assetIds: string[]; readFields: string[];
      writeFields: string[]; ttlMs: number; requestNonce: string;
    };
    expect(request.kind).toBe('keepany-mcp-local-request-v1');
    expect(request.appOrigin).toBe(new URL(page.url()).origin);
    expect(request.assetIds).toHaveLength(1);
    expect(request.readFields).toEqual(['name']);
    expect(request.writeFields).toEqual(['name']);
    expect(request.ttlMs).toBe(15 * 60_000);
    expect(JSON.stringify(request)).not.toContain(hidden);
    expect(JSON.stringify(request)).not.toContain(otherDescription);

    const childEnv = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    transport = new StdioClientTransport({
      command: packagedExecutable ?? join(repo, 'node_modules/.bin/tsx'),
      args: [...(packagedExecutable ? [] : [join(repo, 'apps/mcp-launcher/src/main.ts')]),
        '--request', requestPath, '--pairing-file', pairingPath, '--state-dir', privateDir],
      cwd: packagedExecutable ? privateDir : repo, env: childEnv, stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', chunk => { stderr += String(chunk); });
    client = new Client({ name: 'keepany-web-acceptance', version: '1.0.0' });
    await client.connect(transport);
    await waitFor(() => exists(pairingPath));
    expect((await stat(privateDir)).mode & 0o777).toBe(0o700);
    expect((await stat(pairingPath)).mode & 0o777).toBe(0o600);
    const pairing = JSON.parse(await readFile(pairingPath, 'utf8')) as {
      kind: string; url: string; pairingSecret: string; requestNonce: string; appOrigin: string; expiresAt: number;
    };
    expect(pairing.requestNonce).toBe(request.requestNonce);
    expect(pairing.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(pairing.kind).toBe('keepany-mcp-pairing-v1');
    expect(pairing.appOrigin).toBe(request.appOrigin);
    expect(pairing.expiresAt - Date.now()).toBeGreaterThan(0);
    expect(pairing.expiresAt - Date.now()).toBeLessThanOrEqual(120_000);
    expect(pairing.pairingSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stderr).not.toContain(pairing.pairingSecret);
    expect((await fetch(`${pairing.url}/pair`, { method: 'POST', headers: {
      Origin: 'http://untrusted.example', 'Content-Type': 'application/json',
    }, body: JSON.stringify({ secret: pairing.pairingSecret }) })).status).toBe(403);
    expect(await wrongHostStatus(pairing.url, request.appOrigin, pairing.pairingSecret)).toBe(403);
    const unpaired = await client.callTool({ name: 'list_assets', arguments: {} });
    expect(unpaired.isError).toBe(true);
    expect(JSON.stringify(unpaired)).toContain('bridge-unpaired');

    await panel.getByLabel('Import pairing file').setInputFiles(pairingPath);
    const scope = page.getByRole('dialog', { name: 'Confirm local connection' });
    await expect(scope).toBeVisible();
    await expect(scope).toContainText(before);
    await expect(scope).toContainText('Name');
    await expect(scope).not.toContainText(other);
    await scope.getByRole('button', { name: 'Allow connection' }).click();
    await expect(panel.getByText('Local connection authorized')).toBeVisible();
    await waitFor(async () => !(await exists(pairingPath)));

    const list = result<Array<Record<string, unknown>>>(await client.callTool({ name: 'list_assets', arguments: {} }));
    expect(list).toEqual([{ id: request.assetIds[0], name: before }]);
    const selected = result<Record<string, unknown>>(await client.callTool({ name: 'get_asset', arguments: { id: request.assetIds[0] } }));
    expect(selected).toEqual({ id: request.assetIds[0], name: before });
    expect(JSON.stringify(list)).not.toContain(hidden);
    expect(JSON.stringify(list)).not.toContain(other);

    const operationId = `mcp-web-${crypto.randomUUID()}`;
    const patch = { name: after };
    const preview = result<{ previewId: string; expectedVersion: string; changes: Array<{ field: string; before: string; after: string }> }>(
      await client.callTool({ name: 'preview_asset_update', arguments: { id: request.assetIds[0], operationId, patch } }),
    );
    expect(preview.changes).toEqual([{ field: 'name', before, after }]);
    const writeDialog = page.getByRole('dialog', { name: 'Confirm record change' });
    await expect(writeDialog).toBeVisible();
    await expect(writeDialog).toContainText(before);
    await expect(writeDialog).toContainText(after);
    await page.screenshot({ path: join(evidence, 'mcp-write-en-390.png') });
    await mobileWidth(page);
    const confirmArgs = { id: request.assetIds[0], operationId, previewId: preview.previewId, patch };
    const premature = await client.callTool({ name: 'confirm_asset_update', arguments: confirmArgs });
    expect(premature.isError).toBe(true);
    expect(JSON.stringify(premature)).toContain('preview-not-approved');
    await expect(writeDialog).toBeVisible();
    await writeDialog.getByRole('button', { name: 'Approve this change' }).click();
    await expect(writeDialog).toBeHidden();
    expect(result<{ status: string }>(await client.callTool({ name: 'confirm_asset_update', arguments: confirmArgs }))).toEqual({ status: 'applied' });
    expect(result<{ status: string }>(await client.callTool({ name: 'confirm_asset_update', arguments: confirmArgs }))).toEqual({ status: 'duplicate' });
    expect(result<Record<string, unknown>>(await client.callTool({ name: 'get_asset', arguments: { id: request.assetIds[0] } }))).toEqual({ id: request.assetIds[0], name: after });

    await page.getByRole('button', { name: 'Navigation' }).click();
    await page.getByRole('navigation', { name: 'Navigation' }).getByRole('link', { name: 'Projects' }).click();
    await expect(page.getByText(after, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(before, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Navigation' }).click();
    await page.locator('.sidebar-user').click();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
    await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    await page.locator('#assistant > summary').click();
    await expect(panel.getByText('Local connection authorized')).toBeVisible();

    await page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Language' }) }).locator('select').selectOption('zh-CN');
    await expect(panel.getByRole('heading', { name: '本机 MCP 授权' })).toBeVisible();
    await mobileWidth(page);
    await page.screenshot({ path: join(evidence, 'mcp-settings-zh-390.png'), fullPage: true });
    const zhOperationId = `mcp-zh-${crypto.randomUUID()}`;
    const zhPreview = result<{ previewId: string }>(await client.callTool({ name: 'preview_asset_update',
      arguments: { id: request.assetIds[0], operationId: zhOperationId, patch: { name: `${after} proposed` } } }));
    const zhDialog = page.getByRole('dialog', { name: '确认修改资料' });
    await expect(zhDialog).toContainText(after);
    await expect(zhDialog).toContainText(`${after} proposed`);
    await mobileWidth(page);
    await page.screenshot({ path: join(evidence, 'mcp-write-zh-390.png') });
    await zhDialog.getByRole('button', { name: '拒绝本次修改' }).click();
    const rejected = await client.callTool({ name: 'confirm_asset_update', arguments: {
      id: request.assetIds[0], operationId: zhOperationId, previewId: zhPreview.previewId,
      patch: { name: `${after} proposed` },
    } });
    expect(rejected.isError).toBe(true);
    expect(result<Record<string, unknown>>(await client.callTool({ name: 'get_asset', arguments: { id: request.assetIds[0] } }))).toEqual({ id: request.assetIds[0], name: after });

    // Hold the actual RxDB modifier's bridge check, then revoke from the real UI.
    const raceOperationId = `mcp-revoke-${crypto.randomUUID()}`;
    const racePatch = { name: `${after} cancelled` };
    const racePreview = result<{ previewId: string }>(await client.callTool({ name: 'preview_asset_update',
      arguments: { id: request.assetIds[0], operationId: raceOperationId, patch: racePatch } }));
    const raceDialog = page.getByRole('dialog', { name: '确认修改资料' });
    await raceDialog.getByRole('button', { name: '批准本次修改' }).click();
    await expect(raceDialog).toBeHidden();
    let checks = 0;
    let paused = false;
    let continueWrite!: () => void;
    const writeReleased = new Promise<void>(resolve => { continueWrite = resolve; });
    releasePausedWrite = continueWrite;
    await page.route(`${pairing.url}/check-write`, async route => {
      checks++;
      if (checks === 5) { paused = true; await writeReleased; }
      await route.continue();
    });
    const pendingConfirm = client.callTool({ name: 'confirm_asset_update', arguments: {
      id: request.assetIds[0], operationId: raceOperationId, previewId: racePreview.previewId, patch: racePatch,
    } });
    await waitFor(async () => paused);
    await panel.getByRole('button', { name: '撤销本机授权' }).click();
    await expect(panel.getByRole('button', { name: '生成连接请求' })).toBeVisible();
    await expect(panel.getByRole('alert')).toContainText('修改正在处理，可能已保存');
    expect(abortedWriteCheck).toBe(true);
    continueWrite();
    expect((await pendingConfirm).isError).toBe(true);
    await panel.getByRole('alert').scrollIntoViewIfNeeded();
    await mobileWidth(page);
    await page.screenshot({ path: join(evidence, 'mcp-revoke-zh-390.png') });
    await page.goto('/assets/project');
    await expect(page.getByText(after, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(racePatch.name, { exact: true })).toHaveCount(0);
    const revoked = await client.callTool({ name: 'get_asset', arguments: { id: request.assetIds[0] } });
    expect(revoked.isError).toBe(true);
    expect(JSON.stringify(revoked)).toContain('grant-denied');
    const authority = await readFile(join(privateDir, 'authority.json'), 'utf8');
    for (const secret of [pairing.pairingSecret, before, after, hidden, otherDescription]) expect(authority).not.toContain(secret);
    expect(stderr).not.toContain(pairing.pairingSecret);
    expect(errors).toEqual([]);
  } finally {
    releasePausedWrite();
    await client?.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
    await context.close();
    await rm(privateDir, { recursive: true, force: true });
  }
});
