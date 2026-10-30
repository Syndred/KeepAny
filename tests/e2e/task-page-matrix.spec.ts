import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/evidence/2026-09-29";
const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

type StoredTask = {
	id: string;
	name: string;
	dueDate: string;
	done: boolean;
	completionHistory: string[];
};

async function tasks(page: Page): Promise<StoredTask[]> {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		return (await (await localRepository()).list("task")) as StoredTask[];
	}, repositoryModuleUrl);
}

test("task page validation, duplicate, filters and completion history survive refresh", async ({
	browser,
}) => {
	const context = await browser.newContext({ locale: "en-US" });
	const page = await context.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const name = `Inspect renewal ${crypto.randomUUID().slice(0, 8)}`;
	try {
		await page.goto("/tasks");
		await page.getByRole("button", { name: "New task" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog.locator("#taskName-error")).toBeVisible();
		await dialog.getByLabel("Name").fill("L".repeat(301));
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog.locator("#taskName-error")).toBeVisible();
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(await tasks(page)).toHaveLength(0);

		await page.getByRole("button", { name: "New task" }).click();
		await dialog.getByLabel("Name").fill(name);
		await dialog.getByLabel("Date").fill("2026-10-31");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		const row = page.locator("main.page .list-row").filter({ hasText: name });
		await expect(row).toBeVisible();
		expect(await tasks(page)).toMatchObject([
			{ name, dueDate: "2026-10-31", done: false, completionHistory: [] },
		]);

		await page.getByRole("button", { name: "New task" }).click();
		await dialog.getByLabel("Name").fill(name);
		await dialog.getByLabel("Date").fill("2026-10-31");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog.getByRole("alert")).toContainText(
			"This task is already pending.",
		);
		await dialog.getByRole("button", { name: "Cancel" }).click();
		expect(await tasks(page)).toHaveLength(1);

		const filters = page.getByRole("group", { name: "Filter tasks" });
		await filters.getByRole("button", { name: /^Completed ·/ }).click();
		await expect(row).toHaveCount(0);
		await filters.getByRole("button", { name: /^Pending ·/ }).click();
		await expect(row).toBeVisible();
		await row.getByRole("button", { name: "Complete" }).click();
		await expect(row).toHaveCount(0);
		await filters.getByRole("button", { name: /^Completed ·/ }).click();
		await expect(row).toBeVisible();
		await row.getByRole("button", { name: "Reopen" }).click();
		await expect(row).toHaveCount(0);
		await filters.getByRole("button", { name: /^Pending ·/ }).click();
		await expect(row).toBeVisible();
		await row.getByRole("button", { name: "Complete" }).click();
		await filters.getByRole("button", { name: /^All ·/ }).click();
		await expect(row).toBeVisible();
		await expect
			.poll(async () => (await tasks(page))[0]?.completionHistory.length)
			.toBe(2);
		await page.reload();
		await expect(row).toBeVisible();
		expect((await tasks(page))[0]).toMatchObject({
			name,
			done: true,
			completionHistory: expect.any(Array),
		});
		expect((await tasks(page))[0].completionHistory).toHaveLength(2);
		expect(errors).toEqual([]);
	} finally {
		await context.close();
	}
});

for (const locale of ["en-US", "zh-CN"] as const) {
	for (const width of [360, 390, 768, 1280, 1440]) {
		test(`${locale} task page and editor fit ${width}px with long task`, async ({
			browser,
		}) => {
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
							title: "提醒之后，还要留下完成记录。",
							add: "新建待办",
							name: "名称",
							date: "日期",
							save: "保存",
							cancel: "取消",
						}
					: {
							title: "Keep a record after every reminder.",
							add: "New task",
							name: "Name",
							date: "Date",
							save: "Save",
							cancel: "Cancel",
						};
			const stem = `tasks-${locale === "zh-CN" ? "zh" : "en"}-${width}`;
			try {
				await page.goto("/tasks");
				await expect(
					page.getByRole("heading", { level: 1, name: copy.title }),
				).toBeVisible();
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				await page.screenshot({ path: `${evidence}/${stem}-empty.png` });
				await page.getByRole("button", { name: copy.add }).click();
				const dialog = page.getByRole("dialog");
				await expect(dialog).toBeVisible();
				const name = `Task ${locale} ${width} ${"L".repeat(260)}`;
				await dialog.getByLabel(copy.name).fill(name);
				await dialog.getByLabel(copy.date).fill("2026-10-31");
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				if (width <= 390) {
					const sizes = await dialog
						.locator("input")
						.evaluateAll((inputs) =>
							inputs.map((input) =>
								Number.parseFloat(getComputedStyle(input).fontSize),
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
				await page.screenshot({ path: `${evidence}/${stem}-editor.png` });
				await dialog.getByRole("button", { name: copy.save }).click();
				await expect(dialog).toBeHidden();
				await expect(
					page.locator("main.page .list-row").filter({ hasText: name }),
				).toBeVisible();
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				await page.screenshot({
					path: `${evidence}/${stem}-populated.png`,
					fullPage: true,
				});
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}
