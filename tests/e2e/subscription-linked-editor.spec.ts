import { chromium, expect, test, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
		const assets = await repository.list("asset") as Array<{ id: string; name: string; kind: string; subscriptionPaymentMethod: string }>;
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

test("reselecting a removed reverse project connection creates one active connection", async ({ page }) => {
	await page.goto("/finance");
	const ids = await page.evaluate(async ({ domainPath, repositoryPath }) => {
		const { newAsset } = await import(domainPath);
		const { saveBatch } = await import(repositoryPath);
		const subscription = { ...newAsset("subscription"), name: "Reconnected plan" };
		const project = { ...newAsset("project"), name: "Project to reconnect" };
		const removedRelation = { id: crypto.randomUUID(), from: project.id, to: subscription.id, label: "Project", createdAt: new Date().toISOString(), verifiedAt: "", deleted: true };
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

for (const locale of ["en-US", "zh-CN"] as const) {
	for (const recovery of ["retry", "abandon"] as const) {
		test(`${locale} pending subscription connections survive refresh and ${recovery} through the editor`, async ({ browser }) => {
			const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", error => errors.push(error.message));
			const copy = locale === "zh-CN" ? { edit: "编辑", save: "保存", retry: "重试保存关联", abandon: "放弃未完成关联" }
				: { edit: "Edit", save: "Save", retry: "Retry connections", abandon: "Discard pending connections" };
			try {
				await page.goto("/finance");
				const ids = await seedTargets(page);
				const subscriptionId = await page.evaluate(async ({ domainPath, repositoryPath }) => {
					const { newAsset } = await import(domainPath);
					const { save } = await import(repositoryPath);
					const subscription = { ...newAsset("subscription"), name: "Interrupted plan" };
					await save("asset", subscription);
					return subscription.id;
				}, { domainPath, repositoryPath });
				await page.reload();
				const row = page.locator(".finance-linked-row").filter({ hasText: "Interrupted plan" });
				await row.getByRole("button", { name: copy.edit }).click();
				const dialog = page.getByRole("dialog");
				await dialog.locator("#subscriptionProject").selectOption(ids.projectA);
				await dialog.locator("#subscriptionPaymentMethod").fill("Card after interruption");
				await page.evaluate(async repositoryPath => {
					const { localRepository } = await import(repositoryPath);
					const repository = await localRepository();
					const original = repository.db.records.insert.bind(repository.db.records);
					repository.db.records.insert = async (...args: unknown[]) => {
						if ((args[0] as { type: string }).type === "relation") throw Error("injected relation write failure");
						return original(...args);
					};
				}, repositoryPath);
				await dialog.getByRole("button", { name: copy.save, exact: true }).click();
				await expect(dialog.getByRole("button", { name: copy.retry })).toBeVisible();
				await expect(dialog.getByRole("button", { name: copy.save, exact: true })).toBeDisabled();
				const before = await subscriptionState(page);
				expect(before.subscription?.subscriptionPaymentMethod).toBe("Card after interruption");
				expect(before.linkedIds).toHaveLength(0);
				await page.evaluate(async ({ repositoryPath, id }) => {
					const { localRepository } = await import(repositoryPath);
					await (await localRepository()).deleteEntity("asset", id);
				}, { repositoryPath, id: ids.projectA });
				await page.reload();
				await row.getByRole("button", { name: copy.edit }).click();
				await expect(dialog.getByRole("button", { name: copy.retry })).toBeVisible();
				await expect(dialog.getByRole("button", { name: copy.save, exact: true })).toBeDisabled();
				if (recovery === "retry") {
					for (const width of [360, 390, 768, 1280, 1440]) {
						await page.setViewportSize({ width, height: 844 });
						const button = dialog.getByRole("button", { name: copy.abandon });
						await button.scrollIntoViewIfNeeded();
						const bounds = await button.boundingBox();
						if (!bounds) throw Error("pending recovery button missing");
						expect(bounds.x).toBeGreaterThanOrEqual(0);
						expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
						expect(bounds.y).toBeGreaterThanOrEqual(0);
						expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
						await expect(dialog.getByRole("button", { name: copy.retry })).toBeEnabled();
						expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
						if (width === 360 || width === 1440) await page.screenshot({ path: `/private/tmp/keepany-subscription-pending-${locale}-${width}.png` });
					}
					await page.setViewportSize({ width: 390, height: 844 });
				}
				if (recovery === "retry") {
					await dialog.getByRole("button", { name: copy.retry }).click();
					await expect(dialog.getByRole("alert")).toBeVisible();
					await page.evaluate(async ({ repositoryPath, id }) => {
						const { localRepository } = await import(repositoryPath);
						await (await localRepository()).restoreEntity("asset", id);
					}, { repositoryPath, id: ids.projectA });
					await dialog.getByRole("button", { name: copy.retry }).click();
					await expect(dialog).toBeHidden();
				} else {
					await dialog.getByRole("button", { name: copy.abandon }).click();
					await expect(dialog.getByRole("button", { name: copy.save, exact: true })).toBeEnabled();
					await expect(dialog.locator("#subscriptionPaymentMethod")).toHaveValue("Card after interruption");
					await dialog.locator("#subscriptionProject").selectOption(ids.projectB);
					await dialog.getByRole("button", { name: copy.save, exact: true }).click();
					await expect(dialog).toBeHidden();
				}
				await page.reload();
				const after = await subscriptionState(page);
				expect(after.subscription?.subscriptionPaymentMethod).toBe("Card after interruption");
				expect(after.linkedIds).toEqual([recovery === "retry" ? ids.projectA : ids.projectB]);
				expect(await page.evaluate(async ({ repositoryPath, subscriptionId }) => {
					const { localRepository } = await import(repositoryPath);
					return (await localRepository()).getPendingSubscriptionSave(subscriptionId);
				}, { repositoryPath, subscriptionId })).toBeNull();
				await expect(row).toContainText(recovery === "retry" ? "Project A" : "Project B");
				await page.screenshot({ path: `/private/tmp/keepany-subscription-recovery-${locale}-${recovery}.png`, fullPage: true });
				expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
				expect(errors).toEqual([]);
			} finally { await context.close(); }
		});
	}
}

test("a real Chromium process crash after the subscription asset write replays its durable connections", async ({ baseURL }) => {
	test.skip(process.platform === "win32", "Process discovery uses the macOS/Linux ps command.");
	test.setTimeout(60_000);
	const directory = await mkdtemp(join(tmpdir(), "keepany-subscription-crash-"));
	let context = await chromium.launchPersistentContext(directory, { headless: true, baseURL, locale: "en-US" });
	try {
		const page = context.pages()[0];
		await page.goto("/finance");
		const ids = await seedTargets(page);
		await page.reload();
		await page.getByRole("button", { name: "Add subscription" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.locator("#name").fill("Crash-recovered plan");
		await dialog.locator("#subscriptionProject").selectOption(ids.projectA);
		await dialog.locator("#subscriptionLoginAccount").selectOption(ids.accountA);
		await dialog.locator("#subscriptionPaymentMethod").fill("Visa retained after crash");
		await page.evaluate(async repositoryPath => {
			const { localRepository } = await import(repositoryPath);
			const repository = await localRepository();
			const add = repository.fileStore.subscriptionSaveJournal.add.bind(repository.fileStore.subscriptionSaveJournal);
			repository.fileStore.subscriptionSaveJournal.add = async (...args: unknown[]) => {
				const result = await add(...args);
				(globalThis as typeof globalThis & { __subscriptionJournal?: unknown }).__subscriptionJournal = args[0];
				return result;
			};
			const original = repository.db.records.insert.bind(repository.db.records);
			repository.db.records.insert = async (...args: unknown[]) => {
				if ((args[0] as { type: string }).type === "relation") {
					(globalThis as typeof globalThis & { __subscriptionPaused?: boolean }).__subscriptionPaused = true;
					await new Promise(() => {});
				}
				return original(...args);
			};
		}, repositoryPath);
		await dialog.getByRole("button", { name: "Save", exact: true }).click();
		await expect.poll(() => page.evaluate(() => !!(globalThis as typeof globalThis & { __subscriptionPaused?: boolean }).__subscriptionPaused)).toBe(true);
		const snapshot = await page.evaluate(async repositoryPath => {
			const { localRepository } = await import(repositoryPath);
			const repository = await localRepository();
			const journal = (globalThis as typeof globalThis & { __subscriptionJournal?: {
				id: string; assetId: string; relations: Array<{ row: { id: string } }>; } }).__subscriptionJournal;
			if (!journal) throw Error("durable intent snapshot missing");
			const asset = await repository.get("asset", journal.assetId);
			if (asset.lastSubscriptionSaveId !== journal.id) throw Error("asset CAS has not committed");
			return { operationId: journal.id, assetId: journal.assetId,
				relationIds: journal.relations.map(planned => planned.row.id.slice(9)).sort(),
				count: (await repository.list("relation")).length };
		}, repositoryPath);
		expect(snapshot.count).toBe(0);
		const processes = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).split("\n");
		const own = processes.filter(command => command.includes(`--user-data-dir=${directory}`) && command.includes("--remote-debugging-pipe"));
		if (own.length !== 1) throw Error("isolated Chromium process is ambiguous");
		const pid = Number(own[0].match(/^\s*(\d+)/)?.[1]);
		if (!Number.isSafeInteger(pid) || pid < 1) throw Error("isolated Chromium process missing");
		process.kill(pid, "SIGKILL");
		await context.close().catch(() => {});
		context = await chromium.launchPersistentContext(directory, { headless: true, baseURL, locale: "en-US" });
		const restored = context.pages()[0];
		await restored.goto("/finance");
		const row = restored.locator(".finance-linked-row").filter({ hasText: "Crash-recovered plan" });
		await expect(row).toContainText("Project A");
		await expect(row).toContainText("Account A");
		await expect(row).toContainText("Visa retained after crash");
		const state = await restored.evaluate(async ({ repositoryPath, snapshot }) => {
			const { localRepository } = await import(repositoryPath);
			const repository = await localRepository();
			const asset = await repository.get("asset", snapshot.assetId);
			const relations = await repository.list("relation") as Array<{ id: string }>;
			return { marker: asset.lastSubscriptionSaveId, ids: relations.map(relation => relation.id).sort(),
				pending: await repository.getPendingSubscriptionSave(snapshot.assetId) };
		}, { repositoryPath, snapshot });
		expect(state).toEqual({ marker: snapshot.operationId, ids: snapshot.relationIds, pending: null });
		await restored.reload();
		expect((await subscriptionState(restored)).linkedIds).toEqual([ids.projectA, ids.accountA].sort());
	} finally {
		await context.close().catch(() => {});
		await rm(directory, { recursive: true, force: true });
	}
});

for (const pause of ["intent", "asset"] as const) {
	test(`without Web Locks another tab ${pause === "intent" ? "cancels an uncommitted intent safely" : "waits for the asset CAS and completes the same intent"}`, async ({ browser }) => {
		const context = await browser.newContext({ locale: "en-US" });
		await context.addInitScript(() => Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }));
		const first = await context.newPage(), second = await context.newPage();
		try {
			await first.goto("/finance");
			const ids = await seedTargets(first);
			const subscription = await first.evaluate(async ({ domainPath, repositoryPath }) => {
				const { newAsset } = await import(domainPath);
				const { save } = await import(repositoryPath);
				const asset = { ...newAsset("subscription"), name: "Concurrent intent" };
				await save("asset", asset);
				return asset;
			}, { domainPath, repositoryPath });
			await second.goto("/finance");
			await second.evaluate(async repositoryPath => { await (await import(repositoryPath)).localRepository(); }, repositoryPath);
			await first.evaluate(async ({ repositoryPath, pause, subscription }) => {
				const { localRepository } = await import(repositoryPath);
				const repository = await localRepository();
				const state = globalThis as typeof globalThis & { __subscriptionPaused?: boolean; __resumeSubscription?: () => void };
				const wait = async () => {
					state.__subscriptionPaused = true;
					await new Promise<void>(resolve => { state.__resumeSubscription = resolve; });
				};
				if (pause === "intent") {
					const add = repository.fileStore.subscriptionSaveJournal.add.bind(repository.fileStore.subscriptionSaveJournal);
					repository.fileStore.subscriptionSaveJournal.add = async (...args: unknown[]) => {
						const value = await add(...args);
						await wait();
						return value;
					};
				} else {
					const storage = repository.db.records.storageInstance;
					const write = storage.bulkWrite.bind(storage);
					storage.bulkWrite = async (...args: unknown[]) => {
						const rows = args[0] as Array<{ document: { id: string } }>;
						if (rows.some(row => row.document.id === `asset:${subscription.id}`)) await wait();
						return write(...args);
					};
				}
			}, { repositoryPath, pause, subscription });
			const saving = first.evaluate(async ({ repositoryPath, subscription, ids }) => {
				const { localRepository } = await import(repositoryPath);
				try {
					await (await localRepository()).saveSubscription(subscription, { ...subscription, name: "Committed in first tab" },
						[{ id: ids.projectA, kind: "project", label: "Project" }]);
					return "saved";
				} catch (error) {
					const reason = error instanceof Error ? error.message : String(error);
					(globalThis as typeof globalThis & { __subscriptionFailure?: string }).__subscriptionFailure = reason;
					return reason;
				}
			}, { repositoryPath, subscription, ids });
			await expect.poll(() => first.evaluate(() => {
				const state = globalThis as typeof globalThis & { __subscriptionPaused?: boolean; __subscriptionFailure?: string };
				if (state.__subscriptionFailure) throw Error(state.__subscriptionFailure);
				return !!state.__subscriptionPaused;
			})).toBe(true);
			const recovering = second.evaluate(async ({ repositoryPath, subscription }) => {
				const state = globalThis as typeof globalThis & { __subscriptionRecoveryStarted?: boolean; __subscriptionRecoveryFinished?: boolean };
				state.__subscriptionRecoveryStarted = true;
				await (await (await import(repositoryPath)).localRepository()).retrySubscriptionSave(subscription.id);
				state.__subscriptionRecoveryFinished = true;
			}, { repositoryPath, subscription });
			if (pause === "intent") await recovering;
			else {
				await expect.poll(() => second.evaluate(() => !!(globalThis as typeof globalThis & { __subscriptionRecoveryStarted?: boolean }).__subscriptionRecoveryStarted)).toBe(true);
				expect(await second.evaluate(() => !!(globalThis as typeof globalThis & { __subscriptionRecoveryFinished?: boolean }).__subscriptionRecoveryFinished)).toBe(false);
			}
			await first.evaluate(() => (globalThis as typeof globalThis & { __resumeSubscription?: () => void }).__resumeSubscription?.());
			expect(await saving).toBe(pause === "intent" ? "asset-stale" : "saved");
			await recovering;
			const state = await subscriptionState(second);
			expect(state.subscription?.name).toBe(pause === "intent" ? "Concurrent intent" : "Committed in first tab");
			expect(state.linkedIds).toEqual(pause === "intent" ? [] : [ids.projectA]);
			expect(await second.evaluate(async ({ repositoryPath, subscription }) => {
				return (await (await import(repositoryPath)).localRepository()).getPendingSubscriptionSave(subscription.id);
			}, { repositoryPath, subscription })).toBeNull();
		} finally { await context.close(); }
	});
}
