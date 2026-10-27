import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";

// Healthy-contract coverage for T02: the original merged-workspace fixture uses
// only one past purchase date and future expiry dates. These cases exercise the
// date boundaries, deleted task, duplicate relation and separate currencies.
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/keepany-summary-qa";
mkdirSync(evidence, { recursive: true });
const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainPath = `/@fs${process.cwd()}/packages/domain/src/index.ts`;

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

for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
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
		for (const width of [360, 768, 1440]) {
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
