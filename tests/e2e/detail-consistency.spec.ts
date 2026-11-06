import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	assetSchema,
	newAsset,
	taskSchema,
	calendarDayDistance,
	type Asset,
} from "../../packages/domain/src";
import { resources } from "../../apps/web/src/i18n";
import {
	prepareCompletionArchive,
	restoreCompletionArchive,
} from "./helpers/completion-archive";
import { acceptanceCandidate } from "./helpers/acceptance-candidate";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { unzipSync, strFromU8 } from "fflate";

type Locale = "zh-CN" | "en";
const password = "DC-fictional-backup-only-2026";
const stamp = "2026-11-06T00:00:00.000Z";
let archive: string;
const tFor = (locale: Locale) => (key: string) =>
	(resources[locale].translation as Record<string, string>)[key];
const identity = () =>
	acceptanceCandidate().release.webFiles.find((f) => f.path === "index.html")!
		.sha256;
test.beforeAll(async ({}, info) => {
	const directory = resolve(
		process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/detail-consistency",
		`fixture-${info.workerIndex}`,
	);
	await prepareCompletionArchive(directory, password, async (db) => {
		const category = await db.saveCatalogCategory(null, {
			name: "DC Documents / 证件",
		});
		const bytes = readFileSync("apps/web/public/samples/laptop.png");
		const images: string[] = [];
		for (const name of ["cover", "detail", "receipt", "other"])
			images.push(
				await db.putFile(
					new File([bytes], `dc-${name}.png`, { type: "image/png" }),
				),
			);
		const base = (kind: Asset["kind"], id: string, name: string) => ({
			...newAsset(kind),
			id,
			name,
			createdAt: stamp,
			updatedAt: stamp,
		});
		const generic = assetSchema.parse({
			...base("project", "dc-generic", "DC generic / 通用资料"),
			catalogCategoryId: category.id,
			usageStartDate: "2026-03-05",
			dueDate: "2027-03-18",
			url: "https://dc.example.test",
			tags: ["DC", "fictional"],
			description: "DC description / 完整描述",
			attachments: images,
			projectMedia: {
				logoId: images[0],
				homeScreenshotId: images[1],
				productScreenshotIds: [images[2]],
				promoCoverId: "",
			},
			projectDomains: [
				{
					id: "00000000-0000-4000-8000-000000000011",
					name: "child.example.test",
					expiryDate: "2027-03-18",
					catalog: {
						categoryId: category.id,
						name: "DC domain / 域名",
						url: "https://child.example.test",
						tags: [],
						status: "active",
						notes: "",
						attachments: [],
						deleted: false,
						usageStartDate: "2026-08-01",
					},
				},
			],
		});
		const item = assetSchema.parse({
			...base("item", "dc-item", "DC item / 实物"),
			category: "electronics",
			itemStartDate: "2026-03-05",
			warrantyDate: "2027-03-18",
			itemWarrantyStatus: "inWarranty",
			itemPurchasePriceKnown: true,
			amount: 699900,
			location: "DC office",
			attachments: images,
			itemMedia: {
				coverId: images[0],
				detailIds: [images[1]],
				receiptIds: [images[2]],
			},
		});
		const subscription = assetSchema.parse({
			...base("subscription", "dc-subscription", "DC subscription / 订阅"),
			category: "cloud",
			subscriptionStartDate: "2026-03-05",
			dueDate: "2027-03-18",
			amount: 6800,
		});
		const wallet = assetSchema.parse({
			...base("project", "dc-wallet", "DC wallet / 卡包"),
			currency: "USD",
			walletCard: {
				type: "countPass",
				issuer: "DC issuer",
				lastFour: "2086",
				balanceMinor: 0,
				remainingUses: 0,
			},
			dueDate: "2027-03-18",
		});
		const onlyStart = assetSchema.parse({
			...base("project", "dc-only-start", "DC only start / 仅开始日期"),
			usageStartDate: "2026-03-05",
		});
		const unknown = assetSchema.parse({
			...base("project", "dc-unknown", "DC unknown / 未填日期"),
			createdAt: "2020-01-01T00:00:00Z",
		});
		for (const asset of [
			generic,
			item,
			subscription,
			wallet,
			onlyStart,
			unknown,
		])
			await db.save("asset", asset);
		for (const asset of [generic, item, subscription, wallet])
			await db.save(
				"task",
				taskSchema.parse({
					id: `${asset.id}-task`,
					assetId: asset.id,
					name: "DC task / 核对资料",
					dueDate: "2026-11-20",
					createdAt: stamp,
				}),
			);
		return { records: 6, tasks: 4, images: 4 };
	});
	archive = resolve(directory, "fixture.ka1");
});
async function start(page: Page, locale: Locale) {
	await page.addInitScript(
		(language) => localStorage.setItem("keepany-language", language),
		locale,
	);
	expect(
		createHash("sha256")
			.update(await (await page.request.get("/")).body())
			.digest("hex"),
	).toBe(identity());
	await page.goto("/assets");
	await restoreCompletionArchive(page, password, archive);
}
async function assets(page: Page) {
	if (await page.locator(".mobile-nav").isVisible())
		await page.locator('.mobile-nav a[href="/assets"]').click();
	else await page.locator('.sidebar nav a[href="/assets"]').click();
	await expect(page.locator(".workspace-navigation")).toBeVisible();
}
async function enter(page: Page, name: string) {
	await assets(page);
	await page.locator(".asset-summary-card").filter({ hasText: name }).click();
	await expect(page.locator(".unified-detail-main")).toBeVisible();
}
async function shot(
	page: Page,
	info: TestInfo,
	name: string,
	selector?: string,
) {
	await page.evaluate(() => document.fonts.ready);
	await expect
		.poll(() =>
			page
				.locator(".unified-detail-main,.dialog")
				.evaluateAll(
					(els) =>
						els
							.flatMap((el) => el.getAnimations({ subtree: true }))
							.filter(
								(a) =>
									a.playState === "running" &&
									a.effect?.getTiming().iterations !== Infinity,
							).length,
				),
		)
		.toBe(0);
	const path = info.outputPath(`${name}.png`);
	if (selector)
		await page.locator(selector).screenshot({ path, animations: "disabled" });
	else await page.screenshot({ path, fullPage: false, animations: "disabled" });
	await info.attach(`${name}.png`, { path, contentType: "image/png" });
}
async function receipt(info: TestInfo, locale: Locale, ids: string[]) {
	await info.attach("contract-results.json", {
		body: JSON.stringify({
			locale,
			ids,
			candidate: identity(),
			result: "passed",
		}),
		contentType: "application/json",
	});
}
async function exportRows(page: Page, locale: Locale) {
	const t = tFor(locale);
	await page.goto("/backup");
	const card = page.locator(".intake-backup-card");
	await card.locator("#backup-password").fill(password);
	await card.getByRole("button", { name: t("backup"), exact: true }).click();
	const event = page.waitForEvent("download");
	await card
		.getByRole("link", { name: t("saveBackupFile"), exact: true })
		.click();
	const file = await (await event).path();
	if (!file) throw Error("No backup file");
	const zip = unzipSync(await decryptBackup(readFileSync(file), password));
	return JSON.parse(strFromU8(zip["records.json"])) as {
		type: string;
		payload: string;
	}[];
}
for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} DC01 DC02 DC07 create generic category and persist explicit dates`, async ({
		page,
	}, info) => {
		const t = tFor(locale);
		await start(page, locale);
		await assets(page);
		await page
			.locator(".workspace-navigation")
			.getByRole("button", { name: t("catalogNew"), exact: true })
			.click();
		let dialog = page.getByRole("dialog");
		await dialog
			.getByLabel(t("catalogName"), { exact: true })
			.fill("DC new category / 新分类");
		await dialog
			.getByRole("button", { name: t("catalogNew"), exact: true })
			.click();
		await expect(dialog).toBeHidden();
		const categoryURL = page.url();
		await page
			.getByRole("button", { name: t("workspaceAddAsset"), exact: true })
			.click();
		dialog = page.getByRole("dialog");
		await expect(dialog.locator("#catalog-record-category")).toContainText(
			"DC new category / 新分类",
		);
		await dialog.getByRole("button", { name: t("save"), exact: true }).click();
		await expect(dialog.locator("#catalog-record-name")).toHaveAttribute(
			"aria-invalid",
			"true",
		);
		await shot(page, info, `${locale}-generic-required-error`);
		await dialog.locator("#catalog-record-name").fill("DC created / 新建资料");
		await dialog.locator("#catalog-record-start").fill("2026-03-05");
		await dialog.locator("#catalog-record-date").fill("2027-03-18");
		await shot(page, info, `${locale}-generic-create`);
		await dialog.getByRole("button", { name: t("save"), exact: true }).click();
		await expect(dialog).toBeHidden();
		await page
			.locator(".asset-summary-card")
			.filter({ hasText: "DC created /" })
			.click();
		await expect(page.locator('[data-metric="elapsed"] strong')).toBeVisible();
		await expect(page.locator('[data-metric="elapsed"]')).toContainText("2026");
		const back = page.locator(".topbar-back-link");
		await back.hover();
		await expect(back).toHaveCSS("border-top-style", "solid");
		await shot(page, info, `${locale}-back-hover`);
		await back.focus();
		await page.keyboard.press("Tab");
		await page.keyboard.press("Shift+Tab");
		await expect(back).toBeFocused();
		await shot(page, info, `${locale}-back-keyboard`);
		await page
			.locator(".unified-detail-header")
			.getByRole("button", { name: t("edit"), exact: true })
			.click();
		dialog = page.getByRole("dialog");
		await dialog.locator("#catalog-record-start").fill("2020-01-01");
		await dialog
			.getByRole("button", { name: t("cancel"), exact: true })
			.click();
		await expect(page.locator('[data-metric="elapsed"]')).not.toContainText(
			"2020",
		);
		await page.reload();
		await expect(page.locator('[data-metric="elapsed"]')).toContainText("2026");
		await back.click();
		await expect(page).toHaveURL(categoryURL);
		await page
			.getByRole("button", { name: t("workspaceAddAsset"), exact: true })
			.click();
		dialog = page.getByRole("dialog");
		await expect(dialog.locator("#catalog-record-start")).toHaveValue("");
		await dialog
			.getByRole("button", { name: t("cancel"), exact: true })
			.click();
		await page
			.getByRole("button", { name: t("globalAddRecord"), exact: true })
			.click();
		await page
			.getByRole("menuitem", { name: t("catalogRecords"), exact: true })
			.click();
		dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		if (await dialog.locator("#workspace-create-kind").count())
			await dialog
				.getByRole("button", { name: t("workspaceContinue"), exact: true })
				.click();
		await expect(
			page.getByRole("dialog").locator("#catalog-record-start"),
		).toBeVisible();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: t("cancel"), exact: true })
			.click();
		const rows = await exportRows(page, locale);
		const created = rows
			.filter((r) => r.type === "asset")
			.map((r) => JSON.parse(r.payload))
			.find((a) => a.name === "DC created / 新建资料");
		expect(created).toMatchObject({
			usageStartDate: "2026-03-05",
			dueDate: "2027-03-18",
		});
		await receipt(info, locale, ["DC01", "DC02", "DC07"]);
	});
	test(`${locale} DC03 big metrics and retained fields across six widths`, async ({
		page,
	}, info) => {
		await start(page, locale);
		for (const width of [390, 768, 1280, 1920, 1991, 2262]) {
			await page.setViewportSize({ width, height: 1000 });
			for (const kind of [
				"generic",
				"item",
				"subscription",
				"wallet",
				"domain",
			]) {
				await enter(page, `DC ${kind} /`);
				const main = page.locator(".unified-detail-main");
				await expect(main.locator("h1")).toBeVisible();
				const sizes = await main
					.locator(".unified-detail-metric strong")
					.evaluateAll((els) =>
						els.map((e) => parseFloat(getComputedStyle(e).fontSize)),
					);
				expect(sizes.length).toBeGreaterThan(0);
				expect(Math.min(...sizes)).toBeGreaterThanOrEqual(40);
				if (kind !== "wallet") {
					await expect(
						main.locator('[data-metric="elapsed"] strong'),
					).toBeVisible();
					const today = await page.evaluate(() => {
						const d = new Date();
						return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
					});
					await expect(
						main.locator('[data-metric="elapsed"] strong'),
					).toHaveText(
						String(
							calendarDayDistance(
								kind === "domain" ? "2026-08-01" : "2026-03-05",
								today,
							),
						),
					);
				} else
					await expect(
						main.locator('[data-metric="wallet-primary"] strong'),
					).toHaveText("0");
				await expect(
					main.locator('[data-metric="remaining"] strong'),
				).toBeVisible();
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width + 1);
				await shot(
					page,
					info,
					`${locale}-${width}-${kind}-main`,
					".unified-detail-main",
				);
			}
		}
		await enter(page, "DC only start /");
		await expect(page.locator('[data-metric="remaining"]')).toHaveCount(0);
		await expect(page.locator('[data-metric="elapsed"] strong')).toBeVisible();
		await shot(page, info, `${locale}-only-start`, ".unified-detail-main");
		await enter(page, "DC unknown /");
		await expect(page.locator(".unified-detail-metric strong")).toHaveCount(0);
		await shot(page, info, `${locale}-no-dates`, ".unified-detail-main");
		await enter(page, "DC domain /");
		await expect(page.locator('[data-metric="elapsed"]')).toContainText("2026");
		await receipt(info, locale, ["DC03"]);
	});
	test(`${locale} DC04 image roles remain stored with uniform gallery operations`, async ({
		page,
		context,
	}, info) => {
		const t = tFor(locale);
		await start(page, locale);
		await enter(page, "DC item /");
		const photos = page.locator(".unified-detail-photo");
		await expect(photos).toHaveCount(4);
		await expect(
			page.getByRole("combobox", {
				name: t("itemPhotosAndEvidence"),
				exact: true,
			}),
		).toHaveCount(0);
		const rolesBefore = (await exportRows(page, locale))
			.filter((r) => r.type === "asset")
			.map((r) => JSON.parse(r.payload))
			.find((a) => a.id === "dc-item");
		await enter(page, "DC item /");
		const popup = context.waitForEvent("page");
		await photos.first().getByRole("link").click();
		const original = await popup;
		await expect(original.locator("img")).toBeVisible();
		await original.close();
		await page
			.getByRole("button", { name: t("addPhoto"), exact: true })
			.click();
		await page
			.locator(
				'input[type="file"][accept="image/png,image/jpeg,image/webp,image/gif"]',
			)
			.setInputFiles("apps/web/public/samples/laptop.png");
		let dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible();
		await shot(page, info, `${locale}-image-preview`);
		await dialog
			.getByRole("button", { name: t("cancel"), exact: true })
			.click();
		await expect(photos).toHaveCount(4);
		await page
			.getByRole("button", { name: t("addPhoto"), exact: true })
			.click();
		await page
			.locator(
				'input[type="file"][accept="image/png,image/jpeg,image/webp,image/gif"]',
			)
			.setInputFiles("apps/web/public/samples/laptop.png");
		dialog = page.getByRole("dialog");
		await dialog
			.getByRole("button", { name: t("confirm"), exact: true })
			.click();
		await expect(dialog).toBeHidden();
		await expect(photos).toHaveCount(5);
		await photos.first().getByRole("button").click();
		await page
			.getByRole("menuitem", { name: t("replaceImage"), exact: true })
			.click();
		await page
			.locator(
				'input[type="file"][accept="image/png,image/jpeg,image/webp,image/gif"]',
			)
			.setInputFiles("apps/web/public/samples/laptop.png");
		dialog = page.getByRole("dialog");
		await dialog
			.getByRole("button", { name: t("confirm"), exact: true })
			.click();
		await expect(dialog).toBeHidden();
		await expect(photos).toHaveCount(5);
		await page.reload();
		await expect(photos).toHaveCount(5);
		await shot(
			page,
			info,
			`${locale}-uniform-gallery`,
			".unified-detail-description",
		);
		const rolesAfter = (await exportRows(page, locale))
			.filter((r) => r.type === "asset")
			.map((r) => JSON.parse(r.payload))
			.find((a) => a.id === "dc-item");
		expect(rolesAfter.itemMedia.detailIds).toEqual(
			rolesBefore.itemMedia.detailIds,
		);
		expect(rolesAfter.itemMedia.receiptIds).toEqual(
			rolesBefore.itemMedia.receiptIds,
		);
		expect(rolesAfter.itemMedia.coverId).not.toBe(
			rolesBefore.itemMedia.coverId,
		);
		expect(rolesAfter.attachments).toContain(rolesAfter.itemMedia.coverId);
		expect(rolesAfter.attachments).toHaveLength(5);
		await receipt(info, locale, ["DC04"]);
	});
}
