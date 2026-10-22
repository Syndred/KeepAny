import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { build } from "esbuild";
import { strFromU8, unzipSync } from "fflate";
import { newAsset, type Asset, type Relation } from "../../packages/domain/src";
import {
	openLocalRepository,
	type RecordRow,
} from "../../packages/local-db/src";
import {
	decryptBackup,
	encryptBackup,
} from "../../packages/local-db/src/backup-crypto";
import type {
	VaultPersistence,
	VaultSession,
} from "../../packages/password-vault/src";
import { expectReadableAccountGraph } from "./helpers/account-graph";
import {
	inspectVisualKdbx,
	visualCopy,
	visualMaster,
} from "./fixtures/password-smart-import-visual";

test.setTimeout(150_000);
const evidence =
	process.env.KEEPANY_EVIDENCE_DIR ??
	"/tmp/stackperch-password-account-upgrade";
const backupPassword = "Synthetic-upgrade-backup-password!42";
const email = "upgrade.owner@gmail.com",
	phone = "13800138000";
const password = "Synthetic-upgrade-entry-password!42";
const blockedName = "Blocked upgrade entry";
const records = [
	{
		title: "Gmail Upgrade",
		username: email,
		usernameAliases: [],
		url: "https://mail.google.com",
	},
	{
		title: "Bybit Upgrade",
		username: email,
		usernameAliases: [phone],
		url: "https://bybit.example.test",
	},
	{
		title: "Notion Upgrade",
		username: email,
		usernameAliases: [],
		url: "https://notion.example.test",
	},
	{
		title: "Calendar Upgrade",
		username: phone,
		usernameAliases: [],
		url: "https://calendar.example.test",
	},
	{
		title: "Cloud Upgrade",
		username: `+86${phone}`,
		usernameAliases: [],
		url: "https://cloud.example.test",
	},
	{
		title: blockedName,
		username: "blocked-user",
		usernameAliases: [],
		url: "https://blocked.example.test",
	},
];
let fixture: Buffer;
let accountIds: string[];
let oldHubs: Relation[];
let manual: Relation;

function stableId(prefix: string, values: string[]) {
	return `${prefix}-${createHash("sha256").update(JSON.stringify(values)).digest("hex")}`;
}

// Prepare an actual legacy RxDB archive and encrypted KDBX in an ephemeral Node
// database. Browser writes use the fixed app's normal backup restore UI only.
test.beforeAll(async () => {
	mkdirSync(evidence, { recursive: true });
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
	const repository = await openLocalRepository(
		`test-vault-upgrade-${crypto.randomUUID().slice(0, 8)}`,
	);
	const session = new Session({
		read: () => repository.readPasswordVault(),
		write: (bytes, expectedRevision) =>
			repository.savePasswordVault(bytes, expectedRevision),
	});
	try {
		await session.initialize();
		await session.create(visualMaster);
		for (const record of records)
			await session.saveEntry({
				...record,
				password,
				notes: `Synthetic encrypted notes for ${record.title}`,
				linkedAssetIds: [],
			});
		const entries = session.getSnapshot().entries;
		const entryIds = records.map((record) => {
			const entry = entries.find((entry) => entry.title === record.title);
			if (!entry) throw Error("upgrade-fixture-entry-missing");
			return entry.id;
		});
		accountIds = entryIds.map(
			(id) => `pw-account-${createHash("sha256").update(id).digest("hex")}`,
		);
		const assets = records.map((record, index) => ({
			...newAsset("account"),
			id: accountIds[index],
			name: record.title,
			username: record.username,
			url: record.url,
			category: "",
			description: `Synthetic existing profile ${index}`,
			deleted: index === records.length - 1,
		}));
		const oldHub = (left: number, right: number): Relation => ({
			id: stableId("pw-link-identifier", [
				...[accountIds[left], accountIds[right]].sort(),
				"identifier",
			]),
			from: accountIds[left],
			to: accountIds[right],
			label: "相同登录标识",
			createdAt: "2026-10-21T00:00:00.000Z",
			verifiedAt: "2026-10-21",
			deleted: false,
		});
		oldHubs = [oldHub(1, 0), oldHub(1, 2), oldHub(1, 3)];
		manual = {
			id: "synthetic-manual-upgrade-connection",
			from: accountIds[1],
			to: accountIds[4],
			label: "Manual project connection",
			source: "Synthetic manual evidence, preserve verbatim",
			createdAt: "2026-10-20T00:00:00.000Z",
			verifiedAt: "2026-10-20",
			deleted: false,
		};
		await repository.saveBatch([
			...assets.map((value) => ({ type: "asset" as const, value })),
			...[...oldHubs, manual].map((value) => ({
				type: "relation" as const,
				value,
			})),
		]);
		const revision = session.getSnapshot().contentRevision;
		if (!revision) throw Error("upgrade-fixture-revision-missing");
		await session.linkAccounts(
			entryIds.map((entryId, index) => ({
				entryId,
				accountId: accountIds[index],
			})),
			revision,
		);
		fixture = Buffer.from(
			await encryptBackup(await repository.exportArchive(), backupPassword),
		);
	} finally {
		session.lock();
		await repository.close();
	}
});

async function openBackupRestore(page: Page) {
	const details = page
		.locator("details.intake-secondary")
		.filter({ has: page.locator("#restore-file") });
	if ((await details.getAttribute("open")) === null)
		await details.locator("summary").click();
}

async function downloadState(page: Page, zh: boolean, name: string) {
	await page.goto("/intake");
	await page.locator("#backup-password").fill(backupPassword);
	await page
		.getByRole("button", {
			name: zh ? "创建备份" : "Create backup",
			exact: true,
		})
		.click();
	const link = page.getByRole("link", {
		name: zh ? "保存备份文件" : "Save backup file",
		exact: true,
	});
	await expect(link).toBeVisible();
	const downloading = page.waitForEvent("download");
	await link.click();
	const path = test.info().outputPath(name);
	await (await downloading).saveAs(path);
	const archive = unzipSync(
		await decryptBackup(new Uint8Array(readFileSync(path)), backupPassword),
	);
	const rows = JSON.parse(strFromU8(archive["records.json"])) as RecordRow[];
	return {
		assets: rows
			.filter((row) => row.type === "asset")
			.map((row) => JSON.parse(row.payload) as Asset),
		relations: rows
			.filter((row) => row.type === "relation")
			.map((row) => JSON.parse(row.payload) as Relation),
	};
}

for (const { locale, width } of [
	{ locale: "zh-CN", width: 1536 },
	{ locale: "en", width: 390 },
] as const) {
	test(`${locale} ${width}px upgrades legacy uncategorized hubs and isolates a deleted linked entry`, async ({
		browser,
	}, info) => {
		const zh = locale === "zh-CN",
			t = visualCopy(locale);
		const context = await browser.newContext({
			locale: zh ? "zh-CN" : "en-US",
			viewport: { width, height: 1024 },
			acceptDownloads: true,
		});
		await context.addInitScript(
			(language) => localStorage.setItem("keepany-language", language),
			locale,
		);
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		async function openConnections() {
			await page.goto("/assets/vault");
			if (await page.locator("#password-vault-unlock-master").isVisible()) {
				await page.locator("#password-vault-unlock-master").fill(visualMaster);
				await page
					.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
					.click();
			}
			await expect(page.locator(".password-vault-entry")).toHaveCount(
				records.length,
			);
			await page
				.getByRole("button", { name: t("pwConnectTitle"), exact: true })
				.click();
			const dialog = page.getByRole("dialog");
			await expect(dialog.locator(".vault-connect-account")).toHaveCount(5);
			await expect(dialog.getByRole("alert")).toHaveText(
				t("pwConnectBlocked", { count: 1, names: blockedName }),
			);
			await expect(dialog).not.toContainText(t("pwConnectLoadError"));
			await dialog
				.getByRole("button", { name: t("pwConnectSelectAll"), exact: true })
				.click();
			await expect(
				dialog.getByText(t("pwConnectSelected", { count: 5 }), { exact: true }),
			).toBeVisible();
			return dialog;
		}
		try {
			await page.goto("/intake");
			await openBackupRestore(page);
			await page.locator("#backup-password").fill(backupPassword);
			await page.locator("#restore-file").setInputFiles({
				name: "synthetic-legacy-account-upgrade.ka1",
				mimeType: "application/octet-stream",
				buffer: fixture,
			});
			await page
				.getByRole("button", { name: zh ? "预览" : "Preview", exact: true })
				.first()
				.click();
			const confirm = page.getByRole("button", {
				name: zh ? /^确认 ·/ : /^Confirm ·/,
			});
			await expect(confirm).toBeVisible();
			await confirm.click();
			await expect(
				page.getByRole("status").filter({
					hasText: zh ? /已恢复 \d+ 条记录/ : /Restored \d+ records/,
				}),
			).toBeVisible();
			let dialog = await openConnections();
			for (const [index, record] of records.slice(0, 5).entries()) {
				const row = dialog
					.locator(".vault-connect-account")
					.filter({ has: page.locator("strong", { hasText: record.title }) });
				await expect(row.getByRole("combobox")).toHaveText(
					index === 0 ? (zh ? "邮箱" : "Email") : zh ? "其他" : "Other",
				);
			}
			await dialog
				.getByRole("button", { name: t("pwConnectLocal"), exact: true })
				.click();
			await expect(dialog.locator(".vault-connect-suggestion")).toHaveCount(5);
			await expect(dialog.locator(".vault-connect-replacement")).toHaveText(
				t("pwConnectReplace", { count: 3 }),
			);
			await expect(
				dialog.getByRole("button", { name: t("pwConnectSave"), exact: true }),
			).toBeEnabled();
			await page.screenshot({
				path: join(evidence, `legacy-upgrade-review-${locale}-${width}.png`),
			});
			await dialog
				.getByRole("button", { name: t("pwConnectSave"), exact: true })
				.click();
			await expect(dialog).toBeHidden();
			const first = await downloadState(page, zh, "upgraded-first.ka1");
			const live = first.assets.filter((asset) => !asset.deleted);
			expect(live).toHaveLength(6);
			expect(JSON.stringify(first.assets)).not.toContain(password);
			expect(
				first.assets.find((asset) => asset.id === accountIds[0]),
			).toMatchObject({
				category: "email",
				description: "Synthetic existing profile 0",
			});
			for (const id of accountIds.slice(1, 5))
				expect(first.assets.find((asset) => asset.id === id)?.category).toBe(
					"other",
				);
			const phoneIdentity = live.filter((asset) => asset.category === "phone");
			expect(phoneIdentity).toHaveLength(1);
			expect(phoneIdentity[0].username).toBe(phone);
			expect(
				first.assets.find((asset) => asset.id === accountIds[5]),
			).toMatchObject({ deleted: true, category: "" });
			for (const old of oldHubs)
				expect(
					first.relations.find((relation) => relation.id === old.id),
				).toEqual({ ...old, deleted: true });
			expect(
				first.relations.find((relation) => relation.id === manual.id),
			).toEqual(manual);
			const identityLinks = first.relations.filter(
				(relation) =>
					!relation.deleted && relation.id.startsWith("login-link-"),
			);
			expect(identityLinks).toHaveLength(5);
			const expectedEdges = [
				[accountIds[1], accountIds[0], "email"],
				[accountIds[2], accountIds[0], "email"],
				...[1, 3, 4].map((index) => [
					accountIds[index],
					phoneIdentity[0].id,
					"phone",
				]),
			];
			for (const [from, to, kind] of expectedEdges)
				expect(identityLinks).toContainEqual(
					expect.objectContaining({
						id: stableId("login-link", [from, kind, to]),
						from,
						to,
						label: t(`pwConnectKind_${kind}`),
					}),
				);
			expect(
				identityLinks.every((relation) => relation.from !== relation.to),
			).toBe(true);
			await page.goto("/assets/account");
			await expect(page.locator(".asset-account-card")).toHaveCount(6);
			await page
				.locator(".asset-category-scroll")
				.getByRole("button", { name: zh ? "邮箱" : "Email", exact: true })
				.click();
			await expect(page.locator(".asset-account-card")).toHaveCount(1);
			await expect(page.locator(".asset-account-card")).toContainText(
				"Gmail Upgrade",
			);
			await page
				.locator(".asset-category-scroll")
				.getByRole("button", { name: zh ? "手机" : "Phone", exact: true })
				.click();
			await expect(page.locator(".asset-account-card")).toHaveCount(1);
			await expect(page.locator(".asset-account-card")).toContainText(phone);
			await page.goto(`/assets/account/${accountIds[0]}`);
			await expect(page.locator(".react-flow__node")).toHaveCount(6);
			await expect(page.locator(".react-flow__edge")).toHaveCount(6);
			await expectReadableAccountGraph(page);
			await page.locator(".asset-relations-card").scrollIntoViewIfNeeded();
			await page.screenshot({
				path: join(evidence, `legacy-upgrade-graph-${locale}-${width}.png`),
			});
			dialog = await openConnections();
			await dialog
				.getByRole("button", { name: t("pwConnectLocal"), exact: true })
				.click();
			await expect(dialog.locator(".vault-connect-suggestion")).toHaveCount(5);
			await expect(dialog.locator(".vault-connect-replacement")).toHaveCount(0);
			await dialog
				.getByRole("button", { name: t("pwConnectSave"), exact: true })
				.click();
			await expect(dialog).toBeHidden();
			const downloading = page.waitForEvent("download");
			await page
				.getByRole("button", { name: t("pwVaultExport"), exact: true })
				.click();
			const path = info.outputPath("legacy-upgrade.kdbx");
			await (await downloading).saveAs(path);
			const encrypted = await inspectVisualKdbx(path);
			expect(encrypted).toHaveLength(records.length);
			for (const [index, record] of records.entries())
				expect(
					encrypted.find((item) => item.draft.title === record.title)?.draft,
				).toMatchObject({
					username: record.username,
					usernameAliases: record.usernameAliases,
					password,
					notes: `Synthetic encrypted notes for ${record.title}`,
					linkedAssetIds: [accountIds[index]],
				});
			const second = await downloadState(page, zh, "upgraded-repeated.ka1");
			const sorted = <T extends { id: string }>(items: T[]) =>
				[...items].sort((left, right) => left.id.localeCompare(right.id));
			expect(sorted(second.assets)).toEqual(sorted(first.assets));
			expect(sorted(second.relations)).toEqual(sorted(first.relations));
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth + 1,
				),
			).toBe(true);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
}
