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
	test(`${locale} ${width}px recovers deleted accounts, resolves duplicates, and explicitly restores deleted lines`, async ({
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
		async function connect() {
			await page.goto("/assets/vault");
			await page.locator("#password-vault-unlock-master").fill(visualMaster);
			await page
				.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
				.click();
			await expect(page.locator(".password-vault-entry")).toHaveCount(
				records.length,
			);
			await page
				.getByRole("button", { name: t("pwConnectTitle"), exact: true })
				.click();
			const dialog = page.getByRole("dialog");
			await expect(
				dialog.locator(".vault-connect-account-pane h3"),
			).toBeVisible();
			return dialog;
		}
		const row = (name: string) =>
			page
				.locator(".vault-connect-account")
				.filter({
					has: page.locator("strong", { hasText: new RegExp(`^${name}$`) }),
				});
		const conflict = (name: string) =>
			page.getByRole("region", {
				name: t("pwConnectConflictFor", { name }),
				exact: true,
			});
		async function save() {
			await page
				.getByRole("dialog")
				.getByRole("button", { name: t("pwConnectSave"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
		}
		try {
			await page.goto("/intake");
			await page
				.locator("details.intake-secondary")
				.filter({ has: page.locator("#restore-file") })
				.locator("summary")
				.click();
			await page.locator("#backup-password").fill(backupPassword);
			await page
				.locator("#restore-file")
				.setInputFiles({
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
				page
					.getByRole("status")
					.filter({
						hasText: zh ? /已恢复 \d+ 条记录/ : /Restored \d+ records/,
					}),
			).toBeVisible();
			let dialog = await connect();
			await expect(dialog.locator(".vault-connect-conflict")).toHaveCount(5);
			await expect(dialog.locator(".vault-connect-account")).toHaveCount(1);
			await expect(conflict(records[0].title)).toContainText(
				t("pwConnectConflict_account_deleted"),
			);
			await expect(conflict(records[2].title)).toContainText(
				t("pwConnectConflict_identity_deleted"),
			);
			await expect(conflict(records[3].title)).toContainText(
				t("pwConnectConflict_identity_ambiguous"),
			);
			await dialog.getByRole("searchbox").fill(records[0].title);
			await expect(dialog.locator(".vault-connect-conflict")).toHaveCount(1);
			const geometry = await dialog
				.locator(".vault-connect-conflict")
				.evaluate((card) => {
					const rect = card.getBoundingClientRect();
					return {
						width: rect.width,
						gap: Number.parseFloat(getComputedStyle(card).rowGap),
						controls: [...card.querySelectorAll("button")].map(
							(button) => button.getBoundingClientRect().height,
						),
						contained: [...card.children].every(
							(child) => child.getBoundingClientRect().right <= rect.right + 1,
						),
					};
				});
			expect(geometry.gap).toBeGreaterThanOrEqual(12);
			expect(geometry.contained).toBe(true);
			expect(geometry.controls.every((height) => height >= 44)).toBe(true);
			await page.screenshot({
				path: join(evidence, `link-conflict-${locale}-${width}.png`),
			});
			await dialog.getByRole("searchbox").fill("");
			await row(records[5].title).getByRole("checkbox").check();
			await row(records[5].title)
				.getByRole("textbox")
				.fill("Retain this edited hint");
			await selectChoice(row(records[5].title).getByRole("combobox"), "social");
			await conflict(records[0].title)
				.getByRole("button", {
					name: t("pwConnectRestoreAccountNamed", { name: records[0].title }),
					exact: true,
				})
				.click();
			await expect(conflict(records[0].title)).toBeHidden();
			await expect(row(records[0].title).getByRole("checkbox")).toBeChecked();
			await expect(row(records[0].title).getByRole("checkbox")).toBeFocused();
			await chooseRecovery(conflict(records[1].title), accountIds[1]);
			await conflict(records[2].title)
				.getByRole("button", {
					name: t("pwConnectRestoreAccountNamed", { name: "Deleted mailbox" }),
					exact: true,
				})
				.click();
			await expect(conflict(records[2].title)).toBeHidden();
			await chooseRecovery(conflict(records[3].title), identityIds[3]);
			await chooseRecovery(conflict(records[4].title), replacementId);
			await expect(dialog.locator(".vault-connect-conflict")).toHaveCount(0);
			await expect(dialog.locator(".vault-connect-account")).toHaveCount(6);
			await expect(row(records[5].title).getByRole("textbox")).toHaveValue(
				"Retain this edited hint",
			);
			await expect(row(records[5].title).getByRole("combobox")).toHaveAttribute(
				"data-value",
				"social",
			);
			await expect(row(records[5].title).getByRole("checkbox")).toBeChecked();
			await dialog
				.getByRole("button", { name: t("pwConnectLocal"), exact: true })
				.click();
			await expect(dialog.locator(".vault-connect-suggestion")).toHaveCount(3);
			const old = dialog
				.locator(".vault-connect-suggestion")
				.filter({ hasText: records[0].title });
			await expect(old).toContainText(t("pwConnectRestoreRelation"));
			await expect(old.getByRole("checkbox")).not.toBeChecked();
			await page.screenshot({
				path: join(evidence, `link-resolved-${locale}-${width}.png`),
			});
			await save();
			const first = await inspectState(page, zh, "resolved.ka1");
			expect(
				first.relations.find((relation) => relation.id === originalLine.id),
			).toEqual(originalLine);
			expect(
				first.assets.find((asset) => asset.id === accountIds[0])?.deleted,
			).toBe(false);
			expect(
				first.assets.find((asset) => asset.id === accountIds[4])?.deleted,
			).toBe(true);
			expect(
				first.assets.find((asset) => asset.id === identityIds[1])?.deleted,
			).toBe(false);
			expect(JSON.stringify(first)).not.toContain(password);
			dialog = await connect();
			await expect(dialog.locator(".vault-connect-conflict")).toHaveCount(0);
			await row(records[0].title).getByRole("checkbox").check();
			await dialog
				.getByRole("button", { name: t("pwConnectLocal"), exact: true })
				.click();
			await dialog
				.locator(".vault-connect-suggestion")
				.getByRole("checkbox")
				.check();
			await save();
			// Delete the restored line through its normal UI, then add it again from the vault.
			await page.goto(`/assets/account/${accountIds[0]}`);
			await expect(page.locator(".react-flow__edge")).toHaveCount(1);
			await page
				.locator(".asset-relations-card details")
				.filter({ has: page.locator(".relation-row") })
				.locator("summary")
				.click();
			await page
				.locator(".relation-row")
				.getByRole("button", { name: zh ? /^删除关系/ : /^Delete connection/ })
				.click();
			await page
				.getByRole("dialog")
				.getByRole("button", {
					name: zh ? "删除关系" : "Delete connection",
					exact: true,
				})
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await expect(page.locator(".react-flow__edge")).toHaveCount(0);
			dialog = await connect();
			await expect(dialog.locator(".vault-connect-conflict")).toHaveCount(0);
			await row(records[0].title).getByRole("checkbox").check();
			await dialog
				.getByRole("button", { name: t("pwConnectLocal"), exact: true })
				.click();
			await expect(
				dialog.locator(".vault-connect-suggestion").getByRole("checkbox"),
			).not.toBeChecked();
			await dialog
				.locator(".vault-connect-suggestion")
				.getByRole("checkbox")
				.check();
			await save();
			const download = page.waitForEvent("download");
			await page
				.getByRole("button", { name: t("pwVaultExport"), exact: true })
				.click();
			const kdbxPath = info.outputPath("recovered.kdbx");
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
				encrypted
					.find((item) => item.draft.title === records[1].title)
					?.draft.linkedAssetIds.sort(),
			).toEqual([accountIds[1], projectId].sort());
			expect(
				encrypted
					.find((item) => item.draft.title === records[4].title)
					?.draft.linkedAssetIds.sort(),
			).toEqual([replacementId, projectId].sort());
			const final = await inspectState(page, zh, "recovered.ka1");
			expect(
				final.relations.find((relation) => relation.id === originalLine.id),
			).toEqual({ ...originalLine, deleted: false });
			expect(
				final.relations.filter(
					(relation) =>
						relation.from === originalLine.from &&
						relation.to === originalLine.to,
				),
			).toHaveLength(1);
			expect(final.assets).toHaveLength(first.assets.length);
			await page.goto(`/assets/account/${accountIds[0]}`);
			await expect(page.locator(".react-flow__node")).toHaveCount(2);
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
