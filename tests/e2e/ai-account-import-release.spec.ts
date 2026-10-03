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
				await page.goto("/intake");
				await expect(page.locator(".ai-import-panel")).toContainText(
					zh ? "尚未配置 AI 模型" : "No AI model is configured",
				);
				await page.goto("/settings#assistant");
				const settings = page.locator(".ai-settings-panel");
				await selectChoice(
					settings.locator("#ai-settings-provider"),
					"compatible",
				);
				await settings.locator("#ai-settings-url").fill(mock.baseURL);
				await settings.locator("#ai-settings-model").fill(model);
				await selectChoice(
					settings.locator("#ai-settings-key-source"),
					"session",
				);
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
				await expect(importer).toContainText(
					`${zh ? "当前模型：" : "Current model: "}${model}`,
				);
				await expect(importer.locator(".notice")).toHaveCount(0);
				const choose = importer.getByRole("button", {
					name: zh ? "选择文件" : "Choose file",
					exact: true,
				});
				await expect(importer.locator("#ai-import-file")).toBeHidden();
				const fileChooser = page.waitForEvent("filechooser");
				await choose.focus();
				await choose.press("Enter");
				const fileName = `${"account-import-".repeat(10)}.txt`;
				await (await fileChooser).setFiles({
					name: fileName,
					mimeType: "text/plain",
					buffer: Buffer.from("Portal: https://example.test/"),
				});
				await expect(importer).toContainText(fileName);
				await expect(importer.locator("#ai-import-text")).toBeDisabled();
				await checkLayout(page, importer, width);
				const fileGap = await importer.evaluate((panel) => {
					const file = panel.querySelector(".file-picker");
					const action = file?.nextElementSibling;
					if (!file || !action) throw Error("Missing file picker or action");
					return (
						action.getBoundingClientRect().top -
						file.getBoundingClientRect().bottom
					);
				});
				expect(fileGap).toBeGreaterThanOrEqual(16);
				await importer
					.getByRole("button", {
						name: zh ? "移除文件" : "Remove file",
						exact: true,
					})
					.click();
				await expect(importer.locator("#ai-import-file")).toHaveValue("");
				await expect(importer.locator("#ai-import-text")).toBeEnabled();
				const generateGap = await importer.evaluate((panel) => {
					const file = panel.querySelector(".file-picker");
					const action = file?.nextElementSibling;
					if (!file || !action) throw Error("Missing file picker or action");
					return (
						action.getBoundingClientRect().top -
						file.getBoundingClientRect().bottom
					);
				});
				expect(generateGap).toBeGreaterThanOrEqual(16);
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
				const batches = page.locator(".intake-review-batch");
				await expect(batches).toHaveCount(1);
				const batch = batches.first();
				await expect(batch.locator(".intake-review-batch-header > strong")).toHaveCount(1);
				await expect(batch.locator(".intake-review-batch-model")).toContainText(model);
				await expect(batch.locator(".intake-review-original pre")).toHaveCount(1);
				await expect(rows.locator(".intake-review-original")).toHaveCount(0);
				await batch.locator(".intake-review-original > summary").click();
				await expect(batch.locator(".intake-review-original pre")).toHaveText(source);
				await batch.locator(".intake-review-original > summary").click();
				await expect(batch.locator(".intake-review-original pre")).toBeHidden();
				const positions = await rows.evaluateAll((elements) => elements.map((element) => {
					const rect = element.getBoundingClientRect();
					return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
				}));
				if (width === 1280) {
					expect(positions[0].y).toBe(positions[1].y);
					expect(positions[1].x).toBeGreaterThan(positions[0].x + positions[0].width);
					expect(positions[0].height).toBeLessThanOrEqual(500);
				} else {
					expect(positions[0].x).toBe(positions[1].x);
					expect(positions[1].y).toBeGreaterThan(positions[0].y + positions[0].height);
				}
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
				await portal.locator(".intake-review-evidence > summary").click();
				await expect(portal.locator(".intake-review-evidence p")).toHaveText(emailSource);
				await portal.locator(".intake-review-evidence > summary").click();
				await checkLayout(page, portal, width);
				await checkLayout(page, database, width);
				mkdirSync(evidence, { recursive: true });
				await portal.screenshot({
					path: `${evidence}/account-review-${language}-${width}.png`,
				});
				await batch.screenshot({path: `${evidence}/review-batch-${language}-${width}.png`});
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
				// The same displayed file name must not merge different source contents.
				const alternateSource = "Alternate Portal: https://other.example.test/dashboard (GitHub)";
				mock.responses.push(JSON.stringify({ text: "", records: [{ kind: "account", name: "Alternate Portal", url: "https://other.example.test/dashboard", username: "", description: "GitHub", evidence: alternateSource }] }));
				await importer.locator("#ai-import-text").fill(alternateSource);
				await importer.getByRole("button", {name: copy.generate, exact: true}).click();
				await expect(rows).toHaveCount(3);
				await expect(batches).toHaveCount(2);
				await expect(batches.locator(".intake-review-batch-header > strong")).toHaveText([zh ? "文字或表格内容" : "Text or spreadsheet content", zh ? "文字或表格内容" : "Text or spreadsheet content"]);
				const alternateBatch = batches.filter({has: page.locator('input[id$="-name"][value="Alternate Portal"]')});
				await alternateBatch.locator(".intake-review-original > summary").click();
				await expect(alternateBatch.locator(".intake-review-original pre")).toHaveText(alternateSource);
				await expect(batch.locator(".intake-review-original pre")).toHaveText(source);
				await alternateBatch.locator(".intake-review-original > summary").click();
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
				await page.goto("/intake");
				await expect(importer).toContainText(
					zh
						? `${model} 已配置。当前页面尚未启用 API Key`
						: `${model} is configured. This page needs an API key`,
				);
				await expect(
					importer.getByRole("link", {
						name: zh ? "启用密钥" : "Activate key",
						exact: true,
					}),
				).toBeVisible();
				await expect(importer).not.toContainText(
					zh ? "尚未配置 AI 模型" : "No AI model is configured",
				);
				await expect(
					importer.getByRole("button", { name: copy.generate, exact: true }),
				).toBeDisabled();
				await importer.screenshot({
					path: `${evidence}/account-import-session-${language}-${width}.png`,
				});
				expect(mock.requests).toHaveLength(3);
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
