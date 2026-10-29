import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	inspectVisualKdbx,
	visualHarness,
	visualMaster,
} from "./fixtures/password-smart-import-visual";
import { selectChoice } from "./helpers/select-choice";
import { openVaultAccess, prepareVaultWorkspace, revealPasswordEntries } from "./helpers/vault-access";
import {
	activeAccountGraph,
	expectAccountGraphGeometry,
	waitForAccountGraphLayout,
} from "./helpers/account-graph";

test.describe.configure({ mode: "parallel" });
test.setTimeout(120_000);
const email = "dual.login@gmail.com",
	phone = "13800138000";
const title = "Dual Login Account",
	secret = "Synthetic-dual-login!42";
const evidence =
	process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/stackperch-dual-login-evidence";

for (const locale of ["zh-CN", "en"] as const)
	for (const width of [1536, 390]) {
		test(`${locale} ${width}px creates both login connections when saving without pressing local match`, async ({
			browser,
		}, info) => {
			const h = await visualHarness(browser, locale, { width, height: 1000 });
			const { page, t } = h,
				zh = locale === "zh-CN";
			const primary = width === 390 ? phone : email;
			const alias = width === 390 ? email : phone;
			mkdirSync(evidence, { recursive: true });
			const shot = async (stage: string) => {
				await expect(page.locator(".toast")).toHaveCount(0, { timeout: 7000 });
				return page.screenshot({
					path: join(evidence, `${locale}-${width}-${stage}.png`),
				});
			};
			async function vault() {
				await page.goto("/assets/vault");
				await prepareVaultWorkspace(page);
				await openVaultAccess(page);
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
				await revealPasswordEntries(page);
				await revealPasswordEntries(page);
			}
			async function connections() {
				await page
					.getByRole("button", { name: t("pwConnectTitle"), exact: true })
					.click();
				const dialog = page.locator(".vault-connect-dialog");
				await dialog
					.locator(".vault-connect-account")
					.getByRole("checkbox", { name: new RegExp(`^${title}`) })
					.check();
				const suggestions = dialog.locator(".vault-connect-suggestion");
				await expect(suggestions).toHaveCount(2);
				await expect(suggestions.filter({ hasText: email })).toHaveCount(1);
				await expect(suggestions.filter({ hasText: phone })).toHaveCount(1);
				for (const identifier of [email, phone])
					expect(
						(
							await suggestions.filter({ hasText: identifier }).innerText()
						).split(identifier),
					).toHaveLength(2);
				await expect(suggestions.locator("input:checked")).toHaveCount(2);
				await expect(
					dialog.getByRole("button", { name: t("pwConnectSave"), exact: true }),
				).toBeEnabled();
				return { dialog, suggestions };
			}
			async function graph() {
				await expect(page.locator(".password-vault-linked-asset")).toBeAttached();
				await revealPasswordEntries(page);
				await page.locator(".password-vault-linked-asset").click();
				await waitForAccountGraphLayout(page, { nodes: 3, edges: 2 });
				await expectAccountGraphGeometry(page);
				return activeAccountGraph(page).evaluate((el) => ({
					nodes: [...el.querySelectorAll<HTMLElement>(".react-flow__node")]
						.map((node) => node.dataset.id)
						.sort(),
					edges: [...el.querySelectorAll<HTMLElement>(".react-flow__edge")]
						.map((edge) => edge.dataset.id)
						.sort(),
				}));
			}
			try {
				// The phone already exists, exactly as in the reported manual-picker case.
				await page.goto("/assets/account");
				await page
					.getByRole("button", { name: zh ? "新增" : "Add", exact: true })
					.click();
				await page.locator("#password-vault-entry-title").fill(phone);
				await page.locator("#password-vault-entry-username").fill(phone);
				await selectChoice(page.locator("#account-entry-category"), "phone");
				await page
					.getByRole("dialog")
					.getByRole("button", { name: zh ? "保存" : "Save", exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await page.goto("/assets/vault");
				await prepareVaultWorkspace(page);
				await h.createVault();
				// Pure KDBX preparation uses real file import. The real editor below
				// still exercises manual identifiers and password generation.
				await h.seedExisting({ title, username: primary, password: "" });
				await page.locator(".password-vault-entry").filter({ hasText: title }).getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
				await page.locator("#password-vault-entry-title").fill(title);
				await page.locator("#password-vault-entry-username").fill(primary);
				await page
					.getByRole("button", { name: t("pwVaultAddIdentifier"), exact: true })
					.click();
				await page.locator("#password-vault-entry-identifier-1").fill(alias);
				const generator = page.getByRole("button", {
					name: t("pwVaultGeneratePassword"),
					exact: true,
				});
				await expect(generator).toHaveCount(1);
				await generator.click();
				await expect(
					page.locator("#password-vault-entry-password"),
				).not.toHaveValue("");
				await page.locator("#password-vault-entry-password").fill(secret);
				await page
					.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
				const first = await connections();
				await shot("automatic-suggestions");
				await first.dialog
					.getByRole("button", { name: t("pwConnectSave"), exact: true })
					.click();
				await expect(first.dialog).toBeHidden();
				const initial = await graph();
				await shot("both-connections");

				await page
					.getByRole("button", {
						name: zh ? "添加关联" : "Add connection",
						exact: true,
					})
					.click();
				await page.locator("#relation-target").press("ArrowDown");
				await expect(
					page.getByRole("option", { name: email, exact: true }),
				).toBeVisible();
				await expect(
					page.getByRole("option", { name: phone, exact: true }),
				).toBeVisible();
				await shot("manual-targets");
				await page.keyboard.press("Escape");
				await page
					.getByRole("dialog")
					.getByRole("button", { name: zh ? "关闭" : "Close", exact: true })
					.click();

				await vault();
				const again = await connections();
				const phoneChoice = again.suggestions
					.filter({ hasText: phone })
					.getByRole("checkbox");
				await phoneChoice.uncheck();
				await again.dialog
					.locator(".vault-connect-account textarea")
					.fill("Synthetic optional hint");
				await expect(phoneChoice).not.toBeChecked();
				await phoneChoice.check();
				await again.dialog
					.locator(".vault-connect-account")
					.getByRole("checkbox", { name: new RegExp(`^${title}`) })
					.uncheck();
				await expect(again.suggestions).toHaveCount(0);
				await expect(
					again.dialog.getByRole("button", {
						name: t("pwConnectSave"),
						exact: true,
					}),
				).toBeDisabled();
				await again.dialog
					.locator(".vault-connect-account")
					.getByRole("checkbox", { name: new RegExp(`^${title}`) })
					.check();
				await expect(again.suggestions.locator("input:checked")).toHaveCount(2);
				await again.dialog
					.getByRole("button", { name: t("pwConnectSave"), exact: true })
					.click();
				await expect(again.dialog).toBeHidden();
				expect(await graph()).toEqual(initial);
				await page.goto("/assets/account");
				await expect(page.locator(".asset-account-card")).toHaveCount(3);

				await vault();
				const downloading = page.waitForEvent("download");
				await page
					.getByRole("button", { name: t("pwVaultExport"), exact: true })
					.click();
				const filename = info.outputPath("dual-login.kdbx");
				await (await downloading).saveAs(filename);
				const saved = await inspectVisualKdbx(filename);
				expect(saved).toHaveLength(1);
				expect(saved[0].draft).toMatchObject({
					username: primary,
					usernameAliases: [alias],
					password: secret,
				});
				expect(saved[0].draft.linkedAssetIds).toHaveLength(1);
				expect(h.errors).toEqual([]);
			} finally {
				await h.close();
			}
		});
	}
