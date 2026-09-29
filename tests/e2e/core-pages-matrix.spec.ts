import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const evidence = "docs/evidence/2026-09-29";

for (const locale of ["en-US", "zh-CN"] as const) {
	for (const width of [360, 390, 768, 1280, 1440]) {
		test(`${locale} overview, intake, settings and trash fit ${width}px`, async ({
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
							move: "移至回收站",
							restore: "恢复",
						overview: "你的数字宇宙，一眼掌握。",
						intake: "随手收录，慢慢整理。",
							settings: "设置",
							trash: "回收站",
						}
					: {
							add: "Add",
							name: "Name",
							save: "Save",
							move: "Move to trash",
							restore: "Restore",
						overview: "Your world, all in one view.",
						intake: "Collect now, organize later.",
							settings: "Settings",
							trash: "Trash",
						};
			const stem = `core-${locale === "zh-CN" ? "zh" : "en"}-${width}`;
			async function verifyPage(title: string) {
				await expect(
					page.getByRole("heading", { level: 1, name: title }),
				).toBeVisible();
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
					`${locale} ${width}px ${page.url()}`,
				).toBeLessThanOrEqual(width);
			}
			async function verifyReadableSubscription(name: string) {
				const card = page.locator(".asset-library-card").filter({ hasText: name }).first();
				await expect(card).toBeVisible();
				await expect(card.locator(".asset-library-meta")).toContainText("90,071,992,547,409.91");
				expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
			}
			try {
				await page.goto("/assets/subscription");
				await page.getByRole("button", { name: copy.add, exact: true }).click();
				let dialog = page.getByRole("dialog");
				const subscription = `Core subscription ${locale} ${width}`;
				await dialog.getByLabel(copy.name, { exact: true }).fill(subscription);
				await dialog.locator("#amount").fill("90071992547409.91");
				await dialog.locator("#dueDate").fill("2026-10-31");
				await dialog.getByRole("button", { name: copy.save }).click();
				await expect(dialog).toBeHidden();
				if (width <= 390) {
					await verifyReadableSubscription(subscription);
					await page.screenshot({
						path: `${evidence}/${stem}-subscription-list.png`,
					});
				}

				await page.goto("/");
				await verifyPage(copy.overview);
				await expect(page.locator(".overview-action-row")).toContainText(subscription);
				await expect(page.locator(".overview-stat").first()).toContainText("1");
				await page.screenshot({
					path: `${evidence}/${stem}-overview-populated.png`,
					fullPage: true,
				});

				await page.goto("/intake");
				await verifyPage(copy.intake);
				await expect(page.locator("#backup-password")).toBeVisible();
				await page.screenshot({
					path: `${evidence}/${stem}-intake.png`,
					fullPage: true,
				});

				await page.goto("/settings");
				await verifyPage(copy.settings);
				await page.screenshot({
					path: `${evidence}/${stem}-settings.png`,
					fullPage: true,
				});

				await page.goto("/trash");
				await verifyPage(copy.trash);
				await page.screenshot({ path: `${evidence}/${stem}-trash-empty.png` });
				await page.goto("/assets/project");
				await page.getByRole("button", { name: copy.add, exact: true }).click();
				dialog = page.getByRole("dialog");
				const project = `Core ${"L".repeat(150)}`;
				await dialog.getByLabel(copy.name, { exact: true }).fill(project);
				await dialog.getByRole("button", { name: copy.save }).click();
				await expect(dialog).toBeHidden();
				await page
					.locator("main.page .list-row")
					.filter({ hasText: project })
					.click();
				await page
					.locator("main.page > .asset-project-action-bar")
					.getByRole("button", { name: copy.move })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: copy.move })
					.click();
				await expect(page).toHaveURL(/\/assets\/project$/);
				await page.goto("/trash");
				await verifyPage(copy.trash);
				const row = page.locator("main.page .list-row").filter({
					hasText: project,
				});
				await expect(row).toBeVisible();
				await expect(
					row.getByRole("button", { name: copy.restore }),
				).toBeVisible();
				await page.screenshot({
					path: `${evidence}/${stem}-trash-populated.png`,
					fullPage: true,
				});
				await row.getByRole("button", { name: copy.restore }).click();
				await expect(row).toHaveCount(0);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}

test("mobile topbar search opens from its keyboard-accessible button", async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 844 });
	await page.goto("/");
	await expect(page.locator(".overview-hero")).toBeVisible();
	await page.locator(".top-search-trigger").click();
	await expect(page.locator(".top-search-panel input")).toBeFocused();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

for (const [locale, currentLabel, nextLabel, target] of [
	["en-US", "Language", "语言", "zh-CN"],
	["zh-CN", "语言", "Language", "en"],
] as const) {
	test(`${locale} settings language control has a name and choice persists`, async ({
		browser,
	}) => {
		const context = await browser.newContext({ locale });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await page.goto("/settings");
			const selection = page.getByRole("combobox", { name: currentLabel });
			await expect(selection).toBeVisible();
			await selection.focus();
			await expect(selection).toBeFocused();
			await selection.selectOption(target);
			await expect(page.getByRole("combobox", { name: nextLabel })).toHaveValue(
				target,
			);
			await page.reload();
			await expect(page.getByRole("combobox", { name: nextLabel })).toHaveValue(
				target,
			);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
}
