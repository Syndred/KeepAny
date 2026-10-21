import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { aiCopy } from "../../apps/web/src/ai-copy";
import {
	inspectVisualKdbx,
	recognitionFixture,
	visualHarness,
	visualMaster,
	visualVaultContentFingerprint,
} from "./fixtures/password-smart-import-visual";
import { syntheticKey } from "./helpers/ai-workflow";
import { selectChoice } from "./helpers/select-choice";

// The former expanding-card suite is migrated to the two-pane review workspace.
// State/visual navigation, atomic save and cross-tab CAS are in the visual suite.
test.setTimeout(120_000);
const editor = (importer: Locator) => importer.locator(".pw-work-editor");
const field = (scope: Locator, name: string) =>
	scope.locator(`[id$='-${name}']`).first();
const button = (scope: Locator, name: RegExp) =>
	scope.getByRole("button", { name, exact: true });
async function recognize(
	_h: Awaited<ReturnType<typeof visualHarness>>,
	importer: Locator,
	source: string,
) {
	await importer.locator("#pw-smart-source").fill(source);
	await button(importer, /^(本机识别|Recognize on device)$/).click();
}
async function ai(page: Page, importer: Locator) {
	await button(importer, /^(用 AI 识别|Recognize with AI)$/).click();
	await page
		.getByRole("dialog")
		.last()
		.getByRole("button", {
			name: /^(确认识别|Confirm recognition)$/,
			exact: true,
		})
		.click();
}
async function advanced(page: Page, option: RegExp) {
	await page
		.getByRole("combobox", {
			name: /^(其他输入方式|Other input methods)$/,
			exact: true,
		})
		.click();
	await page.getByRole("option", { name: option, exact: true }).click();
}
async function close(page: Page) {
	await page
		.locator(".password-smart-import-dialog > header")
		.getByRole("button", { name: /^(关闭|Close)$/, exact: true })
		.click();
	const discard = page.getByRole("button", {
		name: /^(关闭并清空|Close and clear)$/,
		exact: true,
	});
	if (await discard.isVisible()) await discard.click();
	await expect(page.locator(".password-smart-import")).toHaveCount(0);
}
async function save(page: Page, importer: Locator) {
	await button(importer, /^(导入已核对的 \d+ 条|Import \d+ reviewed)$/).click();
	await page
		.getByRole("dialog")
		.last()
		.getByRole("button", { name: /^(确认导入|Confirm import)$/, exact: true })
		.click();
	await expect(importer.locator(".pw-smart-receipt")).toBeVisible();
}
async function exported(h: Awaited<ReturnType<typeof visualHarness>>) {
	const download = h.page.waitForEvent("download");
	await h.page
		.getByRole("button", { name: h.t("pwVaultExport"), exact: true })
		.click();
	const path = test.info().outputPath("synthetic-contract.kdbx");
	await (await download).saveAs(path);
	return inspectVisualKdbx(path);
}
for (const locale of ["zh-CN", "en"] as const)
	for (const width of [390, 1280]) {
		test(`${locale} ${width}px unresolved fragment draft survives partial mapping and saves exact entries`, async ({
			browser,
		}) => {
			const h = await visualHarness(browser, locale, { width, height: 900 });
			try {
				await h.page.goto("/assets/vault");
				await h.createVault();
				const before = await visualVaultContentFingerprint(h.page);
				const importer = await h.open();
				const source =
					"Synthetic mapped service\n  Demo mapped!;,|  \nSynthetic original note";
				await recognize(h, importer, source);
				const form = importer.locator(
					".pw-work-fragment:not([hidden]) .pw-smart-fragment-form",
				);
				await expect(form).toBeVisible();
				await field(form, "title").fill("Synthetic manual service");
				await field(form, "username").fill("manual@example.com");
				await field(form, "password").fill("  Demo manual!42  ");
				await field(form, "notes").fill("Synthetic unsaved note");
				await advanced(h.page, new RegExp(`^${h.t("pwSmartMap")}$`));
				await selectChoice(importer.locator("#pw-map-field-1"), "title");
				await selectChoice(importer.locator("#pw-map-field-2"), "password");
				await importer
					.getByRole("button", { name: h.t("pwSmartMapAdd"), exact: true })
					.click();
				// The unassigned final line and its form retain identity through partial mapping.
				await importer.locator(".pw-work-list-row").last().click();
				await expect(field(form, "title")).toHaveValue(
					"Synthetic manual service",
				);
				await expect(field(form, "password")).toHaveValue("  Demo manual!42  ");
				await expect(field(form, "notes")).toHaveValue(
					"Synthetic unsaved note",
				);
				await advanced(h.page, /^(粘贴清单|Paste a list)$/);
				await importer
					.getByRole("button", {
						name: h.t("pwSmartBackToReview"),
						exact: true,
					})
					.click();
				await expect(field(form, "notes")).toHaveValue(
					"Synthetic unsaved note",
				);
				expect(await visualVaultContentFingerprint(h.page)).toEqual(before);
				await form
					.getByRole("button", {
						name: h.t("pwSmartFragmentApply"),
						exact: true,
					})
					.click();
				await button(importer, /^(批量核对|Bulk review)$/).click();
				await h.page
					.getByRole("dialog")
					.last()
					.getByRole("button", {
						name: /^(已核对，全部选入|Reviewed, select all)$/,
						exact: true,
					})
					.click();
				await save(h.page, importer);
				await close(h.page);
				const entries = await exported(h);
				expect(entries).toHaveLength(2);
				expect(entries.map(({ draft }) => draft)).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							title: "Synthetic mapped service",
							password: "  Demo mapped!;,|  ",
							username: "",
						}),
						expect.objectContaining({
							title: "Synthetic manual service",
							password: "  Demo manual!42  ",
							username: "manual@example.com",
							notes: "Synthetic unsaved note",
						}),
					]),
				);
				expect(h.mock.requests).toHaveLength(0);
				expect(h.errors).toEqual([]);
			} finally {
				await h.close();
			}
		});
	}
for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} CSV and TSV preserve whitespace punctuation and reject invalid UTF-8`, async ({
		browser,
	}) => {
		const h = await visualHarness(browser, locale, { width: 390, height: 844 });
		const secret = '  Demo CSV ;,"quoted"|\t  ';
		const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
		try {
			await h.page.goto("/assets/vault");
			await h.createVault();
			const before = await visualVaultContentFingerprint(h.page);
			let importer = await h.open();
			const file = importer.locator("input[type=file]");
			await file.setInputFiles({
				name: "invalid.txt",
				mimeType: "text/plain",
				buffer: Buffer.from([0xc3, 0x28]),
			});
			await expect(importer).toContainText(h.t("pwSmartFailed"));
			for (const [extension, separator] of [
				["csv", ","],
				["tsv", "\t"],
			]) {
				const content = [
					["name", "url", "username", "password", "note"].join(separator),
					[
						`${extension} account`,
						"https://example.com/login?token=synthetic",
						`${extension}@example.com`,
						secret,
						"Synthetic note, with quotes",
					]
						.map(quote)
						.join(separator),
				].join("\n");
				await importer.locator("input[type=file]").setInputFiles({
					name: `synthetic.${extension}`,
					mimeType: "text/plain",
					buffer: Buffer.from(content),
				});
				await expect(importer.locator("#pw-smart-source")).toHaveValue(content);
				await button(importer, /^(本机识别|Recognize on device)$/).click();
				await importer.getByRole("tab", { name: /已核对|Reviewed/ }).click();
				await expect(field(editor(importer), "password")).toHaveValue(secret);
				if (extension === "csv")
					expect(await visualVaultContentFingerprint(h.page)).toEqual(before);
				await save(h.page, importer);
				await close(h.page);
				if (extension === "csv") importer = await h.open();
			}
			expect((await exported(h)).map(({ draft }) => draft.password)).toEqual([
				secret,
				secret,
			]);
			await h.page.reload();
			await h.page.locator("#password-vault-unlock-master").fill(visualMaster);
			await h.page
				.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true })
				.click();
			await expect(
				h.page.locator(".password-vault-entry-list .password-vault-entry"),
			).toHaveCount(2);
			expect(h.errors).toEqual([]);
		} finally {
			await h.close();
		}
	});
}

test("AI delayed response is discarded after close and a real other-tab model change", async ({
	browser,
}) => {
	const h = await visualHarness(browser, "en");
	const fixture = recognitionFixture([
		{
			title: "Synthetic service",
			username: "demo@example.com",
			password: "Demo-only!42",
		},
	]);
	try {
		await h.configure();
		await h.createVault();
		const before = await visualVaultContentFingerprint(h.page);
		let importer = await h.open();
		const endpoint = `${h.mock.baseURL}/chat/completions`;
		let release!: () => void;
		let arrived!: () => void;
		let gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let received = new Promise<void>((resolve) => {
			arrived = resolve;
		});
		await h.page.route(endpoint, async (route) => {
			arrived();
			await gate;
			await route.abort().catch(() => {});
		});
		await importer.locator("#pw-smart-source").fill(fixture.source);
		await ai(h.page, importer);
		await received;
		await close(h.page);
		release();
		await h.page.unroute(endpoint);
		importer = await h.open();
		await expect(importer.locator("#pw-smart-source")).toHaveValue("");
		gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		received = new Promise<void>((resolve) => {
			arrived = resolve;
		});
		await h.page.route(endpoint, async (route) => {
			arrived();
			await gate;
			await route.abort().catch(() => {});
		});
		await importer.locator("#pw-smart-source").fill(fixture.source);
		await ai(h.page, importer);
		await received;
		const other = await h.context.newPage();
		await other.goto("/settings#assistant");
		const settings = other.locator(".ai-settings-panel");
		await settings
			.locator("#ai-settings-model")
			.fill("synthetic-replaced-model");
		await selectChoice(settings.locator("#ai-settings-key-source"), "none");
		await settings
			.getByRole("button", { name: "Save configuration", exact: true })
			.click();
		await expect(importer).toContainText(h.t("pwSmartAiChanged"));
		await expect(importer.locator("#pw-smart-source")).toHaveValue(
			fixture.source,
		);
		release();
		await h.page.unroute(endpoint);
		await other.close();
		expect(await visualVaultContentFingerprint(h.page)).toEqual(before);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

test("vault-stored model key automatically activates after unlocking without sending the key in source", async ({
	browser,
}) => {
	const h = await visualHarness(browser, "en");
	try {
		await h.configure();
		await h.createVault();
		await h.seedExisting({
			title: "Synthetic model key",
			username: "",
			password: syntheticKey,
		});
		await h.page
			.getByRole("button", { name: "AI assistant and access", exact: true })
			.click();
		await h.page
			.getByRole("link", { name: "Assistant access", exact: true })
			.click();
		await h.page
			.getByRole("link", { name: "Configure local access", exact: true })
			.click();
		const settings = h.page.locator(".ai-settings-panel");
		await selectChoice(settings.locator("#ai-settings-key-source"), "vault");
		await selectChoice(settings.locator("#ai-settings-vault-entry"), {
			label: "Synthetic model key",
		});
		const vaultEntryId = await settings
			.locator("#ai-settings-vault-entry")
			.getAttribute("data-value");
		expect(vaultEntryId).toBeTruthy();
		await settings.locator("#ai-settings-auto-activate").check();
		await settings
			.getByRole("button", { name: "Save configuration", exact: true })
			.click();
		await expect(
			settings
				.getByRole("status")
				.filter({ hasText: aiCopy.aiSettingsVaultSaved[1] }),
		).toBeVisible();
		expect(
			await h.page.evaluate(() =>
				JSON.parse(localStorage.getItem("keepany-ai-settings-v1") || "null"),
			),
		).toMatchObject({ keySource: "vault", autoActivate: true, vaultEntryId });
		await h.page.goto("/assets/vault");
		await h.page.locator("#password-vault-unlock-master").fill(visualMaster);
		await h.page
			.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true })
			.click();
		const importer = await h.open();
		const fixture = recognitionFixture([
			{
				title: "Synthetic restored service",
				username: "demo@example.com",
				password: "Demo-only!42",
			},
		]);
		h.mock.responses.push(fixture.response);
		await importer.locator("#pw-smart-source").fill(fixture.source);
		await ai(h.page, importer);
		await expect(importer.locator(".pw-work-list-row")).toHaveCount(1);
		expect(h.mock.requests[0].headers.authorization).toBe(
			`Bearer ${syntheticKey}`,
		);
		expect(JSON.stringify(h.mock.requests[0].body)).not.toContain(syntheticKey);
		expect(JSON.stringify(h.mock.requests[0].body)).not.toContain(visualMaster);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

test("target drafts preserve edits per target and incorporate later edits to untouched fields", async ({
	browser,
}) => {
	const h = await visualHarness(browser, "en");
	try {
		await h.configure();
		await h.createVault();
		const importer = await h.open();
		const fixture = recognitionFixture([
			{ title: "A", username: "a@example.com", password: "Demo-A!42" },
			{ title: "B", username: "b@example.com", password: "Demo-B!42" },
		]);
		h.mock.responses.push(fixture.response);
		await importer.locator("#pw-smart-source").fill(fixture.source);
		await ai(h.page, importer);
		const target = async () => {
			await editor(importer)
				.getByRole("button", { name: "Change entry", exact: true })
				.click();
			const dialog = h.page.getByRole("dialog").last();
			await dialog
				.getByRole("button", { name: "B · b@example.com", exact: true })
				.click();
			await dialog
				.getByRole("button", { name: "Confirm", exact: true })
				.click();
		};
		await target();
		await field(editor(importer), "notes").fill("Synthetic target note");
		await button(editor(importer), /^(Back to current entry|Cancel)$/).click();
		await importer
			.locator(".pw-work-list-row")
			.filter({ hasText: "b@example.com" })
			.click();
		await field(editor(importer), "password").fill("Demo-B-new!42");
		await importer
			.locator(".pw-work-list-row")
			.filter({ hasText: "a@example.com" })
			.click();
		await target();
		await expect(field(editor(importer), "password")).toHaveValue(
			"Demo-B-new!42",
		);
		await expect(field(editor(importer), "notes")).toHaveValue(
			"Synthetic target note",
		);
		await button(editor(importer), /^(Review update|Apply to entry)$/).click();
		await importer.getByRole("tab", { name: /Reviewed/ }).click();
		await expect(field(editor(importer), "password")).toHaveValue(
			"Demo-B-new!42",
		);
		await expect(field(editor(importer), "notes")).toHaveValue(
			"Synthetic target note",
		);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

for (const [locale, width] of [
	["zh-CN", 1448],
	["en", 390],
] as const) {
	test(`${locale} same-platform accounts distinguish batch repeats from saved duplicates`, async ({
		browser,
	}, info) => {
		const h = await visualHarness(browser, locale, { width, height: 1086 });
		const password = "Synthetic-same-platform!42";
		const source = ["first@example.com", "second@example.com"]
			.map(
				(username) =>
					`Title=Outlook\nUsername=${username}\nPassword="${password}"`,
			)
			.join("\n\n");
		try {
			await h.page.goto("/assets/vault");
			await h.createVault();
			await h.seedExisting({
				title: "Outlook",
				username: "saved@example.com",
				password,
			});
			let importer = await h.open();
			await recognize(h, importer, source);
			// An incomplete earlier row is omitted from engine preview; the duplicate link still targets the correct UI row.
			await importer
				.locator(".pw-work-list-row")
				.filter({ hasText: "first@example.com" })
				.click();
			await expect(field(editor(importer), "username")).toHaveValue(
				"first@example.com",
			);
			await field(editor(importer), "password").fill("");
			await importer
				.locator(".pw-work-list-row")
				.filter({ hasText: "second@example.com" })
				.click();
			await button(importer, /^(新增同平台账号|Add another account)$/).click();
			await expect(field(editor(importer), "username")).toHaveValue("");
			await field(editor(importer), "username").fill("second@example.com");
			await field(editor(importer), "password").fill(password);
			const hint = editor(importer).locator(".pw-work-conflict-note");
			await expect(hint).toContainText(
				locale === "zh-CN" ? "本次清单" : "this import",
			);
			await expect(hint).not.toContainText(
				locale === "zh-CN" ? "密码库中已有" : "already in your vault",
			);
			await expect(
				button(importer, /^(核对完成，下一条|Reviewed, next entry)$/),
			).toBeDisabled();
			await expect(h.page.locator(".toast")).toBeHidden();
			await hint.scrollIntoViewIfNeeded();
			await h.page.screenshot({
				path: info.outputPath(`same-platform-${locale}-batch.png`),
			});
			await button(
				importer,
				/^(查看清单中的条目|View entry in this import)$/,
			).click();
			await expect(field(editor(importer), "username")).toHaveValue(
				"second@example.com",
			);
			await expect(button(importer, /^(撤销核对|Undo review)$/)).toBeVisible();
			await importer
				.locator(".pw-work-list-row")
				.filter({ hasText: "second@example.com" })
				.last()
				.click();
			await field(editor(importer), "username").fill("third@example.com");
			await expect(
				editor(importer).locator(".pw-work-conflict-note"),
			).toHaveCount(0);
			const finish = button(
				importer,
				/^(核对完成，下一条|Reviewed, next entry)$/,
			);
			await expect(finish).toBeEnabled();
			await finish.scrollIntoViewIfNeeded();
			await h.page.screenshot({
				path: info.outputPath(`same-platform-${locale}-distinct.png`),
			});
			await finish.click();
			await importer
				.locator(".pw-work-list-row")
				.filter({ hasText: "first@example.com" })
				.click();
			await field(editor(importer), "password").fill(password);
			await finish.click();
			await save(h.page, importer);
			await expect(importer.locator(".pw-smart-receipt")).toContainText(
				locale === "zh-CN" ? "新增 3" : "3 added",
			);
			await close(h.page);
			const entries = await exported(h);
			expect(entries).toHaveLength(4);
			expect(entries.map((entry) => entry.draft.username).sort()).toEqual([
				"first@example.com",
				"saved@example.com",
				"second@example.com",
				"third@example.com",
			]);
			for (const entry of entries) expect(entry.draft.password).toBe(password);
			importer = await h.open();
			await recognize(h, importer, source.split("\n\n")[0]);
			await expect(
				editor(importer).locator(".pw-work-conflict-note"),
			).toHaveText(
				locale === "zh-CN"
					? "密码库中已有相同条目。"
					: "An identical entry is already in your vault.",
			);
			await expect(
				button(importer, /^(查看清单中的条目|View entry in this import)$/),
			).toHaveCount(0);
			expect(h.errors).toEqual([]);
		} finally {
			await h.close();
		}
	});
}

for (const locale of ["zh-CN", "en"] as const)
	for (const width of [390, 1280]) {
		test(`${locale} ${width}px optional passwords and unchanged source review save to KDBX`, async ({
			browser,
		}) => {
			const h = await visualHarness(browser, locale, { width, height: 900 });
			try {
				await h.configure();
				await h.createVault();
				let importer = await h.open();
				await recognize(
					h,
					importer,
					"name,username,notes\nSynthetic Google app,demo@example.test,Sign in with Google",
				);
				await expect(importer.locator(".pw-work-list-row")).toHaveCount(1);
				await expect(field(editor(importer), "password")).toHaveValue("");
				await expect(
					editor(importer).getByText(h.t("pwSmartPasswordOptional"), {
						exact: true,
					}),
				).toBeVisible();
				await expect(
					button(importer, /^(导入已核对的 0 条|Import 0 reviewed)$/),
				).toBeDisabled();
				if (width === 1280) {
					await button(importer, /^(批量核对|Bulk review)$/).click();
					await h.page
						.getByRole("dialog")
						.last()
						.getByRole("button", {
							name: /^(已核对，全部选入|Reviewed, select all)$/,
							exact: true,
						})
						.click();
				} else {
					await button(
						importer,
						/^(核对完成，下一条|Reviewed, next entry)$/,
					).click();
				}
				await save(h.page, importer);
				await close(h.page);
				const local = await exported(h);
				expect(
					local.map((item) => [
						item.draft.title,
						item.draft.password,
						item.draft.notes,
					]),
				).toEqual([["Synthetic Google app", "", "Sign in with Google"]]);
				importer = await h.open();
				const fixture = recognitionFixture([
					{
						title: "Synthetic SSO app",
						username: "sso@example.test",
						password: "",
					},
				]);
				// Leave a source line unassigned beside an otherwise complete AI candidate.
				fixture.source =
					fixture.source.trimEnd() + "\nAdditional source context";
				h.mock.responses.push(fixture.response);
				await importer.locator("#pw-smart-source").fill(fixture.source);
				await ai(h.page, importer);
				await expect(importer.locator(".pw-work-list-row")).toHaveCount(2);
				await importer.locator(".pw-work-list-row[data-source-group]").click();
				const form = importer.locator(
					".pw-work-fragment:not([hidden]) .pw-smart-fragment-form",
				);
				await expect(field(form, "title")).toHaveValue("Synthetic SSO app");
				await expect(
					form.getByText(h.t("pwSmartFragmentHint"), { exact: true }),
				).toBeVisible();
				await expect(
					form.getByRole("button", {
						name: h.t("pwSmartFragmentApply"),
						exact: true,
					}),
				).toBeEnabled();
				const evidence =
					process.env.KEEPANY_EVIDENCE_DIR ??
					test.info().outputPath("evidence");
				mkdirSync(evidence, { recursive: true });
				await expect(h.page.locator(".toast")).toBeHidden();
				await h.page.screenshot({
					path: join(evidence, `optional-password-${locale}-${width}.png`),
					fullPage: true,
				});
				if (width === 390) {
					await form
						.getByRole("button", {
							name: h.t("pwSmartFragmentApply"),
							exact: true,
						})
						.scrollIntoViewIfNeeded();
					await h.page.screenshot({
						path: join(
							evidence,
							`optional-password-${locale}-${width}-actions.png`,
						),
					});
				}
				expect(
					await h.page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				).toBe(true);
				await form
					.getByRole("button", {
						name: h.t("pwSmartFragmentApply"),
						exact: true,
					})
					.click();
				await expect(
					importer.locator(".pw-work-list-row[data-source-group]"),
				).toHaveCount(0);
				await save(h.page, importer);
				await close(h.page);
				const rows = await exported(h);
				expect(rows).toHaveLength(2);
				expect(
					rows.find((item) => item.draft.title === "Synthetic SSO app")?.draft
						.password,
				).toBe("");
				expect(h.errors).toEqual([]);
			} finally {
				await h.close();
			}
		});
	}
