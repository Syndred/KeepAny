import { expect, type Locator, type Page, test } from "@playwright/test";
import {
	inspectVisualKdbx,
	pendingRecords,
	recognitionFixture,
	visualBatch,
	visualEvidence,
	visualHarness,
	visualMaster,
	visualOldNotionPassword,
	visualVaultFingerprint,
} from "./fixtures/password-smart-import-visual";
import { model } from "./helpers/ai-workflow";
import { selectChoice } from "./helpers/select-choice";

test.setTimeout(180_000);

const aiButton = (scope: Locator) =>
	scope.getByRole("button", {
		name: /^(用 AI 识别|用 .* 识别清单|Recognize with AI|Use AI|Recognize list with .*)$/,
		exact: true,
	});
async function confirmRecognition(page: Page) {
	await page
		.getByRole("button", {
			name: /^(确认识别|Confirm recognition)$/,
			exact: true,
		})
		.click();
}
async function recognizeAi(page: Page, importer: Locator) {
	await aiButton(importer).click();
	await confirmRecognition(page);
}
function editor(importer: Locator) {
	return importer.locator(".pw-work-editor");
}
function field(importer: Locator, name: string) {
	return editor(importer).locator(`[id$="-${name}"]`).first();
}
function row(importer: Locator, username: string) {
	return importer.locator(".pw-work-list-row").filter({ hasText: username });
}
async function goInput(importer: Locator) {
	await importer
		.page()
		.getByRole("combobox", {
			name: /^(其他输入方式|Other input methods)$/,
			exact: true,
		})
		.click();
	await importer
		.page()
		.getByRole("option", { name: /^(粘贴清单|Paste a list)$/, exact: true })
		.click();
}
async function reviewCount(importer: Locator, count: number) {
	await expect(
		importer.getByRole("button", {
			name: new RegExp(`^(导入已核对的 ${count} 条|Import ${count} reviewed)$`),
		}),
	).toBeVisible();
}
async function seedMain(h: Awaited<ReturnType<typeof visualHarness>>) {
	await h.configure();
	await h.createVault();
	await h.seedExisting({
		...pendingRecords[3],
		password: visualOldNotionPassword,
	});
	const importer = await h.open();
	await importer.locator("#pw-smart-source").fill(visualBatch.source);
	h.mock.responses.push(visualBatch.response);
	await recognizeAi(h.page, importer);
	await expect(importer.locator(".pw-work-list-row")).toHaveCount(54);
	await field(importer, "password").fill("");
	await editor(importer)
		.getByRole("button", { name: h.t("pwVaultAddIdentifier"), exact: true })
		.click();
	await editor(importer)
		.locator(".pw-smart-identifier-row input")
		.last()
		.fill("alex-demo");
	await importer
		.getByRole("button", { name: /^(批量核对|Bulk review)$/, exact: true })
		.click();
	const bulk = h.page.getByRole("dialog").last();
	// The fixture's 47 background entries are reviewed through the actual batch UI.
	// Keep pending accounts unchecked, including accounts with optional empty passwords.
	for (const username of [
		"alex@example.com",
		"design@example.com",
		"work@example.com",
		"dev@example.com",
		"studio@example.com",
	]) {
		const matches = bulk
			.locator("label")
			.filter({ hasText: username })
			.getByRole("checkbox");
		for (const checkbox of await matches.all()) await checkbox.uncheck();
	}
	await bulk
		.getByRole("button", {
			name: /^(已核对，全部选入|Reviewed, select all|Confirm reviewed|Select reviewed entries)$/,
			exact: true,
		})
		.click();
	await reviewCount(importer, 47);
	await expect(importer.locator(".pw-work-list-row")).toHaveCount(7);
	return importer;
}

for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} main 54 real candidates and review navigation`, async ({
		browser,
	}, info) => {
		const h = await visualHarness(browser, locale);
		const evidence = visualEvidence(h.page, info, locale);
		try {
			const importer = await seedMain(h);
			await expect(field(importer, "username")).toHaveValue("alex@example.com");
			await expect(field(importer, "password")).toHaveValue("");
			await evidence.capture(
				"00-main",
				"54 actual candidates; 47 reviewed and 7 pending; Outlook selected; Notion conflict.",
			);
			if (locale === "en")
				expect(await importer.innerText()).not.toMatch(/[\p{Script=Han}]/u);
			await row(importer, "dev@example.com").click();
			await expect(field(importer, "title")).toHaveValue("GitHub");
			await evidence.capture(
				"06-A",
				"Clicking a row selects its own independent account.",
			);
			await field(importer, "notes").fill(
				"Synthetic unfinished note kept in this dialog",
			);
			await importer
				.getByRole("button", { name: /^(暂时跳过|Skip for now)$/, exact: true })
				.click();
			await row(importer, "dev@example.com").click();
			await expect(field(importer, "notes")).toHaveValue(
				"Synthetic unfinished note kept in this dialog",
			);
			await evidence.capture(
				"06-D",
				"Skip advances while preserving the previous candidate's notes.",
			);
			await importer
				.getByRole("button", {
					name: /^(核对完成，下一条|Review complete, next|Reviewed, next|Review and next).*$/,
				})
				.click();
			await reviewCount(importer, 48);
			await evidence.capture(
				"06-C",
				"Completing a valid candidate increments reviewed count and advances.",
			);
			await importer.getByRole("tab", { name: /已核对|Reviewed/ }).click();
			await row(importer, "dev@example.com").click();
			expect(
				await importer
					.locator(".pw-work-list-scroll")
					.evaluate((node) => node.clientHeight),
			).toBeLessThanOrEqual(610);
			await evidence.capture(
				"06-B",
				"Reviewed entries remain scrollable within the list, with undo available.",
				undefined,
				"-reviewed",
			);
			await importer
				.getByRole("button", { name: /^(撤销核对|Undo review)$/, exact: true })
				.click();
			await reviewCount(importer, 47);
			await evidence.capture(
				"06-B",
				"Undo review removes only the selected candidate from import selection.",
			);
			expect(h.errors).toEqual([]);
		} finally {
			await h.close();
		}
	});
}

test("zh-CN controlled provider confirmation failure and cancel states", async ({
	browser,
}, info) => {
	const h = await visualHarness(browser, "zh-CN");
	const evidence = visualEvidence(h.page, info, "zh-CN");
	try {
		await h.configure();
		await h.createVault();
		await h.seedExisting({
			...pendingRecords[3],
			password: visualOldNotionPassword,
		});
		const importer = await h.open();
		const fixture = recognitionFixture(pendingRecords.slice(0, 3));
		await importer.locator("#pw-smart-source").fill(fixture.source);
		await evidence.capture(
			"01-A",
			"Pasted synthetic source is editable before any model request.",
		);
		await importer.locator('input[type="file"]').setInputFiles({
			name: "accounts.txt",
			mimeType: "text/plain",
			buffer: Buffer.from(fixture.source),
		});
		await expect(importer.locator("#pw-smart-source")).toHaveValue(
			fixture.source,
		);
		await evidence.capture(
			"01-B",
			"UTF-8 file content appears through the real file input.",
		);
		h.mock.responses.push("malformed synthetic response");
		await aiButton(importer).click();
		const consent = h.page.getByRole("dialog").last();
		await expect(consent).toContainText(model);
		await expect(consent).toContainText(h.mock.baseURL);
		await expect(consent).toContainText(/密码/);
		expect(h.mock.requests).toHaveLength(0);
		await evidence.capture(
			"01-C",
			"Model and endpoint disclosure precedes the first network request.",
		);
		await confirmRecognition(h.page);
		await expect(importer).toContainText(h.t("pwSmartAiResponseFormat"));
		await expect(importer.locator("#pw-smart-source")).toHaveValue(
			fixture.source,
		);
		await evidence.capture(
			"02-C",
			"Malformed provider output preserves exact source and reports only the failure category.",
			undefined,
			"-format",
		);
		const sent = JSON.stringify(h.mock.requests[0].body);
		expect(sent).toContain("alex@example.com");
		expect(sent).not.toContain(visualOldNotionPassword);
		expect(sent).not.toContain("Synthetic visual acceptance master");
		const endpoint = `${h.mock.baseURL}/chat/completions`;
		let release!: () => void;
		let arrived!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const received = new Promise<void>((resolve) => {
			arrived = resolve;
		});
		await h.page.route(endpoint, async (route) => {
			arrived();
			await gate;
			await route.abort().catch(() => undefined);
		});
		await recognizeAi(h.page, importer);
		await received;
		await expect(importer.locator("#pw-smart-source")).toBeDisabled();
		await evidence.capture(
			"01-D",
			"Busy recognition disables source editing and exposes cancel.",
		);
		await importer
			.getByRole("button", {
				name: /^(取消识别|Cancel recognition)$/,
				exact: true,
			})
			.click();
		release();
		await h.page.unroute(endpoint);
		await expect(importer.locator("#pw-smart-source")).toHaveValue(
			fixture.source,
		);
		await expect(importer.locator("#pw-smart-source")).toBeEnabled();
		await evidence.capture(
			"11-B",
			"Cancellation returns to editable source without losing pasted text.",
		);
		h.mock.responses.push(fixture.response);
		await recognizeAi(h.page, importer);
		await expect(importer.locator(".pw-work-list-row")).toHaveCount(3);
		await reviewCount(importer, 0);
		await evidence.capture(
			"02-B",
			"Controlled AI results are not automatically reviewed.",
		);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

test("zh-CN account editing source copy and paste controls", async ({
	browser,
}, info) => {
	const h = await visualHarness(browser, "zh-CN");
	const evidence = visualEvidence(h.page, info, "zh-CN");
	try {
		const importer = await seedMain(h);
		await importer
			.getByRole("button", { name: "新增同平台账号", exact: true })
			.click();
		await expect(field(importer, "title")).toHaveValue("Outlook");
		for (const key of ["username", "password", "notes"])
			await expect(field(importer, key)).toHaveValue("");
		await evidence.capture(
			"03-A",
			"New same-platform account copies only the platform identity.",
		);
		await row(importer, "alex@example.com").click();
		await editor(importer)
			.getByRole("button", { name: h.t("pwVaultAddIdentifier"), exact: true })
			.click();
		const aliases = editor(importer).locator(".pw-smart-identifier-row input");
		await aliases.last().fill("alex-work");
		await evidence.capture(
			"03-B",
			"Alternative login identifiers stay on the same candidate.",
		);
		const addUrl = editor(importer).getByRole("button", {
			name: h.t("pwVaultAddUrl"),
			exact: true,
		});
		if (await addUrl.isVisible()) await addUrl.click();
		await field(importer, "url").fill("https://outlook.live.com");
		await field(importer, "notes").fill("工作账号");
		await evidence.capture(
			"03-C",
			"Notes and an optional valid website are editable.",
		);
		await field(importer, "title").fill("");
		await importer.getByRole("button", { name: /核对完成.*下一条/ }).click();
		await expect(field(importer, "title")).toBeFocused();
		await evidence.capture(
			"03-D",
			"Review of a missing name focuses the required name field.",
		);
		await field(importer, "title").fill("Outlook");
		const source = editor(importer).locator(".pw-import-source-card");
		await h.context.grantPermissions(["clipboard-read", "clipboard-write"]);
		await source
			.locator(".pw-smart-source-line")
			.nth(2)
			.getByRole("button")
			.click();
		await editor(importer)
			.getByRole("button", { name: "粘贴密码", exact: true })
			.click();
		await expect(field(importer, "password")).toHaveValue("Demo-only!42");
		await expect(source.getByRole("checkbox")).toHaveCount(0);
		await expect(source.getByRole("combobox")).toHaveCount(0);
		await evidence.capture(
			"04-A",
			"Each source row has a copy action; no source selection or field menu remains.",
		);
		await evidence.capture(
			"04-B",
			"Copying the masked password row and pasting fills the exact credential.",
		);
		await source
			.getByRole("button", { name: h.t("pwVaultShowPassword"), exact: true })
			.click();
		await evidence.capture(
			"04-C",
			"Source password visibility is independent of per-row copying.",
		);
		await source.getByRole("button", { name: /更换条目/ }).click();
		await evidence.capture(
			"04-D",
			"Changing target requires explicit candidate selection.",
		);
		await h.page.keyboard.press("Escape");
		await source
			.getByRole("button", { name: h.t("pwSmartSourceExcerpt"), exact: true })
			.click();
		await expect(source.locator(".pw-smart-source-content")).toBeHidden();
		await evidence.capture(
			"11-C",
			"Source content collapses independently of edited fields.",
		);
		await source
			.getByRole("button", { name: h.t("pwSmartSourceExcerpt"), exact: true })
			.click();
		const eye = editor(importer)
			.locator(".pw-smart-password")
			.getByRole("button");
		await eye.click();
		await expect(field(importer, "password")).toHaveAttribute("type", "text");
		await evidence.capture(
			"10-C",
			"Password field reveal leaves other source reveal controls independent.",
		);
		await eye.click();
		await editor(importer)
			.getByRole("button", {
				name: h.t("pwVaultRemoveIdentifier", { count: 2 }),
				exact: true,
			})
			.click();
		await expect(aliases).toHaveCount(1);
		await expect(aliases.first()).toHaveValue("alex-demo");
		await evidence.capture(
			"10-C",
			"Removing one identifier leaves the other account identifier unchanged.",
			undefined,
			"-remove",
		);
		const primary = importer.getByRole("button", { name: /核对完成.*下一条/ });
		await primary.hover();
		await evidence.capture(
			"10-D",
			"Primary button hover uses the application theme.",
			undefined,
			"-hover",
		);
		await primary.focus();
		await evidence.capture(
			"10-D",
			"Primary button keyboard focus is visibly outlined.",
			undefined,
			"-focus",
		);
		expect(await importer.locator("select").count()).toBe(0);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

test("zh-CN mapping append original line numbers and return preservation", async ({
	browser,
}, info) => {
	const h = await visualHarness(browser, "zh-CN");
	const evidence = visualEvidence(h.page, info, "zh-CN");
	try {
		await h.configure();
		await h.createVault();
		const importer = await h.open();
		const source =
			"Outlook\nalex@example.com\nDemo-only!42\n\nOutlook\nwork@example.com\nDemo-only-work!42\n说明文字";
		await importer.locator("#pw-smart-source").fill(source);
		await importer
			.getByRole("button", { name: h.t("pwSmartMap"), exact: true })
			.click();
		await importer.locator("#pw-map-field-1").click();
		await evidence.capture(
			"05-A",
			"Mapping uses the themed field selector and original source line numbers.",
		);
		await h.page.keyboard.press("Escape");
		for (const [number, value] of [
			[1, "title"],
			[2, "username"],
			[3, "password"],
			[4, "ignore"],
			[5, "title"],
			[6, "username"],
			[7, "password"],
			[8, "ignore"],
		] as const) {
			await selectChoice(importer.locator(`#pw-map-field-${number}`), value);
		}
		await importer
			.getByRole("checkbox", {
				name: h.t("pwSmartMapStart", { line: 5 }),
				exact: true,
			})
			.check();
		await evidence.capture(
			"05-B",
			"Two explicit starts split two independent accounts; blank and explanatory lines remain numbered.",
		);
		await importer
			.getByRole("button", { name: h.t("pwSmartMapReview"), exact: true })
			.click();
		await importer.getByRole("tab", { name: /已核对/ }).click();
		await expect(importer.locator(".pw-work-list-row")).toHaveCount(2);
		await field(importer, "notes").fill("Synthetic review draft remains");
		await goInput(importer);
		await importer.locator("#pw-smart-source").fill(`${source}\nExtra note`);
		await expect(importer).toContainText(h.t("pwSmartSourceChangedHint"));
		await evidence.capture(
			"05-D",
			"Changing source displays replacement warning while preserving the existing review.",
		);
		await importer
			.getByRole("button", { name: h.t("pwSmartBackToReview"), exact: true })
			.click();
		await expect(field(importer, "notes")).toHaveValue(
			"Synthetic review draft remains",
		);
		await goInput(importer);
		await importer
			.locator("#pw-smart-source")
			.fill("New service\nnew@example.com\nDemo-only-new!42");
		await h.page
			.getByRole("combobox", { name: "其他输入方式", exact: true })
			.click();
		await h.page
			.getByRole("option", { name: h.t("pwSmartMap"), exact: true })
			.click();
		// Existing mapping choices intentionally remain until edited; explicitly set the current rows.
		for (const [number, value] of [
			[1, "title"],
			[2, "username"],
			[3, "password"],
		] as const) {
			await selectChoice(importer.locator(`#pw-map-field-${number}`), value);
		}
		await importer
			.getByRole("button", { name: h.t("pwSmartMapAdd"), exact: true })
			.click();
		await evidence.capture(
			"05-C",
			"Mapped entries append to the existing review batch.",
		);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

test("zh-CN duplicate conflict bulk tools save and draft close confirmations", async ({
	browser,
}, info) => {
	const h = await visualHarness(browser, "zh-CN");
	const evidence = visualEvidence(h.page, info, "zh-CN");
	try {
		const importer = await seedMain(h);
		await row(importer, "team@example.com").click();
		await editor(importer)
			.getByRole("combobox", { name: "保存方式", exact: true })
			.click();
		await evidence.capture(
			"07-B",
			"A password conflict defaults to skip and requires an explicit save action.",
		);
		await h.page.getByRole("option", { name: /更新 Notion/ }).click();
		await expect(editor(importer)).toContainText("将保留旧密码历史");
		await evidence.capture(
			"07-C",
			"Update is tied to the selected existing Notion identity.",
		);
		await field(importer, "password").fill(visualOldNotionPassword);
		await field(importer, "notes").fill("Synthetic metadata-only update");
		await editor(importer)
			.getByRole("combobox", { name: "保存方式", exact: true })
			.click();
		await evidence.capture(
			"07-D",
			"Same-password metadata changes use explicit update, never a duplicated entry.",
		);
		await h.page.keyboard.press("Escape");
		await importer
			.getByRole("button", { name: "批量核对", exact: true })
			.click();
		await evidence.capture(
			"08-A",
			"Batch selection excludes missing fields and identity conflicts.",
		);
		await h.page
			.getByRole("dialog")
			.last()
			.getByRole("button", { name: "返回", exact: true })
			.click();
		await importer.getByRole("combobox", { name: "更多", exact: true }).click();
		await expect(h.page.getByRole("listbox")).toHaveCSS("width", "220px");
		await evidence.capture(
			"08-B",
			"More actions use the existing custom themed menu.",
		);
		await expect(
			h.page.getByRole("option", { name: "整理网站名称", exact: true }),
		).toHaveAttribute("aria-disabled", "true");
		await h.page.keyboard.press("Escape");
		await importer.getByRole("button", { name: /导入已核对的 \d+ 条/ }).click();
		await evidence.capture(
			"09-A",
			"Final confirmation shows current add/update counts before KDBX write.",
		);
		await h.page
			.getByRole("dialog")
			.last()
			.getByRole("button", { name: "确认导入", exact: true })
			.click();
		await expect(importer.locator(".pw-smart-receipt")).toBeVisible();
		await evidence.capture(
			"09-B",
			"A successful atomic batch leaves pending candidates available in the same dialog.",
		);
		await h.page
			.getByRole("combobox", { name: "导入操作菜单", exact: true })
			.click();
		await expect(h.page.getByRole("listbox")).toHaveCSS("width", "220px");
		await evidence.capture(
			"11-A",
			"Import actions exposes model details and lock-close.",
			undefined,
			"-menu",
		);
		await h.page.getByRole("option", { name: "模型详情", exact: true }).click();
		await evidence.capture(
			"11-A",
			"Model details show the configured model and endpoint.",
			undefined,
			"-details",
		);
		await h.page
			.getByRole("dialog")
			.last()
			.getByRole("button", { name: "关闭", exact: true })
			.click();
		await importer
			.getByRole("button", { name: h.t("pwSmartLockClose"), exact: true })
			.click();
		await evidence.capture(
			"10-B",
			"Lock-close confirms clearing only this unimported draft.",
		);
		await h.page
			.getByRole("dialog")
			.last()
			.getByRole("button", { name: "取消", exact: true })
			.click();
		await h.page
			.getByRole("dialog", { name: h.t("pwSmartTitle"), exact: true })
			.getByRole("button", { name: "关闭", exact: true })
			.click();
		await evidence.capture(
			"10-A",
			"Closing a nonempty draft requires clear-draft confirmation.",
		);
		await h.page
			.getByRole("dialog")
			.last()
			.getByRole("button", { name: "关闭并清空", exact: true })
			.click();
		await h.open();
		await expect(importer.locator("#pw-smart-source")).toHaveValue("");
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

async function closeImport(page: Page, t: (key: string) => string) {
	await page
		.getByRole("dialog", { name: t("pwSmartTitle"), exact: true })
		.getByRole("button", { name: /^(关闭|Close)$/, exact: true })
		.first()
		.click();
	const confirm = page.getByRole("button", {
		name: /^(关闭并清空|Close and clear)$/,
		exact: true,
	});
	if (await confirm.isVisible()) await confirm.click();
	await expect(page.locator(".password-smart-import")).toHaveCount(0);
}
async function localRecognize(
	h: Awaited<ReturnType<typeof visualHarness>>,
	importer: Locator,
	source: string,
) {
	await importer.locator("#pw-smart-source").fill(source);
	await importer
		.getByRole("button", { name: h.t("pwSmartRecognize"), exact: true })
		.click();
}
async function confirmSave(page: Page, importer: Locator) {
	await importer
		.getByRole("button", {
			name: /^(导入已核对的 \d+ 条|Import \d+ reviewed)$/,
			exact: true,
		})
		.click();
	await page
		.getByRole("dialog")
		.last()
		.getByRole("button", { name: /^(确认导入|Confirm import)$/, exact: true })
		.click();
}

test("zh-CN atomic KDBX save supplementary import and cross-tab stale draft recovery", async ({
	browser,
}, info) => {
	const h = await visualHarness(browser, "zh-CN");
	const evidence = visualEvidence(h.page, info, "zh-CN");
	try {
		await h.configure();
		await h.createVault();
		let importer = await h.open();
		const source =
			'Title=Outlook\nUsername=alex@example.com\nPassword="Demo-only-first!42"\n\nTitle=Outlook\nUsername=work@example.com\nPassword="Demo-only-second!42"\n\nTitle=Figma\nUsername=design@example.com\nPassword="Demo-only-figma!42"';
		await localRecognize(h, importer, source);
		await importer.getByRole("tab", { name: /已核对/ }).click();
		await row(importer, "design@example.com").click();
		await field(importer, "password").fill("");
		await evidence.capture(
			"02-A",
			"Local labeled entries are selected while incomplete Figma stays pending.",
		);
		await row(importer, "alex@example.com").click();
		await editor(importer)
			.getByRole("button", { name: h.t("pwVaultAddIdentifier"), exact: true })
			.click();
		await editor(importer)
			.locator(".pw-smart-identifier-row input")
			.last()
			.fill("alex-demo");
		await importer
			.getByRole("button", { name: "核对完成，下一条", exact: true })
			.click();
		const before = await visualVaultFingerprint(h.page);
		// Inject one storage failure at the real browser persistence boundary, never into React state.
		await h.page.evaluate(() => {
			const original = IDBObjectStore.prototype.put;
			IDBObjectStore.prototype.put = function (
				...args: Parameters<IDBObjectStore["put"]>
			) {
				if (this.name === "passwordVault") {
					IDBObjectStore.prototype.put = original;
					throw new DOMException(
						"Synthetic acceptance write fault",
						"QuotaExceededError",
					);
				}
				return original.apply(this, args);
			};
		});
		await confirmSave(h.page, importer);
		await expect(importer).toContainText(h.t("pwSmartFailed"));
		expect(await visualVaultFingerprint(h.page)).toEqual(before);
		await expect(importer.locator(".pw-smart-receipt")).toHaveCount(0);
		await evidence.capture(
			"09-C",
			"Injected KDBX persistence failure writes no candidate and preserves review choices.",
			undefined,
			"-atomic-failure",
		);
		await confirmSave(h.page, importer);
		await expect(importer.locator(".pw-smart-receipt")).toBeVisible();
		await importer.getByRole("tab", { name: /待处理/ }).click();
		await row(importer, "design@example.com").click();
		await editor(importer)
			.getByRole("button", { name: "更换条目", exact: true })
			.click();
		const target = h.page.getByRole("dialog").last();
		await target
			.getByRole("button", { name: "Outlook · alex@example.com", exact: true })
			.click();
		await target.getByRole("button", { name: "确定", exact: true }).click();
		for (const key of ["title", "username"])
			await expect(field(importer, key)).toHaveAttribute("readonly", "");
		await expect(
			editor(importer).getByRole("button", {
				name: h.t("pwVaultAddUrl"),
				exact: true,
			}),
		).toBeDisabled();
		await field(importer, "notes").fill(
			"Synthetic supplement to already imported entry",
		);
		await evidence.capture(
			"09-D",
			"Supplementing an imported entry keeps name, account and URL readonly.",
		);
		await importer
			.getByRole("button", { name: "核对更新", exact: true })
			.click();
		await confirmSave(h.page, importer);
		await expect(importer.locator(".pw-smart-receipt")).toContainText("更新 1");
		await closeImport(h.page, h.t);
		const download = h.page.waitForEvent("download");
		await h.page
			.getByRole("button", { name: h.t("pwVaultExport"), exact: true })
			.click();
		const exported = await download;
		const path = info.outputPath("synthetic-visual-acceptance.kdbx");
		await exported.saveAs(path);
		const entries = await inspectVisualKdbx(path);
		expect(entries).toHaveLength(2);
		const first = entries.find(
			({ draft }) => draft.username === "alex@example.com",
		)?.draft;
		const second = entries.find(
			({ draft }) => draft.username === "work@example.com",
		)?.draft;
		expect(first?.password).toBe("Demo-only-first!42");
		expect(first?.usernameAliases).toEqual(["alex-demo"]);
		expect(first?.notes).toBe("Synthetic supplement to already imported entry");
		expect(second?.password).toBe("Demo-only-second!42");
		await h.page.reload();
		await h.page.locator("#password-vault-unlock-master").fill(visualMaster);
		await h.page
			.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true })
			.click();
		await expect(
			h.page.locator(".password-vault-entry-list .password-vault-entry"),
		).toHaveCount(2);
		importer = await h.open();
		await localRecognize(h, importer, source);
		await row(importer, "alex@example.com").click();
		await evidence.capture(
			"07-A",
			"Existing same-account and same-password entries default to duplicate skip.",
		);
		await field(importer, "notes").fill(
			"Synthetic draft survives cross-tab change",
		);
		const secondPage = await h.context.newPage();
		await secondPage.goto("/assets/vault");
		await secondPage
			.locator("#password-vault-unlock-master")
			.fill(visualMaster);
		await secondPage
			.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true })
			.click();
		await secondPage
			.locator(".password-vault-entry-list .password-vault-entry")
			.filter({ hasText: "alex@example.com" })
			.getByRole("button", { name: h.t("pwVaultEditEntry"), exact: true })
			.click();
		await secondPage
			.locator("#password-vault-entry-password")
			.fill("Demo-only-external-update!42");
		await secondPage
			.getByRole("button", { name: h.t("pwVaultSaveEntry"), exact: true })
			.click();
		await expect(importer.locator(".pw-smart-stale")).toBeVisible();
		await expect(field(importer, "notes")).toHaveValue(
			"Synthetic draft survives cross-tab change",
		);
		await expect(
			importer.getByRole("button", { name: /导入已核对的/ }),
		).toBeDisabled();
		await evidence.capture(
			"09-C",
			"An actual second-tab write blocks the old revision and retains the current draft.",
			undefined,
			"-stale",
		);
		await importer.locator("#pw-smart-unlock").fill(visualMaster);
		await importer
			.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true })
			.click();
		await expect(importer.locator(".pw-smart-stale")).toHaveCount(0);
		await expect(field(importer, "notes")).toHaveValue(
			"Synthetic draft survives cross-tab change",
		);
		await expect(
			editor(importer).getByRole("combobox", { name: "保存方式", exact: true }),
		).toHaveAttribute("data-value", "skip");
		await secondPage.close();
		await importer
			.getByRole("button", { name: h.t("pwSmartLockClose"), exact: true })
			.click();
		await h.page
			.getByRole("dialog")
			.last()
			.getByRole("button", { name: h.t("pwSmartLockClose"), exact: true })
			.click();
		await expect(importer).toHaveCount(0);
		await h.page.locator("#password-vault-unlock-master").fill(visualMaster);
		await h.page
			.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true })
			.click();
		importer = await h.open();
		await expect(importer.locator("#pw-smart-source")).toHaveValue("");
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} 390px unavailable model and multiline password controls`, async ({
		browser,
	}, info) => {
		const h = await visualHarness(browser, locale, { width: 390, height: 844 });
		const evidence = visualEvidence(h.page, info, locale);
		const multiline = "  Demo-line-1\r\nDemo-line-2\nDemo-line-3  ";
		try {
			await h.configure();
			await h.page.reload();
			await h.createVault();
			const importer = await h.open();
			await importer
				.locator("#pw-smart-source")
				.fill(
					`Title=Outlook\nUsername=alex@example.com\nPassword=${JSON.stringify(multiline)}`,
				);
			await expect(aiButton(importer)).toBeDisabled();
			await evidence.capture(
				"02-D",
				"Configured but inactive model is recoverable inside import; source remains editable.",
			);
			await importer
				.getByRole("button", { name: h.t("pwSmartRecognize"), exact: true })
				.click();
			await importer.getByRole("tab", { name: /已核对|Reviewed/ }).click();
			await row(importer, "alex@example.com").click();
			const password = field(importer, "password");
			await expect(password).toHaveAttribute("readonly", "");
			await h.context.grantPermissions(["clipboard-read", "clipboard-write"]);
			await editor(importer)
				.locator(".pw-smart-source-line")
				.nth(2)
				.getByRole("button")
				.click();
			expect(await h.page.evaluate(() => navigator.clipboard.readText())).toBe(
				multiline,
			);
			await editor(importer)
				.getByRole("button", {
					name: locale === "en" ? "Paste Password" : "粘贴密码",
					exact: true,
				})
				.click();

			const eye = editor(importer)
				.locator(".pw-smart-password")
				.getByRole("button");
			await eye.click();
			await expect(password).toHaveValue(multiline.replace(/\r\n/g, "\n"));
			await evidence.capture(
				"11-D",
				"A multi-line fake password is revealed with original line and whitespace structure.",
				undefined,
				"-shown",
			);
			await eye.click();
			await expect(password).not.toHaveValue(/Demo-line/);
			await evidence.capture(
				"11-D",
				"Hiding a multi-line password masks each line without changing the saved value.",
				undefined,
				"-hidden",
			);
			if (locale === "en")
				expect(await importer.innerText()).not.toMatch(/[\p{Script=Han}]/u);
			expect(
				await h.page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(391);
			await importer
				.getByRole("button", {
					name: /^(核对完成，下一条|Reviewed, next entry)$/,
					exact: true,
				})
				.click();
			await confirmSave(h.page, importer);
			await expect(importer.locator(".pw-smart-receipt")).toBeVisible();
			await closeImport(h.page, h.t);
			const download = h.page.waitForEvent("download");
			await h.page
				.getByRole("button", { name: h.t("pwVaultExport"), exact: true })
				.click();
			const path = info.outputPath(`synthetic-multiline-${locale}.kdbx`);
			await (await download).saveAs(path);
			const entries = await inspectVisualKdbx(path);
			expect(entries[0].draft.password).toBe(multiline);
			expect(h.errors).toEqual([]);
		} finally {
			await h.close();
		}
	});
}

test("zh-CN website title preview excludes credentials and returned titles need review", async ({
	browser,
}, info) => {
	const h = await visualHarness(browser, "zh-CN");
	const evidence = visualEvidence(h.page, info, "zh-CN");
	try {
		await h.configure();
		await h.createVault();
		const importer = await h.open();
		await localRecognize(
			h,
			importer,
			'Website=https://github.com/\nUsername=dev@example.com\nPassword="Demo-only-github!42"\n\nWebsite=https://notion.so/\nUsername=team@example.com\nPassword="Demo-only-new-Notion!42"',
		);
		await importer.getByRole("combobox", { name: "更多", exact: true }).click();
		await h.page
			.getByRole("option", { name: "整理网站名称", exact: true })
			.click();
		const consent = h.page.getByRole("dialog").last();
		await expect(consent).not.toContainText("team@example.com");
		await expect(consent).not.toContainText(visualOldNotionPassword);
		await evidence.capture(
			"08-C",
			"Title organization shows only domains and temporary IDs.",
		);
		h.mock.responses.push(
			JSON.stringify({
				records: [
					{ id: "vault-import-1", title: "GitHub" },
					{ id: "vault-import-2", title: "Notion" },
				],
			}),
		);
		await consent
			.getByRole("button", { name: "确认整理", exact: true })
			.click();
		await expect(importer).toContainText(h.t("pwSmartAiDone"));
		const sent = JSON.stringify(h.mock.requests.at(-1)?.body);
		for (const privateValue of [
			"team@example.com",
			visualOldNotionPassword,
			"Synthetic metadata-only update",
			"Demo-only-github!42",
		])
			expect(sent).not.toContain(privateValue);
		await evidence.capture(
			"08-D",
			"Returned website names remain subject to review; request excludes private fields.",
		);

		await reviewCount(importer, 0);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

test("zh-CN provider truncation and timeout preserve the existing review", async ({
	browser,
}, info) => {
	const h = await visualHarness(browser, "zh-CN");
	const evidence = visualEvidence(h.page, info, "zh-CN");
	const fixture = recognitionFixture([
		{
			title: "Synthetic provider service",
			username: "demo@example.com",
			password: "Demo-only!42",
		},
	]);
	try {
		await h.configure();
		await h.createVault();
		const importer = await h.open();
		await importer.locator("#pw-smart-source").fill(fixture.source);
		h.mock.responses.push(fixture.response);
		await recognizeAi(h.page, importer);
		await field(importer, "notes").fill("Synthetic retained review");
		await goInput(importer);
		const endpoint = `${h.mock.baseURL}/chat/completions`;
		await h.page.route(endpoint, (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					id: "synthetic-truncated",
					object: "chat.completion",
					created: 1791150000,
					model,
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: '{"records":[' },
							finish_reason: "length",
						},
					],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			}),
		);
		await recognizeAi(h.page, importer);
		await expect(importer).toContainText(h.t("pwSmartAiOutputLimit"));
		await expect(importer.locator("#pw-smart-source")).toHaveValue(
			fixture.source,
		);
		await evidence.capture(
			"02-C",
			"Actual provider length finish reason is rejected while source and prior review remain.",
			undefined,
			"-truncated",
		);
		await h.page.unroute(endpoint);
		await h.page.clock.install();
		let release!: () => void;
		let arrived!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const received = new Promise<void>((resolve) => {
			arrived = resolve;
		});
		await h.page.route(endpoint, async (route) => {
			arrived();
			await gate;
			await route.abort().catch(() => {});
		});
		await recognizeAi(h.page, importer);
		await received;
		await h.page.clock.fastForward(120_001);
		await expect(importer).toContainText(h.t("pwSmartAiTimeout"));
		release();
		await h.page.unroute(endpoint);
		await expect(importer.locator("#pw-smart-source")).toHaveValue(
			fixture.source,
		);
		await evidence.capture(
			"02-C",
			"The application's real 120-second timeout fires under browser clock control; no source or review loss.",
			undefined,
			"-timeout",
		);
		await importer
			.getByRole("button", { name: h.t("pwSmartBackToReview"), exact: true })
			.click();
		await expect(field(importer, "notes")).toHaveValue(
			"Synthetic retained review",
		);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} quick clipboard exact values and compact desktop layout`, async ({
		browser,
	}, info) => {
		const h = await visualHarness(browser, locale, {
			width: 1218,
			height: 808,
		});
		const evidence = visualEvidence(h.page, info, locale);
		try {
			const importer = await seedMain(h);
			await h.context.grantPermissions(["clipboard-read", "clipboard-write"]);
			const source = editor(importer).locator(".pw-import-source-card");
			const paste = (key: string) =>
				field(importer, key)
					.locator(
						"xpath=ancestor::div[contains(@class,'pw-import-input-control')][1]",
					)
					.getByRole("button")
					.last();
			await source
				.locator(".pw-smart-source-line")
				.nth(1)
				.getByRole("button")
				.click();
			await paste("username").click();
			await expect(field(importer, "username")).toHaveValue("alex@example.com");
			await source
				.locator(".pw-smart-source-line")
				.nth(2)
				.getByRole("button")
				.click();
			await paste("password").click();
			await expect(field(importer, "password")).toHaveValue("Demo-only!42");
			await evidence.capture(
				"00-main",
				"1218x808 compact review with seven pending accounts, an alias, and row copy / field paste.",
			);
			const metrics = await h.page
				.locator(".dialog.password-smart-import-dialog")
				.evaluate((node) => ({
					height: node.scrollHeight,
					client: node.clientHeight,
					width: node.scrollWidth,
					clientWidth: node.clientWidth,
				}));
			expect(metrics.height, JSON.stringify(metrics)).toBeLessThanOrEqual(
				metrics.client + 1,
			);
			expect(metrics.width).toBeLessThanOrEqual(metrics.clientWidth + 1);
			// Browser clipboard values remain exact even when the password control becomes a textarea.
			const secret = "  Synthetic-only!\r\nsecond line  ";
			await h.page.evaluate(
				(text) => navigator.clipboard.writeText(text),
				secret,
			);
			await paste("password").click();
			await editor(importer)
				.locator(".pw-smart-password")
				.getByRole("button")
				.click();
			await expect(field(importer, "password")).toHaveValue(
				secret.replace(/\r\n/g, "\n"),
			);
			await importer
				.getByRole("button", { name: /^(下一条|Next entry)$/, exact: true })
				.click();
			await importer
				.getByRole("button", { name: /^(上一条|Previous entry)$/, exact: true })
				.click();
			await editor(importer)
				.locator(".pw-smart-password")
				.getByRole("button")
				.click();
			await expect(field(importer, "password")).toHaveValue(
				secret.replace(/\r\n/g, "\n"),
			);
			await h.page.evaluate(() => {
				Object.defineProperty(navigator.clipboard, "readText", {
					configurable: true,
					value: () =>
						Promise.reject(new DOMException("Denied", "NotAllowedError")),
				});
			});
			await paste("username").click();
			await expect(
				editor(importer).locator(".pw-import-paste-error"),
			).toBeVisible();
			await expect(field(importer, "username")).toHaveValue("alex@example.com");
			await h.page.evaluate(() => {
				Object.defineProperty(navigator.clipboard, "readText", {
					configurable: true,
					value: () =>
						new Promise<string>((resolve) => {
							(
								window as unknown as { resolvePaste: (text: string) => void }
							).resolvePaste = resolve;
						}),
				});
			});
			await paste("username").click();
			await importer
				.getByRole("button", { name: /^(下一条|Next entry)$/, exact: true })
				.click();
			await h.page.evaluate(() =>
				(
					window as unknown as { resolvePaste: (text: string) => void }
				).resolvePaste("late-synthetic-value"),
			);
			await expect(field(importer, "username")).toHaveValue("work@example.com");
			await importer
				.getByRole("button", { name: /^(上一条|Previous entry)$/, exact: true })
				.click();
			await expect(field(importer, "username")).toHaveValue("alex@example.com");
		} finally {
			await h.close();
		}
	});
}
