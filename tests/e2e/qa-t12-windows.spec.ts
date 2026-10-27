import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { selectChoice } from "./helpers/select-choice";
import { sourceModuleUrl } from "./helpers/source-module-url";

const repositoryPath = sourceModuleUrl("packages/local-db/src/index.ts");
const domainPath = sourceModuleUrl("packages/domain/src/index.ts");
const evidence = "docs/qa/2026-10-27/evidence/T12-windows";
mkdirSync(evidence, { recursive: true });

async function state(page: Page, id: string) {
	return page.evaluate(async ({ repositoryPath, id }) => {
		const repository = await (await import(repositoryPath)).localRepository();
		return { asset: await repository.get("asset", id), history: (await repository.list("history")).filter((row: { assetId: string }) => row.assetId === id).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)), tasks: (await repository.list("task")).filter((row: { assetId: string }) => row.assetId === id) };
	}, { repositoryPath, id });
}

async function fixture(page: Page) {
	return page.evaluate(async ({ repositoryPath, domainPath }) => {
		const item = { ...(await import(domainPath)).newAsset("item"), name: "T12 concurrent camera", location: "Original location" };
		await (await import(repositoryPath)).save("asset", item);
		return item.id as string;
	}, { repositoryPath, domainPath });
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`T12-01..03 ${locale} ${width}px item facts, double-click borrowing and reminder deduplication`, async ({ browser }) => {
		test.setTimeout(120_000);
		const context = await browser.newContext({ locale, timezoneId: "Asia/Shanghai", viewport: { width, height: 950 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
		try {
			await page.addInitScript((language) => localStorage.setItem("keepany-language", language), locale);
			await page.clock.setFixedTime(new Date("2026-10-27T04:00:00Z"));
			await page.goto("/assets/item");
			await page.getByRole("button", { name: t("add"), exact: true }).click();
			const dialog = page.getByRole("dialog");
			await dialog.locator("#name").fill("T12 Camera");
			await dialog.getByLabel(t("itemPurchasePrice")).fill("123.45");
			await selectChoice(dialog.getByLabel(t("currency")), "USD");
			await dialog.getByLabel(t("purchaseDate")).fill("2026-08-14");
			await dialog.getByLabel(t("warrantyDate")).fill("2027-08-14");
			await dialog.getByLabel(t("location")).fill("Studio / shelf");
			await dialog.getByRole("button", { name: t("save"), exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			const card = page.locator(".asset-library-card").filter({ hasText: "T12 Camera" });
			await expect(card).toContainText("74");
			await card.click();
			const id = new URL(page.url()).pathname.split("/").at(-1) as string;
			expect((await state(page, id)).asset).toMatchObject({ amount: 12345, currency: "USD", itemPurchasePriceKnown: true, purchaseDate: "2026-08-14", warrantyDate: "2027-08-14", location: "Studio / shelf" });
			await page.locator('[data-item-media-role="coverId"]').getByRole("button", { name: t("addImage"), exact: true }).click();
			const pngBase64 = await page.evaluate(() => {
				const canvas = document.createElement("canvas"); canvas.width = canvas.height = 24;
				const drawing = canvas.getContext("2d"); if (!drawing) throw Error("canvas-unavailable");
				drawing.fillStyle = "#d88564"; drawing.fillRect(0, 0, 24, 24); return canvas.toDataURL("image/png").split(",")[1];
			});
			await page.locator(".asset-attachments-card input[type=file]").setInputFiles({ name: "T12-cover.png", mimeType: "image/png", buffer: Buffer.from(pngBase64, "base64") });
			await page.getByRole("dialog").getByRole("button", { name: t("confirm"), exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await page.reload();
			await expect(page.locator(".asset-item-photo-stage img")).toBeVisible();
			await expect(page.getByRole("button", { name: t("itemOpenMaintenancePlan"), exact: true })).toHaveCount(0);
			await expect(page.getByRole("link", { name: t("itemOpenMaintenancePlan"), exact: true })).toBeVisible();
			await page.getByRole("button", { name: t("loan"), exact: true }).click();
			await expect(page.getByRole("alert")).toHaveText(t("borrowerRequired"));
			expect((await state(page, id)).history).toHaveLength(0);
			await page.getByLabel(t("borrower"), { exact: true }).fill("T12 Borrower");
			await page.getByLabel(t("itemExpectedReturnDate")).fill("2026-11-01");
			const other = await context.newPage();
			await other.goto(page.url());
			await page.getByRole("button", { name: t("loan"), exact: true }).dblclick();
			await expect(page.getByRole("button", { name: t("return"), exact: true })).toBeVisible();
			await expect(other.getByRole("button", { name: t("return"), exact: true })).toBeVisible();
			const loaned = await state(page, id);
			expect(loaned.asset).toMatchObject({ status: "loaned", borrower: "T12 Borrower", itemExpectedReturnDate: "2026-11-01" });
			expect(loaned.history).toHaveLength(1);
			await page.getByRole("button", { name: t("return"), exact: true }).dblclick();
			await expect(page.getByRole("button", { name: t("loan"), exact: true })).toBeVisible();
			await other.close();
			await page.reload();
			const returned = await state(page, id);
			expect(returned.asset).toMatchObject({ status: "active", borrower: "", itemExpectedReturnDate: "" });
			expect(returned.history.map((row: { action: string }) => row.action).sort()).toEqual(["loan", "return"]);
			expect(returned.history.every((row: { borrower: string }) => row.borrower === "T12 Borrower")).toBe(true);
			for (let index = 0; index < 2; index++) {
				await page.getByLabel(t("maintenanceNotes")).fill(`T12 maintenance ${index}`);
				await page.getByLabel(t("maintenanceDate")).fill("2026-10-26");
				await page.getByLabel(t("maintenanceReminderDate")).fill("2026-11-20");
				await page.getByRole("button", { name: t("maintenance"), exact: true }).dblclick();
				await expect(page.getByLabel(t("maintenanceNotes"))).toHaveValue("");
				await expect(page.getByRole("button", { name: t("maintenance"), exact: true })).toBeEnabled();
			}
			const withReminder = await state(page, id);
			expect(withReminder.history.filter((row: { action: string }) => row.action === "maintenance")).toHaveLength(2);
			expect(withReminder.tasks).toHaveLength(1);
			expect(withReminder.tasks[0]).toMatchObject({ assetId: id, dueDate: "2026-11-20", done: false, dedupeKey: `item:${id}:maintenance:2026-11-20` });
			const reminder = page.locator(`[id="task-${withReminder.tasks[0].id}"]`);
			await reminder.getByRole("button", { name: t("complete"), exact: true }).dblclick();
			await expect(reminder.getByRole("button", { name: t("reopen"), exact: true })).toBeVisible();
			await reminder.getByRole("button", { name: t("reopen"), exact: true }).click();
			await reminder.getByRole("button", { name: t("complete"), exact: true }).click();
			await expect(reminder.getByRole("button", { name: t("reopen"), exact: true })).toBeVisible();
			await page.reload();
			const completed = await state(page, id);
			expect(completed.tasks).toHaveLength(1);
			expect(completed.tasks[0].completionHistory).toHaveLength(2);
			expect(completed.tasks[0].done).toBe(true);
			expect(completed.history).toHaveLength(4);
			expect(completed.asset.itemMedia.coverId).toBe(returned.asset.itemMedia.coverId);
			await expect(page.locator(".asset-item-photo-stage img")).toBeVisible();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			await page.screenshot({ path: join(evidence, `T12-${locale}-${width}.png`), fullPage: true });
			await test.info().attach("T12-state", { body: JSON.stringify(completed, null, 2), contentType: "application/json" });
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}

for (const [locale, width] of [["zh-CN", 390], ["en", 1280]] as const) {
	test(`T12-04 ${locale} ${width}px stale in-flight item action rejects another tab's location edit`, async ({ browser }) => {
		const context = await browser.newContext({ locale, viewport: { width, height: 950 } });
		const first = await context.newPage();
		const second = await context.newPage();
		const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
		try {
			await context.addInitScript((language) => localStorage.setItem("keepany-language", language), locale);
			await first.goto("/");
			const id = await fixture(first);
			await first.goto(`/assets/item/${id}`);
			await second.goto(first.url());
			await second.getByLabel(t("borrower"), { exact: true }).fill("T12 stale borrower");
			await second.evaluate(async (repositoryPath) => {
				const repository = await (await import(repositoryPath)).localRepository();
				const original = repository.recordItemAction.bind(repository);
				const gate = window as unknown as { t12Entered: boolean; t12Resume?: () => void };
				repository.recordItemAction = async (...args: unknown[]) => {
					gate.t12Entered = true;
					await new Promise<void>((resolve) => { gate.t12Resume = resolve; });
					repository.recordItemAction = original;
					return original(...args);
				};
			}, repositoryPath);
			await second.getByRole("button", { name: t("loan"), exact: true }).click();
			await expect.poll(() => second.evaluate(() => (window as unknown as { t12Entered: boolean }).t12Entered)).toBe(true);
			await first.getByRole("button", { name: t("itemEditLocation"), exact: true }).click();
			const dialog = first.getByRole("dialog");
			await dialog.getByLabel(t("itemLocationArea")).fill("Tab A wins");
			await dialog.getByLabel(t("itemLocationContainer")).fill("Shelf");
			await dialog.getByLabel(t("itemLocationSpot")).fill("New position");
			await dialog.getByRole("button", { name: t("itemSaveLocation"), exact: true }).click();
			await expect(dialog).toBeHidden();
			const won = await state(first, id);
			// The established persisted separator includes U+2063; display removes it.
			expect(won.asset.location).toBe("Tab A wins \u2063› Shelf \u2063› New position");
			await second.evaluate(() => (window as unknown as { t12Resume: () => void }).t12Resume());
			await expect(second.getByRole("alert")).toHaveText(t("itemStale"));
			const rejected = await state(first, id);
			expect(rejected.asset).toEqual(won.asset);
			expect(rejected.history).toEqual([]);
			await second.reload();
			await second.getByLabel(t("borrower"), { exact: true }).fill("T12 fresh borrower");
			await second.getByRole("button", { name: t("loan"), exact: true }).click();
			await expect(second.getByRole("button", { name: t("return"), exact: true })).toBeVisible();
			const retried = await state(second, id);
			expect(retried.asset).toMatchObject({ location: won.asset.location, status: "loaned", borrower: "T12 fresh borrower" });
			expect(retried.history).toHaveLength(1);
		} finally { await context.close(); }
	});
}
