import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
	inspectVisualKdbx,
	visualHarness,
	visualMaster,
} from "./fixtures/password-smart-import-visual";
import { selectChoice } from "./helpers/select-choice";
import {
	activeAccountGraph,
	expectAccountGraphGeometry,
	setAccountRelationDetailsOpen,
	waitForAccountGraphLayout,
} from "./helpers/account-graph";

test.describe.configure({ mode: "parallel" });
test.setTimeout(240_000);
const email = "shared.matrix@example.test",
	phone = "13900001234",
	other = "other.matrix@example.test";
const names = {
	a: "Archive alpha",
	b: "Archive beta",
	phone: "Phone service",
	alias: "Published alias",
	latest: "Latest service",
	unused: "Not imported",
	plus: "Plus service",
	later: "Later service",
};
const evidence =
	process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/stackperch-mailbox-matrix-evidence";
for (const locale of ["zh-CN", "en"] as const)
	for (const width of [1536, 390]) {
		test(`${locale} ${width}px keeps shared email and phone complete across existing accounts and lifecycle changes`, async ({
			browser,
		}, info) => {
			const h = await visualHarness(browser, locale, { width, height: 1000 }),
				{ page, t } = h,
				zh = locale === "zh-CN";
			const copy = {
				add: zh ? "新增" : "Add",
				save: zh ? "保存" : "Save",
				edit: zh ? "编辑" : "Edit",
				close: zh ? "关闭" : "Close",
				trash: zh ? "移至回收站" : "Move to trash",
				restore: zh ? "恢复" : "Restore",
				purge: zh ? "彻底删除" : "Delete permanently",
				deleteLine: zh ? "删除关系" : "Delete connection",
			};
			const snapshots: unknown[] = [];
			mkdirSync(evidence, { recursive: true });
			const screenshot = async (stage: string) => {
				await expect(page.locator(".toast")).toHaveCount(0, { timeout: 7000 });
				await page.screenshot({
					path: join(evidence, `${locale}-${width}-${stage}.png`),
				});
			};
			const card = (name: string) =>
				page.locator(".asset-account-card").filter({
					has: page.locator("strong").getByText(name, { exact: true }),
				});
			async function openAccount(name: string) {
				await page.goto("/assets/account");
				await expect(card(name)).toHaveCount(1);
				await card(name).click();
				await expect(page.locator(".page-header h1")).toHaveText(name);
			}
			async function createAccount(
				name: string,
				username: string,
				category = "other",
				checkDefault = false,
			) {
				await page.goto("/assets/account");
				await page.getByRole("button", { name: copy.add, exact: true }).click();
				const form = page.getByRole("dialog");
				if (checkDefault)
					await expect(form.locator("#category")).toHaveAttribute(
						"data-value",
						"other",
					);
				await form.locator("#name").fill(name);
				await form.locator("#username").fill(username);
				await selectChoice(form.locator("#category"), category);
				if (name === names.alias) {
					await form
						.locator("#url")
						.fill("https://example.test/unchanged/path?public=yes#keep");
					await form
						.locator("#notes")
						.fill("Private ordinary note stays unchanged");
				}
				await form
					.getByRole("button", { name: copy.save, exact: true })
					.click();
				await expect(form).toBeHidden();
				const href = await card(name).getAttribute("href");
				if (!href) throw Error("Created account link missing");
				return href;
			}
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
			async function password(
				name: string,
				username: string,
				aliases: string[] = [],
				assetPath?: string,
			) {
				await page
					.getByRole("button", { name: t("pwVaultNewEntry"), exact: true })
					.click();
				await page.locator("#password-vault-entry-title").fill(name);
				await page.locator("#password-vault-entry-username").fill(username);
				for (let i = 0; i < aliases.length; i++) {
					await page
						.getByRole("button", {
							name: t("pwVaultAddIdentifier"),
							exact: true,
						})
						.click();
					await page
						.locator(`#password-vault-entry-identifier-${i + 1}`)
						.fill(aliases[i]);
				}
				await page
					.locator("#password-vault-entry-password")
					.fill(`Synthetic-${name}!42`);
				if (assetPath) {
					await page.locator("#password-vault-entry-asset").press("ArrowDown");
					const popup = page.getByRole("listbox");
					const option = popup.locator(
						`[role="option"][data-value="${assetPath.split("/").pop()}"]`,
					);
					await expect(option).toBeVisible();
					await option.hover();
					await option.click();
					await expect(page.locator(".password-vault-linked-chip")).toHaveCount(
						1,
					);
					await expect(popup).toBeHidden();
				}
				await page
					.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
			}
			async function connect(name: string) {
				await page
					.getByRole("button", { name: t("pwConnectTitle"), exact: true })
					.click();
				const dialog = page.locator(".vault-connect-dialog");
				await dialog
					.locator(".vault-connect-account")
					.filter({ has: page.getByText(name, { exact: true }) })
					.getByRole("checkbox")
					.check();
				await expect(
					dialog.getByRole("button", { name: t("pwConnectSave"), exact: true }),
				).toBeEnabled();
				return dialog;
			}
			async function saveConnections() {
				const dialog = page.locator(".vault-connect-dialog");
				await dialog
					.getByRole("button", { name: t("pwConnectSave"), exact: true })
					.click();
				await expect(dialog).toBeHidden();
			}
			async function graph(
				name: string,
				nodes: number,
				edges: number,
				stage: string,
			) {
				await openAccount(name);
				await page
					.getByRole("button", { name: t("accountGraphDirect"), exact: true })
					.click();
				await waitForAccountGraphLayout(page, { nodes, edges });
				await expectAccountGraphGeometry(page);
				const snapshot = await activeAccountGraph(page).evaluate((el) => ({
					nodes: [...el.querySelectorAll<HTMLElement>(".react-flow__node")]
						.map((x) => x.dataset.id)
						.sort(),
					edges: [...el.querySelectorAll<HTMLElement>(".react-flow__edge")]
						.map((x) => x.dataset.id)
						.sort(),
				}));
				snapshots.push({ stage, ...snapshot });
				return snapshot;
			}
			async function editPrimary(name: string, username: string) {
				await openAccount(name);
				await page
					.locator(".page-header")
					.getByRole("button", { name: copy.edit, exact: true })
					.click();
				await page.locator("#username").fill(username);
				await page
					.getByRole("dialog")
					.getByRole("button", { name: copy.save, exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
			}
			async function deleteBetaLine() {
				await graph(email, 6, 5, "before-line-delete");
				const details = await setAccountRelationDetailsOpen(page);
				await details
					.locator(".relation-row")
					.filter({ hasText: names.b })
					.getByRole("button", { name: /^(删除关系|Delete connection) ·/ })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: copy.deleteLine, exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await waitForAccountGraphLayout(page, { nodes: 5, edges: 4 });
			}
			const betaTrash = (page: Page) =>
				page
					.locator(".trash-row[data-relation-id]")
					.filter({ hasText: names.b });
			try {
				await createAccount(names.a, ` ${email} `);
				await createAccount(names.b, email.toUpperCase());
				await createAccount(names.phone, "+86 139 0000 1234");
				const aliasPath = await createAccount(names.alias, phone);
				await createAccount(names.plus, "shared.matrix+other@example.test");
				await page.goto("/assets/vault");
				await h.createVault();
				await password(names.alias, phone, [email], aliasPath);
				await password(names.latest, email, [phone]);
				await password(names.unused, email);
				const first = await connect(names.latest);
				await expect(first.locator(".vault-connect-suggestion")).toHaveCount(7);
				await expect(
					first
						.locator(".vault-connect-suggestion")
						.filter({ hasText: names.alias }),
				).toHaveCount(2);
				await expect(
					first
						.locator(".vault-connect-suggestion")
						.filter({ hasText: names.unused }),
				).toHaveCount(0);
				await screenshot("complete-preview");
				await saveConnections();
				const initial = await graph(email, 5, 4, "initial-complete-mailbox");
				await screenshot("complete-mailbox");
				await graph(phone, 4, 3, "initial-complete-phone");
				await screenshot("complete-phone");
				await openAccount(names.alias);
				await expect(page.locator(".asset-supplemental-notes")).toHaveText(
					"Private ordinary note stays unchanged",
				);
				await expect(
					page.getByRole("link", {
						name: "https://example.test/unchanged/path?public=yes#keep",
						exact: true,
					}),
				).toHaveAttribute(
					"href",
					"https://example.test/unchanged/path?public=yes#keep",
				);
				await vault();
				await connect(names.latest);
				await saveConnections();
				expect(await graph(email, 5, 4, "repeat-import")).toEqual(initial);
				await page.goto("/assets/account");
				await expect(page.locator(".asset-account-card")).toHaveCount(8);
				await expect(card(names.unused)).toHaveCount(0);
				await createAccount(names.later, email, "other", true);
				const expanded = await graph(email, 6, 5, "new-account-after-identity");
				await editPrimary(names.a, other);
				await graph(email, 5, 4, "primary-changed-away");
				await createAccount(other, other, "email");
				await graph(other, 2, 1, "identity-created-after-account");
				await editPrimary(names.a, email);
				expect(await graph(email, 6, 5, "primary-round-trip")).toEqual(
					expanded,
				);
				await graph(other, 1, 0, "old-primary-detached");
				await deleteBetaLine();
				await vault();
				const deletedPreview = await connect(names.latest);
				await expect(
					deletedPreview
						.locator(".vault-connect-suggestion")
						.filter({ hasText: names.b })
						.getByRole("checkbox"),
				).not.toBeChecked();
				await saveConnections();
				await graph(email, 5, 4, "deleted-line-stays-deleted");
				await page.goto("/trash");
				await betaTrash(page)
					.getByRole("button", { name: copy.restore, exact: true })
					.click();
				await expect(betaTrash(page)).toHaveCount(0);
				expect(await graph(email, 6, 5, "line-restored")).toEqual(expanded);
				await deleteBetaLine();
				await page.goto("/trash");
				await betaTrash(page)
					.getByRole("button", { name: copy.purge, exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: copy.purge, exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await vault();
				const purgedPreview = await connect(names.latest);
				await expect(
					purgedPreview
						.locator(".vault-connect-suggestion")
						.filter({ hasText: names.b }),
				).toHaveCount(0);
				await saveConnections();
				await graph(email, 5, 4, "purged-line-not-recreated-by-another-import");
				await page.goto("/assets/account");
				const betaPath = await card(names.b).getAttribute("href");
				if (!betaPath) throw Error("Existing beta account link missing");
				await vault();
				await password(names.b, email, [], betaPath);
				await connect(names.b);
				await saveConnections();
				await graph(email, 6, 5, "explicit-source-reimport");
				const laterBefore = expanded.nodes.filter(
					(id) => !initial.nodes.includes(id),
				);
				expect(laterBefore).toHaveLength(1);
				await openAccount(names.later);
				await page
					.locator(".page-header")
					.getByRole("button", { name: copy.trash, exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: copy.trash, exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await graph(email, 5, 4, "account-deleted");
				await page.goto("/trash");
				const laterTrash = page
					.locator(".trash-row[data-asset-id]")
					.filter({ hasText: names.later });
				await laterTrash
					.getByRole("button", { name: copy.restore, exact: true })
					.click();
				await expect(laterTrash).toHaveCount(0);
				await graph(email, 6, 5, "account-restored");
				await openAccount(names.later);
				await page
					.locator(".page-header")
					.getByRole("button", { name: copy.trash, exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: copy.trash, exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await page.goto("/trash");
				await laterTrash
					.getByRole("button", { name: copy.purge, exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: copy.purge, exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await createAccount(names.later, email);
				const rebuilt = await graph(
					email,
					6,
					5,
					"account-purged-and-recreated",
				);
				expect(rebuilt.nodes).not.toContain(laterBefore[0]);
				await screenshot("final-complete-mailbox");
				await vault();
				const download = page.waitForEvent("download");
				await page
					.getByRole("button", { name: t("pwVaultExport"), exact: true })
					.click();
				const path = info.outputPath("mailbox-matrix.kdbx");
				await (await download).saveAs(path);
				const saved = await inspectVisualKdbx(path);
				expect(saved).toHaveLength(4);
				expect(
					saved.find((x) => x.draft.title === names.unused)?.draft
						.linkedAssetIds,
				).toEqual([]);
				expect(
					saved.find((x) => x.draft.title === names.alias)?.draft,
				).toMatchObject({
					username: phone,
					usernameAliases: [email],
					password: `Synthetic-${names.alias}!42`,
					linkedAssetIds: [aliasPath.split("/").pop()],
				});
				expect(h.errors).toEqual([]);
				writeFileSync(
					join(evidence, `${locale}-${width}-shared-identity.json`),
					`${JSON.stringify({ snapshots, pageErrors: h.errors }, null, 2)}\n`,
				);
			} finally {
				await h.close();
			}
		});
	}
