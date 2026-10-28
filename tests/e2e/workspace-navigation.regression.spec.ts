import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { selectChoice } from "./helpers/select-choice";
import { passwordVaultCopy } from "../../apps/web/src/password-vault-copy";
import { sourceModuleUrl } from "./helpers/source-module-url";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/keepany-navigation";
mkdirSync(evidence, { recursive: true });
const repositoryPath = sourceModuleUrl("packages/local-db/src/index.ts");
const domainPath = sourceModuleUrl("packages/domain/src/index.ts");

async function ordinaryRecords(page: Page) {
	return page.evaluate(async path => {
		const { localRepository } = await import(path);
		const repository = await localRepository();
		return JSON.stringify({
			assets: (await repository.list("asset")).sort((a: {id: string}, b: {id: string}) => a.id.localeCompare(b.id)),
			preferences: (await repository.list("preference")).filter((row: {id: string}) => ["sidebarOrder", "sidebarHidden"].includes(row.id)).sort((a: {id: string}, b: {id: string}) => a.id.localeCompare(b.id)),
		});
	}, repositoryPath);
}

test.describe("workspace tab selection through real navigation", () => {
	test.use({ hasTouch: true });
	for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
		test(`${locale} ${width}px workspace tabs keep one highlight through clicks, Back and reload`, async ({ page }, info) => {
			test.setTimeout(90_000);
			await page.setViewportSize({ width, height: 844 });
			await page.addInitScript(language => localStorage.setItem("keepany-language", language), locale);
			const errors: string[] = [];
			page.on("pageerror", error => errors.push(error.message));
			const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
			await page.goto("/");
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			// The existing T01 fixture uses the same formal repository constructors.
			// Only setup is programmatic; all selection below uses rendered links.
			const records = await page.evaluate(async ({ repositoryPath, domainPath }) => {
				const { saveBatch, localRepository } = await import(repositoryPath);
				const { newAsset } = await import(domainPath);
				if ((await (await localRepository()).list("asset")).length) throw Error("tab-fixture-not-empty");
				const assets = (["project", "account", "subscription", "item"] as const).map(kind => ({
					...newAsset(kind), name: `Tab selection ${kind}`,
				}));
				await saveBatch(assets.map(value => ({ type: "asset", value })));
				return assets.map(({ id, kind, name }) => ({ id, kind, name }));
			}, { repositoryPath, domainPath });
			const before = await ordinaryRecords(page);
			const assetTabs = page.getByRole("navigation", { name: t("assetsWorkspace"), exact: true });
			const cards = page.locator("main .asset-list-content > a.list-row");
			async function assertAssetView(path: string, key: keyof typeof resources.en.translation, kind?: string) {
				await expect.poll(() => new URL(page.url()).pathname).toBe(path);
				await expect(assetTabs.locator(":scope > a[aria-current='page']")).toHaveText([t(key)]);
				await expect(page.getByRole("heading", { level: 1 })).toHaveText(t(path === "/finance" ? "financeTitle" : path === "/assets" ? "assetsWorkspace" : key));
				const expected = records.filter(record => kind ? record.kind === kind : path === "/assets" && record.kind !== "account");
				await expect(cards).toHaveCount(expected.length);
				for (const record of expected) await expect(page.locator(`main .asset-list-content > a.list-row[href='/assets/${record.kind}/${record.id}']`)).toContainText(record.name);
				if (path !== "/assets") {
					const all = assetTabs.getByRole("link", { name: t("all"), exact: true });
					await expect(all).not.toHaveAttribute("aria-current", "page");
					const backgrounds = await assetTabs.evaluate(nav => {
						const all = nav.querySelector("a[href='/assets']")!;
						const selected = nav.querySelector("a[aria-current='page']")!;
						return { all: getComputedStyle(all).backgroundColor, selected: getComputedStyle(selected).backgroundColor, allShadow: getComputedStyle(all).boxShadow };
					});
					expect(backgrounds.all).not.toBe(backgrounds.selected);
					expect(backgrounds.allShadow).toBe("none");
				}
				await expect.poll(() => ordinaryRecords(page)).toBe(before);
			}
			if (width === 390) {
				const menu = page.getByRole("button", { name: t("navigation"), exact: true });
				await menu.tap();
				const drawer = page.getByRole("dialog", { name: t("navigation"), exact: true });
				await expect(drawer).toBeVisible();
				let previousDrawer: { left: number; right: number; viewport: number } | undefined;
				await expect.poll(async () => {
					const current = await drawer.evaluate(element => {
						const box = element.getBoundingClientRect();
						return { left: box.left, right: box.right, viewport: innerWidth };
					});
					const contained = (box: typeof current) => box.left >= -0.25 && box.right <= box.viewport + 0.25;
					const stable = previousDrawer !== undefined && contained(previousDrawer) && contained(current)
						&& Math.abs(previousDrawer.left - current.left) <= 0.25 && Math.abs(previousDrawer.right - current.right) <= 0.25;
					previousDrawer = current;
					return stable;
				}).toBe(true);
				await info.attach("drawer-stable-position", { body: JSON.stringify(previousDrawer), contentType: "application/json" });
				// The open modal correctly makes the topbar inert; read its state without clicking it.
				await expect(page.locator(".mobile-menu")).toHaveAttribute("aria-expanded", "true");
				const mainLinks = drawer.locator(".nav .sortable-nav-link");
				await expect(mainLinks).toHaveCount(4);
				for (const key of ["overview", "tasks", "assetsWorkspace", "accountsWorkspace"] as const) {
					await expect(drawer.locator(".nav").getByRole("link", { name: t(key), exact: true })).toBeVisible();
				}
				const geometry = await mainLinks.evaluateAll(links => links.map(link => {
					const box = link.getBoundingClientRect();
					return { label: link.textContent?.trim(), width: box.width, height: box.height };
				}));
				await info.attach("drawer-main-link-geometry", { body: JSON.stringify(geometry), contentType: "application/json" });
				for (const link of geometry) {
					expect(link.width, `${link.label} touch width`).toBeGreaterThanOrEqual(44);
					expect(link.height, `${link.label} touch height`).toBeGreaterThanOrEqual(44);
				}
				await page.screenshot({ path: join(evidence, `tab-selection-${locale}-${width}-drawer.png`), fullPage: false });
				await drawer.locator(".nav").getByRole("link", { name: t("assetsWorkspace"), exact: true }).tap();
				await expect(menu).toHaveAttribute("aria-expanded", "false");
				await expect(drawer).toBeHidden();
				await assertAssetView("/assets", "all");
			}
			await page.goto("/assets/project");
			await assertAssetView("/assets/project", "project", "project");
			let previous = { path: "/assets/project", key: "project", kind: "project" } as { path: string; key: keyof typeof resources.en.translation; kind?: string };
			for (const current of [
				{ path: "/assets", key: "all" },
				{ path: "/assets/project", key: "project", kind: "project" },
				{ path: "/assets/subscription", key: "subscription", kind: "subscription" },
				{ path: "/assets/item", key: "item", kind: "item" },
				{ path: "/assets/domains", key: "workspaceDomains" },
				{ path: "/finance", key: "workspaceLedger" },
			] as const) {
				await assetTabs.getByRole("link", { name: t(current.key), exact: true }).click();
				await assertAssetView(current.path, current.key, "kind" in current ? current.kind : undefined);
				await page.goBack();
				await assertAssetView(previous.path, previous.key, previous.kind);
				await page.goForward();
				await assertAssetView(current.path, current.key, "kind" in current ? current.kind : undefined);
				await page.reload();
				await assertAssetView(current.path, current.key, "kind" in current ? current.kind : undefined);
				await page.screenshot({ path: join(evidence, `tab-selection-${locale}-${width}-${current.key}.png`), fullPage: false });
				previous = current;
			}
			await page.goto("/accounts");
			const accountTabs = page.getByRole("navigation", { name: t("accountsWorkspace"), exact: true });
			async function assertAccountView(key: "workspaceAllAccounts" | "workspacePasswords" | "workspacePasswordReferences", hash: string) {
				await expect.poll(() => `${new URL(page.url()).pathname}${new URL(page.url()).hash}`).toBe(key === "workspaceAllAccounts" ? "/accounts" : `/assets/vault${hash}`);
				await expect(accountTabs.locator(":scope > a[aria-current='page']")).toHaveText([t(key)]);
				if (key === "workspaceAllAccounts") {
					await expect(cards).toHaveCount(1);
					await expect(cards).toContainText("Tab selection account");
				} else {
					await expect(accountTabs.getByRole("link", { name: t("workspaceAllAccounts"), exact: true })).not.toHaveAttribute("aria-current", "page");
					await expect(page.locator("#password-vault-master")).toBeVisible();
					if (hash) await expect(page.locator("#vault-references")).toBeVisible();
				}
				await expect.poll(() => ordinaryRecords(page)).toBe(before);
			}
			for (const current of [
				{ key: "workspacePasswords", hash: "" },
				{ key: "workspacePasswordReferences", hash: "#vault-references" },
				{ key: "workspaceAllAccounts", hash: "" },
			] as const) {
				const old = new URL(page.url());
				await accountTabs.getByRole("link", { name: t(current.key), exact: true }).click();
				await assertAccountView(current.key, current.hash);
				await page.goBack();
				await expect.poll(() => `${new URL(page.url()).pathname}${new URL(page.url()).hash}`).toBe(`${old.pathname}${old.hash}`);
				await expect(accountTabs.locator(":scope > a[aria-current='page']")).toHaveCount(1);
				await page.goForward();
				await assertAccountView(current.key, current.hash);
				await page.reload();
				await assertAccountView(current.key, current.hash);
			}
			expect(errors).toEqual([]);
		});
	}
});

for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`${locale} ${width}px T01 new and legacy navigation select exactly one group and preserve records`, async ({ page }) => {
		test.setTimeout(90_000);
		await page.setViewportSize({ width, height: 950 });
		await page.addInitScript(language => localStorage.setItem("keepany-language", language), locale);
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
		const p = (key: keyof typeof passwordVaultCopy) => passwordVaultCopy[key][locale === "zh-CN" ? 0 : 1];
		async function mainNav(name: string) {
			if (width === 390) await page.getByRole("button", { name: t("navigation"), exact: true }).click();
			await page.locator(".sidebar .nav").getByRole("link", { name, exact: true }).click();
		}
		await page.goto("/");
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		await mainNav(t("accountsWorkspace"));
		await expect(page).toHaveURL(/\/accounts$/);
		await expect(page.locator(".sidebar .sortable-nav-link.active")).toHaveText([t("accountsWorkspace")]);
		await mainNav(t("assetsWorkspace"));
		await expect(page).toHaveURL(/\/assets$/);
		await mainNav(t("overview"));
		await expect(page).toHaveURL(/\/$/);

		const ids = await page.evaluate(async ({ repositoryPath, domainPath }) => {
			const { saveBatch } = await import(repositoryPath);
			const { newAsset } = await import(domainPath);
			const project = { ...newAsset("project"), name: "T01 Project", projectDomains: [{ id: crypto.randomUUID(), name: "t01.example.test", expiryDate: "2026-12-01", annualAmount: 1200, currency: "USD", registrar: "Fixture registrar" }] };
			const account = { ...newAsset("account"), name: "T01 Account", username: "navigation@example.test", category: "email" };
			const item = { ...newAsset("item"), name: "T01 Item" };
			const subscription = { ...newAsset("subscription"), name: "T01 Subscription" };
			const reference = { ...newAsset("vault"), name: "T01 External reference", location: "Fixture vault" };
			await saveBatch([
				...[project, account, item, subscription, reference].map(value => ({ type: "asset", value })),
				{ type: "preference", value: { id: "sidebarOrder", value: ["overview", "vault", "item", "tasks", "account", "project", "subscription"] } },
				{ type: "preference", value: { id: "sidebarHidden", value: ["account"] } },
			]);
			return { project: project.id, account: account.id, item: item.id, subscription: subscription.id };
		}, { repositoryPath, domainPath });
		await page.goto("/assets/vault");
		await page.locator("#password-vault-master").fill("T01 synthetic master!2026");
		await page.locator("#password-vault-master-confirm").fill("T01 synthetic master!2026");
		await page.getByRole("button", { name: p("pwVaultCreate"), exact: true }).click();
		await page.getByRole("button", { name: p("pwVaultNewEntry"), exact: true }).click();
		await page.locator("#password-vault-entry-title").fill("T01 retained credential");
		await page.locator("#password-vault-entry-username").fill("synthetic@example.test");
		await page.locator("#password-vault-entry-password").fill("Synthetic T01 secret!2026");
		await page.getByRole("dialog").getByRole("button", { name: p("pwVaultSaveEntry"), exact: true }).click();
		await expect(page.locator(".password-vault-entry")).toHaveCount(1);
		const before = await ordinaryRecords(page);
		for (const [path, group] of [
			["/assets/account", "accountsWorkspace"], ["/assets/vault", "accountsWorkspace"],
			[`/assets/account/${ids.account}`, "accountsWorkspace"], ["/assets/project", "assetsWorkspace"],
			["/assets/item", "assetsWorkspace"], ["/assets/subscription", "assetsWorkspace"],
			["/assets/domains", "assetsWorkspace"], ["/finance", "assetsWorkspace"],
			[`/assets/project/${ids.project}`, "assetsWorkspace"], [`/assets/item/${ids.item}`, "assetsWorkspace"],
			[`/assets/subscription/${ids.subscription}`, "assetsWorkspace"],
		] as const) {
			await page.goto(path);
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			// Regression: T01-001 — legacy account paths must not activate both merged sidebar groups.
			// Found by /qa on 2026-10-27. Report: docs/qa/2026-10-27/scopes/T01.md
			await expect(page.locator(".sidebar .sortable-nav-link.active")).toHaveText([t(group)]);
			await expect(page.locator(".sidebar .sortable-nav-link[aria-current='page']")).toHaveCount(1);
			if (await page.locator(".workspace-navigation").count()) await expect(page.locator(".workspace-navigation > a[aria-current='page']")).toHaveCount(1);
			await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
			await expect.poll(() => ordinaryRecords(page)).toBe(before);
		}
		await page.goto("/accounts");
		await expect(page.locator(".sidebar .sortable-nav-link .nav-label")).toHaveText([t("overview"), t("accountsWorkspace"), t("assetsWorkspace"), t("tasks")]);
		await expect(page.locator(".asset-account-card")).toContainText("T01 Account");
		if (width === 390) await page.getByRole("button", { name: t("navigation"), exact: true }).click();
		await page.screenshot({ path: join(evidence, `legacy-navigation-${locale}-${width}.png`), fullPage: true });
		await page.reload();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("accountsWorkspace"));
		await expect(page.locator(".sidebar .sortable-nav-link .nav-label")).toHaveText([t("overview"), t("accountsWorkspace"), t("assetsWorkspace"), t("tasks")]);
		await expect.poll(() => ordinaryRecords(page)).toBe(before);
		await page.goto("/assets/vault");
		await page.locator("#password-vault-unlock-master").fill("T01 synthetic master!2026");
		await page.getByRole("button", { name: p("pwVaultUnlock"), exact: true }).click();
		await expect(page.locator(".password-vault-entry")).toHaveCount(1);
		await expect(page.locator(".password-vault-entry")).toContainText("T01 retained credential");

		await page.evaluate(async ({ repositoryPath, domainPath }) => {
			const { saveBatch } = await import(repositoryPath);
			const { newAsset } = await import(domainPath);
			await saveBatch(Array.from({ length: 70 }, (_, index) => ({ type: "asset", value: {
				...newAsset("account"), name: `T01 Long ${String(index + 1).padStart(2, "0")}`, category: "email", tags: ["navigation"],
			} })));
		}, { repositoryPath, domainPath });
		await page.goto("/accounts");
		await page.getByRole("button", { name: t("email"), exact: true }).click();
		const search = page.getByRole("searchbox", { name: t("accountListSearch"), exact: true });
		await search.fill("T01 Long");
		await selectChoice(page.locator("#asset-tag-filter"), "navigation");
		const rows = page.locator(".asset-account-card");
		await expect(rows).toHaveCount(70);
		const target = rows.nth(50);
		const targetName = await target.locator("strong").innerText();
		await target.evaluate(element => element.scrollIntoView({ block: "center" }));
		const beforeScroll = await page.evaluate(() => scrollY);
		expect(beforeScroll).toBeGreaterThan(1000);
		await target.click();
		await expect(page.getByRole("heading", { name: targetName, exact: true })).toBeVisible();
		await page.locator(".topbar-back-link").click();
		async function assertListPosition() {
			await expect(rows).toHaveCount(70);
			await expect(search).toHaveValue("T01 Long");
			await expect(page.getByRole("button", { name: t("email"), exact: true })).toHaveAttribute("aria-pressed", "true");
			await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(1000);
			const actual = await page.evaluate(() => scrollY);
			expect(Math.abs(actual - beforeScroll)).toBeLessThan(35);
			await expect(rows.filter({ hasText: targetName })).toBeInViewport();
			return actual;
		}
		const returned = await assertListPosition();
		await page.reload();
		const refreshed = await assertListPosition();
		await page.screenshot({ path: join(evidence, `long-list-${locale}-${width}.png`), fullPage: false });
		console.log(JSON.stringify({ locale, width, count: 70, beforeScroll, returned, refreshed, targetName }));
		expect(errors).toEqual([]);
	});
}
