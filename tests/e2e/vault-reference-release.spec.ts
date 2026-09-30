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
				linkEntry: "关联密码库条目",
				entryName: "条目名称",
				storedIn: "保管位置",
				usedFor: "用于",
				verified: "核实时间",
				linked: "已关联",
				vaultLabel: "密码库引用",
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
				linkEntry: "Link vault entry",
				entryName: "Entry name",
				storedIn: "Stored in",
				usedFor: "Used for",
				verified: "Verified",
				linked: "Linked",
				vaultLabel: "Vault references",
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
	await picker.selectOption(copy.languageValue);
	await expect(
		page.getByRole("combobox", { name: copy.language, exact: true }),
	).toHaveValue(copy.languageValue);
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
	await dialog
		.getByLabel(copy.usedFor, { exact: true })
		.selectOption(accountId);
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

async function assertVaultTable(page: Page, copy: Copy, vaultHref: string) {
	await page.goto("/assets/vault");
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
}

async function assertVaultDetails(page: Page, accountHref: string) {
	await expect(
		page.getByRole("heading", { name: vaultName, exact: true }),
	).toBeVisible();
	const relation = page
		.locator(".relation-row")
		.filter({ hasText: accountName });
	await expect(relation).toHaveCount(1);
	await expect(relation).toContainText(accountName);
	await expect(relation).toContainText("2026");
	await expect(
		relation.getByRole("link", { name: accountName, exact: true }),
	).toHaveAttribute("href", accountHref);
}

async function assertAccountDetails(page: Page) {
	await expect(
		page.getByRole("heading", { name: accountName, exact: true }),
	).toBeVisible();
	await expect(page.locator(".account-security-card")).toContainText(vaultName);
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

		await assertVaultTable(page, copy, vaultHref);
		await page.reload();
		await assertVaultTable(page, copy, vaultHref);
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
		await expect(page).toHaveURL(new RegExp(`${accountHref}$`));
		await assertAccountDetails(page);
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
				await assertVaultTable(sourcePage, copy, vault.href);
				await sourcePage.reload();
				await assertVaultTable(sourcePage, copy, vault.href);
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
				await expect(sourcePage).toHaveURL(new RegExp(`${account.href}$`));
				await assertAccountDetails(sourcePage);
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
