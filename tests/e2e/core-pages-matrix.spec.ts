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
							overview: "概览",
							intake: "收录与备份",
							settings: "设置",
							trash: "回收站",
						}
					: {
							add: "Add",
							name: "Name",
							save: "Save",
							move: "Move to trash",
							restore: "Restore",
							overview: "Overview",
							intake: "Import & backup",
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
			async function verifyReadableSubscription(selector: string) {
				const row = page.locator(selector).first();
				await expect(row).toBeVisible();
				const layout = await row.evaluate((element) => {
					const name = element.querySelector(":scope > div:not(.row-icon)");
					const amount = element.querySelector(":scope > b");
					if (!name || !amount) throw Error("Subscription row fields missing");
					const nameBox = name.getBoundingClientRect();
					const amountBox = amount.getBoundingClientRect();
					return {
						nameWidth: nameBox.width,
						nameBottom: nameBox.bottom,
						amountTop: amountBox.top,
					};
				});
				expect(layout.nameWidth).toBeGreaterThan(160);
				expect(layout.amountTop).toBeGreaterThanOrEqual(layout.nameBottom - 1);
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
					await verifyReadableSubscription(".subscription-list-row");
					await page.screenshot({
						path: `${evidence}/${stem}-subscription-list.png`,
					});
				}

				await page.goto("/");
				await verifyPage(copy.overview);
				await expect(page.locator("main.page")).toContainText(subscription);
				await expect(page.locator("main.page")).toContainText(
					"90,071,992,547,409.91",
				);
				if (width <= 390) {
					await verifyReadableSubscription(".overview-subscription-row");
					await verifyReadableSubscription(".subscription-list-row");
				}
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
					.locator("main.page > .page-header")
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
