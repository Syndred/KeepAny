import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
	type Browser,
	expect,
	type Locator,
	type Page,
	type TestInfo,
} from "@playwright/test";
import { build } from "esbuild";
import { passwordVaultCopy } from "../../../apps/web/src/password-vault-copy";
import type {
	VaultPersistence,
	VaultSession,
} from "../../../packages/password-vault/src";
import { aiServer, labels, model, syntheticKey } from "../helpers/ai-workflow";
import { selectChoice } from "../helpers/select-choice";

export const visualMaster = "Synthetic visual acceptance master 2026!";
export const visualOldNotionPassword = "Demo-only-old-Notion!42";
export type VisualLocale = "zh-CN" | "en";
export type VisualRecord = {
	title: string;
	username: string;
	password: string;
	missingPassword?: boolean;
	url?: string;
	notes?: string;
	aliases?: string[];
};
export const pendingRecords: VisualRecord[] = [
	{ title: "Outlook", username: "alex@example.com", password: "Demo-only!42" },
	{
		title: "Outlook",
		username: "work@example.com",
		password: "Demo-only-work!42",
	},
	{
		title: "GitHub",
		username: "dev@example.com",
		password: "Demo-only-github!42",
		url: "https://github.com/",
	},
	{
		title: "Notion",
		username: "team@example.com",
		password: "Demo-only-new-Notion!42",
		url: "https://notion.so/",
	},
	{
		title: "Figma",
		username: "design@example.com",
		password: "",
		missingPassword: true,
	},
	{
		title: "Dropbox",
		username: "work@example.com",
		password: "Demo-only-dropbox!42",
	},
	{
		title: "Adobe",
		username: "studio@example.com",
		password: "Demo-only-adobe!42",
	},
];
export const reviewedRecords: VisualRecord[] = Array.from(
	{ length: 47 },
	(_, index) => ({
		title: `Example ${String(index + 1).padStart(2, "0")}`,
		username: `reviewed-${String(index + 1).padStart(2, "0")}@example.com`,
		password: `Demo-only-reviewed-${index + 1}!42`,
	}),
);

/** Provider output contains references only. The application extracts fake values from the pasted source. */
export function recognitionFixture(records: VisualRecord[]) {
	const lines: string[] = [];
	const ignoredLines: number[] = [];
	const references = records.map((record) => {
		const append = (value: string | undefined) => {
			if (!value) return null;
			lines.push(value);
			return { line: lines.length };
		};
		const title = append(record.title);
		const username = append(record.username);
		const originalPassword = append(record.password);
		if (record.missingPassword && originalPassword)
			ignoredLines.push(originalPassword.line);
		const password = record.missingPassword ? null : originalPassword;
		const url = append(record.url);
		const notes = append(record.notes);
		const usernameAliases = (record.aliases ?? []).map((alias) =>
			append(alias),
		);
		lines.push("");
		return { title, username, password, url, notes, usernameAliases };
	});
	return {
		source: lines.join("\n"),
		response: JSON.stringify({ records: references, ignoredLines }),
	};
}
export const visualBatch = recognitionFixture([
	...pendingRecords,
	...reviewedRecords,
]);

export function visualCopy(locale: VisualLocale) {
	const index = locale === "zh-CN" ? 0 : 1;
	return (key: string, values: Record<string, string | number> = {}) =>
		(passwordVaultCopy[key]?.[index] ?? key).replace(
			/\{\{(\w+)\}\}/g,
			(whole, name: string) => String(values[name] ?? whole),
		);
}
export type VisualCopy = ReturnType<typeof visualCopy>;

/** Only language is initialized outside the UI. No candidate, vault, or React state is injected. */
export async function visualHarness(
	browser: Browser,
	locale: VisualLocale,
	viewport = { width: 1448, height: 1086 },
) {
	const mock = await aiServer();
	const context = await browser.newContext({
		locale: locale === "en" ? "en-US" : locale,
		viewport,
	});
	await context.addInitScript(
		(language) => localStorage.setItem("keepany-language", language),
		locale,
	);
	const page = await context.newPage();
	page.setDefaultTimeout(15_000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const t = visualCopy(locale);
	async function configure(withoutKey = false) {
		await page.goto("/settings#assistant");
		const settings = page.locator(".ai-settings-panel");
		await selectChoice(settings.locator("#ai-settings-provider"), "compatible");
		await settings.locator("#ai-settings-url").fill(mock.baseURL);
		await settings.locator("#ai-settings-model").fill(model);
		await selectChoice(
			settings.locator("#ai-settings-key-source"),
			withoutKey ? "none" : "session",
		);
		if (!withoutKey)
			await settings.locator("#ai-settings-api-key").fill(syntheticKey);
		await settings
			.getByRole("button", { name: labels[locale].saveSettings, exact: true })
			.click();
		await expect(
			settings.getByRole("status").filter({ hasText: labels[locale].ready }),
		).toBeVisible();
		if (viewport.width < 768) await page.locator(".mobile-menu").click();
		await page
			.getByRole("link", {
				name: locale === "zh-CN" ? "密码库" : "Password vault",
				exact: true,
			})
			.first()
			.click();
	}
	async function createVault() {
		await page.locator("#password-vault-master").fill(visualMaster);
		await page.locator("#password-vault-master-confirm").fill(visualMaster);
		await page
			.getByRole("button", { name: t("pwVaultCreate"), exact: true })
			.click();
		await expect(page.locator(".password-vault-toolbar")).toBeVisible();
	}
	async function seedExisting(record: VisualRecord) {
		await page
			.getByRole("button", { name: t("pwVaultNewEntry"), exact: true })
			.click();
		await page.locator("#password-vault-entry-title").fill(record.title);
		await page.locator("#password-vault-entry-username").fill(record.username);
		await page.locator("#password-vault-entry-password").fill(record.password);
		if (record.url) {
			const add = page.getByRole("button", {
				name: t("pwVaultAddUrl"),
				exact: true,
			});
			if (await add.isVisible()) await add.click();
			await page.locator("#password-vault-entry-url").fill(record.url);
		}
		await page
			.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
			.click();
		await expect(page.getByRole("dialog")).toBeHidden();
	}
	async function open() {
		await page
			.getByRole("button", { name: t("pwSmartTitle"), exact: true })
			.click();
		const importer = page.locator(".password-smart-import");
		await expect(importer).toBeVisible();
		return importer;
	}
	return {
		page,
		context,
		mock,
		errors,
		t,
		configure,
		createVault,
		seedExisting,
		open,
		close: async () => {
			await context.close();
			await mock.close();
		},
	};
}

export const visualCases = {
	"01-A": "粘贴清单",
	"01-B": "选择文件载入",
	"01-C": "AI发送范围确认",
	"01-D": "识别中可取消",
	"02-A": "本机识别",
	"02-B": "AI结果未核对",
	"02-C": "超时截断格式失败保留",
	"02-D": "模型不可用",
	"03-A": "新增独立账号",
	"03-B": "添加同账号登录标识",
	"03-C": "网址备注",
	"03-D": "缺失字段定位",
	"04-A": "多行选择填字段",
	"04-B": "快捷填密码",
	"04-C": "原文显隐复制",
	"04-D": "补充目标切换",
	"05-A": "按行映射",
	"05-B": "新条目起点与忽略",
	"05-C": "映射追加保留",
	"05-D": "返回及原文修改",
	"06-A": "选行与前后切换",
	"06-B": "已核对撤销",
	"06-C": "核对后下一条",
	"06-D": "跳过保留草稿",
	"07-A": "相同密码默认跳过",
	"07-B": "冲突保存选项",
	"07-C": "明确指定更新",
	"07-D": "仅补元信息更新",
	"08-A": "批量核对有效条目",
	"08-B": "更多操作菜单",
	"08-C": "网站名称发送预览",
	"08-D": "整理后再核对",
	"09-A": "最终导入确认",
	"09-B": "部分成功继续补录",
	"09-C": "原子失败与版本变化",
	"09-D": "补充已导入条目",
	"10-A": "关闭清空确认",
	"10-B": "锁定清空确认",
	"10-C": "密码显隐删除标识",
	"10-D": "默认悬停焦点禁用",
	"11-A": "顶部菜单与模型详情",
	"11-B": "取消保留",
	"11-C": "原文展开折叠",
	"11-D": "多行密码精确保留",
} as const;
export type VisualCaseId = keyof typeof visualCases | "00-main";

/** Evidence records an exercised state, never an automatic claim of visual parity. */
export function visualEvidence(
	page: Page,
	info: TestInfo,
	locale: VisualLocale,
) {
	const root =
		process.env.KEEPANY_EVIDENCE_DIR ?? info.outputPath("visual-evidence");
	mkdirSync(root, { recursive: true });
	const captured: {
		state: VisualCaseId;
		screenshot: string;
		assertion: string;
		visualReview: string;
	}[] = [];
	return {
		async capture(
			state: VisualCaseId,
			assertion: string,
			element?: Locator,
			suffix = "",
		) {
			const viewport = page.viewportSize();
			if (!viewport) throw Error("Visual acceptance requires a fixed viewport");
			await expect(page.locator(".pw-work-toast")).toBeHidden();
			await expect(page.locator(".toast")).toBeHidden();
			if (state === "00-main") {
				const metrics = await page.evaluate(() =>
					Object.fromEntries(
						[
							".dialog.pw-smart-dialog",
							".pw-import-workspace",
							".pw-work-list",
							".pw-work-editor",
							".pw-work-tabs",
							".pw-work-list-footer",
							".pw-work-list-row:first-child",
							".pw-work-list-row:last-child",
							".pw-work-editor-heading",
							".pw-import-source-card",
							".pw-smart-field-title input",
							".pw-smart-primary-identifier input",
							".pw-smart-identifier-row",
							".pw-smart-field-password input",
							".pw-smart-field-notes textarea",
						].map((selector) => {
							const node = document.querySelector(selector);
							if (!node) return [selector, null];
							const box = node.getBoundingClientRect();
							const style = getComputedStyle(node);
							return [
								selector,
								{
									x: box.x,
									y: box.y,
									width: box.width,
									height: box.height,
									font: style.fontSize,
									minHeight: style.minHeight,
								},
							];
						}),
					),
				);
				writeFileSync(
					join(root, `00-metrics-${locale}-${viewport.width}.json`),
					JSON.stringify(metrics, null, 2),
				);
			}
			const filename = `${state}-${locale}-${viewport.width}${suffix}.png`;
			const path = join(root, filename);
			if (element) await element.screenshot({ path });
			else await page.screenshot({ path, fullPage: false });
			captured.push({
				state,
				screenshot: filename,
				assertion,
				visualReview: "待逐图人工对照最终参考图；测试通过不代表像素一致",
			});
			writeFileSync(
				join(
					root,
					`matrix-${locale}-${viewport.width}-${info.title.replace(/[^a-zA-Z0-9]+/g, "-")}.json`,
				),
				JSON.stringify(
					{ locale, viewport, controlledProvider: true, captured },
					null,
					2,
				),
			);
			await info.attach(`${state}${suffix}`, {
				path,
				contentType: "image/png",
			});
			const width = await page
				.locator(".dialog")
				.first()
				.evaluate((node) => ({
					scroll: node.scrollWidth,
					client: node.clientWidth,
				}));
			expect(width.scroll, JSON.stringify(width)).toBeLessThanOrEqual(
				width.client + 1,
			);
		},
		captured,
	};
}

let readonlyRuntime:
	| Promise<{ VaultSession: new (storage: VaultPersistence) => VaultSession }>
	| undefined;
export async function inspectVisualKdbx(path: string) {
	readonlyRuntime ??= build({
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
	const { VaultSession: Session } = await readonlyRuntime;
	const session = new Session({
		read: async () => ({
			id: "local",
			revision: "synthetic-visual-readonly",
			bytes: new Uint8Array(readFileSync(path)),
			updatedAt: "2026-10-05T00:00:00.000Z",
		}),
		write: async () => {
			throw Error("Read-only synthetic KDBX inspection");
		},
	});
	await session.initialize();
	await session.unlock(visualMaster);
	try {
		return session.getSnapshot().entries.map(({ id }) => ({
			draft: session.readEntry(id),
			history: session.history(id),
		}));
	} finally {
		session.lock();
	}
}

export async function visualVaultFingerprint(page: Page) {
	return page.evaluate(async () => {
		for (const metadata of await indexedDB.databases()) {
			const databaseName = metadata.name;
			if (!databaseName?.endsWith("-files-v1")) continue;
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const open = indexedDB.open(databaseName);
				open.onsuccess = () => resolve(open.result);
				open.onerror = () => reject(open.error);
			});
			try {
				if (!db.objectStoreNames.contains("passwordVault")) continue;
				const record = await new Promise<
					{ revision: string; bytes: Uint8Array } | undefined
				>((resolve, reject) => {
					const get = db
						.transaction("passwordVault", "readonly")
						.objectStore("passwordVault")
						.get("local");
					get.onsuccess = () => resolve(get.result);
					get.onerror = () => reject(get.error);
				});
				if (record)
					return {
						revision: record.revision,
						digest: Array.from(
							new Uint8Array(
								await crypto.subtle.digest(
									"SHA-256",
									record.bytes.slice().buffer,
								),
							),
							(value) => value.toString(16).padStart(2, "0"),
						).join(""),
					};
			} finally {
				db.close();
			}
		}
		throw Error("Synthetic acceptance vault missing");
	});
}
