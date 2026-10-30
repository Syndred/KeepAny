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
			await page.getByRole("button", { name: zh ? "用示例资料开始" : "Start with sample records", exact: true }).click();
			const add = page.getByRole("dialog").getByRole("button", { name: zh ? "加入示例资料" : "Add sample records", exact: true });
			await add.click();
			await expect(page.getByRole("dialog")).toBeHidden();
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
			await page.locator(".compact-account-title").first().click();
			await page.getByRole("button", { name: zh ? "在此查看密码" : "View passwords here", exact: true }).click();
			const passwords = page.locator(".account-passwords-section");
			await expect(passwords.locator("#password-vault-master")).toBeVisible();
			await expect(passwords.getByRole("status").filter({ hasText: zh ? "正在打开密码库" : "Opening the password vault" })).toHaveCount(0);
			await expect(passwords).toBeFocused();
			await expect(passwords).toBeInViewport();
			await expect.poll(() => passwords.evaluate((section) => {
				const facts = document.querySelector(".account-facts-grid");
				if (!facts) return false;
				const panel = section.getBoundingClientRect();
				const source = facts.getBoundingClientRect();
				return panel.top >= source.bottom - 1 && panel.width >= source.width - 1 && panel.top >= 0 && panel.top < innerHeight - 100;
			})).toBe(true);
			await page.screenshot({ path: join(evidence, `built-inline-open-${zh ? "zh" : "en"}-${width}.png`), fullPage: false });
			await expect(page.locator(".account-passwords-section #password-vault-master")).toBeVisible();
			await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
			await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
			const syntheticMaster = "Synthetic FC12 persistence 2026!";
			await passwords.locator("#password-vault-master").fill(syntheticMaster);
			await passwords.locator("#password-vault-master-confirm").fill(syntheticMaster);
			await passwords.getByRole("button", { name: zh ? "创建密码库" : "Create vault", exact: true }).click();
			await expect(passwords.locator(".password-vault-toolbar")).toBeVisible();
			await page.reload();
			await expect(page.getByRole("button", { name: zh ? "在此查看密码" : "View passwords here", exact: true })).toBeVisible();
			await page.getByRole("button", { name: zh ? "在此查看密码" : "View passwords here", exact: true }).click();
			await expect(passwords.locator("#password-vault-unlock-master")).toBeVisible();
			await expect(passwords.locator("#password-vault-master-confirm")).toHaveCount(0);
			await expect(passwords).toBeFocused();
			// Verify settled layout after the persisted vault and browser scroll anchoring finish.
			await page.waitForTimeout(500);
			await expect(passwords).toBeFocused();
			await expect.poll(() => passwords.evaluate((section) => section.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
			await expect.poll(() => passwords.evaluate((section) => section.getBoundingClientRect().top)).toBeLessThan(200);
			await page.screenshot({ path: join(evidence, `built-inline-persisted-${zh ? "zh" : "en"}-${width}.png`), fullPage: false });
			await passwords.locator("#password-vault-unlock-master").fill(syntheticMaster);
			await passwords.getByRole("button", { name: zh ? "解锁密码库" : "Unlock vault", exact: true }).click();
			await expect(passwords.locator(".password-vault-toolbar")).toBeVisible();
			await page.getByRole("button", { name: zh ? "收起密码" : "Hide passwords", exact: true }).click();
			await expect(passwords).toHaveCount(0);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
