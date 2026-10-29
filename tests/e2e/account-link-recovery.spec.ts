import { openBackupRestorePanel } from "./helpers/backup-restore";
import { prepareVaultWorkspace, revealPasswordEntries } from "./helpers/vault-access";
import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { build } from "esbuild";
import { strFromU8, unzipSync } from "fflate";
import { newAsset, type Asset, type Relation } from "../../packages/domain/src";
import {
	openLocalRepository,
	type RecordRow,
} from "../../packages/local-db/src";
import {
	decryptBackup,
	encryptBackup,
} from "../../packages/local-db/src/backup-crypto";
import type {
	VaultPersistence,
	VaultSession,
} from "../../packages/password-vault/src";
import {
	inspectVisualKdbx,
	visualCopy,
	visualMaster,
} from "./fixtures/password-smart-import-visual";
import { selectChoice } from "./helpers/select-choice";
import { waitForAccountGraphLayout } from "./helpers/account-graph";
import { initializeNodeIndexedDB } from "./helpers/node-indexeddb";

test.setTimeout(150_000);
const evidence =
	process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/stackperch-account-link-recovery";
const backupPassword = "Synthetic-recovery-backup!42";
const password = "Synthetic-recovery-entry!42";
const records = [
	{ title: "Deleted Service", username: "owner@example.test" },
	{ title: "Duplicate Service", username: "duplicate-handle" },
	{ title: "Deleted identity service", username: "deleted.mail@example.test" },
	{
		title: "Duplicate identity service",
		username: "duplicate.mail@example.test",
	},
	{ title: "Replace Service", username: "replace-handle" },
	{ title: "Unrelated service", username: "unrelated-handle" },
];
let fixture: Buffer;
let accountIds: string[];
let identityIds: string[];
let originalLine: Relation;
const replacementId = "synthetic-replacement-account";
const projectId = "preserved-project";

function stable(prefix: string, values: string[]) {
	return `${prefix}-${createHash("sha256").update(JSON.stringify(values)).digest("hex")}`;
}

test.beforeAll(async () => {
	initializeNodeIndexedDB();
	mkdirSync(evidence, { recursive: true });
	const bundled = await build({
		entryPoints: ["packages/password-vault/src/index.ts"],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
	});
	const module = { exports: {} };
	new Function("require", "module", "exports", bundled.outputFiles[0].text)(
		createRequire(join(process.cwd(), "package.json")),
		module,
		module.exports,
	);
	const { VaultSession: Session } = module.exports as {
		VaultSession: new (storage: VaultPersistence) => VaultSession;
	};
	const repository = await openLocalRepository(
		`test-link-recovery-${crypto.randomUUID().slice(0, 8)}`,
	);
	const session = new Session({
		read: () => repository.readPasswordVault(),
		write: (bytes, revision) => repository.savePasswordVault(bytes, revision),
	});
	try {
		await session.initialize();
		await session.create(visualMaster);
		const entryIds: string[] = [];
		for (const record of records)
			entryIds.push(
				await session.saveEntry({
					...record,
					password,
					url: "",
					notes: `Encrypted note ${record.title}`,
					usernameAliases: [],
					linkedAssetIds: [],
				}),
			);
		accountIds = entryIds.map((id, index) =>
			index === 1
				? "duplicate-service-primary"
				: `pw-account-${createHash("sha256").update(id).digest("hex")}`,
		);
		const accounts = records.map((record, index) => ({
			...newAsset("account"),
			...record,
			name: record.title,
			id: accountIds[index],
			category: "other",
			description: `Public profile ${index}`,
			deleted: index === 0 || index === 4,
		}));
		identityIds = ["owner@example.test", "deleted.mail@example.test"].map(
			(email) => stable("login-identity", ["email", "example.test", email]),
		);
		const identities = [
			"owner@example.test",
			"deleted.mail@example.test",
			"duplicate.mail@example.test",
			"duplicate.mail@example.test",
		].map((email, index) => ({
			...newAsset("account"),
			id: identityIds[index] ?? `duplicate-email-${index}`,
			name: [
				"Primary mailbox",
				"Deleted mailbox",
				"Duplicate mailbox A",
				"Duplicate mailbox B",
			][index],
			category: "email",
			username: email,
			deleted: index === 1,
		}));
		identityIds = identities.map((identity) => identity.id);
		originalLine = {
			id: stable("login-link", [accountIds[0], "email", identityIds[0]]),
			from: accountIds[0],
			to: identityIds[0],
			label: "Login email",
			source: records[0].username,
			createdAt: "2026-10-21T00:00:00Z",
			verifiedAt: "2026-10-21",
			deleted: true,
		};
		await repository.saveBatch([
			...[
				...accounts,
				...identities,
				{ ...accounts[1], id: "duplicate-service-secondary" },
				{ ...accounts[4], id: replacementId, deleted: false },
				{ ...newAsset("project"), id: projectId, name: "Preserved project" },
			].map((value) => ({ type: "asset" as const, value })),
			{ type: "relation", value: originalLine },
		]);
		for (const [index, id] of entryIds.entries())
			await session.saveEntry({
				...session.readEntry(id),
				linkedAssetIds: [
					accountIds[index],
					...(index === 1
						? ["duplicate-service-secondary", projectId]
						: index === 4
							? [projectId]
							: []),
				],
			});
		fixture = Buffer.from(
			await encryptBackup(await repository.exportArchive(), backupPassword),
		);
	} finally {
		session.lock();
		await repository.close();
	}
});

async function chooseRecovery(scope: Locator, targetId: string) {
	const trigger = scope.getByRole("combobox");
	await trigger.press("ArrowDown");
	const popup = scope.page().getByRole("listbox");
	await expect(popup).toBeVisible();
	await expect
		.poll(() =>
			popup.evaluate((element) =>
				element.contains(element.ownerDocument.activeElement),
			),
		)
		.toBe(true);
	await popup.locator(`[role="option"][data-value="${targetId}"]`).click();
	await expect(scope).toBeHidden();
}

async function inspectState(page: Page, zh: boolean, filename: string) {
	await page.goto("/intake");
	await page.locator("#backup-password").fill(backupPassword);
	await page
		.getByRole("button", {
			name: zh ? "创建备份" : "Create backup",
			exact: true,
		})
		.click();
	const downloading = page.waitForEvent("download");
	await page
		.getByRole("link", {
			name: zh ? "保存备份文件" : "Save backup file",
			exact: true,
		})
		.click();
	const path = test.info().outputPath(filename);
	await (await downloading).saveAs(path);
	const archive = unzipSync(
		await decryptBackup(new Uint8Array(readFileSync(path)), backupPassword),
	);
	const rows = JSON.parse(strFromU8(archive["records.json"])) as RecordRow[];
	return {
		assets: rows
			.filter((row) => row.type === "asset")
			.map((row) => JSON.parse(row.payload) as Asset),
		relations: rows
			.filter((row) => row.type === "relation")
			.map((row) => JSON.parse(row.payload) as Relation),
	};
}

for (const { locale, width } of [
	{ locale: "zh-CN", width: 1536 },
	{ locale: "en", width: 1536 },
	{ locale: "zh-CN", width: 390 },
	{ locale: "en", width: 390 },
] as const) {
	test(`${locale} ${width}px disconnects, deletes, restores and re-imports without reviving trashed accounts`, async ({
		browser,
	}, info) => {
		const zh = locale === "zh-CN",
			t = visualCopy(locale);
		const context = await browser.newContext({
			locale: zh ? "zh-CN" : "en-US",
			viewport: { width, height: 1000 },
			acceptDownloads: true,
		});
		await context.addInitScript(
			(language) => localStorage.setItem("keepany-language", language),
			locale,
		);
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		async function vault() {
			await page.goto("/assets/vault");
			await prepareVaultWorkspace(page);
			await page.locator("#password-vault-unlock-master").fill(visualMaster);
			await page
				.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
				.click();
			const entries = page.locator(".password-vault-entry-list .password-vault-entry");
			// One encrypted entry may appear under each of its linked accounts.
			// Count its stable ID rather than treating those views as extra entries.
			await expect.poll(async () => new Set(await entries.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-entry-id")))).size).toBe(records.length);
			expect(await entries.evaluateAll(nodes => nodes.every(node => Boolean(node.getAttribute("data-entry-id"))))).toBe(true);
			await revealPasswordEntries(page);
			for (const record of records) await expect(entries.filter({ has: page.getByRole("heading", { name: record.title, exact: true }) }).first()).toBeVisible();
		}
		async function connect() {
			await page
				.getByRole("button", { name: t("pwConnectTitle"), exact: true })
				.click();
			return page.getByRole("dialog", {
				name: t("pwConnectTitle"),
				exact: true,
			});
		}
		const row = (name: string) =>
			page.locator(".vault-connect-account").filter({
				has: page.locator("strong", { hasText: new RegExp(`^${name}$`) }),
			});
		const conflict = (name: string) =>
			page.getByRole("region", {
				name: t("pwConnectConflictFor", { name }),
				exact: true,
			});
		const card = () =>
			page.locator(".password-vault-entry-list .password-vault-entry").filter({
				has: page.getByRole("heading", {
					name: records[0].title,
					exact: true,
				}),
			});
		async function saveLinks() {
			await page
				.getByRole("dialog")
				.getByRole("button", { name: t("pwConnectSave"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
		}
		async function cancel() {
			await page
				.getByRole("dialog")
				.getByRole("button", { name: zh ? "取消" : "Cancel", exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
		}
		try {
			await page.goto("/intake");
			await openBackupRestorePanel(page);
			await page.locator("#backup-password").fill(backupPassword);
			await page.locator("#restore-file").setInputFiles({
				name: "synthetic-link-recovery.ka1",
				mimeType: "application/octet-stream",
				buffer: fixture,
			});
			await page
				.getByRole("button", { name: zh ? "预览" : "Preview", exact: true })
				.first()
				.click();
			await page
				.getByRole("button", { name: zh ? /^确认 ·/ : /^Confirm ·/ })
				.click();
			await expect(
				page.getByRole("status").filter({
					hasText: zh ? /已恢复 \d+ 条记录/ : /Restored \d+ records/,
				}),
			).toBeVisible();
			await vault();
			let dialog = await connect();
			await expect(dialog.locator(".vault-connect-conflict")).toHaveCount(2);
			await expect(dialog.locator(".vault-connect-account")).toHaveCount(4);
			await expect(row(records[0].title)).toContainText(t("pwConnectNew"));
			await expect(
				dialog.getByRole("button", { name: /恢复账号|Restore account/ }),
			).toHaveCount(0);
			await row(records[5].title).getByRole("checkbox").check();
			await row(records[5].title)
				.getByRole("textbox")
				.fill("Retain this edited hint");
			await selectChoice(row(records[5].title).getByRole("combobox"), "social");
			await chooseRecovery(conflict(records[1].title), accountIds[1]);
			await chooseRecovery(conflict(records[3].title), identityIds[3]);
			await expect(dialog.locator(".vault-connect-conflict")).toHaveCount(0);
			for (const index of [0, 2, 4])
				await row(records[index].title).getByRole("checkbox").check();
			await expect(row(records[5].title).getByRole("textbox")).toHaveValue(
				"Retain this edited hint",
			);
			await expect(row(records[5].title).getByRole("combobox")).toHaveAttribute(
				"data-value",
				"social",
			);
			await dialog
				.getByRole("button", { name: t("pwConnectLocal"), exact: true })
				.click();
			await expect(dialog.locator(".vault-connect-suggestion")).toHaveCount(3);
			await saveLinks();
			const first = await inspectState(page, zh, "reimported.ka1");
			const newAccount = first.assets.find(
				(asset) => asset.name === records[0].title && !asset.deleted,
			);
			if (!newAccount) throw Error("missing-reimported-account");
			expect(newAccount.id).not.toBe(accountIds[0]);
			expect(
				first.assets.find((asset) => asset.id === accountIds[0])?.deleted,
			).toBe(true);
			expect(
				first.assets.find((asset) => asset.id === accountIds[4])?.deleted,
			).toBe(true);
			expect(
				first.assets.find((asset) => asset.id === identityIds[1])?.deleted,
			).toBe(true);
			expect(
				first.relations.find((relation) => relation.id === originalLine.id),
			).toEqual(originalLine);
			const line = first.relations.find(
				(relation) =>
					!relation.deleted &&
					relation.from === newAccount.id &&
					relation.to === identityIds[0],
			);
			if (!line) throw Error("missing-reimported-line");
			expect(JSON.stringify(first)).not.toContain(password);

			await vault();
			await page
				.getByRole("searchbox")
				.and(page.locator("#password-vault-search-input"))
				.fill(records[0].title);
			const disconnect = card().getByRole("button", {
				name: t("pwVaultUnlinkNamed", { name: records[0].title }),
				exact: true,
			});
			await expect(disconnect).toHaveText(t("pwVaultUnlink"));
			await expect(
				card().getByRole("button", {
					name: t("pwVaultDeleteEntry"),
					exact: true,
				}),
			).toHaveText(t("pwVaultDeleteEntry"));
			await disconnect.click();
			await expect(page.getByRole("dialog")).toContainText(
				t("pwVaultUnlinkHint"),
			);
			await cancel();
			await expect(card().locator(".password-vault-linked-asset")).toHaveCount(
				1,
			);
			await disconnect.click();
			await page.screenshot({
				path: join(evidence, `disconnect-confirm-${locale}-${width}.png`),
			});
			await page
				.getByRole("dialog")
				.getByRole("button", { name: t("pwVaultUnlink"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await expect(
				card().locator(".password-vault-linked-connection"),
			).toHaveCount(0);
			await expect(card()).toHaveCount(1);
			await expect(card()).toBeFocused();
			await expect(card()).toBeInViewport();
			await expect(page.getByText(t("pwVaultUnlinked"), { exact: true })).toHaveCount(1);
			await page.screenshot({
				path: join(evidence, `disconnect-done-${locale}-${width}.png`),
			});
			dialog = await connect();
			await expect(dialog.locator(".vault-connect-conflict")).toHaveCount(0);
			await row(records[0].title).getByRole("checkbox").check();
			await dialog
				.getByRole("button", { name: t("pwConnectLocal"), exact: true })
				.click();
			await saveLinks();
			await expect(card().locator(".password-vault-linked-asset")).toHaveCount(
				1,
			);

			// Remove a graph line directly, with cancellation and confirmation, while expanded.
			await page.goto(`/assets/account/${newAccount.id}`);
			await expect(page.locator(".react-flow__edge")).toHaveCount(1);
			await page
				.getByRole("button", { name: t("accountGraphExpand"), exact: true })
				.click();
			const expanded = page.getByRole("dialog", {
				name: zh ? "关系图" : "Connections",
				exact: true,
			});
			await expect(expanded).toBeVisible();
			await waitForAccountGraphLayout(page);
			const edge = expanded.locator(".react-flow__edge");
			await edge.focus();
			await edge.press("Enter");
			await expect(edge).toHaveClass(/\bselected\b/);
			const deleteLine = expanded.getByRole("button", {
				name: zh ? "删除关系" : "Delete connection",
				exact: true,
			});
			await expect(deleteLine).toBeVisible();
			await deleteLine.click();
			const deletion = page.getByRole("dialog", {
				name: zh ? "删除关系" : "Delete connection",
				exact: true,
			});
			await deletion
				.getByRole("button", { name: zh ? "取消" : "Cancel", exact: true })
				.click();
			await expect(expanded).toBeVisible();
			await expect(edge).toHaveCount(1);
			await deleteLine.click();
			await page.screenshot({
				path: join(evidence, `graph-delete-confirm-${locale}-${width}.png`),
			});
			await deletion
				.getByRole("button", {
					name: zh ? "删除关系" : "Delete connection",
					exact: true,
				})
				.click();
			await expect(deletion).toBeHidden();
			await expect(expanded).toBeVisible();
			await expect(expanded.locator(".react-flow__edge")).toHaveCount(0);
			await expanded
				.getByRole("button", { name: zh ? "关闭" : "Close", exact: true })
				.click();
			if (width < 768) await page.locator(".mobile-menu").click();
			const trash = page.getByRole("link", {
				name: zh ? "回收站" : "Trash",
				exact: true,
			});
			await expect(trash).toBeVisible();
			await trash.click();
			await expect(
				page.getByRole("heading", {
					name: zh ? "回收站" : "Trash",
					exact: true,
				}),
			).toBeVisible();
			await page
				.locator(`[data-relation-id="${line.id}"]`)
				.getByRole("button", { name: zh ? "恢复" : "Restore", exact: true })
				.click();
			await expect(page.locator(`[data-relation-id="${line.id}"]`)).toHaveCount(
				0,
			);
			await page.screenshot({
				path: join(evidence, `trash-visible-${locale}-${width}.png`),
			});

			await vault();
			await page.locator("#password-vault-search-input").fill(records[0].title);
			const trashEntry = card().getByRole("button", {
				name: t("pwVaultDeleteEntry"),
				exact: true,
			});
			await trashEntry.click();
			await cancel();
			await expect(card()).toHaveCount(1);
			await trashEntry.click();
			await page
				.getByRole("dialog")
				.getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true })
				.click();
			await expect(card()).toHaveCount(0);
			await page
				.getByRole("button", { name: t("pwVaultTrashTitle"), exact: true })
				.click();
			await expect(page.locator("#vault-trash")).toBeInViewport();
			await page
				.locator("#vault-trash")
				.getByRole("button", { name: t("pwVaultRestoreEntry"), exact: true })
				.click();
			await expect(card()).toHaveCount(1);
			const download = page.waitForEvent("download");
			await page
				.getByRole("button", { name: t("pwVaultExport"), exact: true })
				.click();
			const kdbxPath = info.outputPath("disconnected-and-restored.kdbx");
			await (await download).saveAs(kdbxPath);
			const encrypted = await inspectVisualKdbx(kdbxPath);
			expect(encrypted).toHaveLength(records.length);
			for (const record of records)
				expect(
					encrypted.find((item) => item.draft.title === record.title)?.draft,
				).toMatchObject({
					password,
					notes: `Encrypted note ${record.title}`,
					username: record.username,
				});
			expect(
				encrypted.find((item) => item.draft.title === records[0].title)?.draft
					.linkedAssetIds,
			).toEqual([newAccount.id]);
			expect(
				encrypted
					.find((item) => item.draft.title === records[1].title)
					?.draft.linkedAssetIds.sort(),
			).toEqual([accountIds[1], projectId].sort());
			expect(
				encrypted
					.find((item) => item.draft.title === records[4].title)
					?.draft.linkedAssetIds.sort(),
			).toEqual([replacementId, projectId].sort());
			const final = await inspectState(page, zh, "disconnected-final.ka1");
			expect(final.assets).toEqual(first.assets);
			expect(final.relations).toEqual(first.relations);
			await page.goto(`/assets/account/${newAccount.id}`);
			await expect(page.locator(".react-flow__node")).toHaveCount(2);
			await expect(page.locator(".react-flow__edge")).toHaveCount(1);
			// Exercise the user's exact path: trash the account, then re-import from its retained password.
			await page
				.getByRole("button", {
					name: zh ? "移至回收站" : "Move to trash",
					exact: true,
				})
				.click();
			await cancel();
			await expect(page.locator(".react-flow__edge")).toHaveCount(1);
			await page
				.getByRole("button", {
					name: zh ? "移至回收站" : "Move to trash",
					exact: true,
				})
				.click();
			await page
				.getByRole("dialog")
				.getByRole("button", {
					name: zh ? "移至回收站" : "Move to trash",
					exact: true,
				})
				.click();
			await expect(page).toHaveURL(/\/assets\/account$/);
			await vault();
			dialog = await connect();
			await expect(dialog.locator(".vault-connect-conflict")).toHaveCount(0);
			await expect(row(records[0].title)).toContainText(t("pwConnectNew"));
			await row(records[0].title).getByRole("checkbox").check();
			await dialog
				.getByRole("button", { name: t("pwConnectLocal"), exact: true })
				.click();
			await saveLinks();
			const secondImport = await inspectState(
				page,
				zh,
				"reimport-after-account-trash.ka1",
			);
			expect(
				secondImport.assets.find((asset) => asset.id === newAccount.id)
					?.deleted,
			).toBe(true);
			const latest = secondImport.assets.filter(
				(asset) => !asset.deleted && asset.name === records[0].title,
			);
			expect(latest).toHaveLength(1);
			expect(latest[0].id).not.toBe(newAccount.id);
			await page.goto(`/assets/account/${latest[0].id}`);
			await expect(page.locator(".react-flow__edge")).toHaveCount(1);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth + 1,
				),
			).toBe(true);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
}
