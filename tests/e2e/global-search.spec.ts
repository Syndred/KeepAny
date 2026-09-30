import { expect, test, type Page } from "@playwright/test";

const repositoryUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
const results = (page: Page) => page.locator(".top-search-panel .search-results a");

async function query(page: Page, text: string) {
	if (!await page.locator("#top-search-query").isVisible()) await page.locator(".top-search-trigger").click();
	await page.locator("#top-search-query").fill(text);
}

async function focusedRow(page: Page, id: string) {
	const row = page.locator(`[id="${id}"]`);
	await expect(row).toBeVisible();
	await expect(row).toBeFocused();
	expect(await row.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return rect.top < innerHeight && rect.bottom > 0;
	})).toBe(true);
	await expect(page.locator(".top-search-panel")).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => sessionStorage.getItem("keepany-search"))).toBe("");
}

async function fixture(page: Page) {
	return page.evaluate(async ([repositoryPath, domainPath]) => {
		const { localRepository, saveBatch } = await import(repositoryPath);
		const { newAsset, taskSchema, historySchema } = await import(domainPath);
		const account = { ...newAsset("account"), name: "Search Wallet", username: "public-mail@example.test", notes: "private-asset-note" };
		const second = { ...newAsset("account"), name: "Other Wallet" };
		const camera = { ...newAsset("item"), name: "Search Camera", location: "Study → Shelf → Upper drawer", tags: ["field-tag"], url: "https://url-private-user:url-private-password@example.test/camera?query-private-token=secret#fragment-private-token" };
		const pdf = { ...newAsset("project"), id: `pdf-${"a".repeat(48)}`, name: "Imported PDF receipt", description: "private-pdf-description", longDescription: "private-pdf-long-description" };
		const deleted = { ...newAsset("project"), name: "deleted-asset-token", deleted: true };
		const projects = Array.from({ length: 16 }, (_, n) => ({ ...newAsset("project"), name: `Browse ${String(n).padStart(2, "0")} ${"VeryLongVisibleProjectTitle".repeat(3)}` }));
		const now = new Date().toISOString();
		const history = historySchema.parse({ id: crypto.randomUUID(), assetId: account.id, action: "expense", title: "Search dinner transaction", eventDate: "2026-01-01", source: "Public bank statement", amount: 1234, currency: "USD", note: "private-history-note", createdAt: now });
		const otherHistory = historySchema.parse({ ...history, id: crypto.randomUUID(), assetId: second.id, action: "refund", title: "Other refund", source: "Other bank", eventDate: "2026-10-01" });
		const fillerHistory = Array.from({ length: 12 }, (_, n) => historySchema.parse({ ...history, id: crypto.randomUUID(), title: `Other newer record ${n}`, eventDate: "2026-09-30" }));
		const task = taskSchema.parse({ id: crypto.randomUUID(), name: "Search inspect receipts", assetId: camera.id, dueDate: "2026-10-31", done: true, completedAt: now, completionHistory: [now], createdAt: now });
		const pendingTask = taskSchema.parse({ id: crypto.randomUUID(), name: "Other pending task", createdAt: now });
		const deletedTask = taskSchema.parse({ ...task, id: crypto.randomUUID(), name: "deleted-task-token", deleted: true });
		await saveBatch([
			...[account, second, camera, pdf, deleted, ...projects].map((value) => ({ type: "asset", value })),
			...[history, otherHistory, ...fillerHistory].map((value) => ({ type: "history", value })),
			...[task, pendingTask, deletedTask].map((value) => ({ type: "task", value })),
		]);
		const repository = await localRepository();
		const candidate = { id: `pdf-${"a".repeat(64)}`, fileHash: "a".repeat(64), fileName: "public-receipt-file.pdf", rowNumber: 1, source: "pdf", sourceText: "private-pdf-original", asset: pdf, status: "accepted", kindSelected: true };
		await repository.fileStore.intakeReview.put(candidate);
		return { assetId: camera.id as string, historyId: history.id as string, otherAccountId: second.id as string, candidateId: candidate.id, taskId: task.id as string };
	}, [repositoryUrl, domainUrl]);
}

for (const locale of ["en-US", "zh-CN"]) {
	for (const width of [390, 1280]) {
		test(`${locale} global search locates four sources, clears same-hash filters and bounds 15 long results at ${width}px`, async ({ browser }) => {
			const context = await browser.newContext({ locale, viewport: { width, height: 844 } });
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			try {
				await page.goto("/");
				const ids = await fixture(page);
				await page.goto("/finance");
				await query(page, "");
				await expect(results(page)).toHaveCount(15);
				await expect(results(page).first()).toContainText("Browse 00");
				await expect(results(page).last()).toContainText("Browse 14");
				await results(page).last().scrollIntoViewIfNeeded();
				const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
					elements: [...document.querySelectorAll("body *")].filter((element) => element.getBoundingClientRect().right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 5)
						.slice(0, 12).map((element) => ({ tag: element.tagName, class: element.className, right: element.getBoundingClientRect().right, sw: element.scrollWidth, cw: element.clientWidth })),
				}));
				expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(width + 1);
				await expect(page.locator("#top-search-query")).toBeInViewport();
				await expect(page.locator(".top-search-panel-close")).toBeInViewport();
				await page.screenshot({ path: test.info().outputPath(`global-search-${locale}-${width}-15-results.png`) });
				await results(page).last().click();
				await expect(page.getByRole("heading", { name: /Browse 14/ })).toBeVisible();
				await query(page, "UPPER DRAWER");
				await expect(results(page)).toHaveCount(1);
				await results(page).click();
				await expect(page).toHaveURL(new RegExp(`/assets/item/${ids.assetId}$`));
				for (const text of ["field-tag", "PUBLIC-MAIL@", "example.test/camera", "Public bank statement", "12.34", "2026-10-31"]) {
					await query(page, text);
					await expect(results(page).first()).toBeVisible();
				}
				for (const text of ["private-asset-note", "private-history-note", "private-pdf-original", "private-pdf-description", "private-pdf-long-description", "url-private-user", "url-private-password", "query-private-token", "fragment-private-token", "deleted-asset-token", "deleted-task-token", ids.assetId, ids.historyId]) {
					await query(page, text);
					await expect(results(page)).toHaveCount(0);
				}
				await query(page, "dinner transaction");
				await results(page).click();
				await expect(page).toHaveURL(new RegExp(`/finance#finance-entry-${ids.historyId}$`));
				await focusedRow(page, `finance-entry-${ids.historyId}`);
				// Repeating the identical hash must reveal the row hidden by all three filters.
				for (let repeat = 0; repeat < 2; repeat++) {
					const filters = page.locator(".finance-filters select");
					await filters.nth(0).selectOption("refund");
					await filters.nth(1).selectOption(ids.otherAccountId);
					await filters.nth(2).selectOption("source:Other bank");
					await expect(page.locator(`[id="finance-entry-${ids.historyId}"]`)).toHaveCount(0);
					await query(page, "dinner transaction");
					await results(page).click();
					await focusedRow(page, `finance-entry-${ids.historyId}`);
					await expect(filters.nth(0)).toHaveValue("all");
					await expect(filters.nth(1)).toHaveValue("");
					await expect(filters.nth(2)).toHaveValue("all");
				}
				await page.reload();
				await focusedRow(page, `finance-entry-${ids.historyId}`);
				await query(page, "public-receipt-file.pdf");
				await expect(results(page)).toHaveCount(1);
				await results(page).click();
				await focusedRow(page, `intake-review-${ids.candidateId}`);
				await query(page, "inspect receipts");
				await results(page).click();
				await focusedRow(page, `task-${ids.taskId}`);
				await page.locator(".task-filters button").nth(0).click();
				await expect(page.locator(`[id="task-${ids.taskId}"]`)).toHaveCount(0);
				await query(page, "inspect receipts");
				await results(page).click();
				await focusedRow(page, `task-${ids.taskId}`);
				// Ordinary data updates must preserve a later user filter under the old hash.
				await page.locator(".task-filters button").nth(0).click();
				await page.evaluate(async (modulePath) => {
					const { localRepository, save } = await import(modulePath);
					const repo = await localRepository();
					const task = (await repo.list("task")).find((row: { name: string }) => row.name === "Other pending task");
					await save("task", { ...task, name: "Other updated pending task" });
				}, repositoryUrl);
				await expect(page.locator(".task-filters button").nth(0)).toHaveAttribute("aria-pressed", "true");
				await expect(page.locator(`[id="task-${ids.taskId}"]`)).toHaveCount(0);
				await page.evaluate(async ({ modulePath, taskId }) => {
					const { localRepository, save } = await import(modulePath);
					const task = await (await localRepository()).get("task", taskId);
					await save("task", { ...task, deleted: true });
				}, { modulePath: repositoryUrl, taskId: ids.taskId });
				await expect(page.locator(".task-filters button").nth(0)).toHaveAttribute("aria-pressed", "true");
				await query(page, "inspect receipts");
				await expect(results(page)).toHaveCount(0);
				await page.goto("/tasks#task-%E0%A4%A");
				await expect(page.locator(".task-filters")).toBeVisible();
				await page.goto("/tasks#task-missing-target");
				await expect(page.locator(".task-filters")).toBeVisible();
				expect(errors).toEqual([]);
			} finally { await context.close(); }
		});
	}
}

test("same-page intake search reads a candidate confirmed in another tab without replacing a queued draft", async ({ context, page }) => {
	await page.goto("/intake");
	await page.getByRole("button", { name: "Spreadsheet", exact: true }).click();
	await page.locator("#csv-file").setInputFiles({ name: "cross-tab-search.csv", mimeType: "text/csv", buffer: Buffer.from("name,kind\nCross tab target,project\nKeep my draft,account") });
	await expect(page.locator(".intake-review-row")).toHaveCount(2);
	const target = page.locator(".intake-review-row").first();
	const targetId = await target.getAttribute("id");
	const other = await context.newPage();
	try {
		await other.goto("/intake");
		await other.locator(".intake-review-row").first().getByRole("button", { name: "Confirm and save" }).click();
		await expect(other.locator(".intake-review-row").first()).toContainText("Confirmed");
		const draft = page.locator(".intake-review-row").nth(1).getByLabel("Name", { exact: true });
		await draft.fill("Keep edited draft");
		await query(page, "cross-tab-search.csv");
		await expect(results(page)).toHaveCount(1);
		await results(page).click();
		if (!targetId) throw Error("candidate-row-id-missing");
		await focusedRow(page, targetId);
		await expect(target).toContainText("Confirmed");
		await expect(target.getByRole("button", { name: "Confirm and save" })).toHaveCount(0);
		await expect(draft).toHaveValue("Keep edited draft");
		// A completely new candidate must be inserted into this already mounted review list.
		await other.getByRole("button", { name: "Spreadsheet", exact: true }).click();
		await other.locator("#csv-file").setInputFiles({ name: "new-tab-search.csv", mimeType: "text/csv", buffer: Buffer.from("name,kind\nNew target receipt,project") });
		const newTarget = other.locator(".intake-review-row").filter({ hasText: "new-tab-search.csv" });
		await newTarget.getByRole("button", { name: "Confirm and save" }).click();
		await query(page, "new-tab-search.csv");
		await expect(results(page)).toHaveCount(1);
		await results(page).click();
		const newId = await newTarget.getAttribute("id");
		if (!newId) throw Error("new-candidate-row-id-missing");
		await focusedRow(page, newId);
		await expect(page.locator(`[id="${newId}"]`)).toContainText("Confirmed");
		await expect(draft).toHaveValue("Keep edited draft");
	} finally { await other.close(); }
});

test("a late target read does not replace a candidate draft queued after search navigation", async ({ context, page }) => {
	await page.route("**/src/intake-review-store.ts*", async (route) => {
		const response = await route.fetch();
		const body = await response.text();
		const read = /return review\.getReviewedCandidate\(([\s\S]*?)\);/;
		expect(body).toMatch(read);
		await route.fulfill({ response, body: body.replace(read, (_match, args: string) => `const result = await review.getReviewedCandidate(${args});
			if (window.__delaySearchReviewRead) await window.__delaySearchReviewRead();
			window.__searchReadCompleted = (window.__searchReadCompleted || 0) + 1;
			return result;`) });
	});
	await page.goto("/intake");
	await page.getByRole("button", { name: "Spreadsheet", exact: true }).click();
	await page.locator("#csv-file").setInputFiles({ name: "late-target-read.csv", mimeType: "text/csv", buffer: Buffer.from("name,kind\nLate target candidate,project") });
	const row = page.locator(".intake-review-row");
	await expect(row).toHaveCount(1);
	const other = await context.newPage();
	try {
		await other.goto("/intake");
		await other.locator(".intake-review-row").getByRole("button", { name: "Confirm and save" }).click();
		await expect(other.locator(".intake-review-row")).toContainText("Confirmed");
		await page.evaluate(() => {
			const state = window as typeof window & { __delaySearchReviewRead?: () => Promise<void>; __searchReadResolvers?: Array<() => void> };
			state.__searchReadResolvers = [];
			state.__delaySearchReviewRead = () => new Promise<void>((resolve) => state.__searchReadResolvers?.push(resolve));
		});
		await query(page, "late-target-read.csv");
		await expect(results(page)).toHaveCount(1);
		await results(page).click();
		await expect.poll(() => page.evaluate(() => (window as typeof window & { __searchReadResolvers: unknown[] }).__searchReadResolvers.length)).toBe(1);
		const input = row.getByLabel("Name", { exact: true });
		await input.fill("Draft started after target read");
		await expect.poll(() => page.evaluate(() => (window as typeof window & { __searchReadResolvers: unknown[] }).__searchReadResolvers.length)).toBe(2);
		await page.evaluate(() => (window as typeof window & { __searchReadResolvers: Array<() => void> }).__searchReadResolvers[0]());
		await expect.poll(() => page.evaluate(() => (window as typeof window & { __searchReadCompleted: number }).__searchReadCompleted)).toBe(1);
		await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		await expect(input).toHaveValue("Draft started after target read");
		await expect(row.getByRole("button", { name: "Confirm and save" })).toBeVisible();
		// The queued edit itself reconciles its rejected stale write after its own read finishes.
		await page.evaluate(() => (window as typeof window & { __searchReadResolvers: Array<() => void> }).__searchReadResolvers[1]());
		await expect(row).toContainText("Confirmed");
		await expect(input).toHaveCount(0);
	} finally { await other.close(); }
});

test("rejected candidate autosave keeps its draft and error on first and repeated search hashes", async ({ context, page }) => {
	await page.goto("/intake");
	await page.getByRole("button", { name: "Spreadsheet", exact: true }).click();
	await page.locator("#csv-file").setInputFiles({ name: "failed-draft-search.csv", mimeType: "text/csv", buffer: Buffer.from("name,kind\nPersisted candidate title,project") });
	const row = page.locator(".intake-review-row");
	await expect(row).toHaveCount(1);
	const rowId = await row.getAttribute("id");
	if (!rowId) throw Error("failed-draft-row-id-missing");
	const candidateId = rowId.slice("intake-review-".length);
	await page.evaluate(async ({ modulePath, candidateId }) => {
		const { localRepository } = await import(modulePath);
		const repository = await localRepository();
		repository.fileStore.intakeReview.hook("updating", (_changes: Record<string, unknown>, id: string) => {
			if (id === candidateId) throw Error("test-intake-write-rejected");
		});
	}, { modulePath: repositoryUrl, candidateId });
	const input = row.getByLabel("Name", { exact: true });
	await input.fill("Unsaved candidate draft");
	const alert = row.getByRole("alert");
	await expect(alert).toBeVisible();
	const originalError = await alert.textContent();
	await expect(row.getByRole("status")).toHaveCount(0);
	expect(await page.evaluate(async ({ modulePath, candidateId }) => {
		const { localRepository } = await import(modulePath);
		return (await (await localRepository()).fileStore.intakeReview.get(candidateId)).asset.name;
	}, { modulePath: repositoryUrl, candidateId })).toBe("Persisted candidate title");
	const other = await context.newPage();
	try {
		await other.goto("/intake");
		await other.locator(".intake-review-row").getByRole("button", { name: "Confirm and save" }).click();
		await expect(other.locator(".intake-review-row")).toContainText("Confirmed");
		for (let activation = 0; activation < 2; activation++) {
			await query(page, "failed-draft-search.csv");
			await expect(results(page)).toHaveCount(1);
			await results(page).click();
			await focusedRow(page, rowId);
			await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
			await expect(input).toHaveValue("Unsaved candidate draft");
			await expect(alert).toHaveText(originalError ?? "");
			await expect(row.getByRole("status")).toHaveCount(0);
		}
	} finally { await other.close(); }
});

test("failed candidate metadata read conservatively excludes asset descriptions while public names remain searchable", async ({ page }) => {
	await page.goto("/");
	await fixture(page);
	await page.evaluate(async (modulePath) => {
		const { localRepository, save } = await import(modulePath);
		const asset = (await (await localRepository()).list("asset")).find((row: { name: string }) => row.name === "Search Wallet");
		await save("asset", { ...asset, description: "unloaded-provenance-description" });
	}, repositoryUrl);
	await page.route("**/src/data.ts*", async (route) => {
		const response = await route.fetch();
		const body = await response.text();
		const needle = '.intakeReview.where("status").equals("accepted").toArray()';
		expect(body).toContain(needle);
		await route.fulfill({ response, body: body.replace(needle, `${needle}.then(() => { throw Error("test-metadata-read-failed"); })`) });
	});
	await page.reload();
	await query(page, "unloaded-provenance-description");
	await expect(results(page)).toHaveCount(0);
	await query(page, "Search Wallet");
	await expect(results(page).filter({ hasText: "Asset" })).toHaveCount(1);
	await query(page, "public-receipt-file.pdf");
	await expect(results(page)).toHaveCount(0);
});
