import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { build } from "esbuild";
import { passwordVaultCopy } from "../../apps/web/src/password-vault-copy";
import type {
	VaultPersistence,
	VaultSession,
} from "../../packages/password-vault/src";
import {
	aiServer,
	checkLayout,
	labels,
	model,
	syntheticKey,
} from "./helpers/ai-workflow";
import { selectChoice } from "./helpers/select-choice";

test.setTimeout(150_000);
const evidenceRoot =
	process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/keepany-password-smart-import";
mkdirSync(evidenceRoot, { recursive: true });
const master = "Synthetic smart-import master 2026!";
const githubPassword = "  Synthetic Github P4ss!;,|\t  ";
const gitlabPassword = "Synthetic GitLab password 2026!";
const duplicatePassword = "Synthetic existing password 2026!";
const changedPassword = "Synthetic Github next password 2026!";
const githubUsername = "synthetic-github-user@example.test";
const githubUrl =
	"https://github.com/login?token=synthetic-url-secret#private-anchor";
const note = "synthetic-private-note-do-not-send";
const verifiedTitle = "GitHub verified";
const variants = [
	{ locale: "zh-CN", width: 390 },
	{ locale: "zh-CN", width: 1280 },
	{ locale: "en-US", width: 390 },
	{ locale: "en-US", width: 1280 },
] as const;

function copy(locale: string) {
	const index = locale === "zh-CN" ? 0 : 1;
	return (key: string, values: Record<string, string | number> = {}) =>
		(passwordVaultCopy[key]?.[index] ?? key).replace(
			/\{\{(\w+)\}\}/g,
			(all, name: string) => String(values[name] ?? all),
		);
}
type Copy = ReturnType<typeof copy>;
function sourceBlock(
	url: string,
	username: string,
	password: string,
	title?: string,
	notes?: string,
) {
	return [
		...(title ? [`Title=${title}`] : []),
		`Website=${url}`,
		`Username=${username}`,
		`Password=${JSON.stringify(password)}`,
		...(notes ? [`Notes=${notes}`] : []),
	].join("\n");
}
const duplicateSource = sourceBlock(
	"https://duplicate.example/login",
	"synthetic-existing-user",
	duplicatePassword,
	"Existing login",
);
const pastedSource = [
	sourceBlock(
		githubUrl,
		githubUsername,
		githubPassword,
		"synthetic-source-title",
		note,
	),
	sourceBlock(
		"https://gitlab.com/users/sign_in",
		"synthetic-gitlab-user@example.test",
		gitlabPassword,
	),
	duplicateSource,
	"Title=Unclear account\nUsername=synthetic-unclear-user\nunlabeled-synthetic-secret",
].join("\n\n");

async function configureAndOpenVault(
	page: Page,
	locale: string,
	baseURL: string,
	width: number,
	withoutKey = false,
) {
	const ui = labels[locale === "zh-CN" ? "zh-CN" : "en"];
	await page.goto("/settings#assistant");
	const settings = page.locator(".ai-settings-panel");
	await selectChoice(settings.locator("#ai-settings-provider"), "compatible");
	await settings.locator("#ai-settings-url").fill(baseURL);
	await settings.locator("#ai-settings-model").fill(model);
	if (withoutKey)
		await selectChoice(settings.locator("#ai-settings-key-source"), "none");
	else {
		await selectChoice(settings.locator("#ai-settings-key-source"), "session");
		await settings.locator("#ai-settings-api-key").fill(syntheticKey);
	}
	await settings
		.getByRole("button", { name: ui.saveSettings, exact: true })
		.click();
	await expect(
		settings.getByRole("status").filter({ hasText: ui.ready }),
	).toBeVisible();
	// The API key is deliberately page-session only; use the real SPA link.
	if (width === 390) await page.locator(".mobile-menu").click();
	await page
		.getByRole("link", {
			name: locale === "zh-CN" ? "密码库" : "Password vault",
			exact: true,
		})
		.first()
		.click();
	await expect(page).toHaveURL(/\/assets\/vault/);
}
async function createVault(page: Page, t: Copy) {
	await page.locator("#password-vault-master").fill(master);
	await page.locator("#password-vault-master-confirm").fill(master);
	await page
		.getByRole("button", { name: t("pwVaultCreate"), exact: true })
		.click();
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
}
async function unlock(page: Page, t: Copy) {
	await page.locator("#password-vault-unlock-master").fill(master);
	await page
		.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
		.click();
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
}
async function closeDialog(page: Page) {
	const buttons = page
		.getByRole("dialog")
		.getByRole("button", { name: /^(Close|关闭)$/, exact: true });
	await expect(buttons.last()).toBeEnabled();
	await buttons.first().click();
	await expect(page.getByRole("dialog")).toBeHidden();
}

async function openImport(page: Page, t: Copy, source?: string) {
	await page
		.getByRole("button", { name: t("pwSmartTitle"), exact: true })
		.click();
	const importer = page.locator(".password-smart-import");
	await expect(importer).toBeVisible();
	await expect(importer.locator("#pw-smart-source")).toHaveValue("");
	if (source !== undefined) {
		await importer.locator("#pw-smart-source").fill(source);
		await importer
			.getByRole("button", { name: t("pwSmartRecognize"), exact: true })
			.click();
	}
	return importer;
}
async function seedDuplicate(page: Page, t: Copy) {
	await page
		.getByRole("button", { name: t("pwVaultNewEntry"), exact: true })
		.click();
	await page.locator("#password-vault-entry-title").fill("Existing login");
	await page
		.locator("#password-vault-entry-username")
		.fill("synthetic-existing-user");
	await openOptional(page.locator(".password-vault-optional"));
	await page
		.locator("#password-vault-entry-url")
		.fill("https://duplicate.example/login");
	await page.locator("#password-vault-entry-password").fill(duplicatePassword);
	await page
		.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
		.click();
	await expect(page.getByRole("dialog")).toBeHidden();
}
function entry(page: Page, title: string) {
	return page
		.locator(".password-vault-entry-list .password-vault-entry")
		.filter({ has: page.locator("strong", { hasText: title }) });
}
async function readEntry(page: Page, t: Copy, title: string) {
	await entry(page, title)
		.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
		.click();
	const field = page.locator("#password-vault-entry-password");
	await expect(field).toHaveAttribute("type", "password");
	await openOptional(page.locator(".password-vault-optional"));
	const result = {
		password: await field.inputValue(),
		username: await page.locator("#password-vault-entry-username").inputValue(),
		url: await page.locator("#password-vault-entry-url").inputValue(),
		notes: await page.locator("#password-vault-entry-notes").inputValue(),
	};
	await closeDialog(page);
	return result;
}
async function openRow(row: Locator) {
	const editor = row.locator(".pw-smart-row-editor");
	if ((await editor.getAttribute("open")) === null)
		await editor.locator("summary").first().click();
}
async function openOptional(container: Locator) {
	const addUrl = container.getByRole("button", {
		name: /^(添加网址|Add website URL)$/,
		exact: true,
	});
	if (await addUrl.isVisible()) await addUrl.click();
}
async function openFragment(group: Locator, t: Copy) {
	const form = group.locator(".pw-smart-fragment-form");
	if ((await form.getAttribute("data-expanded")) !== "true")
		await form
			.getByRole("button", { name: t("pwSmartFragmentFill"), exact: true })
			.click();
	await expect(form).toHaveAttribute("data-expanded", "true");
	return form;
}
async function changeFragmentTarget(form: Locator, t: Copy, targetId: string) {
	const picker = form.locator(".pw-smart-target-picker");
	if (!(await picker.isVisible()))
		await form
			.getByRole("button", {
				name: t("pwSmartFragmentChangeTarget"),
				exact: true,
			})
			.click();
	await selectChoice(picker.locator("button[id$='-target']"), targetId);
}
async function openSourceExcerpt(container: Locator, t: Copy) {
	const toggle = container
		.locator(".pw-smart-source-disclosure")
		.getByRole("button", { name: t("pwSmartSourceExcerpt"), exact: true });
	if (
		(await toggle.count()) > 0 &&
		(await toggle.getAttribute("aria-expanded")) === "false"
	)
		await toggle.click();
	await expect(container.locator(".pw-smart-source-excerpt")).toBeVisible();
}
async function sourceText(excerpt: Locator) {
	return (
		await excerpt.locator(".pw-smart-source-value").allTextContents()
	).join("\n");
}
async function expectQuickFormLayout(form: Locator) {
	const fields = await form.evaluate((element) =>
		["title", "username", "password"].map((field) => {
			const control = element.querySelector<HTMLInputElement>(
				`input[id$='-${field}']`,
			);
			const rectangle = control?.getBoundingClientRect();
			const parent = control?.closest(".field")?.getBoundingClientRect();
			return {
				field,
				width: rectangle?.width ?? 0,
				height: rectangle?.height ?? 0,
				parentWidth: parent?.width ?? 0,
				top: rectangle?.top ?? 0,
			};
		}),
	);
	for (const field of fields) {
		expect(field.width).toBeGreaterThan(120);
		expect(Math.abs(field.width - field.parentWidth)).toBeLessThanOrEqual(1);
		expect(Math.abs(field.height - 52)).toBeLessThanOrEqual(0.5);
	}
	expect(fields[1].top).toBeGreaterThan(fields[0].top);
	expect(fields[2].top).toBeGreaterThan(fields[1].top);
	test.info().annotations.push({
		type: "ui-quick-field-layout",
		description: JSON.stringify(fields),
	});
}
async function expectQuickGroupLayout(group: Locator, width: number) {
	const geometry = await group.evaluate((element) => {
		const source = element.querySelector(".pw-smart-source-disclosure");
		const form = element.querySelector(".pw-smart-fragment-editor");
		const a = source?.getBoundingClientRect();
		const b = form?.getBoundingClientRect();
		return {
			gap: a && b ? b.left - a.right : null,
			verticalGap: a && b ? b.top - a.bottom : null,
			sourceOpen:
				source?.querySelector("button")?.getAttribute("aria-expanded") ===
				"true",
			scrollWidth: element.scrollWidth,
			clientWidth: element.clientWidth,
		};
	});
	if (width === 390) {
		expect(geometry.sourceOpen).toBe(false);
		expect(geometry.verticalGap).toBeGreaterThanOrEqual(15.5);
	} else {
		expect(geometry.gap).toBeGreaterThanOrEqual(15.5);
	}
	expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
	test.info().annotations.push({
		type: "ui-quick-group-layout",
		description: JSON.stringify(geometry),
	});
}
/** A real pointer hit must land on the control even after mousedown updates focus. */
async function exercisePasswordEye(
	page: Page,
	field: Locator,
	controls: Locator,
	secret: string,
) {
	const multiline =
		(await field.evaluate((element) => element.tagName)) === "TEXTAREA";
	for (const [index, horizontal] of [
		0.5, 0.02, 0.98, 0.5, 0.02, 0.98,
	].entries()) {
		const eye = controls.getByRole("button", {
			name: /^(显示密码|隐藏密码|Show password|Hide password)$/,
			exact: true,
		});
		await eye.scrollIntoViewIfNeeded();
		const box = await eye.boundingBox();
		if (!box) throw Error("Password eye has no pointer target");
		expect(box.width).toBeGreaterThanOrEqual(44);
		expect(box.height).toBeGreaterThanOrEqual(44);
		const x = box.x + box.width * horizontal;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		try {
			expect(
				await eye.evaluate(
					(element, point) => {
						const rectangle = element.getBoundingClientRect();
						const hit = document.elementFromPoint(point.x, point.y);
						return (
							rectangle.left <= point.x &&
							point.x < rectangle.right &&
							rectangle.top <= point.y &&
							point.y < rectangle.bottom &&
							(hit === element || (!!hit && element.contains(hit)))
						);
					},
					{ x, y },
				),
			).toBe(true);
		} finally {
			await page.mouse.up();
		}
		test.info().annotations.push({
			type: "ui-pointer-hit",
			description: JSON.stringify({
				field: await field.getAttribute("id"),
				width: box.width,
				height: box.height,
				horizontal,
				hitAfterMouseDown: true,
				multiline,
			}),
		});
		if (multiline) {
			await expect(field).toHaveValue(
				index % 2 === 0 ? secret.replace(/\r\n/g, "\n") : "••••••••",
			);
		} else {
			await expect(field).toHaveAttribute(
				"type",
				index % 2 === 0 ? "text" : "password",
			);
			await expect(field).toHaveValue(secret);
		}
	}
}
async function addIdentifiers(form: Locator, values: string[]) {
	for (const [index, value] of values.entries()) {
		await form
			.getByRole("button", {
				name: /^(添加登录标识|Add login identifier)$/,
				exact: true,
			})
			.click();
		await form.locator(".pw-smart-identifier-row input").nth(index).fill(value);
	}
}
async function expectIdentifiers(form: Locator, values: string[]) {
	const inputs = form.locator(".pw-smart-identifier-row input");
	await expect(inputs).toHaveCount(values.length);
	for (const [index, value] of values.entries())
		await expect(inputs.nth(index)).toHaveValue(value);
}
async function expectActionSpacing(actions: Locator) {
	const gaps = await actions.evaluate((element) => {
		const buttons = [...element.querySelectorAll("button")].filter(
			(button) => button.getBoundingClientRect().width > 0,
		);
		return buttons.flatMap((button, index) =>
			buttons.slice(index + 1).map((other) => {
				const a = button.getBoundingClientRect();
				const b = other.getBoundingClientRect();
				const sameRow = Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
				return sameRow
					? Math.max(b.left - a.right, a.left - b.right)
					: Math.max(b.top - a.bottom, a.top - b.bottom);
			}),
		);
	});
	for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(15.5);
	test.info().annotations.push({
		type: "ui-gaps",
		description: JSON.stringify({
			target: await actions.getAttribute("class"),
			gaps,
		}),
	});
}
async function expectSourceGroupSpacing(groups: Locator) {
	const gaps = await groups.evaluateAll((elements) =>
		elements.map((element, index) => {
			const rectangle = element.getBoundingClientRect();
			const next = elements[index + 1]?.getBoundingClientRect();
			return next ? next.top - rectangle.bottom : null;
		}),
	);
	for (const gap of gaps)
		if (gap !== null) expect(gap).toBeGreaterThanOrEqual(15.5);
	test.info().annotations.push({
		type: "ui-source-gaps",
		description: JSON.stringify(gaps),
	});
}
async function captureFragmentSections(
	page: Page,
	form: Locator,
	stem: string,
) {
	await expect(page.locator(".toast")).toBeHidden({ timeout: 10_000 });
	await form
		.locator(".pw-smart-fragment-editor")
		.evaluate((element) =>
			element.scrollIntoView({ block: "start", behavior: "instant" }),
		);
	await page.screenshot({ path: join(evidenceRoot, `${stem}-top.png`) });
	await form
		.locator(".pw-smart-identifiers")
		.evaluate((element) =>
			element.scrollIntoView({ block: "start", behavior: "instant" }),
		);
	await page.screenshot({ path: join(evidenceRoot, `${stem}-details.png`) });
	await form
		.locator(".pw-smart-fragment-actions")
		.evaluate((element) =>
			element.scrollIntoView({ block: "center", behavior: "instant" }),
		);
	await page.screenshot({
		path: join(evidenceRoot, `${stem}-notes-actions.png`),
	});
}
async function importAdvanced(importer: Locator, t: Copy, key: string) {
	let button = importer.getByRole("button", { name: t(key), exact: true });
	if (!(await button.isVisible())) {
		button = importer.getByRole("button", {
			name: t(key),
			exact: true,
			includeHidden: true,
		});
		const section = button.locator("xpath=ancestor::details[1]");
		await section.locator("summary").first().click();
	}
	await button.click();
}
async function reviewMapping(importer: Locator, t: Copy) {
	const append = importer.getByRole("button", {
		name: t("pwSmartMapAdd"),
		exact: true,
	});
	await ((await append.isVisible())
		? append
		: importer.getByRole("button", {
				name: t("pwSmartMapReview"),
				exact: true,
			})
	).click();
}
/** Read ciphertext only; preview and AI must leave the persisted revision and bytes unchanged. */
async function persistedVault(page: Page) {
	return page.evaluate(async () => {
		const databases = await indexedDB.databases();
		for (const metadata of databases) {
			const name = metadata.name;
			if (!name?.endsWith("-files-v1")) continue;
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(name);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			try {
				if (!database.objectStoreNames.contains("passwordVault")) continue;
				const record = await new Promise<
					{ revision: string; bytes: Uint8Array } | undefined
				>((resolve, reject) => {
					const request = database
						.transaction("passwordVault", "readonly")
						.objectStore("passwordVault")
						.get("local");
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
				if (record) {
					const digest = await crypto.subtle.digest(
						"SHA-256",
						record.bytes.slice().buffer,
					);
					return {
						revision: record.revision,
						sha256: Array.from(new Uint8Array(digest), (value) =>
							value.toString(16).padStart(2, "0"),
						).join(""),
					};
				}
			} finally {
				database.close();
			}
		}
		throw Error("Synthetic vault was not found");
	});
}
let inspectionRuntime:
	| Promise<{ VaultSession: new (storage: VaultPersistence) => VaultSession }>
	| undefined;
async function inspectKdbx(path: string) {
	// Playwright runs native Node ESM, whereas kdbxweb publishes CommonJS named exports.
	// Bundle the existing engine for readonly artifact inspection; the UI still runs the fixed release files.
	inspectionRuntime ??= build({
		entryPoints: ["packages/password-vault/src/index.ts"],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
	}).then((result) => {
		const module = { exports: {} };
		new Function("require", "module", "exports", result.outputFiles[0].text)(
			createRequire(join(process.cwd(), "package.json")),
			module,
			module.exports,
		);
		return module.exports as {
			VaultSession: new (storage: VaultPersistence) => VaultSession;
		};
	});
	const { VaultSession: ReadonlySession } = await inspectionRuntime;
	const bytes = new Uint8Array(readFileSync(path));
	const storage: VaultPersistence = {
		read: async () => ({
			id: "local",
			revision: "synthetic-readonly-revision",
			bytes,
			updatedAt: "2026-10-02T00:00:00.000Z",
		}),
		write: async () => {
			throw Error("Readonly KDBX inspection cannot write");
		},
	};
	const session = new ReadonlySession(storage);
	await session.initialize();
	await session.unlock(master);
	try {
		return session.getSnapshot().entries.map(({ id }) => ({
			draft: session.readEntry(id),
			history: session.history(id),
		}));
	} finally {
		session.lock();
	}
}

test("local line mapping retains unresolved edits through partial save and clears them on lock", async ({
	browser,
}) => {
	const t = copy("en-US");
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 1280, height: 844 },
	});
	await context.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	const page = await context.newPage();
	try {
		await page.goto("/assets/vault");
		await createVault(page, t);
		const source =
			"Mapped service\nplain-user\nSynthetic mapped password\nUnassigned old value";
		const importer = await openImport(page, t);
		await importer.locator("#pw-smart-source").fill(source);
		await importAdvanced(importer, t, "pwSmartMap");
		await importer
			.locator("#pw-map-value-4")
			.fill("Unassigned corrected value");
		await importAdvanced(importer, t, "pwSmartEditSource");
		await expect(importer.locator("#pw-smart-source")).toHaveValue(
			source.replace("old value", "corrected value"),
		);
		await importAdvanced(importer, t, "pwSmartMap");
		for (const [line, field] of [
			[1, "title"],
			[2, "username"],
			[3, "password"],
		] as const)
			await selectChoice(importer.locator(`#pw-map-field-${line}`), field);
		await importer
			.locator("#pw-map-value-4")
			.fill("Unassigned second correction");
		await reviewMapping(importer, t);
		await expect(importer.locator(".pw-smart-issues")).toContainText(
			t("pwSmartIssue_unrecognized-line"),
		);
		await importer.locator(".pw-smart-row").getByRole("checkbox").check();
		await importer
			.getByRole("button", {
				name: t("pwSmartConfirm", { count: 1 }),
				exact: true,
			})
			.click();
		await expect(importer.locator(".pw-smart-receipt")).toHaveText(
			t("pwSmartSaved", { added: 1, updated: 0, skipped: 0 }),
		);
		const continueButton = importer.getByRole("button", {
			name: t("pwSmartContinue"),
			exact: true,
		});
		if (await continueButton.isVisible()) await continueButton.click();
		await importAdvanced(importer, t, "pwSmartEditSource");
		await expect(importer.locator("#pw-smart-source")).toHaveValue(
			source.replace("old value", "second correction"),
		);
		await importer
			.getByRole("button", { name: t("pwSmartLockClose"), exact: true })
			.click();
		await expect(page.getByRole("dialog")).toBeHidden();
		await unlock(page, t);
		await openImport(page, t);
		await expect(importer.locator("#pw-smart-source")).toHaveValue("");
		await closeDialog(page);
	} finally {
		await context.close();
	}
});

test("advanced input and mapping returns retain edited review choices through failed replacement work", async ({
	browser,
}) => {
	test.setTimeout(45_000);
	const t = copy("en-US");
	const mock = await aiServer();
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 1280, height: 844 },
	});
	await context.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	const page = await context.newPage();
	const source =
		"Original review service\noriginal.review@example.test\nSynthetic reviewed secret!";
	const editedNotes =
		"Synthetic unsaved form edit that must survive every back button";
	try {
		await configureAndOpenVault(page, "en-US", mock.baseURL, 1280);
		await createVault(page, t);
		const original = await persistedVault(page);
		const importer = await openImport(page, t);
		await importer.locator("#pw-smart-source").fill(source);
		mock.responses.push(
			JSON.stringify({
				records: [
					{
						title: { line: 1 },
						username: { line: 2 },
						password: { line: 3 },
						url: null,
						notes: null,
					},
				],
				ignoredLines: [],
			}),
		);
		await importer
			.getByRole("button", {
				name: t("pwSmartAiRecognize", { model }),
				exact: true,
			})
			.click();
		const row = importer.locator(".pw-smart-row");
		await openRow(row);
		await openOptional(row.locator(".pw-smart-optional"));
		await row.locator("textarea[id$='-notes']").fill(editedNotes);
		await row.getByRole("checkbox").check();
		const assertOriginalReview = async () => {
			await expect(row).toHaveCount(1);
			await expect(row.locator("input[id$='-title']")).toHaveValue(
				"Original review service",
			);
			await expect(row.locator("textarea[id$='-notes']")).toHaveValue(
				editedNotes,
			);
			await expect(row.getByRole("checkbox")).toBeChecked();
			await expect(importer.locator(".pw-smart-mode")).toHaveText(
				t("pwSmartReviewMode_ai", { model, endpoint: mock.baseURL }),
			);
			expect(await persistedVault(page)).toEqual(original);
		};
		await importAdvanced(importer, t, "pwSmartEditSource");
		const input = importer.locator("#pw-smart-source");
		const changedSource = `${source}\nSynthetic unassigned correction`;
		await input.fill(changedSource);
		await importer.locator("#pw-smart-file").setInputFiles({
			name: "synthetic-invalid-utf8.txt",
			mimeType: "text/plain",
			buffer: Buffer.from([0xff, 0xff]),
		});
		await expect(
			importer.getByRole("status").filter({ hasText: t("pwSmartFailed") }),
		).toBeVisible();
		await expect(input).toHaveValue(changedSource);
		await importer
			.getByRole("button", { name: t("pwSmartBackToReview"), exact: true })
			.click();
		await assertOriginalReview();
		await importAdvanced(importer, t, "pwSmartEditSource");
		mock.responses.push("broken synthetic-only JSON");
		await importer
			.getByRole("button", {
				name: t("pwSmartAiRecognize", { model }),
				exact: true,
			})
			.click();
		await expect(
			importer
				.getByRole("status")
				.filter({ hasText: t("pwSmartAiResponseFormat") }),
		).toBeVisible();
		await expect(input).toHaveValue(changedSource);
		await importer
			.getByRole("button", { name: t("pwSmartBackToReview"), exact: true })
			.click();
		await assertOriginalReview();
		await importAdvanced(importer, t, "pwSmartMap");
		for (const [line, field] of [
			[1, "title"],
			[2, "title"],
			[3, "password"],
		] as const)
			await selectChoice(importer.locator(`#pw-map-field-${line}`), field);
		await reviewMapping(importer, t);
		await expect(importer.locator(".pw-smart-mapping")).toBeVisible();
		await importer
			.getByRole("button", { name: t("pwSmartBackToReview"), exact: true })
			.click();
		await assertOriginalReview();
		await importAdvanced(importer, t, "pwSmartMap");
		await importAdvanced(importer, t, "pwSmartEditSource");
		await expect(input).toHaveValue(changedSource);
		await importer
			.getByRole("button", { name: t("pwSmartBackToReview"), exact: true })
			.click();
		await assertOriginalReview();
		await importer
			.getByRole("button", {
				name: t("pwSmartConfirm", { count: 1 }),
				exact: true,
			})
			.click();
		await expect(importer.locator(".pw-smart-receipt")).toHaveText(
			t("pwSmartSaved", { added: 1, updated: 0, skipped: 0 }),
		);
		await closeDialog(page);
		await page.reload();
		await unlock(page, t);
		expect(await readEntry(page, t, "Original review service")).toEqual({
			password: "Synthetic reviewed secret!",
			username: "original.review@example.test",
			url: "",
			notes: editedNotes,
		});
		expect(mock.requests).toHaveLength(2);
	} finally {
		await context.close();
		await mock.close();
	}
});

test("unassigned-only content becomes an editable pending form entry and saves locally", async ({
	browser,
}) => {
	test.setTimeout(45_000);
	const t = copy("en-US");
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 390, height: 844 },
	});
	await context.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	const page = await context.newPage();
	const outgoing: string[] = [];
	page.on("request", (request) => {
		if (/chat\/completions|responses$/.test(request.url()))
			outgoing.push(request.url());
	});
	const source =
		"Unassigned synthetic information\nSynthetic note retained as original";
	const password = "Synthetic manually entered app password!";
	try {
		await page.goto("/assets/vault");
		await createVault(page, t);
		const original = await persistedVault(page);
		const importer = await openImport(page, t, source);
		await expect(importer.locator(".pw-smart-row")).toHaveCount(0);
		await expect(importer.locator("#pw-smart-source")).toBeHidden();
		const group = importer.locator(".pw-smart-source-group");
		await expect(group).toHaveCount(1);
		await openFragment(group, t);
		const form = group.locator(".pw-smart-fragment-form");
		await form
			.locator("input[id$='-title']")
			.fill("Synthetic manually completed App");
		await form
			.getByRole("button", { name: t("pwSmartFragmentAddNotes"), exact: true })
			.click();
		await expect(form.locator("textarea[id$='-notes']")).toHaveValue(source);
		await form
			.getByRole("button", { name: t("pwSmartFragmentApply"), exact: true })
			.click();
		const row = importer.locator(".pw-smart-row");
		await expect(row).toHaveCount(1);
		await expect(row.getByRole("checkbox")).toBeDisabled();
		await expect(row.locator(".pw-smart-row-issues")).toContainText(
			t("pwSmartIssue_missing-password"),
		);
		await openRow(row);
		await expect(row.locator("textarea[id$='-notes']")).toHaveValue(source);
		await row.locator("input[id$='-username']").fill("manual-app-user-91");
		await row.locator("input[id$='-password']").fill(password);
		await expect(row.getByRole("checkbox")).toBeEnabled();
		await expect(row.getByRole("checkbox")).not.toBeChecked();
		expect(await persistedVault(page)).toEqual(original);
		await row.getByRole("checkbox").check();
		await importer
			.getByRole("button", {
				name: t("pwSmartConfirm", { count: 1 }),
				exact: true,
			})
			.click();
		await expect(importer.locator(".pw-smart-receipt")).toHaveText(
			t("pwSmartSaved", { added: 1, updated: 0, skipped: 0 }),
		);
		await closeDialog(page);
		await page.reload();
		await unlock(page, t);
		expect(
			await readEntry(page, t, "Synthetic manually completed App"),
		).toEqual({
			password,
			username: "manual-app-user-91",
			url: "",
			notes: source,
		});
		expect(outgoing).toEqual([]);
	} finally {
		await context.close();
	}
});

test("partly assigned source keeps the original fragment form draft while adding mapped entries", async ({
	browser,
}) => {
	test.setTimeout(45_000);
	const t = copy("en-US");
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 1280, height: 844 },
		acceptDownloads: true,
	});
	await context.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	const page = await context.newPage();
	const outgoing: string[] = [];
	page.on("request", (request) => {
		if (/chat\/completions|responses$/.test(request.url()))
			outgoing.push(request.url());
	});
	const mappedPassword = "Synthetic mapped original password!";
	const manualPassword = "Synthetic unsaved manual password!";
	const notes = "Synthetic unsaved note survives partial source assignment";
	const source = `Synthetic mapped service\n${mappedPassword}\nSynthetic unassigned extra note`;
	try {
		await page.goto("/assets/vault");
		await createVault(page, t);
		const original = await persistedVault(page);
		const importer = await openImport(page, t, source);
		await expect(importer.locator(".pw-smart-row")).toHaveCount(0);
		const group = importer.locator(".pw-smart-source-group");
		await expect(group).toHaveCount(1);
		const groupId = await group.getAttribute("data-source-group");
		await openFragment(group, t);
		const form = group.locator(".pw-smart-fragment-form");
		await form.locator("input[id$='-title']").fill("Synthetic manual service");
		await form.locator("input[id$='-username']").fill("manual-unsaved-user");
		await form.locator("input[id$='-password']").fill(manualPassword);
		await openOptional(form.locator(".pw-smart-optional"));
		await form.locator("textarea[id$='-notes']").fill(notes);
		await importAdvanced(importer, t, "pwSmartMap");
		await selectChoice(importer.locator("#pw-map-field-1"), "title");
		await selectChoice(importer.locator("#pw-map-field-2"), "password");
		await reviewMapping(importer, t);
		await expect(importer.locator(".pw-smart-row")).toHaveCount(1);
		await expect(group).toHaveAttribute("data-source-group", groupId ?? "");
		await expect(form).toHaveAttribute("data-expanded", "true");
		await expect(form.locator("input[id$='-title']")).toHaveValue(
			"Synthetic manual service",
		);
		await expect(form.locator("input[id$='-username']")).toHaveValue(
			"manual-unsaved-user",
		);
		await expect(form.locator("input[id$='-password']")).toHaveValue(
			manualPassword,
		);
		await expect(form.locator("textarea[id$='-notes']")).toHaveValue(notes);
		expect(await persistedVault(page)).toEqual(original);
		await form
			.getByRole("button", { name: t("pwSmartFragmentApply"), exact: true })
			.click();
		await expect(importer.locator(".pw-smart-row")).toHaveCount(2);
		await expect(importer.locator(".pw-smart-issues")).toHaveCount(0);
		for (const checkbox of await importer
			.locator(".pw-smart-row")
			.getByRole("checkbox")
			.all())
			await checkbox.check();
		await importer
			.getByRole("button", {
				name: t("pwSmartConfirm", { count: 2 }),
				exact: true,
			})
			.click();
		await expect(importer.locator(".pw-smart-receipt")).toHaveText(
			t("pwSmartSaved", { added: 2, updated: 0, skipped: 0 }),
		);
		await closeDialog(page);
		const download = page.waitForEvent("download");
		await page
			.getByRole("button", { name: t("pwVaultExport"), exact: true })
			.click();
		const path = test.info().outputPath("partly-assigned-fragment.kdbx");
		await (await download).saveAs(path);
		const exported = await inspectKdbx(path);
		expect(exported).toHaveLength(2);
		expect(exported.map(({ draft }) => draft)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: "Synthetic mapped service",
					password: mappedPassword,
					username: "",
					notes: "",
				}),
				expect.objectContaining({
					title: "Synthetic manual service",
					password: manualPassword,
					username: "manual-unsaved-user",
					notes,
				}),
			]),
		);
		expect(outgoing).toEqual([]);
	} finally {
		await context.close();
	}
});

test("remaining source forms explicitly supplement an entry already saved in this import", async ({
	browser,
}) => {
	test.setTimeout(45_000);
	const t = copy("en-US");
	const mock = await aiServer();
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 1280, height: 844 },
		acceptDownloads: true,
	});
	await context.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	const page = await context.newPage();
	const password = "Synthetic saved service password!";
	const sourceNote = "Synthetic extra note kept for the imported service";
	const source = `Saved service\nsaved.service@example.test\n${password}\n\n${sourceNote}`;
	try {
		await configureAndOpenVault(page, "en-US", mock.baseURL, 1280);
		await createVault(page, t);
		const importer = await openImport(page, t);
		await importer.locator("#pw-smart-source").fill(source);
		mock.responses.push(
			JSON.stringify({
				records: [
					{
						title: { line: 1 },
						username: { line: 2 },
						password: { line: 3 },
						url: null,
						notes: null,
					},
				],
				ignoredLines: [5],
			}),
		);
		await importer
			.getByRole("button", {
				name: t("pwSmartAiRecognize", { model }),
				exact: true,
			})
			.click();
		const group = importer.locator(".pw-smart-source-group");
		await openFragment(group, t);
		const form = group.locator(".pw-smart-fragment-form");
		await changeFragmentTarget(form, t, "vault-import-1");
		await expect(
			form.getByRole("button", {
				name: t("pwSmartFragmentApply"),
				exact: true,
			}),
		).toBeDisabled();
		await form
			.getByRole("button", { name: t("pwSmartFragmentAddNotes"), exact: true })
			.click();
		await expect(form.locator("textarea[id$='-notes']")).toHaveValue(
			sourceNote,
		);
		await importer.locator(".pw-smart-row").getByRole("checkbox").check();
		await importer
			.getByRole("button", {
				name: t("pwSmartConfirm", { count: 1 }),
				exact: true,
			})
			.click();
		await expect(importer.locator(".pw-smart-receipt")).toHaveText(
			t("pwSmartSaved", { added: 1, updated: 0, skipped: 0 }),
		);
		const continueButton = importer.getByRole("button", {
			name: t("pwSmartContinue"),
			exact: true,
		});
		if (await continueButton.isVisible()) await continueButton.click();
		await expect(importer.locator("#pw-smart-source")).toBeHidden();
		await expect(importer.locator(".pw-smart-row")).toHaveCount(0);
		const savedRevision = await persistedVault(page);
		await expect(form).toHaveAttribute("data-expanded", "true");
		await expect(form.locator("button[id$='-target']")).toHaveAttribute(
			"data-value",
			"vault-import-1",
		);
		await expect(form.locator("input[id$='-title']")).toHaveValue(
			"Saved service",
		);
		await expect(form.locator("input[id$='-title']")).toHaveAttribute(
			"readonly",
			"",
		);
		await expect(form.locator("input[id$='-username']")).toHaveValue(
			"saved.service@example.test",
		);
		await expect(
			form.getByRole("button", {
				name: t("pwSmartFragmentNotesAdded"),
				exact: true,
			}),
		).toBeDisabled();
		await expect(form.locator("textarea[id$='-notes']")).toHaveValue(
			sourceNote,
		);
		await form
			.getByRole("button", { name: t("pwSmartFragmentApply"), exact: true })
			.click();
		const row = importer.locator(".pw-smart-row");
		await expect(row).toHaveCount(1);
		await expect(row.getByRole("checkbox")).toBeChecked();
		await expect(row.getByRole("checkbox")).toBeEnabled();
		expect(await persistedVault(page)).toEqual(savedRevision);
		await row.getByRole("checkbox").check();
		await importer
			.getByRole("button", {
				name: t("pwSmartConfirm", { count: 1 }),
				exact: true,
			})
			.click();
		await expect(importer.locator(".pw-smart-receipt")).toHaveText(
			t("pwSmartSaved", { added: 0, updated: 1, skipped: 0 }),
		);
		await closeDialog(page);
		await expect(
			page.locator(".password-vault-entry-list .password-vault-entry"),
		).toHaveCount(1);
		const download = page.waitForEvent("download");
		await page
			.getByRole("button", { name: t("pwVaultExport"), exact: true })
			.click();
		const path = test
			.info()
			.outputPath("fragment-update-after-partial-save.kdbx");
		await (await download).saveAs(path);
		const exported = await inspectKdbx(path);
		expect(exported).toHaveLength(1);
		expect(exported[0].draft).toMatchObject({
			title: "Saved service",
			username: "saved.service@example.test",
			password,
			url: "",
			notes: sourceNote,
		});
		expect(exported[0].history).toHaveLength(1);
		expect(mock.requests).toHaveLength(1);
	} finally {
		await context.close();
		await mock.close();
	}
});

test("a same-password duplicate can explicitly update saved notes after fragment completion", async ({
	browser,
}) => {
	test.setTimeout(45_000);
	const t = copy("en-US");
	const mock = await aiServer();
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 1280, height: 844 },
		acceptDownloads: true,
	});
	await context.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	const page = await context.newPage();
	const sourceNote = "Synthetic supplemental note for the already saved login";
	const source = `Existing login\nsynthetic-existing-user\n${duplicatePassword}\nhttps://duplicate.example/login\n\n${sourceNote}`;
	try {
		await configureAndOpenVault(page, "en-US", mock.baseURL, 1280);
		await createVault(page, t);
		await seedDuplicate(page, t);
		const original = await persistedVault(page);
		const importer = await openImport(page, t);
		await importer.locator("#pw-smart-source").fill(source);
		mock.responses.push(
			JSON.stringify({
				records: [
					{
						title: { line: 1 },
						username: { line: 2 },
						password: { line: 3 },
						url: { line: 4 },
						notes: null,
					},
				],
				ignoredLines: [6],
			}),
		);
		await importer
			.getByRole("button", {
				name: t("pwSmartAiRecognize", { model }),
				exact: true,
			})
			.click();
		const row = importer.locator(".pw-smart-row");
		await expect(row).toContainText(t("pwSmartStatus_duplicate"));
		await expect(row.getByRole("checkbox")).toBeDisabled();
		const group = importer.locator(".pw-smart-source-group");
		await openFragment(group, t);
		const form = group.locator(".pw-smart-fragment-form");
		await changeFragmentTarget(form, t, "vault-import-1");
		await form
			.getByRole("button", { name: t("pwSmartFragmentAddNotes"), exact: true })
			.click();
		await form
			.getByRole("button", { name: t("pwSmartFragmentApply"), exact: true })
			.click();
		await expect(row).toContainText(t("pwSmartStatus_conflict"));
		await expect(row.getByRole("checkbox")).toBeDisabled();
		await expect(
			importer.locator("#pw-smart-vault-import-1-action"),
		).toHaveAttribute("data-value", "skip");
		await importer.locator("#pw-smart-vault-import-1-action").click();
		await expect(
			page.getByRole("option", {
				name: t("pwSmartCreateSeparate"),
				exact: true,
			}),
		).toHaveAttribute("aria-disabled", "true");
		await page.keyboard.press("Escape");
		expect(await persistedVault(page)).toEqual(original);
		await selectChoice(importer.locator("#pw-smart-vault-import-1-action"), {
			label: t("pwSmartUpdateExisting", { name: "Existing login" }),
		});
		await expect(row.getByRole("checkbox")).toBeChecked();
		await importer
			.getByRole("button", {
				name: t("pwSmartConfirm", { count: 1 }),
				exact: true,
			})
			.click();
		await expect(importer.locator(".pw-smart-receipt")).toHaveText(
			t("pwSmartSaved", { added: 0, updated: 1, skipped: 0 }),
		);
		await closeDialog(page);
		const download = page.waitForEvent("download");
		await page
			.getByRole("button", { name: t("pwVaultExport"), exact: true })
			.click();
		const path = test.info().outputPath("same-password-fragment-notes.kdbx");
		await (await download).saveAs(path);
		const exported = await inspectKdbx(path);
		expect(exported).toHaveLength(1);
		expect(exported[0].draft).toMatchObject({
			title: "Existing login",
			username: "synthetic-existing-user",
			password: duplicatePassword,
			url: "https://duplicate.example/login",
			notes: sourceNote,
		});
		expect(exported[0].history).toHaveLength(1);
		expect(mock.requests).toHaveLength(1);
	} finally {
		await context.close();
		await mock.close();
	}
});

for (const variant of variants) {
	test(`${variant.locale} ${variant.width}px quick completion reuses recognized identity and fills exact selected source with one AI request`, async ({
		browser,
	}) => {
		const t = copy(variant.locale);
		const mock = await aiServer();
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
			permissions: ["clipboard-read", "clipboard-write"],
			acceptDownloads: true,
		});
		await context.addInitScript(
			(locale) => localStorage.setItem("keepany-language", locale),
			variant.locale === "zh-CN" ? "zh-CN" : "en",
		);
		const page = await context.newPage();
		const errors: string[] = [];
		const consoleErrors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		const firstPassword = "  Synthetic quick password ;|!  ";
		const secondPassword = "Synthetic separate mobile password!";
		const source = [
			"Quick service",
			"quick.user@example.test",
			firstPassword,
			"",
			"Separate mobile App",
			"mobile-player-52",
			secondPassword,
		].join("\n");
		try {
			await configureAndOpenVault(
				page,
				variant.locale,
				mock.baseURL,
				variant.width,
			);
			await createVault(page, t);
			const original = await persistedVault(page);
			const importer = await openImport(page, t);
			await importer.locator("#pw-smart-source").fill(source);
			mock.responses.push(
				JSON.stringify({
					records: [
						{
							title: { line: 1 },
							username: { line: 2 },
							password: null,
							url: null,
							notes: null,
						},
						{
							title: { line: 5 },
							username: { line: 6 },
							password: null,
							url: null,
							notes: null,
						},
					],
					ignoredLines: [3, 7],
				}),
			);
			await importer
				.getByRole("button", {
					name: t("pwSmartAiRecognize", { model }),
					exact: true,
				})
				.click();
			const groups = importer.locator(".pw-smart-source-group");
			await expect(groups).toHaveCount(2);
			const rows = importer.locator(".pw-smart-row");
			await expect(rows).toHaveCount(2);
			for (const [index, title, username, password, line] of [
				[0, "Quick service", "quick.user@example.test", firstPassword, 3],
				[1, "Separate mobile App", "mobile-player-52", secondPassword, 7],
			] as const) {
				const group = groups.first();
				const form = group.locator(".pw-smart-fragment-form");
				await expect(form).toHaveAttribute("data-expanded", "true");
				await expect(form).toHaveAttribute(
					"data-completion-target",
					`vault-import-${index + 1}`,
				);
				await expect(form.locator("button[id$='-mode']")).toHaveCount(0);
				await expect(form.locator(".pw-smart-target-picker")).toBeHidden();
				await expect(form.locator("input[id$='-title']")).toHaveValue(title);
				await expect(form.locator("input[id$='-username']")).toHaveValue(
					username,
				);
				await expect(form.locator("input[id$='-password']")).toHaveValue("");
				await expectQuickGroupLayout(group, variant.width);
				await expectQuickFormLayout(form);
				await expect(form.locator("input[id$='-url']")).toBeHidden();
				await expect(form.locator("textarea[id$='-notes']")).toBeVisible();
				if (variant.locale === "en-US")
					expect(await group.innerText()).not.toMatch(/[\u4e00-\u9fff]/);
				await expect(page.locator(".toast")).toBeHidden({ timeout: 10_000 });
				await form.evaluate((element) =>
					element.scrollIntoView({ block: "start", behavior: "instant" }),
				);
				await page.screenshot({
					path: join(
						evidenceRoot,
						`password-quick-fill-${variant.locale}-${variant.width}-${index + 1}-default.png`,
					),
				});
				const excerpt = group.locator(".pw-smart-source-excerpt");
				await openSourceExcerpt(group, t);
				await excerpt
					.getByRole("button", {
						name: t("pwSmartSourceShow"),
						exact: true,
					})
					.click();
				const selectedLine = group.getByRole("checkbox", {
					name: t("pwSmartSourceSelectLine", { line }),
					exact: true,
				});
				const sourceLine = selectedLine.locator("xpath=..");
				await sourceLine.locator(".pw-smart-source-value").click();
				await expect(selectedLine).toBeChecked();
				const lineBox = await sourceLine.boundingBox();
				expect(lineBox?.height).toBeGreaterThanOrEqual(44);
				const sourceActions = group.locator(".pw-smart-source-field-actions");
				await expectActionSpacing(sourceActions);
				await sourceActions.evaluate((element) =>
					element.scrollIntoView({ block: "center", behavior: "instant" }),
				);
				await page.screenshot({
					path: join(
						evidenceRoot,
						`password-quick-fill-${variant.locale}-${variant.width}-${index + 1}-source-actions.png`,
					),
				});
				await group
					.getByRole("button", { name: t("pwSmartSourceCopy"), exact: true })
					.click();
				expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
					password,
				);
				await group
					.getByRole("button", { name: t("pwSmartFillPassword"), exact: true })
					.click();
				await expect(form.locator("input[id$='-password']")).toHaveValue(
					password,
				);
				await expect(form.locator("input[id$='-title']")).toHaveValue(title);
				await expect(form.locator("input[id$='-username']")).toHaveValue(
					username,
				);
				await expectActionSpacing(form.locator(".pw-smart-fragment-actions"));
				await checkLayout(page, importer, variant.width);
				await expect(page.locator(".toast")).toBeHidden({ timeout: 10_000 });
				if (variant.width === 390)
					await group
						.locator(".pw-smart-source-disclosure")
						.getByRole("button", {
							name: t("pwSmartSourceExcerpt"),
							exact: true,
						})
						.click();
				await form.evaluate((element) =>
					element.scrollIntoView({ block: "start", behavior: "instant" }),
				);
				await page.screenshot({
					path: join(
						evidenceRoot,
						`password-quick-fill-${variant.locale}-${variant.width}-${index + 1}.png`,
					),
				});
				await form
					.getByRole("button", {
						name: t("pwSmartFragmentApply"),
						exact: true,
					})
					.click();
				await expect(
					rows.nth(index).getByRole("checkbox").first(),
				).toBeChecked();
				await expect(groups).toHaveCount(1 - index);
				expect(await persistedVault(page)).toEqual(original);
				expect(mock.requests).toHaveLength(1);
			}
			await importer
				.getByRole("button", {
					name: t("pwSmartConfirm", { count: 2 }),
					exact: true,
				})
				.click();
			await expect(importer.locator(".pw-smart-receipt")).toHaveText(
				t("pwSmartSaved", { added: 2, updated: 0, skipped: 0 }),
			);
			await closeDialog(page);
			const download = page.waitForEvent("download");
			await page
				.getByRole("button", { name: t("pwVaultExport"), exact: true })
				.click();
			const path = test.info().outputPath("quick-filled-passwords.kdbx");
			await (await download).saveAs(path);
			const exported = await inspectKdbx(path);
			expect(exported).toHaveLength(2);
			expect(exported.map(({ draft }) => draft)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						title: "Quick service",
						username: "quick.user@example.test",
						password: firstPassword,
						url: "",
					}),
					expect.objectContaining({
						title: "Separate mobile App",
						username: "mobile-player-52",
						password: secondPassword,
						url: "",
					}),
				]),
			);
			expect(mock.requests).toHaveLength(1);
			expect(errors).toEqual([]);
			expect(consoleErrors).toEqual([]);
			test.info().annotations.push({
				type: "ui-quick-completion",
				description: JSON.stringify({
					bundle: await page.evaluate(() =>
						[...document.scripts]
							.filter((script) => script.src)
							.map((script) => new URL(script.src).pathname)
							.find((path) => path.startsWith("/assets/index-")),
					),
					exportedEntries: exported.length,
					aiCalls: mock.requests.length,
					identityRetyped: false,
					modeSelections: 0,
					clipboardExact: true,
					pageErrors: errors.length,
					consoleErrors: consoleErrors.length,
				}),
			});
		} finally {
			await context.close();
			await mock.close();
		}
	});

	test(`${variant.locale} ${variant.width}px unresolved source forms create or complete entries and save without rerunning AI`, async ({
		browser,
	}) => {
		test.setTimeout(75_000);
		const t = copy(variant.locale);
		const mock = await aiServer();
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
			acceptDownloads: true,
		});
		await context.addInitScript(
			(locale) => localStorage.setItem("keepany-language", locale),
			variant.locale === "zh-CN" ? "zh-CN" : "en",
		);
		const page = await context.newPage();
		const errors: string[] = [];
		const consoleErrors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		const firstPassword = '  Synthetic Gmail ;|,\\" P4ss!\t  ';
		const secondPassword = "Synthetic second Gmail password!";
		const appPassword = "Synthetic App password\r\nsecond line  ";
		const unknown =
			'<img src=x onerror="document.body.dataset.syntheticXss=1">';
		const unknownSecret = "Synthetic unassigned secret 2026!";
		const attachedSource =
			"Synthetic additional account information\r\nRecovery contact: help.synthetic@example.test";
		const manuallyCreatedPassword =
			"  Synthetic manually classified password ;|!  ";
		const completedPassword = "Synthetic completed pending account password!";
		const additionalPassword =
			"Synthetic additional platform account password!";
		const source = [
			"Gmail",
			"first.gmail@example.test",
			firstPassword,
			"second.gmail@example.test",
			secondPassword,
			"",
			"Studio App",
			"studio-player-42",
			appPassword,
			"",
			"App without password",
			"pending-player-55",
			"",
			unknown,
			unknownSecret,
			"",
			attachedSource,
		].join("\r\n");
		try {
			await configureAndOpenVault(
				page,
				variant.locale,
				mock.baseURL,
				variant.width,
			);
			await createVault(page, t);
			const original = await persistedVault(page);
			const importer = await openImport(page, t);
			await importer.locator("#pw-smart-file").setInputFiles({
				name: "synthetic-gmail-app-logins.txt",
				mimeType: "text/plain",
				buffer: Buffer.from(source),
			});
			mock.responses.push(
				JSON.stringify({
					records: [
						{
							title: { line: 1 },
							username: { line: 2 },
							password: { line: 3 },
							url: null,
							notes: null,
						},
						{
							title: { line: 1 },
							username: { line: 4 },
							password: { line: 5 },
							url: null,
							notes: null,
						},
						{
							title: { line: 7 },
							username: { line: 8 },
							password: { line: 9, endLine: 10 },
							url: null,
							notes: null,
						},
						{
							title: { line: 12 },
							username: { line: 13 },
							password: null,
							url: null,
							notes: null,
						},
					],
					ignoredLines: [15, 16, 18, 19],
				}),
			);
			await importer
				.getByRole("button", {
					name: t("pwSmartAiRecognize", { model }),
					exact: true,
				})
				.click();
			const rows = importer.locator(".pw-smart-row");
			await expect(rows).toHaveCount(4);
			for (const checkbox of await rows.getByRole("checkbox").all())
				await expect(checkbox).not.toBeChecked();
			const first = rows.nth(0);
			const second = rows.nth(1);
			const app = rows.nth(2);
			const pending = importer.locator(
				'.pw-smart-row[data-row-id="vault-import-4"]',
			);
			await expect(pending.locator(".pw-smart-row-editor")).toHaveAttribute(
				"open",
				"",
			);
			for (const [row, username] of [
				[first, "first.gmail@example.test"],
				[second, "second.gmail@example.test"],
				[app, "studio-player-42"],
				[pending, "pending-player-55"],
			] as const) {
				await expect(row.locator(".pw-smart-row-summary")).toContainText(
					username,
				);
				await openRow(row);
				await expect(row.locator(".pw-smart-source-context")).toContainText(
					username,
				);
				await expect(row.locator("input[id$='-url']")).toBeHidden();
				await expect(row.locator("textarea[id$='-notes']")).toBeVisible();
				await expect(row.locator(".pw-smart-optional summary")).toHaveCount(0);
			}
			await expect(first.locator(".pw-smart-source-context")).toContainText(
				"Gmail",
			);
			await expect(second.locator(".pw-smart-source-context")).toContainText(
				"Gmail",
			);
			await expect(app.locator(".pw-smart-source-context")).toContainText(
				"Studio App",
			);
			await expect(pending.locator(".pw-smart-row-editor")).toHaveAttribute(
				"open",
				"",
			);
			await expect(pending.getByRole("checkbox")).toBeDisabled();
			const firstExcerpt = first.locator(".pw-smart-source-excerpt");
			const secondExcerpt = second.locator(".pw-smart-source-excerpt");
			await openSourceExcerpt(first, t);
			await expect(firstExcerpt).toHaveAttribute(
				"data-source-revealed",
				"false",
			);
			await expect(
				firstExcerpt.locator(".pw-smart-source-text"),
			).not.toContainText(firstPassword);
			await firstExcerpt
				.getByRole("button", { name: t("pwSmartSourceShow"), exact: true })
				.click();
			await expect(firstExcerpt).toHaveAttribute(
				"data-source-revealed",
				"true",
			);
			await expect(firstExcerpt.locator(".pw-smart-source-text")).toContainText(
				firstPassword,
			);
			expect(await sourceText(firstExcerpt)).toBe(
				[
					"Gmail",
					"first.gmail@example.test",
					firstPassword,
					"second.gmail@example.test",
				].join("\n"),
			);
			await expect(secondExcerpt).toHaveAttribute(
				"data-source-revealed",
				"false",
			);
			await expect(
				secondExcerpt.locator(".pw-smart-source-text"),
			).not.toContainText(secondPassword);
			await firstExcerpt
				.getByRole("button", { name: t("pwSmartSourceHide"), exact: true })
				.click();
			await openOptional(app.locator(".pw-smart-optional"));
			await app
				.locator("input[id$='-url']")
				.fill("https://optional.example.test/login");
			await app.locator("input[id$='-url']").fill("");
			await app
				.locator("textarea[id$='-notes']")
				.fill("Synthetic App review note");
			await addIdentifiers(app, ["app-mailbox@example.test", "+15550000042"]);
			const unknownExcerpt = importer
				.locator(".pw-smart-issues .pw-smart-source-excerpt")
				.first();
			await openSourceExcerpt(
				importer.locator(".pw-smart-source-group").first(),
				t,
			);
			await expect(unknownExcerpt).toHaveAttribute(
				"data-source-revealed",
				"false",
			);
			await expect(
				unknownExcerpt.locator(".pw-smart-source-text"),
			).not.toContainText(unknown);
			await unknownExcerpt
				.getByRole("button", { name: t("pwSmartSourceShow"), exact: true })
				.click();
			await expect(
				unknownExcerpt.locator(".pw-smart-source-text"),
			).toContainText(unknown);
			expect(await sourceText(unknownExcerpt)).toBe(
				`${unknown}\n${unknownSecret}`,
			);
			await expect(
				importer.locator(".pw-smart-source-excerpt img"),
			).toHaveCount(0);
			expect(
				await page.evaluate(() => document.body.dataset.syntheticXss),
			).toBeUndefined();
			await expect(
				unknownExcerpt.getByRole("button", {
					name: t("pwSmartSourceEdit"),
					exact: true,
				}),
			).toHaveCount(0);
			await first.getByRole("checkbox").check();
			const groups = importer.locator(".pw-smart-source-group");
			await expect(groups).toHaveCount(2);
			await expectSourceGroupSpacing(groups);
			await expect(page.locator(".toast")).toBeHidden({ timeout: 10_000 });
			await groups.first().scrollIntoViewIfNeeded();
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-fragment-gaps-${variant.locale}-${variant.width}.png`,
				),
			});
			await exercisePasswordEye(
				page,
				first.locator("input[id$='-password']"),
				first.locator(".pw-smart-password"),
				firstPassword,
			);
			await exercisePasswordEye(
				page,
				app.locator("textarea[id$='-password']"),
				app.locator(".pw-smart-password"),
				appPassword,
			);
			const firstGroup = groups.nth(0);
			const secondGroup = groups.nth(1);
			await openFragment(firstGroup, t);
			const createForm = firstGroup.locator(".pw-smart-fragment-form");
			await expect(createForm.locator("input[id$='-title']")).toHaveValue("");
			await expect(createForm.locator("input[id$='-username']")).toHaveValue(
				"",
			);
			await expect(createForm.locator("input[id$='-password']")).toHaveValue(
				"",
			);
			await expect(createForm.locator("input[id$='-url']")).toBeHidden();
			await expect(
				createForm.getByRole("button", {
					name: t("pwSmartFragmentApply"),
					exact: true,
				}),
			).toBeDisabled();
			await createForm
				.locator("input[id$='-title']")
				.fill("Manually classified App");
			await createForm
				.locator("input[id$='-username']")
				.fill("manual-player-73");
			await createForm
				.locator("input[id$='-password']")
				.fill(manuallyCreatedPassword);
			await expect(createForm.locator("textarea[id$='-notes']")).toBeVisible();
			await expect(
				createForm.locator(".pw-smart-optional summary"),
			).toHaveCount(0);
			await addIdentifiers(createForm, [
				"manual-alias-73",
				"+15550000073",
				"remove-alias-73",
			]);
			await createForm
				.locator(".pw-smart-identifier-row")
				.nth(2)
				.getByRole("button")
				.click();
			await expectIdentifiers(createForm, ["manual-alias-73", "+15550000073"]);
			await exercisePasswordEye(
				page,
				createForm.locator("input[id$='-password']"),
				createForm.locator(".pw-smart-password"),
				manuallyCreatedPassword,
			);
			await openOptional(createForm.locator(".pw-smart-optional"));
			await createForm
				.locator("input[id$='-url']")
				.fill("https://optional-manual.example.test/login");
			await createForm.locator("input[id$='-url']").fill("");
			await createForm
				.locator("textarea[id$='-notes']")
				.fill("Synthetic manually classified note");
			await createForm
				.getByRole("button", {
					name: t("pwSmartFragmentAddNotes"),
					exact: true,
				})
				.click();
			const createdNotes = await createForm
				.locator("textarea[id$='-notes']")
				.inputValue();
			expect(createdNotes).toContain(`${unknown}\n${unknownSecret}`);
			await createForm.locator("textarea[id$='-notes']").fill(createdNotes);
			await captureFragmentSections(
				page,
				createForm,
				`password-fragment-identifiers-${variant.locale}-${variant.width}`,
			);
			await firstGroup
				.getByRole("button", {
					name: t("pwSmartFragmentCollapse"),
					exact: true,
				})
				.click();
			await expect(createForm.locator("input[id$='-title']")).toBeHidden();
			await openFragment(firstGroup, t);
			await expect(createForm.locator("input[id$='-title']")).toHaveValue(
				"Manually classified App",
			);
			await expect(createForm.locator("input[id$='-password']")).toHaveValue(
				manuallyCreatedPassword,
			);
			await expect(createForm.locator("textarea[id$='-notes']")).toHaveValue(
				createdNotes,
			);
			await expect(
				createForm.getByRole("button", {
					name: t("pwSmartFragmentNotesAdded"),
					exact: true,
				}),
			).toBeDisabled();
			await importAdvanced(importer, t, "pwSmartEditSource");
			await expect(importer.locator("#pw-smart-source")).toHaveValue(
				source.replace(/\r\n|\r/g, "\n"),
			);
			await importer
				.getByRole("button", {
					name: t("pwSmartBackToReview"),
					exact: true,
				})
				.click();
			await expect(createForm.locator("input[id$='-password']")).toHaveValue(
				manuallyCreatedPassword,
			);
			await expect(createForm.locator("textarea[id$='-notes']")).toHaveValue(
				createdNotes,
			);
			await importAdvanced(importer, t, "pwSmartMap");
			await importer
				.getByRole("button", {
					name: t("pwSmartBackToReview"),
					exact: true,
				})
				.click();
			await expect(createForm.locator("input[id$='-title']")).toHaveValue(
				"Manually classified App",
			);
			await expect(createForm.locator("input[id$='-password']")).toHaveValue(
				manuallyCreatedPassword,
			);
			await expect(createForm.locator("textarea[id$='-notes']")).toHaveValue(
				createdNotes,
			);
			await expect(first.getByRole("checkbox")).toBeChecked();
			await expectIdentifiers(createForm, ["manual-alias-73", "+15550000073"]);
			await changeFragmentTarget(createForm, t, "vault-import-1");
			await expect(
				createForm.getByRole("button", {
					name: t("pwSmartFragmentApply"),
					exact: true,
				}),
			).toBeDisabled();
			await addIdentifiers(createForm, ["first-target-alias"]);
			await expect(
				createForm.getByRole("button", {
					name: t("pwSmartFragmentApply"),
					exact: true,
				}),
			).toBeEnabled();
			await createForm
				.locator("textarea[id$='-notes']")
				.fill("Synthetic draft for first target only");
			await changeFragmentTarget(createForm, t, "vault-import-2");
			await expect(createForm.locator("textarea[id$='-notes']")).toHaveValue(
				"",
			);
			await expectIdentifiers(createForm, []);
			await changeFragmentTarget(createForm, t, "vault-import-1");
			await expect(createForm.locator("textarea[id$='-notes']")).toHaveValue(
				"Synthetic draft for first target only",
			);
			await expectIdentifiers(createForm, ["first-target-alias"]);
			await changeFragmentTarget(createForm, t, "new");
			await expectIdentifiers(createForm, ["manual-alias-73", "+15550000073"]);
			await expect(createForm.locator("textarea[id$='-notes']")).toHaveValue(
				createdNotes,
			);
			await openFragment(secondGroup, t);
			const attachForm = secondGroup.locator(".pw-smart-fragment-form");
			await changeFragmentTarget(attachForm, t, "vault-import-4");
			await expect(attachForm.locator("input[id$='-title']")).toHaveValue(
				"App without password",
			);
			await expect(attachForm.locator("input[id$='-username']")).toHaveValue(
				"pending-player-55",
			);
			await expect(
				attachForm.getByRole("button", {
					name: t("pwSmartFragmentApply"),
					exact: true,
				}),
			).toBeDisabled();
			await attachForm
				.locator("input[id$='-password']")
				.fill(completedPassword);
			await attachForm
				.getByRole("button", {
					name: t("pwSmartFragmentAddNotes"),
					exact: true,
				})
				.click();
			const completedNotes = await attachForm
				.locator("textarea[id$='-notes']")
				.inputValue();
			expect(completedNotes).toContain(attachedSource.replace(/\r\n/g, "\n"));
			await attachForm.locator("textarea[id$='-notes']").fill(completedNotes);
			await pending
				.locator("input[id$='-username']")
				.fill("pending-player-corrected-56");
			await expect(attachForm.locator("input[id$='-username']")).toHaveValue(
				"pending-player-corrected-56",
			);
			await expect(createForm.locator("input[id$='-password']")).toHaveValue(
				manuallyCreatedPassword,
			);
			await expect(first.getByRole("checkbox")).toBeChecked();
			expect(await persistedVault(page)).toEqual(original);
			expect(mock.requests).toHaveLength(1);
			await checkLayout(page, importer, variant.width);
			await expectActionSpacing(
				attachForm.locator(".pw-smart-fragment-actions"),
			);
			await expect(page.locator(".toast")).toBeHidden({ timeout: 10_000 });
			await attachForm
				.locator(".pw-smart-fragment-editor")
				.evaluate((element) => {
					element.scrollIntoView({ block: "start", behavior: "instant" });
				});
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-fragment-form-${variant.locale}-${variant.width}-fill.png`,
				),
			});
			await attachForm
				.locator(".pw-smart-fragment-actions")
				.evaluate((element) =>
					element.scrollIntoView({ block: "center", behavior: "instant" }),
				);
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-fragment-form-${variant.locale}-${variant.width}-notes-actions.png`,
				),
			});
			await attachForm
				.getByRole("button", { name: t("pwSmartFragmentApply"), exact: true })
				.click();
			await expect(pending.locator("input[id$='-password']")).toHaveValue(
				completedPassword,
			);
			await expect(pending.getByRole("checkbox")).toBeEnabled();
			await expect(pending.getByRole("checkbox")).toBeChecked();
			await createForm
				.getByRole("button", { name: t("pwSmartFragmentApply"), exact: true })
				.click();
			await expect(rows).toHaveCount(5);
			const created = rows.filter({
				has: page.locator(".pw-smart-row-summary", {
					hasText: "manual-player-73",
				}),
			});
			await openRow(created);
			await expect(created.getByRole("checkbox")).toBeChecked();
			await expect(created.locator("input[id$='-url']")).toBeHidden();
			await expect(created.locator("textarea[id$='-notes']")).toHaveValue(
				createdNotes,
			);
			await created
				.getByRole("button", {
					name: t("pwVaultAddAnotherAccount"),
					exact: true,
				})
				.click();
			await expect(rows).toHaveCount(6);
			const another = rows.last();
			await expect(another.locator(".pw-smart-row-editor")).toHaveAttribute(
				"open",
				"",
			);
			await expect(another.getByRole("checkbox")).toBeDisabled();
			await expect(another.locator("input[id$='-title']")).toHaveValue(
				"Manually classified App",
			);
			await expect(another.locator("input[id$='-username']")).toHaveValue("");
			await expect(another.locator("input[id$='-password']")).toHaveValue("");
			await expectIdentifiers(another, []);
			await expect(another.locator("textarea[id$='-notes']")).toHaveValue("");
			await another
				.locator("input[id$='-username']")
				.fill("manual-small-player-74");
			await another.locator("input[id$='-password']").fill(additionalPassword);
			await expect(another.getByRole("checkbox")).toBeEnabled();
			await expect(another.getByRole("checkbox")).not.toBeChecked();
			await expect(created.locator("input[id$='-username']")).toHaveValue(
				"manual-player-73",
			);
			await expect(created.locator("input[id$='-password']")).toHaveValue(
				manuallyCreatedPassword,
			);
			await expectIdentifiers(created, ["manual-alias-73", "+15550000073"]);
			await expect(created.locator("textarea[id$='-notes']")).toHaveValue(
				createdNotes,
			);
			await expect(importer.locator(".pw-smart-issues")).toHaveCount(0);
			await expect(first.getByRole("checkbox")).toBeChecked();
			expect(await persistedVault(page)).toEqual(original);
			await checkLayout(page, importer, variant.width);
			await pending
				.locator(".pw-smart-source-context")
				.scrollIntoViewIfNeeded();
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-source-context-${variant.locale}-${variant.width}-review.png`,
				),
				fullPage: true,
			});
			for (const row of [first, second, app])
				await row.getByRole("checkbox").check();
			// Explicit completion selects these two; keep them for a separate save.
			await pending.getByRole("checkbox").uncheck();
			await created.getByRole("checkbox").uncheck();
			await expect(pending.getByRole("checkbox")).not.toBeChecked();
			await importer
				.getByRole("button", {
					name: t("pwSmartConfirm", { count: 3 }),
					exact: true,
				})
				.click();
			await expect(importer.locator(".pw-smart-receipt")).toHaveText(
				t("pwSmartSaved", { added: 3, updated: 0, skipped: 0 }),
			);
			await expect(rows).toHaveCount(3);
			await expect(pending.locator(".pw-smart-source-context")).toContainText(
				"pending-player-55",
			);
			await expect(pending.locator("input[id$='-password']")).toHaveValue(
				completedPassword,
			);
			await expect(created.locator("textarea[id$='-notes']")).toHaveValue(
				createdNotes,
			);
			await pending.getByRole("checkbox").check();
			await created.getByRole("checkbox").check();
			await another.getByRole("checkbox").check();
			await importer
				.getByRole("button", {
					name: t("pwSmartConfirm", { count: 3 }),
					exact: true,
				})
				.click();
			await expect(importer.locator(".pw-smart-receipt")).toHaveText(
				t("pwSmartSaved", { added: 3, updated: 0, skipped: 0 }),
			);
			// Both saves add three entries, so receipt text alone may still describe the prior save.
			await expect(rows).toHaveCount(0);
			await closeDialog(page);
			const download = page.waitForEvent("download");
			await page
				.getByRole("button", { name: t("pwVaultExport"), exact: true })
				.click();
			const path = test.info().outputPath("gmail-app-no-website.kdbx");
			await (await download).saveAs(path);
			const exported = await inspectKdbx(path);
			expect(
				exported.map(({ draft }) => ({
					title: draft.title,
					username: draft.username,
					password: draft.password,
					url: draft.url,
					notes: draft.notes,
				})),
			).toEqual(
				expect.arrayContaining([
					{
						title: "Gmail",
						username: "first.gmail@example.test",
						password: firstPassword,
						url: "",
						notes: "",
					},
					{
						title: "Gmail",
						username: "second.gmail@example.test",
						password: secondPassword,
						url: "",
						notes: "",
					},
					{
						title: "Studio App",
						username: "studio-player-42",
						password: appPassword,
						url: "",
						notes: "Synthetic App review note",
					},
					{
						title: "App without password",
						username: "pending-player-corrected-56",
						password: completedPassword,
						url: "",
						notes: completedNotes,
					},
					{
						title: "Manually classified App",
						username: "manual-small-player-74",
						password: additionalPassword,
						url: "",
						notes: "",
					},
					{
						title: "Manually classified App",
						username: "manual-player-73",
						password: manuallyCreatedPassword,
						url: "",
						notes: createdNotes,
					},
				]),
			);
			expect(exported).toHaveLength(6);
			expect(
				exported.find(({ draft }) => draft.username === "manual-player-73")
					?.draft.usernameAliases,
			).toEqual(["manual-alias-73", "+15550000073"]);
			await page.reload();
			await unlock(page, t);
			await entry(page, "Manually classified App")
				.filter({ hasText: "manual-player-73" })
				.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
				.click();
			await expectIdentifiers(page.getByRole("dialog"), [
				"manual-alias-73",
				"+15550000073",
			]);
			await closeDialog(page);
			await entry(page, "Studio App")
				.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
				.click();
			await expect(page.locator("#password-vault-entry-username")).toHaveValue(
				"studio-player-42",
			);
			await expectIdentifiers(page.getByRole("dialog"), [
				"app-mailbox@example.test",
				"+15550000042",
			]);
			await expect(page.locator("#password-vault-entry-url")).toBeHidden();
			await expect(page.locator("#password-vault-entry-notes")).toHaveValue(
				"Synthetic App review note",
			);
			await expect(
				page.locator("textarea#password-vault-entry-password"),
			).toHaveValue("••••••••");
			await page
				.getByRole("dialog")
				.getByRole("button", { name: t("pwVaultShowPassword"), exact: true })
				.click();
			await expect(
				page.locator("textarea#password-vault-entry-password"),
			).toHaveValue(appPassword.replace(/\r\n/g, "\n"));
			await closeDialog(page);
			expect(mock.requests).toHaveLength(1);
			expect(errors).toEqual([]);
			expect(consoleErrors).toEqual([]);
			test.info().annotations.push({
				type: "ui-errors",
				description: JSON.stringify({
					pageErrors: errors.length,
					consoleErrors: consoleErrors.length,
				}),
			});
			test.info().annotations.push({
				type: "ui-kdbx",
				description: JSON.stringify({
					exportedEntries: exported.length,
					aliasesAndDifferentPasswordsMatched: true,
					aiCalls: mock.requests.length,
				}),
			});
		} finally {
			await context.close();
			await mock.close();
		}
	});

	test(`${variant.locale} ${variant.width}px unlabeled password notes and local field mapping save exact reviewed credentials`, async ({
		browser,
	}) => {
		const t = copy(variant.locale);
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
		});
		await context.addInitScript(
			(locale) => localStorage.setItem("keepany-language", locale),
			variant.locale === "zh-CN" ? "zh-CN" : "en",
		);
		const page = await context.newPage();
		const errors: string[] = [];
		const outgoing: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("request", (request) => {
			if (/chat\/completions|responses$/.test(request.url()))
				outgoing.push(request.url());
		});
		const password = "  Synthetic;pass|,with:punctuation!  ";
		const source = `Outlook\ndemo.one@example.test\n${password}\ndemo.two@example.test`;
		try {
			await page.goto("/assets/vault");
			await createVault(page, t);
			const before = await persistedVault(page);
			let importer = await openImport(page, t, source);
			await expect(importer.locator(".pw-smart-row")).toHaveCount(1);
			await expect(
				importer.locator("#pw-smart-vault-import-1-password"),
			).toHaveValue(password);
			await expect(
				importer.getByText(t("pwSmartInferredHint"), { exact: true }),
			).toBeVisible();
			await expect(
				importer.locator(".pw-smart-row input[type=checkbox]"),
			).not.toBeChecked();
			await expect(
				importer.getByRole("button", {
					name: t("pwSmartConfirm", { count: 0 }),
					exact: true,
				}),
			).toBeDisabled();
			await expect(importer.locator(".pw-smart-issues")).toContainText(
				t("pwSmartIssue_unrecognized-line"),
			);
			expect(await persistedVault(page)).toEqual(before);
			await closeDialog(page);
			importer = await openImport(page, t);
			await importer.locator("#pw-smart-source").fill(source);
			await importAdvanced(importer, t, "pwSmartMap");
			await expect(importer.locator(".pw-smart-map-line")).toHaveCount(4);
			await expect(importer.locator("#pw-map-value-3")).toHaveAttribute(
				"type",
				"password",
			);
			await selectChoice(importer.locator("#pw-map-field-1"), "title");
			await selectChoice(importer.locator("#pw-map-field-2"), "username");
			await selectChoice(importer.locator("#pw-map-field-3"), "password");
			await selectChoice(importer.locator("#pw-map-field-4"), "notes");
			await checkLayout(page, importer, variant.width);
			await page.locator(".dialog").evaluate((element) => {
				element.scrollTop = 0;
			});
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-notes-${variant.locale}-${variant.width}-mapping.png`,
				),
				fullPage: true,
			});
			await reviewMapping(importer, t);
			await expect(importer.locator(".pw-smart-issues")).toHaveCount(0);
			await expect(importer.locator(".pw-smart-row")).toHaveCount(1);
			const mapped = importer.locator(".pw-smart-row").first();
			await openRow(mapped);
			await expect(mapped.locator("textarea[id$='-notes']")).toHaveValue(
				"demo.two@example.test",
			);
			await expect(mapped.getByRole("checkbox")).toBeChecked();
			await mapped.getByRole("checkbox").check();
			expect(await persistedVault(page)).toEqual(before);
			await importer
				.getByRole("button", {
					name: t("pwSmartConfirm", { count: 1 }),
					exact: true,
				})
				.click();
			await expect(importer.locator(".pw-smart-receipt")).toHaveText(
				t("pwSmartSaved", { added: 1, updated: 0, skipped: 0 }),
			);
			await closeDialog(page);
			await page.reload();
			await unlock(page, t);
			expect(await readEntry(page, t, "Outlook")).toEqual({
				password,
				username: "demo.one@example.test",
				url: "",
				notes: "demo.two@example.test",
			});
			// A non-email account can be assigned locally when automatic recognition cannot decide.
			const generic = "Generic service\nplain-user\nSynthetic second password";
			await openImport(page, t, generic);
			await expect(importer.locator(".pw-smart-row")).toHaveCount(0);
			await importAdvanced(importer, t, "pwSmartMap");
			for (const [line, field] of [
				[1, "title"],
				[2, "username"],
				[3, "password"],
			] as const)
				await selectChoice(importer.locator(`#pw-map-field-${line}`), field);
			await reviewMapping(importer, t);
			await expect(importer.locator(".pw-smart-row")).toHaveCount(1);
			await importer.locator(".pw-smart-row").getByRole("checkbox").check();
			await checkLayout(page, importer, variant.width);
			await page.locator(".dialog").evaluate((element) => {
				element.scrollTop = 0;
			});
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-notes-${variant.locale}-${variant.width}-review.png`,
				),
				fullPage: true,
			});
			await importer
				.getByRole("button", {
					name: t("pwSmartConfirm", { count: 1 }),
					exact: true,
				})
				.click();
			await expect(importer.locator(".pw-smart-receipt")).toBeVisible();
			await closeDialog(page);
			await page.reload();
			await unlock(page, t);
			expect((await readEntry(page, t, "Generic service")).username).toBe(
				"plain-user",
			);
			await openImport(page, t);
			await expect(importer.locator("#pw-smart-source")).toHaveValue("");
			await expect(importer.locator(".pw-smart-map-line")).toHaveCount(0);
			await closeDialog(page);
			expect(outgoing).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});

	test(`${variant.locale} ${variant.width}px smart password import reviews locally, sends domains only and saves a recoverable KDBX`, async ({
		browser,
	}) => {
		const t = copy(variant.locale);
		const mock = await aiServer();
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
			acceptDownloads: true,
		});
		await context.addInitScript(
			(locale) => localStorage.setItem("keepany-language", locale),
			variant.locale === "zh-CN" ? "zh-CN" : "en",
		);
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		try {
			await configureAndOpenVault(
				page,
				variant.locale,
				mock.baseURL,
				variant.width,
			);
			await createVault(page, t);
			await seedDuplicate(page, t);
			const original = await persistedVault(page);
			const importer = await openImport(page, t);
			await importer.locator("#pw-smart-source").fill(pastedSource);
			await checkLayout(page, importer, variant.width);
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-smart-${variant.locale}-${variant.width}-source.png`,
				),
				fullPage: true,
			});
			await importer
				.getByRole("button", { name: t("pwSmartRecognize"), exact: true })
				.click();
			const rows = importer.locator(".pw-smart-row");
			await expect(rows).toHaveCount(3);
			await expect(rows.nth(0)).toContainText(t("pwSmartStatus_new"));
			await expect(rows.nth(1)).toContainText(t("pwSmartStatus_new"));
			await expect(rows.nth(2)).toContainText(t("pwSmartStatus_duplicate"));
			await expect(rows.nth(2).getByRole("checkbox")).toBeDisabled();
			await expect(importer.locator(".pw-smart-issues")).toContainText(
				t("pwSmartIssues"),
			);
			await expect(importer.locator(".pw-smart-issues")).toContainText(
				t("pwSmartIssue_missing-password"),
			);
			await expect(rows.locator("input[id$='-password']")).toHaveCount(3);
			for (const field of await rows.locator("input[id$='-password']").all())
				await expect(field).toHaveAttribute("type", "password");
			await expect(
				importer.locator("#pw-smart-vault-import-1-password"),
			).toHaveValue(githubPassword);
			expect(await persistedVault(page)).toEqual(original);
			expect(mock.requests).toHaveLength(0);
			mock.responses.push(
				JSON.stringify({
					records: [
						{ id: "vault-import-1", title: "GitHub" },
						{ id: "vault-import-2", title: "GitLab" },
						{ id: "vault-import-3", title: "Duplicate" },
					],
				}),
			);
			await importer
				.getByRole("button", {
					name: t("pwSmartAiOrganize", { model }),
					exact: true,
				})
				.click();
			await expect(
				importer.getByRole("status").filter({ hasText: t("pwSmartAiDone") }),
			).toBeVisible();
			expect(mock.requests).toHaveLength(1);
			expect(mock.requests[0].body.model).toBe(model);
			const prompt = mock.requests[0].body.messages.filter(
				(message) => message.role === "user",
			);
			expect(prompt).toHaveLength(1);
			expect(JSON.parse(prompt[0].content)).toEqual({
				records: [
					{ id: "vault-import-1", host: "github.com" },
					{ id: "vault-import-2", host: "gitlab.com" },
					{ id: "vault-import-3", host: "duplicate.example" },
				],
			});
			const sent = JSON.stringify(mock.requests[0].body);
			for (const secret of [
				githubPassword,
				gitlabPassword,
				duplicatePassword,
				githubUsername,
				"synthetic-gitlab-user@example.test",
				"synthetic-existing-user",
				note,
				"synthetic-source-title",
				"synthetic-url-secret",
				"private-anchor",
				"/login",
				"/users/sign_in",
				"unlabeled-synthetic-secret",
			])
				expect(sent).not.toContain(secret);
			expect(await persistedVault(page)).toEqual(original);
			await expect(
				importer.locator("#pw-smart-vault-import-1-title"),
			).toHaveValue("GitHub");
			await importer
				.locator("#pw-smart-vault-import-1-title")
				.fill(verifiedTitle);
			await expect(rows.nth(0).getByRole("checkbox")).not.toBeChecked();
			await importer
				.getByRole("checkbox", { name: t("pwSmartSelectNew"), exact: true })
				.check();
			await expect(
				importer.getByRole("button", {
					name: t("pwSmartConfirm", { count: 2 }),
					exact: true,
				}),
			).toBeEnabled();
			await checkLayout(page, importer, variant.width);
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-smart-${variant.locale}-${variant.width}-review.png`,
				),
				fullPage: true,
			});
			await importer
				.getByRole("button", {
					name: t("pwSmartConfirm", { count: 2 }),
					exact: true,
				})
				.click();
			await expect(importer.locator(".pw-smart-receipt")).toHaveText(
				t("pwSmartSaved", { added: 2, updated: 0, skipped: 0 }),
			);
			await expect(rows.locator("input[id$='-password']")).toHaveCount(1);
			await importAdvanced(importer, t, "pwSmartEditSource");
			await expect(importer.locator("#pw-smart-source")).toHaveValue(
				pastedSource,
			);
			await closeDialog(page);
			await expect(
				page.locator(".password-vault-entry-list .password-vault-entry"),
			).toHaveCount(3);
			expect((await persistedVault(page)).revision).not.toBe(original.revision);
			expect(await readEntry(page, t, verifiedTitle)).toEqual({
				password: githubPassword,
				username: githubUsername,
				url: githubUrl,
				notes: note,
			});
			expect((await readEntry(page, t, "GitLab")).password).toBe(
				gitlabPassword,
			);
			await page.reload();
			await unlock(page, t);
			expect((await readEntry(page, t, verifiedTitle)).password).toBe(
				githubPassword,
			);

			const retryOriginal = await persistedVault(page);
			await openImport(page, t, pastedSource);
			await expect(rows).toHaveCount(3);
			await expect(
				rows
					.locator(".pw-smart-status")
					.filter({ hasText: t("pwSmartStatus_duplicate") }),
			).toHaveCount(3);
			await expect(
				importer.getByRole("button", {
					name: t("pwSmartConfirm", { count: 0 }),
					exact: true,
				}),
			).toBeDisabled();
			expect(await persistedVault(page)).toEqual(retryOriginal);
			await closeDialog(page);

			await openImport(
				page,
				t,
				sourceBlock(
					githubUrl,
					githubUsername,
					changedPassword,
					verifiedTitle,
					note,
				),
			);
			await expect(rows.nth(0)).toContainText(t("pwSmartStatus_conflict"));
			await expect(
				importer.locator("#pw-smart-vault-import-1-action"),
			).toHaveAttribute("data-value", "skip");
			await expect(rows.nth(0).getByRole("checkbox")).not.toBeChecked();
			await expect(
				importer.getByRole("button", {
					name: t("pwSmartConfirm", { count: 0 }),
					exact: true,
				}),
			).toBeDisabled();
			expect(await persistedVault(page)).toEqual(retryOriginal);
			await selectChoice(importer.locator("#pw-smart-vault-import-1-action"), {
				label: t("pwSmartUpdateExisting", { name: verifiedTitle }),
			});
			await importer
				.getByRole("button", {
					name: t("pwSmartConfirm", { count: 1 }),
					exact: true,
				})
				.click();
			await expect(importer.locator(".pw-smart-receipt")).toHaveText(
				t("pwSmartSaved", { added: 0, updated: 1, skipped: 0 }),
			);
			await closeDialog(page);
			expect((await readEntry(page, t, verifiedTitle)).password).toBe(
				changedPassword,
			);
			await entry(page, verifiedTitle)
				.getByRole("button", { name: t("pwVaultHistory"), exact: true })
				.click();
			await expect(page.locator(".password-vault-history-row")).toHaveCount(1);
			await page
				.getByRole("button", { name: t("pwVaultRevealPassword"), exact: true })
				.click();
			await expect(page.locator(".password-vault-history-row code")).toHaveText(
				githubPassword,
			);
			await closeDialog(page);

			const downloading = page.waitForEvent("download");
			await page
				.getByRole("button", { name: t("pwVaultExport"), exact: true })
				.click();
			const download = await downloading;
			const path = test.info().outputPath("smart-import-passwords.kdbx");
			await download.saveAs(path);
			for (const secret of [
				master,
				githubPassword,
				changedPassword,
				gitlabPassword,
				note,
			])
				expect(readFileSync(path).includes(Buffer.from(secret))).toBe(false);
			const decrypted = await inspectKdbx(path);
			expect(decrypted).toHaveLength(3);
			const github = decrypted.find(
				({ draft }) => draft.title === verifiedTitle,
			);
			expect(github?.draft).toMatchObject({
				password: changedPassword,
				username: githubUsername,
				url: githubUrl,
				notes: note,
			});
			expect(github?.history[0].draft.password).toBe(githubPassword);
			const restored = await browser.newContext({
				locale: variant.locale,
				viewport: { width: variant.width, height: 844 },
			});
			try {
				await restored.addInitScript(
					(locale) => localStorage.setItem("keepany-language", locale),
					variant.locale === "zh-CN" ? "zh-CN" : "en",
				);
				const restorePage = await restored.newPage();
				await restorePage.goto("/assets/vault");
				await restorePage
					.getByRole("button", { name: t("pwVaultImportEmpty"), exact: true })
					.click();
				await restorePage
					.locator("#password-vault-import-file")
					.setInputFiles(path);
				await restorePage
					.locator("#password-vault-import-password")
					.fill(master);
				await restorePage
					.getByRole("button", { name: t("pwVaultImportNow"), exact: true })
					.click();
				await expect(restorePage.getByRole("dialog")).toBeHidden();
				await expect(
					restorePage.locator(
						".password-vault-entry-list .password-vault-entry",
					),
				).toHaveCount(3);
				expect((await readEntry(restorePage, t, verifiedTitle)).password).toBe(
					changedPassword,
				);
				await restorePage.reload();
				await unlock(restorePage, t);
				expect((await readEntry(restorePage, t, "GitLab")).password).toBe(
					gitlabPassword,
				);
				await checkLayout(
					restorePage,
					restorePage.locator(".password-vault-panel"),
					variant.width,
				);
				await restorePage.screenshot({
					path: join(
						evidenceRoot,
						`password-smart-${variant.locale}-${variant.width}-restored.png`,
					),
					fullPage: true,
				});
			} finally {
				await restored.close();
			}
			expect(errors).toEqual([]);
		} finally {
			await context.close();
			await mock.close();
		}
	});
}

test("smart import discards sensitive state on close and lock, keeps failed AI candidates, and rejects stale or delayed work", async ({
	browser,
}) => {
	const t = copy("en-US");
	const mock = await aiServer();
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 1280, height: 844 },
	});
	await context.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	const page = await context.newPage();
	try {
		await configureAndOpenVault(page, "en-US", mock.baseURL, 1280);
		await createVault(page, t);
		const original = await persistedVault(page);
		const source = sourceBlock(
			githubUrl,
			githubUsername,
			githubPassword,
			verifiedTitle,
			note,
		);
		const importer = await openImport(page, t, source);
		mock.responses.push("malformed synthetic model output");
		await importer
			.getByRole("button", {
				name: t("pwSmartAiOrganize", { model }),
				exact: true,
			})
			.click();
		await expect(
			importer.getByRole("status").filter({ hasText: t("pwSmartAiFailed") }),
		).toBeVisible();
		await expect(
			importer.locator("#pw-smart-vault-import-1-password"),
		).toHaveValue(githubPassword);
		await expect(
			importer.locator("#pw-smart-vault-import-1-title"),
		).toHaveValue(verifiedTitle);
		expect(await persistedVault(page)).toEqual(original);
		await closeDialog(page);
		await expect(
			page.locator("#pw-smart-source, #pw-smart-vault-import-1-password"),
		).toHaveCount(0);
		await openImport(page, t, source);
		await importer
			.getByRole("button", { name: t("pwVaultShowPassword"), exact: true })
			.click();
		await expect(
			importer.locator("#pw-smart-vault-import-1-password"),
		).toHaveAttribute("type", "text");
		await importer
			.getByRole("button", { name: t("pwSmartLockClose"), exact: true })
			.click();
		await expect(page.getByRole("dialog")).toBeHidden();
		await expect(
			page.locator("#pw-smart-source, #pw-smart-vault-import-1-password"),
		).toHaveCount(0);
		await unlock(page, t);
		await openImport(page, t, source);
		// Two immediate events exercise the synchronous in-flight guard before React rerenders.
		await importer
			.getByRole("button", {
				name: t("pwSmartConfirm", { count: 1 }),
				exact: true,
			})
			.evaluate((button: HTMLButtonElement) => {
				button.click();
				button.click();
			});
		await expect(importer.locator(".pw-smart-receipt")).toHaveText(
			t("pwSmartSaved", { added: 1, updated: 0, skipped: 0 }),
		);
		await closeDialog(page);
		await expect(
			page.locator(".password-vault-entry-list .password-vault-entry"),
		).toHaveCount(1);
		const second = await context.newPage();
		await second.goto("/assets/vault");
		await unlock(second, t);
		const pendingSource = sourceBlock(
			"https://gitlab.com/users/sign_in",
			"synthetic-pending-user",
			gitlabPassword,
		);
		await openImport(page, t, pendingSource);
		await entry(second, verifiedTitle)
			.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
			.click();
		await second
			.locator("#password-vault-entry-password")
			.fill(changedPassword);
		await second
			.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
			.click();
		await expect(second.getByRole("dialog")).toBeHidden();
		await expect(page.getByRole("dialog")).toBeHidden();
		await expect(page.locator("#pw-smart-vault-import-1-password")).toHaveCount(
			0,
		);
		await unlock(page, t);
		expect((await readEntry(page, t, verifiedTitle)).password).toBe(
			changedPassword,
		);
		await second.close();
		const beforeDelayed = await persistedVault(page);
		await openImport(page, t, pendingSource);
		let release!: () => void;
		let arrived!: () => void;
		let handled!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const received = new Promise<void>((resolve) => {
			arrived = resolve;
		});
		const completed = new Promise<void>((resolve) => {
			handled = resolve;
		});
		const endpoint = `${mock.baseURL}/chat/completions`;
		await page.route(endpoint, async (route) => {
			arrived();
			await gate;
			await route
				.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						id: "chatcmpl-delayed-synthetic",
						object: "chat.completion",
						created: 1790899200,
						model,
						choices: [
							{
								index: 0,
								message: {
									role: "assistant",
									content: JSON.stringify({
										records: [{ id: "vault-import-1", title: "GitLab" }],
									}),
								},
								finish_reason: "stop",
							},
						],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					}),
				})
				.catch(() => undefined); // Closing the dialog aborts this request intentionally.
			handled();
		});
		await importer
			.getByRole("button", {
				name: t("pwSmartAiOrganize", { model }),
				exact: true,
			})
			.click();
		await received;
		await closeDialog(page);
		release();
		await completed;
		await page.unroute(endpoint);
		await openImport(page, t);
		await expect(importer.locator(".pw-smart-row")).toHaveCount(0);
		expect(await persistedVault(page)).toEqual(beforeDelayed);
		const persistedText = await page.evaluate(() =>
			JSON.stringify({
				local: { ...localStorage },
				session: { ...sessionStorage },
			}),
		);
		for (const secret of [
			githubPassword,
			changedPassword,
			gitlabPassword,
			githubUsername,
			note,
			"synthetic-pending-user",
		])
			expect(persistedText).not.toContain(secret);
		await closeDialog(page);
		await expect(
			page.locator(".password-vault-entry-list .password-vault-entry"),
		).toHaveCount(1);
	} finally {
		await context.close();
		await mock.close();
	}
});

test("smart import preserves multiline secrets and clears conflict choices when identities or selections change", async ({
	browser,
}) => {
	const t = copy("en-US");
	const multilinePassword = "Synthetic first line\n  synthetic second line\t ";
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 390, height: 844 },
		acceptDownloads: true,
	});
	await context.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	const page = await context.newPage();
	try {
		await page.goto("/assets/vault");
		await createVault(page, t);
		await seedDuplicate(page, t);
		const importer = await openImport(
			page,
			t,
			[
				sourceBlock(
					"https://duplicate.example/login",
					"synthetic-existing-user",
					changedPassword,
					"Existing login",
				),
				sourceBlock(
					"https://multiline.example/login",
					"synthetic-multiline-user",
					multilinePassword,
					"Multiline login",
				),
			].join("\n\n"),
		);
		const rows = importer.locator(".pw-smart-row");
		await expect(rows).toHaveCount(2);
		await expect(rows.nth(0)).toContainText(t("pwSmartStatus_conflict"));
		await selectChoice(importer.locator("#pw-smart-vault-import-1-action"), {
			label: t("pwSmartUpdateExisting", { name: "Existing login" }),
		});
		await rows.nth(0).getByRole("checkbox").uncheck();
		await openRow(rows.nth(1));
		const multiline = importer.locator(
			"textarea#pw-smart-vault-import-2-password",
		);
		await expect(multiline).toHaveValue("••••••••");
		await expect(multiline).toHaveAttribute("readonly", "");
		await rows
			.nth(1)
			.getByRole("button", { name: t("pwVaultShowPassword"), exact: true })
			.click();
		await expect(multiline).toHaveValue(multilinePassword);
		await rows
			.nth(1)
			.getByRole("button", { name: t("pwVaultHidePassword"), exact: true })
			.click();
		await expect(multiline).toHaveValue("••••••••");
		await checkLayout(page, importer, 390);
		await importer
			.getByRole("button", {
				name: t("pwSmartConfirm", { count: 1 }),
				exact: true,
			})
			.click();
		await expect(importer.locator(".pw-smart-receipt")).toHaveText(
			t("pwSmartSaved", { added: 1, updated: 0, skipped: 0 }),
		);
		await closeDialog(page);
		expect((await readEntry(page, t, "Existing login")).password).toBe(
			duplicatePassword,
		);
		await entry(page, "Multiline login")
			.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
			.click();
		const savedMultiline = page.locator(
			"textarea#password-vault-entry-password",
		);
		await expect(savedMultiline).toHaveValue("••••••••");
		await expect(savedMultiline).toHaveAttribute("readonly", "");
		await page
			.getByRole("dialog")
			.getByRole("button", { name: t("pwVaultShowPassword"), exact: true })
			.click();
		await expect(savedMultiline).toHaveValue(multilinePassword);
		await page
			.getByRole("dialog")
			.getByRole("button", { name: t("pwVaultHidePassword"), exact: true })
			.click();
		await expect(savedMultiline).toHaveValue("••••••••");
		await page
			.locator("#password-vault-entry-title")
			.fill("Multiline login edited");
		await page
			.locator("#password-vault-entry-notes")
			.fill("Synthetic note edited with multiline password hidden");
		await page
			.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
			.click();
		await expect(page.getByRole("dialog")).toBeHidden();
		await entry(page, "Existing login")
			.getByRole("button", { name: t("pwVaultHistory"), exact: true })
			.click();
		await expect(page.locator(".password-vault-history-row")).toHaveCount(0);
		await closeDialog(page);
		await openImport(
			page,
			t,
			[
				sourceBlock(
					"https://first.example/login",
					"synthetic-first-user",
					githubPassword,
					"First new login",
				),
				sourceBlock(
					"https://second.example/login",
					"synthetic-second-user",
					gitlabPassword,
					"Second new login",
				),
			].join("\n\n"),
		);
		await expect(rows.nth(1).getByRole("checkbox")).toBeChecked();
		await importer
			.locator("#pw-smart-vault-import-1-url")
			.fill("https://second.example/login");
		await importer
			.locator("#pw-smart-vault-import-1-username")
			.fill("synthetic-second-user");
		await expect(rows.nth(1)).toContainText(t("pwSmartStatus_conflict"));
		await expect(rows.nth(1).getByRole("checkbox")).not.toBeChecked();
		await expect(
			importer.locator("#pw-smart-vault-import-2-action"),
		).toHaveAttribute("data-value", "skip");
		await importer
			.getByRole("checkbox", { name: t("pwSmartSelectNew"), exact: true })
			.check();
		await expect(rows.nth(1).getByRole("checkbox")).not.toBeChecked();
		await importer
			.getByRole("button", {
				name: t("pwSmartConfirm", { count: 1 }),
				exact: true,
			})
			.click();
		await expect(importer.locator(".pw-smart-receipt")).toHaveText(
			t("pwSmartSaved", { added: 1, updated: 0, skipped: 0 }),
		);
		await closeDialog(page);
		await expect(
			page.locator(".password-vault-entry-list .password-vault-entry"),
		).toHaveCount(3);
		expect((await readEntry(page, t, "First new login")).password).toBe(
			githubPassword,
		);
		const downloading = page.waitForEvent("download");
		await page
			.getByRole("button", { name: t("pwVaultExport"), exact: true })
			.click();
		const download = await downloading;
		const path = test.info().outputPath("multiline-smart-import.kdbx");
		await download.saveAs(path);
		const inspected = await inspectKdbx(path);
		const saved = inspected.find(
			({ draft }) => draft.title === "Multiline login edited",
		);
		expect(saved?.draft.password).toBe(multilinePassword);
		expect(saved?.draft.notes).toBe(
			"Synthetic note edited with multiline password hidden",
		);
		expect(saved?.history[0].draft.password).toBe(multilinePassword);
	} finally {
		await context.close();
	}
});

test("smart import FilePicker rejects invalid UTF-8 and preserves Chrome CSV credentials through save and reload", async ({
	browser,
}) => {
	const t = copy("en-US");
	const csvPassword = '  Synthetic CSV password;,"quoted"|\t  ';
	const csvUsername = "synthetic-csv-user@example.test";
	const csvUrl = "https://csv.example/login?synthetic=query-value";
	const csvNote = 'Synthetic CSV note, with "quotes" and separator;';
	const csvField = (value: string) => `"${value.replace(/"/g, '""')}"`;
	const csv = [
		"name,url,username,password,note",
		["Chrome imported login", csvUrl, csvUsername, csvPassword, csvNote]
			.map(csvField)
			.join(","),
	].join("\n");
	const tsvPassword = "  Synthetic TSV password;| keep spaces  ";
	const tsv = [
		"title\turl\tusername\tpassword",
		[
			"TSV reviewed login",
			"https://tsv.example/login",
			"synthetic-tsv-user",
			tsvPassword,
		]
			.map(csvField)
			.join("\t"),
	].join("\n");
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 390, height: 844 },
	});
	await context.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	const page = await context.newPage();
	try {
		await page.goto("/assets/vault");
		await createVault(page, t);
		const original = await persistedVault(page);
		const importer = await openImport(page, t);
		const picker = importer.locator("#pw-smart-file");
		await picker.setInputFiles({
			name: "invalid-utf8.txt",
			mimeType: "text/plain",
			buffer: Buffer.concat([
				Buffer.from("Title=Synthetic invalid input\nPassword="),
				Buffer.from([0xc3, 0x28]),
			]),
		});
		await expect(importer.getByRole("status")).toContainText(
			t("pwSmartFailed"),
		);
		await expect(importer.locator("#pw-smart-source")).toHaveValue("");
		await expect(
			importer.getByRole("button", {
				name: t("pwSmartRecognize"),
				exact: true,
			}),
		).toBeDisabled();
		expect(await persistedVault(page)).toEqual(original);
		await picker.setInputFiles([]);
		await expect(importer.locator("#pw-smart-file-value")).toHaveText(
			t("pwSmartNoFile"),
		);
		const choosingCsv = page.waitForEvent("filechooser");
		await importer
			.getByRole("button", { name: t("pwSmartChooseFile"), exact: true })
			.click();
		await (await choosingCsv).setFiles({
			name: "chrome-passwords.csv",
			mimeType: "text/csv",
			buffer: Buffer.from(csv, "utf8"),
		});
		await expect(importer.locator("#pw-smart-file-value")).toHaveText(
			"chrome-passwords.csv",
		);
		await expect(importer.locator("#pw-smart-source")).toHaveValue(csv);
		await importer
			.getByRole("button", { name: t("pwSmartRecognize"), exact: true })
			.click();
		await expect(importer.locator(".pw-smart-row")).toHaveCount(1);
		await expect(importer.locator(".pw-smart-issues")).toHaveCount(0);
		const reviewedPassword = importer.locator(
			"#pw-smart-vault-import-1-password",
		);
		await expect(reviewedPassword).toHaveAttribute("type", "password");
		await expect(reviewedPassword).toHaveValue(csvPassword);
		await expect(
			importer.locator("#pw-smart-vault-import-1-username"),
		).toHaveValue(csvUsername);
		await expect(
			importer.locator("#pw-smart-vault-import-1-notes"),
		).toHaveValue(csvNote);
		expect(await persistedVault(page)).toEqual(original);
		await checkLayout(page, importer, 390);
		await page.screenshot({
			path: join(evidenceRoot, "password-smart-file-csv-en-US-390-review.png"),
			fullPage: true,
		});
		await importer
			.getByRole("button", {
				name: t("pwSmartConfirm", { count: 1 }),
				exact: true,
			})
			.click();
		await expect(importer.locator(".pw-smart-receipt")).toHaveText(
			t("pwSmartSaved", { added: 1, updated: 0, skipped: 0 }),
		);
		await closeDialog(page);
		await page.reload();
		await unlock(page, t);
		expect(await readEntry(page, t, "Chrome imported login")).toEqual({
			password: csvPassword,
			username: csvUsername,
			url: csvUrl,
			notes: csvNote,
		});
		const saved = await persistedVault(page);
		await openImport(page, t);
		const choosingTsv = page.waitForEvent("filechooser");
		await importer
			.getByRole("button", { name: t("pwSmartChooseFile"), exact: true })
			.click();
		await (await choosingTsv).setFiles({
			name: "synthetic-passwords.tsv",
			mimeType: "text/tab-separated-values",
			buffer: Buffer.from(tsv, "utf8"),
		});
		await expect(importer.locator("#pw-smart-source")).toHaveValue(tsv);
		await importer
			.getByRole("button", { name: t("pwSmartRecognize"), exact: true })
			.click();
		await expect(importer.locator(".pw-smart-row")).toHaveCount(1);
		await expect(importer.locator(".pw-smart-issues")).toHaveCount(0);
		await expect(
			importer.locator("#pw-smart-vault-import-1-password"),
		).toHaveValue(tsvPassword);
		expect(await persistedVault(page)).toEqual(saved);
		await closeDialog(page);
		await openImport(page, t);
		await expect(importer.locator("#pw-smart-file-value")).toHaveText(
			t("pwSmartNoFile"),
		);
		await expect(importer.locator(".pw-smart-row")).toHaveCount(0);
		expect(await persistedVault(page)).toEqual(saved);
		await closeDialog(page);
		await expect(
			page.locator(".password-vault-entry-list .password-vault-entry"),
		).toHaveCount(1);
	} finally {
		await context.close();
	}
});

for (const variant of variants) {
	test(`AI recognizes pasted password notes without sending the existing vault ${variant.locale} ${variant.width}`, async ({
		browser,
	}) => {
		const t = copy(variant.locale);
		const mock = await aiServer();
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
		});
		await context.addInitScript(
			(locale) => localStorage.setItem("keepany-language", locale),
			variant.locale === "zh-CN" ? "zh-CN" : "en",
		);
		const page = await context.newPage();
		const password = '  Synthetic notes ;|,\\" P4ss!\t  ';
		const secondPassword = "Synthetic second notes secret!";
		const source = [
			"Outlook notes",
			"demo.notes.one@example.test",
			password,
			"demo.unassigned@example.test",
			"Second service",
			"demo.notes.two@example.test",
			secondPassword,
			"Synthetic note with instructions: keep the original values",
		].join("\n");
		try {
			await configureAndOpenVault(
				page,
				variant.locale,
				mock.baseURL,
				variant.width,
				variant.locale === "zh-CN" && variant.width === 390,
			);
			await createVault(page, t);
			await seedDuplicate(page, t);
			const before = await persistedVault(page);
			const importer = await openImport(page, t);
			await importer.locator("#pw-smart-source").fill(source);
			expect(mock.requests).toHaveLength(0);
			await expect(importer.locator(".pw-smart-ai-recognition")).toContainText(
				mock.baseURL,
			);
			await checkLayout(page, importer, variant.width);
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-ai-input-${variant.locale}-${variant.width}.png`,
				),
				fullPage: true,
			});
			mock.responses.push(
				JSON.stringify({
					records: [
						{
							title: { line: 1 },
							username: { line: 2 },
							password: { line: 3 },
							url: null,
							notes: null,
						},
						{
							title: { line: 5 },
							username: { line: 6 },
							password: { line: 7 },
							url: null,
							notes: { line: 8 },
						},
					],
					ignoredLines: [4],
				}),
			);
			await importer
				.getByRole("button", {
					name: t("pwSmartAiRecognize", { model }),
					exact: true,
				})
				.click();
			await expect(importer.locator(".pw-smart-row")).toHaveCount(2);
			await expect(
				importer.locator("#pw-smart-vault-import-1-password"),
			).toHaveValue(password);
			await expect(
				importer.locator("#pw-smart-vault-import-1-password"),
			).toHaveAttribute("type", "password");
			await expect(importer.locator(".pw-smart-issues")).toContainText(
				t("pwSmartIssue_unrecognized-line"),
			);
			await expect(
				importer.getByRole("button", {
					name: t("pwSmartConfirm", { count: 0 }),
					exact: true,
				}),
			).toBeDisabled();
			expect(await persistedVault(page)).toEqual(before);
			expect(mock.requests).toHaveLength(1);
			const sent = JSON.stringify(mock.requests[0].body);
			expect(sent).toContain("demo.notes.one@example.test");
			expect(sent).toContain("demo.unassigned@example.test");
			expect(sent).not.toContain(duplicatePassword);
			expect(sent).not.toContain(master);
			expect(sent).not.toContain("synthetic-existing-user");
			expect(sent).not.toContain(syntheticKey);
			const persistedText = await page.evaluate(() =>
				JSON.stringify({
					local: { ...localStorage },
					session: { ...sessionStorage },
				}),
			);
			expect(persistedText).not.toContain("demo.notes.one@example.test");
			expect(persistedText).not.toContain(secondPassword);
			await checkLayout(page, importer, variant.width);
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-ai-review-${variant.locale}-${variant.width}.png`,
				),
				fullPage: true,
			});
			await importer
				.getByRole("checkbox", { name: t("pwSmartSelectNew"), exact: true })
				.check();
			await importer
				.getByRole("button", {
					name: t("pwSmartConfirm", { count: 2 }),
					exact: true,
				})
				.click();
			await expect(importer.locator(".pw-smart-receipt")).toHaveText(
				t("pwSmartSaved", { added: 2, updated: 0, skipped: 0 }),
			);
			await closeDialog(page);
			await page.reload();
			await unlock(page, t);
			await expect(
				page.locator(".password-vault-entry-list .password-vault-entry"),
			).toHaveCount(3);
			expect((await readEntry(page, t, "Outlook notes")).password).toBe(
				password,
			);
			expect((await readEntry(page, t, "Second service")).password).toBe(
				secondPassword,
			);
		} finally {
			await context.close();
			await mock.close();
		}
	});
}

test("AI note recognition keeps failed source and discards delayed results after close or model change", async ({
	browser,
}) => {
	const t = copy("en-US");
	const mock = await aiServer();
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 1280, height: 844 },
	});
	await context.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	const page = await context.newPage();
	const source =
		"Synthetic service\ndemo.ai.failure@example.test\nSynthetic failure secret!";
	try {
		await configureAndOpenVault(page, "en-US", mock.baseURL, 1280);
		await createVault(page, t);
		const original = await persistedVault(page);
		let importer = await openImport(page, t);
		await importer.locator("#pw-smart-source").fill(source);
		mock.responses.push("broken JSON with synthetic-only secret");
		await importer
			.getByRole("button", {
				name: t("pwSmartAiRecognize", { model }),
				exact: true,
			})
			.click();
		await expect(
			importer
				.getByRole("status")
				.filter({ hasText: t("pwSmartAiResponseFormat") }),
		).toBeVisible();
		await expect(importer.locator("#pw-smart-source")).toHaveValue(source);
		expect(await persistedVault(page)).toEqual(original);
		await expect(importer).not.toContainText("broken JSON");
		const endpoint = `${mock.baseURL}/chat/completions`;
		let release!: () => void;
		let arrived!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const received = new Promise<void>((resolve) => {
			arrived = resolve;
		});
		await page.route(endpoint, async (route) => {
			arrived();
			await gate;
			await route.abort().catch(() => undefined);
		});
		await importer
			.getByRole("button", {
				name: t("pwSmartAiRecognize", { model }),
				exact: true,
			})
			.click();
		await received;
		await closeDialog(page);
		release();
		await page.unroute(endpoint);
		importer = await openImport(page, t);
		await expect(importer.locator("#pw-smart-source")).toHaveValue("");
		await expect(importer.locator(".pw-smart-row")).toHaveCount(0);
		expect(await persistedVault(page)).toEqual(original);
		await importer.locator("#pw-smart-source").fill(source);
		await page.route(endpoint, async (route) => {
			// Simulate another tab replacing the model metadata while a request is in flight.
			await page.evaluate(() =>
				window.dispatchEvent(
					new StorageEvent("storage", { key: "keepany-ai-settings-v1" }),
				),
			);
			await route.abort().catch(() => undefined);
		});
		await importer
			.getByRole("button", {
				name: t("pwSmartAiRecognize", { model }),
				exact: true,
			})
			.click();
		await expect(
			importer.getByRole("status").filter({ hasText: t("pwSmartAiChanged") }),
		).toBeVisible();
		await expect(importer.locator("#pw-smart-source")).toHaveValue(source);
		await expect(importer.locator(".pw-smart-row")).toHaveCount(0);
		expect(await persistedVault(page)).toEqual(original);
		await closeDialog(page);
	} finally {
		await context.close();
		await mock.close();
	}
});

test("password AI import automatically restores its saved vault API key after unlock", async ({
	browser,
}) => {
	const t = copy("en-US");
	const mock = await aiServer();
	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 1280, height: 844 },
	});
	await context.addInitScript(() =>
		localStorage.setItem("keepany-language", "en"),
	);
	const page = await context.newPage();
	try {
		await configureAndOpenVault(page, "en-US", mock.baseURL, 1280);
		await createVault(page, t);
		await seedDuplicate(page, t);
		await entry(page, "Existing login")
			.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
			.click();
		await page.locator("#password-vault-entry-password").fill(syntheticKey);
		await page
			.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
			.click();
		await expect(page.getByRole("dialog")).toBeHidden();
		await page
			.getByRole("button", { name: "AI assistant and access", exact: true })
			.click();
		await page
			.getByRole("link", { name: "Assistant access", exact: true })
			.click();
		await page
			.getByRole("link", { name: "Configure local access", exact: true })
			.click();
		const settings = page.locator(".ai-settings-panel");
		await selectChoice(settings.locator("#ai-settings-key-source"), "vault");
		await selectChoice(settings.locator("#ai-settings-vault-entry"), {
			label: "Existing login",
		});
		await settings.locator("#ai-settings-auto-activate").check();
		await settings
			.getByRole("button", { name: "Save configuration", exact: true })
			.click();
		await expect(
			settings
				.getByRole("status")
				.filter({ hasText: "Model configuration is active" }),
		).toBeVisible();
		await page.goto("/assets/vault");
		await unlock(page, t);
		const importer = await openImport(page, t);
		const source =
			"Synthetic restored-key service\ndemo.restored@example.test\nSynthetic restored secret!";
		await importer.locator("#pw-smart-source").fill(source);
		await expect(
			importer.getByRole("button", {
				name: "Activate selected key",
				exact: true,
			}),
		).toHaveCount(0);
		expect(mock.requests).toHaveLength(0);
		mock.responses.push(
			JSON.stringify({
				records: [
					{
						title: { line: 1 },
						username: { line: 2 },
						password: { line: 3 },
						url: null,
						notes: null,
					},
				],
				ignoredLines: [],
			}),
		);
		await importer
			.getByRole("button", {
				name: t("pwSmartAiRecognize", { model }),
				exact: true,
			})
			.click();
		await expect(importer.locator(".pw-smart-row")).toHaveCount(1);
		expect(mock.requests[0].headers.authorization).toBe(
			`Bearer ${syntheticKey}`,
		);
		expect(JSON.stringify(mock.requests[0].body)).not.toContain(syntheticKey);
		await closeDialog(page);
	} finally {
		await context.close();
		await mock.close();
	}
});

for (const variant of variants) {
	test(`AI incomplete entries remain editable after a partial password import ${variant.locale} ${variant.width}`, async ({
		browser,
	}) => {
		const t = copy(variant.locale);
		const mock = await aiServer();
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
		});
		await context.addInitScript(
			(locale) => localStorage.setItem("keepany-language", locale),
			variant.locale === "zh-CN" ? "zh-CN" : "en",
		);
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const completePassword = "  Synthetic complete password ;|!  ";
		const correctedPassword = "Synthetic manually completed password!";
		const passwordOnly = "Synthetic original password-only value!";
		const correctedNotes = "Synthetic correction retained through partial save";
		const source = [
			"Synthetic complete service",
			"complete.synthetic@example.test",
			completePassword,
			"Synthetic service without password",
			"missing.synthetic@example.test",
			passwordOnly,
			"Synthetic unassigned source fragment",
		].join("\n");
		try {
			await configureAndOpenVault(
				page,
				variant.locale,
				mock.baseURL,
				variant.width,
			);
			await createVault(page, t);
			const original = await persistedVault(page);
			const importer = await openImport(page, t);
			await importer.locator("#pw-smart-source").fill(source);
			mock.responses.push(
				JSON.stringify({
					records: [
						{
							title: { line: 1 },
							username: { line: 2 },
							password: { line: 3 },
							url: null,
							notes: null,
						},
						{
							title: { line: 4 },
							username: { line: 5 },
							password: null,
							url: null,
							notes: null,
						},
						{
							title: null,
							username: null,
							password: { line: 6 },
							url: null,
							notes: null,
						},
					],
					ignoredLines: [7],
				}),
			);
			await importer
				.getByRole("button", {
					name: t("pwSmartAiRecognize", { model }),
					exact: true,
				})
				.click();
			const rows = importer.locator(".pw-smart-row");
			const complete = importer.locator(
				'.pw-smart-row[data-row-id="vault-import-1"]',
			);
			const missingPassword = importer.locator(
				'.pw-smart-row[data-row-id="vault-import-2"]',
			);
			const missingTitle = importer.locator(
				'.pw-smart-row[data-row-id="vault-import-3"]',
			);
			await expect(rows).toHaveCount(3);
			await expect(importer.locator(".pw-smart-mode")).toHaveText(
				t("pwSmartReviewMode_ai", { model, endpoint: mock.baseURL }),
			);
			await expect(importer.locator(".pw-smart-issues")).toContainText(
				t("pwSmartIssue_unrecognized-line"),
			);
			for (const checkbox of await rows.getByRole("checkbox").all())
				await expect(checkbox).not.toBeChecked();
			await expect(missingPassword.getByRole("checkbox")).toBeDisabled();
			await expect(missingTitle.getByRole("checkbox")).toBeDisabled();
			await expect(
				missingPassword.locator(".pw-smart-row-issues"),
			).toContainText(t("pwSmartIssue_missing-password"));
			await expect(missingTitle.locator(".pw-smart-row-issues")).toContainText(
				t("pwSmartIssue_missing-identity"),
			);
			await expect(
				missingPassword.locator(".pw-smart-source-excerpt"),
			).toContainText("Synthetic service without password");
			await expect(
				missingPassword.locator(".pw-smart-source-excerpt"),
			).toContainText("missing.synthetic@example.test");
			await openRow(missingPassword);
			await expect(
				missingPassword.locator("input[id$='-password']"),
			).toHaveValue("");
			await openOptional(missingPassword.locator(".pw-smart-optional"));
			await missingPassword
				.locator("textarea[id$='-notes']")
				.fill(correctedNotes);
			await openRow(missingTitle);
			await expect(missingTitle.locator("input[id$='-title']")).toHaveValue("");
			await expect(missingTitle.locator("input[id$='-password']")).toHaveValue(
				passwordOnly,
			);
			await expect(
				missingTitle.locator("input[id$='-password']"),
			).toHaveAttribute("type", "password");
			expect(await persistedVault(page)).toEqual(original);
			expect(mock.requests).toHaveLength(1);
			expect(JSON.stringify(mock.requests[0].body)).not.toContain(master);
			expect(JSON.stringify(mock.requests[0].body)).not.toContain(syntheticKey);
			await importer
				.getByRole("checkbox", { name: t("pwSmartSelectNew"), exact: true })
				.check();
			await expect(complete.getByRole("checkbox")).toBeChecked();
			await expect(missingPassword.getByRole("checkbox")).not.toBeChecked();
			await expect(missingTitle.getByRole("checkbox")).not.toBeChecked();
			const confirmOne = importer.getByRole("button", {
				name: t("pwSmartConfirm", { count: 1 }),
				exact: true,
			});
			await expect(confirmOne).toBeEnabled();
			await checkLayout(page, importer, variant.width);
			await page.locator(".dialog").evaluate((element) => {
				element.scrollTop = 0;
			});
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-ai-incomplete-${variant.locale}-${variant.width}-review.png`,
				),
				fullPage: true,
			});
			await missingPassword
				.locator(".pw-smart-row-issues")
				.scrollIntoViewIfNeeded();
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-ai-incomplete-${variant.locale}-${variant.width}-needs-completion.png`,
				),
				fullPage: true,
			});
			await confirmOne.click();
			await expect(importer.locator(".pw-smart-receipt")).toHaveText(
				t("pwSmartSaved", { added: 1, updated: 0, skipped: 0 }),
			);
			await expect(
				page.locator(".password-vault-entry-list .password-vault-entry"),
			).toHaveCount(1);
			expect((await persistedVault(page)).revision).not.toBe(original.revision);
			await expect(rows).toHaveCount(2);
			await expect(importer.locator(".pw-smart-mode")).toHaveText(
				t("pwSmartReviewMode_ai", { model, endpoint: mock.baseURL }),
			);
			await expect(
				missingPassword.locator("textarea[id$='-notes']"),
			).toHaveValue(correctedNotes);
			await expect(missingTitle.locator("input[id$='-password']")).toHaveValue(
				passwordOnly,
			);
			await expect(importer.locator(".pw-smart-issues")).toContainText(
				t("pwSmartIssue_unrecognized-line"),
			);
			await openRow(missingPassword);
			await missingPassword
				.locator("input[id$='-password']")
				.fill(correctedPassword);
			await expect(missingPassword.getByRole("checkbox")).toBeEnabled();
			await expect(missingPassword.getByRole("checkbox")).not.toBeChecked();
			await expect(missingPassword.locator(".pw-smart-row-issues")).toHaveCount(
				0,
			);
			await openRow(missingTitle);
			await missingTitle
				.locator("input[id$='-title']")
				.fill("Synthetic manually named service");
			await expect(missingTitle.getByRole("checkbox")).toBeEnabled();
			await expect(missingTitle.getByRole("checkbox")).not.toBeChecked();
			await expect(missingTitle.locator(".pw-smart-row-issues")).toHaveCount(0);
			await missingPassword.getByRole("checkbox").check();
			await missingTitle.getByRole("checkbox").check();
			await checkLayout(page, importer, variant.width);
			await page.locator(".dialog").evaluate((element) => {
				element.scrollTop = 0;
			});
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-ai-incomplete-${variant.locale}-${variant.width}-remaining.png`,
				),
				fullPage: true,
			});
			await importer
				.getByRole("button", {
					name: t("pwSmartConfirm", { count: 2 }),
					exact: true,
				})
				.click();
			await expect(importer.locator(".pw-smart-receipt")).toHaveText(
				t("pwSmartSaved", { added: 2, updated: 0, skipped: 0 }),
			);
			await closeDialog(page);
			await page.reload();
			await unlock(page, t);
			await expect(
				page.locator(".password-vault-entry-list .password-vault-entry"),
			).toHaveCount(3);
			expect(await readEntry(page, t, "Synthetic complete service")).toEqual({
				password: completePassword,
				username: "complete.synthetic@example.test",
				url: "",
				notes: "",
			});
			expect(
				await readEntry(page, t, "Synthetic service without password"),
			).toEqual({
				password: correctedPassword,
				username: "missing.synthetic@example.test",
				url: "",
				notes: correctedNotes,
			});
			expect(
				await readEntry(page, t, "Synthetic manually named service"),
			).toEqual({ password: passwordOnly, username: "", url: "", notes: "" });
			await checkLayout(
				page,
				page.locator(".password-vault-panel"),
				variant.width,
			);
			await page.screenshot({
				path: join(
					evidenceRoot,
					`password-ai-incomplete-${variant.locale}-${variant.width}-restored.png`,
				),
				fullPage: true,
			});
			expect(mock.requests).toHaveLength(1);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
			await mock.close();
		}
	});
}
