import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { openVaultAccess } from "./helpers/vault-access";
import { closeCompactLoginDetails, compactEntryIds, openCompactLoginDetails } from "./helpers/compact-account";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/account-password-layout";
mkdirSync(evidence, { recursive: true });
const master = "Synthetic layout vault 2026!", phone = "+1 202-555-0142", emptyName = "Empty synthetic account";
async function lineCount(locator: Locator) {
	return locator.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); return new Set(Array.from(range.getClientRects(), rect => Math.round(rect.top))).size; });
}

// The user-approved compact contract replaces inline disclosure. Business
// assertions (notes, copy, empty/multiple, cancel, KDBX identity and reload) remain.
// Historical evidence state names stay compatible with the existing verifier:
// "expanded" is now the actual separately opened login-details dialog.
for (const language of ["zh-CN", "en"] as const) for (const width of [1920, 1280, 768, 390, 2560]) {
	test(`${language} ${width} compact account keeps masked fields readable and neighbors compact`, async ({ browser }) => {
		test.setTimeout(120_000);
		const t = (key: string) => (resources[language].translation as Record<string, string>)[key] ?? key;
		const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: language, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
		await context.addInitScript(lang => localStorage.setItem("keepany-language", lang), language);
		const page = await context.newPage(); page.setDefaultTimeout(12_000);
		const errors: string[] = [], baselineCandidates: Array<{ state: string; path: string; sha256: string; platform: string; browser: string; baseline: string; comparison: string }> = [];
		page.on("pageerror", error => errors.push(error.message));
		async function baselineState(state: "expanded" | "collapsed") {
			const list = page.locator(".unified-account-list");
			await expect(list).toHaveCount(1);
			const baseline = `account-${language}-${width}-${state}.png`, path = join(evidence, `review-${process.platform}-${baseline}`);
			await list.screenshot({ path, animations: "disabled" });
			if (process.env.KEEPANY_REVIEWED_BASELINES) await expect(list).toHaveScreenshot(baseline, { animations: "disabled", maxDiffPixels: 0 });
			baselineCandidates.push({ state, path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex"), platform: process.platform, browser: browser.version(), baseline: `${process.platform}/accounts/${baseline}`, comparison: process.env.KEEPANY_REVIEWED_BASELINES ? "passed" : "pending-human-review" });
		}
		try {
			await page.goto("/");
			const indexHtml = await (await page.request.get("/")).text();
			const candidate = { origin: new URL(page.url()).origin, indexSha256: createHash("sha256").update(indexHtml).digest("hex"), portable: Boolean(process.env.KEEPANY_PREVIEW_DIRECTORY || process.env.KEEPANY_PREVIEW_ARCHIVE) };
			await page.goto("/settings#advanced-settings");
			await page.getByRole("button", { name: t("loadSample"), exact: true }).click();
			await expect(page.getByRole("button", { name: t("sampleLibraryPresent"), exact: true })).toBeDisabled();
			await page.goto("/accounts");
			await page.locator(".password-vault-header").getByRole("button", { name: t("add"), exact: true }).click();
			await page.getByRole("dialog").locator("#password-vault-entry-title").fill(emptyName);
			await page.getByRole("dialog").getByRole("button", { name: t("save"), exact: true }).click();
			await expect(page.getByRole("dialog")).toHaveCount(0);
			await openVaultAccess(page);
			await page.locator("#password-vault-master").fill(master); await page.locator("#password-vault-master-confirm").fill(master);
			await page.locator(".unified-vault-access").getByRole("button", { name: t("pwVaultCreate"), exact: true }).click();
			const sampleButton = page.getByRole("button", { name: t("sampleLogins"), exact: true });
			await expect(sampleButton).toBeVisible();
			await page.locator(".password-vault-toolbar").screenshot({ path: join(evidence, `toolbar-${language}-${width}.png`) });
			expect(await lineCount(sampleButton)).toBe(1);
			const account = page.locator(".unified-account.asset-account-phone");
			const originalAccountHref = await account.locator(".compact-account-title").getAttribute("href"); expect(originalAccountHref).toBeTruthy();
			async function addEntry() { await account.getByRole("button", { name: t("moreActions"), exact: true }).click(); await page.getByRole("menuitem", { name: t("pwVaultNewEntry"), exact: true }).click(); }
			await addEntry();
			await page.locator("#password-vault-entry-title").fill("Demo | Phone service login");
			await page.locator("#password-vault-entry-username").fill(phone);
			await page.locator("#password-vault-entry-password").fill("Synthetic-layout-only!2026");
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultAddUrl"), exact: true }).click();
			await page.locator("#password-vault-entry-url").fill("https://mobile.example.test/");
			await page.locator("#password-vault-entry-notes").fill(language === "zh-CN" ? "虚构555演示号码与运营商账户，用于核对完整备注排版；没有真实短信验证码或恢复码。" : "Synthetic phone and carrier account for checking complete notes. No real SMS codes or recovery codes.");
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			await expect(account).toHaveAttribute("data-entry-id", /.+/);
			const firstId = await account.getAttribute("data-entry-id");
			const collapsed = await page.locator(".unified-account").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
			let details = await openCompactLoginDetails(page, account, t);
			const entry = page.getByRole("dialog", { name: t("compactAccountLoginDetails"), exact: true }).locator(".password-vault-entry");
			const geometry = await page.locator(".unified-account").evaluateAll(nodes => nodes.map(node => ({ open: false, height: node.getBoundingClientRect().height })));
			const maskLines = await lineCount(entry.locator(".password-vault-secret")), usernameLines = await lineCount(entry.locator(".password-vault-value").first());
			const notes = await entry.locator(".password-vault-notes-row").evaluate(node => ({ rowWidth: node.getBoundingClientRect().width, valueWidth: node.querySelector(".password-vault-value")?.getBoundingClientRect().width ?? 0 }));
			writeFileSync(join(evidence, `expanded-${language}-${width}.json`), JSON.stringify({ layoutMode: "compact-card-with-details-dialog", collapsed, geometry, maskLines, usernameLines, notes }, null, 2));
			await page.screenshot({ path: join(evidence, `expanded-${language}-${width}.png`), fullPage: true });
			await expect(page.locator(".toast")).toHaveCount(0);
			await page.screenshot({ path: join(evidence, `expanded-stable-${language}-${width}.png`), fullPage: true });
			await baselineState("expanded");
			expect(maskLines).toBe(1); expect(usernameLines).toBe(1); expect(notes.valueWidth).toBeGreaterThanOrEqual(notes.rowWidth * .6);
			for (const [index, box] of geometry.entries()) expect(box.height).toBeLessThanOrEqual(collapsed[index] + 1);
			expect(await entry.locator(".password-vault-value-actions button").evaluateAll(nodes => nodes.some(node => { const r = node.getBoundingClientRect(), parent = node.closest(".password-vault-entry")!.getBoundingClientRect(); return r.left < parent.left || r.right > parent.right || r.width < 44 || r.height < 44; }))).toBe(false);
			await entry.getByRole("button", { name: t("pwVaultRevealPassword"), exact: true }).click();
			await expect(entry.getByRole("button", { name: t("pwVaultHidePasswordValue"), exact: true })).toHaveAttribute("aria-pressed", "true");
			await expect(entry.locator(".password-vault-secret")).toHaveText("Synthetic-layout-only!2026");
			await entry.getByRole("button", { name: t("pwVaultHidePasswordValue"), exact: true }).click();
			await expect(entry.locator(".password-vault-secret")).toHaveText("••••••••••••");
			await entry.getByRole("button", { name: t("pwVaultCopyUsername"), exact: true }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(phone);
			await closeCompactLoginDetails(page, t); await expect(entry).toHaveCount(0);
			for (const [index, height] of (await page.locator(".unified-account").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))).entries()) expect(height).toBeLessThanOrEqual(collapsed[index] + 1);
			await baselineState("collapsed");
			const trigger = account.getByRole("button", { name: t("moreActions"), exact: true });
			await trigger.focus(); await trigger.press("Enter"); await expect(page.getByRole("menu")).toBeVisible(); await page.keyboard.press("Escape");
			await trigger.press("Space"); await expect(page.getByRole("menu")).toBeVisible(); await page.keyboard.press("Escape");
			await trigger.hover(); await account.screenshot({ path: join(evidence, `hover-${language}-${width}.png`) });
			await trigger.focus(); await account.screenshot({ path: join(evidence, `focus-${language}-${width}.png`) });
			await addEntry(); await page.locator("#password-vault-entry-title").fill("Second passwordless phone login");
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			const savedEntryIds = await compactEntryIds(page); expect(savedEntryIds).toHaveLength(2); expect(savedEntryIds.every(Boolean)).toBe(true);
			await account.locator(".compact-account-switch").click();
			await expect(account).toContainText(t("pwVaultNoPassword"));
			details = await openCompactLoginDetails(page, account, t);
			await expect(details.getByRole("button", { name: t("pwVaultRevealPassword"), exact: true })).toBeDisabled();
			await closeCompactLoginDetails(page, t);
			const empty = page.locator(".unified-account").filter({ hasText: emptyName });
			await expect(empty).not.toHaveAttribute("data-entry-id", /.+/);
			await expect(empty.getByRole("button", { name: t("compactAccountAddPassword"), exact: true })).toBeVisible();
			await empty.screenshot({ path: join(evidence, `empty-${language}-${width}.png`) });
			await page.screenshot({ path: join(evidence, `multiple-${language}-${width}.png`), fullPage: true });
			await expect(page.locator(".toast")).toHaveCount(0); await page.screenshot({ path: join(evidence, `multiple-stable-${language}-${width}.png`), fullPage: true });
			expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
			await account.locator(".compact-account-switch").click(); await expect(account).toHaveAttribute("data-entry-id", firstId!);
			details = await openCompactLoginDetails(page, account, t); await details.getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
			await page.locator("#password-vault-entry-title").fill("Discard this synthetic edit");
			await page.getByRole("dialog").last().getByRole("button", { name: t("close"), exact: true }).click();
			await expect(entry).toContainText("Demo | Phone service login"); await closeCompactLoginDetails(page, t); await expect(page.getByRole("dialog")).toHaveCount(0);
			await page.reload(); await openVaultAccess(page); await page.locator("#password-vault-unlock-master").fill(master);
			await page.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
			expect(await account.locator(".compact-account-title").getAttribute("href")).toBe(originalAccountHref);
			expect(await compactEntryIds(page)).toEqual(savedEntryIds);
			details = await openCompactLoginDetails(page, account, t); await expect(details).toContainText("Demo | Phone service login"); await expect(details).toContainText(phone); await closeCompactLoginDetails(page, t);
			await account.locator(".compact-account-switch").click(); details = await openCompactLoginDetails(page, account, t); await expect(details).toContainText("Second passwordless phone login"); await closeCompactLoginDetails(page, t);
			if (process.env.KEEPANY_LAYOUT_FIXTURE && language === "zh-CN" && width === 1920) { await page.goto("/intake"); await page.locator("#backup-password").fill(master); await page.getByRole("button", { name: t("backup"), exact: true }).click(); const download = page.waitForEvent("download"); await page.getByRole("link", { name: t("saveBackupFile"), exact: true }).click(); await (await download).saveAs(process.env.KEEPANY_LAYOUT_FIXTURE); }
			expect(errors).toEqual([]);
			writeFileSync(join(evidence, `result-${language}-${width}.json`), JSON.stringify({ ids: ["AL01", "AL02", "AL10"], layoutMode: "compact-card-with-details-dialog", language, width, candidate, status: "passed", errors, geometry, notes, maskLines, usernameLines, originalAccountHref, savedEntryIds, cancelAndReloadPreserved: true, baselineCandidates, visual: "requires-human-review" }, null, 2));
		} finally { await context.close(); }
	});
}
