import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { visualHarness, visualMaster } from "./fixtures/password-smart-import-visual";

test.setTimeout(120_000);

for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} T06 downloaded KDBX restores private draft and rejects bad imports without replacing entries`, async ({ browser }, info) => {
		const h = await visualHarness(browser, locale, { width: locale === "zh-CN" ? 390 : 1280, height: 1000 });
		const source = "Title=Draft-only service\nUsername=draft@example.test\nPassword=Synthetic-draft-only!42";
		try {
			await h.page.goto("/assets/vault");
			await h.createVault();
			await h.seedExisting({ title: "Saved before import", username: "saved@example.test", password: "Synthetic-saved!42" });
			const importer = await h.open();
			await importer.locator("#pw-smart-source").fill(source);
			await expect(h.page.locator(".pw-smart-draft-status")).toHaveText(h.t("pwSmartDraftSaved"));
			await h.page.locator(".password-smart-import-dialog > header").getByRole("button", { name: /^(关闭|Close)$/, exact: true }).click();
			await h.page.getByRole("button", { name: h.t("pwSmartCloseKeepDraft"), exact: true }).click();
			await expect(importer).toHaveCount(0);
			const download = h.page.waitForEvent("download");
			await h.page.getByRole("button", { name: h.t("pwVaultExport"), exact: true }).click();
			const path = info.outputPath("draft-and-entry.kdbx");
			await (await download).saveAs(path);
			expect(readFileSync(path).includes(Buffer.from(source))).toBe(false);
			// Rotate the live vault after download: the older file must still use
			// its original master, while the current vault requires the new one.
			const nextMaster = "Synthetic T06 rotated master!42";
			await h.page.getByRole("button", { name: h.t("pwVaultChangeMaster"), exact: true }).click();
			await h.page.locator("#password-vault-current-master").fill(visualMaster);
			await h.page.locator("#password-vault-new-master").fill(nextMaster);
			await h.page.locator("#password-vault-new-master-confirm").fill(nextMaster);
			await h.page.getByRole("button", { name: h.t("pwVaultChangeMasterNow"), exact: true }).click();
			await expect(h.page.getByRole("dialog")).toBeHidden();
			await h.page.reload();
			await h.page.locator("#password-vault-unlock-master").fill(visualMaster);
			await h.page.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true }).click();
			await expect(h.page.locator(".password-vault-message")).toContainText(h.t("pwVaultUnlockFailed"));
			await h.page.locator("#password-vault-unlock-master").fill(nextMaster);
			await h.page.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true }).click();
			await expect(h.page.locator(".password-vault-entry-list .password-vault-entry")).toHaveCount(1);
			const restored = await browser.newContext({ locale: locale === "en" ? "en-US" : locale });
			try {
				const page = await restored.newPage();
				await page.addInitScript(language => localStorage.setItem("keepany-language", language), locale);
				await page.goto("/assets/vault");
				await page.getByRole("button", { name: h.t("pwVaultImportEmpty"), exact: true }).click();
				await page.locator("#password-vault-import-file").setInputFiles(path);
				await page.locator("#password-vault-import-password").fill(visualMaster);
				await page.getByRole("button", { name: h.t("pwVaultImportNow"), exact: true }).click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await expect(page.locator(".password-vault-entry-list .password-vault-entry")).toHaveCount(1);
				await page.getByRole("button", { name: h.t("pwSmartTitle"), exact: true }).click();
				await expect(page.locator("#pw-smart-source")).toHaveValue(source);
				await page.locator(".password-smart-import-dialog > header").getByRole("button", { name: /^(关闭|Close)$/, exact: true }).click();
				await page.getByRole("button", { name: h.t("pwSmartCloseKeepDraft"), exact: true }).click();
				for (const bad of ["password", "bytes"]) {
					await page.getByRole("button", { name: h.t("pwVaultImport"), exact: true }).click();
					await page.locator("#password-vault-import-file").setInputFiles(bad === "password" ? path : { name: "damaged.kdbx", mimeType: "application/octet-stream", buffer: Buffer.from("synthetic corrupt KDBX") });
					await page.locator("#password-vault-import-password").fill(bad === "password" ? "Definitely wrong synthetic master" : visualMaster);
					await page.getByRole("button", { name: h.t("pwVaultImportNow"), exact: true }).click();
					await expect(page.locator(".password-vault-message")).toBeVisible();
					await page.getByRole("dialog").getByRole("button", { name: /^(关闭|Close)$/, exact: true }).click();
					await expect(page.locator(".password-vault-entry-list .password-vault-entry")).toHaveCount(1);
					await expect(page.locator(".password-vault-entry-list")).toContainText("saved@example.test");
				}
				await page.reload();
				await page.locator("#password-vault-unlock-master").fill(visualMaster);
				await page.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true }).click();
				await expect(page.locator(".password-vault-entry-list .password-vault-entry")).toHaveCount(1);
				await page.getByRole("button", { name: h.t("pwSmartTitle"), exact: true }).click();
				await expect(page.locator("#pw-smart-source")).toHaveValue(source);
			} finally { await restored.close(); }
			expect(h.mock.requests).toHaveLength(0);
			expect(h.errors).toEqual([]);
		} finally { await h.close(); }
	});
}
