import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const evidence =
	process.env.KEEPANY_CONDITIONAL_EVIDENCE_DIR ?? "docs/evidence/2026-09-29";

const copies = {
	"en-US": {
		addAnother: "Create another",
		add: "Add",
		all: "All",
		category: "Category",
		categoryName: "Category name",
		categorySave: "Save collection",
		close: "Collapse",
		duplicate: "This category already exists.",
		manage: "Manage",
		name: "Name",
		remove: "Remove",
		relation: "Add connection",
		save: "Save",
		website: "Websites",
	},
	"zh-CN": {
		addAnother: "新建另一个",
		add: "新增",
		all: "全部",
		category: "分类",
		categoryName: "分类名称",
		categorySave: "保存分类",
		close: "收起",
		duplicate: "该分类已存在。",
		manage: "管理",
		name: "名称",
		remove: "移除",
		relation: "添加关联",
		save: "保存",
		website: "网站",
	},
} as const;

for (const locale of ["en-US", "zh-CN"] as const) {
	test(`${locale} category management reports duplicate visible labels and removes custom category`, async ({
		browser,
	}) => {
		const context = await browser.newContext({ locale });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const copy = copies[locale];
		const custom = `Custom-${crypto.randomUUID().slice(0, 8)}`;
		try {
			await page.goto("/assets/project");
			await page.getByRole("button", { name: copy.manage }).click();
			const dialog = page.getByRole("region", { name: copy.category });
			await dialog.getByLabel(copy.categoryName).fill(copy.website);
			await dialog
				.getByRole("button", { name: copy.categorySave, exact: true })
				.click();
			await expect(dialog.getByRole("alert")).toHaveText(copy.duplicate);
			await expect(dialog.getByLabel(copy.categoryName)).toHaveAttribute(
				"aria-invalid",
				"true",
			);
			await dialog.getByLabel(copy.categoryName).fill(custom);
			await expect(dialog.getByRole("alert")).toHaveCount(0);
			await dialog
				.getByRole("button", { name: copy.categorySave, exact: true })
				.click();
			await expect(dialog).toBeHidden();
			await expect(
				page
					.getByRole("main")
					.getByRole("button", { name: custom, exact: true }),
			).toBeVisible();
			await page.getByRole("button", { name: copy.manage }).click();
			await dialog
				.getByRole("button", { name: copy.addAnother, exact: true })
				.click();
			await dialog.getByLabel(copy.categoryName).fill(custom.toUpperCase());
			await dialog
				.getByRole("button", { name: copy.categorySave, exact: true })
				.click();
			await expect(dialog.getByRole("alert")).toHaveText(copy.duplicate);
			await dialog
				.locator(".list-row")
				.filter({ hasText: custom })
				.getByRole("button", { name: copy.remove })
				.click();
			await expect(dialog.locator(".list-row")).toHaveCount(0);
			await expect(dialog).toBeHidden();
			await expect(
				page
					.getByRole("main")
					.getByRole("button", { name: custom, exact: true }),
			).toHaveCount(0);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});

	for (const width of [360, 390, 768, 1280, 1440]) {
		test(`${locale} category and connection dialogs fit ${width}px`, async ({
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
			const copy = copies[locale];
			const stem = `dialogs-${locale === "zh-CN" ? "zh" : "en"}-${width}`;
			try {
				await page.goto("/assets/project");
				await page.getByRole("button", { name: copy.manage }).click();
				const categoryDialog = page.getByRole("region", {
					name: copy.category,
				});
				const category = "C".repeat(60);
				await categoryDialog.getByLabel(copy.categoryName).fill(category);
				const categorySaveButton = categoryDialog.getByRole("button", {
					name: copy.categorySave,
					exact: true,
				});
				await categorySaveButton.click();
				await expect(categoryDialog).toBeHidden();
				await page.getByRole("button", { name: copy.manage }).click();
				await categoryDialog
					.getByRole("button", { name: copy.addAnother, exact: true })
					.click();
				await categoryDialog.getByLabel(copy.categoryName).fill(category);
				await categoryDialog
					.getByRole("button", { name: copy.categorySave, exact: true })
					.click();
				await expect(categoryDialog.getByRole("alert")).toHaveText(
					copy.duplicate,
				);
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				if (width <= 390) {
					expect(
						await categoryDialog
							.getByLabel(copy.categoryName)
							.evaluate((input) =>
								Number.parseFloat(getComputedStyle(input).fontSize),
							),
					).toBeGreaterThanOrEqual(16);
					await categorySaveButton.scrollIntoViewIfNeeded();
					await expect(categorySaveButton).toBeInViewport({ ratio: 1 });
				}
				await page.screenshot({ path: `${evidence}/${stem}-category.png` });
				await categoryDialog.getByRole("button", { name: copy.close }).click();
				await page.getByRole("button", { name: copy.all, exact: true }).click();

				const project = `Project ${locale} ${width}`;
				await page.getByRole("button", { name: copy.add, exact: true }).click();
				let dialog = page.getByRole("dialog");
				await dialog.getByLabel(copy.name, { exact: true }).fill(project);
				await dialog.getByRole("button", { name: copy.save }).click();
				await expect(dialog).toBeHidden();
				const account = `Account ${locale} ${width}`;
				await page.goto("/assets/account");
				await page.getByRole("button", { name: copy.add, exact: true }).click();
				dialog = page.getByRole("dialog");
				await dialog.getByLabel(copy.name, { exact: true }).fill(account);
				await dialog.getByRole("button", { name: copy.save }).click();
				await expect(dialog).toBeHidden();
				await page.goto("/assets/project");
				await page
					.locator("main.page .list-row")
					.filter({ hasText: project })
					.click();
				await page.getByRole("button", { name: copy.relation }).click();
				const relationDialog = page.getByRole("dialog", {
					name: copy.relation,
				});
				await selectChoice(relationDialog.locator("#relation-target"), {
					label: account,
				});
				await relationDialog.locator("#relation-label").fill("L".repeat(90));
				await relationDialog.locator("#relation-source").fill("S".repeat(120));
				await relationDialog.locator("#relation-verified").fill("2026-10-31");
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				if (width <= 390) {
					const sizes = await relationDialog
						.locator("input, [role=combobox]")
						.evaluateAll((fields) =>
							fields.map((field) =>
								Number.parseFloat(getComputedStyle(field).fontSize),
							),
						);
					expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
					await expect(
						relationDialog.getByRole("button", { name: copy.save }),
					).toBeInViewport({ ratio: 1 });
				}
				await page.screenshot({ path: `${evidence}/${stem}-relation.png` });
				await relationDialog.getByRole("button", { name: copy.save }).click();
				await expect(relationDialog).toBeHidden();
				await expect(page.locator(".relation-row")).toHaveCount(1);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}
