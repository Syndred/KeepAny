import { expect, test, type Page } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";
import { sourceModuleUrl } from "./helpers/source-module-url";

const repositoryModuleUrl = sourceModuleUrl("packages/local-db/src/index.ts");
const domainModuleUrl = sourceModuleUrl("packages/domain/src/index.ts");

async function seedLedger(page: Page) {
	return page.evaluate(async ({ repositoryPath, domainPath }) => {
		const { saveBatch } = await import(repositoryPath);
		const { newAsset } = await import(domainPath);
		const now = new Date();
		const monthDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15`;
		const subscription = { ...newAsset("subscription"), name: "Cloud storage", amount: 1000, currency: "CNY" as const, dueDate: monthDate };
		const dollarSubscription = { ...newAsset("subscription"), name: "Developer tools", amount: 2000, currency: "USD" as const, dueDate: monthDate };
		const account = { ...newAsset("account"), name: "Travel card", currency: "CNY" as const };
		const renewal = { id: crypto.randomUUID(), assetId: subscription.id, action: "renew", note: "", billDate: monthDate, amount: 500, currency: "CNY", createdAt: now.toISOString(), deleted: false };
		await saveBatch([
			...([subscription, dollarSubscription, account].map((value) => ({ type: "asset" as const, value }))),
			{ type: "history", value: renewal },
		]);
		return { subscriptionId: subscription.id, dollarId: dollarSubscription.id, accountId: account.id };
	}, { repositoryPath: repositoryModuleUrl, domainPath: domainModuleUrl });
}

async function storedHistory(page: Page) {
	return page.evaluate(async (repositoryPath) => {
		const { localRepository } = await import(repositoryPath);
		return (await localRepository()).list("history") as Promise<Array<{ action: string; assetId: string; title?: string; source?: string; amount?: number; currency?: string; eventDate?: string }>>;
	}, repositoryModuleUrl);
}

async function record(page: Page, input: { type: string; asset: string; title: string; amount: string; source: string; currency?: string }) {
	await page.getByRole("button", { name: "Record transaction" }).click();
	const dialog = page.getByRole("dialog", { name: "Record transaction" });
	await selectChoice(dialog.getByLabel("Record type"), input.type);
	await selectChoice(dialog.getByLabel("Subscription or account"), input.asset);
	await dialog.getByLabel("Title").fill(input.title);
	await dialog.getByLabel("Amount").fill(input.amount);
	if (input.currency) await selectChoice(dialog.getByLabel("Currency"), input.currency);
	await dialog.getByLabel("Payment source (optional)").fill(input.source);
	await dialog.getByRole("button", { name: "Save record" }).click();
	await expect(dialog).toBeHidden();
}

test("ledger records confirmed spending, preserves renewal history and reads back after refresh", async ({ page }) => {
	await page.goto("/finance");
	await expect(page.getByRole("heading", { name: "Subscriptions and bills" })).toBeVisible();
	const ids = await seedLedger(page);
	const summary = page.locator(".finance-summary");
	await expect(summary.locator(".card").nth(0)).toContainText("10.00");
	await expect(summary.locator(".card").nth(0)).toContainText("20.00");
	await expect(summary.locator(".card").nth(1)).toContainText("5.00");
	await record(page, { type: "expense", asset: ids.subscriptionId, title: "Extra storage", amount: "12.34", source: "Visa statement" });
	await expect(summary.locator(".card").nth(1)).toContainText("17.34");
	await record(page, { type: "expense", asset: ids.dollarId, title: "Developer tools invoice", amount: "3", source: "Dollar card" });
	await expect(summary.locator(".card").nth(1)).toContainText("$3.00");
	await record(page, { type: "topup", asset: ids.accountId, title: "Card top-up", amount: "20", source: "Bank transfer" });
	await record(page, { type: "refund", asset: ids.accountId, title: "Card refund", amount: "1", source: "" });
	await record(page, { type: "balance", asset: ids.accountId, title: "Card balance", amount: "23.60", source: "Card app" });
	await expect(summary.locator(".card").nth(1)).toContainText("17.34");
	await expect(summary.locator(".card").nth(2)).toContainText("23.60");
	await selectChoice(page.getByRole("combobox", { name: "Type" }), "refund");
	await expect(page.locator(".finance-entry")).toHaveCount(1);
	await expect(page.locator(".finance-entry")).toContainText("Card refund");
	await selectChoice(page.getByRole("combobox", { name: "Type" }), "all");
	await selectChoice(page.getByRole("combobox", { name: "Related asset" }), ids.accountId);
	await expect(page.locator(".finance-entry")).toHaveCount(3);
	await selectChoice(page.getByRole("combobox", { name: "Payment source or method" }), "source:Card app");
	await expect(page.locator(".finance-entry")).toHaveCount(1);
	await expect(page.locator(".finance-entry")).toContainText("Card balance");
	await selectChoice(page.getByRole("combobox", { name: "Related asset" }), "");
	await selectChoice(page.getByRole("combobox", { name: "Payment source or method" }), "empty");
	await expect(page.locator(".finance-entry")).toHaveCount(2);
	await expect(page.locator(".finance-entry").filter({ hasText: "Card refund" })).toContainText("No source recorded");
	await expect(page.locator(".finance-entry").filter({ hasText: "Recorded renewal" })).toHaveCount(1);

	const entries = await storedHistory(page);
	const expense = entries.find((entry) => entry.title === "Extra storage");
	expect(expense).toMatchObject({ action: "expense", assetId: ids.subscriptionId, amount: 1234, currency: "CNY", source: "Visa statement" });
	expect(entries.find((entry) => entry.title === "Card balance")).toMatchObject({ action: "balance", assetId: ids.accountId, amount: 2360 });
	await page.reload();
	await expect(summary.locator(".card").nth(1)).toContainText("17.34");
	await expect(summary.locator(".card").nth(2)).toContainText("23.60");
	await expect(page.locator(".finance-entry")).toHaveCount(6);
	await page.locator(".finance-subscription").filter({ hasText: "Cloud storage" }).click();
	await expect(page).toHaveURL(new RegExp(`/assets/subscription/${ids.subscriptionId}$`));
	await expect(page.getByRole("link", { name: "View bills" })).toBeVisible();
	await page.goto("/assets/subscription");
	await expect(page.getByRole("link", { name: "View bills" })).toHaveAttribute("href", "/finance");
});

test("invalid record stays unsaved and a missing related asset offers creation paths", async ({ page }) => {
	await page.goto("/finance");
	await page.getByRole("button", { name: "Record transaction" }).click();
	const dialog = page.getByRole("dialog", { name: "Record transaction" });
	await expect(dialog.getByText("Add a subscription or account before recording a transaction.")).toBeVisible();
	await expect(dialog.getByRole("link", { name: "Add subscription" })).toHaveAttribute("href", "/assets/subscription");
	await expect(dialog.getByRole("link", { name: "Add account" })).toHaveAttribute("href", "/assets/account");
	await dialog.getByRole("button", { name: "Close" }).click();
	const ids = await seedLedger(page);
	await page.getByRole("button", { name: "Record transaction" }).click();
	const form = page.getByRole("dialog", { name: "Record transaction" });
	await selectChoice(form.getByLabel("Subscription or account"), ids.subscriptionId);
	await form.getByLabel("Title").fill("Invalid expense");
	await form.getByLabel("Amount").fill("0");
	await form.getByLabel("Payment source (optional)").fill("Statement");
	await form.getByRole("button", { name: "Save record" }).click();
	await expect(form.getByRole("alert")).toContainText("valid amount");
	await form.getByLabel("Amount").fill("1.234");
	await form.getByRole("button", { name: "Save record" }).click();
	await expect(form.getByRole("alert")).toContainText("valid amount");
	await selectChoice(form.getByLabel("Record type"), "balance");
	await form.getByLabel("Amount").fill("");
	await form.getByRole("button", { name: "Save record" }).click();
	await expect(form.getByRole("alert")).toContainText("valid amount");
	expect((await storedHistory(page)).filter((entry) => entry.action === "expense")).toHaveLength(0);
});
