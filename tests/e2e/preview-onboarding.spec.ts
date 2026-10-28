import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "docs/evidence/2026-10-11/preview";

for (const locale of ["zh-CN", "en-US"] as const) {
	for (const width of [390, 1280]) {
		test(`new ${locale} visitor can start with sample records at ${width}px`, async ({ browser }) => {
			const context = await browser.newContext({ locale, viewport: { width, height: 844 } });
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", error => errors.push(error.message));
			const zh = locale === "zh-CN";
			try {
				mkdirSync(evidence, { recursive: true });
				await page.goto("/");
				const start = page.getByRole("link", { name: zh ? "用示例资料开始" : "Start with sample records", exact: true });
				await expect(start).toBeVisible();
				const actions = start.locator("..");
				expect(await actions.evaluate(element => Number.parseFloat(getComputedStyle(element).gap))).toBeGreaterThanOrEqual(8);
				expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
				await page.screenshot({ path: `${evidence}/onboarding-${zh ? "zh" : "en"}-${width}-empty.png`, fullPage: true });
				await start.click();
				await expect(page).toHaveURL(/\/settings#advanced-settings$/);
				await expect(page.locator("#advanced-settings")).toHaveJSProperty("open", true);
				const add = page.getByRole("button", { name: zh ? "加入示例资料" : "Add sample records", exact: true });
				await expect(add).toBeEnabled();
				await add.click();
				await expect(page.getByRole("button", { name: zh ? "完整示例资料已加入" : "Full sample records already added", exact: true })).toBeDisabled();
				await page.goto("/");
				await expect(page.getByText(zh ? "示例 | 林间笔记" : "Sample | Mori Notes", { exact: true }).first()).toBeVisible();
				await expect(start).toHaveCount(0);
				await page.reload();
				await expect(page.getByText(zh ? "示例 | 林间笔记" : "Sample | Mori Notes", { exact: true }).first()).toBeVisible();
				await page.screenshot({ path: `${evidence}/onboarding-${zh ? "zh" : "en"}-${width}-sample.png`, fullPage: true });
				expect(errors).toEqual([]);
			} finally { await context.close(); }
		});
	}
}
