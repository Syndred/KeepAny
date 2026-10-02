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
) {
	const ui = labels[locale === "zh-CN" ? "zh-CN" : "en"];
	await page.goto("/settings#assistant");
	const settings = page.locator(".ai-settings-panel");
	await selectChoice(settings.locator("#ai-settings-provider"), "compatible");
	await settings.locator("#ai-settings-url").fill(baseURL);
	await settings.locator("#ai-settings-model").fill(model);
	await settings.locator("#ai-settings-api-key").fill(syntheticKey);
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
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /^(Close|关闭)$/, exact: true })
		.first()
		.click();
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
	if ((await row.locator("details").getAttribute("open")) === null)
		await row.locator("summary").click();
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

for (const variant of variants) {
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
				t("pwSmartSaved", { added: 2, updated: 0, skipped: 1 }),
			);
			await expect(importer.locator("input[id$='-password']")).toHaveCount(0);
			await importer
				.getByRole("button", { name: t("pwSmartContinue"), exact: true })
				.click();
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
			t("pwSmartSaved", { added: 1, updated: 0, skipped: 1 }),
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
			t("pwSmartSaved", { added: 1, updated: 0, skipped: 1 }),
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
