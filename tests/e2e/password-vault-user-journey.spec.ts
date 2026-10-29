import { prepareVaultWorkspace, revealPasswordEntries } from "./helpers/vault-access";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	inspectVisualKdbx,
	type VisualCopy,
	visualHarness,
	visualMaster,
} from "./fixtures/password-smart-import-visual";
import { selectChoice } from "./helpers/select-choice";
import {
	expectReadableAccountGraph,
	exerciseAccountGraphControls,
} from "./helpers/account-graph";

test.setTimeout(180_000);
const root =
	process.env.KEEPANY_EVIDENCE_DIR ?? "/tmp/stackperch-vault-user-journey";
mkdirSync(root, { recursive: true });
const email = "qa.owner@gmail.com";
const phone = "13800138000";
const originalPassword = "Synthetic-user-journey!42";
const records = [
	{
		title: "Gmail QA",
		username: email,
		url: "https://mail.google.com/",
		notes: "Synthetic primary mailbox",
	},
	{
		title: "GitHub QA",
		username: email,
		url: "https://github.com/",
		notes: "Synthetic code hosting account",
	},
	{
		title: "Notion QA",
		username: email,
		url: "https://notion.so/",
		notes: "Synthetic notebook account",
	},
	{
		title: "Slack QA",
		username: email,
		url: "https://slack.com/",
		notes: "Synthetic team account",
	},
	{
		title: "Figma QA",
		username: email,
		url: "https://figma.com/",
		notes: "Synthetic design account",
	},
	{
		title: "Calendar QA",
		username: `+86${phone}`,
		url: "https://first.example.test/",
		notes: "Synthetic phone sign-in",
	},
	{
		title: "Cloud QA",
		username: phone,
		url: "https://second.example.test/",
		notes: "Synthetic same phone in local format",
	},
	{
		title: "Student QA",
		username: "2020034943091",
		url: "https://student.example.test/",
		notes: "Synthetic student identifier",
	},
	{
		title: "QQ QA",
		username: "875306537",
		url: "https://qq.example.test/",
		notes: "Synthetic numeric username",
	},
	{
		title: "Google app QA",
		username: email,
		url: "https://app.example.test/",
		notes: "Sign in with Google; synthetic passwordless account",
		password: "",
	},
].map((record) => ({ password: originalPassword, ...record }));
const csv = [
	["name", "username", "password", "url", "notes"],
	...records.map((record) => [
		record.title,
		record.username,
		record.password,
		record.url,
		record.notes,
	]),
]
	.map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(","))
	.join("\n");

async function noOverflow(page: Page) {
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth + 1,
		),
	).toBe(true);
}
async function closeDialog(page: Page) {
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /^(关闭|Close)$/, exact: true })
		.click();
	await expect(page.getByRole("dialog")).toBeHidden();
}
async function saveEntry(page: Page, t: VisualCopy) {
	await page
		.getByRole("dialog")
		.getByRole("button", { name: t("pwVaultSaveEntry"), exact: true })
		.click();
	await expect(page.getByRole("dialog")).toBeHidden();
}
async function unlock(page: Page, t: VisualCopy) {
	await prepareVaultWorkspace(page);
	await page.locator("#password-vault-unlock-master").fill(visualMaster);
	await page
		.getByRole("button", { name: t("pwVaultUnlock"), exact: true })
		.click();
	await expect(page.locator(".password-vault-toolbar")).toBeVisible();
	await revealPasswordEntries(page);
}
async function actionTargets(scope: Locator) {
	const targets = await scope.locator("button").evaluateAll((buttons) =>
		buttons
			.filter((button) => {
				const box = button.getBoundingClientRect();
				return box.width > 0 && box.height > 0;
			})
			.map((button) => {
				const box = button.getBoundingClientRect();
				return {
					name: button.getAttribute("aria-label") || button.textContent,
					width: box.width,
					height: box.height,
				};
			}),
	);
	for (const target of targets) {
		expect(target.name?.trim()).toBeTruthy();
		expect(target.width).toBeGreaterThanOrEqual(43.5);
		expect(target.height).toBeGreaterThanOrEqual(43.5);
	}
}

async function mobileToolbarLayout(page: Page) {
	const toolbar = page.locator(".password-vault-toolbar");
	await actionTargets(toolbar);
	const boxes = await toolbar
		.locator(".actions > button")
		.evaluateAll((buttons) =>
			buttons.map((button) => {
				const box = button.getBoundingClientRect();
				return {
					left: box.left,
					right: box.right,
					top: box.top,
					bottom: box.bottom,
					width: box.width,
					height: box.height,
				};
			}),
		);
	expect(boxes).toHaveLength(8);
	const rows: (typeof boxes)[] = [];
	for (const box of boxes) {
		const row = rows.find((row) => Math.abs(row[0].top - box.top) < 1);
		if (row) row.push(box);
		else rows.push([box]);
	}
	expect(rows.map((row) => row.length)).toEqual([5, 3]);
	for (const row of rows) {
		const sorted = [...row].sort((a, b) => a.left - b.left);
		for (let i = 1; i < sorted.length; i++)
			expect(sorted[i].left - sorted[i - 1].right).toBeGreaterThanOrEqual(7.5);
	}
	expect(rows[1][0].top - rows[0][0].bottom).toBeGreaterThanOrEqual(7.5);
}

for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} passwordless labeled notes retain punctuation and prefill reviewed fields`, async ({
		browser,
	}) => {
		const h = await visualHarness(browser, locale, { width: 390, height: 900 });
		try {
			await h.page.goto("/assets/vault");
			await h.createVault();
			const importer = await h.open();
			const notes = "使用 Google 登录，无独立密码";
			await importer
				.locator("#pw-smart-source")
				.fill(`名称=Notion\n账号=demo.reader@gmail.com\n备注=${notes}`);
			await importer
				.getByRole("button", {
					name: /^(本机识别|Recognize on device)$/,
					exact: true,
				})
				.click();
			await expect(importer.locator(".pw-work-list-row")).toHaveCount(1);
			const editor = importer.locator(".pw-work-editor");
			await expect(editor.locator("[id$='-title']").first()).toHaveValue(
				"Notion",
			);
			await expect(editor.locator("[id$='-username']").first()).toHaveValue(
				"demo.reader@gmail.com",
			);
			await expect(editor.locator("[id$='-password']").first()).toHaveValue("");
			await expect(editor.locator("[id$='-notes']").first()).toHaveValue(notes);
			await expect(
				importer.getByRole("button", {
					name: /^(导入已核对的 0 条|Import 0 reviewed)$/,
					exact: true,
				}),
			).toBeDisabled();
			expect(h.mock.requests).toHaveLength(0);
			expect(h.errors).toEqual([]);
		} finally {
			await h.close();
		}
	});
}

for (const locale of ["zh-CN", "en"] as const)
	for (const width of [1536, 390]) {
		test(`${locale} ${width}px user imports, categorizes and follows account identities before vault maintenance`, async ({
			browser,
		}, info) => {
			const h = await visualHarness(browser, locale, { width, height: 1024 });
			const { page, t } = h;
			const zh = locale === "zh-CN";
			const entries = page.locator(
				".password-vault-entry-list .password-vault-entry",
			);
			const entry = (title: string) =>
				entries.filter({
					has: page.getByRole("heading", { name: title, exact: true }),
				});
			try {
				await page.goto("/assets/vault");
				await prepareVaultWorkspace(page);
				await h.createVault();
				if (width < 680) await mobileToolbarLayout(page);
				const importer = await h.open();
				await importer.locator("#pw-smart-source").fill(csv);
				await importer
					.getByRole("button", {
						name: /^(本机识别|Recognize on device)$/,
						exact: true,
					})
					.click();
				// Explicit local fields are already reviewed; the passwordless entry still needs approval.
				await expect(importer.locator(".pw-work-list-row")).toHaveCount(1);
				await expect(importer.locator(".pw-work-list-row")).toContainText(
					"Google app QA",
				);
				await importer
					.getByRole("button", {
						name: /^(批量核对|Bulk review)$/,
						exact: true,
					})
					.click();
				await page
					.getByRole("dialog")
					.last()
					.getByRole("button", {
						name: /^(已核对，全部选入|Reviewed, select all)$/,
						exact: true,
					})
					.click();
				await importer.getByRole("tab", { name: /已核对|Reviewed/ }).click();
				await expect(importer.locator(".pw-work-list-row")).toHaveCount(
					records.length,
				);
				await importer
					.getByRole("button", {
						name: /^(导入已核对的 10 条|Import 10 reviewed)$/,
						exact: true,
					})
					.click();
				await page
					.getByRole("dialog")
					.last()
					.getByRole("button", {
						name: /^(确认导入|Confirm import)$/,
						exact: true,
					})
					.click();
				await expect(importer.locator(".pw-smart-receipt")).toBeVisible();
				await page
					.locator(".password-smart-import-dialog > header")
					.getByRole("button", { name: /^(关闭|Close)$/, exact: true })
					.click();
				await expect(importer).toBeHidden();
				await expect(entries).toHaveCount(records.length);
				await expect(entry("Google app QA")).toContainText(
					t("pwVaultNoPassword"),
				);
				await expect(entry("Gmail QA")).toContainText(records[0].notes);

				// Add another login identifier through the regular editor; it joins two identity families.
				await entry("GitHub QA")
					.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", { name: t("pwVaultAddIdentifier"), exact: true })
					.click();
				await page
					.locator(".pw-smart-identifier-row input")
					.fill(`+86${phone}`);
				await saveEntry(page, t);
				await expect(entry("GitHub QA")).toContainText(`+86${phone}`);
				await actionTargets(entry("GitHub QA"));
				await noOverflow(page);
				await page.screenshot({
					path: join(root, `journey-vault-${locale}-${width}.png`),
					fullPage: true,
				});

				await page
					.getByRole("button", { name: t("pwConnectTitle"), exact: true })
					.click();
				const connect = page.locator(".vault-connect-dialog");
				const rows = connect.locator(".vault-connect-account");
				await expect(rows).toHaveCount(records.length);
				await connect
					.getByRole("button", { name: t("pwConnectSelectAll"), exact: true })
					.click();
				const gmailRow = rows.filter({
					has: page.getByText("Gmail QA", { exact: true }),
				});
				const studentRow = rows.filter({
					has: page.getByText("Student QA", { exact: true }),
				});
				await expect(gmailRow.getByRole("combobox")).toContainText(
					zh ? "邮箱" : "Email",
				);
				await selectChoice(studentRow.getByRole("combobox"), "social");
				await connect
					.getByRole("button", { name: t("pwConnectLocal"), exact: true })
					.click();
				const suggestions = connect.locator(".vault-connect-suggestion");
				await expect(suggestions).toHaveCount(8);
				await expect(suggestions.filter({ hasText: "Student QA" })).toHaveCount(
					0,
				);
				await expect(suggestions.filter({ hasText: "QQ QA" })).toHaveCount(0);
				await expect(suggestions.filter({ hasText: "GitHub QA" })).toHaveCount(
					2,
				);
				await expect(
					suggestions.filter({ hasText: "Notion QA" }).locator("strong"),
				).toHaveText(/Notion QA\s*→\s*Gmail QA/);
				await expect(
					suggestions.filter({ hasText: t("pwConnectKind_email") }),
				).toHaveCount(5);
				await expect(
					suggestions.filter({ hasText: t("pwConnectKind_phone") }),
				).toHaveCount(3);
				for (const suggestion of await suggestions.all())
					await expect(
						suggestion.locator("input[type=checkbox]"),
					).toBeChecked();
				await gmailRow.scrollIntoViewIfNeeded();
				await noOverflow(page);
				await connect.screenshot({
					path: join(root, `journey-connect-${locale}-${width}.png`),
				});
				await connect
					.getByRole("button", { name: t("pwConnectSave"), exact: true })
					.click();
				await expect(connect).toBeHidden();
				await expect(
					page.locator(
						".password-vault-entry-list .password-vault-linked-asset",
					),
				).toHaveCount(records.length);

				// Repeat the reviewed operation before following a graph; it must not multiply nodes or edges.
				await page
					.getByRole("button", { name: t("pwConnectTitle"), exact: true })
					.click();
				await connect
					.getByRole("button", { name: t("pwConnectSelectAll"), exact: true })
					.click();
				await expect(studentRow.getByRole("combobox")).toContainText(
					zh ? "自媒体" : "Social",
				);
				await connect
					.getByRole("button", { name: t("pwConnectLocal"), exact: true })
					.click();
				await connect
					.getByRole("button", { name: t("pwConnectSave"), exact: true })
					.click();
				await expect(connect).toBeHidden();
				await revealPasswordEntries(page);
				await entry("Gmail QA").locator(".password-vault-linked-asset").click();
				await expect(page).toHaveURL(/\/assets\/account\//);
				await expect(page.locator(".react-flow__node")).toHaveCount(6);
				await expect(page.locator(".react-flow__edge")).toHaveCount(5);
				await expectReadableAccountGraph(page);
				await page
					.getByRole("button", {
						name: zh ? "完整关系" : "All connections",
						exact: true,
					})
					.click();
				await expect(page.locator(".react-flow__node")).toHaveCount(9);
				await expect(page.locator(".react-flow__edge")).toHaveCount(8);
				await expectReadableAccountGraph(page);
				for (const edge of await page.locator(".react-flow__edge-path").all())
					await expect(edge).toHaveAttribute("marker-end", /url\(/);
				await expect(
					page.locator(".react-flow__node[data-id^='login-identity-']"),
				).toHaveCount(1);
				await page.locator("#relation-filter").fill("Cloud QA");
				await expect(
					page.locator(".react-flow__node").filter({ hasText: "Cloud QA" }),
				).toHaveCount(1);
				await expect(page.locator(".react-flow__node")).toHaveCount(9);
				await expect(page.locator(".asset-graph-match")).toContainText(
					"Cloud QA",
				);
				await page.locator("#relation-filter").fill("");
				await page.locator(".asset-relations-card").scrollIntoViewIfNeeded();
				await expect(page.locator(".toast")).toBeHidden({ timeout: 10000 });
				await noOverflow(page);
				await page.screenshot({
					path: join(root, `journey-family-${locale}-${width}.png`),
				});
				await exerciseAccountGraphControls(page);
				await page
					.locator(".account-graph-view-actions")
					.getByRole("button", { name: /^(适应画布|Fit all)$/, exact: true })
					.click();
				const cloudNodeLink = page
					.locator(".asset-graph-link")
					.filter({ hasText: "Cloud QA" });
				await cloudNodeLink.focus();
				await expect(cloudNodeLink).toBeFocused();
				await cloudNodeLink.press("Enter");
				await expect(
					page.getByRole("heading", { name: "Cloud QA", exact: true }).first(),
				).toBeVisible();
				if (width < 768) await page.locator(".mobile-menu").click();
				await page
					.getByRole("link", { name: zh ? "账号" : "Accounts", exact: true })
					.first()
					.click();
				await expect(page.locator(".asset-account-card")).toHaveCount(11);
				await expect(
					page
						.locator(".asset-account-card")
						.filter({ has: page.getByText("Student QA", { exact: true }) }),
				).toContainText(zh ? "自媒体" : "Social");
				await page
					.locator(".asset-category-scroll")
					.getByRole("button", { name: zh ? "邮箱" : "Email", exact: true })
					.click();
				await expect(
					page
						.locator(".asset-category-scroll")
						.getByRole("button", { name: zh ? "邮箱" : "Email", exact: true }),
				).toHaveAttribute("aria-pressed", "true");
				await expect(
					page
						.locator(".asset-category-scroll")
						.getByRole("button", { name: zh ? "全部" : "All", exact: true }),
				).not.toHaveClass(/active/);
				await expect(page.locator(".asset-account-card")).toHaveCount(1);
				await expect(page.locator(".asset-account-card")).toContainText(
					"Gmail QA",
				);
				await noOverflow(page);
				await page.screenshot({
					path: join(root, `journey-category-${locale}-${width}.png`),
					fullPage: true,
					animations: "disabled",
				});

				// Return through the account's own password management link.
				await page.locator(".asset-account-card").click();
				await page
					.getByRole("link", {
						name: zh ? "管理这个账号的密码" : "Manage this account’s passwords",
						exact: true,
					})
					.click();
				await expect(entries).toHaveCount(1);
				await page
					.getByRole("button", {
						name: t("pwVaultClearAssetFilter"),
						exact: true,
					})
					.click();
				await expect(page).not.toHaveURL(/#asset-/);
				// Clearing the account focus preserves the user's independent category.
				await expect(page.locator(".asset-category-scroll").getByRole("button", { name: zh ? "邮箱" : "Email", exact: true })).toHaveAttribute("aria-pressed", "true");
				await page.locator(".asset-category-scroll").getByRole("button", { name: zh ? "全部" : "All", exact: true }).click();
				await expect(entries).toHaveCount(records.length);
				await revealPasswordEntries(page);
				await page
					.locator("#password-vault-search-input")
					.fill("not-a-saved-account");
				await expect(entries).toHaveCount(0);
				await page.locator("#password-vault-search-input").fill("");
				await expect(entries).toHaveCount(records.length);
				await revealPasswordEntries(page);
				await entry("Notion QA")
					.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
					.click();
				await page
					.locator("#password-vault-entry-password")
					.fill("Synthetic-edited-journey!99");
				await saveEntry(page, t);
				await entry("Notion QA")
					.getByRole("button", { name: t("pwVaultHistory"), exact: true })
					.click();
				await page
					.getByRole("dialog")
					.getByRole("button", {
						name: t("pwVaultHistoryRestore"),
						exact: true,
					})
					.first()
					.click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await entry("Notion QA")
					.getByRole("button", { name: t("pwVaultEditEntry"), exact: true })
					.click();
				await expect(
					page.locator("#password-vault-entry-password"),
				).toHaveValue(originalPassword);
				await closeDialog(page);
				await entry("QQ QA")
					.getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true })
					.click();
				await page.getByRole("dialog").getByRole("button", { name: t("pwVaultDeleteEntry"), exact: true }).click();
				await expect(entries).toHaveCount(records.length - 1);
				await page.locator("#vault-trash").scrollIntoViewIfNeeded();
				await expect(page.locator("#vault-trash")).toBeInViewport();
				await page
					.getByRole("button", { name: t("pwVaultRestoreEntry"), exact: true })
					.click();
				await expect(entries).toHaveCount(records.length);
				await page
					.getByRole("button", { name: t("pwVaultLock"), exact: true })
					.click();
				await expect(entries).toHaveCount(0);
				await unlock(page, t);
				await expect(entries).toHaveCount(records.length);
				await page.reload();
				await unlock(page, t);
				await expect(entries).toHaveCount(records.length);

				const download = page.waitForEvent("download");
				await page
					.getByRole("button", { name: t("pwVaultExport"), exact: true })
					.click();
				const output = info.outputPath("synthetic-user-journey.kdbx");
				await (await download).saveAs(output);
				const inspected = await inspectVisualKdbx(output);
				expect(inspected).toHaveLength(records.length);
				for (const record of records)
					expect(
						inspected.find((item) => item.draft.title === record.title)?.draft,
					).toMatchObject({
						username: record.username,
						password: record.password,
						notes: record.notes,
					});
				expect(
					inspected.find((item) => item.draft.title === "GitHub QA")?.draft
						.usernameAliases,
				).toEqual([`+86${phone}`]);
				const restoredContext = await browser.newContext({
					viewport: { width, height: 1024 },
				});
				try {
					await restoredContext.addInitScript(
						(language) => localStorage.setItem("keepany-language", language),
						locale,
					);
					const restored = await restoredContext.newPage();
					await restored.goto("/assets/vault");
					await prepareVaultWorkspace(restored);
					await restored
						.getByRole("button", { name: t("pwVaultImportEmpty"), exact: true })
						.click();
					await restored
						.locator("#password-vault-import-file")
						.setInputFiles(output);
					await restored
						.locator("#password-vault-import-password")
						.fill(visualMaster);
					await restored
						.getByRole("button", { name: t("pwVaultImportNow"), exact: true })
						.click();
					await expect(restored.getByRole("dialog")).toBeHidden();
					const restoredEntries = restored.locator(
						".password-vault-entry-list .password-vault-entry",
					);
					await expect(restoredEntries).toHaveCount(records.length);
					await expect(
						restoredEntries.filter({
							has: restored.getByRole("heading", {
								name: "Google app QA",
								exact: true,
							}),
						}),
					).toContainText(t("pwVaultNoPassword"));
					await noOverflow(restored);
				} finally {
					await restoredContext.close();
				}
				expect(h.mock.requests).toHaveLength(0);
				expect(h.errors).toEqual([]);
			} finally {
				await h.close();
			}
		});
	}
