import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";
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
		usernameAliases: ["studio@example.com"],
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
	fixture = Buffer.from(await session.exportKdbx());
	session.lock();
});

for (const locale of ["zh-CN", "en"] as const)
	for (const width of [1536, 390]) {
		test(`${locale} ${width} dense grid preserves fields, icon actions, detail navigation and locked secrets`, async ({
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
				if (width === 1536)
					expect(
						Math.max(...geometry.map((box) => box.bottom)),
					).toBeLessThanOrEqual(1024);
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
				await first
					.getByRole("button", {
						name: t("pwVaultOpenEntry", { name: records[0].title }),
						exact: true,
					})
					.click();
				await expect(page).toHaveURL(/#password-/);
				await expect(cards).toHaveCount(0);
				await expect(page.locator(".vault-privacy-note")).toHaveCount(0);
				const detail = page.locator(".password-vault-entry-detail");
				await expect(detail).toContainText(records[0].notes);
				await expect(detail).not.toContainText(records[0].password);
				await expect(page.locator(".toast")).toBeHidden({ timeout: 10000 });
				await page.screenshot({
					path: join(root, `detail-${locale}-${width}.png`),
				});
				await page.goBack();
				await expect(cards).toHaveCount(6);
				await expect(first).not.toContainText(records[0].password);
				await first
					.getByRole("button", {
						name: t("pwVaultOpenEntry", { name: records[0].title }),
						exact: true,
					})
					.click();
				await page
					.getByRole("button", { name: t("pwVaultBackToEntries"), exact: true })
					.click();
				await expect(cards).toHaveCount(6);
				await expect(
					first.locator(".password-vault-entry-title"),
				).toBeFocused();
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
				await first
					.getByRole("button", {
						name: t("pwVaultOpenEntry", { name: records[0].title }),
						exact: true,
					})
					.click();
				await page.reload();
				await expect(page.locator(".password-vault-entry-detail")).toHaveCount(
					0,
				);
				await page.locator("#password-vault-unlock-master").fill(visualMaster);
				await page
					.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
					.click();
				await expect(
					page.locator(".password-vault-entry-detail"),
				).toContainText(longNotes);
				await expect(
					page.locator(".password-vault-entry-detail"),
				).not.toContainText("Second secret line");
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
	}
