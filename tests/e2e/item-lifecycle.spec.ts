import { mkdirSync, readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const evidence = "docs/evidence/2026-09-29";
const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

type ItemState = {
	asset: Record<string, unknown>;
	history: Record<string, unknown>[];
	tasks: Record<string, unknown>[];
};

function detail(page: Page, label: string) {
	return page.locator("dt").filter({ hasText: label }).locator("..").locator("dd");
}

function historyRows(page: Page, label: string) {
	return page.locator("section.card").filter({ has: page.getByRole("heading", { name: label }) }).locator(".list-row");
}

function taskSection(page: Page, label: string) {
	return page.locator("section.card").filter({ has: page.getByRole("heading", { name: label }) });
}

async function localItemState(page: Page, name: string): Promise<ItemState> {
	return page.evaluate(async ({ modulePath, name }) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		const asset = (await repository.list("asset")).find((row: { name: string }) => row.name === name);
		if (!asset) throw Error(`item missing: ${name}`);
		const history = (await repository.list("history"))
			.filter((row: { assetId: string }) => row.assetId === asset.id)
			.sort((left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id));
		const tasks = (await repository.list("task"))
			.filter((row: { assetId: string }) => row.assetId === asset.id)
			.sort((left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id));
		return { asset, history, tasks };
	}, { modulePath: repositoryModuleUrl, name });
}

async function setLanguage(page: Page, value: "en-US" | "zh-CN") {
	await page.goto("/settings");
	await page.locator("section.card").filter({ has: page.getByRole("heading", { name: /^(Language|语言)$/ }) }).locator("select").selectOption(value);
}

async function captureWidths(page: Page, language: "en" | "zh", label: string) {
	for (const width of [1280, 390, 360]) {
		await page.setViewportSize({ width, height: 844 });
		await page.reload();
		await expect(historyRows(page, label)).toHaveCount(3);
		expect(await page.evaluate(() => document.documentElement.scrollWidth), `${language} item detail at ${width}px`).toBeLessThanOrEqual(width);
		await page.screenshot({ path: `${evidence}/item-lifecycle-${language}-${width}.png`, fullPage: true });
	}
}

test("item loan, return, maintenance, reminder and task history survive trash and encrypted backup restore", async ({ browser }) => {
	test.setTimeout(180_000);
	mkdirSync(evidence, { recursive: true });
	const unique = crypto.randomUUID().slice(0, 8);
	const name = `Camera ${unique}`;
	const borrower = `Borrower ${unique}`;
	const taskName = `Inspect case ${unique}`;
	const password = `item-local-backup-${unique}-2026`;
	const source = await browser.newContext({ locale: "en-US", timezoneId: "America/New_York", acceptDownloads: true, viewport: { width: 1280, height: 844 } });
	const page = await source.newPage();
	page.setDefaultTimeout(10_000);
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	try {
		await page.goto("/assets/item");
		await page.getByRole("button", { name: "Add", exact: true }).click();
		const itemDialog = page.getByRole("dialog");
		await itemDialog.getByLabel("Name", { exact: true }).fill(name);
		await itemDialog.getByLabel("Purchase date").fill("2026-09-01");
		await itemDialog.getByLabel("Warranty ends").fill("2027-09-01");
		await itemDialog.getByLabel("Location").fill("Studio shelf A");
		await itemDialog.getByRole("button", { name: "Save" }).click();
		await expect(itemDialog).toBeHidden();
		await page.getByText(name).first().click();
		await expect(page.getByRole("heading", { name })).toBeVisible();
		await expect(detail(page, "Purchase date")).toHaveText("Sep 1, 2026");
		await expect(detail(page, "Warranty ends")).toHaveText("Sep 1, 2027");
		await expect(detail(page, "Location")).toHaveText("Studio shelf A");

		await page.getByRole("button", { name: "Lend item" }).click();
		await expect(page.getByRole("alert")).toContainText("Enter the borrower's name.");
		await expect(historyRows(page, "History")).toHaveCount(0);
		await page.getByLabel("Borrower").fill(borrower);
		const second = await source.newPage();
		second.setDefaultTimeout(10_000);
		second.on("pageerror", error => errors.push(error.message));
		await second.goto(page.url());
		await expect(second.getByRole("button", { name: "Lend item" })).toBeVisible();
		await page.getByRole("button", { name: "Lend item" }).dblclick();
		await expect(historyRows(page, "History")).toHaveCount(1);
		await expect(detail(page, "Status")).toContainText("On loan");
		await expect(detail(page, "Borrower")).toHaveText(borrower);
		await expect(second.getByRole("button", { name: "Return item" })).toBeVisible();
		await expect(second.getByRole("button", { name: "Lend item" })).toHaveCount(0);
		await second.close();
		await page.getByRole("button", { name: "Return item" }).dblclick();
		await expect(historyRows(page, "History")).toHaveCount(2);
		await expect(detail(page, "Status")).toContainText("Active");
		await expect(detail(page, "Borrower")).toHaveCount(0);
		await expect(historyRows(page, "History").first()).toContainText(borrower);

		await page.getByLabel("Maintenance notes").fill(`Lens cleaned ${unique}`);
		await page.getByLabel("Maintenance date").fill("2026-09-20");
		await page.getByLabel("Next reminder (optional)").fill("2026-10-20");
		await page.getByRole("button", { name: "Log maintenance" }).click();
		await expect(historyRows(page, "History")).toHaveCount(3);
		await expect(historyRows(page, "History").first()).toContainText(`Lens cleaned ${unique}`);
		await expect(historyRows(page, "History").first()).toContainText("Sep 20, 2026");
		const tasks = taskSection(page, "Tasks");
		const reminder = tasks.locator(".list-row").filter({ hasText: `Maintain ${name}` });
		await expect(reminder).toContainText("Oct 20, 2026");
		await reminder.getByRole("button", { name: "Complete" }).dblclick();
		await expect(reminder).toContainText("Completed");
		await reminder.getByRole("button", { name: "Reopen" }).click();
		await expect(reminder).toContainText("Pending");
		await reminder.getByRole("button", { name: "Complete" }).click();
		await expect(reminder).toContainText("Completed");

		await tasks.getByRole("button", { name: "Add" }).click();
		let taskDialog = page.getByRole("dialog");
		await taskDialog.getByLabel("Name").fill(taskName);
		await taskDialog.getByLabel("Date").fill("2026-10-21");
		await taskDialog.getByRole("button", { name: "Save" }).click();
		await expect(taskDialog).toBeHidden();
		await tasks.getByRole("button", { name: "Add" }).click();
		taskDialog = page.getByRole("dialog");
		await taskDialog.getByLabel("Name").fill(taskName);
		await taskDialog.getByLabel("Date").fill("2026-10-21");
		await taskDialog.getByRole("button", { name: "Save" }).click();
		await expect(taskDialog.getByRole("alert")).toContainText("This task is already pending.");
		await taskDialog.getByRole("button", { name: "Cancel" }).click();
		await expect(taskDialog).toBeHidden();
		await expect(tasks.locator(".list-row").filter({ hasText: taskName })).toHaveCount(1);
		const beforeTrash = await localItemState(page, name);
		expect(beforeTrash.asset).toMatchObject({ status: "active", borrower: "", purchaseDate: "2026-09-01", warrantyDate: "2027-09-01", location: "Studio shelf A" });
		expect(beforeTrash.history.map(row => row.action).sort()).toEqual(["loan", "maintenance", "return"]);
		expect(beforeTrash.history.find(row => row.action === "loan")?.borrower).toBe(borrower);
		expect(beforeTrash.history.find(row => row.action === "return")?.borrower).toBe(borrower);
		expect(beforeTrash.history.find(row => row.action === "maintenance")?.eventDate).toBe("2026-09-20");
		expect(beforeTrash.tasks).toHaveLength(2);
		expect(beforeTrash.tasks.find(row => row.name === `Maintain ${name}`)?.completionHistory).toHaveLength(2);
		await page.getByRole("button", { name: "Archive item" }).click();
		await expect(detail(page, "Status")).toContainText("Archived");
		await expect(page.getByRole("button", { name: "Lend item" })).toBeDisabled();
		await expect(page.getByRole("button", { name: "Log maintenance" })).toBeDisabled();
		await page.reload();
		await expect(detail(page, "Status")).toContainText("Archived");
		await page.getByRole("button", { name: "Reactivate item" }).click();
		await expect(detail(page, "Status")).toContainText("Active");

		await page.getByRole("button", { name: "Move to trash" }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Move to trash" }).click();
		await expect(page).toHaveURL(/\/assets\/item$/);
		await page.goto("/trash");
		const trashedItem = page.locator(".list-row").filter({ hasText: name });
		await trashedItem.getByRole("button", { name: "Restore" }).click();
		await expect(trashedItem).toHaveCount(0);
		await page.goto("/assets/item");
		await page.getByText(name).first().click();
		await page.reload();
		await expect(historyRows(page, "History")).toHaveCount(3);
		await expect(taskSection(page, "Tasks").locator(".list-row")).toHaveCount(2);
		const beforeBackup = await localItemState(page, name);
		expect(beforeBackup.asset.id).toBe(beforeTrash.asset.id);
		expect(beforeBackup.history).toEqual(beforeTrash.history);
		expect(beforeBackup.tasks).toEqual(beforeTrash.tasks);
		await captureWidths(page, "en", "History");

		await page.goto("/intake");
		await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: "Create backup" }).click();
		const downloadEvent = page.waitForEvent("download");
		await page.getByRole("link", { name: "Save backup file" }).click();
		const download = await downloadEvent;
		expect(download.suggestedFilename()).toMatch(/^keepany-\d{4}-\d{2}-\d{2}\.ka1$/);
		const backupPath = await download.path();
		if (!backupPath) throw Error("item backup download missing");
		expect(readFileSync(backupPath).length).toBeGreaterThan(52);

		const destination = await browser.newContext({ locale: "zh-CN", timezoneId: "Asia/Shanghai", viewport: { width: 1280, height: 844 } });
		const restored = await destination.newPage();
		restored.setDefaultTimeout(10_000);
		restored.on("pageerror", error => errors.push(error.message));
		try {
			await restored.goto("/assets/item");
			await expect(restored.getByText(name)).toHaveCount(0);
			await setLanguage(restored, "zh-CN");
			await restored.goto("/intake");
			await restored.locator("#backup-password").fill(password);
			await restored.locator("#restore-file").setInputFiles(backupPath);
			await restored.getByRole("button", { name: "预览", exact: true }).first().click();
			await restored.getByRole("button", { name: /确认 ·/ }).click();
			await expect(restored.getByText(/已恢复 \d+ 条记录/)).toBeVisible();
			await restored.goto("/assets/item");
			await restored.getByText(name).first().click();
			await expect(detail(restored, "购入日期")).toHaveText("2026年9月1日");
			await expect(detail(restored, "保修到期")).toHaveText("2027年9月1日");
			await expect(historyRows(restored, "历史记录")).toHaveCount(3);
			await expect(historyRows(restored, "历史记录").first()).toContainText("2026年9月20日");
			await expect(taskSection(restored, "待办")).toContainText("2026年10月20日");
			const after = await localItemState(restored, name);
			expect(after.asset.id).toBe(beforeBackup.asset.id);
			expect(after.asset.purchaseDate).toBe(beforeBackup.asset.purchaseDate);
			expect(after.asset.warrantyDate).toBe(beforeBackup.asset.warrantyDate);
			expect(after.history).toEqual(beforeBackup.history);
			expect(after.tasks).toEqual(beforeBackup.tasks);
			await captureWidths(restored, "zh", "历史记录");
		} finally {
			await destination.close();
		}
		expect(errors).toEqual([]);
	} finally {
		await source.close();
	}
});
