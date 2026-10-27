import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { recognitionFixture, visualHarness, visualMaster, visualVaultContentFingerprint } from "./fixtures/password-smart-import-visual";
import { model, syntheticKey } from "./helpers/ai-workflow";

test.setTimeout(120_000);
const root = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/T08-boundary";
mkdirSync(root, { recursive: true });
const aiButton = (scope: Locator) => scope.getByRole("button", { name: /^(用 AI 识别|用 .* 识别清单|Recognize with AI|Use AI|Recognize list with .*)$/, exact: true });
async function recognize(page: Page, importer: Locator) {
	await aiButton(importer).click();
	await page.getByRole("button", { name: /^(确认识别|Confirm recognition)$/, exact: true }).click();
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`${locale} ${width} T08 consent sends only current list and rejects fabricated references before retry`, async ({ browser }) => {
		const h = await visualHarness(browser, locale, { width, height: 900 });
		const fixture = recognitionFixture([{ title: "Current synthetic list", username: "current@example.test", password: "Current-only-secret!42" }]);
		const existing = { title: "Existing vault excluded title", username: "existing-excluded@example.test", password: "Existing-excluded-secret!42" };
		try {
			await h.configure();
			await h.createVault();
			await h.seedExisting(existing);
			const before = await visualVaultContentFingerprint(h.page);
			const importer = await h.open();
			await importer.locator("#pw-smart-source").fill(fixture.source);
			expect(h.mock.requests).toHaveLength(0);
			await aiButton(importer).click();
			const consent = h.page.getByRole("dialog").last();
			await expect(consent).toContainText(model);
			await expect(consent).toContainText(h.mock.baseURL);
			await expect(consent).toContainText(locale === "zh-CN" ? /密码/ : /password/i);
			expect(h.mock.requests).toHaveLength(0);
			await h.page.screenshot({ path: join(root, `consent-${locale}-${width}.png`) });
			await consent.getByRole("button", { name: /^(取消|Cancel)$/, exact: true }).click();
			expect(h.mock.requests).toHaveLength(0);
			h.mock.responses.push(JSON.stringify({ records: [{ title: { line: 1 }, username: { line: 2 }, password: "Fabricated-not-in-source" }], ignoredLines: [] }));
			await recognize(h.page, importer);
			await expect(importer).toContainText(h.t("pwSmartAiResponseFormat"));
			await expect(importer.locator("#pw-smart-source")).toHaveValue(fixture.source);
			const request = h.mock.requests[0];
			expect(request.body.model).toBe(model);
			const body = JSON.stringify(request.body);
			for (const value of ["Current synthetic list", "current@example.test", "Current-only-secret!42"]) expect(body).toContain(value);
			for (const value of [existing.title, existing.username, existing.password, visualMaster, syntheticKey]) expect(body).not.toContain(value);
			expect(request.headers.authorization).toBe(`Bearer ${syntheticKey}`);
			expect(await visualVaultContentFingerprint(h.page)).toEqual(before);
			h.mock.responses.push(JSON.stringify({ records: [{ title: { line: 999 }, username: { line: 2 }, password: { line: 3, substring: "Fabricated-not-in-source" } }], ignoredLines: [] }));
			await recognize(h.page, importer);
			await expect(importer.locator(".pw-work-list-row:not([data-source-group])")).toHaveCount(0);
			await expect(importer).not.toContainText("Fabricated-not-in-source");
			expect(await visualVaultContentFingerprint(h.page)).toEqual(before);
			await h.page.getByRole("combobox", { name: /^(其他输入方式|Other input methods)$/, exact: true }).click();
			await h.page.getByRole("option", { name: /^(粘贴清单|Paste a list)$/, exact: true }).click();
			h.mock.responses.push(fixture.response);
			await recognize(h.page, importer);
			await expect(importer.locator(".pw-work-list-row:not([data-source-group])")).toHaveCount(1);
			await expect(importer.getByRole("tab", { name: /^(已核对|Reviewed) 0$/ })).toBeVisible();
			expect(await visualVaultContentFingerprint(h.page)).toEqual(before);
			expect(h.mock.requests).toHaveLength(3);
			expect(h.errors).toEqual([]);
		} finally { await h.close(); }
	});
}

test("T08 late successful recognition after explicit lock cannot refill the encrypted saved source", async ({ browser }) => {
	const h = await visualHarness(browser, "en", { width: 1280, height: 900 });
	const fixture = recognitionFixture([{ title: "Late synthetic service", username: "late@example.test", password: "Synthetic-late-only!42" }]);
	let release: () => void = () => {};
	try {
		await h.configure();
		await h.createVault();
		const before = await visualVaultContentFingerprint(h.page);
		let importer = await h.open();
		await importer.locator("#pw-smart-source").fill(fixture.source);
		let arrived!: () => void;
		let completed!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const received = new Promise<void>(resolve => { arrived = resolve; });
		const settled = new Promise<void>(resolve => { completed = resolve; });
		await h.page.route(`${h.mock.baseURL}/chat/completions`, async route => {
			arrived();
			await gate;
			try {
				await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "late-synthetic", object: "chat.completion", created: 1791150000, model, choices: [{ index: 0, message: { role: "assistant", content: fixture.response }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) });
			} catch { /* An already-aborted request also cannot update the review. */ }
			finally { completed(); }
		});
		await recognize(h.page, importer);
		await received;
		await h.page.getByRole("combobox", { name: "Import actions", exact: true }).click();
		await h.page.getByRole("option", { name: "Lock and close", exact: true }).click();
		await h.page.getByRole("dialog").last().getByRole("button", { name: "Lock and close", exact: true }).click();
		await expect(h.page.locator("#password-vault-unlock-master")).toBeVisible();
		release();
		await settled;
		await h.page.locator("#password-vault-unlock-master").fill(visualMaster);
		await h.page.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true }).click();
		importer = await h.open();
		await expect(importer.locator("#pw-smart-source")).toHaveValue(fixture.source);
		await expect(importer.locator(".pw-work-list-row")).toHaveCount(0);
		expect(await visualVaultContentFingerprint(h.page)).toEqual(before);
		expect(h.mock.requests).toHaveLength(0);
		expect(h.errors).toEqual([]);
	} finally { release(); await h.close(); }
});
