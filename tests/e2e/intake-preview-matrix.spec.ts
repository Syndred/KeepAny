import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

const evidence =
	process.env.KEEPANY_INTAKE_EVIDENCE_DIR ?? "docs/evidence/2026-09-29";
const photo = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAAhUlEQVR4nLXNuRXCQBAE0WJCIQlZikEJYZLZ5iGfLOTyYI85Wu3NlPEfn2Pja/vzhXT2c7fzfS+A2rDuV2jYKKgMmzSJYfPcysYCoGysAWqGC6BgeAGyRgAgZcQA4kYYIGhkACJGEsBt5AF8RgnAYVQBVoYAYGpoAMaGDGBgKIGuIQb+jQtZ/TPNXBjnggAAAABJRU5ErkJggg==",
	"base64",
);
const copies = {
	"en-US": {
		quick: "Quick capture",
		backup: "Records & backup",
		createBackup: "Create backup",
		csv: "CSV file",
		csvMode: "Spreadsheet",
		photoMode: "Photo or receipt",
		manualMode: "Manual",
		addPhoto: "Add image",
		import: "Confirm import",
		confirmCandidate: "Confirm and save",
		staged: "candidates are ready for review",
		invalidCsv: "No reviewable records",
		invalid: "Please check this field",
		preview: "Preview",
		previewRecords: "Preview records",
		restore: "Restore backup",
		saveBackup: "Save backup file",
	},
	"zh-CN": {
		quick: "快速收录",
		backup: "资料与备份",
		createBackup: "创建备份",
		csv: "CSV 表格",
		csvMode: "表格",
		photoMode: "图片 / 收据",
		manualMode: "手动",
		addPhoto: "添加图片",
		import: "确认导入",
		confirmCandidate: "确认入库",
		staged: "条候选",
		invalidCsv: "未找到可审核资料",
		invalid: "请检查此项",
		preview: "预览",
		previewRecords: "预览资料",
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
				const importCard = page.locator(".intake-quick-card");
				const backupCard = page.locator(".intake-backup-card");
				await expect(
					importCard.getByRole("heading", { name: copy.quick }),
				).toBeVisible();
				await expect(
					backupCard.getByRole("heading", { name: copy.backup }),
				).toBeVisible();
				await expect(importCard.locator("#csv-file")).toHaveCount(0);
				const url = "https://example.com/keepany-preview";
				await importCard.locator("#import-url").fill(url);
				await importCard
					.getByRole("button", { name: copy.previewRecords })
					.click();
				await expect(
					importCard.locator(".import-preview input:not([type=checkbox])"),
				).toHaveValue(/example\.com/);
				await page.screenshot({
					path: `${evidence}/${stem}-url.png`,
					fullPage: true,
				});
				await importCard.locator("#import-url").fill("file:///old-candidate");
				await expect(importCard.locator(".import-preview")).toHaveCount(0);
				await importCard
					.getByRole("button", { name: copy.previewRecords })
					.click();
				await expect(page.locator(".notice[role='status']")).toContainText(
					copy.invalid,
				);
				await expect(importCard.locator(".import-preview")).toHaveCount(0);
				await importCard.locator("#import-url").fill(url);
				await importCard
					.getByRole("button", { name: copy.previewRecords })
					.click();
				await importCard.getByRole("button", { name: copy.import }).click();
				await expect(importCard.locator(".import-preview")).toHaveCount(0);
				await importCard.getByRole("button", { name: copy.manualMode }).click();
				await importCard.locator("#intake-manual-name").fill("Inbox idea");
				await importCard
					.getByRole("button", { name: copy.previewRecords })
					.click();
				await expect(
					importCard.locator(".import-preview input:not([type=checkbox])"),
				).toHaveValue("Inbox idea");
				await page.screenshot({
					path: `${evidence}/${stem}-manual.png`,
					fullPage: true,
				});
				await importCard.getByRole("button", { name: copy.import }).click();
				await expect(page.locator(".intake-recent")).toContainText(
					"Inbox idea",
				);
				await importCard.getByRole("button", { name: copy.photoMode }).click();
				await expect(importCard.locator("#import-url")).toHaveCount(0);
				await importCard.locator("#intake-photo-file").setInputFiles({
					name: "new-photo.png",
					mimeType: "image/png",
					buffer: photo,
				});
				await expect(importCard.locator("img.image-preview")).toBeVisible();
				await importCard.locator("#intake-photo-name").fill("Photo item");
				await page.screenshot({
					path: `${evidence}/${stem}-photo-new.png`,
					fullPage: true,
				});
				await importCard.getByRole("button", { name: copy.import }).click();
				await expect(page.locator(".intake-recent")).toContainText(
					"Photo item",
				);
				await page
					.locator(".intake-recent")
					.getByRole("link", { name: "Photo item" })
					.click();
				await expect(page.locator(".asset-item-photo-stage img")).toBeVisible();
				await page.goto("/intake");
				await importCard.getByRole("button", { name: copy.photoMode }).click();
				await importCard
					.locator("#intake-photo-asset")
					.selectOption({ label: "example.com" });
				await importCard.locator("#intake-photo-file").setInputFiles({
					name: "receipt.png",
					mimeType: "image/png",
					buffer: photo,
				});
				await expect(importCard.locator("img.image-preview")).toBeVisible();
				await importCard.getByRole("button", { name: copy.addPhoto }).click();
				await expect(importCard.locator("img.image-preview")).toHaveCount(0);
				await page
					.locator(".intake-recent")
					.getByRole("link", { name: "example.com" })
					.click();
				await page.locator("#asset-project-materials > summary").click();
				await expect(
					page.locator(".asset-attachments-card img.asset-image").first(),
				).toBeVisible();
				await page.goto("/intake");
				await importCard
					.getByRole("button", { name: copy.csvMode, exact: true })
					.click();
				await expect(importCard.locator("#import-url")).toHaveCount(0);

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
				const review = page.locator(".intake-review-card");
				const rows = review.locator(".intake-review-row");
				await expect(page.locator(".notice[role='status']")).toContainText(
					copy.staged,
				);
				await expect(rows).toHaveCount(2);
				await expect(
					rows.nth(1).getByLabel(locale === "zh-CN" ? "名称" : "Name"),
				).toHaveValue(longName);
				for (const chip of await review.locator(".chip").all()) {
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
				await expect(page.locator(".notice[role='status']")).toContainText(
					copy.invalidCsv,
				);
				await expect(rows).toHaveCount(2);
				await importCard.getByLabel(copy.csv).setInputFiles({
					name: "preview.csv",
					mimeType: "text/csv",
					buffer: Buffer.from(csv),
				});
				await expect(rows).toHaveCount(2);
				await rows
					.nth(1)
					.getByRole("button", { name: copy.confirmCandidate })
					.click();
				await expect(rows.nth(1)).toContainText(
					locale === "zh-CN" ? "已确认" : "Confirmed",
				);

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
				await backupCard
					.locator("details.intake-secondary > summary")
					.filter({ hasText: copy.restore })
					.click();
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
