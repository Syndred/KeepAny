import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";

const token = "migration-test-token-".padEnd(40, "x");
const key = Buffer.from(new Uint8Array(32).fill(9)).toString("base64url");
const password = "migration-source-passphrase";
const targetPassword = "migration-target-passphrase";
test.use({ actionTimeout: 15_000 });

function mockSync(context: BrowserContext, port: number, workspaceId: string) {
	const accepted = new Map<string, { version: number; sequence: number }>();
	const versions = new Map<string, number>();
	let pushes = 0;
	let dropAck = false;
	void context.route(`http://127.0.0.1:${port}/**`, async route => {
		const request = route.request();
		const body = JSON.parse(request.postData() || "{}") as Record<string, unknown>;
		const headers = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, content-type", "content-type": "application/json" };
		if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
		if (body.workspaceId !== workspaceId) return route.fulfill({ status: 403, json: {}, headers });
		if (request.url().endsWith("/sync/preflight")) return route.fulfill({ json: { accountId: "self-host-owner", workspaceId }, headers });
		if (request.url().endsWith("/sync/pull")) return route.fulfill({ json: { changes: [], nextCursor: Number(body.cursor) }, headers });
		if (request.url().endsWith("/sync/push")) {
			pushes++;
			const operations = body.operations as { operationId: string; id: string }[];
			const results = operations.map(operation => {
				const previous = accepted.get(operation.operationId);
				if (!previous) {
					const version = (versions.get(operation.id) ?? 0) + 1;
					versions.set(operation.id, version);
					accepted.set(operation.operationId, { version, sequence: accepted.size + 1 });
				}
				return { operationId: operation.operationId, status: previous ? "duplicate" : "accepted", ...accepted.get(operation.operationId) };
			});
			if (dropAck) { dropAck = false; return route.abort("failed"); }
			return route.fulfill({ json: { results }, headers });
		}
		return route.fulfill({ status: 404, json: {}, headers });
	});
	return { accepted, get pushes() { return pushes; }, dropNextPushAck() { dropAck = true; } };
}

async function configure(page: Page, port: number, workspaceId: string) {
	await page.goto("/settings#connections");
	const inputs = page.locator(".sync-panel .form-grid input");
	await inputs.nth(0).fill(`http://127.0.0.1:${port}`);
	await inputs.nth(1).fill(token);
	await inputs.nth(2).fill(workspaceId);
	await inputs.nth(3).fill(key);
}

async function sourceBackup(page: Page, label: string, port: number, workspaceId: string) {
	await page.goto("/assets/project");
	await page.getByRole("button", { name: label === "en" ? "Add" : "新增", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(label === "en" ? "Name" : "名称", { exact: true }).fill("Source migration project");
	await dialog.getByRole("button", { name: label === "en" ? "Save" : "保存" }).click();
	await expect(dialog).toBeHidden();
	await configure(page, port, workspaceId);
	await page.locator(".sync-panel").getByRole("button", { name: label === "en" ? "Sync now" : "立即同步" }).click();
	await expect(page.locator(".sync-panel .notice")).toHaveText(label === "en" ? "This sync completed" : "本次同步已完成");
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: label === "en" ? "Create backup" : "创建备份", exact: true }).first().click();
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		page.getByRole("link", { name: label === "en" ? "Save backup file" : "保存备份文件" }).click(),
	]);
	const file = path.join(test.info().outputDir, `source-${label}.ka1`);
	await download.saveAs(file);
	return file;
}

for (const locale of ["en", "zh-CN"] as const) {
	test(`explicit archive migration in ${locale}`, async ({ browser }) => {
		test.setTimeout(180_000);
		const sourceContext = await browser.newContext({ locale: locale === "en" ? "en-US" : "zh-CN" });
		const targetContext = await browser.newContext({ locale: locale === "en" ? "en-US" : "zh-CN", viewport: locale === "en" ? { width: 1280, height: 900 } : { width: 390, height: 844 } });
		const errors: string[] = [];
		const sourcePage = await sourceContext.newPage();
		const targetPage = await targetContext.newPage();
		sourcePage.on("pageerror", error => errors.push(`source: ${error.message}`));
		targetPage.on("pageerror", error => errors.push(`target: ${error.message}`));
		const sourceWorkspace = crypto.randomUUID();
		const targetWorkspace = crypto.randomUUID();
		mockSync(sourceContext, 3199, sourceWorkspace);
		const targetServer = mockSync(targetContext, 3200, targetWorkspace);
		try {
			const file = await sourceBackup(sourcePage, locale === "en" ? "en" : "zh", 3199, sourceWorkspace);
			await configure(targetPage, 3200, targetWorkspace);
			const panel = targetPage.locator(".migration-panel");
			await panel.locator('input[type="file"]').first().setInputFiles(file);
			await panel.locator('input[type="password"]').first().fill(password);
			await panel.getByRole("button", { name: locale === "en" ? "Check target and preview" : "核对目标并预览" }).click();
			await expect(panel).toContainText(targetWorkspace);
			await expect(panel).toContainText(locale === "en" ? "Source records: 1" : "来源共 1 条");
			await panel.getByLabel(locale === "en" ? "I checked the source and target for this merge" : "我已核对来源和目标，确认这次合并").check();
			await panel.getByLabel(locale === "en" ? "Target backup password (12 characters minimum)" : "目标备份密码（至少 12 位）").fill(targetPassword);
			await panel.getByRole("button", { name: locale === "en" ? "Create target backup" : "生成目标备份" }).click();
			const [download] = await Promise.all([
				targetPage.waitForEvent("download"),
				panel.getByRole("link", { name: locale === "en" ? "Download target backup" : "下载目标备份" }).click(),
			]);
			const targetFile = path.join(test.info().outputDir, `target-${locale}.ka1`);
			await download.saveAs(targetFile);
			await panel.getByLabel(locale === "en" ? "Select the downloaded target backup" : "选择已下载的目标备份").setInputFiles(targetFile);
			await panel.getByRole("button", { name: locale === "en" ? "Verify downloaded backup" : "回读验证" }).click();
			await expect(panel).toContainText(locale === "en" ? "Target backup verified from the downloaded file" : "目标备份已回读验证");
			await panel.screenshot({ path: test.info().outputPath(`migration-${locale}-preview.png`) });
			await panel.getByRole("button", { name: locale === "en" ? "Merge into target local data" : "确认合并到目标本机资料" }).click();
			await expect(panel).toContainText(locale === "en" ? "Local merge complete; sync not started" : "本机合并完成，尚未同步");
			if (locale === "zh-CN") {
				await panel.getByRole("button", { name: "撤销本机合并" }).click();
				await expect(panel).toContainText("本机合并已撤销");
				await targetPage.goto("/assets/project");
				await expect(targetPage.locator("main .list-row").filter({ hasText: "Source migration project" })).toHaveCount(0);
			} else {
				targetServer.dropNextPushAck();
				await panel.getByRole("button", { name: "Start target sync" }).click();
				await expect(panel).toContainText("Target sync not finished");
				await expect(panel).toContainText("The target server may have received some records");
				await panel.getByRole("button", { name: "Retry target sync" }).click();
				await expect(panel).toContainText("Target sync complete");
				await targetPage.goto("/assets/project");
				await expect(targetPage.locator("main .list-row").filter({ hasText: "Source migration project" })).toBeVisible();
				await targetPage.reload();
				await expect(targetPage.locator("main .list-row").filter({ hasText: "Source migration project" })).toBeVisible();
				await expect(targetServer.accepted.size).toBe(1);
				await expect(targetServer.pushes).toBe(2);
			}
			await targetPage.goto("/settings#connections");
			await expect(targetPage.getByRole("heading", { name: locale === "en" ? "Move to another account or workspace" : "迁移到另一账号或工作区" })).toBeVisible();
			await targetPage.screenshot({ path: test.info().outputPath(`migration-${locale}.png`), fullPage: true });
			expect(await targetPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
			expect(errors).toEqual([]);
		} finally { await sourceContext.close(); await targetContext.close(); }
	});
}

test("existing target record requires an individual choice before migration", async ({ browser }) => {
	test.setTimeout(90_000);
	const sourceContext = await browser.newContext({ locale: "en-US" });
	const targetContext = await browser.newContext({ locale: "en-US" });
	const sourcePage = await sourceContext.newPage();
	const targetPage = await targetContext.newPage();
	sourcePage.setDefaultTimeout(10_000);
	targetPage.setDefaultTimeout(10_000);
	const sourceWorkspace = crypto.randomUUID();
	const targetWorkspace = crypto.randomUUID();
	mockSync(sourceContext, 3199, sourceWorkspace);
	const targetServer = mockSync(targetContext, 3200, targetWorkspace);
	try {
		const file = await sourceBackup(sourcePage, "en", 3199, sourceWorkspace);
		// Create the shared target record through the explicit transfer flow;
		// ordinary restore now preserves the source identity on a clean browser.
		await configure(targetPage, 3200, targetWorkspace);
		const initial = targetPage.locator(".migration-panel");
		await initial.locator('input[type="file"]').first().setInputFiles(file);
		await initial.locator('input[type="password"]').first().fill(password);
		await initial.getByRole("button", { name: "Check target and preview" }).click();
		await initial.getByLabel("I checked the source and target for this merge").check();
		await initial.getByLabel("Target backup password (12 characters minimum)").fill(targetPassword);
		await initial.getByRole("button", { name: "Create target backup" }).click();
		const downloading = targetPage.waitForEvent("download");
		await initial.getByRole("link", { name: "Download target backup" }).click();
		const initialBackup = test.info().outputPath("target-initial.ka1");
		await (await downloading).saveAs(initialBackup);
		await initial.getByLabel("Select the downloaded target backup").setInputFiles(initialBackup);
		await initial.getByRole("button", { name: "Verify downloaded backup" }).click();
		await initial.getByRole("button", { name: "Merge into target local data" }).click();
		await initial.getByRole("button", { name: "Start target sync" }).click();
		await expect(initial).toContainText("Target sync complete");
		await targetPage.goto("/assets/project");
		await targetPage.locator("main .list-row").filter({ hasText: "Source migration project" }).click();
		await targetPage.getByRole("button", { name: "Edit", exact: true }).click();
		const dialog = targetPage.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill("Target variant");
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await configure(targetPage, 3200, targetWorkspace);
		await targetPage.locator(".sync-panel").getByRole("button", { name: "Sync now" }).click();
		await expect(targetPage.locator(".sync-panel .notice")).toHaveText("This sync completed");
		const panel = targetPage.locator(".migration-panel");
		await panel.locator('input[type="file"]').first().setInputFiles(file);
		await panel.locator('input[type="password"]').first().fill(password);
		await panel.getByRole("button", { name: "Check target and preview" }).click();
		await expect(panel).toContainText("1 need a choice");
		await expect(panel).toContainText("Source migration project");
		await expect(panel).toContainText("Target variant");
		await panel.getByText("Show field differences").click();
		await expect(panel.locator(".migration-field-difference").filter({ hasText: "Name" }).first()).toContainText("Target variant");
		await panel.getByLabel("I checked the source and target for this merge").check();
		await panel.getByLabel("Target backup password (12 characters minimum)").fill(targetPassword);
		await panel.getByRole("button", { name: "Create target backup" }).click();
		const [download] = await Promise.all([targetPage.waitForEvent("download"), panel.getByRole("link", { name: "Download target backup" }).click()]);
		const targetFile = path.join(test.info().outputDir, "target-conflict.ka1");
		await download.saveAs(targetFile);
		await panel.getByLabel("Select the downloaded target backup").setInputFiles(targetFile);
		await panel.getByRole("button", { name: "Verify downloaded backup" }).click();
		await expect(panel.getByRole("button", { name: "Merge into target local data" })).toBeDisabled();
		await panel.getByLabel(/Use source version/).check();
		await expect(panel.getByRole("button", { name: "Merge into target local data" })).toBeEnabled();
		await panel.screenshot({ path: test.info().outputPath("migration-en-conflict-choice.png") });
		await panel.getByRole("button", { name: "Merge into target local data" }).click();
		await expect(panel).toContainText("Local merge complete; sync not started");
		await panel.getByRole("button", { name: "Start target sync" }).click();
		await expect(panel).toContainText("Target sync complete");
		await targetPage.goto("/assets/project");
		await expect(targetPage.locator("main .list-row").filter({ hasText: "Source migration project" })).toBeVisible();
		await expect(targetPage.locator("main .list-row").filter({ hasText: "Target variant" })).toHaveCount(0);
		expect(targetServer.accepted.size).toBe(3);
	} finally { await sourceContext.close(); await targetContext.close(); }
});
