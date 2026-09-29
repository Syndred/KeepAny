import { expect, test, type Page } from "@playwright/test";

const domainPath = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

async function seedFinance(page: Page) {
	return page.evaluate(async ({ domainPath, repositoryPath }) => {
		const { newAsset, relationSchema, historySchema } = await import(domainPath);
		const { saveBatch } = await import(repositoryPath);
		const now = new Date().toISOString();
		const project = { ...newAsset("project"), name: "Mori Studio" };
		const account = { ...newAsset("account"), name: "Studio billing account" };
		const subscription = { ...newAsset("subscription"), name: "Cloud hosting", amount: 9800, dueDate: "2026-10-22" };
		const relations = [
			relationSchema.parse({ id: crypto.randomUUID(), from: subscription.id, to: project.id, label: "used by", createdAt: now }),
			relationSchema.parse({ id: crypto.randomUUID(), from: account.id, to: subscription.id, label: "manages", createdAt: now }),
		];
		const payment = historySchema.parse({ id: crypto.randomUUID(), assetId: subscription.id, action: "expense", title: "September hosting", amount: 9800, currency: "CNY", eventDate: "2026-09-22", source: "Visa statement", note: "", createdAt: now });
		await saveBatch([
			{ type: "asset", value: project }, { type: "asset", value: account }, { type: "asset", value: subscription },
			...relations.map((value) => ({ type: "relation" as const, value })),
			{ type: "history", value: payment },
		]);
		return { projectId: project.id, accountId: account.id, subscriptionId: subscription.id };
	}, { domainPath, repositoryPath });
}

for (const locale of ["zh-CN", "en"] as const) {
	test(`finance shows recorded subscription connections in ${locale}`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.goto("/");
		await page.evaluate((value) => localStorage.setItem("keepany-language", value), locale);
		const ids = await seedFinance(page);
		await page.goto("/finance");
		const linked = page.locator(".finance-linked-card");
		await expect(linked).toContainText(locale === "en" ? "Subscription connections" : "订阅关联");
		await expect(linked).toContainText("Cloud hosting");
		await expect(linked).toContainText("Visa statement");
		await expect(linked.getByRole("link", { name: "Mori Studio ↗" })).toHaveAttribute("href", `/assets/project/${ids.projectId}`);
		await expect(linked.getByRole("link", { name: "Studio billing account ↗" })).toHaveAttribute("href", `/assets/account/${ids.accountId}`);
		await page.screenshot({ path: `/tmp/keepany-finance-${locale}-1280.png`, fullPage: true });
		await linked.getByRole("link", { name: "Mori Studio ↗" }).click();
		await expect(page).toHaveURL(new RegExp(`/assets/project/${ids.projectId}$`));
		await page.goto("/finance");
		await linked.getByRole("link", { name: "Studio billing account ↗" }).click();
		await expect(page).toHaveURL(new RegExp(`/assets/account/${ids.accountId}$`));
	});
}

test("finance creates and edits real subscriptions without adding a payment record", async ({ page }) => {
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("keepany-language", "en"));
	const ids = await seedFinance(page);
	await page.goto("/finance");
	const row = page.locator(".finance-linked-row").filter({ hasText: "Cloud hosting" });
	await row.getByRole("button", { name: "Edit" }).click();
	const edit = page.getByRole("dialog", { name: "Edit" });
	await edit.getByLabel("Name", { exact: true }).fill("Cloud hosting updated");
	await edit.getByRole("button", { name: "Save" }).click();
	await expect(edit).toBeHidden();
	await expect(page.locator(".finance-linked-row")).toContainText("Cloud hosting updated");
	await page.getByRole("button", { name: "Add subscription" }).click();
	const create = page.getByRole("dialog");
	await create.getByLabel("Name", { exact: true }).fill("Archive backup");
	await create.locator("#amount").fill("12.50");
	await create.locator("#dueDate").fill("2026-11-01");
	await create.getByRole("button", { name: "Save" }).click();
	await expect(create).toBeHidden();
	await expect(page.locator(".finance-linked-row")).toHaveCount(2);
	await expect(page.locator(".finance-linked-row").filter({ hasText: "Archive backup" })).toContainText("No linked project or account");
	await page.reload();
	await expect(page.locator(".finance-linked-row")).toHaveCount(2);
	await expect(page.locator(".finance-linked-row").filter({ hasText: "Cloud hosting updated" })).toContainText("Mori Studio");
	await expect(page.evaluate(async ({ repositoryPath, subscriptionId }) => {
		const { localRepository } = await import(repositoryPath);
		const repository = await localRepository();
		const assets = await repository.list("asset") as Array<{ id: string; name: string }>;
		const history = await repository.list("history") as Array<{ action: string }>;
		return { renamed: assets.find((asset) => asset.id === subscriptionId)?.name, created: assets.some((asset) => asset.name === "Archive backup"), historyCount: history.length };
	}, { repositoryPath, subscriptionId: ids.subscriptionId })).resolves.toEqual({ renamed: "Cloud hosting updated", created: true, historyCount: 1 });
});

test("finance connections remain readable on mobile", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/");
	await page.evaluate(() => localStorage.setItem("keepany-language", "zh-CN"));
	await seedFinance(page);
	await page.goto("/finance");
	await expect(page.locator(".finance-linked-card")).toContainText("Mori Studio");
	await expect(page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).resolves.toBe(true);
	await page.screenshot({ path: "/tmp/keepany-finance-zh-CN-390.png", fullPage: true });
});
