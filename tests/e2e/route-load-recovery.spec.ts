import { openBackupPage } from "./helpers/backup-restore";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
	expect,
	test,
	type APIRequestContext,
	type Browser,
	type Locator,
	type Page,
	type TestInfo,
} from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import {
	inspectVisualKdbx,
	importVisualKdbxEntries,
	visualCopy,
	visualMaster,
} from "./fixtures/password-smart-import-visual";
import {
	openVaultAccess,
	revealPasswordEntries,
} from "./helpers/vault-access";

// Test author is independent of the product implementation. All writes below
// are real UI operations on synthetic data. KDBX setup is explicitly generated
// in Node and imported through the real file chooser. Read-only backup inspection is
// auxiliary observation, not a claim that it is itself a user interaction.
const widths = [390, 563, 768, 1280, 1920, 2560] as const;
const languages = ["zh-CN", "en"] as const;
type Language = (typeof languages)[number];
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/route-load-recovery/evidence";
const syntheticPassword = "Synthetic-FC17-entry!42";
const updatedPassword = "Synthetic-FC17-entry-updated!42";
const backupPassword = "Synthetic-FC17-backup!42";
const titles = ["Gmail FC17", "GitHub FC17"];
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type Release = {
	sourceCommit: string;
	sourceDirty: boolean;
	webFiles: { path: string; sha256: string }[];
	applicationRoutes: { paths: string[] };
};
function packageIdentity() {
	const archive = process.env.KEEPANY_PREVIEW_ARCHIVE;
	const directory = process.env.KEEPANY_PREVIEW_DIRECTORY;
	if (archive) {
		const bytes = readFileSync(archive);
		const archiveSha256 = sha(bytes);
		expect(archiveSha256).toBe(readFileSync(`${archive}.sha256`, "utf8").trim().split(/\s+/)[0]);
		const files = unzipSync(bytes);
		const names = Object.keys(files).filter((name) => name.endsWith("/RELEASE.json") && name.split("/").length === 2);
		expect(names).toHaveLength(1);
		return { release: JSON.parse(strFromU8(files[names[0]])) as Release, archiveSha256 };
	}
	if (directory) return { release: JSON.parse(readFileSync(join(directory, "RELEASE.json"), "utf8")) as Release, archiveSha256: null };
	throw Error("FC17 requires an actual portable candidate, never development source");
}
async function servedIdentity(request: APIRequestContext) {
	const candidate = packageIdentity();
	const html = await (await request.get("/")).body();
	const indexSha256 = sha(html);
	expect(indexSha256).toBe(candidate.release.webFiles.find((row) => row.path === "index.html")?.sha256);
	return { candidate: candidate.release.sourceCommit, sourceDirty: candidate.release.sourceDirty, archiveSha256: candidate.archiveSha256, indexSha256 };
}
function modulePath(release: Release, prefix: string) {
	const files = release.webFiles.filter((row) => row.path.startsWith(`assets/${prefix}-`) && row.path.endsWith(".js"));
	expect(files, `One actual compiled module for ${prefix}`).toHaveLength(1);
	return `/${files[0].path}`;
}
async function harness(browser: Browser, language: Language, width: number, baseURL: string) {
	const context = await browser.newContext({ baseURL, locale: language === "en" ? "en-US" : language, viewport: { width, height: 1000 }, serviceWorkers: "block" });
	// Only language is initialized outside UI. SW blocking is explicit fault preparation.
	await context.addInitScript((value) => localStorage.setItem("keepany-language", value), language);
	const page = await context.newPage();
	page.setDefaultTimeout(15_000);
	return { context, page, t: visualCopy(language) };
}
function copy(language: Language) {
	return language === "zh-CN" ? {
		title: "暂时无法打开这个页面", hint: "请重新加载后再试，已保存的资料会保留。", reload: "重新加载", createBackup: "创建备份", saveBackup: "保存备份文件",
	} : {
		title: "This page could not be opened", hint: "Reload to try again. Your saved records will be kept.", reload: "Reload page", createBackup: "Create backup", saveBackup: "Save backup file",
	};
}
type Journal = { stage: string; [key: string]: unknown }[];
async function capture(page: Page, folder: string, name: string, steps: Journal, sectionOnly = false) {
	const path = join(folder, `${name}.png`);
	if (sectionOnly) await page.getByTestId("route-load-error").screenshot({ path });
	else await page.screenshot({ path });
	steps.push({ stage: "screenshot", name, path, sha256: sha(readFileSync(path)), visualVerdict: "not-reviewed" });
}
async function errorControls(page: Page, language: Language, width: number, steps: Journal) {
	const section = page.getByTestId("route-load-error");
	const text = copy(language);
	await expect(section).toBeVisible();
	await expect(section).toHaveAttribute("data-error-kind", "module-load");
	await expect(page.locator("main").filter({ has: section })).toHaveCount(1);
	const heading = section.getByRole("heading", { name: text.title, exact: true, level: 1 });
	await expect(heading).toHaveAttribute("tabindex", "-1");
	await expect(heading).toBeFocused();
	await expect(section.getByText(text.hint, { exact: true })).toBeVisible();
	const button = section.getByRole("button", { name: text.reload, exact: true });
	await expect(section.getByRole("button")).toHaveCount(1);
	await expect(button).toBeEnabled();
	await expect(section).not.toContainText(/TypeError|https?:\/\/|node_modules|Show Error|\.js\b|Synthetic-FC17/);
	if (width < 768) await expect(page.locator(".mobile-menu")).toBeVisible();
	else await expect(page.locator(".sidebar")).toBeVisible();
	const geometry = await section.evaluate((node) => {
		const bounds = node.getBoundingClientRect();
		const button = node.querySelector("button")?.getBoundingClientRect();
		const heading = node.querySelector("h1")?.getBoundingClientRect();
		return {
			section: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth },
			button: button && { left: button.left, right: button.right, top: button.top, bottom: button.bottom, width: button.width, height: button.height },
			heading: heading && { top: heading.top, bottom: heading.bottom }, viewport: { width: innerWidth, height: innerHeight },
			pageOverflow: document.documentElement.scrollWidth > innerWidth,
		};
	});
	// Save the actual observation even when a following contract assertion fails.
	steps.push({ stage: "error-controls", geometry, classification: "module-load", loadingDisabled: "N/A: reload is a hard navigation, no in-page saving/busy operation" });
	expect(geometry.pageOverflow).toBe(false);
	expect(geometry.section.left).toBeGreaterThanOrEqual(-1);
	expect(geometry.section.right).toBeLessThanOrEqual(width + 1);
	expect(geometry.section.scrollWidth).toBeLessThanOrEqual(geometry.section.clientWidth + 1);
	expect(geometry.button?.width).toBeGreaterThanOrEqual(44);
	expect(geometry.button?.height).toBeGreaterThanOrEqual(44);
	expect(geometry.button?.top).toBeGreaterThanOrEqual(0);
	expect(geometry.button?.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);
	expect(geometry.heading?.top).toBeGreaterThanOrEqual(0);
	expect(geometry.heading?.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);
	return { section, heading, button };
}
async function visibleStates(page: Page, folder: string, name: string, button: Locator, steps: Journal) {
	await capture(page, folder, `${name}-default`, steps);
	await button.hover();
	await capture(page, folder, `${name}-hover`, steps, true);
	await page.keyboard.press("Tab");
	await expect(button).toBeFocused();
	await capture(page, folder, `${name}-focus`, steps, true);
	const rect = await button.boundingBox();
	if (!rect) throw Error("FC17 reload button bounds missing");
	await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
	await page.mouse.down();
	await capture(page, folder, `${name}-pressed`, steps, true);
	// Cancel this pointer gesture outside the button. Recovery is a separate,
	// actual keyboard/click action; capturing a pressed frame is not a reload.
	await page.mouse.move(0, 0);
	await page.mouse.up();
}
async function unlock(page: Page, t: ReturnType<typeof visualCopy>, requireLocked: boolean) {
	await openVaultAccess(page);
	const input = page.locator("#password-vault-unlock-master");
	if (requireLocked) await expect(input).toBeVisible();
	if (await input.isVisible()) {
		await input.fill(visualMaster);
		await page.getByRole("button", { name: t("pwVaultUnlock"), exact: true }).click();
	}
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
	await revealPasswordEntries(page);
}
async function seedSavedData(page: Page, t: ReturnType<typeof visualCopy>) {
	await page.goto("/accounts");
	await openVaultAccess(page);
	await page.locator("#password-vault-master").fill(visualMaster);
	await page.locator("#password-vault-master-confirm").fill(visualMaster);
	await page.getByRole("button", { name: t("pwVaultCreate"), exact: true }).click();
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
	for (const [index, title] of titles.entries()) {
		// Password-only preparation is a fictional Node KDBX imported through
		// the real file chooser; publication remains the reviewed Connect flow.
		await importVisualKdbxEntries(page, t, [{ title, username: "fc17.owner@gmail.com", password: syntheticPassword, url: index ? "https://github.com/" : "https://mail.google.com/", notes: `Synthetic saved FC17 note ${index}. ${"Long saved text stays local. ".repeat(5)}` }]);
	}
	const first = page.locator(".password-vault-entry").filter({ has: page.getByRole("heading", { name: titles[0], exact: true }) });
	await first.getByRole("button", { name: t("pwVaultEditEntry"), exact: true }).click();
	await page.locator("#password-vault-entry-password").fill(updatedPassword);
	await page.getByRole("dialog").getByRole("button", { name: t("pwVaultSaveEntry"), exact: true }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await page.getByRole("button", { name: t("pwConnectTitle"), exact: true }).click();
	const dialog = page.locator(".vault-connect-dialog");
	await expect(dialog.locator(".vault-connect-account")).toHaveCount(2);
	await expect(dialog.locator(".vault-connect-conflict")).toHaveCount(0);
	await dialog.getByRole("button", { name: t("pwConnectSelectAll"), exact: true }).click();
	await dialog.getByRole("button", { name: t("pwConnectLocal"), exact: true }).click();
	await dialog.getByRole("button", { name: t("pwConnectSave"), exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.locator(".asset-account-card")).toHaveCount(2);
	await revealPasswordEntries(page);
}
async function exportedKdbx(page: Page, t: ReturnType<typeof visualCopy>, info: TestInfo, name: string) {
	await page.goto("/accounts");
	await unlock(page, t, false);
	const downloading = page.waitForEvent("download");
	await page.getByRole("button", { name: t("pwVaultExport"), exact: true }).click();
	const download = await downloading;
	const file = info.outputPath(`${name}.kdbx`);
	await download.saveAs(file);
	try {
		const entries = (await inspectVisualKdbx(file)).sort((left, right) => left.draft.title.localeCompare(right.draft.title));
		expect(entries).toHaveLength(2);
		expect(entries.every((entry) => entry.draft.id && entry.draft.linkedAssetIds.length === 1)).toBe(true);
		expect(new Set(entries.map((entry) => entry.draft.id)).size).toBe(2);
		expect(entries.find((entry) => entry.draft.title === titles[0])?.history.length).toBeGreaterThan(0);
		return { digest: sha(JSON.stringify(entries)), entries: entries.map((entry) => ({ id: entry.draft.id, linkedAssetIds: entry.draft.linkedAssetIds, passwordSha256: sha(entry.draft.password), historyCount: entry.history.length, historySha256: sha(JSON.stringify(entry.history)) })) };
	} finally { await download.delete(); }
}
async function exportedBackup(page: Page, language: Language, info: TestInfo, name: string) {
	await page.goto("/intake");
	await openBackupPage(page); await page.locator("#backup-password").fill(backupPassword);
	await page.getByRole("button", { name: copy(language).createBackup, exact: true }).click();
	const downloading = page.waitForEvent("download");
	await page.getByRole("link", { name: copy(language).saveBackup, exact: true }).click();
	const download = await downloading;
	const file = info.outputPath(`${name}.ka1`);
	await download.saveAs(file);
	try {
		const archive = unzipSync(await decryptBackup(new Uint8Array(readFileSync(file)), backupPassword));
		const rows = JSON.parse(strFromU8(archive["records.json"])) as { type: string; id?: string; payload: string }[];
		const assets = rows.filter((row) => row.type === "asset").map((row) => JSON.parse(row.payload) as { id: string; deleted?: boolean });
		const relations = rows.filter((row) => row.type === "relation").map((row) => JSON.parse(row.payload) as { id: string; from: string; to: string; deleted?: boolean });
		expect(assets.filter((row) => !row.deleted)).toHaveLength(2);
		expect(relations.filter((row) => !row.deleted)).toHaveLength(1);
		const assetIds = assets.map((row) => row.id).sort();
		expect(relations.every((row) => assetIds.includes(row.from) && assetIds.includes(row.to))).toBe(true);
		expect(archive["password-vault.kdbx"]).toBeDefined();
		return { recordsSha256: sha(archive["records.json"]), recordCount: rows.length, assetIds, relationIds: relations.map((row) => row.id).sort(), encryptedKdbxSha256: sha(archive["password-vault.kdbx"]), intakeReviewSha256: sha(archive["intake-review.json"]) };
	} finally { await download.delete(); }
}

for (const language of languages) for (const width of widths) {
	test(`${language} ${width} FC17 two manual recoveries preserve saved identities and history`, async ({ browser, request, baseURL }, info) => {
		const folder = join(evidence, `${language}-${width}-recovery`);
		mkdirSync(folder, { recursive: true });
		const steps: Journal = [];
		const identity = await servedIdentity(request);
		steps.push({ stage: "identity", ...identity, serviceWorkers: "block", preparation: "Synthetic data created by normal UI; only language and deliberate HTTP abort are fixture controls" });
		const { page, context, t } = await harness(browser, language, width, baseURL as string);
		let status = "failed";
		try {
			await seedSavedData(page, t);
			const baselineKdbx = await exportedKdbx(page, t, info, "before");
			const baselineBackup = await exportedBackup(page, language, info, "before");
			steps.push({ stage: "saved-baseline", kdbx: baselineKdbx, backup: baselineBackup });
			const target = modulePath(packageIdentity().release, "PasswordVaultPanel");
			let remainingFailures = 2;
			const failed: { url: string; error: string | undefined }[] = [];
			let documents = 0;
			page.on("request", (req) => { if (req.isNavigationRequest() && req.frame() === page.mainFrame()) documents++; });
			page.on("requestfailed", (req) => {
				if (new URL(req.url()).pathname !== target) return;
				const event = { url: req.url(), error: req.failure()?.errorText };
				failed.push(event);
				steps.push({ stage: "http-requestfailed", ...event });
			});
			await page.route(`**${target}`, async (route) => {
				if (remainingFailures > 0) { remainingFailures--; await route.abort("failed"); }
				else await route.continue();
			});
			await page.goto("/accounts");
			for (let round = 1; round <= 2; round++) {
				const { button } = await errorControls(page, language, width, steps);
				await expect.poll(() => failed.length).toBe(round);
				await visibleStates(page, folder, `failure-${round}`, button, steps);
				const observedDocuments = documents;
				await page.waitForTimeout(500); // Explicit no-automatic-reload observation window.
				expect(documents).toBe(observedDocuments);
				expect(failed).toHaveLength(round);
				steps.push({ stage: "failure-observed", round, failed: [...failed], documents, noAutomaticReloadObservedMs: 500 });
				// First actual recovery uses the visible button; second uses keyboard Enter.
				if (round === 1) await Promise.all([page.waitForNavigation({ waitUntil: "load" }), button.click()]);
				else {
					await expect(button).toBeFocused();
					await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.keyboard.press("Enter")]);
				}
				steps.push({ stage: "manual-reload", round, trigger: round === 1 ? "button-click" : "keyboard-enter" });
			}
			await expect(page.getByTestId("route-load-error")).toHaveCount(0);
			expect(documents, "Initial failure plus exactly two user-initiated full reloads").toBe(3);
			await unlock(page, t, true);
			await expect(page.locator(".asset-account-card")).toHaveCount(2);
			await capture(page, folder, "recovered-unlocked", steps);
			expect(failed).toHaveLength(2);
			expect(remainingFailures).toBe(0);
			const afterKdbx = await exportedKdbx(page, t, info, "after");
			const afterBackup = await exportedBackup(page, language, info, "after");
			expect(afterKdbx).toEqual(baselineKdbx);
			expect(afterBackup).toEqual(baselineBackup);
			steps.push({ stage: "saved-data-preserved", kdbx: afterKdbx, backup: afterBackup, manualRecoveryCount: 2, requestFailureCount: failed.length });
			status = "passed";
		} finally {
			writeFileSync(join(folder, "result.json"), JSON.stringify({ language, width, status, identity, steps, visualVerdict: "not-reviewed" }, null, 2));
			await context.close();
		}
	});
}

// Every real router template is represented. Parameter variants expand the
// shared list/detail templates, not invented routes. Empty fixture IDs below
// are deliberate: the real route component's own module is aborted before any
// domain record read; this group asserts error presentation, not valid-record
// business recovery. The populated account group above verifies preservation.
const routeCases = [
	{ template: "/", path: "/", module: "page-overview" },
	{ template: "/tasks", path: "/tasks", module: "page-tasks" },
	...["project", "account", "subscription", "item", "vault"].map((kind) => ({ template: "/assets/$kind", path: `/assets/${kind}`, module: "page-workspaces" })),
	{ template: "/assets", path: "/assets", module: "page-workspaces" },
	{ template: "/accounts", path: "/accounts", module: "page-workspaces" },
	...["project", "account", "subscription", "item", "vault"].map((kind) => ({ template: "/assets/$kind/$id", path: `/assets/${kind}/synthetic-fc17-missing`, module: "page-asset-detail" })),
	{ template: "/assets/project/$id/workflow/$flow", path: "/assets/project/synthetic-fc17-missing/workflow/overview", module: "page-project-workflow" },
	{ template: "/change-impact", path: "/change-impact", module: "page-change-impact" },
	{ template: "/assistant-access", path: "/assistant-access", module: "page-assistant-access" },
	{ template: "/collections", path: "/collections", module: "page-collections" },
	{ template: "/collections/$id", path: "/collections/synthetic-fc17-missing", module: "page-collections" },
	{ template: "/finance", path: "/finance", module: "page-workspaces" },
	{ template: "/intake", path: "/intake", module: "page-intake" },
	{ template: "/trash", path: "/trash", module: "page-trash" },
	{ template: "/settings", path: "/settings", module: "page-settings" },
];
for (const language of languages) for (const width of widths) {
	test(`${language} ${width} FC17 every shared router error consumer`, async ({ browser, request, baseURL }) => {
		const folder = join(evidence, `${language}-${width}-routes`);
		mkdirSync(folder, { recursive: true });
		const candidate = packageIdentity();
		expect([...new Set(routeCases.map((row) => row.template))].sort()).toEqual([...candidate.release.applicationRoutes.paths].sort());
		const identity = await servedIdentity(request);
		const results: unknown[] = [];
		let status = "failed";
		try {
			for (const [index, row] of routeCases.entries()) {
				const { page, context } = await harness(browser, language, width, baseURL as string);
				const steps: Journal = [{ stage: "identity", ...identity, serviceWorkers: "block", template: row.template, path: row.path, module: row.module }];
				let routeStatus = "failed";
				try {
					const target = modulePath(candidate.release, row.module);
					const failures: unknown[] = [];
					let aborted = 0;
					page.on("requestfailed", (req) => {
						if (new URL(req.url()).pathname !== target) return;
						const event = { url: req.url(), error: req.failure()?.errorText };
						failures.push(event);
						steps.push({ stage: "http-requestfailed", ...event });
					});
					await page.route(`**${target}`, async (route) => { aborted++; await route.abort("failed"); });
					await page.goto(row.path);
					const { button } = await errorControls(page, language, width, steps);
					await expect.poll(() => failures.length).toBeGreaterThan(0);
					expect(aborted).toBeGreaterThan(0);
					await visibleStates(page, folder, `${index}-${basename(row.path) || "home"}`, button, steps);
					steps.push({ stage: "actual-http-module-failure", target, aborted, failures });
					// Leave the real error through AppShell UI, using a different module.
					// React.lazy caches a rejection within this document; selecting the
					// same failed module would not prove navigation to a healthy page.
					const destination = row.module === "page-workspaces" ? "/tasks" : "/accounts";
					if (width < 768) await page.locator(".mobile-menu").click();
					const navigation = page.locator(`.sidebar .nav a[href="${destination}"]`);
					await expect(navigation).toBeVisible();
					await navigation.click();
					await expect.poll(() => new URL(page.url()).pathname).toBe(destination);
					await expect(page.getByTestId("route-load-error")).toHaveCount(0);
					await expect(page.getByRole("heading", {
						level: 1,
						name: destination === "/tasks" ? (language === "zh-CN" ? "待办" : "Tasks") : (language === "zh-CN" ? "账号" : "Accounts"),
						exact: true,
					})).toBeVisible();
					// The pathname can settle while the mobile sidebar is still animating.
					// Observe its actual closed geometry before a stable navigation frame.
					if (width < 768) await expect.poll(() => page.locator(".sidebar").evaluate(node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
					const mobileSidebarRight = width < 768 ? await page.locator(".sidebar").evaluate(node => node.getBoundingClientRect().right) : null;
					if (mobileSidebarRight !== null) { expect(Number.isFinite(mobileSidebarRight)).toBe(true); expect(mobileSidebarRight).toBeLessThanOrEqual(1); }
					steps.push({ stage: "error-navigation", via: "actual-sidebar-link", destination, mobileMenuOpened: width < 768, mobileSidebarRight, mobileSidebarClosed: width < 768 ? true : "not-applicable-desktop", failedModule: target });
					await capture(page, folder, `${index}-normal-navigation`, steps);
					routeStatus = "passed";
				} finally {
					results.push({ template: row.template, path: row.path, status: routeStatus, steps });
					await context.close();
				}
			}
			status = "passed";
		} finally { writeFileSync(join(folder, "result.json"), JSON.stringify({ language, width, status, identity, routeManifest: routeCases, routes: results, visualVerdict: "not-reviewed" }, null, 2)); }
	});
}
