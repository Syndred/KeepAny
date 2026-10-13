import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const evidence =
	process.env.KEEPANY_EVIDENCE_DIR ?? process.env.KEEPANY_LEGACY_EVIDENCE_DIR ?? "docs/evidence/2026-09-29";
const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

type StoredAsset = {
	id: string;
	kind: string;
	name: string;
	category: string;
	tags: string[];
	username: string;
	contact: string;
	description: string;
	attachments: string[];
	deleted: boolean;
};

async function assetRows(page: Page): Promise<StoredAsset[]> {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		return (await repository.allRecords())
			.filter((row: { type: string }) => row.type === "asset")
			.map((row: { payload: string }) => JSON.parse(row.payload))
			.sort((a: StoredAsset, b: StoredAsset) => a.id.localeCompare(b.id));
	}, repositoryModuleUrl);
}

async function storedFiles(
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

async function add(page: Page, kind: "project" | "account", name: string) {
	await page.goto(`/assets/${kind}`);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name", { exact: true }).fill(name);
	return dialog;
}

async function saveDialog(page: Page) {
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog).toBeHidden();
}

async function openDetail(page: Page, name: string) {
	const row = page
		.locator("main.page .list-row")
		.filter({ hasText: name })
		.first();
	if (await page.locator("#top-search-query").isVisible().catch(() => false)) {
		await row.focus();
		await page.keyboard.press("Enter");
	} else {
		await row.click();
	}
	await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function openSearchInput(page: Page) {
	const input = page.locator("#top-search-query");
	if (!(await input.isVisible().catch(() => false))) {
		await page
			.getByRole("button", { name: "Search all records", exact: true })
			.click();
	}
	await expect(input).toBeVisible();
	return input;
}

async function fillSearch(page: Page, value: string) {
	const input = await openSearchInput(page);
	await input.fill(value);
	await expect
		.poll(() => page.evaluate(() => sessionStorage.getItem("keepany-search") || ""))
		.toBe(value);
}

async function expectSearchValue(page: Page, value: string) {
	const input = await openSearchInput(page);
	await expect(input).toHaveValue(value);
}

async function expectPersistedListSearch(
	page: Page,
	kind: "project" | "account",
	value: string,
) {
	await expect
		.poll(() =>
			page.evaluate((assetKind) => {
				try {
					const raw = sessionStorage.getItem(`keepany-scroll-filter-${assetKind}`);
					return raw ? (JSON.parse(raw) as { search?: string }).search ?? "" : "";
				} catch {
					return "";
				}
			}, kind),
		)
		.toBe(value);
}

async function closeSearch(page: Page) {
	const input = page.locator("#top-search-query");
	if (await input.isVisible().catch(() => false)) await input.press("Escape");
	await expect(input).toBeHidden();
}

async function backToList(page: Page) {
	await page
		.getByRole("banner")
		.getByRole("link", { name: /^(Back to list|返回列表)$/ })
		.click();
}

async function openProjectMaterials(page: Page) {
	const materials = page.locator("#asset-project-materials");
	if (!page.url().includes("/assets/project/")) return;
	await expect(materials).toHaveCount(1);
	const initialOpen = await materials.evaluate((element) => (element as HTMLDetailsElement).open);
	if (!initialOpen) {
		const viewMaterials = page.getByRole("button", {
			name: /^(View submission materials|查看提交材料)$/,
		});
		if (await viewMaterials.count()) await viewMaterials.first().click();
		else await materials.locator("summary").click();
	}
	await expect
		.poll(() =>
			materials.evaluate((element) => (element as HTMLDetailsElement).open),
		)
		.toBe(true);
}

async function deleteAndRestore(
	page: Page,
	kind: "project" | "account",
	name: string,
) {
	const actions = page.locator(
		kind === "project"
			? "main.page > .asset-project-action-bar"
			: "main.page > .page-header",
	);
	await actions.getByRole("button", { name: "Move to trash" }).click();
	const confirm = page.getByRole("dialog");
	await confirm.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByRole("heading", { name })).toBeVisible();
	await actions.getByRole("button", { name: "Move to trash" }).click();
	await confirm.getByRole("button", { name: "Move to trash" }).click();
	await expect(page).toHaveURL(new RegExp(`/assets/${kind}$`));
	await expect(
		page.locator("main.page .list-row").filter({ hasText: name }),
	).toHaveCount(0);
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

test("project and account CRUD, intersecting filters, trash and actual backup restore", async ({
	browser,
}) => {
	test.setTimeout(180_000);
	mkdirSync(evidence, { recursive: true });
	const suffix = crypto.randomUUID().slice(0, 8);
	const project = `Project ${suffix} ${"P".repeat(140)}`;
	const projectSaved = `Edited project ${suffix}`;
	const account = `Account ${suffix}`;
	const accountSaved = `Edited account ${suffix}`;
	const otherProject = `Other project ${suffix}`;
	const tag = `intersection-${suffix}`;
	const longTag = "T".repeat(60);
	const longEmail = `${"e".repeat(250)}@example.test`;
	const password = `crud-backup-${suffix}-2026`;
	const source = await browser.newContext({
		locale: "en-US",
		acceptDownloads: true,
		viewport: { width: 1280, height: 800 },
	});
	const page = await source.newPage();
	page.setDefaultTimeout(15_000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		const projectDialog = await add(page, "project", project);
		await projectDialog
			.getByLabel("Tags (comma separated)")
			.pressSequentially("alpha, beta");
		await expect(
			projectDialog.getByLabel("Tags (comma separated)"),
		).toHaveValue("alpha, beta");
		await projectDialog
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 98 }, (_, index) => `tag${index}`),
				].join(","),
			);
		await projectDialog
			.getByLabel("Short description")
			.fill("Original project description");
		await saveDialog(page);
		await openDetail(page, project);
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const projectEdit = page.getByRole("dialog");
		await projectEdit
			.getByLabel("Name", { exact: true })
			.fill("Cancelled project rename");
		await projectEdit.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByRole("heading", { name: project })).toBeVisible();
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		await projectEdit.getByLabel("Name", { exact: true }).fill("");
		await projectEdit
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(
			projectEdit.getByText("Please check this field"),
		).toBeVisible();
		await expect(projectEdit).toBeVisible();
		await projectEdit.getByLabel("Name", { exact: true }).fill("N".repeat(161));
		await projectEdit
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(projectEdit.locator("#name-error")).toBeVisible();
		await projectEdit.getByLabel("Name", { exact: true }).fill(projectSaved);
		await projectEdit
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 99 }, (_, index) => `tag${index}`),
				].join(","),
			);
		await projectEdit
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(projectEdit.locator("#tags-error")).toBeVisible();
		await projectEdit
			.getByLabel("Tags (comma separated)")
			.fill(
				[
					tag,
					longTag,
					...Array.from({ length: 98 }, (_, index) => `tag${index}`),
				].join(","),
			);
		await projectEdit.getByLabel("Short description").fill("");
		await saveDialog(page);
		await expect(
			page.getByRole("heading", { name: projectSaved }),
		).toBeVisible();
		await expect(page.getByText("Cancelled project rename")).toHaveCount(0);
		await backToList(page);
		const otherDialog = await add(page, "project", otherProject);
		await selectChoice(otherDialog.getByLabel("Category"), "repository");
		await saveDialog(page);

		const accountDialog = await add(page, "account", account);
		await accountDialog
			.getByLabel("Username / identifier")
			.fill("e".repeat(301));
		await accountDialog
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(accountDialog.locator("#username-error")).toBeVisible();
		await accountDialog.getByLabel("Username / identifier").fill(longEmail);
		await accountDialog
			.getByLabel("Tags (comma separated)")
			.fill(`${tag}, account-only`);
		await saveDialog(page);
		await openDetail(page, account);
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const accountEdit = page.getByRole("dialog");
		await accountEdit
			.getByLabel("Name", { exact: true })
			.fill("Cancelled account rename");
		await accountEdit.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByRole("heading", { name: account })).toBeVisible();
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		await accountEdit.getByLabel("Name", { exact: true }).fill("");
		await accountEdit
			.getByRole("button", { name: "Save", exact: true })
			.click();
		await expect(
			accountEdit.getByText("Please check this field"),
		).toBeVisible();
		await accountEdit.getByLabel("Name", { exact: true }).fill(accountSaved);
		await accountEdit.getByLabel("Contact").fill("");
		await saveDialog(page);
		await expect(
			page.getByRole("heading", { name: accountSaved }),
		).toBeVisible();
		await backToList(page);

		await page.goto("/assets/project");
		await page.getByRole("button", { name: "Websites", exact: true }).click();
		await selectChoice(page.locator("#asset-tag-filter"), { label: tag });
		await fillSearch(page, tag);
		await expect(page.locator("main.page .list-row")).toHaveCount(1);
		await expect(
			page.locator("main.page .list-row").filter({ hasText: projectSaved }),
		).toBeVisible();
		await closeSearch(page);
		await page
			.getByRole("button", { name: "Repositories", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Repositories", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await fillSearch(page, tag);
		await expect(page.locator("main.page .list-row")).toHaveCount(0);
		await closeSearch(page);
		await page.getByRole("button", { name: "Websites", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Websites", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await fillSearch(page, tag);
		await openDetail(page, projectSaved);
		await backToList(page);
		await expectPersistedListSearch(page, "project", tag);
		await fillSearch(page, tag);
		await expectSearchValue(page, tag);
		await expect(
			page.getByRole("button", { name: "Websites", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(page.locator("#asset-tag-filter")).toHaveAttribute(
			"data-value",
			tag,
		);
		await page.reload();
		await expectPersistedListSearch(page, "project", tag);
		await fillSearch(page, tag);
		await expectSearchValue(page, tag);
		await expect(
			page.getByRole("button", { name: "Websites", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(page.locator("#asset-tag-filter")).toHaveAttribute(
			"data-value",
			tag,
		);
		await expect(page.locator("main.page .list-row")).toHaveCount(1);
		await fillSearch(page, `no-results-${suffix}`);
		await expect(page.locator("main.page .list-row")).toHaveCount(0);
		await fillSearch(page, "");
		await openDetail(page, projectSaved);
		await deleteAndRestore(page, "project", projectSaved);
		await page.reload();
		await expect(
			page.locator("main.page .list-row").filter({ hasText: projectSaved }),
		).toBeVisible();

		await page.goto("/assets/account");
		await page.getByRole("button", { name: "Email", exact: true }).click();
		await selectChoice(page.locator("#asset-tag-filter"), { label: tag });
		await fillSearch(page, longEmail);
		await expect(page.locator("main.page .list-row")).toHaveCount(1);
		await fillSearch(page, `no-results-${suffix}`);
		await expect(page.locator("main.page .list-row")).toHaveCount(0);
		await fillSearch(page, "");
		await openDetail(page, accountSaved);
		await deleteAndRestore(page, "account", accountSaved);
		await page.reload();
		await expect(
			page.locator("main.page .list-row").filter({ hasText: accountSaved }),
		).toBeVisible();
		const scrollCsv = [
			"name,kind,category",
			...Array.from(
				{ length: 45 },
				(_, index) =>
					`Scroll account ${suffix} ${String(index).padStart(2, "0")},account,email`,
			),
		].join("\n");
		await page.goto("/intake");
		await page
			.locator(".intake-mode-tabs")
			.getByRole("button", { name: "Spreadsheet" })
			.click();
		await page.locator("#csv-file").setInputFiles({
			name: "crud-scroll.csv",
			mimeType: "text/csv",
			buffer: Buffer.from(scrollCsv),
		});
		await expect(
			page.getByText("45 candidates are ready for review.", { exact: true }),
		).toBeVisible();
		await expect(page.locator(".intake-review-row")).toHaveCount(45);
		for (let index = 0; index < 45; index += 1) {
			const pending = page
				.locator(".intake-review-row")
				.filter({ has: page.getByRole("button", { name: "Confirm" }) })
				.first();
			await pending.getByRole("button", { name: "Confirm" }).click();
		}
		await expect(
			page.locator(".intake-review-row").getByRole("button", { name: "Confirm" }),
		).toHaveCount(0);
		await page.goto("/assets/account");
		await selectChoice(page.locator("#asset-tag-filter"), "");
		await fillSearch(page, `Scroll account ${suffix}`);
		await expect(page.locator("main.page .list-row")).toHaveCount(45);
		const target = page.locator("main.page .list-row").nth(30);
		const targetName = await target.locator("strong").innerText();
		await target.evaluate((element) =>
			element.scrollIntoView({ block: "center" }),
		);
		const scrolled = await page.evaluate(() => window.scrollY);
		expect(scrolled).toBeGreaterThan(1000);
		await openDetail(page, targetName);
		await backToList(page);
		await expectPersistedListSearch(page, "account", `Scroll account ${suffix}`);
		await fillSearch(page, `Scroll account ${suffix}`);
		await expectSearchValue(page, `Scroll account ${suffix}`);
		await expect(
			page.getByRole("button", { name: "Email", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(page.locator("#asset-tag-filter")).toHaveAttribute(
			"data-value",
			"",
		);
		await expect
			.poll(() => page.evaluate(() => window.scrollY))
			.toBeGreaterThan(1000);
		expect(
			Math.abs((await page.evaluate(() => window.scrollY)) - scrolled),
		).toBeLessThan(35);
		await page.screenshot({
			path: `${evidence}/crud-en-1280-account-filter-return.png`,
		});
		await fillSearch(page, "");

		const before = (await assetRows(page)).filter((asset) =>
			[projectSaved, accountSaved, otherProject].includes(asset.name),
		);
		expect(before).toHaveLength(3);
		expect(
			before.find((asset) => asset.name === projectSaved)?.tags,
		).toHaveLength(100);
		expect(
			before.find((asset) => asset.name === projectSaved)?.description,
		).toBe("");
		expect(before.find((asset) => asset.name === accountSaved)?.username).toBe(
			longEmail,
		);
		expect(before.every((asset) => !asset.deleted)).toBe(true);

		await page.goto("/intake");
		await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: "Create backup" }).click();
		const link = page.getByRole("link", { name: "Save backup file" });
		await expect(link).toBeVisible();
		const downloadPromise = page.waitForEvent("download");
		await link.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(
			/^stackperch-\d{4}-\d{2}-\d{2}\.ka1$/,
		);
		const backupPath = await download.path();
		if (!backupPath) throw Error("The browser did not save the .ka1 file");
		const destination = await browser.newContext({
			locale: "zh-CN",
			viewport: { width: 390, height: 844 },
		});
		const restored = await destination.newPage();
		restored.on("pageerror", (error) => errors.push(error.message));
		try {
			await restored.goto("/assets/project");
			await expect(restored.getByText(projectSaved)).toHaveCount(0);
			await restored.goto("/intake");
			await restored.locator("#backup-password").fill(password);
			await restored.locator("#restore-file").setInputFiles(backupPath);
			await restored
				.getByRole("button", { name: "预览", exact: true })
				.first()
				.click();
			const confirm = restored.getByRole("button", { name: /确认 ·/ });
			await expect(confirm).toBeVisible();
			await confirm.click();
			await expect(restored.getByText(/已恢复 \d+ 条记录/)).toBeVisible();
			const after = (await assetRows(restored)).filter((asset) =>
				[projectSaved, accountSaved, otherProject].includes(asset.name),
			);
			expect(after).toEqual(before);
			await restored.reload();
			await restored.goto("/assets/account");
			await expect(
				restored
					.locator("main.page .list-row")
					.filter({ hasText: accountSaved }),
			).toBeVisible();
			await restored.goto("/assets/project");
			await expect(
				restored
					.locator("main.page .list-row")
					.filter({ hasText: projectSaved }),
			).toBeVisible();
			await restored.screenshot({
				path: `${evidence}/crud-zh-390-restored-project.png`,
			});
		} finally {
			await destination.close();
		}
		expect(errors).toEqual([]);
	} finally {
		await source.close();
	}
});

test("a matching list search can restore scroll after navigation clears the temporary query", async ({ browser }) => {
	const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 844 } });
	const page = await context.newPage();
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const query = `Scroll match ${crypto.randomUUID().slice(0, 8)}`;
	const tag = `tag-${query}`;
	try {
		await page.goto("/assets/account");
		await page.evaluate(async ({ repositoryPath, domainPath, query, tag }) => {
			const { localRepository } = await import(repositoryPath);
			const { newAsset } = await import(domainPath);
			const repository = await localRepository();
			for (let index = 0; index < 45; index++) {
				await repository.save("asset", { ...newAsset("account"), category: "email", tags: [tag],
					name: `${query} ${String(index).padStart(2, "0")}` });
			}
		}, { repositoryPath: repositoryModuleUrl, domainPath: `/@fs${process.cwd()}/packages/domain/src/index.ts`, query, tag });
		await page.getByRole("button", { name: "Email", exact: true }).click();
		await selectChoice(page.locator("#asset-tag-filter"), { label: tag });
		await fillSearch(page, query);
		await expect(page.locator("main.page .list-row")).toHaveCount(45);
		const target = page.locator("main.page .list-row").nth(30);
		const name = await target.locator("strong").innerText();
		await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
		const before = await page.evaluate(() => window.scrollY);
		expect(before).toBeGreaterThan(1000);
		await openDetail(page, name);
		const stored = await page.evaluate(() => Number(sessionStorage.getItem("keepany-scroll-account")));
		expect(Math.abs(stored - before)).toBeLessThan(35);
		await expect(page.locator("#top-search-query")).toBeHidden();
		await backToList(page);
		await expect(page.locator("#asset-tag-filter")).toHaveAttribute("data-value", tag);
		await expect(page.getByRole("button", { name: "Email", exact: true })).toHaveAttribute("aria-pressed", "true");
		await expectPersistedListSearch(page, "account", query);
		await expect(page.locator("#top-search-query")).toBeHidden();
		// The cleared query is a different view. Its first render must not consume
		// the saved position before the user returns to the matching filter.
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
		await fillSearch(page, query);
		await expect(page.locator("main.page .list-row")).toHaveCount(45);
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
		const after = await page.evaluate(() => window.scrollY);
		expect(Math.abs(after - before)).toBeLessThan(35);
		await expect(target).toBeInViewport({ ratio: 1 });
		console.log(JSON.stringify({ kind: "account", before, stored, after }));
		expect(errors).toEqual([]);
	} finally {
		await context.close();
	}
});

for (const kind of ["project", "account"] as const) {
	test(`${kind} image replacement removes old blob and actual backup restores only current image`, async ({
		browser,
	}) => {
		test.setTimeout(120_000);
		mkdirSync(evidence, { recursive: true });
		const suffix = crypto.randomUUID().slice(0, 8);
		const name = `Image ${kind} ${suffix}`;
		const password = `image-crud-backup-${suffix}-2026`;
		const source = await browser.newContext({
			locale: "en-US",
			acceptDownloads: true,
			viewport: { width: 390, height: 844 },
		});
		const page = await source.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		async function png(color: string) {
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
		try {
			await add(page, kind, name);
			await saveDialog(page);
			await openDetail(page, name);
			await openProjectMaterials(page);
			const assetId = (await assetRows(page)).find(
				(asset) => asset.name === name,
			)?.id;
			if (!assetId) throw Error(`${kind} ID missing`);
			const first = await png("#e43b44");
			await page.getByLabel("Add image").setInputFiles({
				name: "original.png",
				mimeType: "image/png",
				buffer: first,
			});
			await page
				.getByRole("dialog")
				.getByRole("button", { name: "Confirm" })
				.click();
			await expect(page.locator(".asset-image")).toHaveCount(1);
			const firstFiles = await storedFiles(page);
			expect(firstFiles).toHaveLength(1);
			expect(firstFiles[0].bytes).toEqual(Array.from(first));
			const replacement = await png("#2487c2");
			const chooser = page.waitForEvent("filechooser");
			await page.getByRole("button", { name: "Replace image" }).click();
			await (await chooser).setFiles({
				name: "replacement.png",
				mimeType: "image/png",
				buffer: replacement,
			});
			await page
				.getByRole("dialog")
				.getByRole("button", { name: "Confirm" })
				.click();
			await expect(page.locator(".asset-image")).toHaveCount(1);
			await expect.poll(async () => (await storedFiles(page)).length).toBe(1);
			const currentFiles = await storedFiles(page);
			expect(currentFiles[0].id).not.toBe(firstFiles[0].id);
			expect(currentFiles[0].name).toBe("replacement.png");
			expect(currentFiles[0].bytes).toEqual(Array.from(replacement));
			expect(
				(await assetRows(page)).find((asset) => asset.id === assetId)
					?.attachments,
			).toEqual([currentFiles[0].id]);
			await page.screenshot({
				path: `${evidence}/crud-en-390-${kind}-image-replaced.png`,
			});

			await page.goto("/intake");
			await page.locator("#backup-password").fill(password);
			await page.getByRole("button", { name: "Create backup" }).click();
			const downloadEvent = page.waitForEvent("download");
			await page.getByRole("link", { name: "Save backup file" }).click();
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
				await restored.goto(`/assets/${kind}/${assetId}`);
				await openProjectMaterials(restored);
				await expect(restored.getByRole("heading", { name })).toBeVisible();
				await expect(restored.locator(".asset-image")).toHaveCount(1);
				expect(
					(await assetRows(restored)).find((asset) => asset.id === assetId)
						?.attachments,
				).toEqual([currentFiles[0].id]);
				expect(await storedFiles(restored)).toEqual(currentFiles);
			} finally {
				await destination.close();
			}
			await page.goto(`/assets/${kind}/${assetId}`);
			await openProjectMaterials(page);
			await page.getByRole("button", { name: "Remove image" }).click();
			await expect(page.locator(".asset-image")).toHaveCount(0);
			await expect.poll(async () => (await storedFiles(page)).length).toBe(0);
			expect(
				(await assetRows(page)).find((asset) => asset.id === assetId)
					?.attachments,
			).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await source.close();
		}
	});
}

for (const locale of ["en-US", "zh-CN"] as const) {
	for (const width of [360, 390, 768, 1280, 1440]) {
		test(`${locale} project/account CRUD entry and edit dialog fit ${width}px`, async ({
			browser,
		}) => {
			test.setTimeout(90_000);
			mkdirSync(evidence, { recursive: true });
			const context = await browser.newContext({
				locale,
				viewport: { width, height: 844 },
			});
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const copy =
				locale === "zh-CN"
						? {
									add: "新增",
									name: "名称",
									save: "保存",
									cancel: "取消",
									notes: "备注",
									projectNotes: "补充说明",
									contactDetails: "联系方式",
							edit: "编辑",
							project: "每个项目，都有自己的档案。",
							account: "每个账号，都有来有往。",
						}
					: {
							add: "Add",
									name: "Name",
									save: "Save",
									cancel: "Cancel",
									notes: "Notes",
									projectNotes: "Additional notes",
									contactDetails: "Contact details",
							edit: "Edit",
							project: "Every project has its own file.",
							account: "Every account has connections.",
						};
			try {
				for (const [kind, label] of [
					["project", copy.project],
					["account", copy.account],
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
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth),
					).toBeLessThanOrEqual(width);
					if (width <= 390) {
						if (kind === "project") {
							const contactDetails = dialog
								.locator("details.project-editor-group")
								.filter({ hasText: copy.contactDetails });
							if (
								!(await contactDetails.evaluate(
									(element) => (element as HTMLDetailsElement).open,
								))
							) {
								await contactDetails.locator("summary").click();
							}
						}
						const sizes = await dialog
							.locator("input, textarea, [role=combobox]")
							.evaluateAll((elements) =>
								elements.map((element) =>
									Number.parseFloat(getComputedStyle(element).fontSize),
								),
							);
						expect(
							Math.min(...sizes),
							`${locale} ${width}px ${kind} editor input font size`,
						).toBeGreaterThanOrEqual(16);
						await expect(
							dialog.getByRole("button", { name: copy.cancel }),
						).toBeInViewport({ ratio: 1 });
						await expect(
							dialog.getByRole("button", { name: copy.save }),
						).toBeInViewport({ ratio: 1 });
						const notesLabel =
							kind === "project" ? copy.projectNotes : copy.notes;
						await dialog.getByLabel(notesLabel).scrollIntoViewIfNeeded();
						await expect(dialog.getByLabel(notesLabel)).toBeInViewport({
							ratio: 1,
						});
						await expect(
							dialog.getByRole("button", { name: copy.save }),
						).toBeInViewport({ ratio: 1 });
					}
					await page.screenshot({
						path: `${evidence}/crud-${locale === "zh-CN" ? "zh" : "en"}-${width}-${kind}-editor.png`,
					});
					if (width <= 390) {
						await dialog.evaluate((element) =>
							element.scrollTo({ top: element.scrollHeight }),
						);
						const notesLabel =
							kind === "project" ? copy.projectNotes : copy.notes;
						const notes = await dialog.getByLabel(notesLabel).boundingBox();
						const actions = await dialog
							.locator("form > .actions")
							.boundingBox();
						if (!notes || !actions)
							throw Error("Editor notes or actions missing");
						expect(
							notes.y + notes.height,
							`${locale} ${width}px ${kind} notes visible above actions`,
						).toBeLessThanOrEqual(actions.y + 1);
						await page.screenshot({
							path: `${evidence}/crud-${locale === "zh-CN" ? "zh" : "en"}-${width}-${kind}-editor-tail.png`,
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
					const editButton =
						kind === "project"
							? page
									.locator("main.page > .asset-project-action-bar")
									.getByRole("button", { name: copy.edit, exact: true })
							: page
									.locator("main.page > .page-header")
									.getByRole("button", { name: copy.edit, exact: true });
					await editButton.click();
					await expect(page.getByRole("dialog")).toBeVisible({
						timeout: 15_000,
					});
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
