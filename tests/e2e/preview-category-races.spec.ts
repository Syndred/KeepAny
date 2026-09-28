import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

async function savedProjectNames(page: Page): Promise<string[]> {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		return (await repository.allRecords())
			.filter((row: { type: string }) => row.type === "asset")
			.map((row: { payload: string }) => JSON.parse(row.payload))
			.filter(
				(asset: { kind: string; deleted: boolean }) =>
					asset.kind === "project" && !asset.deleted,
			)
			.map((asset: { name: string }) => asset.name);
	}, repositoryModuleUrl);
}

async function holdFileRead(
	page: Page,
	fileName: string,
	method: "text" | "arrayBuffer",
) {
	await page.evaluate(
		({ fileName, method }) => {
			const host = window as typeof window & {
				__heldReadStarted?: boolean;
				__releaseHeldRead?: () => void;
			};
			const original = File.prototype[method];
			let release: () => void = () => {};
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			host.__releaseHeldRead = release;
			if (method === "text") {
				File.prototype.text = function (this: File) {
					if (this.name !== fileName)
						return (original as File["text"]).call(this);
					host.__heldReadStarted = true;
					return gate.then(() => (original as File["text"]).call(this));
				};
			} else {
				File.prototype.arrayBuffer = function (this: File) {
					if (this.name !== fileName)
						return (original as File["arrayBuffer"]).call(this);
					host.__heldReadStarted = true;
					return gate.then(() => (original as File["arrayBuffer"]).call(this));
				};
			}
		},
		{ fileName, method },
	);
}

async function releaseHeldRead(page: Page) {
	await page.evaluate(() => {
		const host = window as typeof window & { __releaseHeldRead?: () => void };
		host.__releaseHeldRead?.();
	});
	await page.waitForTimeout(100);
}

test("late old CSV cannot replace a newer URL preview or be imported", async ({
	page,
}) => {
	await page.goto("/intake");
	await holdFileRead(page, "held.csv", "text");
	await page.locator("#csv-file").setInputFiles({
		name: "held.csv",
		mimeType: "text/csv",
		buffer: Buffer.from("name,kind\nOld CSV,project"),
	});
	await expect
		.poll(() =>
			page.evaluate(() =>
				Boolean(
					(window as typeof window & { __heldReadStarted?: boolean })
						.__heldReadStarted,
				),
			),
		)
		.toBe(true);
	await page.locator("#import-url").fill("https://new.example/");
	await page
		.locator("section.card")
		.filter({ has: page.getByRole("heading", { name: "Confirm import" }) })
		.getByRole("button", { name: "Preview" })
		.click();
	await expect(page.locator(".import-preview")).toContainText("new.example");
	await releaseHeldRead(page);
	await expect(page.locator(".import-preview")).toContainText("new.example");
	await expect(page.locator(".import-preview")).not.toContainText("Old CSV");
	await page.getByRole("button", { name: "Confirm import" }).last().click();
	await expect.poll(() => savedProjectNames(page)).toEqual(["new.example"]);
});

test("late valid CSV cannot revive candidates after a newer broken CSV", async ({
	page,
}) => {
	await page.goto("/intake");
	await holdFileRead(page, "held.csv", "text");
	await page.locator("#csv-file").setInputFiles({
		name: "held.csv",
		mimeType: "text/csv",
		buffer: Buffer.from("name,kind\nOld CSV,project"),
	});
	await expect
		.poll(() =>
			page.evaluate(() =>
				Boolean(
					(window as typeof window & { __heldReadStarted?: boolean })
						.__heldReadStarted,
				),
			),
		)
		.toBe(true);
	await page.locator("#csv-file").setInputFiles({
		name: "broken.csv",
		mimeType: "text/csv",
		buffer: Buffer.from('name,kind\n"unterminated,project'),
	});
	await expect(page.locator(".notice[role='status']")).toContainText(
		"Could not finish. Please try again.",
	);
	await releaseHeldRead(page);
	await expect(page.locator(".import-preview")).toHaveCount(0);
	await expect(page.locator(".notice[role='status']")).toContainText(
		"Could not finish. Please try again.",
	);
	await page.locator("#csv-file").setInputFiles({
		name: "retry.csv",
		mimeType: "text/csv",
		buffer: Buffer.from("name,kind\nRetry CSV,project"),
	});
	await expect(page.locator(".import-preview")).toContainText("Retry CSV");
	await page.getByRole("button", { name: "Confirm import" }).last().click();
	await expect.poll(() => savedProjectNames(page)).toEqual(["Retry CSV"]);
});

test("late old CSV cannot replace a newer valid CSV", async ({ page }) => {
	await page.goto("/intake");
	await holdFileRead(page, "held.csv", "text");
	await page.locator("#csv-file").setInputFiles({
		name: "held.csv",
		mimeType: "text/csv",
		buffer: Buffer.from("name,kind\nOld CSV,project"),
	});
	await expect
		.poll(() =>
			page.evaluate(() =>
				Boolean(
					(window as typeof window & { __heldReadStarted?: boolean })
						.__heldReadStarted,
				),
			),
		)
		.toBe(true);
	await page.locator("#csv-file").setInputFiles({
		name: "new.csv",
		mimeType: "text/csv",
		buffer: Buffer.from("name,kind\nNew CSV,project"),
	});
	await expect(page.locator(".import-preview")).toContainText("New CSV");
	await releaseHeldRead(page);
	await expect(page.locator(".import-preview")).toContainText("New CSV");
	await expect(page.locator(".import-preview")).not.toContainText("Old CSV");
	await page.getByRole("button", { name: "Confirm import" }).last().click();
	await expect.poll(() => savedProjectNames(page)).toEqual(["New CSV"]);
});

test("late URL preview cannot reappear after editing the URL", async ({
	page,
}) => {
	await page.goto("/intake");
	const uiRepositoryUrl = await page.evaluate(() =>
		performance
			.getEntriesByType("resource")
			.map((entry) => entry.name)
			.find((name) => name.includes("/packages/local-db/src/index.ts")),
	);
	if (!uiRepositoryUrl) throw Error("local repository module not loaded");
	await page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		const original = repository.allRecords.bind(repository);
		const host = window as typeof window & {
			__oldUrlBlocked?: boolean;
			__releaseOldUrl?: () => void;
		};
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		host.__releaseOldUrl = release;
		let first = true;
		repository.allRecords = async () => {
			if (first) {
				first = false;
				host.__oldUrlBlocked = true;
				await gate;
			}
			return original();
		};
	}, uiRepositoryUrl);
	const importCard = page.locator("section.card").filter({
		has: page.getByRole("heading", { name: "Confirm import" }),
	});
	await page.locator("#import-url").fill("https://old.example/");
	await importCard.getByRole("button", { name: "Preview" }).click();
	await expect
		.poll(() =>
			page.evaluate(() =>
				Boolean(
					(window as typeof window & { __oldUrlBlocked?: boolean })
						.__oldUrlBlocked,
				),
			),
		)
		.toBe(true);
	await page.locator("#import-url").fill("https://new.example/");
	await importCard.getByRole("button", { name: "Preview" }).click();
	await expect(importCard.locator(".import-preview")).toContainText(
		"new.example",
	);
	await page.evaluate(() => {
		(
			window as typeof window & { __releaseOldUrl?: () => void }
		).__releaseOldUrl?.();
	});
	await page.waitForTimeout(100);
	await expect(importCard.locator(".import-preview")).toContainText(
		"new.example",
	);
	await expect(importCard.locator(".import-preview")).not.toContainText(
		"old.example",
	);
	await importCard.getByRole("button", { name: "Confirm import" }).click();
	await expect.poll(() => savedProjectNames(page)).toEqual(["new.example"]);
});

test("late restore inspection cannot enable confirmation for a replaced file", async ({
	page,
}) => {
	await page.goto("/intake");
	const backupCard = page.locator("section.card").filter({
		has: page.getByRole("heading", { name: "Encrypted backup" }),
	});
	await backupCard.locator("#backup-password").fill("test-only-backup-2026");
	await backupCard.getByRole("button", { name: "Create backup" }).click();
	const saveFile = backupCard.getByRole("link", { name: "Save backup file" });
	await expect(saveFile).toBeVisible();
	const downloadPromise = page.waitForEvent("download");
	await saveFile.click();
	const filePath = await (await downloadPromise).path();
	if (!filePath) throw Error("backup download missing");
	const bytes = readFileSync(filePath);
	await holdFileRead(page, "held.ka1", "arrayBuffer");
	await backupCard.locator("#restore-file").setInputFiles({
		name: "held.ka1",
		mimeType: "application/octet-stream",
		buffer: bytes,
	});
	await backupCard.getByRole("button", { name: "Preview" }).click();
	await expect
		.poll(() =>
			page.evaluate(() =>
				Boolean(
					(window as typeof window & { __heldReadStarted?: boolean })
						.__heldReadStarted,
				),
			),
		)
		.toBe(true);
	await backupCard.locator("#restore-file").setInputFiles({
		name: "broken.ka1",
		mimeType: "application/octet-stream",
		buffer: Buffer.from([1, 2, 3]),
	});
	await backupCard.getByRole("button", { name: "Preview" }).click();
	await expect(page.locator(".notice[role='status']")).toContainText(
		"Incorrect password or damaged backup",
	);
	await releaseHeldRead(page);
	await expect(
		backupCard.getByRole("button", { name: /Confirm ·/ }),
	).toHaveCount(0);
	await backupCard.locator("#restore-file").setInputFiles({
		name: "retry.ka1",
		mimeType: "application/octet-stream",
		buffer: bytes,
	});
	await backupCard.getByRole("button", { name: "Preview" }).click();
	await expect(
		backupCard.getByRole("button", { name: /Confirm ·/ }),
	).toBeVisible();
});

test("same-tab double click and two tabs create only one normalized category", async ({
	browser,
}) => {
	const context = await browser.newContext({ locale: "en-US" });
	const first = await context.newPage();
	const second = await context.newPage();
	try {
		await Promise.all([
			first.goto("/assets/project"),
			second.goto("/assets/project"),
		]);
		const dialogs = await Promise.all(
			[first, second].map(async (page) => {
				await page.getByRole("button", { name: "Manage" }).click();
				return page.getByRole("dialog", { name: "Category" });
			}),
		);
		await dialogs[0].getByLabel("Category name").fill("  Race Category  ");
		await dialogs[1].getByLabel("Category name").fill("race category");
		await Promise.all(
			dialogs.map((dialog) =>
				dialog.getByRole("button", { name: "Save" }).click(),
			),
		);
		await expect
			.poll(
				async () =>
					Number(await dialogs[0].isVisible()) +
					Number(await dialogs[1].isVisible()),
			)
			.toBe(1);
		const loser = (await dialogs[0].isVisible()) ? dialogs[0] : dialogs[1];
		await expect(loser.getByRole("alert")).toHaveText(
			"This category already exists.",
		);
		await expect
			.poll(async () =>
				first.evaluate(async (modulePath) => {
					const { localRepository } = await import(modulePath);
					const rows = await (await localRepository()).allRecords();
					return rows.filter(
						(row: { type: string; payload: string }) =>
							row.type === "category" && !JSON.parse(row.payload).deleted,
					).length;
				}, repositoryModuleUrl),
			)
			.toBe(1);
		await loser.getByLabel("Category name").fill("Retry Category");
		await loser.getByRole("button", { name: "Save" }).click();
		await expect(loser).toBeHidden();
		await first.getByRole("button", { name: "Manage" }).click();
		const doubleDialog = first.getByRole("dialog", { name: "Category" });
		await doubleDialog.getByLabel("Category name").fill("Double Category");
		await doubleDialog
			.getByRole("button", { name: "Save" })
			.evaluate((button) => {
				(button as HTMLButtonElement).click();
				(button as HTMLButtonElement).click();
			});
		await expect(doubleDialog).toBeHidden();
		await expect
			.poll(async () =>
				first.evaluate(async (modulePath) => {
					const { localRepository } = await import(modulePath);
					const rows = await (await localRepository()).allRecords();
					return rows.filter(
						(row: { type: string; payload: string }) =>
							row.type === "category" &&
							!JSON.parse(row.payload).deleted &&
							JSON.parse(row.payload).name === "Double Category",
					).length;
				}, repositoryModuleUrl),
			)
			.toBe(1);
	} finally {
		await context.close();
	}
});
