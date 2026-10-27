import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { sourceModuleUrl } from "./helpers/source-module-url";
import { selectChoice } from "./helpers/select-choice";

const repositoryPath = sourceModuleUrl("packages/local-db/src/index.ts");
const domainPath = sourceModuleUrl("packages/domain/src/index.ts");
const evidence = "docs/qa/2026-10-27/evidence/T14-round2";

async function history(page: Page) {
	return page.evaluate(async (path) => {
		const { localRepository } = await import(path);
		return (await (await localRepository()).list("history")).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
	}, repositoryPath);
}

for (const locale of ["zh-CN", "en"] as const) {
	test(`ledger preserves confirmed entries through subscription editing and cancelled drafts (${locale})`, async ({ page }) => {
		await page.setViewportSize({ width: locale === "zh-CN" ? 390 : 1280, height: 844 });
		await page.goto("/");
		await page.evaluate((language) => localStorage.setItem("keepany-language", language), locale);
		const ids = await page.evaluate(async ({ repositoryPath, domainPath }) => {
			const { saveBatch } = await import(repositoryPath);
			const { newAsset, relationSchema, historySchema } = await import(domainPath);
			const createdAt = new Date().toISOString();
			const project = { ...newAsset("project"), name: "T14 Project" };
			const item = { ...newAsset("item"), name: "T14 Physical item" };
			const account = { ...newAsset("account"), name: "T14 Billing account" };
			const subscription = { ...newAsset("subscription"), name: "T14 Subscription", amount: 1000, dueDate: "2026-11-15" };
			const relations = [project, account].map((asset) => relationSchema.parse({ id: crypto.randomUUID(), from: subscription.id, to: asset.id, label: "uses", createdAt }));
			const renewal = historySchema.parse({ id: crypto.randomUUID(), assetId: subscription.id, action: "renew", billDate: "2026-10-15", amount: 500, currency: "CNY", note: "T14 original renewal", createdAt });
			await saveBatch([...([project, item, account, subscription].map((value) => ({ type: "asset", value }))), ...relations.map((value) => ({ type: "relation", value })), { type: "history", value: renewal }]);
			return { project: project.id, item: item.id, account: account.id, subscription: subscription.id, renewal: renewal.id };
		}, { repositoryPath, domainPath });
		await page.goto("/finance");
		const linked = page.locator(".finance-linked-row");
		await expect(linked).toContainText("T14 Project");
		await expect(linked).toContainText("T14 Billing account");
		const add = () => page.getByRole("button", { name: locale === "en" ? "Record transaction" : "记一笔", exact: true });
		const before = await history(page);
		await add().click();
		const dialog = page.getByRole("dialog");
		await dialog.locator("#finance-asset").click();
		const targetOptions = await page.getByRole("option").allTextContents();
		await page.keyboard.press("Escape");
		await selectChoice(dialog.locator("#finance-asset"), ids.subscription);
		await dialog.locator("#finance-title").fill("T14 confirmed invoice");
		await dialog.locator("#finance-amount").fill("12.34");
		await dialog.locator("#finance-date").fill("2026-10-20");
		await dialog.locator("#finance-source").fill("Synthetic statement");
		await expect.poll(() => history(page)).toEqual(before);
		await dialog.getByRole("button", { name: locale === "en" ? "Save record" : "保存记录", exact: true }).click();
		await expect(dialog).toBeHidden();
		await expect(page.locator(".finance-entry")).toHaveCount(2);
		const confirmed = await history(page);
		expect(confirmed.find((row: any) => row.title === "T14 confirmed invoice")).toMatchObject({ assetId: ids.subscription, amount: 1234, currency: "CNY", eventDate: "2026-10-20", source: "Synthetic statement" });
		expect(confirmed.find((row: any) => row.id === ids.renewal)).toMatchObject({ amount: 500, billDate: "2026-10-15", note: "T14 original renewal" });
		const ledgerControls = await page.locator(".finance-entry").evaluateAll((rows) => rows.map((row) => ({ text: row.textContent, controls: Array.from(row.querySelectorAll("button,a,input")).map((el) => el.textContent) })));
		await linked.getByRole("button", { name: locale === "en" ? "Edit" : "编辑", exact: true }).click();
		const editor = page.getByRole("dialog");
		await editor.locator("#amount").fill("25.50");
		await editor.locator("#dueDate").fill("2026-12-22");
		await editor.getByRole("button", { name: locale === "en" ? "Save" : "保存", exact: true }).click();
		await expect(editor).toBeHidden();
		await expect(linked).toContainText("25.50");
		const updatedSubscription = await page.evaluate(async ({ repositoryPath, id }) => {
			const { localRepository } = await import(repositoryPath);
			const asset = await (await localRepository()).get("asset", id);
			return { id: asset.id, amount: asset.amount, dueDate: asset.dueDate };
		}, { repositoryPath, id: ids.subscription });
		expect(updatedSubscription).toEqual({ id: ids.subscription, amount: 2550, dueDate: "2026-12-22" });
		expect(await history(page)).toEqual(confirmed);
		await add().click();
		await dialog.locator("#finance-amount").fill("1.234");
		await dialog.getByRole("button", { name: locale === "en" ? "Save record" : "保存记录", exact: true }).click();
		await expect(dialog.getByRole("alert")).toBeVisible();
		expect(await history(page)).toEqual(confirmed);
		await dialog.locator("#finance-amount").fill("99.99");
		await dialog.getByRole("button", { name: locale === "en" ? "Cancel" : "取消", exact: true }).click();
		await expect(dialog).toBeHidden();
		await page.reload();
		await expect(page.locator(".finance-entry")).toHaveCount(2);
		expect(await history(page)).toEqual(confirmed);
		mkdirSync(evidence, { recursive: true });
		await page.screenshot({ path: `${evidence}/${locale}-${locale === "en" ? 1280 : 390}.png`, fullPage: true });
		// Observations are receipts, not generated expected values or assertions that missing UI must remain absent.
		const routes = [];
		for (const [kind, id] of [["project", ids.project], ["item", ids.item], ["subscription", ids.subscription]]) {
			await page.goto(`/assets/${kind}/${id}`);
			await expect(page.getByRole("heading", { name: `T14 ${kind === "project" ? "Project" : kind === "item" ? "Physical item" : "Subscription"}`, exact: true })).toBeVisible();
			routes.push({ kind, buttons: await page.getByRole("button").allTextContents(), financeLinks: await page.locator('a[href="/finance"]').allTextContents() });
		}
		writeFileSync(`${evidence}/${locale}-receipt.json`, JSON.stringify({ locale, port: 4208, ids, targetOptions, ledgerControls, historyCount: confirmed.length, entries: confirmed, updatedSubscription, invalidAndCancelPreservedHistory: true, refreshPreservedHistory: true, routes }, null, 2));
	});
}
