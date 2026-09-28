import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const evidence = "docs/evidence/2026-09-29";
const copies = {
	"en-US": {
		backup: "Encrypted backup",
		createBackup: "Create backup",
		csv: "CSV file",
		duplicate: "Duplicate",
		import: "Confirm import",
		invalid: "Please check this field",
		preview: "Preview",
		ready: "Ready",
		restore: "Restore backup",
		saveBackup: "Save backup file",
	},
	"zh-CN": {
		backup: "加密备份",
		createBackup: "创建备份",
		csv: "CSV 表格",
		duplicate: "重复",
		import: "确认导入",
		invalid: "请检查此项",
		preview: "预览",
		ready: "可导入",
		restore: "恢复备份",
		saveBackup: "保存备份文件",
	},
} as const;

for (const locale of ["en-US", "zh-CN"] as const) {
	for (const width of [360, 390, 768, 1280, 1440]) {
		test(`${locale} intake previews and backup fit ${width}px`, async ({
			browser,
		}) => {
			test.setTimeout(90_000);
			mkdirSync(evidence, { recursive: true });
			const context = await browser.newContext({
				locale,
				acceptDownloads: true,
				viewport: { width, height: 844 },
			});
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const copy = copies[locale];
			const stem = `intake-${locale === "zh-CN" ? "zh" : "en"}-${width}`;
			const longName = `Project ${"X".repeat(140)}`;
			try {
				await page.goto("/intake");
				const importCard = page.locator("section.card").filter({
					has: page.getByRole("heading", { name: copy.import }),
				});
				const backupCard = page.locator("section.card").filter({
					has: page.getByRole("heading", { name: copy.backup }),
				});
				const url = "https://example.com/keepany-preview";
				await importCard.locator("#import-url").fill(url);
				await importCard.getByRole("button", { name: copy.preview }).click();
				await expect(importCard.locator(".import-preview")).toContainText(
					"example.com",
				);
				await page.screenshot({
					path: `${evidence}/${stem}-url.png`,
					fullPage: true,
				});
				await importCard.locator("#import-url").fill("file:///old-candidate");
				await expect(importCard.locator(".import-preview")).toHaveCount(0);
				await importCard.getByRole("button", { name: copy.preview }).click();
				await expect(page.locator(".notice[role='status']")).toContainText(
					copy.invalid,
				);
				await expect(importCard.locator(".import-preview")).toHaveCount(0);
				await importCard.locator("#import-url").fill(url);
				await importCard.getByRole("button", { name: copy.preview }).click();
				await importCard.getByRole("button", { name: copy.import }).click();
				await expect(importCard.locator(".import-preview")).toHaveCount(0);

				const csv = [
					"name,kind,url,category,description",
					`example.com,project,${url},website,duplicate`,
					`${longName},project,https://long.example/,website,long name`,
				].join("\n");
				await importCard.getByLabel(copy.csv).setInputFiles({
					name: "preview.csv",
					mimeType: "text/csv",
					buffer: Buffer.from(csv),
				});
				const preview = importCard.locator(".import-preview");
				await expect(preview.locator(".list-row")).toHaveCount(2);
				await expect(
					preview
						.locator(".list-row")
						.filter({ hasText: "example.com" })
						.first(),
				).toContainText(copy.duplicate);
				await expect(
					preview.locator(".list-row").filter({ hasText: longName }),
				).toContainText(copy.ready);
				await expect(
					preview
						.locator(".list-row")
						.filter({ hasText: "example.com" })
						.first()
						.locator("input"),
				).toBeDisabled();
				for (const chip of await preview.locator(".chip").all()) {
					const box = await chip.boundingBox();
					expect(box?.width).toBeGreaterThanOrEqual(38);
					expect(box?.height).toBeLessThanOrEqual(30);
				}
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				await page.screenshot({
					path: `${evidence}/${stem}-csv.png`,
					fullPage: true,
				});
				await importCard.getByLabel(copy.csv).setInputFiles({
					name: "broken.csv",
					mimeType: "text/csv",
					buffer: Buffer.from('name,kind\n"unterminated,project'),
				});
				await expect(importCard.locator(".import-preview")).toHaveCount(0);
				await importCard.getByLabel(copy.csv).setInputFiles({
					name: "preview.csv",
					mimeType: "text/csv",
					buffer: Buffer.from(csv),
				});
				await expect(preview.locator(".list-row")).toHaveCount(2);
				await importCard.getByRole("button", { name: copy.import }).click();
				await expect(importCard.locator(".import-preview")).toHaveCount(0);

				await backupCard
					.locator("#backup-password")
					.fill("local-only-intake-2026");
				await backupCard
					.getByRole("button", { name: copy.createBackup })
					.click();
				const saveFile = backupCard.getByRole("link", {
					name: copy.saveBackup,
				});
				await expect(saveFile).toBeVisible();
				const downloadPromise = page.waitForEvent("download");
				await saveFile.click();
				const downloaded = await downloadPromise;
				const file = await downloaded.path();
				if (!file) throw new Error("Downloaded backup missing");
				await backupCard.getByLabel(copy.restore).setInputFiles(file);
				await backupCard.getByRole("button", { name: copy.preview }).click();
				await expect(
					backupCard.getByRole("button", { name: /[·] [1-9]/ }),
				).toBeVisible();
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				await page.screenshot({
					path: `${evidence}/${stem}-restore-preview.png`,
					fullPage: true,
				});
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}
