import { expect, test, type Page } from "@playwright/test";

const domainUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
const repositoryUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

async function createAsset(page: Page) {
	return page.evaluate(async ([domainModule, repositoryModule]) => {
		const { newAsset } = await import(domainModule);
		const { save } = await import(repositoryModule);
		const asset = { ...newAsset("item"), name: "Test laptop" };
		await save("asset", asset);
		return asset.id as string;
	}, [domainUrl, repositoryUrl]);
}

test("maintenance plan keeps an estimated amount and advances fixed dates with evidence", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 850 });
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("keepany-language", "en"));
	const assetId = await createAsset(page);
	await page.goto("/tasks");
	await page.getByRole("button", { name: "New maintenance plan" }).click();
	const editor = page.getByRole("dialog");
	await editor.getByLabel("Plan name").fill("Clean laptop");
	await editor.getByLabel("Linked asset").selectOption(assetId);
	await editor.getByLabel("Repeat rule").selectOption("fixed");
	await editor.getByLabel("Interval", { exact: true }).fill("1");
	await editor.getByLabel("Interval unit").selectOption("month");
	await editor.getByLabel("Next date").fill("2026-01-31");
	await editor.getByLabel("Remind days early").fill("7");
	await editor.getByLabel("Planned amount (optional)").fill("50.00");
	await editor.getByRole("button", { name: "Create plan" }).click();
	const row = page.locator(".maintenance-task-row");
	await expect(row).toContainText("Clean laptop");
	await expect(row).toContainText("Test laptop");
	await expect(row).toContainText("Jan 24, 2026");
	await expect(row).toContainText("50.00");
	await row.getByRole("button", { name: "Confirm complete" }).click();
	await row.getByLabel("Action date").fill("2026-01-30");
	await row.getByLabel("Evidence or note").fill("Cleaned and checked the laptop");
	await row.getByRole("button", { name: "Save action record" }).click();
	await expect(row).toContainText("Feb 28, 2026");
	await row.getByRole("button", { name: "Skip this occurrence" }).click();
	await row.getByLabel("Action date").fill("2026-02-20");
	await row.getByLabel("Evidence or note").fill("Maintenance was not needed this month");
	await row.getByRole("button", { name: "Save action record" }).click();
	await expect(row).toContainText("Mar 31, 2026");
	await row.getByText("Action history · 2").click();
	await expect(row).toContainText("Cleaned and checked the laptop");
	await expect(row).toContainText("Maintenance was not needed this month");
	await page.reload();
	await expect(page.locator(".maintenance-task-row")).toContainText("Mar 31, 2026");
	await expect(page.evaluate(async repositoryModule => {
		const { localRepository } = await import(repositoryModule);
		const repository = await localRepository();
		const rows = await repository.allRecords();
		const task = rows.filter((row: { type: string }) => row.type === "task").map((row: { payload: string }) => JSON.parse(row.payload)).find((value: { name: string }) => value.name === "Clean laptop");
		return { amount: task.maintenancePlan.schedule.plannedAmountMinor, records: task.maintenancePlan.records.length, dueDate: task.dueDate, financeRows: rows.filter((row: { type: string; payload: string }) => row.type === "history" && ["expense", "topup", "refund", "balance"].includes(JSON.parse(row.payload).action)).length };
	}, repositoryUrl)).resolves.toEqual({ amount: 5000, records: 2, dueDate: "2026-03-31", financeRows: 0 });
	await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
});

test("one-time skip closes its plan; ordinary tasks keep their existing toggle", async ({ page }) => {
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("keepany-language", "zh-CN"));
	const assetId = await createAsset(page);
	await page.goto("/tasks");
	await page.getByRole("button", { name: "新建维护计划" }).click();
	const editor = page.getByRole("dialog");
	await editor.getByLabel("计划名称").fill("保修核查");
	await editor.getByLabel("关联资产").selectOption(assetId);
	await editor.getByLabel("下次日期").fill("2026-10-19");
	await editor.getByRole("button", { name: "创建计划" }).click();
	const row = page.locator(".maintenance-task-row");
	await row.getByRole("button", { name: "跳过本次" }).click();
	await row.getByLabel("处理日期").fill(await page.evaluate(() => {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	}));
	await row.getByLabel("处理依据或说明").fill("设备已经出售，无需检查保修");
	await row.getByRole("button", { name: "保存处理记录" }).click();
	await expect(row).toContainText("已跳过");
	await expect(row.getByRole("button", { name: "确认完成" })).toHaveCount(0);
	await page.getByRole("button", { name: "新建待办" }).click();
	const simple = page.getByRole("dialog");
	await simple.getByLabel("名称").fill("整理保修发票");
	await simple.getByRole("button", { name: "保存" }).click();
	const ordinary = page.locator(".list-row").filter({ hasText: "整理保修发票" });
	await ordinary.getByRole("button", { name: "完成" }).click();
	await expect(ordinary).toContainText("已完成");
});
