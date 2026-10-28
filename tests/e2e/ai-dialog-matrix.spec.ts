import { mkdirSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "docs/evidence/2026-09-29";
const syntheticKey = "keepany-synthetic-ai-key-do-not-use";

type Plan = {
	status: number;
	answer?: string;
	payload?: unknown;
	location?: string;
	gate?: Promise<void>;
};
type Captured = { headers: IncomingHttpHeaders; body: unknown };

async function aiServer() {
	const plans: Plan[] = [];
	const requests: Captured[] = [];
	const server: Server = createServer(async (request, response) => {
		const cors = {
			"Access-Control-Allow-Origin": request.headers.origin ?? "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "content-type, authorization",
		};
		if (request.method === "OPTIONS") {
			response.writeHead(204, cors).end();
			return;
		}
		if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
			response.writeHead(404, cors).end();
			return;
		}
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		requests.push({ headers: request.headers, body });
		const plan = plans.shift() ?? { status: 500 };
		if (plan.gate) await plan.gate;
		response.writeHead(plan.status, {
			...cors,
			"Content-Type": "application/json",
			...(plan.location ? { Location: plan.location } : {}),
		});
		response.end(
			JSON.stringify(
				"payload" in plan
					? plan.payload
					: { choices: [{ message: { content: plan.answer ?? "" } }] },
			),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as AddressInfo;
	return {
		endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
		plans,
		requests,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

const copies = {
	en: {
		add: "Add",
		name: "Name",
		description: "Short description",
		contact: "Contact",
		contactDetails: "Contact details",
		notes: "Internal notes",
		save: "Save",
		assistant: "AI assistant",
		assistantMenu: "AI assistant and access",
		assistantAccess: "Assistant access",
		askAssistant: "Ask assistant",
		endpoint: "Service URL",
		model: "Model",
		key: "API key (this session only)",
		question: "Question",
		send: "Send",
		close: "Close",
		error: "Connection failed. Check the URL, key and CORS settings.",
	},
	"zh-CN": {
		add: "新增",
		name: "名称",
		description: "简短描述",
		contact: "联系方式",
		contactDetails: "联系方式",
		notes: "内部备注",
		save: "保存",
		assistant: "AI 助手",
		assistantMenu: "AI 助手与授权",
		assistantAccess: "助手授权",
		askAssistant: "提问助手",
		endpoint: "服务地址",
		model: "模型",
		key: "API Key（仅本次会话）",
		question: "问题",
		send: "发送",
		close: "关闭",
		error: "连接失败，请检查地址、密钥与跨域设置。",
	},
} as const;

async function addProject(
	page: Page,
	copy: typeof copies.en | (typeof copies)["zh-CN"],
	name: string,
	description: string,
) {
	await page.goto("/assets/project");
	await page.getByRole("button", { name: copy.add, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(copy.name, { exact: true }).fill(name);
	await dialog.getByLabel(copy.description, { exact: true }).fill(description);
	await dialog
		.getByLabel(copy.contact, { exact: true })
		.fill("contact-private-sentinel");
	await dialog
		.locator("summary")
		.filter({ hasText: copy.contactDetails })
		.click();
	await dialog
		.getByLabel(copy.notes, { exact: true })
		.fill("notes-private-sentinel");
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
}

async function openAi(
	page: Page,
	copy: typeof copies.en | (typeof copies)["zh-CN"],
) {
	await page
		.getByRole("button", { name: copy.assistantMenu, exact: true })
		.click();
	await page
		.getByRole("menuitem", { name: copy.assistantAccess, exact: true })
		.click();
	const trigger = page.getByRole("button", { name: copy.askAssistant, exact: true });
	await trigger.click();
	const dialog = page.getByRole("dialog", { name: copy.assistant });
	await expect(dialog).toBeVisible();
	return { trigger, dialog };
}

for (const language of ["en", "zh-CN"] as const) {
	for (const width of [360, 390, 768, 1280, 1440]) {
		test(`${language} AI dialog selected-only request and error at ${width}px`, async ({
			browser,
		}) => {
			test.setTimeout(90_000);
			mkdirSync(evidence, { recursive: true });
			const copy = copies[language];
			const mock = await aiServer();
			const context = await browser.newContext({
				viewport: { width, height: 844 },
			});
			await context.addInitScript(
				(value) => localStorage.setItem("keepany-language", value),
				language,
			);
			const page = await context.newPage();
			page.setDefaultTimeout(10_000);
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const chosen = `${"A".repeat(140)}-${crypto.randomUUID().slice(0, 6)}`;
			const excluded = `Excluded-${crypto.randomUUID().slice(0, 6)}`;
			const answer = `Verified-${"R".repeat(1800)}`;
			const stem = `ai-dialog-${language}-${width}${process.env.KEEPANY_AI_EVIDENCE_MODE === "preview" ? "-preview" : ""}`;
			try {
				await addProject(page, copy, chosen, "selected-description");
				await addProject(page, copy, excluded, "private-description-sentinel");
				const { trigger, dialog } = await openAi(page, copy);
				await expect(
					dialog.getByRole("button", { name: copy.send }),
				).toBeDisabled();
				expect(
					await dialog.evaluate((element) =>
						element.contains(document.activeElement),
					),
				).toBe(true);
				await dialog.getByLabel(copy.endpoint).fill(mock.endpoint);
				await dialog.getByLabel(copy.model).fill("synthetic-model");
				await dialog.getByLabel(copy.key).fill(syntheticKey);
				await dialog.getByLabel(copy.question).fill("   ");
				await dialog.getByRole("checkbox", { name: chosen }).check();
				await expect(
					dialog.getByRole("button", { name: copy.send }),
				).toBeDisabled();
				await dialog
					.getByLabel(copy.question)
					.fill("Summarize my selected record");
				await expect(
					dialog.getByRole("button", { name: copy.send }),
				).toBeEnabled();
				await expect(dialog.getByLabel(copy.question)).toBeInViewport({
					ratio: 0.95,
				});
				await expect(
					dialog.getByRole("button", { name: copy.send }),
				).toBeInViewport({ ratio: 0.95 });
				expect(
					await dialog.evaluate(
						(element) => element.scrollWidth <= element.clientWidth,
					),
				).toBe(true);
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				await page.screenshot({
					path: `${evidence}/${stem}-ready.png`,
				});
				await dialog.getByRole("button", { name: copy.send }).focus();
				for (let i = 0; i < 7; i += 1) {
					await page.keyboard.press("Tab");
					// Base UI's focus guard returns focus in its queued focus task.
					await expect.poll(() => dialog.evaluate((element) =>
							element.contains(document.activeElement),
						)).toBe(true);
				}
				mock.plans.push({ status: 200, answer });
				await dialog.getByRole("button", { name: copy.send }).click();
				await expect.poll(() => mock.requests.length).toBe(1);
				const request = mock.requests[0];
				expect(request.headers.authorization).toBe(`Bearer ${syntheticKey}`);
				const payload = request.body as {
					model: string;
					messages: { role: string; content: string }[];
				};
				expect(payload.model).toBe("synthetic-model");
				const user = JSON.parse(
					payload.messages.find((message) => message.role === "user")
						?.content ?? "null",
				) as {
					records: { name: string; description: string }[];
					question: string;
				};
				expect(user).toEqual({
					records: [
						expect.objectContaining({
							name: chosen,
							description: "selected-description",
							amount: null,
						}),
					],
					question: "Summarize my selected record",
				});
				expect(Object.keys(user.records[0]).sort()).toEqual(
					["amount", "currency", "description", "dueDate", "kind", "name", "url"].sort(),
				);
				expect(JSON.stringify(payload)).not.toContain(excluded);
				expect(JSON.stringify(payload)).not.toContain(
					"private-description-sentinel",
				);
				expect(JSON.stringify(payload)).not.toContain(
					"contact-private-sentinel",
				);
				expect(JSON.stringify(payload)).not.toContain("notes-private-sentinel");
				await expect(dialog.getByText(answer)).toBeVisible();
				await dialog.getByText(answer).scrollIntoViewIfNeeded();
				expect(
					await dialog.evaluate(
						(element) => element.scrollWidth <= element.clientWidth,
					),
				).toBe(true);
				await page.screenshot({
					path: `${evidence}/${stem}-answer.png`,
				});
				mock.plans.push({ status: 503 });
				await dialog.getByRole("button", { name: copy.send }).click();
				await expect(dialog.getByRole("alert")).toHaveText(copy.error);
				await page.screenshot({
					path: `${evidence}/${stem}-error.png`,
				});
				await page.keyboard.press("Escape");
				await expect(dialog).toBeHidden();
				await expect(trigger).toBeFocused();
				const reopened = await openAi(page, copy);
				await expect(reopened.dialog.getByLabel(copy.key)).toHaveValue("");
				await expect(
					reopened.dialog.getByRole("button", { name: copy.send }),
				).toBeDisabled();
				await reopened.dialog.getByRole("button", { name: copy.close }).click();
				await expect(reopened.dialog).toBeHidden();
				await page.reload();
				const storage = await page.evaluate(() =>
					JSON.stringify({
						local: { ...localStorage },
						session: { ...sessionStorage },
					}),
				);
				expect(storage).not.toContain(syntheticKey);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
				await mock.close();
			}
		});
	}
}

for (const language of ["en", "zh-CN"] as const) {
	test(`${language} AI usage and entered-rate estimate at 390px`, async ({ browser }) => {
		const mock = await aiServer();
		const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
		await context.addInitScript((value) => localStorage.setItem("keepany-language", value), language);
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await addProject(page, copies[language], "Usage project", "Synthetic record");
			const { dialog } = await openAi(page, copies[language]);
			await dialog.getByLabel(copies[language].endpoint).fill(mock.endpoint);
			await dialog.getByLabel(copies[language].model).fill("synthetic-model");
			await dialog.getByLabel(copies[language].question).fill("Show usage");
			await dialog.getByRole("checkbox", { name: "Usage project" }).check();
			await dialog.locator(".ai-pricing summary").click();
			await dialog.locator("#ai-price-input").fill("2");
			await dialog.locator("#ai-price-output").fill("8");
			await dialog.locator("#ai-price-currency").fill("usd");
			mock.plans.push({ status: 200, payload: {
				model: "synthetic-model",
				choices: [{ message: { content: "Metered answer" } }],
				usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
			} });
			await dialog.getByRole("button", { name: copies[language].send }).click();
			await expect(dialog.getByText("Metered answer")).toBeVisible();
			await expect(dialog.locator(".ai-cost")).toContainText("123");
			await expect(dialog.locator(".ai-cost")).toContainText("45");
			await expect(dialog.locator(".ai-cost")).toContainText("USD 0.000606");
			expect(JSON.stringify(mock.requests[0].body)).not.toContain("ai-price");
			expect(JSON.stringify(mock.requests[0].body)).not.toContain("0.000606");
			expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
			await dialog.locator(".ai-cost").scrollIntoViewIfNeeded();
			await page.screenshot({ path: `${evidence}/ai-cost-${language}-390.png` });

			mock.plans.push({ status: 200, payload: {
				model: "synthetic-model",
				choices: [{ message: { content: "No usage answer" } }],
			} });
			await dialog.getByRole("button", { name: copies[language].send }).click();
			await expect(dialog.getByText("No usage answer")).toBeVisible();
			await expect(dialog.locator(".ai-cost")).not.toContainText("0.000606");
			await expect(dialog.locator(".ai-cost")).not.toContainText("123");
			await expect(dialog.locator(".ai-cost")).toContainText(language === "en" ? "Unknown" : "未知");

			mock.plans.push({ status: 200, payload: {
				model: "different-model",
				choices: [{ message: { content: "Different model answer" } }],
				usage: { prompt_tokens: 123, completion_tokens: 45 },
			} });
			await dialog.getByRole("button", { name: copies[language].send }).click();
			await expect(dialog.getByText("Different model answer")).toBeVisible();
			await expect(dialog.locator(".ai-cost")).toContainText("different-model");
			await expect(dialog.locator(".ai-cost")).not.toContainText("0.000606");
			expect(errors).toEqual([]);
		} finally {
			await context.close();
			await mock.close();
		}
	});
}

test("AI rejects invalid success content, retries, filters deleted assets and sends once on double click", async ({
	browser,
}) => {
	test.setTimeout(90_000);
	const mock = await aiServer();
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	const page = await context.newPage();
	page.setDefaultTimeout(10_000);
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	try {
		await addProject(
			page,
			copies.en,
			"Selected AI project",
			"selected-description",
		);
		await addProject(
			page,
			copies.en,
			"Deleted AI project",
			"deleted-description-sentinel",
		);
		await page
			.locator("main.page .list-row")
			.filter({ hasText: "Deleted AI project" })
			.click();
		await page
			.locator(".asset-project-action-bar")
			.getByRole("button", { name: "Move to trash" })
			.click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Move to trash" })
			.click();
		await expect(page).toHaveURL(/\/assets\/project$/);
		const { dialog } = await openAi(page, copies.en);
		await expect(
			dialog.getByRole("checkbox", { name: "Deleted AI project" }),
		).toHaveCount(0);
		await dialog.getByLabel(copies.en.endpoint).fill(mock.endpoint);
		await dialog.getByLabel(copies.en.model).fill("synthetic-model");
		await dialog.getByLabel(copies.en.question).fill("Test response shape");
		await dialog.getByRole("checkbox", { name: "Selected AI project" }).check();
		mock.plans.push({
			status: 200,
			payload: { choices: [{ message: { content: null } }] },
		});
		await dialog.getByRole("button", { name: copies.en.send }).click();
		await expect(dialog.getByRole("alert")).toHaveText(
			"The service returned an unreadable response. Please try again.",
		);
		await expect(dialog.getByText("Response", { exact: true })).toHaveCount(0);
		mock.plans.push({ status: 200, answer: "Valid retry answer" });
		await dialog.getByRole("button", { name: copies.en.send }).click();
		await expect(dialog.getByText("Valid retry answer")).toBeVisible();
		const sent = mock.requests[1].body as {
			messages: { role: string; content: string }[];
		};
		expect(JSON.stringify(sent)).not.toContain("Deleted AI project");
		expect(JSON.stringify(sent)).not.toContain("deleted-description-sentinel");
		mock.plans.push({ status: 200, answer: "Single answer", gate });
		await page.evaluate(() => {
			const dialog = document.querySelector<HTMLElement>("[role=dialog]");
			const send = Array.from(dialog?.querySelectorAll("button") ?? []).find(
				(button) => button.textContent?.includes("Send"),
			);
			if (!send) throw Error("Send button missing");
			send.click();
			send.click();
		});
		await expect.poll(() => mock.requests.length).toBe(3);
		await expect(
			dialog.getByRole("button", { name: "Thinking…" }),
		).toBeDisabled();
		release();
		await expect(dialog.getByText("Single answer")).toBeVisible();
		expect(mock.requests).toHaveLength(3);
	} finally {
		release();
		await context.close();
		await mock.close();
	}
});

test("AI request does not follow a provider redirect with the synthetic key", async ({
	browser,
}) => {
	const primary = await aiServer();
	const receiver = await aiServer();
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	const page = await context.newPage();
	try {
		await addProject(page, copies.en, "Redirect project", "Synthetic record");
		const { dialog } = await openAi(page, copies.en);
		await dialog.getByLabel(copies.en.endpoint).fill(primary.endpoint);
		await dialog.getByLabel(copies.en.model).fill("synthetic-model");
		await dialog.getByLabel(copies.en.key).fill(syntheticKey);
		await dialog.getByLabel(copies.en.question).fill("Will this redirect?");
		await dialog.getByRole("checkbox", { name: "Redirect project" }).check();
		primary.plans.push({ status: 302, location: receiver.endpoint });
		await dialog.getByRole("button", { name: copies.en.send }).click();
		await expect(dialog.getByRole("alert")).toHaveText(copies.en.error);
		expect(primary.requests).toHaveLength(1);
		expect(primary.requests[0].headers.authorization).toBe(
			`Bearer ${syntheticKey}`,
		);
		expect(receiver.requests).toHaveLength(0);
	} finally {
		await context.close();
		await primary.close();
		await receiver.close();
	}
});

test("AI answer from a superseded question cannot appear under the edited question", async ({
	browser,
}) => {
	const mock = await aiServer();
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	const page = await context.newPage();
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	try {
		await addProject(page, copies.en, "Race project", "Race record");
		const { dialog } = await openAi(page, copies.en);
		await dialog.getByLabel(copies.en.endpoint).fill(mock.endpoint);
		await dialog.getByLabel(copies.en.model).fill("synthetic-model");
		await dialog.getByLabel(copies.en.question).fill("First question");
		await dialog.getByRole("checkbox", { name: "Race project" }).check();
		mock.plans.push({ status: 200, answer: "Answer to first question", gate });
		await dialog.getByRole("button", { name: copies.en.send }).click();
		await expect.poll(() => mock.requests.length).toBe(1);
		await dialog.getByLabel(copies.en.question).fill("Second question");
		release();
		await expect(
			dialog.getByRole("button", { name: copies.en.send }),
		).toBeEnabled();
		await expect(dialog.getByText("Answer to first question")).toHaveCount(0);
		mock.plans.push({ status: 200, answer: "Answer to second question" });
		await dialog.getByRole("button", { name: copies.en.send }).click();
		await expect(dialog.getByText("Answer to second question")).toBeVisible();
		await expect.poll(() => mock.requests.length).toBe(2);
	} finally {
		release();
		await context.close();
		await mock.close();
	}
});
