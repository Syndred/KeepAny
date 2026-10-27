import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdirSync } from "node:fs";
import { createUrlMetadataHandler } from "../../scripts/intake-url-metadata.mjs";
import { resources } from "../../apps/web/src/i18n";
import { sourceModuleUrl } from "./helpers/source-module-url";

const repositoryPath = sourceModuleUrl("packages/local-db/src/index.ts");
const parserPath = sourceModuleUrl("apps/web/src/intake-url.ts");
const evidence = "docs/qa/2026-10-27/evidence/T18-completion";
let fixture: Server;
let fixtureOrigin = "";
let metadataGets = 0;
let unsafeResources = 0;
test.beforeAll(async () => {
	fixture = createServer((request, response) => {
		if (request.url !== "/page") { unsafeResources++; response.end("must not load"); return; }
		metadataGets++;
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(`<!doctype html><title>T18 Controlled &amp; Metadata</title><meta name="description" content="原始 description &quot;quoted&quot;"><script>window.__unsafeMetadata=1</script><img src="${fixtureOrigin}/image-must-not-load"><iframe src="${fixtureOrigin}/frame-must-not-load"></iframe>`);
	});
	await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
	const address = fixture.address();
	if (!address || typeof address === "string") throw Error("fixture-address");
	fixtureOrigin = `http://127.0.0.1:${address.port}`;
	mkdirSync(evidence, { recursive: true });
});
test.afterAll(async () => {
	fixture.closeAllConnections();
	await new Promise<void>(resolve => fixture.close(() => resolve()));
});

async function readback(page: Page) {
	return page.evaluate(async path => {
		const repository = await (await import(path)).localRepository();
		return { assets: await repository.list("asset"), candidates: await repository.fileStore.intakeReview.toArray() };
	}, repositoryPath);
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`T18 completion ${locale} ${width}: controlled metadata review and exact CSV source survive confirm and reload`, async ({ browser, baseURL }) => {
		test.setTimeout(90_000);
		const context = await browser.newContext({ locale, viewport: { width, height: 950 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
		// This injected handler has an exact loopback fixture exception. It still
		// performs a real HTTP GET to the fixture. The normal route is checked below
		// against a public page and rejects the same loopback URL by default.
		if (!baseURL) throw Error("base-url-required");
		const handler = createUrlMetadataHandler(baseURL, { testAllowedOrigins: [fixtureOrigin] });
		await context.route("**/__keepany_intake__/url-metadata", async route => {
			const incoming = route.request();
			// Interception happens before the browser transport adds Host. Rebuild
			// that transport header from its actual destination, preserving Origin.
			const headers = { ...await incoming.allHeaders(), host: new URL(incoming.url()).host };
			const response = await handler(new Request(incoming.url(), { method: incoming.method(), headers, body: incoming.postData() }));
			await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
		});
		try {
			await page.addInitScript(language => localStorage.setItem("keepany-language", language), locale);
			await page.goto("/intake");
			const quick = page.locator(".intake-quick-card");
			await quick.locator("#import-url").fill(`${fixtureOrigin}/page`);
			await quick.getByRole("button", { name: t("intakePreviewRecords"), exact: true }).click();
			const preview = quick.locator(".import-preview");
			await expect(preview.locator('input:not([type="checkbox"])')).toHaveValue("T18 Controlled & Metadata");
			await expect(preview.locator("textarea")).toHaveValue('原始 description "quoted"');
			if ((locale === "zh-CN" && width === 390) || (locale === "en" && width === 1280)) {
				await preview.scrollIntoViewIfNeeded();
				await page.screenshot({ path: `${evidence}/T18-url-${locale}-${width}.png`, fullPage: false });
			}
			expect((await readback(page)).assets).toHaveLength(0);
			await quick.getByRole("button", { name: t("intakeModeManual"), exact: true }).click();
			await expect(preview).toHaveCount(0);
			expect((await readback(page)).assets).toHaveLength(0);
			await quick.getByRole("button", { name: t("intakeModeUrl"), exact: true }).click();
			await quick.getByRole("button", { name: t("intakePreviewRecords"), exact: true }).click();
			await preview.locator('input:not([type="checkbox"])').fill("T18 edited metadata title");
			await preview.locator("textarea").fill("T18 edited metadata description");
			await preview.getByRole("button", { name: t("confirmImport"), exact: true }).click();
			await expect(preview).toHaveCount(0);
			await page.reload();
			expect((await readback(page)).assets).toEqual([expect.objectContaining({ name: "T18 edited metadata title", description: "T18 edited metadata description", url: `${fixtureOrigin}/page` })]);
			await quick.getByRole("button", { name: t("intakeModeCsv"), exact: true }).click();
			const original = '\uFEFFkind,name,url,description\r\nproject,T18 Source Alpha,https://alpha.example.test,"First line\r\n第二行"\r\nproject,T18 Source Alpha,https://alpha.example.test,Duplicate\r\nitem,T18 Source Waiting,,Original waiting\r\n';
			await quick.locator("#csv-file").setInputFiles({ name: "T18-original.csv", mimeType: "text/csv", buffer: Buffer.from(original) });
			const rows = page.locator(".intake-review-row");
			await expect(rows).toHaveCount(3);
			const originalDetails = page.locator(".intake-review-original");
			await originalDetails.locator("summary").click();
			expect(await originalDetails.locator("pre").textContent()).toBe(original);
			await rows.nth(2).getByLabel(t("name"), { exact: true }).fill("T18 Waiting Edited");
			await rows.nth(0).getByRole("button", { name: t("reviewConfirm"), exact: true }).click();
			await expect(rows.nth(0).locator(".chip")).toHaveText(t("reviewStatusAccepted"));
			await rows.nth(1).getByRole("button", { name: t("reviewConfirm"), exact: true }).click();
			await expect(rows.nth(1).getByRole("alert")).toContainText(locale === "en" ? "Duplicate" : "重复");
			await page.reload();
			await expect(rows.nth(2).getByLabel(t("name"), { exact: true })).toHaveValue("T18 Waiting Edited");
			const state = await readback(page);
			expect(state.assets).toHaveLength(2);
			expect(state.candidates.filter((row: { status: string }) => row.status === "pending")).toHaveLength(2);
			expect(state.candidates.find((row: { sourceText?: string }) => row.sourceText)?.sourceText).toBe(original);
			expect(state.candidates.filter((row: { sourceTextRef?: string }) => row.sourceTextRef)).toHaveLength(2);
			expect(await page.evaluate(() => (window as unknown as { __unsafeMetadata?: number }).__unsafeMetadata)).toBeUndefined();
			expect(unsafeResources).toBe(0);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			await originalDetails.locator("summary").click();
			await originalDetails.scrollIntoViewIfNeeded();
			await page.screenshot({ path: `${evidence}/T18-${locale}-${width}.png`, fullPage: false });
			await test.info().attach("T18-exact-source-and-metadata-readback", { body: JSON.stringify({ state, metadataGets, unsafeResources }), contentType: "application/json" });
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}

test("T18 normal Vite API reads a real public page and rejects local targets without test exceptions", async ({ page }) => {
	await page.goto("/intake");
	const parsed = await page.evaluate(async path => {
		const { readUrlMetadata } = await import(path);
		return readUrlMetadata("https://example.com/");
	}, parserPath);
	expect(parsed).toMatchObject({ url: "https://example.com/", title: "Example Domain" });
	const blocked = await page.evaluate(async url => {
		const result = await fetch("/__keepany_intake__/url-metadata", { method: "POST", headers: { "content-type": "application/json", "x-keepany-intake": "metadata" }, body: JSON.stringify({ url }) });
		return { status: result.status, value: await result.json() };
	}, `${fixtureOrigin}/page`);
	expect(blocked).toEqual({ status: 422, value: { error: "metadata-private" } });
	expect((await readback(page)).assets).toHaveLength(0);
});

test("T18 credential-bearing URLs are rejected before a candidate, asset or target request exists", async ({ page }) => {
	let targetRequests = 0;
	page.on("request", request => { if (new URL(request.url()).hostname === "example.com") targetRequests++; });
	await page.goto("/intake");
	const quick = page.locator(".intake-quick-card");
	try {
		for (const url of ["https://synthetic-user:synthetic-password@example.com/", "http://synthetic-user@example.com/"]) {
			await quick.locator("#import-url").fill(url);
			await quick.getByRole("button", { name: "Preview records", exact: true }).click();
			await expect(page.getByRole("status").filter({ hasText: resources.en.translation.invalid })).toBeVisible();
			await expect(quick.locator(".import-preview")).toHaveCount(0);
			expect((await readback(page)).assets).toHaveLength(0);
			expect(targetRequests).toBe(0);
		}
	} finally {
		await test.info().attach("T18-credential-url-boundary-readback", { body: JSON.stringify({ targetRequests, candidateCount: await quick.locator(".import-preview").count(), assets: (await readback(page)).assets }), contentType: "application/json" });
	}
});
