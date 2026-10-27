import { readFileSync } from "node:fs";
import {
	type Browser,
	type BrowserContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import type { Asset, Relation } from "../../packages/domain/src";
import { inspectArchive, type RecordRow } from "../../packages/local-db/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { setAccountRelationDetailsOpen, waitForAccountGraphLayout } from "./helpers/account-graph";
import { selectChoice } from "./helpers/select-choice";

const password = "vault-reference-release-backup";
const accountName = "Synthetic vault account";
const vaultName = "Synthetic vault reference";
const storageLocation = "Bitwarden personal vault";
const verifiedAt = "2026-09-20";

const copyFor = (zh: boolean) =>
	zh
		? {
				add: "新增",
				name: "名称",
				save: "保存",
				language: "语言",
				languageValue: "zh-CN",
				heroTitle: "密码库",
				note: "下方保留外部密码库的引用与关联；实际密码请存入上方的加密密码库。",
				linkEntry: "关联密码库条目",
				entryName: "条目名称",
				storedIn: "保管位置",
				usedFor: "用于",
				verified: "核实时间",
				linked: "已关联",
				vaultLabel: "密码库",
				managePasswords: "管理这个账号的密码",
				backup: "创建备份",
				download: "保存备份文件",
				preview: "预览",
				confirm: /^确认 ·/,
				restored: /已恢复 \d+ 条记录/,
			}
		: {
				add: "Add",
				name: "Name",
				save: "Save",
				language: "Language",
				languageValue: "en",
				heroTitle: "Password vault",
				note: "Keep references and connections to external vaults below. Save passwords in the encrypted vault above.",
				linkEntry: "Link vault entry",
				entryName: "Entry name",
				storedIn: "Stored in",
				usedFor: "Used for",
				verified: "Verified",
				linked: "Linked",
				vaultLabel: "Password vault",
				managePasswords: "Manage this account’s passwords",
				backup: "Create backup",
				download: "Save backup file",
				preview: "Preview",
				confirm: /^Confirm ·/,
				restored: /Restored \d+ records/,
			};

type Copy = ReturnType<typeof copyFor>;

async function setLanguage(page: Page, zh: boolean) {
	const copy = copyFor(zh);
	await page.goto("/settings");
	const picker = page.getByRole("combobox", {
		name: copy.language,
		exact: true,
	});
	await expect(picker).toBeVisible();
	await selectChoice(picker, copy.languageValue);
	await expect(
		page.getByRole("combobox", { name: copy.language, exact: true }),
	).toHaveAttribute("data-value", copy.languageValue);
}

async function createAccount(page: Page, copy: Copy) {
	await page.goto("/assets/account");
	await page
		.getByRole("main")
		.getByRole("button", { name: copy.add, exact: true })
		.click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(copy.name, { exact: true }).fill(accountName);
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
	const card = page
		.locator("main .asset-account-card")
		.filter({ hasText: accountName });
	await expect(card).toHaveCount(1);
	const href = await card.getAttribute("href");
	if (!href) throw Error("vault-reference-account-link-missing");
	const id = href.split("/").at(-1);
	if (!id) throw Error("vault-reference-account-id-missing");
	return { id, href };
}

async function createVault(page: Page, copy: Copy, accountId: string) {
	await page.goto("/assets/vault");
	await page
		.getByRole("main")
		.getByRole("button", { name: copy.linkEntry, exact: true })
		.click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(copy.entryName, { exact: true }).fill(vaultName);
	await dialog.getByLabel(copy.storedIn, { exact: true }).fill(storageLocation);
	await selectChoice(
		dialog.getByLabel(copy.usedFor, { exact: true }),
		accountId,
	);
	await dialog.getByLabel(copy.verified, { exact: true }).fill(verifiedAt);
	await expect(dialog.getByLabel(/password|recovery|密码|恢复码/i)).toHaveCount(
		0,
	);
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
	await page.reload();
	const row = page
		.locator(".vault-reference-table tbody tr")
		.filter({ hasText: vaultName });
	await expect(row).toHaveCount(1);
	const href = await row
		.getByRole("link", { name: vaultName, exact: true })
		.getAttribute("href");
	if (!href) throw Error("vault-reference-entry-link-missing");
	const id = href.split("/").at(-1);
	if (!id) throw Error("vault-reference-entry-id-missing");
	return { id, href };
}

async function assertVaultTable(
	page: Page,
	copy: Copy,
	vaultHref: string,
	width?: number,
) {
	await page.goto("/assets/vault");
	const hero = page.locator(".vault-page .password-vault-header h1");
	await expect(hero).toBeVisible();
	await expect(hero).toHaveText(copy.heroTitle);
	const note = page.locator(".vault-privacy-note");
	await expect(note).toBeVisible();
	await expect(note).toHaveAttribute("role", "note");
	await expect(note).toContainText(copy.note);
	const table = page.locator(".vault-reference-table");
	await expect(table).toBeVisible();
	const row = table.locator("tbody tr").filter({ hasText: vaultName });
	await expect(row).toHaveCount(1);
	await expect(row).toContainText(accountName);
	await expect(row).toContainText(storageLocation);
	await expect(row).toContainText("2026");
	await expect(row).toContainText(copy.linked);
	await expect(
		row.getByRole("link", { name: vaultName, exact: true }),
	).toHaveAttribute("href", vaultHref);
	if (width === 390) {
		const tableWrap = page.locator(".vault-table-wrap");
		await expect(page.locator("#password-vault-master")).toBeVisible();
		await expect(tableWrap).toHaveAttribute("tabindex", "0");
		await tableWrap.focus();
		await expect(tableWrap).toBeFocused();
		await row.scrollIntoViewIfNeeded();
		await expect(row.locator("td").first()).toBeInViewport({ ratio: 0.1 });
		const readScrollState = () =>
			tableWrap.evaluate((element) => ({
				scrollLeft: (element as HTMLElement).scrollLeft,
				scrollWidth: (element as HTMLElement).scrollWidth,
				clientWidth: (element as HTMLElement).clientWidth,
				focused: document.activeElement === element,
				overflowX: window.getComputedStyle(element).overflowX,
				overflowY: window.getComputedStyle(element).overflowY,
				tabIndex: (element as HTMLElement).tabIndex,
				activeTagName: document.activeElement?.tagName ?? "",
				activeClassName: String(
					(document.activeElement as HTMLElement | null)?.className ?? "",
				),
				selection: window.getSelection()?.toString() ?? "",
				scriptSources: Array.from(document.scripts)
					.map((script) => script.src)
					.filter(Boolean),
			}));
		const initialState = await readScrollState();
		const waitForScrollSettled = async () => {
			let last = (await readScrollState()).scrollLeft;
			let unchangedSince = Date.now();
			await expect.poll(async () => {
				const current = (await readScrollState()).scrollLeft;
				if (current !== last) { last = current; unchangedSince = Date.now(); }
				return Date.now() - unchangedSince;
			}, { timeout: 3_000, intervals: [50] }).toBeGreaterThanOrEqual(150);
		};
		await test.info().attach("vault-table-scroll-initial", {
			body: JSON.stringify(initialState, null, 2),
			contentType: "application/json",
		});
		for (let press = 0; press < 8; press += 1) {
			const before = await readScrollState();
			if (before.scrollLeft >= before.scrollWidth - before.clientWidth) break;
			await tableWrap.press("ArrowRight");
			await expect.poll(async () => (await readScrollState()).scrollLeft).toBeGreaterThan(before.scrollLeft);
			await waitForScrollSettled();
		}
		try {
			await expect
				.poll(async () => (await readScrollState()).scrollLeft, {
					timeout: 2_000,
				})
				.toBeGreaterThan(initialState.scrollLeft);
		} finally {
			const rightState = await readScrollState();
			await test.info().attach("vault-table-scroll-after-right", {
				body: JSON.stringify(rightState, null, 2),
				contentType: "application/json",
			});
		}
		await expect(row.locator("td").nth(4)).toBeInViewport({ ratio: 0.1 });
		// Native keyboard scrolling animates and may coalesce rapid key presses.
		// Read each actual movement before issuing another key; do not set scrollLeft.
		for (let press = 0; press < 20; press += 1) {
			const beforeLeft = (await readScrollState()).scrollLeft;
			if (beforeLeft <= initialState.scrollLeft) break;
			await tableWrap.press("ArrowLeft");
			await expect.poll(async () => (await readScrollState()).scrollLeft, {
				timeout: 2_000,
			}).toBeLessThan(beforeLeft);
			await waitForScrollSettled();
		}
		try {
			await expect
				.poll(async () => (await readScrollState()).scrollLeft, {
					timeout: 2_000,
				})
				.toBe(initialState.scrollLeft);
		} finally {
			const restoredState = await readScrollState();
			await test.info().attach("vault-table-scroll-after-left", {
				body: JSON.stringify(restoredState, null, 2),
				contentType: "application/json",
			});
		}
	}
}

async function assertVaultDetails(page: Page, accountHref: string) {
	await expect(
		page.getByRole("heading", { name: vaultName, exact: true }),
	).toBeVisible();
	await setAccountRelationDetailsOpen(page);
	const relation = page
		.locator("details.account-relation-details .relation-row")
		.filter({ hasText: accountName });
	await expect(relation).toHaveCount(1);
	await expect(relation).toContainText(accountName);
	await expect(relation).toContainText("2026");
	await expect(
		relation.getByRole("link", { name: accountName, exact: true }),
	).toHaveAttribute("href", accountHref);
}

async function assertAccountDetails(page: Page, copy: Copy, accountId: string, vaultHref: string) {
	await expect(
		page.getByRole("heading", { name: accountName, exact: true }),
	).toBeVisible();
	const details = await setAccountRelationDetailsOpen(page);
	const relation = details.locator(".relation-row").filter({ hasText: vaultName });
	await expect(relation).toHaveCount(1);
	await expect(relation).toBeVisible();
	await expect(relation).toContainText(accountName);
	await expect(relation).toContainText(copy.vaultLabel);
	await expect(relation).toContainText("2026");
	await expect(relation.getByRole("link", { name: vaultName, exact: true })).toHaveAttribute("href", vaultHref);
	await expect(page.locator(".account-security-card").getByRole("link", {
		name: copy.managePasswords, exact: true,
	})).toHaveAttribute("href", `/assets/vault#asset-${accountId}`);
	await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
}

async function downloadAndInspect(
	page: Page,
	copy: Copy,
	filename: string,
	accountId: string,
	vaultId: string,
) {
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
	expect(download.suggestedFilename()).toMatch(/\.ka1$/);

	const bytes = readFileSync(path);
	expect(bytes.subarray(0, 8).toString()).toBe("KEEPANY1");
	const inspected = await inspectArchive(
		await decryptBackup(new Uint8Array(bytes), password),
	);
	expect(inspected.manifest.recordCount).toBe(inspected.rows.length);
	const assets = inspected.rows
		.filter((row: RecordRow) => row.type === "asset")
		.map((row: RecordRow) => JSON.parse(row.payload) as Asset);
	const relations = inspected.rows
		.filter((row: RecordRow) => row.type === "relation")
		.map((row: RecordRow) => JSON.parse(row.payload) as Relation);
	const account = assets.find((asset) => asset.id === accountId);
	const vault = assets.find((asset) => asset.id === vaultId);
	const relation = relations.find(
		(item) => item.from === vaultId && item.to === accountId,
	);
	expect(account).toMatchObject({
		id: accountId,
		kind: "account",
		name: accountName,
	});
	expect(vault).toMatchObject({
		id: vaultId,
		kind: "vault",
		name: vaultName,
		location: storageLocation,
	});
	expect(relation).toMatchObject({
		from: vaultId,
		to: accountId,
		label: copy.vaultLabel,
		verifiedAt,
		deleted: false,
	});
	if (!relation) throw Error("vault-reference-archive-relation-missing");
	return { path, relationId: relation.id };
}

async function restoreIntoCleanContext(
	browser: Browser,
	locale: "zh-CN" | "en-US",
	width: number,
	zh: boolean,
	copy: Copy,
	archivePath: string,
	accountHref: string,
	vaultHref: string,
	accountId: string,
	vaultId: string,
	errors: string[],
) {
	const context = await browser.newContext({
		locale,
		viewport: { width, height: 844 },
		acceptDownloads: true,
	});
	const page = await context.newPage();
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		await setLanguage(page, zh);
		await page.goto("/assets/vault");
		await expect(page.locator(".vault-reference-table tbody tr")).toHaveCount(
			0,
		);
		await page.goto("/intake");
		await page.locator("#backup-password").fill(password);
		await page.locator("#restore-file").setInputFiles(archivePath);
		await page
			.getByRole("button", { name: copy.preview, exact: true })
			.first()
			.click();
		await expect(
			page.getByRole("button", { name: copy.confirm }),
		).toBeVisible();
		await page.getByRole("button", { name: copy.confirm }).click();
		await expect(
			page.getByRole("status").filter({ hasText: copy.restored }),
		).toBeVisible();

		await assertVaultTable(page, copy, vaultHref, width);
		await page.reload();
		await assertVaultTable(page, copy, vaultHref, width);
		const row = page
			.locator(".vault-reference-table tbody tr")
			.filter({ hasText: vaultName });
		await row.getByRole("link", { name: vaultName, exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`${vaultHref}$`));
		await assertVaultDetails(page, accountHref);
		await page
			.locator(".relation-row")
			.filter({ hasText: accountName })
			.getByRole("link", { name: accountName, exact: true })
			.click();
		await expect(page).toHaveURL(new RegExp(`${accountHref}#account-relations$`));
		await assertAccountDetails(page, copy, accountId, vaultHref);
		await expect(
			page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth + 1,
			),
		).resolves.toBe(true);
		await page.screenshot({
			path: test
				.info()
				.outputPath(
					`vault-reference-restored-${zh ? "zh-CN" : "en-US"}-${width}.png`,
				),
			fullPage: true,
		});
		const restoredArchive = await downloadAndInspect(
			page,
			copy,
			`vault-reference-restored-${zh ? "zh-CN" : "en-US"}-${width}.ka1`,
			accountId,
			vaultId,
		);
		return { context, relationId: restoredArchive.relationId };
	} catch (error) {
		await context.close().catch(() => undefined);
		throw error;
	}
}

for (const locale of ["zh-CN", "en-US"] as const) {
	for (const width of [390, 1280] as const) {
		test(`${locale} ${width}px vault reference saves, archives and restores through the fixed UI`, async ({
			browser,
		}) => {
			test.setTimeout(width === 390 ? 150_000 : 120_000);
			const zh = locale === "zh-CN";
			const copy = copyFor(zh);
			const sourceContext = await browser.newContext({
				locale,
				viewport: { width, height: 844 },
				acceptDownloads: true,
			});
			const sourcePage = await sourceContext.newPage();
			const errors: string[] = [];
			sourcePage.on("pageerror", (error) => errors.push(error.message));
			let cleanContext: BrowserContext | undefined;
			try {
				await setLanguage(sourcePage, zh);
				const account = await createAccount(sourcePage, copy);
				const vault = await createVault(sourcePage, copy, account.id);
				await assertVaultTable(sourcePage, copy, vault.href, width);
				await sourcePage.reload();
				await assertVaultTable(sourcePage, copy, vault.href, width);
				const row = sourcePage
					.locator(".vault-reference-table tbody tr")
					.filter({ hasText: vaultName });
				await row.getByRole("link", { name: vaultName, exact: true }).click();
				await expect(sourcePage).toHaveURL(new RegExp(`${vault.href}$`));
				await assertVaultDetails(sourcePage, account.href);
				await sourcePage
					.locator(".relation-row")
					.filter({ hasText: accountName })
					.getByRole("link", { name: accountName, exact: true })
					.click();
				await expect(sourcePage).toHaveURL(new RegExp(`${account.href}#account-relations$`));
				await assertAccountDetails(sourcePage, copy, account.id, vault.href);
				await sourcePage.goto("/assets/vault");
				await expect(
					sourcePage.evaluate(
						() => document.documentElement.scrollWidth <= window.innerWidth + 1,
					),
				).resolves.toBe(true);
				await sourcePage.screenshot({
					path: test
						.info()
						.outputPath(
							`vault-reference-source-${zh ? "zh-CN" : "en-US"}-${width}.png`,
						),
					fullPage: true,
				});
				const archive = await downloadAndInspect(
					sourcePage,
					copy,
					`vault-reference-${zh ? "zh-CN" : "en-US"}-${width}.ka1`,
					account.id,
					vault.id,
				);

				const restored = await restoreIntoCleanContext(
					browser,
					locale,
					width,
					zh,
					copy,
					archive.path,
					account.href,
					vault.href,
					account.id,
					vault.id,
					errors,
				);
				cleanContext = restored.context;
				expect(restored.relationId).toBe(archive.relationId);
				expect(archive.relationId).toMatch(/^[0-9a-f-]{36}$/);
				expect(errors).toEqual([]);
			} finally {
				if (cleanContext) await cleanContext.close();
				await sourceContext.close();
			}
		});
	}
}
