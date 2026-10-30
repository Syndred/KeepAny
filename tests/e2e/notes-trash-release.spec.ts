import { openBackupPage } from "./helpers/backup-restore";
import { openBackupRestorePanel } from "./helpers/backup-restore";
import { prepareVaultWorkspace } from "./helpers/vault-access";
import "fake-indexeddb/auto";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { build } from "esbuild";
import { strFromU8, unzipSync } from "fflate";
import { newAsset, type AssetKind } from "../../packages/domain/src";
import { openLocalRepository } from "../../packages/local-db/src";
import {
	decryptBackup,
	encryptBackup,
} from "../../packages/local-db/src/backup-crypto";
import type {
	VaultPersistence,
	VaultSession,
} from "../../packages/password-vault/src";
import {
	visualMaster,
	inspectVisualKdbx,
} from "./fixtures/password-smart-import-visual";
import { initializeNodeIndexedDB } from "./helpers/node-indexeddb";

test.setTimeout(150_000);
const evidence =
	process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/stackperch-notes-trash-evidence";
const backupPassword = "Synthetic-notes-trash-backup!42";
const password = "Synthetic-entry-only!42";
// External vault-reference creation was retired by the user's 2026-10-29 scope.
const kinds: AssetKind[] = ["account", "subscription", "item"];
let fixture: Buffer;

test.beforeAll(async () => {
	initializeNodeIndexedDB();
	mkdirSync(evidence, { recursive: true });
	const result = await build({
		entryPoints: ["packages/password-vault/src/index.ts"],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
	});
	const module = { exports: {} };
	new Function("require", "module", "exports", result.outputFiles[0].text)(
		createRequire(join(process.cwd(), "package.json")),
		module,
		module.exports,
	);
	const { VaultSession: Session } = module.exports as {
		VaultSession: new (storage: VaultPersistence) => VaultSession;
	};
	const repository = await openLocalRepository(
		`test-notes-trash-${crypto.randomUUID().slice(0, 10)}`,
	);
	const session = new Session({
		read: () => repository.readPasswordVault(),
		write: (bytes, revision) => repository.savePasswordVault(bytes, revision),
	});
	try {
		const assets = [
			...kinds.map((kind) => ({
				...newAsset(kind),
				id: `form-${kind}`,
				name: `Form ${kind}`,
				longDescription: `Legacy ${kind}`,
				notes: kind === "item" ? `Legacy ${kind}` : `Private ${kind}`,
			})),
			{ ...newAsset("project"), id: "keep-project", name: "Keep project" },
			{
				...newAsset("account"),
				id: "purge-first",
				name: "Purge first",
				notes: "Purge private text",
				deleted: true,
			},
			{
				...newAsset("account"),
				id: "purge-second",
				name: "Purge second",
				deleted: true,
			},
		];
		await repository.saveBatch(
			assets.map((value) => ({ type: "asset" as const, value })),
		);
		const createdAt = new Date().toISOString();
		await repository.save("relation", {
			id: "purge-related",
			from: "purge-first",
			to: "keep-project",
			label: "Old login",
			createdAt,
			deleted: true,
		});
		await repository.save("relation", {
			id: "purge-line",
			from: "form-account",
			to: "keep-project",
			label: "Old connection",
			createdAt,
			deleted: true,
		});
		await repository.save("task", {
			id: "purge-task",
			name: "Related old task",
			assetId: "purge-first",
			createdAt,
		});
		await session.initialize();
		await session.create(visualMaster);
		for (let index = 0; index < 4; index++) {
			const id = await session.saveEntry({
				title: `Synthetic password ${index}`,
				username: `reader${index}@example.test`,
				password,
				url: "",
				notes: `Encrypted note ${index}`,
				linkedAssetIds: ["form-account"],
			});
			if (index > 0) {
				await session.saveEntry({
					...session.readEntry(id),
					notes: `Encrypted updated note ${index}`,
				});
				await session.trashEntry(id);
			}
		}
		fixture = Buffer.from(
			await encryptBackup(await repository.exportArchive(), backupPassword),
		);
	} finally {
		session.lock();
		await repository.close();
	}
});

async function exportRows(page: Page, zh: boolean) {
	await page.goto("/intake");
	await openBackupPage(page); await page.locator("#backup-password").fill(backupPassword);
	await page
		.getByRole("button", {
			name: zh ? "创建备份" : "Create backup",
			exact: true,
		})
		.click();
	const download = page.waitForEvent("download");
	await page
		.getByRole("link", {
			name: zh ? "保存备份文件" : "Save backup file",
			exact: true,
		})
		.click();
	const filename = test.info().outputPath("synthetic-after-purge.ka1");
	await (await download).saveAs(filename);
	const files = unzipSync(
		await decryptBackup(new Uint8Array(readFileSync(filename)), backupPassword),
	);
	return JSON.parse(strFromU8(files["records.json"])).map(
		(row: { payload: string }) => JSON.parse(row.payload),
	);
}

for (const locale of ["zh-CN", "en"])
	for (const width of [390, 1536]) {
		test(`${locale} ${width}px consolidates legacy notes and confirms both trash workflows`, async ({
			browser,
		}, info) => {
			const zh = locale === "zh-CN";
			const context = await browser.newContext({
				viewport: { width, height: 960 },
				acceptDownloads: true,
			});
			await context.addInitScript(
				(language) => localStorage.setItem("keepany-language", language),
				locale,
			);
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const edit = zh ? "编辑" : "Edit",
				save = zh ? "保存" : "Save",
				cancel = zh ? "取消" : "Cancel";
			const purge = zh ? "彻底删除" : "Delete permanently",
				empty = zh ? "清空回收站" : "Empty trash";
			const restore = zh ? "恢复" : "Restore";
			const capture = async (name: string) =>
				page.screenshot({ path: `${evidence}/${locale}-${width}-${name}.png` });
			const cancelDialog = async () => {
				await page
					.getByRole("dialog")
					.getByRole("button", { name: cancel, exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
			};
			try {
				await page.goto("/intake");
				await openBackupRestorePanel(page);
				await openBackupPage(page); await page.locator("#backup-password").fill(backupPassword);
				await page.locator("#restore-file").setInputFiles({
					name: "synthetic-notes-trash.ka1",
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

				for (const kind of kinds) {
					await page.goto(`/assets/${kind}/form-${kind}`);
					await page
						.getByRole("button", { name: edit, exact: true })
						.first()
						.click();
					let dialog = page.getByRole("dialog");
					const original =
						kind === "item"
							? `Legacy ${kind}`
							: `Legacy ${kind}\n\nPrivate ${kind}`;
					await expect(dialog.locator("#longDescription")).toHaveCount(0);
					await expect(
						dialog.getByLabel(zh ? "备注" : "Notes", { exact: true }),
					).toHaveCount(1);
					await expect(dialog.locator("#notes")).toHaveValue(original);
					await dialog.locator("#notes").fill(`${original}\nChanged`);
					await cancelDialog();
					await page
						.getByRole("button", { name: edit, exact: true })
						.first()
						.click();
					dialog = page.getByRole("dialog");
					await expect(dialog.locator("#notes")).toHaveValue(original);
					await dialog.locator("#notes").fill(`${original}\nChanged`);
					if (kind === "account") {
						await dialog.locator("#notes").scrollIntoViewIfNeeded();
						await expect
							.poll(async () => {
								const notes = await dialog.locator("#notes").boundingBox();
								const actions = await dialog
									.locator("form > .actions")
									.boundingBox();
								return (
									!!notes &&
									!!actions &&
									notes.y + notes.height <= actions.y - 8
								);
							})
							.toBe(true);
						await capture("single-notes");
					}
					await dialog.getByRole("button", { name: save, exact: true }).click();
					await expect(dialog).toBeHidden();
					await page.reload();
					await expect(page.locator(".asset-supplemental-notes")).toHaveText(
						`${original}\nChanged`,
					);
					await expect(page.locator(".asset-supplemental-notes")).toHaveCount(
						1,
					);
					expect(
						await page.evaluate(
							() => document.documentElement.scrollWidth <= innerWidth,
						),
					).toBe(true);
				}
				await page.goto("/assets/project/keep-project");
				await page
					.getByRole("button", { name: edit, exact: true })
					.first()
					.click();
				await expect(
					page.getByRole("dialog").locator("#longDescription"),
				).toHaveCount(1);
				await expect(
					page
						.getByRole("dialog")
						.getByLabel(zh ? "内部备注" : "Internal notes", { exact: true }),
				).toHaveCount(1);
				await cancelDialog();

				await page.goto("/trash");
				let row = page.locator('.trash-row[data-asset-id="purge-second"]');
				await row.getByRole("button", { name: restore, exact: true }).click();
				await expect(row).toHaveCount(0);
				await page.goto("/assets/account/purge-second");
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
				await expect(page.getByRole("dialog")).toBeHidden();
				await page.goto("/trash");
				row = page.locator('.trash-row[data-asset-id="purge-first"]');
				await row.getByRole("button", { name: purge, exact: true }).click();
				await expect(page.getByRole("dialog")).toContainText(
					zh ? "无法从回收站恢复" : "cannot restore",
				);
				const controls = await page
					.getByRole("dialog")
					.getByRole("button")
					.evaluateAll((buttons) =>
						buttons.map((button) => {
							const box = button.getBoundingClientRect();
							return {
								x: box.x,
								y: box.y,
								width: box.width,
								height: box.height,
							};
						}),
					);
				expect(controls.every((box) => box.height >= 44)).toBe(true);
				const rowButtons = await row
					.locator("button")
					.evaluateAll((buttons) =>
						buttons.map((button) => {
							const box = button.getBoundingClientRect();
							return {
								x: box.x,
								y: box.y,
								width: box.width,
								height: box.height,
							};
						}),
					);
				expect(rowButtons).toHaveLength(2);
				expect(rowButtons.every((box) => box.height >= 44)).toBe(true);
				expect(
					rowButtons[1].x - rowButtons[0].x - rowButtons[0].width,
				).toBeGreaterThanOrEqual(12);
				await capture("ordinary-confirm");
				await cancelDialog();
				await expect(row).toBeVisible();
				await row.getByRole("button", { name: purge, exact: true }).click();
				await page.keyboard.press("Escape");
				await expect(page.getByRole("dialog")).toBeHidden();
				await row.getByRole("button", { name: purge, exact: true }).click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: purge, exact: true })
					.click();
				await expect(row).toHaveCount(0);
				await expect(
					page.locator('[data-relation-id="purge-related"]'),
				).toHaveCount(0);
				await page.getByRole("button", { name: empty, exact: true }).click();
				await cancelDialog();
				await expect(page.locator(".trash-row")).toHaveCount(2);
				await page.getByRole("button", { name: empty, exact: true }).click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: empty, exact: true })
					.click();
				await expect(page.locator(".trash-row")).toHaveCount(0);
				await page.reload();
				await expect(
					page.getByRole("heading", {
						name: zh ? "回收站" : "Trash",
						exact: true,
					}),
				).toBeVisible();
				await expect(page.locator(".trash-row")).toHaveCount(0);
				await capture("ordinary-empty");
				const rows = await exportRows(page, zh);
				expect(
					rows.find((asset: { id: string }) => asset.id === "purge-first"),
				).toMatchObject({
					purged: true,
					deleted: true,
					notes: "",
					longDescription: "",
				});
				expect(JSON.stringify(rows)).not.toContain("Purge private text");
				for (const kind of kinds)
					expect(
						rows.find((asset: { id: string }) => asset.id === `form-${kind}`),
					).toMatchObject({
						longDescription: "",
						notes: expect.stringContaining("Changed"),
					});

				await page.goto("/assets/vault");

				await prepareVaultWorkspace(page);
				await page.locator("#password-vault-unlock-master").fill(visualMaster);
				await page
					.getByRole("button", {
						name: zh ? "解锁密码库" : "Unlock vault",
						exact: true,
					})
					.click();
				await expect(page.locator(".password-vault-entry-trash")).toHaveCount(
					3,
				);
				await expect(
					page.locator(".password-vault-entry-list .password-vault-entry"),
				).toHaveCount(1);
				const first = page
					.locator(".password-vault-entry-trash")
					.filter({ hasText: "Synthetic password 1" });
				await first.getByRole("button", { name: purge, exact: true }).click();
				await capture("password-confirm");
				await cancelDialog();
				await expect(first).toBeVisible();
				await first.getByRole("button", { name: purge, exact: true }).click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: purge, exact: true })
					.click();
				await expect(first).toHaveCount(0);
				await page
					.locator(".password-vault-entry-trash")
					.filter({ hasText: "Synthetic password 2" })
					.getByRole("button", {
						name: zh ? "恢复条目" : "Restore entry",
						exact: true,
					})
					.click();
				await expect(page.locator(".password-vault-entry-trash")).toHaveCount(
					1,
				);
				await page
					.locator("#vault-trash")
					.getByRole("button", { name: empty, exact: true })
					.click();
				await cancelDialog();
				await expect(page.locator(".password-vault-entry-trash")).toHaveCount(
					1,
				);
				await page
					.locator("#vault-trash")
					.getByRole("button", { name: empty, exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: empty, exact: true })
					.click();
				await expect(page.locator(".password-vault-entry-trash")).toHaveCount(
					0,
				);
				await expect(
					page.locator(".password-vault-entry-list .password-vault-entry"),
				).toHaveCount(2);
				await capture("password-empty");
				const downloading = page.waitForEvent("download");
				await page
					.getByRole("button", {
						name: zh ? "导出备份" : "Export backup",
						exact: true,
					})
					.click();
				const filename = info.outputPath("synthetic-purged.kdbx");
				await (await downloading).saveAs(filename);
				const content = await inspectVisualKdbx(filename);
				expect(content.map((entry) => entry.draft.title).sort()).toEqual([
					"Synthetic password 0",
					"Synthetic password 2",
				]);
				expect(
					content.every((entry) => entry.draft.password === password),
				).toBe(true);
				expect(
					content.find((entry) => entry.draft.title === "Synthetic password 2")!
						.history.length,
				).toBeGreaterThan(0);
				await page.reload();
				await prepareVaultWorkspace(page);
				await page.locator("#password-vault-unlock-master").fill(visualMaster);
				await page
					.getByRole("button", {
						name: zh ? "解锁密码库" : "Unlock vault",
						exact: true,
					})
					.click();
				await expect(page.locator(".password-vault-entry-trash")).toHaveCount(
					0,
				);
				await expect(
					page.locator(".password-vault-entry-list .password-vault-entry"),
				).toHaveCount(2);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				).toBe(true);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
