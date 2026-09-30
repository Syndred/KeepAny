import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { passwordVaultCopy } from "../../apps/web/src/password-vault-copy";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { inspectArchive } from "../../packages/local-db/src";

test.setTimeout(150_000);
const evidenceRoot = process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/keepany-password-vault-source";
mkdirSync(evidenceRoot, { recursive: true });
const master = "Sample master phrase 2026!";
const nextMaster = "Changed sample phrase 2026!";
const backupPassword = "Sample outer backup 2026!";
const accountName = "Studio mailbox";
const entryName = "Studio mail login";
const password2 = "Synthetic edited password 2026!";
const variants = [
	{ locale: "zh-CN", width: 390 }, { locale: "zh-CN", width: 1280 },
	{ locale: "en-US", width: 390 }, { locale: "en-US", width: 1280 },
] as const;

function copy(locale: string) {
	const index = locale === "zh-CN" ? 0 : 1;
	return (key: string) => passwordVaultCopy[key]?.[index] ?? key;
}
async function language(page: Page, locale: string) {
	await page.goto("/");
	await page.evaluate((lng) => localStorage.setItem("keepany-language", lng), locale === "zh-CN" ? "zh-CN" : "en");
}
async function createAccount(page: Page, zh: boolean) {
	await page.goto("/assets/account");
	await page.getByRole("main").getByRole("button", { name: zh ? "新增" : "Add", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(zh ? "名称" : "Name", { exact: true }).fill(accountName);
	await dialog.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
	await expect(dialog).toBeHidden();
	const card = page.locator(".asset-account-card").filter({ hasText: accountName });
	await expect(card).toBeVisible();
	return (await card.getAttribute("href")) as string;
}
async function unlock(page: Page, t: ReturnType<typeof copy>, password = master) {
	await page.locator("#password-vault-unlock-master").fill(password);
	await page.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
}
async function closeEditor(page: Page) {
	await page.getByRole("dialog").getByRole("button", { name: /^(Close|关闭)$/ }).click();
	await expect(page.getByRole("dialog")).toBeHidden();
}
async function readPassword(page: Page, t: ReturnType<typeof copy>) {
	await page.locator(".password-vault-entry-list .password-vault-entry").getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
	const field = page.locator("#password-vault-entry-password");
	await expect(field).toHaveAttribute("type", "password");
	const value = await field.inputValue();
	await page.getByRole("dialog").getByRole("button", { name: t("pwVaultShowPassword"), exact: true }).click();
	await expect(field).toHaveAttribute("type", "text");
	await closeEditor(page);
	return value;
}

for (const variant of variants) {
	test(`${variant.locale} ${variant.width}px passwords persist, lock, rotate and restore with assets`, async ({ browser }) => {
		const t = copy(variant.locale);
		const zh = variant.locale === "zh-CN";
		const context = await browser.newContext({ locale: variant.locale, viewport: { width: variant.width, height: 844 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await language(page, variant.locale);
			const accountHref = await createAccount(page, zh);
			await page.goto(accountHref);
			await page.getByRole("link", { name: zh ? "管理这个账号的密码" : "Manage this account’s passwords" }).click();
			await expect(page).toHaveURL(/\/assets\/vault#asset-/);
			await expect(page.locator("#password-vault-master")).toBeVisible();
			await page.screenshot({ path: join(evidenceRoot, `${variant.locale}-${variant.width}-create.png`), fullPage: true });
			await page.locator("#password-vault-master").fill(master);
			await page.locator("#password-vault-master-confirm").fill(master);
			await page.getByRole("button", { name: t("pwVaultCreate"), exact: true }).click();
			await expect(page.locator(".password-vault-toolbar")).toBeVisible();
			await page.getByRole("button", { name: t("pwVaultNewEntry"), exact: true }).click();
			await page.locator("#password-vault-entry-title").fill(entryName);
			await page.locator("#password-vault-entry-username").fill("editor@studio.example");
			await page.locator("#password-vault-entry-url").fill("https://studio.example/login");
			await expect(page.locator(".password-vault-linked-chip")).toContainText(accountName);
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultGeneratePassword"), exact: true }).last().click();
			await expect(page.locator("#password-vault-entry-password")).toHaveValue(/^.{24}$/);
			const generated = await page.locator("#password-vault-entry-password").inputValue();
			expect(generated).toHaveLength(24);
			expect(generated).toMatch(/[A-Z]/); expect(generated).toMatch(/[a-z]/); expect(generated).toMatch(/[0-9]/);
			await page.getByRole("button", { name: t("pwVaultCopyPassword"), exact: true }).click();
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(generated);
			await page.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			const entry = page.locator(".password-vault-entry-list .password-vault-entry");
			await expect(entry).toHaveCount(1);
			await expect(entry).toContainText(accountName);
			await entry.getByRole("button", { name: t("pwVaultCopyUsername"), exact: true }).click();
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("editor@studio.example");
			await page.locator("#password-vault-search-input").fill("absent");
			await expect(entry).toHaveCount(0);
			await page.locator("#password-vault-search-input").fill("Studio");
			await expect(entry).toHaveCount(1);
			await page.locator("#password-vault-search-input").fill("");
			const externalEmpty = page.locator(".vault-reference-empty");
			await expect(externalEmpty).toContainText(zh ? "暂无" : "None");
			await externalEmpty.scrollIntoViewIfNeeded();
			await expect(externalEmpty.locator("strong")).toBeInViewport();
			await page.locator(".password-vault-panel").scrollIntoViewIfNeeded();
			await page.screenshot({ path: join(evidenceRoot, `${variant.locale}-${variant.width}-entries.png`), fullPage: true });
			await entry.getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
			await expect(page.locator("#password-vault-entry-password")).toHaveValue(generated);
			await page.locator("#password-vault-entry-password").fill(password2);
			await page.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await entry.getByRole("button", { name: t("pwVaultHistory"), exact: true }).click();
			await page.getByRole("button", { name: t("pwVaultHistoryRestore"), exact: true }).first().click();
			await expect(page.getByRole("dialog")).toBeHidden();
			expect(await readPassword(page, t)).toBe(generated);
			await entry.getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true }).click();
			await expect(entry).toHaveCount(0);
			await page.getByRole("button", { name: t("pwVaultRestoreEntry"), exact: true }).click();
			await expect(entry).toHaveCount(1);
			await page.getByRole("button", { name: t("pwVaultLock"), exact: true }).click();
			await expect(entry).toHaveCount(0);
			await expect(page.locator("#password-vault-entry-password")).toHaveCount(0);
			await page.locator("#password-vault-unlock-master").fill("wrong master");
			await page.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
			await expect(page.locator(".password-vault-message")).toContainText(t("pwVaultUnlockFailed"));
			await unlock(page, t);
			await page.getByRole("button", { name: t("pwVaultChangeMaster"), exact: true }).click();
			await page.locator("#password-vault-current-master").fill(master);
			await page.locator("#password-vault-new-master").fill(nextMaster);
			await page.locator("#password-vault-new-master-confirm").fill(nextMaster);
			await page.getByRole("button", { name: t("pwVaultChangeMasterNow"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await page.reload();
			await page.locator("#password-vault-unlock-master").fill(master);
			await page.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
			await expect(page.locator(".password-vault-message")).toContainText(t("pwVaultUnlockFailed"));
			await unlock(page, t, nextMaster);
			expect(await readPassword(page, t)).toBe(generated);
			const kdbxDownload = page.waitForEvent("download");
			await page.getByRole("button", { name: t("pwVaultExport"), exact: true }).click();
			const kdbx = await kdbxDownload;
			const kdbxPath = test.info().outputPath("passwords.kdbx");
			await kdbx.saveAs(kdbxPath);
			expect(readFileSync(kdbxPath).includes(Buffer.from(generated))).toBe(false);
			await page.getByRole("button", { name: t("pwVaultImport"), exact: true }).click();
			await page.locator("#password-vault-import-file").setInputFiles(kdbxPath);
			await page.locator("#password-vault-import-password").fill(nextMaster);
			await page.getByRole("button", { name: t("pwVaultImportNow"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await expect(entry).toHaveCount(1);
			const currentDownloadPromise = page.waitForEvent("download");
			await page.getByRole("button", { name: t("pwVaultExport"), exact: true }).click();
			const currentDownload = await currentDownloadPromise;
			const currentKdbxPath = test.info().outputPath("current-passwords.kdbx");
			await currentDownload.saveAs(currentKdbxPath);
			await page.goto("/intake");
			await page.locator("#backup-password").fill(backupPassword);
			await page.getByRole("button", { name: zh ? "创建备份" : "Create backup", exact: true }).click();
			const backupLink = page.getByRole("link", { name: zh ? "保存备份文件" : "Save backup file", exact: true });
			await expect(backupLink).toBeVisible();
			const backupDownload = page.waitForEvent("download"); await backupLink.click();
			const backup = await backupDownload;
			const backupPath = test.info().outputPath("full.ka1"); await backup.saveAs(backupPath);
			const inspected = await inspectArchive(await decryptBackup(new Uint8Array(readFileSync(backupPath)), backupPassword));
			expect(inspected.passwordVault?.bytes).toEqual(new Uint8Array(readFileSync(currentKdbxPath)));
			expect(inspected.rows.some((row) => row.payload.includes(generated) || row.payload.includes(password2) || row.payload.includes(master))).toBe(false);
			const restored = await browser.newContext({ locale: variant.locale, viewport: { width: variant.width, height: 844 } });
			try {
				const restorePage = await restored.newPage();
				await language(restorePage, variant.locale);
				await restorePage.goto("/assets/vault");
				await expect(restorePage.locator("#password-vault-master")).toBeVisible();
				// Keep the initialized empty session alive through the SPA restore route.
				await restorePage.getByRole("link", { name: zh ? "收录与备份" : "Import & backup", exact: true }).last().click();
				await restorePage.locator("#backup-password").fill(backupPassword);
				await restorePage.locator("summary").filter({ hasText: zh ? "恢复备份" : "Restore backup" }).click();
				await restorePage.locator("#restore-file").setInputFiles(backupPath);
				await restorePage.getByRole("button", { name: zh ? "预览" : "Preview", exact: true }).click();
				await expect(restorePage.getByText(zh ? "包含加密密码库。恢复后仍需原密码库主密码解锁。" : "Includes an encrypted password vault. Its original master password is still needed after restoring.")).toBeVisible();
				await restorePage.getByRole("button", { name: zh ? /^确认 ·/ : /^Confirm ·/ }).click();
				await expect(restorePage.getByRole("status").filter({ hasText: zh ? "已恢复" : "Restored" })).toBeVisible();
				if (variant.width === 390) await restorePage.locator(".mobile-menu").click();
				await restorePage.getByRole("link", { name: zh ? "密码库" : "Password vault", exact: true }).first().click();
				await unlock(restorePage, t, nextMaster);
				await expect(restorePage.locator(".password-vault-entry-list .password-vault-entry")).toContainText(accountName);
				expect(await readPassword(restorePage, t)).toBe(generated);
				await restorePage.screenshot({ path: join(evidenceRoot, `${variant.locale}-${variant.width}-restored.png`), fullPage: true });
				await expect(restorePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
				if (process.env.KEEPANY_PRODUCTION_OFFLINE === "1" && variant.locale === "en-US" && variant.width === 1280) {
					await restorePage.evaluate(() => navigator.serviceWorker.ready);
					await restored.setOffline(true);
					await restorePage.reload();
					await unlock(restorePage, t, nextMaster);
					expect(await readPassword(restorePage, t)).toBe(generated);
					await restored.setOffline(false);
				}
			} finally { await restored.close(); }
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}

test("password changes lock a revealed editor in another tab; idle lock and clean KDBX import work", async ({ browser }) => {
	const t = copy("en-US");
	const context = await browser.newContext({ locale: "en-US", acceptDownloads: true });
	try {
		const first = await context.newPage();
		await first.clock.install();
		await language(first, "en-US");
		await first.goto("/assets/vault");
		await expect(first.locator("#password-vault-master")).toBeVisible();
		const second = await context.newPage();
		await second.goto("/assets/vault");
		await expect(second.locator("#password-vault-master")).toBeVisible();
		await first.locator("#password-vault-master").fill(master);
		await first.locator("#password-vault-master-confirm").fill(master);
		await first.getByRole("button", { name: t("pwVaultCreate"), exact: true }).click();
		await expect(first.locator(".password-vault-toolbar")).toBeVisible();
		await expect(second.locator("#password-vault-unlock-master")).toBeVisible();
		await first.getByRole("button", { name: t("pwVaultNewEntry"), exact: true }).click();
		await first.locator("#password-vault-entry-title").fill(entryName);
		await first.locator("#password-vault-entry-password").fill(password2);
		await first.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
		await expect(first.getByRole("dialog")).toBeHidden();
		await unlock(second, t);
		await second.locator(".password-vault-entry-list .password-vault-entry").getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
		await second.getByRole("button", { name: t("pwVaultShowPassword"), exact: true }).click();
		await expect(second.locator("#password-vault-entry-password")).toHaveValue(password2);
		await first.locator(".password-vault-entry-list .password-vault-entry").getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
		await first.locator("#password-vault-entry-password").fill("Synthetic third revision!");
		await first.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
		await expect(first.getByRole("dialog")).toBeHidden();
		await expect(second.getByRole("dialog")).toBeHidden();
		await expect(second.locator("#password-vault-entry-password")).toHaveCount(0);
		await expect(second.locator("#password-vault-unlock-master")).toBeVisible();
		await unlock(second, t);
		expect(await readPassword(second, t)).toBe("Synthetic third revision!");
		const downloadPromise = first.waitForEvent("download");
		await first.getByRole("button", { name: t("pwVaultExport"), exact: true }).click();
		const download = await downloadPromise;
		const path = test.info().outputPath("independent-import.kdbx"); await download.saveAs(path);
		await first.clock.fastForward(5 * 60 * 1000 + 15_000);
		await expect(first.locator("#password-vault-unlock-master")).toBeVisible();
		await expect(first.locator(".password-vault-entry-list .password-vault-entry")).toHaveCount(0);
		const empty = await browser.newContext({ locale: "en-US" });
		try {
			const page = await empty.newPage();
			await language(page, "en-US"); await page.goto("/assets/vault");
			await page.getByRole("button", { name: t("pwVaultImportEmpty"), exact: true }).click();
			await page.locator("#password-vault-import-file").setInputFiles(path);
			await page.locator("#password-vault-import-password").fill(master);
			await page.getByRole("button", { name: t("pwVaultImportNow"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			expect(await readPassword(page, t)).toBe("Synthetic third revision!");
			await page.reload(); await unlock(page, t);
			expect(await readPassword(page, t)).toBe("Synthetic third revision!");
		} finally { await empty.close(); }
	} finally { await context.close(); }
});
