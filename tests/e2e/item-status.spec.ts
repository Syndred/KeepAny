import { openBackupPage } from "./helpers/backup-restore";
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainModuleUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;

function fact(page: Page, label: string) {
	return page.locator("dt").filter({ hasText: label }).locator("..").locator("dd");
}

async function state(page: Page, name: string) {
	return page.evaluate(async ({ modulePath, name }) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		const asset = (await repository.list("asset")).find((row: { name: string }) => row.name === name);
		if (!asset) throw Error(`Missing item ${name}`);
		const history = (await repository.list("history")).filter((row: { assetId: string }) => row.assetId === asset.id);
		return { asset, history };
	}, { modulePath: repositoryModuleUrl, name }) as Promise<{ asset: Record<string, unknown>; history: Record<string, unknown>[] }>;
}

async function changeStatus(page: Page, status: string, day: string, note: string) {
	await page.getByRole("button", { name: "Record status change" }).click();
	const dialog = page.getByRole("dialog");
	await selectChoice(dialog.getByLabel("Item status"), status);
	await dialog.getByLabel("Effective date").fill(day);
	await dialog.getByLabel("Note (optional)").fill(note);
	await dialog.getByRole("button", { name: "Save status" }).click();
	await expect(dialog).toBeHidden();
}

test("legacy item without lifecycle fields records its first status change", async ({ page }) => {
	const name = `Legacy work laptop ${crypto.randomUUID().slice(0, 8)}`;
	await page.goto("/assets/item");
	const id = await page.evaluate(async ({ modulePath, domainPath, name }) => {
		const { localRepository } = await import(modulePath);
		const { newAsset } = await import(domainPath);
		const repository = await localRepository();
		const asset = { ...newAsset("item"), name, purchaseDate: "2023-05-10" };
		await repository.save("asset", asset);
		const row = await repository.db.records.findOne(`asset:${asset.id}`).exec();
		if (!row) throw Error("legacy row missing");
		await row.incrementalModify((data: { payload: string }) => {
			const payload = JSON.parse(data.payload);
			for (const field of ["itemLifecycleStatus", "itemStatusDate", "itemStartDate", "itemWarrantyStatus", "lastItemEventId"])
				delete payload[field];
			return { ...data, payload: JSON.stringify(payload) };
		});
		return asset.id;
	}, { modulePath: repositoryModuleUrl, domainPath: domainModuleUrl, name });
	await page.goto(`/assets/item/${id}`);
	await expect(page.getByRole("heading", { name })).toBeVisible();
	await expect(fact(page, "Item status")).toHaveText("Not recorded");
	await page.getByRole("button", { name: "Record status change" }).click();
	const dialog = page.getByRole("dialog");
	await selectChoice(dialog.getByLabel("Item status"), "idle");
	await dialog.getByLabel("Effective date").fill("2026-09-29");
	await dialog.getByRole("button", { name: "Save status" }).click();
	await expect(dialog).toBeHidden();
	await expect(fact(page, "Item status")).toHaveText("Idle");
	const saved = await state(page, name);
	expect(saved.asset).toMatchObject({ itemLifecycleStatus: "idle", itemStatusDate: "2026-09-29" });
	expect(saved.history.filter(row => row.action === "itemStatus")).toMatchObject([
		{ itemStatusBefore: null, itemStatusAfter: "idle", eventDate: "2026-09-29" },
	]);
});

test("physical item facts, atomic status history and encrypted backup survive in both languages and widths", async ({ browser }, testInfo) => {
	test.setTimeout(180_000);
	const unique = crypto.randomUUID().slice(0, 8);
	const name = `Physical profile ${unique}`;
	const password = `item-status-${unique}-backup-2026`;
	const source = await browser.newContext({ locale: "en-US", acceptDownloads: true, viewport: { width: 1280, height: 932 } });
	const page = await source.newPage();
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	try {
		await page.goto("/assets/item");
		await page.getByRole("button", { name: "Add", exact: true }).click();
		let dialog = page.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill(name);
		await dialog.getByLabel("Purchase date").fill("2026-09-01");
		await dialog.getByLabel("Started using").fill("2026-09-05");
		await selectChoice(dialog.getByLabel("Warranty status"), "inWarranty");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await page.getByText(name).first().click();
		await expect(fact(page, "Purchase price")).toHaveText("Not recorded");
		await expect(fact(page, "Started using")).toHaveText("Sep 5, 2026");
		await expect(fact(page, "Warranty status")).toHaveText("Under warranty");
		await expect(fact(page, "Item status")).toHaveText("In use");
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		dialog = page.getByRole("dialog");
		await dialog.getByLabel("Purchase price").fill("0.00");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(fact(page, "Purchase price")).toContainText("0.00");
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		dialog = page.getByRole("dialog");
		await dialog.getByLabel("Purchase price").fill("12.34");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(fact(page, "Purchase price")).toContainText("12.34");
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		dialog = page.getByRole("dialog");
		await selectChoice(dialog.getByLabel("Currency"), "JPY");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog.getByText("Please check this field")).toBeVisible();
		await dialog.getByLabel("Purchase price").fill("120");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await expect((await state(page, name)).asset).toMatchObject({ amount: 120, currency: "JPY" });
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		dialog = page.getByRole("dialog");
		await selectChoice(dialog.getByLabel("Currency"), "CNY");
		await dialog.getByLabel("Purchase price").fill("12.34");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await changeStatus(page, "idle", "2026-09-10", "Stored on shelf");
		await changeStatus(page, "repairing", "2026-09-12", "Inspection scheduled");
		await expect(page.getByRole("button", { name: "Lend item" })).toBeDisabled();
		await changeStatus(page, "inUse", "2026-09-13", "Back in use");
		await page.getByLabel("Borrower").fill("Ada");
		await page.getByRole("button", { name: "Lend item" }).click();
		await page.getByRole("button", { name: "Record status change" }).click();
		await page.getByRole("dialog").getByLabel("Item status").click();
		await expect(page.getByRole("option", { name: "Marked resold", exact: true })).toHaveAttribute("data-disabled", "");
		await expect(page.getByRole("option", { name: "Marked retired", exact: true })).toHaveAttribute("data-disabled", "");
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).toBeVisible();
		await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
		await page.getByRole("button", { name: "Return item" }).click();
		await changeStatus(page, "resold", "2026-09-15", "Local record only");
		await expect(page.getByRole("button", { name: "Lend item" })).toBeDisabled();
		await expect(page.getByRole("button", { name: "Log maintenance" })).toBeDisabled();
		await changeStatus(page, "retired", "2026-09-16", "Final local status");
		await expect(fact(page, "Item status")).toHaveText("Marked retired");
		const before = await state(page, name);
		expect(before.asset).toMatchObject({ amount: 1234, currency: "CNY", itemPurchasePriceKnown: true,
			purchaseDate: "2026-09-01", itemStartDate: "2026-09-05", itemWarrantyStatus: "inWarranty",
			itemLifecycleStatus: "retired", itemStatusDate: "2026-09-16" });
		expect(before.history.filter(row => row.action === "itemStatus").map(row => row.itemStatusAfter).sort())
			.toEqual(["idle", "inUse", "repairing", "resold", "retired"].sort());
		expect(before.history.filter(row => row.action === "itemStatus").every(row => row.itemStatusBefore !== undefined && row.eventDate && row.note)).toBe(true);
		for (const width of [1280, 390]) {
			await page.setViewportSize({ width, height: 932 });
			await page.reload();
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
			await page.screenshot({ path: testInfo.outputPath(`item-status-en-${width}.png`), fullPage: true });
			await page.getByRole("button", { name: "Record status change" }).click();
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
			await expect(page.getByRole("dialog").getByText("This status is recorded on this device.", { exact: false })).toBeVisible();
			await page.screenshot({ path: testInfo.outputPath(`item-status-dialog-en-${width}.png`), fullPage: true });
			await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
		}
		await page.goto("/intake");
		await openBackupPage(page); await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: "Create backup" }).click();
		const downloadEvent = page.waitForEvent("download");
		await page.getByRole("link", { name: "Save backup file" }).click();
		const download = await downloadEvent;
		const backupPath = await download.path();
		if (!backupPath) throw Error("Missing .ka1 backup");
		expect(download.suggestedFilename()).toMatch(/\.ka1$/);
		expect(readFileSync(backupPath).length).toBeGreaterThan(52);

		const destination = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 932 } });
		const restored = await destination.newPage();
		restored.on("pageerror", error => errors.push(error.message));
		try {
			await restored.goto("/settings");
			await selectChoice(restored.locator("section.card").filter({ has: restored.getByRole("heading", { name: "语言" }) }).getByRole("combobox"), "zh-CN");
			await restored.goto("/intake");
			await openBackupPage(restored); await restored.locator("#backup-password").fill(password);
			await restored.locator("#restore-file").setInputFiles(backupPath);
			await restored.getByRole("button", { name: "预览", exact: true }).first().click();
			await restored.getByRole("button", { name: /确认 ·/ }).click();
			await expect(restored.getByText(/已恢复 \d+ 条记录/)).toBeVisible();
			await restored.goto("/assets/item");
			await restored.getByText(name).first().click();
			await expect(fact(restored, "购入价")).toContainText("12.34");
			await expect(fact(restored, "开始使用")).toHaveText("2026年9月5日");
			await expect(fact(restored, "保修状态")).toHaveText("保修中");
			await expect(fact(restored, "物品状态")).toHaveText("已退役");
			await expect(restored.getByText("使用中 → 闲置")).toBeVisible();
			const after = await state(restored, name);
			expect(after.asset).toEqual(before.asset);
			expect(after.history.sort((a, b) => String(a.id).localeCompare(String(b.id))))
				.toEqual(before.history.sort((a, b) => String(a.id).localeCompare(String(b.id))));
			for (const width of [1280, 390]) {
				await restored.setViewportSize({ width, height: 932 });
				await restored.reload();
				expect(await restored.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
				await restored.screenshot({ path: testInfo.outputPath(`item-status-zh-${width}.png`), fullPage: true });
				await restored.getByRole("button", { name: "记录状态变更" }).click();
				expect(await restored.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
				await expect(restored.getByRole("dialog").getByText("这只是本机记录的状态", { exact: false })).toBeVisible();
				await restored.screenshot({ path: testInfo.outputPath(`item-status-dialog-zh-${width}.png`), fullPage: true });
				await restored.getByRole("dialog").getByRole("button", { name: "取消" }).click();
			}
		} finally { await destination.close(); }
		expect(errors).toEqual([]);
	} finally { await source.close(); }
});
