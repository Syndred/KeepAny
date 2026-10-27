import { expect, test } from "@playwright/test";

test.use({ actionTimeout: 15_000 });

for (const locale of ["zh-CN", "en-US"] as const) {
	for (const width of [390, 1280]) {
		test(`${locale} ${width}px organize asset entry retains and reloads the subscription ledger`, async ({ browser }) => {
			const context = await browser.newContext({ locale, viewport: { width, height: 844 } });
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const zh = locale === "zh-CN";
			const assetsLabel = zh ? "资产" : "Assets";
			const ledgerLabel = zh ? "费用账本" : "Ledger";
			const financeTitle = zh ? "订阅与账单" : "Subscriptions and bills";
			try {
				await page.goto("/collections");
				const entry = page.locator(".collections-organize-nav").getByRole("link", { name: assetsLabel, exact: true });
				await expect(entry).toHaveAttribute("href", "/assets");
				await expect(page.locator('aside.sidebar a[href="/assets"]')).toHaveText(assetsLabel);
				await entry.scrollIntoViewIfNeeded();
				await expect(entry).toBeInViewport({ ratio: 1 });
				await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
				await page.screenshot({ path: test.info().outputPath(`collections-subscription-entry-${locale}-${width}.png`) });
				await entry.click();
				await expect(page).toHaveURL(/\/assets$/);
				await page.locator(".workspace-navigation").getByRole("link", { name: ledgerLabel, exact: true }).click();
				await expect(page).toHaveURL(/\/finance$/);
				const finance = page.locator("main.finance-page");
				await expect(finance.getByRole("heading", { name: financeTitle, exact: true })).toBeVisible();
				await expect(finance.locator(".finance-summary > section")).toHaveCount(3);
				await expect(finance.locator(".finance-summary > section").first()).toContainText(zh ? "暂无计划费用" : "No planned cost");
				await expect(finance.locator(".finance-summary > section").nth(1)).toContainText(zh ? "暂无记录" : "No records yet");
				await page.reload();
				await expect(finance.getByRole("heading", { name: financeTitle, exact: true })).toBeVisible();
				await expect(finance.locator(".finance-entry")).toHaveCount(0);
				await expect(finance.locator(".finance-linked-list")).toHaveCount(0);
				await expect(page.locator('aside.sidebar a[href="/assets"]')).toHaveAttribute("aria-current", "page");
				await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
				await page.screenshot({ path: test.info().outputPath(`collections-finance-readback-${locale}-${width}.png`) });
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}
