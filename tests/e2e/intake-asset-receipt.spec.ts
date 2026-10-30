import { openBackupPage } from "./helpers/backup-restore";
import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import type { Asset } from "../../packages/domain/src";
import type { ReviewedCandidate } from "../../packages/local-db/src/intake-review";
import { selectChoice } from "./helpers/select-choice";

const password = "intake-asset-receipt-encrypted-backup";
const acceptedName = "Confirmed CSV snapshot with a long descriptive name retained after the saved account changes";
const ignoredName = "Ignored CSV snapshot retained for later reference";
const currentName = "Current renamed account";
const acceptedUrl = "https://receipt.example.test/confirmed";
const ignoredUrl = "https://receipt.example.test/ignored";
const acceptedDescription = "Original confirmed candidate description with preserved readable content. ".repeat(12).trim();
const ignoredDescription = "Original ignored candidate description with preserved readable content. ".repeat(8).trim();
const copyFor = (zh: boolean) => zh ? {
	spreadsheet: "表格", confirm: "确认入库", ignore: "忽略", confirmed: "已确认", ignored: "已忽略",
	name: "名称", edit: "编辑", save: "保存", trash: "移至回收站", description: "简短描述",
	recordType: "资料类型", account: "账号", item: "实物", view: "查看已保存资料", unavailable: "关联资料不可用",
	backup: "创建备份", download: "保存备份文件", preview: "预览", confirmRestore: /确认 ·/, restored: /已恢复 \d+ 条记录/,
} : {
	spreadsheet: "Spreadsheet", confirm: "Confirm and save", ignore: "Ignore", confirmed: "Confirmed", ignored: "Ignored",
	name: "Name", edit: "Edit", save: "Save", trash: "Move to trash", description: "Short description",
	recordType: "Record type", account: "Accounts", item: "Items", view: "View saved record", unavailable: "Related record unavailable",
	backup: "Create backup", download: "Save backup file", preview: "Preview", confirmRestore: /Confirm ·/, restored: /Restored \d+ records/,
};
type Copy = ReturnType<typeof copyFor>;

test.use({ actionTimeout: 15_000 });

function candidate(page: Page, name: string) {
	return page.locator(".intake-review-row").filter({ has: page.locator(".intake-expense-receipt > strong", { hasText: name }) });
}

async function assertReceipt(row: Locator, copy: Copy, ignored: boolean) {
	const receipt = row.locator(".intake-expense-receipt");
	await expect(row.locator(".chip")).toHaveText(ignored ? copy.ignored : copy.confirmed);
	await expect(receipt.locator("strong")).toHaveText(ignored ? ignoredName : acceptedName);
	await expect(receipt.getByText(`${copy.recordType}: ${ignored ? copy.item : copy.account}`, { exact: true })).toBeVisible();
	await expect(receipt).toContainText(ignored ? ignoredUrl : acceptedUrl);
	await expect(row.locator("input, textarea, [role=combobox]")).toHaveCount(0);
	const description = receipt.locator("details");
	await expect(description).not.toHaveAttribute("open");
	await description.getByText(copy.description, { exact: true }).click();
	await expect(description.locator("p")).toHaveText(ignored ? ignoredDescription : acceptedDescription);
	await expect(description.locator("p")).toBeVisible();
	expect(await row.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
	await description.getByText(copy.description, { exact: true }).click();
	if (ignored) await expect(row.getByRole("link")).toHaveCount(0);
}

async function deleteAsset(page: Page, copy: Copy) {
	await page.locator(".page-header .actions").getByRole("button", { name: copy.trash, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: copy.trash, exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page).toHaveURL(/\/assets\/account$/);
}

async function assertUnavailable(page: Page, copy: Copy) {
	await page.goto("/intake");
	const accepted = candidate(page, acceptedName);
	await assertReceipt(accepted, copy, false);
	await expect(accepted.getByText(copy.unavailable, { exact: true })).toBeVisible();
	await expect(accepted.getByRole("link")).toHaveCount(0);
	await assertReceipt(candidate(page, ignoredName), copy, true);
	await page.reload();
	await expect(accepted.getByText(copy.unavailable, { exact: true })).toBeVisible();
	await expect(accepted.getByRole("link")).toHaveCount(0);
}

async function archive(page: Page, copy: Copy) {
	await page.goto("/intake");
	await openBackupPage(page); await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: copy.backup, exact: true }).click();
	const link = page.getByRole("link", { name: copy.download, exact: true });
	await expect(link).toBeVisible();
	const downloading = page.waitForEvent("download");
	await link.click();
	const path = await (await downloading).path();
	if (!path) throw Error("receipt-backup-missing");
	const bytes = readFileSync(path);
	expect(bytes.subarray(0, 8).toString()).toBe("KEEPANY1");
	const entries = unzipSync(await decryptBackup(new Uint8Array(bytes), password));
	const records = JSON.parse(strFromU8(entries["records.json"])) as Array<{ type: string; payload: string }>;
	return {
		path,
		assets: records.filter((row) => row.type === "asset").map((row) => JSON.parse(row.payload) as Asset),
		candidates: JSON.parse(strFromU8(entries["intake-review.json"])) as ReviewedCandidate[],
	};
}

for (const locale of ["en-US", "zh-CN"]) {
	for (const width of [390, 1280]) {
		test(`${locale} intake asset receipts retain snapshots and safe detail links at ${width}px`, async ({ browser }) => {
			test.setTimeout(width === 390 ? 150_000 : 60_000);
			const zh = locale === "zh-CN", copy = copyFor(zh);
			const context = await browser.newContext({ locale, viewport: { width, height: 844 }, acceptDownloads: true });
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			try {
				await page.goto("/intake");
				await page.getByRole("button", { name: copy.spreadsheet, exact: true }).click();
				await page.locator("#csv-file").setInputFiles({ name: "asset-receipts.csv", mimeType: "text/csv", buffer: Buffer.from([
					"name,kind,url,description",
					`${acceptedName},project,${acceptedUrl},${acceptedDescription}`,
					`${ignoredName},project,${ignoredUrl},${ignoredDescription}`,
				].join("\n")) });
				const rows = page.locator(".intake-review-row");
				await expect(rows).toHaveCount(2);
				await selectChoice(rows.nth(0).getByRole("combobox"), "account");
				await rows.nth(0).getByRole("button", { name: copy.confirm, exact: true }).click();
				await selectChoice(rows.nth(1).getByRole("combobox"), "item");
				await rows.nth(1).getByRole("button", { name: copy.ignore, exact: true }).click();
				const accepted = candidate(page, acceptedName), ignored = candidate(page, ignoredName);
				await assertReceipt(accepted, copy, false);
				await assertReceipt(ignored, copy, true);
				const details = accepted.getByRole("link", { name: `${copy.view}: ${acceptedName}`, exact: true });
				const href = await details.getAttribute("href");
				if (!href) throw Error("receipt-detail-link-missing");
				expect(href).toMatch(/^\/assets\/account\/[^/]+$/);
				const assetId = href.split("/").at(-1);
				await details.click();
				await expect(page.getByRole("heading", { name: acceptedName, exact: true })).toBeVisible();
				await page.locator(".page-header .actions").getByRole("button", { name: copy.edit, exact: true }).click();
				const dialog = page.getByRole("dialog");
				await dialog.getByLabel(copy.name, { exact: true }).fill(currentName);
				await dialog.getByRole("button", { name: copy.save, exact: true }).click();
				await expect(dialog).toBeHidden();
				await expect(page.getByRole("heading", { name: currentName, exact: true })).toBeVisible();
				await page.goto("/intake");
				await assertReceipt(accepted, copy, false);
				await expect(accepted.getByRole("link", { name: `${copy.view}: ${currentName}`, exact: true })).toHaveAttribute("href", href);
				await expect(accepted.getByRole("link", { name: `${copy.view}: ${acceptedName}`, exact: true })).toHaveCount(0);
				await page.reload();
				await expect(accepted.getByRole("link", { name: `${copy.view}: ${currentName}`, exact: true })).toBeVisible();
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
				await page.locator(".intake-review-list").screenshot({ path: test.info().outputPath(`intake-asset-receipt-${locale}-${width}.png`) });
				// Chinese mobile restores a live renamed record; English mobile restores its deletion tombstone.
				const liveBackup = width === 390 && zh ? await archive(page, copy) : undefined;
				await accepted.getByRole("link", { name: `${copy.view}: ${currentName}`, exact: true }).click();
				await deleteAsset(page, copy);
				await assertUnavailable(page, copy);
				await page.locator(".intake-review-list").screenshot({ path: test.info().outputPath(`intake-asset-receipt-unavailable-${locale}-${width}.png`) });
				if (width === 390) {
					const saved = liveBackup ?? await archive(page, copy);
					const receipt = saved.candidates.find((row) => row.asset.name === acceptedName);
					const ignoredReceipt = saved.candidates.find((row) => row.asset.name === ignoredName);
					expect(receipt).toMatchObject({ status: "accepted", asset: { id: assetId, name: acceptedName, kind: "account", description: acceptedDescription } });
					expect(ignoredReceipt).toMatchObject({ status: "ignored", asset: { name: ignoredName, kind: "item", description: ignoredDescription } });
					expect(saved.assets).toHaveLength(1);
					expect(saved.assets[0]).toMatchObject({ id: assetId, name: currentName, deleted: !zh });
					const destination = await browser.newContext({ locale, viewport: { width, height: 844 }, acceptDownloads: true });
					try {
						const restored = await destination.newPage();
						restored.on("pageerror", (error) => errors.push(error.message));
						await restored.goto("/assets/account");
						await expect(restored.locator("main .asset-account-card")).toHaveCount(0);
						await restored.goto("/intake");
						await openBackupPage(restored); await restored.locator("#backup-password").fill(password);
						await restored.locator("#restore-file").setInputFiles(saved.path);
						await restored.getByRole("button", { name: copy.preview, exact: true }).first().click();
						await restored.getByRole("button", { name: copy.confirmRestore }).click();
						await expect(restored.getByText(copy.restored)).toBeVisible();
						await assertReceipt(candidate(restored, acceptedName), copy, false);
						await assertReceipt(candidate(restored, ignoredName), copy, true);
						if (zh) {
							const restoredLink = candidate(restored, acceptedName).getByRole("link", { name: `${copy.view}: ${currentName}`, exact: true });
							await expect(restoredLink).toHaveAttribute("href", href);
							await restoredLink.click();
							await expect(restored.getByRole("heading", { name: currentName, exact: true })).toBeVisible();
							await deleteAsset(restored, copy);
						}
						await assertUnavailable(restored, copy);
						await restored.locator(".intake-review-list").screenshot({ path: test.info().outputPath(`intake-asset-receipt-restored-${locale}-${width}.png`) });
					} finally { await destination.close(); }
				}
				expect(errors).toEqual([]);
			} finally { await context.close(); }
		});
	}
}
