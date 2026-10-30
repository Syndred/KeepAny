import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { closeCompactLoginDetails, compactEntryIds, openCompactLoginDetails } from "./helpers/compact-account";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/account-password-consolidation";
mkdirSync(evidence, { recursive: true });
const master = "Synthetic vault master 2026!";
const secret = "Synthetic protected password 2026!";
const title = "Synthetic independent login";
const note = "Synthetic private notes excluded from ordinary search";
const aliases = ["second-login@example.test", "+15550001234"];
const copy = (language: "zh-CN" | "en") => (key: string) => (resources[language].translation as Record<string, string>)[key] ?? key;

async function openAccess(page: Page) {
	const section = page.locator(".unified-vault-access");
	await expect(section).toBeVisible();
	if (!await section.evaluate((node) => (node as HTMLDetailsElement).open)) await section.locator("summary").click();
	await expect(section).toHaveJSProperty("open", true);
}
async function unlock(page: Page, t: (key: string) => string) {
	await openAccess(page);
	await page.locator("#password-vault-unlock-master").fill(master);
	await page.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
}
for (const language of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`${language} ${width} account and password features survive unified entry, locking and KDBX restore`, async ({ browser }) => {
		test.setTimeout(180_000);
		const context = await browser.newContext({ viewport: { width, height: 950 }, locale: language, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
		await context.addInitScript((language) => localStorage.setItem("keepany-language", language), language);
		const page = await context.newPage(), t = copy(language); page.setDefaultTimeout(12_000);
		const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
		try {
			await page.goto("/settings#advanced-settings");
			await page.getByRole("button", { name: t("loadSample"), exact: true }).click();
			await expect(page.getByRole("button", { name: t("sampleLibraryPresent"), exact: true })).toBeDisabled();
			await page.goto("/accounts");
			await openAccess(page);
			await page.locator("#password-vault-master").fill(master);
			await page.locator("#password-vault-master-confirm").fill(master);
			await page.getByRole("button", { name: t("pwVaultCreate"), exact: true }).click();
			const toolbar = page.locator(".password-vault-toolbar");
			await toolbar.getByRole("button", { name: t("sampleLogins"), exact: true }).click();
			await expect(toolbar.getByRole("button", { name: t("sampleLogins"), exact: true })).toHaveCount(0, { timeout: 30_000 });
			await expect.poll(async () => (await compactEntryIds(page)).length).toBe(8);
			const passwordless = page.locator(".unified-account").filter({ hasText: t("sampleNoPasswordAccount") });
			await expect(passwordless).toContainText(t("pwVaultNoPassword"));
			let loginDetail = await openCompactLoginDetails(page, passwordless, t);
			await loginDetail.getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
			await expect(page.locator("#password-vault-entry-password")).toHaveValue("");
			await page.getByRole("dialog").last().getByRole("button", { name: t("close"), exact: true }).click();
			await closeCompactLoginDetails(page, t);
			// The single global entry creates an account and its optional credential together.
			await page.locator(".password-vault-header").getByRole("button", { name: t("add"), exact: true }).click();
			await page.locator("#password-vault-entry-title").fill(title);
			await page.locator("#password-vault-entry-username").fill("primary@example.test");
			for (const alias of aliases) {
				await page.getByRole("dialog").getByRole("button", { name: t("pwVaultAddIdentifier"), exact: true }).click();
				await page.locator(".pw-smart-identifier-row input").last().fill(alias);
			}
			await page.locator("#password-vault-entry-notes").fill(note);
			await page.getByRole("dialog").getByRole("button", { name: t("save"), exact: true }).click();
			await expect(page.locator(".asset-account-card")).toHaveCount(9);
			const created = page.locator(".unified-account").filter({ hasText: title });
			loginDetail = await openCompactLoginDetails(page, created, t);
			await expect(loginDetail.locator(".password-vault-entry")).toHaveCount(1);
			// Keep the original standalone lifecycle coverage by explicitly unlinking this new credential.
			await loginDetail.locator(".password-vault-linked-connection button").click();
			await page.getByRole("dialog", { name: t("pwVaultUnlink"), exact: true }).getByRole("button", { name: t("pwVaultUnlink"), exact: true }).click();
			await expect(created).not.toHaveAttribute("data-entry-id", /.+/);
			const standalone = page.locator(".workspace-password-only .password-vault-entry").filter({ hasText: title });
			await expect(standalone).toContainText(t("pwVaultNoPassword"));
			await standalone.getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
			await page.locator("#password-vault-entry-password").fill(secret);
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			await standalone.getByRole("button", { name: t("pwVaultRevealPassword"), exact: true }).click();
			await expect(standalone.locator(".password-vault-secret")).toHaveText(secret);
			await standalone.getByRole("button", { name: t("pwVaultCopyPassword"), exact: true }).click();
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(secret);
			await standalone.getByRole("button", { name: t("pwVaultHidePasswordValue"), exact: true }).click();
			// Search public login metadata in memory, while excluding protected passwords and notes.
			const query = page.getByRole("searchbox", { name: t("accountListSearch"), exact: true });
			await query.fill(aliases[0]); await expect(standalone).toBeVisible();
			expect(await page.evaluate(() => sessionStorage.getItem("keepany-account-list-search") ?? "")).toBe("");
			await query.fill(secret); await expect(page.locator(".workspace-password-only")).toHaveCount(0);
			await query.fill(note); await expect(page.locator(".workspace-password-only")).toHaveCount(0);
			await query.fill("");
			await standalone.getByRole("button", { name: t("pwVaultHistory"), exact: true }).click();
			// Preparation now creates an account-linked revision, then unlinks it.
			// Restore the exact second (unlinked, still passwordless) revision that
			// preceded the password edit, retaining the original standalone contract.
			await expect(page.locator(".password-vault-history-row")).toHaveCount(2);
			await page.locator(".password-vault-history-row").nth(1).getByRole("button", { name: t("pwVaultHistoryRestore"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await expect(standalone).toContainText(t("pwVaultNoPassword"));
			// Linked entry unlinks after confirmation and joins standalone rows, without changing the account.
			const linked = page.locator(".unified-account").filter({ hasText: t("sampleAccount") });
			loginDetail = await openCompactLoginDetails(page, linked, t);
			await loginDetail.locator(".password-vault-linked-connection button").click();
			await page.getByRole("dialog", { name: t("pwVaultUnlink"), exact: true }).getByRole("button", { name: t("cancel"), exact: true }).click();
			await expect(loginDetail.locator(".password-vault-entry")).toHaveCount(1);
			await loginDetail.locator(".password-vault-linked-connection button").click();
			await page.getByRole("dialog", { name: t("pwVaultUnlink"), exact: true }).getByRole("button", { name: t("pwVaultUnlink"), exact: true }).click();
			await expect(linked).not.toHaveAttribute("data-entry-id", /.+/);
			await expect(page.locator(".asset-account-card")).toHaveCount(9);
			await standalone.getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true }).click();
			await page.getByRole("dialog").getByRole("button", { name: t("cancel"), exact: true }).click();
			await expect(standalone).toBeVisible();
			await standalone.getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true }).click();
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true }).click();
			await expect(standalone).toHaveCount(0);
			await page.locator("#vault-trash").getByRole("button", { name: t("pwVaultRestoreEntry"), exact: true }).click();
			await expect(standalone).toBeVisible();
			await toolbar.getByRole("button", { name: t("pwSmartTitle"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeVisible();
			await page.getByRole("dialog").getByRole("button", { name: t("close"), exact: true }).click();
			await toolbar.getByRole("button", { name: t("pwConnectTitle"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeVisible();
			await page.getByRole("dialog").getByRole("button", { name: t("close"), exact: true }).click();
			await toolbar.getByRole("button", { name: t("pwVaultChangeMaster"), exact: true }).click();
			await expect(page.locator("#password-vault-current-master")).toBeVisible();
			await page.getByRole("dialog").getByRole("button", { name: t("cancel"), exact: true }).click();
			const download = page.waitForEvent("download");
			await toolbar.getByRole("button", { name: t("pwVaultExport"), exact: true }).click();
			const file = test.info().outputPath("unified-account-logins.kdbx"); await (await download).saveAs(file);
			const encrypted = readFileSync(file); expect(encrypted.includes(Buffer.from(note))).toBe(false);
			for (const alias of aliases) expect(encrypted.includes(Buffer.from(alias))).toBe(false);
			await toolbar.getByRole("button", { name: t("pwVaultLock"), exact: true }).click();
			await expect(page.locator(".password-vault-entry-list .password-vault-entry")).toHaveCount(0);
			await expect(page.locator(".asset-account-card")).toHaveCount(9);
			await expect(query).toHaveValue("");
			await openAccess(page);
			await page.locator("#password-vault-unlock-master").fill("Wrong synthetic password");
			await page.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
			await expect(page.locator(".password-vault-message").filter({ hasText: t("pwVaultUnlockFailed") })).toBeVisible();
			await unlock(page, t);
			await expect(standalone).toBeVisible();
			await expect(page.locator(".toast, .compact-account-feedback-message").filter({ hasText: t("pwVaultUnlockFailed") })).toHaveCount(0);
			await page.screenshot({ path: join(evidence, `unified-logins-${language}-${width}.png`) });
			await page.reload(); await unlock(page, t); await expect(standalone).toBeVisible();
			const restored = await browser.newContext({ viewport: { width, height: 950 }, locale: language });
			try {
				await restored.addInitScript((language) => localStorage.setItem("keepany-language", language), language);
				const target = await restored.newPage(); await target.goto("/accounts");
				await openAccess(target);
				await target.getByRole("button", { name: t("pwVaultImportEmpty"), exact: true }).click();
				await target.locator("#password-vault-import-file").setInputFiles(file);
				await target.locator("#password-vault-import-password").fill(master);
				await target.getByRole("dialog").getByRole("button", { name: t("pwVaultImportNow"), exact: true }).click();
				await expect(target.locator(".workspace-password-only .password-vault-entry")).toHaveCount(9);
				await expect(target.locator(".workspace-password-only")).toContainText(title);
				await expect(target.locator(".workspace-password-only")).toContainText(aliases[0]);
			} finally { await restored.close(); }
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
