import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import {
	aiServer,
	checkLayout,
	evidence,
	labels,
	model,
	openAssistant,
	syntheticKey,
} from "./helpers/ai-workflow";
import { selectChoice } from "./helpers/select-choice";

async function openFinance(page: Page) {
	const menu = page.locator(".mobile-menu");
	if (await menu.isVisible()) await menu.click();
	await page.locator('.nav a[href="/finance"]').click();
	await expect(page).toHaveURL(/\/finance$/);
}

// This slice accepts the actual delivery bundle through UI only. No development-module imports.
for (const language of ["en", "zh-CN"] as const) {
	for (const width of [390, 1280]) {
		test(`${language} delivered AI import, local search and confirmed reminder at ${width}px`, async ({
			browser,
		}) => {
			test.setTimeout(120_000);
			mkdirSync(evidence, { recursive: true });
			const copy = labels[language];
			const mock = await aiServer();
			const context = await browser.newContext({
				viewport: { width, height: 844 },
				timezoneId: "Asia/Shanghai",
			});
			await context.addInitScript(
				(value) => localStorage.setItem("keepany-language", value),
				language,
			);
			const page = await context.newPage();
			page.setDefaultTimeout(12_000);
			const errors: string[] = [];
			const sourceRequests: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("request", (request) => {
				if (request.url().includes("/@fs")) sourceRequests.push(request.url());
			});
			const subscriptionName =
				language === "en" ? "Delivered AI subscription" : "固定包 AI 订阅";
			const taskName =
				language === "en" ? "Delivered AI reminder" : "固定包 AI 提醒";
			try {
				await page.goto("/settings#assistant");
				const settings = page.locator(".ai-settings-panel");
				await expect(
					settings.getByRole("heading", {
						name: copy.settingsTitle,
						exact: true,
					}),
				).toBeVisible();
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
				await checkLayout(page, settings, width);
				await page
					.locator(".top-actions")
					.getByRole("link", { name: copy.intake, exact: true })
					.click();
				const importer = page.locator(".ai-import-panel");
				const source = `${subscriptionName}: USD 12.50 every month, next renewal 2026-12-20.`;
				mock.responses.push(
					JSON.stringify({
						text: "",
						records: [
							{
								kind: "subscription",
								name: subscriptionName,
								url: "",
								description: "",
								category: "",
								tags: [],
								amount: "12.50",
								currency: "USD",
								cycle: "month",
								interval: 1,
								dueDate: "2026-12-20",
								evidence: source,
								relatedName: "",
								missingFields: [],
							},
						],
					}),
				);
				await importer.locator("#ai-import-text").fill(source);
				await importer
					.getByRole("button", { name: copy.generate, exact: true })
					.click();
				const review = page.locator(".intake-review-row");
				await expect(review).toHaveCount(1);
				await expect(review.locator("input[id$='-name']")).toHaveValue(
					subscriptionName,
				);
				await expect(review.locator("input[id$='-amount']")).toHaveValue(
					"12.50",
				);
				await expect(review.locator("button[id$='-currency']")).toHaveAttribute(
					"data-value",
					"USD",
				);
				await expect(review.locator("button[id$='-cycle']")).toHaveAttribute(
					"data-value",
					"month",
				);
				await expect(review.locator("input[id$='-dueDate']")).toHaveValue(
					"2026-12-20",
				);
				await expect(review).toContainText(
					language === "en" ? "Pending" : "待确认",
				);
				await review.screenshot({
					path: `${evidence}/ai-release-review-${language}-${width}.png`,
				});
				await openFinance(page);
				await expect(page.locator(".finance-subscription")).toHaveCount(0);
				await page
					.locator(".top-actions")
					.getByRole("link", { name: copy.intake, exact: true })
					.click();
				await expect(review).toHaveCount(1);
				await review
					.getByRole("button", { name: copy.confirmImport, exact: true })
					.click();
				await expect(review).toContainText(copy.confirmed);
				await expect(
					review.getByRole("button", { name: copy.confirmImport, exact: true }),
				).toHaveCount(0);
				await openFinance(page);
				const subscription = page.locator(".finance-subscription");
				await expect(subscription).toHaveCount(1);
				await expect(subscription).toHaveText(subscriptionName);
				const subscriptionHref = await subscription.getAttribute("href");
				expect(subscriptionHref).toMatch(
					/^\/assets\/subscription\/ai-[0-9a-f]+-1$/,
				);
				await expect(subscription.locator("..")).toContainText("12.50");
				const dialog = await openAssistant(page, copy);
				for (const link of await dialog.getByRole("link").all()) {
					await expect(link).toHaveCSS("color", "rgb(23, 36, 58)");
				}
				await dialog
					.getByRole("checkbox", { name: subscriptionName, exact: true })
					.check();
				const askQuestion = `What amount is supplied for ${subscriptionName}?`;
				const askAnswer =
					"The supplied amount is USD 12.50; the billing cycle is not supplied.";
				mock.responses.push(askAnswer);
				await dialog
					.getByRole("textbox", { name: copy.question, exact: true })
					.fill(askQuestion);
				await dialog
					.getByRole("button", { name: copy.send, exact: true })
					.click();
				await expect(
					dialog.getByText(askAnswer, { exact: true }),
				).toBeVisible();
				const askRequest = mock.requests.at(-1);
				expect(askRequest).toBeDefined();
				const asked = JSON.parse(
					askRequest?.body.messages.find((message) => message.role === "user")
						?.content ?? "",
				) as { records: Record<string, unknown>[]; question: string };
				expect(asked).toEqual({
					question: askQuestion,
					records: [
						{
							kind: "subscription",
							name: subscriptionName,
							description: "",
							url: "",
							dueDate: "2026-12-20",
							amount: "12.50",
							currency: "USD",
						},
					],
				});
				await dialog
					.getByRole("button", { name: copy.findTab, exact: true })
					.click();
				const question = `Find ${subscriptionName} and its monthly cost.`;
				mock.responses.push(
					JSON.stringify({
						scope: "assets",
						query: subscriptionName,
						kind: "subscription",
						dateFrom: null,
						dateTo: null,
						taskDone: null,
						relatedQuery: "",
						aggregate: "monthlyTotal",
					}),
				);
				await dialog.getByRole("textbox", { name: copy.question, exact: true }).fill(question);
				await dialog
					.getByRole("button", { name: copy.send, exact: true })
					.click();
				const result = dialog
					.locator(".ai-local-results")
					.getByRole("link", { name: subscriptionName, exact: true });
				await expect(result).toHaveCount(1);
				await expect(result).toHaveCSS("color", "rgb(23, 36, 58)");
				await expect(result).toHaveCSS("background-color", "rgb(255, 240, 184)");
				await result.hover();
				await expect(result).toHaveCSS("color", "rgb(23, 36, 58)");
				await expect(result).toHaveCSS("background-color", "rgb(255, 210, 76)");
				await page.mouse.move(0, 0);
				await expect(result).toHaveAttribute(
					"href",
					subscriptionHref as string,
				);
				await expect(dialog.locator(".ai-local-results")).toContainText(
					"12.50",
				);
				await dialog.locator(".ai-local-results").screenshot({ path: `${evidence}/ai-search-links-${language}-${width}.png` });
				await result.click();
				await expect(dialog).toBeHidden();
				await expect(page).toHaveURL(new RegExp(`${subscriptionHref}$`));
				await expect(
					page.getByRole("heading", { name: subscriptionName, exact: true }),
				).toBeVisible();
				await expect(page.locator("main")).toContainText("12.50");

				const reminder = {
					operation: "create",
					name: taskName,
					taskQuery: "",
					assetQuery: "",
					localDate: "2026-12-20",
					localTime: "10:30",
					timeZone: "Asia/Shanghai",
					leadMinutes: 30,
					leadDays: 3,
					rule: { mode: "fixed", unit: "week", every: 2 },
				};
				const questionReminder = `Create ${taskName} for 2026-12-20 at 10:30 Asia/Shanghai; remind 30 minutes before, repeat every two weeks.`;
				let reminderDialog = await openAssistant(page, copy);
				await reminderDialog
					.getByRole("button", { name: copy.reminderTab, exact: true })
					.click();
				mock.responses.push(JSON.stringify(reminder));
				await reminderDialog
					.getByRole("textbox", { name: copy.question, exact: true })
					.fill(questionReminder);
				await reminderDialog
					.getByRole("button", { name: copy.send, exact: true })
					.click();
				let preview = reminderDialog.locator(".ai-plan");
				await expect(
					preview.getByLabel(copy.time, { exact: true }),
				).toHaveValue("10:30");
				await expect(
					preview.getByLabel(copy.lead, { exact: true }),
				).toHaveValue("30");
				await expect(preview.locator("#ai-reminder-repeat")).toHaveAttribute(
					"data-value",
					"week",
				);
				await expect(preview).toContainText("2 ·");
				await expect(
					preview.getByText(copy.trigger, { exact: false }),
				).toContainText("10:00");
				await checkLayout(page, reminderDialog, width);
				await preview
					.getByText(copy.trigger, { exact: false })
					.scrollIntoViewIfNeeded();
				await page.screenshot({
					path: `${evidence}/ai-release-reminder-preview-${language}-${width}.png`,
				});
				await preview
					.getByRole("button", { name: copy.cancel, exact: true })
					.click();
				await expect(preview).toBeHidden();
				await reminderDialog
					.getByRole("button", { name: copy.close, exact: true })
					.click();
				await page.locator('.top-actions a[href="/tasks"]').click();
				await expect(page.locator(".tasks-list-card .list-row")).toHaveCount(0);
				reminderDialog = await openAssistant(page, copy);
				await reminderDialog
					.getByRole("button", { name: copy.reminderTab, exact: true })
					.click();
				mock.responses.push(JSON.stringify(reminder));
				await reminderDialog
					.getByRole("textbox", { name: copy.question, exact: true })
					.fill(questionReminder);
				await reminderDialog
					.getByRole("button", { name: copy.send, exact: true })
					.click();
				preview = reminderDialog.locator(".ai-plan");
				await preview
					.getByRole("button", { name: copy.confirmAction, exact: true })
					.click();
				const saved = preview.getByRole("link", {
					name: copy.saved,
					exact: true,
				});
				await expect(saved).toBeVisible();
				await page.mouse.move(0, 0);
				await expect(saved).toHaveCSS("color", "rgb(23, 36, 58)");
				const taskHref = await saved.getAttribute("href");
				expect(taskHref).toBe("/tasks");
				await reminderDialog
					.getByRole("button", { name: copy.close, exact: true })
					.click();
				await page.locator('.top-actions a[href="/tasks"]').click();
				const taskRows = page.locator(".tasks-list-card .list-row");
				await expect(taskRows).toHaveCount(1);
				const taskId = await taskRows.getAttribute("id");
				expect(taskId).toMatch(/^task-[0-9a-f-]+$/);
				await page.reload();
				await expect(taskRows).toHaveCount(1);
				const task = taskRows.filter({ hasText: taskName });
				await expect(task).toHaveCount(1);
				await expect(task).toHaveAttribute("id", taskId as string);
				await expect(
					task.getByLabel(copy.remindLater, { exact: true }),
				).toHaveValue("2026-12-20");
				await expect(task).toContainText("10:30");
				await expect(task).toContainText("10:00");
				await expect(task).toContainText("Asia/Shanghai");
				await expect(task).toContainText(
					language === "en" ? "30 minutes before" : "提前 30 分钟",
				);
				await expect(task).toContainText(
					language === "en" ? "Every 2 weeks" : "每 2 周",
				);
				await expect(task.locator("time").nth(0)).toHaveAttribute(
					"datetime",
					"2026-12-20T02:30:00.000Z",
				);
				await expect(task.locator("time").nth(1)).toHaveAttribute(
					"datetime",
					"2026-12-20T02:00:00.000Z",
				);
				await task.screenshot({
					path: `${evidence}/ai-release-reminder-refreshed-${language}-${width}.png`,
				});
				await openFinance(page);
				await expect(page.locator(".finance-subscription")).toHaveCount(1);
				await expect(page.locator(".finance-subscription")).toHaveAttribute(
					"href",
					subscriptionHref as string,
				);
				await page.goto("/settings#assistant");
				await expect(
					settings.getByRole("status").filter({ hasText: copy.needsKey }),
				).toBeVisible();
				await expect(settings.locator("#ai-settings-api-key")).toHaveValue("");
				await expect(settings.locator("#ai-settings-model")).toHaveValue(model);
				await expect(settings.locator("#ai-settings-url")).toHaveValue(
					mock.baseURL,
				);
				expect(mock.requests).toHaveLength(5);
				expect(sourceRequests).toEqual([]);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
				await mock.close();
			}
		});
	}
}
