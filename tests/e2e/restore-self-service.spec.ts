import { readFileSync } from "node:fs";
import { expect, type BrowserContext, type Page, test } from "@playwright/test";
import type { Asset } from "../../packages/domain/src";
import { inspectArchive, type RecordRow } from "../../packages/local-db/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";

import { sourceModuleUrl } from "./helpers/source-module-url";
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

test("en-US 1280 local third-version conflict can keep current data and abandon the remainder", async ({ browser }) => {
	test.setTimeout(120_000);
	const copy = copyFor(false);
	const contexts: BrowserContext[] = [];
	const errors: string[] = [];
	const suffix = crypto.randomUUID().slice(0, 8);
	const names = [`Recovery source A ${suffix}`, `Recovery source B ${suffix}`];
	const sourceNotes = `source second version ${suffix}`;
	const localNotes = `local third version ${suffix}`;
	try {
		const source = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 844 }, acceptDownloads: true });
		const clean = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 844 }, acceptDownloads: true });
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
		await cleanPage.locator('a[href="/intake"]').click();
		await expect(cleanPage).toHaveURL(/\/intake$/);
		await prepareRestore(cleanPage, copy, sourceArchive.path, false);
		await injectRestoreWriteFault(cleanPage, 1);
		await cleanPage.getByRole("button", { name: copy.confirm }).click();
		const panel = await expectPendingPanel(cleanPage, copy, [2, 0, 1, 1, 0]);
		await cleanPage.screenshot({ path: test.info().outputPath("restore-self-service-abandon-en-1280-pending.png"), fullPage: true });

		await cleanPage.locator('a[href="/accounts"]').first().click();
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
		await cleanPage.locator('a[href="/intake"]').click();
		await expect(cleanPage).toHaveURL(/\/intake$/);
		await expect(panel).toBeVisible();
		await expect(panel.locator(".restore-recovery-counts dd")).toHaveText(["2", "0", "0", "1", "1"]);
		await panel.getByRole("button", { name: copy.keepCurrent, exact: true }).click();
		const confirm = cleanPage.getByRole("dialog");
		await expect(confirm).toContainText(copy.abandonHint);
		await confirm.getByRole("button", { name: copy.abandonConfirm, exact: true }).click();
		await expect(panel).toBeHidden();

		await cleanPage.reload();
		await cleanPage.locator('a[href="/accounts"]').first().click();
		await expect(cleanPage).toHaveURL(/\/accounts$/);
		await expect(cleanPage.locator("main .asset-account-card").filter({ hasText: presentName })).toBeVisible();
		await expect(cleanPage.locator("main .asset-account-card").filter({ hasText: missingName })).toHaveCount(0);
		await cleanPage.locator("main .asset-account-card").filter({ hasText: presentName }).click();
		await expect(cleanPage.locator(".note")).toContainText(localNotes);
		const restored = await downloadAndInspect(cleanPage, copy, "restore-self-service-abandon-en-1280-restored.ka1");
		const sourceAssets = assets(sourceArchive.rows);
		const restoredAssets = assets(restored.rows);
		const presentSource = sourceAssets.find((asset) => asset.name === presentName);
		const missingSource = sourceAssets.find((asset) => asset.name === missingName);
		if (!presentSource || !missingSource) throw Error("source-restore-assets-missing");
		expect(restoredAssets).toHaveLength(1);
		expect(restoredAssets[0].id).toBe(presentSource.id);
		expect(restoredAssets[0].id).not.toBe(missingSource.id);
		expect(restoredAssets[0].notes).toBe(localNotes);
		await cleanPage.screenshot({ path: test.info().outputPath("restore-self-service-abandon-en-1280-kept.png"), fullPage: true });
		expect(await cleanPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
		expect(errors).toEqual([]);
	} finally {
		await attachPageErrors(errors);
		await closeContexts(contexts);
	}
});
