import { openProjectDetails } from "./helpers/project-details";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/evidence/2026-09-29";
const mode = process.env.KEEPANY_SCROLL_MODE ?? "dev";

for (const width of [1280, 390]) {
	test(`${mode} ${width}px restores the actual long-list scroll after detail and graph navigation`, async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		mkdirSync(evidence, { recursive: true });
		const context = await browser.newContext({
			viewport: { width, height: 844 },
			locale: "en-US",
		});
		const page = await context.newPage();
		page.setDefaultTimeout(15_000);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const suffix = crypto.randomUUID().slice(0, 6);
		const project = `Scroll graph ${suffix}`;
		let target = "";
		const csv = [
			"name,kind,category",
			`${project},project,website`,
			...Array.from(
				{ length: 70 },
				(_, index) =>
					`Scroll account ${String(index + 1).padStart(2, "0")} ${suffix},account,email`,
			),
		].join("\n");
		const readY = () => page.evaluate(() => window.scrollY);
		async function expectReturnedScroll(expected: number, path?: string) {
			await expect(page).toHaveURL(/\/assets\/account$/);
			await expect(page.locator(".list-row")).toHaveCount(70);
			await expect(
				page.getByRole("button", { name: "Email", exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await expect.poll(readY).toBeGreaterThan(1000);
			const actual = await readY();
			expect(Math.abs(actual - expected)).toBeLessThan(35);
			const visible = await page
				.locator(".list-row")
				.filter({ hasText: target })
				.evaluate((element) => {
					const rect = element.getBoundingClientRect();
					return rect.top >= 0 && rect.bottom <= window.innerHeight;
				});
			expect(visible).toBe(true);
			await expect(page.locator(".toast")).toHaveCount(0);
			if (path) await page.screenshot({ path, fullPage: false });
			return actual;
		}
		try {
			await page.goto("/intake");
			await page.locator(".intake-mode-tabs").getByRole("button", { name: "Spreadsheet", exact: true }).click();
			await page
				.locator("#csv-file")
				.setInputFiles({
					name: "scroll-fixture.csv",
					mimeType: "text/csv",
					buffer: Buffer.from(csv),
				});
			const reviews = page.locator(".intake-review-row");
			await expect(reviews).toHaveCount(71);
			for (let index = 0; index < 71; index++) {
				await reviews.nth(index).getByRole("button", { name: "Confirm and save", exact: true }).click();
				await expect(reviews.nth(index)).toContainText("Confirmed");
			}
			await page.goto("/assets/account");
			await page.getByRole("button", { name: "Email", exact: true }).click();
			await expect(page.locator(".list-row")).toHaveCount(70);
			const targetRow = page.locator(".list-row").nth(50);
			target = await targetRow.locator("strong").innerText();
			await targetRow.evaluate((element) =>
				element.scrollIntoView({ block: "center" }),
			);
			await expect.poll(readY).toBeGreaterThan(1000);
			const before = await readY();
			await targetRow.click();
			await expect(page.getByRole("heading", { name: target })).toBeVisible();
			const stored = await page.evaluate(() =>
				Number(sessionStorage.getItem("keepany-scroll-account")),
			);
			expect(Math.abs(stored - before)).toBeLessThan(35);
			await page.getByRole("banner").getByRole("link", { name: "Back to list" }).click();
			const direct = await expectReturnedScroll(
				stored,
				`${evidence}/scroll-return-${mode}-${width}-direct.png`,
			);
			await page.reload();
			const refreshed = await expectReturnedScroll(stored);
			await page.locator(".list-row").filter({ hasText: target }).click();
			await page.locator(".top-search-trigger").click();
			await page.locator("#top-search-query").fill(`absent-${suffix}`);
			await expect(page.locator(".top-search-panel")).toContainText("None");
			await expect(page.locator(".top-search-panel a")).toHaveCount(0);
			await page.locator("#top-search-query").press("Escape");
			await expect(page.locator(".top-search-panel")).toHaveCount(0);
			await page.getByRole("banner").getByRole("link", { name: "Back to list" }).click();
			await expectReturnedScroll(stored);
			await page.goto("/assets/project");
			await page.getByText(project, { exact: true }).first().click();
			await openProjectDetails(page);
			await page.getByRole("button", { name: "Add connection" }).click();
			const dialog = page.getByRole("dialog");
			await selectChoice(dialog.getByLabel("Connect to"), { label: target });
			await dialog.getByLabel("Connection label").fill("owner");
			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(dialog).toBeHidden();
			await page
				.locator(".react-flow__node")
				.filter({ hasText: target })
				.click();
			await expect(page.getByRole("heading", { name: target })).toBeVisible();
			await page.getByRole("banner").getByRole("link", { name: "Back to list" }).click();
			await expect(page).toHaveURL(/\/assets\/project$/);
			await expect(page.getByText(project, { exact: true }).first()).toBeVisible();
			await page.goto("/assets/account");
			const graph = await expectReturnedScroll(stored);
			console.log(
				JSON.stringify({
					mode,
					width,
					before,
					stored,
					direct,
					refreshed,
					graph,
				}),
			);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
}
