import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { resources } from "../../apps/web/src/i18n";
import { selectChoice } from "./helpers/select-choice";
import { sourceModuleUrl } from "./helpers/source-module-url";

const repositoryPath = sourceModuleUrl("packages/local-db/src/index.ts");
const evidence = "docs/qa/2026-10-27/evidence/T18-windows";
mkdirSync(evidence, { recursive: true });

async function readback(page: Page) {
	return page.evaluate(async (path) => {
		const repository = await (await import(path)).localRepository();
		return { assets: await repository.list("asset"), candidates: await repository.fileStore.intakeReview.toArray(), fileIds: (await repository.fileStore.blobs.toArray()).map((row: { id: string }) => row.id) };
	}, repositoryPath);
}

test("T18-03 corrupt picture is rejected without creating an asset or a blob", async ({ page }) => {
	await page.goto("/intake");
	await page.getByRole("button", { name: "Photo or receipt", exact: true }).click();
	await page.locator("#intake-photo-file").setInputFiles({ name: "corrupt.png", mimeType: "image/png", buffer: Buffer.from("synthetic-not-a-decodable-image") });
	await page.locator("#intake-photo-name").fill("Corrupt photo must not save");
	await page.getByRole("button", { name: "Confirm import", exact: true }).click();
	try {
		await expect(page.getByRole("status").filter({ hasText: "Choose a JPEG, PNG, WebP or GIF up to 20 MB." })).toBeVisible();
	} finally {
		await test.info().attach("corrupt-image-readback", { body: JSON.stringify(await readback(page)), contentType: "application/json" });
	}
	const after = await readback(page);
	expect(after.assets).toEqual([]);
	expect(after.fileIds).toEqual([]);
	await expect(page.locator("#intake-photo-name")).toHaveValue("Corrupt photo must not save");
	const images = await page.evaluate(() => {
		const canvas = document.createElement("canvas"); canvas.width = canvas.height = 24;
		const drawing = canvas.getContext("2d"); if (!drawing) throw Error("canvas-unavailable");
		drawing.fillStyle = "#568c76"; drawing.fillRect(0, 0, 24, 24);
		return { png: canvas.toDataURL("image/png").split(",")[1], jpeg: canvas.toDataURL("image/jpeg").split(",")[1], webp: canvas.toDataURL("image/webp") };
	});
	await page.locator("#intake-photo-file").setInputFiles({ name: "valid.png", mimeType: "image/png", buffer: Buffer.from(images.png, "base64") });
	await page.locator("#intake-photo-name").fill("T18 valid picture");
	await page.getByRole("button", { name: "Confirm import", exact: true }).click();
	await expect(page.locator(".intake-recent")).toContainText("T18 valid picture");
	const created = await readback(page);
	expect(created.assets).toHaveLength(1);
	expect(created.fileIds).toHaveLength(1);
	await selectChoice(page.locator("#intake-photo-asset"), created.assets[0].id);
	await page.locator("#intake-photo-file").setInputFiles({ name: "broken-attachment.png", mimeType: "image/png", buffer: Buffer.from("synthetic-broken-attachment") });
	await page.getByRole("button", { name: "Add image", exact: true }).click();
	await expect(page.getByRole("status").filter({ hasText: "Choose a JPEG, PNG, WebP or GIF up to 20 MB." })).toBeVisible();
	expect(await readback(page)).toEqual(created);
	await page.locator("#intake-photo-file").setInputFiles({ name: "plain.txt", mimeType: "text/plain", buffer: Buffer.from("synthetic plain text") });
	await expect(page.locator("#intake-photo-file")).toHaveValue("");
	expect(await readback(page)).toEqual(created);
	await page.locator("#intake-photo-file").setInputFiles({ name: "oversize.png", mimeType: "image/png", buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
	await expect(page.locator("#intake-photo-file")).toHaveValue("");
	expect(await readback(page)).toEqual(created);
	await page.locator("#intake-photo-file").setInputFiles({ name: "valid.jpg", mimeType: "image/jpeg", buffer: Buffer.from(images.jpeg, "base64") });
	await page.getByRole("button", { name: "Add image", exact: true }).click();
	await expect(page.locator(".intake-quick-card img.image-preview")).toHaveCount(0);
	const appended = await readback(page);
	expect(appended.assets).toHaveLength(1);
	expect(appended.assets[0].id).toBe(created.assets[0].id);
	expect(appended.assets[0].attachments).toHaveLength(2);
	expect(appended.assets[0].attachments[0]).toBe(created.assets[0].attachments[0]);
	expect(appended.fileIds).toHaveLength(2);
	expect(images.webp).toMatch(/^data:image\/webp;base64,/);
	await page.locator("#intake-photo-file").setInputFiles({ name: "valid.webp", mimeType: "image/webp", buffer: Buffer.from(images.webp.split(",")[1], "base64") });
	await page.getByRole("button", { name: "Add image", exact: true }).click();
	await expect(page.locator(".intake-quick-card img.image-preview")).toHaveCount(0);
	const webpAppended = await readback(page);
	expect(webpAppended.assets).toHaveLength(1);
	expect(webpAppended.assets[0].id).toBe(created.assets[0].id);
	expect(webpAppended.assets[0].attachments.slice(0, 2)).toEqual(appended.assets[0].attachments);
	expect(webpAppended.assets[0].attachments).toHaveLength(3);
	expect(webpAppended.fileIds).toHaveLength(3);
});

for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`T18-01/02/04 ${locale} ${width}px URL generations and persistent selective CSV review`, async ({ browser }) => {
		test.setTimeout(90_000);
		const context = await browser.newContext({ locale, viewport: { width, height: 950 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
		let metadataRequests = 0;
		await context.route("http://127.0.0.1:43219/**", async (route) => { metadataRequests++; await route.fulfill({ contentType: "text/html", body: '<title>T18 controlled metadata title</title><meta name="description" content="T18 controlled metadata description">' }); });
		try {
			await page.addInitScript((language) => localStorage.setItem("keepany-language", language), locale);
			await page.goto("/intake");
			const quick = page.locator(".intake-quick-card");
			await expect(quick).toBeVisible();
			await page.evaluate(async (path) => {
				const repository = await (await import(path)).localRepository();
				const original = repository.allRecords.bind(repository);
				const host = window as unknown as { t18Held: boolean; t18Returned: boolean; t18Release?: () => void };
				let held = false;
				repository.allRecords = async () => {
					const value = await original();
					if (!held) { held = true; host.t18Held = true; await new Promise<void>((resolve) => { host.t18Release = resolve; }); host.t18Returned = true; }
					return value;
				};
			}, repositoryPath);
			await quick.locator("#import-url").fill("http://127.0.0.1:43219/old");
			await quick.getByRole("button", { name: t("intakePreviewRecords"), exact: true }).click();
			await expect.poll(() => page.evaluate(() => (window as unknown as { t18Held: boolean }).t18Held)).toBe(true);
			await quick.locator("#import-url").fill("http://127.0.0.1:43219/latest");
			await quick.getByRole("button", { name: t("intakePreviewRecords"), exact: true }).click();
			const preview = quick.locator(".import-preview");
			await expect(preview.getByRole("textbox")).toHaveValue("127.0.0.1");
			await preview.getByRole("textbox").fill("T18 edited latest candidate");
			await page.evaluate(() => (window as unknown as { t18Release: () => void }).t18Release());
			await expect.poll(() => page.evaluate(() => (window as unknown as { t18Returned: boolean }).t18Returned)).toBe(true);
			await expect(preview.getByRole("textbox")).toHaveValue("T18 edited latest candidate");
			expect((await readback(page)).assets).toEqual([]);
			await quick.getByRole("button", { name: t("intakeModeManual"), exact: true }).click();
			await expect(preview).toHaveCount(0);
			expect((await readback(page)).assets).toEqual([]);
			await quick.locator("#intake-manual-name").fill("T18 pasted manual title");
			await quick.getByRole("button", { name: t("intakePreviewRecords"), exact: true }).click();
			await expect(preview.getByRole("textbox")).toHaveValue("T18 pasted manual title");
			await quick.getByRole("button", { name: t("intakeModeUrl"), exact: true }).click();
			for (const forbidden of ["file:///secret", "javascript:alert(1)", "data:text/plain,synthetic"]) {
				await quick.locator("#import-url").fill(forbidden);
				await quick.getByRole("button", { name: t("intakePreviewRecords"), exact: true }).click();
				await expect(page.getByRole("status").filter({ hasText: t("invalid") })).toBeVisible();
				await expect(preview).toHaveCount(0);
			}
			await quick.locator("#import-url").fill("http://127.0.0.1:43219/latest");
			await quick.getByRole("button", { name: t("intakePreviewRecords"), exact: true }).click();
			await preview.getByRole("textbox").fill("T18 confirmed URL");
			await preview.getByRole("button", { name: t("confirmImport"), exact: true }).click();
			await expect(preview).toHaveCount(0);
			const urlState = await readback(page);
			expect(urlState.assets).toHaveLength(1);
			expect(urlState.assets[0]).toMatchObject({ name: "T18 confirmed URL", url: "http://127.0.0.1:43219/latest", category: "website" });
			expect(metadataRequests).toBe(0);
			await quick.getByRole("button", { name: t("intakeModeCsv"), exact: true }).click();
			const csv = "name,kind,url,description\nAlpha,project,https://alpha.example.test,original first\nAlpha,project,https://alpha.example.test,duplicate line\nT18 Waiting,item,,original waiting text";
			await page.locator("#csv-file").setInputFiles({ name: "T18.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
			const rows = page.locator(".intake-review-row");
			await expect(rows).toHaveCount(3);
			await rows.nth(0).getByLabel(t("name"), { exact: true }).fill("");
			await rows.nth(0).getByRole("button", { name: t("reviewConfirm"), exact: true }).click();
			await expect(rows.nth(0).getByRole("alert")).toBeVisible();
			await rows.nth(0).getByLabel(t("name"), { exact: true }).fill("Alpha");
			await rows.nth(2).getByLabel(t("name"), { exact: true }).fill("T18 Draft retained");
			await rows.nth(2).getByLabel(t("description"), { exact: true }).fill("T18 edited candidate draft");
			await rows.nth(0).getByRole("checkbox").check();
			await page.getByRole("button", { name: locale === "en" ? "Confirm selected (1)" : "确认所选（1）", exact: true }).click();
			await expect(rows.nth(0).locator(".chip")).toHaveText(t("reviewStatusAccepted"));
			await rows.nth(1).getByRole("button", { name: t("reviewConfirm"), exact: true }).click();
			await expect(rows.nth(1).getByRole("alert")).toContainText(locale === "en" ? "Duplicate" : "重复");
			await page.reload();
			await expect(rows).toHaveCount(3);
			await expect(rows.nth(2).getByLabel(t("name"), { exact: true })).toHaveValue("T18 Draft retained");
			await expect(rows.nth(2).getByLabel(t("description"), { exact: true })).toHaveValue("T18 edited candidate draft");
			const result = await readback(page);
			expect(result.assets.map((asset: { name: string }) => asset.name).sort()).toEqual(["Alpha", "T18 confirmed URL"]);
			expect(result.candidates.filter((candidate: { status: string }) => candidate.status === "pending")).toHaveLength(2);
			await test.info().attach("T18-candidate-readback", { body: JSON.stringify({ metadataRequests, result }, null, 2), contentType: "application/json" });
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			await page.screenshot({ path: join(evidence, `T18-${locale}-${width}.png`), fullPage: true });
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
