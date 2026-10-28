import { mkdirSync, readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { aiCopy } from "../../apps/web/src/ai-copy";
import { passwordVaultCopy } from "../../apps/web/src/password-vault-copy";
import { inspectArchive } from "../../packages/local-db/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import {
	aiServer,
	checkLayout,
	labels,
	model,
	syntheticKey,
} from "./helpers/ai-workflow";
import { selectChoice } from "./helpers/select-choice";
import { openVaultAccess, prepareVaultWorkspace, revealPasswordEntries } from "./helpers/vault-access";

const evidenceRoot =
	process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/keepany-ai-key-persistence";
const master = "Synthetic persistent API-key master 2026!";
const replacementKey = "keepany-replacement-synthetic-key-do-not-use";
const backupPassword = "Synthetic persistent API-key outer backup 2026!";
const accountName = "Synthetic ordinary account";
const variants = [
	{ language: "zh-CN", locale: "zh-CN", width: 390 },
	{ language: "zh-CN", locale: "zh-CN", width: 1280 },
	{ language: "en", locale: "en-US", width: 390 },
	{ language: "en", locale: "en-US", width: 1280 },
] as const;
type Language = (typeof variants)[number]["language"];

function copy(language: Language) {
	const index = language === "zh-CN" ? 0 : 1;
	return (key: string) =>
		aiCopy[key]?.[index] ?? passwordVaultCopy[key]?.[index] ?? key;
}

async function openSettings(page: Page, language: Language) {
	const ui = labels[language];
	await page
		.getByRole("button", { name: ui.assistantMenu, exact: true })
		.click();
	await page
		.getByRole("menuitem", { name: ui.assistantAccess, exact: true })
		.click();
	await page
		.getByRole("link", {
			name: language === "zh-CN" ? "配置本机授权" : "Configure local access",
			exact: true,
		})
		.click();
	const settings = page.locator(".ai-settings-panel");
	await expect(settings).toBeVisible();
	return settings;
}

async function openVault(page: Page, language: Language, width: number) {
	if (width === 390) await page.locator(".mobile-menu").click();
	await page
		.getByRole("link", {
			name: language === "zh-CN" ? "账号" : "Accounts",
			exact: true,
		})
		.first()
		.click();
	await expect(page).toHaveURL(/\/accounts$/);
}

async function createVault(page: Page, language: Language) {
	const t = copy(language);
	await page.goto("/assets/vault");
	await prepareVaultWorkspace(page);
	await openVaultAccess(page);
	await page.locator("#password-vault-master").fill(master);
	await page.locator("#password-vault-master-confirm").fill(master);
	await page
		.getByRole("button", { name: t("pwVaultCreate"), exact: true })
		.click();
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
	await revealPasswordEntries(page);
}

async function unlockSettings(settings: Locator, language: Language) {
	const t = copy(language);
	const masterField = settings.locator("#ai-settings-master");
	const open = settings.getByRole("button", {
		name: t("aiSettingsOpenVault"),
		exact: true,
	});
	await expect(masterField.or(open)).toBeVisible();
	if (await open.isVisible()) await open.click();
	await masterField.fill(master);
	await settings
		.getByRole("button", { name: t("aiSettingsUnlockVault"), exact: true })
		.click();
	await expect(masterField).toHaveCount(0);
}

async function configuration(page: Page) {
	return page.evaluate(() =>
		JSON.parse(localStorage.getItem("keepany-ai-settings-v1") || "null"),
	);
}

async function assertNoPlainStorage(page: Page) {
	const storage = await page.evaluate(() =>
		JSON.stringify({
			local: { ...localStorage },
			session: { ...sessionStorage },
		}),
	);
	for (const value of [syntheticKey, replacementKey, master])
		expect(storage).not.toContain(value);
}

async function testConnection(
	settings: Locator,
	language: Language,
	mock: Awaited<ReturnType<typeof aiServer>>,
	key: string,
) {
	const ui = labels[language];
	const before = mock.requests.length;
	mock.responses.push("OK");
	await settings
		.getByRole("button", { name: ui.testConnection, exact: true })
		.click();
	await expect(
		settings.getByRole("status").filter({ hasText: ui.connected }),
	).toContainText(model);
	expect(mock.requests).toHaveLength(before + 1);
	expect(mock.requests[before].headers.authorization).toBe(`Bearer ${key}`);
	const prompt = JSON.stringify(mock.requests[before].body);
	for (const value of [syntheticKey, replacementKey, master, accountName])
		expect(prompt).not.toContain(value);
}

for (const variant of variants) {
	test(`${variant.language} ${variant.width}px encrypted API key survives refresh, updates in place and stops on lock`, async ({
		browser,
	}) => {
		test.setTimeout(150_000);
		mkdirSync(evidenceRoot, { recursive: true });
		const ui = labels[variant.language];
		const t = copy(variant.language);
		const mock = await aiServer();
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
			acceptDownloads: true,
		});
		await context.addInitScript(
			(language) => localStorage.setItem("keepany-language", language),
			variant.language,
		);
		const page = await context.newPage();
		page.setDefaultTimeout(15_000);
		const errors: string[] = [];
		const sourceRequests: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("request", (request) => {
			if (request.url().includes("/@fs")) sourceRequests.push(request.url());
		});
		try {
			// A real ordinary asset makes the backup assertion check both storage paths.
			await page.goto("/assets/account");
			await page
				.getByRole("main")
				.getByRole("button", { name: ui.add, exact: true })
				.click();
			const editor = page.getByRole("dialog");
			await editor.getByLabel(ui.name, { exact: true }).fill(accountName);
			await editor.getByRole("button", { name: ui.save, exact: true }).click();
			await expect(editor).toBeHidden();
			await createVault(page, variant.language);

			const settings = await openSettings(page, variant.language);
			await selectChoice(
				settings.locator("#ai-settings-provider"),
				"compatible",
			);
			await settings.locator("#ai-settings-url").fill(mock.baseURL);
			await settings.locator("#ai-settings-model").fill(model);
			await expect(settings.locator("#ai-settings-key-source")).toHaveAttribute(
				"data-value",
				"vault",
			);
			await expect(
				settings.locator("#ai-settings-auto-activate"),
			).toBeChecked();
			await settings.locator("#ai-settings-api-key").fill(syntheticKey);
			await settings
				.getByRole("button", { name: ui.saveSettings, exact: true })
				.click();
			await expect(
				settings
					.getByRole("status")
					.filter({ hasText: t("aiSettingsVaultSaved") }),
			).toBeVisible();
			await expect(settings.locator("#ai-settings-api-key")).toHaveValue("");
			const original = await configuration(page);
			expect(original).toMatchObject({
				provider: "compatible",
				baseURL: mock.baseURL,
				model,
				keySource: "vault",
				autoActivate: true,
			});
			expect(original.vaultEntryId).toEqual(expect.any(String));
			await assertNoPlainStorage(page);
			await checkLayout(page, settings, variant.width);
			await settings.screenshot({
				path: `${evidenceRoot}/ai-key-saved-${variant.language}-${variant.width}.png`,
			});

			// The key is never typed again: only the vault's master password is needed.
			await page.reload();
			await unlockSettings(settings, variant.language);
			await expect(
				settings.getByRole("status").filter({ hasText: ui.ready }),
			).toBeVisible();
			await expect(
				settings.getByRole("button", {
					name: t("aiSettingsActivateVaultKey"),
					exact: true,
				}),
			).toHaveCount(0);
			await expect(settings.locator("#ai-settings-api-key")).toHaveValue("");
			await testConnection(settings, variant.language, mock, syntheticKey);

			// Re-saving the selected entry reuses it; a replacement key updates it.
			await settings
				.getByRole("button", { name: ui.saveSettings, exact: true })
				.click();
			await expect(
				settings
					.getByRole("status")
					.filter({ hasText: t("aiSettingsVaultSaved") }),
			).toBeVisible();
			expect((await configuration(page)).vaultEntryId).toBe(
				original.vaultEntryId,
			);
			await settings.locator("#ai-settings-api-key").fill(replacementKey);
			await settings
				.getByRole("button", { name: ui.saveSettings, exact: true })
				.click();
			await expect(settings.locator("#ai-settings-api-key")).toHaveValue("");
			expect((await configuration(page)).vaultEntryId).toBe(
				original.vaultEntryId,
			);
			await page.reload();
			await unlockSettings(settings, variant.language);
			await testConnection(settings, variant.language, mock, replacementKey);
			await assertNoPlainStorage(page);
			await checkLayout(page, settings, variant.width);
			await settings.screenshot({
				path: `${evidenceRoot}/ai-key-restored-${variant.language}-${variant.width}.png`,
			});

			await openVault(page, variant.language, variant.width);
			const entries = page.locator(
				".password-vault-entry-list .password-vault-entry",
			);
			await expect(entries).toHaveCount(1);
			await entries
				.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
				.click();
			await expect(page.locator("#password-vault-entry-password")).toHaveValue(
				replacementKey,
			);
			await page
				.getByRole("dialog")
				.getByRole("button", { name: ui.close, exact: true })
				.first()
				.click();
			const kdbxDownload = page.waitForEvent("download");
			await page
				.getByRole("button", { name: t("pwVaultExport"), exact: true })
				.click();
			const kdbx = await kdbxDownload;
			const kdbxPath = test.info().outputPath("encrypted-api-key.kdbx");
			await kdbx.saveAs(kdbxPath);
			const encrypted = readFileSync(kdbxPath);
			for (const value of [syntheticKey, replacementKey, master])
				expect(encrypted.includes(Buffer.from(value))).toBe(false);

			await page
				.locator(".top-actions")
				.getByRole("link", { name: ui.intake, exact: true })
				.click();
			await page.locator("#backup-password").fill(backupPassword);
			await page
				.getByRole("button", {
					name: variant.language === "zh-CN" ? "创建备份" : "Create backup",
					exact: true,
				})
				.click();
			const backupLink = page.getByRole("link", {
				name:
					variant.language === "zh-CN" ? "保存备份文件" : "Save backup file",
				exact: true,
			});
			await expect(backupLink).toBeVisible();
			const backupDownload = page.waitForEvent("download");
			await backupLink.click();
			const backup = await backupDownload;
			const backupPath = test.info().outputPath("ordinary-assets.ka1");
			await backup.saveAs(backupPath);
			const archive = await inspectArchive(
				await decryptBackup(
					new Uint8Array(readFileSync(backupPath)),
					backupPassword,
				),
			);
			expect(archive.passwordVault?.bytes).toEqual(new Uint8Array(encrypted));
			const rows = JSON.stringify(archive.rows);
			expect(rows).toContain(accountName);
			for (const value of [syntheticKey, replacementKey, master])
				expect(rows).not.toContain(value);

			await openVault(page, variant.language, variant.width);
			await page
				.getByRole("button", { name: t("pwVaultLock"), exact: true })
				.click();
			await expect(entries).toHaveCount(0);
			await openSettings(page, variant.language);
			await expect(
				settings
					.getByRole("status")
					.filter({ hasText: t("aiSettingsVaultNeedsUnlock") }),
			).toBeVisible();
			const requestCount = mock.requests.length;
			await settings
				.getByRole("button", { name: ui.testConnection, exact: true })
				.click();
			await expect(settings.getByRole("alert")).toContainText(
				t("aiSettingsVaultLocked"),
			);
			expect(mock.requests).toHaveLength(requestCount);
			await assertNoPlainStorage(page);
			if (process.env.KEEPANY_PRODUCTION_OFFLINE === "1")
				expect(sourceRequests).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
			await mock.close();
		}
	});
}

test("vault API key with automatic activation disabled still requires explicit activation after unlock", async ({
	browser,
}) => {
	test.setTimeout(90_000);
	const language = "en";
	const ui = labels[language];
	const t = copy(language);
	const mock = await aiServer();
	const context = await browser.newContext({ locale: "en-US" });
	await context.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	const page = await context.newPage();
	try {
		await createVault(page, language);
		const settings = await openSettings(page, language);
		await selectChoice(settings.locator("#ai-settings-provider"), "compatible");
		await settings.locator("#ai-settings-url").fill(mock.baseURL);
		await settings.locator("#ai-settings-model").fill(model);
		await settings.locator("#ai-settings-auto-activate").uncheck();
		await settings.locator("#ai-settings-api-key").fill(syntheticKey);
		await settings
			.getByRole("button", { name: ui.saveSettings, exact: true })
			.click();
		await expect(
			settings.getByRole("status").filter({ hasText: ui.ready }),
		).toBeVisible();
		expect((await configuration(page)).autoActivate).not.toBe(true);
		await page.reload();
		await unlockSettings(settings, language);
		await expect(
			settings
				.getByRole("status")
				.filter({ hasText: t("aiSettingsVaultNeedsActivation") }),
		).toBeVisible();
		expect(mock.requests).toHaveLength(0);
		await settings
			.getByRole("button", {
				name: t("aiSettingsActivateVaultKey"),
				exact: true,
			})
			.click();
		await expect(
			settings.getByRole("status").filter({ hasText: ui.ready }),
		).toBeVisible();
		await testConnection(settings, language, mock, syntheticKey);
		await assertNoPlainStorage(page);
	} finally {
		await context.close();
		await mock.close();
	}
});
