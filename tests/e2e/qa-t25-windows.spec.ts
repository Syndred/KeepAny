import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { visualHarness, visualMaster } from "./fixtures/password-smart-import-visual";

test.setTimeout(150_000);
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/qa-t25-windows";
mkdirSync(evidence, { recursive: true });

async function search(page: Page, value: string) {
	if (!await page.locator("#top-search-query").isVisible()) await page.locator(".top-search-trigger").click();
	await page.locator("#top-search-query").fill(value);
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	const zh = locale === "zh-CN";
	test(`${locale} ${width} T25 external references preserve edit/delete cancellation and one active tab`, async ({ browser }) => {
		const context = await browser.newContext({ locale: zh ? "zh-CN" : "en-US", viewport: { width, height: 900 } });
		await context.addInitScript((lng) => localStorage.setItem("keepany-language", lng), locale);
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		const label = { add: zh ? "关联密码库条目" : "Link vault entry", name: zh ? "条目名称" : "Entry name", save: zh ? "保存" : "Save", cancel: zh ? "取消" : "Cancel", edit: zh ? "编辑" : "Edit", trash: zh ? "移至回收站" : "Move to trash", store: zh ? "保管位置" : "Stored in" };
		const name = `QA external reference ${locale} ${width}`;
		try {
			await page.goto("/assets/vault#vault-references");
			await expect(page.locator(".workspace-navigation a[aria-current='page']")).toHaveCount(1);
			await expect(page.locator(".workspace-navigation a[aria-current='page']")).toHaveText(zh ? "外部引用" : "External references");
			await page.locator(".workspace-navigation").getByRole("link", { name: zh ? "密码管理" : "Passwords", exact: true }).click();
			await expect(page.locator(".workspace-navigation a[aria-current='page']")).toHaveCount(1);
			await expect(page.locator(".workspace-navigation a[aria-current='page']")).toHaveText(zh ? "密码管理" : "Passwords");
			await page.locator(".workspace-navigation").getByRole("link", { name: zh ? "外部引用" : "External references", exact: true }).click();
			await expect(page.locator(".workspace-navigation a[aria-current='page']")).toHaveCount(1);
			await page.getByRole("main").getByRole("button", { name: label.add, exact: true }).click();
			let d = page.getByRole("dialog");
			await d.getByLabel(label.name, { exact: true }).fill(name);
			await d.locator("#url").fill("javascript:alert(1)");
			await expect(d.getByLabel(/password|recovery|密码|恢复码/i)).toHaveCount(0);
			await d.getByRole("button", { name: label.save, exact: true }).click();
			await expect(d.getByText(zh ? "请检查此项" : "Please check this field", { exact: true })).toBeVisible();
			await d.getByRole("button", { name: label.cancel, exact: true }).click();
			await page.reload();
			await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(0);
			await page.getByRole("main").getByRole("button", { name: label.add, exact: true }).click();
			d = page.getByRole("dialog");
			await d.getByLabel(label.name, { exact: true }).fill(name);
			await d.locator("#url").fill("https://example.test/vault-entry");
			await d.getByLabel(label.store, { exact: true }).fill("Synthetic external vault");
			await d.getByRole("button", { name: label.save, exact: true }).click();
			await expect(d).toBeHidden();
			const row = page.getByRole("row").filter({ hasText: name });
			await expect(row).toContainText("Synthetic external vault");
			await page.screenshot({ path: join(evidence, `reference-${locale}-${width}.png`), fullPage: true });
			await row.getByRole("link", { name, exact: true }).click();
			await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
			const detailUrl = page.url();
			await page.getByRole("button", { name: label.edit, exact: true }).first().click();
			d = page.getByRole("dialog");
			await d.getByLabel(label.name, { exact: true }).fill(`${name} canceled`);
			await d.getByRole("button", { name: label.cancel, exact: true }).click();
			await page.reload();
			await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
			await page.getByRole("button", { name: label.edit, exact: true }).first().click();
			d = page.getByRole("dialog");
			await d.getByLabel(label.name, { exact: true }).fill(`${name} edited`);
			await d.getByRole("button", { name: label.save, exact: true }).click();
			await expect(d).toBeHidden();
			await page.reload();
			await expect(page.getByRole("heading", { name: `${name} edited`, exact: true })).toBeVisible();
			const website = page.getByRole("link").filter({ hasText: "example.test" }).first();
			await expect(website).toHaveAttribute("href", "https://example.test/vault-entry");
			await context.route("https://example.test/**", route => route.fulfill({ status: 200, body: "Synthetic external vault landing" }));
			const [popup] = await Promise.all([page.waitForEvent("popup"), website.click()]);
			await expect(popup).toHaveURL("https://example.test/vault-entry");
			await popup.close();
			await page.getByRole("button", { name: label.trash, exact: true }).click();
			d = page.getByRole("dialog");
			await d.getByRole("button", { name: label.cancel, exact: true }).click();
			await page.reload();
			await expect(page.getByRole("heading", { name: `${name} edited`, exact: true })).toBeVisible();
			await page.getByRole("button", { name: label.trash, exact: true }).click();
			d = page.getByRole("dialog");
			await d.getByRole("button", { name: label.trash, exact: true }).click();
			await expect(d).toBeHidden();
			await page.goto(detailUrl);
			await expect(page.getByRole("heading", { name: `${name} edited`, exact: true })).toHaveCount(0);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});

	test(`${locale} ${width} T25 unlocked KDBX secrets and encrypted private import draft stay outside ordinary search`, async ({ browser }) => {
		const h = await visualHarness(browser, locale, { width, height: 900 });
		const secret = `SyntheticKdbxUniqueSecret${locale}${width}!42`;
		const draft = `SyntheticPrivateDraftUnique${locale}${width}`;
		try {
			await h.page.goto("/accounts");
			await h.page.getByRole("main").getByRole("button", { name: zh ? "新增" : "Add", exact: true }).click();
			const account = h.page.getByRole("dialog");
			await account.getByLabel(zh ? "名称" : "Name", { exact: true }).fill("Public search anchor");
			await account.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
			await expect(account).toBeHidden();
			await h.page.goto("/assets/vault");
			await h.createVault();
			await h.seedExisting({ title: "Synthetic visible password", username: "synthetic@example.test", password: secret });
			await h.page.reload();
			await h.page.locator("#password-vault-unlock-master").fill(visualMaster);
			await h.page.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true }).click();
			await expect(h.page.locator(".password-vault-toolbar")).toBeVisible();
			await h.page.locator(".password-vault-entry-list .password-vault-entry").getByRole("button", { name: h.t("pwVaultEditEntry"), exact: true }).click();
			await expect(h.page.locator("#password-vault-entry-password")).toHaveValue(secret);
			await h.page.getByRole("dialog").getByRole("button", { name: /^(Close|关闭)$/ }).click();
			const importer = await h.open();
			await importer.locator("#pw-smart-source").fill(`title,username,password\n${draft},draft@example.test,DraftOnlySecret!42`);
			await importer.getByRole("button", { name: h.t("pwSmartRecognize"), exact: true }).click();
			await expect(h.page.locator(".pw-smart-draft-status")).toHaveText(h.t("pwSmartDraftSaved"));
			await h.page.reload();
			await h.page.locator("#password-vault-unlock-master").fill(visualMaster);
			await h.page.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true }).click();
			const restored = await h.open();
			await expect(restored.locator(".pw-work-editor [id$='-title']")).toHaveValue(draft);
			await expect(restored.locator(".pw-work-editor [id$='-password']")).toHaveValue("DraftOnlySecret!42");
			await h.page.reload();
			await h.page.locator("#password-vault-unlock-master").fill(visualMaster);
			await h.page.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true }).click();
			for (const token of [secret, draft, "DraftOnlySecret!42"]) {
				await search(h.page, "Public search anchor");
				await expect(h.page.locator(".top-search-panel .search-results a")).toHaveCount(1);
				await search(h.page, token);
				await expect(h.page.locator(".top-search-panel .search-results a")).toHaveCount(0);
			}
			await search(h.page, "Public search anchor");
			await expect(h.page.locator(".top-search-panel .search-results a")).toHaveCount(1);
			await h.page.locator(".top-search-panel .search-results a").click();
			await expect(h.page.getByRole("heading", { name: "Public search anchor", exact: true })).toBeVisible();
			expect(h.mock.requests).toHaveLength(0);
			expect(h.errors).toEqual([]);
		} finally { await h.close(); }
	});
}
