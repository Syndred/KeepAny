import { expect, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

import { sourceModuleUrl } from "./helpers/source-module-url";
const repositoryUrl = sourceModuleUrl("packages/local-db/src/index.ts");

for (const outcome of ["saved", "failed", "ignored"] as const) test(`a delayed confirmation refresh keeps a different row's ${outcome} kind edit`, async ({ page }) => {
	await page.goto("/intake");
	await page.getByRole("button", { name: "Spreadsheet", exact: true }).click();
	await page.locator("#csv-file").setInputFiles({
		name: "refresh-race.csv", mimeType: "text/csv",
		buffer: Buffer.from("name,kind\nConfirmed first,project\nEditable second,project"),
	});
	const rows = page.locator(".intake-review-row");
	await expect(rows).toHaveCount(2);
	const candidateId = (await rows.nth(1).getAttribute("id"))?.replace(/^intake-review-/, "");
	if (!candidateId) throw Error("review-candidate-id-missing");
	await page.evaluate(async ({ modulePath, candidateId, outcome }) => {
		const { localRepository } = await import(modulePath);
		const table = (await localRepository()).fileStore.intakeReview;
		const original = table.toArray.bind(table);
		const host = window as typeof window & {
			__reviewReadHeld?: boolean;
			__releaseReviewRead?: () => void;
		};
		const gate = new Promise<void>((resolve) => { host.__releaseReviewRead = resolve; });
		let held = false;
		table.toArray = async () => {
			const snapshot = await original();
			if (!held) {
				held = true;
				host.__reviewReadHeld = true;
				await gate;
			}
			return snapshot;
		};
		if (outcome === "failed") {
			const put = table.put.bind(table);
			let failed = false;
			table.put = async (value: { id: string }, key?: string) => {
				if (!failed && value.id === candidateId) {
					failed = true;
					throw Error("synthetic-review-save-failure");
				}
				return put(value, key);
			};
		}
	}, { modulePath: repositoryUrl, candidateId, outcome });
	await rows.nth(0).getByRole("button", { name: "Confirm and save", exact: true }).click();
	await expect.poll(() => page.evaluate(() => (window as typeof window & { __reviewReadHeld?: boolean }).__reviewReadHeld)).toBe(true);
	await selectChoice(rows.nth(1).getByRole("combobox"), "item");
	await expect(rows.nth(1).getByRole("button", { name: "Ignore", exact: true })).toBeEnabled();
	const persistedKind = () => page.evaluate(async ({ modulePath, candidateId }) => {
		const { localRepository } = await import(modulePath);
		return (await (await localRepository()).fileStore.intakeReview.get(candidateId))?.asset.kind;
	}, { modulePath: repositoryUrl, candidateId });
	if (outcome === "failed") {
		await expect(rows.nth(1).getByRole("alert")).toBeVisible();
		await expect.poll(persistedKind).toBe("project");
	} else {
		// The real IndexedDB write has already completed before the old read resumes.
		await expect.poll(persistedKind).toBe("item");
	}
	if (outcome === "ignored") {
		await rows.nth(1).getByRole("button", { name: "Ignore", exact: true }).click();
		await expect(rows.nth(1)).toContainText("Ignored");
	}
	await page.evaluate(() => (window as typeof window & { __releaseReviewRead?: () => void }).__releaseReviewRead?.());
	await expect(rows.nth(0).locator(".chip")).toHaveText("Confirmed");
	if (outcome === "ignored") {
		await expect(rows.nth(1)).toContainText("Ignored");
		await expect(rows.nth(1)).toContainText("Record type: Items");
		await expect(rows.nth(1).getByRole("combobox")).toHaveCount(0);
		return;
	}
	await expect(rows.nth(1).getByRole("combobox")).toHaveAttribute("data-value", "item");
	if (outcome === "failed") {
		// The failed edit remains visible until the user corrects it and retries.
		expect(await persistedKind()).toBe("project");
		await expect(rows.nth(1).getByRole("alert")).toBeVisible();
		await selectChoice(rows.nth(1).getByRole("combobox"), "account");
		await expect.poll(persistedKind).toBe("account");
	} else expect(await persistedKind()).toBe("item");
	await rows.nth(1).getByRole("button", { name: "Ignore", exact: true }).click();
	await expect(rows.nth(1)).toContainText("Ignored");
	await expect(rows.nth(1)).toContainText(`Record type: ${outcome === "failed" ? "Accounts" : "Items"}`);
	await page.reload();
	await expect(rows.nth(0).locator(".chip")).toHaveText("Confirmed");
	await expect(rows.nth(1)).toContainText(`Record type: ${outcome === "failed" ? "Accounts" : "Items"}`);
});

test("an older queued save failure does not leave an error after the newer edit succeeds", async ({ page }) => {
	await page.goto("/intake");
	await page.getByRole("button", { name: "Spreadsheet", exact: true }).click();
	await page.locator("#csv-file").setInputFiles({
		name: "queued-edit-failure.csv", mimeType: "text/csv",
		buffer: Buffer.from("name,kind\nQueued synthetic candidate,project"),
	});
	const row = page.locator(".intake-review-row");
	await expect(row).toHaveCount(1);
	const candidateId = (await row.getAttribute("id"))?.replace(/^intake-review-/, "");
	if (!candidateId) throw Error("review-candidate-id-missing");
	await page.evaluate(async ({ modulePath, candidateId }) => {
		const { localRepository } = await import(modulePath);
		const table = (await localRepository()).fileStore.intakeReview;
		const original = table.put.bind(table);
		let failed = false;
		table.put = async (value: { id: string }, key?: string) => {
			if (!failed && value.id === candidateId) {
				failed = true;
				throw Error("synthetic-superseded-review-save-failure");
			}
			return original(value, key);
		};
		const host = window as typeof window & { __reviewEditLockHeld?: boolean; __releaseReviewEditLock?: () => void };
		void navigator.locks.request(`keepany-intake-review:${candidateId}`, async () => {
			host.__reviewEditLockHeld = true;
			await new Promise<void>((resolve) => { host.__releaseReviewEditLock = resolve; });
		});
	}, { modulePath: repositoryUrl, candidateId });
	await expect.poll(() => page.evaluate(() => (window as typeof window & { __reviewEditLockHeld?: boolean }).__reviewEditLockHeld)).toBe(true);
	await selectChoice(row.getByRole("combobox"), "item");
	await expect(row.getByRole("button", { name: "Ignore", exact: true })).toBeDisabled();
	await selectChoice(row.getByRole("combobox"), "account");
	await page.evaluate(() => (window as typeof window & { __releaseReviewEditLock?: () => void }).__releaseReviewEditLock?.());
	await expect(row.getByRole("button", { name: "Ignore", exact: true })).toBeEnabled();
	expect(await page.evaluate(async ({ modulePath, candidateId }) => {
		const { localRepository } = await import(modulePath);
		return (await (await localRepository()).fileStore.intakeReview.get(candidateId))?.asset.kind;
	}, { modulePath: repositoryUrl, candidateId })).toBe("account");
	await expect(row.getByRole("combobox")).toHaveAttribute("data-value", "account");
	await expect(row.getByRole("alert")).toHaveCount(0);
	await row.getByRole("button", { name: "Confirm and save", exact: true }).click();
	await expect(row.locator(".chip")).toHaveText("Confirmed");
	await expect(row).toContainText("Record type: Accounts");
});

test("a delayed search target read does not restore a candidate after its confirmation", async ({ page }) => {
	await page.goto("/intake");
	await page.getByRole("button", { name: "Spreadsheet", exact: true }).click();
	await page.locator("#csv-file").setInputFiles({
		name: "confirmed-search-race.csv", mimeType: "text/csv",
		buffer: Buffer.from("name,kind\nConfirmed search target,project"),
	});
	const row = page.locator(".intake-review-row");
	await expect(row).toHaveCount(1);
	const candidateId = (await row.getAttribute("id"))?.replace(/^intake-review-/, "");
	if (!candidateId) throw Error("review-candidate-id-missing");
	await page.evaluate(async ({ modulePath, candidateId }) => {
		const { localRepository } = await import(modulePath);
		const table = (await localRepository()).fileStore.intakeReview;
		const original = table.get.bind(table);
		const host = window as typeof window & {
			__searchTargetHeld?: boolean;
			__searchTargetReturned?: boolean;
			__releaseSearchTarget?: () => void;
		};
		const gate = new Promise<void>((resolve) => { host.__releaseSearchTarget = resolve; });
		let held = false;
		table.get = async (id: string) => {
			const snapshot = await original(id);
			if (!held && id === candidateId) {
				held = true;
				host.__searchTargetHeld = true;
				await gate;
				host.__searchTargetReturned = true;
			}
			return snapshot;
		};
	}, { modulePath: repositoryUrl, candidateId });
	// Same-document row links use the same target loader as search results.
	await page.goto(`/intake#intake-review-${candidateId}`);
	await expect.poll(() => page.evaluate(() => (window as typeof window & { __searchTargetHeld?: boolean }).__searchTargetHeld)).toBe(true);
	await row.getByRole("button", { name: "Confirm and save", exact: true }).click();
	await expect(row.locator(".chip")).toHaveText("Confirmed");
	await expect(row.getByLabel("Name", { exact: true })).toHaveCount(0);
	await page.evaluate(() => (window as typeof window & { __releaseSearchTarget?: () => void }).__releaseSearchTarget?.());
	await expect.poll(() => page.evaluate(() => (window as typeof window & { __searchTargetReturned?: boolean }).__searchTargetReturned)).toBe(true);
	await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
	await expect(row.locator(".chip")).toHaveText("Confirmed");
	await expect(row.getByLabel("Name", { exact: true })).toHaveCount(0);
	expect(await page.evaluate(async ({ modulePath, candidateId }) => {
		const { localRepository } = await import(modulePath);
		return (await (await localRepository()).fileStore.intakeReview.get(candidateId))?.status;
	}, { modulePath: repositoryUrl, candidateId })).toBe("accepted");
});
