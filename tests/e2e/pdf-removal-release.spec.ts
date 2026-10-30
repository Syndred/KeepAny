import { openCapture } from "./helpers/ai-workflow";
import { openBackupPage } from "./helpers/backup-restore";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { resources } from "../../apps/web/src/i18n";
import { aiServer, labels, model, syntheticKey } from "./helpers/ai-workflow";
import { selectChoice } from "./helpers/select-choice";
import { portableCandidate } from "./helpers/portable-candidate";

const candidate = portableCandidate();
const password = "PDF-removal-synthetic-backup";
async function archive(page: Page, language: "zh-CN" | "en") {
	const t = resources[language].translation;
 const backupPage = await page.context().newPage();
 await backupPage.goto(page.url());
 try {
	await openBackupPage(backupPage); await backupPage.locator("#backup-password").fill(password);
	await backupPage.getByRole("button", { name: t.backup, exact: true }).click();
	const pending = backupPage.waitForEvent("download");
	await backupPage.getByRole("link", { name: t.saveBackupFile, exact: true }).click();
	const path = await (await pending).path();
	if (!path) throw Error("synthetic-backup-download-missing");
	const entries = unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)), password));
	return { rows: JSON.parse(strFromU8(entries["records.json"])),
		reviews: JSON.parse(strFromU8(entries["intake-review.json"])) };
 } finally { await backupPage.close(); }
}

for (const language of ["zh-CN", "en"] as const) test(`RM02 ${language}: removed PDF inputs reject extension or MIME locally and retain CSV/AI text`, async ({ browser }) => {
	test.setTimeout(120_000);
	const mock = await aiServer();
	const context = await browser.newContext({ locale: language, viewport: { width: 1280, height: 900 } });
	await context.addInitScript(value => localStorage.setItem("keepany-language", value), language);
	const page = await context.newPage(), errors: string[] = [], development: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	page.on("request", request => { if (/\/@(?:fs|vite)\//.test(request.url())) development.push(request.url()); });
	const t = resources[language].translation, copy = labels[language];
	try {
		await page.goto("/settings#assistant");
		const settings = page.locator(".ai-settings-panel");
		await selectChoice(settings.locator("#ai-settings-provider"), "compatible");
		await settings.locator("#ai-settings-url").fill(mock.baseURL);
		await settings.locator("#ai-settings-model").fill(model);
		await selectChoice(settings.locator("#ai-settings-key-source"), "session");
		await settings.locator("#ai-settings-api-key").fill(syntheticKey);
		await settings.getByRole("button", { name: copy.saveSettings, exact: true }).click();
		await expect(settings.getByRole("status").filter({ hasText: copy.ready })).toBeVisible();
		await openCapture(page, copy.intake);
		const importer = page.locator(".ai-import-panel"), quick = page.locator(".intake-quick-card");
		const source = "RM02 retained text project: https://retained.example.test/";
		await page.getByRole("button", { name: t.aiCaptureTab, exact: true }).click();
		await importer.locator("#ai-import-text").fill(source);
		const generate = importer.getByRole("button", { name: copy.generate, exact: true });
		await page.getByRole("button", { name: t.aiCaptureTab, exact: true }).click();
		await expect(generate).toBeEnabled();
		await page.getByRole("button", { name: t.captureTab, exact: true }).click();
		await expect(quick.getByRole("button", { name: t.intakeModePdf, exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: t.aiCaptureTab, exact: true }).click();
		await expect(importer.locator("#ai-import-file")).not.toHaveAttribute("accept", /pdf/i);
		const before = await archive(page, language);
		await page.getByRole("button", { name: t.captureTab, exact: true }).click();
		await quick.getByRole("button", { name: t.intakeModeCsv, exact: true }).click();
		await page.getByRole("button", { name: t.captureTab, exact: true }).click();
		await expect(quick.locator("#csv-file")).not.toHaveAttribute("accept", /pdf/i);
		for (const file of [
			{ name: "new.pdf", mimeType: "application/pdf" },
			{ name: "extension-only.PDF", mimeType: "text/csv" },
			{ name: "mime-only.csv", mimeType: "application/pdf" },
			{ name: "image-shaped.PDF", mimeType: "image/png" },
		]) {
			const input = { ...file, buffer: Buffer.from("PDF forbidden payload: must stay local") };
		await page.getByRole("button", { name: t.captureTab, exact: true }).click();
			await quick.locator("#csv-file").setInputFiles(input);
			await expect(page.locator(".intake-tools").getByRole("status").filter({ hasText: t.pdfImportRemoved })).toBeVisible();
		await page.getByRole("button", { name: t.aiCaptureTab, exact: true }).click();
			await importer.locator("#ai-import-file").setInputFiles(input);
		await page.getByRole("button", { name: t.aiCaptureTab, exact: true }).click();
			await expect(importer.getByRole("status")).toHaveText(t.pdfImportRemoved);
		await page.getByRole("button", { name: t.aiCaptureTab, exact: true }).click();
			await expect(generate).toBeDisabled();
			expect(mock.requests).toHaveLength(0);
		}
		await page.getByRole("button", { name: t.captureTab, exact: true }).click();
		await quick.getByRole("button", { name: t.intakeModeImage, exact: true }).click();
		await page.getByRole("button", { name: t.captureTab, exact: true }).click();
		await quick.locator("#intake-photo-file").setInputFiles({ name: "not-an-image.pdf", mimeType: "image/png", buffer: Buffer.from("%PDF-1.4") });
		await expect(page.locator(".intake-tools").getByRole("status").filter({ hasText: t.pdfImportRemoved })).toBeVisible();
		await page.getByRole("button", { name: t.captureTab, exact: true }).click();
		await expect(quick.getByRole("button", { name: t.confirmImport, exact: true })).toBeDisabled();
		for (const width of [390, 768, 1280, 1920, 2560]) {
			await page.setViewportSize({ width, height: 900 });
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
		await page.getByRole("button", { name: t.aiCaptureTab, exact: true }).click();
			await expect(importer.getByRole("status")).toHaveText(t.pdfImportRemoved);
			await page.screenshot({ path: test.info().outputPath(`pdf-removed-${language}-${width}.png`), fullPage: true });
		}
		expect(await archive(page, language)).toEqual(before);
		expect(mock.requests).toHaveLength(0);
		await page.getByRole("button", { name: t.aiCaptureTab, exact: true }).click();
		await importer.getByRole("button", { name: t.aiImportRemoveFile, exact: true }).click();
		await page.getByRole("button", { name: t.aiCaptureTab, exact: true }).click();
		await expect(importer.locator("#ai-import-text")).toHaveValue(source);
		await page.getByRole("button", { name: t.aiCaptureTab, exact: true }).click();
		await expect(generate).toBeEnabled();
		await page.getByRole("button", { name: t.captureTab, exact: true }).click();
		await quick.getByRole("button", { name: t.intakeModeCsv, exact: true }).click();
		await page.getByRole("button", { name: t.captureTab, exact: true }).click();
		await quick.locator("#csv-file").setInputFiles({ name: "retained.csv", mimeType: "text/csv", buffer: Buffer.from("name,kind\nRM02 retained CSV,project") });
		await expect(page.locator(".intake-review-row")).toHaveCount(1);
		mock.responses.push(JSON.stringify({ text: "", records: [{ kind: "project", name: "RM02 retained AI", username: "",
			url: "https://retained.example.test/", description: "", category: "", tags: [], amount: null, currency: null,
			cycle: null, interval: null, dueDate: null, evidence: source, relatedName: "", missingFields: [] }] }));
		await page.getByRole("button", { name: t.aiCaptureTab, exact: true }).click();
		await generate.click();
		await expect(page.locator(".intake-review-row")).toHaveCount(2);
		expect(mock.requests).toHaveLength(1);
		expect(JSON.stringify(mock.requests[0].body)).toContain(source);
		expect(JSON.stringify(mock.requests[0].body)).not.toContain("PDF forbidden payload");
		const after = await archive(page, language);
		expect(after.rows).toEqual(before.rows);
		expect(after.reviews).toHaveLength(2);
		expect(after.reviews.map((row: { status: string }) => row.status)).toEqual(["pending", "pending"]);
		await page.reload();
		expect(await archive(page, language)).toEqual(after);
		expect(development).toEqual([]);
		expect(errors).toEqual([]);
		await test.info().attach("PDF-removal-candidate-and-effects", { body: JSON.stringify({ candidate, before, after,
			aiRequests: mock.requests.length, development, errors }), contentType: "application/json" });
	} finally { await context.close(); await mock.close(); }
});
