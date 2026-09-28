import { expect, test } from "@playwright/test";

const copies = {
	en: {
		add: "Add",
		name: "Name",
		save: "Save",
		move: "Move to trash",
		cancel: "Cancel",
		warning:
			"Move to trash? Connections are retained and available after restoring.",
	},
	"zh-CN": {
		add: "新增",
		name: "名称",
		save: "保存",
		move: "移至回收站",
		cancel: "取消",
		warning: "移到回收站？关联记录会保留，恢复后可继续使用。",
	},
} as const;

for (const language of ["en", "zh-CN"] as const) {
	for (const width of [360, 390, 768, 1280, 1440]) {
		test(`${language} asset delete dialog fits and traps focus at ${width}px`, async ({
			browser,
		}) => {
			const context = await browser.newContext({
				viewport: { width, height: 844 },
			});
			await context.addInitScript(
				(locale) => localStorage.setItem("keepany-language", locale),
				language,
			);
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const copy = copies[language];
			const name = `Delete dialog ${language} ${width} ${"Very long asset name ".repeat(5)}`;
			try {
				await page.goto("/assets/project");
				await page.getByRole("button", { name: copy.add, exact: true }).click();
				const editor = page.getByRole("dialog");
				await editor.getByLabel(copy.name, { exact: true }).fill(name);
				await editor.getByRole("button", { name: copy.save }).click();
				await expect(editor).toBeHidden();
				await page
					.locator("main.page .list-row")
					.filter({ hasText: name })
					.click();
				await expect(page.getByRole("heading", { name })).toBeVisible();
				const trigger = page
					.locator("main.page > .page-header")
					.getByRole("button", { name: copy.move });
				await trigger.click();
				const dialog = page.getByRole("dialog");
				await expect(dialog.getByText(copy.warning)).toBeVisible();
				const cancel = dialog.getByRole("button", { name: copy.cancel });
				const confirm = dialog.getByRole("button", { name: copy.move });
				await expect(cancel).toBeInViewport();
				await expect(confirm).toBeInViewport();
				await expect
					.poll(() =>
						page.evaluate(() =>
							document
								.querySelector('[role="dialog"]')
								?.contains(document.activeElement),
						),
					)
					.toBe(true);
				for (let step = 0; step < 6; step++) {
					await page.keyboard.press("Tab");
					expect(
						await page.evaluate(() =>
							document
								.querySelector('[role="dialog"]')
								?.contains(document.activeElement),
						),
					).toBe(true);
				}
				await page.screenshot({
					path: `docs/evidence/2026-09-29/detail-asset-delete-${language}-${width}.png`,
				});
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				await cancel.click();
				await expect(dialog).toBeHidden();
				await expect(trigger).toBeFocused();
				await page.reload();
				await expect(page.getByRole("heading", { name })).toBeVisible();
				await trigger.click();
				await page.keyboard.press("Escape");
				await expect(dialog).toBeHidden();
				await expect(trigger).toBeFocused();
				await page.reload();
				await expect(page.getByRole("heading", { name })).toBeVisible();
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}
