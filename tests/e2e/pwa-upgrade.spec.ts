import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";

test.skip(process.env.KEEPANY_PWA_UPGRADE !== "1", "Run the fixed 8f9a1b5 package against the newly built PWA with KEEPANY_PWA_UPGRADE=1");

test("old controlled tab upgrades on the same origin without losing its project, image or draft", async ({ browser }) => {
	test.setTimeout(120_000);
	const root = process.cwd();
	const directory = mkdtempSync(join(tmpdir(), "keepany-pwa-upgrade-"));
	const tar = execFileSync("git", ["archive", "8f9a1b5", "release/web"], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
	const extracted = spawnSync("tar", ["-x", "-C", directory, "--strip-components=2"], { input: tar });
	if (extracted.status !== 0) throw Error(extracted.stderr.toString());
	const contentTypes: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };
	const server = createServer((request, response) => {
		const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
		const candidate = resolve(directory, `.${pathname}`);
		const file = candidate.startsWith(`${directory}${sep}`) && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(directory, "index.html");
		response.setHeader("Content-Type", contentTypes[extname(file)] ?? "application/octet-stream");
		response.setHeader("Cache-Control", "no-cache");
		response.end(readFileSync(file));
	});
	await new Promise<void>((resolveReady) => server.listen(0, "127.0.0.1", resolveReady));
	const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 800 } });
	const page = await context.newPage();
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
	const project = `Upgrade project ${crypto.randomUUID().slice(0, 8)}`;
	try {
		await page.goto(`${address}/assets/project`);
		await page.getByRole("button", { name: "Add", exact: true }).click();
		await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill(project);
		await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
		await page.getByText(project, { exact: true }).click();
		await expect(page.getByRole("heading", { name: project })).toBeVisible();
		await page.getByLabel("Add image").setInputFiles({ name: "upgrade.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9nR+IAAAAASUVORK5CYII=", "base64") });
		await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
		await expect(page.locator(".asset-image")).toHaveCount(1);
		await page.evaluate(async () => { await navigator.serviceWorker.ready; });
		await page.reload();
		await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const draft = page.getByRole("dialog").getByLabel("Name", { exact: true });
		await draft.fill(`${project} unsaved`);
		await page.evaluate(() => { (window as Window & { __pwaDraftMarker?: boolean }).__pwaDraftMarker = true; });

		// Keep old hashed chunks available while the old page is still open.
		cpSync(join(root, "apps/web/dist"), directory, { recursive: true, force: true });
		await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.ready;
			await new Promise<void>((resolveChange, reject) => {
				const timeout = window.setTimeout(() => reject(Error("new worker did not take control")), 15_000);
				navigator.serviceWorker.addEventListener("controllerchange", () => { window.clearTimeout(timeout); resolveChange(); }, { once: true });
				void registration.update().catch(reject);
			});
		});
		await expect(draft).toHaveValue(`${project} unsaved`);
		expect(await page.evaluate(() => (window as Window & { __pwaDraftMarker?: boolean }).__pwaDraftMarker)).toBe(true);
		await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
		await page.reload();
		await expect(page.getByRole("heading", { name: project })).toBeVisible();
		await expect(page.getByText("Domains and holding costs")).toBeVisible();
		await expect(page.locator(".asset-image")).toHaveCount(1);
		await expect.poll(() => page.locator(".asset-image").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const nextDraft = page.getByRole("dialog").getByLabel("Name", { exact: true });
		await nextDraft.fill(`${project} second draft`);
		await page.evaluate(() => { (window as Window & { __pwaDraftMarker?: boolean }).__pwaDraftMarker = true; });
		writeFileSync(join(directory, "sw.js"), `${readFileSync(join(directory, "sw.js"), "utf8")}\n// second update\n`);
		await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
		await expect(page.getByRole("status").filter({ hasText: "An update is ready" })).toBeVisible();
		await page.getByRole("button", { name: "Update app" }).evaluate((button: HTMLButtonElement) => button.click());
		await expect(page.getByText("Save or cancel your current edit before updating.")).toBeVisible();
		await expect(nextDraft).toHaveValue(`${project} second draft`);
		expect(await page.evaluate(() => (window as Window & { __pwaDraftMarker?: boolean }).__pwaDraftMarker)).toBe(true);
		await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
		await page.getByRole("button", { name: "Update app" }).click();
		await expect(page.getByRole("heading", { name: project })).toBeVisible();
		await expect(page.locator(".asset-image")).toHaveCount(1);
		expect(await page.evaluate(() => (window as Window & { __pwaDraftMarker?: boolean }).__pwaDraftMarker)).toBeUndefined();
		expect(pageErrors).toEqual([]);
		expect(consoleErrors).toEqual([]);
	} finally {
		await context.close();
		await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
		rmSync(directory, { recursive: true, force: true });
	}
});
