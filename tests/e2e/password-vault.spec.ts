import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { passwordVaultCopy } from "../../apps/web/src/password-vault-copy";
import { inspectArchive } from "../../packages/local-db/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";

test.setTimeout(150_000);
const evidenceRoot =
	process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/keepany-password-vault-source";
mkdirSync(evidenceRoot, { recursive: true });
const master = "Sample master phrase 2026!";
const nextMaster = "Changed sample phrase 2026!";
const backupPassword = "Sample outer backup 2026!";
const accountName = "Studio mailbox";
const entryName = "Studio mail login";
const password2 = "Synthetic edited password 2026!";
const variants = [
	{ locale: "zh-CN", width: 390 },
	{ locale: "zh-CN", width: 1280 },
	{ locale: "en-US", width: 390 },
	{ locale: "en-US", width: 1280 },
] as const;

function copy(locale: string) {
	const index = locale === "zh-CN" ? 0 : 1;
	return (key: string, values: Record<string, string | number> = {}) =>
		(passwordVaultCopy[key]?.[index] ?? key).replace(
			/\{\{(\w+)\}\}/g,
			(all, name: string) => String(values[name] ?? all),
		);
}
async function language(page: Page, locale: string) {
	await page.goto("/");
	await page.evaluate(
		(lng) => localStorage.setItem("keepany-language", lng),
		locale === "zh-CN" ? "zh-CN" : "en",
	);
}
async function createAccount(page: Page, zh: boolean) {
	await page.goto("/assets/account");
	await page
		.getByRole("main")
		.getByRole("button", { name: zh ? "新增" : "Add", exact: true })
		.click();
	const dialog = page.getByRole("dialog");
	await dialog
		.getByLabel(zh ? "名称" : "Name", { exact: true })
		.fill(accountName);
	await dialog
		.getByRole("button", { name: zh ? "保存" : "Save", exact: true })
		.click();
	await expect(dialog).toBeHidden();
	const card = page
		.locator(".asset-account-card")
		.filter({ hasText: accountName });
	await expect(card).toBeVisible();
	return (await card.getAttribute("href")) as string;
}
async function unlock(
	page: Page,
	t: ReturnType<typeof copy>,
	password = master,
) {
	await page.locator("#password-vault-unlock-master").fill(password);
	await page
		.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
		.click();
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
}
async function closeEditor(page: Page) {
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /^(Close|关闭)$/ })
		.click();
	await expect(page.getByRole("dialog")).toBeHidden();
}
async function openWebsite(container: Locator) {
	const addUrl = container.getByRole("button", {
		name: /^(添加网址|Add website URL)$/,
		exact: true,
	});
	if (await addUrl.isVisible()) await addUrl.click();
}
async function readPassword(page: Page, t: ReturnType<typeof copy>) {
	await page
		.locator(".password-vault-entry-list .password-vault-entry")
		.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
		.click();
	const field = page.locator("#password-vault-entry-password");
	await expect(field).toHaveAttribute("type", "password");
	const value = await field.inputValue();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: t("pwVaultShowPassword"), exact: true })
		.click();
	await expect(field).toHaveAttribute("type", "text");
	await closeEditor(page);
	return value;
}

async function expectActionSpacing(actions: Locator) {
	const gaps = await actions.evaluate((element) => {
		const buttons = [...element.querySelectorAll("button")].filter(
			(button) => button.getBoundingClientRect().width > 0,
		);
		return buttons.flatMap((button, index) =>
			buttons.slice(index + 1).map((other) => {
				const a = button.getBoundingClientRect();
				const b = other.getBoundingClientRect();
				const sameRow = Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
				return sameRow
					? Math.max(b.left - a.right, a.left - b.right)
					: Math.max(b.top - a.bottom, a.top - b.bottom);
			}),
		);
	});
	for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(15.5);
	test.info().annotations.push({
		type: "ui-gaps",
		description: JSON.stringify({
			target: await actions.getAttribute("class"),
			gaps,
		}),
	});
}
async function pointerClick(page: Page, button: Locator, horizontal = 0.5) {
	await button.scrollIntoViewIfNeeded();
	const box = await button.boundingBox();
	if (!box) throw Error("Password action has no target");
	expect(box.width).toBeGreaterThanOrEqual(44);
	expect(box.height).toBeGreaterThanOrEqual(44);
	const point = {
		x: box.x + box.width * horizontal,
		y: box.y + box.height / 2,
	};
	await page.mouse.move(point.x, point.y);
	await page.mouse.down();
	try {
		expect(
			await button.evaluate((element, point) => {
				const rect = element.getBoundingClientRect();
				const hit = document.elementFromPoint(point.x, point.y);
				return (
					rect.left <= point.x &&
					point.x < rect.right &&
					rect.top <= point.y &&
					point.y < rect.bottom &&
					(hit === element || (!!hit && element.contains(hit)))
				);
			}, point),
		).toBe(true);
	} finally {
		await page.mouse.up();
	}
	test.info().annotations.push({
		type: "ui-pointer-hit",
		description: JSON.stringify({
			width: box.width,
			height: box.height,
			horizontal,
			hitAfterMouseDown: true,
		}),
	});
}
async function exerciseEye(
	page: Page,
	field: Locator,
	t: ReturnType<typeof copy>,
	secret: string,
) {
	const multiline =
		(await field.evaluate((element) => element.tagName)) === "TEXTAREA";
	for (const [index, horizontal] of [
		0.5, 0.02, 0.98, 0.5, 0.02, 0.98,
	].entries()) {
		await pointerClick(
			page,
			page.getByRole("dialog").getByRole("button", {
				name: t(
					index % 2 === 0 ? "pwVaultShowPassword" : "pwVaultHidePassword",
				),
				exact: true,
			}),
			horizontal,
		);
		if (multiline)
			await expect(field).toHaveValue(index % 2 === 0 ? secret : "••••••••");
		else {
			await expect(field).toHaveAttribute(
				"type",
				index % 2 === 0 ? "text" : "password",
			);
			await expect(field).toHaveValue(secret);
		}
	}
}
async function expectIdentifiers(form: Locator, values: string[]) {
	const inputs = form.locator(".pw-smart-identifier-row input");
	await expect(inputs).toHaveCount(values.length);
	for (const [index, value] of values.entries())
		await expect(inputs.nth(index)).toHaveValue(value);
}
async function expectEditorFieldLayout(dialog: Locator) {
	const fields = await dialog.evaluate((element) =>
		["title", "username", "password", "url"].map((field) => {
			const control = element.querySelector<HTMLInputElement>(
				`#password-vault-entry-${field}`,
			);
			const rectangle = control?.getBoundingClientRect();
			const parent = control?.closest(".field")?.getBoundingClientRect();
			const inputRow = control?.closest(".pw-import-input-control");
			const actions = inputRow
				?.querySelector(".pw-import-field-actions")
				?.getBoundingClientRect();
			const beside = !!rectangle && !!actions && actions.top < rectangle.bottom;
			const gap = inputRow
				? Number.parseFloat(getComputedStyle(inputRow).columnGap)
				: 0;
			return {
				field,
				width: rectangle?.width ?? 0,
				height: rectangle?.height ?? 0,
				availableWidth:
					(parent?.width ?? 0) - (beside ? (actions?.width ?? 0) + gap : 0),
				actionGap: beside
					? (actions?.left ?? 0) - (rectangle?.right ?? 0)
					: (actions?.top ?? 0) - (rectangle?.bottom ?? 0),
				actionsOverflow: (actions?.right ?? 0) - (parent?.right ?? 0),
				top: rectangle?.top ?? 0,
			};
		}),
	);
	for (const field of fields) {
		expect(field.width).toBeGreaterThan(120);
		expect(Math.abs(field.width - field.availableWidth)).toBeLessThanOrEqual(1);
		expect(field.actionGap).toBeGreaterThanOrEqual(8);
		expect(field.actionsOverflow).toBeLessThanOrEqual(1);
		expect(Math.abs(field.height - 52)).toBeLessThanOrEqual(0.5);
	}
	expect(fields[1].top).toBeGreaterThan(fields[0].top);
	expect(fields[2].top).toBeGreaterThan(fields[1].top);
	test.info().annotations.push({
		type: "ui-editor-field-layout",
		description: JSON.stringify(fields),
	});
}
for (const variant of variants) {
	test(`${variant.locale} ${variant.width}px multiple login identifiers and same-platform accounts survive KDBX export and reopen`, async ({
		browser,
	}) => {
		const t = copy(variant.locale);
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
			acceptDownloads: true,
			permissions: ["clipboard-read", "clipboard-write"],
		});
		const page = await context.newPage();
		const errors: string[] = [];
		const consoleErrors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		const title = "Synthetic multi-login platform";
		const primary = "first.platform@example.test";
		const aliases = ["platform-player-21", "+15550000021"];
		const password = "Synthetic first platform password!";
		const secondPrimary = "second.platform@example.test";
		const secondPassword = "Synthetic separate platform password!";
		const url = "https://platform.example.test/login";
		const notes = "Synthetic direct notes without a disclosure";
		const entries = page.locator(
			".password-vault-entry-list .password-vault-entry",
		);
		try {
			await language(page, variant.locale);
			await page.goto("/assets/vault");
			await page.locator("#password-vault-master").fill(master);
			await page.locator("#password-vault-master-confirm").fill(master);
			await page
				.getByRole("button", { name: t("pwVaultCreate"), exact: true })
				.click();
			await expect(page.locator(".password-vault-toolbar")).toBeVisible();
			await page
				.getByRole("button", { name: t("pwVaultNewEntry"), exact: true })
				.click();
			const dialog = page.getByRole("dialog");
			await expect(page.locator("#password-vault-entry-notes")).toBeVisible();
			await expect(
				page.locator(".password-vault-optional summary"),
			).toHaveCount(0);
			await expect(page.locator("#password-vault-entry-url")).toBeHidden();
			await page.locator("#password-vault-entry-title").fill(title);
			await page.locator("#password-vault-entry-username").fill(primary);
			for (const [index, value] of [
				...aliases,
				"remove-this-identifier",
			].entries()) {
				await dialog
					.getByRole("button", { name: t("pwVaultAddIdentifier"), exact: true })
					.click();
				await dialog
					.locator(".pw-smart-identifier-row input")
					.nth(index)
					.fill(value);
			}
			await dialog
				.locator(".pw-smart-identifier-row")
				.nth(2)
				.getByRole("button", {
					name: t("pwVaultRemoveIdentifier", { count: 3 }),
					exact: true,
				})
				.click();
			await expectIdentifiers(dialog, aliases);
			await page.locator("#password-vault-entry-notes").fill(notes);
			await openWebsite(page.locator(".password-vault-optional"));
			await page.locator("#password-vault-entry-url").fill(url);
			const field = page.locator("#password-vault-entry-password");
			await field.fill(password);
			await exerciseEye(page, field, t, password);
			await expectEditorFieldLayout(dialog);
			const generate = dialog.getByRole("button", {
				name: t("pwVaultGeneratePassword"),
				exact: true,
			});
			await expect(generate).toHaveCount(1);
			await expect(dialog.locator(".password-vault-field-actions")).toHaveCount(0);
			await pointerClick(page, generate, 0.98);
			await expect(field).toHaveValue(/^.{24}$/);
			await field.fill(password);
			if (variant.locale === "en-US")
				expect(await dialog.innerText()).not.toMatch(/[\u4e00-\u9fff]/);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth + 1,
				),
			).toBe(true);
			await expect(page.locator(".toast")).toBeHidden({ timeout: 10_000 });
			await dialog.evaluate((element) =>
				element.scrollTo({ top: 0, behavior: "instant" }),
			);
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-identifiers-${variant.locale}-${variant.width}-top.png`,
				),
			});
			await dialog
				.locator(".pw-smart-identifiers")
				.evaluate((element) =>
					element.scrollIntoView({ block: "start", behavior: "instant" }),
				);
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-identifiers-${variant.locale}-${variant.width}-editor.png`,
				),
			});
			await page
				.locator("#password-vault-entry-notes")
				.evaluate((element) =>
					element.scrollIntoView({ block: "center", behavior: "instant" }),
				);
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-identifiers-${variant.locale}-${variant.width}-notes-actions.png`,
				),
			});
			await page
				.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
				.click();
			await expect(dialog).toBeHidden();
			await expect(entries).toHaveCount(1);
			const first = entries.filter({ hasText: primary });
			await expectActionSpacing(first.locator(".password-vault-entry-actions"));
			for (const [index, value] of aliases.entries()) {
				await first
					.locator(`[data-identifier-index="${index + 2}"]`)
					.getByRole("button", {
						name: t("pwVaultCopyIdentifier", { count: index + 2 }),
						exact: true,
					})
					.click();
				expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
					value,
				);
				await page.locator("#password-vault-search-input").fill(value);
				await expect(entries).toHaveCount(1);
				await page.locator("#password-vault-search-input").fill("");
			}
			await page
				.locator("#password-vault-search-input")
				.fill("remove-this-identifier");
			await expect(entries).toHaveCount(0);
			await page.locator("#password-vault-search-input").fill("");
			await first
				.getByRole("button", {
					name: t("pwVaultAddAnotherAccount"),
					exact: true,
				})
				.click();
			await expect(page.locator("#password-vault-entry-title")).toHaveValue(
				title,
			);
			await expect(page.locator("#password-vault-entry-url")).toBeVisible();
			await expect(page.locator("#password-vault-entry-url")).toHaveValue(url);
			await expect(page.locator("#password-vault-entry-username")).toHaveValue(
				"",
			);
			await expectIdentifiers(dialog, []);
			await expect(field).toHaveValue("");
			await expect(page.locator("#password-vault-entry-notes")).toHaveValue("");
			await page.locator("#password-vault-entry-username").fill(secondPrimary);
			const generator = dialog
				.locator(".password-vault-password-input")
				.getByRole("button", {
					name: t("pwVaultGeneratePassword"),
					exact: true,
				});
			await pointerClick(page, generator, 0.02);
			await expect(field).toHaveValue(/^.{24}$/);
			await field.fill(secondPassword);
			await exerciseEye(page, field, t, secondPassword);
			await page
				.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
				.click();
			await expect(dialog).toBeHidden();
			await expect(entries).toHaveCount(2);
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-identifiers-${variant.locale}-${variant.width}-accounts.png`,
				),
				fullPage: true,
			});
			await page.reload();
			await unlock(page, t);
			await expect(entries).toHaveCount(2);
			await first
				.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
				.click();
			await expectIdentifiers(dialog, aliases);
			await expect(field).toHaveValue(password);
			await expect(page.locator("#password-vault-entry-notes")).toHaveValue(
				notes,
			);
			await closeEditor(page);
			await entries
				.filter({ hasText: secondPrimary })
				.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
				.click();
			await expectIdentifiers(dialog, []);
			await expect(field).toHaveValue(secondPassword);
			await expect(page.locator("#password-vault-entry-notes")).toHaveValue("");
			await closeEditor(page);
			const download = page.waitForEvent("download");
			await page
				.getByRole("button", { name: t("pwVaultExport"), exact: true })
				.click();
			const path = test.info().outputPath("multi-login-identifiers.kdbx");
			await (await download).saveAs(path);
			const ciphertext = readFileSync(path);
			for (const secret of [password, secondPassword, ...aliases])
				expect(ciphertext.includes(Buffer.from(secret))).toBe(false);
			const reopened = await browser.newContext({
				locale: variant.locale,
				viewport: { width: variant.width, height: 844 },
			});
			try {
				const restored = await reopened.newPage();
				restored.on("pageerror", (error) => errors.push(error.message));
				restored.on("console", (message) => {
					if (message.type() === "error") consoleErrors.push(message.text());
				});
				await language(restored, variant.locale);
				await restored.goto("/assets/vault");
				await restored
					.getByRole("button", { name: t("pwVaultImportEmpty"), exact: true })
					.click();
				await restored
					.locator("#password-vault-import-file")
					.setInputFiles(path);
				await restored.locator("#password-vault-import-password").fill(master);
				await restored
					.getByRole("button", { name: t("pwVaultImportNow"), exact: true })
					.click();
				await expect(restored.getByRole("dialog")).toBeHidden();
				const restoredEntries = restored.locator(
					".password-vault-entry-list .password-vault-entry",
				);
				await expect(restoredEntries).toHaveCount(2);
				for (const [username, secret, identifiers, expectedNotes] of [
					[primary, password, aliases, notes],
					[secondPrimary, secondPassword, [], ""],
				] as const) {
					await restoredEntries
						.filter({ hasText: username })
						.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
						.click();
					await expect(
						restored.locator("#password-vault-entry-title"),
					).toHaveValue(title);
					await expect(
						restored.locator("#password-vault-entry-url"),
					).toHaveValue(url);
					await expectIdentifiers(restored.getByRole("dialog"), [
						...identifiers,
					]);
					await expect(
						restored.locator("#password-vault-entry-password"),
					).toHaveValue(secret);
					await expect(
						restored.locator("#password-vault-entry-notes"),
					).toHaveValue(expectedNotes);
					await closeEditor(restored);
				}
			} finally {
				await reopened.close();
			}
			expect(errors).toEqual([]);
			expect(consoleErrors).toEqual([]);
			test.info().annotations.push({
				type: "ui-errors",
				description: JSON.stringify({
					pageErrors: errors.length,
					consoleErrors: consoleErrors.length,
					restoredPageIncluded: true,
				}),
			});
			test.info().annotations.push({
				type: "ui-kdbx",
				description: JSON.stringify({
					entriesAfterRefresh: await entries.count(),
					exportedThenReopened: 2,
					aliasesAndDifferentPasswordsMatched: true,
				}),
			});
		} finally {
			await context.close();
		}
	});

	test(`${variant.locale} ${variant.width}px app passwords show notes directly, save without a website and retain added details when edited`, async ({
		browser,
	}) => {
		const t = copy(variant.locale);
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
		});
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const appTitle = "Studio mobile App";
		const appUser = "studio-player-42";
		const appPassword = "Synthetic App password 2026!";
		const optionalUrl = "https://studio.example.test/sign-in";
		const optionalNotes = "Synthetic optional account note";
		try {
			await language(page, variant.locale);
			await page.goto("/assets/vault");
			await page.locator("#password-vault-master").fill(master);
			await page.locator("#password-vault-master-confirm").fill(master);
			await page
				.getByRole("button", { name: t("pwVaultCreate"), exact: true })
				.click();
			await expect(page.locator(".password-vault-toolbar")).toBeVisible();
			await page
				.getByRole("button", { name: t("pwVaultNewEntry"), exact: true })
				.click();
			const details = page.locator(".password-vault-optional");
			await expect(page.locator("#password-vault-entry-url")).toBeHidden();
			await expect(page.locator("#password-vault-entry-notes")).toBeVisible();
			await expect(details.locator("summary")).toHaveCount(0);
			await page.locator("#password-vault-entry-title").fill(appTitle);
			await page.locator("#password-vault-entry-username").fill(appUser);
			await page.locator("#password-vault-entry-password").fill(appPassword);
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-app-${variant.locale}-${variant.width}-new.png`,
				),
				fullPage: true,
			});
			await page
				.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			const entry = page
				.locator(".password-vault-entry-list .password-vault-entry")
				.filter({ has: page.getByRole("heading", { name: appTitle, exact: true }) });
			await expect(entry).toHaveCount(1);
			await entry
				.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
				.click();
			await expect(page.locator("#password-vault-entry-password")).toHaveValue(
				appPassword,
			);
			await expect(page.locator("#password-vault-entry-username")).toHaveValue(
				appUser,
			);
			await expect(page.locator("#password-vault-entry-url")).toBeHidden();
			await openWebsite(details);
			await page.locator("#password-vault-entry-url").fill(optionalUrl);
			await page.locator("#password-vault-entry-notes").fill(optionalNotes);
			await page
				.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await page.reload();
			await unlock(page, t);
			await entry
				.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
				.click();
			await expect(page.locator("#password-vault-entry-url")).toBeVisible();
			await expect(page.locator("#password-vault-entry-url")).toHaveValue(
				optionalUrl,
			);
			await expect(page.locator("#password-vault-entry-notes")).toHaveValue(
				optionalNotes,
			);
			await page
				.locator("#password-vault-entry-password")
				.fill(`${appPassword} revised`);
			await page
				.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await entry
				.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
				.click();
			await expect(page.locator("#password-vault-entry-url")).toHaveValue(
				optionalUrl,
			);
			await expect(page.locator("#password-vault-entry-notes")).toHaveValue(
				optionalNotes,
			);
			await page.locator("#password-vault-entry-url").fill("");
			await page.locator("#password-vault-entry-notes").fill("");
			await page
				.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await page.reload();
			await unlock(page, t);
			await entry
				.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
				.click();
			await expect(page.locator("#password-vault-entry-password")).toHaveValue(
				`${appPassword} revised`,
			);
			await expect(page.locator("#password-vault-entry-notes")).toHaveValue("");
			await expect(page.locator("#password-vault-entry-url")).toBeHidden();
			await expect(
				page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth + 1,
				),
			).resolves.toBe(true);
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-app-${variant.locale}-${variant.width}-restored.png`,
				),
				fullPage: true,
			});
			await closeEditor(page);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});

	test(`${variant.locale} ${variant.width}px passwords persist, lock, rotate and restore with assets`, async ({
		browser,
	}) => {
		const t = copy(variant.locale);
		const zh = variant.locale === "zh-CN";
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
			acceptDownloads: true,
			permissions: ["clipboard-read", "clipboard-write"],
		});
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await language(page, variant.locale);
			const accountHref = await createAccount(page, zh);
			await page.goto(accountHref);
			await page
				.getByRole("link", {
					name: zh ? "管理这个账号的密码" : "Manage this account’s passwords",
				})
				.click();
			await expect(page).toHaveURL(/\/assets\/vault#asset-/);
			await expect(page.locator("#password-vault-master")).toBeVisible();
			await page.screenshot({
				path: join(
					evidenceRoot,
					`${variant.locale}-${variant.width}-create.png`,
				),
				fullPage: true,
			});
			await page.locator("#password-vault-master").fill(master);
			await page.locator("#password-vault-master-confirm").fill(master);
			await page
				.getByRole("button", { name: t("pwVaultCreate"), exact: true })
				.click();
			await expect(page.locator(".password-vault-toolbar")).toBeVisible();
			await page
				.getByRole("button", { name: t("pwVaultNewEntry"), exact: true })
				.click();
			await page.locator("#password-vault-entry-title").fill(entryName);
			await page
				.locator("#password-vault-entry-username")
				.fill("editor@studio.example");
			await openWebsite(page.locator(".password-vault-optional"));
			await page
				.locator("#password-vault-entry-url")
				.fill("https://studio.example/login");
			await expect(page.locator(".password-vault-linked-chip")).toContainText(
				accountName,
			);
			await page
				.getByRole("dialog")
				.getByRole("button", {
					name: t("pwVaultGeneratePassword"),
					exact: true,
				})
				.last()
				.click();
			await expect(page.locator("#password-vault-entry-password")).toHaveValue(
				/^.{24}$/,
			);
			const generated = await page
				.locator("#password-vault-entry-password")
				.inputValue();
			expect(generated).toHaveLength(24);
			expect(generated).toMatch(/[A-Z]/);
			expect(generated).toMatch(/[a-z]/);
			expect(generated).toMatch(/[0-9]/);
			await page
				.getByRole("button", { name: t("pwVaultCopyPassword"), exact: true })
				.click();
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
				generated,
			);
			await page
				.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			const entry = page.locator(
				".password-vault-entry-list .password-vault-entry",
			);
			await expect(entry).toHaveCount(1);
			await expect(entry).toContainText(accountName);
			await entry
				.getByRole("button", { name: t("pwVaultCopyUsername"), exact: true })
				.click();
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
				"editor@studio.example",
			);
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
			await page.screenshot({
				path: join(
					evidenceRoot,
					`${variant.locale}-${variant.width}-entries.png`,
				),
				fullPage: true,
			});
			await entry
				.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
				.click();
			await expect(page.locator("#password-vault-entry-password")).toHaveValue(
				generated,
			);
			await page.locator("#password-vault-entry-password").fill(password2);
			await page
				.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await entry
				.getByRole("button", { name: t("pwVaultHistory"), exact: true })
				.click();
			await page
				.getByRole("button", { name: t("pwVaultHistoryRestore"), exact: true })
				.first()
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			expect(await readPassword(page, t)).toBe(generated);
			await entry
				.getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true })
				.click();
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true }).click();
			await expect(entry).toHaveCount(0);
			await page
				.getByRole("button", { name: t("pwVaultRestoreEntry"), exact: true })
				.click();
			await expect(entry).toHaveCount(1);
			await page
				.getByRole("button", { name: t("pwVaultLock"), exact: true })
				.click();
			await expect(entry).toHaveCount(0);
			await expect(page.locator("#password-vault-entry-password")).toHaveCount(
				0,
			);
			await page.locator("#password-vault-unlock-master").fill("wrong master");
			await page
				.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
				.click();
			await expect(page.locator(".password-vault-message")).toContainText(
				t("pwVaultUnlockFailed"),
			);
			await unlock(page, t);
			await page
				.getByRole("button", { name: t("pwVaultChangeMaster"), exact: true })
				.click();
			await page.locator("#password-vault-current-master").fill(master);
			await page.locator("#password-vault-new-master").fill(nextMaster);
			await page.locator("#password-vault-new-master-confirm").fill(nextMaster);
			await page
				.getByRole("button", { name: t("pwVaultChangeMasterNow"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await page.reload();
			await page.locator("#password-vault-unlock-master").fill(master);
			await page
				.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
				.click();
			await expect(page.locator(".password-vault-message")).toContainText(
				t("pwVaultUnlockFailed"),
			);
			await unlock(page, t, nextMaster);
			expect(await readPassword(page, t)).toBe(generated);
			const kdbxDownload = page.waitForEvent("download");
			await page
				.getByRole("button", { name: t("pwVaultExport"), exact: true })
				.click();
			const kdbx = await kdbxDownload;
			const kdbxPath = test.info().outputPath("passwords.kdbx");
			await kdbx.saveAs(kdbxPath);
			expect(readFileSync(kdbxPath).includes(Buffer.from(generated))).toBe(
				false,
			);
			await page
				.getByRole("button", { name: t("pwVaultImport"), exact: true })
				.click();
			await page.locator("#password-vault-import-file").setInputFiles(kdbxPath);
			await page.locator("#password-vault-import-password").fill(nextMaster);
			await page
				.getByRole("button", { name: t("pwVaultImportNow"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await expect(entry).toHaveCount(1);
			const currentDownloadPromise = page.waitForEvent("download");
			await page
				.getByRole("button", { name: t("pwVaultExport"), exact: true })
				.click();
			const currentDownload = await currentDownloadPromise;
			const currentKdbxPath = test.info().outputPath("current-passwords.kdbx");
			await currentDownload.saveAs(currentKdbxPath);
			await page.goto("/intake");
			await page.locator("#backup-password").fill(backupPassword);
			await page
				.getByRole("button", {
					name: zh ? "创建备份" : "Create backup",
					exact: true,
				})
				.click();
			const backupLink = page.getByRole("link", {
				name: zh ? "保存备份文件" : "Save backup file",
				exact: true,
			});
			await expect(backupLink).toBeVisible();
			const backupDownload = page.waitForEvent("download");
			await backupLink.click();
			const backup = await backupDownload;
			const backupPath = test.info().outputPath("full.ka1");
			await backup.saveAs(backupPath);
			const inspected = await inspectArchive(
				await decryptBackup(
					new Uint8Array(readFileSync(backupPath)),
					backupPassword,
				),
			);
			expect(inspected.passwordVault?.bytes).toEqual(
				new Uint8Array(readFileSync(currentKdbxPath)),
			);
			expect(
				inspected.rows.some(
					(row) =>
						row.payload.includes(generated) ||
						row.payload.includes(password2) ||
						row.payload.includes(master),
				),
			).toBe(false);
			const restored = await browser.newContext({
				locale: variant.locale,
				viewport: { width: variant.width, height: 844 },
			});
			try {
				const restorePage = await restored.newPage();
				await language(restorePage, variant.locale);
				await restorePage.goto("/assets/vault");
				await expect(
					restorePage.locator("#password-vault-master"),
				).toBeVisible();
				// Keep the initialized empty session alive through the SPA restore route.
				await restorePage
					.getByRole("link", {
						name: zh ? "收录与备份" : "Import & backup",
						exact: true,
					})
					.last()
					.click();
				await restorePage.locator("#backup-password").fill(backupPassword);
				await restorePage
					.locator("summary")
					.filter({ hasText: zh ? "恢复备份" : "Restore backup" })
					.click();
				await restorePage.locator("#restore-file").setInputFiles(backupPath);
				await restorePage
					.getByRole("button", { name: zh ? "预览" : "Preview", exact: true })
					.click();
				await expect(
					restorePage.getByText(
						zh
							? "包含加密密码库。恢复后仍需原密码库主密码解锁。"
							: "Includes an encrypted password vault. Its original master password is still needed after restoring.",
					),
				).toBeVisible();
				await restorePage
					.getByRole("button", { name: zh ? /^确认 ·/ : /^Confirm ·/ })
					.click();
				await expect(
					restorePage
						.getByRole("status")
						.filter({ hasText: zh ? "已恢复" : "Restored" }),
				).toBeVisible();
				if (variant.width === 390)
					await restorePage.locator(".mobile-menu").click();
				await restorePage
					.getByRole("link", {
						name: zh ? "密码库" : "Password vault",
						exact: true,
					})
					.first()
					.click();
				await unlock(restorePage, t, nextMaster);
				await expect(
					restorePage.locator(
						".password-vault-entry-list .password-vault-entry",
					),
				).toContainText(accountName);
				expect(await readPassword(restorePage, t)).toBe(generated);
				await restorePage.screenshot({
					path: join(
						evidenceRoot,
						`${variant.locale}-${variant.width}-restored.png`,
					),
					fullPage: true,
				});
				await expect(
					restorePage.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth + 1,
					),
				).resolves.toBe(true);
				if (
					process.env.KEEPANY_PRODUCTION_OFFLINE === "1" &&
					variant.locale === "en-US" &&
					variant.width === 1280
				) {
					await restorePage.evaluate(() => navigator.serviceWorker.ready);
					await restored.setOffline(true);
					await restorePage.reload();
					await unlock(restorePage, t, nextMaster);
					expect(await readPassword(restorePage, t)).toBe(generated);
					await restored.setOffline(false);
				}
			} finally {
				await restored.close();
			}
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
}

test("password changes lock a revealed editor in another tab; idle lock and clean KDBX import work", async ({
	browser,
}) => {
	const t = copy("en-US");
	const context = await browser.newContext({
		locale: "en-US",
		acceptDownloads: true,
	});
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
		await first
			.getByRole("button", { name: t("pwVaultCreate"), exact: true })
			.click();
		await expect(first.locator(".password-vault-toolbar")).toBeVisible();
		await expect(second.locator("#password-vault-unlock-master")).toBeVisible();
		await first
			.getByRole("button", { name: t("pwVaultNewEntry"), exact: true })
			.click();
		await first.locator("#password-vault-entry-title").fill(entryName);
		await first.locator("#password-vault-entry-password").fill(password2);
		await first
			.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
			.click();
		await expect(first.getByRole("dialog")).toBeHidden();
		await unlock(second, t);
		await second
			.locator(".password-vault-entry-list .password-vault-entry")
			.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
			.click();
		await second
			.getByRole("button", { name: t("pwVaultShowPassword"), exact: true })
			.click();
		await expect(second.locator("#password-vault-entry-password")).toHaveValue(
			password2,
		);
		await first
			.locator(".password-vault-entry-list .password-vault-entry")
			.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
			.click();
		await first
			.locator("#password-vault-entry-password")
			.fill("Synthetic third revision!");
		await first
			.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
			.click();
		await expect(first.getByRole("dialog")).toBeHidden();
		await expect(second.getByRole("dialog")).toBeHidden();
		await expect(second.locator("#password-vault-entry-password")).toHaveCount(
			0,
		);
		await expect(second.locator("#password-vault-unlock-master")).toBeVisible();
		await unlock(second, t);
		expect(await readPassword(second, t)).toBe("Synthetic third revision!");
		const downloadPromise = first.waitForEvent("download");
		await first
			.getByRole("button", { name: t("pwVaultExport"), exact: true })
			.click();
		const download = await downloadPromise;
		const path = test.info().outputPath("independent-import.kdbx");
		await download.saveAs(path);
		await first.clock.fastForward(5 * 60 * 1000 + 15_000);
		await expect(first.locator("#password-vault-unlock-master")).toBeVisible();
		await expect(
			first.locator(".password-vault-entry-list .password-vault-entry"),
		).toHaveCount(0);
		const empty = await browser.newContext({ locale: "en-US" });
		try {
			const page = await empty.newPage();
			await language(page, "en-US");
			await page.goto("/assets/vault");
			await page
				.getByRole("button", { name: t("pwVaultImportEmpty"), exact: true })
				.click();
			await page.locator("#password-vault-import-file").setInputFiles(path);
			await page.locator("#password-vault-import-password").fill(master);
			await page
				.getByRole("button", { name: t("pwVaultImportNow"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			expect(await readPassword(page, t)).toBe("Synthetic third revision!");
			await page.reload();
			await unlock(page, t);
			expect(await readPassword(page, t)).toBe("Synthetic third revision!");
		} finally {
			await empty.close();
		}
	} finally {
		await context.close();
	}
});

for (const variant of variants) {
	test(`${variant.locale} ${variant.width}px manual passwordless entries survive editing, reload and KDBX reimport`, async ({ browser }) => {
		const t = copy(variant.locale);
		const context = await browser.newContext({ locale: variant.locale, viewport: { width: variant.width, height: 1000 }, acceptDownloads: true });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		const title = "Synthetic third-party login";
		const user = "passwordless@example.test";
		try {
			await language(page, variant.locale);
			await page.goto("/assets/vault");
			await page.locator("#password-vault-master").fill(master);
			await page.locator("#password-vault-master-confirm").fill(master);
			await page.getByRole("button", { name: t("pwVaultCreate"), exact: true }).click();
			await page.getByRole("button", { name: t("pwVaultNewEntry"), exact: true }).click();
			await page.locator("#password-vault-entry-title").fill(title);
			await page.locator("#password-vault-entry-username").fill(user);
			const field = page.getByLabel(t("pwVaultPasswordOptionalField"), { exact: true });
			await expect(field).toHaveValue("");
			await expect(field).not.toHaveAttribute("required", "");
			await page.getByRole("button", { name: t("pwVaultAddIdentifier"), exact: true }).click();
			await page.locator(".pw-smart-identifier-row input").fill("+15550000999");
			await page.screenshot({ path: join(evidenceRoot, `passwordless-${variant.locale}-${variant.width}-new.png`), fullPage: true });
			await page.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			const entries = page.locator(".password-vault-entry-list .password-vault-entry");
			const first = entries.filter({ has: page.getByText(user, { exact: true }) });
			await expect(first).toContainText(t("pwVaultNoPassword"));
			await expect(first).toContainText("+15550000999");
			// Editing can leave the password empty, and can clear an existing multiline password.
			await first.getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
			await page.locator("#password-vault-entry-notes").fill("Third-party sign-in");
			await page.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await first.getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
			// Paste a multiline synthetic secret through the existing clipboard action.
			await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText: async () => "Synthetic line one\nSynthetic line two" } }));
			await page.locator(".password-vault-secret-field").getByRole("button", { name: /粘贴|Paste/ }).click();
			await page.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await first.getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
			await expect(page.locator("textarea#password-vault-entry-password")).toBeVisible();
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultShowPassword"), exact: true }).click();
			await field.fill("");
			await page.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await first.getByRole("button", { name: t("pwVaultAddAnotherAccount"), exact: true }).click();
			await page.locator("#password-vault-entry-username").fill("second-passwordless@example.test");
			await expect(field).toHaveValue("");
			await page.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await expect(entries).toHaveCount(2);
			await page.reload();
			await unlock(page, t);
			await expect(entries).toHaveCount(2);
			for (const entry of await entries.all()) await expect(entry).toContainText(t("pwVaultNoPassword"));
			await page.screenshot({ path: join(evidenceRoot, `passwordless-${variant.locale}-${variant.width}-saved.png`), fullPage: true });
			const download = page.waitForEvent("download");
			await page.getByRole("button", { name: t("pwVaultExport"), exact: true }).click();
			const path = test.info().outputPath("passwordless.kdbx");
			await (await download).saveAs(path);
			const restoredContext = await browser.newContext({ locale: variant.locale });
			try {
				const restored = await restoredContext.newPage();
				await language(restored, variant.locale);
				await restored.goto("/assets/vault");
				await restored.getByRole("button", { name: t("pwVaultImportEmpty"), exact: true }).click();
				await restored.locator("#password-vault-import-file").setInputFiles(path);
				await restored.locator("#password-vault-import-password").fill(master);
				await restored.getByRole("button", { name: t("pwVaultImportNow"), exact: true }).click();
				await expect(restored.getByRole("dialog")).toBeHidden();
				const saved = restored.locator(".password-vault-entry-list .password-vault-entry");
				await expect(saved).toHaveCount(2);
				for (const entry of await saved.all()) {
					await entry.getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
					await expect(restored.locator("#password-vault-entry-password")).toHaveValue("");
					await closeEditor(restored);
				}
				await expect(saved.filter({ has: restored.getByText(user, { exact: true }) })).toContainText("+15550000999");
				await expect(saved.filter({ has: restored.getByText(user, { exact: true }) })).toContainText("Third-party sign-in");
			} finally { await restoredContext.close(); }
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
