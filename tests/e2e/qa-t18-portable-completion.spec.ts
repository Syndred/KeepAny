import { expect, test, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import type { ReviewedCandidate } from "../../packages/local-db/src/intake-review";
import { resources } from "../../apps/web/src/i18n";

const password = "T18-portable-synthetic-backup-password";
const evidence = "docs/qa/2026-10-27/evidence/T18-completion";
type ArchiveRow = { id: string; type: string; payload: string };

async function archive(page: Page, t: (key: keyof typeof resources.en.translation) => string) {
	await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: t("backup"), exact: true }).click();
	const link = page.getByRole("link", { name: t("saveBackupFile"), exact: true });
	await expect(link).toBeVisible();
	const downloadEvent = page.waitForEvent("download");
	await link.click();
	const download = await downloadEvent, path = await download.path();
	if (!path) throw Error("download-missing");
	expect(download.suggestedFilename()).toMatch(/\.ka1$/);
	const bytes = new Uint8Array(readFileSync(path));
	const entries = unzipSync(await decryptBackup(bytes, password));
	return { path, rows: JSON.parse(strFromU8(entries["records.json"])) as ArchiveRow[],
		candidates: JSON.parse(strFromU8(entries["intake-review.json"])) as ReviewedCandidate[] };
}

for (const [locale, width] of [["zh-CN", 390], ["en", 1280]] as const) test(`T18 portable ${locale} ${width}: public metadata, exact CSV and downloaded backup restore without source imports`, async ({ browser }) => {
	test.setTimeout(120_000);
	const context = await browser.newContext({ locale, viewport: { width, height: 950 } });
	const destination = await browser.newContext({ locale, viewport: { width, height: 950 } });
	const page = await context.newPage(), restored = await destination.newPage();
	const errors: string[] = [], sourceRequests: string[] = [];
	const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
	for (const tab of [page, restored]) {
		tab.on("pageerror", error => errors.push(error.message));
		tab.on("request", request => { if (request.url().includes("/@fs/") || request.url().includes("/@vite/")) sourceRequests.push(request.url()); });
		await tab.addInitScript(language => localStorage.setItem("keepany-language", language), locale);
	}
	try {
		await page.goto("/intake");
		const quick = page.locator(".intake-quick-card"), preview = quick.locator(".import-preview");
		await quick.locator("#import-url").fill("https://example.com/");
		const metadataResponse = page.waitForResponse(response => response.url().endsWith("/__keepany_intake__/url-metadata") && response.request().method() === "POST");
		await quick.getByRole("button", { name: t("intakePreviewRecords"), exact: true }).click();
		const response = await metadataResponse;
		expect(response.status()).toBe(200);
		expect((await response.json()).html).toContain("Example Domain");
		await expect(preview.locator('input:not([type="checkbox"])')).toHaveValue("Example Domain");
		await quick.getByRole("button", { name: t("intakeModeManual"), exact: true }).click();
		await expect(preview).toHaveCount(0);
		const canceled = await archive(page, t);
		expect(canceled.rows).toHaveLength(0);
		expect(canceled.candidates).toHaveLength(0);
		await quick.getByRole("button", { name: t("intakeModeUrl"), exact: true }).click();
		await quick.getByRole("button", { name: t("intakePreviewRecords"), exact: true }).click();
		await expect(preview.locator('input:not([type="checkbox"])')).toHaveValue("Example Domain");
		await preview.locator('input:not([type="checkbox"])').fill("T18 portable reviewed URL");
		await preview.locator("textarea").fill("T18 portable reviewed description");
		await preview.getByRole("button", { name: t("confirmImport"), exact: true }).click();
		await expect(preview).toHaveCount(0);
		await page.reload();
		const blocked = await page.evaluate(async () => {
			const response = await fetch("/__keepany_intake__/url-metadata", { method: "POST", headers: { "content-type": "application/json", "x-keepany-intake": "metadata" }, body: JSON.stringify({ url: "http://127.0.0.1:4180/" }) });
			return { status: response.status, value: await response.json() };
		});
		expect(blocked).toEqual({ status: 422, value: { error: "metadata-private" } });
		await quick.getByRole("button", { name: t("intakeModeCsv"), exact: true }).click();
		const original = '\uFEFFkind,name,url,description\r\nproject,T18 Portable Alpha,https://alpha.example.test,"First line\r\n第二行"\r\nproject,T18 Portable Alpha,https://alpha.example.test,Duplicate\r\nitem,T18 Portable Waiting,,Original waiting\r\n';
		await quick.locator("#csv-file").setInputFiles({ name: "T18-portable-original.csv", mimeType: "text/csv", buffer: Buffer.from(original) });
		const rows = page.locator(".intake-review-row");
		await expect(rows).toHaveCount(3);
		await rows.nth(2).getByLabel(t("name"), { exact: true }).fill("T18 Portable Waiting Edited");
		await rows.nth(0).getByRole("button", { name: t("reviewConfirm"), exact: true }).click();
		await expect(rows.nth(0).locator(".chip")).toHaveText(t("reviewStatusAccepted"));
		await rows.nth(1).getByRole("button", { name: t("reviewConfirm"), exact: true }).click();
		await expect(rows.nth(1).getByRole("alert")).toContainText(locale === "en" ? "Duplicate" : "重复");
		await page.reload();
		await expect(rows.nth(2).getByLabel(t("name"), { exact: true })).toHaveValue("T18 Portable Waiting Edited");
		const before = await archive(page, t);
		const assets = before.rows.filter(row => row.type === "asset").map(row => JSON.parse(row.payload));
		expect(assets).toHaveLength(2);
		expect(assets).toContainEqual(expect.objectContaining({ name: "T18 portable reviewed URL", description: "T18 portable reviewed description", url: "https://example.com/" }));
		expect(before.candidates).toHaveLength(3);
		expect(before.candidates.find(row => row.sourceText)?.sourceText).toBe(original);
		expect(before.candidates.filter(row => row.sourceTextRef)).toHaveLength(2);
		expect(before.candidates.every(row => row.fileHash === createHash("sha256").update(Buffer.from(original)).digest("hex"))).toBe(true);
		expect(before.candidates.filter(row => row.status === "pending")).toHaveLength(2);
		await restored.goto("/intake");
		await restored.locator("#backup-password").fill(password);
		await restored.locator("#restore-file").setInputFiles(before.path);
		await restored.getByRole("button", { name: t("preview"), exact: true }).first().click();
		await restored.getByRole("button", { name: /^(确认|Confirm) · 2/ }).click();
		await expect(restored.locator(".intake-review-row")).toHaveCount(3);
		await restored.reload();
		const after = await archive(restored, t);
		expect(after.rows).toEqual(before.rows);
		expect(after.candidates).toEqual(before.candidates);
		const originalDetails = restored.locator(".intake-review-original");
		await originalDetails.locator("summary").click();
		expect(await originalDetails.locator("pre").textContent()).toBe(original);
		await originalDetails.scrollIntoViewIfNeeded();
		mkdirSync(evidence, { recursive: true });
		await restored.screenshot({ path: `${evidence}/T18-portable-${locale}-${width}.png`, fullPage: false });
		expect(await restored.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
		expect(sourceRequests).toEqual([]);
		expect(errors).toEqual([]);
		await test.info().attach("T18-portable-actual-backup-readback", { body: JSON.stringify({ blocked, rows: before.rows, candidates: before.candidates, sourceRequests, errors }), contentType: "application/json" });
	} finally { await destination.close(); await context.close(); }
});
