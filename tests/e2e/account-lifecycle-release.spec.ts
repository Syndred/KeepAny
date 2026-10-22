import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import type { Asset, Relation } from "../../packages/domain/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import {
	inspectVisualKdbx,
	visualHarness,
	visualMaster,
} from "./fixtures/password-smart-import-visual";
import { selectChoice } from "./helpers/select-choice";
import {
	activeAccountGraph,
	expectAccountGraphGeometry,
	expectReadableAccountGraph,
	setAccountRelationDetailsOpen,
	waitForAccountGraphLayout,
} from "./helpers/account-graph";

test.setTimeout(300_000);
test.describe.configure({ mode: "parallel" });
const evidence =
	process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/stackperch-lifecycle-evidence";
const email = "lifecycle.owner@gmail.com";
const password = "Synthetic-lifecycle-entry!42";
const backupPassword = "Synthetic-lifecycle-backup!42";
const titles = [
	"Gmail Lifecycle",
	"GitHub Lifecycle",
	"Notion Lifecycle",
	"Figma Lifecycle",
];
const records = titles.map((title, index) => ({
	title,
	username: email,
	password,
	url: [
		"https://mail.google.com/",
		"https://github.com/",
		"https://notion.so/",
		"https://figma.com/",
	][index],
	notes: `Synthetic lifecycle note ${index}`,
}));
const csv = [
	["name", "username", "password", "url", "notes"],
	...records.map((row) => [
		row.title,
		row.username,
		row.password,
		row.url,
		row.notes,
	]),
]
	.map((row) =>
		row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","),
	)
	.join("\n");

async function exportedState(page: Page, zh: boolean, filename: string) {
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
	const rows = JSON.parse(strFromU8(archive["records.json"])) as {
		type: string;
		payload: string;
	}[];
	return {
		assets: rows
			.filter((row) => row.type === "asset")
			.map((row) => JSON.parse(row.payload) as Asset),
		relations: rows
			.filter((row) => row.type === "relation")
			.map((row) => JSON.parse(row.payload) as Relation),
	};
}

for (const locale of ["zh-CN", "en"] as const)
	for (const width of [1536, 390]) {
		test(`${locale} ${width}px imports, links, deletes, restores, purges and reimports the same account family`, async ({
			browser,
		}, info) => {
			mkdirSync(evidence, { recursive: true });
			const h = await visualHarness(browser, locale, { width, height: 1000 });
			const { page, t } = h,
				zh = locale === "zh-CN";
			const snapshots: { stage: string; nodes: string[]; edges: string[] }[] =
				[];
			const entries = page.locator(
				".password-vault-entry-list .password-vault-entry",
			);
			const entry = (title: string) =>
				entries.filter({
					has: page.getByRole("heading", { name: title, exact: true }),
				});
			const cancel = zh ? "取消" : "Cancel",
				trash = zh ? "移至回收站" : "Move to trash",
				restore = zh ? "恢复" : "Restore";
			const purge = zh ? "彻底删除" : "Delete permanently",
				empty = zh ? "清空回收站" : "Empty trash";
			const screenshot = (stage: string) =>
				page.screenshot({
					path: join(evidence, `${locale}-${width}-${stage}.png`),
				});
			async function vault() {
				await page.goto("/assets/vault");
				await expect(
					page
						.locator("#password-vault-unlock-master")
						.or(page.locator(".password-vault-toolbar")),
				).toBeVisible();
				if (await page.locator("#password-vault-unlock-master").isVisible()) {
					await page
						.locator("#password-vault-unlock-master")
						.fill(visualMaster);
					await page
						.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
						.click();
				}
				await expect(page.locator(".password-vault-toolbar")).toBeVisible();
			}
			async function importPasswords(count: number) {
				const importer = await h.open();
				if (!(await importer.locator("#pw-smart-source").isVisible())) {
					const paste = importer.getByRole("button", {
						name: /^(粘贴清单|Paste a list)$/,
						exact: true,
					});
					if (await paste.isVisible()) await paste.click();
					else
						await selectChoice(
							page.getByRole("combobox", {
								name: /^(其他输入方式|Other input methods)$/,
								exact: true,
							}),
							"paste",
						);
				}
				if (count === 4) {
					await expect(
						importer.getByRole("button", {
							name: t("pwSmartFile"),
							exact: true,
						}),
					).toHaveCount(0);
					const picking = page.waitForEvent("filechooser");
					await importer
						.getByRole("button", { name: t("pwSmartChooseFile"), exact: true })
						.click();
					await (await picking).setFiles({
						name: "lifecycle.csv",
						mimeType: "text/csv",
						buffer: Buffer.from(csv),
					});
					await expect(importer.locator("#pw-smart-source")).toHaveValue(csv);
				} else await importer.locator("#pw-smart-source").fill(csv);
				await importer
					.getByRole("button", { name: /^(本机识别|Recognize on device)$/ })
					.click();
				await expect(
					importer.getByRole("button", {
						name: /^(下一条|Next entry)$/,
						exact: true,
					}),
				).toHaveCount(1);
				await expect(
					importer.getByRole("button", {
						name: /^(暂时跳过|Skip for now)$/,
						exact: true,
					}),
				).toHaveCount(0);
				await importer
					.getByRole("button", {
						name: zh ? `导入已核对的 ${count} 条` : `Import ${count} reviewed`,
						exact: true,
					})
					.click();
				await page
					.getByRole("dialog")
					.last()
					.getByRole("button", {
						name: /^(确认导入|Confirm import)$/,
						exact: true,
					})
					.click();
				await expect(importer.locator(".pw-smart-receipt")).toBeVisible();
				const savedDialog = page.locator(".password-smart-import-dialog");
				if (count === 1) {
					await expect(importer.locator(".pw-work-list-row")).toHaveCount(3);
					await savedDialog
						.locator(":scope > header")
						.getByRole("button", { name: /^(关闭|Close)$/, exact: true })
						.click();
					await page
						.getByRole("dialog")
						.last()
						.getByRole("button", {
							name: /^(关闭并清空|Close and clear)$/,
							exact: true,
						})
						.click();
					await expect(importer).toBeHidden();
					await expect(entries).toHaveCount(4);
					return;
				}
				await expect(
					savedDialog.getByRole("button", {
						name: /^(关闭|Close)$/,
						exact: true,
					}),
				).toHaveCount(1);
				await expect(
					savedDialog.getByRole("combobox", {
						name: /^(其他输入方式|Other input methods)$/,
					}),
				).toHaveCount(0);
				await screenshot("import-complete");
				await savedDialog
					.getByRole("button", { name: t("pwConnectTitle"), exact: true })
					.click();
				await expect(importer).toBeHidden();
				await expect(page.locator(".vault-connect-dialog")).toBeVisible();
				await expect(page.getByRole("dialog")).toHaveCount(1);
				await expect(
					page
						.locator(".vault-connect-dialog")
						.getByRole("heading", { name: t("pwConnectTitle"), exact: true }),
				).toBeFocused();
				await expect(entries).toHaveCount(4);
			}
			async function linkAll() {
				const dialog = page.locator(".vault-connect-dialog");
				if (!(await dialog.isVisible())) {
					await vault();
					await page
						.getByRole("button", { name: t("pwConnectTitle"), exact: true })
						.click();
				}
				await expect(dialog.locator(".vault-connect-conflict")).toHaveCount(0);
				await expect(dialog.locator(".vault-connect-account")).toHaveCount(4);
				await dialog
					.getByRole("button", { name: t("pwConnectSelectAll"), exact: true })
					.click();
				await dialog
					.getByRole("button", { name: t("pwConnectLocal"), exact: true })
					.click();
				await dialog
					.getByRole("button", { name: t("pwConnectSave"), exact: true })
					.click();
				await expect(dialog).toBeHidden();
			}
			async function graph(
				title: string,
				nodes: number,
				edges: number,
				stage: string,
			) {
				await vault();
				await entry(title).locator(".password-vault-linked-asset").click();
				await waitForAccountGraphLayout(page, { nodes, edges });
				await expectAccountGraphGeometry(page);
				await expectReadableAccountGraph(page, {
					all: width > 600,
					centered: false,
				});
				const graph = activeAccountGraph(page);
				const value = await graph.evaluate((element) => ({
					nodes: [...element.querySelectorAll<HTMLElement>(".react-flow__node")]
						.map((node) => node.dataset.id ?? "")
						.sort(),
					edges: [...element.querySelectorAll<HTMLElement>(".react-flow__edge")]
						.map((edge) => edge.dataset.id ?? "")
						.sort(),
				}));
				expect(new Set(value.nodes).size).toBe(nodes);
				expect(new Set(value.edges).size).toBe(edges);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				).toBe(true);
				snapshots.push({ stage, ...value });
				return value;
			}
			async function trashAccount(title: string) {
				await vault();
				await entry(title).locator(".password-vault-linked-asset").click();
				await page
					.locator(".page-header")
					.getByRole("button", { name: trash, exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: cancel, exact: true })
					.click();
				await expect(
					page.getByRole("heading", { name: title, exact: true }).first(),
				).toBeVisible();
				await page
					.locator(".page-header")
					.getByRole("button", { name: trash, exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: trash, exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
			}
			async function restoreAccount(title: string) {
				await page.goto("/trash");
				const row = page
					.locator(".trash-row[data-asset-id]")
					.filter({ has: page.getByText(title, { exact: true }) });
				await expect(row).toHaveCount(1);
				await row.getByRole("button", { name: restore, exact: true }).click();
				await expect(row).toHaveCount(0);
			}
			async function purgeAccount(title: string) {
				await page.goto("/trash");
				const row = page
					.locator(".trash-row[data-asset-id]")
					.filter({ has: page.getByText(title, { exact: true }) });
				await row.getByRole("button", { name: purge, exact: true }).click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: cancel, exact: true })
					.click();
				await expect(row).toHaveCount(1);
				await row.getByRole("button", { name: purge, exact: true }).click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: purge, exact: true })
					.click();
				await expect(row).toHaveCount(0);
			}
			async function removeNotebookLine() {
				await graph(titles[0], 4, 3, "before-line-delete");
				const details = await setAccountRelationDetailsOpen(page);
				const row = details
					.locator(".relation-row")
					.filter({ hasText: titles[2] });
				await row
					.getByRole("button", { name: /^(删除关系|Delete connection) ·/ })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", {
						name: zh ? "删除关系" : "Delete connection",
						exact: true,
					})
					.click();
				await waitForAccountGraphLayout(page, { nodes: 3, edges: 2 });
			}
			try {
				await page.goto("/assets/vault");
				await h.createVault();
				await importPasswords(4);
				await linkAll();
				const initial = await graph(titles[0], 4, 3, "initial");
				await screenshot("initial-family");
				await linkAll();
				expect(await graph(titles[0], 4, 3, "repeat-link")).toEqual(initial);

				await removeNotebookLine();
				await page.goto("/trash");
				await page
					.locator(".trash-row[data-relation-id]")
					.getByRole("button", { name: restore, exact: true })
					.click();
				await expect(page.locator(".trash-row[data-relation-id]")).toHaveCount(
					0,
				);
				expect(await graph(titles[0], 4, 3, "line-restored")).toEqual(initial);
				await removeNotebookLine();
				await page.goto("/trash");
				await page
					.locator(".trash-row[data-relation-id]")
					.getByRole("button", { name: purge, exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: purge, exact: true })
					.click();
				await expect(page.locator(".trash-row")).toHaveCount(0);
				await graph(titles[0], 3, 2, "line-purged");
				await linkAll();
				const lineRebuilt = await graph(titles[0], 4, 3, "line-reimported");
				expect(lineRebuilt.nodes).toEqual(initial.nodes);
				expect(
					lineRebuilt.edges.filter((id) => !initial.edges.includes(id)),
				).toHaveLength(1);

				await trashAccount(titles[2]);
				await graph(titles[0], 3, 2, "leaf-trashed");
				await restoreAccount(titles[2]);
				expect(await graph(titles[0], 4, 3, "leaf-restored")).toEqual(
					lineRebuilt,
				);
				await trashAccount(titles[2]);
				await purgeAccount(titles[2]);
				await graph(titles[0], 3, 2, "leaf-purged");
				await linkAll();
				const leafRebuilt = await graph(titles[0], 4, 3, "leaf-reimported");
				expect(
					leafRebuilt.nodes.filter((id) => !initial.nodes.includes(id)),
				).toHaveLength(1);
				await screenshot("leaf-reimported");

				await trashAccount(titles[0]);
				await graph(titles[3], 1, 0, "center-trashed");
				await restoreAccount(titles[0]);
				expect(await graph(titles[0], 4, 3, "center-restored")).toEqual(
					leafRebuilt,
				);
				await trashAccount(titles[0]);
				await purgeAccount(titles[0]);
				await graph(titles[3], 1, 0, "center-purged");
				await linkAll();
				const centerRebuilt = await graph(titles[0], 4, 3, "center-reimported");
				expect(
					centerRebuilt.nodes.filter((id) => !leafRebuilt.nodes.includes(id)),
				).toHaveLength(1);

				await trashAccount(titles[2]);
				await linkAll();
				const restoredFamily = await graph(
					titles[0],
					4,
					3,
					"reimport-before-restore",
				);
				await page.goto("/trash");
				const oldAccount = page
					.locator(".trash-row[data-asset-id]")
					.filter({ has: page.getByText(titles[2], { exact: true }) });
				await oldAccount
					.getByRole("button", { name: restore, exact: true })
					.click();
				await expect(oldAccount.getByRole("alert")).toBeVisible();
				await expect(oldAccount).toHaveCount(1);
				await screenshot("restore-duplicate-blocked");
				await oldAccount
					.getByRole("link", {
						name: zh ? "查看已有账号" : "View existing account",
						exact: true,
					})
					.click();
				await expect(
					page.getByRole("heading", { name: titles[2], exact: true }),
				).toBeVisible();
				await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
				await purgeAccount(titles[2]);
				expect(await graph(titles[0], 4, 3, "old-duplicate-purged")).toEqual(
					restoredFamily,
				);

				await vault();
				await entry(titles[3])
					.getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true })
					.click();
				await expect(entries).toHaveCount(3);
				await page
					.locator(".password-vault-entry-trash")
					.getByRole("button", { name: t("pwVaultRestoreEntry"), exact: true })
					.click();
				await expect(entries).toHaveCount(4);
				expect(await graph(titles[0], 4, 3, "password-restored")).toEqual(
					restoredFamily,
				);
				await vault();
				await entry(titles[3])
					.getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true })
					.click();
				await page
					.locator(".password-vault-entry-trash")
					.getByRole("button", { name: purge, exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: purge, exact: true })
					.click();
				await expect(entries).toHaveCount(3);
				expect(await graph(titles[0], 4, 3, "password-purged")).toEqual(
					restoredFamily,
				);
				await vault();
				await importPasswords(1);
				await linkAll();
				expect(await graph(titles[0], 4, 3, "password-reimported")).toEqual(
					restoredFamily,
				);

				for (const title of titles) await trashAccount(title);
				await page.goto("/assets/account");
				await expect(page.locator(".asset-account-card")).toHaveCount(0);
				await page.goto("/trash");
				await page.getByRole("button", { name: empty, exact: true }).click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: empty, exact: true })
					.click();
				await expect(page.locator(".trash-row")).toHaveCount(0);
				await linkAll();
				const final = await graph(titles[0], 4, 3, "all-reimported");
				expect(
					final.nodes.every((id) => !restoredFamily.nodes.includes(id)),
				).toBe(true);
				await linkAll();
				expect(await graph(titles[0], 4, 3, "final-repeat")).toEqual(final);
				await screenshot("final-family");
				await page.goto("/assets/account");
				await expect(page.locator(".asset-account-card")).toHaveCount(4);

				const state = await exportedState(page, zh, "lifecycle-final.ka1");
				const liveAssets = state.assets.filter((asset) => !asset.deleted);
				expect(liveAssets).toHaveLength(4);
				const liveIds = new Set(liveAssets.map((asset) => asset.id));
				const liveLines = state.relations.filter((line) => !line.deleted);
				expect(liveLines).toHaveLength(3);
				expect(
					liveLines.every(
						(line) => liveIds.has(line.from) && liveIds.has(line.to),
					),
				).toBe(true);
				await vault();
				const downloading = page.waitForEvent("download");
				await page
					.getByRole("button", { name: t("pwVaultExport"), exact: true })
					.click();
				const filename = info.outputPath("lifecycle-final.kdbx");
				await (await downloading).saveAs(filename);
				const content = await inspectVisualKdbx(filename);
				expect(content).toHaveLength(4);
				expect(
					content.every(
						(entry) =>
							entry.draft.password === password &&
							entry.draft.linkedAssetIds.length === 1 &&
							liveIds.has(entry.draft.linkedAssetIds[0]),
					),
				).toBe(true);
				writeFileSync(
					join(evidence, `${locale}-${width}-lifecycle.json`),
					JSON.stringify(
						{
							snapshots,
							liveAssets: liveAssets.length,
							liveRelations: liveLines.length,
							kdbxEntries: content.length,
							stalePointers: 0,
							pageErrors: h.errors,
						},
						null,
						2,
					),
				);
				expect(h.errors).toEqual([]);
			} finally {
				await h.close();
			}
		});
	}
