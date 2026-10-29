import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { openVaultAccess } from "./helpers/vault-access";
import { openStandaloneEntryDraft, saveStandaloneEntryDraft } from "./helpers/standalone-entry";

const master = "Synthetic filtered unlink acceptance 2026!";

for (const language of ["zh-CN", "en"] as const) {
	for (const width of [390, 1280]) {
		test(`${language} ${width}px filtered unlink preserves entries and visible continuation focus`, async ({
			browser,
		}, info) => {
			test.setTimeout(120_000);
			const context = await browser.newContext({
				locale: language,
				viewport: { width, height: 900 },
			});
			await context.addInitScript(
				(value) => localStorage.setItem("keepany-language", value),
				language,
			);
			const page = await context.newPage();
			const t = (key: string) =>
				(resources[language].translation as Record<string, string>)[key] ?? key;
			const evidence =
				process.env.KEEPANY_EVIDENCE_DIR ?? info.outputPath("evidence");
			mkdirSync(evidence, { recursive: true });
			const stem = `filtered-unlink-${language}-${width}`;
			const observations: unknown[] = [];
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const accountName = "FC07 filtered account";
			const linkedTitle = "FC07 filtered login";
			const otherTitle = "FC07 adjacent login";
			const entries = page.locator(
				".password-vault-entry-list .password-vault-entry",
			);
			const card = (title: string) =>
				entries.filter({
					has: page.getByRole("heading", { name: title, exact: true }),
				});
			async function observe(stage: string) {
				observations.push({
					stage,
					...(await page.evaluate(() => {
						const active = document.activeElement as HTMLElement | null;
						const rect = active?.getBoundingClientRect();
						return {
							url: location.href,
							active: {
								tag: active?.tagName,
								id: active?.id,
								entryId:
									active?.closest<HTMLElement>("[data-entry-id]")?.dataset
										.entryId,
								rect: rect && { top: rect.top, bottom: rect.bottom },
							},
							filter: !!document.querySelector(".password-vault-filter"),
							entryIds: [
								...document.querySelectorAll<HTMLElement>(
									".password-vault-entry-list .password-vault-entry",
								),
							].map((node) => node.dataset.entryId),
						};
					})),
				});
			}
			async function saveEntry(title: string, notes: string) {
				await page.locator("#password-vault-entry-title").fill(title);
				await page
					.locator("#password-vault-entry-username")
					.fill("synthetic-owner@example.test");
				await page
					.locator("#password-vault-entry-password")
					.fill("Synthetic-only-secret!42");
				await page.locator("#password-vault-entry-notes").fill(notes);
				if (await page.getByRole("dialog").locator(".account-entry-form").count()) {
					await saveStandaloneEntryDraft(page, t);
					return;
				}
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
					.click();
				await expect(page.getByRole("dialog")).toHaveCount(0);
			}
			try {
				await page.goto("/accounts");
				const html = await (await page.request.get("/")).text();
				observations.push({
					stage: "candidate-entry",
					origin: new URL(page.url()).origin,
					indexSha256: createHash("sha256").update(html).digest("hex"),
					scripts: [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(
						(match) => match[1],
					),
				});
				await page
					.getByRole("main")
					.getByRole("button", { name: t("add"), exact: true })
					.click();
				const accountEditor = page.getByRole("dialog");
				await accountEditor.locator("#password-vault-entry-title").fill(accountName);
				await accountEditor
					.locator("#password-vault-entry-username")
					.fill("synthetic-account@example.test");
				await accountEditor
					.getByRole("button", { name: t("save"), exact: true })
					.click();
				await expect(accountEditor).toHaveCount(0);
				await openVaultAccess(page);
				await page.locator("#password-vault-master").fill(master);
				await page.locator("#password-vault-master-confirm").fill(master);
				await page
					.getByRole("button", { name: t("pwVaultCreate"), exact: true })
					.click();
				const account = page
					.locator(".unified-account")
					.filter({ hasText: accountName });
				await expect(account).toHaveCount(1);
				const disclosure = account.locator(".unified-account-passwords");
				await expect(disclosure).toBeVisible();
				if (
					!(await disclosure.evaluate(
						(node) => (node as HTMLDetailsElement).open,
					))
				)
					await disclosure.locator(":scope > summary").click();
				await disclosure
					.getByRole("button", { name: t("pwVaultNewEntry"), exact: true })
					.click();
				await saveEntry(linkedTitle, "Synthetic linked note");
				await expect(card(linkedTitle)).toBeVisible();
				const linkedId = await card(linkedTitle).getAttribute("data-entry-id");
				if (!linkedId) throw Error("linked-entry-id-missing");
				await openStandaloneEntryDraft(page, t);
				await saveEntry(otherTitle, "Before adjacent edit");
				await expect(entries).toHaveCount(2);
				await account.locator("a.asset-account-card").click();
				await expect(
					page.getByRole("heading", {
						level: 1,
						name: accountName,
						exact: true,
					}),
				).toBeVisible();
				await page
					.getByRole("link", { name: t("accountOpenPasswords"), exact: true })
					.click();
				await expect(page).toHaveURL(/#asset-/);
				const filter = page.locator(".password-vault-filter");
				const clearFilter = filter.getByRole("button", {
					name: t("pwVaultClearAssetFilter"),
					exact: true,
				});
				await expect(filter).toContainText(accountName);
				await expect(entries).toHaveCount(1);
				await expect(card(linkedTitle)).toHaveAttribute(
					"data-entry-id",
					linkedId,
				);
				await card(linkedTitle)
					.locator(".password-vault-linked-connection")
					.getByRole("button")
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("cancel"), exact: true })
					.click();
				await expect(page.getByRole("dialog")).toHaveCount(0);
				await expect(
					card(linkedTitle).locator(".password-vault-linked-connection"),
				).toHaveCount(1);
				await page.evaluate(
					() =>
						new Promise<void>((resolve) =>
							requestAnimationFrame(() =>
								requestAnimationFrame(() => resolve()),
							),
						),
				);
				await observe("cancel-focus-observation");
				await expect
					.poll(() =>
						card(linkedTitle).evaluate(
							(node) =>
								node === document.activeElement ||
								node.contains(document.activeElement),
						),
					)
					.toBe(true);
				await observe("cancel-keeps-link-and-filter");
				await card(linkedTitle)
					.locator(".password-vault-linked-connection")
					.getByRole("button")
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("pwVaultUnlink"), exact: true })
					.click();
				await expect(page.getByRole("dialog")).toHaveCount(0);
				await expect(entries).toHaveCount(0);
				await expect(filter).toContainText(accountName);
				await expect(page.locator(".password-vault-empty")).toBeVisible();
				await observe("confirmed-empty-filter");
				await page.screenshot({
					path: join(evidence, `${stem}-empty-filter.png`),
				});
				await expect(clearFilter).toBeFocused();
				await expect(clearFilter).toBeInViewport();
				await clearFilter.click();
				await expect(filter).toHaveCount(0);
				await expect(entries).toHaveCount(2);
				await expect(card(linkedTitle)).toHaveAttribute(
					"data-entry-id",
					linkedId,
				);
				await expect(
					card(linkedTitle).locator(".password-vault-linked-connection"),
				).toHaveCount(0);
				await card(otherTitle)
					.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
					.click();
				await page
					.locator("#password-vault-entry-notes")
					.fill("After adjacent edit without delayed focus");
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
					.click();
				await expect(page.getByRole("dialog")).toHaveCount(0);
				await expect(card(otherTitle)).toContainText(
					"After adjacent edit without delayed focus",
				);
				await page.evaluate(
					() =>
						new Promise<void>((resolve) =>
							requestAnimationFrame(() =>
								requestAnimationFrame(() => resolve()),
							),
						),
				);
				await expect
					.poll(() =>
						card(linkedTitle).evaluate(
							(node) =>
								node === document.activeElement ||
								node.contains(document.activeElement),
						),
					)
					.toBe(false);
				await observe("adjacent-save-no-late-focus");
				await account.locator("a.asset-account-card").click();
				await page
					.getByRole("link", { name: t("accountOpenPasswords"), exact: true })
					.click();
				await expect(entries).toHaveCount(0);
				await page.reload();
				await openVaultAccess(page);
				await page.locator("#password-vault-unlock-master").fill(master);
				await page
					.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
					.click();
				await expect(filter).toContainText(accountName);
				await expect(entries).toHaveCount(0);
				await expect(clearFilter).toBeVisible();
				await clearFilter.click();
				await expect(entries).toHaveCount(2);
				await expect(card(linkedTitle)).toHaveAttribute(
					"data-entry-id",
					linkedId,
				);
				await expect(
					card(linkedTitle).locator(".password-vault-linked-connection"),
				).toHaveCount(0);
				await expect(card(otherTitle)).toContainText(
					"After adjacent edit without delayed focus",
				);
				// The new global flow deliberately retains its newly created ordinary account.
				await expect(page.locator(".unified-account")).toHaveCount(2);
				await observe("refresh-and-unlock-retains-data");
				await page.screenshot({ path: join(evidence, `${stem}-retained.png`) });
				expect(errors).toEqual([]);
			} finally {
				writeFileSync(
					join(evidence, `${stem}.json`),
					JSON.stringify({ language, width, observations, errors }, null, 2),
				);
				await context.close();
			}
		});
	}
}
