import { expect, test, type Page } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const domainUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
const repositoryUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

async function seedAsset(page: Page) {
	return page.evaluate(async ([domainModule, repositoryModule]) => {
		const { newAsset } = await import(domainModule);
		const { save } = await import(repositoryModule);
		const asset = { ...newAsset("item"), name: "Studio laptop" };
		await save("asset", asset);
		return asset.id as string;
	}, [domainUrl, repositoryUrl]);
}

for (const locale of ["zh-CN", "en"] as const) {
	test(`tasks page keeps the reference layout and real plan details in ${locale}`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto("/");
		await page.evaluate((value) => localStorage.setItem("keepany-language", value), locale);
		const assetId = await seedAsset(page);
		await page.goto("/tasks");
		await page.getByRole("button", { name: locale === "en" ? "New maintenance plan" : "新建维护计划" }).click();
		const editor = page.getByRole("dialog");
		await editor.getByLabel(locale === "en" ? "Plan name" : "计划名称").fill("Laptop review");
		await selectChoice(editor.getByLabel(locale === "en" ? "Linked asset" : "关联资产"), assetId);
		await editor.getByLabel(locale === "en" ? "Next date" : "下次日期").fill("2026-11-05");
		await editor.getByLabel(locale === "en" ? "Planned amount (optional)" : "计划金额（可选）").fill("50");
		await editor.getByRole("button", { name: locale === "en" ? "Create plan" : "创建计划" }).click();

		const list = page.locator(".tasks-list-card");
		const details = page.locator(".tasks-plan-card");
		await expect(page.locator(".tasks-page .page-header h1")).toHaveText(locale === "en" ? "Keep a record after every reminder." : "提醒之后，还要留下完成记录。");
		await expect(list).toContainText("Laptop review");
		await expect(details).toContainText("Studio laptop");
		await expect(details).toContainText("50");
		const listBox = await list.boundingBox();
		const detailBox = await details.boundingBox();
		expect(listBox && detailBox && detailBox.x > listBox.x + listBox.width).toBeTruthy();
		await page.screenshot({ path: `/tmp/keepany-tasks-${locale}-1280.png`, fullPage: true });

		await page.getByRole("button", { name: /^(已完成|Completed) · 0$/ }).click();
		await expect(list).not.toContainText("Laptop review");
		await details.getByRole("button", { name: locale === "en" ? "View tasks →" : "查看待办 →" }).click();
		await expect(page.getByRole("button", { name: /^(全部|All) · 1$/ })).toHaveAttribute("aria-pressed", "true");
		await expect(list).toContainText("Laptop review");
		await page.reload();
		await expect(details).toContainText("Studio laptop");
		await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
	});
}

test("task cards stack without horizontal overflow on mobile", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("keepany-language", "zh-CN"));
	const assetId = await seedAsset(page);
	await page.goto("/tasks");
	await page.getByRole("button", { name: "新建维护计划" }).click();
	const editor = page.getByRole("dialog");
	await editor.getByLabel("计划名称").fill("设备维护");
	await selectChoice(editor.getByLabel("关联资产"), assetId);
	await editor.getByLabel("下次日期").fill("2026-11-05");
	await editor.getByRole("button", { name: "创建计划" }).click();
	const listBox = await page.locator(".tasks-list-card").boundingBox();
	const detailBox = await page.locator(".tasks-plan-card").boundingBox();
	expect(listBox && detailBox && detailBox.y >= listBox.y + listBox.height).toBeTruthy();
	await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
});
