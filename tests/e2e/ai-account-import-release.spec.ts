import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	aiServer,
	checkLayout,
	evidence,
	labels,
	model,
	syntheticKey,
} from "./helpers/ai-workflow";
import { selectChoice } from "./helpers/select-choice";

for (const language of ["zh-CN", "en"] as const) {
	for (const width of [390, 1280]) {
		test(`${language} account identifiers are reviewed, saved and retained at ${width}px`, async ({
			browser,
		}) => {
			const copy = labels[language],
				zh = language === "zh-CN";
			const mock = await aiServer();
			const context = await browser.newContext({
				viewport: { width, height: 844 },
			});
			await context.addInitScript(
				(value) => localStorage.setItem("keepany-language", value),
				language,
			);
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			try {
				await page.goto("/settings#assistant");
				const settings = page.locator(".ai-settings-panel");
				await selectChoice(
					settings.locator("#ai-settings-provider"),
					"compatible",
				);
				await settings.locator("#ai-settings-url").fill(mock.baseURL);
				await settings.locator("#ai-settings-model").fill(model);
				await settings.locator("#ai-settings-api-key").fill(syntheticKey);
				await settings
					.getByRole("button", { name: copy.saveSettings, exact: true })
					.click();
				await expect(
					settings.getByRole("status").filter({ hasText: copy.ready }),
				).toBeVisible();
				await page
					.locator(".top-actions")
					.getByRole("link", { name: copy.intake, exact: true })
					.click();
				const importer = page.locator(".ai-import-panel"),
					rows = page.locator(".intake-review-row");
				await importer
					.locator("#ai-import-text")
					.fill(
						"Test account: https://example.test/ (GitHub):数据库密码fictional-secret",
					);
				await importer
					.getByRole("button", { name: copy.generate, exact: true })
					.click();
				await expect(importer).toContainText(
					zh
						? "请先移除文字中的密码"
						: "Remove passwords, API keys or private keys",
				);
				expect(mock.requests).toHaveLength(0);
				await expect(rows).toHaveCount(0);
				const emailSource = "Portal: https://example.test/dashboard (gmail)",
					githubSource = "Database: https://db.example.test/dashboard (GitHub)";
				const source = `${emailSource}\n${githubSource}\ngmail=reader@example.test`;
				const response = JSON.stringify({
					text: "",
					records: [
						{
							kind: "account",
							name: "Portal",
							url: "https://example.test/dashboard",
							username: "reader@example.test",
							description: "Gmail",
							evidence: emailSource,
						},
						{
							kind: "account",
							name: "Database",
							url: "https://db.example.test/dashboard",
							username: "",
							description: "GitHub",
							evidence: githubSource,
						},
					],
				});
				mock.responses.push(response);
				await importer.locator("#ai-import-text").fill(source);
				await importer
					.getByRole("button", { name: copy.generate, exact: true })
					.click();
				await expect(rows).toHaveCount(2);
				const portal = rows.filter({
					has: page.locator('input[id$="-name"][value="Portal"]'),
				});
				const database = rows.filter({
					has: page.locator('input[id$="-name"][value="Database"]'),
				});
				await expect(portal.locator('input[id$="-username"]')).toHaveValue(
					"reader@example.test",
				);
				await expect(database.locator('input[id$="-username"]')).toHaveValue(
					"",
				);
				await expect(
					database.locator('textarea[id$="-description"]'),
				).toHaveValue("GitHub");
				await checkLayout(page, portal, width);
				mkdirSync(evidence, { recursive: true });
				await portal.screenshot({
					path: `${evidence}/account-review-${language}-${width}.png`,
				});
				await portal
					.locator('input[id$="-username"]')
					.fill("edited@example.test");
				await expect(portal.getByRole("status")).toHaveCount(0);
				mock.responses.push(response);
				await importer
					.getByRole("button", { name: copy.generate, exact: true })
					.click();
				await expect(rows).toHaveCount(2);
				await expect(portal.locator('input[id$="-username"]')).toHaveValue(
					"edited@example.test",
				);
				const savedRow = page.locator(`#${await portal.getAttribute("id")}`);
				await portal
					.getByRole("button", { name: copy.confirmImport, exact: true })
					.click();
				await expect(savedRow).toContainText(copy.confirmed);
				await savedRow
					.getByRole("link", {
						name: new RegExp(zh ? "^查看已保存资料" : "^View saved record"),
					})
					.click();
				await expect(page).toHaveURL(/\/assets\/account\//);
				await expect(
					page
						.locator(".account-facts-grid dl")
						.getByText("edited@example.test", { exact: true }),
				).toBeVisible();
				await page.reload();
				await expect(
					page
						.locator(".account-facts-grid dl")
						.getByText("edited@example.test", { exact: true }),
				).toBeVisible();
				expect(mock.requests).toHaveLength(2);
				for (const request of mock.requests)
					expect(JSON.stringify(request.body)).not.toContain(
						"fictional-secret",
					);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
				await mock.close();
			}
		});
	}
}
