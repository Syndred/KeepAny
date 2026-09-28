import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const evidence = "docs/evidence/2026-09-29";
const copies = {
	"en-US": {
		add: "Add",
		addBacklink: "Add backlink",
		cancel: "Cancel",
		invalidUrl: "Enter a valid http or https URL",
		name: "Name",
		nameTooLong: "Name must be 200 characters or fewer",
		planned: "Planned",
		required: "This field is required",
		save: "Save",
		url: "URL",
	},
	"zh-CN": {
		add: "新增",
		addBacklink: "新增外链",
		cancel: "取消",
		invalidUrl: "请输入有效的 http 或 https 网址",
		name: "名称",
		nameTooLong: "名称不能超过 200 个字符",
		planned: "计划中",
		required: "此项不能为空",
		save: "保存",
		url: "网址",
	},
} as const;

async function createProject(
	page: Page,
	copy: (typeof copies)[keyof typeof copies],
	name: string,
) {
	await page.goto("/assets/project");
	await page.getByRole("button", { name: copy.add, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(copy.name, { exact: true }).fill(name);
	await dialog.getByRole("button", { name: copy.save }).click();
	await expect(dialog).toBeHidden();
	await page.locator("main.page .list-row").filter({ hasText: name }).click();
	await expect(page.getByRole("heading", { name })).toBeVisible();
}

for (const locale of ["en-US", "zh-CN"] as const) {
	const copy = copies[locale];
	for (const width of [360, 390, 768, 1280, 1440]) {
		test(`${locale} local backlink dialog validation and layout at ${width}px`, async ({
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
			try {
				const project = `Ledger ${locale} ${width}`;
				await createProject(page, copy, project);
				const trigger = page.getByRole("button", { name: copy.addBacklink });
				await trigger.click();
				const dialog = page.getByRole("dialog", { name: copy.addBacklink });
				await dialog.getByRole("button", { name: copy.save }).click();
				await expect(dialog.getByLabel(copy.name)).toHaveAttribute(
					"aria-invalid",
					"true",
				);
				await expect(dialog.getByLabel(copy.url)).toHaveAttribute(
					"aria-invalid",
					"true",
				);
				await expect(dialog.getByRole("alert")).toHaveText([
					copy.required,
					copy.required,
				]);
				await dialog.getByLabel(copy.name).fill("X".repeat(201));
				await dialog.getByLabel(copy.url).fill("https://");
				await dialog.getByRole("button", { name: copy.save }).click();
				await expect(dialog.getByRole("alert")).toHaveText([
					copy.nameTooLong,
					copy.invalidUrl,
				]);
				await dialog.getByLabel(copy.url).fill("javascript:alert(1)");
				await dialog.getByRole("button", { name: copy.save }).click();
				await expect(dialog.getByRole("alert")).toHaveText([
					copy.nameTooLong,
					copy.invalidUrl,
				]);
				await dialog.getByLabel(copy.url).fill("http:/example.com");
				await dialog.getByRole("button", { name: copy.save }).click();
				await expect(dialog.getByRole("alert")).toHaveText([
					copy.nameTooLong,
					copy.invalidUrl,
				]);
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				await expect(
					dialog.getByRole("button", { name: copy.cancel }),
				).toBeInViewport({ ratio: 1 });
				await expect(
					dialog.getByRole("button", { name: copy.save }),
				).toBeInViewport({ ratio: 1 });
				if (width <= 390) {
					const sizes = await dialog
						.locator("input")
						.evaluateAll((inputs) =>
							inputs.map((input) =>
								Number.parseFloat(getComputedStyle(input).fontSize),
							),
						);
					expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
				}
				await page.screenshot({
					path: `${evidence}/ledger-${locale === "zh-CN" ? "zh" : "en"}-${width}-error.png`,
				});
				await dialog.getByRole("button", { name: copy.cancel }).click();
				await expect(dialog).toBeHidden();
				await expect(trigger).toBeFocused();
				await page.reload();
				await expect(
					page
						.locator("section")
						.filter({
							has: page.getByRole("heading", {
								name: locale === "zh-CN" ? "外链" : "Backlinks",
							}),
						})
						.locator("tbody tr"),
				).toHaveCount(0);
				await trigger.click();
				await expect(dialog.getByLabel(copy.name)).toHaveValue("");
				const name = `Local directory ${locale} ${width} ${"N".repeat(85)}`;
				const url = `https://example.com/${locale}/${width}/${"p".repeat(110)}`;
				await dialog.getByLabel(copy.name).fill(name);
				await dialog.getByLabel(copy.url).fill(url);
				await page.screenshot({
					path: `${evidence}/ledger-${locale === "zh-CN" ? "zh" : "en"}-${width}-ready.png`,
				});
				await dialog.getByRole("button", { name: copy.save }).click();
				await expect(dialog).toBeHidden();
				await expect(trigger).toBeFocused();
				const row = page.locator("tr").filter({ hasText: name });
				await expect(row).toHaveCount(1);
				await expect(row.getByRole("combobox")).toHaveValue("planned");
				await expect(row.getByRole("link", { name })).toHaveAttribute(
					"href",
					url,
				);
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				await page.reload();
				await expect(page.locator("tr").filter({ hasText: name })).toHaveCount(
					1,
				);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}

	test(`${locale} backlink keyboard trap, Escape, focus return and rapid save`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			locale,
			viewport: { width: 390, height: 844 },
		});
		const page = await context.newPage();
		try {
			await createProject(page, copy, `Keyboard ${locale}`);
			const trigger = page.getByRole("button", { name: copy.addBacklink });
			await trigger.click();
			const dialog = page.getByRole("dialog", { name: copy.addBacklink });
			await expect(dialog).toBeVisible();
			expect(
				await page.evaluate(
					() => document.activeElement?.closest('[role="dialog"]') !== null,
				),
			).toBe(true);
			await dialog.getByRole("button", { name: copy.save }).focus();
			await page.keyboard.press("Tab");
			expect(
				await page.evaluate(
					() => document.activeElement?.closest('[role="dialog"]') !== null,
				),
			).toBe(true);
			await page.keyboard.press("Escape");
			await expect(dialog).toBeHidden();
			await expect(trigger).toBeFocused();
			await trigger.click();
			await dialog.getByLabel(copy.name).fill(`Rapid ${locale}`);
			await dialog.getByLabel(copy.url).fill("https://example.com/rapid");
			await dialog
				.getByRole("button", { name: copy.save })
				.evaluate((button) => {
					(button as HTMLButtonElement).click();
					(button as HTMLButtonElement).click();
				});
			await expect(dialog).toBeHidden();
			await expect(
				page.locator("tr").filter({ hasText: `Rapid ${locale}` }),
			).toHaveCount(1);
			await page.reload();
			await expect(
				page.locator("tr").filter({ hasText: `Rapid ${locale}` }),
			).toHaveCount(1);
		} finally {
			await context.close();
		}
	});
}
