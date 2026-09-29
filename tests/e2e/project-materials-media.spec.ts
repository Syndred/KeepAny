import { expect, type Page, test } from "@playwright/test";

const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainPath = `/@fs${process.cwd()}/packages/domain/src/index.ts`;

async function storedProject(page: Page, id: string) {
	return page.evaluate(async ({ repositoryPath, id }) => {
		const { localRepository } = await import(repositoryPath);
		const repository = await localRepository();
		const asset = await repository.get("asset", id);
		return { asset, fileIds: (await repository.fileStore.blobs.toArray()).map((file: { id: string }) => file.id) };
	}, { repositoryPath, id });
}

async function png(page: Page, color: string) {
	const base64 = await page.evaluate((fill) => {
		const canvas = document.createElement("canvas");
		canvas.width = 80;
		canvas.height = 64;
		const context = canvas.getContext("2d");
		if (!context) throw Error("canvas-unavailable");
		context.fillStyle = fill;
		context.fillRect(0, 0, 80, 64);
		return canvas.toDataURL("image/png").split(",")[1];
	}, color);
	return Buffer.from(base64, "base64");
}

for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} project materials and role images persist through reload`, async ({ browser }) => {
		test.setTimeout(120_000);
		const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const addLabel = locale === "zh-CN" ? "添加图片" : "Add image";
		const replaceLabel = locale === "zh-CN" ? "替换图片" : "Replace image";
		const removeLabel = locale === "zh-CN" ? "移除图片" : "Remove image";
		const confirmLabel = locale === "zh-CN" ? "确认" : "Confirm";
		try {
			await page.goto("/");
			await page.evaluate((value) => localStorage.setItem("keepany-language", value), locale);
			const id = await page.evaluate(async ({ repositoryPath, domainPath }) => {
				const { save } = await import(repositoryPath);
				const { newAsset } = await import(domainPath);
				const asset = { ...newAsset("project"), name: "Materials test", projectTitle: "Actual product title",
					projectPromoUrl: "https://example.test/promo", projectMediumDescription: "Medium saved copy",
					projectFeatures: "Saved features", projectPricing: "Free tier", projectPricingType: "Freemium",
					projectEmail: "hello@example.test", longDescription: "Full saved copy", notes: "Saved contact note" };
				await save("asset", asset);
				return asset.id as string;
			}, { repositoryPath, domainPath });
			await page.goto(`/assets/project/${id}`);
			await page.locator("#asset-project-materials > summary").click();
			const materials = page.locator("#asset-project-materials");
			for (const value of ["Actual product title", "https://example.test/promo", "Medium saved copy", "Full saved copy", "Saved features", "Free tier", "Freemium", "hello@example.test", "Saved contact note"]) await expect(materials).toContainText(value);
			await materials.getByRole("button", { name: locale === "zh-CN" ? "编辑" : "Edit", exact: true }).click();
			await expect(page.getByRole("dialog").locator("#projectTitle")).toHaveValue("Actual product title");
			await page.getByRole("dialog").getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel" }).click();

			async function upload(role: string, name: string, color: string, replace = false) {
				const section = materials.locator(`[data-project-media-role="${role}"]`);
				await section.getByRole("button", { name: replace ? replaceLabel : addLabel }).first().click();
				await materials.locator("input[type=file]").setInputFiles({ name, mimeType: "image/png", buffer: await png(page, color) });
				const dialog = page.getByRole("dialog");
				await expect(dialog.locator("img.image-preview")).toBeVisible();
				await dialog.getByRole("button", { name: confirmLabel }).click();
				await expect(dialog).toBeHidden();
				await expect(section.locator("img.asset-image").first()).toBeVisible();
			}
			await upload("logoId", "logo.png", "#eb5f57");
			await expect(page.locator(".asset-project-hero-logo img")).toBeVisible();
			await expect(page.locator(".asset-project-hero-visual img")).toHaveCount(0);
			await upload("homeScreenshotId", "home.png", "#4b74da");
			await expect(page.locator(".asset-project-hero-visual img")).toBeVisible();
			await upload("productScreenshotIds", "product.png", "#50a884");
			await upload("promoCoverId", "cover.png", "#edbe4d");
			let stored = await storedProject(page, id);
			let asset = stored.asset as { attachments: string[]; projectMedia: { logoId: string; homeScreenshotId: string; productScreenshotIds: string[]; promoCoverId: string } };
			expect(asset.projectMedia.productScreenshotIds).toHaveLength(1);
			expect(asset.attachments[0]).toBe(asset.projectMedia.homeScreenshotId);
			for (const mediaId of [asset.projectMedia.logoId, asset.projectMedia.homeScreenshotId, asset.projectMedia.promoCoverId, ...asset.projectMedia.productScreenshotIds]) {
				expect(asset.attachments).toContain(mediaId);
				expect(stored.fileIds).toContain(mediaId);
			}
			await page.reload();
			await page.locator("#asset-project-materials > summary").click();
			for (const role of ["logoId", "homeScreenshotId", "productScreenshotIds", "promoCoverId"]) await expect(materials.locator(`[data-project-media-role="${role}"] img.asset-image`)).toBeVisible();
			for (const width of [390, 1280]) {
				await page.setViewportSize({ width, height: 844 });
				await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
				await page.screenshot({ path: `/private/tmp/keepany-project-materials-${locale}-${width}.png`, fullPage: true });
			}
			if (locale === "en") {
				for (let index = 1; index < 4; index++) await upload("productScreenshotIds", `product-${index}.png`, "#50a884");
				const screenshots = materials.locator('[data-project-media-role="productScreenshotIds"]');
				await expect(screenshots.locator("img.asset-image")).toHaveCount(4);
				await expect(screenshots.getByRole("button", { name: addLabel })).toBeDisabled();
				await screenshots.getByRole("button", { name: removeLabel }).first().click();
				await expect(screenshots.locator("img.asset-image")).toHaveCount(3);
				await expect(screenshots.getByRole("button", { name: addLabel })).toBeEnabled();
			}
			const oldLogo = asset.projectMedia.logoId;
			await upload("logoId", "logo-new.png", "#9b66c8", true);
			stored = await storedProject(page, id);
			asset = stored.asset as typeof asset;
			expect(asset.projectMedia.logoId).not.toBe(oldLogo);
			expect(asset.attachments).not.toContain(oldLogo);
			expect(stored.fileIds).not.toContain(oldLogo);
			const oldCover = asset.projectMedia.promoCoverId;
			await materials.locator('[data-project-media-role="promoCoverId"]').getByRole("button", { name: removeLabel }).click();
			stored = await storedProject(page, id);
			asset = stored.asset as typeof asset;
			expect(asset.projectMedia.promoCoverId).toBe("");
			expect(asset.attachments).not.toContain(oldCover);
			await expect(materials.locator('[data-project-media-role="promoCoverId"] img')).toHaveCount(0);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
