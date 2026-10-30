import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { openVaultAccess } from "./helpers/vault-access";
import { closeCompactLoginDetails, openCompactLoginDetails } from "./helpers/compact-account";

const evidence = resolve(process.env.KEEPANY_SINGLE_ENTRY_EVIDENCE ?? "test-results/qa/2026-10-29/accounts-single-entry/independent-final");
mkdirSync(evidence, { recursive: true });
const master = "SyntheticIndependentMaster2026!";
const secret = "SyntheticIndependentSecret2026!";
const privateNotes = "Synthetic confidential vault note";
const ordinaryNotes = "Synthetic ordinary account note";
const copy = (lang: "zh-CN" | "en") => (key: string) => (resources[lang].translation as Record<string, string>)[key] ?? key;

async function save(dialog: Locator) {
	await dialog.getByRole("button", { name: /^(保存|Save|保存条目|Save entry)$/ }).click();
	await expect(dialog).toBeHidden();
}

async function openMore(dialog: Locator) {
	for (const detail of await dialog.locator("details").all()) {
		if (!await detail.evaluate(node => (node as HTMLDetailsElement).open)) await detail.locator(":scope > summary").click();
	}
}

async function choose(page: Page, locator: Locator, label: string) {
	await locator.click();
	await page.getByRole("option", { name: label, exact: true }).click();
}

async function newAccount(page: Page, t: (key: string) => string) {
	const globalAdd = page.locator(".password-vault-header").getByRole("button", { name: t("add"), exact: true });
	await expect(globalAdd).toHaveCount(1);
	await expect(globalAdd).toBeVisible();
	const target = await globalAdd.boundingBox();
	expect(target).not.toBeNull();
	expect(target!.width).toBeGreaterThanOrEqual(44);
	expect(target!.height).toBeGreaterThanOrEqual(44);
	await expect(page.locator(".password-vault-toolbar .password-vault-new")).toHaveCount(0);
	await expect(page.locator(".password-vault-trash-open")).toHaveCount(0);
	await globalAdd.click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.locator("#password-vault-entry-title")).toBeVisible();
	return dialog;
}

async function createVault(page: Page, t: (key: string) => string) {
	await openVaultAccess(page);
	await page.locator("#password-vault-master").fill(master);
	await page.locator("#password-vault-master-confirm").fill(master);
	await page.getByRole("button", { name: t("pwVaultCreate"), exact: true }).click();
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
}

async function unlock(page: Page, t: (key: string) => string) {
	await openVaultAccess(page);
	await page.locator("#password-vault-unlock-master").fill(master);
	await page.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
}

async function failNextKdbxWrite(page: Page) {
	// Isolated fictional fault preparation only: fail one real passwordVault
	// IndexedDB put, then restore the native method. No application API or data
	// injection is used; subsequent save/purge/retry actions use the actual UI.
	await page.evaluate(() => {
		const original = IDBObjectStore.prototype.put;
		const state = { attempts: 0 };
		(window as Window & { singleEntryWriteFault?: { attempts: number } }).singleEntryWriteFault = state;
		IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
			if (this.name === "passwordVault") {
				state.attempts++;
				IDBObjectStore.prototype.put = original;
				throw new DOMException("Synthetic one-write KDBX fault", "QuotaExceededError");
			}
			return key === undefined ? original.call(this, value) : original.call(this, value, key);
		};
	});
}

async function expectOneInjectedWriteFailure(page: Page) {
	expect(await page.evaluate(() => (window as Window & { singleEntryWriteFault?: { attempts: number } }).singleEntryWriteFault?.attempts)).toBe(1);
}

async function noOverflow(page: Page, dialog?: Locator) {
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
	if (dialog) expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
}

async function snapshot(page: Page, name: string) {
	if (name.startsWith("matrix-empty-") || name.startsWith("matrix-account-compact-")) {
		// Resizing across the mobile breakpoint starts the real sidebar CSS
		// transition. Record the intended final viewport state, not an in-flight
		// frame that still covers part of the account list.
		if (page.viewportSize()!.width < 768) await expect.poll(() => page.locator(".sidebar").evaluate(node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
		else await expect.poll(() => page.locator(".sidebar").evaluate(node => node.getBoundingClientRect().left)).toBeGreaterThanOrEqual(0);
	}
	await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
}

for (const language of ["zh-CN", "en"] as const) {
	test(`${language} SE01-SE07 unified account creation, original fields, durable KDBX link and bottom trash`, async ({ browser }, info) => {
		const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 1000 }, locale: language, permissions: ["clipboard-read", "clipboard-write"] });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), language);
		const page = await context.newPage(), t = copy(language), errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		try {
			await page.goto("/");
			await page.locator(".sidebar nav").getByRole("link", { name: t("accountsWorkspace"), exact: true }).click();
			await expect(page).toHaveURL(/\/accounts$/);
			// Empty password is a real account without requiring the user to establish a vault first.
			let dialog = await newAccount(page, t);
			await dialog.locator("#password-vault-entry-title").fill("Synthetic minimal passwordless account");
			await save(dialog);
			await expect(page.locator(".asset-account-card")).toHaveCount(1);
			await page.reload();
			await expect(page.locator(".asset-account-card")).toContainText("Synthetic minimal passwordless account");
			dialog = await newAccount(page, t);
			await dialog.locator("#password-vault-entry-title").fill("Synthetic cancelled account");
			await dialog.getByRole("button", { name: t("cancel"), exact: true }).click();
			await expect(page.locator(".asset-account-card")).toHaveCount(1);
			await expect(page.locator(".asset-account-card")).not.toContainText("Synthetic cancelled account");
			await createVault(page, t);
			dialog = await newAccount(page, t);
			await openMore(dialog);
			await dialog.locator("#password-vault-entry-title").fill("Synthetic complete account");
			await dialog.locator("#password-vault-entry-username").fill("complete@example.test");
			await dialog.locator("#password-vault-entry-password").fill(secret);
			await dialog.locator("#password-vault-entry-url").fill("https://complete.example.test/login");
			await dialog.locator("#password-vault-entry-notes").fill(privateNotes);
			await dialog.getByLabel(t("accountProvider"), { exact: true }).fill("Synthetic provider");
			await dialog.getByLabel(t("contact"), { exact: true }).fill("Synthetic contact");
			await dialog.getByLabel(t("accountPurpose"), { exact: true }).fill("Synthetic project access");
			await dialog.getByLabel(t("tags"), { exact: true }).fill("synthetic, work");
			await dialog.locator("#account-entry-notes").fill(ordinaryNotes);
			await dialog.getByLabel(t("accountProfileVerifiedAt"), { exact: true }).fill("2026-10-29");
			await page.keyboard.press("Tab");
			await choose(page, dialog.getByLabel(t("category"), { exact: true }), t("social"));
			await choose(page, dialog.getByLabel(t("status"), { exact: true }), t("paused"));
			await dialog.getByRole("button", { name: t("pwVaultAddIdentifier"), exact: true }).click();
			await dialog.locator(".pw-smart-identifier-row input").last().fill("alias@example.test");
			await snapshot(page, `journey-complete-form-${language}`);
			await save(dialog);
			await expect(page.locator(".asset-account-card")).toHaveCount(2);
			const account = page.locator(".unified-account").filter({ hasText: "Synthetic complete account" });
			await openCompactLoginDetails(page, account, t);
			const entry = page.getByRole("dialog", { name: t("compactAccountLoginDetails"), exact: true }).locator(".password-vault-entry");
			await expect(entry).toHaveCount(1);
			await expect(entry).toContainText("alias@example.test");
			await entry.getByRole("button", { name: t("pwVaultRevealPassword"), exact: true }).click();
			await expect(entry.locator(".password-vault-secret")).toHaveText(secret);
			await entry.getByRole("button", { name: t("pwVaultHidePasswordValue"), exact: true }).click();
			await entry.getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
			await expect(page.locator("#password-vault-entry-notes")).toHaveValue(privateNotes);
			await page.getByRole("dialog").last().getByRole("button", { name: t("close"), exact: true }).click();
			await closeCompactLoginDetails(page, t);
			await account.locator(".compact-account-title").click();
			await expect(page.locator(".account-facts-card").first()).toContainText("Synthetic provider");
			await expect(page.locator(".account-facts-card").first()).toContainText("Synthetic project access");
			await page.locator(".page-header").getByRole("button", { name: t("edit"), exact: true }).click();
			dialog = page.getByRole("dialog");
			for (const [id, value] of Object.entries({ name: "Synthetic complete account", accountProvider: "Synthetic provider", username: "complete@example.test", contact: "Synthetic contact", description: "Synthetic project access", accountProfileVerifiedAt: "2026-10-29", notes: ordinaryNotes })) await expect(dialog.locator(`#${id}`)).toHaveValue(value);
			await expect(dialog.locator("#tags")).toHaveValue("synthetic, work");
			await expect(dialog.locator("#status")).toHaveText(t("paused"));
			await expect(dialog).not.toContainText(privateNotes);
			await dialog.getByRole("button", { name: t("cancel"), exact: true }).click();
			await page.locator(".sidebar nav").getByRole("link", { name: t("accountsWorkspace"), exact: true }).click();
			await page.reload(); await unlock(page, t);
			await openCompactLoginDetails(page, account, t);
			await expect(entry).toContainText("complete@example.test");
			await entry.getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true }).click();
			await page.getByRole("dialog", { name: t("pwVaultDeleteEntry"), exact: true }).getByRole("button", { name: t("cancel"), exact: true }).click();
			await expect(entry).toHaveCount(1);
			await entry.getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true }).click();
			await page.getByRole("dialog", { name: t("pwVaultDeleteEntry"), exact: true }).getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true }).click();
			await expect(entry).toHaveCount(0);
			const trash = page.locator("#vault-trash");
			await trash.scrollIntoViewIfNeeded();
			await expect(trash).toContainText("Synthetic complete account");
			await trash.getByRole("button", { name: t("deletePermanently"), exact: true }).click();
			await page.getByRole("dialog").getByRole("button", { name: t("cancel"), exact: true }).click();
			await expect(trash.locator(".password-vault-entry-trash")).toHaveCount(1);
			await snapshot(page, `journey-bottom-trash-${language}`);
			// SE15: a purge write failure is an operation error, not a malformed import.
			await failNextKdbxWrite(page);
			await trash.getByRole("button", { name: t("deletePermanently"), exact: true }).click();
			const purge = page.getByRole("dialog");
			await purge.getByRole("button", { name: t("deletePermanently"), exact: true }).click();
			await expect(purge.getByRole("alert")).toHaveText(t("pwVaultError"));
			await expect(purge).not.toContainText(t("pwVaultInvalidBackup"));
			await expectOneInjectedWriteFailure(page);
			await expect(trash.locator(".password-vault-entry-trash")).toHaveCount(1);
			await snapshot(page, `purge-error-${language}`);
			await purge.getByRole("button", { name: t("cancel"), exact: true }).click();
			await trash.getByRole("button", { name: t("pwVaultRestoreEntry"), exact: true }).click();
			await expect(page.getByRole("dialog", { name: t("compactAccountLoginDetails"), exact: true })).toHaveCount(0);
			await openCompactLoginDetails(page, account, t);
			await expect(entry).toHaveCount(1);
			await expect(trash.locator(".password-vault-entry-trash")).toHaveCount(0);
			await page.reload(); await unlock(page, t);
			await openCompactLoginDetails(page, account, t);
			await expect(entry).toHaveCount(1);
			await page.goto("/assets/vault#vault-trash");
			await unlock(page, t);
			await expect(page.locator("#vault-trash")).toBeInViewport();
			await noOverflow(page);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});

	test(`${language} SE02 same-form create and unlock errors preserve ordinary draft`, async ({ browser }, info) => {
		const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 390, height: 1000 }, locale: language });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), language);
		const page = await context.newPage(), t = copy(language);
		try {
			await page.goto("/accounts");
			let dialog = await newAccount(page, t);
			await dialog.locator("#password-vault-entry-title").fill("Synthetic retained draft");
			await dialog.locator("#password-vault-entry-username").fill("retained@example.test");
			await openMore(dialog);
			await dialog.locator("#account-entry-notes").fill("Synthetic ordinary account details remain after an access error. ".repeat(24));
			await dialog.locator("#account-entry-master").fill(master);
			await dialog.locator("#account-entry-master-confirm").fill(`${master}wrong`);
			await dialog.getByRole("button", { name: t("pwVaultCreate"), exact: true }).click();
			const error = dialog.getByRole("alert");
			await expect(error).toBeVisible();
			// SE13: DOM visibility does not prove that sticky actions do not cover
			// feedback after the longer, expanded account form has scrolled.
			const feedback = await error.evaluate(node => {
				const box = node.getBoundingClientRect();
				const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
				return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: innerWidth, height: innerHeight, exposed: !!hit && (hit === node || node.contains(hit)) };
			});
			expect(feedback.top).toBeGreaterThanOrEqual(0);
			expect(feedback.bottom).toBeLessThanOrEqual(feedback.height);
			expect(feedback.left).toBeGreaterThanOrEqual(0);
			expect(feedback.right).toBeLessThanOrEqual(feedback.width);
			expect(feedback.exposed).toBe(true);
			await expect(dialog.locator("#password-vault-entry-title")).toHaveValue("Synthetic retained draft");
			await expect(page.locator(".asset-account-card")).toHaveCount(0);
			await snapshot(page, `same-form-create-error-${language}`);
			await dialog.locator("#account-entry-master-confirm").fill(master);
			await dialog.getByRole("button", { name: t("pwVaultCreate"), exact: true }).click();
			await expect(dialog.locator("#password-vault-entry-password")).toBeVisible();
			await expect(dialog.locator("#password-vault-entry-title")).toHaveValue("Synthetic retained draft");
			await dialog.locator("#password-vault-entry-password").fill(secret);
			await failNextKdbxWrite(page);
			await dialog.getByRole("button", { name: t("save"), exact: true }).click();
			await expect(dialog.getByRole("alert")).toHaveText(t("accountEntryPartial"));
			await expectOneInjectedWriteFailure(page);
			await expect(page.locator(".asset-account-card")).toHaveCount(1);
			await expect(page.locator(".compact-account-card[data-entry-id], .workspace-password-only .password-vault-entry")).toHaveCount(0);
			await expect(dialog.locator("#password-vault-entry-password")).toHaveValue(secret);
			await snapshot(page, `same-form-save-partial-${language}`);
			// Editing a private draft must keep the partial-success recovery notice.
			await dialog.locator("#password-vault-entry-notes").fill("Synthetic retained note after partial save");
			await expect(dialog.getByRole("alert")).toHaveText(t("accountEntryPartial"));
			await dialog.getByRole("button", { name: t("save"), exact: true }).dblclick();
			await expect(dialog).toBeHidden();
			await expect(page.locator(".asset-account-card")).toHaveCount(1);
			await expect(page.locator(".compact-account-card[data-entry-id], .workspace-password-only .password-vault-entry")).toHaveCount(1);
			await page.locator(".password-vault-toolbar").getByRole("button", { name: t("pwVaultLock"), exact: true }).click();
			dialog = await newAccount(page, t);
			await dialog.locator("#password-vault-entry-title").fill("Synthetic unlock retained draft");
			await dialog.locator("#account-entry-master").fill("Incorrect synthetic master");
			await dialog.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
			await expect(dialog.getByRole("alert")).toBeVisible();
			await expect(dialog.locator("#password-vault-entry-title")).toHaveValue("Synthetic unlock retained draft");
			await expect(dialog.locator("#password-vault-entry-password")).toHaveCount(0);
			await dialog.locator("#account-entry-master").fill(master);
			await dialog.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
			await expect(dialog.locator("#password-vault-entry-password")).toBeVisible();
			await expect(dialog.locator("#password-vault-entry-title")).toHaveValue("Synthetic unlock retained draft");
			await dialog.getByRole("button", { name: t("cancel"), exact: true }).click();
			await expect(page.locator(".asset-account-card")).toHaveCount(1);
			await page.reload(); await unlock(page, t);
			await expect(page.locator(".asset-account-card")).toHaveCount(1);
			await expect(page.locator(".compact-account-card[data-entry-id], .workspace-password-only .password-vault-entry")).toHaveCount(1);
			await noOverflow(page);
			// SE16: native date validation runs before onSubmit. A corrected URL
			// must not leave an unrelated server/schema error beneath that feedback.
			dialog = await newAccount(page, t);
			await dialog.locator("#password-vault-entry-title").fill("Synthetic sequential validation recovery");
			await dialog.locator("#password-vault-entry-url").fill("ftp://example.test/synthetic");
			await dialog.getByRole("button", { name: t("save"), exact: true }).click();
			await expect(dialog.getByRole("alert")).toContainText(t("url"));
			await dialog.locator("#password-vault-entry-url").fill("https://example.test/ok");
			await expect(dialog.getByRole("alert")).toHaveCount(0);
			await openMore(dialog);
			await dialog.locator("#account-entry-reviewed").fill("2026-02-30");
			await dialog.getByRole("button", { name: t("save"), exact: true }).click();
			expect(await dialog.locator("#account-entry-reviewed").evaluate(node => (node as HTMLInputElement).validity.valid)).toBe(false);
			await expect(dialog.getByRole("alert")).toContainText(t("invalidDate"));
			await expect(dialog.locator("#account-entry-reviewed")).toBeInViewport({ ratio: 1 });
			const invalidField = await dialog.locator("#account-entry-reviewed").boundingBox();
			const actions = await dialog.locator(".password-vault-editor-actions").boundingBox();
			expect(invalidField!.y + invalidField!.height).toBeLessThanOrEqual(actions!.y);
			await expect(page.locator(".asset-account-card")).toHaveCount(1);
			await snapshot(page, `sequential-validation-error-${language}`);
			await dialog.locator("#account-entry-reviewed").fill("2026-10-29");
			await save(dialog);
			await expect(page.locator(".asset-account-card")).toHaveCount(2);
			await page.reload(); await unlock(page, t);
			await expect(page.locator(".asset-account-card")).toHaveCount(2);
			await expect(page.locator(".compact-account-card[data-entry-id], .workspace-password-only .password-vault-entry")).toHaveCount(2);
		} finally { await context.close(); }
	});

	test(`${language} SE08 empty, merged form, long invalid draft and compact account at six widths`, async ({ browser }, info) => {
		const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 1050 }, locale: language });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), language);
		const page = await context.newPage(), t = copy(language), dimensions: unknown[] = [];
		const longTitle = `Synthetic long account ${"工作账号 Long title ".repeat(6)}`;
		try {
			await page.goto("/accounts");
			// A zero card count also occurs while the lazy workspace is loading.
			// Wait for the actual empty account list and vault access form before
			// recording any empty-state screenshot.
			await expect(page.locator(".unified-account-list .empty")).toBeVisible();
			await expect(page.locator("#password-vault-master")).toBeVisible();
			for (const width of [390, 768, 1268, 1280, 1920, 2560]) {
				await page.setViewportSize({ width, height: 1050 });
				await expect(page.locator(".asset-account-card")).toHaveCount(0);
				await noOverflow(page);
				await snapshot(page, `matrix-empty-${language}-${width}`);
			}
			await createVault(page, t);
			for (const title of [longTitle, "Synthetic neighboring account"]) {
				const dialog = await newAccount(page, t);
				await dialog.locator("#password-vault-entry-title").fill(title);
				await dialog.locator("#password-vault-entry-username").fill(`long.${"login-".repeat(12)}@example.test`);
				await dialog.locator("#password-vault-entry-password").fill(secret);
				await dialog.locator("#password-vault-entry-url").fill(`https://example.test/${"long-path/".repeat(50)}`);
				await dialog.locator("#password-vault-entry-notes").fill(`Synthetic private long note ${"文字 notes ".repeat(70)}`);
				await save(dialog);
			}
			const account = page.locator(".unified-account").filter({ hasText: longTitle });
			const neighbor = page.locator(".unified-account").filter({ hasText: "Synthetic neighboring account" });
			for (const width of [390, 768, 1268, 1280, 1920, 2560]) {
				await page.setViewportSize({ width, height: 1050 });
				await noOverflow(page);
				await snapshot(page, `matrix-account-compact-${language}-${width}`);
				const measure = (node: SVGElement | HTMLElement) => {
					const box = node.getBoundingClientRect();
					return { top: box.top, left: box.left, width: box.width, height: box.height };
				};
				const expanded = await account.evaluate(measure), compact = await neighbor.evaluate(measure);
				const geometry = { expanded, compact };
				// The approved compact contract replaces inline expansion: both cards
				// remain compact even with long notes; full details open separately.
				expect(expanded.height).toBeLessThanOrEqual(width === 390 ? 250 : 220);
				if (Math.abs(expanded.top - compact.top) < 2) expect(Math.abs(compact.height - expanded.height)).toBeLessThanOrEqual(2);
				dimensions.push({ width, language, geometry });
				await openCompactLoginDetails(page, account, t);
				await noOverflow(page, page.getByRole("dialog", { name: t("compactAccountLoginDetails"), exact: true }));
				// Preserve the gate's historical filename for the user-opened
				// account details state; details now live in their own dialog.
				await snapshot(page, `matrix-account-expanded-${language}-${width}`);
				await closeCompactLoginDetails(page, t);
				let dialog = await newAccount(page, t);
				await dialog.locator("#password-vault-entry-title").fill("Synthetic compact editor");
				await dialog.locator("#password-vault-entry-title").focus();
				await noOverflow(page, dialog);
				await snapshot(page, `matrix-editor-default-${language}-${width}`);
				await openMore(dialog);
				await dialog.locator("#password-vault-entry-title").fill(longTitle);
				await dialog.locator("#password-vault-entry-url").fill(`https://example.test/${"long-path/".repeat(80)}`);
				await dialog.locator("#account-entry-notes").fill(`Synthetic ordinary long note ${"文字 details ".repeat(70)}`);
				await dialog.getByLabel(t("accountPurpose"), { exact: true }).fill("Synthetic purpose ".repeat(30));
				await dialog.getByLabel(t("tags"), { exact: true }).fill("x".repeat(61));
				await dialog.getByRole("button", { name: t("save"), exact: true }).click();
				await expect(dialog.getByRole("alert")).toBeVisible();
				await expect(page.locator(".asset-account-card")).toHaveCount(2);
				await noOverflow(page, dialog);
				await snapshot(page, `matrix-editor-expanded-error-${language}-${width}`);
				await dialog.getByLabel(t("category"), { exact: true }).scrollIntoViewIfNeeded();
				await dialog.getByLabel(t("category"), { exact: true }).click();
				await expect(page.getByRole("listbox")).toBeVisible();
				await snapshot(page, `matrix-category-open-${language}-${width}`);
				await page.keyboard.press("Escape");
				await dialog.getByRole("button", { name: t("cancel"), exact: true }).click();
				await expect(dialog).toBeHidden();
				await expect(page.locator(".asset-account-card")).toHaveCount(2);
				await expect(neighbor).toBeAttached();
			}
			writeFileSync(join(evidence, `matrix-dimensions-${language}.json`), JSON.stringify(dimensions, null, 2));
		} finally { await context.close(); }
	});
}
