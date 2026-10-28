import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { sourceModuleUrl } from "./helpers/source-module-url";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/ui-consolidation";
mkdirSync(evidence, { recursive: true });
const copy = (language: "zh-CN" | "en") => (key: string) => (resources[language].translation as Record<string, string>)[key] ?? key;
const repositoryPath = sourceModuleUrl("packages/local-db/src/index.ts");
async function ordinaryRows(page: Page) {
	return page.evaluate(async path => {
		const repository = await (await import(path)).localRepository();
		return (await repository.allRecords()).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
	}, repositoryPath) as Promise<{ id: string; type: string; payload: string }[]>;
}
async function touchTarget(page: Page, target: Locator, name: string) {
	await target.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest" }));
	await expect(target).toBeVisible();
	const observed = await target.evaluate(element => {
		const r = element.getBoundingClientRect(), width = innerWidth, height = innerHeight;
		const hits = [0.2, 0.5, 0.8].flatMap(x => [0.2, 0.5, 0.8].map(y => {
			const hit = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y);
			return hit === element || !!hit && element.contains(hit);
		}));
		return { x: r.x, y: r.y, width: r.width, height: r.height, viewport: { width, height }, coarse: matchMedia("(pointer: coarse)").matches,
			visibleRatio: Math.max(0, Math.min(r.right, width) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, height) - Math.max(r.top, 0)) / (r.width * r.height), hits };
	});
	await test.info().attach(`touch-${name}`, { body: JSON.stringify(observed), contentType: "application/json" });
	if (observed.width < 44 || observed.height < 44 || observed.visibleRatio < 0.99 || !observed.hits.every(Boolean))
		await page.screenshot({ path: test.info().outputPath(`touch-${name}-failure.png`), fullPage: false });
	expect(observed.coarse).toBe(true);
	expect(observed.width, `${name} width`).toBeGreaterThanOrEqual(44);
	expect(observed.height, `${name} height`).toBeGreaterThanOrEqual(44);
	expect(observed.visibleRatio, `${name} visible ratio`).toBeGreaterThanOrEqual(0.99);
	expect(observed.hits, `${name} nine interior hit points`).toEqual(Array(9).fill(true));
}
async function installSamples(page: Page, t: (key: string) => string) {
	await page.goto("/settings#advanced-settings");
	await page.getByRole("button", { name: t("loadSample"), exact: true }).click();
	await expect(page.getByRole("button", { name: t("sampleLibraryPresent"), exact: true })).toBeDisabled();
}
async function noOverflow(page: Page) {
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
for (const language of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`${language} ${width} unified accounts, complete sample images, equal cards, shared graph and real item history`, async ({ browser }) => {
		test.setTimeout(150_000);
		const context = await browser.newContext({ viewport: { width, height: 950 }, hasTouch: width === 390, locale: language });
		await context.addInitScript((language) => localStorage.setItem("keepany-language", language), language);
		const page = await context.newPage(); page.setDefaultTimeout(12_000);
		const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
		const t = copy(language);
		try {
			await installSamples(page, t);
			await page.reload();
			await expect(page.getByRole("button", { name: t("sampleLibraryPresent"), exact: true })).toBeDisabled();
			const assetsLink = page.locator(width === 390 ? ".mobile-tabbar" : ".sidebar .nav").getByRole("link", { name: t("assetsWorkspace"), exact: true });
			await assetsLink.click();
			const assetTabs = page.getByRole("navigation", { name: t("assetsWorkspace"), exact: true });
			async function selectedAssetTab(path: string, key: string, title: string) {
				await expect.poll(() => new URL(page.url()).pathname).toBe(path);
				await expect(assetTabs.locator(":scope > a[aria-current='page']")).toHaveText([t(key)]);
				await expect(page.getByRole("heading", { level: 1 })).toHaveText(t(title));
				const styles = await assetTabs.evaluate(nav => {
					const links = [...nav.querySelectorAll("a")];
					return links.map(link => ({ label: link.textContent, selected: link.getAttribute("aria-current") === "page", background: getComputedStyle(link).backgroundColor, shadow: getComputedStyle(link).boxShadow }));
				});
				const current = styles.filter(link => link.selected);
				expect(current).toHaveLength(1);
				for (const link of styles.filter(link => !link.selected)) {
					expect(link.background, `${link.label} must not share the selected highlight`).not.toBe(current[0].background);
					expect(link.shadow, `${link.label} must not retain the selected shadow`).toBe("none");
				}
				await test.info().attach(`asset-tabs-${key}`, { body: JSON.stringify({ path, styles }), contentType: "application/json" });
			}
			for (const [path, key, title] of [
				["/assets", "all", "assetsWorkspace"], ["/assets/project", "project", "project"],
				["/assets/item", "item", "item"], ["/assets/domains", "workspaceDomains", "workspaceDomains"],
				["/assets/subscription", "subscription", "subscription"], ["/finance", "workspaceLedger", "financeTitle"],
			]) {
				await assetTabs.getByRole("link", { name: t(key), exact: true }).click();
				await selectedAssetTab(path, key, title);
			}
			await page.goBack();
			await selectedAssetTab("/assets/subscription", "subscription", "subscription");
			await page.reload();
			await selectedAssetTab("/assets/subscription", "subscription", "subscription");
			await page.goto("/accounts");
			await expect(page.locator(".asset-account-card")).toHaveCount(8);
			await expect(page.locator(".workspace-navigation")).toHaveCount(0);
			await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("accountsWorkspace"));
			if (width === 390) {
				const headerActions = page.locator(".topbar").getByRole("button");
				await expect(headerActions.first()).toBeVisible();
				for (const [index, button] of (await headerActions.all()).entries()) await touchTarget(page, button, `header-${index}`);
				await touchTarget(page, page.locator(".password-vault-header").getByRole("button", { name: t("add"), exact: true }), "account-header-add");
				await touchTarget(page, page.locator(".unified-vault-access > summary"), "vault-access-summary");
				await touchTarget(page, page.getByRole("searchbox", { name: t("accountListSearch"), exact: true }), "account-search");
				await touchTarget(page, page.locator("#vault-references > summary"), "external-references-summary");
			}
			await expect(page.locator(".unified-vault-access")).not.toHaveAttribute("open", "");
			await page.getByRole("button", { name: t("add"), exact: true }).click();
			const editor = page.getByRole("dialog");
			await editor.getByLabel(t("name"), { exact: true }).fill("Synthetic account without password");
			await editor.getByRole("button", { name: t("save"), exact: true }).click();
			await expect(editor).toBeHidden();
			await expect(page.locator(".asset-account-card")).toHaveCount(9);
			const query = page.getByRole("searchbox", { name: t("accountListSearch"), exact: true });
			await query.fill("Synthetic account without password");
			await expect(page.locator(".asset-account-card")).toHaveCount(1);
			await query.fill("");
			await noOverflow(page);
			await page.screenshot({ path: join(evidence, `accounts-${language}-${width}.png`) });
			await page.locator("#vault-references > summary").click();
			await expect(page.locator(".vault-reference-table tbody tr")).toHaveCount(2);
			await page.goto("/assets/vault#vault-references");
			await expect(page.locator(".vault-reference-table")).toBeVisible();
			await expect(page.locator(".asset-account-card")).toHaveCount(9);
			await page.goto("/collections");
			await page.locator(".collections-tile").filter({ hasText: t("sampleCollection") }).locator("a").first().click();
			await expect(page.locator(".collections-member-card")).toHaveCount(26);
			const boxes = await page.locator(".collections-member-card").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
			expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(1);
			await expect(page.locator(".collections-member-cover img")).toHaveCount(4);
			await expect.poll(() => page.locator(".collections-member-cover img").evaluateAll((nodes) => nodes.every((node) => (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
			await noOverflow(page);
			await page.screenshot({ path: join(evidence, `collection-${language}-${width}.png`) });
			await page.locator(".collections-member-card").filter({ hasText: t("sampleLaptop") }).click();
			const graph = page.locator(".graph.account-family-graph");
			await expect(graph).toHaveAttribute("data-layout-ready", "true");
			await graph.getByRole("button", { name: t("accountGraphExpand"), exact: true }).click();
			await expect(page.locator(".account-graph-dialog")).toBeVisible();
			await page.getByRole("dialog").getByRole("button", { name: t("close"), exact: true }).click();
			await expect(graph).toHaveAttribute("data-layout-ready", "true");
			await graph.scrollIntoViewIfNeeded();
			await graph.locator(".react-flow__edge").first().focus();
			await page.keyboard.press("Enter");
			await expect(graph.locator(".account-graph-connection-details")).toBeVisible();
			await graph.locator(".account-graph-selection-close").click();
			const loan = page.getByRole("group", { name: t("itemLoanHistory"), exact: true });
			const maintenance = page.getByRole("group", { name: t("itemMaintenanceHistory"), exact: true });
			if (width === 390) {
				for (const [groupName, group] of [["loan", loan], ["maintenance", maintenance]] as const)
					for (const [index, target] of (await group.locator("input:not([aria-hidden=true]), button:visible").all()).entries()) await touchTarget(page, target, `${groupName}-control-${index}`);
				await maintenance.getByRole("combobox", { name: t("maintenanceDate"), exact: true }).click();
				const calendar = page.getByRole("dialog", { name: t("datePickerTitle"), exact: true });
				await expect(calendar).toBeVisible();
				for (const [index, target] of (await calendar.locator("button:visible, select:visible").all()).entries())
					if (await target.isEnabled()) await touchTarget(page, target, `calendar-control-${index}`);
				await page.keyboard.press("Escape");
				await expect(calendar).toBeHidden();
			}
			const styles = await loan.evaluate((node) => [node.querySelector("input")!, node.querySelector(".date-field > input")!].map((node) => {
				const s = getComputedStyle(node); return { height: node.getBoundingClientRect().height, border: s.borderWidth, radius: s.borderRadius, background: s.backgroundColor };
			}));
			expect(Math.abs(styles[0].height - styles[1].height)).toBeLessThan(1);
			expect(styles[0].border).toBe(styles[1].border); expect(styles[0].radius).toBe(styles[1].radius); expect(styles[0].background).toBe(styles[1].background);
			expect(await loan.locator(".date-field").evaluate(node => node.getBoundingClientRect().height)).toBe(styles[1].height);
			await loan.getByRole("button", { name: t("loan"), exact: true }).click();
			await expect(page.getByText(t("borrowerRequired"), { exact: true })).toBeVisible();
			await loan.getByLabel(t("borrower"), { exact: true }).fill("Synthetic borrower");
			await loan.getByRole("button", { name: t("loan"), exact: true }).click();
			await expect(loan.getByRole("button", { name: t("return"), exact: true })).toBeVisible();
			await expect(loan.getByRole("button", { name: t("return"), exact: true })).toBeEnabled();
			const beforeReturn = await ordinaryRows(page);
			await loan.getByRole("button", { name: t("return"), exact: true }).click();
			let confirmation = page.getByRole("dialog", { name: t("return"), exact: true });
			await expect(confirmation).toBeVisible();
			await confirmation.getByRole("button", { name: t("cancel"), exact: true }).click();
			await expect(confirmation).toBeHidden();
			expect(await ordinaryRows(page)).toEqual(beforeReturn);
			await expect(loan.getByRole("button", { name: t("return"), exact: true })).toBeVisible();
			await loan.getByRole("button", { name: t("return"), exact: true }).click();
			confirmation = page.getByRole("dialog", { name: t("return"), exact: true });
			await expect(confirmation).toBeVisible();
			await confirmation.getByRole("button", { name: t("confirm"), exact: true }).click();
			await expect(confirmation).toBeHidden();
			await expect(loan.getByRole("button", { name: t("loan"), exact: true })).toBeVisible();
			await expect(loan.getByRole("button", { name: t("loan"), exact: true })).toBeEnabled();
			const afterReturn = await ordinaryRows(page);
			const additions = afterReturn.filter(row => !beforeReturn.some(old => old.id === row.id));
			expect(additions).toHaveLength(1);
			expect(additions[0].type).toBe("history");
			expect(JSON.parse(additions[0].payload).action).toBe("return");
			const targetId = new URL(page.url()).pathname.split("/").at(-1);
			for (const row of beforeReturn.filter(row => row.id !== `asset:${targetId}`)) expect(afterReturn.find(value => value.id === row.id)).toEqual(row);
			await test.info().attach("return-cancel-confirm-records", { body: JSON.stringify({ beforeReturn, afterReturn }), contentType: "application/json" });
			await maintenance.getByLabel(t("maintenanceNotes"), { exact: true }).fill("Synthetic maintenance saved from unified form");
			const beforeInvalidDate = await page.locator(".asset-item-timeline > .list-row").count();
			await maintenance.getByRole("combobox", { name: t("maintenanceDate"), exact: true }).fill("2026-02-30");
			await page.keyboard.press("Tab");
			await maintenance.getByRole("button", { name: t("maintenance"), exact: true }).click();
			expect(await maintenance.getByRole("combobox", { name: t("maintenanceDate"), exact: true }).evaluate((node) => (node as HTMLInputElement).validity.valid)).toBe(false);
			await expect(maintenance.getByLabel(t("maintenanceNotes"), { exact: true })).toHaveValue("Synthetic maintenance saved from unified form");
			await expect(page.locator(".asset-item-timeline > .list-row")).toHaveCount(beforeInvalidDate);
			await maintenance.getByRole("combobox", { name: t("maintenanceDate"), exact: true }).fill("2026-10-28");
			await page.keyboard.press("Tab");
			await maintenance.getByRole("button", { name: t("maintenance"), exact: true }).click();
			await expect(page.locator(".asset-item-timeline")).toContainText("Synthetic maintenance saved from unified form");
			await page.reload();
			await expect(page.locator(".asset-item-timeline")).toContainText("Synthetic maintenance saved from unified form");
			await noOverflow(page);
			await page.locator(".item-history-forms").scrollIntoViewIfNeeded();
			await page.screenshot({ path: join(evidence, `history-${language}-${width}.png`) });
			await page.goto("/assets/subscription");
			await expect(page.locator(".asset-library-card")).toHaveCount(6);
			await expect(page.getByText(t("filterTag"), { exact: true })).toHaveClass("sr-only");
			await expect(page.getByRole("combobox", { name: t("filterTag"), exact: true })).toBeVisible();
			await noOverflow(page);
			await page.screenshot({ path: join(evidence, `subscriptions-${language}-${width}.png`) });
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
