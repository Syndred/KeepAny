import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Locator, type Page } from "@playwright/test";

export const syntheticKey = "keepany-ai-workflow-synthetic-key-do-not-use";
export const model = "keepany-synthetic-model";
export const evidence =
	process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/evidence/2026-10-01";

type ChatBody = {
	model: string;
	messages: { role: string; content: string }[];
};
type Captured = { headers: IncomingHttpHeaders; body: ChatBody };

/** Same loopback/CORS fixture pattern as ai-dialog-matrix, with SDK-standard responses. */
export async function aiServer() {
	const responses: string[] = [];
	const requests: Captured[] = [];
	const server = createServer(async (request, response) => {
		const cors = {
			"Access-Control-Allow-Origin": request.headers.origin ?? "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers":
				"content-type, authorization, x-ai-sdk-user-agent",
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
		const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ChatBody;
		requests.push({ headers: request.headers, body });
		const content = responses.shift();
		response.writeHead(content === undefined ? 500 : 200, {
			...cors,
			"Content-Type": "application/json",
		});
		response.end(
			JSON.stringify(
				content === undefined
					? { error: { message: "No synthetic response planned" } }
					: {
							id: `chatcmpl-keepany-synthetic-${requests.length}`,
							object: "chat.completion",
							created: 1790812800,
							model,
							choices: [
								{
									index: 0,
									message: { role: "assistant", content },
									finish_reason: "stop",
								},
							],
							usage: {
								prompt_tokens: 19,
								completion_tokens: 7,
								total_tokens: 26,
							},
						},
			),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as AddressInfo;
	return {
		baseURL: `http://127.0.0.1:${address.port}/v1`,
		requests,
		responses,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

export const labels = {
	en: {
		add: "Add",
		name: "Name",
		description: "Short description",
		save: "Save",
		close: "Close",
		cancel: "Cancel",
		settingsTitle: "Connect an AI model",
		saveSettings: "Save configuration",
		testConnection: "Test connection",
		connected: "Connected · model",
		needsKey: "Model configured; activate or enter an API key",
		ready: "Model configuration is active",
		intake: "Capture & import",
		importTitle: "Organize with AI",
		generate: "Generate records to review",
		confirmImport: "Confirm and save",
		confirmed: "Confirmed",
		unknown: "Check:",
		assistantMenu: "AI assistant and access",
		assistantAccess: "Assistant access",
		askAssistant: "Ask assistant",
		assistant: "AI assistant",
		findTab: "Find records",
		reminderTab: "Set reminders",
		question: "Question",
		send: "Send",
		preview: "Review reminder",
		confirmAction: "Confirm action",
		date: "Due date",
		time: "Reminder time",
		zone: "Time zone",
		lead: "Minutes before due time",
		trigger: "Notification time:",
		saved: "Saved. View reminders",
		remindLater: "Remind later",
		weekly: "Weekly",
	},
	"zh-CN": {
		add: "新增",
		name: "名称",
		description: "简短描述",
		save: "保存",
		close: "关闭",
		cancel: "取消",
		settingsTitle: "连接 AI 模型",
		saveSettings: "保存配置",
		testConnection: "测试连接",
		connected: "连接成功 · 模型",
		needsKey: "模型已配置，请启用或输入 API Key",
		ready: "模型配置已启用",
		intake: "收录",
		importTitle: "AI 整理导入",
		generate: "生成待审核资料",
		confirmImport: "确认入库",
		confirmed: "已确认",
		unknown: "待核对：",
		assistantMenu: "AI 助手与授权",
		assistantAccess: "助手授权",
		askAssistant: "提问助手",
		assistant: "AI 助手",
		findTab: "查找资料",
		reminderTab: "设置提醒",
		question: "问题",
		send: "发送",
		preview: "核对提醒",
		confirmAction: "确认执行",
		date: "到期日期",
		time: "提醒时间",
		zone: "时区",
		lead: "提前分钟数",
		trigger: "通知时间：",
		saved: "已保存，查看提醒",
		remindLater: "稍后提醒",
		weekly: "每周",
	},
} as const;
export type Labels = (typeof labels)[keyof typeof labels];

export async function openAssistant(page: Page, copy: Labels) {
	await page
		.getByRole("button", { name: copy.assistantMenu, exact: true })
		.click();
	await page
		.getByRole("menuitem", { name: copy.assistantAccess, exact: true })
		.click();
	await page
		.getByRole("button", { name: copy.askAssistant, exact: true })
		.click();
	const dialog = page.getByRole("dialog", {
		name: copy.assistant,
		exact: true,
	});
	await expect(dialog).toBeVisible();
	return dialog;
}

export async function checkLayout(page: Page, element: Locator, width: number) {
	await expect(element).toBeVisible();
	expect(
		await element.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
	).toBe(true);
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth),
	).toBeLessThanOrEqual(width + 1);
}

export async function openCapture(page: Page, label: string) {
  await page.getByRole("button", { name: /^(Add a record|新增资料)$/ }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}
