import { expect, test } from "@playwright/test";

for (const locale of ["zh-CN", "en-US"] as const) {
	test(`${locale} assistant access page shows real empty state at 390px`, async ({ browser }) => {
	const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
	const page = await context.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		await page.goto("/assistant-access");
		const copy = locale === "zh-CN"
			? { title: "只分享完成任务所需的资产信息。", empty: "当前没有有效的本机连接", configure: "配置本机授权", recent: "连接后可查看本次授权的访问记录。" }
			: { title: "Share only the records needed for the task.", empty: "No active local connection", configure: "Configure local access", recent: "Connect to view access recorded for this grant." };
		await expect(page.getByRole("heading", { name: copy.title })).toBeVisible();
		await expect(page.getByText(copy.empty)).toBeVisible();
		await expect(page.getByText(copy.recent)).toBeVisible();
		await expect(page.getByRole("button", { name: locale === "zh-CN" ? "撤销本机授权" : "Revoke local access" })).toHaveCount(0);
		await page.screenshot({ path: `/private/tmp/keepany-assistant-access-${locale}.png`, fullPage: true });
		expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
		await page.getByRole("link", { name: copy.configure }).click();
		await expect(page).toHaveURL(/\/settings#assistant$/);
		await expect(page.locator(".mcp-panel")).toBeVisible();
		expect(errors).toEqual([]);
	} finally { await context.close(); }
});
}
