import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/account-password-layout";
mkdirSync(evidence, { recursive: true });
const master = "Synthetic layout vault 2026!";
const phone = "+1 202-555-0142";
const emptyName = "Empty synthetic account";

async function lineCount(locator: Locator) {
	return locator.evaluate((node) => {
		const range = document.createRange();
		range.selectNodeContents(node);
		return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
	});
}

for (const language of ["zh-CN", "en"] as const) for (const width of [1920, 1280, 768, 390, 2560]) {
	test(`${language} ${width} account disclosure keeps masked fields readable and neighbors compact`, async ({ browser }) => {
		test.setTimeout(120_000);
		const t = (key: string) => (resources[language].translation as Record<string, string>)[key] ?? key;
		const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: language, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
		await context.addInitScript((language) => localStorage.setItem("keepany-language", language), language);
		const page = await context.newPage();
		page.setDefaultTimeout(12_000);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await page.goto("/");
			const indexHtml = await (await page.request.get("/")).text();
			const candidate = { origin: new URL(page.url()).origin, indexSha256: createHash("sha256").update(indexHtml).digest("hex"), portable: Boolean(process.env.KEEPANY_PREVIEW_DIRECTORY || process.env.KEEPANY_PREVIEW_ARCHIVE) };
			await page.goto("/settings#advanced-settings");
			await page.getByRole("button", { name: t("loadSample"), exact: true }).click();
			await expect(page.getByRole("button", { name: t("sampleLibraryPresent"), exact: true })).toBeDisabled();
			await page.goto("/accounts");
			await page.getByRole("main").getByRole("button", { name: t("add"), exact: true }).click();
			await page.getByRole("dialog").getByLabel(t("name"), { exact: true }).fill(emptyName);
			await page.getByRole("dialog").getByRole("button", { name: t("save"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			const access = page.locator(".unified-vault-access");
			if (!await access.evaluate((node) => (node as HTMLDetailsElement).open)) await access.locator("summary").click();
			await page.locator("#password-vault-master").fill(master);
			await page.locator("#password-vault-master-confirm").fill(master);
			await page.getByRole("button", { name: t("pwVaultCreate"), exact: true }).click();
			const sampleButton = page.getByRole("button", { name: t("sampleLogins"), exact: true });
			await expect(sampleButton).toBeVisible();
			await page.locator(".password-vault-toolbar").screenshot({ path: join(evidence, `toolbar-${language}-${width}.png`) });
			expect(await lineCount(sampleButton), "The sample-login text action remains one readable line").toBe(1);
			const account = page.locator(".unified-account").filter({ has: page.locator(".asset-account-phone") });
			const disclosure = account.locator(".unified-account-passwords");
			const trigger = disclosure.locator("summary");
			await trigger.click();
			await expect(disclosure).toHaveJSProperty("open", true);
			await disclosure.getByRole("button", { name: t("pwVaultNewEntry"), exact: true }).click();
			await page.locator("#password-vault-entry-title").fill("Demo | Phone service login");
			await page.locator("#password-vault-entry-username").fill(phone);
			await page.locator("#password-vault-entry-password").fill("Synthetic-layout-only!2026");
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultAddUrl"), exact: true }).click();
			await page.locator("#password-vault-entry-url").fill("https://mobile.example.test/");
			await page.locator("#password-vault-entry-notes").fill(language === "zh-CN" ? "虚构555演示号码与运营商账户，用于核对账号展开后的备注排版；没有真实短信验证码或恢复码。" : "Synthetic phone and carrier account for checking expanded notes. No real SMS codes or recovery codes.");
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			await expect(disclosure.locator(".password-vault-entry")).toHaveCount(1);
			await trigger.click();
			await expect(disclosure).toHaveJSProperty("open", false);
			const collapsed = await page.locator(".unified-account").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
			// Exercise the summary text, rather than setting the native details property.
			await trigger.click();
			await expect(disclosure).toHaveJSProperty("open", true);
			const entry = disclosure.locator(".password-vault-entry");
			await entry.scrollIntoViewIfNeeded();
			const geometry = await page.locator(".unified-account").evaluateAll((nodes) => nodes.map((node) => ({ open: Boolean(node.querySelector("details[open]")), height: node.getBoundingClientRect().height })));
			const maskLines = await lineCount(entry.locator(".password-vault-secret"));
			const usernameLines = await lineCount(entry.locator(".password-vault-value").first());
			const notes = await entry.locator(".password-vault-notes-row").evaluate((node) => ({ rowWidth: node.getBoundingClientRect().width, valueWidth: node.querySelector(".password-vault-value")?.getBoundingClientRect().width ?? 0 }));
			writeFileSync(join(evidence, `expanded-${language}-${width}.json`), JSON.stringify({ collapsed, geometry, maskLines, usernameLines, notes }, null, 2));
			await page.screenshot({ path: join(evidence, `expanded-${language}-${width}.png`), fullPage: true });
			expect.soft(maskLines, "A concealed password stays on one readable line").toBe(1);
			expect.soft(usernameLines, "A short phone identifier stays on one line").toBe(1);
			expect.soft(notes.valueWidth, "Notes use most of the available row rather than a narrow center column").toBeGreaterThanOrEqual(notes.rowWidth * 0.6);
			for (const [index, box] of geometry.entries()) if (!box.open) expect.soft(box.height, "Expanding one account must not stretch collapsed neighbors").toBeLessThanOrEqual(collapsed[index] + 1);
			const overflow = await entry.locator(".password-vault-value-actions button").evaluateAll((nodes) => nodes.some((node) => { const r = node.getBoundingClientRect(), parent = node.closest(".password-vault-entry")?.getBoundingClientRect(); return !parent || r.left < parent.left || r.right > parent.right || r.width < 44 || r.height < 44; }));
			expect(overflow, "Field actions fit the entry and retain 44px targets").toBe(false);
			await trigger.focus(); await trigger.press("Enter");
			await expect(disclosure).toHaveJSProperty("open", false);
			await expect(entry).toBeHidden();
			const after = await page.locator(".unified-account").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
			for (const [index, height] of after.entries()) expect(height).toBeLessThanOrEqual(collapsed[index] + 1);
			await trigger.press("Space"); await expect(disclosure).toHaveJSProperty("open", true);
			await trigger.hover();
			await account.screenshot({ path: join(evidence, `hover-${language}-${width}.png`) });
			await trigger.focus();
			await account.screenshot({ path: join(evidence, `focus-${language}-${width}.png`) });
			const reveal = disclosure.getByRole("button", { name: t("pwVaultRevealPassword"), exact: true });
			await reveal.click();
			await expect(disclosure.getByRole("button", { name: t("pwVaultHidePasswordValue"), exact: true })).toHaveAttribute("aria-pressed", "true");
			await expect(entry.locator(".password-vault-secret")).toHaveText("Synthetic-layout-only!2026");
			await disclosure.getByRole("button", { name: t("pwVaultHidePasswordValue"), exact: true }).click();
			await expect(entry.locator(".password-vault-secret")).toHaveText("••••••••••••");
			await disclosure.getByRole("button", { name: t("pwVaultCopyUsername"), exact: true }).click();
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(phone);
			await disclosure.getByRole("button", { name: t("pwVaultNewEntry"), exact: true }).click();
			await page.locator("#password-vault-entry-title").fill("Second passwordless phone login");
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			await expect(disclosure.locator(".password-vault-entry")).toHaveCount(2);
			await expect(disclosure).toContainText(t("pwVaultNoPassword"));
			await expect(disclosure.locator(".password-vault-entry").last().getByRole("button", { name: t("pwVaultRevealPassword"), exact: true })).toBeDisabled();
			const empty = page.locator(".unified-account").filter({ hasText: emptyName }).locator(".unified-account-passwords");
			await empty.locator("summary").click(); await expect(empty).toHaveJSProperty("open", true);
			await expect(empty.locator(".password-vault-entry")).toHaveCount(0);
			await expect(empty.getByRole("button", { name: t("pwVaultNewEntry"), exact: true })).toBeVisible();
			await empty.screenshot({ path: join(evidence, `empty-${language}-${width}.png`) });
			await empty.locator("summary").click();
			await page.screenshot({ path: join(evidence, `multiple-${language}-${width}.png`), fullPage: true });
			expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
			if (process.env.KEEPANY_LAYOUT_FIXTURE && language === "zh-CN" && width === 1920) {
				await page.goto("/intake");
				await page.locator("#backup-password").fill(master);
				await page.getByRole("button", { name: t("backup"), exact: true }).click();
				const download = page.waitForEvent("download");
				await page.getByRole("link", { name: t("saveBackupFile"), exact: true }).click();
				await (await download).saveAs(process.env.KEEPANY_LAYOUT_FIXTURE);
			}
			expect(errors).toEqual([]);
			writeFileSync(join(evidence, `result-${language}-${width}.json`), JSON.stringify({ ids: ["AL01", "AL02", "AL10"], language, width, candidate, status: "passed", errors, geometry, notes, maskLines, usernameLines, visual: "requires-human-review" }, null, 2));
		} finally { await context.close(); }
	});
}
