import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const evidence = "docs/evidence/2026-09-29";
const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

type Asset = {
	id: string;
	kind: string;
	name: string;
	category: string;
	tags: string[];
	amount: number;
	discountAmount: number;
	dueDate: string;
	purchaseDate: string;
	warrantyDate: string;
	location: string;
	attachments: string[];
	deleted: boolean;
};

async function assets(page: Page): Promise<Asset[]> {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		return (await repository.allRecords())
			.filter((row: { type: string }) => row.type === "asset")
			.map((row: { payload: string }) => JSON.parse(row.payload))
			.sort((left: Asset, right: Asset) => left.id.localeCompare(right.id));
	}, repositoryModuleUrl);
}

async function files(
	page: Page,
): Promise<{ id: string; name: string; bytes: number[] }[]> {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		return Promise.all(
			(await repository.fileStore.blobs.toArray()).map(
				async (file: { id: string; name: string; blob: Blob }) => ({
					id: file.id,
					name: file.name,
					bytes: Array.from(new Uint8Array(await file.blob.arrayBuffer())),
				}),
			),
		);
	}, repositoryModuleUrl);
}

async function renewalHistory(
	page: Page,
	assetId: string,
): Promise<{ id: string; assetId: string; action: string; amount: number }[]> {
	return page.evaluate(
		async ({ modulePath, id }) => {
			const { localRepository } = await import(modulePath);
			const repository = await localRepository();
			return (await repository.list("history"))
				.filter(
					(row: { assetId: string; action: string }) =>
						row.assetId === id && row.action === "renew",
				)
				.sort((left: { id: string }, right: { id: string }) =>
					left.id.localeCompare(right.id),
				);
		},
		{ modulePath: repositoryModuleUrl, id: assetId },
	);
}

async function png(page: Page, color: string): Promise<Buffer> {
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

async function create(page: Page, kind: "subscription" | "item", name: string) {
	await page.goto(`/assets/${kind}`);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name", { exact: true }).fill(name);
	return dialog;
}

async function save(page: Page) {
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog).toBeHidden();
}

async function detail(page: Page, name: string) {
	await page
		.locator("main.page .list-row")
		.filter({ hasText: name })
		.first()
		.click();
	await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function trashCycle(
	page: Page,
	kind: "subscription" | "item",
	name: string,
) {
	await page
		.locator("main.page > .page-header")
		.getByRole("button", { name: "Move to trash" })
		.click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByRole("heading", { name })).toBeVisible();
	await page
		.locator("main.page > .page-header")
		.getByRole("button", { name: "Move to trash" })
		.click();
	await dialog.getByRole("button", { name: "Move to trash" }).click();
	await expect(page).toHaveURL(new RegExp(`/assets/${kind}$`));
	await page.goto("/trash");
	const row = page.locator("main.page .list-row").filter({ hasText: name });
	await expect(row).toBeVisible();
	await row.getByRole("button", { name: "Restore" }).click();
	await expect(row).toHaveCount(0);
	await page.goto(`/assets/${kind}`);
	await expect(
		page.locator("main.page .list-row").filter({ hasText: name }),
	).toBeVisible();
}

test("subscription and item shared CRUD, filters, image and actual backup restore", async ({
	browser,
}) => {
	test.setTimeout(180_000);
	mkdirSync(evidence, { recursive: true });
	const suffix = crypto.randomUUID().slice(0, 8);
	const subscription = `Subscription ${suffix}`;
	const subscriptionSaved = `Edited subscription ${suffix}`;
	const subscriptionOther = `Other subscription ${suffix}`;
	const item = `Camera ${suffix}`;
	const itemSaved = `Edited camera ${suffix}`;
	const itemOther = `Other item ${suffix}`;
	const tag = `matrix-${suffix}`;
	const longTag = "T".repeat(60);
	const location = "L".repeat(300);
	const password = `subscription-item-${suffix}-2026`;
	const source = await browser.newContext({
		locale: "en-US",
		timezoneId: "America/New_York",
		acceptDownloads: true,
		viewport: { width: 1280, height: 844 },
	});
	const page = await source.newPage();
	page.setDefaultTimeout(15_000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		const subscriptionCreate = await create(page, "subscription", subscription);
		await subscriptionCreate.locator("#amount").fill("");
		await subscriptionCreate
			.getByLabel("Tags (comma separated)")
			.pressSequentially("alpha, beta");
		await expect(
			subscriptionCreate.getByLabel("Tags (comma separated)"),
		).toHaveValue("alpha, beta");
		await subscriptionCreate
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 98 }, (_, index) => `sub${index}`),
				].join(","),
			);
		await save(page);
		await detail(page, subscription);
		const subscriptionId = new URL(page.url()).pathname.split("/").at(-1);
		if (!subscriptionId) throw Error("Subscription ID missing");
		expect(
			(await assets(page)).find((asset) => asset.id === subscriptionId),
		).toMatchObject({
			amount: 0,
			discountAmount: 0,
			dueDate: "",
			tags: expect.arrayContaining([tag, longTag]),
		});
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const subscriptionEdit = page.getByRole("dialog");
		await subscriptionEdit
			.getByLabel("Name", { exact: true })
			.fill("Cancelled subscription edit");
		await subscriptionEdit.getByRole("button", { name: "Cancel" }).click();
		await expect(
			page.getByRole("heading", { name: subscription }),
		).toBeVisible();
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		await subscriptionEdit.locator("#amount").fill("12.345");
		await subscriptionEdit.getByRole("button", { name: "Save" }).click();
		await expect(subscriptionEdit.locator("#amount-error")).toBeVisible();
		expect(
			(await assets(page)).find((asset) => asset.id === subscriptionId)?.amount,
		).toBe(0);
		await subscriptionEdit.locator("#amount").fill("12.34");
		await subscriptionEdit.locator("#discountAmount").fill("13");
		await subscriptionEdit.getByRole("button", { name: "Save" }).click();
		await expect(
			subscriptionEdit.locator("#discountAmount-error"),
		).toBeVisible();
		await subscriptionEdit.locator("#discountAmount").fill("2.34");
		await subscriptionEdit
			.getByLabel("Name", { exact: true })
			.fill(subscriptionSaved);
		await subscriptionEdit.locator("#dueDate").fill("2026-10-31");
		await subscriptionEdit.locator("#discountUntil").fill("2026-11-01");
		await save(page);
		await expect(
			page.getByRole("heading", { name: subscriptionSaved }),
		).toBeVisible();
		expect(
			(await assets(page)).find((asset) => asset.id === subscriptionId),
		).toMatchObject({
			amount: 1234,
			discountAmount: 234,
			dueDate: "2026-10-31",
		});
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		await subscriptionEdit.locator("#currency").selectOption("JPY");
		await subscriptionEdit.locator("#discountAmount").fill("0");
		await subscriptionEdit.getByRole("button", { name: "Save" }).click();
		await expect(subscriptionEdit.locator("#amount-error")).toBeVisible();
		await subscriptionEdit.locator("#currency").selectOption("CNY");
		await subscriptionEdit.locator("#amount").fill("90071992547409.92");
		await subscriptionEdit.getByRole("button", { name: "Save" }).click();
		await expect(subscriptionEdit.locator("#amount-error")).toBeVisible();
		await subscriptionEdit.locator("#amount").fill("90071992547409.91");
		await subscriptionEdit.locator("#discountAmount").fill("0");
		await save(page);
		expect(
			(await assets(page)).find((asset) => asset.id === subscriptionId)?.amount,
		).toBe(Number.MAX_SAFE_INTEGER);
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		await expect(subscriptionEdit.locator("#amount")).toHaveValue(
			"90071992547409.91",
		);
		await subscriptionEdit.getByRole("button", { name: "Cancel" }).click();
		await expect(
			page
				.locator("dt")
				.filter({ hasText: "Amount" })
				.first()
				.locator("..")
				.locator("dd"),
		).toContainText("90,071,992,547,409.91");
		await page.getByLabel("Locally recorded amount").fill("90071992547400.01");
		await page.getByRole("button", { name: "Record renewal" }).click();
		const history = page
			.locator("section.card")
			.filter({ has: page.getByRole("heading", { name: "History" }) })
			.locator(".list-row");
		await expect(history).toHaveCount(1);
		await expect(history.first()).toContainText("90,071,992,547,400.01");
		expect((await renewalHistory(page, subscriptionId))[0]?.amount).toBe(
			9_007_199_254_740_001,
		);
		const subscriptionBefore = await png(page, "#b83942");
		await page.getByLabel("Add image").setInputFiles({
			name: "subscription-before.png",
			mimeType: "image/png",
			buffer: subscriptionBefore,
		});
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Confirm" })
			.click();
		await expect(page.locator(".asset-image")).toHaveCount(1);
		const subscriptionOldFile = (await files(page))[0];
		const subscriptionAfter = await png(page, "#36906a");
		const subscriptionChooser = page.waitForEvent("filechooser");
		await page.getByRole("button", { name: "Replace image" }).click();
		await (await subscriptionChooser).setFiles({
			name: "subscription-after.png",
			mimeType: "image/png",
			buffer: subscriptionAfter,
		});
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Confirm" })
			.click();
		await expect
			.poll(async () => (await files(page))[0]?.name)
			.toBe("subscription-after.png");
		const subscriptionCurrentFile = (await files(page))[0];
		expect(await files(page)).toHaveLength(1);
		expect(subscriptionCurrentFile.id).not.toBe(subscriptionOldFile.id);
		expect(subscriptionCurrentFile.bytes).toEqual(
			Array.from(subscriptionAfter),
		);
		expect(
			(await assets(page)).find((asset) => asset.id === subscriptionId)
				?.attachments,
		).toEqual([subscriptionCurrentFile.id]);
		await page.getByRole("link", { name: "Back to list" }).click();
		await expect(
			page
				.locator("main.page .list-row")
				.filter({ hasText: subscriptionSaved }),
		).toContainText("90,071,992,547,409.91");
		const otherSubscription = await create(
			page,
			"subscription",
			subscriptionOther,
		);
		await otherSubscription.getByLabel("Category").selectOption("service");
		await save(page);

		const itemCreate = await create(page, "item", item);
		await itemCreate
			.getByLabel("Tags (comma separated)")
			.pressSequentially("alpha, beta");
		await expect(itemCreate.getByLabel("Tags (comma separated)")).toHaveValue(
			"alpha, beta",
		);
		await itemCreate
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 98 }, (_, index) => `item${index}`),
				].join(","),
			);
		await itemCreate.getByLabel("Purchase date").fill("2028-02-29");
		await itemCreate.getByLabel("Warranty ends").fill("2030-02-28");
		await save(page);
		await detail(page, item);
		const itemId = new URL(page.url()).pathname.split("/").at(-1);
		if (!itemId) throw Error("Item ID missing");
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const itemEdit = page.getByRole("dialog");
		await itemEdit
			.getByLabel("Name", { exact: true })
			.fill("Cancelled item edit");
		await itemEdit.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByRole("heading", { name: item })).toBeVisible();
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		await itemEdit.getByLabel("Name", { exact: true }).fill("");
		await itemEdit.getByRole("button", { name: "Save" }).click();
		await expect(itemEdit.locator("#name-error")).toBeVisible();
		await itemEdit.getByLabel("Name", { exact: true }).fill(itemSaved);
		await itemEdit.getByLabel("Location").fill("L".repeat(301));
		await itemEdit.getByRole("button", { name: "Save" }).click();
		await expect(itemEdit.locator("#location-error")).toBeVisible();
		await itemEdit.getByLabel("Location").fill(location);
		await itemEdit
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 99 }, (_, index) => `item${index}`),
				].join(","),
			);
		await itemEdit.getByRole("button", { name: "Save" }).click();
		await expect(itemEdit.locator("#tags-error")).toBeVisible();
		await itemEdit
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 98 }, (_, index) => `item${index}`),
				].join(","),
			);
		await save(page);
		await expect(page.getByRole("heading", { name: itemSaved })).toBeVisible();
		expect(
			(await assets(page)).find((asset) => asset.id === itemId),
		).toMatchObject({
			purchaseDate: "2028-02-29",
			warrantyDate: "2030-02-28",
			location,
			tags: expect.arrayContaining([tag, longTag]),
		});
		const oldImage = await png(page, "#d43b45");
		await page.getByLabel("Add image").setInputFiles({
			name: "item-before.png",
			mimeType: "image/png",
			buffer: oldImage,
		});
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Confirm" })
			.click();
		await expect(page.locator(".asset-image")).toHaveCount(1);
		const oldFile = (await files(page)).find(
			(file) => file.name === "item-before.png",
		);
		if (!oldFile) throw Error("Original item image missing");
		const newImage = await png(page, "#247fc0");
		const chooser = page.waitForEvent("filechooser");
		await page.getByRole("button", { name: "Replace image" }).click();
		await (await chooser).setFiles({
			name: "item-after.png",
			mimeType: "image/png",
			buffer: newImage,
		});
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Confirm" })
			.click();
		await expect
			.poll(
				async () =>
					(await files(page)).find((file) => file.name === "item-after.png")
						?.id,
			)
			.toBeTruthy();
		const currentFile = (await files(page)).find(
			(file) => file.name === "item-after.png",
		);
		if (!currentFile) throw Error("Replacement item image missing");
		expect(await files(page)).toHaveLength(2);
		expect(currentFile.id).not.toBe(oldFile.id);
		expect(currentFile.bytes).toEqual(Array.from(newImage));
		await page.screenshot({
			path: `${evidence}/crud-matrix-en-1280-item-image-replaced.png`,
		});
		await page.getByRole("link", { name: "Back to list" }).click();
		const otherItem = await create(page, "item", itemOther);
		await otherItem.getByLabel("Category").selectOption("other");
		await save(page);

		for (const [kind, category, categoryOther, name, id] of [
			[
				"subscription",
				"Software",
				"Services",
				subscriptionSaved,
				subscriptionId,
			],
			["item", "Devices", "Other", itemSaved, itemId],
		] as const) {
			await page.goto(`/assets/${kind}`);
			const search = page.getByRole("textbox", {
				name: "Search assets, tags…",
			});
			await page.getByRole("button", { name: category, exact: true }).click();
			await page.locator("#asset-tag-filter").selectOption({ label: tag });
			await search.fill(tag);
			await expect(page.locator("main.page .list-row")).toHaveCount(1);
			await page.getByRole("button", { name: category, exact: true }).click();
			await page.screenshot({
				path: `${evidence}/crud-matrix-en-1280-${kind}-filter.png`,
			});
			await page
				.getByRole("button", { name: categoryOther, exact: true })
				.click();
			await expect(page.locator("main.page .list-row")).toHaveCount(0);
			await page.screenshot({
				path: `${evidence}/crud-matrix-en-1280-${kind}-empty.png`,
			});
			await page.getByRole("button", { name: category, exact: true }).click();
			await page
				.locator("main.page .list-row")
				.filter({ hasText: name })
				.click();
			await expect(page.getByRole("heading", { name })).toBeVisible();
			await page.getByRole("link", { name: "Back to list" }).click();
			await expect(search).toHaveValue(tag);
			await expect(page.locator("#asset-tag-filter")).toHaveValue(tag);
			await expect(
				page.getByRole("button", { name: category, exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await page.reload();
			await expect(search).toHaveValue(tag);
			await expect(page.locator("#asset-tag-filter")).toHaveValue(tag);
			await search.fill(`no-results-${suffix}`);
			await expect(page.locator("main.page .list-row")).toHaveCount(0);
			await search.fill("");
			await page
				.locator("main.page .list-row")
				.filter({ hasText: name })
				.click();
			expect(
				(await assets(page)).find((asset) => asset.id === id)?.deleted,
			).toBe(false);
			await trashCycle(page, kind, name);
			await page.reload();
			await expect(
				page.locator("main.page .list-row").filter({ hasText: name }),
			).toBeVisible();
		}

		const before = (await assets(page)).filter((asset) =>
			[subscriptionSaved, itemSaved, subscriptionOther, itemOther].includes(
				asset.name,
			),
		);
		const beforeHistory = await renewalHistory(page, subscriptionId);
		expect(beforeHistory).toHaveLength(1);
		expect(before).toHaveLength(4);
		expect(
			before.find((asset) => asset.id === subscriptionId)?.tags,
		).toHaveLength(100);
		expect(before.find((asset) => asset.id === itemId)?.tags).toHaveLength(100);
		expect(before.find((asset) => asset.id === itemId)?.attachments).toEqual([
			currentFile.id,
		]);
		expect(
			before.find((asset) => asset.id === subscriptionId)?.attachments,
		).toEqual([subscriptionCurrentFile.id]);
		expect(before.every((asset) => !asset.deleted)).toBe(true);
		await page.goto("/intake");
		await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: "Create backup" }).click();
		const downloadEvent = page.waitForEvent("download");
		await page.getByRole("link", { name: "Save backup file" }).click();
		const backupPath = await (await downloadEvent).path();
		if (!backupPath) throw Error("The browser did not save the .ka1 file");
		const destination = await browser.newContext({
			locale: "zh-CN",
			timezoneId: "Asia/Shanghai",
			viewport: { width: 390, height: 844 },
		});
		const restored = await destination.newPage();
		restored.on("pageerror", (error) => errors.push(error.message));
		try {
			await restored.goto("/assets/item");
			await expect(restored.getByText(itemSaved)).toHaveCount(0);
			await restored.goto("/intake");
			await restored.locator("#backup-password").fill(password);
			await restored.locator("#restore-file").setInputFiles(backupPath);
			await restored
				.getByRole("button", { name: "预览", exact: true })
				.first()
				.click();
			await restored.getByRole("button", { name: /确认 ·/ }).click();
			await expect(restored.getByText(/已恢复 \d+ 条记录/)).toBeVisible();
			expect(
				(await assets(restored)).filter((asset) =>
					before.some((original) => original.id === asset.id),
				),
			).toEqual(before);
			expect(await renewalHistory(restored, subscriptionId)).toEqual(
				beforeHistory,
			);
			const restoredFiles = await files(restored);
			expect(restoredFiles).toHaveLength(2);
			expect(
				restoredFiles.find((file) => file.id === subscriptionCurrentFile.id),
			).toEqual(subscriptionCurrentFile);
			expect(restoredFiles.find((file) => file.id === currentFile.id)).toEqual(
				currentFile,
			);
			await restored.reload();
			await restored.goto(`/assets/item/${itemId}`);
			await expect(
				restored.getByRole("heading", { name: itemSaved }),
			).toBeVisible();
			await expect(restored.locator(".asset-image")).toHaveCount(1);
			expect(
				await restored.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(390);
			await restored.screenshot({
				path: `${evidence}/crud-matrix-zh-390-restored-item.png`,
			});
			await restored.goto(`/assets/subscription/${subscriptionId}`);
			await expect(
				restored.getByRole("heading", { name: subscriptionSaved }),
			).toBeVisible();
			await expect(restored.locator(".asset-image")).toHaveCount(1);
			expect(
				await restored.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(390);
			await restored.screenshot({
				path: `${evidence}/crud-matrix-zh-390-restored-subscription-image.png`,
				fullPage: true,
			});
		} finally {
			await destination.close();
		}
		await page.goto(`/assets/item/${itemId}`);
		await page.getByRole("button", { name: "Remove image" }).click();
		await expect(page.locator(".asset-image")).toHaveCount(0);
		await expect.poll(async () => (await files(page)).length).toBe(1);
		expect(
			(await assets(page)).find((asset) => asset.id === itemId)?.attachments,
		).toEqual([]);
		await page.goto(`/assets/subscription/${subscriptionId}`);
		await page.getByRole("button", { name: "Remove image" }).click();
		await expect(page.locator(".asset-image")).toHaveCount(0);
		await expect.poll(async () => (await files(page)).length).toBe(0);
		expect(
			(await assets(page)).find((asset) => asset.id === subscriptionId)
				?.attachments,
		).toEqual([]);
		expect(errors).toEqual([]);
	} finally {
		await source.close();
	}
});

test("renewal hint preserves cents and matches blank or typed payments for USD and JPY", async ({
	browser,
}) => {
	test.setTimeout(90_000);
	mkdirSync(evidence, { recursive: true });
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 390, height: 844 },
	});
	const page = await context.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		for (const [currency, amountText, minorUnits, visibleAmount] of [
			[
				"USD",
				"90071992547409.91",
				Number.MAX_SAFE_INTEGER,
				"$90,071,992,547,409.91",
			],
			[
				"JPY",
				"9007199254740991",
				Number.MAX_SAFE_INTEGER,
				"¥9,007,199,254,740,991",
			],
		] as const) {
			const name = `Hint ${currency} ${crypto.randomUUID().slice(0, 8)}`;
			const dialog = await create(page, "subscription", name);
			await dialog.locator("#currency").selectOption(currency);
			await dialog.locator("#amount").fill(amountText);
			await dialog.locator("#dueDate").fill("2026-10-31");
			await save(page);
			await detail(page, name);
			const assetId = new URL(page.url()).pathname.split("/").at(-1);
			if (!assetId) throw Error("Subscription ID missing");
			const input = page.getByLabel("Locally recorded amount");
			await expect(input).toHaveAttribute("placeholder", amountText);
			const hint = await input.getAttribute("placeholder");
			if (!hint) throw Error("Renewal hint missing");
			await expect(input).toHaveValue("");
			for (const width of [360, 390]) {
				await page.setViewportSize({ width, height: 844 });
				const layout = await input.evaluate((element: HTMLInputElement) => {
					const style = getComputedStyle(element);
					const canvas = document.createElement("canvas");
					const measure = canvas.getContext("2d");
					if (!measure) throw Error("Text measurement unavailable");
					measure.font = style.font;
					return {
						fontSize: Number.parseFloat(style.fontSize),
						available:
							element.clientWidth -
							Number.parseFloat(style.paddingLeft) -
							Number.parseFloat(style.paddingRight) -
							24,
						textWidth: measure.measureText(element.placeholder).width,
						scrollWidth: document.documentElement.scrollWidth,
					};
				});
				expect(layout.fontSize).toBeGreaterThanOrEqual(16);
				expect(layout.available).toBeGreaterThan(layout.textWidth);
				expect(layout.scrollWidth).toBeLessThanOrEqual(width);
			}
			await page.screenshot({
				path: `${evidence}/crud-matrix-en-390-${currency.toLowerCase()}-renewal-hint.png`,
				fullPage: true,
			});
			const history = page
				.locator("section.card")
				.filter({ has: page.getByRole("heading", { name: "History" }) })
				.locator(".list-row");
			await page.getByRole("button", { name: "Record renewal" }).click();
			await expect(history).toHaveCount(1);
			await expect(history.first()).toContainText(visibleAmount);
			await expect(input).toHaveAttribute("placeholder", amountText);
			await input.fill(hint);
			await page.getByRole("button", { name: "Record renewal" }).click();
			await expect(history).toHaveCount(2);
			for (const row of await history.all())
				await expect(row).toContainText(visibleAmount);
			if (process.env.KEEPANY_SUBSCRIPTION_MODE !== "preview")
				expect(
					(await renewalHistory(page, assetId)).map((row) => row.amount),
				).toEqual([minorUnits, minorUnits]);
			await page.reload();
			await expect(input).toHaveAttribute("placeholder", amountText);
			await expect(history).toHaveCount(2);
			if (process.env.KEEPANY_SUBSCRIPTION_MODE !== "preview")
				expect(
					(await renewalHistory(page, assetId)).map((row) => row.amount),
				).toEqual([minorUnits, minorUnits]);
		}
		expect(errors).toEqual([]);
	} finally {
		await context.close();
	}
});

for (const locale of ["en-US", "zh-CN"] as const) {
	for (const width of [360, 390, 768, 1280, 1440]) {
		test(`${locale} subscription and item entry and editor fit ${width}px`, async ({
			browser,
		}) => {
			test.setTimeout(90_000);
			mkdirSync(evidence, { recursive: true });
			const context = await browser.newContext({
				locale,
				viewport: { width, height: 844 },
			});
			const page = await context.newPage();
			const copy =
				locale === "zh-CN"
					? {
							add: "新增",
							name: "名称",
							save: "保存",
							cancel: "取消",
							notes: "备注",
							edit: "编辑",
							subscription: "订阅",
							item: "实物",
						}
					: {
							add: "Add",
							name: "Name",
							save: "Save",
							cancel: "Cancel",
							notes: "Notes",
							edit: "Edit",
							subscription: "Subscriptions",
							item: "Items",
						};
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			try {
				for (const [kind, label] of [
					["subscription", copy.subscription],
					["item", copy.item],
				] as const) {
					await page.goto(`/assets/${kind}`);
					await expect(
						page.getByRole("heading", { level: 1, name: label }),
					).toBeVisible();
					await page
						.getByRole("button", { name: copy.add, exact: true })
						.click();
					const dialog = page.getByRole("dialog");
					await expect(dialog).toBeVisible();
					const name = `${kind} ${locale} ${width} ${"L".repeat(90)}`;
					await dialog.getByLabel(copy.name, { exact: true }).fill(name);
					if (kind === "subscription")
						await dialog.locator("#amount").fill("12.34");
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
					if (width <= 390) {
						const sizes = await dialog
							.locator("input, textarea, select")
							.evaluateAll((elements) =>
								elements.map((element) =>
									Number.parseFloat(getComputedStyle(element).fontSize),
								),
							);
						expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
						await expect(
							dialog.getByRole("button", { name: copy.cancel }),
						).toBeInViewport({ ratio: 1 });
						await expect(
							dialog.getByRole("button", { name: copy.save }),
						).toBeInViewport({ ratio: 1 });
					}
					await page.screenshot({
						path: `${evidence}/crud-matrix-${locale === "zh-CN" ? "zh" : "en"}-${width}-${kind}-editor.png`,
					});
					if (width <= 390) {
						await dialog.evaluate((element) =>
							element.scrollTo({ top: element.scrollHeight }),
						);
						const notes = await dialog.getByLabel(copy.notes).boundingBox();
						const actions = await dialog
							.locator("form > .actions")
							.boundingBox();
						if (!notes || !actions)
							throw Error("Editor notes or actions missing");
						expect(notes.y + notes.height).toBeLessThanOrEqual(actions.y + 1);
						await page.screenshot({
							path: `${evidence}/crud-matrix-${locale === "zh-CN" ? "zh" : "en"}-${width}-${kind}-editor-tail.png`,
						});
					}
					await dialog.getByRole("button", { name: copy.save }).click();
					await expect(dialog).toBeHidden();
					await page
						.locator("main.page .list-row")
						.filter({ hasText: name })
						.click();
					await expect(page.getByRole("heading", { name })).toBeVisible();
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
					await page
						.getByRole("button", { name: copy.edit, exact: true })
						.click();
					await expect(page.getByRole("dialog")).toBeVisible();
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
				}
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
}
