import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "docs/evidence/2026-09-29";
const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

function nextDate(page: Page, label: string) {
	return page.locator("dt").filter({ hasText: label }).locator("..").locator("dd");
}

function historyRows(page: Page, label: string) {
	return page.locator("section.card").filter({ has: page.getByRole("heading", { name: label }) }).locator(".list-row");
}

async function localRenewalState(page: Page, name: string) {
	return page.evaluate(async ({ modulePath, name }) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		const asset = (await repository.list("asset")).find((row: { name: string }) => row.name === name);
		const history = (await repository.list("history")).filter((row: { assetId: string; action: string }) => row.assetId === asset?.id && row.action === "renew");
		return { asset, history };
	}, { modulePath: repositoryModuleUrl, name });
}

test("renewal cycle, local amounts and history survive edits, status changes, refresh and backup restore", async ({ browser }) => {
	test.setTimeout(120_000);
	mkdirSync(evidence, { recursive: true });
	const source = await browser.newContext({ locale: "en-US", timezoneId: "America/New_York", acceptDownloads: true, viewport: { width: 1280, height: 800 } });
	const page = await source.newPage();
	page.setDefaultTimeout(10_000);
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	const name = `Cycle ${crypto.randomUUID().slice(0, 8)}`;
	const password = `test-only-cycle-${crypto.randomUUID()}`;
	try {
		await page.goto("/assets/subscription");
		await page.getByRole("button", { name: "Add", exact: true }).click();
		let dialog = page.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill(name);
		await selectChoice(dialog.locator("#currency"), "USD");
		await dialog.locator("#amount").fill("120.00");
		await dialog.locator("#dueDate").fill("2026-01-31");
		await dialog.locator("#trialEndsAt").fill("2026-02-01");
		await dialog.locator("#discountAmount").fill("20.00");
		await dialog.locator("#discountUntil").fill("2026-02-28");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await page.getByText(name).first().click();
		await expect(nextDate(page, "Next date")).toHaveText("Jan 31, 2026");
		await expect(nextDate(page, "Monthly average")).toContainText("$120.00");
		await expect(nextDate(page, "Estimated amount for this date")).toContainText("$0.00");

		await page.getByRole("button", { name: "Record renewal" }).dblclick();
		await expect(nextDate(page, "Next date")).toHaveText("Feb 28, 2026");
		await expect(historyRows(page, "History")).toHaveCount(1);
		await expect(historyRows(page, "History").first()).toContainText("$0.00");
		await expect(nextDate(page, "Estimated amount for this date")).toContainText("$100.00");
		await page.getByLabel("Locally recorded amount").fill("88.40");
		await page.getByRole("button", { name: "Record renewal" }).click();
		await expect(nextDate(page, "Next date")).toHaveText("Mar 31, 2026");
		await expect(historyRows(page, "History")).toHaveCount(2);
		await expect(historyRows(page, "History").first()).toContainText("$88.40");
		await expect(nextDate(page, "Estimated amount for this date")).toContainText("$120.00");

		await page.getByRole("button", { name: "Edit", exact: true }).click();
		dialog = page.getByRole("dialog");
		await dialog.locator("#dueDate").fill("2026-04-30");
		await dialog.locator("#interval").fill("2");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await expect(nextDate(page, "Next date")).toHaveText("Apr 30, 2026");

		for (const status of ["paused", "cancelled", "active"]) {
			await page.getByRole("button", { name: "Edit", exact: true }).click();
			dialog = page.getByRole("dialog");
			await selectChoice(dialog.locator("#status"), status);
			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(dialog).toBeHidden();
			if (status === "active") await expect(page.getByRole("button", { name: "Record renewal" })).toBeEnabled();
			else await expect(page.getByRole("button", { name: "Record renewal" })).toBeDisabled();
			await page.goto("/");
			const dueCard = page.locator(".overview-panel").filter({ has: page.getByRole("heading", { name: "Next actions" }) });
			if (status === "active") await expect(dueCard).toContainText(name);
			else await expect(dueCard).not.toContainText(name);
			await page.goto("/assets/subscription");
			await page.getByText(name).first().click();
		}
		await expect(page.getByRole("button", { name: "Record renewal" })).toBeEnabled();
		await page.getByRole("button", { name: "Record renewal" }).click();
		await expect(nextDate(page, "Next date")).toHaveText("Jun 30, 2026");
		await expect(historyRows(page, "History")).toHaveCount(3);
		await page.reload();
		await expect(historyRows(page, "History")).toHaveCount(3);
		// The development server exposes the source module for exact local record readback.
		// Production preview verifies the same flow through its visible UI and restored archive.
		const before = process.env.KEEPANY_SUBSCRIPTION_MODE === "preview" ? null : await localRenewalState(page, name);
		if (before) {
			expect(before.asset?.renewalCount).toBe(1);
			expect(before.asset?.billingAnchor).toBe("2026-04-30");
			expect(before.asset?.cancelledAt).toBe("");
			expect(before.history.map((entry: { amount: number }) => entry.amount).sort((a: number, b: number) => a - b)).toEqual([0, 8840, 12000]);
		}
		await page.screenshot({ path: `${evidence}/subscription-cycle-en-1280.png`, fullPage: true });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.reload();
		await expect(historyRows(page, "History")).toHaveCount(3);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
		await page.screenshot({ path: `${evidence}/subscription-cycle-en-390.png`, fullPage: true });

		await page.goto("/intake");
		await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: "Create backup" }).click();
		const downloadEvent = page.waitForEvent("download");
		await page.getByRole("link", { name: "Save backup file" }).click();
		const path = await (await downloadEvent).path();
		if (!path) throw Error("backup download missing");
		const destination = await browser.newContext({ locale: "zh-CN", timezoneId: "Asia/Shanghai", viewport: { width: 1280, height: 800 } });
		const restored = await destination.newPage();
		restored.setDefaultTimeout(10_000);
		restored.on("pageerror", error => errors.push(error.message));
		try {
			await restored.goto("/settings");
			await selectChoice(restored.locator("section.card").filter({ has: restored.getByRole("heading", { name: /^(Language|语言)$/ }) }).getByRole("combobox"), "zh-CN");
			await expect(restored.getByRole("heading", { name: "设置" })).toBeVisible();
			await restored.goto("/intake");
			await restored.locator("#backup-password").fill(password);
			await restored.locator("details").filter({ has: restored.locator("#restore-file") }).locator("summary").click();
			await restored.locator("#restore-file").setInputFiles(path);
			await restored.getByRole("button", { name: "预览", exact: true }).first().click();
			await restored.getByRole("button", { name: /确认 ·/ }).click();
			await expect(restored.getByText(/已恢复 \d+ 条记录/)).toBeVisible();
			await restored.goto("/assets/subscription");
			await restored.getByText(name).first().click();
			await expect(nextDate(restored, "下次日期")).toHaveText("2026年6月30日");
			await expect(historyRows(restored, "历史记录")).toHaveCount(3);
			await expect(historyRows(restored, "历史记录").first()).toContainText("本机记录金额");
			if (before) {
				const after = await localRenewalState(restored, name);
				expect(after.asset?.id).toBe(before.asset?.id);
				expect(after.asset?.dueDate).toBe(before.asset?.dueDate);
				expect(after.history.map((entry: { id: string; amount: number }) => [entry.id, entry.amount]).sort()).toEqual(before.history.map((entry: { id: string; amount: number }) => [entry.id, entry.amount]).sort());
			}
			await restored.screenshot({ path: `${evidence}/subscription-cycle-zh-1280.png`, fullPage: true });
			await restored.setViewportSize({ width: 390, height: 844 });
			await restored.reload();
			await expect(historyRows(restored, "历史记录")).toHaveCount(3);
			expect(await restored.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
			await restored.screenshot({ path: `${evidence}/subscription-cycle-zh-390.png`, fullPage: true });
		} finally {
			await destination.close();
		}
		expect(errors).toEqual([]);
	} finally {
		await source.close();
	}
});

test("an older client edit during a queued renewal leaves no false history and permits backup", async ({ browser }) => {
	test.skip(process.env.KEEPANY_SUBSCRIPTION_MODE === "preview", "This fault injection uses the development source module.");
	test.setTimeout(90_000);
	const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 800 } });
	const first = await context.newPage();
	const second = await context.newPage();
	first.setDefaultTimeout(10_000);
	second.setDefaultTimeout(10_000);
	const name = `Concurrent cycle ${crypto.randomUUID().slice(0, 8)}`;
	try {
		await first.goto("/assets/subscription");
		await first.getByRole("button", { name: "Add", exact: true }).click();
		const dialog = first.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill(name);
		await dialog.locator("#dueDate").fill("2026-01-31");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await first.getByText(name).first().click();
		await second.goto(first.url());
		await expect(second.getByRole("heading", { name })).toBeVisible();
		await second.evaluate(async modulePath => {
			const { localRepository } = await import(modulePath);
			await localRepository();
		}, repositoryModuleUrl);

		await first.evaluate(async modulePath => {
			const { localRepository } = await import(modulePath);
			const repository = await localRepository();
			const storage = repository.db.records.storageInstance;
			const original = storage.bulkWrite.bind(storage);
			let release: (() => void) | undefined;
			let entered = false;
			const gate = { entered: () => entered, release: () => release?.() };
			(window as Window & { __renewalGate?: typeof gate }).__renewalGate = gate;
			storage.bulkWrite = async (rows: Parameters<typeof original>[0], context: Parameters<typeof original>[1]) => {
				if (context === "keepany-renewal" && !entered) {
					entered = true;
					await new Promise<void>(resolve => { release = resolve; });
				}
				return original(rows, context);
			};
		}, repositoryModuleUrl);
		await first.getByRole("button", { name: "Record renewal" }).click();
		await first.waitForFunction(() => (window as Window & { __renewalGate?: { entered: () => boolean } }).__renewalGate?.entered());
		await second.evaluate(async ({ modulePath, name }) => {
			const { localRepository } = await import(modulePath);
			const repository = await localRepository();
			const asset = (await repository.list("asset")).find((item: { name: string }) => item.name === name);
			if (!asset) throw Error("subscription missing in second tab");
			// Current public writes share the native journal gate. Model an older
			// client that bypasses it, so the pair's storage CAS remains essential.
			const storage = repository.db.records.storageInstance;
			const [raw] = await storage.findDocumentsById([`asset:${asset.id}`], false);
			const changed = await storage.bulkWrite([{ previous: raw, document: {
				...raw, payload: JSON.stringify({ ...asset, name: `${name} renamed` }), updatedAt: raw.updatedAt + 1,
			} }], "external-test-edit");
			if (changed.error.length) throw Error("older-client-edit-failed");
		}, { modulePath: repositoryModuleUrl, name });
		const openingTab = await context.newPage();
		await openingTab.goto(first.url());
		await expect(openingTab.getByRole("heading", { name: `${name} renamed` })).toHaveCount(0);
		await first.evaluate(() => (window as Window & { __renewalGate?: { release: () => void } }).__renewalGate?.release());
		await expect.poll(async () => second.evaluate(async modulePath => {
			const { localRepository } = await import(modulePath);
			return (await localRepository()).fileStore.renewalJournal.count();
		}, repositoryModuleUrl)).toBe(0);
		await expect(openingTab.getByRole("heading", { name: `${name} renamed` })).toBeVisible();
		await expect.poll(async () => (await localRenewalState(second, `${name} renamed`)).history).toHaveLength(0);
		const state = await localRenewalState(second, `${name} renamed`);
		expect(state.asset).toMatchObject({ dueDate: "2026-01-31", renewalCount: 0 });
		expect(state.history).toHaveLength(0);
		expect(await second.evaluate(async modulePath => {
			const { localRepository } = await import(modulePath);
			return (await (await localRepository()).exportArchive()).length;
		}, repositoryModuleUrl)).toBeGreaterThan(0);

		await second.reload();
		await second.getByRole("button", { name: "Record renewal" }).click();
		await expect(nextDate(second, "Next date")).toHaveText("Feb 28, 2026");
		await expect(historyRows(second, "History")).toHaveCount(1);
	} finally {
		await first.evaluate(() => (window as Window & { __renewalGate?: { release: () => void } }).__renewalGate?.release()).catch(() => {});
		await context.close();
	}
});
