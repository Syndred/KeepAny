import { expect, test, type Page } from "@playwright/test";

const domainPath = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

async function seedTargets(page: Page) {
	return page.evaluate(async ({ domainPath, repositoryPath }) => {
		const { newAsset } = await import(domainPath);
		const { saveBatch } = await import(repositoryPath);
		const projectA = { ...newAsset("project"), name: "Project A" };
		const projectB = { ...newAsset("project"), name: "Project B" };
		const accountA = { ...newAsset("account"), name: "Account A" };
		const accountB = { ...newAsset("account"), name: "Account B" };
		await saveBatch([projectA, projectB, accountA, accountB].map((value) => ({ type: "asset" as const, value })));
		return { projectA: projectA.id, projectB: projectB.id, accountA: accountA.id, accountB: accountB.id };
	}, { domainPath, repositoryPath });
}

async function subscriptionState(page: Page) {
	return page.evaluate(async (repositoryPath) => {
		const { localRepository } = await import(repositoryPath);
		const repository = await localRepository();
		const assets = await repository.list("asset") as Array<{ id: string; kind: string; subscriptionPaymentMethod: string }>;
		const subscription = assets.find((asset) => asset.kind === "subscription");
		const relations = await repository.list("relation") as Array<{ from: string; to: string }>;
		const history = await repository.list("history") as unknown[];
		return { subscription, linkedIds: relations.filter((relation) => relation.from === subscription?.id || relation.to === subscription?.id)
			.map((relation) => relation.from === subscription?.id ? relation.to : relation.from).sort(), historyCount: history.length };
	}, repositoryPath);
}

for (const locale of ["zh-CN", "en-US"] as const) {
	for (const width of [390, 1280]) {
		test(`${locale} subscription keeps payment method and additive connections at ${width}px`, async ({ browser }) => {
			const context = await browser.newContext({ locale, viewport: { width, height: 844 } });
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const copy = locale === "zh-CN" ? { add: "添加订阅", save: "保存", edit: "编辑", payment: "付款方式", source: "最近记录来源" }
				: { add: "Add subscription", save: "Save", edit: "Edit", payment: "Payment method", source: "Latest recorded source" };
			try {
				await page.goto("/finance");
				const ids = await seedTargets(page);
				await page.reload();
				await page.getByRole("button", { name: copy.add }).click();
				const dialog = page.getByRole("dialog");
				await dialog.locator("#name").fill("Cloud plan");
				await dialog.locator("#subscriptionProject").selectOption(ids.projectA);
				await dialog.locator("#subscriptionLoginAccount").selectOption(ids.accountA);
				await dialog.locator("#subscriptionPaymentMethod").fill("Visa ending 4242");
				await dialog.locator("#amount").fill("12.50");
				await dialog.locator("#dueDate").fill("2026-11-01");
				await dialog.getByRole("button", { name: copy.save, exact: true }).click();
				await expect(dialog).toBeHidden();
				const row = page.locator(".finance-linked-row").filter({ hasText: "Cloud plan" });
				await expect(row).toContainText("Project A");
				await expect(row).toContainText("Account A");
				await expect(row).toContainText(`${copy.payment}: Visa ending 4242`);
				await expect(row).toContainText(copy.source);
				await page.reload();
				let state = await subscriptionState(page);
				expect(state.subscription?.subscriptionPaymentMethod).toBe("Visa ending 4242");
				expect(state.linkedIds).toEqual([ids.projectA, ids.accountA].sort());
				expect(state.historyCount).toBe(0);
				await row.getByRole("button", { name: copy.edit }).click();
				await expect(dialog.locator("#subscriptionProject")).toHaveValue(ids.projectA);
				await expect(dialog.locator("#subscriptionLoginAccount")).toHaveValue(ids.accountA);
				await dialog.locator("#subscriptionProject").selectOption(ids.projectB);
				await dialog.locator("#subscriptionLoginAccount").selectOption(ids.accountB);
				await dialog.locator("#subscriptionPaymentMethod").fill("Bank transfer");
				await dialog.getByRole("button", { name: copy.save, exact: true }).click();
				await expect(dialog).toBeHidden();
				await page.reload();
				state = await subscriptionState(page);
				expect(state.subscription?.subscriptionPaymentMethod).toBe("Bank transfer");
				expect(state.linkedIds).toEqual([ids.projectA, ids.projectB, ids.accountA, ids.accountB].sort());
				expect(state.historyCount).toBe(0);
				await expect(row).toContainText("Project A");
				await expect(row).toContainText("Project B");
				await expect(row).toContainText("Account A");
				await expect(row).toContainText("Account B");
				await expect(row).toContainText(`${copy.payment}: Bank transfer`);
				await row.getByRole("button", { name: copy.edit }).click();
				await dialog.getByRole("button", { name: copy.save, exact: true }).click();
				await expect(dialog).toBeHidden();
				expect((await subscriptionState(page)).linkedIds).toHaveLength(4);
				await page.screenshot({ path: `/private/tmp/keepany-subscription-editor-${locale}-${width}.png`, fullPage: true });
				expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
				expect(errors).toEqual([]);
			} finally { await context.close(); }
		});
	}
}

test("stale subscription edit does not overwrite another tab's asset changes", async ({ page }) => {
	await page.goto("/finance");
	const id = await page.evaluate(async ({ domainPath, repositoryPath }) => {
		const { newAsset } = await import(domainPath);
		const { save } = await import(repositoryPath);
		const subscription = { ...newAsset("subscription"), name: "Existing plan" };
		await save("asset", subscription);
		return subscription.id;
	}, { domainPath, repositoryPath });
	await page.reload();
	await page.locator(".finance-linked-row").filter({ hasText: "Existing plan" }).getByRole("button", { name: "Edit" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.locator("#subscriptionPaymentMethod")).toHaveValue("");
	await dialog.locator("#subscriptionPaymentMethod").fill("Bank transfer");
	await page.evaluate(async ({ repositoryPath, id }) => {
		const { localRepository, saveAssetIfCurrent } = await import(repositoryPath);
		const current = await (await localRepository()).get("asset", id);
		await saveAssetIfCurrent(current, { ...current, name: "Changed elsewhere", updatedAt: new Date().toISOString() });
	}, { repositoryPath, id });
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog.getByRole("alert")).toContainText("changed elsewhere");
	await expect(dialog).toBeVisible();
	const stored = await page.evaluate(async ({ repositoryPath, id }) => {
		const { localRepository } = await import(repositoryPath);
		const asset = await (await localRepository()).get("asset", id);
		return { name: asset.name, paymentMethod: asset.subscriptionPaymentMethod };
	}, { repositoryPath, id });
	expect(stored).toEqual({ name: "Changed elsewhere", paymentMethod: "" });
});

test("reselecting a removed project creates one active connection", async ({ page }) => {
	await page.goto("/finance");
	const ids = await page.evaluate(async ({ domainPath, repositoryPath }) => {
		const { newAsset } = await import(domainPath);
		const { saveBatch } = await import(repositoryPath);
		const subscription = { ...newAsset("subscription"), name: "Reconnected plan" };
		const project = { ...newAsset("project"), name: "Project to reconnect" };
		const removedRelation = { id: crypto.randomUUID(), from: subscription.id, to: project.id, label: "Project", createdAt: new Date().toISOString(), verifiedAt: "", deleted: true };
		await saveBatch([{ type: "asset", value: subscription }, { type: "asset", value: project }, { type: "relation", value: removedRelation }]);
		return { subscriptionId: subscription.id, projectId: project.id };
	}, { domainPath, repositoryPath });
	await page.reload();
	const row = page.locator(".finance-linked-row").filter({ hasText: "Reconnected plan" });
	await row.getByRole("button", { name: "Edit" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.locator("#subscriptionProject").selectOption(ids.projectId);
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog).toBeHidden();
	const activeCount = await page.evaluate(async ({ repositoryPath, ids }) => {
		const { localRepository } = await import(repositoryPath);
		const relations = await (await localRepository()).list("relation") as Array<{ deleted: boolean; from: string; to: string }>;
		return relations.filter((relation) => !relation.deleted && relation.from === ids.subscriptionId && relation.to === ids.projectId).length;
	}, { repositoryPath, ids });
	expect(activeCount).toBe(1);
});
