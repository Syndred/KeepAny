import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { expect, type Browser, type Page, test } from '@playwright/test';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { selectChoice } from "./helpers/select-choice";
import { nativePrivateFiles, stopPrivateFilesHelper } from '../../packages/mcp/src/node-private-files';
import { assertPrivateTestFile, privateTestDirectory } from '../../packages/mcp/src/node-private-files.test-support';

const repo = resolve('.');
const packagedExecutable = process.env.KEEPANY_MCP_EXECUTABLE;
const evidence = process.env.KEEPANY_MCP_EVIDENCE_DIR ?? join(repo, 'test-results/evidence/2026-09-29');
test.beforeAll(async () => { await mkdir(evidence, { recursive: true }); });
const evidenceSuffix = process.env.KEEPANY_MCP_EVIDENCE_MODE === 'preview' ? '-preview' : '';
const widths = [360, 390, 768, 1280, 1440] as const;
const languages = [
  { code: 'en', locale: 'en-US', asset: 'Accessible records', read: 'Readable fields', write: 'Editable fields',
    name: 'Name', description: 'Short description', create: 'Create connection request', import: 'Import pairing file',
    scope: 'Confirm local connection', allow: 'Allow connection', deny: 'Deny connection',
    preview: 'Confirm record change', approve: 'Approve this change', reject: 'Deny this change',
    connected: 'Local connection authorized', revoke: 'Revoke local access' },
  { code: 'zh-CN', locale: 'zh-CN', asset: '可访问的资料', read: '可读取的字段', write: '可修改的字段',
    name: '名称', description: '简短描述', create: '生成连接请求', import: '导入配对文件',
    scope: '确认本机连接', allow: '允许连接', deny: '拒绝连接',
    preview: '确认修改资料', approve: '批准本次修改', reject: '拒绝本次修改',
    connected: '本机连接已授权', revoke: '撤销本机授权' },
] as const;
type Language = typeof languages[number];
type Reply = Awaited<ReturnType<Client['callTool']>>;
type RequestFile = { assetIds: string[]; readFields: string[]; writeFields: string[]; appOrigin: string; requestNonce: string };

function result<T>(reply: Reply): T {
  expect(reply.isError).not.toBe(true);
  const structured = reply.structuredContent as { result?: T } | undefined;
  expect(structured).toHaveProperty('result');
  return structured?.result as T;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
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

async function selectLanguage(page: Page, code: string) {
  await page.goto('/settings#assistant');
  await selectChoice(page.locator('section.card').filter({ has: page.getByRole('heading', { name: /^(Language|语言)$/ }) })
    .getByRole("combobox"), code);
  await ensureAssistantOpen(page);
}

async function ensureAssistantOpen(page: Page) {
  const section = page.locator('details#assistant');
  if ((await section.getAttribute('open')) === null) await section.locator('summary').click();
  await expect(section.locator('.mcp-panel')).toBeVisible();
}

async function checkLayout(page: Page, width: number, dialog: ReturnType<Page['getByRole']>, action: ReturnType<Page['getByRole']>) {
  const sizes = await page.evaluate(() => ({
    document: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewport: window.innerWidth,
  }));
  expect(sizes.document).toBeLessThanOrEqual(width);
  expect(sizes.viewport).toBe(width);
  const dialogSize = await dialog.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(dialogSize.scroll).toBeLessThanOrEqual(dialogSize.client + 1);
  await action.scrollIntoViewIfNeeded();
  const actionBox = await action.boundingBox();
  if (!actionBox) throw Error('dialog-action-not-visible');
  expect(actionBox.x).toBeGreaterThanOrEqual(0);
  expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(width + 1);
  expect(actionBox.y).toBeGreaterThanOrEqual(0);
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(850);
  await expect(action).toBeEnabled();
}

async function prepareRequest(page: Page, language: Language, selected: string, excluded: string): Promise<{ path: string; request: RequestFile }> {
  await ensureAssistantOpen(page);
  const panel = page.locator('.mcp-panel');
  const create = panel.getByRole('button', { name: language.create });
  const selectedOption = panel.getByRole('group', { name: language.asset }).getByLabel(selected);
  if (!(await selectedOption.isChecked())) await expect(create).toBeDisabled();
  await selectedOption.check();
  await expect(panel.getByRole('group', { name: language.asset }).getByLabel(excluded)).not.toBeChecked();
  await panel.getByRole('group', { name: language.read }).getByLabel(language.description).check();
  await panel.getByRole('group', { name: language.write }).getByLabel(language.description).check();
  const downloadPromise = page.waitForEvent('download');
  await create.click();
  const path = await (await downloadPromise).path();
  if (!path) throw Error('request-download-missing');
  const request = JSON.parse(await readFile(path, 'utf8')) as RequestFile;
  expect(request.appOrigin).toBe(new URL(page.url()).origin);
  expect(request.assetIds).toHaveLength(1);
  expect(request.readFields).toEqual(['name', 'description']);
  expect(request.writeFields).toEqual(['description']);
  expect(JSON.stringify(request)).not.toContain(selected);
  expect(JSON.stringify(request)).not.toContain(excluded);
  return { path, request };
}

async function launch(path: string, privateDir: string, suffix: string) {
  const pairingPath = join(privateDir, `pairing-${suffix}.json`);
  const childEnv = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...(packagedExecutable ? [packagedExecutable] : ['--import', 'tsx', join(repo, 'apps/mcp-launcher/src/main.ts')]), '--request', path,
      '--pairing-file', pairingPath, '--state-dir', privateDir],
    cwd: repo, env: childEnv, stderr: 'pipe',
  });
  const client = new Client({ name: 'keepany-dialog-matrix', version: '1.0.0' });
  try {
    await client.connect(transport);
    await waitFor(async () => stat(pairingPath).then(() => true, () => false));
    if (process.platform === 'win32') await nativePrivateFiles.checkDirectory(privateDir);
    else expect((await stat(privateDir)).mode & 0o777).toBe(0o700);
    await assertPrivateTestFile(pairingPath, expect);
    return { client, transport, pairingPath };
  } catch (error) {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    throw error;
  }
}

async function fixture(browser: Browser, language: Language, width: number) {
  const context = await browser.newContext({ locale: language.locale, viewport: { width, height: 850 }, acceptDownloads: true });
  const page = await context.newPage();
  const privateDir = await privateTestDirectory('keepany-mcp-dialog-extra-');
  const mark = crypto.randomUUID().slice(0, 8);
  const selected = `Scope selected ${mark}`;
  const excluded = `Scope excluded ${mark}`;
  const before = `Before ${mark}`;
  const outside = `Outside ${mark}`;
  try {
    await selectLanguage(page, 'en');
    await addProject(page, selected, before);
    await addProject(page, excluded, outside);
    await selectLanguage(page, language.code);
    return { context, page, privateDir, selected, excluded, before, outside,
      close: async () => {
        await context.close().catch(() => undefined);
        stopPrivateFilesHelper();
        await rm(privateDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 });
      } };
  } catch (error) {
    await context.close().catch(() => undefined);
    stopPrivateFilesHelper();
    await rm(privateDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 });
    throw error;
  }
}

async function pair(page: Page, language: Language, connection: Awaited<ReturnType<typeof launch>>) {
  await ensureAssistantOpen(page);
  const panel = page.locator('.mcp-panel');
  await panel.getByLabel(language.import).focus();
  await panel.getByLabel(language.import).setInputFiles(connection.pairingPath);
  const dialog = page.getByRole('dialog', { name: language.scope });
  await expect(dialog).toBeVisible();
  return { panel, dialog };
}

for (const language of languages) for (const width of widths) {
  test(`${language.code} ${width}: exact MCP scope and one-record write previews`, async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ locale: language.locale, viewport: { width, height: 850 }, acceptDownloads: true });
    const page = await context.newPage();
    const privateDir = await privateTestDirectory('keepany-mcp-dialog-');
    let connection: Awaited<ReturnType<typeof launch>> | undefined;
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const mark = crypto.randomUUID().slice(0, 8);
    const selected = `Selected ${mark} ${'N'.repeat(125)}`;
    const excluded = `Outside ${mark}`;
    const before = `Visible description ${mark}`;
    const outside = `Unselected secret ${mark}`;
    const rejectedValue = `Rejected ${mark}`;
    const approvedValue = `Approved ${mark} ${'A'.repeat(220)}`;
    try {
      await selectLanguage(page, 'en');
      await addProject(page, selected, before);
      await addProject(page, excluded, outside);
      await selectLanguage(page, language.code);
      const panel = page.locator('.mcp-panel');
      const { path, request } = await prepareRequest(page, language, selected, excluded);
      connection = await launch(path, privateDir, 'main');
      const unpaired = await connection.client.callTool({ name: 'list_assets', arguments: {} });
      expect(unpaired.isError).toBe(true);
      await panel.getByLabel(language.import).focus();
      await panel.getByLabel(language.import).setInputFiles(connection.pairingPath);
      const scope = page.getByRole('dialog', { name: language.scope });
      await expect(scope).toBeVisible();
      await expect(scope).toContainText(selected);
      await expect(scope).toContainText(language.description);
      await expect(scope).not.toContainText(excluded);
      await expect(scope).not.toContainText(outside);
      await checkLayout(page, width, scope, scope.getByRole('button', { name: language.allow }));
      await page.screenshot({ path: join(evidence, `mcp-dialog-${language.code}-${width}${evidenceSuffix}-scope.png`) });
      await scope.getByRole('button', { name: language.allow }).focus();
      await page.keyboard.press('Tab');
      await expect(scope.locator(':focus')).toHaveCount(1);
      await scope.getByRole('button', { name: language.allow }).click();
      await expect(scope).toBeHidden();
      await expect(panel.getByText(language.connected)).toBeVisible();
      const list = result<Array<Record<string, unknown>>>(await connection.client.callTool({ name: 'list_assets', arguments: {} }));
      expect(list).toEqual([{ id: request.assetIds[0], name: selected, description: before }]);
      const denied = await connection.client.callTool({ name: 'preview_asset_update', arguments: {
        id: request.assetIds[0], operationId: `forbidden-${crypto.randomUUID()}`, patch: { name: 'Forbidden' },
      } });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied)).toContain('write-denied');

      const rejectedOperation = `mcp-reject-${crypto.randomUUID()}`;
      const rejectedPatch = { description: rejectedValue };
      const rejectedPreview = result<{ previewId: string }>(await connection.client.callTool({ name: 'preview_asset_update', arguments: {
        id: request.assetIds[0], operationId: rejectedOperation, patch: rejectedPatch,
      } }));
      const write = page.getByRole('dialog', { name: language.preview });
      await expect(write).toContainText(before);
      await expect(write).toContainText(rejectedValue);
      await write.getByRole('button', { name: language.reject }).click();
      await expect(write).toBeHidden();
      const rejectedConfirm = await connection.client.callTool({ name: 'confirm_asset_update', arguments: {
        id: request.assetIds[0], operationId: rejectedOperation, previewId: rejectedPreview.previewId, patch: rejectedPatch,
      } });
      expect(rejectedConfirm.isError).toBe(true);
      expect(result<Record<string, unknown>>(await connection.client.callTool({ name: 'get_asset', arguments: { id: request.assetIds[0] } })))
        .toEqual({ id: request.assetIds[0], name: selected, description: before });

      const operationId = `mcp-approve-${crypto.randomUUID()}`;
      const patch = { description: approvedValue };
      const preview = result<{ previewId: string; changes: unknown[] }>(await connection.client.callTool({ name: 'preview_asset_update', arguments: {
        id: request.assetIds[0], operationId, patch,
      } }));
      expect(preview.changes).toEqual([{ field: 'description', before, after: approvedValue }]);
      await expect(write).toContainText(approvedValue);
      await expect(write).not.toContainText(outside);
      await checkLayout(page, width, write, write.getByRole('button', { name: language.approve }));
      await page.screenshot({ path: join(evidence, `mcp-dialog-${language.code}-${width}${evidenceSuffix}-write.png`) });
      const confirmArgs = { id: request.assetIds[0], operationId, previewId: preview.previewId, patch };
      const premature = await connection.client.callTool({ name: 'confirm_asset_update', arguments: confirmArgs });
      expect(premature.isError).toBe(true);
      expect(JSON.stringify(premature)).toContain('preview-not-approved');
      await write.getByRole('button', { name: language.approve }).click();
      await expect(write).toBeHidden();
      expect(result<{ status: string }>(await connection.client.callTool({ name: 'confirm_asset_update', arguments: confirmArgs })))
        .toEqual({ status: 'applied' });
      expect(result<{ status: string }>(await connection.client.callTool({ name: 'confirm_asset_update', arguments: confirmArgs })))
        .toEqual({ status: 'duplicate' });
      expect(result<Record<string, unknown>>(await connection.client.callTool({ name: 'get_asset', arguments: { id: request.assetIds[0] } })))
        .toEqual({ id: request.assetIds[0], name: selected, description: approvedValue });
      await panel.getByRole('button', { name: language.revoke }).click();
      await expect(panel.getByRole('button', { name: language.create })).toBeVisible();
      const revoked = await connection.client.callTool({ name: 'get_asset', arguments: { id: request.assetIds[0] } });
      expect(revoked.isError).toBe(true);
      expect(JSON.stringify(revoked)).toContain('grant-denied');
      const authority = await readFile(join(privateDir, 'authority.json'), 'utf8');
      for (const value of [selected, excluded, before, outside, approvedValue]) expect(authority).not.toContain(value);
      expect(pageErrors).toEqual([]);
    } finally {
      await connection?.client.close().catch(() => undefined);
      await connection?.transport.close().catch(() => undefined);
      await context.close();
      stopPrivateFilesHelper();
      await rm(privateDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 25 });
    }
  });
}

test('scope request cannot be reused after access choices change and return', async ({ browser }) => {
  test.setTimeout(45_000);
  const language = languages[0];
  const local = await fixture(browser, language, 390);
  try {
    const { page, selected, excluded } = local;
    const panel = page.locator('.mcp-panel');
    await prepareRequest(page, language, selected, excluded);
    await expect(panel.getByLabel(language.import)).toBeEnabled();
    await panel.getByRole('group', { name: language.asset }).getByLabel(excluded).check();
    await expect(panel.getByLabel(language.import)).toBeDisabled();
    await panel.getByRole('group', { name: language.asset }).getByLabel(excluded).uncheck();
    await expect(panel.getByLabel(language.import)).toBeDisabled();
    await expect(panel.getByRole('link', { name: 'Download request file' })).toHaveCount(0);
    await expect(panel.getByRole('alert')).toContainText('Access choices changed');
  } finally {
    await local.close();
  }
});

test('denied and Escape-closed scope dialogs never grant access and return focus', async ({ browser }) => {
  test.setTimeout(90_000);
  const language = languages[0];
  const local = await fixture(browser, language, 390);
  const connections: Array<Awaited<ReturnType<typeof launch>>> = [];
  try {
    for (const method of ['deny', 'Escape'] as const) {
      const { path } = await prepareRequest(local.page, language, local.selected, local.excluded);
      const connection = await launch(path, local.privateDir, method);
      connections.push(connection);
      const { panel, dialog } = await pair(local.page, language, connection);
      expect((await connection.client.callTool({ name: 'list_assets', arguments: {} })).isError).toBe(true);
      if (method === 'deny') await dialog.getByRole('button', { name: language.deny }).click();
      else await local.page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(panel.getByRole('heading', { name: 'Local MCP access' })).toBeFocused();
      await expect(panel.getByRole('alert')).toContainText('not approved');
      const unauthorized = await connection.client.callTool({ name: 'get_asset', arguments: { id: 'any-id' } });
      expect(unauthorized.isError).toBe(true);
      const authority = await readFile(join(local.privateDir, 'authority.json'), 'utf8');
      expect(authority).not.toContain(local.before);
      expect(authority).not.toContain(local.outside);
      await local.page.screenshot({ path: join(evidence, `mcp-dialog-en-390-scope-${method}.png`) });
      await connection.client.close().catch(() => undefined);
      await connection.transport.close().catch(() => undefined);
    }
  } finally {
    for (const connection of connections) {
      await connection.client.close().catch(() => undefined);
      await connection.transport.close().catch(() => undefined);
    }
    await local.close();
  }
});

test('a preview expires when the record changes in another browser tab', async ({ browser }) => {
  test.setTimeout(90_000);
  const language = languages[0];
  const local = await fixture(browser, language, 390);
  let connection: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    const { path, request } = await prepareRequest(local.page, language, local.selected, local.excluded);
    connection = await launch(path, local.privateDir, 'conflict');
    const { panel, dialog } = await pair(local.page, language, connection);
    await dialog.getByRole('button', { name: language.allow }).click();
    await expect(panel.getByText(language.connected)).toBeVisible();
    const operationId = `mcp-conflict-${crypto.randomUUID()}`;
    const patch = { description: `Proposal ${crypto.randomUUID().slice(0, 8)}` };
    const preview = result<{ previewId: string }>(await connection.client.callTool({ name: 'preview_asset_update', arguments: {
      id: request.assetIds[0], operationId, patch,
    } }));
    const write = local.page.getByRole('dialog', { name: language.preview });
    await expect(write).toContainText(patch.description);
    const second = await local.context.newPage();
    const changed = `Changed in second tab ${crypto.randomUUID().slice(0, 8)}`;
    await second.goto('/assets/project');
    await second.locator(`.asset-list-content a[href="/assets/project/${request.assetIds[0]}"]`).click();
    await second.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = second.getByRole('dialog');
    await edit.getByLabel('Short description').fill(changed);
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit).toBeHidden();
    const approve = write.getByRole('button', { name: language.approve });
    if (await approve.isEnabled()) await approve.click();
    else await write.getByRole('button', { name: language.reject }).click();
    await expect(write).toBeHidden();
    const denied = await connection.client.callTool({ name: 'confirm_asset_update', arguments: {
      id: request.assetIds[0], operationId, previewId: preview.previewId, patch,
    } });
    expect(denied.isError).toBe(true);
    expect(result<Record<string, unknown>>(await connection.client.callTool({ name: 'get_asset', arguments: { id: request.assetIds[0] } })))
      .toEqual({ id: request.assetIds[0], name: local.selected, description: changed });
    await expect(panel.getByRole('alert')).toContainText('expired');
    await local.page.screenshot({ path: join(evidence, 'mcp-dialog-en-390-preview-conflict.png') });
  } finally {
    await connection?.client.close().catch(() => undefined);
    await connection?.transport.close().catch(() => undefined);
    await local.close();
  }
});

test('two synchronous approval clicks produce one approval and no false connection error', async ({ browser }) => {
  test.setTimeout(90_000);
  const language = languages[0];
  const local = await fixture(browser, language, 390);
  let connection: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    const { path, request } = await prepareRequest(local.page, language, local.selected, local.excluded);
    connection = await launch(path, local.privateDir, 'double');
    const { panel, dialog } = await pair(local.page, language, connection);
    await dialog.getByRole('button', { name: language.allow }).click();
    await expect(panel.getByText(language.connected)).toBeVisible();
    const operationId = `mcp-double-${crypto.randomUUID()}`;
    const patch = { description: `Only once ${crypto.randomUUID().slice(0, 8)}` };
    const preview = result<{ previewId: string }>(await connection.client.callTool({ name: 'preview_asset_update', arguments: {
      id: request.assetIds[0], operationId, patch,
    } }));
    const write = local.page.getByRole('dialog', { name: language.preview });
    const approve = write.getByRole('button', { name: language.approve });
    await expect(approve).toBeEnabled();
    await approve.evaluate(element => { (element as HTMLElement).click(); (element as HTMLElement).click(); });
    await expect(write).toBeHidden();
    await expect(panel.getByRole('alert')).toHaveCount(0);
    const authority = JSON.parse(await readFile(join(local.privateDir, 'authority.json'), 'utf8')) as {
      audit: Array<{ action: string; operationId?: string }>;
    };
    expect(authority.audit.filter(entry => entry.action === 'approve' && entry.operationId === operationId)).toHaveLength(1);
    const confirmArgs = { id: request.assetIds[0], operationId, previewId: preview.previewId, patch };
    expect(result<{ status: string }>(await connection.client.callTool({ name: 'confirm_asset_update', arguments: confirmArgs })))
      .toEqual({ status: 'applied' });
    expect(result<{ status: string }>(await connection.client.callTool({ name: 'confirm_asset_update', arguments: confirmArgs })))
      .toEqual({ status: 'duplicate' });
  } finally {
    await connection?.client.close().catch(() => undefined);
    await connection?.transport.close().catch(() => undefined);
    await local.close();
  }
});

test('removing the selected record during scope approval cannot authorize the stale scope', async ({ browser }) => {
  test.setTimeout(90_000);
  const language = languages[0];
  const local = await fixture(browser, language, 390);
  let connection: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    const { path, request } = await prepareRequest(local.page, language, local.selected, local.excluded);
    connection = await launch(path, local.privateDir, 'removed');
    const { panel, dialog } = await pair(local.page, language, connection);
    const second = await local.context.newPage();
    await second.goto('/assets/project');
    await second.locator(`.asset-list-content a[href="/assets/project/${request.assetIds[0]}"]`).click();
    await second.getByRole('button', { name: 'Move to trash' }).click();
    await second.getByRole('dialog').getByRole('button', { name: 'Move to trash' }).click();
    await expect(second.getByRole('heading', { name: local.selected })).toHaveCount(0);
    await expect(panel.locator('.mcp-asset-list')).not.toContainText(local.selected);
    if (await dialog.isVisible()) await dialog.getByRole('button', { name: language.allow }).click();
    await expect(panel.getByText(language.connected)).toHaveCount(0);
    expect((await connection.client.callTool({ name: 'list_assets', arguments: {} })).isError).toBe(true);
  } finally {
    await connection?.client.close().catch(() => undefined);
    await connection?.transport.close().catch(() => undefined);
    await local.close();
  }
});
