import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { sourceModuleUrl } from "./helpers/source-module-url";
import { seedDensityBrowser } from "./helpers/ui-density-fixture";

// Regression: UI-20261028 — whole-field dates, dense mixed records, single active tabs,
// adjacent collection rows and working workspace menu. User-reported /qa regression.
// Value: protects=real rendered interaction and data reread; seam=none;
// no_claim=synthetic local records, no remote service or native notification acceptance.
const evidence =
	process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/ui-migration/density";
mkdirSync(evidence, { recursive: true });
test.setTimeout(90_000);

for (const language of ["zh-CN", "en"] as const)
	for (const width of [390, 768, 1280, 1920]) {
		test(`${language} ${width}px dense records and complete date interaction`, async ({
			page,
		}) => {
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.setViewportSize({ width, height: 960 });
			await page.addInitScript(
				(language) => localStorage.setItem("keepany-language", language),
				language,
			);
			await page.clock.setFixedTime(new Date("2026-10-28T04:00:00Z"));
			await page.goto("/assets");
			const ids = await page.evaluate(seedDensityBrowser, {
				repositoryPath: sourceModuleUrl("packages/local-db/src/index.ts"),
				domainPath: sourceModuleUrl("packages/domain/src/index.ts"),
				language,
			});
			await page.reload();
			const t = (key: string) => resources[language].translation[key];
			const cards = page.locator(".workspace-asset-grid > a");
			await expect(cards).toHaveCount(25); // 24 assets in the catalog plus the recorded domain.
			await expect(page.locator(".workspace-asset-grid")).toHaveClass(
				/asset-dense-list/,
			);
			if (width >= 1280) {
				await expect(
					page.locator(".asset-project-foot .chip").first(),
				).toBeVisible();
				const statusX = await page.evaluate(() =>
					[".asset-project-foot .chip", ".asset-library-foot .chip"].map(
						(selector) =>
							document.querySelector(selector)!.getBoundingClientRect().x,
					),
				);
				expect(Math.abs(statusX[0] - statusX[1])).toBeLessThanOrEqual(1);
			}
			expect(
				await cards.evaluateAll((cards) =>
					cards.every((card) => card.getBoundingClientRect().height < 195),
				),
			).toBe(true);
			await page.screenshot({
				path: join(evidence, `dense-list-${language}-${width}.png`),
				fullPage: true,
			});
			await page
				.getByRole("button", { name: t("assetCardView"), exact: true })
				.click();
			const rectangles = await cards.evaluateAll((cards) =>
				cards.map((card) => ({
					width: card.getBoundingClientRect().width,
					height: card.getBoundingClientRect().height,
					top: card.getBoundingClientRect().top,
					bottom: card.getBoundingClientRect().bottom,
				})),
			);
			expect(
				rectangles.every((rect) => rect.width <= 361 && rect.height < 440),
			).toBe(true);
			for (const rect of rectangles) {
				const sameRow = rectangles.filter((other) => Math.abs(other.top - rect.top) < 1);
				expect(Math.max(...sameRow.map((other) => other.bottom)) - Math.min(...sameRow.map((other) => other.bottom))).toBeLessThanOrEqual(1);
			}
			await expect(page.locator(".asset-kind-icon img")).toHaveJSProperty(
				"naturalWidth",
				640,
			);
			await expect(page.locator(".asset-project-cover")).toHaveCount(0);
			if (width >= 1280)
				expect(
					await cards.evaluateAll(
						(cards) =>
							cards.filter(
								(card) => card.getBoundingClientRect().bottom <= innerHeight,
							).length,
					),
				).toBeGreaterThanOrEqual(6);
			await page.screenshot({
				path: join(evidence, `dense-assets-${language}-${width}.png`),
				fullPage: true,
			});
			await page
				.getByRole("button", { name: t("assetListView"), exact: true })
				.click();
			for (const path of [
				"/assets",
				"/assets/project",
				"/assets/item",
				"/assets/domains",
				"/assets/subscription",
				"/finance",
				"/accounts",
				"/assets/vault#vault-references",
			]) {
				await page.goto(path);
				await expect(
					page.locator(".workspace-navigation > a[aria-current='page']"),
				).toHaveCount(1);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth + 1,
					),
				).toBe(true);
			}
			await page.goto("/collections");
			await expect(page.locator(".collections-tile")).toHaveCount(8);
			if (width <= 680) {
				const target = await page.locator(".collections-tile button[aria-haspopup=menu]").first().boundingBox();
				expect(target!.width).toBeGreaterThanOrEqual(44);
				expect(target!.height).toBeGreaterThanOrEqual(44);
			}
			const geometry = await page.evaluate(() => ({
				navBottom: document
					.querySelector(".collections-organize-nav")!
					.getBoundingClientRect().bottom,
				rowTop: document
					.querySelector(".collections-existing")!
					.getBoundingClientRect().top,
			}));
			expect(geometry.rowTop - geometry.navBottom).toBeLessThanOrEqual(16);
			const first = page.locator(".collections-tile").first();
			const sameLine = await first.evaluate((row) => {
				const icon = row.querySelector("svg")!.getBoundingClientRect();
				const title = row.querySelector("a")!.getBoundingClientRect();
				return (
					Math.abs(icon.y + icon.height / 2 - title.y - title.height / 2) < 2
				);
			});
			expect(sameLine).toBe(true);
			await page.screenshot({
				path: join(evidence, `dense-collections-${language}-${width}.png`),
				fullPage: true,
			});
			await page.goto("/finance");
			await expect(page.locator(".finance-entry-actions .button")).toHaveCount(
				8,
			);
			const financeGeometry = await page
				.locator(".finance-entry-actions .button")
				.evaluateAll((buttons) =>
					buttons.map((button) => {
						const rect = button.getBoundingClientRect();
						return {
							width: rect.width,
							height: rect.height,
							radius: parseFloat(getComputedStyle(button).borderRadius),
						};
					}),
				);
			expect(financeGeometry.length).toBe(8);
			expect(
				financeGeometry.every(
					(rect) => rect.width > rect.height * 1.25 && rect.radius > 100,
				),
			).toBe(true);
			await page.screenshot({
				path: join(evidence, `dense-finance-${language}-${width}.png`),
				fullPage: true,
			});
			await page.goto("/tasks");
			await expect(page.locator(".tasks-plan-card")).toHaveCount(0);
			await expect(page.locator(".tasks-columns")).toHaveClass(/is-single/);
			await expect(page.locator(".task-filters button").first()).toContainText(
				t("all"),
			);
			const from = page.locator("#task-date-from");
			await from.fill("2026-02-30");
			expect(
				await from.evaluate((input: HTMLInputElement) => input.checkValidity()),
			).toBe(false);
			await from.fill("");
			expect(
				await from.evaluate((input: HTMLInputElement) => input.checkValidity()),
			).toBe(true);
			await from.click({ position: { x: 12, y: 15 } });
			await expect(page.locator(".date-popover")).toBeVisible();
			const bounds = await page.locator(".date-popover").boundingBox();
			expect(bounds!.x).toBeGreaterThanOrEqual(0);
			expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
			if (width <= 760) {
				const targets = await page.locator(".rdp-day_button, .rdp-button_previous, .rdp-button_next").evaluateAll((buttons) => buttons.map((button) => ({width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height})));
				expect(targets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true);
			}
			await page.screenshot({
				path: join(evidence, `dense-date-${language}-${width}.png`),
				fullPage: true,
			});
			await page.locator('.rdp-day[data-day="2026-10-29"] button').click();
			await expect(from).toHaveValue("2026-10-29");
			await expect(page.locator(".date-popover")).toBeHidden();
			await expect(from).toBeFocused();
			await from.press("ArrowDown");
			await expect(page.locator(".date-popover")).toBeVisible();
			await expect
				.poll(() =>
					page
						.locator(".date-popover")
						.evaluate((popup) => popup.contains(document.activeElement)),
				)
				.toBe(true);
			await page.keyboard.press("Escape");
			await expect(page.locator(".date-popover")).toBeHidden();
			await page
				.getByRole("button", { name: t("taskClearDates"), exact: true })
				.click();
			await expect(from).toHaveValue("");
			const rowDate = page.locator(`#task-${ids.task} .date-field input`);
			await rowDate.fill("2026-11-09");
			await expect(
				page
					.getByRole("status")
					.filter({ hasText: t("saved") })
					.first(),
			).toBeVisible();
			await page.reload();
			await expect(
				page.locator(`#task-${ids.task} .date-field input`),
			).toHaveValue("2026-11-09");
			if (width <= 760)
				await page
					.getByRole("button", { name: t("navigation"), exact: true })
					.click();
			await page.locator(".workspace-current").click();
			await expect(page.getByRole("menuitem")).toHaveCount(3);
			await page
				.getByRole("menuitem", { name: t("settings"), exact: true })
				.click();
			await expect(page).toHaveURL(/\/settings$/);
			expect(errors).toEqual([]);
		});
	}
