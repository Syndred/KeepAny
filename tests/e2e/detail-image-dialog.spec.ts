import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const evidence = "docs/evidence/2026-09-29";
const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

async function imageState(page: Page) {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		const assets = (await repository.allRecords())
			.filter((record: { type: string }) => record.type === "asset")
			.map((record: { payload: string }) => JSON.parse(record.payload));
		return {
			attachments: assets[0]?.attachments ?? [],
			files: await repository.fileStore.blobs.count(),
		};
	}, repositoryModuleUrl);
}

async function png(page: Page, color: string) {
	const base64 = await page.evaluate((fill) => {
		const canvas = document.createElement("canvas");
		canvas.width = 8;
		canvas.height = 8;
		const context = canvas.getContext("2d");
		if (!context) throw Error("Canvas unavailable");
		context.fillStyle = fill;
		context.fillRect(0, 0, 8, 8);
		return canvas.toDataURL("image/png").split(",")[1];
	}, color);
	return Buffer.from(base64, "base64");
}

for (const language of ["en", "zh-CN"] as const) {
	for (const width of [360, 390, 768, 1280, 1440]) {
		test(`${language} image preview and confirmation at ${width}px`, async ({
			browser,
		}, testInfo) => {
			mkdirSync(evidence, { recursive: true });
			const labels =
				language === "en"
					? {
							add: "Add",
							name: "Name",
							save: "Save",
							addImage: "Add image",
							replace: "Replace image",
							cancel: "Cancel",
							confirm: "Confirm",
							error: "Choose a JPEG, PNG, WebP or GIF up to 20 MB.",
						}
					: {
							add: "新增",
							name: "名称",
							save: "保存",
							addImage: "添加图片",
							replace: "替换图片",
							cancel: "取消",
							confirm: "确认",
							error: "请选择不超过 20 MB 的 JPEG、PNG、WebP 或 GIF。",
						};
			const context = await browser.newContext({
				viewport: { width, height: 844 },
			});
			await context.addInitScript(
				(value) => localStorage.setItem("keepany-language", value),
				language,
			);
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const name = `Photo dialog ${crypto.randomUUID().slice(0, 8)}`;
			const longName = `${"L".repeat(240)}.png`;
			try {
				await page.goto("/assets/project");
				await page
					.getByRole("button", { name: labels.add, exact: true })
					.click();
				const editor = page.getByRole("dialog");
				await editor.getByLabel(labels.name, { exact: true }).fill(name);
				await editor
					.getByRole("button", { name: labels.save, exact: true })
					.click();
				await expect(editor).toBeHidden();
				await page.getByText(name).first().click();
				await expect(page.getByRole("heading", { name })).toBeVisible();
				const first = await png(page, "#4a82de");
				const addImage = page.getByRole("button", { name: labels.addImage });
				const firstChooser = page.waitForEvent("filechooser");
				await addImage.click();
				await (await firstChooser).setFiles({
					name: longName,
					mimeType: "image/png",
					buffer: first,
				});
				const dialog = page.getByRole("dialog");
				await expect(
					dialog.getByRole("img", { name: longName }),
				).toHaveJSProperty("naturalWidth", 8);
				await expect(
					dialog.getByRole("button", { name: labels.confirm }),
				).toBeEnabled();
				await expect(dialog.getByText(longName)).toBeVisible();
				expect(
					await dialog.evaluate((element) =>
						element.contains(document.activeElement),
					),
				).toBe(true);
				await dialog.getByRole("button", { name: labels.confirm }).focus();
				for (let i = 0; i < 5; i += 1) {
					await page.keyboard.press("Tab");
					expect(
						await dialog.evaluate((element) =>
							element.contains(document.activeElement),
						),
					).toBe(true);
				}
				const filenameFits = await dialog
					.getByText(longName)
					.evaluate((element) => element.scrollWidth <= element.clientWidth);
				expect(filenameFits).toBe(true);
				expect(
					await dialog.evaluate(
						(element) => element.scrollWidth <= element.clientWidth,
					),
				).toBe(true);
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth),
				).toBeLessThanOrEqual(width);
				const screenshot = await page.screenshot({
					path: `${evidence}/detail-image-${language}-${width}-preview.png`,
				});
				await testInfo.attach(`${language}-${width}-image-preview`, {
					body: screenshot,
					contentType: "image/png",
				});
				await page.keyboard.press("Escape");
				await expect(dialog).toBeHidden();
				await expect(addImage).toBeFocused();
				expect(await imageState(page)).toEqual({ attachments: [], files: 0 });
				const brokenChooser = page.waitForEvent("filechooser");
				await addImage.click();
				await (await brokenChooser).setFiles({
					name: "broken.png",
					mimeType: "image/png",
					buffer: Buffer.from("not a png"),
				});
				await expect(dialog.getByRole("alert")).toHaveText(labels.error);
				await expect(
					dialog.getByRole("button", { name: labels.confirm }),
				).toBeDisabled();
				await dialog.getByRole("button", { name: labels.cancel }).click();
				await expect(dialog).toBeHidden();
				await expect(addImage).toBeFocused();
				expect(await imageState(page)).toEqual({ attachments: [], files: 0 });
				await page.getByLabel(labels.addImage).setInputFiles({
					name: "valid.png",
					mimeType: "image/png",
					buffer: first,
				});
				await expect(
					dialog.getByRole("button", { name: labels.confirm }),
				).toBeEnabled();
				await dialog.getByRole("button", { name: labels.confirm }).click();
				await expect(dialog).toBeHidden();
				await expect(page.locator(".asset-image")).toHaveCount(1);
				await expect.poll(async () => (await imageState(page)).files).toBe(1);
				const saved = await imageState(page);
				expect(saved.attachments).toHaveLength(1);
				const replaceImage = page.getByRole("button", { name: labels.replace });
				const chooser = page.waitForEvent("filechooser");
				await replaceImage.click();
				await (await chooser).setFiles({
					name: "new.png",
					mimeType: "image/png",
					buffer: await png(page, "#f57143"),
				});
				await expect(
					dialog.getByRole("button", { name: labels.confirm }),
				).toBeEnabled();
				await dialog.getByRole("button", { name: labels.cancel }).click();
				await expect(dialog).toBeHidden();
				await expect(replaceImage).toBeFocused();
				expect(await imageState(page)).toEqual(saved);
				await page.reload();
				await expect(page.locator(".asset-image")).toHaveCount(1);
				expect(await imageState(page)).toEqual(saved);
				const secondChooser = page.waitForEvent("filechooser");
				await replaceImage.click();
				await (await secondChooser).setFiles({
					name: "new.png",
					mimeType: "image/png",
					buffer: await png(page, "#f57143"),
				});
				await expect(
					dialog.getByRole("button", { name: labels.confirm }),
				).toBeEnabled();
				await dialog.getByRole("button", { name: labels.confirm }).click();
				await expect(dialog).toBeHidden();
				await expect
					.poll(async () => (await imageState(page)).attachments[0])
					.not.toBe(saved.attachments[0]);
				const replaced = await imageState(page);
				expect(replaced.attachments).toHaveLength(1);
				expect(replaced.files).toBe(1);
				await page.reload();
				await expect(page.locator(".asset-image")).toHaveCount(1);
				expect(await imageState(page)).toEqual(replaced);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}

for (const scenario of [
	{
		language: "en",
		width: 390,
		add: "Add",
		name: "Name",
		save: "Save",
		addImage: "Add image",
		replace: "Replace image",
		cancel: "Cancel",
		confirm: "Confirm",
	},
	{
		language: "zh-CN",
		width: 1280,
		add: "新增",
		name: "名称",
		save: "保存",
		addImage: "添加图片",
		replace: "替换图片",
		cancel: "取消",
		confirm: "确认",
	},
] as const) {
	test(`${scenario.language} production-safe image dialog at ${scenario.width}px`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			viewport: { width: scenario.width, height: 844 },
		});
		await context.addInitScript(
			(language) => localStorage.setItem("keepany-language", language),
			scenario.language,
		);
		const page = await context.newPage();
		const name = `Preview image ${crypto.randomUUID().slice(0, 8)}`;
		try {
			await page.goto("/assets/project");
			await page
				.getByRole("button", { name: scenario.add, exact: true })
				.click();
			const editor = page.getByRole("dialog");
			await editor.getByLabel(scenario.name, { exact: true }).fill(name);
			await editor.getByRole("button", { name: scenario.save }).click();
			await expect(editor).toBeHidden();
			await page.getByText(name).first().click();
			await expect(page.getByRole("heading", { name })).toBeVisible();
			const addImage = page.getByRole("button", { name: scenario.addImage });
			const firstChooser = page.waitForEvent("filechooser");
			await addImage.click();
			await (await firstChooser).setFiles({
				name: "first.png",
				mimeType: "image/png",
				buffer: await png(page, "#4a82de"),
			});
			const dialog = page.getByRole("dialog");
			await expect(
				dialog.getByRole("button", { name: scenario.confirm }),
			).toBeEnabled();
			await dialog.getByRole("button", { name: scenario.cancel }).click();
			await expect(addImage).toBeFocused();
			await page.reload();
			await expect(page.locator(".asset-image")).toHaveCount(0);
			const nextChooser = page.waitForEvent("filechooser");
			await addImage.click();
			await (await nextChooser).setFiles({
				name: "first.png",
				mimeType: "image/png",
				buffer: await png(page, "#4a82de"),
			});
			await dialog.getByRole("button", { name: scenario.confirm }).click();
			await expect(page.locator(".asset-image")).toHaveCount(1);
			await page.reload();
			await expect(page.locator(".asset-image")).toHaveCount(1);
			const replace = page.getByRole("button", { name: scenario.replace });
			const chooser = page.waitForEvent("filechooser");
			await replace.click();
			await (await chooser).setFiles({
				name: "second.png",
				mimeType: "image/png",
				buffer: await png(page, "#f57143"),
			});
			await dialog.getByRole("button", { name: scenario.confirm }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			await expect(page.locator(".asset-image")).toHaveCount(1);
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(scenario.width);
		} finally {
			await context.close();
		}
	});
}
