import { expect, type Page, test } from "@playwright/test";

const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

async function png(page: Page, color: string) {
	const base64 = await page.evaluate((fill) => {
		const canvas = document.createElement("canvas");
		canvas.width = 24;
		canvas.height = 24;
		const context = canvas.getContext("2d");
		if (!context) throw Error("canvas-unavailable");
		context.fillStyle = fill;
		context.fillRect(0, 0, 24, 24);
		return canvas.toDataURL("image/png").split(",")[1];
	}, color);
	return Buffer.from(base64, "base64");
}

async function stored(page: Page, name: string) {
	return page.evaluate(async ({ path, name }) => {
		const { localRepository } = await import(path);
		const repository = await localRepository();
		const asset = (await repository.list("asset")).find((row: { name: string }) => row.name === name);
		const blobs = await repository.fileStore.blobs.toArray();
		return { asset, ids: blobs.map((blob: { id: string }) => blob.id) };
	}, { path: repositoryPath, name });
}

async function pixel(page: Page, role: string) {
	return page.locator(`[data-project-media-role="${role}"] img.asset-image`).first().evaluate((image: HTMLImageElement) => {
		const canvas = document.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		const context = canvas.getContext("2d");
		if (!context) throw Error("canvas-unavailable");
		context.drawImage(image, 0, 0, 1, 1);
		return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
	});
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`${locale} ${width}px project form saves and edits all image roles`, async ({ browser }) => {
		test.setTimeout(120_000);
		const context = await browser.newContext({ locale, viewport: { width, height: 844 } });
		const page = await context.newPage();
		const pageErrors: string[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));
		const name = `Project form media ${locale} ${width}`;
		const saveLabel = locale === "zh-CN" ? "保存" : "Save";
		try {
			await page.goto("/");
			await page.evaluate((value) => localStorage.setItem("keepany-language", value), locale);
			await page.goto("/assets/project");
			await page.getByRole("button", { name: locale === "zh-CN" ? "新增" : "Add", exact: true }).click();
			let dialog = page.getByRole("dialog");
			await dialog.locator("#name").fill(name);
			await dialog.locator("#projectLogoFile").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: await png(page, "#ef4030") });
			await dialog.locator("#projectHomeFile").setInputFiles({ name: "home.png", mimeType: "image/png", buffer: await png(page, "#235ac8") });
			await dialog.locator("#projectProductFiles").setInputFiles([
				{ name: "product-a.png", mimeType: "image/png", buffer: await png(page, "#239a50") },
				{ name: "product-b.png", mimeType: "image/png", buffer: await png(page, "#efbd29") },
			]);
			await dialog.locator("#projectPromoFile").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: await png(page, "#8726b0") });
			await expect(dialog.locator(".project-editor-image")).toHaveCount(5);
			await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
			await dialog.locator(".project-editor-media").scrollIntoViewIfNeeded();
			await dialog.screenshot({ path: `/private/tmp/keepany-project-form-media-${locale}-${width}.png` });
			await dialog.getByRole("button", { name: saveLabel, exact: true }).click();
			await expect(dialog).toBeHidden();
			const created = await stored(page, name);
			const initial = created.asset as { id: string; attachments: string[]; projectMedia: { logoId: string; homeScreenshotId: string; productScreenshotIds: string[]; promoCoverId: string } };
			expect(initial.projectMedia.productScreenshotIds).toHaveLength(2);
			expect(initial.attachments[0]).toBe(initial.projectMedia.homeScreenshotId);
			for (const id of [initial.projectMedia.logoId, initial.projectMedia.homeScreenshotId, initial.projectMedia.promoCoverId, ...initial.projectMedia.productScreenshotIds]) {
				expect(initial.attachments).toContain(id);
				expect(created.ids).toContain(id);
			}
			await page.goto(`/assets/project/${initial.id}`);
			await page.locator("#asset-project-materials > summary").click();
			for (const role of ["logoId", "homeScreenshotId", "productScreenshotIds", "promoCoverId"]) await expect(page.locator(`[data-project-media-role="${role}"] img.asset-image`).first()).toBeVisible();
			expect(await pixel(page, "logoId")).toEqual([239, 64, 48]);
			expect(await pixel(page, "homeScreenshotId")).toEqual([35, 90, 200]);
			expect(await pixel(page, "productScreenshotIds")).toEqual([35, 154, 80]);
			expect(await pixel(page, "promoCoverId")).toEqual([135, 38, 176]);
			await page.getByRole("button", { name: locale === "zh-CN" ? "编辑" : "Edit", exact: true }).first().click();
			dialog = page.getByRole("dialog");
			await dialog.locator("#projectLogoFile").setInputFiles({ name: "logo-new.png", mimeType: "image/png", buffer: await png(page, "#6839dd") });
			await dialog.locator("#projectProductFiles").setInputFiles({ name: "product-new.png", mimeType: "image/png", buffer: await png(page, "#15c7aa") });
			await dialog.getByRole("button", { name: saveLabel, exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			await page.locator("#asset-project-materials > summary").click();
			const edited = await stored(page, name);
			const updated = edited.asset as typeof initial;
			expect(updated.projectMedia.logoId).not.toBe(initial.projectMedia.logoId);
			expect(updated.projectMedia.productScreenshotIds).toHaveLength(1);
			expect(updated.projectMedia.homeScreenshotId).toBe(initial.projectMedia.homeScreenshotId);
			expect(updated.projectMedia.promoCoverId).toBe(initial.projectMedia.promoCoverId);
			for (const oldId of [initial.projectMedia.logoId, ...initial.projectMedia.productScreenshotIds]) {
				expect(updated.attachments).not.toContain(oldId);
				expect(edited.ids).not.toContain(oldId);
			}
			expect(await pixel(page, "logoId")).toEqual([104, 57, 221]);
			expect(await pixel(page, "productScreenshotIds")).toEqual([21, 199, 170]);
			expect(await pixel(page, "homeScreenshotId")).toEqual([35, 90, 200]);
			expect(await pixel(page, "promoCoverId")).toEqual([135, 38, 176]);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			if (locale === "en" && width === 390) {
				await page.getByRole("button", { name: "Edit", exact: true }).first().click();
				dialog = page.getByRole("dialog");
				await dialog.locator("#projectPromoFile").setInputFiles({ name: "stale-cover.png", mimeType: "image/png", buffer: await png(page, "#ff00ff") });
				await page.evaluate(async ({ path, id }) => {
					const { localRepository } = await import(path);
					const repository = await localRepository();
					const current = await repository.get("asset", id);
					await repository.saveAssetIfCurrent(current, { ...current, description: "Concurrent edit", updatedAt: new Date().toISOString() });
				}, { path: repositoryPath, id: initial.id });
				await dialog.getByRole("button", { name: saveLabel, exact: true }).click();
				await expect(dialog.getByRole("alert")).toBeVisible();
				await expect(dialog).toBeVisible();
				const afterFailure = await stored(page, name);
				expect((afterFailure.asset as typeof initial).projectMedia.promoCoverId).toBe(updated.projectMedia.promoCoverId);
				expect(afterFailure.ids.sort()).toEqual(edited.ids.sort());
			}
			expect(pageErrors).toEqual([]);
		} finally { await context.close(); }
	});
}
