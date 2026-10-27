import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import type { Asset, Category, History, Relation } from '../../packages/domain/src';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import { resources } from '../../apps/web/src/i18n';
import { selectChoice } from './helpers/select-choice';
import { sourceModuleUrl } from './helpers/source-module-url';

// Fresh mobile acceptance, not inherited historical outcomes. Reused local
// scenarios retain repository readbacks and explicit synthetic fault injection.
// All screenshots/artifacts go outside the repository when the evidence env is set.
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? resolve('test-results/mobile-acceptance-core');
mkdirSync(evidence, { recursive: true });
test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' });
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed() && page.url() !== 'about:blank') {
    await page.screenshot({ path: info.outputPath('final-mobile.png'), fullPage: true });
  }
});

test.describe('F01-navigation — fresh 4236 shared React mobile', () => {
// Reused steps from mobile-app-shell.spec.ts; restricted to mobile widths.

test('cold backup tool reveals the password form after its page finishes loading', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/more');
	await expect(page.locator('.mobile-more-page')).toBeVisible();
	await page.route('**/src/workflows.tsx*', async route => {
		await new Promise(resolve => setTimeout(resolve, 800));
		await route.continue();
	});
	await page.locator('.mobile-more-page a[href="/intake#backup-password"]').click();
	await expect(page.locator('#backup-password')).toBeInViewport();
});

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


});


test.describe('F01-F03-summary — fresh 4236 shared React mobile', () => {
// Reused steps from workspace-summary-qa.spec.ts; restricted to mobile widths.

// Healthy-contract coverage for T02: the original merged-workspace fixture uses
// only one past purchase date and future expiry dates. These cases exercise the
// date boundaries, deleted task, duplicate relation and separate currencies.
mkdirSync(evidence, { recursive: true });
const repositoryPath = sourceModuleUrl("packages/local-db/src/index.ts");
const domainPath = sourceModuleUrl("packages/domain/src/index.ts");

test.use({ timezoneId: "Asia/Shanghai" });
test.setTimeout(120_000);

async function seed(page: Page, locale: "zh-CN" | "en") {
	await page.addInitScript((language) => localStorage.setItem("keepany-language", language), locale);
	await page.clock.setFixedTime(new Date("2026-10-27T04:00:00Z"));
	await page.goto("/assets");
	await expect(page.locator(".workspace-catalog")).toBeVisible();
	return page.evaluate(async ({ repositoryPath, domainPath }) => {
		const { saveBatch } = await import(repositoryPath);
		const { newAsset, taskSchema, historySchema, relationSchema } = await import(domainPath);
		const domains = ["2026-10-27", "2026-10-26", "2026-10-28", ""].map((expiryDate, index) => ({
			id: crypto.randomUUID(), name: `boundary-${index}.example`, expiryDate,
			annualAmount: [1200, 100000, 500, null][index], currency: ["USD", "CNY", "JPY", "USD"][index],
			registrar: "Synthetic registrar", accountId: "", autoRenew: "unknown",
		}));
		const project = { ...newAsset("project"), name: "T02 project", projectDomains: domains };
		const items = ["2026-10-25", "2026-10-27", "2026-10-28", ""].map((purchaseDate, index) => ({
			...newAsset("item"), name: `T02 item ${index}`, purchaseDate,
			amount: [10000, 2500, 1000, 0][index], currency: ["CNY", "USD", "JPY", "CNY"][index], itemPurchasePriceKnown: index < 3,
		}));
		const subscriptions = ["2026-10-27", "2026-10-26", "2026-10-28", ""].map((dueDate, index) => ({
			...newAsset("subscription"), name: `T02 subscription ${index}`, dueDate,
			amount: [1234, 4567, 8900, 100][index], currency: ["USD", "CNY", "JPY", "USD"][index],
		}));
		const tasks = [false, true, true].map((done, index) => taskSchema.parse({
			id: crypto.randomUUID(), assetId: project.id, name: `T02 task ${index}`, done, deleted: index === 2, createdAt: project.createdAt,
		}));
		const relations = [0, 1].map(() => relationSchema.parse({
			id: crypto.randomUUID(), from: project.id, to: subscriptions[0].id, label: "uses", createdAt: project.createdAt,
		}));
		const history = [
			{ assetId: subscriptions[0].id, action: "expense", amount: 1200, currency: "USD" },
			{ assetId: subscriptions[1].id, action: "renew", amount: 4567, currency: "CNY" },
			{ assetId: subscriptions[2].id, action: "expense", amount: 1000, currency: "JPY" },
			{ assetId: project.id, action: "expense", amount: 500, currency: "JPY" },
			{ assetId: project.id, action: "refund", amount: 1000, currency: "USD" },
		].map((entry, index) => historySchema.parse({ ...entry, id: crypto.randomUUID(), title: `T02 cost ${index}`, note: "", eventDate: "2026-10-27", billDate: "2026-10-27", createdAt: project.createdAt }));
		await saveBatch([
			...[project, ...items, ...subscriptions].map((value) => ({ type: "asset", value })),
			...tasks.map((value) => ({ type: "task", value })),
			...relations.map((value) => ({ type: "relation", value })),
			...history.map((value) => ({ type: "history", value })),
		]);
		return { project: project.id, item: items[0].id, subscription: subscriptions[0].id, task: tasks[0].id, domain: domains[0].id };
	}, { repositoryPath, domainPath });
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390]) {
	test(`T02 ${locale} ${width}px date boundaries progress money and original paths`, async ({ page }) => {
		await page.setViewportSize({ width, height: 950 });
		const t = (key: string) => resources[locale].translation[key];
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const ids = await seed(page, locale);
		const grid = page.locator(".workspace-asset-grid");
		const card = (name: string) => grid.locator(":scope > a").filter({ has: page.locator("strong", { hasText: name }) });
		const project = () => grid.locator(".asset-project-card").filter({ hasText: "T02 project" });
		const summary = page.locator(".workspace-summary-grid");

		await test.step("T02-01: type navigation and each card's original details", async () => {
			await expect(grid.locator(":scope > a")).toHaveCount(13);
			for (const [label, kind] of [["project", "project"], ["item", "item"], ["subscription", "subscription"]]) {
				await page.locator(".workspace-navigation").getByRole("link", { name: t(label), exact: true }).click();
				await expect(page).toHaveURL(new RegExp(`/assets/${kind}$`));
				await page.locator(".workspace-navigation").getByRole("link", { name: t("all"), exact: true }).click();
				await expect(grid.locator(":scope > a")).toHaveCount(13);
			}
			for (const [selector, kind, id] of [[".asset-project-card", "project", ids.project], [".asset-library-card", "item", ids.item], [".asset-library-card", "subscription", ids.subscription]]) {
				const name = kind === "project" ? "T02 project" : `T02 ${kind} 0`;
				await grid.locator(selector).filter({ hasText: name }).click();
				await expect(page).toHaveURL(new RegExp(`/assets/${kind}/${id}$`));
				await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
				await page.locator(".topbar-back-link").click();
			}
			await page.locator(".workspace-navigation").getByRole("link", { name: t("workspaceDomains"), exact: true }).click();
			await expect(grid.locator(":scope > a")).toHaveCount(4);
			await grid.locator(".workspace-domain-card").filter({ hasText: "boundary-0.example" }).click();
			await expect(page).toHaveURL(new RegExp(`/assets/project/${ids.project}#project-domain-${ids.domain}$`));
			await expect(page.locator(`#project-domain-${ids.domain}`)).toBeInViewport();
			await page.goto("/assets");
		});

		await test.step("T02-02: past today future missing purchase dates and persisted edit", async () => {
			await expect(card("T02 item 0").locator(".workspace-asset-metrics > strong")).toContainText(locale === "en" ? "2 days" : "2 天");
			await expect(card("T02 item 1").locator(".workspace-asset-metrics > strong")).toContainText(locale === "en" ? "0 days" : "0 天");
			await expect(card("T02 item 2").locator(".workspace-asset-metrics > strong")).toContainText("2026");
			await expect(card("T02 item 3").locator(".workspace-asset-metrics > strong")).toHaveText(t("workspacePurchaseDateMissing"));
			await card("T02 item 0").click();
			await page.locator("main.page > .page-header").getByRole("button", { name: t("edit"), exact: true }).click();
			const dialog = page.getByRole("dialog");
			await dialog.locator("#purchaseDate").fill("2026-10-26");
			await expect(dialog.locator("#purchaseDate")).toHaveValue("2026-10-26");
			await dialog.getByRole("button", { name: t("save"), exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.goto("/assets");
			await page.reload();
			await expect(card("T02 item 0").locator(".workspace-asset-metrics > strong")).toContainText(locale === "en" ? "1 day" : "1 天");
		});

		await test.step("T02-03: deleted tasks excluded and expiry boundaries", async () => {
			await expect(project()).toContainText("1 / 2");
			for (const [index, expected] of [[0, t("workspaceDueToday")], [1, locale === "en" ? "1 day overdue" : "已过期 1 天"], [2, locale === "en" ? "1 day left" : "剩余 1 天"], [3, t("workspaceDateMissing")]] as const) {
				await expect(card(`T02 subscription ${index}`).locator(".workspace-asset-metrics > strong")).toContainText(expected);
				await expect(grid.locator(".workspace-domain-card").filter({ hasText: `boundary-${index}.example` }).locator(":scope > strong")).toContainText(expected);
			}
			await expect(summary.locator("section").nth(3).locator("strong")).toHaveText("4");
			await project().click();
			await page.locator(`#task-${ids.task}`).getByRole("button", { name: t("complete"), exact: true }).click();
			await expect(page.locator(`#task-${ids.task}`).getByRole("button", { name: t("reopen"), exact: true })).toBeVisible();
			await page.goto("/assets");
			await page.reload();
			await expect(project()).toContainText("2 / 2");
		});

		await test.step("T02-04: separate currencies duplicate links and persisted fee change", async () => {
			await expect(summary.locator("section").nth(0)).toContainText("100.00");
			await expect(summary.locator("section").nth(0)).toContainText("25.00");
			await expect(summary.locator("section").nth(0)).toContainText("1,000");
			await expect(summary.locator("section").nth(1)).toContainText("12.00");
			await expect(summary.locator("section").nth(1)).toContainText("45.67");
			await expect(summary.locator("section").nth(1)).toContainText("1,500");
			await expect(summary.locator("section").nth(2)).toContainText("13.34");
			await expect(project()).toContainText("160.08");
			await expect(project()).toContainText("12.00");
			await page.screenshot({ path: join(evidence, `T02-summary-${locale}-${width}.png`), fullPage: true });
			await page.locator(".workspace-navigation").getByRole("link", { name: t("workspaceLedger"), exact: true }).click();
			const row = page.locator(".finance-linked-row").filter({ hasText: "T02 subscription 0" });
			await row.getByRole("button", { name: t("edit"), exact: true }).click();
			const dialog = page.getByRole("dialog");
			await dialog.locator("#amount").fill("15.99");
			await expect(dialog.locator("#amount")).toHaveValue("15.99");
			await dialog.getByRole("button", { name: t("save"), exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.goto("/assets");
			await page.reload();
			await expect(summary.locator("section").nth(2)).toContainText("16.99");
			await expect(summary.locator("section").nth(1)).toContainText("12.00");
			await expect(project()).toContainText("203.88");
			await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
			expect(await grid.evaluate((element) => parseFloat(getComputedStyle(element).rowGap))).toBeGreaterThanOrEqual(16);
			await page.screenshot({ path: join(evidence, `T02-after-${locale}-${width}.png`), fullPage: true });
		});
		expect(errors).toEqual([]);
	});
}

for (const locale of ["zh-CN", "en"] as const) {
	test(`T02 ${locale} supplemental asset layouts keep controls reachable`, async ({ page }) => {
		const t = (key: string) => resources[locale].translation[key];
		await seed(page, locale);
		for (const width of [360, 430]) {
			await page.setViewportSize({ width, height: 950 });
			const grid = page.locator(".workspace-asset-grid");
			await expect(grid.locator(":scope > a")).toHaveCount(13);
			await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
			expect(await grid.evaluate((element) => parseFloat(getComputedStyle(element).rowGap))).toBeGreaterThanOrEqual(16);
			await page.getByRole("button", { name: t("workspaceAddAsset"), exact: true }).click();
			const dialog = page.getByRole("dialog");
			await expect(dialog.getByRole("combobox", { name: t("workspaceAssetType") })).toBeVisible();
			await expect(dialog.getByRole("button", { name: t("workspaceContinue"), exact: true })).toBeInViewport();
			await expect(dialog.getByRole("button", { name: t("cancel"), exact: true })).toBeInViewport();
			await page.screenshot({ path: join(evidence, `T02-layout-${locale}-${width}.png`) });
			await dialog.getByRole("button", { name: t("cancel"), exact: true }).click();
			await expect(dialog).toBeHidden();
		}
	});
}

});


test.describe('F01-categories — fresh 4236 shared React mobile', () => {
// Reused steps from custom-category-release.spec.ts; restricted to mobile widths.

const password = "category-fixed-package-backup-2026";
test.use({ actionTimeout: 15_000 });
type Kind = "project" | "account";
const renamedCategory = (kind: Kind) => `Renamed ${kind} ${"L".repeat(44)}`;
const copy = (zh: boolean) => zh ? {
	add: "新增", name: "名称", save: "保存", newCategory: "新增分类", category: "分类", categoryName: "分类名称", categorySave: "保存分类", manage: "管理", backup: "创建备份", download: "保存备份文件", preview: "预览", confirm: /确认 ·/, restored: /已恢复 \d+ 条记录/,
} : {
	add: "Add", name: "Name", save: "Save", newCategory: "New category", category: "Category", categoryName: "Category name", categorySave: "Save collection", manage: "Manage", backup: "Create backup", download: "Save backup file", preview: "Preview", confirm: /Confirm ·/, restored: /Restored \d+ records/,
};
async function addAsset(page: Page, kind: Kind, name: string, zh: boolean) {
	const text = copy(zh);
	await page.goto(`/assets/${kind}`);
	await page.getByRole("button", { name: text.add, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(text.name, { exact: true }).fill(name);
	await dialog.getByRole("button", { name: text.save, exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator("main .asset-list-content a").filter({ hasText: name })).toHaveCount(1);
}
async function download(page: Page, zh: boolean) {
	const text = copy(zh);
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: text.backup, exact: true }).click();
	const link = page.getByRole("link", { name: text.download, exact: true });
	await expect(link).toBeVisible();
	const downloaded = page.waitForEvent("download");
	await link.click();
	const result = await downloaded;
	const path = await result.path();
	if (!path) throw Error("backup-download-missing");
	expect(result.suggestedFilename()).toMatch(/\.ka1$/);
	const bytes = readFileSync(path);
	expect(bytes.subarray(0, 8).toString()).toBe("KEEPANY1");
	const entries = unzipSync(await decryptBackup(new Uint8Array(bytes), password));
	const rows = JSON.parse(strFromU8(entries["records.json"])) as Array<{ type: string; payload: string }>;
	return {
		path,
		categories: rows.filter((row) => row.type === "category").map((row) => JSON.parse(row.payload) as Category),
		assets: rows.filter((row) => row.type === "asset").map((row) => JSON.parse(row.payload) as Asset),
	};
}
async function sidebarCategory(page: Page, name: string) {
	// Every case uses 390px. Wait for hydration instead of treating an absent menu as desktop.
	await page.locator(".mobile-menu").click();
	await expect(page.locator(".sidebar")).toHaveClass(/\bopen\b/);
	const category = page.locator(".sidebar-custom").getByRole("button", { name, exact: true });
	await expect(category).toBeInViewport({ ratio: 1 });
	await category.click();
}
async function rename(page: Page, zh: boolean, name: string, add: string, remove: string) {
	const text = copy(zh);
	await page.getByRole("button", { name: text.manage, exact: true }).click();
	const editor = page.getByRole("region", { name: text.category, exact: true });
	await editor.getByLabel(text.categoryName).fill(name);
	await editor.getByRole("checkbox", { name: remove }).uncheck();
	await editor.getByRole("checkbox", { name: add }).check();
	await editor.getByRole("button", { name: text.categorySave, exact: true }).click();
	await expect(editor).toBeHidden();
	await page.reload();
	await expect(page.locator(".asset-category-scroll").getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator("main .asset-list-content a")).toHaveCount(1);
	await expect(page.locator("main .asset-list-content a")).toContainText(add);
}

for (const locale of ["en-US", "zh-CN"]) {
	test(`${locale} fixed package category identity survives UI rename and encrypted clean restore`, async ({ browser }) => {
		// Multiple encrypted downloads and a second browser context need a separate CI budget.
		test.setTimeout(150_000);
		const zh = locale === "zh-CN";
		const text = copy(zh);
		const source = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, acceptDownloads: true });
		const page = await source.newPage();
		const errors: string[] = [];
		let sourceFailure: unknown;
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			for (const kind of ["project", "account"] as const) {
				await addAsset(page, kind, `${kind} First`, zh);
				await addAsset(page, kind, `${kind} Second`, zh);
				await page.getByRole("button", { name: text.newCategory, exact: true }).click();
				const editor = page.getByRole("region", { name: text.category, exact: true });
				await editor.getByLabel(text.categoryName).fill(`Original ${kind}`);
				await editor.getByRole("checkbox", { name: `${kind} First` }).check();
				await editor.getByRole("button", { name: text.categorySave, exact: true }).click();
				await expect(editor).toBeHidden();
				await expect(page.locator("main .asset-list-content a")).toHaveCount(1);
			}
			const before = await download(page, zh);
			expect(before.categories).toHaveLength(2);
			for (const kind of ["project", "account"] as const) {
				await page.goto(`/assets/${kind}`);
				await rename(page, zh, renamedCategory(kind), `${kind} Second`, `${kind} First`);
				await page.locator("main .asset-list-content a").click();
				const category = page.locator(".asset-detail .eyebrow");
				await expect(category).toBeVisible();
				await expect(category).toContainText(renamedCategory(kind));
				expect(await category.evaluate(element => {
					const rect = element.getBoundingClientRect();
					const header = element.closest(".page-header")?.getBoundingClientRect();
					if (!header) return false;
					return rect.right <= header.right + 1 && element.scrollWidth <= element.clientWidth + 1;
				}), "Long custom categories wrap inside the detail header").toBe(true);
				await sidebarCategory(page, renamedCategory(kind));
				await expect(page.locator("main .asset-list-content a")).toHaveCount(1);
			}
			const after = await download(page, zh);
			expect(after.categories).toHaveLength(2);
			for (const kind of ["project", "account"] as const) {
				expect(after.categories.find((category) => category.kind === kind)).toMatchObject({ id: before.categories.find((category) => category.kind === kind)?.id, name: renamedCategory(kind), deleted: false });
				expect(after.assets.find((asset) => asset.name === `${kind} First`)?.category).toBe("");
				expect(after.assets.find((asset) => asset.name === `${kind} Second`)?.category).toBe(renamedCategory(kind));
			}
			const destination = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, acceptDownloads: true });
			let destinationFailure: unknown;
			try {
				const restored = await destination.newPage();
				restored.on("pageerror", (error) => errors.push(error.message));
				await restored.goto("/assets/project");
				await expect(restored.locator("main .asset-list-content a")).toHaveCount(0);
				await restored.goto("/intake");
				await restored.locator("#backup-password").fill(password);
				await restored.locator("#restore-file").setInputFiles(after.path);
				await restored.getByRole("button", { name: text.preview, exact: true }).first().click();
				await restored.getByRole("button", { name: text.confirm }).click();
				await expect(restored.getByText(text.restored)).toBeVisible();
				for (const kind of ["project", "account"] as const) {
					await restored.goto(`/assets/${kind}`);
					await sidebarCategory(restored, renamedCategory(kind));
					await expect(restored.locator("main .asset-list-content a")).toHaveCount(1);
					await expect(restored.locator("main .asset-list-content a")).toContainText(`${kind} Second`);
					await rename(restored, zh, `Recovered ${kind}`, `${kind} First`, `${kind} Second`);
					await sidebarCategory(restored, `Recovered ${kind}`);
					await expect(restored.locator("main .asset-list-content a")).toContainText(`${kind} First`);
					expect(await restored.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
				}
				await restored.screenshot({ path: test.info().outputPath(`category-fixed-restored-${locale}-390.png`), fullPage: true });
				const final = await download(restored, zh);
				for (const kind of ["project", "account"] as const) {
					expect(final.categories.find((category) => category.kind === kind)).toMatchObject({ id: before.categories.find((category) => category.kind === kind)?.id, name: `Recovered ${kind}` });
					expect(final.assets.find((asset) => asset.name === `${kind} First`)?.category).toBe(`Recovered ${kind}`);
					expect(final.assets.find((asset) => asset.name === `${kind} Second`)?.category).toBe("");
				}
			} catch (error) {
				destinationFailure = error;
				throw error;
			} finally {
				if (destinationFailure) await destination.close().catch(() => undefined);
				else await destination.close();
			}
			expect(errors).toEqual([]);
		} catch (error) {
			sourceFailure = error;
			throw error;
		} finally {
			if (sourceFailure) await source.close().catch(() => undefined);
			else await source.close();
		}
	});
}

});


test.describe('F02-F03-profile-domains — fresh 4236 shared React mobile', () => {
// Reused steps from qa-t10-windows.spec.ts; restricted to mobile widths.

const repositoryPath = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/local-db/src/index.ts`;
const domainPath = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/domain/src/index.ts`;
mkdirSync(evidence, { recursive: true });

async function readAsset(page: Page, id: string) {
	return page.evaluate(async ({ repositoryPath, id }) => (await (await import(repositoryPath)).localRepository()).get("asset", id), { repositoryPath, id });
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390]) {
	test(`T10-01..04 ${locale} ${width}px project profiles, domain ownership and editing preservation`, async ({ browser }) => {
		test.setTimeout(150_000);
		const context = await browser.newContext({ locale: locale === "en" ? "en-US" : locale, timezoneId: "Asia/Shanghai", viewport: { width, height: 950 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
		try {
			await page.addInitScript((language) => localStorage.setItem("keepany-language", language), locale);
			await page.clock.setFixedTime(new Date("2026-10-27T04:00:00Z"));
			await page.goto("/assets");
			await page.getByRole("button", { name: t("workspaceAddAsset"), exact: true }).click();
			await selectChoice(page.locator("#workspace-create-kind"), "project");
			await page.getByRole("dialog").getByRole("button", { name: t("workspaceContinue"), exact: true }).click();
			let editor = page.getByRole("dialog");
			await editor.locator("#name").fill("T10 Project");
			await editor.locator("#url").fill("https://t10.example.test");
			await editor.locator("#description").fill("T10 short description");
			await editor.locator("#projectTitle").fill("T10 product title");
			await editor.locator("#projectPromoUrl").fill("https://t10.example.test/promo");
			await editor.locator("#tags").fill("alpha, beta");
			await editor.locator(".project-editor-group").nth(1).locator("summary").click();
			await editor.locator("#projectMediumDescription").fill("T10 medium description");
			await editor.locator("#longDescription").fill("T10 complete description");
			await editor.locator("#projectFeatures").fill("T10 feature");
			await editor.locator("#projectPricing").fill("T10 free tier");
			await editor.locator("#projectPricingType").fill("Freemium");
			await editor.locator(".project-editor-group").nth(2).locator("summary").click();
			await editor.locator("#projectEmail").fill("t10@example.test");
			await editor.locator("#notes").fill("T10 preserved notes");
			await editor.getByRole("button", { name: t("save"), exact: true }).click();
			await expect(editor).toBeHidden();
			await page.reload();
			await expect(page.locator(".asset-project-card").filter({ hasText: "T10 Project" })).toBeVisible();
			const project = await page.evaluate(async (path) => (await (await import(path)).localRepository()).list("asset").then((rows: { name: string }[]) => rows.find((row) => row.name === "T10 Project")), repositoryPath);
			expect(project).toMatchObject({ kind: "project", url: "https://t10.example.test", description: "T10 short description", projectTitle: "T10 product title", projectPromoUrl: "https://t10.example.test/promo", tags: ["alpha", "beta"], projectMediumDescription: "T10 medium description", longDescription: "T10 complete description", projectFeatures: "T10 feature", projectPricing: "T10 free tier", projectPricingType: "Freemium", projectEmail: "t10@example.test", notes: "T10 preserved notes" });
			await page.locator(".asset-project-card").filter({ hasText: "T10 Project" }).click();
			await expect(page.locator(".asset-project-profile-card")).toContainText("t10.example.test");
			await page.getByRole("button", { name: t("projectViewMaterials"), exact: true }).click();
			await expect(page.locator(".asset-project-materials")).toContainText("T10 complete description");

			// Independent existing project makes an incorrect domain association observable.
			const otherId = await page.evaluate(async ({ repositoryPath, domainPath }) => {
				const other = { ...(await import(domainPath)).newAsset("project"), name: "Other domain owner" };
				await (await import(repositoryPath)).save("asset", other);
				return other.id as string;
			}, { repositoryPath, domainPath });
			await page.goto("/assets/domains");
			await page.getByRole("button", { name: t("workspaceAddAsset"), exact: true }).click();
			await selectChoice(page.locator("#workspace-domain-project"), project.id);
			await page.getByRole("dialog").getByRole("button", { name: t("workspaceManageDomain"), exact: true }).click();
			await expect(page).toHaveURL(new RegExp(`/assets/project/${project.id}#project-domains$`));
			for (const [name, fee] of [["one.t10.test", "12.34"], ["two.t10.test", "50.00"], ["unknown.t10.test", ""]]) {
				await page.getByRole("button", { name: t("projectAddDomain"), exact: true }).click();
				const dialog = page.getByRole("dialog");
				await dialog.getByLabel(t("projectDomain"), { exact: true }).fill(name);
				await dialog.getByLabel(t("projectRegistrar")).fill("T10 Registrar");
				await dialog.getByLabel(t("projectExpiry")).fill("2026-11-18");
				await selectChoice(dialog.getByRole("combobox", { name: t("currency"), exact: true }), "USD");
				await dialog.getByLabel(t("projectAnnualFee")).fill(fee);
				await dialog.getByRole("button", { name: t("save"), exact: true }).click();
				await expect(dialog).toBeHidden();
				await expect(page.locator(".asset-project-domain-row").filter({ hasText: name })).toBeVisible();
			}
			await page.reload();
			const domainsBefore = (await readAsset(page, project.id)).projectDomains;
			expect(domainsBefore).toHaveLength(3);
			expect((await readAsset(page, otherId)).projectDomains).toEqual([]);
			await page.goto("/assets");
			await expect(page.locator(".workspace-domain-card")).toHaveCount(3);
			await page.locator(".workspace-domain-card").filter({ hasText: "one.t10.test" }).click();
			await expect(page).toHaveURL(new RegExp(`#project-domain-${domainsBefore[0].id}$`));
			const targetRow = page.locator(`#project-domain-${domainsBefore[0].id}`);
			await expect(targetRow).toBeInViewport();
			await targetRow.getByRole("button", { name: t("edit"), exact: true }).click();
			const domainEditor = page.getByRole("dialog");
			await domainEditor.getByLabel(t("projectRegistrar")).fill("Updated Registrar");
			await domainEditor.getByLabel(t("projectExpiry")).fill("2026-10-29");
			await selectChoice(domainEditor.getByRole("combobox", { name: t("currency"), exact: true }), "EUR");
			await domainEditor.getByLabel(t("projectAnnualFee")).fill("23.45");
			await domainEditor.getByRole("button", { name: t("save"), exact: true }).click();
			await expect(domainEditor).toBeHidden();
			await page.reload();
			const domainsAfter = (await readAsset(page, project.id)).projectDomains;
			expect(domainsAfter[0]).toMatchObject({ id: domainsBefore[0].id, name: "one.t10.test", registrar: "Updated Registrar", expiryDate: "2026-10-29", annualAmount: 2345, currency: "EUR" });
			expect(domainsAfter.slice(1)).toEqual(domainsBefore.slice(1));
			await page.goto("/assets");
			const targetCard = page.locator(".workspace-domain-card").filter({ hasText: "one.t10.test" });
			await expect(targetCard).toContainText(locale === "en" ? "2 days left" : "剩余 2 天");
			await expect(targetCard).toContainText("23.45");
			await expect(targetCard).toContainText("Updated Registrar");
			await expect(page.locator(".workspace-domain-card").filter({ hasText: "unknown.t10.test" })).toContainText(t("workspaceAmountMissing"));
			await expect(page.locator(".workspace-domain-card").filter({ hasText: "unknown.t10.test" })).not.toContainText("0.00");

			const fixtureIds = await page.evaluate(async ({ repositoryPath, domainPath, id }) => {
				const { newAsset, relationSchema } = await import(domainPath);
				const { localRepository, save, saveBatch } = await import(repositoryPath);
				const project = await (await localRepository()).get("asset", id);
				const account = { ...newAsset("account"), name: "T10 linked account", username: "linked@example.test" };
				const subscription = { ...newAsset("subscription"), name: "T10 linked subscription", amount: 1200, currency: "USD" };
				const relations = [account, subscription].map((asset) => relationSchema.parse({ id: crypto.randomUUID(), from: id, to: asset.id, label: "T10 relation", createdAt: project.createdAt }));
				await save("asset", { ...project, contact: "Hidden contact retained", location: "Hidden location retained" });
				await saveBatch([{ type: "asset", value: account }, { type: "asset", value: subscription }, ...relations.map((value) => ({ type: "relation", value }))]);
				return { account: account.id, subscription: subscription.id, relations };
			}, { repositoryPath, domainPath, id: project.id });
			await page.goto(`/assets/project/${project.id}`);
			await expect(page.locator(".asset-project-profile-card")).toContainText("T10 linked account");
			await expect(page.locator(".asset-project-profile-card")).toContainText("T10 linked subscription");
			const beforeEdit = await readAsset(page, project.id);
			await page.locator(".asset-project-action-bar").getByRole("button", { name: t("edit"), exact: true }).click();
			editor = page.getByRole("dialog");
			await editor.locator("#name").fill("Cancelled T10 name");
			await editor.getByRole("button", { name: t("cancel"), exact: true }).click();
			await expect(editor).toBeHidden();
			expect(await readAsset(page, project.id)).toEqual(beforeEdit);
			await page.reload();
			await expect(page.getByRole("heading", { name: "T10 Project", exact: true })).toBeVisible();
			await page.locator(".asset-project-action-bar").getByRole("button", { name: t("edit"), exact: true }).click();
			editor = page.getByRole("dialog");
			await editor.locator("#name").fill("T10 Project renamed");
			await editor.getByRole("button", { name: t("save"), exact: true }).click();
			await expect(editor).toBeHidden();
			await page.reload();
			await expect(page.getByRole("heading", { name: "T10 Project renamed", exact: true })).toBeVisible();
			const renamed = await readAsset(page, project.id);
			const { name: oldName, updatedAt: oldUpdatedAt, ...retainedBefore } = beforeEdit;
			const { name: newName, updatedAt: newUpdatedAt, ...retainedAfter } = renamed;
			expect(newName).toBe("T10 Project renamed");
			expect(retainedAfter).toEqual(retainedBefore);
			const relationsAfter = await page.evaluate(async (path) => (await (await import(path)).localRepository()).list("relation"), repositoryPath);
			expect(relationsAfter.sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)))
				.toEqual(fixtureIds.relations.sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)));
			await expect(page.locator(".asset-project-related-card")).toHaveCount(2);
			await expect(page.locator(".asset-project-related-card").filter({ hasText: "T10 linked account" })).toHaveAttribute("href", `/assets/account/${fixtureIds.account}`);
			await expect(page.locator(".asset-project-related-card").filter({ hasText: "T10 linked subscription" })).toHaveAttribute("href", `/assets/subscription/${fixtureIds.subscription}`);
			await page.getByRole("button", { name: t("projectViewMaterials"), exact: true }).click();
			await expect(page.locator(".asset-project-materials")).toContainText("T10 preserved notes");
			await expect(page.locator(".asset-project-materials")).toContainText("https://t10.example.test/promo");
			await expect(page.locator(".asset-project-domain-row")).toHaveCount(3);
			await page.goto("/assets");
			await expect(page.locator(".asset-project-card").filter({ hasText: "T10 Project renamed" })).toBeVisible();
			await expect(targetCard).toContainText("T10 Project renamed");
			for (const card of await page.locator(".asset-project-card").all()) {
				const cover = await card.locator(".asset-project-cover").boundingBox();
				const preview = await card.locator(".asset-browser-body").boundingBox();
				if (cover && preview) expect(preview.y + preview.height).toBeLessThanOrEqual(cover.y + cover.height);
			}
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			await page.screenshot({ path: join(evidence, `T10-${locale}-${width}.png`), fullPage: true });
			expect(errors).toEqual([]);
			await test.info().attach("T10-readback", { body: JSON.stringify({ projectId: project.id, domainsBefore, domainsAfter, preserved: retainedAfter, relations: relationsAfter }, null, 2), contentType: "application/json" });
		} finally { if (!page.isClosed()) await page.screenshot({ path: test.info().outputPath("mobile-end.png"), fullPage: true }); await context.close(); }
	});
}

});


test.describe('F08-F11-workflow-media — fresh 4236 shared React mobile', () => {
// Reused steps from qa-t11-windows.spec.ts; restricted to mobile widths.

const domainPath = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/domain/src/index.ts`;
mkdirSync(evidence, { recursive: true });

const repositoryPath = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/local-db/src/index.ts`;

async function png(page: Page, color: string) {
	const base64 = await page.evaluate((fill) => {
		const canvas = document.createElement("canvas");
		canvas.width = 24;
		canvas.height = 24;
		const context = canvas.getContext("2d");
		if (!context) throw Error("canvas-unavailable");
		context.fillStyle = fill;
		context.fillRect(0, 0, 24, 24);
		return canvas.toDataURL("image/png").split(",")[1];
	}, color);
	return Buffer.from(base64, "base64");
}

async function workflowFixture(page: Page) {
	return page.evaluate(async ({ repositoryPath, domainPath }) => {
		const { newAsset, relationSchema, submissionSchema } = await import(domainPath);
		const { saveBatch } = await import(repositoryPath);
		const project = { ...newAsset("project"), name: "T11 Workflow Project", description: "Original profile snapshot", url: "https://t11.example.test", projectDomains: [{ id: crypto.randomUUID(), name: "t11.example.test", registrar: "T11 Registrar", expiryDate: "2027-01-01", annualAmount: 12000, currency: "CNY", autoRenew: "on" }] };
		const account = { ...newAsset("account"), name: "T11 administration", username: "admin@t11.example.test" };
		const subscription = { ...newAsset("subscription"), name: "T11 hosting", amount: 9800, currency: "CNY", dueDate: "2026-10-22" };
		const relations = [account, subscription].map((asset) => relationSchema.parse({ id: crypto.randomUUID(), from: project.id, to: asset.id, label: "T11 dependency", createdAt: project.createdAt }));
		const submission = submissionSchema.parse({ id: crypto.randomUUID(), assetId: project.id, name: "T11 listing", url: "https://directory.example/t11", status: "indexed", deleted: false });
		await saveBatch([...([project, account, subscription].map((value) => ({ type: "asset", value }))), ...relations.map((value) => ({ type: "relation", value })), { type: "submission", value: submission }]);
		return { id: project.id, subscription: subscription.id, account: account.id };
	}, { repositoryPath, domainPath });
}

async function workflowReadback(page: Page, projectId: string) {
	return page.evaluate(async ({ repositoryPath, projectId }) => {
		const repository = await (await import(repositoryPath)).localRepository();
		return { project: await repository.get("asset", projectId), tasks: (await repository.list("task")).filter((task: { assetId: string }) => task.assetId === projectId).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)) };
	}, { repositoryPath, projectId });
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390]) {
	test(`T11-03/04 ${locale} ${width}px brand snapshots and evidence-gated local archive`, async ({ browser }) => {
		test.setTimeout(150_000);
		const context = await browser.newContext({ locale, viewport: { width, height: 900 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
		try {
			await page.addInitScript((language) => localStorage.setItem("keepany-language", language), locale);
			await page.goto("/");
			const ids = await workflowFixture(page);
			await page.goto(`/assets/project/${ids.id}`);
			await page.getByRole("link", { name: t("workflowBrandEntry"), exact: true }).click();
			await expect(page.locator(".project-workflow-preview-row")).toHaveCount(5);
			await page.getByRole("button", { name: t("workflowCreatePlan"), exact: true }).click();
			await expect(page.getByRole("alert")).toHaveText(t("workflowProposalRequired"));
			await expect(page.locator(".project-workflow-task")).toHaveCount(0);
			await page.getByLabel(t("workflowProposedName")).fill("T11 proposed brand");
			await page.getByLabel(t("workflowProposedDescription")).fill("T11 proposed description");
			await page.getByLabel(t("workflowProposedUrl")).fill("https://proposed.example.test");
			await page.getByLabel(t("workflowChangeNote")).fill("T11 proposed scope");
			await page.getByRole("button", { name: t("workflowCreatePlan"), exact: true }).click();
			const tasks = page.locator(".project-workflow-task");
			await expect(tasks).toHaveCount(5);
			const snapshot = await workflowReadback(page, ids.id);
			expect(snapshot.tasks.every((task: { projectWorkflow: { projectName: string; proposedName: string } }) => task.projectWorkflow.projectName === "T11 Workflow Project" && task.projectWorkflow.proposedName === "T11 proposed brand")).toBe(true);
			await page.reload();
			expect(await workflowReadback(page, ids.id)).toEqual(snapshot);
			await expect(page.locator(".project-workflow-before-after")).toContainText("T11 proposed description");
			await expect(page.getByRole("button", { name: t("workflowNewRound"), exact: true })).toBeDisabled();
			for (let index = 0; index < 5; index++) {
				const row = tasks.nth(index);
				await row.getByRole("button", { name: t("workflowRecordResult"), exact: true }).click();
				if (index === 0) {
					await row.getByRole("button", { name: t("workflowSaveRecord"), exact: true }).click();
					await expect(row).toHaveAttribute("data-outcome", "pending");
				}
				await selectChoice(row.getByLabel(t("workflowResult")), index === 0 ? "done" : "na");
				await row.getByLabel(t("workflowEvidence")).fill(`T11 synthetic brand evidence ${index}`);
				await row.getByRole("button", { name: t("workflowSaveRecord"), exact: true }).click();
				await expect(row).toHaveAttribute("data-outcome", index === 0 ? "done" : "na");
				await expect(row.locator(".project-workflow-record")).toContainText(`T11 synthetic brand evidence ${index}`);
				if (index === 0) {
					await page.getByRole("button", { name: t("workflowViewReport"), exact: true }).click();
					await expect(page.locator(".project-workflow-report")).toContainText(t("workflowReportIncomplete"));
					await page.getByRole("button", { name: t("workflowBackToPlan"), exact: true }).click();
				}
			}
			const brandComplete = await workflowReadback(page, ids.id);
			expect(brandComplete.project.name).toBe("T11 Workflow Project");
			expect(brandComplete.project.url).toBe("https://t11.example.test");
			await page.reload();
			expect(await workflowReadback(page, ids.id)).toEqual(brandComplete);
			await page.getByRole("button", { name: t("workflowViewReport"), exact: true }).click();
			await expect(page.locator(".project-workflow-report")).toContainText(t("workflowReportComplete"));
			await page.getByRole("button", { name: t("workflowBackToPlan"), exact: true }).click();
			await expect(page.getByRole("button", { name: t("workflowNewRound"), exact: true })).toBeEnabled();

			await page.goto(`/assets/project/${ids.id}`);
			await page.getByRole("link", { name: t("workflowCloseEntry"), exact: true }).click();
			await page.getByRole("button", { name: t("workflowCreatePlan"), exact: true }).click();
			await expect(tasks).toHaveCount(7);
			await expect(tasks.filter({ hasText: "T11 hosting" })).toContainText("98.00");
			await expect(tasks.filter({ hasText: "t11.example.test" }).first()).toContainText("T11 Registrar");
			await expect(tasks.last().getByRole("button", { name: t("workflowRecordResult"), exact: true })).toBeDisabled();
			await tasks.first().getByRole("button", { name: t("workflowRecordResult"), exact: true }).click();
			await selectChoice(tasks.first().getByLabel(t("workflowResult")), "blocked");
			await tasks.first().getByLabel(t("workflowEvidence")).fill("T11 backup destination unavailable");
			await tasks.first().getByRole("button", { name: t("workflowSaveRecord"), exact: true }).click();
			await expect(tasks.first()).toHaveAttribute("data-outcome", "blocked");
			await page.reload();
			await expect(tasks.first()).toContainText("T11 backup destination unavailable");
			await page.getByRole("button", { name: t("workflowViewReport"), exact: true }).click();
			await expect(page.locator(".project-workflow-report")).toContainText(t("workflowReportIncomplete"));
			await expect(page.getByRole("button", { name: t("workflowArchiveLocal"), exact: true })).toHaveCount(0);
			await page.getByRole("button", { name: t("workflowBackToPlan"), exact: true }).click();
			for (let index = 0; index < 6; index++) {
				const row = tasks.nth(index);
				await row.getByRole("button", { name: t(index === 0 ? "workflowEditRecord" : "workflowRecordResult"), exact: true }).click();
				await selectChoice(row.getByLabel(t("workflowResult")), index === 0 ? "done" : "na");
				await row.getByLabel(t("workflowEvidence")).fill(`T11 synthetic close evidence ${index}; no external action performed`);
				await row.getByRole("button", { name: t("workflowSaveRecord"), exact: true }).click();
				await expect(row).toHaveAttribute("data-outcome", index === 0 ? "done" : "na");
			}
			await tasks.last().getByRole("button", { name: t("workflowRecordResult"), exact: true }).click();
			await tasks.last().getByLabel(t("workflowEvidence")).fill("T11 synthetic final local archive decision");
			await tasks.last().getByRole("button", { name: t("workflowSaveRecord"), exact: true }).click();
			await expect(tasks.last()).toHaveAttribute("data-outcome", "done");
			await page.getByRole("button", { name: t("workflowViewReport"), exact: true }).click();
			await expect(page.locator(".project-workflow-report")).toContainText(t("workflowReportComplete"));
			await page.getByRole("button", { name: t("workflowArchiveLocal"), exact: true }).click();
			await expect(page.getByRole("dialog")).toContainText(t("workflowArchiveConfirm"));
			await page.getByRole("dialog").getByRole("button", { name: t("cancel"), exact: true }).click();
			expect((await workflowReadback(page, ids.id)).project.status).toBe("active");
			await page.getByRole("button", { name: t("workflowArchiveLocal"), exact: true }).click();
			await page.getByRole("dialog").getByRole("button", { name: t("workflowConfirmArchive"), exact: true }).click();
			await expect(page.locator(".project-workflow-report")).toContainText(t("workflowArchivedLocal"));
			const archived = await workflowReadback(page, ids.id);
			expect(archived.project.status).toBe("archived");
			expect(archived.project.id).toBe(ids.id);
			expect(archived.tasks).toHaveLength(12);
			await page.reload();
			expect(await workflowReadback(page, ids.id)).toEqual(archived);
			await page.getByRole("button", { name: t("workflowViewReport"), exact: true }).click();
			await expect(page.locator(".project-workflow-report")).toContainText(t("workflowArchivedLocal"));
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			await page.screenshot({ path: join(evidence, `T11-workflow-${locale}-${width}.png`), fullPage: true });
			await test.info().attach("T11-workflow-readback", { body: JSON.stringify(archived, null, 2), contentType: "application/json" });
			expect(errors).toEqual([]);
		} finally { if (!page.isClosed()) await page.screenshot({ path: test.info().outputPath("mobile-end.png"), fullPage: true }); await context.close(); }
	});
}

async function stored(page: Page, name: string) {
	return page.evaluate(async ({ path, name }) => {
		const { localRepository } = await import(path);
		const repository = await localRepository();
		const asset = (await repository.list("asset")).find((row: { name: string }) => row.name === name);
		const blobs = await repository.fileStore.blobs.toArray();
		return { asset, ids: blobs.map((blob: { id: string }) => blob.id) };
	}, { path: repositoryPath, name });
}

async function pixel(page: Page, role: string) {
	return page.locator(`[data-project-media-role="${role}"] img.asset-image`).first().evaluate((image: HTMLImageElement) => {
		const canvas = document.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		const context = canvas.getContext("2d");
		if (!context) throw Error("canvas-unavailable");
		context.drawImage(image, 0, 0, 1, 1);
		return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
	});
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390]) {
	test(`T11-01/02 ${locale} ${width}px materials and role images preserve cancellation and failures`, async ({ browser }) => {
		test.setTimeout(120_000);
		const context = await browser.newContext({ locale, viewport: { width, height: 844 } });
		const page = await context.newPage();
		const pageErrors: string[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));
		const name = `Project form media ${locale} ${width}`;
		const saveLabel = locale === "zh-CN" ? "保存" : "Save";
		try {
			await page.goto("/");
			await page.evaluate((value) => localStorage.setItem("keepany-language", value), locale);
			await page.goto("/assets/project");
			await page.getByRole("button", { name: locale === "zh-CN" ? "新增" : "Add", exact: true }).click();
			let dialog = page.getByRole("dialog");
			await dialog.locator("#name").fill(name);
			await dialog.locator("#url").fill("https://t11.example.test");
			await dialog.locator("#description").fill("T11 saved material description");
			await dialog.locator("#projectTitle").fill("T11 material title");
			await dialog.locator("#projectPromoUrl").fill("https://t11.example.test/promo");
			await dialog.locator("#projectLogoFile").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: await png(page, "#ef4030") });
			await dialog.locator("#projectHomeFile").setInputFiles({ name: "home.png", mimeType: "image/png", buffer: await png(page, "#235ac8") });
			await dialog.locator("#projectProductFiles").setInputFiles([
				{ name: "product-a.png", mimeType: "image/png", buffer: await png(page, "#239a50") },
				{ name: "product-b.png", mimeType: "image/png", buffer: await png(page, "#efbd29") },
			]);
			await dialog.locator("#projectPromoFile").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: await png(page, "#8726b0") });
			await expect(dialog.locator(".project-editor-image")).toHaveCount(5);
			await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
			await dialog.locator(".project-editor-media").scrollIntoViewIfNeeded();
			// Role pixels and persisted IDs are the acceptance evidence; avoid duplicate screenshots.
			await dialog.getByRole("button", { name: saveLabel, exact: true }).click();
			await expect(dialog).toBeHidden();
			const created = await stored(page, name);
			const initial = created.asset as { id: string; attachments: string[]; projectMedia: { logoId: string; homeScreenshotId: string; productScreenshotIds: string[]; promoCoverId: string } };
			expect(created.asset).toMatchObject({ description: "T11 saved material description", projectTitle: "T11 material title", projectPromoUrl: "https://t11.example.test/promo" });
			expect(initial.projectMedia.productScreenshotIds).toHaveLength(2);
			expect(initial.attachments[0]).toBe(initial.projectMedia.homeScreenshotId);
			for (const id of [initial.projectMedia.logoId, initial.projectMedia.homeScreenshotId, initial.projectMedia.promoCoverId, ...initial.projectMedia.productScreenshotIds]) {
				expect(initial.attachments).toContain(id);
				expect(created.ids).toContain(id);
			}
			await page.goto(`/assets/project/${initial.id}`);
			await page.locator("#asset-project-materials > summary").click();
			for (const role of ["logoId", "homeScreenshotId", "productScreenshotIds", "promoCoverId"]) await expect(page.locator(`[data-project-media-role="${role}"] img.asset-image`).first()).toBeVisible();
			expect(await pixel(page, "logoId")).toEqual([239, 64, 48]);
			expect(await pixel(page, "homeScreenshotId")).toEqual([35, 90, 200]);
			expect(await pixel(page, "productScreenshotIds")).toEqual([35, 154, 80]);
			expect(await pixel(page, "promoCoverId")).toEqual([135, 38, 176]);
			await expect(page.locator("#asset-project-materials").getByRole("link", { name: "https://t11.example.test/promo", exact: true })).toHaveAttribute("href", "https://t11.example.test/promo");
			// Preparing a replacement followed by Cancel must not write any new blob or role.
			await page.getByRole("button", { name: locale === "zh-CN" ? "编辑" : "Edit", exact: true }).first().click();
			dialog = page.getByRole("dialog");
			await dialog.locator("#projectLogoFile").setInputFiles({ name: "cancel-logo.png", mimeType: "image/png", buffer: await png(page, "#ff00ff") });
			await dialog.getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel", exact: true }).click();
			await expect(dialog).toBeHidden();
			const afterCancel = await stored(page, name);
			expect(afterCancel.asset).toEqual(created.asset);
			expect(afterCancel.ids.sort()).toEqual(created.ids.sort());
			await page.getByRole("button", { name: locale === "zh-CN" ? "编辑" : "Edit", exact: true }).first().click();
			dialog = page.getByRole("dialog");
			await dialog.locator("#projectLogoFile").setInputFiles({ name: "logo-new.png", mimeType: "image/png", buffer: await png(page, "#6839dd") });
			await dialog.locator("#projectProductFiles").setInputFiles({ name: "product-new.png", mimeType: "image/png", buffer: await png(page, "#15c7aa") });
			await dialog.getByRole("button", { name: saveLabel, exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			await page.locator("#asset-project-materials > summary").click();
			const edited = await stored(page, name);
			const updated = edited.asset as typeof initial;
			expect(updated.projectMedia.logoId).not.toBe(initial.projectMedia.logoId);
			expect(updated.projectMedia.productScreenshotIds).toHaveLength(1);
			expect(updated.projectMedia.homeScreenshotId).toBe(initial.projectMedia.homeScreenshotId);
			expect(updated.projectMedia.promoCoverId).toBe(initial.projectMedia.promoCoverId);
			for (const oldId of [initial.projectMedia.logoId, ...initial.projectMedia.productScreenshotIds]) {
				expect(updated.attachments).not.toContain(oldId);
				expect(edited.ids).not.toContain(oldId);
			}
			expect(await pixel(page, "logoId")).toEqual([104, 57, 221]);
			expect(await pixel(page, "productScreenshotIds")).toEqual([21, 199, 170]);
			expect(await pixel(page, "homeScreenshotId")).toEqual([35, 90, 200]);
			expect(await pixel(page, "promoCoverId")).toEqual([135, 38, 176]);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			if (locale === "en" && width === 390) {
				await page.getByRole("button", { name: "Edit", exact: true }).first().click();
				dialog = page.getByRole("dialog");
				await dialog.locator("#projectPromoFile").setInputFiles({ name: "stale-cover.png", mimeType: "image/png", buffer: await png(page, "#ff00ff") });
				await page.evaluate(async ({ path, id }) => {
					const { localRepository } = await import(path);
					const repository = await localRepository();
					const current = await repository.get("asset", id);
					await repository.saveAssetIfCurrent(current, { ...current, description: "Concurrent edit", updatedAt: new Date().toISOString() });
				}, { path: repositoryPath, id: initial.id });
				await dialog.getByRole("button", { name: saveLabel, exact: true }).click();
				await expect(dialog.getByRole("alert")).toBeVisible();
				await expect(dialog).toBeVisible();
				await expect(dialog.locator("#name")).toHaveValue(name);
				await expect(dialog.locator(".project-editor-image")).toHaveCount(4);
				const afterFailure = await stored(page, name);
				expect((afterFailure.asset as typeof initial).projectMedia.promoCoverId).toBe(updated.projectMedia.promoCoverId);
				expect(afterFailure.ids.sort()).toEqual(edited.ids.sort());
				await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
			}
			const beforeRemove = await stored(page, name);
			const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
			await page.locator('[data-project-media-role="promoCoverId"]').getByRole("button", { name: t("removeImage"), exact: true }).click();
			await expect(page.locator('[data-project-media-role="promoCoverId"] img.asset-image')).toHaveCount(0);
			await page.reload();
			await page.locator("#asset-project-materials > summary").click();
			const afterRemove = await stored(page, name);
			const removed = afterRemove.asset as typeof initial;
			const beforeRemovedAsset = beforeRemove.asset as typeof initial;
			expect(removed.projectMedia).toEqual({ ...beforeRemovedAsset.projectMedia, promoCoverId: "" });
			expect(removed.attachments).not.toContain(beforeRemovedAsset.projectMedia.promoCoverId);
			await expect.poll(async () => (await stored(page, name)).ids).not.toContain(beforeRemovedAsset.projectMedia.promoCoverId);
			expect(await pixel(page, "homeScreenshotId")).toEqual([35, 90, 200]);
			expect(await pixel(page, "logoId")).toEqual([104, 57, 221]);
			await expect(page.locator("#asset-project-materials")).toContainText("T11 material title");
			expect(pageErrors).toEqual([]);
		} finally { if (!page.isClosed()) await page.screenshot({ path: test.info().outputPath("mobile-end.png"), fullPage: true }); await context.close(); }
	});
}


});


test.describe('F10-item-actions — fresh 4236 shared React mobile', () => {
// Reused steps from qa-t12-windows.spec.ts; restricted to mobile widths.

const repositoryPath = sourceModuleUrl("packages/local-db/src/index.ts");
const domainPath = sourceModuleUrl("packages/domain/src/index.ts");
mkdirSync(evidence, { recursive: true });

async function state(page: Page, id: string) {
	return page.evaluate(async ({ repositoryPath, id }) => {
		const repository = await (await import(repositoryPath)).localRepository();
		return { asset: await repository.get("asset", id), history: (await repository.list("history")).filter((row: { assetId: string }) => row.assetId === id).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)), tasks: (await repository.list("task")).filter((row: { assetId: string }) => row.assetId === id) };
	}, { repositoryPath, id });
}

async function fixture(page: Page) {
	return page.evaluate(async ({ repositoryPath, domainPath }) => {
		const item = { ...(await import(domainPath)).newAsset("item"), name: "T12 concurrent camera", location: "Original location" };
		await (await import(repositoryPath)).save("asset", item);
		return item.id as string;
	}, { repositoryPath, domainPath });
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390]) {
	test(`T12-01..03 ${locale} ${width}px item facts, double-click borrowing and reminder deduplication`, async ({ browser }) => {
		test.setTimeout(120_000);
		const context = await browser.newContext({ locale, timezoneId: "Asia/Shanghai", viewport: { width, height: 950 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
		try {
			await page.addInitScript((language) => localStorage.setItem("keepany-language", language), locale);
			await page.clock.setFixedTime(new Date("2026-10-27T04:00:00Z"));
			await page.goto("/assets/item");
			await page.getByRole("button", { name: t("add"), exact: true }).click();
			const dialog = page.getByRole("dialog");
			await dialog.locator("#name").fill("T12 Camera");
			await dialog.getByLabel(t("itemPurchasePrice")).fill("123.45");
			await selectChoice(dialog.getByLabel(t("currency")), "USD");
			await dialog.getByLabel(t("purchaseDate")).fill("2026-08-14");
			await dialog.getByLabel(t("warrantyDate")).fill("2027-08-14");
			await dialog.getByLabel(t("location")).fill("Studio / shelf");
			await dialog.getByRole("button", { name: t("save"), exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			const card = page.locator(".asset-library-card").filter({ hasText: "T12 Camera" });
			await expect(card).toContainText("74");
			await card.click();
			const id = new URL(page.url()).pathname.split("/").at(-1) as string;
			expect((await state(page, id)).asset).toMatchObject({ amount: 12345, currency: "USD", itemPurchasePriceKnown: true, purchaseDate: "2026-08-14", warrantyDate: "2027-08-14", location: "Studio / shelf" });
			await page.locator('[data-item-media-role="coverId"]').getByRole("button", { name: t("addImage"), exact: true }).click();
			const pngBase64 = await page.evaluate(() => {
				const canvas = document.createElement("canvas"); canvas.width = canvas.height = 24;
				const drawing = canvas.getContext("2d"); if (!drawing) throw Error("canvas-unavailable");
				drawing.fillStyle = "#d88564"; drawing.fillRect(0, 0, 24, 24); return canvas.toDataURL("image/png").split(",")[1];
			});
			await page.locator(".asset-attachments-card input[type=file]").setInputFiles({ name: "T12-cover.png", mimeType: "image/png", buffer: Buffer.from(pngBase64, "base64") });
			await page.getByRole("dialog").getByRole("button", { name: t("confirm"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await page.reload();
			await expect(page.locator(".asset-item-photo-stage img")).toBeVisible();
			await expect(page.getByRole("button", { name: t("itemOpenMaintenancePlan"), exact: true })).toHaveCount(0);
			await expect(page.getByRole("link", { name: t("itemOpenMaintenancePlan"), exact: true })).toBeVisible();
			await page.getByRole("button", { name: t("loan"), exact: true }).click();
			await expect(page.getByRole("alert")).toHaveText(t("borrowerRequired"));
			expect((await state(page, id)).history).toHaveLength(0);
			await page.getByLabel(t("borrower"), { exact: true }).fill("T12 Borrower");
			await page.getByLabel(t("itemExpectedReturnDate")).fill("2026-11-01");
			const other = await context.newPage();
			await other.goto(page.url());
			await page.getByRole("button", { name: t("loan"), exact: true }).dblclick();
			await expect(page.getByRole("button", { name: t("return"), exact: true })).toBeVisible();
			await expect(other.getByRole("button", { name: t("return"), exact: true })).toBeVisible();
			const loaned = await state(page, id);
			expect(loaned.asset).toMatchObject({ status: "loaned", borrower: "T12 Borrower", itemExpectedReturnDate: "2026-11-01" });
			expect(loaned.history).toHaveLength(1);
			await page.getByRole("button", { name: t("return"), exact: true }).dblclick();
			await expect(page.getByRole("button", { name: t("loan"), exact: true })).toBeVisible();
			await other.close();
			await page.reload();
			const returned = await state(page, id);
			expect(returned.asset).toMatchObject({ status: "active", borrower: "", itemExpectedReturnDate: "" });
			expect(returned.history.map((row: { action: string }) => row.action).sort()).toEqual(["loan", "return"]);
			expect(returned.history.every((row: { borrower: string }) => row.borrower === "T12 Borrower")).toBe(true);
			for (let index = 0; index < 2; index++) {
				await page.getByLabel(t("maintenanceNotes")).fill(`T12 maintenance ${index}`);
				await page.getByLabel(t("maintenanceDate")).fill("2026-10-26");
				await page.getByLabel(t("maintenanceReminderDate")).fill("2026-11-20");
				await page.getByRole("button", { name: t("maintenance"), exact: true }).dblclick();
				await expect(page.getByLabel(t("maintenanceNotes"))).toHaveValue("");
				await expect(page.getByRole("button", { name: t("maintenance"), exact: true })).toBeEnabled();
			}
			const withReminder = await state(page, id);
			expect(withReminder.history.filter((row: { action: string }) => row.action === "maintenance")).toHaveLength(2);
			expect(withReminder.tasks).toHaveLength(1);
			expect(withReminder.tasks[0]).toMatchObject({ assetId: id, dueDate: "2026-11-20", done: false, dedupeKey: `item:${id}:maintenance:2026-11-20` });
			const reminder = page.locator(`[id="task-${withReminder.tasks[0].id}"]`);
			await reminder.getByRole("button", { name: t("complete"), exact: true }).dblclick();
			await expect(reminder.getByRole("button", { name: t("reopen"), exact: true })).toBeVisible();
			await reminder.getByRole("button", { name: t("reopen"), exact: true }).click();
			await reminder.getByRole("button", { name: t("complete"), exact: true }).click();
			await expect(reminder.getByRole("button", { name: t("reopen"), exact: true })).toBeVisible();
			await page.reload();
			const completed = await state(page, id);
			expect(completed.tasks).toHaveLength(1);
			expect(completed.tasks[0].completionHistory).toHaveLength(2);
			expect(completed.tasks[0].done).toBe(true);
			expect(completed.history).toHaveLength(4);
			expect(completed.asset.itemMedia.coverId).toBe(returned.asset.itemMedia.coverId);
			await expect(page.locator(".asset-item-photo-stage img")).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			await page.screenshot({ path: join(evidence, `T12-${locale}-${width}.png`), fullPage: true });
			await test.info().attach("T12-state", { body: JSON.stringify(completed, null, 2), contentType: "application/json" });
			expect(errors).toEqual([]);
		} finally { if (!page.isClosed()) await page.screenshot({ path: test.info().outputPath("mobile-end.png"), fullPage: true }); await context.close(); }
	});
}

for (const [locale, width] of [["zh-CN", 390], ["en", 390]] as const) {
	test(`T12-04 ${locale} ${width}px stale in-flight item action rejects another tab's location edit`, async ({ browser }) => {
		const context = await browser.newContext({ locale, viewport: { width, height: 950 } });
		const first = await context.newPage();
		const second = await context.newPage();
		const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
		try {
			await context.addInitScript((language) => localStorage.setItem("keepany-language", language), locale);
			await first.goto("/");
			const id = await fixture(first);
			await first.goto(`/assets/item/${id}`);
			await second.goto(first.url());
			await second.getByLabel(t("borrower"), { exact: true }).fill("T12 stale borrower");
			await second.evaluate(async (repositoryPath) => {
				const repository = await (await import(repositoryPath)).localRepository();
				const original = repository.recordItemAction.bind(repository);
				const gate = window as unknown as { t12Entered: boolean; t12Resume?: () => void };
				repository.recordItemAction = async (...args: unknown[]) => {
					gate.t12Entered = true;
					await new Promise<void>((resolve) => { gate.t12Resume = resolve; });
					repository.recordItemAction = original;
					return original(...args);
				};
			}, repositoryPath);
			await second.getByRole("button", { name: t("loan"), exact: true }).click();
			await expect.poll(() => second.evaluate(() => (window as unknown as { t12Entered: boolean }).t12Entered)).toBe(true);
			await first.getByRole("button", { name: t("itemEditLocation"), exact: true }).click();
			const dialog = first.getByRole("dialog");
			await dialog.getByLabel(t("itemLocationArea")).fill("Tab A wins");
			await dialog.getByLabel(t("itemLocationContainer")).fill("Shelf");
			await dialog.getByLabel(t("itemLocationSpot")).fill("New position");
			await dialog.getByRole("button", { name: t("itemSaveLocation"), exact: true }).click();
			await expect(dialog).toBeHidden();
			const won = await state(first, id);
			// The established persisted separator includes U+2063; display removes it.
			expect(won.asset.location).toBe("Tab A wins \u2063› Shelf \u2063› New position");
			await second.evaluate(() => (window as unknown as { t12Resume: () => void }).t12Resume());
			await expect(second.getByRole("alert")).toHaveText(t("itemStale"));
			const rejected = await state(first, id);
			expect(rejected.asset).toEqual(won.asset);
			expect(rejected.history).toEqual([]);
			await second.reload();
			await second.getByLabel(t("borrower"), { exact: true }).fill("T12 fresh borrower");
			await second.getByRole("button", { name: t("loan"), exact: true }).click();
			await expect(second.getByRole("button", { name: t("return"), exact: true })).toBeVisible();
			const retried = await state(second, id);
			expect(retried.asset).toMatchObject({ location: won.asset.location, status: "loaned", borrower: "T12 fresh borrower" });
			expect(retried.history).toHaveLength(1);
		} finally { if (!second.isClosed()) await second.screenshot({ path: test.info().outputPath("mobile-end.png"), fullPage: true }); await context.close(); }
	});
}

});


test.describe('F09-leap-anchor — fresh 4236 shared React mobile', () => {
// Reused steps from qa-t13-windows.spec.ts; restricted to mobile widths.

const repository = sourceModuleUrl("packages/local-db/src/index.ts");
const domain = sourceModuleUrl("packages/domain/src/index.ts");
for (const locale of ["zh-CN", "en-US"] as const) {
	test(`${locale} T13 annual renewal keeps the original leap-day anchor through four UI renewals`, async ({ browser }) => {
		const context = await browser.newContext({ locale, viewport: { width: 390, height: 900 } });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), locale === "zh-CN" ? "zh-CN" : "en");
		const page = await context.newPage();
		try {
			await page.goto("/");
			const id = await page.evaluate(async ([repositoryPath, domainPath]) => {
				const { newAsset } = await import(domainPath);
				const { save } = await import(repositoryPath);
				const asset = { ...newAsset("subscription"), name: "T13 leap-day", amount: 1200, currency: "USD", cycle: "year", interval: 1, dueDate: "2024-02-29", billingAnchor: "2024-02-29", renewalCount: 0 };
				await save("asset", asset);
				return asset.id;
			}, [repository, domain]);
			await page.goto(`/assets/subscription/${id}`);
			for (const [index, next] of ["2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29"].entries()) {
				await page.getByRole("button", { name: locale === "zh-CN" ? "记录续费" : "Record renewal", exact: true }).click();
				await expect.poll(async () => page.evaluate(async ({ repositoryPath, id }) => {
					const db = await (await import(repositoryPath)).localRepository();
					const asset = await db.get("asset", id);
					const history = (await db.list("history")).filter((row: { assetId: string; action: string }) => row.assetId === id && row.action === "renew");
					return { anchor: asset.billingAnchor, due: asset.dueDate, count: history.length };
				}, { repositoryPath: repository, id })).toEqual({ anchor: "2024-02-29", due: next, count: index + 1 });
			}
			await page.reload();
			await expect(page.getByRole("heading", { name: "T13 leap-day", exact: true })).toBeVisible();
		} finally { if (!page.isClosed()) await page.screenshot({ path: test.info().outputPath("mobile-end.png"), fullPage: true }); await context.close(); }
	});
}

});


test.describe('F09-cycle — fresh 4236 shared React mobile', () => {
// Reused steps from subscription-cycle.spec.ts; restricted to mobile widths.

const repositoryModuleUrl = sourceModuleUrl("packages/local-db/src/index.ts");

function nextDate(page: Page, label: string) {
	return page.locator("dt").filter({ hasText: label }).locator("..").locator("dd");
}

function historyRows(page: Page, label: string) {
	return page.locator("section.card").filter({ has: page.getByRole("heading", { name: label }) }).locator(".list-row");
}

async function localRenewalState(page: Page, name: string) {
	return page.evaluate(async ({ modulePath, name }) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		const asset = (await repository.list("asset")).find((row: { name: string }) => row.name === name);
		const history = (await repository.list("history")).filter((row: { assetId: string; action: string }) => row.assetId === asset?.id && row.action === "renew");
		return { asset, history };
	}, { modulePath: repositoryModuleUrl, name });
}

test("renewal cycle, local amounts and history survive edits, status changes, refresh and backup restore", async ({ browser }) => {
	test.setTimeout(120_000);
	mkdirSync(evidence, { recursive: true });
	const source = await browser.newContext({ locale: "en-US", timezoneId: "America/New_York", acceptDownloads: true, viewport: { width: 390, height: 800 } });
	const page = await source.newPage();
	page.setDefaultTimeout(10_000);
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	const name = `Cycle ${crypto.randomUUID().slice(0, 8)}`;
	const password = `test-only-cycle-${crypto.randomUUID()}`;
	try {
		await page.goto("/assets/subscription");
		await page.getByRole("button", { name: "Add", exact: true }).click();
		let dialog = page.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill(name);
		await selectChoice(dialog.locator("#currency"), "USD");
		await dialog.locator("#amount").fill("120.00");
		await dialog.locator("#dueDate").fill("2026-01-31");
		await dialog.locator("#trialEndsAt").fill("2026-02-01");
		await dialog.locator("#discountAmount").fill("20.00");
		await dialog.locator("#discountUntil").fill("2026-02-28");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await page.getByText(name).first().click();
		await expect(nextDate(page, "Next date")).toHaveText("Jan 31, 2026");
		await expect(nextDate(page, "Monthly average")).toContainText("$120.00");
		await expect(nextDate(page, "Estimated amount for this date")).toContainText("$0.00");

		await page.getByRole("button", { name: "Record renewal" }).dblclick();
		await expect(nextDate(page, "Next date")).toHaveText("Feb 28, 2026");
		await expect(historyRows(page, "History")).toHaveCount(1);
		await expect(historyRows(page, "History").first()).toContainText("$0.00");
		await expect(nextDate(page, "Estimated amount for this date")).toContainText("$100.00");
		await page.getByLabel("Locally recorded amount").fill("88.40");
		await page.getByRole("button", { name: "Record renewal" }).click();
		await expect(nextDate(page, "Next date")).toHaveText("Mar 31, 2026");
		await expect(historyRows(page, "History")).toHaveCount(2);
		await expect(historyRows(page, "History").first()).toContainText("$88.40");
		await expect(nextDate(page, "Estimated amount for this date")).toContainText("$120.00");

		await page.getByRole("button", { name: "Edit", exact: true }).click();
		dialog = page.getByRole("dialog");
		await dialog.locator("#dueDate").fill("2026-04-30");
		await dialog.locator("#interval").fill("2");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await expect(nextDate(page, "Next date")).toHaveText("Apr 30, 2026");

		for (const status of ["paused", "cancelled", "active"]) {
			await page.getByRole("button", { name: "Edit", exact: true }).click();
			dialog = page.getByRole("dialog");
			await selectChoice(dialog.locator("#status"), status);
			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(dialog).toBeHidden();
			if (status === "active") await expect(page.getByRole("button", { name: "Record renewal" })).toBeEnabled();
			else await expect(page.getByRole("button", { name: "Record renewal" })).toBeDisabled();
			await page.goto("/");
			const dueCard = page.locator(".overview-panel").filter({ has: page.getByRole("heading", { name: "Next actions" }) });
			if (status === "active") await expect(dueCard).toContainText(name);
			else await expect(dueCard).not.toContainText(name);
			await page.goto("/assets/subscription");
			await page.getByText(name).first().click();
		}
		await expect(page.getByRole("button", { name: "Record renewal" })).toBeEnabled();
		await page.getByRole("button", { name: "Record renewal" }).click();
		await expect(nextDate(page, "Next date")).toHaveText("Jun 30, 2026");
		await expect(historyRows(page, "History")).toHaveCount(3);
		await page.reload();
		await expect(historyRows(page, "History")).toHaveCount(3);
		// The development server exposes the source module for exact local record readback.
		// Production preview verifies the same flow through its visible UI and restored archive.
		const before = process.env.KEEPANY_SUBSCRIPTION_MODE === "preview" ? null : await localRenewalState(page, name);
		if (before) {
			expect(before.asset?.renewalCount).toBe(1);
			expect(before.asset?.billingAnchor).toBe("2026-04-30");
			expect(before.asset?.cancelledAt).toBe("");
			expect(before.history.map((entry: { amount: number }) => entry.amount).sort((a: number, b: number) => a - b)).toEqual([0, 8840, 12000]);
		}
		await page.screenshot({ path: `${evidence}/subscription-cycle-en-source390.png`, fullPage: true });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.reload();
		await expect(historyRows(page, "History")).toHaveCount(3);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
		await page.screenshot({ path: `${evidence}/subscription-cycle-en-390.png`, fullPage: true });

		await page.goto("/intake");
		await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: "Create backup" }).click();
		const downloadEvent = page.waitForEvent("download");
		await page.getByRole("link", { name: "Save backup file" }).click();
		const path = await (await downloadEvent).path();
		if (!path) throw Error("backup download missing");
		const destination = await browser.newContext({ locale: "zh-CN", timezoneId: "Asia/Shanghai", viewport: { width: 390, height: 800 } });
		const restored = await destination.newPage();
		restored.setDefaultTimeout(10_000);
		restored.on("pageerror", error => errors.push(error.message));
		try {
			await restored.goto("/settings");
			await selectChoice(restored.locator("section.card").filter({ has: restored.getByRole("heading", { name: /^(Language|语言)$/ }) }).getByRole("combobox"), "zh-CN");
			await expect(restored.getByRole("heading", { name: "设置" })).toBeVisible();
			await restored.goto("/intake");
			await restored.locator("#backup-password").fill(password);
			await restored.locator("details").filter({ has: restored.locator("#restore-file") }).locator("summary").click();
			await restored.locator("#restore-file").setInputFiles(path);
			await restored.getByRole("button", { name: "预览", exact: true }).first().click();
			await restored.getByRole("button", { name: /确认 ·/ }).click();
			await expect(restored.getByText(/已恢复 \d+ 条记录/)).toBeVisible();
			await restored.goto("/assets/subscription");
			await restored.getByText(name).first().click();
			await expect(nextDate(restored, "下次日期")).toHaveText("2026年6月30日");
			await expect(historyRows(restored, "历史记录")).toHaveCount(3);
			await expect(historyRows(restored, "历史记录").first()).toContainText("本机记录金额");
			if (before) {
				const after = await localRenewalState(restored, name);
				expect(after.asset?.id).toBe(before.asset?.id);
				expect(after.asset?.dueDate).toBe(before.asset?.dueDate);
				expect(after.history.map((entry: { id: string; amount: number }) => [entry.id, entry.amount]).sort()).toEqual(before.history.map((entry: { id: string; amount: number }) => [entry.id, entry.amount]).sort());
			}
			await restored.screenshot({ path: `${evidence}/subscription-cycle-zh-restored390.png`, fullPage: true });
			await restored.setViewportSize({ width: 390, height: 844 });
			await restored.reload();
			await expect(historyRows(restored, "历史记录")).toHaveCount(3);
			expect(await restored.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
			await restored.screenshot({ path: `${evidence}/subscription-cycle-zh-390.png`, fullPage: true });
		} finally {
			await destination.close();
		}
		expect(errors).toEqual([]);
	} finally {
		await source.close();
	}
});

test("an older client edit during a queued renewal leaves no false history and permits backup", async ({ browser }) => {
	test.skip(process.env.KEEPANY_SUBSCRIPTION_MODE === "preview", "This fault injection uses the development source module.");
	test.setTimeout(90_000);
	const context = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 800 } });
	const first = await context.newPage();
	const second = await context.newPage();
	first.setDefaultTimeout(10_000);
	second.setDefaultTimeout(10_000);
	const name = `Concurrent cycle ${crypto.randomUUID().slice(0, 8)}`;
	try {
		await first.goto("/assets/subscription");
		await first.getByRole("button", { name: "Add", exact: true }).click();
		const dialog = first.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill(name);
		await dialog.locator("#dueDate").fill("2026-01-31");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await first.getByText(name).first().click();
		await second.goto(first.url());
		await expect(second.getByRole("heading", { name })).toBeVisible();
		await second.evaluate(async modulePath => {
			const { localRepository } = await import(modulePath);
			await localRepository();
		}, repositoryModuleUrl);

		await first.evaluate(async modulePath => {
			const { localRepository } = await import(modulePath);
			const repository = await localRepository();
			const storage = repository.db.records.storageInstance;
			const original = storage.bulkWrite.bind(storage);
			let release: (() => void) | undefined;
			let entered = false;
			const gate = { entered: () => entered, release: () => release?.() };
			(window as Window & { __renewalGate?: typeof gate }).__renewalGate = gate;
			storage.bulkWrite = async (rows: Parameters<typeof original>[0], context: Parameters<typeof original>[1]) => {
				if (context === "keepany-renewal" && !entered) {
					entered = true;
					await new Promise<void>(resolve => { release = resolve; });
				}
				return original(rows, context);
			};
		}, repositoryModuleUrl);
		await first.getByRole("button", { name: "Record renewal" }).click();
		await first.waitForFunction(() => (window as Window & { __renewalGate?: { entered: () => boolean } }).__renewalGate?.entered());
		await second.evaluate(async ({ modulePath, name }) => {
			const { localRepository } = await import(modulePath);
			const repository = await localRepository();
			const asset = (await repository.list("asset")).find((item: { name: string }) => item.name === name);
			if (!asset) throw Error("subscription missing in second tab");
			// Current public writes share the native journal gate. Model an older
			// client that bypasses it, so the pair's storage CAS remains essential.
			const storage = repository.db.records.storageInstance;
			const [raw] = await storage.findDocumentsById([`asset:${asset.id}`], false);
			const changed = await storage.bulkWrite([{ previous: raw, document: {
				...raw, payload: JSON.stringify({ ...asset, name: `${name} renamed` }), updatedAt: raw.updatedAt + 1,
			} }], "external-test-edit");
			if (changed.error.length) throw Error("older-client-edit-failed");
		}, { modulePath: repositoryModuleUrl, name });
		const openingTab = await context.newPage();
		await openingTab.goto(first.url());
		await expect(openingTab.getByRole("heading", { name: `${name} renamed` })).toHaveCount(0);
		await first.evaluate(() => (window as Window & { __renewalGate?: { release: () => void } }).__renewalGate?.release());
		await expect.poll(async () => second.evaluate(async modulePath => {
			const { localRepository } = await import(modulePath);
			return (await localRepository()).fileStore.renewalJournal.count();
		}, repositoryModuleUrl)).toBe(0);
		await expect(openingTab.getByRole("heading", { name: `${name} renamed` })).toBeVisible();
		await expect.poll(async () => (await localRenewalState(second, `${name} renamed`)).history).toHaveLength(0);
		const state = await localRenewalState(second, `${name} renamed`);
		expect(state.asset).toMatchObject({ dueDate: "2026-01-31", renewalCount: 0 });
		expect(state.history).toHaveLength(0);
		expect(await second.evaluate(async modulePath => {
			const { localRepository } = await import(modulePath);
			return (await (await localRepository()).exportArchive()).length;
		}, repositoryModuleUrl)).toBeGreaterThan(0);

		await second.reload();
		await second.getByRole("button", { name: "Record renewal" }).click();
		await expect(nextDate(second, "Next date")).toHaveText("Feb 28, 2026");
		await expect(historyRows(second, "History")).toHaveCount(1);
	} finally {
		await first.evaluate(() => (window as Window & { __renewalGate?: { release: () => void } }).__renewalGate?.release()).catch(() => {});
		await context.close();
	}
});

});


test.describe('F07-impact — fresh 4236 shared React mobile', () => {
// Reused steps from impact-checklist.spec.ts; restricted to mobile widths.

const repositoryModuleUrl = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/local-db/src/index.ts`;

async function taskRows(page: Page) {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		return (await (await localRepository()).list("task", true)) as {
			id: string;
			dedupeKey: string;
			done: boolean;
			dueDate: string;
			completedAt: string;
			completionHistory: string[];
			impactSnapshot?: { accountId: string; relationId: string; label: string; source: string; verifiedAt: string; legacyDedupeKey?: string };
		}[];
	}, repositoryModuleUrl);
}

for (const scenario of [
	{ language: "en", width: 390, add: "Add", name: "Name", save: "Save", addRelation: "Add connection", target: "Connect to", label: "Connection label", source: "Connection source", verified: "Last verified", generate: "Create checklist", complete: "Complete", reopen: "Reopen", remind: "Remind later", pending: "Pending", done: "Completed", all: "All", task: "View task", backup: "Create backup", download: "Save backup file", preview: "Preview", restored: /Restored \d+ records/ },
	{ language: "zh-CN", width: 390, add: "新增", name: "名称", save: "保存", addRelation: "添加关联", target: "关联至", label: "关联用途", source: "关系来源", verified: "最近核验", generate: "生成检查待办", complete: "完成", reopen: "重新打开", remind: "稍后提醒", pending: "待处理", done: "已完成", all: "全部", task: "查看待办", backup: "创建备份", download: "保存备份文件", preview: "预览", restored: /已恢复 \d+ 条记录/ },
] as const) {
	test(`${scenario.language} ${scenario.width}px account impact checklist and fresh .ka1 restore`, async ({ browser }) => {
		test.setTimeout(150_000);
		mkdirSync(evidence, { recursive: true });
		const context = await browser.newContext({
			locale: scenario.language === "en" ? "en-US" : "zh-CN",
			viewport: { width: scenario.width, height: 844 },
			acceptDownloads: true,
		});
		await context.addInitScript((language) => localStorage.setItem("keepany-language", language), scenario.language);
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.setDefaultTimeout(12_000);
		const suffix = crypto.randomUUID().slice(0, 6);
		const account = `Account ${suffix}`;
		const project = `Project ${suffix}`;
		const labelA = `Recovery ${suffix}`;
		const labelB = `Billing ${suffix}`;
		const password = `impact-local-${suffix}-2026`;
		async function addAsset(kind: "account" | "project", name: string) {
			await page.goto(`/assets/${kind}`);
			await page.getByRole("button", { name: scenario.add, exact: true }).click();
			const dialog = page.getByRole("dialog");
			await dialog.getByLabel(scenario.name, { exact: true }).fill(name);
			await dialog.getByRole("button", { name: scenario.save }).click();
			await expect(dialog).toBeHidden();
			await page.getByText(name, { exact: true }).first().click();
			await expect(page.getByRole("heading", { name })).toBeVisible();
			return page.url();
		}
		async function addRelation(label: string, metadata: boolean) {
			await page.getByRole("button", { name: scenario.addRelation }).click();
			const dialog = page.getByRole("dialog");
			await selectChoice(dialog.getByLabel(scenario.target), { label: project });
			await dialog.getByLabel(scenario.label).fill(label);
			if (metadata) {
				await dialog.getByLabel(scenario.source).fill("Local relationship note");
				await dialog.getByLabel(scenario.verified).fill("2026-09-29");
			}
			await dialog.getByRole("button", { name: scenario.save }).click();
			await expect(dialog).toBeHidden();
		}
		try {
			await addAsset("project", project);
			const accountUrl = await addAsset("account", account);
			await addRelation(labelA, true);
			await addRelation(labelB, false);
			const checklist = page.locator(".impact-checklist");
			await expect(checklist.getByRole("button", { name: `${scenario.generate} · 2` })).toBeEnabled();
			await checklist.getByRole("button", { name: `${scenario.generate} · 2` }).click();
			await expect(checklist.locator(".impact-task-row")).toHaveCount(2);
			await expect(checklist.getByRole("button", { name: `${scenario.generate} · 0` })).toBeDisabled();
			const initial = (await taskRows(page)).filter((row) => row.impactSnapshot);
			expect(initial).toHaveLength(2);
			expect(new Set(initial.map((row) => row.impactSnapshot?.relationId)).size).toBe(2);
			expect(initial.find((row) => row.impactSnapshot?.label === labelA)?.impactSnapshot).toMatchObject({ source: "Local relationship note", verifiedAt: "2026-09-29" });
			const first = checklist.locator(".impact-task-row").filter({ hasText: labelA });
			const second = checklist.locator(".impact-task-row").filter({ hasText: labelB });
			await expect(first.getByRole("link", { name: project })).toBeVisible();
			await first.getByRole("button", { name: new RegExp(scenario.complete) }).click();
			await expect(first.getByText(scenario.done, { exact: true })).toBeVisible();
			await second.getByLabel(scenario.remind).fill("2026-10-05");
			await expect(second.getByLabel(scenario.remind)).toHaveValue("2026-10-05");
			await expect(checklist.getByRole("button", { name: `${scenario.pending} · 1` })).toBeVisible();
			await checklist.getByRole("button", { name: `${scenario.pending} · 1` }).click();
			await expect(checklist.locator(".impact-task-row")).toHaveCount(1);
			await checklist.getByRole("button", { name: `${scenario.done} · 1` }).click();
			await expect(checklist.locator(".impact-task-row")).toHaveCount(1);
			await checklist.getByRole("button", { name: `${scenario.all} · 2` }).click();
			await expect(page.locator(".react-flow__node")).toHaveCount(2);
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.screenshot({ path: `${evidence}/impact-${scenario.language}-${scenario.width}-account.png`, fullPage: true });
			await first.getByRole("link", { name: scenario.task }).click();
			await expect(page).toHaveURL(/\/tasks#task-/);
			await expect(page.locator(".impact-task-row")).toHaveCount(2);
			await page.screenshot({ path: `${evidence}/impact-${scenario.language}-${scenario.width}-tasks.png`, fullPage: true });
			await page.locator(".impact-task-row").filter({ hasText: labelA }).getByRole("button", { name: new RegExp(scenario.reopen) }).click();
			await expect(page.locator(".impact-task-row").filter({ hasText: labelA }).getByText(scenario.pending, { exact: true })).toBeVisible();
			await page.locator(".impact-task-row").filter({ hasText: labelA }).getByRole("button", { name: new RegExp(scenario.complete) }).click();
			await expect(page.locator(".impact-task-row").filter({ hasText: labelA }).getByText(scenario.done, { exact: true })).toBeVisible();
			await expect.poll(async () => (await taskRows(page)).find((row) => row.impactSnapshot?.label === labelA)?.completionHistory?.length).toBe(2);
			await page.goto(accountUrl);
			await expect(checklist.locator(".impact-task-row")).toHaveCount(2);
			const before = (await taskRows(page)).filter((row) => row.impactSnapshot).sort((a, b) => a.id.localeCompare(b.id));
			expect(before).toHaveLength(2);
			expect(before.find((row) => row.impactSnapshot?.label === labelA)?.completionHistory).toHaveLength(2);
			expect(before.find((row) => row.impactSnapshot?.label === labelB)?.dueDate).toBe("2026-10-05");
			await page.reload();
			await expect(checklist.locator(".impact-task-row")).toHaveCount(2);
			await page.goto("/intake");
			await page.locator("#backup-password").fill(password);
			await page.getByRole("button", { name: scenario.backup }).click();
			const saveFile = page.getByRole("link", { name: scenario.download });
			await expect(saveFile).toBeVisible();
			const downloadPromise = page.waitForEvent("download");
			await saveFile.click();
			const download = await downloadPromise;
			expect(download.suggestedFilename()).toMatch(/\.ka1$/);
			const path = await download.path();
			if (!path) throw Error("backup download missing");
			expect(readFileSync(path).byteLength).toBeGreaterThan(52);
			const restoreContext = await browser.newContext({ locale: scenario.language === "en" ? "en-US" : "zh-CN", viewport: { width: scenario.width, height: 844 } });
			await restoreContext.addInitScript((language) => localStorage.setItem("keepany-language", language), scenario.language);
			const restored = await restoreContext.newPage();
			restored.on("pageerror", (error) => errors.push(error.message));
			try {
				await restored.goto("/intake");
				await restored.locator("#backup-password").fill(password);
				await restored.locator("#restore-file").setInputFiles(path);
				await restored.getByRole("button", { name: scenario.preview, exact: true }).first().click();
				await restored.getByRole("button", { name: /Confirm ·|确认 ·/ }).click();
				await expect(restored.getByText(scenario.restored)).toBeVisible();
				const after = (await taskRows(restored)).filter((row) => row.impactSnapshot).sort((a, b) => a.id.localeCompare(b.id));
				expect(after).toEqual(before);
				await restored.goto(new URL(accountUrl).pathname);
				await expect(restored.locator(".impact-task-row")).toHaveCount(2);
				await expect(restored.locator(".react-flow__node")).toHaveCount(2);
				await expect(restored.locator(".impact-checklist").getByRole("button", { name: `${scenario.generate} · 0` })).toBeDisabled();
				await restored.screenshot({ path: `${evidence}/impact-${scenario.language}-${scenario.width}-restored.png`, fullPage: true });
				const overflow = await restored.evaluate(() => document.documentElement.scrollWidth - innerWidth);
				expect(overflow).toBeLessThanOrEqual(1);
			} finally {
				await restoreContext.close();
			}
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
}

test("relation changes preserve completed impact history and add only new relation tasks", async ({ page }) => {
	test.setTimeout(75_000);
	page.setDefaultTimeout(10_000);
	const suffix = crypto.randomUUID().slice(0, 6);
	const account = `Account ${suffix}`;
	const project = `Project ${suffix}`;
	const other = `Other ${suffix}`;
	const label = `Recovery ${suffix}`;
	const newLabel = `Owner ${suffix}`;
	async function addAsset(kind: "account" | "project", name: string) {
		await page.goto(`/assets/${kind}`);
		await page.getByRole("button", { name: "Add", exact: true }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill(name);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await page.getByText(name, { exact: true }).first().click();
		return page.url();
	}
	async function addRelation(target: string, name: string) {
		await page.getByRole("button", { name: "Add connection" }).click();
		const dialog = page.getByRole("dialog");
		await selectChoice(dialog.getByLabel("Connect to"), { label: target });
		await dialog.getByLabel("Connection label").fill(name);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
	}
	await addAsset("project", project);
	await addAsset("project", other);
	const accountUrl = await addAsset("account", account);
	await addRelation(project, label);
	const checklist = page.locator(".impact-checklist");
	await checklist.getByRole("button", { name: "Create checklist · 1" }).click();
	await expect(checklist.locator(".impact-task-row")).toHaveCount(1);
	await checklist.locator(".impact-task-row").getByRole("button", { name: /Complete/ }).click();
	await expect(checklist.locator(".impact-task-row").getByText("Completed", { exact: true })).toBeVisible();
	const original = (await taskRows(page)).find((row) => row.impactSnapshot?.label === label);
	if (!original) throw Error("original impact task missing");
	await page.locator('.account-relation-details > summary').click();
	await page.getByRole("button", { name: `Delete connection · ${label} · ${project}` }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Delete connection" }).click();
	await expect(checklist.getByText("The original connection or asset was removed.", { exact: false })).toBeVisible();
	await expect(checklist.locator(".impact-task-row")).toHaveCount(1);
	await page.goto("/trash");
	await page.locator(".relation-row").filter({ hasText: label }).getByRole("button", { name: "Restore" }).click();
	await page.goto(accountUrl);
	await expect(checklist.getByText("The original connection or asset was removed.", { exact: false })).toHaveCount(0);
	await addRelation(other, newLabel);
	await expect(checklist.getByRole("button", { name: "Create checklist · 1" })).toBeEnabled();
	await checklist.getByRole("button", { name: "Create checklist · 1" }).click();
	await expect(checklist.locator(".impact-task-row")).toHaveCount(2);
	const after = (await taskRows(page)).filter((row) => row.impactSnapshot);
	expect(after).toHaveLength(2);
	expect(after.find((row) => row.id === original.id)).toMatchObject({ done: true, completedAt: original.completedAt, completionHistory: original.completionHistory });
	expect(after.filter((row) => row.impactSnapshot?.relationId === original.impactSnapshot?.relationId)).toHaveLength(1);
});


});


test.describe('F12-ledger — fresh 4236 shared React mobile', () => {
// Reused steps from finance-ledger-release.spec.ts; restricted to mobile widths.

test.use({ timezoneId: "Asia/Shanghai" });

const password = "finance-ledger-release-backup-2026";
const eventDate = "2026-09-30";

const copies = {
	"zh-CN": {
		add: "新增",
		name: "名称",
		provider: "服务商",
		save: "保存",
		paymentMethod: "付款方式",
		account: "登录账号",
		amount: "金额",
		currency: "币种",
		dueDate: "下次日期",
		financeTitle: "订阅与账单",
		addRecord: "记一笔",
		recordDialog: "记一笔",
		recordType: "记录类型",
		relatedAsset: "关联资产",
		title: "名称",
		date: "日期",
		source: "付款来源（选填）",
		note: "备注",
		saveRecord: "保存记录",
		invalidAmount: "请输入有效金额。",
		filterType: "类型",
		filterAsset: "关联资产",
		filterSource: "付款来源或方式",
		noSource: "未填写来源",
		monthlyPlan: "每月计划费用",
		confirmedSpent: "本月已记录支出",
		balances: "余额观察",
		backup: "创建备份",
		download: "保存备份文件",
		preview: "预览",
		confirm: /^确认 ·/,
		restored: /已恢复 \d+ 条记录/,
	},
	"en-US": {
		add: "Add",
		name: "Name",
		provider: "Provider",
		save: "Save",
		paymentMethod: "Payment method",
		account: "Sign-in account",
		amount: "Amount",
		currency: "Currency",
		dueDate: "Next date",
		financeTitle: "Subscriptions and bills",
		addRecord: "Record transaction",
		recordDialog: "Record transaction",
		recordType: "Record type",
		relatedAsset: "Related asset",
		title: "Title",
		date: "Date",
		source: "Payment source (optional)",
		note: "Note",
		saveRecord: "Save record",
		invalidAmount: "Enter a valid amount.",
		filterType: "Type",
		filterAsset: "Related asset",
		filterSource: "Payment source or method",
		noSource: "No source recorded",
		monthlyPlan: "Monthly planned cost",
		confirmedSpent: "Spending recorded this month",
		balances: "Observed balances",
		backup: "Create backup",
		download: "Save backup file",
		preview: "Preview",
		confirm: /^Confirm ·/,
		restored: /Restored \d+ records/,
	},
} as const;

type Locale = keyof typeof copies;
type Copy = (typeof copies)[Locale];
type Action = "expense" | "topup" | "refund" | "balance";
type LedgerSpec = {
	action: Action;
	targetId: string;
	title: string;
	amount: string;
	amountMinor: number;
	currency: "CNY" | "JPY";
	source: string;
	note: string;
	invalidAmount?: string;
};
type ArchiveRow = { type: string; payload: string };
type ArchiveData = {
	assets: Asset[];
	history: History[];
	relations: Relation[];
};

function byId<T extends { id: string }>(values: T[]) {
	return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

async function readArchive(path: string): Promise<ArchiveData> {
	const encrypted = new Uint8Array(readFileSync(path));
	expect(Buffer.from(encrypted.subarray(0, 8)).toString("utf8")).toBe(
		"KEEPANY1",
	);
	const files = unzipSync(await decryptBackup(encrypted, password));
	const recordsFile = files["records.json"];
	if (!recordsFile) throw new Error("records-json-missing");
	const rows = JSON.parse(strFromU8(recordsFile)) as ArchiveRow[];
	return {
		assets: rows
			.filter((row) => row.type === "asset")
			.map((row) => JSON.parse(row.payload) as Asset),
		history: rows
			.filter((row) => row.type === "history")
			.map((row) => JSON.parse(row.payload) as History),
		relations: rows
			.filter((row) => row.type === "relation")
			.map((row) => JSON.parse(row.payload) as Relation),
	};
}

async function assetIdFromList(page: Page, name: string) {
	const link = page
		.locator("main .asset-list-content a")
		.filter({ hasText: name });
	await expect(link).toHaveCount(1);
	const href = await link.first().getAttribute("href");
	const id = href?.split("/").at(-1) ?? "";
	if (!id) throw new Error(`asset-id-missing:${name}`);
	return id;
}

async function createAccount(page: Page, copy: Copy, name: string) {
	await page.goto("/assets/account");
	await page.getByRole("button", { name: copy.add, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(copy.name, { exact: true }).fill(name);
	await dialog
		.getByLabel(copy.provider, { exact: true })
		.fill("Synthetic bank");
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
	return assetIdFromList(page, name);
}

async function createSubscription(
	page: Page,
	copy: Copy,
	name: string,
	accountId: string,
) {
	await page.goto("/assets/subscription");
	await page.getByRole("button", { name: copy.add, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(copy.name, { exact: true }).fill(name);
	await selectChoice(dialog.getByLabel(copy.account, { exact: true }), {
		value: accountId,
	});
	await dialog
		.getByLabel(copy.paymentMethod, { exact: true })
		.fill("Bank card");
	await dialog.locator("#amount").fill("1200");
	await selectChoice(dialog.getByLabel(copy.currency, { exact: true }), "JPY");
	await dialog.locator("#dueDate").fill("2026-10-31");
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
	return assetIdFromList(page, name);
}

async function recordTransaction(page: Page, copy: Copy, input: LedgerSpec) {
	await page.getByRole("button", { name: copy.addRecord, exact: true }).click();
	const dialog = page.getByRole("dialog", { name: copy.recordDialog });
	await selectChoice(
		dialog.getByLabel(copy.recordType, { exact: true }),
		input.action,
	);
	await selectChoice(dialog.getByLabel(copy.relatedAsset, { exact: true }), {
		value: input.targetId,
	});
	await dialog.getByLabel(copy.title, { exact: true }).fill(input.title);
	await dialog
		.getByLabel(copy.amount, { exact: true })
		.fill(input.invalidAmount ?? input.amount);
	await selectChoice(
		dialog.getByLabel(copy.currency, { exact: true }),
		input.currency,
	);
	await dialog.getByLabel(copy.date, { exact: true }).fill(eventDate);
	await dialog.getByLabel(copy.source, { exact: true }).fill(input.source);
	await dialog.getByLabel(copy.note, { exact: true }).fill(input.note);
	if (input.invalidAmount) {
		await dialog
			.getByRole("button", { name: copy.saveRecord, exact: true })
			.click();
		await expect(dialog.getByRole("alert")).toHaveText(copy.invalidAmount);
		await dialog.getByLabel(copy.amount, { exact: true }).fill(input.amount);
	}
	await dialog
		.getByRole("button", { name: copy.saveRecord, exact: true })
		.click();
	await expect(dialog).toBeHidden();
}

async function filterAndClear(
	page: Page,
	copy: Copy,
	ids: { accountId: string; subscriptionId: string },
) {
	const type = page.getByRole("combobox", {
		name: copy.filterType,
		exact: true,
	});
	const asset = page.getByRole("combobox", {
		name: copy.filterAsset,
		exact: true,
	});
	const source = page.getByRole("combobox", {
		name: copy.filterSource,
		exact: true,
	});
	const rows = page.locator(".finance-entry");

	await selectChoice(type, "expense");
	await selectChoice(asset, ids.subscriptionId);
	await selectChoice(source, "source:JPY statement");
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText("JPY expense");

	await selectChoice(type, "all");
	await selectChoice(asset, "");
	await selectChoice(source, "all");
	await expect(rows).toHaveCount(4);

	await selectChoice(asset, ids.accountId);
	await expect(rows).toHaveCount(3);
	await selectChoice(source, "empty");
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText(copy.noSource);

	await selectChoice(asset, "");
	await selectChoice(source, "all");
	await expect(rows).toHaveCount(4);
}

async function assertSummaryAndLinks(
	page: Page,
	copy: Copy,
	accountName: string,
	subscriptionName: string,
) {
	await expect(
		page.getByRole("heading", { name: copy.financeTitle }),
	).toBeVisible();
	const summary = page.locator(".finance-summary");
	await expect(summary.locator(".card").nth(0)).toContainText(copy.monthlyPlan);
	await expect(summary.locator(".card").nth(0)).toContainText("1,200");
	await expect(summary.locator(".card").nth(1)).toContainText(
		copy.confirmedSpent,
	);
	await expect(summary.locator(".card").nth(1)).toContainText("1,234");
	await expect(summary.locator(".card").nth(2)).toContainText(copy.balances);
	await expect(summary.locator(".card").nth(2)).toContainText("0.00");
	const linked = page
		.locator(".finance-linked-row")
		.filter({ hasText: subscriptionName });
	await expect(linked).toHaveCount(1);
	await expect(linked).toContainText(accountName);
}

async function downloadArchive(page: Page, copy: Copy) {
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: copy.backup, exact: true }).click();
	const link = page.getByRole("link", { name: copy.download, exact: true });
	await expect(link).toBeVisible();
	const download = page.waitForEvent("download");
	await link.click();
	const result = await download;
	const path = await result.path();
	if (!path) throw new Error("finance-backup-download-missing");
	expect(result.suggestedFilename()).toMatch(/\.ka1$/);
	return { path, data: await readArchive(path) };
}

async function restoreArchive(page: Page, copy: Copy, path: string) {
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.locator("#restore-file").setInputFiles(path);
	await page
		.getByRole("button", { name: copy.preview, exact: true })
		.first()
		.click();
	await page.getByRole("button", { name: copy.confirm }).click();
	await expect(page.getByText(copy.restored)).toBeVisible();
}

for (const variant of [
	{ locale: "zh-CN", width: 390 },
	{ locale: "en-US", width: 390 },
] as const) {
	test(`${variant.locale} ${variant.width} finance ledger survives UI backup and clean restore`, async ({
		browser,
	}) => {
		test.setTimeout(150_000);
		const copy = copies[variant.locale];
		let source: BrowserContext | undefined;
		let destination: BrowserContext | undefined;
		const errors: string[] = [];
		try {
			source = await browser.newContext({
				locale: variant.locale,
				viewport: { width: variant.width, height: 844 },
				acceptDownloads: true,
			});
			const sourcePage = await source.newPage();
			sourcePage.setDefaultTimeout(15_000);
			await sourcePage.clock.setFixedTime(new Date("2026-09-30T04:00:00Z"));
			sourcePage.on("pageerror", (error) =>
				errors.push(`source:${error.message}`),
			);

			const suffix = crypto.randomUUID().slice(0, 8);
			const accountName = `Ledger account ${suffix}`;
			const subscriptionName = `JPY subscription ${suffix}`;
			const accountId = await createAccount(sourcePage, copy, accountName);
			const subscriptionId = await createSubscription(
				sourcePage,
				copy,
				subscriptionName,
				accountId,
			);

			await sourcePage.goto("/finance");
			await expect(
				sourcePage.getByRole("heading", { name: copy.financeTitle }),
			).toBeVisible();
			const entries: LedgerSpec[] = [
				{
					action: "expense",
					targetId: subscriptionId,
					title: "JPY expense",
					amount: "1234",
					amountMinor: 1234,
					currency: "JPY",
					source: "JPY statement",
					note: "Checked JPY statement",
					invalidAmount: "12.5",
				},
				{
					action: "topup",
					targetId: accountId,
					title: "CNY top-up",
					amount: "50.00",
					amountMinor: 5000,
					currency: "CNY",
					source: "Bank transfer",
					note: "Added working funds",
				},
				{
					action: "refund",
					targetId: accountId,
					title: "CNY refund",
					amount: "5.00",
					amountMinor: 500,
					currency: "CNY",
					source: "",
					note: "Refund without source",
				},
				{
					action: "balance",
					targetId: accountId,
					title: "Observed zero balance",
					amount: "0",
					amountMinor: 0,
					currency: "CNY",
					source: "Bank app",
					note: "Zero balance observation",
				},
			];
			for (const entry of entries)
				await recordTransaction(sourcePage, copy, entry);

			await assertSummaryAndLinks(
				sourcePage,
				copy,
				accountName,
				subscriptionName,
			);
			await filterAndClear(sourcePage, copy, { accountId, subscriptionId });
			await sourcePage.reload();
			await expect(sourcePage.locator(".finance-entry")).toHaveCount(4);
			await assertSummaryAndLinks(
				sourcePage,
				copy,
				accountName,
				subscriptionName,
			);
			await sourcePage.screenshot({
				path: test
					.info()
					.outputPath(
						`finance-ledger-source-${variant.locale}-${variant.width}.png`,
					),
				fullPage: true,
			});

			const sourceArchive = await downloadArchive(sourcePage, copy);
			expect(sourceArchive.data.assets).toHaveLength(2);
			expect(sourceArchive.data.history).toHaveLength(4);
			expect(sourceArchive.data.relations).toHaveLength(1);
			expect(sourceArchive.data.relations).toEqual([
				expect.objectContaining({ from: subscriptionId, to: accountId }),
			]);
			for (const entry of entries) {
				expect(sourceArchive.data.history).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							action: entry.action,
							assetId: entry.targetId,
							title: entry.title,
							amount: entry.amountMinor,
							currency: entry.currency,
							eventDate,
							source: entry.source,
							note: entry.note,
						}),
					]),
				);
			}

			destination = await browser.newContext({
				locale: variant.locale,
				viewport: { width: variant.width, height: 844 },
				acceptDownloads: true,
			});
			const restored = await destination.newPage();
			restored.setDefaultTimeout(15_000);
			await restored.clock.setFixedTime(new Date("2026-09-30T04:00:00Z"));
			restored.on("pageerror", (error) =>
				errors.push(`restored:${error.message}`),
			);
			await restoreArchive(restored, copy, sourceArchive.path);
			await restored.reload();
			await restored.goto("/finance");
			await expect(restored.locator(".finance-entry")).toHaveCount(4);
			await assertSummaryAndLinks(
				restored,
				copy,
				accountName,
				subscriptionName,
			);
			await filterAndClear(restored, copy, { accountId, subscriptionId });
			await restored.screenshot({
				path: test
					.info()
					.outputPath(
						`finance-ledger-restored-${variant.locale}-${variant.width}.png`,
					),
				fullPage: true,
			});

			const restoredArchive = await downloadArchive(restored, copy);
			expect(byId(restoredArchive.data.assets)).toEqual(
				byId(sourceArchive.data.assets),
			);
			expect(byId(restoredArchive.data.history)).toEqual(
				byId(sourceArchive.data.history),
			);
			expect(byId(restoredArchive.data.relations)).toEqual(
				byId(sourceArchive.data.relations),
			);
			expect(errors).toEqual([]);
		} finally {
			if (destination) await destination.close().catch(() => undefined);
			if (source) await source.close().catch(() => undefined);
		}
	});
}

});


test.describe('F13-edit-filters — fresh 4236 shared React mobile', () => {
// Reused steps from qa-t16-completion.spec.ts; restricted to mobile widths.
const repositoryPath = `/@fs/${resolve("packages/local-db/src/index.ts").replaceAll("\\", "/")}`;
const domainPath = `/@fs/${resolve("packages/domain/src/index.ts").replaceAll("\\", "/")}`;
const editPath = `/@fs/${resolve("apps/web/src/task-edit.ts").replaceAll("\\", "/")}`;
async function tasks(page: Page) { return page.evaluate(async path => (await (await import(path)).localRepository()).list("task", true), repositoryPath); }
for (const zh of [true, false]) for (const width of [390]) {
	test(`${zh ? "zh" : "en"} ${width} T16-03 edit cancel/save, date intersection and return`, async ({ browser }) => {
		const context = await browser.newContext({ locale: zh ? "zh-CN" : "en-US", viewport: { width, height: 900 } });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
		const page = await context.newPage(); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
		try {
			await page.goto("/");
			const fixture = await page.evaluate(async ([rp, dp, ep]) => {
				const { saveBatch } = await import(rp); const { newAsset, taskSchema } = await import(dp);
				const asset = { ...newAsset("project"), name: "T16 date project" };
				const task = taskSchema.parse({ id: crypto.randomUUID(), name: "T16 original ".repeat(13).trim(), assetId: asset.id, dueDate: "2026-10-28", createdAt: new Date().toISOString(), completionHistory: ["2026-10-20T00:00:00Z"] });
				const occupied = { ...task, id: crypto.randomUUID(), name: "T16 occupied" };
				const { manualTaskDedupeKey } = await import(ep);
				task.dedupeKey = await manualTaskDedupeKey(task.name, task.assetId, task.dueDate);
				occupied.dedupeKey = await manualTaskDedupeKey(occupied.name, occupied.assetId, occupied.dueDate);
				const past = { ...task, id: crypto.randomUUID(), name: "T16 past", dueDate: "2026-10-26", dedupeKey: "" };
				const done = { ...task, id: crypto.randomUUID(), name: "T16 done", dueDate: "2026-10-29", dedupeKey: "", done: true, completedAt: "2026-10-27T00:00:00Z" };
				await saveBatch([{ type: "asset", value: asset }, ...[task, occupied, past, done].map(value => ({ type: "task", value }))]);
				return { asset, task, occupied, past, done };
			}, [repositoryPath, domainPath, editPath]);
			await page.goto("/tasks");
			const row = page.locator(`#task-${fixture.task.id}`);
			const edit = zh ? "编辑" : "Edit", cancel = zh ? "取消" : "Cancel", save = zh ? "保存" : "Save", name = zh ? "名称" : "Name";
			await row.getByRole("button", { name: edit, exact: true }).click();
			let dialog = page.getByRole("dialog");
			await dialog.getByLabel(name, { exact: true }).fill("Cancelled task edit");
			await dialog.getByRole("button", { name: cancel, exact: true }).click();
			expect((await tasks(page)).find((task: { id: string }) => task.id === fixture.task.id)).toEqual(fixture.task);
			await row.getByRole("button", { name: edit, exact: true }).click();
			dialog = page.getByRole("dialog");
			await dialog.getByLabel(name, { exact: true }).fill("");
			await dialog.getByRole("button", { name: save, exact: true }).click();
			await expect(dialog).toBeVisible();
			expect((await tasks(page)).find((task: { id: string }) => task.id === fixture.task.id)).toEqual(fixture.task);
			await dialog.getByLabel(name, { exact: true }).fill(fixture.occupied.name);
			await dialog.getByRole("button", { name: save, exact: true }).click();
			await expect(dialog.getByRole("alert")).toHaveText(zh ? "同一待办已存在且尚未完成。" : "This task is already pending.");
			await dialog.getByLabel(name, { exact: true }).fill("T16 edited task");
			await dialog.getByLabel(zh ? "日期" : "Date", { exact: true }).fill("2026-10-30");
			await page.evaluate(async path => { const db = await (await import(path)).localRepository(); const original = db.saveTaskIfCurrent.bind(db); db.saveTaskIfCurrent = async () => { db.saveTaskIfCurrent = original; throw new DOMException("Synthetic quota", "QuotaExceededError"); }; }, repositoryPath);
			await dialog.getByRole("button", { name: save, exact: true }).click();
			await expect(dialog.getByRole("alert")).toBeVisible();
			await expect(dialog.getByLabel(name, { exact: true })).toHaveValue("T16 edited task");
			expect((await tasks(page)).find((task: { id: string }) => task.id === fixture.task.id)).toEqual(fixture.task);
			await dialog.getByRole("button", { name: save, exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			const saved = (await tasks(page)).find((task: { id: string }) => task.id === fixture.task.id);
			expect(saved).toMatchObject({ name: "T16 edited task", dueDate: "2026-10-30", assetId: fixture.asset.id, completionHistory: fixture.task.completionHistory, createdAt: fixture.task.createdAt });
			expect((await tasks(page)).filter((task: { id: string }) => task.id !== fixture.task.id)).toEqual([fixture.occupied, fixture.past, fixture.done].sort((a, b) => a.id.localeCompare(b.id)));
			await page.getByLabel(zh ? "开始日期" : "Start date", { exact: true }).fill("2026-10-29");
			await page.getByLabel(zh ? "结束日期" : "End date", { exact: true }).fill("2026-10-30");
			await page.locator(".task-filters").getByRole("button", { name: new RegExp(`^${zh ? "待处理" : "Pending"}`) }).click();
			await expect(page.locator(".tasks-list-card .impact-task-info > strong")).toHaveText(["T16 edited task"]);
			await row.getByRole("link", { name: fixture.asset.name, exact: true }).click();
			await page.goBack(); await page.reload();
			await expect(page.getByLabel(zh ? "开始日期" : "Start date", { exact: true })).toHaveValue("2026-10-29");
			await expect(page.locator(".tasks-list-card .impact-task-info > strong")).toHaveText(["T16 edited task"]);
			await page.getByLabel(zh ? "结束日期" : "End date", { exact: true }).fill("2026-10-28");
			await expect(page.getByRole("alert")).toHaveText(zh ? "结束日期不能早于开始日期。" : "The end date must be on or after the start date.");
			await page.getByRole("button", { name: zh ? "清除日期" : "Clear dates", exact: true }).click();
			await expect(page.locator(".tasks-list-card .impact-task-info > strong")).toHaveCount(3);
			// A competing save after this editor opened must not become its new expected version.
			await row.getByRole("button", { name: edit, exact: true }).click();
			await page.getByRole("dialog").getByLabel(name, { exact: true }).fill("T16 stale draft");
			await page.evaluate(async ({ path, id }) => { const db = await (await import(path)).localRepository(); const current = await db.get("task", id); await db.saveTaskIfCurrent(current, { ...current, name: "T16 other tab" }); }, { path: repositoryPath, id: fixture.task.id });
			await page.getByRole("dialog").getByRole("button", { name: save, exact: true }).click();
			await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
			expect((await tasks(page)).find((task: { id: string }) => task.id === fixture.task.id)?.name).toBe("T16 other tab");
			await page.getByRole("dialog").getByRole("button", { name: cancel, exact: true }).click();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
			if ((zh && width === 390) || (!zh && width === 390)) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: `${evidence}/${zh ? "zh-390" : "en-390"}.png`, fullPage: true }); }
			expect(errors).toEqual([]);
		} finally { if (!page.isClosed()) await page.screenshot({ path: test.info().outputPath("mobile-end.png"), fullPage: true }); await context.close(); }
	});
}

});


test.describe('F13-task-lifecycle — fresh 4236 shared React mobile', () => {
// Reused steps from ordinary-task-reminder.spec.ts; restricted to mobile widths.

const repositoryUrl = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/local-db/src/index.ts`;
const domainUrl = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/domain/src/index.ts`;
test.use({ timezoneId: "Asia/Shanghai" });

type StoredTask = {
	id: string;
	assetId: string;
	name: string;
	dueDate: string;
	dedupeKey: string;
	done: boolean;
	completedAt: string;
	completionHistory: string[];
};

const languages = [
	{
		language: "en",
		add: "Add",
		name: "Name",
		date: "Date",
		save: "Save",
		cancel: "Cancel",
		complete: "Complete",
		reopen: "Reopen",
		remind: "Remind later",
		postpone: "Postpone 1 day",
		duplicate: "This task is already pending.",
		missing: "Related record unavailable",
		history: "Completion history",
		trash: "Move to trash",
	},
	{
		language: "zh-CN",
		add: "新增",
		name: "名称",
		date: "日期",
		save: "保存",
		cancel: "取消",
		complete: "完成",
		reopen: "重新打开",
		remind: "稍后提醒",
		postpone: "稍后 1 天",
		duplicate: "同一待办已存在且尚未完成。",
		missing: "关联资料不可用",
		history: "完成记录",
		trash: "移至回收站",
	},
] as const;
type Labels = (typeof languages)[number];

async function storedTasks(page: Page, name: string): Promise<StoredTask[]> {
	return page.evaluate(
		async ({ modulePath, taskName }) => {
			const { localRepository } = await import(modulePath);
			return (await (await localRepository()).list("task")).filter(
				(task: StoredTask) => task.name === taskName,
			);
		},
		{ modulePath: repositoryUrl, taskName: name },
	);
}

async function addTask(
	page: Page,
	labels: Labels,
	assetId: string,
	name: string,
	dueDate: string,
) {
	await page.goto(`/assets/item/${assetId}`);
	await page
		.locator(".asset-tasks-card")
		.getByRole("button", { name: labels.add, exact: true })
		.click();
	const editor = page.getByRole("dialog");
	await editor.getByLabel(labels.name, { exact: true }).fill(name);
	await editor.getByLabel(labels.date, { exact: true }).fill(dueDate);
	await editor.getByRole("button", { name: labels.save, exact: true }).click();
	return editor;
}

async function expectReachable(page: Page, control: Locator, width: number) {
	await control.scrollIntoViewIfNeeded();
	await expect(control).toBeVisible();
	const box = await control.boundingBox();
	expect(
		box &&
			box.x >= -1 &&
			box.x + box.width <= width + 1 &&
			box.y >= -1 &&
			box.y + box.height <= 845,
	).toBeTruthy();
	await expect(
		page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
	).resolves.toBe(true);
}

for (const labels of languages) {
	for (const width of [390]) {
		test(`${labels.language} ordinary task linked reminder, duplicate and orphan boundaries at ${width}px`, async ({
			page,
		}) => {
			test.setTimeout(60_000);
			await page.setViewportSize({ width, height: 844 });
			await page.clock.setFixedTime(new Date("2026-09-30T04:00:00Z"));
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.goto("/");
			await page.evaluate(
				(language) => localStorage.setItem("keepany-language", language),
				labels.language,
			);
			const asset = await page.evaluate(
				async ([repositoryPath, domainPath]) => {
					const { save } = await import(repositoryPath);
					const { newAsset } = await import(domainPath);
					const item = {
						...newAsset("item"),
						name: "Ordinary reminder camera",
					};
					await save("asset", item);
					return { id: item.id as string, name: item.name };
				},
				[repositoryUrl, domainUrl],
			);
			const taskName =
				labels.language === "en"
					? "Inspect camera records before renewal"
					: "续费前核对相机资料和购买记录";
			await expect(
				await addTask(page, labels, asset.id, taskName, "2026-10-31"),
			).toBeHidden();
			await expect
				.poll(async () => (await storedTasks(page, taskName)).length)
				.toBe(1);
			const taskId = (await storedTasks(page, taskName))[0].id;
			const row = page.locator(`#task-${taskId}`);
			const reminder = row.getByLabel(labels.remind, { exact: true });
			await page.goto("/tasks");
			await expect(
				row.getByRole("link", { name: asset.name, exact: true }),
			).toHaveAttribute("href", `/assets/item/${asset.id}`);
			await row.getByRole("link", { name: asset.name, exact: true }).click();
			await expect(page).toHaveURL(new RegExp(`/assets/item/${asset.id}$`));
			await expect(
				page.getByRole("heading", { name: asset.name, exact: true }),
			).toBeVisible();
			await page.goto("/tasks");
			await expectReachable(page, reminder, width);
			await expectReachable(
				page,
				row.getByRole("button", { name: labels.postpone, exact: true }),
				width,
			);
			await row
				.getByRole("button", { name: labels.postpone, exact: true })
				.click();
			await expect(reminder).toHaveValue("2026-11-01");
			await expect
				.poll(async () =>
					(await storedTasks(page, taskName))[0].dedupeKey.endsWith(
						":2026-11-01",
					),
				)
				.toBe(true);
			await page.reload();
			await expect(reminder).toHaveValue("2026-11-01");
			await reminder.fill("2026-11-30");
			await expect
				.poll(async () => (await storedTasks(page, taskName))[0].dueDate)
				.toBe("2026-11-30");
			await row
				.getByRole("button", { name: labels.postpone, exact: true })
				.click();
			await expect(reminder).toHaveValue("2026-12-01");
			await page.screenshot({
				path: join(
					evidence,
					`keepany-ordinary-task-${labels.language}-${width}.png`,
				),
				fullPage: true,
			});

			await row
				.getByRole("button", { name: labels.complete, exact: true })
				.click();
			await expect
				.poll(async () => (await storedTasks(page, taskName))[0])
				.toMatchObject({
					done: true,
					dueDate: "2026-12-01",
					completionHistory: ["2026-09-30T04:00:00.000Z"],
				});
			await expect(row).toContainText(labels.history);
			await expect(reminder).toHaveCount(0);
			await page.reload();
			await row
				.getByRole("button", { name: labels.reopen, exact: true })
				.click();
			await expect(reminder).toHaveValue("2026-12-01");
			await expect
				.poll(async () => (await storedTasks(page, taskName))[0])
				.toMatchObject({
					done: false,
					completedAt: "",
					dueDate: "2026-12-01",
					completionHistory: ["2026-09-30T04:00:00.000Z"],
				});
			await page.clock.setFixedTime(new Date("2026-09-30T04:01:00Z"));
			await row
				.getByRole("button", { name: labels.complete, exact: true })
				.click();
			await expect
				.poll(
					async () => (await storedTasks(page, taskName))[0].completionHistory,
				)
				.toEqual(["2026-09-30T04:00:00.000Z", "2026-09-30T04:01:00.000Z"]);
			await row
				.getByRole("button", { name: labels.reopen, exact: true })
				.click();
			await expect
				.poll(async () => (await storedTasks(page, taskName))[0].done)
				.toBe(false);
			await page.reload();
			await expect(reminder).toHaveValue("2026-12-01");
			await expect(row).toContainText(labels.history);

			const duplicateEditor = await addTask(
				page,
				labels,
				asset.id,
				taskName,
				"2026-12-01",
			);
			await expect(duplicateEditor.getByRole("alert")).toContainText(
				labels.duplicate,
			);
			await duplicateEditor
				.getByRole("button", { name: labels.cancel, exact: true })
				.click();
			expect(await storedTasks(page, taskName)).toHaveLength(1);
			await expect(
				await addTask(page, labels, asset.id, taskName, "2026-12-02"),
			).toBeHidden();
			await page.goto("/tasks");
			await reminder.fill("2026-12-02");
			await expect(page.locator(".toast[role='status']")).toContainText(
				labels.duplicate,
			);
			await expect(reminder).toHaveValue("2026-12-01");
			await row
				.getByRole("button", { name: labels.postpone, exact: true })
				.click();
			await expect(page.locator(".toast[role='status']")).toContainText(
				labels.duplicate,
			);
			await expect(reminder).toHaveValue("2026-12-01");
			const remaining = await storedTasks(page, taskName);
			expect(remaining).toHaveLength(2);
			expect(remaining.find((task) => task.id === taskId)).toMatchObject({
				dueDate: "2026-12-01",
				done: false,
				completionHistory: [
					"2026-09-30T04:00:00.000Z",
					"2026-09-30T04:01:00.000Z",
				],
			});
			const otherTask = remaining.find((task) => task.id !== taskId);
			if (!otherTask) throw Error("second ordinary task missing");
			const otherRow = page.locator(`#task-${otherTask.id}`);
			await otherRow
				.getByLabel(labels.remind, { exact: true })
				.fill("2026-09-01");
			await expect
				.poll(
					async () =>
						(await storedTasks(page, taskName)).find(
							(task) => task.id === otherTask.id,
						)?.dueDate,
				)
				.toBe("2026-09-01");
			await otherRow
				.getByRole("button", { name: labels.postpone, exact: true })
				.click();
			await expect(
				otherRow.getByLabel(labels.remind, { exact: true }),
			).toHaveValue("2026-10-01");

			await row.getByRole("link", { name: asset.name, exact: true }).click();
			await page
				.locator("main > .page-header")
				.getByRole("button", { name: labels.trash, exact: true })
				.click();
			await page
				.getByRole("dialog")
				.getByRole("button", { name: labels.trash, exact: true })
				.click();
			await expect(page).toHaveURL(/\/assets\/item$/);
			await page.goto("/tasks");
			await expect(row).toContainText(labels.missing);
			await expect(row.locator("a")).toHaveCount(0);
			await expect(otherRow).toContainText(labels.missing);
			await expect(otherRow.locator("a")).toHaveCount(0);
			await page.reload();
			await expect(row).toContainText(labels.missing);
			await expect(row.locator("a")).toHaveCount(0);
			await expect(reminder).toHaveValue("2026-12-01");
			expect(errors).toEqual([]);
			await expect(
				page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth + 1,
				),
			).resolves.toBe(true);
		});
	}
}

});


test.describe('F01-search — fresh 4236 shared React mobile', () => {
// Reused mobile-only steps from global-search.spec.ts.

const repositoryUrl = sourceModuleUrl("packages/local-db/src/index.ts");
const domainUrl = sourceModuleUrl("packages/domain/src/index.ts");
const results = (page: Page) => page.locator(".top-search-panel .search-results a");

async function query(page: Page, text: string) {
	if (!await page.locator("#top-search-query").isVisible()) await page.locator(".top-search-trigger").click();
	await page.locator("#top-search-query").fill(text);
}

async function focusedRow(page: Page, id: string) {
	const row = page.locator(`[id="${id}"]`);
	await expect(row).toBeVisible();
	await expect(row).toBeFocused();
	expect(await row.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return rect.top < innerHeight && rect.bottom > 0;
	})).toBe(true);
	await expect(page.locator(".top-search-panel")).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => sessionStorage.getItem("keepany-search"))).toBe("");
}

async function fixture(page: Page) {
	return page.evaluate(async ([repositoryPath, domainPath]) => {
		const { localRepository, saveBatch } = await import(repositoryPath);
		const { newAsset, taskSchema, historySchema } = await import(domainPath);
		const account = { ...newAsset("account"), name: "Search Wallet", username: "public-mail@example.test", notes: "private-asset-note" };
		const second = { ...newAsset("account"), name: "Other Wallet" };
		const camera = { ...newAsset("item"), name: "Search Camera", location: "Study → Shelf → Upper drawer", tags: ["field-tag"], url: "https://url-private-user:url-private-password@example.test/camera?query-private-token=secret#fragment-private-token" };
		const pdf = { ...newAsset("project"), id: `pdf-${"a".repeat(48)}`, name: "Imported PDF receipt", description: "private-pdf-description", longDescription: "private-pdf-long-description" };
		const deleted = { ...newAsset("project"), name: "deleted-asset-token", deleted: true };
		const projects = Array.from({ length: 16 }, (_, n) => ({ ...newAsset("project"), name: `Browse ${String(n).padStart(2, "0")} ${"VeryLongVisibleProjectTitle".repeat(3)}` }));
		const now = new Date().toISOString();
		const history = historySchema.parse({ id: crypto.randomUUID(), assetId: account.id, action: "expense", title: "Search dinner transaction", eventDate: "2026-01-01", source: "Public bank statement", amount: 1234, currency: "USD", note: "private-history-note", createdAt: now });
		const otherHistory = historySchema.parse({ ...history, id: crypto.randomUUID(), assetId: second.id, action: "refund", title: "Other refund", source: "Other bank", eventDate: "2026-10-01" });
		const fillerHistory = Array.from({ length: 12 }, (_, n) => historySchema.parse({ ...history, id: crypto.randomUUID(), title: `Other newer record ${n}`, eventDate: "2026-09-30" }));
		const task = taskSchema.parse({ id: crypto.randomUUID(), name: "Search inspect receipts", assetId: camera.id, dueDate: "2026-10-31", done: true, completedAt: now, completionHistory: [now], createdAt: now });
		const pendingTask = taskSchema.parse({ id: crypto.randomUUID(), name: "Other pending task", createdAt: now });
		const deletedTask = taskSchema.parse({ ...task, id: crypto.randomUUID(), name: "deleted-task-token", deleted: true });
		await saveBatch([
			...[account, second, camera, pdf, deleted, ...projects].map((value) => ({ type: "asset", value })),
			...[history, otherHistory, ...fillerHistory].map((value) => ({ type: "history", value })),
			...[task, pendingTask, deletedTask].map((value) => ({ type: "task", value })),
		]);
		const repository = await localRepository();
		const candidate = { id: `pdf-${"a".repeat(64)}`, fileHash: "a".repeat(64), fileName: "public-receipt-file.pdf", rowNumber: 1, source: "pdf", sourceText: "private-pdf-original", asset: pdf, status: "accepted", kindSelected: true };
		await repository.fileStore.intakeReview.put(candidate);
		return { assetId: camera.id as string, historyId: history.id as string, otherAccountId: second.id as string, candidateId: candidate.id, taskId: task.id as string };
	}, [repositoryUrl, domainUrl]);
}

for (const locale of ["en-US", "zh-CN"]) {
	for (const width of [390]) {
		test(`${locale} global search locates four sources, clears same-hash filters and bounds 15 long results at ${width}px`, async ({ browser }) => {
			const context = await browser.newContext({ locale, viewport: { width, height: 844 } });
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			try {
				await page.goto("/");
				const ids = await fixture(page);
				await page.goto("/finance");
				await query(page, "");
				await expect(results(page)).toHaveCount(15);
				await expect(results(page).first()).toContainText("Browse 00");
				await expect(results(page).last()).toContainText("Browse 14");
				await results(page).last().scrollIntoViewIfNeeded();
				const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
					elements: [...document.querySelectorAll("body *")].filter((element) => element.getBoundingClientRect().right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 5)
						.slice(0, 12).map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right, sw: element.scrollWidth, cw: element.clientWidth })),
				}));
				expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(width + 1);
				await expect(page.locator("#top-search-query")).toBeInViewport();
				await expect(page.locator(".top-search-panel-close")).toBeInViewport();
				await page.screenshot({ path: test.info().outputPath(`global-search-${locale}-${width}-15-results.png`) });
				await results(page).last().click();
				await expect(page.getByRole("heading", { name: /Browse 14/ })).toBeVisible();
				await query(page, "UPPER DRAWER");
				await expect(results(page)).toHaveCount(1);
				await results(page).click();
				await expect(page).toHaveURL(new RegExp(`/assets/item/${ids.assetId}$`));
				for (const text of ["field-tag", "PUBLIC-MAIL@", "example.test/camera", "Public bank statement", "12.34", "2026-10-31"]) {
					await query(page, text);
					await expect(results(page).first()).toBeVisible();
				}
				for (const text of ["private-asset-note", "private-history-note", "private-pdf-original", "private-pdf-description", "private-pdf-long-description", "url-private-user", "url-private-password", "query-private-token", "fragment-private-token", "deleted-asset-token", "deleted-task-token", ids.assetId, ids.historyId]) {
					await query(page, text);
					await expect(results(page)).toHaveCount(0);
				}
				await query(page, "dinner transaction");
				await results(page).click();
				await expect(page).toHaveURL(new RegExp(`/finance#finance-entry-${ids.historyId}$`));
				await focusedRow(page, `finance-entry-${ids.historyId}`);
				// Repeating the identical hash must reveal the row hidden by all three filters.
				for (let repeat = 0; repeat < 2; repeat++) {
					const filters = page.locator(".finance-filters").getByRole("combobox");
					await selectChoice(filters.nth(0), "refund");
					await selectChoice(filters.nth(1), ids.otherAccountId);
					await selectChoice(filters.nth(2), "source:Other bank");
					await selectChoice(page.locator('#finance-filter-currency'), 'JPY');
					await page.locator('#finance-filter-from').fill('2099-01-01');
					await page.locator('#finance-filter-query').fill('hide original bill');
					await expect(page.locator(`[id="finance-entry-${ids.historyId}"]`)).toHaveCount(0);
					await query(page, "dinner transaction");
					await results(page).click();
					await focusedRow(page, `finance-entry-${ids.historyId}`);
					await expect(filters.nth(0)).toHaveAttribute("data-value", "all");
					await expect(filters.nth(1)).toHaveAttribute("data-value", "");
					await expect(filters.nth(2)).toHaveAttribute("data-value", "all");
					await expect(page.locator('#finance-filter-currency')).toHaveAttribute('data-value', 'all');
					await expect(page.locator('#finance-filter-from')).toHaveValue('');
					await expect(page.locator('#finance-filter-query')).toHaveValue('');
				}
				await page.reload();
				await focusedRow(page, `finance-entry-${ids.historyId}`);
				await query(page, "public-receipt-file.pdf");
				await expect(results(page)).toHaveCount(1);
				await results(page).click();
				await focusedRow(page, `intake-review-${ids.candidateId}`);
				await query(page, "inspect receipts");
				await results(page).click();
				await focusedRow(page, `task-${ids.taskId}`);
				await page.locator(".task-filters button").nth(0).click();
				await expect(page.locator(`[id="task-${ids.taskId}"]`)).toHaveCount(0);
				await query(page, "inspect receipts");
				await results(page).click();
				await focusedRow(page, `task-${ids.taskId}`);
				// Ordinary data updates must preserve a later user filter under the old hash.
				await page.locator(".task-filters button").nth(0).click();
				await page.evaluate(async (modulePath) => {
					const { localRepository, save } = await import(modulePath);
					const repo = await localRepository();
					const task = (await repo.list("task")).find((row: { name: string }) => row.name === "Other pending task");
					await save("task", { ...task, name: "Other updated pending task" });
				}, repositoryUrl);
				await expect(page.locator(".task-filters button").nth(0)).toHaveAttribute("aria-pressed", "true");
				await expect(page.locator(`[id="task-${ids.taskId}"]`)).toHaveCount(0);
				await page.evaluate(async ({ modulePath, taskId }) => {
					const { localRepository, save } = await import(modulePath);
					const task = await (await localRepository()).get("task", taskId);
					await save("task", { ...task, deleted: true });
				}, { modulePath: repositoryUrl, taskId: ids.taskId });
				await expect(page.locator(".task-filters button").nth(0)).toHaveAttribute("aria-pressed", "true");
				await query(page, "inspect receipts");
				await expect(results(page)).toHaveCount(0);
				await page.goto("/tasks#task-%E0%A4%A");
				await expect(page.locator(".task-filters")).toBeVisible();
				await page.goto("/tasks#task-missing-target");
				await expect(page.locator(".task-filters")).toBeVisible();
				expect(errors).toEqual([]);
			} finally { if (!page.isClosed()) await page.screenshot({ path: test.info().outputPath("mobile-end.png"), fullPage: true }); await context.close(); }
		});
	}
}


});


test.describe('F01-scroll — fresh 4236 shared React mobile', () => {
// Reused mobile-only steps from list-scroll-return.spec.ts.

const mode = process.env.KEEPANY_SCROLL_MODE ?? "dev";

for (const width of [390]) {
	test(`${mode} ${width}px restores the actual long-list scroll after detail and graph navigation`, async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		mkdirSync(evidence, { recursive: true });
		const context = await browser.newContext({
			viewport: { width, height: 844 },
			locale: "en-US",
		});
		const page = await context.newPage();
		page.setDefaultTimeout(15_000);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const suffix = crypto.randomUUID().slice(0, 6);
		const project = `Scroll graph ${suffix}`;
		let target = "";
		const csv = [
			"name,kind,category",
			`${project},project,website`,
			...Array.from(
				{ length: 70 },
				(_, index) =>
					`Scroll account ${String(index + 1).padStart(2, "0")} ${suffix},account,email`,
			),
		].join("\n");
		const readY = () => page.evaluate(() => window.scrollY);
		async function expectReturnedScroll(expected: number, path?: string) {
			await expect(page).toHaveURL(/\/assets\/account$/);
			await expect(page.locator(".list-row")).toHaveCount(70);
			await expect(
				page.getByRole("button", { name: "Email", exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await expect.poll(readY).toBeGreaterThan(1000);
			const actual = await readY();
			expect(Math.abs(actual - expected)).toBeLessThan(35);
			const visible = await page
				.locator(".list-row")
				.filter({ hasText: target })
				.evaluate((element) => {
					const rect = element.getBoundingClientRect();
					return rect.top >= 0 && rect.bottom <= window.innerHeight;
				});
			expect(visible).toBe(true);
			await expect(page.locator(".toast")).toHaveCount(0);
			if (path) await page.screenshot({ path, fullPage: false });
			return actual;
		}
		try {
			await page.goto("/intake");
			await page.locator(".intake-mode-tabs").getByRole("button", { name: "Spreadsheet", exact: true }).click();
			await page
				.locator("#csv-file")
				.setInputFiles({
					name: "scroll-fixture.csv",
					mimeType: "text/csv",
					buffer: Buffer.from(csv),
				});
			const reviews = page.locator(".intake-review-row");
			await expect(reviews).toHaveCount(71);
			for (let index = 0; index < 71; index++) {
				await reviews.nth(index).getByRole("button", { name: "Confirm and save", exact: true }).click();
				await expect(reviews.nth(index)).toContainText("Confirmed");
			}
			await page.goto("/assets/account");
			await page.getByRole("button", { name: "Email", exact: true }).click();
			await expect(page.locator(".list-row")).toHaveCount(70);
			const targetRow = page.locator(".list-row").nth(50);
			target = await targetRow.locator("strong").innerText();
			await targetRow.evaluate((element) =>
				element.scrollIntoView({ block: "center" }),
			);
			await expect.poll(readY).toBeGreaterThan(1000);
			const before = await readY();
			await targetRow.click();
			await expect(page.getByRole("heading", { name: target })).toBeVisible();
			const stored = await page.evaluate(() =>
				Number(sessionStorage.getItem("keepany-scroll-account")),
			);
			expect(Math.abs(stored - before)).toBeLessThan(35);
			await page.getByRole("banner").getByRole("link", { name: "Back to list" }).click();
			const direct = await expectReturnedScroll(
				stored,
				`${evidence}/scroll-return-${mode}-${width}-direct.png`,
			);
			await page.reload();
			const refreshed = await expectReturnedScroll(stored);
			await page.locator(".list-row").filter({ hasText: target }).click();
			await page.locator(".top-search-trigger").click();
			await page.locator("#top-search-query").fill(`absent-${suffix}`);
			await expect(page.locator(".top-search-panel")).toContainText("None");
			await expect(page.locator(".top-search-panel a")).toHaveCount(0);
			await page.locator("#top-search-query").press("Escape");
			await expect(page.locator(".top-search-panel")).toHaveCount(0);
			await page.getByRole("banner").getByRole("link", { name: "Back to list" }).click();
			await expectReturnedScroll(stored);
			await page.goto("/assets/project");
			await page.getByText(project, { exact: true }).first().click();
			await page.getByRole("button", { name: "Add connection" }).click();
			const dialog = page.getByRole("dialog");
			await selectChoice(dialog.getByLabel("Connect to"), { label: target });
			await dialog.getByLabel("Connection label").fill("owner");
			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(dialog).toBeHidden();
			await page.getByRole('button', { name: 'Expand graph', exact: true }).click();
			const fit = page.getByRole('button', { name: 'Fit all', exact: true });
			if (await fit.isVisible()) await fit.click();
			await page
				.locator(".react-flow__node")
				.filter({ hasText: target })
				.getByRole('link')
				.click();
			await page.getByRole('button', { name: 'Exit expanded view', exact: true }).click();
			await expect(page.getByRole("heading", { name: target })).toBeVisible();
			await page.getByRole("banner").getByRole("link", { name: "Back to list" }).click();
			await expect(page).toHaveURL(/\/assets\/project$/);
			await expect(page.getByText(project, { exact: true }).first()).toBeVisible();
			await page.goto("/assets/account");
			const graph = await expectReturnedScroll(stored);
			console.log(
				JSON.stringify({
					mode,
					width,
					before,
					stored,
					direct,
					refreshed,
					graph,
				}),
			);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
}

});


test.describe('F01-category-errors — fresh 4236 shared React mobile', () => {
// Reused mobile-only steps from custom-category-edit.spec.ts.

const repositoryPath = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/local-db/src/index.ts`;
const domainPath = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/domain/src/index.ts`;
type Kind = "project" | "account";
const copy = (locale: string) =>
	locale === "zh-CN"
		? {
				category: "分类",
				name: "分类名称",
				add: "新增分类",
				manage: "管理",
				save: "保存分类",
				collapse: "收起",
				remove: "移除",
				edit: "编辑",
				restore: "恢复",
				backup: "创建备份",
				download: "保存备份文件",
				preview: "预览",
				confirm: /确认 ·/,
				restored: /已恢复 \d+ 条记录/,
				duplicate: "该分类已存在。",
				stale: "资料已变化，请收起后重新编辑。",
			}
		: {
				category: "Category",
				name: "Category name",
				add: "New category",
				manage: "Manage",
				save: "Save collection",
				collapse: "Collapse",
				remove: "Remove",
				edit: "Edit",
				restore: "Restore",
				backup: "Create backup",
				download: "Save backup file",
				preview: "Preview",
				confirm: /Confirm ·/,
				restored: /Restored \d+ records/,
				duplicate: "This category already exists.",
				stale: "Records changed. Close this editor and open it again.",
			};

async function fixture(page: Page, kind: Kind, category: string) {
	return page.evaluate(
		async ({ repositoryPath, domainPath, kind, category }) => {
			const { newAsset } = await import(domainPath);
			const { saveBatch } = await import(repositoryPath);
			const assets = ["Keep", "Remove", "Add", "Recover"].map(
				(role, index) => ({
					...newAsset(kind),
					name: `${kind} ${role}`,
					category: index === 3 ? category : "",
					deleted: index === 3,
				}),
			);
			await saveBatch(
				assets.map((value) => ({ type: "asset" as const, value })),
			);
			return assets.map((asset) => asset.id) as string[];
		},
		{ repositoryPath, domainPath, kind, category },
	);
}
async function state(page: Page, kind: Kind) {
	return page.evaluate(
		async ({ repositoryPath, kind }) => {
			const { localRepository } = await import(repositoryPath);
			const repository = await localRepository();
			return {
				categories: (
					(await repository.list("category", true)) as Category[]
				).filter((category) => category.kind === kind),
				assets: ((await repository.list("asset", true)) as Asset[]).filter(
					(asset) => asset.kind === kind,
				),
			};
		},
		{ repositoryPath, kind },
	);
}
async function createCategoryUi(
	page: Page,
	locale: string,
	name: string,
	members: string[] = [],
) {
	const text = copy(locale);
	await page.getByRole("button", { name: text.add, exact: true }).click();
	const editor = page.getByRole("region", { name: text.category, exact: true });
	await editor.getByLabel(text.name, { exact: true }).fill(name);
	for (const member of members)
		await editor.getByRole("checkbox", { name: member, exact: true }).check();
	await editor.getByRole("button", { name: text.save, exact: true }).click();
	await expect(editor).toBeHidden();
}
for (const locale of ["en", "zh-CN"] as const) {
	test(`${locale} category editor rejects duplicate names and stale opening snapshots`, async ({
		page,
	}) => {
		const text = copy(locale);
		await page.goto("/");
		await page.evaluate(
			(language) => localStorage.setItem("keepany-language", language),
			locale,
		);
		await page.goto("/assets/project");
		const ids = await fixture(page, "project", "Original");
		await createCategoryUi(page, locale, "Original", ["project Keep"]);
		await createCategoryUi(page, locale, "Existing");
		await page.getByRole("button", { name: text.add, exact: true }).click();
		const creation = page.getByRole("region", {
			name: text.category,
			exact: true,
		});
		await creation.getByLabel(text.name).fill(locale === "en" ? "全部" : "All");
		await creation
			.getByRole("button", { name: text.save, exact: true })
			.click();
		await expect(creation.getByRole("alert")).toHaveText(text.duplicate);
		await creation
			.getByRole("button", { name: text.collapse, exact: true })
			.click();
		await page
			.locator(".asset-category-scroll")
			.getByRole("button", { name: "Original", exact: true })
			.click();
		await page.getByRole("button", { name: text.manage, exact: true }).click();
		const editor = page.getByRole("region", {
			name: text.category,
			exact: true,
		});
		await editor.getByLabel(text.name).fill("  EXISTING  ");
		await editor.getByRole("button", { name: text.save, exact: true }).click();
		await expect(editor.getByRole("alert")).toHaveText(text.duplicate);
		await editor.getByLabel(text.name).fill("Edited");
		await page.evaluate(
			async ({ repositoryPath, id }) => {
				const { localRepository } = await import(repositoryPath);
				const repository = await localRepository();
				const asset = (await repository.get("asset", id)) as Asset;
				await repository.saveAssetIfCurrent(asset, {
					...asset,
					description: "newer description",
					updatedAt: new Date().toISOString(),
				});
			},
			{ repositoryPath, id: ids[0] },
		);
		await editor.getByRole("button", { name: text.save, exact: true }).click();
		await expect(editor.getByRole("alert")).toHaveText(text.stale);
		const saved = await state(page, "project");
		expect(saved.categories.map((category) => category.name).sort()).toEqual([
			"Existing",
			"Original",
		]);
		expect(saved.assets.find((asset) => asset.id === ids[0])).toMatchObject({
			category: "Original",
			description: "newer description",
		});
		await editor
			.getByRole("button", { name: text.collapse, exact: true })
			.click();
		await page.getByRole("button", { name: text.manage, exact: true }).click();
		await editor.getByLabel(text.name).fill("Edited");
		await editor.getByRole("button", { name: text.save, exact: true }).click();
		await expect(editor).toBeHidden();
		expect(
			(await state(page, "project")).categories.find(
				(category) => category.name === "Edited",
			),
		).toBeDefined();
		await page.getByRole("button", { name: text.manage, exact: true }).click();
		await page.evaluate(async (repositoryPath) => {
			const { localRepository } = await import(repositoryPath);
			const repository = await localRepository();
			const expectedCategory = (
				(await repository.list("category")) as Category[]
			).find((category) => category.name === "Edited");
			if (!expectedCategory) throw Error("fixture category missing");
			const expectedAssets = (
				(await repository.list("asset", true)) as Asset[]
			).filter((asset) => asset.kind === "project");
			await repository.editCustomCategory({
				expectedCategory,
				expectedAssets,
				name: "Newer",
				memberIds: expectedAssets
					.filter((asset) => !asset.deleted && asset.category === "Edited")
					.map((asset) => asset.id),
				reservedNames: ["website", "repository", "tool"],
			});
		}, repositoryPath);
		// A stale Edit action cannot turn a renamed category into a new or dangling category.
		await editor
			.locator(".list-row")
			.filter({ hasText: "Edited" })
			.getByRole("button", { name: text.edit, exact: true })
			.click();
		await expect(editor.getByRole("alert")).toHaveText(text.stale);
		await expect(editor.getByLabel(text.name)).toHaveValue("Edited");
		// A stale removal must reject before clearing members or tombstoning the renamed category.
		await editor
			.locator(".list-row")
			.filter({ hasText: "Edited" })
			.getByRole("button", { name: text.remove, exact: true })
			.click();
		await expect(editor.getByRole("alert")).toHaveText(text.stale);
		const newer = await state(page, "project");
		expect(
			newer.categories.find((category) => category.name === "Newer")?.deleted,
		).toBe(false);
		expect(newer.assets.find((asset) => asset.id === ids[0])?.category).toBe(
			"Newer",
		);
		// Five-tab navigation must discard the old kind's category draft.
		await page.locator('.mobile-tabbar').getByRole('link', { name: locale === 'en' ? 'Accounts' : '账号', exact: true }).click();
		await expect(editor).toBeHidden();
		await page.locator('.mobile-tabbar').getByRole('link', { name: locale === 'en' ? 'Assets' : '资产', exact: true }).click();
		await page.locator('.workspace-navigation a[href="/assets/project"]').click();
		await page.getByRole("button", { name: text.manage, exact: true }).click();
		await editor
			.locator(".list-row")
			.filter({ hasText: "Newer" })
			.getByRole("button", { name: text.remove, exact: true })
			.click();
		await expect(editor).toBeHidden();
		const removed = await state(page, "project");
		expect(
			removed.categories.find((category) => category.name === "Newer")?.deleted,
		).toBe(true);
		expect(removed.assets.find((asset) => asset.id === ids[0])?.category).toBe(
			"",
		);
		expect(removed.assets.find((asset) => asset.id === ids[3])).toMatchObject({
			deleted: true,
			category: "",
		});
	});
}


});


test.describe('F11-image-errors — fresh 4236 shared React mobile', () => {
// Reused mobile-only steps from detail-image-dialog.spec.ts.

const repositoryModuleUrl = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/local-db/src/index.ts`;

async function openMaterials(page: Page) {
	const section = page.locator("#asset-project-materials");
	await expect(section).toBeVisible();
	if (await section.getAttribute("open") === null) await section.locator(":scope > summary").click();
	await expect(section).toHaveAttribute("open", "");
}

async function imageState(page: Page) {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		const assets = (await repository.allRecords())
			.filter((record: { type: string }) => record.type === "asset")
			.map((record: { payload: string }) => JSON.parse(record.payload));
		return {
			attachments: assets[0]?.attachments ?? [],
			files: await repository.fileStore.blobs.count(),
		};
	}, repositoryModuleUrl);
}

async function png(page: Page, color: string) {
	const base64 = await page.evaluate((fill) => {
		const canvas = document.createElement("canvas");
		canvas.width = 8;
		canvas.height = 8;
		const context = canvas.getContext("2d");
		if (!context) throw Error("Canvas unavailable");
		context.fillStyle = fill;
		context.fillRect(0, 0, 8, 8);
		return canvas.toDataURL("image/png").split(",")[1];
	}, color);
	return Buffer.from(base64, "base64");
}

for (const language of ["en", "zh-CN"] as const) {
	for (const width of [390]) {
		test(`${language} image preview and confirmation at ${width}px`, async ({
			browser,
		}, testInfo) => {
			mkdirSync(evidence, { recursive: true });
			const labels =
				language === "en"
					? {
							add: "Add",
							name: "Name",
							save: "Save",
							addImage: "Add image",
							replace: "Replace image",
							cancel: "Cancel",
							confirm: "Confirm",
							error: "Choose a JPEG, PNG, WebP or GIF up to 20 MB.",
						}
					: {
							add: "新增",
							name: "名称",
							save: "保存",
							addImage: "添加图片",
							replace: "替换图片",
							cancel: "取消",
							confirm: "确认",
							error: "请选择不超过 20 MB 的 JPEG、PNG、WebP 或 GIF。",
						};
			const context = await browser.newContext({
				viewport: { width, height: 844 },
			});
			await context.addInitScript(
				(value) => localStorage.setItem("keepany-language", value),
				language,
			);
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const name = `Photo dialog ${crypto.randomUUID().slice(0, 8)}`;
			const longName = `${"L".repeat(240)}.png`;
			try {
				await page.goto("/assets/project");
				await page
					.getByRole("button", { name: labels.add, exact: true })
					.click();
				const editor = page.getByRole("dialog");
				await editor.getByLabel(labels.name, { exact: true }).fill(name);
				await editor
					.getByRole("button", { name: labels.save, exact: true })
					.click();
				await expect(editor).toBeHidden();
				await page.getByText(name).first().click();
				await expect(page.getByRole("heading", { name })).toBeVisible();
			await openMaterials(page);
				const first = await png(page, "#4a82de");
				const images = page.locator(".asset-attachments-card");
				const addImage = images.getByRole("button", { name: labels.addImage, exact: true });
				const firstChooser = page.waitForEvent("filechooser");
				await addImage.click();
				await (await firstChooser).setFiles({
					name: longName,
					mimeType: "image/png",
					buffer: first,
				});
				const dialog = page.getByRole("dialog");
				await expect(
					dialog.getByRole("img", { name: longName }),
				).toHaveJSProperty("naturalWidth", 8);
				await expect(
					dialog.getByRole("button", { name: labels.confirm }),
				).toBeEnabled();
				await expect(dialog.getByText(longName)).toBeVisible();
				expect(
					await dialog.evaluate((element) =>
						element.contains(document.activeElement),
					),
				).toBe(true);
				await dialog.getByRole("button", { name: labels.confirm }).focus();
				for (let i = 0; i < 5; i += 1) {
					await page.keyboard.press("Tab");
					expect(
						await dialog.evaluate((element) =>
							element.contains(document.activeElement),
						),
					).toBe(true);
				}
				const filenameFits = await dialog
					.getByText(longName)
					.evaluate((element) => element.scrollWidth <= element.clientWidth);
				expect(filenameFits).toBe(true);
				expect(
					await dialog.evaluate(
						(element) => element.scrollWidth <= element.clientWidth,
					),
				).toBe(true);
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				const screenshot = await page.screenshot({
					path: `${evidence}/detail-image-${language}-${width}-preview.png`,
				});
				await testInfo.attach(`${language}-${width}-image-preview`, {
					body: screenshot,
					contentType: "image/png",
				});
				await page.keyboard.press("Escape");
				await expect(dialog).toBeHidden();
				await expect(addImage).toBeFocused();
				expect(await imageState(page)).toEqual({ attachments: [], files: 0 });
				const brokenChooser = page.waitForEvent("filechooser");
				await addImage.click();
				await (await brokenChooser).setFiles({
					name: "broken.png",
					mimeType: "image/png",
					buffer: Buffer.from("not a png"),
				});
				await expect(dialog.getByRole("alert")).toHaveText(labels.error);
				await expect(
					dialog.getByRole("button", { name: labels.confirm }),
				).toBeDisabled();
				await dialog.getByRole("button", { name: labels.cancel }).click();
				await expect(dialog).toBeHidden();
				await expect(addImage).toBeFocused();
				expect(await imageState(page)).toEqual({ attachments: [], files: 0 });
				await images.getByLabel(labels.addImage, { exact: true }).setInputFiles({
					name: "valid.png",
					mimeType: "image/png",
					buffer: first,
				});
				await expect(
					dialog.getByRole("button", { name: labels.confirm }),
				).toBeEnabled();
				await dialog.getByRole("button", { name: labels.confirm }).click();
				await expect(dialog).toBeHidden();
				await expect(page.locator(".asset-image")).toHaveCount(1);
				await expect.poll(async () => (await imageState(page)).files).toBe(1);
				const saved = await imageState(page);
				expect(saved.attachments).toHaveLength(1);
				const replaceImage = images.getByRole("button", { name: labels.replace, exact: true });
				const chooser = page.waitForEvent("filechooser");
				await replaceImage.click();
				await (await chooser).setFiles({
					name: "new.png",
					mimeType: "image/png",
					buffer: await png(page, "#f57143"),
				});
				await expect(
					dialog.getByRole("button", { name: labels.confirm }),
				).toBeEnabled();
				await dialog.getByRole("button", { name: labels.cancel }).click();
				await expect(dialog).toBeHidden();
				await expect(replaceImage).toBeFocused();
				expect(await imageState(page)).toEqual(saved);
				await page.reload();
			await openMaterials(page);
				await expect(page.locator(".asset-image")).toHaveCount(1);
				expect(await imageState(page)).toEqual(saved);
				const secondChooser = page.waitForEvent("filechooser");
				await replaceImage.click();
				await (await secondChooser).setFiles({
					name: "new.png",
					mimeType: "image/png",
					buffer: await png(page, "#f57143"),
				});
				await expect(
					dialog.getByRole("button", { name: labels.confirm }),
				).toBeEnabled();
				await dialog.getByRole("button", { name: labels.confirm }).click();
				await expect(dialog).toBeHidden();
				await expect
					.poll(async () => (await imageState(page)).attachments[0])
					.not.toBe(saved.attachments[0]);
				const replaced = await imageState(page);
				expect(replaced.attachments).toHaveLength(1);
				expect(replaced.files).toBe(1);
				await page.reload();
			await openMaterials(page);
				await expect(page.locator(".asset-image")).toHaveCount(1);
				expect(await imageState(page)).toEqual(replaced);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}


});


test.describe('F12-shared-bill-errors — fresh 4236 shared React mobile', () => {
// Reused steps from qa-t14-completion.spec.ts; fresh isolated data and mobile viewport.

const repo = sourceModuleUrl('packages/local-db/src/index.ts');
const domain = sourceModuleUrl('packages/domain/src/index.ts');
const review = sourceModuleUrl('packages/local-db/src/intake-review.ts');
const portable = process.env.KEEPANY_T14_PORTABLE === '1';
const fixtureDirectory = resolve(evidence, 'shared-bill-fixture');
const password = 'Synthetic-T14-only-backup';
mkdirSync(fixtureDirectory, { recursive: true }); mkdirSync(evidence, { recursive: true });
type Fixture = { project: Asset; item: Asset; account: Asset; subscription: Asset; renewed: Asset; renewal: History; dollar: History; yen: History; pdfNameId: string; pdfDescriptionId: string };
let fixture: Fixture;
const copy = (zh: boolean) => ({
  add: zh ? '记一笔' : 'Record transaction', title: zh ? '名称' : 'Title', amount: zh ? '金额' : 'Amount',
  asset: zh ? '关联资产' : 'Related asset', date: zh ? '日期' : 'Date', currency: zh ? '币种' : 'Currency', note: zh ? '备注' : 'Note',
  source: zh ? '付款来源（选填）' : 'Payment source (optional)', save: zh ? '保存记录' : 'Save record', cancel: zh ? '取消' : 'Cancel',
  edit: zh ? '编辑' : 'Edit', editDialog: zh ? '编辑账单' : 'Edit transaction', remove: zh ? '删除' : 'Delete',
  deleteDialog: zh ? '删除账单' : 'Delete transaction', backup: zh ? '创建备份' : 'Create backup',
  download: zh ? '保存备份文件' : 'Save backup file', preview: zh ? '预览' : 'Preview',
  confirm: zh ? /^确认 ·/ : /^Confirm ·/, restored: zh ? /已恢复 \d+ 条记录/ : /Restored \d+ records/,
});

async function downloadArchive(page: Page, zh = false) {
  const c = copy(zh); await page.goto('/intake');
  await page.locator('#backup-password').fill(password);
  await page.getByRole('button', { name: c.backup, exact: true }).click();
  const link = page.getByRole('link', { name: c.download, exact: true }); await expect(link).toBeVisible();
  const pending = page.waitForEvent('download'); await link.click(); const download = await pending;
  const path = await download.path(); if (!path) throw Error('missing-backup-download');
  const files = unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)), password));
  const rows = JSON.parse(strFromU8(files['records.json'])) as { type: string; payload: string }[];
  return { download, assets: rows.filter(row => row.type === 'asset').map(row => JSON.parse(row.payload) as Asset),
    history: rows.filter(row => row.type === 'history').map(row => JSON.parse(row.payload) as History) };
}

async function restoreFixture(page: Page, zh: boolean, path = resolve(fixtureDirectory, 'fixture.ka1')) {
  const c = copy(zh); await page.goto('/intake'); await page.locator('#backup-password').fill(password);
  await page.locator('#restore-file').setInputFiles(path); await page.getByRole('button', { name: c.preview, exact: true }).first().click();
  await page.getByRole('button', { name: c.confirm }).click(); await expect(page.getByText(c.restored)).toBeVisible();
}

async function searchBill(page: Page, query: string, id: string, visible = true) {
  await page.locator('.top-search-trigger').click(); await page.locator('#top-search-query').fill(query);
  const billLink = page.locator(`.top-search-panel .search-results a[href="/finance#finance-entry-${id}"]`);
  await expect(billLink).toHaveCount(visible ? 1 : 0);
  if (visible) { await billLink.click(); await expect(page.locator(`#finance-entry-${id}`)).toBeFocused(); }
  else await page.keyboard.press('Escape');
}

test.beforeAll(async ({ browser }) => {
  if (portable) { fixture = JSON.parse(readFileSync(resolve(fixtureDirectory, 'fixture.json'), 'utf8')); return; }
  const context = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
  await context.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  const page = await context.newPage();
  try {
    await page.goto('/finance');
    fixture = await page.evaluate(async ({ repo, domain, review }) => {
      const { localRepository } = await import(repo), { newAsset, historySchema } = await import(domain);
      const { reviewedCandidateSchema, stageReviewedCandidates } = await import(review);
      const db = await localRepository();
      const project = { ...newAsset('project'), name: 'T14 Project owner', description: 'T14 ordinary original description', longDescription: 'T14 ordinary unselected long description' }, item = { ...newAsset('item'), name: 'T14 Equipment owner' };
      const account = { ...newAsset('account'), name: 'T14 Account owner' }, subscription = { ...newAsset('subscription'), name: 'T14 Subscription source',
        dueDate: '2026-10-27', billingAnchor: '2026-10-27', amount: 500, currency: 'CNY' };
      await db.saveBatch([project,item,account,subscription].map(value => ({ type: 'asset', value })));
      const renewal = historySchema.parse({ id: crypto.randomUUID(), assetId: subscription.id, action: 'renew', note: 'Preserved renewal fact',
        amount: 500, currency: 'CNY', billDate: '2026-10-27', createdAt: '2026-10-27T00:00:00.000Z' });
      const renewed = { ...subscription, dueDate: '2026-11-27', renewalCount: 1, lastRenewalId: renewal.id, updatedAt: '2026-10-27T00:00:01.000Z' };
      await db.recordRenewal(subscription, renewed, renewal);
      const dollar = historySchema.parse({ id: crypto.randomUUID(), assetId: account.id, action: 'expense', title: 'T14 USD reference', note: '',
        amount: 1200, currency: 'USD', eventDate: '2026-10-27', createdAt: '2026-10-27T00:00:00.000Z' });
      const yen = historySchema.parse({ ...dollar, id: crypto.randomUUID(), assetId: item.id, title: 'T14 JPY reference', amount: 300, currency: 'JPY' });
      await db.createFinanceEntry(dollar); await db.createFinanceEntry(yen);
      const pdfs = ['a','b'].map((char,index) => reviewedCandidateSchema.parse({ id: `pdf-${char.repeat(64)}`, fileHash: char.repeat(64),
        fileName: `T14-${index ? 'description' : 'name'}-review.pdf`, rowNumber: 1, source: 'pdf', sourceText: 'T14 synthetic raw PDF source marker', kindSelected: true,
        status: 'pending', asset: { ...newAsset('project'), id: `pdf-${char.repeat(48)}`, name: index ? 'T14 description-only proposal' : 'T14 renamed project',
          description: 'T14 merged PDF description marker' } }));
      for (const row of pdfs) await stageReviewedCandidates(db.fileStore, [row]);
      return { project,item,account,subscription,renewed,renewal,dollar,yen,pdfNameId: pdfs[0].id,pdfDescriptionId: pdfs[1].id };
    }, { repo, domain, review });
    const archive = await downloadArchive(page); await archive.download.saveAs(resolve(fixtureDirectory, 'fixture.ka1'));
    writeFileSync(resolve(fixtureDirectory, 'fixture.json'), JSON.stringify(fixture, null, 2));
  } finally { await context.close(); }
});

for (const locale of ['zh-CN','en-US'] as const) for (const width of [390]) {
  test(`${locale} ${width} T14-01..04 shared bill editing deletion renewal preservation and backup`, async ({ browser }) => {
    test.setTimeout(150_000);
    const zh = locale === 'zh-CN', c = copy(zh), errors: string[] = [];
    const context = await browser.newContext({ locale, timezoneId: 'Asia/Shanghai', viewport: { width, height: 900 }, acceptDownloads: true });
    await context.addInitScript(value => localStorage.setItem('keepany-language', value), zh ? 'zh-CN' : 'en');
    const page = await context.newPage(); page.setDefaultTimeout(15_000); page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-27T04:00:00.000Z'));
    try {
      await restoreFixture(page, zh); await page.goto('/finance');
      const rows = page.locator('.finance-entry'); await expect(rows).toHaveCount(3);
      await page.getByRole('button', { name: c.add, exact: true }).click();
      let form = page.getByRole('dialog', { name: c.add, exact: true });
      await selectChoice(form.getByLabel(c.asset, { exact: true }), fixture.project.id);
      await form.getByRole('checkbox', { name: fixture.item.name, exact: true }).check();
      await form.getByLabel(c.title, { exact: true }).fill('T14 Shared project equipment invoice');
      await form.getByLabel(c.amount, { exact: true }).fill('1.234');
      await form.getByLabel(c.date, { exact: true }).fill('2026-10-27');
      await form.getByLabel(c.source, { exact: true }).fill('T14 synthetic statement');
      await form.getByRole('button', { name: c.save, exact: true }).click();
      await expect(form.getByRole('alert')).toContainText(zh ? '有效金额' : 'valid amount');
      await form.getByLabel(c.amount, { exact: true }).fill('12.34');
      await form.getByRole('button', { name: c.save, exact: true }).dblclick(); await expect(form).toBeHidden();
      const shared = rows.filter({ hasText: 'T14 Shared project equipment invoice' }); await expect(shared).toHaveCount(1);
      const sharedRowId = await shared.getAttribute('id'); if (!sharedRowId) throw Error('missing-bill-id');
      const sharedId = sharedRowId.slice('finance-entry-'.length);
      await expect(shared).toContainText(fixture.project.name); await expect(shared).toContainText(fixture.item.name);
      await expect(page.locator('.finance-summary > .card').nth(1)).toContainText('17.34');
      await expect(page.locator('.finance-summary > .card').nth(1)).toContainText('12.00');
      await expect(page.locator('.finance-summary > .card').nth(1)).toContainText('300');
      for (const owner of [fixture.project, fixture.item]) { await page.goto(`/assets/${owner.kind}/${owner.id}`);
        await expect(page.locator(`.asset-finance-card [data-bill-id="${sharedId}"]`)).toContainText('12.34'); }
      await page.goto('/finance');
      for (const owner of [fixture.project,fixture.item]) await searchBill(page, owner.name, sharedId);

      // Review a failed edit and cancel; neither the amount nor ownership changes.
      await shared.getByRole('button', { name: c.edit, exact: true }).click(); form = page.getByRole('dialog', { name: c.editDialog, exact: true });
      await form.getByLabel(c.amount, { exact: true }).fill('-2'); await form.getByRole('button', { name: c.save, exact: true }).click();
      await expect(form.getByRole('alert')).toBeVisible(); await form.getByRole('button', { name: c.cancel, exact: true }).click();
      await expect(shared).toContainText('12.34');
      await shared.getByRole('button', { name: c.edit, exact: true }).click(); form = page.getByRole('dialog', { name: c.editDialog, exact: true });
      await form.getByLabel(c.amount, { exact: true }).fill('45.67'); await form.getByLabel(c.date, { exact: true }).fill('2026-10-26');
      await form.getByLabel(c.note, { exact: true }).fill('  Evidence kept exactly\nsecond line  ');
      await form.getByRole('button', { name: c.save, exact: true }).click(); await expect(form).toBeHidden(); await page.reload();
      await expect(shared).toContainText('45.67');
      await shared.getByRole('button', { name: c.edit, exact: true }).click(); form = page.getByRole('dialog', { name: c.editDialog, exact: true });
      await expect(form.getByLabel(c.date, { exact: true })).toHaveValue('2026-10-26');
      await selectChoice(form.getByLabel(c.asset, { exact: true }), fixture.item.id);
      await form.getByRole('checkbox', { name: fixture.project.name, exact: true }).uncheck();
      await form.getByRole('button', { name: c.save, exact: true }).click(); await expect(form).toBeHidden(); await page.reload();
      await expect(shared).toContainText(fixture.item.name); await expect(shared).not.toContainText(fixture.project.name);
      await expect(page.locator('.finance-summary > .card').nth(1)).toContainText('50.67');
      await page.goto(`/assets/project/${fixture.project.id}`); await expect(page.locator(`[data-bill-id="${sharedId}"]`)).toHaveCount(0);
      await page.goto(`/assets/item/${fixture.item.id}`); await expect(page.locator(`.asset-finance-card [data-bill-id="${sharedId}"]`)).toContainText('45.67');
      await page.goto('/finance');

      // Correct renewal accounting separately and remove its original source from financial ownership.
      const renewal = page.locator(`#finance-entry-${fixture.renewal.id}`);
      await renewal.getByRole('button', { name: c.edit, exact: true }).click(); form = page.getByRole('dialog', { name: c.editDialog, exact: true });
      await form.getByLabel(c.amount, { exact: true }).fill('7.89'); await form.getByLabel(c.date, { exact: true }).fill('2026-10-25');
      await selectChoice(form.getByLabel(c.asset, { exact: true }), fixture.project.id);
      await form.getByRole('checkbox', { name: fixture.subscription.name, exact: true }).uncheck();
      await form.getByRole('button', { name: c.save, exact: true }).click(); await expect(form).toBeHidden(); await page.reload();
      await expect(renewal).toContainText('7.89'); await expect(renewal).toContainText(fixture.project.name);
      await expect(renewal).not.toContainText(fixture.subscription.name);
      await searchBill(page, '7.89', fixture.renewal.id);
      if ((zh && width === 390) || (!zh && width === 390)) {
        await page.locator('.finance-columns').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${evidence}/T14-${portable ? 'portable' : 'source'}-${locale}-${width}.png` });
        await shared.getByRole('button', { name: c.edit, exact: true }).click();
        const reviewDialog = page.getByRole('dialog', { name: c.editDialog, exact: true });
        await reviewDialog.screenshot({ path: `${evidence}/T14-${portable ? 'portable' : 'source'}-editor-${locale}-${width}.png` });
        await reviewDialog.getByRole('button', { name: c.cancel, exact: true }).click();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      const beforeDelete = await downloadArchive(page, zh);
      const bill = beforeDelete.history.find(entry => entry.title === 'T14 Shared project equipment invoice'); if (!bill) throw Error('missing-shared-bill');
      expect(bill).toMatchObject({ assetId: fixture.item.id, assetIds: [fixture.item.id], amount: 4567, eventDate: '2026-10-26', note: '  Evidence kept exactly\nsecond line  ' });
      const correctedRenewal = beforeDelete.history.find(entry => entry.id === fixture.renewal.id);
      expect(correctedRenewal).toMatchObject(fixture.renewal);
      expect(correctedRenewal?.financeCorrection).toMatchObject({ amount: 789, eventDate: '2026-10-25', assetIds: [fixture.project.id], hidden: false });
      expect(beforeDelete.assets.find(asset => asset.id === fixture.subscription.id)).toEqual(fixture.renewed);
      await page.goto('/finance');
      await shared.getByRole('button', { name: c.remove, exact: true }).click();
      let confirmation = page.getByRole('dialog', { name: c.deleteDialog, exact: true }); await confirmation.getByRole('button', { name: c.cancel, exact: true }).click();
      await expect(shared).toHaveCount(1); await shared.getByRole('button', { name: c.remove, exact: true }).click();
      confirmation = page.getByRole('dialog', { name: c.deleteDialog, exact: true }); await confirmation.getByRole('button', { name: c.remove, exact: true }).click();
      await expect(confirmation).toBeHidden(); await expect(shared).toHaveCount(0);
      await renewal.getByRole('button', { name: c.remove, exact: true }).click(); confirmation = page.getByRole('dialog', { name: c.deleteDialog, exact: true });
      await expect(confirmation).toContainText(zh ? '不会撤销续费' : 'keeps the renewal record');
      await confirmation.getByRole('button', { name: c.remove, exact: true }).click(); await expect(confirmation).toBeHidden(); await page.reload();
      await expect(rows).toHaveCount(2); await expect(rows.filter({ hasText: 'T14 USD reference' })).toHaveCount(1);
      await expect(rows.filter({ hasText: 'T14 JPY reference' })).toHaveCount(1);
      await searchBill(page, 'T14 Shared project equipment invoice', sharedId, false);
      await searchBill(page, '7.89', fixture.renewal.id, false);
      const final = await downloadArchive(page, zh);
      expect(final.history.find(entry => entry.id === bill.id)).toEqual({ ...bill, deleted: true });
      expect(final.history.find(entry => entry.id === fixture.renewal.id)).toEqual({ ...correctedRenewal,
        financeCorrection: { ...correctedRenewal?.financeCorrection, hidden: true } });
      expect(final.history.find(entry => entry.id === fixture.dollar.id)).toEqual(fixture.dollar);
      expect(final.history.find(entry => entry.id === fixture.yen.id)).toEqual(fixture.yen);
      expect(final.assets.find(asset => asset.id === fixture.subscription.id)).toEqual(fixture.renewed);
      const finalPath = resolve(fixtureDirectory, `final-${locale}-${width}.ka1`); await final.download.saveAs(finalPath);
      const restored = await browser.newContext({ locale, acceptDownloads: true });
      await restored.addInitScript(value => localStorage.setItem('keepany-language', value), zh ? 'zh-CN' : 'en');
      try { const target = await restored.newPage(); await restoreFixture(target, zh, finalPath); await target.goto('/finance');
        await expect(target.locator('.finance-entry')).toHaveCount(2); const restoredData = await downloadArchive(target, zh);
        expect(restoredData.history.sort((a,b) => a.id.localeCompare(b.id))).toEqual(final.history.sort((a,b) => a.id.localeCompare(b.id)));
      } finally { await restored.close(); }
      expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test('T14 true second-tab edits and deletion reject stale review without overwriting latest bill', async ({ browser }) => {
  test.setTimeout(100_000); const c = copy(false);
  const context = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
  await context.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  try {
    const first = await context.newPage(); first.setDefaultTimeout(15_000); await restoreFixture(first, false); await first.goto('/finance');
    const second = await context.newPage(); second.setDefaultTimeout(15_000); await second.goto('/finance');
    const row1 = first.locator(`#finance-entry-${fixture.dollar.id}`), row2 = second.locator(`#finance-entry-${fixture.dollar.id}`);
    await row1.getByRole('button', { name: c.edit, exact: true }).click();
    await first.getByRole('dialog').getByLabel(c.amount, { exact: true }).fill('20.01');
    await row2.getByRole('button', { name: c.edit, exact: true }).click();
    await second.getByRole('dialog').getByLabel(c.amount, { exact: true }).fill('30.02');
    await second.getByRole('dialog').getByRole('button', { name: c.save, exact: true }).click(); await expect(second.getByRole('dialog')).toBeHidden();
    await first.getByRole('dialog').getByRole('button', { name: c.save, exact: true }).click();
    await expect(first.getByRole('dialog').getByRole('alert')).toContainText('changed in another tab');
    await expect(first.getByRole('dialog').getByLabel(c.amount, { exact: true })).toHaveValue('20.01');
    await first.getByRole('dialog').getByRole('button', { name: c.cancel, exact: true }).click();
    await expect(row1).toContainText('30.02');
    await row1.getByRole('button', { name: c.remove, exact: true }).click();
    await row2.getByRole('button', { name: c.edit, exact: true }).click(); await second.getByRole('dialog').getByLabel(c.amount, { exact: true }).fill('40.03');
    await second.getByRole('dialog').getByRole('button', { name: c.save, exact: true }).click(); await expect(second.getByRole('dialog')).toBeHidden();
    await first.getByRole('dialog').getByRole('button', { name: c.remove, exact: true }).click();
    await expect(first.getByRole('dialog').getByRole('alert')).toContainText('changed in another tab');
    await first.getByRole('dialog').getByRole('button', { name: c.cancel, exact: true }).click();
    await first.reload(); await expect(row1).toContainText('40.03'); const snapshot = await downloadArchive(first);
    expect(snapshot.history.find(entry => entry.id === fixture.dollar.id)).toMatchObject({ amount: 4003, deleted: false });
  } finally { await context.close(); }
});


});


test.describe('F02-project-account-crud — fresh 4236 shared React mobile', () => {
// Reused steps from project-account-crud.spec.ts; fresh isolated data and mobile viewport.

const repositoryModuleUrl = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/local-db/src/index.ts`;

type StoredAsset = {
	id: string;
	kind: string;
	name: string;
	category: string;
	tags: string[];
	username: string;
	contact: string;
	description: string;
	attachments: string[];
	deleted: boolean;
};

async function assetRows(page: Page): Promise<StoredAsset[]> {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		return (await repository.allRecords())
			.filter((row: { type: string }) => row.type === "asset")
			.map((row: { payload: string }) => JSON.parse(row.payload))
			.sort((a: StoredAsset, b: StoredAsset) => a.id.localeCompare(b.id));
	}, repositoryModuleUrl);
}

async function storedFiles(
	page: Page,
): Promise<{ id: string; name: string; bytes: number[] }[]> {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		return Promise.all(
			(await repository.fileStore.blobs.toArray()).map(
				async (file: { id: string; name: string; blob: Blob }) => ({
					id: file.id,
					name: file.name,
					bytes: Array.from(new Uint8Array(await file.blob.arrayBuffer())),
				}),
			),
		);
	}, repositoryModuleUrl);
}

async function add(page: Page, kind: "project" | "account", name: string) {
	await page.goto(`/assets/${kind}`);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name", { exact: true }).fill(name);
	return dialog;
}

async function saveDialog(page: Page) {
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog).toBeHidden();
}

async function openDetail(page: Page, name: string) {
	const row = page
		.locator("main.page .list-row")
		.filter({ hasText: name })
		.first();
	if (await page.locator("#top-search-query").isVisible().catch(() => false)) {
		await row.focus();
		await page.keyboard.press("Enter");
	} else {
		await row.click();
	}
	await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function openSearchInput(page: Page) {
	const input = page.locator("#top-search-query");
	if (!(await input.isVisible().catch(() => false))) {
		await page
			.getByRole("button", { name: "Search all records", exact: true })
			.click();
	}
	await expect(input).toBeVisible();
	return input;
}

async function fillSearch(page: Page, value: string) {
	const input = await openSearchInput(page);
	await input.fill(value);
	await expect
		.poll(() => page.evaluate(() => sessionStorage.getItem("keepany-search") || ""))
		.toBe(value);
}

async function expectSearchValue(page: Page, value: string) {
	const input = await openSearchInput(page);
	await expect(input).toHaveValue(value);
}

async function expectPersistedListSearch(
	page: Page,
	kind: "project" | "account",
	value: string,
) {
	await expect
		.poll(() =>
			page.evaluate((assetKind) => {
				try {
					const raw = sessionStorage.getItem(`keepany-scroll-filter-${assetKind}`);
					return raw ? (JSON.parse(raw) as { search?: string }).search ?? "" : "";
				} catch {
					return "";
				}
			}, kind),
		)
		.toBe(value);
}

async function closeSearch(page: Page) {
	const input = page.locator("#top-search-query");
	if (await input.isVisible().catch(() => false)) await input.press("Escape");
	await expect(input).toBeHidden();
}

async function backToList(page: Page) {
	await page
		.getByRole("banner")
		.getByRole("link", { name: /^(Back to list|返回列表)$/ })
		.click();
}

async function openProjectMaterials(page: Page) {
	const materials = page.locator("#asset-project-materials");
	if (!page.url().includes("/assets/project/")) return;
	await expect(materials).toHaveCount(1);
	const initialOpen = await materials.evaluate((element) => (element as HTMLDetailsElement).open);
	if (!initialOpen) {
		const viewMaterials = page.getByRole("button", {
			name: /^(View submission materials|查看提交材料)$/,
		});
		if (await viewMaterials.count()) await viewMaterials.first().click();
		else await materials.locator("summary").click();
	}
	await expect
		.poll(() =>
			materials.evaluate((element) => (element as HTMLDetailsElement).open),
		)
		.toBe(true);
}

async function deleteAndRestore(
	page: Page,
	kind: "project" | "account",
	name: string,
) {
	const actions = page.locator(
		kind === "project"
			? "main.page > .asset-project-action-bar"
			: "main.page > .page-header",
	);
	await actions.getByRole("button", { name: "Move to trash" }).click();
	const confirm = page.getByRole("dialog");
	await confirm.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByRole("heading", { name })).toBeVisible();
	await actions.getByRole("button", { name: "Move to trash" }).click();
	await confirm.getByRole("button", { name: "Move to trash" }).click();
	await expect(page).toHaveURL(new RegExp(`/assets/${kind}$`));
	await expect(
		page.locator("main.page .list-row").filter({ hasText: name }),
	).toHaveCount(0);
	await page.goto("/trash");
	const row = page.locator("main.page .list-row").filter({ hasText: name });
	await expect(row).toBeVisible();
	await row.getByRole("button", { name: "Restore" }).click();
	await expect(row).toHaveCount(0);
	await page.goto(`/assets/${kind}`);
	await expect(
		page.locator("main.page .list-row").filter({ hasText: name }),
	).toBeVisible();
}

test("project and account CRUD, intersecting filters, trash and actual backup restore", async ({
	browser,
}) => {
	test.setTimeout(180_000);
	mkdirSync(evidence, { recursive: true });
	const suffix = crypto.randomUUID().slice(0, 8);
	const project = `Project ${suffix} ${"P".repeat(140)}`;
	const projectSaved = `Edited project ${suffix}`;
	const account = `Account ${suffix}`;
	const accountSaved = `Edited account ${suffix}`;
	const otherProject = `Other project ${suffix}`;
	const tag = `intersection-${suffix}`;
	const longTag = "T".repeat(60);
	const longEmail = `${"e".repeat(250)}@example.test`;
	const password = `crud-backup-${suffix}-2026`;
	const source = await browser.newContext({
		locale: "en-US",
		acceptDownloads: true,
		viewport: { width: 390, height: 800 },
	});
	const page = await source.newPage();
	page.setDefaultTimeout(15_000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		const projectDialog = await add(page, "project", project);
		await projectDialog
			.getByLabel("Tags (comma separated)")
			.pressSequentially("alpha, beta");
		await expect(
			projectDialog.getByLabel("Tags (comma separated)"),
		).toHaveValue("alpha, beta");
		await projectDialog
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 98 }, (_, index) => `tag${index}`),
				].join(","),
			);
		await projectDialog
			.getByLabel("Short description")
			.fill("Original project description");
		await saveDialog(page);
		await openDetail(page, project);
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const projectEdit = page.getByRole("dialog");
		await projectEdit
			.getByLabel("Name", { exact: true })
			.fill("Cancelled project rename");
		await projectEdit.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByRole("heading", { name: project })).toBeVisible();
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		await projectEdit.getByLabel("Name", { exact: true }).fill("");
		await projectEdit
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(
			projectEdit.getByText("Please check this field"),
		).toBeVisible();
		await expect(projectEdit).toBeVisible();
		await projectEdit.getByLabel("Name", { exact: true }).fill("N".repeat(161));
		await projectEdit
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(projectEdit.locator("#name-error")).toBeVisible();
		await projectEdit.getByLabel("Name", { exact: true }).fill(projectSaved);
		await projectEdit
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 99 }, (_, index) => `tag${index}`),
				].join(","),
			);
		await projectEdit
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(projectEdit.locator("#tags-error")).toBeVisible();
		await projectEdit
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 98 }, (_, index) => `tag${index}`),
				].join(","),
			);
		await projectEdit.getByLabel("Short description").fill("");
		await saveDialog(page);
		await expect(
			page.getByRole("heading", { name: projectSaved }),
		).toBeVisible();
		await expect(page.getByText("Cancelled project rename")).toHaveCount(0);
		await backToList(page);
		const otherDialog = await add(page, "project", otherProject);
		await selectChoice(otherDialog.getByLabel("Category"), "repository");
		await saveDialog(page);

		const accountDialog = await add(page, "account", account);
		await selectChoice(accountDialog.getByLabel("Category"), "email");
		await accountDialog
			.getByLabel("Username / identifier")
			.fill("e".repeat(301));
		await accountDialog
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(accountDialog.locator("#username-error")).toBeVisible();
		await accountDialog.getByLabel("Username / identifier").fill(longEmail);
		await accountDialog
			.getByLabel("Tags (comma separated)")
			.fill(`${tag}, account-only`);
		await saveDialog(page);
		await openDetail(page, account);
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const accountEdit = page.getByRole("dialog");
		await accountEdit
			.getByLabel("Name", { exact: true })
			.fill("Cancelled account rename");
		await accountEdit.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByRole("heading", { name: account })).toBeVisible();
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		await accountEdit.getByLabel("Name", { exact: true }).fill("");
		await accountEdit
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(
			accountEdit.getByText("Please check this field"),
		).toBeVisible();
		await accountEdit.getByLabel("Name", { exact: true }).fill(accountSaved);
		await accountEdit.getByLabel("Contact").fill("");
		await saveDialog(page);
		await expect(
			page.getByRole("heading", { name: accountSaved }),
		).toBeVisible();
		await backToList(page);

		await page.goto("/assets/project");
		await page.getByRole("button", { name: "Websites", exact: true }).click();
		await selectChoice(page.locator("#asset-tag-filter"), { label: tag });
		await fillSearch(page, tag);
		await expect(page.locator("main.page .list-row")).toHaveCount(1);
		await expect(
			page.locator("main.page .list-row").filter({ hasText: projectSaved }),
		).toBeVisible();
		await closeSearch(page);
		await page
			.getByRole("button", { name: "Repositories", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Repositories", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await fillSearch(page, tag);
		await expect(page.locator("main.page .list-row")).toHaveCount(0);
		await closeSearch(page);
		await page.getByRole("button", { name: "Websites", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Websites", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await fillSearch(page, tag);
		await openDetail(page, projectSaved);
		await backToList(page);
		await expectPersistedListSearch(page, "project", tag);
		await fillSearch(page, tag);
		await expectSearchValue(page, tag);
		await expect(
			page.getByRole("button", { name: "Websites", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(page.locator("#asset-tag-filter")).toHaveAttribute(
			"data-value",
			tag,
		);
		await page.reload();
		await expectPersistedListSearch(page, "project", tag);
		await fillSearch(page, tag);
		await expectSearchValue(page, tag);
		await expect(
			page.getByRole("button", { name: "Websites", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(page.locator("#asset-tag-filter")).toHaveAttribute(
			"data-value",
			tag,
		);
		await expect(page.locator("main.page .list-row")).toHaveCount(1);
		await fillSearch(page, `no-results-${suffix}`);
		await expect(page.locator("main.page .list-row")).toHaveCount(0);
		await fillSearch(page, "");
		await openDetail(page, projectSaved);
		await deleteAndRestore(page, "project", projectSaved);
		await page.reload();
		await expect(
			page.locator("main.page .list-row").filter({ hasText: projectSaved }),
		).toBeVisible();

		await page.goto("/assets/account");
		await page.getByRole("button", { name: "Email", exact: true }).click();
		await selectChoice(page.locator("#asset-tag-filter"), { label: tag });
		await fillSearch(page, longEmail);
		await expect(page.locator("main.page .list-row")).toHaveCount(1);
		await fillSearch(page, `no-results-${suffix}`);
		await expect(page.locator("main.page .list-row")).toHaveCount(0);
		await fillSearch(page, "");
		await openDetail(page, accountSaved);
		await deleteAndRestore(page, "account", accountSaved);
		await page.reload();
		await expect(
			page.locator("main.page .list-row").filter({ hasText: accountSaved }),
		).toBeVisible();
		const scrollCsv = [
			"name,kind,category",
			...Array.from(
				{ length: 45 },
				(_, index) =>
					`Scroll account ${suffix} ${String(index).padStart(2, "0")},account,email`,
			),
		].join("\n");
		await page.goto("/intake");
		await page
			.locator(".intake-mode-tabs")
			.getByRole("button", { name: "Spreadsheet" })
			.click();
		await page.locator("#csv-file").setInputFiles({
			name: "crud-scroll.csv",
			mimeType: "text/csv",
			buffer: Buffer.from(scrollCsv),
		});
		await expect(
			page.getByText("45 candidates are ready for review.", { exact: true }),
		).toBeVisible();
		await expect(page.locator(".intake-review-row")).toHaveCount(45);
		for (let index = 0; index < 45; index += 1) {
			const pending = page
				.locator(".intake-review-row")
				.filter({ has: page.getByRole("button", { name: "Confirm" }) })
				.first();
			await pending.getByRole("button", { name: "Confirm" }).click();
		}
		await expect(
			page.locator(".intake-review-row").getByRole("button", { name: "Confirm" }),
		).toHaveCount(0);
		await page.goto("/assets/account");
		await selectChoice(page.locator("#asset-tag-filter"), "");
		await fillSearch(page, `Scroll account ${suffix}`);
		await expect(page.locator("main.page .list-row")).toHaveCount(45);
		const target = page.locator("main.page .list-row").nth(30);
		const targetName = await target.locator("strong").innerText();
		await target.evaluate((element) =>
			element.scrollIntoView({ block: "center" }),
		);
		const scrolled = await page.evaluate(() => window.scrollY);
		expect(scrolled).toBeGreaterThan(1000);
		await openDetail(page, targetName);
		await backToList(page);
		await expectPersistedListSearch(page, "account", `Scroll account ${suffix}`);
		await fillSearch(page, `Scroll account ${suffix}`);
		await expectSearchValue(page, `Scroll account ${suffix}`);
		await expect(
			page.getByRole("button", { name: "Email", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(page.locator("#asset-tag-filter")).toHaveAttribute(
			"data-value",
			"",
		);
		await expect
			.poll(() => page.evaluate(() => window.scrollY))
			.toBeGreaterThan(1000);
		expect(
			Math.abs((await page.evaluate(() => window.scrollY)) - scrolled),
		).toBeLessThan(35);
		await page.screenshot({
			path: `${evidence}/crud-en-1280-account-filter-return.png`,
		});
		await fillSearch(page, "");

		const before = (await assetRows(page)).filter((asset) =>
			[projectSaved, accountSaved, otherProject].includes(asset.name),
		);
		expect(before).toHaveLength(3);
		expect(
			before.find((asset) => asset.name === projectSaved)?.tags,
		).toHaveLength(100);
		expect(
			before.find((asset) => asset.name === projectSaved)?.description,
		).toBe("");
		expect(before.find((asset) => asset.name === accountSaved)?.username).toBe(
			longEmail,
		);
		expect(before.every((asset) => !asset.deleted)).toBe(true);

		await page.goto("/intake");
		await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: "Create backup" }).click();
		const link = page.getByRole("link", { name: "Save backup file" });
		await expect(link).toBeVisible();
		const downloadPromise = page.waitForEvent("download");
		await link.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(
			/^keepany-\d{4}-\d{2}-\d{2}\.ka1$/,
		);
		const backupPath = await download.path();
		if (!backupPath) throw Error("The browser did not save the .ka1 file");
		const destination = await browser.newContext({
			locale: "zh-CN",
			viewport: { width: 390, height: 844 },
		});
		const restored = await destination.newPage();
		restored.on("pageerror", (error) => errors.push(error.message));
		try {
			await restored.goto("/assets/project");
			await expect(restored.getByText(projectSaved)).toHaveCount(0);
			await restored.goto("/intake");
			await restored.locator("#backup-password").fill(password);
			await restored.locator("#restore-file").setInputFiles(backupPath);
			await restored
				.getByRole("button", { name: "预览", exact: true })
				.first()
				.click();
			const confirm = restored.getByRole("button", { name: /确认 ·/ });
			await expect(confirm).toBeVisible();
			await confirm.click();
			await expect(restored.getByText(/已恢复 \d+ 条记录/)).toBeVisible();
			const after = (await assetRows(restored)).filter((asset) =>
				[projectSaved, accountSaved, otherProject].includes(asset.name),
			);
			expect(after).toEqual(before);
			await restored.reload();
			await restored.goto("/assets/account");
			await expect(
				restored
					.locator("main.page .list-row")
					.filter({ hasText: accountSaved }),
			).toBeVisible();
			await restored.goto("/assets/project");
			await expect(
				restored
					.locator("main.page .list-row")
					.filter({ hasText: projectSaved }),
			).toBeVisible();
			await restored.screenshot({
				path: `${evidence}/crud-zh-390-restored-project.png`,
			});
		} finally {
			await destination.close();
		}
		expect(errors).toEqual([]);
	} finally {
		await source.close();
	}
});

test("a matching list search can restore scroll after navigation clears the temporary query", async ({ browser }) => {
	const context = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
	const page = await context.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const query = `Scroll match ${crypto.randomUUID().slice(0, 8)}`;
	const tag = `tag-${query}`;
	try {
		await page.goto("/assets/account");
		await page.evaluate(async ({ repositoryPath, domainPath, query, tag }) => {
			const { localRepository } = await import(repositoryPath);
			const { newAsset } = await import(domainPath);
			const repository = await localRepository();
			for (let index = 0; index < 45; index++) {
				await repository.save("asset", { ...newAsset("account"), category: "email", tags: [tag],
					name: `${query} ${String(index).padStart(2, "0")}` });
			}
		}, { repositoryPath: repositoryModuleUrl, domainPath: `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/domain/src/index.ts`, query, tag });
		await page.getByRole("button", { name: "Email", exact: true }).click();
		await selectChoice(page.locator("#asset-tag-filter"), { label: tag });
		await fillSearch(page, query);
		await expect(page.locator("main.page .list-row")).toHaveCount(45);
		const target = page.locator("main.page .list-row").nth(30);
		const name = await target.locator("strong").innerText();
		await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
		const before = await page.evaluate(() => window.scrollY);
		expect(before).toBeGreaterThan(1000);
		await openDetail(page, name);
		const stored = await page.evaluate(() => Number(sessionStorage.getItem("keepany-scroll-account")));
		expect(Math.abs(stored - before)).toBeLessThan(35);
		await expect(page.locator("#top-search-query")).toBeHidden();
		await backToList(page);
		await expect(page.locator("#asset-tag-filter")).toHaveAttribute("data-value", tag);
		await expect(page.getByRole("button", { name: "Email", exact: true })).toHaveAttribute("aria-pressed", "true");
		await expectPersistedListSearch(page, "account", query);
		await expect(page.locator("#top-search-query")).toBeHidden();
		// The cleared query is a different view. Its first render must not consume
		// the saved position before the user returns to the matching filter.
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
		await fillSearch(page, query);
		await expect(page.locator("main.page .list-row")).toHaveCount(45);
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
		const after = await page.evaluate(() => window.scrollY);
		expect(Math.abs(after - before)).toBeLessThan(35);
		await expect(target).toBeInViewport({ ratio: 1 });
		console.log(JSON.stringify({ kind: "account", before, stored, after }));
		expect(errors).toEqual([]);
	} finally {
		await context.close();
	}
});

for (const kind of ["project", "account"] as const) {
	test(`${kind} image replacement removes old blob and actual backup restores only current image`, async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		mkdirSync(evidence, { recursive: true });
		const suffix = crypto.randomUUID().slice(0, 8);
		const name = `Image ${kind} ${suffix}`;
		const password = `image-crud-backup-${suffix}-2026`;
		const source = await browser.newContext({
			locale: "en-US",
			acceptDownloads: true,
			viewport: { width: 390, height: 844 },
		});
		const page = await source.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		async function png(color: string) {
			const base64 = await page.evaluate((fill) => {
				const canvas = document.createElement("canvas");
				canvas.width = 8;
				canvas.height = 8;
				const context = canvas.getContext("2d");
				if (!context) throw Error("Canvas unavailable");
				context.fillStyle = fill;
				context.fillRect(0, 0, 8, 8);
				return canvas.toDataURL("image/png").split(",")[1];
			}, color);
			return Buffer.from(base64, "base64");
		}
		try {
			await add(page, kind, name);
			await saveDialog(page);
			await openDetail(page, name);
			await openProjectMaterials(page);
			const assetId = (await assetRows(page)).find(
				(asset) => asset.name === name,
			)?.id;
			if (!assetId) throw Error(`${kind} ID missing`);
			const first = await png("#e43b44");
			await page.getByLabel("Add image").setInputFiles({
				name: "original.png",
				mimeType: "image/png",
				buffer: first,
			});
			await page
				.getByRole("dialog")
				.getByRole("button", { name: "Confirm" })
				.click();
			await expect(page.locator(".asset-image")).toHaveCount(1);
			const firstFiles = await storedFiles(page);
			expect(firstFiles).toHaveLength(1);
			expect(firstFiles[0].bytes).toEqual(Array.from(first));
			const replacement = await png("#2487c2");
			const chooser = page.waitForEvent("filechooser");
			await page.getByRole("button", { name: "Replace image" }).click();
			await (await chooser).setFiles({
				name: "replacement.png",
				mimeType: "image/png",
				buffer: replacement,
			});
			await page
				.getByRole("dialog")
				.getByRole("button", { name: "Confirm" })
				.click();
			await expect(page.locator(".asset-image")).toHaveCount(1);
			await expect.poll(async () => (await storedFiles(page)).length).toBe(1);
			const currentFiles = await storedFiles(page);
			expect(currentFiles[0].id).not.toBe(firstFiles[0].id);
			expect(currentFiles[0].name).toBe("replacement.png");
			expect(currentFiles[0].bytes).toEqual(Array.from(replacement));
			expect(
				(await assetRows(page)).find((asset) => asset.id === assetId)
					?.attachments,
			).toEqual([currentFiles[0].id]);
			await page.screenshot({
				path: `${evidence}/crud-en-390-${kind}-image-replaced.png`,
			});

			await page.goto("/intake");
			await page.locator("#backup-password").fill(password);
			await page.getByRole("button", { name: "Create backup" }).click();
			const downloadEvent = page.waitForEvent("download");
			await page.getByRole("link", { name: "Save backup file" }).click();
			const backupPath = await (await downloadEvent).path();
			if (!backupPath) throw Error("The browser did not save the .ka1 file");
			const destination = await browser.newContext({
				locale: "zh-CN",
				viewport: { width: 390, height: 844 },
			});
			const restored = await destination.newPage();
			restored.on("pageerror", (error) => errors.push(error.message));
			try {
				await restored.goto("/intake");
				await restored.locator("#backup-password").fill(password);
				await restored.locator("#restore-file").setInputFiles(backupPath);
				await restored
					.getByRole("button", { name: "预览", exact: true })
					.first()
					.click();
				await restored.getByRole("button", { name: /确认 ·/ }).click();
				await expect(restored.getByText(/已恢复 \d+ 条记录/)).toBeVisible();
				await restored.goto(`/assets/${kind}/${assetId}`);
				await openProjectMaterials(restored);
				await expect(restored.getByRole("heading", { name })).toBeVisible();
				await expect(restored.locator(".asset-image")).toHaveCount(1);
				expect(
					(await assetRows(restored)).find((asset) => asset.id === assetId)
						?.attachments,
				).toEqual([currentFiles[0].id]);
				expect(await storedFiles(restored)).toEqual(currentFiles);
			} finally {
				await destination.close();
			}
			await page.goto(`/assets/${kind}/${assetId}`);
			await openProjectMaterials(page);
			await page.getByRole("button", { name: "Remove image" }).click();
			await expect(page.locator(".asset-image")).toHaveCount(0);
			await expect.poll(async () => (await storedFiles(page)).length).toBe(0);
			expect(
				(await assetRows(page)).find((asset) => asset.id === assetId)
					?.attachments,
			).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await source.close();
		}
	});
}

for (const locale of ["en-US", "zh-CN"] as const) {
	for (const width of [360, 390, 430]) {
		test(`${locale} project/account CRUD entry and edit dialog fit ${width}px`, async ({
			browser,
		}) => {
			test.setTimeout(90_000);
			mkdirSync(evidence, { recursive: true });
			const context = await browser.newContext({
				locale,
				viewport: { width, height: 844 },
			});
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const copy =
				locale === "zh-CN"
						? {
									add: "新增",
									name: "名称",
									save: "保存",
									cancel: "取消",
									notes: "备注",
									projectNotes: "内部备注",
									contactDetails: "联系方式",
							edit: "编辑",
							project: "每个项目，都有自己的档案。",
							account: "账号",
						}
					: {
							add: "Add",
									name: "Name",
									save: "Save",
									cancel: "Cancel",
									notes: "Notes",
									projectNotes: "Internal notes",
									contactDetails: "Contact details",
							edit: "Edit",
							project: "Every project has its own file.",
							account: "Accounts",
						};
			try {
				for (const [kind, label] of [
					["project", copy.project],
					["account", copy.account],
				] as const) {
					await page.goto(`/assets/${kind}`);
					await expect(
						page.getByRole("heading", { level: 1, name: label }),
					).toBeVisible();
					await page
						.getByRole("button", { name: copy.add, exact: true })
						.click();
					const dialog = page.getByRole("dialog");
					await expect(dialog).toBeVisible();
					const name = `${kind} ${locale} ${width} ${"L".repeat(90)}`;
					await dialog.getByLabel(copy.name, { exact: true }).fill(name);
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
					if (width <= 390) {
						if (kind === "project") {
							const contactDetails = dialog
								.locator("details.project-editor-group")
								.filter({ hasText: copy.contactDetails });
							if (
								!(await contactDetails.evaluate(
									(element) => (element as HTMLDetailsElement).open,
								))
							) {
								await contactDetails.locator("summary").click();
							}
						}
						const sizes = await dialog
							.locator("input, textarea, [role=combobox]")
							.evaluateAll((elements) =>
								elements.map((element) =>
									Number.parseFloat(getComputedStyle(element).fontSize),
								),
							);
						expect(
							Math.min(...sizes),
							`${locale} ${width}px ${kind} editor input font size`,
						).toBeGreaterThanOrEqual(16);
						await expect(
							dialog.getByRole("button", { name: copy.cancel }),
						).toBeInViewport({ ratio: 1 });
						await expect(
							dialog.getByRole("button", { name: copy.save }),
						).toBeInViewport({ ratio: 1 });
						const notesLabel =
							kind === "project" ? copy.projectNotes : copy.notes;
						await dialog.getByLabel(notesLabel).scrollIntoViewIfNeeded();
						await expect(dialog.getByLabel(notesLabel)).toBeInViewport({
							ratio: 1,
						});
						await expect(
							dialog.getByRole("button", { name: copy.save }),
						).toBeInViewport({ ratio: 1 });
					}
					await page.screenshot({
						path: `${evidence}/crud-${locale === "zh-CN" ? "zh" : "en"}-${width}-${kind}-editor.png`,
					});
					if (width <= 390) {
						await dialog.evaluate((element) =>
							element.scrollTo({ top: element.scrollHeight }),
						);
						const notesLabel =
							kind === "project" ? copy.projectNotes : copy.notes;
						const notes = await dialog.getByLabel(notesLabel).boundingBox();
						const actions = await dialog
							.locator("form > .actions")
							.boundingBox();
						if (!notes || !actions)
							throw Error("Editor notes or actions missing");
						expect(
							notes.y + notes.height,
							`${locale} ${width}px ${kind} notes visible above actions`,
						).toBeLessThanOrEqual(actions.y + 1);
						await page.screenshot({
							path: `${evidence}/crud-${locale === "zh-CN" ? "zh" : "en"}-${width}-${kind}-editor-tail.png`,
						});
					}
					await dialog.getByRole("button", { name: copy.save }).click();
					await expect(dialog).toBeHidden();
					await page
						.locator("main.page .list-row")
						.filter({ hasText: name })
						.click();
					await expect(page.getByRole("heading", { name })).toBeVisible();
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
					const editButton =
						kind === "project"
							? page
									.locator("main.page > .asset-project-action-bar")
									.getByRole("button", { name: copy.edit, exact: true })
							: page
									.locator("main.page > .page-header")
									.getByRole("button", { name: copy.edit, exact: true });
					await editButton.click();
					await expect(page.getByRole("dialog")).toBeVisible({
						timeout: 15_000,
					});
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
				}
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}

});


test.describe('F02-subscription-item-crud — fresh 4236 shared React mobile', () => {
// Reused steps from subscription-item-crud.spec.ts; fresh isolated data and mobile viewport.

const repositoryModuleUrl = sourceModuleUrl("packages/local-db/src/index.ts");

type Asset = {
	id: string;
	kind: string;
	name: string;
	category: string;
	tags: string[];
	amount: number;
	discountAmount: number;
	dueDate: string;
	purchaseDate: string;
	warrantyDate: string;
	location: string;
	attachments: string[];
	deleted: boolean;
};

async function assets(page: Page): Promise<Asset[]> {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		return (await repository.allRecords())
			.filter((row: { type: string }) => row.type === "asset")
			.map((row: { payload: string }) => JSON.parse(row.payload))
			.sort((left: Asset, right: Asset) => left.id.localeCompare(right.id));
	}, repositoryModuleUrl);
}

async function files(
	page: Page,
): Promise<{ id: string; name: string; bytes: number[] }[]> {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		return Promise.all(
			(await repository.fileStore.blobs.toArray()).map(
				async (file: { id: string; name: string; blob: Blob }) => ({
					id: file.id,
					name: file.name,
					bytes: Array.from(new Uint8Array(await file.blob.arrayBuffer())),
				}),
			),
		);
	}, repositoryModuleUrl);
}

async function renewalHistory(
	page: Page,
	assetId: string,
): Promise<{ id: string; assetId: string; action: string; amount: number }[]> {
	return page.evaluate(
		async ({ modulePath, id }) => {
			const { localRepository } = await import(modulePath);
			const repository = await localRepository();
			return (await repository.list("history"))
				.filter(
					(row: { assetId: string; action: string }) =>
						row.assetId === id && row.action === "renew",
				)
				.sort((left: { id: string }, right: { id: string }) =>
					left.id.localeCompare(right.id),
				);
		},
		{ modulePath: repositoryModuleUrl, id: assetId },
	);
}

async function png(page: Page, color: string): Promise<Buffer> {
	const base64 = await page.evaluate((fill) => {
		const canvas = document.createElement("canvas");
		canvas.width = 8;
		canvas.height = 8;
		const context = canvas.getContext("2d");
		if (!context) throw Error("Canvas unavailable");
		context.fillStyle = fill;
		context.fillRect(0, 0, 8, 8);
		return canvas.toDataURL("image/png").split(",")[1];
	}, color);
	return Buffer.from(base64, "base64");
}

async function create(page: Page, kind: "subscription" | "item", name: string) {
	await page.goto(`/assets/${kind}`);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name", { exact: true }).fill(name);
	return dialog;
}

async function save(page: Page) {
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog).toBeHidden();
}

async function detail(page: Page, name: string) {
	await page
		.locator("main.page .list-row")
		.filter({ hasText: name })
		.first()
		.click();
	await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function openSearchInput(page: Page) {
	const input = page.locator("#top-search-query");
	if (!(await input.isVisible()))
		await page.getByRole("button", { name: "Search all records", exact: true }).click();
	await expect(input).toBeVisible();
	return input;
}

async function expectSearchClosed(page: Page) {
	await expect(page.locator("#top-search-query")).toBeHidden();
	await expect.poll(() => page.evaluate(() => sessionStorage.getItem("keepany-search") || "")).toBe("");
}

async function trashCycle(
	page: Page,
	kind: "subscription" | "item",
	name: string,
) {
	await page
		.locator("main.page > .page-header")
		.getByRole("button", { name: "Move to trash" })
		.click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByRole("heading", { name })).toBeVisible();
	await page
		.locator("main.page > .page-header")
		.getByRole("button", { name: "Move to trash" })
		.click();
	await dialog.getByRole("button", { name: "Move to trash" }).click();
	await expect(page).toHaveURL(new RegExp(`/assets/${kind}$`));
	await page.goto("/trash");
	const row = page.locator("main.page .list-row").filter({ hasText: name });
	await expect(row).toBeVisible();
	await row.getByRole("button", { name: "Restore" }).click();
	await expect(row).toHaveCount(0);
	await page.goto(`/assets/${kind}`);
	await expect(
		page.locator("main.page .list-row").filter({ hasText: name }),
	).toBeVisible();
}

test("subscription and item shared CRUD, filters, image and actual backup restore", async ({
	browser,
}) => {
	test.setTimeout(180_000);
	mkdirSync(evidence, { recursive: true });
	const suffix = crypto.randomUUID().slice(0, 8);
	const subscription = `Subscription ${suffix}`;
	const subscriptionSaved = `Edited subscription ${suffix}`;
	const subscriptionOther = `Other subscription ${suffix}`;
	const item = `Camera ${suffix}`;
	const itemSaved = `Edited camera ${suffix}`;
	const itemOther = `Other item ${suffix}`;
	const tag = `matrix-${suffix}`;
	const longTag = "T".repeat(60);
	const location = "L".repeat(300);
	const password = `subscription-item-${suffix}-2026`;
	const source = await browser.newContext({
		locale: "en-US",
		timezoneId: "America/New_York",
		acceptDownloads: true,
		viewport: { width: 390, height: 844 },
	});
	const page = await source.newPage();
	page.setDefaultTimeout(15_000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		const subscriptionCreate = await create(page, "subscription", subscription);
		await subscriptionCreate.locator("#amount").fill("");
		await subscriptionCreate
			.getByLabel("Tags (comma separated)")
			.pressSequentially("alpha, beta");
		await expect(
			subscriptionCreate.getByLabel("Tags (comma separated)"),
		).toHaveValue("alpha, beta");
		await subscriptionCreate
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 98 }, (_, index) => `sub${index}`),
				].join(","),
			);
		await save(page);
		await detail(page, subscription);
		const subscriptionId = new URL(page.url()).pathname.split("/").at(-1);
		if (!subscriptionId) throw Error("Subscription ID missing");
		expect(
			(await assets(page)).find((asset) => asset.id === subscriptionId),
		).toMatchObject({
			amount: 0,
			discountAmount: 0,
			dueDate: "",
			tags: expect.arrayContaining([tag, longTag]),
		});
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const subscriptionEdit = page.getByRole("dialog");
		await subscriptionEdit
			.getByLabel("Name", { exact: true })
			.fill("Cancelled subscription edit");
		await subscriptionEdit.getByRole("button", { name: "Cancel" }).click();
		await expect(
			page.getByRole("heading", { name: subscription }),
		).toBeVisible();
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		await subscriptionEdit.locator("#amount").fill("12.345");
		await subscriptionEdit.getByRole("button", { name: "Save" }).click();
		await expect(subscriptionEdit.locator("#amount-error")).toBeVisible();
		expect(
			(await assets(page)).find((asset) => asset.id === subscriptionId)?.amount,
		).toBe(0);
		await subscriptionEdit.locator("#amount").fill("12.34");
		await subscriptionEdit.locator("#discountAmount").fill("13");
		await subscriptionEdit.getByRole("button", { name: "Save" }).click();
		await expect(
			subscriptionEdit.locator("#discountAmount-error"),
		).toBeVisible();
		await subscriptionEdit.locator("#discountAmount").fill("2.34");
		await subscriptionEdit
			.getByLabel("Name", { exact: true })
			.fill(subscriptionSaved);
		await subscriptionEdit.locator("#dueDate").fill("2026-10-31");
		await subscriptionEdit.locator("#discountUntil").fill("2026-11-01");
		await save(page);
		await expect(
			page.getByRole("heading", { name: subscriptionSaved }),
		).toBeVisible();
		expect(
			(await assets(page)).find((asset) => asset.id === subscriptionId),
		).toMatchObject({
			amount: 1234,
			discountAmount: 234,
			dueDate: "2026-10-31",
		});
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		await selectChoice(subscriptionEdit.locator("#currency"), "JPY");
		await subscriptionEdit.locator("#discountAmount").fill("0");
		await subscriptionEdit.getByRole("button", { name: "Save" }).click();
		await expect(subscriptionEdit.locator("#amount-error")).toBeVisible();
		await selectChoice(subscriptionEdit.locator("#currency"), "CNY");
		await subscriptionEdit.locator("#amount").fill("90071992547409.92");
		await subscriptionEdit.getByRole("button", { name: "Save" }).click();
		await expect(subscriptionEdit.locator("#amount-error")).toBeVisible();
		await subscriptionEdit.locator("#amount").fill("90071992547409.91");
		await subscriptionEdit.locator("#discountAmount").fill("0");
		await save(page);
		expect(
			(await assets(page)).find((asset) => asset.id === subscriptionId)?.amount,
		).toBe(Number.MAX_SAFE_INTEGER);
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		await expect(subscriptionEdit.locator("#amount")).toHaveValue(
			"90071992547409.91",
		);
		await subscriptionEdit.getByRole("button", { name: "Cancel" }).click();
		await expect(
			page
				.locator("dt")
				.filter({ hasText: "Amount" })
				.first()
				.locator("..")
				.locator("dd"),
		).toContainText("90,071,992,547,409.91");
		await page.getByLabel("Locally recorded amount").fill("90071992547400.01");
		await page.getByRole("button", { name: "Record renewal" }).click();
		const history = page
			.locator("section.card")
			.filter({ has: page.getByRole("heading", { name: "History" }) })
			.locator(".list-row");
		await expect(history).toHaveCount(1);
		await expect(history.first()).toContainText("90,071,992,547,400.01");
		expect((await renewalHistory(page, subscriptionId))[0]?.amount).toBe(
			9_007_199_254_740_001,
		);
		const subscriptionBefore = await png(page, "#b83942");
		await page.getByLabel("Add image").setInputFiles({
			name: "subscription-before.png",
			mimeType: "image/png",
			buffer: subscriptionBefore,
		});
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Confirm" })
			.click();
		await expect(page.locator(".asset-image")).toHaveCount(1);
		const subscriptionOldFile = (await files(page))[0];
		const subscriptionAfter = await png(page, "#36906a");
		const subscriptionChooser = page.waitForEvent("filechooser");
		await page.getByRole("button", { name: "Replace image" }).click();
		await (await subscriptionChooser).setFiles({
			name: "subscription-after.png",
			mimeType: "image/png",
			buffer: subscriptionAfter,
		});
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Confirm" })
			.click();
		await expect
			.poll(async () => (await files(page))[0]?.name)
			.toBe("subscription-after.png");
		const subscriptionCurrentFile = (await files(page))[0];
		expect(await files(page)).toHaveLength(1);
		expect(subscriptionCurrentFile.id).not.toBe(subscriptionOldFile.id);
		expect(subscriptionCurrentFile.bytes).toEqual(
			Array.from(subscriptionAfter),
		);
		expect(
			(await assets(page)).find((asset) => asset.id === subscriptionId)
				?.attachments,
		).toEqual([subscriptionCurrentFile.id]);
		await page.getByRole("main").getByRole("link", { name: "Back to list" }).click();
		await expect(
			page
				.locator("main.page .list-row")
				.filter({ hasText: subscriptionSaved }),
		).toContainText("90,071,992,547,409.91");
		const otherSubscription = await create(
			page,
			"subscription",
			subscriptionOther,
		);
		await selectChoice(otherSubscription.getByLabel("Category"), "service");
		await save(page);

		const itemCreate = await create(page, "item", item);
		await itemCreate
			.getByLabel("Tags (comma separated)")
			.pressSequentially("alpha, beta");
		await expect(itemCreate.getByLabel("Tags (comma separated)")).toHaveValue(
			"alpha, beta",
		);
		await itemCreate
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 98 }, (_, index) => `item${index}`),
				].join(","),
			);
		await itemCreate.getByLabel("Purchase date").fill("2028-02-29");
		await itemCreate.getByLabel("Warranty ends").fill("2030-02-28");
		await save(page);
		await detail(page, item);
		const itemId = new URL(page.url()).pathname.split("/").at(-1);
		if (!itemId) throw Error("Item ID missing");
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const itemEdit = page.getByRole("dialog");
		await itemEdit
			.getByLabel("Name", { exact: true })
			.fill("Cancelled item edit");
		await itemEdit.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByRole("heading", { name: item })).toBeVisible();
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		await itemEdit.getByLabel("Name", { exact: true }).fill("");
		await itemEdit.getByRole("button", { name: "Save" }).click();
		await expect(itemEdit.locator("#name-error")).toBeVisible();
		await itemEdit.getByLabel("Name", { exact: true }).fill(itemSaved);
		await itemEdit.getByLabel("Location").fill("L".repeat(301));
		await itemEdit.getByRole("button", { name: "Save" }).click();
		await expect(itemEdit.locator("#location-error")).toBeVisible();
		await itemEdit.getByLabel("Location").fill(location);
		await itemEdit
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 99 }, (_, index) => `item${index}`),
				].join(","),
			);
		await itemEdit.getByRole("button", { name: "Save" }).click();
		await expect(itemEdit.locator("#tags-error")).toBeVisible();
		await itemEdit
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 98 }, (_, index) => `item${index}`),
				].join(","),
			);
		await save(page);
		await expect(page.getByRole("heading", { name: itemSaved })).toBeVisible();
		expect(
			(await assets(page)).find((asset) => asset.id === itemId),
		).toMatchObject({
			purchaseDate: "2028-02-29",
			warrantyDate: "2030-02-28",
			location,
			tags: expect.arrayContaining([tag, longTag]),
		});
		const oldImage = await png(page, "#d43b45");
		await page.getByLabel("Add image").setInputFiles({
			name: "item-before.png",
			mimeType: "image/png",
			buffer: oldImage,
		});
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Confirm" })
			.click();
		await expect(page.locator(".asset-image")).toHaveCount(1);
		const oldFile = (await files(page)).find(
			(file) => file.name === "item-before.png",
		);
		if (!oldFile) throw Error("Original item image missing");
		const newImage = await png(page, "#247fc0");
		const chooser = page.waitForEvent("filechooser");
		await page.getByRole("button", { name: "Replace image" }).click();
		await (await chooser).setFiles({
			name: "item-after.png",
			mimeType: "image/png",
			buffer: newImage,
		});
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Confirm" })
			.click();
		await expect
			.poll(
				async () =>
					(await files(page)).find((file) => file.name === "item-after.png")
						?.id,
			)
			.toBeTruthy();
		const currentFile = (await files(page)).find(
			(file) => file.name === "item-after.png",
		);
		if (!currentFile) throw Error("Replacement item image missing");
		expect(await files(page)).toHaveLength(2);
		expect(currentFile.id).not.toBe(oldFile.id);
		expect(currentFile.bytes).toEqual(Array.from(newImage));
		await page.screenshot({
			path: `${evidence}/crud-matrix-en-1280-item-image-replaced.png`,
		});
		await page.getByRole("main").getByRole("link", { name: "Back to list" }).click();
		const otherItem = await create(page, "item", itemOther);
		await selectChoice(otherItem.getByLabel("Category"), "other");
		await save(page);

		for (const [kind, category, categoryOther, name, id] of [
			[
				"subscription",
				"Software",
				"Services",
				subscriptionSaved,
				subscriptionId,
			],
			["item", "Devices", "Other", itemSaved, itemId],
		] as const) {
			await page.goto(`/assets/${kind}`);
			await page.getByRole("button", { name: category, exact: true }).click();
			await selectChoice(page.locator("#asset-tag-filter"), { label: tag });
			const search = await openSearchInput(page);
			await search.fill(tag);
			await expect(page.locator("main.page .list-row")).toHaveCount(1);
			await page.getByRole("button", { name: category, exact: true }).click();
			await expectSearchClosed(page);
			await page.screenshot({
				path: `${evidence}/crud-matrix-en-1280-${kind}-filter.png`,
			});
			await page
				.getByRole("button", { name: categoryOther, exact: true })
				.click();
			await expect(page.locator("main.page .list-row")).toHaveCount(0);
			await page.screenshot({
				path: `${evidence}/crud-matrix-en-1280-${kind}-empty.png`,
			});
			await page.getByRole("button", { name: category, exact: true }).click();
			await openSearchInput(page);
			await expect(search).toHaveValue("");
			await search.fill(tag);
			const row = page.locator("main.page .list-row").filter({ hasText: name });
			await row.focus();
			await row.press("Enter");
			await expect(page.getByRole("heading", { name })).toBeVisible();
			await expectSearchClosed(page);
			await page.getByRole("main").getByRole("link", { name: "Back to list" }).click();
			await expectSearchClosed(page);
			await expect(page.locator("#asset-tag-filter")).toHaveAttribute("data-value", tag);
			await expect(
				page.getByRole("button", { name: category, exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await page.reload();
			await expectSearchClosed(page);
			await expect(page.locator("#asset-tag-filter")).toHaveAttribute("data-value", tag);
			await expect(page.getByRole("button", { name: category, exact: true })).toHaveAttribute("aria-pressed", "true");
			await openSearchInput(page);
			await expect(search).toHaveValue("");
			await search.fill(`no-results-${suffix}`);
			await expect(page.locator("main.page .list-row")).toHaveCount(0);
			await search.press("Escape");
			await expectSearchClosed(page);
			await expect(page.locator("main.page .list-row")).toHaveCount(1);
			await page
				.locator("main.page .list-row")
				.filter({ hasText: name })
				.click();
			expect(
				(await assets(page)).find((asset) => asset.id === id)?.deleted,
			).toBe(false);
			await trashCycle(page, kind, name);
			await page.reload();
			await expect(
				page.locator("main.page .list-row").filter({ hasText: name }),
			).toBeVisible();
		}

		const before = (await assets(page)).filter((asset) =>
			[subscriptionSaved, itemSaved, subscriptionOther, itemOther].includes(
				asset.name,
			),
		);
		const beforeHistory = await renewalHistory(page, subscriptionId);
		expect(beforeHistory).toHaveLength(1);
		expect(before).toHaveLength(4);
		expect(
			before.find((asset) => asset.id === subscriptionId)?.tags,
		).toHaveLength(100);
		expect(before.find((asset) => asset.id === itemId)?.tags).toHaveLength(100);
		expect(before.find((asset) => asset.id === itemId)?.attachments).toEqual([
			currentFile.id,
		]);
		expect(
			before.find((asset) => asset.id === subscriptionId)?.attachments,
		).toEqual([subscriptionCurrentFile.id]);
		expect(before.every((asset) => !asset.deleted)).toBe(true);
		await page.goto("/intake");
		await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: "Create backup" }).click();
		const downloadEvent = page.waitForEvent("download");
		await page.getByRole("link", { name: "Save backup file" }).click();
		const download = await downloadEvent;
		expect(download.suggestedFilename()).toMatch(/\.ka1$/);
		const backupPath = await download.path();
		if (!backupPath) throw Error("The browser did not save the .ka1 file");
		const destination = await browser.newContext({
			locale: "zh-CN",
			timezoneId: "Asia/Shanghai",
			viewport: { width: 390, height: 844 },
		});
		const restored = await destination.newPage();
		restored.on("pageerror", (error) => errors.push(error.message));
		try {
			await restored.goto("/assets/item");
			await expect(restored.getByText(itemSaved)).toHaveCount(0);
			await restored.goto("/intake");
			await restored.locator("#backup-password").fill(password);
			const restoreSection = restored.locator("details.intake-secondary").filter({ has: restored.locator("#restore-file") });
			await expect(restoreSection).toBeVisible();
			if ((await restoreSection.getAttribute("open")) === null)
				await restoreSection.locator(":scope > summary").click();
			await expect(restored.locator("#restore-file")).toBeVisible();
			await restored.locator("#restore-file").setInputFiles(backupPath);
			await restoreSection
				.getByRole("button", { name: "预览", exact: true })
				.click();
			await restored.getByRole("button", { name: /确认 ·/ }).click();
			await expect(restored.getByText(/已恢复 \d+ 条记录/)).toBeVisible();
			expect(
				(await assets(restored)).filter((asset) =>
					before.some((original) => original.id === asset.id),
				),
			).toEqual(before);
			expect(await renewalHistory(restored, subscriptionId)).toEqual(
				beforeHistory,
			);
			const restoredFiles = await files(restored);
			expect(restoredFiles).toHaveLength(2);
			expect(
				restoredFiles.find((file) => file.id === subscriptionCurrentFile.id),
			).toEqual(subscriptionCurrentFile);
			expect(restoredFiles.find((file) => file.id === currentFile.id)).toEqual(
				currentFile,
			);
			await restored.reload();
			await restored.goto(`/assets/item/${itemId}`);
			await expect(
				restored.getByRole("heading", { name: itemSaved }),
			).toBeVisible();
			await expect(restored.locator(".asset-image")).toHaveCount(1);
			await expect(restored.locator(".asset-image")).toBeVisible();
			await expect(restored.locator(".asset-image")).toHaveJSProperty("naturalWidth", 8);
			expect(
				await restored.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(390);
			await restored.screenshot({
				path: `${evidence}/crud-matrix-zh-390-restored-item.png`,
			});
			await restored.goto(`/assets/subscription/${subscriptionId}`);
			await expect(
				restored.getByRole("heading", { name: subscriptionSaved }),
			).toBeVisible();
			await expect(restored.locator(".asset-image")).toHaveCount(1);
			await expect(restored.locator(".asset-image")).toBeVisible();
			await expect(restored.locator(".asset-image")).toHaveJSProperty("naturalWidth", 8);
			expect(
				await restored.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(390);
			await restored.screenshot({
				path: `${evidence}/crud-matrix-zh-390-restored-subscription-image.png`,
				fullPage: true,
			});
		} finally {
			await destination.close();
		}
		await page.goto(`/assets/item/${itemId}`);
		await page.getByRole("button", { name: "Remove image" }).click();
		await expect(page.locator(".asset-image")).toHaveCount(0);
		await expect.poll(async () => (await files(page)).length).toBe(1);
		expect(
			(await assets(page)).find((asset) => asset.id === itemId)?.attachments,
		).toEqual([]);
		await page.goto(`/assets/subscription/${subscriptionId}`);
		await page.getByRole("button", { name: "Remove image" }).click();
		await expect(page.locator(".asset-image")).toHaveCount(0);
		await expect.poll(async () => (await files(page)).length).toBe(0);
		expect(
			(await assets(page)).find((asset) => asset.id === subscriptionId)
				?.attachments,
		).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await source.close();
	}
});

test("renewal hint preserves cents and matches blank or typed payments for USD and JPY", async ({
	browser,
}) => {
	test.setTimeout(90_000);
	mkdirSync(evidence, { recursive: true });
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 390, height: 844 },
	});
	const page = await context.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		for (const [currency, amountText, minorUnits, visibleAmount] of [
			[
				"USD",
				"90071992547409.91",
				Number.MAX_SAFE_INTEGER,
				"$90,071,992,547,409.91",
			],
			[
				"JPY",
				"9007199254740991",
				Number.MAX_SAFE_INTEGER,
				"¥9,007,199,254,740,991",
			],
		] as const) {
			const name = `Hint ${currency} ${crypto.randomUUID().slice(0, 8)}`;
			const dialog = await create(page, "subscription", name);
			await selectChoice(dialog.locator("#currency"), currency);
			await dialog.locator("#amount").fill(amountText);
			await dialog.locator("#dueDate").fill("2026-10-31");
			await save(page);
			await detail(page, name);
			const assetId = new URL(page.url()).pathname.split("/").at(-1);
			if (!assetId) throw Error("Subscription ID missing");
			const input = page.getByLabel("Locally recorded amount");
			await expect(input).toHaveAttribute("placeholder", amountText);
			const hint = await input.getAttribute("placeholder");
			if (!hint) throw Error("Renewal hint missing");
			await expect(input).toHaveValue("");
			for (const width of [360, 390]) {
				await page.setViewportSize({ width, height: 844 });
				const layout = await input.evaluate((element: HTMLInputElement) => {
					const style = getComputedStyle(element);
					const canvas = document.createElement("canvas");
					const measure = canvas.getContext("2d");
					if (!measure) throw Error("Text measurement unavailable");
					measure.font = style.font;
					return {
						fontSize: Number.parseFloat(style.fontSize),
						available:
							element.clientWidth -
							Number.parseFloat(style.paddingLeft) -
							Number.parseFloat(style.paddingRight) -
							24,
						textWidth: measure.measureText(element.placeholder).width,
						scrollWidth: document.documentElement.scrollWidth,
					};
				});
				expect(layout.fontSize).toBeGreaterThanOrEqual(16);
				expect(layout.available).toBeGreaterThan(layout.textWidth);
				expect(layout.scrollWidth).toBeLessThanOrEqual(width);
			}
			await page.screenshot({
				path: `${evidence}/crud-matrix-en-390-${currency.toLowerCase()}-renewal-hint.png`,
				fullPage: true,
			});
			const history = page
				.locator("section.card")
				.filter({ has: page.getByRole("heading", { name: "History" }) })
				.locator(".list-row");
			await page.getByRole("button", { name: "Record renewal" }).click();
			await expect(history).toHaveCount(1);
			await expect(history.first()).toContainText(visibleAmount);
			await expect(input).toHaveAttribute("placeholder", amountText);
			await input.fill(hint);
			await page.getByRole("button", { name: "Record renewal" }).click();
			await expect(history).toHaveCount(2);
			for (const row of await history.all())
				await expect(row).toContainText(visibleAmount);
			if (process.env.KEEPANY_SUBSCRIPTION_MODE !== "preview")
				expect(
					(await renewalHistory(page, assetId)).map((row) => row.amount),
				).toEqual([minorUnits, minorUnits]);
			await page.reload();
			await expect(input).toHaveAttribute("placeholder", amountText);
			await expect(history).toHaveCount(2);
			if (process.env.KEEPANY_SUBSCRIPTION_MODE !== "preview")
				expect(
					(await renewalHistory(page, assetId)).map((row) => row.amount),
				).toEqual([minorUnits, minorUnits]);
		}
		expect(errors).toEqual([]);
	} finally {
		await context.close();
	}
});

for (const locale of ["en-US", "zh-CN"] as const) {
	for (const width of [360, 390, 430]) {
		test(`${locale} subscription and item entry and editor fit ${width}px`, async ({
			browser,
		}) => {
			test.setTimeout(90_000);
			mkdirSync(evidence, { recursive: true });
			const context = await browser.newContext({
				locale,
				viewport: { width, height: 844 },
			});
			const page = await context.newPage();
			const copy =
				locale === "zh-CN"
					? {
							add: "新增",
							name: "名称",
							save: "保存",
							cancel: "取消",
							notes: "备注",
							edit: "编辑",
							subscription: "订阅与续费",
							item: "拥有的一切，一张卡片就能找到。",
						}
					: {
							add: "Add",
							name: "Name",
							save: "Save",
							cancel: "Cancel",
							notes: "Notes",
							edit: "Edit",
							subscription: "Subscriptions and renewals",
							item: "Find every item in one place.",
						};
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			try {
				for (const [kind, label] of [
					["subscription", copy.subscription],
					["item", copy.item],
				] as const) {
					await page.goto(`/assets/${kind}`);
					await expect(
						page.getByRole("heading", { level: 1, name: label }),
					).toBeVisible();
					await page
						.getByRole("button", { name: copy.add, exact: true })
						.click();
					const dialog = page.getByRole("dialog");
					await expect(dialog).toBeVisible();
					const name = `${kind} ${locale} ${width} ${"L".repeat(90)}`;
					await dialog.getByLabel(copy.name, { exact: true }).fill(name);
					if (kind === "subscription")
						await dialog.locator("#amount").fill("12.34");
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
					if (width <= 390) {
						const sizes = await dialog
							.locator("input, textarea, [role=combobox]")
							.evaluateAll((elements) =>
								elements.map((element) =>
									Number.parseFloat(getComputedStyle(element).fontSize),
								),
							);
						expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
						await expect(
							dialog.getByRole("button", { name: copy.cancel }),
						).toBeInViewport({ ratio: 1 });
						await expect(
							dialog.getByRole("button", { name: copy.save }),
						).toBeInViewport({ ratio: 1 });
					}
					await page.screenshot({
						path: `${evidence}/crud-matrix-${locale === "zh-CN" ? "zh" : "en"}-${width}-${kind}-editor.png`,
					});
					if (width <= 390) {
						await dialog.evaluate((element) =>
							element.scrollTo({ top: element.scrollHeight }),
						);
						const notes = await dialog.getByLabel(copy.notes).boundingBox();
						const actions = await dialog
							.locator("form > .actions")
							.boundingBox();
						if (!notes || !actions)
							throw Error("Editor notes or actions missing");
						expect(notes.y + notes.height).toBeLessThanOrEqual(actions.y + 1);
						await page.screenshot({
							path: `${evidence}/crud-matrix-${locale === "zh-CN" ? "zh" : "en"}-${width}-${kind}-editor-tail.png`,
						});
					}
					await dialog.getByRole("button", { name: copy.save }).click();
					await expect(dialog).toBeHidden();
					await page
						.locator("main.page .list-row")
						.filter({ hasText: name })
						.click();
					await expect(page.getByRole("heading", { name })).toBeVisible();
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
					await page
						.getByRole("button", { name: copy.edit, exact: true })
						.click();
					await expect(page.getByRole("dialog")).toBeVisible();
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
				}
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}

});




test.describe('F03-domain-errors — current mobile contract', () => {
  for (const locale of ['zh-CN', 'en'] as const) test(`${locale} domain validation, zero/missing fees and deletion confirmation`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ locale, timezoneId: 'Asia/Shanghai', viewport: { width: 390, height: 844 } });
    await context.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
    const page = await context.newPage();
    const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
    const repo = sourceModuleUrl('packages/local-db/src/index.ts');
    try {
      await page.clock.setFixedTime(new Date('2026-10-27T04:00:00Z'));
      await page.goto('/assets/project');
      await page.getByRole('button', { name: t('add'), exact: true }).click();
      let dialog = page.getByRole('dialog');
      await dialog.locator('#name').fill('Mobile domain validation');
      await dialog.getByRole('button', { name: t('save'), exact: true }).click();
      await expect(dialog).toBeHidden();
      await page.getByText('Mobile domain validation', { exact: true }).first().click();
      const id = new URL(page.url()).pathname.split('/').at(-1);
      if (!id) throw Error('missing-project-id');
      const read = () => page.evaluate(async ({ repo, id }) => (await (await import(repo)).localRepository()).get('asset', id), { repo, id });
      const accountId = await page.evaluate(async ({ repo, domain }) => { const account = { ...(await import(domain)).newAsset('account'), name: 'Domain registrar account' }; await (await import(repo)).save('asset', account); return account.id; }, { repo, domain: sourceModuleUrl('packages/domain/src/index.ts') });
      for (const [name, fee, date] of [['unknown.mobile.test', '', ''], ['zero.mobile.test', '0', '2026-10-26'], ['paid.mobile.test', '12.34', '2026-10-28']]) {
        await page.getByRole('button', { name: t('projectAddDomain'), exact: true }).click();
        dialog = page.getByRole('dialog');
        await dialog.getByLabel(t('projectDomain'), { exact: true }).fill(name);
        await dialog.getByLabel(t('projectRegistrar'), { exact: true }).fill('Boundary registrar');
        await selectChoice(dialog.locator('#project-domain-account'), accountId);
        await selectChoice(dialog.locator('#project-domain-auto-renew'), 'on');
        await dialog.getByLabel(t('projectAnnualFee')).fill(fee);
        await dialog.getByLabel(t('projectExpiry')).fill(date);
        await dialog.getByRole('button', { name: t('save'), exact: true }).click();
        await expect(dialog).toBeHidden();
      }
      await page.reload();
      const before = await read();
      expect(before.projectDomains.map((row: { annualAmount: number | null }) => row.annualAmount)).toEqual([null, 0, 1234]);
      expect(before.projectDomains.every((row: { accountId: string; autoRenew: string; registrar: string }) => row.accountId === accountId && row.autoRenew === 'on' && row.registrar === 'Boundary registrar')).toBe(true);
      // A cloned synthetic browser fixture checks pure-date presentation in a
      // second timezone; this is not a native backup/restore assertion.
      const losAngeles = await browser.newContext({ locale, timezoneId: 'America/Los_Angeles', viewport: { width: 390, height: 844 }, storageState: await context.storageState({ indexedDB: true }) });
      try {
        const local = await losAngeles.newPage(); await local.clock.setFixedTime(new Date('2026-10-27T04:00:00Z'));
        await local.goto('/assets/domains');
        const zero = local.locator('.workspace-domain-card').filter({ hasText: 'zero.mobile.test' });
        await expect(zero).toContainText(t('workspaceDueToday'));
        await zero.click();
        await local.locator('.asset-project-domain-row').filter({ hasText: 'zero.mobile.test' }).getByRole('button', { name: t('edit'), exact: true }).click();
        await expect(local.getByRole('dialog').getByLabel(t('projectExpiry'))).toHaveValue('2026-10-26');
        await local.screenshot({ path: test.info().outputPath('domain-los-angeles-pure-date.png'), fullPage: true });
      } finally { await losAngeles.close(); }
      await page.getByRole('button', { name: t('projectAddDomain'), exact: true }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel(t('projectDomain'), { exact: true }).fill('not a domain');
      await dialog.getByRole('button', { name: t('save'), exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveText(t('projectDomainNameInvalid'));
      await dialog.getByLabel(t('projectDomain'), { exact: true }).fill('ZERO.MOBILE.TEST');
      await dialog.getByRole('button', { name: t('save'), exact: true }).click();
      await expect(dialog.getByRole('alert')).toHaveText(t('duplicate'));
      await dialog.getByRole('button', { name: t('cancel'), exact: true }).click();
      expect(await read()).toEqual(before);
      await page.goto('/assets/domains');
      await expect(page.locator('.workspace-domain-card').filter({ hasText: 'unknown.mobile.test' })).toContainText(t('workspaceAmountMissing'));
      await expect(page.locator('.workspace-domain-card').filter({ hasText: 'zero.mobile.test' })).toContainText(locale === 'en' ? '1 day overdue' : '已过期 1 天');
      await expect(page.locator('.workspace-domain-card').filter({ hasText: 'paid.mobile.test' })).toContainText(locale === 'en' ? '1 day left' : '剩余 1 天');
      await page.screenshot({ path: test.info().outputPath('domain-date-fee-boundaries.png'), fullPage: true });
      await page.locator('.workspace-domain-card').filter({ hasText: 'zero.mobile.test' }).click();
      const domainRow = page.locator('.asset-project-domain-row').filter({ hasText: 'zero.mobile.test' });
      await domainRow.getByRole('button', { name: t('edit'), exact: true }).click();
      await page.getByRole('dialog').getByLabel(t('projectRegistrar'), { exact: true }).fill('Uncommitted registrar');
      await page.getByRole('dialog').getByRole('button', { name: t('projectDomainDelete'), exact: true }).click();
      // Contract requires a cancellable delete decision before the domain is removed.
      await expect(page.getByRole('dialog').getByRole('button', { name: t('confirm'), exact: true })).toBeVisible();
      expect((await read()).projectDomains).toEqual(before.projectDomains);
      await page.getByRole('dialog').last().getByRole('button', { name: t('cancel'), exact: true }).click();
      await expect(page.getByRole('dialog').getByLabel(t('projectRegistrar'), { exact: true })).toHaveValue('Uncommitted registrar');
      expect((await read()).projectDomains).toEqual(before.projectDomains);
      await page.getByRole('dialog').getByRole('button', { name: t('projectDomainDelete'), exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog').getByLabel(t('projectRegistrar'), { exact: true })).toHaveValue('Uncommitted registrar');
      await page.getByRole('dialog').getByRole('button', { name: t('projectDomainDelete'), exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: t('confirm'), exact: true }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
      await page.reload();
      expect((await read()).projectDomains).toEqual(before.projectDomains.filter((row: { name: string }) => row.name !== 'zero.mobile.test'));
      await page.locator('.asset-project-domain-row').filter({ hasText: 'paid.mobile.test' }).getByRole('button', { name: t('edit'), exact: true }).click();
      await page.getByRole('dialog').getByLabel(t('projectRegistrar'), { exact: true }).fill('Stale registrar draft');
      // Explicit C fault: another writer saves after this editor captured its base.
      const newer = await page.evaluate(async ({ repo, id }) => {
        const db = await (await import(repo)).localRepository(), current = await db.get('asset', id);
        const next = { ...current, description: 'Other writer wins', projectDomains: [...current.projectDomains, { ...current.projectDomains[0], id: crypto.randomUUID(), name: 'concurrent.mobile.test' }], updatedAt: new Date().toISOString() };
        await db.saveAssetIfCurrent(current, next); return next;
      }, { repo, id });
      await page.getByRole('dialog').getByRole('button', { name: t('save'), exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(t('assetStale'));
      await expect(page.getByRole('dialog').getByLabel(t('projectRegistrar'), { exact: true })).toHaveValue('Stale registrar draft');
      expect(await read()).toEqual(newer);
      await page.getByRole('dialog').getByRole('button', { name: t('projectDomainDelete'), exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: t('confirm'), exact: true }).click();
      await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(t('assetStale'));
      expect(await read()).toEqual(newer);
      await page.getByRole('dialog').getByRole('button', { name: t('cancel'), exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: t('cancel'), exact: true }).click();
      await page.reload();
      await expect(page.locator('.asset-project-domain-row')).toHaveCount(3);
    } finally {
      if (!page.isClosed()) await page.screenshot({ path: test.info().outputPath('domain-delete-actual.png'), fullPage: true, timeout: 3000, animations: 'disabled' }).catch(() => undefined);
      await context.close();
    }
  });
});

test('F03-04 minimal mobile domain deletion must wait for confirmation', async ({ page }) => {
  const repo = sourceModuleUrl('packages/local-db/src/index.ts'), domain = sourceModuleUrl('packages/domain/src/index.ts');
  await page.goto('/assets');
  const fixture = await page.evaluate(async ({ repo, domain }) => {
    const project = { ...(await import(domain)).newAsset('project'), name: 'Delete decision mobile', projectDomains: [{ id: crypto.randomUUID(), name: 'decision.mobile.test', annualAmount: null, currency: 'CNY', expiryDate: '', registrar: '', accountId: '', autoRenew: 'unknown' }] };
    await (await import(repo)).save('asset', project);
    return project;
  }, { repo, domain });
  await page.goto(`/assets/project/${fixture.id}`);
  await page.locator('.asset-project-domain-row').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete domain', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('This removes only its record from this project.');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  const count = await page.evaluate(async ({ repo, id }) => (await (await (await import(repo)).localRepository()).get('asset', id)).projectDomains.length, { repo, id: fixture.id });
  await test.info().attach('domain-delete-before-confirm-count', { body: JSON.stringify({ domainCountBefore: 1, domainCountAfterDeleteClick: count }), contentType: 'application/json' });
  expect(count, 'click Delete domain must open a confirmation before mutating the project').toBe(1);
  await page.getByRole('dialog').last().getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.asset-project-domain-row')).toHaveCount(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Delete domain', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.asset-project-domain-row')).toHaveCount(0);
});


test.describe('F01-complete-navigation — mobile UI', () => {
  for (const locale of ['zh-CN', 'en'] as const) test(`${locale} empty sample flow, every More tool and persisted language switch`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
    await context.addInitScript(language => { if (!localStorage.getItem('keepany-language')) localStorage.setItem('keepany-language', language); }, locale);
    const page = await context.newPage();
    const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
    try {
      await page.goto('/');
      await expect(page.locator('.overview-stats .overview-stat').first().locator('strong')).toHaveText('0');
      await page.getByRole('link', { name: t('overviewTrySample'), exact: true }).click();
      await page.getByRole('button', { name: t('loadSample'), exact: true }).click();
      await page.locator('.mobile-tabbar a[href="/"]').click();
      await expect(page.locator('.overview-stats .overview-stat').first().locator('strong')).toHaveText('5');
      const project = page.locator('.overview-project-card').first();
      const destination = await project.getAttribute('href');
      await project.click(); await expect(page).toHaveURL(new RegExp(`${destination}$`));
      await expect(page.getByRole('heading', { name: t('sampleProject'), exact: true })).toBeVisible();
      await page.locator('.mobile-tabbar a[href="/more"]').click();
      const hrefs = await page.locator('.mobile-more-page a.mobile-tool').evaluateAll(nodes => nodes.map(node => node.getAttribute('href') ?? ''));
      expect(hrefs).toHaveLength(16);
      for (const href of hrefs) {
        await page.locator(`.mobile-more-page a.mobile-tool[href="${href}"]`).click();
        await expect(page.locator('main')).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
        await page.locator('.mobile-tabbar a[href="/more"]').click();
        await expect(page.locator('.mobile-more-page')).toBeVisible();
      }
      await page.locator('.mobile-more-page').getByRole('button', { name: new RegExp(t('mobileAskAssistant')) }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await page.screenshot({ path: test.info().outputPath('all-more-tools-returned-390.png'), fullPage: true });
      await page.goto('/settings');
      await selectChoice(page.getByRole('combobox', { name: t('language'), exact: true }), locale === 'en' ? 'zh-CN' : 'en');
      await page.reload();
      await expect(page.getByRole('heading', { name: locale === 'en' ? resources['zh-CN'].translation.language : resources.en.translation.language, exact: true })).toBeVisible();
      for (const width of [360, 430]) {
        await page.setViewportSize({ width, height: 844 });
        await page.locator('.top-search-trigger').click();
        await page.locator('#top-search-query').fill('Mobile no matching sample');
        await expect(page.locator('#top-search-query')).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`language-switched-search-${width}.png`), fullPage: true });
        await page.keyboard.press('Escape');
      }
    } finally { await context.close(); }
  });
});

test.describe('F08-round-history — mobile UI', () => {
  for (const locale of ['zh-CN', 'en'] as const) test(`${locale} proposal cancellation and a second round preserve editable old evidence`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
    await context.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
    const page = await context.newPage();
    const repo = sourceModuleUrl('packages/local-db/src/index.ts');
    const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
    try {
      await page.goto('/assets/project');
      await page.getByRole('button', { name: t('add'), exact: true }).click();
      await page.getByRole('dialog').locator('#name').fill('Mobile rounds');
      await page.getByRole('dialog').getByRole('button', { name: t('save'), exact: true }).click();
      await expect(page.getByRole('dialog')).toBeHidden();
      await page.getByText('Mobile rounds', { exact: true }).first().click();
      const id = new URL(page.url()).pathname.split('/').at(-1);
      const read = () => page.evaluate(async ({ repo, id }) => ({ project: await (await (await import(repo)).localRepository()).get('asset', id), tasks: (await (await (await import(repo)).localRepository()).list('task')).filter((task: { assetId: string }) => task.assetId === id) }), { repo, id });
      await page.getByRole('link', { name: t('workflowBrandEntry'), exact: true }).click();
      await page.getByLabel(t('workflowProposedName')).fill('Cancelled proposal');
      await page.locator('main.project-workflow-page > .back-link').click();
      expect((await read()).tasks).toHaveLength(0);
      expect((await read()).project.name).toBe('Mobile rounds');
      await page.getByRole('link', { name: t('workflowBrandEntry'), exact: true }).click();
      await page.getByLabel(t('workflowProposedName')).fill('First proposed name');
      await page.getByRole('button', { name: t('workflowCreatePlan'), exact: true }).click();
      const rows = page.locator('.project-workflow-task');
      await expect(rows.first()).toBeVisible();
      await expect(page.getByRole('button', { name: t('workflowNewRound'), exact: true })).toBeDisabled();
      const total = await rows.count();
      for (let index = 0; index < total; index++) {
        const row = rows.nth(index);
        await row.getByRole('button', { name: t('workflowRecordResult'), exact: true }).click();
        await selectChoice(row.getByLabel(t('workflowResult')), 'na');
        await row.getByLabel(t('workflowEvidence')).fill(`First round synthetic evidence ${index}`);
        await row.getByRole('button', { name: t('workflowSaveRecord'), exact: true }).click();
        await expect(row).toHaveAttribute('data-outcome', 'na');
      }
      const first = await read();
      await page.getByRole('button', { name: t('workflowNewRound'), exact: true }).click();
      await page.getByLabel(t('workflowProposedName')).fill('Second proposed name');
      await page.getByRole('button', { name: t('workflowCreatePlan'), exact: true }).click();
      await expect(page.getByRole('button', { name: t('workflowCreatePlan'), exact: true })).toHaveCount(0);
      await expect(page.locator('.project-workflow-before-after')).toContainText('Second proposed name');
      const second = await read();
      expect(second.tasks.length).toBe(total * 2);
      for (const original of first.tasks) expect(second.tasks.find((task: { id: string }) => task.id === original.id)).toEqual(original);
      const newRows = second.tasks.filter((task: { id: string }) => !first.tasks.some((old: { id: string }) => old.id === task.id));
      await page.goto(`/tasks#task-${first.tasks[0].id}`);
      const old = page.locator(`#task-${first.tasks[0].id}`);
      await expect(old).toContainText(first.tasks[0].projectWorkflow.record.evidence);
      await old.getByRole('button', { name: t('workflowEditRecord'), exact: true }).click();
      await old.getByLabel(t('workflowEvidence')).fill('Reviewed old round evidence');
      await old.getByRole('button', { name: t('workflowSaveRecord'), exact: true }).click();
      await expect(old.locator('.project-workflow-record')).toContainText('Reviewed old round evidence');
      await page.reload();
      await expect(old).toContainText('Reviewed old round evidence');
      const after = await read();
      for (const current of newRows) expect(after.tasks.find((task: { id: string }) => task.id === current.id)).toEqual(current);
      await page.screenshot({ path: test.info().outputPath('old-round-evidence-with-new-round-preserved.png'), fullPage: true });
    } finally { await context.close(); }
  });
});

test('F12-04 finance exposes currency date and keyword intersection controls on mobile', async ({ page }) => {
  await page.goto('/finance');
  await expect(page.locator('#finance-filter-currency')).toBeVisible();
  await expect(page.locator('#finance-filter-from')).toBeVisible();
  await expect(page.locator('#finance-filter-to')).toBeVisible();
  await expect(page.locator('#finance-filter-query')).toBeVisible();
});

test.describe('F12-04-intersection — mobile ledger state', () => {
  for (const locale of ['zh-CN', 'en'] as const) test(`${locale} currency dates query and source intersect and survive return reload and deleted currency`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ locale, timezoneId: locale === 'en' ? 'America/Los_Angeles' : 'Asia/Shanghai', viewport: { width: 390, height: 844 } });
    await context.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
    const page = await context.newPage();
    const repo = sourceModuleUrl('packages/local-db/src/index.ts'), domain = sourceModuleUrl('packages/domain/src/index.ts');
    const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
    try {
      await page.goto('/finance');
      const ids = await page.evaluate(async ({ repo, domain }) => {
        const { newAsset, historySchema } = await import(domain), { saveBatch } = await import(repo);
        const project = { ...newAsset('project'), name: 'Filter owner project' }, account = { ...newAsset('account'), name: 'Filter account' }, subscription = { ...newAsset('subscription'), name: 'Undated renewal owner' };
        const bill = historySchema.parse({ id: crypto.randomUUID(), assetId: project.id, assetIds: [project.id, account.id], action: 'expense', title: 'Alpha shared bill', source: 'Filter bank', note: 'Local invoice detail', amount: 1234, currency: 'USD', eventDate: '2026-10-27', createdAt: '2026-10-27T00:30:00.000Z' });
        const zero = historySchema.parse({ ...bill, id: crypto.randomUUID(), action: 'balance', title: 'Zero balance observation', amount: 0, eventDate: '2026-10-26', assetIds: [project.id] });
        const undated = historySchema.parse({ id: crypto.randomUUID(), assetId: subscription.id, action: 'renew', title: 'Undated unknown amount', note: '', createdAt: '' });
        const refund = historySchema.parse({ ...bill, id: crypto.randomUUID(), action: 'refund', title: 'CNY refund', currency: 'CNY', amount: 200, eventDate: '2026-10-28' });
        const yen = historySchema.parse({ ...bill, id: crypto.randomUUID(), assetId: account.id, assetIds: [account.id], title: 'Only yen record', amount: 300, currency: 'JPY' });
        const deleted = historySchema.parse({ ...bill, id: crypto.randomUUID(), title: 'Deleted hidden bill', deleted: true });
        await saveBatch([...[project, account, subscription].map(value => ({ type: 'asset', value })), ...[bill, zero, undated, refund, yen, deleted].map(value => ({ type: 'history', value }))]);
        return { project: project.id, bill: bill.id, zero: zero.id, undated: undated.id, yen: yen.id };
      }, { repo, domain });
      await page.reload();
      const rows = page.locator('.finance-entry');
      await expect(rows).toHaveCount(5);
      await selectChoice(page.locator('#finance-filter-type'), 'expense');
      await selectChoice(page.locator('#finance-filter-asset'), ids.project);
      await selectChoice(page.locator('#finance-filter-source'), 'source:Filter bank');
      await selectChoice(page.locator('#finance-filter-currency'), 'USD');
      await page.locator('#finance-filter-from').fill('2026-10-27');
      await page.locator('#finance-filter-to').fill('2026-10-27');
      await page.locator('#finance-filter-query').fill('ＡＬＰＨＡ');
      await expect(rows).toHaveCount(1); await expect(rows.first()).toHaveAttribute('id', `finance-entry-${ids.bill}`);
      await expect(rows.first()).toContainText(locale === 'en' ? 'Oct 27, 2026' : '2026年10月27日');
      await page.locator('.top-search-trigger').click();
      await page.locator('#top-search-query').fill('Filter owner project');
      await page.locator(`.top-search-panel a[href="/assets/project/${ids.project}"]`).click();
      await expect(page.getByRole('heading', { name: 'Filter owner project', exact: true })).toBeVisible();
      await page.goBack(); await page.reload();
      await expect(page.locator('#finance-filter-currency')).toHaveAttribute('data-value', 'USD');
      await expect(page.locator('#finance-filter-from')).toHaveValue('2026-10-27');
      await expect(page.locator('#finance-filter-query')).toHaveValue('ＡＬＰＨＡ');
      await expect(rows).toHaveCount(1);
      await page.screenshot({ path: test.info().outputPath('ledger-intersection-restored-390.png'), fullPage: true });
      await page.locator('#finance-filter-from').fill('2026-10-28');
      await expect(page.getByRole('alert')).toHaveText(t('financeFilterDateInvalid')); await expect(rows).toHaveCount(0);
      await page.getByRole('button', { name: t('financeFilterClear'), exact: true }).click();
      await expect(rows).toHaveCount(5);
      await page.locator('#finance-filter-query').fill('No matching invoice'); await expect(rows).toHaveCount(0);
      await page.reload(); await expect(page.locator('#finance-filter-query')).toHaveValue('No matching invoice'); await expect(rows).toHaveCount(0);
      await page.getByRole('button', { name: t('financeFilterClear'), exact: true }).click();
      await expect(page.locator(`#finance-entry-${ids.zero} > b`)).toContainText('0.00');
      await expect(page.locator(`#finance-entry-${ids.undated} > b`)).toHaveCount(0);
      await page.locator('#finance-filter-from').fill('2026-10-27'); await expect(page.locator(`#finance-entry-${ids.undated}`)).toHaveCount(0);
      await page.getByRole('button', { name: t('financeFilterClear'), exact: true }).click();
      await selectChoice(page.locator('#finance-filter-currency'), 'JPY'); await expect(rows).toHaveCount(1);
      await rows.first().getByRole('button', { name: t('financeDeleteAction'), exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: t('financeDeleteAction'), exact: true }).click();
      await expect(page.getByRole('dialog')).toBeHidden(); await expect(rows).toHaveCount(0);
      await page.reload(); await expect(page.locator('#finance-filter-currency')).toHaveAttribute('data-value', 'JPY'); await expect(rows).toHaveCount(0);
      await page.getByRole('button', { name: t('financeFilterClear'), exact: true }).click(); await expect(rows).toHaveCount(4);
      for (const width of [360, 430]) {
        await page.setViewportSize({ width, height: 844 });
        await page.locator('#finance-filter-query').focus();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`ledger-controls-${width}.png`), fullPage: true });
      }
    } finally { await context.close(); }
  });
});

test.describe('F02-complete-facts — mobile ordinary assets', () => {
  for (const locale of ['zh-CN', 'en'] as const) test(`${locale} dual account facts, subscription links and item lifecycle fields persist`, async ({ browser }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
    await context.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
    const page = await context.newPage();
    const repo = sourceModuleUrl('packages/local-db/src/index.ts'), domain = sourceModuleUrl('packages/domain/src/index.ts');
    const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
    const readNamed = (name: string) => page.evaluate(async ({ repo, name }) => (await (await (await import(repo)).localRepository()).list('asset')).find((row: { name: string }) => row.name === name), { repo, name });
    try {
      await page.goto('/assets/account'); await page.getByRole('button', { name: t('add'), exact: true }).click();
      let form = page.getByRole('dialog');
      for (const [field, value] of [['name','Mobile complete account'],['accountProvider','Synthetic provider'],['username','owner@example.test'],['contact','+15550000000'],['description','Project administrator'],['url','https://account.example.test'],['tags','alpha, beta'],['notes','Ordinary local account note'],['accountProfileVerifiedAt','2026-10-27']]) await form.locator(`#${field}`).fill(value);
      await selectChoice(form.locator('#status'), 'paused');
      await form.getByRole('button', { name: t('save'), exact: true }).click(); await expect(form).toBeHidden(); await page.reload();
      const account = await readNamed('Mobile complete account');
      expect(account).toMatchObject({ kind: 'account', accountProvider: 'Synthetic provider', username: 'owner@example.test', contact: '+15550000000', description: 'Project administrator', url: 'https://account.example.test', tags: ['alpha','beta'], notes: 'Ordinary local account note', accountProfileVerifiedAt: '2026-10-27', status: 'paused' });
      const projectId = await page.evaluate(async ({ repo, domain }) => { const project = { ...(await import(domain)).newAsset('project'), name: 'Full subscription owner' }; await (await import(repo)).save('asset', project); return project.id; }, { repo, domain });
      await page.goto('/assets/subscription'); await page.getByRole('button', { name: t('add'), exact: true }).click(); form = page.getByRole('dialog');
      for (const [field,value] of [['name','Mobile complete subscription'],['amount','12.34'],['interval','2'],['dueDate','2026-10-27'],['trialEndsAt','2026-10-28'],['discountAmount','13.00'],['discountUntil','2026-10-30'],['subscriptionPaymentMethod','Synthetic invoice'],['url','https://subscription.example.test'],['tags','alpha, beta'],['notes','Subscription local note']]) await form.locator(`#${field}`).fill(value);
      await selectChoice(form.locator('#currency'), 'USD'); await selectChoice(form.locator('#cycle'), 'week');
      await selectChoice(form.locator('#subscriptionProject'), projectId); await selectChoice(form.locator('#subscriptionLoginAccount'), account.id);
      await form.getByRole('button', { name: t('save'), exact: true }).click(); await expect(form.locator('#discountAmount-error')).toBeVisible();
      await form.locator('#discountAmount').fill('2.34'); await form.getByRole('button', { name: t('save'), exact: true }).click(); await expect(form).toBeHidden(); await page.reload();
      const subscription = await readNamed('Mobile complete subscription');
      expect(subscription).toMatchObject({ kind: 'subscription', amount: 1234, currency: 'USD', cycle: 'week', interval: 2, dueDate: '2026-10-27', billingAnchor: '2026-10-27', trialEndsAt: '2026-10-28', discountAmount: 234, discountUntil: '2026-10-30', subscriptionPaymentMethod: 'Synthetic invoice', tags: ['alpha','beta'], notes: 'Subscription local note' });
      const relations = await page.evaluate(async ({ repo, id }) => (await (await (await import(repo)).localRepository()).list('relation')).filter((row: { from: string; to: string }) => row.from === id || row.to === id), { repo, id: subscription.id });
      expect(relations.some((row: { from: string; to: string }) => row.from === projectId || row.to === projectId)).toBe(true);
      expect(relations.some((row: { from: string; to: string }) => row.from === account.id || row.to === account.id)).toBe(true);
      await page.goto('/assets/item'); await page.getByRole('button', { name: t('add'), exact: true }).click(); form = page.getByRole('dialog');
      for (const [field,value] of [['name','Mobile lifecycle item'],['amount','0'],['purchaseDate','2026-10-01'],['itemStartDate','2026-10-02'],['warrantyDate','2027-10-01'],['location','Studio shelf'],['tags','alpha, beta'],['notes','Item local note']]) await form.locator(`#${field}`).fill(value);
      await selectChoice(form.locator('#currency'), 'USD'); await selectChoice(form.locator('#itemWarrantyStatus'), 'inWarranty');
      await form.getByRole('button', { name: t('save'), exact: true }).click(); await expect(form).toBeHidden(); await page.reload();
      const item = await readNamed('Mobile lifecycle item');
      expect(item).toMatchObject({ kind: 'item', amount: 0, currency: 'USD', itemPurchasePriceKnown: true, purchaseDate: '2026-10-01', itemStartDate: '2026-10-02', warrantyDate: '2027-10-01', itemWarrantyStatus: 'inWarranty', location: 'Studio shelf', notes: 'Item local note' });
      await page.getByText('Mobile lifecycle item', { exact: true }).first().click();
      for (const status of ['inUse','idle','repairing','resold','retired']) {
        await page.getByRole('button', { name: t('itemStatusChange'), exact: true }).click();
        const dialog = page.getByRole('dialog'); await selectChoice(dialog.locator('#item-lifecycle-status'), status);
        await dialog.locator('#item-status-date').fill('2026-10-27'); await dialog.locator('#item-status-note').fill(`Synthetic lifecycle ${status}`);
        await dialog.getByRole('button', { name: t('itemStatusSave'), exact: true }).click(); await expect(dialog).toBeHidden();
      }
      await page.reload(); const final = await readNamed('Mobile lifecycle item');
      expect(final).toMatchObject({ id: item.id, itemLifecycleStatus: 'retired', itemStatusDate: '2026-10-27', itemStartDate: '2026-10-02', itemWarrantyStatus: 'inWarranty' });
      const history = await page.evaluate(async ({ repo, id }) => (await (await (await import(repo)).localRepository()).list('history')).filter((row: { assetId: string; action: string }) => row.assetId === id && row.action === 'itemStatus'), { repo, id: item.id });
      expect(history).toHaveLength(5);
      expect(history.map((row: { itemStatusAfter: string }) => row.itemStatusAfter).sort()).toEqual(['idle','inUse','repairing','resold','retired'].sort());
      await page.screenshot({ path: test.info().outputPath('complete-item-lifecycle.png'), fullPage: true });
    } finally { await context.close(); }
  });
});


test.describe('Open contract gaps — actual mobile UI red', () => {
  test.use({ actionTimeout: 10_000 });
  test('F13-01 standalone task creation must let the user select its target asset', async ({ page }) => {
    await page.goto('/tasks');
    await page.getByRole('button', { name: 'New task', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('combobox')).toBeVisible();
  });
  test('F13-03 ordinary task must offer a cancellable delete action', async ({ page }) => {
    await page.goto('/tasks'); await page.getByRole('button', { name: 'New task', exact: true }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Name', { exact: true }).fill('Mobile removal contract task');
    await form.getByRole('button', { name: 'Save', exact: true }).click(); await expect(form).toBeHidden();
    await expect(page.locator('.impact-task-row').filter({ hasText: 'Mobile removal contract task' }).getByRole('button', { name: /^(Move to trash|Delete)$/ })).toBeVisible();
  });
  test('F12-02 a deleted bill must be offered in the recycle bin for restoration', async ({ page }) => {
    const repo = sourceModuleUrl('packages/local-db/src/index.ts'), domain = sourceModuleUrl('packages/domain/src/index.ts');
    await page.goto('/finance');
    await page.evaluate(async ({ repo, domain }) => {
      const { newAsset, historySchema } = await import(domain), { saveBatch } = await import(repo);
      const account = { ...newAsset('account'), name: 'Bill restoration owner' };
      const bill = historySchema.parse({ id: crypto.randomUUID(), assetId: account.id, action: 'expense', title: 'Mobile bill restoration contract', amount: 1234, currency: 'USD', eventDate: '2026-10-27', note: '', createdAt: new Date().toISOString() });
      await saveBatch([{ type: 'asset', value: account }, { type: 'history', value: bill }]);
    }, { repo, domain });
    await page.reload(); const row = page.locator('.finance-entry').filter({ hasText: 'Mobile bill restoration contract' });
    await row.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden();
    await page.locator('.mobile-tabbar a[href="/more"]').click();
    await page.locator('.mobile-more-page a[href="/trash"]').click();
    await expect(page.getByText('Mobile bill restoration contract', { exact: true })).toBeVisible();
  });
});
