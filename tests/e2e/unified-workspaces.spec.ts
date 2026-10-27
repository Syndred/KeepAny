import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { passwordVaultCopy } from "../../apps/web/src/password-vault-copy";
import { selectChoice } from "./helpers/select-choice";

test.use({ timezoneId: "Asia/Shanghai" });
test.setTimeout(90_000);
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/keepany-unified-workspaces";
mkdirSync(evidence, { recursive: true });
const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainPath = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
const master = "Synthetic merged account master 2026!";

async function ordinaryAssets(page: Page) {
	return page.evaluate(async (path) => {
		const { localRepository } = await import(path);
		return JSON.stringify((await (await localRepository()).list("asset")).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)));
	}, repositoryPath);
}

async function seed(page: Page, locale: "zh-CN" | "en") {
	await page.addInitScript((language) => localStorage.setItem("keepany-language", language), locale);
	await page.clock.setFixedTime(new Date("2026-10-27T04:00:00Z"));
	await page.goto("/assets");
	await expect(page.locator(".workspace-catalog")).toBeVisible();
	return page.evaluate(async ({ repositoryPath, domainPath }) => {
		const { saveBatch } = await import(repositoryPath);
		const { newAsset, taskSchema, historySchema, relationSchema } = await import(domainPath);
		const domainId = crypto.randomUUID();
		const project = { ...newAsset("project"), name: "PixelNote", projectDomains: [{ id: domainId, name: "pixelnote.example", expiryDate: "2026-11-18", annualAmount: 1200, currency: "USD", registrar: "Example Registrar" }] };
		const item = { ...newAsset("item"), name: "Studio laptop", purchaseDate: "2026-08-14", amount: 799900, itemPurchasePriceKnown: true, warrantyDate: "2027-08-13" };
		const subscription = { ...newAsset("subscription"), name: "NoteFlow Pro", amount: 1200, currency: "USD", dueDate: "2026-11-05" };
		const account = { ...newAsset("account"), name: "Workspace Mail", username: "owner@example.test", category: "email" };
		const reference = { ...newAsset("vault"), name: "External vault reference", location: "External manager" };
		const assets = [project, item, subscription, account, reference];
		const relation = relationSchema.parse({ id: crypto.randomUUID(), from: project.id, to: subscription.id, label: "uses", createdAt: project.createdAt });
		const renewal = historySchema.parse({ id: crypto.randomUUID(), assetId: subscription.id, action: "renew", note: "", amount: 2400, currency: "USD", billDate: "2026-10-05", createdAt: project.createdAt });
		const tasks = Array.from({ length: 5 }, (_, index) => taskSchema.parse({ id: crypto.randomUUID(), name: `Project step ${index}`, assetId: project.id, done: index < 3, createdAt: project.createdAt }));
		await saveBatch([
			...assets.map((value) => ({ type: "asset", value })),
			...tasks.map((value) => ({ type: "task", value })),
			{ type: "relation", value: relation }, { type: "history", value: renewal },
			{ type: "preference", value: { id: "sidebarOrder", value: ["overview", "vault", "item", "tasks", "account", "project", "subscription"] } },
			{ type: "preference", value: { id: "sidebarHidden", value: ["account"] } },
		]);
		return { project: project.id, item: item.id, subscription: subscription.id, account: account.id, domain: domainId };
	}, { repositoryPath, domainPath });
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`${locale} ${width}px merged navigation, asset facts and original editors remain reachable`, async ({ page }) => {
		await page.setViewportSize({ width, height: 950 });
		const t = (key: string) => resources[locale].translation[key];
		const ids = await seed(page, locale);
		const before = await ordinaryAssets(page);
		const grid = page.locator(".workspace-asset-grid");
		await expect(grid.locator(":scope > a")).toHaveCount(4);
		await expect(grid.locator(".asset-project-card")).toContainText("3 / 5");
		await expect(grid.locator(".asset-library-card").filter({ hasText: "Studio laptop" })).toContainText("74");
		await expect(grid.locator(".asset-library-card").filter({ hasText: "NoteFlow Pro" })).toContainText("9");
		await expect(grid.locator(".workspace-domain-card")).toContainText("22");
		await expect(page.locator(".workspace-summary-grid").locator("section").nth(1)).toContainText("24.00");
		await expect(page.locator(".sidebar .sortable-nav-link .nav-label")).toHaveText([t("overview"), t("accountsWorkspace"), t("assetsWorkspace"), t("tasks")]);
		await expect(page.locator(".sidebar .sortable-nav-link.active")).toHaveText(t("assetsWorkspace"));
		await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
		expect(await grid.evaluate((element) => parseFloat(getComputedStyle(element).rowGap))).toBeGreaterThanOrEqual(16);
		await page.screenshot({ path: join(evidence, `assets-${locale}-${width}.png`), fullPage: true });
		await page.getByRole("searchbox", { name: t("workspaceSearch") }).fill("pixelnote.example");
		await expect(grid.locator(":scope > a")).toHaveCount(2);
		await grid.locator(".workspace-domain-card").click();
		await expect(page).toHaveURL(new RegExp(`/assets/project/${ids.project}#project-domain-${ids.domain}$`));
		const domain = page.locator(`#project-domain-${ids.domain}`);
		await expect(domain).toBeInViewport();
		await domain.getByRole("button", { name: t("edit"), exact: true }).click();
		await expect(page.getByRole("dialog")).toBeVisible();
		await page.getByRole("dialog").getByRole("button", { name: t("cancel"), exact: true }).click();
		await page.locator(".topbar-back-link").click();
		await expect(page.getByRole("searchbox", { name: t("workspaceSearch") })).toHaveValue("pixelnote.example");
		await page.getByRole("searchbox", { name: t("workspaceSearch") }).fill("");
		await page.getByRole("button", { name: t("workspaceAddAsset") }).click();
		await selectChoice(page.getByRole("combobox", { name: t("workspaceAssetType") }), "item");
		await page.getByRole("button", { name: t("workspaceContinue") }).click();
		await expect(page.getByRole("dialog").getByLabel(t("name"), { exact: true })).toBeVisible();
		await page.getByRole("dialog").getByRole("button", { name: t("cancel"), exact: true }).click();
		await expect.poll(() => ordinaryAssets(page)).toBe(before);
		await page.goto("/accounts");
		await expect(page.locator(".asset-account-card")).toContainText("Workspace Mail");
		await expect(page.locator(".sidebar .sortable-nav-link.active")).toHaveText(t("accountsWorkspace"));
		await page.screenshot({ path: join(evidence, `accounts-${locale}-${width}.png`), fullPage: true });
		await page.locator(".workspace-navigation").getByRole("link", { name: t("workspacePasswordReferences"), exact: true }).click();
		await expect(page.locator(".vault-reference-table")).toContainText("External vault reference");
		await page.goto("/assets/subscription");
		await expect(page.locator(".asset-library-card")).toContainText("NoteFlow Pro");
		await page.locator(".workspace-navigation").getByRole("link", { name: t("workspaceLedger"), exact: true }).click();
		await expect(page.locator(".finance-entry")).toContainText("24.00");
		await expect.poll(() => ordinaryAssets(page)).toBe(before);
	});
}

test("account detail manages its own passwords and the merged list hides private rows when locked", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 950 });
	const ids = await seed(page, "en");
	const before = await ordinaryAssets(page);
	const p = (key: string) => passwordVaultCopy[key][1];
	await page.goto(`/assets/account/${ids.account}`);
	await page.getByRole("button", { name: "View passwords here", exact: true }).click();
	const inline = page.locator(".account-passwords-section");
	await inline.locator("#password-vault-master").fill(master);
	await inline.locator("#password-vault-master-confirm").fill(master);
	await inline.getByRole("button", { name: p("pwVaultCreate"), exact: true }).click();
	await inline.getByRole("button", { name: p("pwVaultNewEntry"), exact: true }).click();
	await page.locator("#password-vault-entry-title").fill("Linked account credential");
	await page.locator("#password-vault-entry-username").fill("owner@example.test");
	await page.locator("#password-vault-entry-password").fill("Synthetic linked secret 2026!");
	await expect(page.locator(".password-vault-linked-chip")).toContainText("Workspace Mail");
	await page.getByRole("dialog").getByRole("button", { name: p("pwVaultSaveEntry"), exact: true }).click();
	await expect(inline.locator(".password-vault-entry")).toHaveCount(1);
	await page.locator(".workspace-password-actions").getByRole("link").click();
	await page.getByRole("button", { name: p("pwVaultClearAssetFilter"), exact: true }).click();
	await page.getByRole("button", { name: p("pwVaultNewEntry"), exact: true }).click();
	await page.locator("#password-vault-entry-title").fill("Standalone private credential");
	await page.locator("#password-vault-entry-username").fill("private-login@example.test");
	await page.locator("#password-vault-entry-password").fill("Synthetic private secret 2026!");
	await page.getByRole("dialog").getByRole("button", { name: p("pwVaultSaveEntry"), exact: true }).click();
	await page.locator(".sidebar .nav").getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.locator(".asset-account-card").filter({ hasText: "Workspace Mail" })).toContainText("1 password entry");
	await expect(page.locator(".workspace-password-only .workspace-password-card")).toHaveCount(1);
	await expect(page.locator(".workspace-password-only")).toContainText("Standalone private credential");
	await page.getByRole("searchbox", { name: resources.en.translation.accountListSearch }).fill("private-login@example.test");
	await expect(page.locator(".workspace-password-only .workspace-password-card")).toHaveCount(1);
	expect(await page.evaluate(() => sessionStorage.getItem("keepany-account-list-search") ?? "")).toBe("");
	await page.getByRole("button", { name: p("pwVaultLock"), exact: true }).click();
	await expect(page.locator(".workspace-password-only")).toHaveCount(0);
	await expect(page.getByRole("searchbox", { name: resources.en.translation.accountListSearch })).toHaveValue("");
	await expect(page.locator(".asset-account-card").filter({ hasText: "Workspace Mail" })).toHaveCount(1);
	await expect.poll(() => ordinaryAssets(page)).toBe(before);
	await page.reload();
	await expect(page.locator(".workspace-password-only")).toHaveCount(0);
	await expect.poll(() => ordinaryAssets(page)).toBe(before);
});
