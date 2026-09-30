import { readFileSync } from "node:fs";
import { expect, type BrowserContext, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import type { Asset } from "../../packages/domain/src";
import type { RecordRow } from "../../packages/local-db/src";

const password = "restore-recovery-release-password-2026";
test.use({ actionTimeout: 15_000 });

const copyFor = (zh: boolean) =>
	zh
		? {
				add: "新增",
				name: "名称",
				save: "保存",
				edit: "编辑",
				notes: "备注",
				addPhoto: "添加图片",
				confirmExact: "确认",
				backup: "创建备份",
				download: "保存备份文件",
				preview: "预览",
				confirm: /^确认 ·/,
				continue: "继续恢复",
				keepCurrent: "保留当前资料并放弃剩余恢复",
				abandonConfirm: "确认保留当前资料",
				recoveryTitle: "恢复待处理",
				working: "处理中…",
				abandonHint: "剩余记录和审核条目不会继续写入",
				reason:
					"恢复尚未完成。请核对当前资料后选择继续，或保留当前资料并放弃剩余恢复。",
				identityRefusal:
					"备份来源与当前同步身份不一致，或没有来源标识，未恢复资料。",
			}
		: {
				add: "Add",
				name: "Name",
				save: "Save",
				edit: "Edit",
				notes: "Notes",
				addPhoto: "Add image",
				confirmExact: "Confirm",
				backup: "Create backup",
				download: "Save backup file",
				preview: "Preview",
				confirm: /^Confirm ·/,
				continue: "Continue restore",
				keepCurrent: "Keep current data and abandon restore",
				abandonConfirm: "Keep current data",
				recoveryTitle: "Restore needs attention",
				working: "Working…",
				abandonHint: "Remaining records and review entries will not continue",
				reason:
					"The restore is incomplete. Check current data, then continue or keep current data and abandon the remainder.",
				identityRefusal:
					"The backup has a different or unknown sync identity. No records were restored.",
			};

type Copy = ReturnType<typeof copyFor>;
type Attachment = { id: string; name: string; type: string; bytes: number[] };
type Archive = { path: string; rows: RecordRow[]; attachments: Attachment[] };

function assets(rows: RecordRow[]): Asset[] {
	return rows
		.filter((row) => row.type === "asset")
		.map((row) => JSON.parse(row.payload) as Asset);
}

async function createAccount(page: Page, copy: Copy, name: string) {
	await page.goto("/assets/account");
	await page
		.getByRole("main")
		.getByRole("button", { name: copy.add, exact: true })
		.click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel(copy.name, { exact: true }).fill(name);
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(
		page.locator("main .asset-account-card").filter({ hasText: name }),
	).toHaveCount(1);
}

async function addAccountPhoto(
	page: Page,
	copy: Copy,
	name: string,
	bytes: Buffer,
) {
	await page.goto("/assets/account");
	await page
		.locator("main .asset-account-card")
		.filter({ hasText: name })
		.click();
	await expect(page.getByRole("heading", { name })).toBeVisible();
	await page
		.getByRole("button", { name: copy.addPhoto, exact: true })
		.last()
		.click();
	await page.getByLabel(copy.addPhoto, { exact: true }).setInputFiles({
		name: "restore-release-photo.png",
		mimeType: "image/png",
		buffer: bytes,
	});
	const dialog = page.getByRole("dialog");
	await expect(
		dialog.getByRole("button", { name: copy.confirmExact, exact: true }),
	).toBeEnabled();
	await dialog
		.getByRole("button", { name: copy.confirmExact, exact: true })
		.click();
	await expect(dialog).toBeHidden();
	await expect(page.locator(".image-item")).toHaveCount(1);
}

async function downloadAndInspect(
	page: Page,
	copy: Copy,
	filename: string,
): Promise<Archive> {
	await page.goto("/intake");
	await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: copy.backup, exact: true }).click();
	const link = page.getByRole("link", { name: copy.download, exact: true });
	await expect(link).toBeVisible();
	const downloadPromise = page.waitForEvent("download");
	await link.click();
	const download = await downloadPromise;
	const path = test.info().outputPath(filename);
	await download.saveAs(path);
	const bytes = readFileSync(path);
	expect(bytes.subarray(0, 8).toString()).toBe("KEEPANY1");
	const entries = unzipSync(
		await decryptBackup(new Uint8Array(bytes), password),
	);
	const rows = JSON.parse(strFromU8(entries["records.json"])) as RecordRow[];
	const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as {
		attachments: Array<{
			id: string;
			name: string;
			type: string;
			size: number;
		}>;
	};
	const attachments = manifest.attachments.map((attachment) => ({
		...attachment,
		bytes: Array.from(entries[`files/${attachment.id}`] ?? new Uint8Array()),
	}));
	for (const attachment of attachments)
		expect(attachment.bytes).toHaveLength(attachment.size);
	return { path, rows, attachments };
}

async function openRestoreSection(page: Page) {
	const section = page
		.locator("details.intake-secondary")
		.filter({ has: page.locator("#restore-file") });
	await expect(section).toHaveCount(1);
	if ((await section.getAttribute("open")) === null)
		await section.locator("summary").click();
	return section;
}

async function prepareRestore(
	page: Page,
	copy: Copy,
	archivePath: string,
	navigate = true,
) {
	if (navigate) await page.goto("/intake");
	await openRestoreSection(page);
	await page.locator("#backup-password").fill(password);
	await page.locator("#restore-file").setInputFiles(archivePath);
	await page
		.getByRole("button", { name: copy.preview, exact: true })
		.first()
		.click();
	await expect(page.getByRole("button", { name: copy.confirm })).toBeVisible();
}

async function expectPendingPanel(
	page: Page,
	copy: Copy,
	counts: [number, number, number, number, number],
) {
	const panel = page.locator(".restore-recovery-panel");
	await expect(panel).toBeVisible();
	await expect(
		panel.getByRole("heading", { name: copy.recoveryTitle, exact: true }),
	).toBeVisible();
	await expect(panel.locator(".restore-recovery-counts dd")).toHaveText(
		counts.map(String),
	);
	await expect(panel.locator(".restore-recovery-reason")).toHaveText(
		copy.reason,
	);
	await expect(
		panel.getByRole("button", { name: copy.continue, exact: true }),
	).toBeVisible();
	await expect(
		panel.getByRole("button", { name: copy.keepCurrent, exact: true }),
	).toBeVisible();
	return panel;
}

// Intercept only the existing RxDB record write for one archive row. All
// records and attachments still enter through the formal file preview/restore.
function recordFault({ rowId }: { rowId: string }) {
	const state = { enabled: true, writes: 0, failures: 0 };
	(
		globalThis as typeof globalThis & { __restoreRecordFault?: typeof state }
	).__restoreRecordFault = state;
	const prototype = IDBObjectStore.prototype;
	const put = prototype.put,
		add = prototype.add;
	const inspect = (store: IDBObjectStore, value: unknown) => {
		if (
			!value ||
			typeof value !== "object" ||
			store.name !== "docs" ||
			!store.transaction.db.name.endsWith("--records")
		)
			return;
		const row = value as { id?: unknown };
		if (row.id !== rowId) return;
		state.writes++;
		if (state.enabled) {
			state.failures++;
			throw new DOMException(
				"controlled restore record write interruption",
				"QuotaExceededError",
			);
		}
	};
	prototype.put = function (value: unknown, key?: IDBValidKey) {
		inspect(this, value);
		return key === undefined
			? put.call(this, value)
			: put.call(this, value, key);
	};
	prototype.add = function (value: unknown, key?: IDBValidKey) {
		inspect(this, value);
		return key === undefined
			? add.call(this, value)
			: add.call(this, value, key);
	};
}

async function disableFault(page: Page) {
	await page.evaluate(() => {
		const state = (
			globalThis as typeof globalThis & {
				__restoreRecordFault?: { enabled: boolean };
			}
		).__restoreRecordFault;
		if (!state) throw Error("record-fault-not-installed");
		state.enabled = false;
	});
}

for (const { locale, width, abandon } of [
	{ locale: "zh-CN", width: 390, abandon: false },
	{ locale: "en-US", width: 1280, abandon: true },
]) {
	test(`${locale} ${width}px fixed UI ${abandon ? "keeps current data" : "continues restore"} after a controlled record write interruption`, async ({
		browser,
	}) => {
		test.setTimeout(90000);
		const copy = copyFor(locale === "zh-CN");
		const source = await browser.newContext({
			locale,
			viewport: { width, height: 844 },
			acceptDownloads: true,
		});
		const clean = await browser.newContext({
			locale,
			viewport: { width, height: 844 },
			acceptDownloads: true,
		});
		const page = await source.newPage(),
			restored = await clean.newPage();
		const errors: string[] = [];
		for (const target of [page, restored])
			target.on("pageerror", (error) => errors.push(error.message));
		const suffix = crypto.randomUUID().slice(0, 8);
		const names = [`Restore first ${suffix}`, `Restore second ${suffix}`];
		const existing = `Keep my account ${suffix}`;
		const image = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
			"base64",
		);
		try {
			await createAccount(page, copy, names[0]);
			await createAccount(page, copy, names[1]);
			await addAccountPhoto(page, copy, names[0], image);
			const archive = await downloadAndInspect(page, copy, "source.ka1");
			expect(archive.rows).toHaveLength(2);
			expect(archive.attachments).toHaveLength(1);
			expect(archive.attachments[0].bytes).toEqual([...image]);
			// A real UI save warms the target database and also proves existing data is
			// preserved. Opening native databases ahead of initialization can create
			// empty stores and is deliberately avoided.
			await createAccount(restored, copy, existing);
			const current = await downloadAndInspect(restored, copy, "current.ka1");
			const blockedRow = archive.rows[1];
			await clean.addInitScript(recordFault, { rowId: blockedRow.id });
			await restored.evaluate(recordFault, { rowId: blockedRow.id });
			await prepareRestore(restored, copy, archive.path);
			await restored.getByRole("button", { name: copy.confirm }).click();
			const pending = await expectPendingPanel(restored, copy, [2, 0, 1, 1, 0]);
			const fault = await restored.evaluate(
				() =>
					(
						globalThis as typeof globalThis & {
							__restoreRecordFault?: { writes: number; failures: number };
						}
					).__restoreRecordFault,
			);
			expect(fault?.failures).toBeGreaterThan(0);
			await test
				.info()
				.attach("controlled-write-failure", {
					body: JSON.stringify(fault),
					contentType: "application/json",
				});
			await restored.screenshot({
				path: test.info().outputPath(`restore-pending-${locale}-${width}.png`),
				fullPage: true,
			});
			await restored.reload();
			const reopened = await expectPendingPanel(
				restored,
				copy,
				[2, 0, 1, 1, 0],
			);
			await disableFault(restored);
			if (abandon) {
				await reopened
					.getByRole("button", { name: copy.keepCurrent, exact: true })
					.click();
				const dialog = restored.getByRole("dialog");
				await expect(dialog).toBeVisible();
				await expect(dialog).toContainText(copy.abandonHint);
				await dialog
					.getByRole("button", { name: "Cancel", exact: true })
					.click();
				await expect(dialog).toBeHidden();
				await expectPendingPanel(restored, copy, [2, 0, 1, 1, 0]);
				const before = await downloadAndInspect(
					restored,
					copy,
					"partial-before.ka1",
				);
				await restored.goto("/intake");
				await restored
					.locator(".restore-recovery-panel")
					.getByRole("button", { name: copy.keepCurrent, exact: true })
					.click();
				await restored
					.getByRole("dialog")
					.getByRole("button", { name: copy.abandonConfirm, exact: true })
					.click();
				await expect(restored.locator(".restore-recovery-panel")).toHaveCount(
					0,
				);
				const after = await downloadAndInspect(
					restored,
					copy,
					"partial-after.ka1",
				);
				expect(after.rows).toEqual(before.rows);
				expect(after.attachments).toEqual(before.attachments);
				expect(assets(after.rows)).toHaveLength(2);
				expect(after.rows).toEqual(expect.arrayContaining(current.rows));
				expect(after.rows.some((row) => row.id === blockedRow.id)).toBe(false);
				await restored.screenshot({
					path: test.info().outputPath(`restore-kept-${locale}-${width}.png`),
					fullPage: true,
				});
				// Dropping the intent unlocks a new ordinary restore without undoing the
				// already restored row or the existing account.
				await prepareRestore(restored, copy, archive.path);
				await disableFault(restored);
				await restored.getByRole("button", { name: copy.confirm }).click();
				await expect(restored.getByText("Restored 2 records", { exact: true })).toBeVisible();
			} else {
				await reopened
					.getByRole("button", { name: copy.continue, exact: true })
					.click();
			}
			await expect(restored.locator(".restore-recovery-panel")).toHaveCount(0);
			const complete = await downloadAndInspect(restored, copy, "complete.ka1");
			expect(complete.rows).toEqual(
				expect.arrayContaining([...archive.rows, ...current.rows]),
			);
			expect(complete.rows).toHaveLength(3);
			expect(complete.attachments).toEqual(archive.attachments);
			expect(new Set(complete.rows.map((row) => row.id)).size).toBe(3);
			await restored.reload();
			await expect(restored.locator(".restore-recovery-panel")).toHaveCount(0);
			const repeated = await downloadAndInspect(restored, copy, "reopened.ka1");
			expect(repeated.rows).toEqual(complete.rows);
			expect(repeated.attachments).toEqual(complete.attachments);
			const imageAsset = assets(archive.rows).find((asset) => asset.name === names[0])!;
			await restored.goto(`/assets/account/${imageAsset.id}`);
			const photo = restored.locator(".image-item img").first();
			await expect(photo).toBeVisible();
			await expect
				.poll(() =>
					photo.evaluate(
						(element) => (element as HTMLImageElement).naturalWidth,
					),
				)
				.toBe(1);
			expect(
				await restored.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(width);
			await restored.screenshot({
				path: test.info().outputPath(`restore-complete-${locale}-${width}.png`),
				fullPage: true,
			});
			expect(errors).toEqual([]);
		} finally {
			await source.close();
			await clean.close();
		}
	});
}
