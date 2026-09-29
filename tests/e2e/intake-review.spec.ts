import { expect, test } from "@playwright/test";

const repositoryUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const reviewUrl = `/@fs${process.cwd()}/apps/web/src/intake-review-store.ts`;

for (const locale of ["zh-CN", "en-US"] as const) {
	test(`${locale} CSV review persists edits and decisions without duplicate writes`, async ({ browser }) => {
	const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
	const page = await context.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const labels = locale === "zh-CN"
		? { title: "导入审核", confirm: "确认入库", ignore: "忽略", accepted: "已确认", ignored: "已忽略", pdf: "此 PDF 未生成候选" }
		: { title: "Import review", confirm: "Confirm and save", ignore: "Ignore", accepted: "Confirmed", ignored: "Ignored", pdf: "No candidate was created from this PDF" };
	try {
		await page.goto("/intake");
		const card = page.locator(".intake-review-card");
		await expect(card.getByRole("heading", { name: labels.title })).toBeVisible();
		const file = card.locator("#intake-review-file");
		await file.setInputFiles({ name: "review.csv", mimeType: "text/csv", buffer: Buffer.from("name,kind,url\nAlpha,project,\nBeta,project,") });
		await expect(card.locator(".intake-review-row")).toHaveCount(2);
		const first = card.locator(".intake-review-row").first();
		const second = card.locator(".intake-review-row").nth(1);
		await first.getByLabel(locale === "zh-CN" ? "名称" : "Name").fill("Edited quickly");
		await first.getByLabel(locale === "zh-CN" ? "名称" : "Name").fill("Edited final");
		await first.getByRole("button", { name: labels.confirm }).click();
		await second.getByRole("button", { name: labels.ignore }).click();
		await expect(first).toContainText(labels.accepted);
		await expect(second).toContainText(labels.ignored);
		const saved = await page.evaluate(async (url) => {
			const { localRepository } = await import(url);
			return (await (await localRepository()).allRecords()).filter((row: { type: string }) => row.type === "asset")
				.map((row: { payload: string }) => JSON.parse(row.payload)).filter((asset: { name: string }) => asset.name === "Edited final");
		}, repositoryUrl);
		expect(saved).toHaveLength(1);
		await page.reload();
		await expect(card.locator(".intake-review-row")).toHaveCount(2);
		await expect(card.locator(".intake-review-row").first()).toContainText(labels.accepted);
		await file.setInputFiles({ name: "review-again.csv", mimeType: "text/csv", buffer: Buffer.from("name,kind,url\nAlpha,project,\nBeta,project,") });
		await expect(card.locator(".intake-review-row")).toHaveCount(2);
		const count = await page.evaluate(async (url) => {
			const { localRepository } = await import(url);
			return (await (await localRepository()).allRecords()).filter((row: { type: string }) => row.type === "asset").length;
		}, repositoryUrl);
		expect(count).toBe(1);
		await file.setInputFiles({ name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
		await expect(card.getByRole("status")).toContainText(labels.pdf);
		const historyCount = await page.evaluate(async (url) => {
			const { localRepository } = await import(url);
			return (await (await localRepository()).allRecords()).filter((row: { type: string }) => row.type === "history").length;
		}, repositoryUrl);
		expect(historyCount).toBe(0);
		await page.screenshot({ path: `/private/tmp/keepany-import-review-${locale}.png`, fullPage: true });
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
		expect(overflow).toBe(false);
		expect(errors).toEqual([]);
	} finally { await context.close(); }
});
}

test("existing stable asset ID is reconciled after a simulated decision interruption", async ({ page }) => {
	await page.goto("/intake");
	const card = page.locator(".intake-review-card");
	await card.locator("#intake-review-file").setInputFiles({ name: "recover.csv", mimeType: "text/csv", buffer: Buffer.from("name,kind\nRecover me,project") });
	await expect(card.locator(".intake-review-row")).toHaveCount(1);
	await page.evaluate(async ({ reviewPath, repositoryPath }) => {
		const { listReviewedCandidates } = await import(reviewPath);
		const { saveBatch } = await import(repositoryPath);
		const [row] = await listReviewedCandidates();
		await saveBatch([{ type: "asset", value: row.asset }]);
	}, { reviewPath: reviewUrl, repositoryPath: repositoryUrl });
	await card.getByRole("button", { name: "Confirm and save" }).click();
	await expect(card.locator(".intake-review-row")).toContainText("Confirmed");
	const records = await page.evaluate(async (url) => {
		const { localRepository } = await import(url);
		return (await (await localRepository()).allRecords()).filter((row: { type: string }) => row.type === "asset");
	}, repositoryUrl);
	expect(records).toHaveLength(1);
});

test("two tabs confirming one staged row create one asset", async ({ context }) => {
	const first = await context.newPage();
	await first.goto("/intake");
	await first.locator("#intake-review-file").setInputFiles({ name: "same.csv", mimeType: "text/csv", buffer: Buffer.from("name,kind\nOne row,project") });
	await expect(first.locator(".intake-review-row")).toHaveCount(1);
	const second = await context.newPage();
	await second.goto("/intake");
	await expect(second.locator(".intake-review-row")).toHaveCount(1);
	await Promise.all([
		first.locator(".intake-review-row").getByRole("button", { name: "Confirm and save" }).click(),
		second.locator(".intake-review-row").getByRole("button", { name: "Confirm and save" }).click(),
	]);
	await expect(first.locator(".intake-review-row")).toContainText("Confirmed");
	await expect(second.locator(".intake-review-row")).toContainText("Confirmed");
	const count = await first.evaluate(async (url) => {
		const { localRepository } = await import(url);
		return (await (await localRepository()).allRecords()).filter((row: { type: string }) => row.type === "asset").length;
	}, repositoryUrl);
	expect(count).toBe(1);
});
