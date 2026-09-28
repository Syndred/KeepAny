import { statSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.skip(process.env.KEEPANY_PRODUCTION_OFFLINE !== "1", "Run against the built PWA preview with KEEPANY_PRODUCTION_OFFLINE=1");

test("built PWA reopens offline, edits local data and downloads a backup", async ({ browser }) => {
	test.setTimeout(90_000);
	const context = await browser.newContext({ locale: "en-US", acceptDownloads: true });
	const page = await context.newPage();
	page.setDefaultTimeout(10_000);
	const errors: string[] = [];
	page.on("pageerror", error => errors.push(error.message));
	const name = `Offline project ${crypto.randomUUID().slice(0, 8)}`;
	try {
		await page.goto("/assets/project");
		await page.getByRole("button", { name: "Add", exact: true }).click();
		await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(name);
		await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
		await expect(page.getByText(name, { exact: true })).toBeVisible();
		await page.evaluate(async () => { await navigator.serviceWorker.ready; });
		await page.reload();
		await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
		await context.setOffline(true);
		await page.reload();
		await expect(page.getByText(name, { exact: true })).toBeVisible();
		await page.getByText(name, { exact: true }).click();
		await page.getByRole("button", { name: "Edit" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill(`${name} edited`);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(page.getByRole("heading", { name: `${name} edited` })).toBeVisible();
		await page.goto("/intake");
		await page.locator("#backup-password").fill("offline-local-only-password-2026");
		await page.getByRole("button", { name: "Create backup" }).click();
		const saveFile = page.getByRole("link", { name: "Save backup file" });
		await expect(saveFile).toBeVisible();
		const event = page.waitForEvent("download");
		await saveFile.click();
		const download = await event;
		expect(download.suggestedFilename()).toMatch(/\.ka1$/);
		const path = await download.path();
		if (!path) throw Error("offline download missing");
		expect(statSync(path).size).toBeGreaterThan(52);
		await page.reload();
		await page.goto("/assets/project");
		await expect(page.getByText(`${name} edited`, { exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	} finally { await context.close(); }
});
