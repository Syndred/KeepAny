import { confirmSampleLibrary } from "./helpers/sample-library";
import { portableCandidate } from "./helpers/portable-candidate";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { openStandaloneEntryDraft, saveStandaloneEntryDraft } from "./helpers/standalone-entry";

// Independent acceptance: only public navigation/UI, fresh synthetic library per case.
const evidence =
	process.env.KEEPANY_INDEPENDENT_EVIDENCE ??
	"test-results/account-layout-independent";
mkdirSync(evidence, { recursive: true });
const master = "Independent synthetic vault 2026!";
const longTitle =
	"Independent synthetic login — long title with readable complete metadata across every consuming container";
const longUrl = `https://independent.example.test/${"readable-path/".repeat(12)}`;
const notes =
	"Synthetic notes only. Every field must remain readable without a narrow value column.\n第二行虚构备注：长内容应完整显示，不裁剪、不丢失。";

for (const language of ["zh-CN", "en"] as const)
	for (const width of [390, 768, 1280, 1920, 2560]) {
		test(`independent ${language} ${width}: AL02 AL03 AL04 AL05 shared consumers`, async ({
			browser,
		}) => {
			test.setTimeout(240_000);
			const context = await browser.newContext({
				viewport: { width, height: 1050 },
				locale: language,
			});
			await context.addInitScript(
				(locale) => localStorage.setItem("keepany-language", locale),
				language,
			);
			const page = await context.newPage();
			page.setDefaultTimeout(15_000);
			const t = (key: string) =>
				(resources[language].translation as Record<string, string>)[key] ?? key;
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const steps: object[] = [];
			const stem = `${language}-${width}`;
			async function capture(name: string, target?: Locator) {
				if (target) {
					await target.scrollIntoViewIfNeeded();
					await target.screenshot({
						path: join(evidence, `${stem}-${name}.png`),
					});
				} else
					await page.screenshot({
						path: join(evidence, `${stem}-${name}.png`),
						fullPage: true,
					});
				steps.push({
					step: name,
					url: page.url(),
					screenshot: `${stem}-${name}.png`,
				});
			}
			async function readable(card: Locator, name: string) {
				await expect(card).toBeVisible();
				const metrics = await card.evaluate((node) => {
					const box = node.getBoundingClientRect();
					const values = [
						...node.querySelectorAll<HTMLElement>(".password-vault-value"),
					].map((value) => ({
						width: value.getBoundingClientRect().width,
						scroll: value.scrollWidth,
						client: value.clientWidth,
					}));
					const buttons = [
						...node.querySelectorAll<HTMLElement>(
							".password-vault-value-actions button",
						),
					].map((button) => {
						const r = button.getBoundingClientRect();
						return {
							width: r.width,
							height: r.height,
							left: r.left - box.left,
							right: box.right - r.right,
						};
					});
					return {
						width: box.width,
						values,
						buttons,
						overflow:
							document.documentElement.scrollWidth >
							document.documentElement.clientWidth,
					};
				});
				expect(metrics.overflow).toBe(false);
				for (const value of metrics.values) {
					expect(value.width).toBeGreaterThan(150);
					expect(value.scroll).toBeLessThanOrEqual(value.client + 1);
				}
				// CSS pixels are subtracted from large scroll coordinates; normalize only
				// floating point noise (<0.001px), while retaining the 44px requirement.
				for (const button of metrics.buttons) {
					expect(Number(button.width.toFixed(3))).toBeGreaterThanOrEqual(44);
					expect(Number(button.height.toFixed(3))).toBeGreaterThanOrEqual(44);
					expect(button.left).toBeGreaterThanOrEqual(0);
					expect(button.right).toBeGreaterThanOrEqual(0);
				}
				steps.push({ step: `${name}-geometry`, metrics });
			}
			async function toolbarFits(toolbar: Locator, name: string) {
				const geometry = await toolbar.evaluate((node) => {
					const box = node.getBoundingClientRect();
					return {
						width: box.width,
						controls: [
							...node.querySelectorAll<HTMLElement>("button, input"),
						].map((element) => {
							const rect = element.getBoundingClientRect();
							return {
								label:
									element.getAttribute("aria-label") ?? element.textContent,
								tag: element.tagName,
								left: rect.left - box.left,
								right: box.right - rect.right,
								width: rect.width,
								height: rect.height,
							};
						}),
					};
				});
				steps.push({ step: `${name}-toolbar-geometry`, geometry });
				for (const control of geometry.controls) {
					expect(
						Number(control.width.toFixed(3)),
						`${name} ${control.label} usable width`,
					).toBeGreaterThanOrEqual(control.tag === "INPUT" ? 150 : 44);
					expect(
						Number(control.height.toFixed(3)),
						`${name} ${control.label} touch height`,
					).toBeGreaterThanOrEqual(44);
					expect(
						control.left,
						`${name} ${control.label} left boundary`,
					).toBeGreaterThanOrEqual(-0.001);
					expect(
						control.right,
						`${name} ${control.label} right boundary`,
					).toBeGreaterThanOrEqual(-0.001);
				}
			}
			try {
				await page.goto("/settings#advanced-settings");
				await page
					.getByRole("button", { name: t("loadSample"), exact: true })
					.click();
await confirmSampleLibrary(page);
				await expect(
					page.getByRole("button", {
						name: t("sampleLibraryPresent"),
						exact: true,
					}),
				).toBeDisabled();
				await page.goto("/accounts");
				const access = page.locator(".unified-vault-access");
				await access.locator("summary").click();
				await page.locator("#password-vault-master").fill(master);
				await page.locator("#password-vault-master-confirm").fill(master);
				await page
					.getByRole("button", { name: t("pwVaultCreate"), exact: true })
					.click();
				const toolbar = page.locator(".password-vault-toolbar");
				const sampleButton = toolbar.getByRole("button", {
					name: t("sampleLogins"),
					exact: true,
				});
				const sampleTextLines = await sampleButton.evaluate((node) => {
					const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT),
						tops = new Set<number>();
					while (walker.nextNode()) {
						const range = document.createRange();
						range.selectNodeContents(walker.currentNode);
						for (const rect of range.getClientRects())
							tops.add(Math.round(rect.top));
					}
					return tops.size;
				});
				await capture("toolbar-sample-logins", toolbar);
				await toolbarFits(toolbar, "accounts");
				expect(
					sampleTextLines,
					"AL10 sample action label must not fold into a narrow icon cell",
				).toBe(1);
				await sampleButton.click();
				await expect(
					toolbar.getByRole("button", { name: t("sampleLogins"), exact: true }),
				).toHaveCount(0, { timeout: 30_000 });
				const categories = page
					.locator(".unified-account-list")
					.first()
					.locator(".asset-category-scroll > button");
				const categoryCount = await categories.count();
				for (let index = 1; index < categoryCount - 1; index++) {
					await categories.nth(index).click();
					const accounts = page.locator(".unified-account");
					if (await accounts.count()) {
						const account = accounts.first(),
							disclosure = account.locator(".unified-account-passwords");
						await disclosure.locator("summary").click();
						await expect(disclosure).toHaveJSProperty("open", true);
						if (await disclosure.locator(".password-vault-entry").count())
							await readable(
								disclosure.locator(".password-vault-entry").first(),
								`category-${index}`,
							);
						await capture(`category-${index}-expanded`, account);
					} else await capture(`category-${index}-empty`);
				}
				await categories.first().click();
				const query = page.getByRole("searchbox", {
					name: t("accountListSearch"),
					exact: true,
				});
				await query.fill("not-an-existent-synthetic-account");
				await expect(page.locator(".unified-account")).toHaveCount(0);
				await capture("filter-empty");
				await query.press("Escape");
				await expect(page.locator(".unified-account")).toHaveCount(8);
				await openStandaloneEntryDraft(page, t);
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("save"), exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeVisible();
				expect(
					await page
						.locator("#password-vault-entry-title")
						.evaluate(
							(node) => (node as HTMLInputElement).validity.valueMissing,
						),
				).toBe(true);
				await capture("required-error");
				await page
					.locator("#password-vault-entry-title")
					.fill("Cancelled synthetic draft");
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("close"), exact: true })
					.click();
				await expect(page.locator(".workspace-password-only")).toHaveCount(0);
				await openStandaloneEntryDraft(page, t);
				await page.locator("#password-vault-entry-title").fill(longTitle);
				await page
					.locator("#password-vault-entry-username")
					.fill("primary-independent@example.test");
				for (const alias of [
					"second-independent@example.test",
					"+1 202-555-0157",
				]) {
					await page
						.getByRole("dialog")
						.getByRole("button", {
							name: t("pwVaultAddIdentifier"),
							exact: true,
						})
						.click();
					await page
						.locator(".pw-smart-identifier-row input")
						.last()
						.fill(alias);
				}
				// The merged form exposes the one shared website field directly.
				await page.locator("#password-vault-entry-url").fill(longUrl);
				await page.locator("#password-vault-entry-notes").fill(notes);
				await saveStandaloneEntryDraft(page, t);
				const standalone = page.locator(
					".workspace-password-only .password-vault-entry",
				);
				await expect(standalone).toContainText(longTitle);
				await expect(standalone).toContainText(longUrl);
				await expect(standalone).toContainText(notes);
				await readable(standalone, "unlinked");
				await expect(
					standalone.getByRole("button", {
						name: t("pwVaultRevealPassword"),
						exact: true,
					}),
				).toBeDisabled();
				await capture("unlinked-long", standalone);
				await standalone
					.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
					.click();
				await page
					.locator("#password-vault-entry-title")
					.fill("Cancelled overwrite");
				await capture("unlinked-editor");
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("close"), exact: true })
					.click();
				await expect(standalone).toContainText(longTitle);
				const phoneAccount = page
					.locator(".unified-account")
					.filter({ has: page.locator(".asset-account-phone") });
				await phoneAccount.locator(".asset-account-card").click();
				await page
					.getByRole("button", {
						name: t("workspaceShowPasswords"),
						exact: true,
					})
					.click();
				const detail = page.locator(".account-passwords-section");
				await readable(
					detail.locator(".password-vault-entry").first(),
					"detail",
				);
				await capture("detail-embedded", detail);
				await toolbarFits(detail.locator(".password-vault-toolbar"), "detail");
				await detail
					.locator(".password-vault-entry")
					.first()
					.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
					.click();
				await page.locator("#password-vault-entry-notes").fill(notes);
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
					.click();
				await expect(detail).toContainText(notes);
				await page.reload();
				await page
					.getByRole("button", {
						name: t("workspaceShowPasswords"),
						exact: true,
					})
					.click();
				await page
					.locator("#password-vault-unlock-master")
					.fill("wrong synthetic master");
				await page
					.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
					.click();
				await expect(
					page
						.locator(".password-vault-message")
						.filter({ hasText: t("pwVaultUnlockFailed") }),
				).toBeVisible();
				await capture(
					"detail-unlock-error",
					page.locator(".account-passwords-section"),
				);
				await page.locator("#password-vault-unlock-master").fill(master);
				await page
					.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
					.click();
				await expect(detail).toContainText(notes);
				await readable(
					detail.locator(".password-vault-entry").first(),
					"detail-reloaded",
				);
				await capture("detail-reloaded", detail);
				// A full document navigation intentionally locks the in-memory KDBX session.
				await page.goto("/accounts");
				await expect(standalone).toHaveCount(0);
				const reentryAccess = page.locator(".unified-vault-access");
				if (
					!(await reentryAccess.evaluate(
						(node) => (node as HTMLDetailsElement).open,
					))
				)
					await reentryAccess.locator("summary").click();
				await page.locator("#password-vault-unlock-master").fill(master);
				await page
					.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
					.click();
				await expect(standalone).toContainText(longTitle);
				await query.fill(notes);
				await expect(page.locator(".workspace-password-only")).toHaveCount(0);
				await query.fill("");
				await readable(standalone, "unlinked-return");
				expect(errors).toEqual([]);
				steps.push({ step: "finished", errors, result: "passed" });
			} finally {
				const candidate = portableCandidate().release;
				writeFileSync(
					join(evidence, `${stem}-independent.json`),
					JSON.stringify(
						{
							language,
							width,
							sourceCommit: candidate?.sourceCommit,
							candidateVersion: candidate?.version,
							steps,
							errors,
						},
						null,
						2,
					),
				);
				await context.close();
			}
		});
	}
