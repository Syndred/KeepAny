import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	readCandidate,
	selectCandidate,
} from "../../scripts/lib/portable-candidate.mjs";
import { resources } from "../../apps/web/src/i18n";
import { assetSchema, newAsset, type Asset } from "../../packages/domain/src";
import {
	prepareCompletionArchive,
	restoreCompletionArchive,
} from "./helpers/completion-archive";
import { openBackupPage } from "./helpers/backup-restore";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { unzipSync, strFromU8 } from "fflate";

type Locale = "zh-CN" | "en";
const text = (locale: Locale, key: string) =>
	(resources[locale].translation as Record<string, string>)[key];
function candidate() {
	if (process.env.KEEPANY_WEB_CANDIDATE) {
		const manifest = JSON.parse(
			readFileSync(
				resolve(process.env.KEEPANY_WEB_CANDIDATE, "CANDIDATE.json"),
				"utf8",
			),
		);
		return {
			...manifest,
			indexSha256: manifest.webFiles.find(
				(file: any) => file.path === "index.html",
			).sha256,
		};
	}
	const { release, archiveSha256 } = readCandidate(selectCandidate());
	return {
		sourceCommit: release.sourceCommit,
		sourceDirty: release.sourceDirty,
		archiveSha256,
		indexSha256: release.webFiles.find(
			(file: any) => file.path === "index.html",
		)!.sha256,
	};
}
async function start(page: Page, locale: Locale, info: TestInfo) {
	await page.addInitScript(
		(language) => localStorage.setItem("keepany-language", language),
		locale,
	);
	const identity = candidate();
	const index = await page.request.get("/");
	expect(
		createHash("sha256")
			.update(await index.body())
			.digest("hex"),
	).toBe(identity.indexSha256);
	await info.attach("candidate.json", {
		body: JSON.stringify(identity),
		contentType: "application/json",
	});
	await page.goto("/assets");
	await expect(page.locator(".workspace-navigation")).toBeVisible();
}
async function newCategory(page: Page, locale: Locale, name: string) {
	await page
		.locator(".workspace-navigation")
		.getByRole("button", { name: text(locale, "catalogNew"), exact: true })
		.click();
	const dialog = page.getByRole("dialog");
	await dialog
		.getByLabel(text(locale, "catalogName"), { exact: true })
		.fill(name);
	await dialog
		.getByRole("button", { name: text(locale, "catalogNew"), exact: true })
		.click();
	await expect(dialog).toBeHidden();
	await expect(
		page.getByRole("heading", { level: 1, name, exact: true }),
	).toBeVisible();
}
async function newRecord(page: Page, locale: Locale, name: string) {
	await page
		.getByRole("button", {
			name: text(locale, "workspaceAddAsset"),
			exact: true,
		})
		.click();
	const dialog = page.getByRole("dialog");
	await dialog.locator("#catalog-record-name").fill(name);
	await dialog
		.getByRole("button", { name: text(locale, "save"), exact: true })
		.click();
	await expect(dialog).toBeHidden();
}
async function manage(page: Page, locale: Locale) {
	await page
		.locator(".workspace-navigation")
		.getByRole("button", { name: text(locale, "catalogManage"), exact: true })
		.click();
	return page.getByRole("dialog");
}
async function noOverflow(page: Page) {
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth > innerWidth,
		),
	).toBe(false);
}

for (const locale of ["zh-CN", "en"] as const)
	test(`${locale}: CAT01 CAT02 CAT03 CAT04 CAT05 CAT06 CAT07 basic records and category lifecycle`, async ({
		page,
	}, info) => {
		const t = (key: string) => text(locale, key);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await start(page, locale, info);
		await expect(page.locator(".workspace-navigation > a")).toHaveCount(4);
		await page
			.locator(".workspace-navigation")
			.getByRole("button", { name: t("catalogNew"), exact: true })
			.click();
		await page
			.getByRole("dialog")
			.getByLabel(t("catalogName"), { exact: true })
			.fill("Cancelled");
		await page
			.getByRole("dialog")
			.getByRole("button", { name: t("close"), exact: true })
			.last()
			.click();
		await expect(
			page
				.locator(".workspace-navigation")
				.getByRole("link", { name: "Cancelled", exact: true }),
		).toHaveCount(0);
		await newCategory(page, locale, "Collection");
		await page
			.locator(".workspace-navigation")
			.getByRole("button", { name: t("catalogNew"), exact: true })
			.click();
		const duplicate = page.getByRole("dialog");
		await duplicate
			.getByLabel(t("catalogName"), { exact: true })
			.fill("ＣＯＬＬＥＣＴＩＯＮ");
		await duplicate
			.getByRole("button", { name: t("catalogNew"), exact: true })
			.click();
		await expect(duplicate.getByRole("alert")).toHaveText(
			t("categoryDuplicate"),
		);
		await duplicate
			.getByLabel(t("catalogName"), { exact: true })
			.fill(t("all"));
		await duplicate
			.getByRole("button", { name: t("catalogNew"), exact: true })
			.click();
		await expect(duplicate.getByRole("alert")).toHaveText(
			t("categoryDuplicate"),
		);
		await duplicate
			.getByRole("button", { name: t("close"), exact: true })
			.last()
			.click();
		await newRecord(page, locale, "Minimal keepsake");
		const card = page
			.locator(".catalog-record-card")
			.filter({ hasText: "Minimal keepsake" });
		await expect(card).toBeVisible();
		await card.click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Minimal keepsake" }),
		).toBeVisible();
		await page.getByRole("button", { name: t("edit"), exact: true }).click();
		const editor = page.getByRole("dialog");
		await expect(editor.locator(".form-grid > .field")).toHaveCount(6);
		await expect(editor.getByText(t("contact"), { exact: true })).toHaveCount(
			0,
		);
		await editor.locator("#catalog-record-name").fill("Cancelled edit");
		await editor
			.getByRole("button", { name: t("cancel"), exact: true })
			.click();
		await expect(
			page.getByRole("heading", { level: 1, name: "Minimal keepsake" }),
		).toBeVisible();
		await page.getByRole("button", { name: t("edit"), exact: true }).click();
		await editor
			.locator("#catalog-record-url")
			.fill("https://example.test/collection");
		await editor.locator("#catalog-record-tags").fill("keepsake, personal");
		await editor
			.locator("#catalog-record-notes")
			.fill("Synthetic note stays local.");
		await editor.getByRole("button", { name: t("save"), exact: true }).click();
		await expect(editor).toBeHidden();
		await page.reload();
		await expect(page.locator(".catalog-record-notes")).toHaveText(
			"Synthetic note stays local.",
		);
		await expect(page.locator(".catalog-record-info a")).toHaveAttribute(
			"href",
			"https://example.test/collection",
		);
		await page
			.getByRole("link", { name: t("back"), exact: true })
			.last()
			.click();
		await newCategory(page, locale, "Second");
		await newRecord(page, locale, "Second record");
		let manager = await manage(page, locale);
		await manager
			.getByRole("region", { name: "Second", exact: true })
			.getByRole("button", {
				name: `${t("catalogMoveUp")} Second`,
				exact: true,
			})
			.click();
		await manager
			.getByRole("button", { name: t("close"), exact: true })
			.last()
			.click();
		await expect(page.locator(".workspace-navigation > a").nth(4)).toHaveText(
			"Second",
		);
		manager = await manage(page, locale);
		let group = manager.getByRole("region", {
			name: "Collection",
			exact: true,
		});
		await group.getByRole("button", { name: t("edit"), exact: true }).click();
		await manager
			.getByLabel(t("catalogName"), { exact: true })
			.fill("Memories");
		await manager.getByRole("button", { name: t("save"), exact: true }).click();
		group = manager.getByRole("region", { name: "Memories", exact: true });
		await group
			.getByRole("button", { name: t("catalogHide"), exact: true })
			.click();
		await manager
			.getByRole("button", { name: t("close"), exact: true })
			.last()
			.click();
		await expect(
			page
				.locator(".workspace-navigation")
				.getByRole("link", { name: "Memories", exact: true }),
		).toHaveCount(0);
		await page.reload();
		manager = await manage(page, locale);
		group = manager.getByRole("region", { name: "Memories", exact: true });
		await group
			.getByRole("button", { name: t("catalogShow"), exact: true })
			.click();
		await group.getByRole("button", { name: t("remove"), exact: true }).click();
		await manager
			.getByRole("region", { name: t("catalogRemoveTitle"), exact: true })
			.getByRole("button", { name: t("cancel"), exact: true })
			.click();
		await expect(group).toBeVisible();
		await group.getByRole("button", { name: t("remove"), exact: true }).click();
		await manager
			.getByRole("button", { name: t("catalogRemoveTitle"), exact: true })
			.click();
		await expect(group).toHaveCount(0);
		await manager
			.getByRole("button", { name: t("close"), exact: true })
			.last()
			.click();
		await page
			.locator(".workspace-navigation")
			.getByRole("link", { name: t("all"), exact: true })
			.click();
		await expect(
			page
				.locator(".catalog-record-card")
				.filter({ hasText: "Minimal keepsake" }),
		).toBeVisible();
		await expect(
			page
				.locator(".catalog-record-card")
				.filter({ hasText: "Minimal keepsake" }),
		).toContainText(t("catalogUnclassified"));
		for (const key of ["item", "subscription", "workspaceLedger"]) {
			await page
				.locator(".workspace-navigation")
				.getByRole("link", { name: t(key), exact: true })
				.click();
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		}
		await noOverflow(page);
		expect(errors).toEqual([]);
		await info.attach("contract-results.json", {
			body: JSON.stringify({
				ids: ["CAT01", "CAT02", "CAT03", "CAT04", "CAT05", "CAT06", "CAT07"],
				result: "passed",
				candidate: candidate().indexSha256,
			}),
			contentType: "application/json",
		});
	});

for (const locale of ["zh-CN", "en"] as const)
	for (const width of [390, 768, 884, 1280, 1920])
		test(`${locale} ${width}: CAT09 navigation, manager and uniform editor states`, async ({
			page,
		}, info) => {
			await page.setViewportSize({ width, height: 900 });
			await start(page, locale, info);
			const t = (key: string) => text(locale, key);
			const long =
				locale === "zh-CN"
					? "个人收藏与学习资料分类名称很长时也能完整阅读"
					: "Personal collections and long study resources";
			await newCategory(page, locale, long);
			await newRecord(page, locale, "Long record title ".repeat(7));
			await noOverflow(page);
			await page.screenshot({
				path: info.outputPath("category.png"),
				fullPage: true,
			});
			const manager = await manage(page, locale);
			await expect(
				manager.getByRole("button", { name: t("catalogNew"), exact: true }),
			).toBeDisabled();
			await manager.getByLabel(t("catalogName"), { exact: true }).fill(long);
			await manager
				.getByRole("button", { name: t("catalogNew"), exact: true })
				.click();
			await expect(manager.getByRole("alert")).toBeVisible();
			await page.screenshot({
				path: info.outputPath("manager-error.png"),
				fullPage: true,
			});
			await manager
				.getByRole("button", { name: t("close"), exact: true })
				.last()
				.click();
			await page
				.getByRole("button", { name: t("workspaceAddAsset"), exact: true })
				.click();
			const editor = page.getByRole("dialog");
			await editor.locator("#catalog-record-name").focus();
			await editor.locator("#catalog-record-name").fill("");
			await editor
				.getByRole("button", { name: t("save"), exact: true })
				.click();
			await expect(editor.locator("#catalog-record-name")).toHaveAttribute(
				"aria-invalid",
				"true",
			);
			await editor.locator("#catalog-record-name").focus();
			await page.screenshot({
				path: info.outputPath("editor-error-focus.png"),
				fullPage: true,
			});
			await editor
				.getByRole("button", { name: t("cancel"), exact: true })
				.click();
			await page.locator(".catalog-record-card").click();
			await page.getByRole("button", { name: t("edit"), exact: true }).click();
			await page
				.getByRole("dialog")
				.locator("#catalog-record-url")
				.fill(`https://example.test/${"long-segment-".repeat(24)}`);
			await page
				.getByRole("dialog")
				.locator("#catalog-record-notes")
				.fill("Long notes ".repeat(30) + "x".repeat(200));
			await page
				.getByRole("dialog")
				.getByRole("button", { name: t("save"), exact: true })
				.click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await page.reload();
			await expect(page.locator(".catalog-record-info dl")).toHaveCSS(
				"display",
				"grid",
			);
			const actions = page.locator(
				".catalog-record-detail .page-header > .actions",
			);
			const buttons = await actions
				.locator("button")
				.evaluateAll((nodes) =>
					nodes.map((node) => node.getBoundingClientRect().width),
				);
			expect(buttons.every((width) => width >= 44)).toBe(true);
			expect((await actions.boundingBox())!.width).toBeGreaterThanOrEqual(
				Math.max(...buttons),
			);
			await noOverflow(page);
			await page.screenshot({
				path: info.outputPath("detail-refreshed-long.png"),
				fullPage: true,
			});
			await page.locator(".catalog-record-extra > summary").click();
			await noOverflow(page);
			await page.screenshot({
				path: info.outputPath("detail-expanded.png"),
				fullPage: true,
			});
			await page.goto("/");
			await expect(
				page.getByRole("heading", { name: t("catalogMyRecords"), exact: true }),
			).toBeVisible();
			await noOverflow(page);
			await page.screenshot({
				path: info.outputPath("overview-records.png"),
				fullPage: true,
			});
			await info.attach("contract-results.json", {
				body: JSON.stringify({
					ids: ["CAT09"],
					result: "passed",
					locale,
					width,
					candidate: candidate().indexSha256,
				}),
				contentType: "application/json",
			});
		});

test("CAT13 pictures, connections, cancel and recycle-bin restore stay usable", async ({
	page,
}, info) => {
	await start(page, "en", info);
	await newCategory(page, "en", "Personal");
	await newRecord(page, "en", "Photograph");
	await newRecord(page, "en", "Related note");
	await page
		.locator(".catalog-record-card")
		.filter({ hasText: "Photograph" })
		.click();
	await page.locator(".catalog-record-extra > summary").click();
	await page
		.locator('input[type="file"]')
		.setInputFiles(resolve("apps/web/public/samples/logo.png"));
	await expect(page.locator(".catalog-images img")).toHaveCount(1);
	const form = page.locator(".catalog-relation-form");
	await form.getByRole("combobox").click();
	await page.getByRole("option", { name: "Related note", exact: true }).click();
	await form.getByRole("textbox").fill("Reference");
	await form
		.getByRole("button", { name: "Add connection", exact: true })
		.click();
	await expect(page.locator(".catalog-related-row")).toHaveCount(1);
	await form.getByRole("combobox").click();
	await page.getByRole("option", { name: "Related note", exact: true }).click();
	await form.getByRole("textbox").fill("Reference");
	await form
		.getByRole("button", { name: "Add connection", exact: true })
		.click();
	await expect(page.getByRole("alert")).toBeVisible();
	await expect(page.locator(".catalog-related-row")).toHaveCount(1);
	await page.screenshot({
		path: info.outputPath("populated-details.png"),
		fullPage: true,
	});
	await page
		.locator(".catalog-related-row")
		.getByRole("button", { name: "Remove", exact: true })
		.click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	await expect(page.locator(".catalog-related-row")).toHaveCount(1);
	await page
		.locator(".catalog-related-row")
		.getByRole("button", { name: "Remove", exact: true })
		.click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Remove", exact: true })
		.click();
	await expect(page.locator(".catalog-related-row")).toHaveCount(0);
	await page
		.locator(".catalog-images")
		.getByRole("button", { name: "Remove image", exact: true })
		.click();
	await expect(page.locator(".catalog-images img")).toHaveCount(0);
	await page
		.getByRole("button", { name: text("en", "delete"), exact: true })
		.click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Photograph" }),
	).toBeVisible();
	await page
		.getByRole("button", { name: text("en", "delete"), exact: true })
		.click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: text("en", "delete"), exact: true })
		.click();
	await expect(
		page.locator(".catalog-record-card").filter({ hasText: "Photograph" }),
	).toHaveCount(0);
	await page.locator('.sidebar a[href="/trash"]').click();
	const row = page
		.locator(".trash-row[data-asset-id]")
		.filter({ hasText: "Photograph" });
	await row.getByRole("button", { name: "Restore", exact: true }).click();
	await page.locator('.sidebar a[href="/assets"]').click();
	await expect(
		page.locator(".catalog-record-card").filter({ hasText: "Photograph" }),
	).toBeVisible();
	await info.attach("contract-results.json", {
		body: JSON.stringify({
			ids: ["CAT13"],
			result: "passed",
			candidate: candidate().indexSha256,
		}),
		contentType: "application/json",
	});
});

test("CAT08 legacy project/domain and category backup remain lossless", async ({
	page,
}, info) => {
	const password = "Synthetic-catalog-backup-only";
	const directory = resolve(
		process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/catalog-categories",
		"legacy-fixture",
	);
	let legacy!: Asset;
	await prepareCompletionArchive(directory, password, async (db) => {
		const old = await db.createCategory("project", "Legacy Work", 0);
		legacy = assetSchema.parse({
			...newAsset("project"),
			catalogCategoryId: undefined,
			category: old.name,
			name: "Old project",
			description: "Original description",
			contact: "Original contact",
			longDescription: "Original private long copy",
			projectLaunchMonth: "2025-01",
			projectDomains: [
				{
					id: crypto.randomUUID(),
					name: "example.test",
					registrar: "Registrar kept",
					annualAmount: 1234,
					expiryDate: "2027-10-30",
				},
				{
					id: crypto.randomUUID(),
					name: `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.test`,
				},
			],
		});
		await db.save("asset", legacy);
		await db.save("asset", {
			...newAsset("project"),
			catalogCategoryId: undefined,
			name: "Other project",
		});
		return legacy;
	});
	await start(page, "en", info);
	await restoreCompletionArchive(
		page,
		password,
		resolve(directory, "fixture.ka1"),
	);
	await page.goto("/assets");
	await expect(
		page
			.locator(".workspace-navigation")
			.getByRole("link", { name: "Projects", exact: true }),
	).toBeVisible();
	await expect(
		page
			.locator(".workspace-navigation")
			.getByRole("link", { name: "Domains", exact: true }),
	).toBeVisible();
	await page
		.locator(".sidebar-category")
		.filter({ hasText: "Legacy Work" })
		.click();
	await expect(page.locator(".catalog-record-card")).toHaveCount(1);
	await expect(page.locator(".catalog-record-card")).toContainText(
		"Old project",
	);
	await page
		.locator(".workspace-navigation")
		.getByRole("link", { name: "Domains", exact: true })
		.click();
	await page
		.locator(".catalog-record-card")
		.filter({ hasText: "example.test" })
		.click();
	await expect(
		page.getByRole("button", { name: "Move to trash", exact: true }),
	).toHaveCount(0);
	await page.locator(".catalog-record-extra > summary").click();
	await expect(page.locator(".catalog-relation-form")).toHaveCount(0);
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const editor = page.getByRole("dialog");
	await editor.locator("#catalog-record-name").fill("Independent display name");
	await editor.locator("#catalog-record-notes").fill("Generic domain note");
	await editor.getByRole("button", { name: "Save", exact: true }).click();
	await expect(editor).toBeHidden();
	await page.reload();
	await expect(
		page.getByRole("heading", { level: 1, name: "Independent display name" }),
	).toBeVisible();
	await page.goto("/assets");
	await page
		.locator(".workspace-navigation")
		.getByRole("link", { name: "Domains", exact: true })
		.click();
	await page
		.locator(".catalog-record-card")
		.filter({ hasText: "a".repeat(60) })
		.click();
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	await editor
		.locator("#catalog-record-notes")
		.fill("Long legacy name preserved");
	await editor.getByRole("button", { name: "Save", exact: true }).click();
	await expect(editor).toBeHidden();
	await expect(page.locator(".catalog-record-notes")).toHaveText(
		"Long legacy name preserved",
	);
	await openBackupPage(page);
	await page.locator("#backup-password").fill(password);
	await page
		.getByRole("button", { name: "Create backup", exact: true })
		.click();
	const pending = page.waitForEvent("download");
	await page
		.getByRole("link", { name: "Save backup file", exact: true })
		.click();
	const downloaded = await pending;
	const raw = await decryptBackup(
		new Uint8Array(readFileSync((await downloaded.path())!)),
		password,
	);
	const rows = JSON.parse(strFromU8(unzipSync(raw)["records.json"]));
	const restored = JSON.parse(
		rows.find((row: any) => row.id === `asset:${legacy.id}`).payload,
	);
	expect(restored).toMatchObject({
		description: legacy.description,
		contact: legacy.contact,
		longDescription: legacy.longDescription,
		projectLaunchMonth: "2025-01",
	});
	expect(restored.projectDomains[0]).toMatchObject({
		name: "example.test",
		registrar: "Registrar kept",
		annualAmount: 1234,
		catalog: { name: "Independent display name", notes: "Generic domain note" },
	});
	expect(rows.filter((row: any) => row.type === "category")).toHaveLength(3);
	await info.attach("contract-results.json", {
		body: JSON.stringify({
			ids: ["CAT08"],
			result: "passed",
			candidate: candidate().indexSha256,
		}),
		contentType: "application/json",
	});
});
