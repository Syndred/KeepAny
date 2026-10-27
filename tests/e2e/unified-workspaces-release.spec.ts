import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/keepany-unified-built";
mkdirSync(evidence, { recursive: true });

for (const locale of ["zh-CN", "en-US"] as const) for (const width of [390, 1280]) {
	test(`${locale} ${width}px built merged workspace preserves sample records, ledger and inline vault access`, async ({ browser }) => {
		const context = await browser.newContext({ locale, viewport: { width, height: 950 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const zh = locale === "zh-CN";
		try {
			await page.goto("/");
			await page.getByRole("link", { name: zh ? "用示例资料开始" : "Start with sample records", exact: true }).click();
			const add = page.getByRole("button", { name: zh ? "加入示例资料" : "Add sample records", exact: true });
			await add.click();
			await expect(add).toBeDisabled();
			await expect(page.getByText(zh ? "已保存" : "Saved", { exact: true })).toBeVisible();
			await page.goto("/assets");
			await expect(page.getByRole("heading", { name: zh ? "资产" : "Assets", exact: true })).toBeVisible();
			await expect(page.locator(".workspace-asset-grid .asset-project-card").first()).toBeVisible();
			expect(await page.locator(".workspace-asset-grid .asset-library-card").count()).toBeGreaterThanOrEqual(2);
			await expect(page.locator(".workspace-summary-grid > section")).toHaveCount(4);
			await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
			await page.screenshot({ path: join(evidence, `built-assets-${zh ? "zh" : "en"}-${width}.png`), fullPage: true });
			await page.locator(".workspace-navigation").getByRole("link", { name: zh ? "费用账本" : "Ledger", exact: true }).click();
			await expect(page.locator(".finance-summary > section")).toHaveCount(3);
			await expect(page.getByRole("heading", { name: zh ? "订阅与账单" : "Subscriptions and bills", exact: true })).toBeVisible();
			await page.goto("/accounts");
			await expect(page.getByRole("heading", { name: zh ? "账号" : "Accounts", exact: true })).toBeVisible();
			await expect(page.locator(".asset-account-card").first()).toBeVisible();
			await page.screenshot({ path: join(evidence, `built-accounts-${zh ? "zh" : "en"}-${width}.png`), fullPage: true });
			await page.locator(".asset-account-card").first().click();
			await page.getByRole("button", { name: zh ? "在此查看密码" : "View passwords here", exact: true }).click();
			await expect(page.locator(".account-passwords-section #password-vault-master")).toBeVisible();
			await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
			await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
			await page.reload();
			await expect(page.getByRole("button", { name: zh ? "在此查看密码" : "View passwords here", exact: true })).toBeVisible();
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
