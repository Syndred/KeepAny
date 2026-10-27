import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { inspectVisualKdbx, visualHarness, visualMaster } from "./fixtures/password-smart-import-visual";
import { sourceModuleUrl } from "./helpers/source-module-url";
import { model, syntheticKey } from "./helpers/ai-workflow";

test.setTimeout(150_000);
const root = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/T09-supplement";
mkdirSync(root, { recursive: true });
const repoUrl = sourceModuleUrl("packages/local-db/src/index.ts");
async function ordinary(page: Page) {
	return page.evaluate(async path => {
		const { localRepository } = await import(path);
		const repo = await localRepository();
		const assets = await repo.list("asset", true);
		const relations = await repo.list("relation", true);
		return { assets: assets.sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)), relations: relations.sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)) };
	}, repoUrl);
}
async function createAccount(page: Page, zh: boolean, name: string) {
	await page.goto("/accounts");
	await page.getByRole("main").getByRole("button", { name: zh ? "新增" : "Add", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(zh ? "名称" : "Name", { exact: true }).fill(name);
	await dialog.getByRole("button", { name: zh ? "保存" : "Save", exact: true }).click();
	await expect(dialog).toBeHidden();
	const card = page.locator(".asset-account-card").filter({ hasText: name });
	await expect(card).toHaveCount(1);
	return await card.getAttribute("href") as string;
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`${locale} ${width} T09 account counts and inline password management show only linked entries`, async ({ browser }) => {
		const h = await visualHarness(browser, locale, { width, height: 950 });
		const { page, t } = h;
		const zh = locale === "zh-CN";
		try {
			const first = await createAccount(page, zh, "First public account");
			const second = await createAccount(page, zh, "Second public account");
			await page.goto(first);
			await page.getByRole("button", { name: zh ? "在此查看密码" : "View passwords here", exact: true }).click();
			await h.createVault();
			for (const title of ["First linked credential one", "First linked credential two"]) {
				await page.getByRole("button", { name: t("pwVaultNewEntry"), exact: true }).click();
				await page.locator("#password-vault-entry-title").fill(title);
				await page.locator("#password-vault-entry-username").fill("first@example.test");
				await page.locator("#password-vault-entry-password").fill("Synthetic-account-specific!42");
				await expect(page.locator(".password-vault-linked-chip")).toContainText("First public account");
				await page.getByRole("dialog").getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			}
			await page.goto(second);
			await page.getByRole("button", { name: zh ? "在此查看密码" : "View passwords here", exact: true }).click();
			await page.locator("#password-vault-unlock-master").fill(visualMaster);
			await page.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
			await page.getByRole("button", { name: t("pwVaultNewEntry"), exact: true }).click();
			await page.locator("#password-vault-entry-title").fill("Second linked credential");
			await page.locator("#password-vault-entry-username").fill("second@example.test");
			await page.locator("#password-vault-entry-password").fill("Synthetic-second-only!42");
			await expect(page.locator(".password-vault-linked-chip")).toContainText("Second public account");
			await page.getByRole("dialog").getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
			await page.goto("/assets/vault");
			await page.locator("#password-vault-unlock-master").fill(visualMaster);
			await page.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
			await h.seedExisting({ title: "Standalone unlinked credential", username: "unlinked@example.test", password: "Synthetic-unlinked-only!42" });
			await page.locator(".workspace-navigation").getByRole("link", { name: zh ? "全部账号" : "All accounts", exact: true }).click();
			await expect(page.locator(".asset-account-card").filter({ hasText: "First public account" })).toContainText(zh ? "2 个密码条目" : "2 password entries");
			await expect(page.locator(".asset-account-card").filter({ hasText: "Second public account" })).toContainText(zh ? "1 个密码条目" : "1 password entry");
			await expect(page.locator(".workspace-password-only .workspace-password-card")).toHaveCount(1);
			await page.locator(".asset-account-card").filter({ hasText: "First public account" }).click();
			await page.getByRole("button", { name: zh ? "在此查看密码" : "View passwords here", exact: true }).click();
			const inline = page.locator(".account-passwords-section");
			await expect(inline.locator(".password-vault-entry")).toHaveCount(2);
			await expect(inline).toContainText("First linked credential one");
			await expect(inline).toContainText("First linked credential two");
			await expect(inline).not.toContainText("Second linked credential");
			await expect(inline).not.toContainText("Standalone unlinked credential");
			if ((zh && width === 390) || (!zh && width === 1280)) {
				await inline.scrollIntoViewIfNeeded();
				await page.screenshot({ path: join(root, `inline-${locale}-${width}.png`) });
			}
			await page.locator(".workspace-password-actions").getByRole("link").click();
			await expect(page.locator(".password-vault-entry-list .password-vault-entry")).toHaveCount(2);
			await page.getByRole("button", { name: t("pwVaultClearAssetFilter"), exact: true }).click();
			await expect(page.locator(".password-vault-entry-list .password-vault-entry")).toHaveCount(4);
			await page.locator(".workspace-navigation").getByRole("link", { name: zh ? "外部引用" : "External references", exact: true }).click();
			await expect(page.getByRole("button", { name: zh ? "关联密码库条目" : "Link vault entry", exact: true })).toBeVisible();
			expect(h.errors).toEqual([]);
		} finally { await h.close(); }
	});
}

test("T09 ordinary save survives KDBX link fault then refresh retries stable IDs without touching an unselected entry", async ({ browser }) => {
	const h = await visualHarness(browser, "en", { width: 1280, height: 950 });
	try {
		await h.configure();
		await h.createVault();
		for (const record of [
			{ title: "Selected retry service", username: "retry-owner@example.test", password: "Synthetic-retry-secret!42", notes: "Private original note survives retry" },
			{ title: "Unselected numeric service", username: "123456789", password: "Synthetic-unselected-secret!42", notes: "Private untouched note" },
		]) {
			await h.seedExisting(record);
			await h.page.locator(".password-vault-entry-list .password-vault-entry").filter({ hasText: record.title }).getByRole("button", { name: h.t("pwVaultEditEntry"), exact: true }).click();
			await h.page.locator("#password-vault-entry-notes").fill(record.notes);
			await h.page.getByRole("dialog").getByRole("button", { name: h.t("pwVaultSaveEntry"), exact: true }).click();
			await expect(h.page.locator(".password-vault-entry-list .password-vault-entry").filter({ hasText: record.title })).toContainText(record.notes);
		}
		async function openSelected() {
			await h.page.getByRole("button", { name: h.t("pwConnectTitle"), exact: true }).click();
			const dialog = h.page.locator(".vault-connect-dialog");
			await dialog.locator(".vault-connect-account").filter({ hasText: "Selected retry service" }).getByRole("checkbox").check();
			await expect(dialog.locator(".vault-connect-account").filter({ hasText: "Unselected numeric service" }).getByRole("checkbox")).not.toBeChecked();
			await dialog.getByRole("button", { name: h.t("pwConnectLocal"), exact: true }).click();
			return dialog;
		}
		let dialog = await openSelected();
		await expect(dialog).toContainText(h.t("pwConnectAiScope"));
		await expect(dialog).toContainText(model);
		await expect(dialog).toContainText(h.mock.baseURL);
		expect(h.mock.requests).toHaveLength(0);
		h.mock.responses.push(JSON.stringify({ relations: [] }));
		await dialog.getByRole("button", { name: h.t("pwConnectAi"), exact: true }).click();
		await expect.poll(() => h.mock.requests.length).toBe(1);
		await expect(dialog.getByRole("button", { name: h.t("pwConnectSave"), exact: true })).toBeEnabled();
		const sent = JSON.stringify(h.mock.requests[0].body);
		expect(sent).toContain("Selected retry service");
		expect(sent).toContain("Private original note survives retry");
		for (const value of ["Unselected numeric service", "Private untouched note", "Synthetic-retry-secret!42", "Synthetic-unselected-secret!42", visualMaster, syntheticKey]) expect(sent).not.toContain(value);
		expect(sent).toContain("Same email alone is NOT evidence of OAuth login or recovery");
		await h.page.evaluate(() => {
			const original = IDBObjectStore.prototype.put;
			IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
				if (this.name === "passwordVault") {
					IDBObjectStore.prototype.put = original;
					throw new DOMException("Synthetic link-only persistence fault", "QuotaExceededError");
				}
				return original.apply(this, args);
			};
		});
		await dialog.getByRole("button", { name: h.t("pwConnectSave"), exact: true }).click();
		await expect(dialog.getByRole("status")).toHaveText(h.t("pwConnectPartial"));
		const partial = await ordinary(h.page);
		expect(partial.assets).toHaveLength(2);
		expect(partial.relations).toHaveLength(1);
		expect(JSON.stringify(partial)).not.toContain("Unselected numeric service");
		const stableIds = partial.assets.map((a: { id: string }) => a.id);
		await h.page.reload();
		await h.page.locator("#password-vault-unlock-master").fill(visualMaster);
		await h.page.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true }).click();
		dialog = await openSelected();
		await dialog.getByRole("button", { name: h.t("pwConnectSave"), exact: true }).click();
		await expect(dialog).toBeHidden();
		const retried = await ordinary(h.page);
		expect(retried.assets.map((a: { id: string }) => a.id)).toEqual(stableIds);
		expect(retried.relations.map((r: { id: string }) => r.id)).toEqual(partial.relations.map((r: { id: string }) => r.id));
		dialog = await openSelected();
		await dialog.getByRole("button", { name: h.t("pwConnectSave"), exact: true }).click();
		await expect(dialog).toBeHidden();
		expect((await ordinary(h.page)).assets.map((a: { id: string }) => a.id)).toEqual(stableIds);
		const download = h.page.waitForEvent("download");
		await h.page.getByRole("button", { name: h.t("pwVaultExport"), exact: true }).click();
		const file = test.info().outputPath("retry-preserved.kdbx");
		await (await download).saveAs(file);
		const entries = await inspectVisualKdbx(file);
		expect(entries).toHaveLength(2);
		expect(entries.find(e => e.draft.title === "Selected retry service")?.draft).toMatchObject({ password: "Synthetic-retry-secret!42", notes: "Private original note survives retry" });
		expect(entries.find(e => e.draft.title === "Unselected numeric service")?.draft).toMatchObject({ password: "Synthetic-unselected-secret!42", notes: "Private untouched note", linkedAssetIds: [] });
		expect(h.errors).toEqual([]);
	} finally { await h.close(); }
});
