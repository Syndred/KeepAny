import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { portableCandidate } from "./helpers/portable-candidate";
import { openVaultAccess } from "./helpers/vault-access";

const evidence = resolve(process.env.KEEPANY_COMPACT_EVIDENCE ?? `test-results/compact-accounts-${Date.now()}`);
mkdirSync(evidence, { recursive: true });
const master = "SyntheticCompactMaster2026!", mainPassword = "Synthetic-Main!2026", secondPassword = "Synthetic-Backup!2026";
const text = (language: "zh-CN" | "en") => (key: string) => (resources[language].translation as Record<string, string>)[key] ?? key;
const account = (page: Page, name = "CC studio account") => page.locator(".compact-account-card").filter({ has: page.getByRole("button", { name: name === "CC studio account" ? /^(CC studio account|CC secondary login)$/ : name, exact: true }) });

async function save(dialog: Locator) {
	await dialog.getByRole("button", { name: /^(保存|Save|保存条目|Save entry)$/ }).click();
	await expect(dialog).toBeHidden();
}
async function createAccount(page: Page, t: (key: string) => string, name: string, user = "", password = "", aliases: string[] = []) {
	await page.locator(".password-vault-header").getByRole("button", { name: t("add"), exact: true }).click();
	const dialog = page.getByRole("dialog").last();
	await dialog.locator("#password-vault-entry-title").fill(name);
	await dialog.locator("#password-vault-entry-username").fill(user);
	if (password) await dialog.locator("#password-vault-entry-password").fill(password);
	if (password) await dialog.locator("#password-vault-entry-url").fill("https://main.example.test/login");
	for (const alias of aliases) {
		await dialog.getByRole("button", { name: t("pwVaultAddIdentifier"), exact: true }).click();
		await dialog.locator(".pw-smart-identifier-row input").last().fill(alias);
	}
	await save(dialog);
}
async function addLogin(page: Page, t: (key: string) => string) {
	await account(page).getByRole("button", { name: t("moreActions"), exact: true }).click();
	await page.getByRole("menuitem", { name: t("pwVaultNewEntry"), exact: true }).click();
	const dialog = page.getByRole("dialog").last();
	await dialog.locator("#password-vault-entry-title").fill("CC secondary login");
	await dialog.locator("#password-vault-entry-username").fill("backup@example.test");
	await dialog.locator("#password-vault-entry-password").fill(secondPassword);
		await dialog.locator("#password-vault-entry-url").fill("https://backup.example.test/login");
	await save(dialog);
}
async function prepare(page: Page, t: (key: string) => string, aliases: string[] = [], extraLogin = true) {
	await page.goto("/");
	await page.locator(".sidebar nav").getByRole("link", { name: t("accountsWorkspace"), exact: true }).click();
		await openVaultAccess(page);
	await page.locator("#password-vault-master").fill(master);
	await page.locator("#password-vault-master-confirm").fill(master);
	await page.getByRole("button", { name: t("accountSetUp"), exact: true }).click();
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
    await createAccount(page, t, "CC public account", "public@example.test");
	await createAccount(page, t, "CC studio account", "main@example.test", mainPassword, aliases);
	if (extraLogin) await addLogin(page, t);
}
async function screenshot(page: Page, name: string) {
	if (page.viewportSize()!.width < 768) await expect.poll(() => page.locator(".sidebar").evaluate(node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
	else await expect.poll(() => page.locator(".sidebar").evaluate(node => node.getBoundingClientRect().left)).toBeGreaterThanOrEqual(0);
	await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
}
async function clipboard(page: Page) { return page.evaluate(() => navigator.clipboard.readText()); }

for (const language of ["zh-CN", "en"] as const) {
	test(`${language} CC10 restoring a deleted entry does not reopen stale login details`, async ({ browser }, info) => {
		test.setTimeout(120_000);
		const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 1000 }, locale: language });
		await context.addInitScript(lang => localStorage.setItem("keepany-language", lang), language);
		const page = await context.newPage(), t = text(language);
		try {
			await prepare(page, t, [], false);
			await account(page).getByRole("button", { name: t("accountDeleteLogin"), exact: true }).click();
            await page.getByRole("dialog", { name: t("accountDeleteLogin"), exact: true }).getByRole("button", { name: t("accountDeleteLogin"), exact: true }).click();
			await expect(page.getByRole("dialog")).toHaveCount(0);
			await page.locator("#vault-trash").getByRole("button", { name: t("pwVaultRestoreEntry"), exact: true }).click();
			await expect(page.getByRole("dialog")).toHaveCount(0);
			await expect(account(page)).toHaveAttribute("data-entry-id", /.+/);
			await screenshot(page, `entry-restored-${language}`);
			await expect(page.getByRole("dialog")).toHaveCount(0);
		} finally { await context.close(); }
	});
	test(`${language} CC03-CC10 compact copy, cyclic switch, lock, details and durable content`, async ({ browser }, info) => {
		test.setTimeout(180_000);
		const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 1000 }, locale: language, permissions: ["clipboard-read", "clipboard-write"] });
		await context.addInitScript(lang => localStorage.setItem("keepany-language", lang), language);
		const page = await context.newPage(), t = text(language), errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		try {
			await prepare(page, t, ["alias@example.test"]);
			const card = account(page), change = card.getByRole("button", { name: /^(切换登录账号|Next login)/ });
			await card.getByRole("button", { name: t("pwVaultCopyUsername"), exact: true }).click();
			await expect.poll(() => clipboard(page)).toBe("main@example.test");
			await card.getByRole("button", { name: t("pwVaultCopyPassword"), exact: true }).click();
			await expect.poll(() => clipboard(page)).toBe(mainPassword);
			await card.getByRole("button", { name: t("pwVaultRevealPassword"), exact: true }).click();
			await expect(card.locator("[data-login-password]")).toHaveText(mainPassword);
			await change.click();
			await expect(card.locator("[data-login-username]")).toHaveText("alias@example.test");
			await expect(card.locator("[data-login-password]")).not.toHaveText(mainPassword);
			await change.click();
			await expect(card.locator("[data-login-username]")).toHaveText("backup@example.test");
			await expect(card.getByRole("link", { name: t("compactAccountOpenUrl"), exact: true })).toHaveAttribute("href", "https://backup.example.test/login");
			await card.getByRole("button", { name: t("pwVaultCopyPassword"), exact: true }).click();
			await expect.poll(() => clipboard(page)).toBe(secondPassword);
			await screenshot(page, `flow-switched-${language}`);
			await change.click();
			await expect(card.locator("[data-login-username]")).toHaveText("main@example.test");
			await expect(card.locator("select")).toHaveCount(0);
			await card.getByRole("button", { name: t("moreActions"), exact: true }).click();
			await page.getByRole("menuitem", { name: t("compactAccountCopyUrl"), exact: true }).click();
			await expect.poll(() => clipboard(page)).toBe("https://main.example.test/login");
			await page.getByRole("button", { name: t("pwVaultLock"), exact: true }).click();
			await expect(card.locator("[data-login-password]")).toHaveCount(0);
			await expect(card.getByRole("button", { name: /^(切换登录账号|Next login)/ })).toHaveCount(0);
            await expect(page.locator(".compact-account-card")).toHaveCount(0);
			await page.locator("#password-vault-unlock-master").fill("wrong-fictional-password");
			await page.getByRole("button", { name: t("accountUnlockAction"), exact: true }).first().click();
			await expect(card.locator("[data-login-password]")).toHaveCount(0);
			await page.locator("#password-vault-unlock-master").fill(master);
			await page.getByRole("button", { name: t("accountUnlockAction"), exact: true }).first().click();
			await expect(card.locator("[data-login-password]")).toHaveText("••••••••••");
            await account(page, "CC public account").getByRole("button", { name: t("pwVaultCopyUsername"), exact: true }).click();
            await expect.poll(() => clipboard(page)).toBe("public@example.test");
            await card.getByRole("button", { name: t("edit"), exact: true }).click();
            const edit = page.getByRole("dialog", { name: t("accountEditUnified"), exact: true });
            await expect(page.getByRole("dialog")).toHaveCount(1);
            await expect(edit.locator("#password-vault-entry-username")).toHaveValue("main@example.test");
            await edit.getByRole("button", { name: t("cancel"), exact: true }).click();
            await expect(card.getByRole("button", { name: t("edit"), exact: true })).toBeFocused();
            await card.getByRole("button", { name: t("moreActions"), exact: true }).click();
            await page.getByRole("menuitem", { name: t("pwVaultHistory"), exact: true }).click();
            await page.getByRole("dialog").getByRole("button", { name: t("close"), exact: true }).click();
			await page.reload(); await openVaultAccess(page);
			await page.locator("#password-vault-unlock-master").fill(master);
			await page.getByRole("button", { name: t("accountUnlockAction"), exact: true }).first().click();
			await expect(account(page)).toBeVisible();
			await expect(account(page).getByRole("button", { name: /^(切换登录账号|Next login)/ })).toContainText("1/3");
			await screenshot(page, `flow-reloaded-${language}`);
			expect(errors).toEqual([]);
		} finally { writeFileSync(join(evidence, `functional-${language}.json`), JSON.stringify({ candidate: portableCandidate(), errors, ids: ["CC03", "CC04", "CC06", "CC07", "CC08", "CC10"] }, null, 2)); await context.close(); }
	});

	test(`${language} CC09 clipboard failure stays explicit and stale failure is cancelled on query change`, async ({ browser }, info) => {
		test.setTimeout(120_000);
		const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 1000 }, locale: language });
		await context.addInitScript(lang => localStorage.setItem("keepany-language", lang), language);
		const page = await context.newPage(), t = text(language);
		try {
			await prepare(page, t);
			// Synthetic clipboard failure preparation. The tested copy/search/lock actions use real UI.
			await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async () => { throw new DOMException("Synthetic clipboard denied", "NotAllowedError"); } }));
			await account(page).getByRole("button", { name: t("pwVaultCopyPassword"), exact: true }).click();
			const manual = page.getByRole("dialog", { name: t("pwVaultManualCopyTitle"), exact: true });
			await expect(manual.locator("textarea")).toHaveValue(mainPassword);
			await screenshot(page, `clipboard-failure-${language}`);
			await manual.getByRole("button", { name: t("close"), exact: true }).click();
			await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: () => new Promise((_resolve, reject) => { (window as Window & { rejectCompactCopy?: () => void }).rejectCompactCopy = () => reject(new DOMException("Synthetic late denial", "NotAllowedError")); }) }));
			await account(page).getByRole("button", { name: t("pwVaultCopyPassword"), exact: true }).click();
			await page.locator("#password-vault-search-input").fill("backup@example.test");
			await page.evaluate(() => (window as Window & { rejectCompactCopy?: () => void }).rejectCompactCopy?.());
			await expect(page.getByRole("dialog", { name: t("pwVaultManualCopyTitle"), exact: true })).toHaveCount(0);
			await expect(account(page).locator("[data-login-username]")).toHaveText("backup@example.test");
			await page.getByRole("button", { name: t("pwVaultLock"), exact: true }).click();
			await expect(page.getByRole("dialog", { name: t("pwVaultManualCopyTitle"), exact: true })).toHaveCount(0);
		} finally { await context.close(); }
	});

	test(`${language} CC05-CC09 query transition never restores a previously revealed password`, async ({ browser }, info) => {
		test.setTimeout(120_000);
		const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 1000 }, locale: language });
		await context.addInitScript(lang => localStorage.setItem("keepany-language", lang), language);
		const page = await context.newPage(), t = text(language);
		try {
			await prepare(page, t);
			await account(page).getByRole("button", { name: t("pwVaultRevealPassword"), exact: true }).click();
			await expect(account(page).locator("[data-login-password]")).toHaveText(mainPassword);
			await page.locator("#password-vault-search-input").fill("backup@example.test");
			await expect(account(page).locator("[data-login-username]")).toHaveText("backup@example.test");
			await page.locator("#password-vault-search-input").fill("");
			await screenshot(page, `query-return-${language}`);
			await expect(account(page).locator("[data-login-password]")).toHaveText("••••••••••");
		} finally { await context.close(); }
	});

	test(`${language} CC01-CC02-CC11 compiled visual geometry and supported widths`, async ({ browser }, info) => {
		test.setTimeout(180_000);
		const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 1000 }, locale: language, permissions: ["clipboard-read", "clipboard-write"] });
		await context.addInitScript(lang => localStorage.setItem("keepany-language", lang), language);
		const page = await context.newPage(), t = text(language), matrix: unknown[] = [];
		try {
			await page.goto("/accounts"); await screenshot(page, `empty-${language}`);
			await prepare(page, t);
			await createAccount(page, t, "CC long title · 账号名称用于核对紧凑卡片与相邻卡片不会互相拉伸的长标题", "long-identifier-for-compact-account@example.test");
			for (const width of [390, 768, 1280, 1920, 2262]) {
				await page.setViewportSize({ width, height: 1000 });
				await expect(account(page)).toBeVisible();
				await account(page, "CC public account").getByRole("button", { name: t("pwVaultCopyUsername"), exact: true }).click();
				await expect(page.locator(".compact-account-feedback-message")).toBeVisible();
				const feedbackOverlap = await page.locator(".compact-account-feedback-message").evaluate(message => {
					const r = message.getBoundingClientRect();
					return [...document.querySelectorAll(".compact-account-card, .password-vault-toolbar button, .asset-category-toolbar")].some(node => { const c = node.getBoundingClientRect(); return r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top; });
				});
				expect(feedbackOverlap).toBe(false);
				await screenshot(page, `matrix-normal-${language}-${width}`);
				const result = await page.locator(".compact-account-card").evaluateAll((cards, width) => ({ width, overflow: document.documentElement.scrollWidth > innerWidth + 1, cards: cards.map(card => ({ height: card.getBoundingClientRect().height, width: card.getBoundingClientRect().width, targets: [...card.querySelectorAll("button,a")].filter(el => el.checkVisibility()).map(el => ({ label: el.getAttribute("aria-label") || el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })) })) }), width);
				matrix.push(result); expect(result.overflow).toBe(false);
				for (const card of result.cards) { expect(card.height).toBeLessThanOrEqual(width === 390 ? 250 : 220); if (width === 390) for (const target of card.targets) expect(target.height).toBeGreaterThanOrEqual(44); }
			}
			await page.setViewportSize({ width: 1280, height: 1000 });
			await page.getByRole("button", { name: t("pwVaultLock"), exact: true }).click();
			for (const width of [390, 768, 1280, 1920, 2262]) { await page.setViewportSize({ width, height: 1000 }); await screenshot(page, `matrix-locked-${language}-${width}`); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
		} finally { writeFileSync(join(evidence, `matrix-${language}.json`), JSON.stringify({ candidate: portableCandidate(), ids: ["CC01", "CC02", "CC11"], matrix }, null, 2)); await context.close(); }
	});
}
