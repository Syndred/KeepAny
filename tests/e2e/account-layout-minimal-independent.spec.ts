import { portableCandidate } from "./helpers/portable-candidate";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";

const evidence =
	process.env.KEEPANY_INDEPENDENT_EVIDENCE ??
	"test-results/account-layout-independent/minimal";
mkdirSync(evidence, { recursive: true });
const master = "Independent minimal synthetic 2026!";
for (const language of ["zh-CN", "en"] as const)
	for (const width of [390, 768, 1280, 1920, 2560]) {
		test(`independent minimal detail ${language} ${width}: AL04 missing optional fields`, async ({
			browser,
		}) => {
			test.setTimeout(120_000);
			const context = await browser.newContext({
				viewport: { width, height: 1050 },
				locale: language,
			});
			await context.addInitScript(
				(locale) => localStorage.setItem("keepany-language", locale),
				language,
			);
			const page = await context.newPage(),
				t = (key: string) =>
					(resources[language].translation as Record<string, string>)[key] ??
					key;
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const steps: object[] = [];
			try {
				await page.goto("/settings#advanced-settings");
				await page
					.getByRole("button", { name: t("loadSample"), exact: true })
					.click();
				await expect(
					page.getByRole("button", {
						name: t("sampleLibraryPresent"),
						exact: true,
					}),
				).toBeDisabled();
				await page.goto("/accounts");
				await page.locator(".unified-vault-access summary").click();
				await page.locator("#password-vault-master").fill(master);
				await page.locator("#password-vault-master-confirm").fill(master);
				await page
					.getByRole("button", { name: t("pwVaultCreate"), exact: true })
					.click();
				await page.locator(".asset-account-phone").click();
				await page
					.getByRole("button", {
						name: t("workspaceShowPasswords"),
						exact: true,
					})
					.click();
				const detail = page.locator(".account-passwords-section");
				await expect(detail.locator(".password-vault-entry")).toHaveCount(0);
				await detail
					.locator(".password-vault-toolbar")
					.getByRole("button", { name: t("pwVaultNewEntry"), exact: true })
					.click();
				await page
					.locator("#password-vault-entry-title")
					.fill("Independent minimal linked login");
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
					.click();
				const card = detail.locator(".password-vault-entry");
				await expect(card).toContainText("Independent minimal linked login");
				await expect(card).toContainText(t("pwVaultNoPassword"));
				for (const key of [
					"pwVaultRevealPassword",
					"pwVaultCopyPassword",
					"pwVaultCopyUsername",
				])
					await expect(
						card.getByRole("button", { name: t(key), exact: true }),
					).toBeDisabled();
				await expect(card.locator(".password-vault-linked-asset")).toHaveCount(
					1,
				);
				const geometry = await card.evaluate((node) => {
					const box = node.getBoundingClientRect();
					return {
						width: box.width,
						values: [
							...node.querySelectorAll<HTMLElement>(".password-vault-value"),
						].map((value) => ({
							width: value.clientWidth,
							overflow: value.scrollWidth > value.clientWidth,
						})),
						buttons: [
							...node.querySelectorAll<HTMLElement>(
								".password-vault-value-actions button,.password-vault-entry-actions button",
							),
						].map((button) => {
							const r = button.getBoundingClientRect();
							return {
								width: r.width,
								height: r.height,
								left: r.left - box.left,
								right: box.right - r.right,
							};
						}),
					};
				});
				for (const value of geometry.values) {
					expect(value.width).toBeGreaterThan(150);
					expect(value.overflow).toBe(false);
				}
				for (const button of geometry.buttons) {
					expect(Number(button.width.toFixed(3))).toBeGreaterThanOrEqual(44);
					expect(Number(button.height.toFixed(3))).toBeGreaterThanOrEqual(44);
					expect(button.left).toBeGreaterThanOrEqual(0);
					expect(button.right).toBeGreaterThanOrEqual(0);
				}
				await detail.scrollIntoViewIfNeeded();
				await detail.screenshot({
					path: join(evidence, `${language}-${width}-detail-minimal.png`),
				});
				steps.push({ step: "minimal-visible-disabled-fields", geometry });
				await card
					.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
					.click();
				await expect(
					page.locator("#password-vault-entry-password"),
				).toHaveValue("");
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("close"), exact: true })
					.click();
				await page.reload();
				await page
					.getByRole("button", {
						name: t("workspaceShowPasswords"),
						exact: true,
					})
					.click();
				await page.locator("#password-vault-unlock-master").fill(master);
				await page
					.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
					.click();
				await expect(card).toContainText("Independent minimal linked login");
				await expect(card).toContainText(t("pwVaultNoPassword"));
				expect(errors).toEqual([]);
				steps.push({ step: "reload-unlock-recalled", result: "passed" });
			} finally {
				const release = portableCandidate().release;
				writeFileSync(
					join(evidence, `${language}-${width}-minimal.json`),
					JSON.stringify(
						{
							language,
							width,
							sourceCommit: release?.sourceCommit,
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
