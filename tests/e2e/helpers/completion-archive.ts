import "fake-indexeddb/auto";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import Dexie from "dexie";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LocalRepository } from "../../../packages/local-db/src";
import { encryptBackup } from "../../../packages/local-db/src/backup-crypto";
import { newAsset } from "../../../packages/domain/src";
import { reviewedCandidateSchema, stageReviewedCandidates } from "../../../packages/local-db/src/intake-review";
import { expect, type Page } from "@playwright/test";
import { openBackupRestorePanel } from "./backup-restore";

/** Synthetic test preparation only. The candidate consumes this KA1 through its real restore UI. */
export async function prepareCompletionArchive<T>(
	directory: string,
	password: string,
	prepare: (repository: LocalRepository) => Promise<T>,
): Promise<T> {
	mkdirSync(directory, { recursive: true });
	// Another spec import may have loaded Dexie before fake-indexeddb/auto. Set
	// this Node fixture's storage explicitly instead of depending on import order.
	Dexie.dependencies.indexedDB = indexedDB;
	Dexie.dependencies.IDBKeyRange = IDBKeyRange;
	const { openLocalRepository } = await import("../../../packages/local-db/src");
	const repository = await openLocalRepository(`completion-${crypto.randomUUID().slice(0, 12)}`);
	try {
		const fixture = await prepare(repository);
		const encrypted = await encryptBackup(await repository.exportArchive(), password);
		writeFileSync(resolve(directory, "fixture.ka1"), encrypted);
		writeFileSync(resolve(directory, "fixture.json"), JSON.stringify(fixture, null, 2));
		writeFileSync(resolve(directory, "preparation.json"), JSON.stringify({
			kind: "node-synthetic-fixture-not-user-operation",
			storage: "fake-indexeddb",
			transport: "public-exportArchive-and-encryptBackup",
			consumption: "compiled-candidate-visible-KA1-restore",
		}, null, 2));
		return fixture;
	} finally { await repository.close(); }
}

export function recordDevelopmentRequests(context: import("@playwright/test").BrowserContext) {
	const requests: string[] = [];
	context.on("request", request => {
		if (/\/@(?:fs|vite)\//.test(request.url())) requests.push(request.url());
	});
	return requests;
}

/** Models already-extracted historical PDF records; it never reads or imports a PDF. */
export async function prepareLegacyPdfArchive(directory: string, password: string,
	documents: ReadonlyArray<{ fileName: string; text: string }>) {
	const candidates = await prepareCompletionArchive(directory, password, async repository => {
		const rows = [];
		for (const document of documents) {
			const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${document.fileName}\n${document.text}`));
			const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
			rows.push(reviewedCandidateSchema.parse({
				id: `pdf-${hash}`, fileHash: hash, fileName: document.fileName, rowNumber: 1,
				source: "pdf", sourceText: document.text, kindSelected: false, status: "pending",
				asset: { ...newAsset("item"), id: `pdf-${hash.slice(0, 48)}`,
					name: document.fileName.replace(/\.pdf$/i, ""), description: document.text },
			}));
		}
		// The public staging contract accepts one source file per pending batch.
		for (const hash of new Set(rows.map(row => row.fileHash))) {
			await stageReviewedCandidates(repository.fileStore, rows.filter(row => row.fileHash === hash));
		}
		return rows;
	});
	return { path: resolve(directory, "fixture.ka1"), candidates };
}

export async function restoreCompletionArchive(page: Page, password: string, archive: string) {
	await openBackupRestorePanel(page);
	await page.locator("#backup-password").fill(password);
	await page.locator("#restore-file").setInputFiles(archive);
	await page.getByRole("button", { name: /^(预览|Preview)$/, exact: true }).click();
	await page.getByRole("button", { name: /^(确认|Confirm) ·/ }).click();
	await expect(page.getByText(/已恢复 \d+ 条记录|Restored \d+ records/)).toBeVisible();
}
