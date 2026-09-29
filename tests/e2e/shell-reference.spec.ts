import { expect, test } from "@playwright/test";

test("desktop shell follows the frozen frame and keeps real navigation reachable in both languages", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.goto("/");
	const projectId = await page.evaluate(async ([domainUrl, repositoryUrl]) => {
		const { newAsset } = await import(domainUrl);
		const { saveBatch } = await import(repositoryUrl);
		const project = { ...newAsset("project"), name: "Shell Atlas" };
		const account = { ...newAsset("account"), name: "Atlas account" };
		await saveBatch([{ type: "asset", value: project }, { type: "asset", value: account }]);
		return project.id as string;
	}, [`/@fs${process.cwd()}/packages/domain/src/index.ts`, `/@fs${process.cwd()}/packages/local-db/src/index.ts`]);

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
		expect(geometry).toMatchObject({ frameLeft: 8, frameRadius: "18px", shellWidth: 1180, sidebarBorder: "3px", searchWidth: 190, searchBorder: "2px", horizontalOverflow: false });
		expect(geometry.shellLeft).toBeGreaterThanOrEqual(48);
		expect(geometry.sidebarRight).toBeGreaterThan(240);
		await expect(page.locator(".sidebar-customize")).toHaveAttribute("href", "/collections");
		await expect(page.locator(".sidebar-collection-manage")).toHaveCount(0);
		await expect(page.locator(".sidebar-tools-menu")).toHaveCount(0);
		await page.screenshot({ path: `/tmp/keepany-shell-${suffix}-1280.png` });
		await page.locator(".workspace-current").click();
		await expect(page.locator(".toast[role='status']")).toContainText(language === "zh-CN" ? "个人工作区" : "Personal workspace");
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
		await expect(page.locator(".sidebar-tools-menu a")).toHaveCount(3);
		await page.locator(".sidebar-user").click();
		await page.locator(".top-ai-wrap button").click();
		await expect(page.locator(".top-ai-menu a")).toHaveCount(2);
		await expect(page.locator(".top-ai-menu a").first()).toHaveAttribute("href", "/change-impact");
		await expect(page.locator(".top-ai-menu a").last()).toHaveAttribute("href", "/assistant-access");
	}
});

test("subscription sidebar opens the local money trail", async ({ page }) => {
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("keepany-language", "zh-CN"));
	await page.reload();
	await page.locator("aside.sidebar").getByRole("link", { name: "订阅" }).click();
	await expect(page).toHaveURL(/\/finance$/);
	await expect(page.getByRole("heading", { name: "订阅与账单" })).toBeVisible();
	await expect(page.locator("aside.sidebar").getByRole("link", { name: "订阅" })).toHaveAttribute("aria-current", "page");
});
