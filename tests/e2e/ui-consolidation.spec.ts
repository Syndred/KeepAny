import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/ui-consolidation";
mkdirSync(evidence, { recursive: true });
const copy = (language: "zh-CN" | "en") => (key: string) => (resources[language].translation as Record<string, string>)[key] ?? key;
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
		const context = await browser.newContext({ viewport: { width, height: 950 }, locale: language });
		await context.addInitScript((language) => localStorage.setItem("keepany-language", language), language);
		const page = await context.newPage(); page.setDefaultTimeout(12_000);
		const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
		const t = copy(language);
		try {
			await installSamples(page, t);
			await page.reload();
			await expect(page.getByRole("button", { name: t("sampleLibraryPresent"), exact: true })).toBeDisabled();
			await page.goto("/accounts");
			await expect(page.locator(".asset-account-card")).toHaveCount(8);
			await expect(page.locator(".workspace-navigation")).toHaveCount(0);
			await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("accountsWorkspace"));
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
			const styles = await loan.evaluate((node) => [node.querySelector("input")!, node.querySelector(".date-field")!].map((node) => {
				const s = getComputedStyle(node); return { height: node.getBoundingClientRect().height, border: s.borderWidth, radius: s.borderRadius, background: s.backgroundColor };
			}));
			expect(Math.abs(styles[0].height - styles[1].height)).toBeLessThan(1);
			expect(styles[0].border).toBe(styles[1].border); expect(styles[0].radius).toBe(styles[1].radius); expect(styles[0].background).toBe(styles[1].background);
			await loan.getByRole("button", { name: t("loan"), exact: true }).click();
			await expect(page.getByText(t("borrowerRequired"), { exact: true })).toBeVisible();
			await loan.getByLabel(t("borrower"), { exact: true }).fill("Synthetic borrower");
			await loan.getByRole("button", { name: t("loan"), exact: true }).click();
			await expect(loan.getByRole("button", { name: t("return"), exact: true })).toBeVisible();
			await loan.getByRole("button", { name: t("return"), exact: true }).click();
			await expect(loan.getByRole("button", { name: t("loan"), exact: true })).toBeVisible();
			await maintenance.getByLabel(t("maintenanceNotes"), { exact: true }).fill("Synthetic maintenance saved from unified form");
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
