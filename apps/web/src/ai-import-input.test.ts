import { describe, expect, it } from "vitest";
import { hasExplicitImportSecret } from "./ai-import-input";

describe("AI text import blocks explicitly labelled credentials locally", () => {
	it.each([
		"Cloud account: https://example.test/ (github):数据库密码test-secret?",
		"数据库密码：fictional-secret",
		'password="fictional-secret"',
		'"apiKey": "fictional-secret"',
		"API Key = fictional-secret",
		"-----BEGIN PRIVATE KEY-----\nfictional-secret",
		"sk-fictional_credential_12345678",
		"https://user:fictional-secret@example.test/dashboard",
		"https://example.test/dashboard?access_token=fictional-secret",
	])("rejects a secret marker in mixed source: %s", (source) => {
		expect(hasExplicitImportSecret(source)).toBe(true);
	});
	it.each([
		"AI portal：https://example.test/dashboard（gmail）\ngmail是reader@example.test",
		"模型服务：https://example.test/account（15500001234）",
		"项目说明：使用密码库保存密码；GitHub登录，没有提供用户名。",
		"Password manager: https://example.test/",
		"https://example.test/dashboard?project=visible-project",
	])(
		"preserves public URLs and explicitly provided login identifiers: %s",
		(source) => {
			expect(hasExplicitImportSecret(source)).toBe(false);
		},
	);
});
