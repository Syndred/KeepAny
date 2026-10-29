import { expect, test } from "@playwright/test";
import { createProject } from "./helpers/create-project";

test("desktop shell follows the frozen frame and keeps real navigation reachable in both languages", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.goto("/");
	const projectId = await createProject(page, "Shell Atlas");

	for (const [language, suffix] of [["zh-CN", "zh"], ["en", "en"]] as const) {
		await page.evaluate((value) => localStorage.setItem("keepany-language", value), language);
		await page.goto("/");
		await expect(page.getByText("Shell Atlas").first()).toBeVisible();
		const geometry = await page.evaluate(() => {
			const element = (selector: string) => {
				const found = document.querySelector(selector);
				if (!found) throw new Error(`Missing ${selector}`);
				return found;
			};
			const rect = (selector: string) => element(selector).getBoundingClientRect();
			const root = rect("#root"), shell = rect(".shell"), sidebar = rect(".sidebar"), search = rect(".top-search");
			return { frameLeft: root.left, frameRadius: getComputedStyle(element("#root")).borderTopLeftRadius, shellLeft: shell.left, shellWidth: shell.width, sidebarRight: sidebar.right, sidebarBorder: getComputedStyle(element(".sidebar")).borderRightWidth, searchWidth: search.width, searchBorder: getComputedStyle(element(".top-search")).borderTopWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
		});
		expect(geometry).toMatchObject({ frameLeft: 8, frameRadius: "18px", sidebarBorder: "3px", searchWidth: 190, searchBorder: "2px", horizontalOverflow: false });
		expect(geometry.shellLeft).toBe(10);
		expect(geometry.sidebarRight - geometry.shellLeft).toBe(195);
		await expect(page.locator(".sidebar-customize[href='/collections']")).toHaveCount(1);
		await expect(page.locator(".sidebar-collection-manage")).toHaveCount(0);
		await expect(page.locator(".sidebar-tools-menu")).toHaveCount(0);
		await page.screenshot({ path: `/tmp/keepany-shell-${suffix}-1280.png` });
		await page.locator(".workspace-current").click();
		await expect(page.getByRole("menuitem")).toHaveCount(3);
		await expect(page.getByRole("menuitem").first()).toHaveAttribute("href", "/settings");
		await page.keyboard.press("Escape");
		await page.locator(".top-search-trigger").click();
		await expect(page.locator(".top-search-panel input")).toBeFocused();
		await page.locator(".top-search-panel input").fill("Shell Atlas");
		await expect(page.locator(".top-search-panel .search-results a")).toContainText("Shell Atlas");
		await page.locator(".top-search-panel .search-results a").click();
		await expect(page).toHaveURL(new RegExp(`/assets/project/${projectId}$`));
		await page.goto("/");
		await page.locator(".top-search-trigger").click();
		await page.locator(".top-search-panel input").fill("Atlas");
		await page.locator(".top-search-panel-close").click();
		await expect(page.locator(".top-search-panel")).toHaveCount(0);
		await expect.poll(() => page.evaluate(() => sessionStorage.getItem("keepany-search"))).toBe("");
		await page.locator(".sidebar-user").click();
		await expect(page.getByRole("menuitem")).toHaveCount(2);
		await expect(page.locator(".sidebar-trash")).toBeVisible();
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: language === "zh-CN" ? "AI 助手与授权" : "AI assistant and access", exact: true }).click();
		await expect(page.getByRole("menuitem")).toHaveCount(2);
		await expect(page.getByRole("menuitem").first()).toHaveAttribute("href", "/change-impact");
		await expect(page.getByRole("menuitem").last()).toHaveAttribute("href", "/assistant-access");
		await page.keyboard.press("Escape");
	}
});

test("asset navigation reaches subscriptions and the ledger with one active tab", async ({ page }) => {
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("keepany-language", "zh-CN"));
	await page.reload();
	await page.locator("aside.sidebar").getByRole("link", { name: "资产", exact: true }).click();
	await page.locator(".workspace-navigation").getByRole("link", { name: "订阅", exact: true }).click();
	await expect(page.locator(".workspace-navigation > a[aria-current='page']")).toHaveCount(1);
	await page.locator(".workspace-navigation").getByRole("link", { name: "费用账本", exact: true }).click();
	await expect(page).toHaveURL(/\/finance$/);
	await expect(page.getByRole("heading", { name: "订阅与账单" })).toBeVisible();
	await expect(page.locator(".workspace-navigation > a[aria-current='page']")).toHaveCount(1);
	await expect(page.locator("aside.sidebar").getByRole("link", { name: "资产", exact: true })).toHaveAttribute("aria-current", "page");
});

for (const locale of ["en-US", "zh-CN"]) {
	test(`${locale} long project title stays within the mobile overview and opens its detail`, async ({ browser }) => {
		const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
		try {
			const page = await context.newPage();
			await page.goto("/");
			const title = "VeryLongVisibleProjectTitle".repeat(3);
			const id = await createProject(page, title);
			await page.goto("/");
			const card = page.locator(".overview-project-card");
			await expect(card.getByRole("heading", { name: title, exact: true })).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			await page.screenshot({ path: test.info().outputPath(`overview-long-title-${locale}-390.png`), fullPage: true });
			await card.click();
			await expect(page).toHaveURL(new RegExp(`/assets/project/${id}$`));
			await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
		} finally {
			await context.close();
		}
	});
}
