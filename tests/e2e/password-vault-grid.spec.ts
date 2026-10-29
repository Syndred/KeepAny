import { prepareVaultWorkspace, revealPasswordEntries } from "./helpers/vault-access";
import { createHash } from "node:crypto";
import { aiServer, model } from "./helpers/ai-workflow";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";
import {
	expectReadableAccountGraph,
	exerciseAccountGraphControls,
} from "./helpers/account-graph";
import type {
	VaultEntryDraft,
	VaultPersistence,
	VaultRecord,
	VaultSession,
} from "../../packages/password-vault/src";
import {
	inspectVisualKdbx,
	visualCopy,
	visualMaster,
} from "./fixtures/password-smart-import-visual";

const root = process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/stackperch-vault-grid";
const records: VaultEntryDraft[] = [
	{
		title: "Google · 个人",
		username: "alex@example.com",
		usernameAliases: ["backup@example.com", "+44 7700 900123"],
		notes: "日常邮件与云盘。备用邮箱和手机号均可用于登录。",
	},
	{
		title: "Google · 工作",
		username: "alex.work@example.com",
		usernameAliases: ["alex@example.com"],
		notes: "工作资料专用，项目文件统一保存在共享云盘。",
	},
	{
		title: "GitHub",
		username: "alex-dev",
		usernameAliases: [],
		notes: "个人开发账号，用于代码仓库与开源项目。",
	},
	{
		title: "TikTok · 创作",
		username: "creator@example.com",
		usernameAliases: ["alex_studio", "+44 7700 900789"],
		notes: "工作室内容账号，发布视频前检查标题与封面。",
	},
	{
		title: "Notion",
		username: "notes@example.com",
		usernameAliases: [],
		notes: "个人知识库，整理读书笔记、项目资料与周计划。",
	},
	{
		title: "Cloudflare",
		username: "admin@example.com",
		usernameAliases: ["ops@example.com"],
		notes: "管理域名和网站，修改配置前先记录原有设置。",
	},
].map((record, index) => ({
	...record,
	password: index === 5 ? "" : `Synthetic-grid-${index}!42`,
	url: "",
	linkedAssetIds: [],
}));
let fixture: Buffer;
let fixtureIds: string[];
test.beforeAll(async () => {
	mkdirSync(root, { recursive: true });
	const bundled = await build({
		entryPoints: ["packages/password-vault/src/index.ts"],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
	});
	const module = { exports: {} };
	new Function("require", "module", "exports", bundled.outputFiles[0].text)(
		createRequire(join(process.cwd(), "package.json")),
		module,
		module.exports,
	);
	const { VaultSession: Session } = module.exports as {
		VaultSession: new (storage: VaultPersistence) => VaultSession;
	};
	let stored: VaultRecord | null = null;
	const session = new Session({
		read: async () => stored,
		write: async (bytes) => {
			stored = {
				id: "local",
				bytes,
				revision: crypto.randomUUID(),
				updatedAt: new Date().toISOString(),
			};
			return stored;
		},
	});
	await session.initialize();
	await session.create(visualMaster);
	for (const record of records) await session.saveEntry(record);
	fixtureIds = records.map((record) => {
		const entry = session
			.getSnapshot()
			.entries.find((entry) => entry.title === record.title);
		if (!entry) throw Error(`Missing synthetic vault entry: ${record.title}`);
		return entry.id;
	});
	fixture = Buffer.from(await session.exportKdbx());
	session.lock();
});

for (const locale of ["zh-CN", "en"] as const)
	for (const width of [1536, 390]) {
		test(`${locale} ${width} dense grid preserves fields, icon actions, legacy anchors and locked secrets`, async ({
			browser,
		}, info) => {
			const context = await browser.newContext({
				locale,
				viewport: { width, height: 1024 },
			});
			await context.addInitScript((language) => {
				localStorage.setItem("keepany-language", language);
				Object.defineProperty(navigator, "clipboard", {
					configurable: true,
					value: {
						writeText: async (value: string) => {
							(window as unknown as { copied: string }).copied = value;
						},
					},
				});
			}, locale);
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			const t = visualCopy(locale);
			try {
				await page.goto("/assets/vault");
				await prepareVaultWorkspace(page);
				await page
					.getByRole("button", { name: t("pwVaultImportEmpty"), exact: true })
					.click();
				await page.locator("#password-vault-import-file").setInputFiles({
					name: "synthetic-grid.kdbx",
					mimeType: "application/octet-stream",
					buffer: fixture,
				});
				await page
					.locator("#password-vault-import-password")
					.fill(visualMaster);
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("pwVaultImportNow"), exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
				const cards = page.locator(
					".password-vault-entry-list .password-vault-entry",
				);
				await expect(cards).toHaveCount(6);
				const geometry = await cards.evaluateAll((nodes) =>
					nodes.map((node) => {
						const box = node.getBoundingClientRect();
						return { x: box.x, y: box.y, width: box.width, bottom: box.bottom };
					}),
				);
				expect(new Set(geometry.map((box) => Math.round(box.x))).size).toBe(
					width === 1536 ? 3 : 1,
				);
				if (width === 1536) {
					// Exclude a separate navigation row only when the entry has one.
                    const navigation = page.locator(".workspace-navigation");
                    const navigationHeight = await navigation.count()
                        ? await navigation.evaluate(node => node.getBoundingClientRect().height) : 0;
					expect(
						Math.max(...geometry.map((box) => box.bottom)) - navigationHeight,
					).toBeLessThanOrEqual(1024);
					await cards.last().locator(".password-vault-entry-actions")
						.scrollIntoViewIfNeeded();
					await expect(cards.last().locator(".password-vault-entry-actions"))
						.toBeInViewport();
				}
				for (let i = 0; i < records.length; i++) {
					const card = cards.filter({ hasText: records[i].title });
					for (const value of [
						records[i].username,
						...(records[i].usernameAliases ?? []),
						records[i].notes,
					])
						await expect(
							card
								.locator(".password-vault-value")
								.filter({ hasText: value })
								.first(),
						).toBeVisible();
					await expect(card).not.toContainText(
						records[i].password || "not-a-real-secret",
					);
				}
				const iconMetrics = await page
					.locator(
						".password-vault-entry .password-vault-icon, .password-vault-toolbar .password-vault-icon",
					)
					.evaluateAll((nodes) =>
						nodes.map((node) => ({
							text: node.textContent,
							label: node.getAttribute("aria-label"),
							title: node.getAttribute("title"),
							width: node.getBoundingClientRect().width,
							height: node.getBoundingClientRect().height,
						})),
					);
				for (const metric of iconMetrics) {
					expect(metric.text).toBe("");
					expect(metric.label).toBeTruthy();
					expect(metric.title).toBe(metric.label);
					expect(metric.width).toBeGreaterThanOrEqual(43.99);
					expect(metric.height).toBeGreaterThanOrEqual(43.99);
				}
				await expect(page.locator(".toast")).toBeHidden({ timeout: 10000 });
				await page.evaluate(() => window.scrollTo(0, 0));
				await page.mouse.move(0, 0);
				await page.screenshot({
					path: join(root, `grid-${locale}-${width}.png`),
				});
				const first = cards.filter({ hasText: records[0].title });
				const copyPassword = first.getByRole("button", {
					name: t("pwVaultCopyPassword"),
					exact: true,
				});
				await copyPassword.click();
				expect(
					await page.evaluate(
						() => (window as unknown as { copied: string }).copied,
					),
				).toBe(records[0].password);
				await expect(first).not.toContainText(records[0].password);
				await first
					.getByRole("button", {
						name: t("pwVaultRevealPassword"),
						exact: true,
					})
					.click();
				await expect(first.locator(".password-vault-secret")).toHaveText(
					records[0].password,
				);
				await expect(
					first.getByRole("heading", { name: records[0].title, exact: true }),
				).toBeVisible();
				await expect(page.locator(".password-vault-detail-view")).toHaveCount(
					0,
				);
				await expect(cards).toHaveCount(6);
				await first
					.getByRole("button", {
						name: t("pwVaultHidePasswordValue"),
						exact: true,
					})
					.click();
				// Real UI edits: unbroken long identifiers, multiline password and notes, valid URL.
				await first
					.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
					.click();
				const longNotes =
					"First line with spaces.\n第二行：完整备注，不能截断。\n" +
					`${"Full content ".repeat(20)}End.`;
				const longAlias = `very-long-identifier-${"x".repeat(65)}@example.com`;
				const secret = "  Synthetic-long-password  \r\nSecond secret line  ";
				await page.locator("#password-vault-entry-notes").fill(longNotes);
				await page
					.locator(".pw-smart-identifier-row input")
					.first()
					.fill(longAlias);
				// Use the actual paste control, since single-line inputs normalize newlines.
				await page.evaluate(
					(value) =>
						Object.defineProperty(navigator, "clipboard", {
							configurable: true,
							value: {
								readText: async () => value,
								writeText: async (value: string) => {
									(window as unknown as { copied: string }).copied = value;
								},
							},
						}),
					secret,
				);
				await page
					.getByRole("dialog")
					.getByRole("button", {
						name: locale === "zh-CN" ? "粘贴密码" : "Paste Password",
						exact: true,
					})
					.click();
				await page
					.getByRole("button", { name: t("pwVaultAddUrl"), exact: true })
					.click();
				await page
					.locator("#password-vault-entry-url")
					.fill("https://example.com/full-website-path");
				await page
					.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await expect(
					first.locator(".password-vault-notes-row .password-vault-value"),
				).toHaveText(longNotes);
				await expect(
					first.locator(".password-vault-identifiers"),
				).toContainText(longAlias);
				await expect(first.getByRole("link")).toHaveAttribute(
					"href",
					"https://example.com/full-website-path",
				);
				await first
					.getByRole("button", {
						name: t("pwVaultRevealPassword"),
						exact: true,
					})
					.click();
				expect(
					await first.locator(".password-vault-secret").textContent(),
				).toBe(secret);
				const overflow = await first
					.locator(".password-vault-value")
					.evaluateAll((nodes) =>
						nodes.map((node) => ({
							overflowX: node.scrollWidth - node.clientWidth,
							overflowY: node.scrollHeight - node.clientHeight,
							clamp: getComputedStyle(node).webkitLineClamp,
						})),
					);
				for (const metrics of overflow) {
					expect(metrics.overflowX).toBeLessThanOrEqual(1);
					expect(metrics.overflowY).toBeLessThanOrEqual(1);
					expect(metrics.clamp).toBe("none");
				}
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth - innerWidth,
					),
				).toBeLessThanOrEqual(1);
				const downloadPromise = page.waitForEvent("download");
				await page
					.locator(".password-vault-toolbar")
					.getByRole("button", { name: t("pwVaultExport"), exact: true })
					.click();
				const download = await downloadPromise;
				const output = info.outputPath("synthetic.kdbx");
				await download.saveAs(output);
				const decrypted = await inspectVisualKdbx(output);
				expect(
					decrypted.find((item) => item.draft.title === records[0].title)
						?.draft,
				).toMatchObject({
					password: secret,
					notes: longNotes,
					usernameAliases: [longAlias, records[0].usernameAliases?.[1]],
				});
				await page
					.locator(".password-vault-toolbar")
					.getByRole("button", { name: t("pwVaultLock"), exact: true })
					.click();
				await expect(cards).toHaveCount(0);
				await expect(page.locator("body")).not.toContainText(longNotes);
				await expect(page.locator("body")).not.toContainText(
					"Second secret line",
				);
				await page.locator("#password-vault-unlock-master").fill(visualMaster);
				await page
					.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
					.click();
				await expect(cards).toHaveCount(6);
				await expect(
					page.getByText(t("pwVaultStatusUnlocked"), { exact: true }),
				).toHaveCount(1);
				await expect(page.locator(".password-vault-message")).toHaveCount(0);
				await expect(first).not.toContainText("Second secret line");
				await page.evaluate(() => {
					Object.defineProperty(navigator, "clipboard", {
						configurable: true,
						value: {
							writeText: () =>
								new Promise((_, reject) => {
									(window as unknown as { rejectCopy: () => void }).rejectCopy =
										() => reject(new Error("denied"));
								}),
						},
					});
				});
				await first
					.getByRole("button", { name: t("pwVaultCopyPassword"), exact: true })
					.click();
				await page
					.locator(".password-vault-toolbar")
					.getByRole("button", { name: t("pwVaultLock"), exact: true })
					.click();
				await page.evaluate(() =>
					(window as unknown as { rejectCopy: () => void }).rejectCopy(),
				);
				await expect(page.getByRole("dialog")).toHaveCount(0);
				await expect(page.locator("body")).not.toContainText(
					"Second secret line",
				);
				await page.locator("#password-vault-unlock-master").fill(visualMaster);
				await page
					.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
					.click();
				const legacyId = await first.getAttribute("data-entry-id");
				await page.goto(`/assets/vault#password-${legacyId}`);
				await page.reload();
				await expect(page.locator(".password-vault-entry-detail")).toHaveCount(
					0,
				);
				await page.locator("#password-vault-unlock-master").fill(visualMaster);
				await page
					.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
					.click();
				await expect(first).toContainText(longNotes);
				await expect(first).not.toContainText("Second secret line");
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}

for (const locale of ["zh-CN", "en"] as const)
	for (const width of [390, 1536]) {
		test(`${locale} ${width} reviewed account family persists without sending vault secrets`, async ({
			browser,
		}, info) => {
			const mock = await aiServer();
			const context = await browser.newContext({
				locale,
				viewport: { width, height: 1024 },
			});
			const t = visualCopy(locale);
			await context.addInitScript(
				({ locale, baseURL, model }) => {
					localStorage.setItem("keepany-language", locale);
					localStorage.setItem(
						"keepany-ai-settings-v1",
						JSON.stringify({
							provider: "compatible",
							baseURL,
							model,
							keySource: "none",
						}),
					);
				},
				{ locale, baseURL: mock.baseURL, model },
			);
			const page = await context.newPage();
			const errors: string[] = [];
			page.on("pageerror", (e) => errors.push(e.message));
			try {
				await page.goto("/assets/vault");
				await prepareVaultWorkspace(page);
				await page
					.getByRole("button", { name: t("pwVaultImportEmpty"), exact: true })
					.click();
				await page.locator("#password-vault-import-file").setInputFiles({
					name: "synthetic-family.kdbx",
					mimeType: "application/octet-stream",
					buffer: fixture,
				});
				await page
					.locator("#password-vault-import-password")
					.fill(visualMaster);
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("pwVaultImportNow"), exact: true })
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await page
					.getByRole("button", { name: t("pwConnectTitle"), exact: true })
					.click();
				const dialog = page.getByRole("dialog");
				await expect(dialog.locator(".vault-connect-account")).toHaveCount(6);
				await expect(
					dialog.locator('input[type="checkbox"]:checked'),
				).toHaveCount(0);
				expect(mock.requests).toHaveLength(0);
				const search = dialog.getByRole("searchbox", {
					name: t("pwConnectSearch"),
				});
				await expect(
					dialog.getByRole("heading", {
						name: t("pwConnectTitle"),
						exact: true,
					}),
				).toBeFocused();
				await expect(dialog.locator('[role="alert"]')).toHaveCount(0);
				const all = dialog.getByRole("button", {
					name: t("pwConnectSelectAll"),
					exact: true,
				});
				expect((await all.boundingBox())?.x).toBeLessThan(
					(await search.boundingBox())?.x ?? 0,
				);
				await page.screenshot({
					path: join(root, `connect-open-${locale}-${width}.png`),
				});
				await search.click();
				await expect(search).toBeFocused();
				await expect(search).toHaveCSS("outline-style", "none");
				await expect(dialog.locator(".vault-connect-search")).not.toHaveCSS(
					"box-shadow",
					"none",
				);
				await page.screenshot({
					path: join(root, `connect-search-${locale}-${width}.png`),
				});
				await page.keyboard.press("Tab");
				await expect(search).not.toBeFocused();

				await search.fill("no-matching-account-synthetic");
				await expect(dialog.locator(".vault-connect-account")).toHaveCount(0);
				await expect(
					dialog.getByText(t("pwConnectNoResults"), { exact: true }),
				).toBeVisible();
				await search.fill(records[2].title);
				await expect(dialog.locator(".vault-connect-account")).toHaveCount(1);
				await search.fill("");
				await expect(dialog.locator(".vault-connect-account")).toHaveCount(6);
				const header = await dialog.locator(":scope > header").boundingBox();
				const footer = await dialog
					.locator(".vault-connect-footer")
					.boundingBox();
				expect(header).toBeTruthy();
				expect(footer).toBeTruthy();
				expect(header?.height).toBeLessThan(width > 760 ? 100 : 150);
				expect((footer?.y ?? 0) + (footer?.height ?? 0)).toBeLessThanOrEqual(
					page.viewportSize()?.height ?? 0,
				);
				if (width > 760) {
					const left = await dialog
						.locator(".vault-connect-account-pane")
						.boundingBox();
					const right = await dialog
						.locator(".vault-connect-review-pane")
						.boundingBox();
					expect(left?.y).toBe(right?.y);
					expect(right?.x).toBeGreaterThan(left?.x ?? 0);
				}
				await dialog
					.getByRole("button", { name: t("pwConnectSelectAll"), exact: true })
					.click();
				// Explicitly review mailbox records and service categories before identity matching.
				for (const [index, category] of [
					[0, "email"],
					[1, "email"],
					[2, "social"],
					[3, "social"],
				] as const) {
					await selectChoice(
						dialog
							.locator(".vault-connect-account")
							.filter({ hasText: records[index].title })
							.getByRole("combobox"),
						category,
					);
				}

				if (width > 760) {
					const viewport = page.viewportSize();
					await page.setViewportSize({ width, height: 600 });
					const scroller = dialog.locator(".vault-connect-accounts");
					await scroller.hover();
					await page.mouse.wheel(0, 500);
					await expect
						.poll(() => scroller.evaluate((element) => element.scrollTop))
						.toBeGreaterThan(0);
					await expect(scroller).toHaveCSS("scrollbar-width", "thin");
					await expect(
						dialog.getByRole("button", {
							name: t("pwConnectSave"),
							exact: true,
						}),
					).toBeInViewport();
					await page.screenshot({
						path: join(root, `connect-scroll-${locale}-${width}.png`),
					});
					if (viewport) await page.setViewportSize(viewport);
				}
				await dialog
					.getByRole("button", { name: t("pwConnectLocal"), exact: true })
					.click();
				await expect(dialog.locator(".vault-connect-suggestion")).toHaveCount(
					8,
				);
				const localSuggestions = dialog.locator(".vault-connect-suggestion");
				await expect(
					localSuggestions.filter({ hasText: "backup@example.com" }),
				).toHaveCount(1);
				await expect(
					localSuggestions.filter({ hasText: "+447700900123" }),
				).toHaveCount(1);
				await expect(
					localSuggestions.filter({ hasText: records[1].title }),
				).toContainText(records[0].title);
				await expect(
					localSuggestions.filter({ hasText: records[4].title }),
				).toContainText("notes@example.com");
				await expect(
					localSuggestions.filter({ hasText: t("pwConnectKind_email") }),
				).toHaveCount(6);
				await expect(
					localSuggestions.filter({ hasText: t("pwConnectKind_phone") }),
				).toHaveCount(2);
				const ids = fixtureIds.map(
					(id) => `pw-account-${createHash("sha256").update(id).digest("hex")}`,
				);
				const hintRow = dialog
					.locator(".vault-connect-account")
					.filter({ hasText: records[2].title });
				await expect(hintRow.getByRole("button")).toHaveCount(0);
				for (const record of records) {
					const row = dialog
						.locator(".vault-connect-account")
						.filter({ hasText: record.title });
					await expect(row.locator("textarea")).toHaveValue(record.notes);
					for (const alias of record.usernameAliases ?? [])
						await expect(
							row.locator(".vault-connect-identifiers"),
						).toContainText(alias);
				}
				await dialog
					.locator(".vault-connect-account")
					.filter({ hasText: records[3].title })
					.locator("textarea")
					.fill("");
				await expect(hintRow.locator("textarea")).toHaveValue(records[2].notes);
				expect(mock.requests).toHaveLength(0);
				await dialog
					.locator(".vault-connect-account")
					.filter({ hasText: records[2].title })
					.locator("textarea")
					.fill(
						"Signs in with Google personal. Google work uses this GitHub account for recovery (synthetic).",
					);
				mock.responses.push(
					JSON.stringify({
						relations: [
							{
								from: ids[2],
								to: ids[0],
								kind: "login",
								evidence: "Explicit login hint",
							},
							{
								from: ids[1],
								to: ids[2],
								kind: "recovery",
								evidence: "Explicit recovery hint",
							},
						],
					}),
				);
				await dialog
					.getByRole("button", { name: t("pwConnectAi"), exact: true })
					.click();
				await expect(dialog.locator(".vault-connect-suggestion")).toHaveCount(
					10,
				);
				const suggestions = dialog.locator(".vault-connect-suggestion");
				const loginSuggestion = suggestions.filter({
					has: page.getByText(t("pwConnectKind_login"), { exact: true }),
				});
				const recoverySuggestion = suggestions.filter({
					has: page.getByText(t("pwConnectKind_recovery"), { exact: true }),
				});
				await expect(loginSuggestion.getByRole("checkbox")).not.toBeChecked();
				await expect(
					recoverySuggestion.getByRole("checkbox"),
				).not.toBeChecked();
				expect(mock.requests).toHaveLength(1);
				const sent = JSON.stringify(mock.requests[0].body);
				for (const record of records) {
					if (record.password) expect(sent).not.toContain(record.password);
					for (const alias of record.usernameAliases ?? [])
						expect(sent).toContain(alias);
					if (record === records[2] || record === records[3])
						expect(sent).not.toContain(record.notes);
					else expect(sent).toContain(record.notes);
				}
				expect(sent).toContain("Signs in with Google personal.");
				await expect(loginSuggestion).toContainText(records[2].title);
				await expect(loginSuggestion).toContainText(records[0].title);
				await expect(recoverySuggestion).toContainText(records[1].title);
				await expect(recoverySuggestion).toContainText(records[2].title);
				await loginSuggestion.getByRole("checkbox").check();
				await recoverySuggestion.getByRole("checkbox").check();
				expect(
					await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
				).toBe(true);
				await expect(page.locator(".toast")).toBeHidden({ timeout: 10000 });
				await page.screenshot({
					path: join(root, `family-review-${locale}-${width}.png`),
				});
				if (locale === "zh-CN" && width === 1536) {
					await page.evaluate(() => {
						const original = IDBObjectStore.prototype.put;
						IDBObjectStore.prototype.put = function (
							...args: Parameters<IDBObjectStore["put"]>
						) {
							if (this.name === "passwordVault") {
								IDBObjectStore.prototype.put = original;
								throw new DOMException(
									"Synthetic association fault",
									"QuotaExceededError",
								);
							}
							return original.apply(this, args);
						};
					});
					await dialog
						.getByRole("button", { name: t("pwConnectSave"), exact: true })
						.click();
					await expect(dialog.getByRole("status")).toHaveText(
						t("pwConnectPartial"),
					);
					await expect(
						page.locator(
							".password-vault-entry-list .password-vault-linked-asset",
						),
					).toHaveCount(0);
				}
				await dialog
					.getByRole("button", { name: t("pwConnectSave"), exact: true })
					.click();
				await expect(dialog).toBeHidden();
				const links = page.locator(
					".password-vault-entry-list .password-vault-linked-asset",
				);
				await expect(links).toHaveCount(6);
				// Repeat with all records: existing accounts and exact identifier edges stay deduplicated.
				await page
					.getByRole("button", { name: t("pwConnectTitle"), exact: true })
					.click();
				await expect(dialog.locator(".vault-connect-account")).toHaveCount(6);
				await expect(dialog).not.toContainText(t("pwConnectNew"));
				await dialog
					.getByRole("button", { name: t("pwConnectSelectAll"), exact: true })
					.click();
				await dialog
					.getByRole("button", { name: t("pwConnectLocal"), exact: true })
					.click();
				await dialog
					.getByRole("button", { name: t("pwConnectSave"), exact: true })
					.click();
				await expect(dialog).toBeHidden();
				// Export/read the actual encrypted file to verify all original fields survived association.
				const download = page.waitForEvent("download");
				await page
					.getByRole("button", { name: t("pwVaultExport"), exact: true })
					.click();
				const output = info.outputPath("linked.kdbx");
				await (await download).saveAs(output);
				const inspected = await inspectVisualKdbx(output);
				expect(inspected).toHaveLength(6);
				for (const record of records)
					expect(
						inspected.find((e) => e.draft.title === record.title)?.draft,
					).toMatchObject({
						password: record.password,
						notes: record.notes,
						username: record.username,
					});
				await revealPasswordEntries(page);
				await links.filter({ hasText: records[0].title }).click();
				await expect(page).toHaveURL(new RegExp(`/assets/account/${ids[0]}`));
				await expect(page.locator(".react-flow__node")).toHaveCount(5);
				await expect(page.locator(".react-flow__edge")).toHaveCount(4);
				await expectReadableAccountGraph(page);
				await page
					.getByRole("button", {
						name: locale === "zh-CN" ? "完整关系" : "All connections",
						exact: true,
					})
					.click();
				await expect(page.locator(".react-flow__node")).toHaveCount(5);
				await expect(page.locator(".react-flow__edge")).toHaveCount(5);
				await expectReadableAccountGraph(page);
				await expect(
					page
						.locator(".react-flow__node")
						.filter({ hasText: "backup@example.com" }),
				).toHaveCount(1);
				await expect(
					page
						.locator(".react-flow__node")
						.filter({ hasText: "+447700900123" }),
				).toHaveCount(1);
				await expect(page.locator(".asset-relations-card")).toContainText(
					t("pwConnectKind_login"),
				);
				await page.locator(".asset-relations-card").scrollIntoViewIfNeeded();
				await page.screenshot({
					path: join(root, `family-graph-${locale}-${width}.png`),
				});
				await exerciseAccountGraphControls(page);
				await page.reload();
				await expect(page.locator(".react-flow__node")).toHaveCount(5);
				await expect(page.locator(".react-flow__edge")).toHaveCount(4);
				await expectReadableAccountGraph(page);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth + 1,
					),
				).toBe(true);
				await page.goto("/assets/account");
				await expect(page.locator(".asset-account-card")).toHaveCount(13);
				for (const record of records)
					await expect(
						page
							.locator(".asset-account-card")
							.filter({ hasText: record.title }),
					).toContainText(record.username);
				for (const record of records.slice(0, 2))
					await expect(
						page
							.locator(".asset-account-card")
							.filter({ hasText: record.title }),
					).toContainText(locale === "zh-CN" ? "邮箱" : "Email");
				await expect(
					page
						.locator(".asset-account-card")
						.filter({ hasText: "backup@example.com" }),
				).toContainText(locale === "zh-CN" ? "邮箱" : "Email");
				await page.screenshot({
					path: join(root, `accounts-${locale}-${width}.png`),
				});
				await page.goto("/intake");
				const importTitle =
					locale === "zh-CN" ? "导入外链记录" : "Import backlink records";
				await page
					.locator("details.intake-secondary")
					.filter({ hasText: importTitle })
					.locator("summary")
					.click();
				const importer = page.locator(".external-import-panel");
				await expect(
					importer.getByRole("heading", { name: importTitle, exact: true }),
				).toBeVisible();
				const heading = importer.locator(".external-import-title");
				expect(
					await heading.evaluate((el) => {
						const icon = el.querySelector("svg");
						if (!icon) throw Error("Import heading has no icon");
						const a = el.getBoundingClientRect(),
							b = icon.getBoundingClientRect();
						return Math.abs((a.top + a.bottom - b.top - b.bottom) / 2);
					}),
				).toBeLessThan(1);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth + 1,
					),
				).toBe(true);
				await importer.screenshot({
					path: join(root, `import-${locale}-${width}.png`),
				});
				expect(errors).toEqual([]);
			} finally {
				await context.close();
				await mock.close();
			}
		});
	}
