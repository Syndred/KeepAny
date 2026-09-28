import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const evidence = "docs/evidence/2026-09-29";
const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

type AssetState = {
	id: string;
	name: string;
	attachments: string[];
	deleted: boolean;
};

async function savedAsset(
	page: Page,
	id: string,
): Promise<AssetState | undefined> {
	return page.evaluate(
		async ({ modulePath, assetId }) => {
			const { localRepository } = await import(modulePath);
			const repository = await localRepository();
			const row = (await repository.allRecords()).find(
				(value: { id: string; type: string }) =>
					value.type === "asset" && value.id === `asset:${assetId}`,
			);
			return row ? JSON.parse(row.payload) : undefined;
		},
		{ modulePath: repositoryModuleUrl, assetId: id },
	);
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

async function installDeleteGate(page: Page, id: string) {
	await page.evaluate(
		async ({ modulePath, assetId }) => {
			const { localRepository } = await import(modulePath);
			const repository = await localRepository();
			const storage = repository.db.records.storageInstance;
			const originalWrite = storage.bulkWrite.bind(storage);
			let release: (() => void) | undefined;
			let entered = false;
			let attempts = 0;
			const gate = {
				entered: () => entered,
				attempts: () => attempts,
				release: () => release?.(),
			};
			(window as Window & { __deleteRaceGate?: typeof gate }).__deleteRaceGate =
				gate;
			storage.bulkWrite = async (
				rows: Parameters<typeof originalWrite>[0],
				context: Parameters<typeof originalWrite>[1],
			) => {
				const writes = rows as {
					document: { id: string; type: string; payload: string };
				}[];
				if (
					writes.some((row) => {
						if (
							row.document.id !== `asset:${assetId}` ||
							row.document.type !== "asset"
						)
							return false;
						return (
							(JSON.parse(row.document.payload) as { deleted?: boolean })
								.deleted === true
						);
					})
				) {
					attempts++;
					if (!entered) {
						entered = true;
						await new Promise<void>((resolve) => {
							release = resolve;
						});
					}
				}
				return originalWrite(rows, context);
			};
		},
		{ modulePath: repositoryModuleUrl, assetId: id },
	);
}

test("stale detail delete cannot erase another tab's rename and replacement image", async ({
	browser,
}) => {
	test.skip(
		process.env.KEEPANY_DELETE_RACE_MODE === "preview",
		"This deterministic storage gate uses the development source module.",
	);
	test.setTimeout(120_000);
	mkdirSync(evidence, { recursive: true });
	const suffix = crypto.randomUUID().slice(0, 8);
	const initial = `Delete race ${suffix}`;
	const updated = `${initial} updated`;
	const password = `delete-race-${suffix}-2026`;
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 1280, height: 844 },
		acceptDownloads: true,
	});
	const first = await context.newPage();
	const second = await context.newPage();
	first.setDefaultTimeout(15_000);
	second.setDefaultTimeout(15_000);
	const errors: string[] = [];
	first.on("pageerror", (error) => errors.push(error.message));
	second.on("pageerror", (error) => errors.push(error.message));
	try {
		await first.goto("/assets/project");
		await first.getByRole("button", { name: "Add", exact: true }).click();
		const create = first.getByRole("dialog");
		await create.getByLabel("Name", { exact: true }).fill(initial);
		await create.getByRole("button", { name: "Save" }).click();
		await expect(create).toBeHidden();
		await first
			.locator("main.page .list-row")
			.filter({ hasText: initial })
			.click();
		await expect(first.getByRole("heading", { name: initial })).toBeVisible();
		const assetId = new URL(first.url()).pathname.split("/").at(-1);
		if (!assetId) throw Error("Project ID missing from detail URL");
		const original = await png(first, "#d23b45");
		await first.getByLabel("Add image").setInputFiles({
			name: "before.png",
			mimeType: "image/png",
			buffer: original,
		});
		await first
			.getByRole("dialog")
			.getByRole("button", { name: "Confirm" })
			.click();
		await expect(first.locator(".asset-image")).toHaveCount(1);
		const oldFile = (await files(first))[0];
		expect(oldFile.bytes).toEqual(Array.from(original));

		await second.goto(first.url());
		await expect(second.getByRole("heading", { name: initial })).toBeVisible();
		await expect(second.locator(".asset-image")).toHaveCount(1);
		await second.evaluate(async (modulePath) => {
			const { localRepository } = await import(modulePath);
			await localRepository();
		}, repositoryModuleUrl);

		await first.getByRole("button", { name: "Move to trash" }).click();
		const confirm = first.getByRole("dialog");
		await confirm.getByRole("button", { name: "Cancel" }).click();
		await expect(confirm).toBeHidden();
		expect((await savedAsset(first, assetId))?.deleted).toBe(false);
		await installDeleteGate(first, assetId);
		await first.getByRole("button", { name: "Move to trash" }).click();
		await first
			.getByRole("dialog")
			.getByRole("button", { name: "Move to trash" })
			.dblclick();
		await first.waitForFunction(() =>
			(
				window as Window & { __deleteRaceGate?: { entered: () => boolean } }
			).__deleteRaceGate?.entered(),
		);

		await second.getByRole("button", { name: "Edit", exact: true }).click();
		const edit = second.getByRole("dialog");
		await edit.getByLabel("Name", { exact: true }).fill(updated);
		await edit.getByRole("button", { name: "Save" }).click();
		await expect(edit).toBeHidden();
		await expect(second.getByRole("heading", { name: updated })).toBeVisible();
		const replacement = await png(second, "#2486c1");
		const chooserEvent = second.waitForEvent("filechooser");
		await second.getByRole("button", { name: "Replace image" }).click();
		await (await chooserEvent).setFiles({
			name: "after.png",
			mimeType: "image/png",
			buffer: replacement,
		});
		await second
			.getByRole("dialog")
			.getByRole("button", { name: "Confirm" })
			.click();
		await expect(second.locator(".asset-image")).toHaveCount(1);
		await expect
			.poll(async () => (await files(second))[0]?.name)
			.toBe("after.png");
		const latestFile = (await files(second))[0];
		expect(await files(second)).toHaveLength(1);
		expect(latestFile.id).not.toBe(oldFile.id);
		expect(latestFile.bytes).toEqual(Array.from(replacement));
		expect(await savedAsset(second, assetId)).toMatchObject({
			name: updated,
			attachments: [latestFile.id],
			deleted: false,
		});

		await first.evaluate(() =>
			(
				window as Window & { __deleteRaceGate?: { release: () => void } }
			).__deleteRaceGate?.release(),
		);
		await expect(confirm.getByRole("alert")).toHaveText(
			"This record changed. Nothing was deleted. Close this dialog, review the latest record, and try again.",
		);
		await expect(confirm).toBeVisible();
		expect(
			await first.evaluate(() =>
				(
					window as Window & { __deleteRaceGate?: { attempts: () => number } }
				).__deleteRaceGate?.attempts(),
			),
		).toBe(1);
		expect(await savedAsset(second, assetId)).toMatchObject({
			name: updated,
			attachments: [latestFile.id],
			deleted: false,
		});
		await first.screenshot({
			path: `${evidence}/delete-race-en-1280-stale.png`,
		});
		await confirm.getByRole("button", { name: "Cancel" }).click();
		await expect(first.getByRole("heading", { name: updated })).toBeVisible();
		await expect(first.locator(".asset-image")).toHaveCount(1);

		await first.getByRole("button", { name: "Move to trash" }).click();
		await first
			.getByRole("dialog")
			.getByRole("button", { name: "Move to trash" })
			.click();
		await expect(first).toHaveURL(/\/assets\/project$/);
		await first.goto("/trash");
		const deleted = first
			.locator("main.page .list-row")
			.filter({ hasText: updated });
		await expect(deleted).toBeVisible();
		await deleted.getByRole("button", { name: "Restore" }).click();
		await expect(deleted).toHaveCount(0);
		await first.goto(`/assets/project/${assetId}`);
		await expect(first.getByRole("heading", { name: updated })).toBeVisible();
		await expect(first.locator(".asset-image")).toHaveCount(1);
		expect(await savedAsset(first, assetId)).toMatchObject({
			name: updated,
			attachments: [latestFile.id],
			deleted: false,
		});
		expect(await files(first)).toEqual([latestFile]);
		await first.screenshot({
			path: `${evidence}/delete-race-en-1280-restored.png`,
		});

		await first.goto("/intake");
		await first.locator("#backup-password").fill(password);
		await first.getByRole("button", { name: "Create backup" }).click();
		const downloadEvent = first.waitForEvent("download");
		await first.getByRole("link", { name: "Save backup file" }).click();
		const backupPath = await (await downloadEvent).path();
		if (!backupPath) throw Error("The browser did not save the .ka1 file");
		const destination = await browser.newContext({
			locale: "zh-CN",
			viewport: { width: 390, height: 844 },
		});
		const restored = await destination.newPage();
		restored.on("pageerror", (error) => errors.push(error.message));
		try {
			await restored.goto("/intake");
			await restored.locator("#backup-password").fill(password);
			await restored.locator("#restore-file").setInputFiles(backupPath);
			await restored
				.getByRole("button", { name: "预览", exact: true })
				.first()
				.click();
			await restored.getByRole("button", { name: /确认 ·/ }).click();
			await expect(restored.getByText(/已恢复 \d+ 条记录/)).toBeVisible();
			await restored.goto(`/assets/project/${assetId}`);
			await expect(
				restored.getByRole("heading", { name: updated }),
			).toBeVisible();
			await expect(restored.locator(".asset-image")).toHaveCount(1);
			expect(await savedAsset(restored, assetId)).toMatchObject({
				name: updated,
				attachments: [latestFile.id],
				deleted: false,
			});
			expect(await files(restored)).toEqual([latestFile]);
			await restored.screenshot({
				path: `${evidence}/delete-race-zh-390-backup-restored.png`,
			});
		} finally {
			await destination.close();
		}
		expect(errors).toEqual([]);
	} finally {
		await first
			.evaluate(() =>
				(
					window as Window & { __deleteRaceGate?: { release: () => void } }
				).__deleteRaceGate?.release(),
			)
			.catch(() => {});
		await context.close();
	}
});

test("Chinese stale deletion dialog keeps the current record and explains the retry", async ({
	browser,
}) => {
	test.skip(
		process.env.KEEPANY_DELETE_RACE_MODE === "preview",
		"This deterministic storage gate uses the development source module.",
	);
	test.setTimeout(90_000);
	mkdirSync(evidence, { recursive: true });
	const suffix = crypto.randomUUID().slice(0, 8);
	const initial = `删除竞态 ${suffix}`;
	const updated = `${initial} 已更新`;
	const context = await browser.newContext({
		locale: "zh-CN",
		viewport: { width: 390, height: 844 },
	});
	const first = await context.newPage();
	const second = await context.newPage();
	try {
		await first.goto("/assets/project");
		await first.getByRole("button", { name: "新增", exact: true }).click();
		const create = first.getByRole("dialog");
		await create.getByLabel("名称", { exact: true }).fill(initial);
		await create.getByRole("button", { name: "保存" }).click();
		await expect(create).toBeHidden();
		await first
			.locator("main.page .list-row")
			.filter({ hasText: initial })
			.click();
		await expect(first.getByRole("heading", { name: initial })).toBeVisible();
		const assetId = new URL(first.url()).pathname.split("/").at(-1);
		if (!assetId) throw Error("Project ID missing from detail URL");
		await second.goto(first.url());
		await expect(second.getByRole("heading", { name: initial })).toBeVisible();
		await installDeleteGate(first, assetId);
		await first.getByRole("button", { name: "移至回收站" }).click();
		const confirm = first.getByRole("dialog");
		await confirm.getByRole("button", { name: "移至回收站" }).click();
		await first.waitForFunction(() =>
			(
				window as Window & { __deleteRaceGate?: { entered: () => boolean } }
			).__deleteRaceGate?.entered(),
		);
		await second.getByRole("button", { name: "编辑", exact: true }).click();
		const edit = second.getByRole("dialog");
		await edit.getByLabel("名称", { exact: true }).fill(updated);
		await edit.getByRole("button", { name: "保存" }).click();
		await expect(edit).toBeHidden();
		await expect(second.getByRole("heading", { name: updated })).toBeVisible();
		await first.evaluate(() =>
			(
				window as Window & { __deleteRaceGate?: { release: () => void } }
			).__deleteRaceGate?.release(),
		);
		await expect(confirm.getByRole("alert")).toHaveText(
			"资料已更新，删除未执行。请关闭弹窗核对最新资料后重试。",
		);
		await expect(confirm).toBeVisible();
		expect(await savedAsset(first, assetId)).toMatchObject({
			name: updated,
			deleted: false,
		});
		await first.screenshot({
			path: `${evidence}/delete-race-zh-390-stale.png`,
		});
	} finally {
		await first
			.evaluate(() =>
				(
					window as Window & { __deleteRaceGate?: { release: () => void } }
				).__deleteRaceGate?.release(),
			)
			.catch(() => {});
		await context.close();
	}
});
