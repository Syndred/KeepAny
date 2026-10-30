import { openBackupPage } from "./helpers/backup-restore";
import { statSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.skip(process.env.KEEPANY_PRODUCTION_OFFLINE !== "1", "Run against the built PWA preview with KEEPANY_PRODUCTION_OFFLINE=1");

test("delivered installation manifest and icons remain available offline", async ({ browser }) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	try {
		await page.goto("/");
		await page.evaluate(async () => { await navigator.serviceWorker.ready; });
		await page.reload();
		await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
		await context.setOffline(true);
		await page.reload();
		const installation = await page.evaluate(async () => {
			const manifestUrl = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
			if (!manifestUrl) throw Error("manifest-missing");
			const manifest = await (await fetch(manifestUrl)).json();
			const icons = await Promise.all(manifest.icons.map(async (icon: { src: string; sizes: string; purpose: string }) => {
				const image = new Image();
				image.src = new URL(icon.src, manifestUrl).href;
				await image.decode();
				return { sizes: icon.sizes, purpose: icon.purpose, width: image.naturalWidth, height: image.naturalHeight };
			}));
			const touch = new Image();
			touch.src = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href ?? "";
			await touch.decode();
			return { id: manifest.id, start: manifest.start_url, scope: manifest.scope, display: manifest.display,
				icons, touch: [touch.naturalWidth, touch.naturalHeight] };
		});
		expect(installation).toMatchObject({ id: "/", start: "/", scope: "/", display: "standalone", touch: [180, 180] });
		expect(installation.icons).toEqual(expect.arrayContaining([
			{ sizes: "192x192", purpose: "any", width: 192, height: 192 },
			{ sizes: "512x512", purpose: "any", width: 512, height: 512 },
			{ sizes: "512x512", purpose: "maskable", width: 512, height: 512 },
		]));
	} finally { await context.close(); }
});

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
		await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
		await page.evaluate(async () => { await navigator.serviceWorker.ready; });
		await page.reload();
		await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
		await context.setOffline(true);
		await page.reload();
		await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
		await page.getByText(name, { exact: true }).first().click();
		await page.getByRole("button", { name: "Edit" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill(`${name} edited`);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(page.getByRole("heading", { name: `${name} edited` })).toBeVisible();
		await page.goto("/intake");
		await openBackupPage(page); await page.locator("#backup-password").fill("offline-local-only-password-2026");
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
		await expect(page.getByText(`${name} edited`, { exact: true }).first()).toBeVisible();
		expect(errors).toEqual([]);
	} finally { await context.close(); }
});
