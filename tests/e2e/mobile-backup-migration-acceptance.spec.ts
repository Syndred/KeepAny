import { serve } from '@hono/node-server';
import pg from 'pg';
import { PostgresSyncService } from '../../packages/sync-core/src/postgres';
import { createPostgresSyncApp } from '../../apps/sync-server/src/app';
import { createStaticTokenAuthenticator } from '../../apps/sync-server/src/auth';
import { migrateSyncDatabase } from '../../apps/sync-server/src/migrate';
import { unusedPort } from './helpers/portable-upgrade';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { decryptBackup, encryptBackup, BACKUP_CONTAINER_MAX_BYTES } from '../../packages/local-db/src/backup-crypto';
import { inspectArchive, type RecordRow, type DatasetBinding } from '../../packages/local-db/src';
import type { Asset } from '../../packages/domain/src';
import { sourceModuleUrl } from './helpers/source-module-url';
import { selectChoice } from './helpers/select-choice';

test.describe('F20-01 C delivery states, B real encrypted download', () => {

// Inside Vite's web root use the same browser module URL as the real callers.
// /@fs for this in-root file would create a second ES-module instance.
const deliveryPath = '/src/file-delivery.ts';
const password = 'Synthetic-export-only-2026';

test('Web keeps a real encrypted backup download without a native handler', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  await page.goto('/intake');
  await page.locator('#backup-password').fill(password);
  await page.getByRole('button', { name: 'Create backup', exact: true }).click();
  const save = page.getByRole('link', { name: 'Save backup file', exact: true });
  await expect(save).toBeVisible();
  const downloading = page.waitForEvent('download');
  await save.click();
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toMatch(/^keepany-\d{4}-\d{2}-\d{2}\.ka1$/);
  const path = await downloaded.path();
  if (!path) throw Error('synthetic-download-missing');
  const archive = await decryptBackup(new Uint8Array(readFileSync(path)), password);
  expect(archive.slice(0, 2)).toEqual(new Uint8Array([80, 75]));
});

for (const zh of [true, false]) {
  test(`${zh ? 'zh-CN' : 'en'} actual backup link uses the registered delivery boundary and distinguishes cancel/open/failure`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(language => localStorage.setItem('keepany-language', language), zh ? 'zh-CN' : 'en');
    await page.goto('/intake');
    await page.evaluate(async path => {
      const state: { count: number; result: string; name: string; magic: string; bytes: number; finish?: () => void } = { count: 0, result: 'cancelled', name: '', magic: '', bytes: 0 };
      Object.assign(window, { __deliveryTest: state });
      const { registerFileDeliveryHandler } = await import(path);
      registerFileDeliveryHandler(async (request: { name: string; bytes: Uint8Array }) => {
        state.count++; state.name = request.name; state.bytes = request.bytes.length;
        state.magic = new TextDecoder().decode(request.bytes.slice(0, 8));
        if (state.result === 'failure') throw Error('synthetic-share-failure');
        if (state.result === 'pending') return new Promise(resolve => { state.finish = () => resolve({ status: 'opened' }); });
        return { status: state.result };
      });
    }, deliveryPath);
    await page.locator('#backup-password').fill(password);
    await page.getByRole('button', { name: zh ? '创建备份' : 'Create backup', exact: true }).click();
    const save = page.getByRole('link', { name: zh ? '保存或分享文件' : 'Save or share file', exact: true });
    await expect(save).toBeVisible();
    await save.click();
    const notice = page.locator('.notice[role=status]');
    await expect(notice).toContainText(zh ? '已取消保存或分享' : 'Save or share cancelled');
    const first = await page.evaluate(() => (window as unknown as { __deliveryTest: { count: number; magic: string; name: string; bytes: number } }).__deliveryTest);
    expect(first).toMatchObject({ count: 1, magic: 'KEEPANY1' });
    expect(first.name).toMatch(/\.ka1$/); expect(first.bytes).toBeGreaterThan(52);
    await page.evaluate(() => { (window as unknown as { __deliveryTest: { result: string } }).__deliveryTest.result = 'pending'; });
    await save.click();
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await save.click({ force: true });
    expect(await page.evaluate(() => (window as unknown as { __deliveryTest: { count: number } }).__deliveryTest.count)).toBe(2);
    await page.evaluate(() => { (window as unknown as { __deliveryTest: { finish: () => void } }).__deliveryTest.finish(); });
    await expect(notice).toContainText(zh ? '返回应用不代表文件已保存' : 'returning to the app does not confirm it was saved');
    await page.evaluate(() => { (window as unknown as { __deliveryTest: { result: string } }).__deliveryTest.result = 'failure'; });
    await save.click();
    await expect(notice).toContainText(zh ? '无法打开文件保存或分享' : 'Could not prepare the file');
    await expect(save).not.toHaveAttribute('aria-disabled', 'true');
    await page.evaluate(() => { (window as unknown as { __deliveryTest: { result: string } }).__deliveryTest.result = 'saved'; });
    await save.click(); await expect(notice).toContainText(zh ? '文件已保存，并已读回核对' : 'The file was saved and read back for verification');
  });
}


});

test.describe('F20-05-06 B recovery panel, C write interruption', () => {

const repositoryModuleUrl = sourceModuleUrl("packages/local-db/src/index.ts");
const password = "restore-recovery-ui-password-2026";

const copyFor = (zh: boolean) => zh ? {
	add: "新增", name: "名称", save: "保存", edit: "编辑", notes: "备注",
	backup: "创建备份", download: "保存备份文件", preview: "预览", confirm: /^确认 ·/,
	continue: "继续恢复", keepCurrent: "保留当前资料并放弃剩余恢复", abandonConfirm: "确认保留当前资料",
	recoveryTitle: "恢复待处理", working: "处理中…",
	abandonHint: "剩余记录和审核条目不会继续写入",
} : {
	add: "Add", name: "Name", save: "Save", edit: "Edit", notes: "Notes",
	backup: "Create backup", download: "Save backup file", preview: "Preview", confirm: /^Confirm ·/,
	continue: "Continue restore", keepCurrent: "Keep current data and abandon restore", abandonConfirm: "Keep current data",
	recoveryTitle: "Restore needs attention", working: "Working…",
	abandonHint: "Remaining records and review entries will not continue",
};

type Copy = ReturnType<typeof copyFor>;
type Archive = { path: string; rows: RecordRow[] };

async function createAccount(page: Page, copy: Copy, name: string) {
	await page.goto("/assets/account");
	await page.getByRole("main").getByRole("button", { name: copy.add, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(copy.name, { exact: true }).fill(name);
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator("main .asset-account-card").filter({ hasText: name })).toHaveCount(1);
}

async function editAccount(page: Page, copy: Copy, name: string, notes: string, navigate = true) {
	if (navigate) await page.goto("/assets/account");
	await page.locator("main .asset-account-card").filter({ hasText: name }).click();
	await page.getByRole("button", { name: copy.edit, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.locator("#notes").fill(notes);
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator(".note")).toContainText(notes);
}

async function downloadAndInspect(page: Page, copy: Copy, filename: string): Promise<Archive> {
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: copy.backup, exact: true }).click();
	const link = page.getByRole("link", { name: copy.download, exact: true });
	await expect(link).toBeVisible();
	const downloadPromise = page.waitForEvent("download");
	await link.click();
	const download = await downloadPromise;
	const path = test.info().outputPath(filename);
	await download.saveAs(path);
	const bytes = readFileSync(path);
	expect(bytes.subarray(0, 8).toString()).toBe("KEEPANY1");
	const inspected = await inspectArchive(await decryptBackup(new Uint8Array(bytes), password));
	expect(inspected.manifest.recordCount).toBe(inspected.rows.length);
	return { path, rows: inspected.rows };
}

async function prepareRestore(page: Page, copy: Copy, archivePath: string, navigate = true) {
	if (navigate) await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.locator("#restore-file").setInputFiles(archivePath);
	await page.getByRole("button", { name: copy.preview, exact: true }).first().click();
	await expect(page.getByRole("button", { name: copy.confirm })).toBeVisible();
}

async function injectRestoreWriteFault(page: Page, failAfterAssets: number) {
	await page.evaluate(async ({ moduleUrl, failAfterAssets }) => {
		const { localRepository } = await import(moduleUrl);
		const repository = await localRepository();
		const original = repository.db.records.insert.bind(repository.db.records);
		let assetWrites = 0;
		repository.db.records.insert = async (...args: unknown[]) => {
			const record = args[0] as { type?: string };
			if (record.type === "asset" && assetWrites++ >= failAfterAssets) {
				repository.db.records.insert = original;
				throw Error("test-restore-write-fault");
			}
			return original(...args);
		};
	}, { moduleUrl: repositoryModuleUrl, failAfterAssets });
}

async function expectPendingPanel(page: Page, copy: Copy, counts: [number, number, number, number, number]) {
	const panel = page.locator(".restore-recovery-panel");
	await expect(panel).toBeVisible();
	await expect(panel.getByRole("heading", { name: copy.recoveryTitle, exact: true })).toBeVisible();
	await expect(panel.locator(".restore-recovery-counts dd")).toHaveText(counts.map(String));
	return panel;
}

function assets(rows: RecordRow[]): Asset[] {
	return rows.filter((row) => row.type === "asset").map((row) => JSON.parse(row.payload) as Asset);
}

async function closeContexts(contexts: BrowserContext[]) {
	for (const context of contexts) await context.close();
}

async function attachPageErrors(errors: string[]) {
	await test.info().attach("restore-self-service-page-errors", {
		body: errors.length ? errors.join("\n") : "0 page errors",
		contentType: "text/plain",
	});
}

test("zh-CN 390 interrupted restore can continue from the recovery panel", async ({ browser }) => {
	test.setTimeout(120_000);
	const copy = copyFor(true);
	const contexts: BrowserContext[] = [];
	const errors: string[] = [];
	const suffix = crypto.randomUUID().slice(0, 8);
	const names = [`恢复资料 A ${suffix}`, `恢复资料 B ${suffix}`];
	try {
		const source = await browser.newContext({ locale: "zh-CN", viewport: { width: 390, height: 844 }, acceptDownloads: true });
		const clean = await browser.newContext({ locale: "zh-CN", viewport: { width: 390, height: 844 }, acceptDownloads: true });
		contexts.push(source, clean);
		const sourcePage = await source.newPage();
		const cleanPage = await clean.newPage();
		for (const page of [sourcePage, cleanPage]) {
			page.setDefaultTimeout(15_000);
			page.on("pageerror", (error) => errors.push(error.message));
		}
		for (const name of names) await createAccount(sourcePage, copy, name);
		const sourceArchive = await downloadAndInspect(sourcePage, copy, "restore-self-service-continue-source.ka1");
		expect(assets(sourceArchive.rows)).toHaveLength(2);

		await prepareRestore(cleanPage, copy, sourceArchive.path);
		await injectRestoreWriteFault(cleanPage, 1);
		await cleanPage.getByRole("button", { name: copy.confirm }).click();
		const panel = await expectPendingPanel(cleanPage, copy, [2, 0, 1, 1, 0]);
		await cleanPage.screenshot({ path: test.info().outputPath("restore-self-service-continue-zh-390-pending.png"), fullPage: true });
        await prepareRestore(cleanPage, copy, sourceArchive.path, false);
        await cleanPage.getByRole('button', { name: copy.confirm }).click();
        await expect(panel).toBeVisible();
        expect(await cleanPage.evaluate(async modulePath => (await (await import(modulePath)).localRepository()).fileStore.journal.count(), repositoryModuleUrl)).toBe(1);
		await panel.getByRole("button", { name: copy.continue, exact: true }).click();
		await expect(panel).toBeHidden();
		await cleanPage.reload();
		await expect(cleanPage.locator(".restore-recovery-panel")).toHaveCount(0);
		const restored = await downloadAndInspect(cleanPage, copy, "restore-self-service-continue-zh-390-restored.ka1");
		expect(restored.rows).toEqual(sourceArchive.rows);
		await cleanPage.screenshot({ path: test.info().outputPath("restore-self-service-continue-zh-390-restored.png"), fullPage: true });
		expect(await cleanPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
		expect(errors).toEqual([]);
	} finally {
		await attachPageErrors(errors);
		await closeContexts(contexts);
	}
});

test("en-US 390 local third-version conflict can keep current data and abandon the remainder", async ({ browser }) => {
	test.setTimeout(120_000);
	const copy = copyFor(false);
	const contexts: BrowserContext[] = [];
	const errors: string[] = [];
	const suffix = crypto.randomUUID().slice(0, 8);
	const names = [`Recovery source A ${suffix}`, `Recovery source B ${suffix}`];
	const sourceNotes = `source second version ${suffix}`;
	const localNotes = `local third version ${suffix}`;
	try {
		const source = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 }, acceptDownloads: true });
		const clean = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 }, acceptDownloads: true });
		contexts.push(source, clean);
		const sourcePage = await source.newPage();
		const cleanPage = await clean.newPage();
		for (const page of [sourcePage, cleanPage]) {
			page.setDefaultTimeout(15_000);
			page.on("pageerror", (error) => errors.push(error.message));
		}
		for (const name of names) await createAccount(sourcePage, copy, name);
		await editAccount(sourcePage, copy, names[0], sourceNotes);
		const sourceArchive = await downloadAndInspect(sourcePage, copy, "restore-self-service-abandon-source.ka1");
		expect(assets(sourceArchive.rows)).toHaveLength(2);

		// Load the formal account editor route before the recovery journal exists;
		// subsequent navigation reuses its repository handle for the local edit.
		await cleanPage.goto("/assets/account");
		await expect(cleanPage.getByRole("main").getByRole("button", { name: copy.add, exact: true })).toBeVisible();
		await cleanPage.locator('.mobile-tabbar a[href="/more"]').click(); await cleanPage.locator('.mobile-more-page a[href="/intake"]').click();
		await expect(cleanPage).toHaveURL(/\/intake$/);
		await prepareRestore(cleanPage, copy, sourceArchive.path, false);
		await injectRestoreWriteFault(cleanPage, 1);
		await cleanPage.getByRole("button", { name: copy.confirm }).click();
		const panel = await expectPendingPanel(cleanPage, copy, [2, 0, 1, 1, 0]);
		await cleanPage.screenshot({ path: test.info().outputPath("restore-self-service-abandon-en-390-pending.png"), fullPage: true });

		await cleanPage.locator('.mobile-tabbar a[href="/accounts"]').click();
		await expect(cleanPage).toHaveURL(/\/accounts$/);
		await expect(cleanPage.locator("main .asset-account-card").first()).toBeVisible();
		let presentName = "";
		for (const name of names) {
			if (await cleanPage.locator("main .asset-account-card").filter({ hasText: name }).count()) {
				presentName = name;
				break;
			}
		}
		if (!presentName) throw Error("partial-restore-account-missing");
		const missingName = names.find((name) => name !== presentName);
		if (!missingName) throw Error("partial-restore-missing-account-name");
		await editAccount(cleanPage, copy, presentName, localNotes, false);
		await cleanPage.locator('.mobile-tabbar a[href="/more"]').click(); await cleanPage.locator('.mobile-more-page a[href="/intake"]').click();
		await expect(cleanPage).toHaveURL(/\/intake$/);
		await expect(panel).toBeVisible();
		await expect(panel.locator(".restore-recovery-counts dd")).toHaveText(["2", "0", "0", "1", "1"]);
		await panel.getByRole("button", { name: copy.keepCurrent, exact: true }).click();
		const confirm = cleanPage.getByRole("dialog");
		await expect(confirm).toContainText(copy.abandonHint);
		await confirm.getByRole("button", { name: copy.abandonConfirm, exact: true }).click();
		await expect(panel).toBeHidden();

		await cleanPage.reload();
		await cleanPage.locator('.mobile-tabbar a[href="/accounts"]').click();
		await expect(cleanPage).toHaveURL(/\/accounts$/);
		await expect(cleanPage.locator("main .asset-account-card").filter({ hasText: presentName })).toBeVisible();
		await expect(cleanPage.locator("main .asset-account-card").filter({ hasText: missingName })).toHaveCount(0);
		await cleanPage.locator("main .asset-account-card").filter({ hasText: presentName }).click();
		await expect(cleanPage.locator(".note")).toContainText(localNotes);
		const restored = await downloadAndInspect(cleanPage, copy, "restore-self-service-abandon-en-390-restored.ka1");
		const sourceAssets = assets(sourceArchive.rows);
		const restoredAssets = assets(restored.rows);
		const presentSource = sourceAssets.find((asset) => asset.name === presentName);
		const missingSource = sourceAssets.find((asset) => asset.name === missingName);
		if (!presentSource || !missingSource) throw Error("source-restore-assets-missing");
		expect(restoredAssets).toHaveLength(1);
		expect(restoredAssets[0].id).toBe(presentSource.id);
		expect(restoredAssets[0].id).not.toBe(missingSource.id);
		expect(restoredAssets[0].notes).toBe(localNotes);
		await cleanPage.screenshot({ path: test.info().outputPath("restore-self-service-abandon-en-390-kept.png"), fullPage: true });
		expect(await cleanPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
		expect(errors).toEqual([]);
	} finally {
		await attachPageErrors(errors);
		await closeContexts(contexts);
	}
});

});

test.describe('F20-07 C source identity and B refusal/budget', () => {

const password = 'synthetic-restore-identity-password';
const token = 'synthetic-identity-token-'.padEnd(40, 'x');
const key = Buffer.from(new Uint8Array(32).fill(8)).toString('base64url');
test.use({ actionTimeout: 15_000 });

// Reuse the existing migration fixture's HTTP contract. Records enter through
// actual UI, and proof of the resulting local dataset comes from real downloads.
async function mockSync(context: BrowserContext, port: number, workspaceId: string) {
  let sequence = 0;
  await context.route(`http://127.0.0.1:${port}/**`, async route => {
    const request = route.request();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type', 'content-type': 'application/json' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const body = JSON.parse(request.postData() || '{}');
    if (body.workspaceId !== workspaceId) return route.fulfill({ status: 403, json: {}, headers });
    if (request.url().endsWith('/sync/preflight')) return route.fulfill({ json: { accountId: 'self-host-owner', workspaceId }, headers });
    if (request.url().endsWith('/sync/pull')) return route.fulfill({ json: { changes: [], nextCursor: Number(body.cursor) }, headers });
    if (request.url().endsWith('/sync/push')) return route.fulfill({ json: {
      results: body.operations.map((operation: { operationId: string }) => ({
        operationId: operation.operationId, status: 'accepted', version: 1, sequence: ++sequence,
      })),
    }, headers });
    return route.fulfill({ status: 404, json: {}, headers });
  });
}

async function connect(page: Page, port: number, workspaceId: string, zh: boolean) {
  await page.goto('/settings#connections');
  const inputs = page.locator('.sync-panel .form-grid input');
  await inputs.nth(0).fill(`http://127.0.0.1:${port}`); await inputs.nth(1).fill(token);
  await inputs.nth(2).fill(workspaceId); await inputs.nth(3).fill(key);
  await page.locator('.sync-panel').getByRole('button', { name: zh ? '立即同步' : 'Sync now', exact: true }).click();
  await expect(page.locator('.sync-panel .notice')).toHaveText(zh ? '本次同步已完成' : 'This sync completed');
}

async function add(page: Page, kind: 'project' | 'item', name: string, zh: boolean) {
  await page.goto(`/assets/${kind}`);
  await page.getByRole('button', { name: zh ? '新增' : 'Add', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel(zh ? '名称' : 'Name', { exact: true }).fill(name);
  await editor.getByRole('button', { name: zh ? '保存' : 'Save', exact: true }).click();
  await expect(editor).toBeHidden();
}

async function download(page: Page, zh: boolean, filename: string) {
  await page.goto('/intake'); await page.locator('#backup-password').fill(password);
  await page.getByRole('button', { name: zh ? '创建备份' : 'Create backup', exact: true }).click();
  const link = page.getByRole('link', { name: zh ? '保存备份文件' : 'Save backup file' });
  await expect(link).toBeVisible();
  const downloading = page.waitForEvent('download'); await link.click();
  const path = test.info().outputPath(filename); await (await downloading).saveAs(path);
  const entries = unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)), password));
  return { path, rows: JSON.parse(strFromU8(entries['records.json'])) as RecordRow[],
    manifest: JSON.parse(strFromU8(entries['manifest.json'])) as { sourceBinding?: DatasetBinding } };
}

async function restore(page: Page, file: string, zh: boolean) {
  await page.goto('/intake'); await page.locator('#backup-password').fill(password);
  await page.locator('#restore-file').setInputFiles(file);
  await page.getByRole('button', { name: zh ? '预览' : 'Preview', exact: true }).first().click();
  const confirm = page.getByRole('button', { name: zh ? '确认 · 1' : 'Confirm · 1', exact: true });
  await expect(confirm).toBeVisible(); await confirm.click();
}

for (const locale of ['zh-CN', 'en-US']) test(`${locale} ordinary restore preserves source identity and blocks a cross-workspace import`, async ({ browser }) => {
  test.setTimeout(90_000);
  const zh = locale === 'zh-CN';
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  async function isolated() {
    const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, acceptDownloads: true });
    contexts.push(context);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    return { context, page };
  }
  try {
    const source = await isolated(), target = await isolated(), clean = await isolated();
    const sourceWorkspace = crypto.randomUUID(), targetWorkspace = crypto.randomUUID();
    await mockSync(source.context, 3216, sourceWorkspace); await mockSync(target.context, 3217, targetWorkspace);
    await add(source.page, 'project', 'Synthetic source project', zh);
    await connect(source.page, 3216, sourceWorkspace, zh);
    const sourceBackup = await download(source.page, zh, 'source.ka1');
    expect(sourceBackup.manifest.sourceBinding?.workspaceId).toBe(sourceWorkspace);
    await add(target.page, 'item', 'Synthetic target item', zh);
    await connect(target.page, 3217, targetWorkspace, zh);
    const before = await download(target.page, zh, 'target-before.ka1');
    await restore(target.page, sourceBackup.path, zh);
    const refusal = target.page.getByRole('status').filter({ hasText: zh
      ? '备份来源与当前同步身份不一致，或没有来源标识，未恢复资料。'
      : 'The backup has a different or unknown sync identity. No records were restored.' });
    await expect(refusal).toBeVisible();
    expect(await target.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await target.page.screenshot({ path: test.info().outputPath(`restore-refused-${locale}.png`), fullPage: true });
    const after = await download(target.page, zh, 'target-after.ka1');
    expect(after.rows).toEqual(before.rows); expect(after.manifest.sourceBinding).toEqual(before.manifest.sourceBinding);
    await target.page.reload();
    const reloaded = await download(target.page, zh, 'target-reloaded.ka1');
    expect(reloaded.rows).toEqual(before.rows);
    const oversized = test.info().outputPath('synthetic-oversized.ka1');
    const sparse = await open(oversized, 'w');
    try { await sparse.truncate(BACKUP_CONTAINER_MAX_BYTES + 1); } finally { await sparse.close(); }
    await clean.page.goto('/intake'); await clean.page.locator('#backup-password').fill(password);
    await clean.page.locator('#restore-file').setInputFiles(oversized);
    await clean.page.getByRole('button', { name: zh ? '预览' : 'Preview', exact: true }).first().click();
    await expect(clean.page.getByRole('status').filter({ hasText: zh ? '备份超过恢复大小上限' : 'This backup exceeds the restore limit' })).toBeVisible();
    await expect(clean.page.getByRole('button', { name: /^(确认|Confirm) ·/ })).toHaveCount(0);
    await restore(clean.page, sourceBackup.path, zh);
    await expect(clean.page.getByRole('status').filter({ hasText: zh ? '已恢复 1 条记录' : 'Restored 1 records' })).toBeVisible();
    await clean.page.reload();
    const restored = await download(clean.page, zh, 'restored.ka1');
    expect(restored.rows).toEqual(sourceBackup.rows);
    expect(restored.manifest.sourceBinding).toEqual(sourceBackup.manifest.sourceBinding);
    await restore(clean.page, sourceBackup.path, zh);
    await expect(clean.page.getByRole('status').filter({ hasText: zh ? '已恢复 1 条记录' : 'Restored 1 records' })).toBeVisible();
    expect(await clean.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await clean.page.screenshot({ path: test.info().outputPath(`restore-same-source-${locale}.png`), fullPage: true });
    expect(errors).toEqual([]);
  } finally { for (const context of contexts) await context.close(); }
});

});

test.describe('F20-07-09 C controlled migration protocol and B UI', () => {

const token = "migration-test-token-".padEnd(40, "x");
const key = Buffer.from(new Uint8Array(32).fill(9)).toString("base64url");
const password = "migration-source-passphrase";
const targetPassword = "migration-target-passphrase";
test.use({ actionTimeout: 15_000 });

function mockSync(context: BrowserContext, port: number, workspaceId: string) {
	const accepted = new Map<string, { version: number; sequence: number }>();
	const versions = new Map<string, number>();
	let pushes = 0;
	let dropAck = false;
	void context.route(`http://127.0.0.1:${port}/**`, async route => {
		const request = route.request();
		const body = JSON.parse(request.postData() || "{}") as Record<string, unknown>;
		const headers = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, content-type", "content-type": "application/json" };
		if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
		if (body.workspaceId !== workspaceId) return route.fulfill({ status: 403, json: {}, headers });
		if (request.url().endsWith("/sync/preflight")) return route.fulfill({ json: { accountId: "self-host-owner", workspaceId }, headers });
		if (request.url().endsWith("/sync/pull")) return route.fulfill({ json: { changes: [], nextCursor: Number(body.cursor) }, headers });
		if (request.url().endsWith("/sync/push")) {
			pushes++;
			const operations = body.operations as { operationId: string; id: string }[];
			const results = operations.map(operation => {
				const previous = accepted.get(operation.operationId);
				if (!previous) {
					const version = (versions.get(operation.id) ?? 0) + 1;
					versions.set(operation.id, version);
					accepted.set(operation.operationId, { version, sequence: accepted.size + 1 });
				}
				return { operationId: operation.operationId, status: previous ? "duplicate" : "accepted", ...accepted.get(operation.operationId) };
			});
			if (dropAck) { dropAck = false; return route.abort("failed"); }
			return route.fulfill({ json: { results }, headers });
		}
		return route.fulfill({ status: 404, json: {}, headers });
	});
	return { accepted, get pushes() { return pushes; }, dropNextPushAck() { dropAck = true; } };
}

async function configure(page: Page, port: number, workspaceId: string) {
	await page.goto("/settings#connections");
	const inputs = page.locator(".sync-panel .form-grid input");
	await inputs.nth(0).fill(`http://127.0.0.1:${port}`);
	await inputs.nth(1).fill(token);
	await inputs.nth(2).fill(workspaceId);
	await inputs.nth(3).fill(key);
}

async function sourceBackup(page: Page, label: string, port: number, workspaceId: string) {
	await page.goto("/assets/project");
	await page.getByRole("button", { name: label === "en" ? "Add" : "新增", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(label === "en" ? "Name" : "名称", { exact: true }).fill("Source migration project");
	await dialog.getByRole("button", { name: label === "en" ? "Save" : "保存" }).click();
	await expect(dialog).toBeHidden();
	await configure(page, port, workspaceId);
	await page.locator(".sync-panel").getByRole("button", { name: label === "en" ? "Sync now" : "立即同步" }).click();
	await expect(page.locator(".sync-panel .notice")).toHaveText(label === "en" ? "This sync completed" : "本次同步已完成");
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: label === "en" ? "Create backup" : "创建备份", exact: true }).first().click();
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.getByRole("link", { name: label === "en" ? "Save backup file" : "保存备份文件" }).click(),
	]);
	const file = path.join(test.info().outputDir, `source-${label}.ka1`);
	await download.saveAs(file);
	return file;
}

for (const locale of ["en", "zh-CN"] as const) {
	test(`explicit archive migration in ${locale}`, async ({ browser }) => {
		test.setTimeout(180_000);
		const sourceContext = await browser.newContext({ locale: locale === "en" ? "en-US" : "zh-CN", viewport: { width:390,height:844 } });
		const targetContext = await browser.newContext({ locale: locale === "en" ? "en-US" : "zh-CN", viewport: locale === "en" ? { width: 390, height: 900 } : { width: 390, height: 844 } });
		const errors: string[] = [];
		const sourcePage = await sourceContext.newPage();
		const targetPage = await targetContext.newPage();
		sourcePage.on("pageerror", error => errors.push(`source: ${error.message}`));
		targetPage.on("pageerror", error => errors.push(`target: ${error.message}`));
		const sourceWorkspace = crypto.randomUUID();
		const targetWorkspace = crypto.randomUUID();
		mockSync(sourceContext, 3199, sourceWorkspace);
		const targetServer = mockSync(targetContext, 3200, targetWorkspace);
		try {
			const file = await sourceBackup(sourcePage, locale === "en" ? "en" : "zh", 3199, sourceWorkspace);
			await configure(targetPage, 3200, targetWorkspace);
			const panel = targetPage.locator(".migration-panel");
			await panel.locator('input[type="file"]').first().setInputFiles(file);
			await panel.locator('input[type="password"]').first().fill(password);
			await panel.getByRole("button", { name: locale === "en" ? "Check target and preview" : "核对目标并预览" }).click();
			await expect(panel).toContainText(targetWorkspace);
			await expect(panel).toContainText(locale === "en" ? "Source records: 1" : "来源共 1 条");
			await panel.getByLabel(locale === "en" ? "I checked the source and target for this merge" : "我已核对来源和目标，确认这次合并").check();
			await panel.getByLabel(locale === "en" ? "Target backup password (12 characters minimum)" : "目标备份密码（至少 12 位）").fill(targetPassword);
			await panel.getByRole("button", { name: locale === "en" ? "Create target backup" : "生成目标备份" }).click();
			const [download] = await Promise.all([
				targetPage.waitForEvent("download"),
				panel.getByRole("link", { name: locale === "en" ? "Download target backup" : "下载目标备份" }).click(),
			]);
			const targetFile = path.join(test.info().outputDir, `target-${locale}.ka1`);
			await download.saveAs(targetFile);
			await panel.getByLabel(locale === "en" ? "Select the downloaded target backup" : "选择已下载的目标备份").setInputFiles(targetFile);
			await panel.getByRole("button", { name: locale === "en" ? "Verify downloaded backup" : "回读验证" }).click();
			await expect(panel).toContainText(locale === "en" ? "Target backup verified from the downloaded file" : "目标备份已回读验证");
			await panel.screenshot({ path: test.info().outputPath(`migration-${locale}-preview.png`) });
			await panel.getByRole("button", { name: locale === "en" ? "Merge into target local data" : "确认合并到目标本机资料" }).click();
			await expect(panel).toContainText(locale === "en" ? "Local merge complete; sync not started" : "本机合并完成，尚未同步");
			if (locale === "zh-CN") {
				await panel.getByRole("button", { name: "撤销本机合并" }).click();
				await expect(panel).toContainText("本机合并已撤销");
				await targetPage.goto("/assets/project");
				await expect(targetPage.locator("main .list-row").filter({ hasText: "Source migration project" })).toHaveCount(0);
			} else {
				targetServer.dropNextPushAck();
				await panel.getByRole("button", { name: "Start target sync" }).click();
				await expect(panel).toContainText("Target sync not finished");
				await expect(panel).toContainText("The target server may have received some records");
				await panel.getByRole("button", { name: "Retry target sync" }).click();
				await expect(panel).toContainText("Target sync complete");
				await targetPage.goto("/assets/project");
				await expect(targetPage.locator("main .list-row").filter({ hasText: "Source migration project" })).toBeVisible();
				await targetPage.reload();
				await expect(targetPage.locator("main .list-row").filter({ hasText: "Source migration project" })).toBeVisible();
				await expect(targetServer.accepted.size).toBe(1);
				await expect(targetServer.pushes).toBe(2);
			}
			await targetPage.goto("/settings#connections");
			await expect(targetPage.getByRole("heading", { name: locale === "en" ? "Move to another account or workspace" : "迁移到另一账号或工作区" })).toBeVisible();
			await targetPage.screenshot({ path: test.info().outputPath(`migration-${locale}.png`), fullPage: true });
			expect(await targetPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			expect(errors).toEqual([]);
		} finally { await sourceContext.close(); await targetContext.close(); }
	});
}

test("existing target record requires an individual choice before migration", async ({ browser }) => {
	test.setTimeout(90_000);
	const sourceContext = await browser.newContext({ locale: "en-US", viewport: { width:390,height:844 } });
	const targetContext = await browser.newContext({ locale: "en-US", viewport: { width:390,height:844 } });
	const sourcePage = await sourceContext.newPage();
	const targetPage = await targetContext.newPage();
	sourcePage.setDefaultTimeout(10_000);
	targetPage.setDefaultTimeout(10_000);
	const sourceWorkspace = crypto.randomUUID();
	const targetWorkspace = crypto.randomUUID();
	mockSync(sourceContext, 3199, sourceWorkspace);
	const targetServer = mockSync(targetContext, 3200, targetWorkspace);
	try {
		const file = await sourceBackup(sourcePage, "en", 3199, sourceWorkspace);
		// Create the shared target record through the explicit transfer flow;
		// ordinary restore now preserves the source identity on a clean browser.
		await configure(targetPage, 3200, targetWorkspace);
		const initial = targetPage.locator(".migration-panel");
		await initial.locator('input[type="file"]').first().setInputFiles(file);
		await initial.locator('input[type="password"]').first().fill(password);
		await initial.getByRole("button", { name: "Check target and preview" }).click();
		await initial.getByLabel("I checked the source and target for this merge").check();
		await initial.getByLabel("Target backup password (12 characters minimum)").fill(targetPassword);
		await initial.getByRole("button", { name: "Create target backup" }).click();
		const downloading = targetPage.waitForEvent("download");
		await initial.getByRole("link", { name: "Download target backup" }).click();
		const initialBackup = test.info().outputPath("target-initial.ka1");
		await (await downloading).saveAs(initialBackup);
		await initial.getByLabel("Select the downloaded target backup").setInputFiles(initialBackup);
		await initial.getByRole("button", { name: "Verify downloaded backup" }).click();
		await initial.getByRole("button", { name: "Merge into target local data" }).click();
		await initial.getByRole("button", { name: "Start target sync" }).click();
		await expect(initial).toContainText("Target sync complete");
		await targetPage.goto("/assets/project");
		await targetPage.locator("main .list-row").filter({ hasText: "Source migration project" }).click();
		await targetPage.getByRole("button", { name: "Edit", exact: true }).click();
		const dialog = targetPage.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill("Target variant");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await configure(targetPage, 3200, targetWorkspace);
		await targetPage.locator(".sync-panel").getByRole("button", { name: "Sync now" }).click();
		await expect(targetPage.locator(".sync-panel .notice")).toHaveText("This sync completed");
		const panel = targetPage.locator(".migration-panel");
		await panel.locator('input[type="file"]').first().setInputFiles(file);
		await panel.locator('input[type="password"]').first().fill(password);
		await panel.getByRole("button", { name: "Check target and preview" }).click();
		await expect(panel).toContainText("1 need a choice");
		await expect(panel).toContainText("Source migration project");
		await expect(panel).toContainText("Target variant");
		await panel.getByText("Show field differences").click();
		await expect(panel.locator(".migration-field-difference").filter({ hasText: "Name" }).first()).toContainText("Target variant");
        await panel.getByLabel(/Keep target version/).check(); await expect(panel.getByLabel(/Keep target version/)).toBeChecked();
        const beforeCancel = await targetPage.evaluate(async modulePath => (await (await import(modulePath)).localRepository()).allRecords(), sourceModuleUrl('packages/local-db/src/index.ts'));
        await targetPage.goto('/assets/project'); await expect(targetPage.locator('.asset-project-card')).toContainText('Target variant');
        await configure(targetPage, 3200, targetWorkspace);
        expect(await targetPage.evaluate(async modulePath => (await (await import(modulePath)).localRepository()).allRecords(), sourceModuleUrl('packages/local-db/src/index.ts'))).toEqual(beforeCancel);
        await panel.locator('input[type="file"]').first().setInputFiles(file); await panel.locator('input[type="password"]').first().fill(password); await panel.getByRole('button',{name:'Check target and preview',exact:true}).click();
		await panel.getByLabel("I checked the source and target for this merge").check();
		await panel.getByLabel("Target backup password (12 characters minimum)").fill(targetPassword);
		await panel.getByRole("button", { name: "Create target backup" }).click();
		const [download] = await Promise.all([targetPage.waitForEvent("download"), panel.getByRole("link", { name: "Download target backup" }).click()]);
		const targetFile = path.join(test.info().outputDir, "target-conflict.ka1");
		await download.saveAs(targetFile);
        await panel.getByLabel('Select the downloaded target backup').setInputFiles(file); await panel.getByRole('button',{name:'Verify downloaded backup',exact:true}).click(); await expect(panel.getByRole('button',{name:'Merge into target local data',exact:true})).toBeDisabled();
		await panel.getByLabel("Select the downloaded target backup").setInputFiles(targetFile);
		await panel.getByRole("button", { name: "Verify downloaded backup" }).click();
		await expect(panel.getByRole("button", { name: "Merge into target local data" })).toBeDisabled();
		await panel.getByLabel(/Use source version/).check();
		await expect(panel.getByRole("button", { name: "Merge into target local data" })).toBeEnabled();
		await panel.screenshot({ path: test.info().outputPath("migration-en-conflict-choice.png") });
		await panel.getByRole("button", { name: "Merge into target local data" }).click();
		await expect(panel).toContainText("Local merge complete; sync not started");
        const later = await targetPage.evaluate(async modulePath => { const db = await (await import(modulePath)).localRepository(); const asset = (await db.list('asset')).find((value: {name:string}) => value.name === 'Source migration project'); await db.save('asset', { ...asset, notes: 'Later independent migration edit' }); return { ...asset, notes: 'Later independent migration edit' }; }, sourceModuleUrl('packages/local-db/src/index.ts'));
        await panel.getByRole('button', { name: 'Undo local merge', exact: true }).click();
        await expect(panel).toContainText(resources.en.translation['migrationError_archive-merge-rollback-conflict']);
        expect(await targetPage.evaluate(async ({modulePath,id}) => (await (await import(modulePath)).localRepository()).get('asset',id), {modulePath:sourceModuleUrl('packages/local-db/src/index.ts'),id:later.id})).toEqual(later);
		await panel.getByRole("button", { name: "Start target sync" }).click();
		await expect(panel).toContainText("Target sync complete");
		await targetPage.goto("/assets/project");
		await expect(targetPage.locator("main .list-row").filter({ hasText: "Source migration project" })).toBeVisible();
		await expect(targetPage.locator("main .list-row").filter({ hasText: "Target variant" })).toHaveCount(0);
		expect(targetServer.accepted.size).toBe(3);
	} finally { await sourceContext.close(); await targetContext.close(); }
});

});

test.describe('F20-07-09 S actual Hono PostgreSQL service with C lost acknowledgement', () => {
  const databaseUrl = process.env.KEEPANY_F20_DATABASE_URL;
  const token = 'Synthetic-F20-target-token'.padEnd(40, 'x'), sourceToken = 'Synthetic-F20-source-token'.padEnd(40, 'x'), key = Buffer.from(new Uint8Array(32).fill(27)).toString('base64url'), targetKey = Buffer.from(new Uint8Array(32).fill(28)).toString('base64url');
  const backupPassword = 'Synthetic-F20-source-backup', targetPassword = 'Synthetic-F20-target-backup';
  for (const locale of ['zh-CN', 'en'] as const) test(`${locale} 390 actual source-to-target migration requires saved backup and retries original operation IDs`, async ({ browser }, info) => {
    test.skip(!databaseUrl, 'Requires the lane-owned isolated PostgreSQL fixture.'); test.setTimeout(150_000);
    const schema = `keepany_f20_${crypto.randomUUID().replaceAll('-', '')}`, sourceSchema = `${schema}_source`, admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 4 }), sourcePool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${sourceSchema}`, max: 4 });
    const contexts: BrowserContext[] = []; let server: ReturnType<typeof serve> | undefined, sourceServer: ReturnType<typeof serve> | undefined, created = false;
    const zh = locale === 'zh-CN', t = (english: string, chinese: string) => zh ? chinese : english;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`); created = true; await admin.query(`CREATE SCHEMA "${sourceSchema}"`); await migrateSyncDatabase(pool); await migrateSyncDatabase(sourcePool);
      const service = new PostgresSyncService(pool), app = createPostgresSyncApp(service, createStaticTokenAuthenticator(token), undefined, { webOrigin: `http://127.0.0.1:${process.env.KEEPANY_E2E_PORT ?? '4236'}` });
      const port = await unusedPort(), endpoint = `http://127.0.0.1:${port}`; server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
      const sourcePort = await unusedPort(), sourceEndpoint = `http://127.0.0.1:${sourcePort}`, sourceService = new PostgresSyncService(sourcePool), sourceApp = createPostgresSyncApp(sourceService, createStaticTokenAuthenticator(sourceToken), undefined, { webOrigin: `http://127.0.0.1:${process.env.KEEPANY_E2E_PORT ?? '4236'}` }); sourceServer = serve({ fetch: sourceApp.fetch, port: sourcePort, hostname: '127.0.0.1' });
      const workspace = async (origin: string, accessToken: string) => { const response = await fetch(`${origin}/workspaces`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' }, body: '{}' }); expect(response.ok).toBe(true); return (await response.json() as { workspaceId: string }).workspaceId; };
      const sourceWorkspace = await workspace(sourceEndpoint, sourceToken), targetWorkspace = await workspace(endpoint, token);
      const foreignWorkspace = await fetch(`${endpoint}/sync/preflight`, { method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type':'application/json'}, body: JSON.stringify({workspaceId:sourceWorkspace}) }); expect(foreignWorkspace.status).toBe(403);
      const isolated = async () => { const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, acceptDownloads: true }); contexts.push(context); await context.addInitScript(value => localStorage.setItem('keepany-language', value), locale); return { context, page: await context.newPage() }; };
      const source = await isolated(), target = await isolated();
      async function configure(page: Page, workspaceId: string) { await page.goto('/settings#connections'); const inputs = page.locator('.sync-panel .form-grid input'); await inputs.nth(0).fill(workspaceId === sourceWorkspace ? sourceEndpoint : endpoint); await inputs.nth(1).fill(workspaceId === sourceWorkspace ? sourceToken : token); await inputs.nth(2).fill(workspaceId); await inputs.nth(3).fill(workspaceId === sourceWorkspace ? key : targetKey); }
      async function download(page: Page, password: string) { await page.goto('/intake'); await page.locator('#backup-password').fill(password); await page.getByRole('button', { name: t('Create backup','创建备份'), exact: true }).click(); const pending = page.waitForEvent('download'); await page.getByRole('link', { name: t('Save backup file','保存备份文件'), exact: true }).click(); const value = await pending, file = await value.path(); if (!file) throw Error('download-missing'); return file; }
      await source.page.goto('/assets/project'); await source.page.getByRole('button', { name: t('Add','新增'), exact: true }).click(); await source.page.getByRole('dialog').getByLabel(t('Name','名称'), { exact: true }).fill('F20 actual service source'); await source.page.getByRole('dialog').getByRole('button', { name: t('Save','保存'), exact: true }).click(); await expect(source.page.getByRole('dialog')).toBeHidden();
      await configure(source.page, sourceWorkspace); await source.page.locator('.sync-panel').getByRole('button', { name: t('Sync now','立即同步'), exact: true }).click(); await expect(source.page.locator('.sync-panel .notice')).toHaveText(t('This sync completed','本次同步已完成'));
      const sourceFile = await download(source.page, backupPassword);
      const input = await inspectArchive(await decryptBackup(new Uint8Array(readFileSync(sourceFile)), backupPassword)); expect(input.manifest.sourceBinding?.workspaceId).toBe(sourceWorkspace); expect(input.manifest.sourceBinding?.accountId).toBe('self-host-owner'); expect(input.manifest.sourceBinding?.endpoint).toBe(sourceEndpoint); const originalId = input.rows[0].id;
      await configure(target.page, targetWorkspace);
      const panel = target.page.locator('.migration-panel'); await panel.locator('input[type=file]').first().setInputFiles(sourceFile); await panel.locator('input[type=password]').first().fill(backupPassword); await panel.getByRole('button', { name: t('Check target and preview','核对目标并预览'), exact: true }).click();
      await expect(panel).toContainText(sourceWorkspace); await expect(panel).toContainText(targetWorkspace); await expect(panel).toContainText(endpoint); await expect(panel).toContainText(sourceEndpoint); await expect(panel).toContainText('self-host-owner'); await expect(panel).toContainText('self-host-owner');
      await expect(panel.getByRole('button', { name: t('Merge into target local data','确认合并到目标本机资料'), exact: true })).toBeDisabled();
      await panel.getByLabel(t('I checked the source and target for this merge','我已核对来源和目标，确认这次合并')).check(); await panel.getByLabel(t('Target backup password (12 characters minimum)','目标备份密码（至少 12 位）')).fill(targetPassword); await panel.getByRole('button', { name: t('Create target backup','生成目标备份'), exact: true }).click();
      const event = target.page.waitForEvent('download'); await panel.getByRole('link', { name: t('Download target backup','下载目标备份'), exact: true }).click(); const targetDownload = await event, targetFile = await targetDownload.path(); if (!targetFile) throw Error('target-backup-missing');
      const before = await inspectArchive(await decryptBackup(new Uint8Array(readFileSync(targetFile)), targetPassword)); expect(before.rows).toHaveLength(0); expect(before.manifest.sourceBinding?.workspaceId).toBe(targetWorkspace);
      await expect(panel.getByRole('button', { name: t('Merge into target local data','确认合并到目标本机资料'), exact: true })).toBeDisabled();
      await panel.getByLabel(t('Select the downloaded target backup','选择已下载的目标备份')).setInputFiles(targetFile); await panel.getByRole('button', { name: t('Verify downloaded backup','回读验证'), exact: true }).click(); await expect(panel).toContainText(t('Target backup verified from the downloaded file','目标备份已回读验证'));
      await panel.getByRole('button', { name: t('Merge into target local data','确认合并到目标本机资料'), exact: true }).click(); await expect(panel).toContainText(t('Local merge complete; sync not started','本机合并完成，尚未同步'));
      let drop = true; const operationIds: string[][] = [];
      await target.context.route(`${endpoint}/sync/push`, async route => { const ids = (route.request().postDataJSON() as { operations: Array<{operationId: string}> }).operations.map(operation => operation.operationId); operationIds.push(ids); if (drop) { drop = false; const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort('failed'); } else await route.continue(); });
      await panel.getByRole('button', { name: t('Start target sync','开始同步到目标'), exact: true }).click(); await expect(panel).toContainText(t('Target sync not finished','目标同步未完成')); await expect(panel).toContainText(t('The target server may have received some records','目标云端可能已收到部分资料'));
      const remoteBeforeRetry = await service.pull({ workspaceId: targetWorkspace, cursor: 0, limit: 100 }, 'self-host-owner'); expect(remoteBeforeRetry.changes.map(row => row.id)).toEqual([originalId]);
      await target.page.reload(); await configure(target.page, targetWorkspace); await expect(panel.getByRole('button', { name: t('Retry target sync','继续目标同步'), exact: true })).toBeVisible(); await panel.getByRole('button', { name: t('Retry target sync','继续目标同步'), exact: true }).click(); await expect(panel).toContainText(t('Target sync complete','目标同步已完成'));
      const originalRemote = await sourceService.pull({workspaceId:sourceWorkspace,cursor:0,limit:100},'self-host-owner'); expect(originalRemote.changes).toHaveLength(1);
      expect(operationIds).toHaveLength(2); expect(operationIds[1]).toEqual(operationIds[0]); const remoteAfterRetry = await service.pull({ workspaceId: targetWorkspace, cursor: 0, limit: 100 }, 'self-host-owner'); expect(remoteAfterRetry.changes).toEqual(remoteBeforeRetry.changes); expect(remoteAfterRetry.changes[0].ciphertext).not.toBe(originalRemote.changes[0].ciphertext);
      const observer = await isolated(); await configure(observer.page,targetWorkspace); await observer.page.locator('.sync-panel').getByRole('button',{name:t('Sync now','立即同步'),exact:true}).click(); await expect(observer.page.locator('.sync-panel .notice')).toHaveText(t('This sync completed','本次同步已完成')); await observer.page.goto('/assets/project'); await expect(observer.page.locator('.asset-project-card')).toContainText('F20 actual service source');
      const targetFileAfter = await download(target.page, targetPassword), final = await inspectArchive(await decryptBackup(new Uint8Array(readFileSync(targetFileAfter)), targetPassword)); expect(final.rows).toEqual(input.rows); expect(final.manifest.sourceBinding?.workspaceId).toBe(targetWorkspace); expect(final.manifest.sourceBinding?.accountId).toBe('self-host-owner'); expect(final.manifest.sourceBinding?.endpoint).toBe(endpoint);
      await info.attach('actual-service-receipt', { contentType: 'application/json', body: JSON.stringify({ schema, sourceEndpoint, targetEndpoint: endpoint, sourceAccount: 'self-host-owner', targetAccount: 'self-host-owner', independentServiceSchemas: true, targetKeyObserverDecrypted: true, separateKeys: key !== targetKey, sourceWorkspace, targetWorkspace, sourceRows: input.rows.length, targetRows: final.rows.length, requestOperationIds: operationIds, remoteSequenceCount: remoteAfterRetry.changes.length }) });
      for (const width of [360, 390, 430]) { await target.page.setViewportSize({ width, height: 844 }); expect(await target.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await target.page.screenshot({ path: info.outputPath(`actual-migration-${locale}-${width}.png`), fullPage: true }); }
    } finally { for (const context of contexts) await context.close(); if (server) { const activeServer = server; await new Promise<void>((resolve, reject) => activeServer.close(error => error ? reject(error) : resolve())); } if (sourceServer) { const activeServer = sourceServer; await new Promise<void>((resolve, reject) => activeServer.close(error => error ? reject(error) : resolve())); } await pool.end(); await sourcePool.end(); if (created) { await admin.query(`DROP SCHEMA IF EXISTS "${sourceSchema}" CASCADE`); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); } await admin.end(); }
  });
});

// C evidence: real disk SQLite and original dataset-manager code, not a native-device result.
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { NativeStore } from '../../packages/local-db-native/src/store';
import { NativeFileStore } from '../../packages/local-db-native/src/repository-storage';
import { NativeDatasetManager } from '../../packages/local-db-native/src/datasets';
import type { SqlDriver, SqlRow } from '../../packages/local-db-native/src/driver';
import type { PersistentFiles } from '../../packages/platform-native/src';
import { newAsset } from '../../packages/domain/src';
import { openRepositoryFromBackend, type LocalRepository } from '../../packages/local-db/src';

test.describe('F20-05-06-10 C disk SQLite candidate boundary faults', () => {
  for (const phase of ['candidate-open', 'file-write', 'sql-commit', 'verification', 'pointer-before-commit', 'pointer-after-commit'] as const) test(`${phase} interruption retains a complete dataset, resumes once and preserves later edits`, async ({ browserName: _browserName }, info) => {
    test.setTimeout(45_000);
    const root = await mkdtemp(path.join(tmpdir(), 'keepany-f20-sqlite-'));
    let fault = true, candidateOpen = 0, armedCommit = false;
    const connections = new Set<DatabaseSync>(), repositories = new Set<LocalRepository>();
    async function driverFor(file: string, control = false, candidate = false): Promise<SqlDriver> {
      await mkdir(path.dirname(file), { recursive: true }); const sql = new DatabaseSync(file); connections.add(sql);
      return { uri: pathToFileURL(file).href,
        async execute(statement) {
          if (fault && candidate && phase === 'sql-commit' && armedCommit && statement === 'COMMIT') { fault = false; throw Error('synthetic-sql-commit'); }
          if (fault && control && phase === 'pointer-after-commit' && armedCommit && statement === 'COMMIT') { fault = false; sql.exec(statement); throw Error('synthetic-after-control-commit'); }
          sql.exec(statement);
        },
        async query<T extends SqlRow>(statement: string, values = []) { return sql.prepare(statement).all(...values) as T[]; },
        async run(statement, values = []) {
          if (candidate && statement.startsWith('INSERT INTO records(')) armedCommit = true;
          if (control && statement.startsWith('UPDATE active_dataset SET name=')) {
            if (fault && phase === 'pointer-before-commit') { fault = false; throw Error('synthetic-before-control-pointer'); }
            if (phase === 'pointer-after-commit') armedCommit = true;
          }
          return Number(sql.prepare(statement).run(...values).changes);
        },
        async close() { if (connections.delete(sql)) sql.close(); },
      };
    }
    const factory = async (name: string) => {
      if (!/^[a-z][a-z0-9-]{2,60}$/.test(name)) throw Error('unsafe-fixture-name');
      const candidate = name.startsWith('keepany-data-');
      if (candidate) { candidateOpen++; if (fault && phase === 'candidate-open') { fault = false; throw Error('synthetic-candidate-open'); } }
      const directory = path.join(root, name), driver = await driverFor(path.join(directory, 'native.db'), false, candidate);
      const files: PersistentFiles = {
        async rootUri() { return pathToFileURL(directory).href; },
        async write(relative, bytes) { if (fault && candidate && phase === 'file-write') { fault = false; throw Error('synthetic-file-write'); } const target = path.join(directory, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes); },
        async read(relative) { return new Uint8Array(await readFile(path.join(directory, relative))); },
        async remove(relative) { await rm(path.join(directory, relative)); },
        async list() { const files: string[] = []; for (const folder of ['files','vaults','recovery']) for (const name of await readdir(path.join(directory, folder)).catch(() => [])) files.push(`${folder}/${name}`); return files; },
      };
      const store = await NativeStore.open(driver, files), side = new NativeFileStore(name, store), repository = await openRepositoryFromBackend(side.records, side); repositories.add(repository);
      if (fault && candidate && phase === 'verification' && candidateOpen >= 2) { fault = false; repository.exportArchive = async () => { throw Error('synthetic-verification'); }; }
      return repository;
    };
    const exists = async (name: string) => { try { await access(path.join(root, name, 'native.db')); return true; } catch { return false; } };
    let control: SqlDriver | undefined;
    try {
      control = await driverFor(path.join(root, 'control.db'), true);
      let manager = await NativeDatasetManager.open(control, factory, exists);
      const active = await manager.openActive(), old = { ...newAsset('project'), name: 'Retain original complete dataset' }; await active.save('asset', old);
      const incoming = await factory('source-library');
      const image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0LsAAAAASUVORK5CYII=', 'base64'));
      const imageId = await incoming.putFile(new File([image], 'source.png', { type: 'image/png' })), asset = { ...newAsset('item'), name: 'Incoming exact original ID', attachments: [imageId] };
      await incoming.save('asset', asset); const archive = await incoming.exportArchive(); await incoming.close();
      await expect(active.restoreArchive(archive)).rejects.toThrow(/synthetic/);
      const afterFailure = await manager.list(), activeName = afterFailure.find(row => row.active)?.name, candidateName = afterFailure.find(row => row.name.startsWith('keepany-data-'))?.name;
      if (!candidateName) throw Error('candidate-not-recorded');
      expect(activeName).toBe(phase === 'pointer-after-commit' ? candidateName : 'keepany-v1');
      expect(await active.get('asset', old.id)).toEqual(old); await active.close();
      await control.close(); control = await driverFor(path.join(root, 'control.db'), true); fault = false; manager = await NativeDatasetManager.open(control, factory, exists);
      if (phase !== 'pointer-after-commit') {
        const retained = await manager.openActive(); expect(await retained.get('asset', old.id)).toEqual(old); await retained.close();
        // An open/file interruption needs the original archive, while a complete candidate can verify/resume.
        if (phase === 'candidate-open' || phase === 'file-write' || phase === 'sql-commit') await manager.restore(archive); else await manager.resume(candidateName);
      }
      const restored = await manager.openActive(); expect(await restored.get('asset', asset.id)).toEqual(asset); expect((await restored.readFile(imageId))?.bytes).toEqual(image);
      const later = { ...newAsset('project'), name: 'New after completed activation' }; await restored.save('asset', later); const beforeSwitch = await restored.exportArchive(); await restored.close();
      await manager.switchTo('keepany-v1'); const returned = await manager.openActive(); expect(await returned.get('asset', old.id)).toEqual(old); expect(await returned.get('asset', later.id)).toBeNull(); await returned.close();
      await manager.switchTo(candidateName); const latest = await manager.openActive(); expect(await latest.get('asset', later.id)).toEqual(later); expect((await inspectArchive(beforeSwitch)).rows.some(row => row.id === `asset:${later.id}`)).toBe(true); await latest.close();
      expect((await manager.list()).filter(row => row.name.startsWith('keepany-data-'))).toHaveLength(1);
      await info.attach('sqlite-candidate-boundary', { contentType: 'application/json', body: JSON.stringify({ phase, activeAfterFailure: activeName === candidateName ? 'new-complete' : 'old-complete', resumedOriginalCandidate: true, imageSha256: createHash('sha256').update(image).digest('hex'), retainedNewRecord: true, totalDatasets: (await manager.list()).length }) });
    } finally {
      for (const repository of repositories) await repository.close().catch(() => {}); await control?.close().catch(() => {}); for (const sql of connections) try { sql.close(); } catch {}
      await cleanupF20Root(root,'keepany-f20-sqlite-');
    }
  });
});

import { resources } from '../../apps/web/src/i18n';
import type { ReviewedCandidate } from '../../packages/local-db/src/intake-review';
const f20RepoPath = sourceModuleUrl('packages/local-db/src/index.ts'), f20DomainPath = sourceModuleUrl('packages/domain/src/index.ts'), f20ReviewPath = sourceModuleUrl('packages/local-db/src/intake-review.ts'), f20WorkflowPath = sourceModuleUrl('packages/domain/src/project-workflow.ts');
const f20Password = 'Synthetic-F20-full-backup', f20Master = 'Synthetic-F20-vault-master';
async function fullState(page: Page): Promise<{ rows: RecordRow[]; reviews: ReviewedCandidate[]; files: Array<{ id: string; name: string; sha256: string }>; vaultHash: string | null }> {
  return page.evaluate(async ({ repo, review }) => { const db = await (await import(repo)).localRepository(), digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(byte => byte.toString(16).padStart(2,'0')).join('');
    const vault = await db.readPasswordVault(); return { rows: (await db.allRecords()).sort((a: RecordRow,b: RecordRow) => a.id.localeCompare(b.id)), reviews: await (await import(review)).listReviewedCandidates(db.fileStore), files: await Promise.all((await db.fileStore.blobs.toArray()).sort((a: {id:string},b: {id:string}) => a.id.localeCompare(b.id)).map(async (file: {id:string;name:string;blob:Blob}) => ({ id: file.id, name: file.name, sha256: await digest(new Uint8Array(await file.blob.arrayBuffer())) }))), vaultHash: vault ? await digest(vault.bytes) : null };
  }, { repo: f20RepoPath, review: f20ReviewPath });
}
test.describe('F20-01-04 B full seven-type snapshot, invalid archives and locked KDBX', () => {
  for (const locale of ['zh-CN','en'] as const) test(`${locale} 390 encrypted full snapshot preview cancellation, errors and clean restore`, async ({ browser }, info) => {
    test.setTimeout(150_000); const contexts: BrowserContext[] = [], t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
    const open = async () => { const context = await browser.newContext({ locale, viewport: { width:390,height:844 }, acceptDownloads:true }); contexts.push(context); await context.addInitScript(value => localStorage.setItem('keepany-language', value), locale); const page = await context.newPage(); await page.goto('/intake'); return page; };
    try {
      const source = await open();
      const fixture = await source.evaluate(async ({ repo, domain, review, workflow }) => {
        const db = await (await import(repo)).localRepository(), { newAsset, taskSchema, historySchema, relationSchema, submissionSchema } = await import(domain), { buildProjectWorkflowTasks } = await import(workflow);
        const canvas = document.createElement('canvas'); canvas.width=16; canvas.height=16; const ctx=canvas.getContext('2d'); if(!ctx)throw Error('canvas'); ctx.fillStyle='#e6ac39';ctx.fillRect(0,0,16,16); const blob = await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('png')),'image/png')); const imageId=await db.putFile(new File([blob], 'full-original.png',{type:'image/png'}));
        const categoryId=crypto.randomUUID(), at='2026-10-27T04:00:00Z';
        const project={...newAsset('project'),name:'F20 complete project',category:categoryId,attachments:[imageId],projectMedia:{logoId:imageId,homeScreenshotId:'',promoCoverId:'',productScreenshotIds:[]}}, account={...newAsset('account'),name:'F20 complete account'}, subscription={...newAsset('subscription'),name:'F20 exact subscription',amount:1234,currency:'USD',dueDate:'2026-11-27',renewalCount:2,lastRenewalId:'previous-renewal'}, removed={...newAsset('item'),name:'F20 deleted original',deleted:true};
        const relation=relationSchema.parse({id:crypto.randomUUID(),from:project.id,to:account.id,label:'owner',source:'Original checked evidence',verifiedAt:'2026-10-27',createdAt:at}), removedRelation={...relation,id:crypto.randomUUID(),label:'retained tombstone',deleted:true};
        const task=taskSchema.parse({id:crypto.randomUUID(),assetId:project.id,name:'F20 completed original task',done:true,completedAt:at,completionHistory:[at],createdAt:at}), deletedTask={...task,id:crypto.randomUUID(),name:'F20 deleted original task',deleted:true};
        const bill=historySchema.parse({id:crypto.randomUUID(),assetId:subscription.id,action:'expense',title:'F20 original expense',note:'Exact local evidence',amount:1234,currency:'USD',eventDate:'2026-10-27',createdAt:at}), deletedBill={...bill,id:crypto.randomUUID(),title:'F20 deleted expense',deleted:true};
        const submission=submissionSchema.parse({id:crypto.randomUUID(),assetId:project.id,name:'F20 backlink',url:'https://example.test/f20',status:'submitted',evidence:'Synthetic receipt only',submittedAt:'2026-10-27'});
        const workflowTasks=buildProjectWorkflowTasks({project,assets:[project,account,subscription],relations:[relation],submissions:[submission],kind:'brand',roundId:crypto.randomUUID(),at,proposal:{proposedName:'Reviewed future name',proposedDescription:'',proposedUrl:'',changeNote:'Synthetic review'},title:(step:string)=>`F20 workflow ${step}`});
        await db.saveBatch([... [project,account,subscription,removed].map(value=>({type:'asset',value})),...[relation,removedRelation].map(value=>({type:'relation',value})),...[task,deletedTask,...workflowTasks].map(value=>({type:'task',value})),...[bill,deletedBill].map(value=>({type:'history',value})),{type:'submission',value:submission},{type:'category',value:{id:categoryId,kind:'project',name:'F20 category',order:1}},{type:'preference',value:{id:'assetCollectionsV1',value:[{id:'f20-live',name:'F20 live',assetIds:[project.id,account.id]},{id:'f20-deleted',name:'F20 removed',assetIds:[subscription.id],deleted:true,deletedAt:at}]}}]);
        const hash='f'.repeat(64); await (await import(review)).stageReviewedCandidates(db.fileStore,[{id:`csv-${hash}-2`,fileHash:hash,fileName:'full-review.csv',rowNumber:2,sourceText:'kind,name\r\nproject,Pending original',asset:{...newAsset('project'),id:`csv-${hash.slice(0,48)}-2`,name:'F20 pending original'},status:'pending'}]);
        return { projectId:project.id, removedId:removed.id, imageId, taskId:task.id, workflowCount:workflowTasks.length };
      },{repo:f20RepoPath,domain:f20DomainPath,review:f20ReviewPath,workflow:f20WorkflowPath});
      await source.goto('/assets/vault'); await source.locator('#password-vault-master').fill(f20Master); await source.locator('#password-vault-master-confirm').fill(f20Master); await source.getByRole('button',{name:t('pwVaultCreate'),exact:true}).click(); await expect(source.locator('.password-vault-toolbar')).toBeVisible(); await source.getByRole('button',{name:t('pwVaultNewEntry'),exact:true}).click(); await source.locator('#password-vault-entry-title').fill('F20 synthetic vault entry'); await source.locator('#password-vault-entry-username').fill('f20@example.test'); await source.locator('#password-vault-entry-password').fill('Synthetic-F20-entry-value'); await source.getByRole('button',{name:t('pwVaultSaveEntry'),exact:true}).click(); await expect(source.getByRole('dialog')).toBeHidden();
      const before=await fullState(source); expect(new Set(before.rows.map(row=>row.type))).toEqual(new Set(['asset','relation','task','history','submission','category','preference'])); expect(before.vaultHash).not.toBeNull();
      await source.goto('/intake'); await source.locator('#backup-password').fill('too-short'); await expect(source.getByRole('button',{name:t('backup'),exact:true})).toBeDisabled(); await source.locator('#backup-password').fill(f20Password); await source.getByRole('button',{name:t('backup'),exact:true}).click(); const downloadEvent=source.waitForEvent('download');await source.getByRole('link',{name:t('saveBackupFile'),exact:true}).click();const download=await downloadEvent, file=await download.path();if(!file)throw Error('download-missing');const bytes=new Uint8Array(readFileSync(file)),plain=await decryptBackup(bytes,f20Password),originals=unzipSync(plain); expect(new TextDecoder().decode(bytes).includes('F20 complete project')).toBe(false);
      const target=await open(), empty=await fullState(target);
      const preview=async(payload:string|{name:string;mimeType:string;buffer:Buffer},password=f20Password)=>{await target.locator('#backup-password').fill(password);await target.locator('#restore-file').setInputFiles(payload);await target.getByRole('button',{name:t('preview'),exact:true}).first().click();};
      await preview(file);await expect(target.getByRole('button',{name:/^(确认|Confirm) ·/})).toBeVisible();await expect(target.getByText(t('restoreContainsVault'),{exact:true})).toBeVisible();expect(await fullState(target)).toEqual(empty);
      // Leaving this preview cancels it; returning never retains an active confirm action.
      await target.goto('/assets/project');await target.goto('/intake');await expect(target.getByRole('button',{name:/^(确认|Confirm) ·/})).toHaveCount(0);expect(await fullState(target)).toEqual(empty);
      await preview(file,'Wrong-F20-backup-password');await expect(target.locator('.notice[role=status]')).toContainText(t('decryptError'));expect(await fullState(target)).toEqual(empty);
      const altered=bytes.slice();altered[altered.length-1]^=1;await preview({name:'tampered.ka1',mimeType:'application/octet-stream',buffer:Buffer.from(altered)});await expect(target.getByRole('button',{name:/^(确认|Confirm) ·/})).toHaveCount(0);expect(await fullState(target)).toEqual(empty);
      for(const mode of ['missing-image','path-traversal','expanded-budget'] as const){const entries=Object.fromEntries(Object.entries(originals).map(([name,value])=>[name,value.slice()]));if(mode==='missing-image')delete entries[`files/${fixture.imageId}`];if(mode==='path-traversal')entries['../outside.json']=strToU8('{}');let zip=zipSync(entries);if(mode==='expanded-budget'){zip=zip.slice();const view=new DataView(zip.buffer);for(let offset=0;offset+30<zip.length;offset++){const signature=view.getUint32(offset,true);if(signature===0x04034b50||signature===0x02014b50)view.setUint32(offset+(signature===0x04034b50?22:24),301*1024*1024,true);}}const encrypted=await encryptBackup(zip,f20Password);await preview({name:`${mode}.ka1`,mimeType:'application/octet-stream',buffer:Buffer.from(encrypted)});await expect(target.getByRole('button',{name:/^(确认|Confirm) ·/})).toHaveCount(0);expect(await fullState(target)).toEqual(empty);}
      await preview(file);await target.getByRole('button',{name:/^(确认|Confirm) ·/}).click();await expect.poll(()=>fullState(target)).toEqual(before);await target.reload();expect(await fullState(target)).toEqual(before);
      await target.goto('/assets/project');await expect(target.locator('.asset-project-card').filter({hasText:'F20 complete project'})).toBeVisible();await target.goto('/tasks');await expect(target.locator(`#task-${fixture.taskId}`)).toBeVisible();await target.goto('/trash');await expect(target.getByText('F20 deleted original',{exact:true})).toBeVisible();await target.goto('/intake');await expect(target.locator('.intake-review-row')).toContainText('F20 pending original');
      await target.goto('/assets/vault');await expect(target.locator('#password-vault-unlock-master')).toBeVisible();await expect(target.locator('.password-vault-toolbar')).toHaveCount(0);await target.locator('#password-vault-unlock-master').fill(f20Master);await target.getByRole('button',{name:t('pwVaultUnlock'),exact:true}).click();await expect(target.locator('.password-vault-entry-list')).toContainText('f20@example.test');
      for(const width of [360,390,430]){await target.setViewportSize({width,height:844});expect(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await target.screenshot({path:info.outputPath(`full-restored-${locale}-${width}.png`),fullPage:true});}
      await target.goto('/intake'); await target.evaluate(async({repo,id})=>{const db=await(await import(repo)).localRepository(),value=await db.get('asset',id);await db.save('asset',{...value,name:'Later same-ID edit'});},{repo:f20RepoPath,id:fixture.projectId}); const sameIdBefore=await fullState(target);await preview(file);await target.getByRole('button',{name:/^(确认|Confirm) ·/}).click();await expect(target.locator('.notice[role=status]')).toContainText(t('restoreConflict'));expect(await fullState(target)).toEqual(sameIdBefore);
      const conflict=await open();await conflict.evaluate(async({repo,domain})=>{const db=await(await import(repo)).localRepository();await db.save('asset',{...(await import(domain)).newAsset('project'),name:'Keep existing current'});},{repo:f20RepoPath,domain:f20DomainPath});await conflict.goto('/assets/vault');await conflict.locator('#password-vault-master').fill('Different-F20-vault-master');await conflict.locator('#password-vault-master-confirm').fill('Different-F20-vault-master');await conflict.getByRole('button',{name:t('pwVaultCreate'),exact:true}).click();await expect(conflict.locator('.password-vault-toolbar')).toBeVisible();const conflictBefore=await fullState(conflict);await conflict.goto('/intake');await conflict.locator('#backup-password').fill(f20Password);await conflict.locator('#restore-file').setInputFiles(file);await conflict.getByRole('button',{name:t('preview'),exact:true}).first().click();await conflict.getByRole('button',{name:/^(确认|Confirm) ·/}).click();await expect(conflict.locator('.notice[role=status]')).toContainText(t('restoreVaultConflict'));expect(await fullState(conflict)).toEqual(conflictBefore);
      await info.attach('full-snapshot-receipt',{contentType:'application/json',body:JSON.stringify({recordCount:before.rows.length,types:[...new Set(before.rows.map(row=>row.type))],backupSha256:createHash('sha256').update(bytes).digest('hex'),imageHashes:before.files,vaultSha256:before.vaultHash,reviewCount:before.reviews.length,workflowCount:fixture.workflowCount})});
    }finally{for(const context of contexts)await context.close();}
  });
});

import { execFileSync, type ChildProcess } from 'node:child_process';
import { startPackage, stopPackage } from './helpers/portable-upgrade';
import { build as bundlePreviewServer } from 'esbuild';

test.describe('F20-03 B published full-SHA package to C SQLite to B clean current Web', () => {
  for (const [brand, commit] of [['KeepAny','64b98e7874a2fdd8d43c8e60de72a25de5800b25'],['StackPerch','7ebc2c349f4826759c8b2ef848e8c6133c0b3858']] as const) test(`${brand} ${commit} retains original archive IDs, images and encrypted vault through SQLite`, async ({ browser }, info) => {
    test.setTimeout(150_000);
    const root=await mkdtemp(path.join(tmpdir(),'keepany-f20-historical-')), packageRoot=path.join(root,'published'), contexts:BrowserContext[]=[];let child:ChildProcess|undefined,native:LocalRepository|undefined;
    try{
      expect(execFileSync('git',['rev-parse',commit],{encoding:'utf8'}).trim()).toBe(commit);await mkdir(path.join(packageRoot,'web'),{recursive:true});const tar=path.join(root,'published.tar');execFileSync('git',['archive','--output',tar,commit,'release/web']);execFileSync('tar',['-xf',tar,'-C',path.join(packageRoot,'web'),'--strip-components=2']);await bundlePreviewServer({entryPoints:['scripts/preview-server.mjs'],outfile:path.join(packageRoot,'preview-server.mjs'),bundle:true,platform:'node',format:'esm',target:'node22'});
      const applicationRoutes=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',"import {readApplicationRouteContract} from './scripts/preview-route-contract.mjs';process.stdout.write(JSON.stringify(await readApplicationRouteContract(process.cwd())))"],{encoding:'utf8'}));await writeFile(path.join(packageRoot,'RELEASE.json'),JSON.stringify({productName:brand,sourceCommit:commit,version:`f20-published-${commit.slice(0,12)}`,applicationRoutes}));const port=await unusedPort(),origin=`http://127.0.0.1:${port}`;child=await startPackage(packageRoot,port);
      const old=await browser.newContext({locale:'en-US',viewport:{width:390,height:844},acceptDownloads:true});contexts.push(old);await old.addInitScript(()=>localStorage.setItem('keepany-language','en'));const page=await old.newPage();await page.goto(`${origin}/settings`);await expect(page).toHaveTitle(brand);const language=page.getByRole('combobox',{name:/Language|语言/,exact:true});if(await language.count())await selectChoice(language,'en');
      await page.goto(`${origin}/settings#advanced-settings`);await page.getByRole('button',{name:'Add sample records',exact:true}).click();await expect(page.getByRole('status').filter({hasText:/^Saved$/})).toBeVisible();await page.goto(`${origin}/assets/project`);await expect(page.locator('.asset-project-card')).toHaveCount(1);
      await page.getByRole('button',{name:'New category',exact:true}).click();const category=page.getByRole('region',{name:'Category',exact:true});await category.getByLabel('Category name').fill('Historic category');await category.getByRole('checkbox').first().check();await category.getByRole('button',{name:'Save collection',exact:true}).click();await expect(category).toBeHidden();await page.locator('.asset-project-card').first().click();
      const canvas=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const ctx=canvas.getContext('2d');if(!ctx)throw Error('canvas');ctx.fillStyle='#8355ba';ctx.fillRect(0,0,8,8);return canvas.toDataURL('image/png').split(',')[1];});await page.getByLabel('Add image',{exact:true}).setInputFiles({name:'historic-original.png',mimeType:'image/png',buffer:Buffer.from(canvas,'base64')});await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
      const backlinks=page.locator('.asset-backlinks-card');if(await backlinks.count()){const summary=backlinks.locator('summary').first();if(await summary.count()&&!(await backlinks.getAttribute('open')))await summary.click();}await page.getByRole('button',{name:'Add backlink',exact:true}).click();const backlink=page.getByRole('dialog');await backlink.getByLabel('Name',{exact:true}).fill('Historic backlink');await backlink.getByLabel('URL',{exact:true}).fill('https://example.test/historic');await backlink.getByRole('button',{name:'Save',exact:true}).click();await expect(backlink).toBeHidden();
      await page.getByRole('link',{name:'Review profile changes',exact:true}).click();await page.getByLabel('Proposed name',{exact:true}).fill('Historic proposed name');await page.getByRole('button',{name:resources.en.translation.workflowCreatePlan,exact:true}).click();await expect(page.locator('.project-workflow-task').first()).toBeVisible();
      await page.goto(`${origin}/assets/item`);await page.locator('.asset-library-card').first().click();await page.getByRole('button',{name:'Move to trash',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Move to trash',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
      await page.goto(`${origin}/intake`);await page.getByRole('button',{name:'Spreadsheet',exact:true}).click();await page.locator('#csv-file').setInputFiles({name:'historic-draft.csv',mimeType:'text/csv',buffer:Buffer.from('kind,name\r\nproject,Historic pending draft\r\n')});await expect(page.locator('.intake-review-row')).toHaveCount(1);
      await page.goto(`${origin}/assets/vault`);await page.locator('#password-vault-master').fill(f20Master);await page.locator('#password-vault-master-confirm').fill(f20Master);await page.getByRole('button',{name:'Create vault',exact:true}).click();await expect(page.locator('.password-vault-toolbar')).toBeVisible();await page.getByRole('button',{name:'New entry',exact:true}).click();await page.locator('#password-vault-entry-title').fill('Historical encrypted entry');await page.locator('#password-vault-entry-username').fill('historic@example.test');await page.locator('#password-vault-entry-password').fill('Synthetic-historical-secret');await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
      await page.goto(`${origin}/intake`);await page.locator('#backup-password').fill(f20Password);await page.getByRole('button',{name:'Create backup',exact:true}).click();const event=page.waitForEvent('download');await page.getByRole('link',{name:'Save backup file',exact:true}).click();const download=await event,backup=await download.path();if(!backup)throw Error('historic-backup-missing');const encrypted=new Uint8Array(readFileSync(backup)),plain=await decryptBackup(encrypted,f20Password),input=await inspectArchive(plain);expect(new Set(input.rows.map(row=>row.type))).toEqual(new Set(['asset','relation','task','history','submission','category','preference']));expect(input.passwordVault).not.toBeNull();expect(input.intakeReview).toHaveLength(1);
      const sql=new DatabaseSync(path.join(root,'native.db'));let closed=false;const files:PersistentFiles={async rootUri(){return pathToFileURL(root).href;},async write(relative,bytes){const target=path.join(root,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);},async read(relative){return new Uint8Array(await readFile(path.join(root,relative)));},async remove(relative){await rm(path.join(root,relative));},async list(){const paths:string[]=[];for(const folder of ['files','vaults','recovery'])for(const name of await readdir(path.join(root,folder)).catch(()=>[]))paths.push(`${folder}/${name}`);return paths;}};const driver:SqlDriver={uri:pathToFileURL(path.join(root,'native.db')).href,async execute(statement){sql.exec(statement);},async query<T extends SqlRow>(statement:string,values=[]){return sql.prepare(statement).all(...values) as T[];},async run(statement,values=[]){return Number(sql.prepare(statement).run(...values).changes);},async close(){if(!closed){closed=true;sql.close();}}};const store=await NativeStore.open(driver,files),side=new NativeFileStore('historic-return',store);native=await openRepositoryFromBackend(side.records,side);await native.restoreArchive(plain);expect(await native.allRecords()).toEqual(input.rows);const returnedEncrypted=await encryptBackup(await native.exportArchive(),f20Password);const returned=await inspectArchive(await decryptBackup(returnedEncrypted,f20Password));expect(returned.rows).toEqual(input.rows);expect(returned.intakeReview).toEqual(input.intakeReview);expect(returned.passwordVault?.bytes).toEqual(input.passwordVault?.bytes);
      const current=await browser.newContext({locale:'en-US',viewport:{width:390,height:844}});contexts.push(current);const restored=await current.newPage();await restored.goto('/intake');await restored.locator('#backup-password').fill(f20Password);await restored.locator('#restore-file').setInputFiles({name:'historic-sqlite-return.ka1',mimeType:'application/octet-stream',buffer:Buffer.from(returnedEncrypted)});await restored.getByRole('button',{name:'Preview',exact:true}).first().click();await restored.getByRole('button',{name:/^Confirm ·/}).click();await expect.poll(async()=>(await fullState(restored)).rows).toEqual(input.rows);const after=await fullState(restored);expect(after.rows).toEqual(input.rows);expect(after.reviews).toEqual(input.intakeReview);expect(after.files.map(file=>file.sha256)).toEqual(input.manifest.attachments.map(file=>file.sha256));expect(after.vaultHash).toBe(input.manifest.passwordVault?.sha256);await restored.goto('/assets/vault');await expect(restored.locator('#password-vault-unlock-master')).toBeVisible();await restored.locator('#password-vault-unlock-master').fill(f20Master);await restored.getByRole('button',{name:'Unlock vault',exact:true}).click();await expect(restored.locator('.password-vault-entry-list')).toContainText('historic@example.test');await restored.screenshot({path:info.outputPath(`${brand}-historical-current-390.png`),fullPage:true});
      await info.attach('historical-source-and-archive',{contentType:'application/json',body:JSON.stringify({brand,sourceCommit:commit,publishedIndexSha256:createHash('sha256').update(await readFile(path.join(packageRoot,'web/index.html'))).digest('hex'),archiveSha256:createHash('sha256').update(encrypted).digest('hex'),recordCount:input.rows.length,types:[...new Set(input.rows.map(row=>row.type))],imageHashes:input.manifest.attachments.map(file=>file.sha256),vaultHash:input.manifest.passwordVault?.sha256,nativeReturnByteEqual:true,workflowCount:input.rows.filter(row=>row.type==='task'&&JSON.parse(row.payload).projectWorkflow).length,tombstones:input.rows.filter(row=>JSON.parse(row.payload).deleted).length})});
    }finally{for(const context of contexts)await context.close();await native?.close();await stopPackage(packageRoot,child);await cleanupF20Root(root,'keepany-f20-historical-');}
  });
});

test.describe('F20-10 C shared dataset confirmation boundary', () => {
  for(const locale of ['zh-CN','en'] as const)test(`${locale} 390 retained dataset switch is explicit, cancellable and failure remains retryable`,async({browser},info)=>{
    const context=await browser.newContext({locale,viewport:{width:390,height:844},acceptDownloads:true});await context.addInitScript(value=>localStorage.setItem('keepany-language',value),locale);const page=await context.newPage(),t=(key:keyof typeof resources.en.translation)=>resources[locale].translation[key];
    try{
      await page.goto('/more');await page.evaluate(async()=>{const state={calls:[] as string[],fail:true,abandonFail:true,rows:[{name:'keepany-v1',createdAt:'2026-10-27T00:00:00Z',active:false,phase:'retained'},{name:'keepany-data-fixture',createdAt:'2026-10-27T01:00:00Z',active:true,phase:'active'},{name:'keepany-data-pending',createdAt:'2026-10-27T02:00:00Z',active:false,phase:'candidate'}]};Object.assign(window,{__f20Dataset:state});const modulePath='/src/native-datasets.ts';const {registerDatasetAdapter}=await import(modulePath);registerDatasetAdapter({async list(){return state.rows;},subscribe(){return()=>{};},async switchTo(name:string){state.calls.push(name);if(state.fail){state.fail=false;throw Error('synthetic-switch-failure');}state.rows=state.rows.map(row=>({...row,active:row.name===name,phase:row.name===name?'active':row.phase==='candidate'?'candidate':'retained'}));},async resume(){throw Error('not-requested');},async abandon(name:string){state.calls.push(`abandon:${name}`);if(state.abandonFail){state.abandonFail=false;throw Error('synthetic-abandon-failure');}state.rows=state.rows.filter(row=>row.name!==name);}});});
      await page.locator('.mobile-more-page a[href="/intake"]').click();const panel=page.getByRole('region',{name:t('localDatasets'),exact:true});await expect(panel).toBeVisible();await panel.getByRole('button',{name:t('localDatasetSwitch'),exact:true}).click();await expect(page.getByRole('dialog')).toContainText(t('localDatasetSwitchConfirm'));await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();expect(await page.evaluate(()=>(window as unknown as {__f20Dataset:{calls:string[]}}).__f20Dataset.calls)).toEqual([]);
      // An actual outer backup can be downloaded before the separate switch decision.
      await page.locator('#backup-password').fill(f20Password);await page.getByRole('button',{name:t('backup'),exact:true}).click();const event=page.waitForEvent('download');await page.getByRole('link',{name:t('saveBackupFile'),exact:true}).click();const file=await(await event).path();if(!file)throw Error('backup-missing');expect((await inspectArchive(await decryptBackup(new Uint8Array(readFileSync(file)),f20Password))).rows).toHaveLength(0);
      await panel.getByRole('button',{name:t('localDatasetSwitch'),exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:t('confirm'),exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(t('localDatasetFailure'));await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:t('confirm'),exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();expect(await page.evaluate(()=>(window as unknown as {__f20Dataset:{calls:string[]}}).__f20Dataset.calls)).toEqual(['keepany-v1','keepany-v1']);await panel.getByRole('button',{name:t('localDatasetAbandon'),exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await panel.getByRole('button',{name:t('localDatasetAbandon'),exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:t('confirm'),exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(t('localDatasetFailure'));await page.screenshot({path:info.outputPath(`dataset-failed-decision-${locale}-390.png`),fullPage:true});await page.getByRole('dialog').getByRole('button',{name:t('confirm'),exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();await expect(panel.getByRole('button',{name:t('localDatasetAbandon'),exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as unknown as {__f20Dataset:{calls:string[]}}).__f20Dataset.calls)).toEqual(['keepany-v1','keepany-v1','abandon:keepany-data-pending','abandon:keepany-data-pending']);await page.screenshot({path:info.outputPath(`dataset-confirmation-${locale}-390.png`),fullPage:true});
    }finally{await context.close();}
  });
});

async function cleanupF20Root(root:string,prefix:string){if(!path.resolve(root).startsWith(path.join(path.resolve(tmpdir()),prefix)))throw Error('unsafe-fixture-cleanup');await rm(root,{recursive:true});}
