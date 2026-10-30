import { openCapture } from "./helpers/ai-workflow";
import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import type { Asset, Task } from "../../packages/domain/src";
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
import { sourceModuleUrl } from "./helpers/source-module-url";

const repositoryUrl = sourceModuleUrl("packages/local-db/src/index.ts");
const reviewUrl = "/src/intake-review-store.ts";
const aiSettingsUrl = "/src/ai-settings-store.ts";
async function readRecords(page: Page) {
	return page.evaluate(async (path) => {
		const { localRepository } = await import(path);
		const repository = await localRepository();
		return {
			assets: (await repository.list("asset")) as Asset[],
			tasks: (await repository.list("task")) as Task[],
		};
	}, repositoryUrl);
}

for (const language of ["en", "zh-CN"] as const) {
	for (const width of [390, 1280]) {
		test(`${language} AI configuration, reviewed import, local search and confirmed reminder at ${width}px`, async ({
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
			page.on("pageerror", (error) => errors.push(error.message));
			const privateName = "Private unrelated project sentinel";
			const subscriptionName =
				language === "en" ? "AI reviewed subscription" : "AI 核对订阅";
			const taskName =
				language === "en" ? "Check AI reminder records" : "核对 AI 提醒资料";
			try {
				// Establish a real UI-created record that must never travel in the local-search request.
				await page.goto("/assets/project");
				await page.getByRole("button", { name: copy.add, exact: true }).click();
				const editor = page.getByRole("dialog");
				await editor.getByLabel(copy.name, { exact: true }).fill(privateName);
				await editor
					.getByLabel(copy.description, { exact: true })
					.fill("private-description-sentinel");
				await editor
					.getByRole("button", { name: copy.save, exact: true })
					.click();
				await expect(editor).toBeHidden();

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
				const metadata = await page.evaluate(() =>
					JSON.parse(localStorage.getItem("keepany-ai-settings-v1") || "null"),
				);
				expect(metadata).toEqual({
					provider: "compatible",
					baseURL: mock.baseURL,
					model,
					keySource: "session",
				});
				expect(
					await page.evaluate(() =>
						JSON.stringify({
							local: { ...localStorage },
							session: { ...sessionStorage },
						}),
					),
				).not.toContain(syntheticKey);
				expect(JSON.stringify(await readRecords(page))).not.toContain(
					syntheticKey,
				);
				mock.responses.push("OK");
				await settings
					.getByRole("button", { name: copy.testConnection, exact: true })
					.click();
				await expect(
					settings.getByRole("status").filter({ hasText: copy.connected }),
				).toContainText(model);
				await expect(
					settings.getByRole("status").filter({ hasText: copy.connected }),
				).toContainText("19");
				await checkLayout(page, settings, width);
				await page.screenshot({
					path: `${evidence}/ai-workflow-settings-${language}-${width}.png`,
				});
				await page.reload();
				await expect(
					settings.getByRole("status").filter({ hasText: copy.needsKey }),
				).toBeVisible();
				await expect(settings.locator("#ai-settings-api-key")).toHaveValue("");
				expect(
					await page.evaluate(
						async (path) => (await import(path)).getAiConnection(),
						aiSettingsUrl,
					),
				).toBeNull();
				await settings.locator("#ai-settings-api-key").fill(syntheticKey);
				await settings
					.getByRole("button", { name: copy.saveSettings, exact: true })
					.click();

				// SPA navigation keeps the intentionally temporary page-session credential.
				await openCapture(page, copy.intake);
				const importer = page.locator(".ai-import-panel");
				await expect(
					importer.getByRole("heading", {
						name: copy.importTitle,
						exact: true,
					}),
				).toBeVisible();
				const source = `${subscriptionName}. Renewal date: 2026-12-20. Amount, currency and billing cycle are not supplied.`;
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
								amount: null,
								currency: null,
								cycle: null,
								interval: null,
								dueDate: "2026-12-20",
								evidence: source,
								relatedName: "",
								missingFields: ["amount", "currency", "cycle"],
							},
						],
					}),
				);
				await importer.locator("#ai-import-text").fill(source);
				await importer
					.getByRole("button", { name: copy.generate, exact: true })
					.click();
				const row = page.locator(".intake-review-row");
				await expect(row).toHaveCount(1);
				await expect(row.locator("input[id$='-name']")).toHaveValue(
					subscriptionName,
				);
				await expect(row.locator("input[id$='-amount']")).toHaveValue("");
				await expect(row.locator("button[id$='-currency']")).toHaveAttribute(
					"data-value",
					"",
				);
				await expect(row.locator("button[id$='-cycle']")).toHaveAttribute(
					"data-value",
					"",
				);
				expect(
					(await readRecords(page)).assets.map((asset) => asset.name),
				).toEqual([privateName]);
				await row
					.getByRole("button", { name: copy.confirmImport, exact: true })
					.click();
				await expect(row.getByRole("alert")).toContainText(copy.unknown);
				expect((await readRecords(page)).assets).toHaveLength(1);
				await row.screenshot({
					path: `${evidence}/ai-workflow-review-${language}-${width}.png`,
				});
				await selectChoice(row.locator("button[id$='-currency']"), "USD");
				await row.locator("input[id$='-amount']").fill("12.50");
				await selectChoice(row.locator("button[id$='-cycle']"), "month");
				await expect(
					row.getByRole("button", { name: copy.confirmImport, exact: true }),
				).toBeEnabled();
				await row
					.getByRole("button", { name: copy.confirmImport, exact: true })
					.click();
				await expect(row).toContainText(copy.confirmed);
				const imported = (await readRecords(page)).assets.find(
					(asset) => asset.name === subscriptionName,
				);
				expect(imported).toMatchObject({
					kind: "subscription",
					amount: 1250,
					currency: "USD",
					cycle: "month",
					dueDate: "2026-12-20",
				});
				if (!imported) throw Error("reviewed subscription was not saved");
				await checkLayout(page, importer, width);

				const dialog = await openAssistant(page, copy);
				await dialog
					.getByRole("button", { name: copy.findTab, exact: true })
					.click();
				const question = `Find the subscription named ${subscriptionName} and its monthly cost.`;
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
				await dialog.getByLabel(copy.question, { exact: true }).fill(question);
				await dialog
					.getByRole("button", { name: copy.send, exact: true })
					.click();
				const result = dialog
					.locator(".ai-local-results")
					.getByRole("link", { name: subscriptionName, exact: true });
				await expect(result).toHaveAttribute(
					"href",
					`/assets/subscription/${imported.id}`,
				);
				await expect(dialog.locator(".ai-local-results")).toContainText(
					"12.50",
				);
				const searchRequest = mock.requests[2];
				expect(searchRequest.headers.authorization).toBe(
					`Bearer ${syntheticKey}`,
				);
				const user = JSON.parse(
					searchRequest.body.messages.find((message) => message.role === "user")
						?.content || "null",
				);
				expect(Object.keys(user).sort()).toEqual(
					["language", "now", "question", "timeZone", "today"].sort(),
				);
				expect(user).toMatchObject({
					question,
					language,
					timeZone: "Asia/Shanghai",
				});
				expect(JSON.stringify(searchRequest.body)).not.toContain(privateName);
				expect(JSON.stringify(searchRequest.body)).not.toContain(
					"private-description-sentinel",
				);
				expect(JSON.stringify(searchRequest.body)).not.toContain(syntheticKey);
				await checkLayout(page, dialog, width);
				await result.click();
				await expect(dialog).toBeHidden();
				await expect(page).toHaveURL(
					new RegExp(`/assets/subscription/${imported.id}$`),
				);
				await expect(
					page.getByRole("heading", { name: subscriptionName, exact: true }),
				).toBeVisible();

				const reminderDialog = await openAssistant(page, copy);
				await reminderDialog
					.getByRole("button", { name: copy.reminderTab, exact: true })
					.click();
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
				mock.responses.push(JSON.stringify(reminder));
				await reminderDialog
					.getByLabel(copy.question, { exact: true })
					.fill(
						`Create ${taskName} for 2026-12-20 at 10:30 Asia/Shanghai, notify 30 minutes early, repeat every two weeks.`,
					);
				await reminderDialog
					.getByRole("button", { name: copy.send, exact: true })
					.click();
				const preview = reminderDialog.locator(".ai-plan");
				await expect(
					preview.getByRole("heading", { name: copy.preview, exact: true }),
				).toBeVisible();
				await expect(
					preview.getByLabel(copy.date, { exact: true }),
				).toHaveValue("2026-12-20");
				await expect(
					preview.getByLabel(copy.time, { exact: true }),
				).toHaveValue("10:30");
				await expect(
					preview.getByLabel(copy.zone, { exact: true }),
				).toHaveValue("Asia/Shanghai");
				await expect(
					preview.getByLabel(copy.lead, { exact: true }),
				).toHaveValue("30");
				await expect(preview.locator("#ai-reminder-repeat")).toHaveAttribute(
					"data-value",
					"week",
				);
				await expect(preview.locator("#ai-reminder-repeat")).toContainText(
					copy.weekly,
				);
				await expect(preview).toContainText("2 ·");
				await expect(
					preview.getByText(copy.trigger, { exact: false }),
				).toContainText("10:00");
				expect((await readRecords(page)).tasks).toHaveLength(0);
				await checkLayout(page, reminderDialog, width);
				await preview
					.getByText(copy.trigger, { exact: false })
					.scrollIntoViewIfNeeded();
				await page.screenshot({
					path: `${evidence}/ai-workflow-reminder-preview-${language}-${width}.png`,
				});
				await preview
					.getByRole("button", { name: copy.cancel, exact: true })
					.click();
				await expect(preview).toBeHidden();
				expect((await readRecords(page)).tasks).toHaveLength(0);
				mock.responses.push(JSON.stringify(reminder));
				await reminderDialog
					.getByRole("button", { name: copy.send, exact: true })
					.click();
				await preview
					.getByRole("button", { name: copy.confirmAction, exact: true })
					.click();
				await expect(
					preview.getByRole("link", { name: copy.saved, exact: true }),
				).toBeVisible();
				const beforeRefresh = (await readRecords(page)).tasks;
				expect(beforeRefresh).toHaveLength(1);
				expect(beforeRefresh[0]).toMatchObject({
					name: taskName,
					assetId: "",
					dueDate: "2026-12-20",
					done: false,
					reminder: {
						at: "2026-12-20T02:30:00.000Z",
						timeZone: "Asia/Shanghai",
						leadMinutes: 30,
						rule: { mode: "fixed", unit: "week", every: 2 },
						occurrence: 0,
					},
				});
				await reminderDialog
					.getByRole("button", { name: copy.close, exact: true })
					.click();
				await page.reload();
				expect((await readRecords(page)).tasks).toEqual(beforeRefresh);
				await page.goto("/tasks");
				const taskRow = page.locator(`#task-${beforeRefresh[0].id}`);
				await expect(taskRow).toContainText(taskName);
				await expect(
					taskRow.getByLabel(copy.remindLater, { exact: true }),
				).toHaveValue("2026-12-20");
				await expect(taskRow).toContainText("10:30");
				await expect(taskRow).toContainText("10:00");
				await expect(taskRow).toContainText("Asia/Shanghai");
				await expect(taskRow.locator("time").nth(0)).toHaveAttribute(
					"datetime",
					"2026-12-20T02:30:00.000Z",
				);
				await expect(taskRow.locator("time").nth(1)).toHaveAttribute(
					"datetime",
					"2026-12-20T02:00:00.000Z",
				);
				await expect(taskRow).toContainText(
					language === "en" ? "30 minutes before" : "提前 30 分钟",
				);
				await expect(taskRow).toContainText(
					language === "en" ? "Every 2 weeks" : "每 2 周",
				);
				await taskRow.screenshot({
					path: `${evidence}/ai-workflow-reminder-refreshed-${language}-${width}.png`,
				});
				await expect
					.poll(async () =>
						page.evaluate(
							async (path) => (await import(path)).listReviewedCandidates(),
							reviewUrl,
						),
					)
					.toMatchObject([
						{
							status: "accepted",
							ai: {
								missingFields: [],
							},
						},
					]);
				expect(mock.requests).toHaveLength(5);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
				await mock.close();
			}
		});
	}
}
