import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { portableCandidate } from "./helpers/portable-candidate";
import { passwordVaultCopy } from "../../apps/web/src/password-vault-copy";
import { openVaultAccess } from "./helpers/vault-access";
import { selectChoice } from "./helpers/select-choice";

const master = "Synthetic FC21 matrix master 2026!";
for (const locale of ["zh-CN", "en"] as const)
	for (const width of [390, 563, 768, 1280, 1920, 2560]) {
		test(`${locale} ${width} FC21 real empty unlocked locked and restored account states`, async ({
			page,
		}, info) => {
			await page.setViewportSize({ width, height: 900 });
			const zh = locale === "zh-CN";
			const t = (key: keyof typeof passwordVaultCopy) =>
				passwordVaultCopy[key][zh ? 0 : 1];
			const { release, archiveSha256 } = portableCandidate();
			const states: string[] = [];
			const receipt: Record<string, unknown> = {
				acceptanceIds: ["FC21-A", "FC21-B", "FC21-C"],
				classification:
					"isolated fictional compiled candidate via real UI; no AI",
				locale,
				width,
				archiveSha256,
				sourceCommit: release.sourceCommit,
				sourceDirty: release.sourceDirty,
				states,
			};
			try {
				await page.addInitScript(
					(language) => localStorage.setItem("keepany-language", language),
					locale,
				);
				await page.goto("/accounts");
				const workspace = page.locator("main.unified-accounts-page");
				await workspace
					.getByRole("button", { name: zh ? "新增" : "Add", exact: true })
					.click();
				let dialog = page.getByRole("dialog");
				await dialog
					.locator("#name")
					.fill(
						"Synthetic FC21 long account title with a deliberately long ending for wrapping",
					);
				await selectChoice(dialog.locator("#category"), "other");
				await dialog
					.locator("#username")
					.fill("synthetic.fc21.persisted@example.test");
				await dialog
					.getByRole("button", { name: zh ? "保存" : "Save", exact: true })
					.click();
				await expect(dialog).toBeHidden();
				const card = workspace
					.locator(".unified-account")
					.filter({ hasText: "Synthetic FC21 long account title" });
				const href = await card
					.locator("a.asset-account-card")
					.getAttribute("href");
				expect(href).toBeTruthy();
				receipt.originalHref = href;
				const badge = workspace.locator(
					'.password-vault-header-meta [role="status"]',
				);
				await expect(badge).toHaveText(t("pwVaultStatusEmpty"));
				const access = page.locator(".unified-vault-access");
				if (await access.evaluate((node) => (node as HTMLDetailsElement).open))
					await access.locator(":scope > summary").click();
				await expect(card.locator(".unified-account-locked")).toHaveText(
					zh ? "尚未建立密码库。" : "No password vault has been created.",
				);
				await card.scrollIntoViewIfNeeded();
				await page.screenshot({ path: info.outputPath("empty-vault.png") });
				states.push("empty");
				await openVaultAccess(page);
				await page.locator("#password-vault-master").fill(master);
				await page.locator("#password-vault-master-confirm").fill(master);
				await page
					.getByRole("button", { name: t("pwVaultCreate"), exact: true })
					.click();
				await expect(badge).toHaveText(t("pwVaultStatusUnlocked"));
				await expect(card.locator(".unified-account-locked")).toHaveCount(0);
				const passwords = card.locator(".unified-account-passwords");
				await expect(passwords.locator(":scope > summary")).toHaveText(
					zh ? "0 个密码条目" : "0 password entries",
				);
				await passwords.locator(":scope > summary").click();
				await card.scrollIntoViewIfNeeded();
				await page.screenshot({
					path: info.outputPath("unlocked-zero-expanded.png"),
				});
				states.push("unlocked-zero");
				await passwords
					.getByRole("button", { name: t("pwVaultNewEntry"), exact: true })
					.click();
				dialog = page.getByRole("dialog");
				await dialog
					.locator("#password-vault-entry-title")
					.fill("Synthetic FC21 saved login");
				await dialog
					.locator("#password-vault-entry-username")
					.fill("synthetic.fc21.persisted@example.test");
				await dialog
					.locator("#password-vault-entry-password")
					.fill("Synthetic-only-FC21-secret!42");
				await dialog
					.locator("#password-vault-entry-notes")
					.fill(
						"Synthetic saved note retained after wrong-master failure and reload.",
					);
				await dialog
					.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
					.click();
				await expect(dialog).toBeHidden();
				const entry = passwords.locator(".password-vault-entry");
				await expect(entry).toHaveCount(1);
				const entryId = await entry.getAttribute("data-entry-id");
				expect(entryId).toBeTruthy();
				receipt.originalEntryId = entryId;
				await page
					.getByRole("button", { name: t("pwVaultLock"), exact: true })
					.click();
				await expect(badge).toHaveText(t("pwVaultStatusLocked"));
				await expect(card.locator(".unified-account-locked")).toHaveText(
					zh
						? "密码已锁定，解锁后查看。"
						: "Passwords are locked. Unlock to view them.",
				);
				await card.scrollIntoViewIfNeeded();
				await page.screenshot({ path: info.outputPath("locked.png") });
				states.push("locked");
				await page.reload();
				await expect(badge).toHaveText(t("pwVaultStatusLocked"));
				expect(
					await card.locator("a.asset-account-card").getAttribute("href"),
				).toBe(href);
				await openVaultAccess(page);
				await page
					.locator("#password-vault-unlock-master")
					.fill("Synthetic wrong master");
				await page
					.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
					.click();
				await expect(page.locator(".password-vault-message")).toContainText(
					t("pwVaultUnlockFailed"),
				);
				await expect(badge).toHaveText(t("pwVaultStatusLocked"));
				states.push("wrong-master");
				await page.locator("#password-vault-unlock-master").fill(master);
				await page
					.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
					.click();
				await expect(badge).toHaveText(t("pwVaultStatusUnlocked"));
				await expect(passwords.locator(":scope > summary")).toHaveText(
					zh ? "1 个密码条目" : "1 password entry",
				);
				await passwords.locator(":scope > summary").click();
				await expect(entry).toHaveCount(1);
				expect(await entry.getAttribute("data-entry-id")).toBe(entryId);
				expect(
					await card.locator("a.asset-account-card").getAttribute("href"),
				).toBe(href);
				await expect(entry).toContainText("Synthetic FC21 saved login");
				await expect(entry).toContainText("Synthetic saved note");
				await card.scrollIntoViewIfNeeded();
				await page.screenshot({
					path: info.outputPath("restored-one-expanded.png"),
				});
				states.push("restored-one");
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth + 1,
					),
				).toBe(true);
				receipt.persistedAssetAndEntryIds = true;
				receipt.completed = true;
			} finally {
				writeFileSync(
					info.outputPath("vault-status-receipt.json"),
					`${JSON.stringify(receipt, null, 2)}\n`,
				);
			}
		});
	}
