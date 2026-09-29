import { expect, type Page, test } from "@playwright/test";

const repositoryPath = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainPath = `/@fs${process.cwd()}/packages/domain/src/index.ts`;

async function itemState(page: Page, id: string) {
	return page.evaluate(
		async ({ repositoryPath, id }) => {
			const { localRepository } = await import(repositoryPath);
			const repository = await localRepository();
			return {
				asset: await repository.get("asset", id),
				history: (await repository.list("history")).filter(
					(row: { assetId: string }) => row.assetId === id,
				),
			};
		},
		{ repositoryPath, id },
	);
}

async function png(page: Page, fill: string) {
	const base64 = await page.evaluate((color) => {
		const canvas = document.createElement("canvas");
		canvas.width = 80;
		canvas.height = 64;
		const context = canvas.getContext("2d");
		if (!context) throw Error("canvas-unavailable");
		context.fillStyle = color;
		context.fillRect(0, 0, 80, 64);
		return canvas.toDataURL("image/png").split(",")[1];
	}, fill);
	return Buffer.from(base64, "base64");
}

for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} receipt without a selected cover keeps the item list placeholder`, async ({ page }) => {
		const zh = locale === "zh-CN";
		await page.goto("/");
		await page.evaluate((value) => localStorage.setItem("keepany-language", value), locale);
		const id = await page.evaluate(async ({ repositoryPath, domainPath }) => {
			const { localRepository } = await import(repositoryPath);
			const { newAsset } = await import(domainPath);
			const repository = await localRepository();
			const asset = { ...newAsset("item"), name: "Receipt-only item" };
			await repository.save("asset", asset);
			return asset.id as string;
		}, { repositoryPath, domainPath });
		await page.goto(`/assets/item/${id}`);
		const receipts = page.locator('[data-item-media-role="receiptIds"]');
		await receipts.getByRole("button", { name: zh ? "添加图片" : "Add image" }).click();
		await page.locator(".asset-attachments-card input[type=file]").setInputFiles({
			name: "receipt.png", mimeType: "image/png", buffer: await png(page, "#e5bd57"),
		});
		await page.getByRole("dialog").getByRole("button", { name: zh ? "确认" : "Confirm" }).click();
		await expect(receipts.locator("img.asset-image")).toBeVisible();
		await page.goto("/assets/item");
		const card = page.locator(".asset-library-card").filter({ hasText: "Receipt-only item" });
		await expect(card.locator(".asset-library-cover img")).toHaveCount(0);
		await expect(card.locator(".asset-library-cover svg")).toBeVisible();
		await page.reload();
		await expect(card.locator(".asset-library-cover img")).toHaveCount(0);
		await expect(card.locator(".asset-library-cover svg")).toBeVisible();
	});

	test(`${locale} legacy Work laptop physical detail, evidence and expected return survive reload`, async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		const context = await browser.newContext({
			locale,
			viewport: { width: 390, height: 844 },
		});
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const zh = locale === "zh-CN";
		try {
			await page.goto("/");
			await page.evaluate(
				(value) => localStorage.setItem("keepany-language", value),
				locale,
			);
			const id = await page.evaluate(
				async ({ repositoryPath, domainPath }) => {
					const { localRepository } = await import(repositoryPath);
					const { newAsset } = await import(domainPath);
					const repository = await localRepository();
					const asset = {
						...newAsset("item"),
						name: "Work laptop",
						location: "Home / office › shelf",
						purchaseDate: "2023-05-10",
					};
					await repository.save("asset", asset);
					const row = await repository.db.records
						.findOne(`asset:${asset.id}`)
						.exec();
					if (!row) throw Error("legacy-row-missing");
					await row.incrementalModify((data: { payload: string }) => {
						const payload = JSON.parse(data.payload);
						for (const field of [
							"itemLifecycleStatus",
							"itemStatusDate",
							"itemStartDate",
							"itemWarrantyStatus",
							"lastItemEventId",
							"itemMedia",
							"itemExpectedReturnDate",
						])
							delete payload[field];
						return { ...data, payload: JSON.stringify(payload) };
					});
					return asset.id as string;
				},
				{ repositoryPath, domainPath },
			);
			await page.goto(`/assets/item/${id}`);
			await expect(
				page.getByRole("heading", { name: "Work laptop" }),
			).toBeVisible();
			await expect(page.locator(".asset-item-photo-stage img")).toHaveCount(0);
			await upload("coverId", "cover.png", "#d88564");
			await page
				.getByRole("button", {
					name: zh ? "记录状态变更" : "Record status change",
				})
				.click();
			let dialog = page.getByRole("dialog");
			await dialog.locator("#item-lifecycle-status").selectOption("idle");
			await dialog.locator("#item-status-date").fill("2026-09-29");
			await dialog
				.getByRole("button", { name: zh ? "保存状态" : "Save status" })
				.click();
			await expect(dialog).toBeHidden();
			await expect(page.locator(".asset-profile-card")).toContainText(
				zh ? "闲置" : "Idle",
			);
			await page
				.getByRole("button", { name: zh ? "编辑位置" : "Edit location" })
				.click();
			dialog = page.getByRole("dialog");
			await expect(dialog.getByLabel(zh ? "所在区域" : "Area")).toHaveValue(
				"Home / office › shelf",
			);
			await expect(
				dialog.getByLabel(zh ? "收纳位置" : "Container"),
			).toHaveValue("");
			await dialog.getByLabel(zh ? "所在区域" : "Area").fill("Study");
			await dialog.getByLabel(zh ? "收纳位置" : "Container").fill("Shelf");
			await dialog.getByLabel(zh ? "具体位置" : "Exact spot").fill("Top");
			await dialog
				.getByRole("button", { name: zh ? "保存位置" : "Save location" })
				.click();
			await expect(dialog).toBeHidden();
			await expect(page.locator(".asset-profile-card")).toContainText(
				"Study › Shelf › Top",
			);

			async function upload(role: string, name: string, color: string) {
				const section = page.locator(`[data-item-media-role="${role}"]`);
				await section
					.getByRole("button", { name: zh ? "添加图片" : "Add image" })
					.click();
				await page
					.locator(".asset-attachments-card input[type=file]")
					.setInputFiles({
						name,
						mimeType: "image/png",
						buffer: await png(page, color),
					});
				const preview = page.getByRole("dialog");
				await expect(preview.locator("img.image-preview")).toBeVisible();
				await preview
					.getByRole("button", { name: zh ? "确认" : "Confirm" })
					.click();
				await expect(preview).toBeHidden();
				await expect(section.locator("img.asset-image")).toBeVisible();
			}
			await upload("detailIds", "detail.png", "#5984d8");
			await upload("receiptIds", "receipt.png", "#e5bd57");
			await expect(page.locator(".asset-item-photo-stage img")).toBeVisible();
			const afterPhotos = await itemState(page, id);
			const media = (
				afterPhotos.asset as {
					itemMedia: {
						coverId: string;
						detailIds: string[];
						receiptIds: string[];
					};
					attachments: string[];
				}
			).itemMedia;
			for (const mediaId of [
				media.coverId,
				...media.detailIds,
				...media.receiptIds,
			])
				expect(
					(afterPhotos.asset as { attachments: string[] }).attachments,
				).toContain(mediaId);
			await page.evaluate(
				async ({ repositoryPath, id, coverId }) => {
					const { localRepository } = await import(repositoryPath);
					const repository = await localRepository();
					const asset = await repository.get("asset", id);
					if (!asset) throw Error("item-missing");
					await repository.save("asset", {
						...asset,
						attachments: [...asset.attachments.filter((value: string) => value !== coverId), coverId],
						updatedAt: new Date().toISOString(),
					});
				},
				{ repositoryPath, id, coverId: media.coverId },
			);
			await page.goto("/assets/item");
			const listCover = page.locator(".asset-library-card .asset-library-cover img");
			await expect(listCover).toBeVisible();
			await expect.poll(() => listCover.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
			const coverPixel = await listCover.evaluate((image: HTMLImageElement) => {
				const canvas = document.createElement("canvas");
				canvas.width = canvas.height = 1;
				const context = canvas.getContext("2d");
				if (!context) throw Error("canvas-unavailable");
				context.drawImage(image, 0, 0, 1, 1);
				return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
			});
			expect(coverPixel).toEqual([216, 133, 100]);
			await page.goto(`/assets/item/${id}`);
			const expectedReturnDate = new Date(Date.now() + 45 * 86_400_000)
				.toISOString()
				.slice(0, 10);
			await page.getByLabel(zh ? "借用人" : "Borrower").fill("Ada");
			await page
				.getByLabel(zh ? "预计归还日期" : "Expected return date")
				.fill(expectedReturnDate);
			await page
				.getByRole("button", { name: zh ? "借出" : "Lend item" })
				.click();
			await expect(page.locator(".asset-profile-card")).toContainText("Ada");
			await expect(page.locator(".asset-profile-card")).toContainText(
				zh ? "已借出" : "On loan",
			);
			const loaned = await itemState(page, id);
			expect(
				(loaned.asset as { itemExpectedReturnDate: string })
					.itemExpectedReturnDate,
			).toBe(expectedReturnDate);
			expect(loaned.history).toContainEqual(
				expect.objectContaining({
					action: "loan",
					borrower: "Ada",
					expectedReturnDate,
				}),
			);
			await page.reload();
			await expect(
				page.locator('[data-item-media-role="receiptIds"] img'),
			).toBeVisible();
			await expect(page.locator(".asset-item-photo-stage img")).toBeVisible();
			await expect(page.locator(".asset-profile-card")).toContainText(
				"Study › Shelf › Top",
			);
			await expect(page.locator(".asset-item-timeline")).toContainText("Ada");
			for (const width of [390, 1280]) {
				await page.setViewportSize({ width, height: 844 });
				await expect(
					page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth + 1,
					),
				).resolves.toBe(true);
				await page.screenshot({
					path: `/private/tmp/keepany-item-physical-${locale}-${width}.png`,
					fullPage: true,
				});
			}
			const detailSection = page.locator('[data-item-media-role="detailIds"]');
			await detailSection
				.getByRole("button", { name: zh ? "替换图片" : "Replace image" })
				.click();
			await page
				.locator(".asset-attachments-card input[type=file]")
				.setInputFiles({
					name: "replacement.png",
					mimeType: "image/png",
					buffer: await png(page, "#568c76"),
				});
			await page
				.getByRole("dialog")
				.getByRole("button", { name: zh ? "确认" : "Confirm" })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			const replaced = await itemState(page, id);
			const newDetailId = (
				replaced.asset as {
					itemMedia: { detailIds: string[] };
					attachments: string[];
				}
			).itemMedia.detailIds[0];
			expect(newDetailId).not.toBe(media.detailIds[0]);
			expect(
				(replaced.asset as { attachments: string[] }).attachments,
			).toContain(newDetailId);
			expect(
				(replaced.asset as { attachments: string[] }).attachments,
			).not.toContain(media.detailIds[0]);
			await page
				.locator('[data-item-media-role="receiptIds"]')
				.getByRole("button", { name: zh ? "移除图片" : "Remove image" })
				.click();
			await expect(
				page.locator('[data-item-media-role="receiptIds"] img'),
			).toHaveCount(0);
			const removed = await itemState(page, id);
			expect(
				(removed.asset as { itemMedia: { receiptIds: string[] } }).itemMedia
					.receiptIds,
			).toEqual([]);
			expect(
				(removed.asset as { attachments: string[] }).attachments,
			).not.toContain(media.receiptIds[0]);
			await page
				.getByRole("button", { name: zh ? "归还" : "Return item" })
				.click();
			await expect(page.locator(".asset-profile-card")).not.toContainText(
				"Ada",
			);
			const returned = await itemState(page, id);
			expect(
				(returned.asset as { itemExpectedReturnDate: string })
					.itemExpectedReturnDate,
			).toBe("");
			expect(
				returned.history.filter(
					(row: { action: string }) => row.action === "return",
				),
			).toHaveLength(1);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
}
