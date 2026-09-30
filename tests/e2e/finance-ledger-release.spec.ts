import { readFileSync } from "node:fs";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import type { Asset, History, Relation } from "../../packages/domain/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { selectChoice } from "./helpers/select-choice";

test.use({ timezoneId: "Asia/Shanghai" });

const password = "finance-ledger-release-backup-2026";
const eventDate = "2026-09-30";

const copies = {
	"zh-CN": {
		add: "新增",
		name: "名称",
		provider: "服务商",
		save: "保存",
		paymentMethod: "付款方式",
		account: "登录账号",
		amount: "金额",
		currency: "币种",
		dueDate: "下次日期",
		financeTitle: "订阅与账单",
		addRecord: "记一笔",
		recordDialog: "记一笔",
		recordType: "记录类型",
		relatedAsset: "关联订阅或账号",
		title: "名称",
		date: "日期",
		source: "付款来源（选填）",
		note: "备注",
		saveRecord: "保存记录",
		invalidAmount: "请输入有效金额。",
		filterType: "类型",
		filterAsset: "关联资产",
		filterSource: "付款来源或方式",
		noSource: "未填写来源",
		monthlyPlan: "每月计划费用",
		confirmedSpent: "本月已记录支出",
		balances: "余额观察",
		backup: "创建备份",
		download: "保存备份文件",
		preview: "预览",
		confirm: /^确认 ·/,
		restored: /已恢复 \d+ 条记录/,
	},
	"en-US": {
		add: "Add",
		name: "Name",
		provider: "Provider",
		save: "Save",
		paymentMethod: "Payment method",
		account: "Sign-in account",
		amount: "Amount",
		currency: "Currency",
		dueDate: "Next date",
		financeTitle: "Subscriptions and bills",
		addRecord: "Record transaction",
		recordDialog: "Record transaction",
		recordType: "Record type",
		relatedAsset: "Subscription or account",
		title: "Title",
		date: "Date",
		source: "Payment source (optional)",
		note: "Note",
		saveRecord: "Save record",
		invalidAmount: "Enter a valid amount.",
		filterType: "Type",
		filterAsset: "Related asset",
		filterSource: "Payment source or method",
		noSource: "No source recorded",
		monthlyPlan: "Monthly planned cost",
		confirmedSpent: "Spending recorded this month",
		balances: "Observed balances",
		backup: "Create backup",
		download: "Save backup file",
		preview: "Preview",
		confirm: /^Confirm ·/,
		restored: /Restored \d+ records/,
	},
} as const;

type Locale = keyof typeof copies;
type Copy = (typeof copies)[Locale];
type Action = "expense" | "topup" | "refund" | "balance";
type LedgerSpec = {
	action: Action;
	targetId: string;
	title: string;
	amount: string;
	amountMinor: number;
	currency: "CNY" | "JPY";
	source: string;
	note: string;
	invalidAmount?: string;
};
type ArchiveRow = { type: string; payload: string };
type ArchiveData = {
	assets: Asset[];
	history: History[];
	relations: Relation[];
};

function byId<T extends { id: string }>(values: T[]) {
	return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

async function readArchive(path: string): Promise<ArchiveData> {
	const encrypted = new Uint8Array(readFileSync(path));
	expect(Buffer.from(encrypted.subarray(0, 8)).toString("utf8")).toBe(
		"KEEPANY1",
	);
	const files = unzipSync(await decryptBackup(encrypted, password));
	const recordsFile = files["records.json"];
	if (!recordsFile) throw new Error("records-json-missing");
	const rows = JSON.parse(strFromU8(recordsFile)) as ArchiveRow[];
	return {
		assets: rows
			.filter((row) => row.type === "asset")
			.map((row) => JSON.parse(row.payload) as Asset),
		history: rows
			.filter((row) => row.type === "history")
			.map((row) => JSON.parse(row.payload) as History),
		relations: rows
			.filter((row) => row.type === "relation")
			.map((row) => JSON.parse(row.payload) as Relation),
	};
}

async function assetIdFromList(page: Page, name: string) {
	const link = page
		.locator("main .asset-list-content a")
		.filter({ hasText: name });
	await expect(link).toHaveCount(1);
	const href = await link.first().getAttribute("href");
	const id = href?.split("/").at(-1) ?? "";
	if (!id) throw new Error(`asset-id-missing:${name}`);
	return id;
}

async function createAccount(page: Page, copy: Copy, name: string) {
	await page.goto("/assets/account");
	await page.getByRole("button", { name: copy.add, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(copy.name, { exact: true }).fill(name);
	await dialog
		.getByLabel(copy.provider, { exact: true })
		.fill("Synthetic bank");
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
	return assetIdFromList(page, name);
}

async function createSubscription(
	page: Page,
	copy: Copy,
	name: string,
	accountId: string,
) {
	await page.goto("/assets/subscription");
	await page.getByRole("button", { name: copy.add, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(copy.name, { exact: true }).fill(name);
	await selectChoice(dialog.getByLabel(copy.account, { exact: true }), {
		value: accountId,
	});
	await dialog
		.getByLabel(copy.paymentMethod, { exact: true })
		.fill("Bank card");
	await dialog.locator("#amount").fill("1200");
	await selectChoice(dialog.getByLabel(copy.currency, { exact: true }), "JPY");
	await dialog.locator("#dueDate").fill("2026-10-31");
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
	return assetIdFromList(page, name);
}

async function recordTransaction(page: Page, copy: Copy, input: LedgerSpec) {
	await page.getByRole("button", { name: copy.addRecord, exact: true }).click();
	const dialog = page.getByRole("dialog", { name: copy.recordDialog });
	await selectChoice(
		dialog.getByLabel(copy.recordType, { exact: true }),
		input.action,
	);
	await selectChoice(dialog.getByLabel(copy.relatedAsset, { exact: true }), {
		value: input.targetId,
	});
	await dialog.getByLabel(copy.title, { exact: true }).fill(input.title);
	await dialog
		.getByLabel(copy.amount, { exact: true })
		.fill(input.invalidAmount ?? input.amount);
	await selectChoice(
		dialog.getByLabel(copy.currency, { exact: true }),
		input.currency,
	);
	await dialog.getByLabel(copy.date, { exact: true }).fill(eventDate);
	await dialog.getByLabel(copy.source, { exact: true }).fill(input.source);
	await dialog.getByLabel(copy.note, { exact: true }).fill(input.note);
	if (input.invalidAmount) {
		await dialog
			.getByRole("button", { name: copy.saveRecord, exact: true })
			.click();
		await expect(dialog.getByRole("alert")).toHaveText(copy.invalidAmount);
		await dialog.getByLabel(copy.amount, { exact: true }).fill(input.amount);
	}
	await dialog
		.getByRole("button", { name: copy.saveRecord, exact: true })
		.click();
	await expect(dialog).toBeHidden();
}

async function filterAndClear(
	page: Page,
	copy: Copy,
	ids: { accountId: string; subscriptionId: string },
) {
	const type = page.getByRole("combobox", {
		name: copy.filterType,
		exact: true,
	});
	const asset = page.getByRole("combobox", {
		name: copy.filterAsset,
		exact: true,
	});
	const source = page.getByRole("combobox", {
		name: copy.filterSource,
		exact: true,
	});
	const rows = page.locator(".finance-entry");

	await selectChoice(type, "expense");
	await selectChoice(asset, ids.subscriptionId);
	await selectChoice(source, "source:JPY statement");
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText("JPY expense");

	await selectChoice(type, "all");
	await selectChoice(asset, "");
	await selectChoice(source, "all");
	await expect(rows).toHaveCount(4);

	await selectChoice(asset, ids.accountId);
	await expect(rows).toHaveCount(3);
	await selectChoice(source, "empty");
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText(copy.noSource);

	await selectChoice(asset, "");
	await selectChoice(source, "all");
	await expect(rows).toHaveCount(4);
}

async function assertSummaryAndLinks(
	page: Page,
	copy: Copy,
	accountName: string,
	subscriptionName: string,
) {
	await expect(
		page.getByRole("heading", { name: copy.financeTitle }),
	).toBeVisible();
	const summary = page.locator(".finance-summary");
	await expect(summary.locator(".card").nth(0)).toContainText(copy.monthlyPlan);
	await expect(summary.locator(".card").nth(0)).toContainText("1,200");
	await expect(summary.locator(".card").nth(1)).toContainText(
		copy.confirmedSpent,
	);
	await expect(summary.locator(".card").nth(1)).toContainText("1,234");
	await expect(summary.locator(".card").nth(2)).toContainText(copy.balances);
	await expect(summary.locator(".card").nth(2)).toContainText("0.00");
	const linked = page
		.locator(".finance-linked-row")
		.filter({ hasText: subscriptionName });
	await expect(linked).toHaveCount(1);
	await expect(linked).toContainText(accountName);
}

async function downloadArchive(page: Page, copy: Copy) {
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: copy.backup, exact: true }).click();
	const link = page.getByRole("link", { name: copy.download, exact: true });
	await expect(link).toBeVisible();
	const download = page.waitForEvent("download");
	await link.click();
	const result = await download;
	const path = await result.path();
	if (!path) throw new Error("finance-backup-download-missing");
	expect(result.suggestedFilename()).toMatch(/\.ka1$/);
	return { path, data: await readArchive(path) };
}

async function restoreArchive(page: Page, copy: Copy, path: string) {
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.locator("#restore-file").setInputFiles(path);
	await page
		.getByRole("button", { name: copy.preview, exact: true })
		.first()
		.click();
	await page.getByRole("button", { name: copy.confirm }).click();
	await expect(page.getByText(copy.restored)).toBeVisible();
}

for (const variant of [
	{ locale: "zh-CN", width: 390 },
	{ locale: "en-US", width: 1280 },
] as const) {
	test(`${variant.locale} ${variant.width} finance ledger survives UI backup and clean restore`, async ({
		browser,
	}) => {
		test.setTimeout(150_000);
		const copy = copies[variant.locale];
		let source: BrowserContext | undefined;
		let destination: BrowserContext | undefined;
		const errors: string[] = [];
		try {
			source = await browser.newContext({
				locale: variant.locale,
				viewport: { width: variant.width, height: 844 },
				acceptDownloads: true,
			});
			const sourcePage = await source.newPage();
			sourcePage.setDefaultTimeout(15_000);
			await sourcePage.clock.setFixedTime(new Date("2026-09-30T04:00:00Z"));
			sourcePage.on("pageerror", (error) =>
				errors.push(`source:${error.message}`),
			);

			const suffix = crypto.randomUUID().slice(0, 8);
			const accountName = `Ledger account ${suffix}`;
			const subscriptionName = `JPY subscription ${suffix}`;
			const accountId = await createAccount(sourcePage, copy, accountName);
			const subscriptionId = await createSubscription(
				sourcePage,
				copy,
				subscriptionName,
				accountId,
			);

			await sourcePage.goto("/finance");
			await expect(
				sourcePage.getByRole("heading", { name: copy.financeTitle }),
			).toBeVisible();
			const entries: LedgerSpec[] = [
				{
					action: "expense",
					targetId: subscriptionId,
					title: "JPY expense",
					amount: "1234",
					amountMinor: 1234,
					currency: "JPY",
					source: "JPY statement",
					note: "Checked JPY statement",
					invalidAmount: "12.5",
				},
				{
					action: "topup",
					targetId: accountId,
					title: "CNY top-up",
					amount: "50.00",
					amountMinor: 5000,
					currency: "CNY",
					source: "Bank transfer",
					note: "Added working funds",
				},
				{
					action: "refund",
					targetId: accountId,
					title: "CNY refund",
					amount: "5.00",
					amountMinor: 500,
					currency: "CNY",
					source: "",
					note: "Refund without source",
				},
				{
					action: "balance",
					targetId: accountId,
					title: "Observed zero balance",
					amount: "0",
					amountMinor: 0,
					currency: "CNY",
					source: "Bank app",
					note: "Zero balance observation",
				},
			];
			for (const entry of entries)
				await recordTransaction(sourcePage, copy, entry);

			await assertSummaryAndLinks(
				sourcePage,
				copy,
				accountName,
				subscriptionName,
			);
			await filterAndClear(sourcePage, copy, { accountId, subscriptionId });
			await sourcePage.reload();
			await expect(sourcePage.locator(".finance-entry")).toHaveCount(4);
			await assertSummaryAndLinks(
				sourcePage,
				copy,
				accountName,
				subscriptionName,
			);
			await sourcePage.screenshot({
				path: test
					.info()
					.outputPath(
						`finance-ledger-source-${variant.locale}-${variant.width}.png`,
					),
				fullPage: true,
			});

			const sourceArchive = await downloadArchive(sourcePage, copy);
			expect(sourceArchive.data.assets).toHaveLength(2);
			expect(sourceArchive.data.history).toHaveLength(4);
			expect(sourceArchive.data.relations).toHaveLength(1);
			expect(sourceArchive.data.relations).toEqual([
				expect.objectContaining({ from: subscriptionId, to: accountId }),
			]);
			for (const entry of entries) {
				expect(sourceArchive.data.history).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							action: entry.action,
							assetId: entry.targetId,
							title: entry.title,
							amount: entry.amountMinor,
							currency: entry.currency,
							eventDate,
							source: entry.source,
							note: entry.note,
						}),
					]),
				);
			}

			destination = await browser.newContext({
				locale: variant.locale,
				viewport: { width: variant.width, height: 844 },
				acceptDownloads: true,
			});
			const restored = await destination.newPage();
			restored.setDefaultTimeout(15_000);
			await restored.clock.setFixedTime(new Date("2026-09-30T04:00:00Z"));
			restored.on("pageerror", (error) =>
				errors.push(`restored:${error.message}`),
			);
			await restoreArchive(restored, copy, sourceArchive.path);
			await restored.reload();
			await restored.goto("/finance");
			await expect(restored.locator(".finance-entry")).toHaveCount(4);
			await assertSummaryAndLinks(
				restored,
				copy,
				accountName,
				subscriptionName,
			);
			await filterAndClear(restored, copy, { accountId, subscriptionId });
			await restored.screenshot({
				path: test
					.info()
					.outputPath(
						`finance-ledger-restored-${variant.locale}-${variant.width}.png`,
					),
				fullPage: true,
			});

			const restoredArchive = await downloadArchive(restored, copy);
			expect(byId(restoredArchive.data.assets)).toEqual(
				byId(sourceArchive.data.assets),
			);
			expect(byId(restoredArchive.data.history)).toEqual(
				byId(sourceArchive.data.history),
			);
			expect(byId(restoredArchive.data.relations)).toEqual(
				byId(sourceArchive.data.relations),
			);
			expect(errors).toEqual([]);
		} finally {
			if (destination) await destination.close().catch(() => undefined);
			if (source) await source.close().catch(() => undefined);
		}
	});
}
