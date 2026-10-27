import { expect, test, type Page } from "@playwright/test";
import { visualHarness, visualMaster } from "./fixtures/password-smart-import-visual";
import { labels, openAssistant, syntheticKey } from "./helpers/ai-workflow";
import { sourceModuleUrl } from "./helpers/source-module-url";
import { selectChoice } from "./helpers/select-choice";
import { aiCopy } from "../../apps/web/src/ai-copy";

test.setTimeout(120_000);
const repoUrl = sourceModuleUrl("packages/local-db/src/index.ts");
const domainUrl = sourceModuleUrl("packages/domain/src/index.ts");
// Use the application's canonical URL so the readback shares its in-memory store.
const aiUrl = "/src/ai-settings-store.ts";
async function tasks(page: Page) {
	return page.evaluate(async path => (await (await import(path)).localRepository()).list("task"), repoUrl);
}
async function connected(page: Page) {
	return page.evaluate(async path => !!(await import(path)).getAiConnection(), aiUrl);
}

for (const [locale, width] of [["zh-CN", 390], ["en", 1280]] as const) {
	test(`${locale} ${width} T21 selected ordinary records send seven public fields and exact major-unit amount`, async ({ browser }) => {
		const h = await visualHarness(browser, locale, { width, height: 950 });
		try {
			await h.configure();
			await h.createVault();
			await h.seedExisting({ title: "Private KDBX excluded title", username: "private-kdbx@example.test", password: "Private-KDBX-only-secret!42" });
			await h.page.evaluate(async ([repository, domain]) => {
				const { saveBatch } = await import(repository);
				const { newAsset } = await import(domain);
				await saveBatch([
					{ type: "asset", value: { ...newAsset("subscription"), name: "Selected public subscription", description: "Public selected summary", amount: 1250, currency: "USD", cycle: "month", dueDate: "2026-12-20", notes: "Excluded-private-note-sentinel", contact: "Excluded-private-contact-sentinel", url: "https://private-url-user:private-url-pass@example.test/public?private-query-token=secret#private-fragment" } },
					{ type: "asset", value: { ...newAsset("project"), name: "Unselected private asset sentinel", description: "Unselected private description sentinel" } },
				]);
			}, [repoUrl, domainUrl]);
			const dialog = await openAssistant(h.page, labels[locale]);
			await expect(dialog.getByRole("checkbox", { name: "Private KDBX excluded title" })).toHaveCount(0);
			await dialog.getByRole("checkbox", { name: "Selected public subscription" }).check();
			await expect(dialog.getByRole("checkbox", { name: "Unselected private asset sentinel" })).not.toBeChecked();
			await dialog.getByLabel(labels[locale].question, { exact: true }).fill("Summarize the selected subscription");
			expect(h.mock.requests).toHaveLength(0);
			h.mock.responses.push("Synthetic public answer");
			await dialog.getByRole("button", { name: labels[locale].send, exact: true }).click();
			await expect(dialog.getByText("Synthetic public answer", { exact: true })).toBeVisible();
			const body = h.mock.requests[0].body;
			const input = JSON.parse(body.messages.find(message => message.role === "user")?.content ?? "null");
			expect(input.records).toEqual([{ kind: "subscription", name: "Selected public subscription", description: "Public selected summary", url: "https://example.test/public", dueDate: "2026-12-20", amount: "12.50", currency: "USD" }]);
			for (const excluded of ["Private KDBX excluded title", "private-kdbx@example.test", "Private-KDBX-only-secret!42", "Unselected private asset sentinel", "Unselected private description sentinel", "Excluded-private-note-sentinel", "Excluded-private-contact-sentinel", "private-url-user", "private-url-pass", "private-query-token", "private-fragment", syntheticKey, visualMaster]) expect(JSON.stringify(body)).not.toContain(excluded);
			expect(body.messages.find(message => message.role === "system")?.content).toContain("Billing cycles are not supplied, so do not infer monthly costs");
			expect(h.errors).toEqual([]);
		} finally { await h.close(); }
	});
}

test("T21 session key disappears on reload and encrypted automatic activation rejects changed endpoint metadata", async ({ browser }) => {
	const h = await visualHarness(browser, "en");
	try {
		await h.configure();
		expect(await connected(h.page)).toBe(true);
		expect(await h.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(syntheticKey);
		await h.page.reload();
		expect(await connected(h.page)).toBe(false);
		await h.createVault();
		await h.page.getByRole("button", { name: labels.en.assistantMenu, exact: true }).click();
		await h.page.getByRole("link", { name: labels.en.assistantAccess, exact: true }).click();
		await h.page.getByRole("link", { name: "Configure local access", exact: true }).click();
		const settings = h.page.locator(".ai-settings-panel");
		await selectChoice(settings.locator("#ai-settings-key-source"), "vault");
		await settings.locator("#ai-settings-api-key").fill(syntheticKey);
		await settings.locator("#ai-settings-auto-activate").check();
		await settings.getByRole("button", { name: "Save configuration", exact: true }).click();
		await expect(settings.getByRole("status").filter({ hasText: aiCopy.aiSettingsVaultSaved[1] })).toBeVisible();
		await expect.poll(() => connected(h.page)).toBe(true);
		const original = await h.page.evaluate(() => JSON.parse(localStorage.getItem("keepany-ai-settings-v1") ?? "null"));
		expect(original.vaultEntryId).toBeTruthy();
		await h.page.evaluate(() => {
			const metadata = JSON.parse(localStorage.getItem("keepany-ai-settings-v1") ?? "null");
			metadata.baseURL += "/unapproved-target";
			localStorage.setItem("keepany-ai-settings-v1", JSON.stringify(metadata));
		});
		await h.page.reload();
		async function unlockFromSettings() {
			const open = settings.getByRole("button", { name: aiCopy.aiSettingsOpenVault[1], exact: true });
			await expect(settings.locator("#ai-settings-master").or(open)).toBeVisible();
			if (await open.isVisible()) await open.click();
			await settings.locator("#ai-settings-master").fill(visualMaster);
			await settings.getByRole("button", { name: aiCopy.aiSettingsUnlockVault[1], exact: true }).click();
			await expect(settings.locator("#ai-settings-master")).toHaveCount(0);
		}
		await unlockFromSettings();
		expect(await connected(h.page)).toBe(false);
		expect(h.mock.requests).toHaveLength(0);
		await h.page.evaluate(value => localStorage.setItem("keepany-ai-settings-v1", JSON.stringify(value)), original);
		await h.page.reload();
		await unlockFromSettings();
		await expect.poll(() => connected(h.page)).toBe(true);
		expect(h.errors).toEqual([]);
	} finally { await h.close(); }
});

test("T21 closing a request and replacing configuration discards its late valid response", async ({ browser }) => {
	const h = await visualHarness(browser, "en");
	let release: () => void = () => {};
	try {
		await h.configure();
		await h.page.evaluate(async ([repository, domain]) => {
			const { save } = await import(repository);
			const { newAsset } = await import(domain);
			await save("asset", { ...newAsset("project"), name: "Old request project" });
		}, [repoUrl, domainUrl]);
		const dialog = await openAssistant(h.page, labels.en);
		await dialog.getByRole("checkbox", { name: "Old request project", exact: true }).check();
		await dialog.getByLabel(labels.en.question, { exact: true }).fill("Summarize old request");
		let arrived!: () => void;
		let done!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const received = new Promise<void>(resolve => { arrived = resolve; });
		const settled = new Promise<void>(resolve => { done = resolve; });
		await h.page.route(`${h.mock.baseURL}/chat/completions`, async route => {
			arrived(); await gate;
			try { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "Late superseded answer" } }] }) }); }
			catch { /* Closed requests may already be aborted. */ }
			finally { done(); }
		});
		await dialog.getByRole("button", { name: labels.en.send, exact: true }).click();
		await received;
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
		await h.page.getByRole("link", { name: "Configure local access", exact: true }).click();
		const settings = h.page.locator(".ai-settings-panel");
		await settings.locator("#ai-settings-model").fill("replacement-synthetic-model");
		await selectChoice(settings.locator("#ai-settings-key-source"), "none");
		await settings.getByRole("button", { name: "Save configuration", exact: true }).click();
		release(); await settled;
		await h.page.unroute(`${h.mock.baseURL}/chat/completions`);
		const current = await openAssistant(h.page, labels.en);
		await expect(current).not.toContainText("Late superseded answer");
		await current.getByRole("button", { name: labels.en.reminderTab, exact: true }).click();
		await current.getByLabel(labels.en.question, { exact: true }).fill("Create an idempotent reminder");
		const plan = { operation: "create", name: "Stable synthetic reminder", taskQuery: "", assetQuery: "", localDate: "2026-12-20", localTime: "10:30", timeZone: "Asia/Shanghai", leadMinutes: 30, leadDays: 0, rule: { mode: "once" } };
		h.mock.responses.push(JSON.stringify(plan));
		await current.getByRole("button", { name: labels.en.send, exact: true }).click();
		const preview = current.locator(".ai-plan");
		await expect(preview).toBeVisible();
		expect(await tasks(h.page)).toHaveLength(0);
		await preview.getByRole("button", { name: labels.en.confirmAction, exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
		await expect(preview.getByRole("link", { name: labels.en.saved, exact: true })).toBeVisible();
		const first = await tasks(h.page);
		expect(first).toHaveLength(1);
		h.mock.responses.push(JSON.stringify(plan));
		await current.getByRole("button", { name: labels.en.send, exact: true }).click();
		await preview.getByRole("button", { name: labels.en.confirmAction, exact: true }).click();
		await expect(current.getByRole("alert")).toBeVisible();
		expect((await tasks(h.page)).map((task: { id: string }) => task.id)).toEqual(first.map((task: { id: string }) => task.id));
		await h.page.reload();
		expect((await tasks(h.page)).map((task: { id: string }) => task.id)).toEqual(first.map((task: { id: string }) => task.id));
		expect(h.mock.requests.every(request => request.body.model === "replacement-synthetic-model")).toBe(true);
		expect(h.errors).toEqual([]);
	} finally { release(); await h.close(); }
});

test("T21 canceling ordinary AI import preserves input and retry stages only a candidate until confirmation", async ({ browser }) => {
	const h = await visualHarness(browser, "en", { width: 390, height: 950 });
	let release: () => void = () => {};
	try {
		await h.configure();
		await h.page.locator(".top-actions").getByRole("link", { name: labels.en.intake, exact: true }).click();
		const importer = h.page.locator(".ai-import-panel");
		const source = "Synthetic cancelable project";
		const answer = JSON.stringify({ text: "", records: [{ kind: "project", name: source, url: "", description: "", category: "other", tags: [], amount: null, currency: null, cycle: null, interval: null, dueDate: null, evidence: source, relatedName: "", missingFields: [] }] });
		await importer.locator("#ai-import-text").fill(source);
		let arrived!: () => void;
		let done!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const received = new Promise<void>(resolve => { arrived = resolve; });
		const settled = new Promise<void>(resolve => { done = resolve; });
		await h.page.route(`${h.mock.baseURL}/chat/completions`, async route => {
			arrived(); await gate;
			try { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: answer } }] }) }); }
			catch { /* Cancelled requests may already be aborted. */ }
			finally { done(); }
		});
		await importer.getByRole("button", { name: labels.en.generate, exact: true }).click();
		await received;
		await importer.getByRole("button", { name: "Stop generation", exact: true }).click();
		release(); await settled;
		await expect(importer.locator("#ai-import-text")).toHaveValue(source);
		await expect(h.page.locator(".intake-review-row")).toHaveCount(0);
		const assets = () => h.page.evaluate(async path => (await (await import(path)).localRepository()).list("asset"), repoUrl);
		expect(await assets()).toHaveLength(0);
		await h.page.unroute(`${h.mock.baseURL}/chat/completions`);
		h.mock.responses.push(answer);
		await importer.getByRole("button", { name: labels.en.generate, exact: true }).click();
		const row = h.page.locator(".intake-review-row");
		await expect(row).toHaveCount(1);
		expect(await assets()).toHaveLength(0);
		await row.getByRole("button", { name: labels.en.confirmImport, exact: true }).click();
		await expect(row).toContainText(labels.en.confirmed);
		const saved = await assets();
		expect(saved).toHaveLength(1);
		await h.page.reload();
		expect((await assets()).map((asset: { id: string }) => asset.id)).toEqual(saved.map((asset: { id: string }) => asset.id));
		expect(h.errors).toEqual([]);
	} finally { release(); await h.close(); }
});
