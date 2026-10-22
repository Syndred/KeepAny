import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	inspectVisualKdbx,
	recognitionFixture,
	visualHarness,
	visualMaster,
	visualVaultContentFingerprint,
} from "./fixtures/password-smart-import-visual";
import { labels, model } from "./helpers/ai-workflow";
import { selectChoice } from "./helpers/select-choice";

// Exercise the user-facing controls against an actual encrypted vault in an isolated origin.
// No user vault or model endpoint is used by this suite.
test.setTimeout(150_000);
const editor = (importer: Locator) => importer.locator(".pw-work-editor");
const field = (scope: Locator, name: string) =>
	scope.locator(`[id$='-${name}']`).first();
const rows = (importer: Locator) => importer.locator(".pw-work-list-row");
const pending = (importer: Locator) =>
	importer.getByRole("tab", { name: /^(待处理|Pending)/ });
const reviewed = (importer: Locator) =>
	importer.getByRole("tab", { name: /^(已核对|Reviewed)/ });
const finish = (importer: Locator) =>
	editor(importer).getByRole("button", {
		name: /^(核对完成，下一条|Reviewed, next entry)$/,
		exact: true,
	});

type DeferredClipboardWindow = Window & {
	__syntheticClipboardReads?: number;
	__resolveSyntheticClipboard?: (value: string) => void;
};

async function noHorizontalOverflow(importer: Locator) {
	const layout = await importer.evaluate((node) => {
		const dialog = node.closest(".password-smart-import-dialog");
		const workspace = node.querySelector(".pw-import-workspace");
		if (!dialog || !workspace)
			throw new Error("Expected import dialog and workspace");
		return {
			dialog: dialog.scrollWidth - dialog.clientWidth,
			workspace: workspace.scrollWidth - workspace.clientWidth,
			page: document.documentElement.scrollWidth - innerWidth,
		};
	});
	// The footer intentionally extends 12px into the dialog padding; measure its scroll surface.
	for (const excess of Object.values(layout))
		expect(excess, JSON.stringify(layout)).toBeLessThanOrEqual(1);
}

async function unlock(h: Awaited<ReturnType<typeof visualHarness>>) {
	await h.page.locator("#password-vault-unlock-master").fill(visualMaster);
	await h.page
		.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true })
		.click();
	await expect(h.page.locator(".password-vault-toolbar")).toBeVisible();
}

async function deleteDialog(page: Page, importer: Locator) {
	await editor(importer)
		.getByRole("button", { name: /^(删除这条|Delete entry)$/, exact: true })
		.click();
	const dialog = page.getByRole("dialog", {
		name: /^(删除这条记录？|Delete this entry\?)$/,
		exact: true,
	});
	await expect(dialog).toBeVisible();
	return dialog;
}

async function confirmDelete(page: Page, importer: Locator) {
	const dialog = await deleteDialog(page, importer);
	await dialog
		.getByRole("button", { name: /^(确认删除|Delete entry)$/, exact: true })
		.click();
	await expect(dialog).toBeHidden();
}

async function saveAll(
	h: Awaited<ReturnType<typeof visualHarness>>,
	importer: Locator,
) {
	await importer
		.getByRole("button", {
			name: /^(导入已核对的 \d+ 条|Import \d+ reviewed)$/,
			exact: true,
		})
		.click();
	await h.page
		.getByRole("dialog")
		.last()
		.getByRole("button", { name: /^(确认导入|Confirm import)$/, exact: true })
		.click();
	await expect(importer.locator(".pw-smart-receipt")).toBeVisible();
	await h.page
		.locator(".password-smart-import-dialog > header")
		.getByRole("button", { name: h.t("pwVaultClose"), exact: true })
		.click();
	const keepDraft = h.page.getByRole("button", {
		name: h.t("pwSmartCloseKeepDraft"),
		exact: true,
	});
	if (await keepDraft.isVisible()) await keepDraft.click();
	await expect(importer).toHaveCount(0);
}

async function exportEntries(h: Awaited<ReturnType<typeof visualHarness>>) {
	const download = h.page.waitForEvent("download");
	await h.page
		.getByRole("button", { name: h.t("pwVaultExport"), exact: true })
		.click();
	const path = test.info().outputPath("synthetic-review-controls.kdbx");
	await (await download).saveAs(path);
	return inspectVisualKdbx(path);
}

for (const { locale, width } of [
	{ locale: "zh-CN", width: 1280 },
	{ locale: "en", width: 390 },
] as const) {
	test(`${locale} ${width}px delete, add and newest-reviewed order survive encrypted draft recovery`, async ({
		browser,
	}, info) => {
		const h = await visualHarness(browser, locale, { width, height: 900 });
		try {
			await h.configure();
			await h.createVault();
			await h.seedExisting({
				title: "Synthetic existing vault account",
				username: "existing@example.test",
				password: "Synthetic-existing!42",
			});
			const before = await visualVaultContentFingerprint(h.page);
			let importer = await h.open();
			const fixture = recognitionFixture([
				{
					title: "Synthetic Alpha",
					username: "alpha@example.test",
					password: "Synthetic-alpha!42",
				},
				{
					title: "Synthetic Remove",
					username: "remove@example.test",
					password: "Synthetic-remove!42",
				},
				{
					title: "Synthetic Charlie",
					username: "charlie@example.test",
					password: "Synthetic-charlie!42",
				},
			]);
			const source = `${fixture.source}\nUnassigned synthetic fragment to remove`;
			const response = JSON.parse(fixture.response);
			response.ignoredLines.push(source.split("\n").length);
			h.mock.responses.push(JSON.stringify(response));
			await importer.locator("#pw-smart-source").fill(source);
			await importer
				.getByRole("button", {
					name: /^(用 AI 识别|Recognize with AI)$/,
				})
				.click();
			await h.page
				.getByRole("button", {
					name: /^(确认识别|Confirm recognition)$/,
					exact: true,
				})
				.click();
			await expect(rows(importer)).toHaveCount(4);
			await rows(importer).filter({ hasText: "alpha@example.test" }).click();
			await field(editor(importer), "notes").fill(
				"Synthetic Alpha edit must survive other deletions",
			);
			await rows(importer).filter({ hasText: "remove@example.test" }).click();
			const cancelled = await deleteDialog(h.page, importer);
			await cancelled
				.getByRole("button", { name: /^(取消|Cancel)$/, exact: true })
				.click();
			await expect(rows(importer)).toHaveCount(4);
			await expect(field(editor(importer), "username")).toHaveValue(
				"remove@example.test",
			);
			await confirmDelete(h.page, importer);
			await expect(
				rows(importer).filter({ hasText: "remove@example.test" }),
			).toHaveCount(0);
			await expect(rows(importer)).toHaveCount(3);
			await importer.locator(".pw-work-list-row[data-source-group]").click();
			await confirmDelete(h.page, importer);
			await expect(
				importer.locator(".pw-work-list-row[data-source-group]"),
			).toHaveCount(0);
			await expect(rows(importer)).toHaveCount(2);

			await importer
				.getByRole("button", { name: /^(新增账号|Add account)$/, exact: true })
				.click();
			await expect(field(editor(importer), "title")).toHaveValue("");
			await expect(field(editor(importer), "title")).toBeFocused();
			await field(editor(importer), "title").fill("Synthetic Manual");
			await field(editor(importer), "username").fill("manual@example.test");
			await field(editor(importer), "password").fill("  Synthetic-manual!42  ");
			await field(editor(importer), "notes").fill(
				"Synthetic manual note preserved after refresh",
			);

			// Deliberately review out of source order: a simple reverse array is insufficient.
			for (const username of [
				"charlie@example.test",
				"alpha@example.test",
				"manual@example.test",
			]) {
				await rows(importer).filter({ hasText: username }).click();
				await finish(importer).click();
			}
			await reviewed(importer).click();
			await expect(
				rows(importer).locator(".pw-work-row-identity > strong"),
			).toHaveText([
				"Synthetic Manual",
				"Synthetic Alpha",
				"Synthetic Charlie",
			]);
			await expect(h.page.locator(".pw-smart-draft-status")).toHaveText(
				h.t("pwSmartDraftSaved"),
			);
			expect(await visualVaultContentFingerprint(h.page)).toEqual(before);
			expect(h.mock.requests).toHaveLength(1);
			await expect(h.page.locator(".toast")).toBeHidden({ timeout: 10_000 });
			await h.page.screenshot({
				path: info.outputPath(`reviewed-${locale}-${width}.png`),
			});

			await h.page.reload();
			await unlock(h);
			importer = await h.open();
			await expect(
				rows(importer).locator(".pw-work-row-identity > strong"),
			).toHaveText([
				"Synthetic Manual",
				"Synthetic Alpha",
				"Synthetic Charlie",
			]);
			await rows(importer).filter({ hasText: "manual@example.test" }).click();
			await expect(field(editor(importer), "notes")).toHaveValue(
				"Synthetic manual note preserved after refresh",
			);
			await expect(field(editor(importer), "password")).toHaveValue(
				"  Synthetic-manual!42  ",
			);
			await rows(importer).filter({ hasText: "alpha@example.test" }).click();
			await expect(field(editor(importer), "notes")).toHaveValue(
				"Synthetic Alpha edit must survive other deletions",
			);
			await pending(importer).click();
			await expect(rows(importer)).toHaveCount(0);
			await expect(
				importer.getByRole("button", {
					name: /^(新增账号|Add account)$/,
					exact: true,
				}),
			).toBeVisible();
			expect(await visualVaultContentFingerprint(h.page)).toEqual(before);
			expect(h.mock.requests).toHaveLength(1);
			await reviewed(importer).click();
			await expect(
				rows(importer).filter({ hasText: "remove@example.test" }),
			).toHaveCount(0);
			await expect(importer.locator(".pw-import-workspace")).toBeVisible();
			await noHorizontalOverflow(importer);
			await saveAll(h, importer);
			const entries = await exportEntries(h);
			expect(entries.map(({ draft }) => draft.username).sort()).toEqual([
				"alpha@example.test",
				"charlie@example.test",
				"existing@example.test",
				"manual@example.test",
			]);
			expect(
				entries.find(({ draft }) => draft.username === "manual@example.test")
					?.draft.password,
			).toBe("  Synthetic-manual!42  ");
			expect(
				entries.find(({ draft }) => draft.username === "existing@example.test")
					?.draft.password,
			).toBe("Synthetic-existing!42");
			expect(h.errors).toEqual([]);
		} finally {
			await h.close();
		}
	});
}

test("delayed alias paste keeps sibling changes and ignores edited or locked fields", async ({
	browser,
}) => {
	const h = await visualHarness(browser, "en", { width: 1280, height: 900 });
	try {
		await h.page.goto("/assets/vault");
		await h.createVault();
		let importer = await h.open();
		await importer
			.locator("#pw-smart-source")
			.fill(
				"Title=Synthetic delayed clipboard\nUsername=primary-delayed@example.test\nPassword=Synthetic-delayed!42",
			);
		await importer
			.getByRole("button", { name: h.t("pwSmartRecognize"), exact: true })
			.click();
		for (const alias of [
			"a@example.test",
			"b@example.test",
			"c@example.test",
		]) {
			await editor(importer)
				.getByRole("button", { name: h.t("pwVaultAddIdentifier"), exact: true })
				.click();
			await editor(importer)
				.locator(".pw-smart-identifier-row input")
				.last()
				.fill(alias);
		}
		await h.page.evaluate(() => {
			const synthetic = window as DeferredClipboardWindow;
			synthetic.__syntheticClipboardReads = 0;
			Object.defineProperty(navigator.clipboard, "readText", {
				configurable: true,
				value: () =>
					new Promise<string>((resolveRead) => {
						synthetic.__syntheticClipboardReads =
							(synthetic.__syntheticClipboardReads ?? 0) + 1;
						synthetic.__resolveSyntheticClipboard = resolveRead;
					}),
			});
		});
		async function beginPaste(row: Locator, reads: number) {
			await row.getByRole("button", { name: /^Paste / }).click();
			await expect
				.poll(() =>
					h.page.evaluate(
						() => (window as DeferredClipboardWindow).__syntheticClipboardReads,
					),
				)
				.toBe(reads);
		}
		async function resolvePaste(value: string) {
			await h.page.evaluate(async (text) => {
				const synthetic = window as DeferredClipboardWindow;
				if (!synthetic.__resolveSyntheticClipboard)
					throw new Error("No pending synthetic clipboard read");
				synthetic.__resolveSyntheticClipboard(text);
				delete synthetic.__resolveSyntheticClipboard;
				await new Promise<void>((done) => window.setTimeout(done, 0));
			}, value);
		}
		const aliasRows = () =>
			editor(importer).locator(".pw-smart-identifier-row");
		await beginPaste(aliasRows().nth(1), 1);
		await aliasRows()
			.nth(0)
			.getByRole("button", {
				name: h.t("pwVaultRemoveIdentifier", { count: 1 }),
				exact: true,
			})
			.click();
		await aliasRows().nth(1).locator("input").fill("c-latest@example.test");
		await resolvePaste("b-from-clipboard@example.test");
		await expect(aliasRows()).toHaveCount(2);
		await expect(aliasRows().nth(0).locator("input")).toHaveValue(
			"b-from-clipboard@example.test",
		);
		await expect(aliasRows().nth(1).locator("input")).toHaveValue(
			"c-latest@example.test",
		);

		await beginPaste(aliasRows().nth(0), 2);
		await aliasRows()
			.nth(0)
			.locator("input")
			.fill("b-manual-latest@example.test");
		await resolvePaste("stale-after-edit@example.test");
		await expect(aliasRows().nth(0).locator("input")).toHaveValue(
			"b-manual-latest@example.test",
		);

		await beginPaste(aliasRows().nth(0), 3);
		await h.page
			.locator(".password-smart-import-dialog > header")
			.getByRole("button", { name: "Close", exact: true })
			.click();
		await h.page
			.getByRole("button", { name: h.t("pwSmartCloseKeepDraft"), exact: true })
			.click();
		await expect(importer).toHaveCount(0);
		await h.page
			.getByRole("button", { name: h.t("pwVaultLock"), exact: true })
			.click();
		await expect(h.page.locator("#password-vault-unlock-master")).toBeVisible();
		await resolvePaste("stale-after-lock@example.test");
		await unlock(h);
		importer = await h.open();
		await expect(aliasRows()).toHaveCount(2);
		await expect(aliasRows().nth(0).locator("input")).toHaveValue(
			"b-manual-latest@example.test",
		);
		await expect(aliasRows().nth(1).locator("input")).toHaveValue(
			"c-latest@example.test",
		);
		await finish(importer).click();
		await saveAll(h, importer);
		const entries = await exportEntries(h);
		expect(entries).toHaveLength(1);
		expect(entries[0].draft.usernameAliases).toEqual([
			"b-manual-latest@example.test",
			"c-latest@example.test",
		]);
		expect(h.mock.requests).toHaveLength(0);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

test("a7be614 encrypted review and unfinished fragment survive a same-origin fixed-package upgrade", async ({
	browser,
}, info) => {
	test.setTimeout(180_000);
	const root = process.cwd();
	const directory = mkdtempSync(join(tmpdir(), "stackperch-review-upgrade-"));
	const archive = join(directory, "old-package.tar");
	execFileSync(
		"git",
		["archive", "--output", archive, "a7be614", "release/web"],
		{
			cwd: root,
		},
	);
	execFileSync("tar", [
		"-xf",
		archive,
		"-C",
		directory,
		"--strip-components=2",
	]);
	const moduleEntry = (folder: string) => {
		const match = readFileSync(join(folder, "index.html"), "utf8").match(
			/<script[^>]*type="module"[^>]*src="([^"]+)"/,
		);
		if (!match) throw new Error("Fixed package has no module entry");
		return match[1];
	};
	const oldEntry = moduleEntry(directory);
	const newPackage = join(root, "release/web");
	const newEntry = moduleEntry(newPackage);
	expect(newEntry).not.toBe(oldEntry);
	const contentTypes: Record<string, string> = {
		".html": "text/html",
		".js": "text/javascript",
		".css": "text/css",
		".json": "application/json",
		".webmanifest": "application/manifest+json",
		".svg": "image/svg+xml",
		".png": "image/png",
		".wasm": "application/wasm",
	};
	const server = createServer((request, response) => {
		const pathname = decodeURIComponent(
			new URL(request.url ?? "/", "http://localhost").pathname,
		);
		const candidate = resolve(directory, `.${pathname}`);
		const file =
			candidate.startsWith(`${directory}/`) &&
			existsSync(candidate) &&
			statSync(candidate).isFile()
				? candidate
				: join(directory, "index.html");
		response.setHeader(
			"Content-Type",
			contentTypes[extname(file)] ?? "application/octet-stream",
		);
		response.setHeader("Cache-Control", "no-cache");
		response.end(readFileSync(file));
	});
	await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const h = await visualHarness(browser, "en", { width: 1280, height: 900 });
	try {
		await h.page.goto(`${origin}/settings#assistant`);
		const settings = h.page.locator(".ai-settings-panel");
		await selectChoice(settings.locator("#ai-settings-provider"), "compatible");
		await settings.locator("#ai-settings-url").fill(h.mock.baseURL);
		await settings.locator("#ai-settings-model").fill(model);
		await selectChoice(settings.locator("#ai-settings-key-source"), "none");
		await settings
			.getByRole("button", { name: labels.en.saveSettings, exact: true })
			.click();
		await expect(
			settings.getByRole("status").filter({ hasText: labels.en.ready }),
		).toBeVisible();
		await h.page.evaluate(async () => {
			await navigator.serviceWorker.ready;
		});
		await h.page.goto(`${origin}/assets/vault`);
		await expect
			.poll(() =>
				h.page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
			)
			.toBe(true);
		await expect(
			h.page.locator('script[type="module"]').first(),
		).toHaveAttribute("src", oldEntry);
		await h.createVault();
		await h.seedExisting({
			title: "Synthetic existing before upgrade",
			username: "existing-upgrade@example.test",
			password: "Synthetic-existing-upgrade!42",
		});
		const before = await visualVaultContentFingerprint(h.page);
		let importer = await h.open();
		const fixture = recognitionFixture([
			{
				title: "Synthetic legacy reviewed",
				username: "legacy-reviewed@example.test",
				password: "  Synthetic-legacy-reviewed!42  ",
			},
		]);
		const source = `${fixture.source}\nSynthetic unfinished legacy fragment`;
		h.mock.responses.push(fixture.response);
		await importer.locator("#pw-smart-source").fill(source);
		await importer
			.getByRole("button", { name: "Recognize with AI", exact: true })
			.click();
		await h.page
			.getByRole("button", { name: "Confirm recognition", exact: true })
			.click();
		await expect(rows(importer)).toHaveCount(2);
		await rows(importer)
			.filter({ hasText: "legacy-reviewed@example.test" })
			.click();
		await field(editor(importer), "notes").fill(
			"Synthetic reviewed note saved by a7be614",
		);
		await finish(importer).click();
		await importer.locator(".pw-work-list-row[data-source-group]").click();
		let form = importer.locator(
			".pw-work-fragment:not([hidden]) .pw-smart-fragment-form",
		);
		await form
			.getByRole("button", {
				name: h.t("pwSmartFragmentChangeTarget"),
				exact: true,
			})
			.click();
		await selectChoice(form.locator("[id$='-target']"), "new");
		await field(form, "title").fill("Synthetic legacy unfinished entry");
		await field(form, "username").fill("legacy-fragment@example.test");
		await field(form, "password").fill("  Synthetic-legacy-fragment!42  ");
		await field(form, "notes").fill("Synthetic unsubmitted fragment notes");
		await expect(h.page.locator(".pw-smart-draft-status")).toHaveText(
			h.t("pwSmartDraftSaved"),
		);
		expect(await visualVaultContentFingerprint(h.page)).toEqual(before);
		await h.page
			.locator(".password-smart-import-dialog > header")
			.getByRole("button", { name: "Close", exact: true })
			.click();
		await h.page
			.getByRole("button", { name: h.t("pwSmartCloseKeepDraft"), exact: true })
			.click();
		await expect(importer).toHaveCount(0);

		// Preserve old hashed chunks while the real old tab installs the new package.
		cpSync(newPackage, directory, { recursive: true, force: true });
		await h.page.evaluate(async () => {
			await (await navigator.serviceWorker.ready).update();
		});
		await expect(
			h.page.getByRole("button", { name: "Update app", exact: true }),
		).toBeVisible();
		await h.page
			.getByRole("button", { name: "Update app", exact: true })
			.click();
		await expect(
			h.page.locator('script[type="module"]').first(),
		).toHaveAttribute("src", newEntry);
		await unlock(h);
		importer = await h.open();
		await expect(
			importer.getByRole("button", { name: "Add account", exact: true }),
		).toBeVisible();
		form = importer.locator(
			".pw-work-fragment:not([hidden]) .pw-smart-fragment-form",
		);
		await expect(field(form, "title")).toHaveValue(
			"Synthetic legacy unfinished entry",
		);
		await expect(field(form, "username")).toHaveValue(
			"legacy-fragment@example.test",
		);
		await expect(field(form, "password")).toHaveValue(
			"  Synthetic-legacy-fragment!42  ",
		);
		await expect(field(form, "notes")).toHaveValue(
			"Synthetic unsubmitted fragment notes",
		);
		await reviewed(importer).click();
		await expect(rows(importer)).toHaveCount(1);
		await rows(importer).first().click();
		await expect(field(editor(importer), "notes")).toHaveValue(
			"Synthetic reviewed note saved by a7be614",
		);
		await pending(importer).click();
		await importer.locator(".pw-work-list-row[data-source-group]").click();
		expect(await visualVaultContentFingerprint(h.page)).toEqual(before);
		expect(h.mock.requests).toHaveLength(1);
		await expect(h.page.locator(".toast")).toBeHidden({ timeout: 10_000 });
		await h.page.screenshot({
			path: info.outputPath("legacy-draft-restored-en-1280.png"),
		});
		await form
			.getByRole("button", { name: h.t("pwSmartFragmentApply"), exact: true })
			.click();
		await saveAll(h, importer);
		const entries = await exportEntries(h);
		expect(entries).toHaveLength(3);
		expect(entries.map(({ draft }) => draft)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					username: "existing-upgrade@example.test",
					password: "Synthetic-existing-upgrade!42",
				}),
				expect.objectContaining({
					username: "legacy-reviewed@example.test",
					password: "  Synthetic-legacy-reviewed!42  ",
					notes: "Synthetic reviewed note saved by a7be614",
				}),
				expect.objectContaining({
					username: "legacy-fragment@example.test",
					password: "  Synthetic-legacy-fragment!42  ",
					notes: "Synthetic unsubmitted fragment notes",
				}),
			]),
		);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
		server.closeAllConnections();
		await new Promise<void>((closed) => server.close(() => closed()));
		rmSync(directory, { recursive: true, force: true });
	}
});

test("removing a target preserves candidate and fragment additions separately from their new-entry drafts", async ({
	browser,
}) => {
	const h = await visualHarness(browser, "en", { width: 1280, height: 900 });
	async function target(importer: Locator, name: string | RegExp) {
		await editor(importer)
			.getByRole("button", { name: "Change entry", exact: true })
			.click();
		const dialog = h.page.getByRole("dialog", {
			name: "Choose an entry to complete",
		});
		await dialog
			.locator(".pw-work-target-list")
			.getByRole("button", { name, exact: typeof name === "string" })
			.click();
		await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
	}
	try {
		await h.configure();
		await h.createVault();
		let importer = await h.open();
		const fixture = recognitionFixture([
			{
				title: "Synthetic target A",
				username: "target-a@example.test",
				password: "Synthetic-target!42",
			},
			{
				title: "Synthetic source B",
				username: "source-b@example.test",
				password: "Synthetic-source!42",
			},
		]);
		h.mock.responses.push(fixture.response);
		await importer
			.locator("#pw-smart-source")
			.fill(`${fixture.source}\nSynthetic fragment F`);
		await importer
			.getByRole("button", { name: "Recognize with AI", exact: true })
			.click();
		await h.page
			.getByRole("button", { name: "Confirm recognition", exact: true })
			.click();
		await expect(rows(importer)).toHaveCount(3);
		await rows(importer).filter({ hasText: "source-b@example.test" }).click();
		await target(importer, "Create a separate entry");
		await field(editor(importer), "title").fill("Synthetic B separate draft");
		await field(editor(importer), "notes").fill(
			"Synthetic B new draft must stay separate",
		);
		await target(importer, "Synthetic target A · target-a@example.test");
		await field(editor(importer), "title").fill("Synthetic B recovered draft");
		await field(editor(importer), "username").fill("b-recovered@example.test");
		await field(editor(importer), "notes").fill(
			"Synthetic B unapplied additions",
		);
		await importer.locator(".pw-work-list-row[data-source-group]").click();
		let form = importer.locator(
			".pw-work-fragment:not([hidden]) .pw-smart-fragment-form",
		);
		await form
			.getByRole("button", {
				name: h.t("pwSmartFragmentChangeTarget"),
				exact: true,
			})
			.click();
		await selectChoice(form.locator("[id$='-target']"), "new");
		await field(form, "title").fill("Synthetic F separate draft");
		await field(form, "notes").fill("Synthetic F new draft must stay separate");
		await selectChoice(form.locator("[id$='-target']"), {
			label: `${h.t("pwSmartRow", { count: 1 })} · Synthetic target A · target-a@example.test`,
		});
		await field(form, "title").fill("Synthetic F recovered draft");
		await field(form, "username").fill("f-recovered@example.test");
		await field(form, "notes").fill("Synthetic F unapplied additions");
		await rows(importer).filter({ hasText: "target-a@example.test" }).click();
		await confirmDelete(h.page, importer);
		await expect(h.page.locator(".pw-smart-draft-status")).toHaveText(
			h.t("pwSmartDraftSaved"),
		);
		await h.page.reload();
		await unlock(h);
		importer = await h.open();
		await rows(importer).filter({ hasText: "source-b@example.test" }).click();
		await target(importer, "Create a separate entry");
		await expect(field(editor(importer), "title")).toHaveValue(
			"Synthetic B separate draft",
		);
		await expect(field(editor(importer), "notes")).toHaveValue(
			"Synthetic B new draft must stay separate",
		);
		await target(
			importer,
			/Edits for removed entry · Synthetic B recovered draft/,
		);
		await expect(field(editor(importer), "username")).toHaveValue(
			"b-recovered@example.test",
		);
		await expect(field(editor(importer), "notes")).toHaveValue(
			"Synthetic B unapplied additions",
		);
		await editor(importer)
			.getByRole("button", { name: "Review as a new account", exact: true })
			.click();
		await rows(importer).filter({ hasText: "source-b@example.test" }).click();
		await target(importer, "Create a separate entry");
		await expect(field(editor(importer), "notes")).toHaveValue(
			"Synthetic B new draft must stay separate",
		);
		await importer.locator(".pw-work-list-row[data-source-group]").click();
		form = importer.locator(
			".pw-work-fragment:not([hidden]) .pw-smart-fragment-form",
		);
		const picker = form.locator("[id$='-target']");
		if (!(await picker.isVisible()))
			await form
				.getByRole("button", {
					name: h.t("pwSmartFragmentChangeTarget"),
					exact: true,
				})
				.click();
		await selectChoice(picker, "new");
		await expect(field(form, "title")).toHaveValue(
			"Synthetic F separate draft",
		);
		await expect(field(form, "notes")).toHaveValue(
			"Synthetic F new draft must stay separate",
		);
		await selectChoice(picker, {
			label:
				"Edits for removed entry · Synthetic F recovered draft · f-recovered@example.test",
		});
		await expect(field(form, "username")).toHaveValue(
			"f-recovered@example.test",
		);
		await expect(field(form, "notes")).toHaveValue(
			"Synthetic F unapplied additions",
		);
		await form
			.getByRole("button", { name: "Review as a new account", exact: true })
			.click();
		await reviewed(importer).click();
		await expect(rows(importer)).toHaveCount(2);
		await saveAll(h, importer);
		const entries = await exportEntries(h);
		expect(
			entries.map(({ draft }) => [draft.username, draft.notes]).sort(),
		).toEqual([
			["b-recovered@example.test", "Synthetic B unapplied additions"],
			["f-recovered@example.test", "Synthetic F unapplied additions"],
		]);
		expect(h.mock.requests).toHaveLength(1);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

for (const { locale, width } of [
	{ locale: "zh-CN", width: 390 },
	{ locale: "en", width: 1280 },
] as const) {
	test(`${locale} ${width}px field copy preserves hidden multiline passwords and compact identifier cards`, async ({
		browser,
	}, info) => {
		const h = await visualHarness(browser, locale, { width, height: 900 });
		try {
			await h.context.grantPermissions(["clipboard-read", "clipboard-write"]);
			await h.page.goto("/assets/vault");
			await h.createVault();
			const importer = await h.open();
			await importer
				.locator("#pw-smart-source")
				.fill(
					"Title=Synthetic clipboard account\nUsername=primary@example.test\nPassword=Synthetic-before!42\nURL=https://example.test/login\nNotes=Synthetic clipboard note",
				);
			await importer
				.getByRole("button", { name: h.t("pwSmartRecognize"), exact: true })
				.click();
			await expect(rows(importer)).toHaveCount(1);
			const aliases = [
				"synthetic-secondary-long-address@example.test",
				"15500000001",
			];
			for (const alias of aliases) {
				await editor(importer)
					.getByRole("button", {
						name: h.t("pwVaultAddIdentifier"),
						exact: true,
					})
					.click();
				await editor(importer)
					.locator(".pw-smart-identifier-row input")
					.last()
					.fill(alias);
			}
			const password = "  Synthetic first line\r\nsecond line!42  ";
			await h.page.evaluate(
				(value) => navigator.clipboard.writeText(value),
				password,
			);
			await editor(importer)
				.locator(".pw-smart-field-password")
				.getByRole("button", { name: /^(粘贴|Paste )/ })
				.click();
			await expect(field(editor(importer), "password")).toHaveAttribute(
				"readonly",
				"",
			);
			await expect(field(editor(importer), "password")).not.toHaveValue(
				password,
			);
			const checks = [
				{
					selector: ".pw-smart-field-title",
					value: "Synthetic clipboard account",
				},
				{
					selector: ".pw-smart-primary-identifier",
					value: "primary@example.test",
				},
				{ selector: ".pw-smart-field-password", value: password },
				{
					selector: ".pw-smart-field-notes",
					value: "Synthetic clipboard note",
				},
				{
					selector: ".pw-smart-field-url",
					value: "https://example.test/login",
				},
			];
			for (const { selector, value } of checks) {
				await editor(importer)
					.locator(selector)
					.getByRole("button", { name: /^(复制|Copy )/ })
					.click();
				await expect
					.poll(() => h.page.evaluate(() => navigator.clipboard.readText()))
					.toBe(value);
			}
			for (let index = 0; index < aliases.length; index++) {
				await editor(importer)
					.locator(".pw-smart-identifier-row")
					.nth(index)
					.getByRole("button", { name: /^(复制|Copy )/ })
					.click();
				await expect
					.poll(() => h.page.evaluate(() => navigator.clipboard.readText()))
					.toBe(aliases[index]);
			}
			const geometry = await editor(importer)
				.locator(".pw-smart-identifier-row")
				.evaluateAll((elements) =>
					elements.map((element) => {
						const box = element.getBoundingClientRect();
						const input = element.querySelector("input");
						if (!input) throw new Error("Expected identifier input");
						const inputBox = input.getBoundingClientRect();
						return {
							x: box.x,
							width: box.width,
							top: box.top,
							bottom: box.bottom,
							inputX: inputBox.x,
							inputWidth: inputBox.width,
							buttons: [...element.querySelectorAll("button")].map(
								(button) => ({
									height: button.getBoundingClientRect().height,
									width: button.getBoundingClientRect().width,
								}),
							),
						};
					}),
				);
			expect(
				Math.abs(geometry[0].inputX - geometry[1].inputX),
			).toBeLessThanOrEqual(1);
			expect(
				Math.abs(geometry[0].inputWidth - geometry[1].inputWidth),
			).toBeLessThanOrEqual(1);
			expect(geometry[1].top - geometry[0].bottom).toBeGreaterThanOrEqual(8);
			for (const row of geometry)
				for (const button of row.buttons) {
					expect(button.height).toBeGreaterThanOrEqual(44);
					expect(button.width).toBeGreaterThanOrEqual(44);
				}
			await expect(h.page.locator(".toast")).toBeHidden({ timeout: 10_000 });
			await editor(importer)
				.locator(".pw-smart-identifiers")
				.screenshot({
					path: info.outputPath(`identifiers-editor-${locale}-${width}.png`),
				});
			await noHorizontalOverflow(importer);
			await finish(importer).click();
			await saveAll(h, importer);
			const card = h.page.locator(
				".password-vault-entry-list .password-vault-entry",
			);
			await expect(card).toHaveCount(1);
			const identifierRows = card.locator(".password-vault-identifier-row");
			await expect(identifierRows).toHaveCount(2);
			for (let index = 0; index < aliases.length; index++) {
				await identifierRows.nth(index).getByRole("button").click();
				await expect
					.poll(() => h.page.evaluate(() => navigator.clipboard.readText()))
					.toBe(aliases[index]);
			}
			const layout = await card.evaluate((element) => {
				const aliasRows = [
					...element.querySelectorAll(".password-vault-identifier-row"),
				];
				const boxes = aliasRows.map((row) => row.getBoundingClientRect());
				const values = aliasRows.map((row) => {
					const value = row.querySelector(".password-vault-value");
					if (!value) throw Error("Expected identifier value");
					const box = value.getBoundingClientRect();
					const style = getComputedStyle(value);
					const topPadding = Number.parseFloat(style.paddingTop);
					const bottomPadding = Number.parseFloat(style.paddingBottom);
					return { top: box.top + topPadding, bottom: box.bottom - bottomPadding, topPadding, bottomPadding };
				});
				return {
					// The approved divider layout has adjacent row boxes; its whitespace
					// belongs inside each value, rather than an additional grid gap.
					gap: values[1].top - values[0].bottom,
					rowGaps: boxes.slice(1).map((box, index) => box.top - boxes[index].bottom),
					valuePadding: values.flatMap((value) => [value.topPadding, value.bottomPadding]),
					dividers: aliasRows.map((row) => {
						const style = getComputedStyle(row);
						return { width: Number.parseFloat(style.borderTopWidth), style: style.borderTopStyle, color: style.borderTopColor };
					}),
					heights: boxes.map((box) => box.height),
					actionHeights: [
						...element.querySelectorAll(".password-vault-entry-actions button"),
					].map((button) => button.getBoundingClientRect().height),
					fontSizes: aliasRows.map((row) =>
						Number.parseFloat(getComputedStyle(row).fontSize),
					),
					shadow: getComputedStyle(element).boxShadow,
					overflow: document.documentElement.scrollWidth > innerWidth + 1,
				};
			});
			expect(layout.gap).toBeGreaterThanOrEqual(8);
			expect(layout.gap).toBeLessThanOrEqual(24);
			expect(layout.rowGaps.every((gap) => Math.abs(gap) <= 1)).toBe(true);
			expect(layout.valuePadding.every((padding) => padding >= 8)).toBe(true);
			expect(layout.dividers.every((divider) => divider.width >= 1 && divider.style === "solid" && !["transparent", "rgba(0, 0, 0, 0)"].includes(divider.color))).toBe(true);
			expect(
				layout.heights.every((height) => height >= 44 && height <= 90),
			).toBe(true);
			expect(layout.fontSizes.every((fontSize) => fontSize >= 14)).toBe(true);
			expect(layout.actionHeights.length).toBeGreaterThan(0);
			expect(layout.actionHeights.every((height) => height >= 44)).toBe(true);
			expect(layout.shadow).not.toBe("none");
			expect(layout.overflow).toBe(false);
			await expect(h.page.locator(".toast")).toBeHidden({ timeout: 10_000 });
			await card.screenshot({
				path: info.outputPath(`identifiers-card-${locale}-${width}.png`),
			});
			const entries = await exportEntries(h);
			expect(entries).toHaveLength(1);
			expect(entries[0].draft.password).toBe(password);
			expect(entries[0].draft.usernameAliases).toEqual(aliases);
			expect(h.errors).toEqual([]);
		} finally {
			await h.close();
		}
	});
}
