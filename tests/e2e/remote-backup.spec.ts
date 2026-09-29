import { readFileSync, mkdirSync } from "node:fs";
import { expect, type BrowserContext, test } from "@playwright/test";

const evidence = "docs/evidence/2026-09-29";
const captureEvidence = process.env.KEEPANY_CAPTURE_EVIDENCE === "1";
type Store = { bytes: Buffer | null; authorizations: string[] };

async function routeStorage(
	context: BrowserContext,
	host: string,
	store: Store,
) {
	await context.route(`https://${host}/**`, async (route) => {
		const method = route.request().method();
		const headers = {
			"access-control-allow-origin": "*",
			"access-control-allow-methods": "GET, PUT, OPTIONS",
			"access-control-allow-headers": "authorization, content-type",
		};
		if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
		const authorization = route.request().headers().authorization;
		if (authorization) store.authorizations.push(authorization);
		if (method === "PUT") {
			store.bytes = route.request().postDataBuffer();
			return route.fulfill({ status: 201, headers });
		}
		if (method === "GET" && store.bytes)
			return route.fulfill({
				status: 200,
				headers,
				contentType: "application/octet-stream",
				body: store.bytes,
			});
		return route.fulfill({ status: 404, headers });
	});
}

for (const variant of [
	{ kind: "s3", locale: "en-US", width: 1280, host: "objects.example" },
	{ kind: "webdav", locale: "zh-CN", width: 390, host: "dav.example" },
] as const) {
	test(`${variant.kind} remote backup reads back and restores from a fresh browser`, async ({
		browser,
	}) => {
		test.setTimeout(90_000);
		if (captureEvidence) mkdirSync(evidence, { recursive: true });
		const store: Store = { bytes: null, authorizations: [] };
		const password = `remote-backup-${crypto.randomUUID()}-2026`;
		const project = `Remote project ${crypto.randomUUID().slice(0, 8)}`;
		const source = await browser.newContext({
			locale: variant.locale,
			acceptDownloads: true,
			viewport: { width: variant.width, height: 844 },
		});
		const sourcePage = await source.newPage();
		const errors: string[] = [];
		sourcePage.on("pageerror", (error) => errors.push(error.message));
		await routeStorage(source, variant.host, store);
		try {
			await sourcePage.goto("/assets/project");
			await sourcePage
				.getByRole("button", {
					name: variant.kind === "s3" ? "Add" : "新增",
					exact: true,
				})
				.click();
			const dialog = sourcePage.getByRole("dialog");
			await dialog
				.getByLabel(variant.kind === "s3" ? "Name" : "名称", { exact: true })
				.fill(project);
			await dialog
				.getByRole("button", { name: variant.kind === "s3" ? "Save" : "保存" })
				.click();
			await expect(sourcePage.getByText(project).first()).toBeVisible();

			await sourcePage.goto("/intake");
			await sourcePage.locator("#backup-password").fill(password);
			const panel = sourcePage.locator(".remote-backup-panel");
			if (variant.kind === "s3") {
				await panel
					.locator("#remote-put-url")
					.fill("https://objects.example/keepany.bin?signature=upload");
				await panel
					.locator("#remote-get-url")
					.fill("https://objects.example/keepany.bin?signature=download");
			} else {
				await panel.locator("#remote-kind").selectOption("webdav");
				await panel
					.locator("#remote-dav-url")
					.fill("https://dav.example/keepany.bin");
				await panel.locator("#remote-dav-user").fill("test-user");
				await panel.locator("#remote-dav-password").fill("test-app-password");
			}
			await panel
				.getByRole("button", {
					name:
						variant.kind === "s3"
							? "Encrypt, upload and verify"
							: "加密上传并核对",
				})
				.click();
			await expect(panel.getByRole("status")).toContainText(
				variant.kind === "s3" ? "Uploaded and checked" : "已上传并读回核对",
			);
			expect(store.bytes?.subarray(0, 8).toString()).toBe("KEEPANY1");
			expect(store.bytes?.includes(Buffer.from(project))).toBe(false);
			if (variant.kind === "webdav") {
				expect(store.authorizations.length).toBeGreaterThanOrEqual(2);
				expect(
					store.authorizations.every(
						(value) =>
							Buffer.from(value.slice(6), "base64").toString() ===
							"test-user:test-app-password",
					),
				).toBe(true);
			}
			const downloadPromise = sourcePage.waitForEvent("download");
			await panel
				.getByRole("link", {
					name: variant.kind === "s3" ? "Save receipt" : "保存校验凭条",
				})
				.click();
			const download = await downloadPromise;
			expect(download.suggestedFilename()).toBe("keepany-remote-receipt.json");
			const receiptPath = await download.path();
			if (!receiptPath) throw Error("receipt was not saved");
			const receipt = readFileSync(receiptPath);
			if (variant.kind === "s3" && store.bytes) {
				const original = Buffer.from(store.bytes);
				store.bytes[40] ^= 1;
				await panel
					.getByRole("button", { name: "Read and preview remote backup" })
					.click();
				await expect(panel.getByRole("status")).toContainText(
					"does not match the receipt",
				);
				await expect(
					panel.getByRole("button", { name: /Confirm ·/ }),
				).toHaveCount(0);
				store.bytes = original;
			}
			await sourcePage.reload();
			await expect(sourcePage.locator("#backup-password")).toHaveValue("");
			await expect(sourcePage.locator("#remote-receipt")).toHaveValue("");
			await expect(sourcePage.locator("#remote-kind")).toHaveValue("s3");
			const destination = await browser.newContext({
				locale: variant.locale,
				viewport: { width: variant.width, height: 844 },
			});
			await routeStorage(destination, variant.host, store);
			const targetPage = await destination.newPage();
			targetPage.on("pageerror", (error) => errors.push(error.message));
			try {
				await targetPage.goto("/intake");
				const targetPanel = targetPage.locator(".remote-backup-panel");
				await expect(targetPage.locator("#backup-password")).toHaveValue("");
				await targetPage.locator("#backup-password").fill(password);
				if (variant.kind === "s3") {
					await expect(targetPanel.locator("#remote-put-url")).toHaveValue("");
					await targetPanel
						.locator("#remote-get-url")
						.fill("https://objects.example/keepany.bin?signature=new-download");
				} else {
					await targetPanel.locator("#remote-kind").selectOption("webdav");
					await targetPanel
						.locator("#remote-dav-url")
						.fill("https://dav.example/keepany.bin");
					await targetPanel.locator("#remote-dav-user").fill("test-user");
					await targetPanel
						.locator("#remote-dav-password")
						.fill("test-app-password");
				}
				await targetPanel.locator("#remote-receipt-file").setInputFiles({
					name: "keepany-remote-receipt.json",
					mimeType: "application/json",
					buffer: receipt,
				});
				await expect(targetPanel.locator("#remote-receipt")).not.toHaveValue(
					"",
				);
				await targetPage
					.locator("#backup-password")
					.fill("incorrect-remote-backup-password");
				await targetPanel
					.getByRole("button", {
						name:
							variant.kind === "s3"
								? "Read and preview remote backup"
								: "读取并预览远端备份",
					})
					.click();
				await expect(targetPanel.getByRole("status")).toContainText(
					variant.kind === "s3" ? "Could not decrypt" : "无法解密",
				);
				await expect(
					targetPanel.getByRole("button", {
						name: variant.kind === "s3" ? /Confirm ·/ : /确认 ·/,
					}),
				).toHaveCount(0);
				await targetPage.locator("#backup-password").fill(password);
				await targetPanel
					.getByRole("button", {
						name:
							variant.kind === "s3"
								? "Read and preview remote backup"
								: "读取并预览远端备份",
					})
					.click();
				await expect(targetPanel.getByRole("status")).toContainText(
					variant.kind === "s3" ? "Remote backup verified" : "远端备份已核对",
				);
				if (captureEvidence)
					await targetPage.screenshot({
						path: `${evidence}/remote-backup-${variant.kind}-${variant.locale === "zh-CN" ? "zh" : "en"}-${variant.width}.png`,
						fullPage: true,
					});
				await targetPanel
					.getByRole("button", {
						name: variant.kind === "s3" ? /Confirm ·/ : /确认 ·/,
					})
					.click();
				await expect(
					targetPage.getByText(
						variant.kind === "s3"
							? /Restored \d+ records/
							: /已恢复 \d+ 条记录/,
					),
				).toBeVisible();
				await targetPage.goto("/assets/project");
				await expect(targetPage.getByText(project).first()).toBeVisible();
				const scrollWidth = await targetPage.evaluate(
					() => document.documentElement.scrollWidth,
				);
				expect(scrollWidth).toBeLessThanOrEqual(variant.width);
			} finally {
				await destination.close();
			}
			expect(errors).toEqual([]);
		} finally {
			await source.close();
		}
	});
}
