import { expect, test } from "@playwright/test";

const languages = [
	{ language: "zh-CN", nav: "主要导航", tabs: ["概览", "资产", "账号", "待办", "更多"], more: "更多", back: "返回更多", ai: "询问 AI 助手", model: "模型与助手设置", connections: "账号绑定与实验同步选项", categories: "项目分类与标签", references: "外部密码引用", backup: "创建备份" },
	{ language: "en", nav: "Main navigation", tabs: ["Overview", "Assets", "Accounts", "Tasks", "More"], more: "More", back: "Back to More", ai: "Ask AI assistant", model: "Model and assistant settings", connections: "Account binding and experimental sync options", categories: "Project categories and tags", references: "External password references", backup: "Create backup" },
] as const;

for (const labels of languages) {
	test(`mobile app navigation and real tools work in ${labels.language}`, async ({ page }, testInfo) => {
		await page.addInitScript((language) => localStorage.setItem("keepany-language", language), labels.language);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/");
		const tabbar = page.getByRole("navigation", { name: labels.nav });
		await expect(tabbar).toBeVisible();
		await expect(tabbar.getByRole("link")).toHaveCount(5);
		const results: Array<{ action: string; expected: string; actual: string }> = [];

		for (const [index, path] of ["/", "/assets", "/accounts", "/tasks", "/more"].entries()) {
			await test.step(`点击底栏 ${labels.tabs[index]} → ${path} 并只高亮当前栏目`, async () => {
				await tabbar.getByRole("link", { name: labels.tabs[index], exact: true }).click();
				await expect(page).toHaveURL(new RegExp(`${path === "/" ? "/" : path}$`));
				await expect(tabbar.locator('[aria-current="page"]')).toHaveCount(1);
				await expect(tabbar.getByRole("link", { name: labels.tabs[index], exact: true })).toHaveAttribute("aria-current", "page");
				results.push({ action: `点击底栏 ${labels.tabs[index]}`, expected: `进入 ${path}，仅当前栏目高亮`, actual: `实际URL ${new URL(page.url()).pathname}，高亮1项` });
			});
		}

		await test.step("更多工具使用现有真实路由并能返回", async () => {
			const tools = page.locator(".mobile-more-page .mobile-tool");
			await expect(tools).toHaveCount(17);
			await page.getByRole("link", { name: labels.model }).click();
			await expect(page).toHaveURL(/\/settings#assistant$/);
			await expect(page.locator("details#assistant")).toHaveJSProperty("open", true);
			await page.getByRole("link", { name: labels.back, exact: true }).click();
			await expect(page.getByRole("heading", { name: labels.more, exact: true })).toBeVisible();
			await page.getByRole("link", { name: new RegExp(labels.connections) }).click();
			await expect(page).toHaveURL(/\/settings#connections$/);
			await expect(page.locator("details#connections")).toHaveJSProperty("open", true);
			await page.getByRole("link", { name: labels.back, exact: true }).click();
			await page.getByRole("link", { name: labels.references }).click();
			await expect(page).toHaveURL(/\/assets\/vault#vault-references$/);
			await expect(page.locator("#vault-references")).toBeVisible();
			await tabbar.getByRole("link", { name: labels.more, exact: true }).click();
			await page.getByRole("link", { name: labels.categories, exact: true }).click();
			await expect(page).toHaveURL(/\/assets\/project$/);
			await expect(page.locator(".asset-category-manage")).toBeVisible();
			await tabbar.getByRole("link", { name: labels.more, exact: true }).click();
			await page.getByRole("link", { name: new RegExp(`^${labels.backup}`) }).click();
			await expect(page).toHaveURL(/\/intake#backup-password$/);
			await expect(page.locator("#backup-password")).toBeVisible();
			results.push({ action: "点击模型设置/连接/外部密码引用/项目分类/创建备份", expected: "进入原有完整页面，展开对应设置，分类管理及备份可达", actual: "5条真实路由及设置open、引用区、分类管理、备份密码区断言通过" });
		});

		await test.step("更多AI按钮打开现有选择资料对话框，关闭后保留页面", async () => {
			await tabbar.getByRole("link", { name: labels.more, exact: true }).click();
			await page.getByRole("button", { name: new RegExp(labels.ai) }).click();
			await expect(page.getByRole("dialog")).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(page.getByRole("dialog")).toBeHidden();
			await expect(page).toHaveURL(/\/more$/);
			results.push({ action: "更多→询问AI→Escape关闭", expected: "打开原有AI范围选择弹窗，关闭回到更多", actual: "现有dialog显示/关闭、/more保留" });
		});

		for (const width of [360, 390, 430]) {
			await test.step(`${width}px 触控目标、横向边界与最后一行可达`, async () => {
				await page.setViewportSize({ width, height: 844 });
				await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
				for (const link of await tabbar.getByRole("link").all()) {
					const box = await link.boundingBox();
					expect(box?.width).toBeGreaterThanOrEqual(44);
					expect(box?.height).toBeGreaterThanOrEqual(44);
				}
				const last = page.locator(".mobile-more-page .mobile-tool").last();
				await last.scrollIntoViewIfNeeded();
				await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
				const lastBox = await last.boundingBox();
				const navBox = await tabbar.boundingBox();
				if (!lastBox || !navBox) throw Error("Expected visible last tool and mobile navigation");
				expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(navBox.y + 1);
				for (const target of await page.locator(".topbar .mobile-menu, .topbar .top-search, .topbar .top-icon-button:visible").all()) {
					const box = await target.boundingBox();
					expect(box?.width).toBeGreaterThanOrEqual(44);
					expect(box?.height).toBeGreaterThanOrEqual(44);
				}
				await page.screenshot({ path: testInfo.outputPath(`more-${labels.language}-${width}.png`), fullPage: true });
				results.push({ action: `${width}px滚动到更多最后一行`, expected: "无横向越界，底栏触控>=44px，末行不被底栏盖住", actual: "全部断言通过，截图留test-results" });
			});
		}
		await test.step("从底部工具返回更多保留原滚动位置", async () => {
			const before = await page.evaluate(() => window.scrollY);
			await page.locator(".mobile-more-page .mobile-tool").last().click();
			await page.getByRole("link", { name: labels.back, exact: true }).click();
			await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(before, 0);
			results.push({ action: "在更多底部打开设置再返回", expected: "保留更多原滚动位置", actual: "返回滚动Y与进入前一致" });
		});
		await testInfo.attach("手机导航逐步验收", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
	});
}

test("desktop navigation remains available without the mobile tabbar", async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/");
	await expect(page.locator("aside.sidebar")).toBeVisible();
	await expect(page.locator(".mobile-tabbar")).toBeHidden();
	await page.goto("/settings");
	await expect(page.locator(".mobile-more-back")).toBeHidden();
	await expect(page.locator(".desktop-tool-back")).toBeVisible();
});
