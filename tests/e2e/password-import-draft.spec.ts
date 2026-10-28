import { openVaultAccess } from "./helpers/vault-access";
import { expect, type Locator, test } from "@playwright/test";
import {
	inspectVisualKdbx,
	recognitionFixture,
	visualHarness,
	visualMaster,
} from "./fixtures/password-smart-import-visual";

test.setTimeout(150_000);
const editor = (scope: Locator) => scope.locator(".pw-work-editor");
const field = (scope: Locator, name: string) =>
	scope.locator(`[id$='-${name}']`).first();

for (const locale of ["zh-CN", "en"] as const) {
	for (const width of [1280, 390]) {
		test(`${locale} ${width}px encrypted AI draft survives reload and lock without resending`, async ({
			browser,
		}, info) => {
			const h = await visualHarness(browser, locale, { width, height: 900 });
			try {
				await h.configure();
				await h.createVault();
				let importer = await h.open();
				const fixture = recognitionFixture([
					{
						title: "Synthetic Google app",
						username: "reader@example.test",
						password: "",
					},
					{
						title: "Synthetic second app",
						username: "second@example.test",
						password: "Synthetic-only!42",
					},
				]);
				const extra = "Unassigned synthetic memo";
				const source = `${fixture.source}\n${extra}`;
				const response = JSON.parse(fixture.response);
				response.ignoredLines.push(source.split("\n").length);
				h.mock.responses.push(JSON.stringify(response));
				await importer.locator("#pw-smart-source").fill(source);
				await importer
					.getByRole("button", {
						name: /^(用 AI 识别|用 .* 识别清单|Recognize with AI|Recognize list with .*)$/,
					})
					.click();
				await h.page
					.getByRole("button", { name: /^(确认识别|Confirm recognition)$/ })
					.click();
				await expect(importer.locator(".pw-work-list-row")).toHaveCount(3);
				await field(editor(importer), "notes").fill(
					"Synthetic edited note kept after refresh",
				);
				await editor(importer)
					.getByRole("button", {
						name: h.t("pwVaultAddIdentifier"),
						exact: true,
					})
					.click();
				await editor(importer)
					.locator(".pw-smart-identifier-row input")
					.last()
					.fill("synthetic-google-alias");
				await importer
					.getByRole("button", {
						name: /^(核对完成，下一条|Review complete, next|Review and next|Reviewed, next entry)$/,
					})
					.click();
				await importer.locator(".pw-work-list-row").last().click();
				const fragment = importer.locator(".pw-smart-fragment-form");
				await field(fragment, "title").fill("Synthetic pending app");
				await field(fragment, "username").fill("pending@example.test");
				await field(fragment, "notes").fill(
					"Synthetic unsubmitted fragment note",
				);
				await expect(h.page.locator(".pw-smart-draft-status")).toHaveText(
					h.t("pwSmartDraftSaved"),
				);
				expect(h.mock.requests).toHaveLength(1);
				await h.page.screenshot({
					path: info.outputPath(`draft-${locale}-${width}-before.png`),
				});

				// A fresh page runs the new application initialization and requires vault unlock.
				await h.page.reload();
				await openVaultAccess(h.page);
				await h.page
					.locator("#password-vault-unlock-master")
					.fill(visualMaster);
				await h.page
					.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true })
					.click();
				importer = await h.open();
				await expect(
					field(importer.locator(".pw-smart-fragment-form"), "notes"),
				).toHaveValue("Synthetic unsubmitted fragment note");
				await expect(
					field(importer.locator(".pw-smart-fragment-form"), "title"),
				).toHaveValue("Synthetic pending app");
				await expect(
					importer.getByRole("button", {
						name: /^(导入已核对的 1 条|Import 1 reviewed)$/,
					}),
				).toBeVisible();
				await importer.getByRole("tab", { name: /已核对|Reviewed/ }).click();
				await importer
					.locator(".pw-work-list-row")
					.filter({ hasText: "reader@example.test" })
					.click();
				await expect(field(editor(importer), "password")).toHaveValue("");
				await expect(field(editor(importer), "notes")).toHaveValue(
					"Synthetic edited note kept after refresh",
				);
				await expect(
					editor(importer).locator(".pw-smart-identifier-row input").last(),
				).toHaveValue("synthetic-google-alias");
				expect(h.mock.requests).toHaveLength(1);

				// Closing immediately after an edit flushes encryption before unmounting.
				await field(editor(importer), "notes").fill(
					"Synthetic note saved on close",
				);
				await h.page
					.getByRole("dialog", { name: h.t("pwSmartTitle"), exact: true })
					.getByRole("button", { name: /^(关闭|Close)$/, exact: true })
					.first()
					.click();
				await h.page
					.getByRole("button", {
						name: h.t("pwSmartCloseKeepDraft"),
						exact: true,
					})
					.click();
				await expect(importer).toHaveCount(0);
				await h.page
					.getByRole("button", { name: h.t("pwVaultLock"), exact: true })
					.click();
				await openVaultAccess(h.page);
				await h.page
					.locator("#password-vault-unlock-master")
					.fill(visualMaster);
				await h.page
					.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true })
					.click();
				importer = await h.open();
				await expect(field(editor(importer), "notes")).toHaveValue(
					"Synthetic note saved on close",
				);
				await expect(
					editor(importer).locator(".pw-smart-identifier-row input").last(),
				).toHaveValue("synthetic-google-alias");
				expect(h.mock.requests).toHaveLength(1);
				await h.page.screenshot({
					path: info.outputPath(`draft-${locale}-${width}-restored.png`),
				});
				expect(
					await h.page
						.locator(".password-smart-import-dialog")
						.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
				).toBe(true);
				if (locale === "en")
					expect(await importer.innerText()).not.toMatch(/[\p{Script=Han}]/u);

				// Explicit discard deletes only the draft; it is never imported as a login.
				await h.page
					.getByRole("dialog", { name: h.t("pwSmartTitle"), exact: true })
					.getByRole("button", { name: /^(关闭|Close)$/, exact: true })
					.first()
					.click();
				await h.page
					.getByRole("button", {
						name: /^(关闭并清空|Close and clear)$/,
						exact: true,
					})
					.click();
				await expect(importer).toHaveCount(0);
				const download = h.page.waitForEvent("download");
				await h.page
					.getByRole("button", { name: h.t("pwVaultExport"), exact: true })
					.click();
				const exported = await download;
				const path = info.outputPath("synthetic-draft-only.kdbx");
				await exported.saveAs(path);
				expect(await inspectVisualKdbx(path)).toHaveLength(0);
				await h.page.reload();
				await openVaultAccess(h.page);
				await h.page
					.locator("#password-vault-unlock-master")
					.fill(visualMaster);
				await h.page
					.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true })
					.click();
				importer = await h.open();
				await expect(importer.locator("#pw-smart-source")).toHaveValue("");
				expect(h.mock.requests).toHaveLength(1);
				expect(h.errors).toEqual([]);
			} finally {
				await h.close();
			}
		});
	}
}

test("failed encrypted draft save blocks close and preserves the last saved draft", async ({
	browser,
}) => {
	const h = await visualHarness(browser, "zh-CN");
	try {
		await h.configure();
		await h.createVault();
		const importer = await h.open();
		await importer
			.locator("#pw-smart-source")
			.fill("Synthetic original source");
		await expect(h.page.locator(".pw-smart-draft-status")).toHaveText(
			h.t("pwSmartDraftSaved"),
		);
		await h.page.evaluate(() => {
			const original = IDBObjectStore.prototype.put;
			(window as unknown as { restoreDraftPut: () => void }).restoreDraftPut =
				() => {
					IDBObjectStore.prototype.put = original;
				};
			IDBObjectStore.prototype.put = function (
				...args: Parameters<IDBObjectStore["put"]>
			) {
				if (this.name === "passwordVault")
					throw new DOMException("Synthetic draft fault", "QuotaExceededError");
				return original.apply(this, args);
			};
		});
		await importer
			.locator("#pw-smart-source")
			.fill("Synthetic latest source that must survive");
		await expect(h.page.locator(".pw-smart-draft-status")).toContainText(
			h.t("pwSmartDraftFailed"),
		);
		await h.page
			.getByRole("dialog", { name: h.t("pwSmartTitle"), exact: true })
			.getByRole("button", { name: "关闭", exact: true })
			.first()
			.click();
		await h.page
			.getByRole("button", { name: h.t("pwSmartCloseKeepDraft"), exact: true })
			.click();
		await expect(importer).toBeVisible();
		await expect(importer.locator("#pw-smart-source")).toHaveValue(
			"Synthetic latest source that must survive",
		);
		await expect(
			h.page.getByRole("button", {
				name: h.t("pwSmartCloseKeepDraft"),
				exact: true,
			}),
		).toBeEnabled();
		await h.page.evaluate(() =>
			(window as unknown as { restoreDraftPut: () => void }).restoreDraftPut(),
		);
		await h.page
			.getByRole("button", { name: h.t("pwSmartCloseKeepDraft"), exact: true })
			.click();
		await expect(importer).toHaveCount(0);
		const reopened = await h.open();
		await expect(reopened.locator("#pw-smart-source")).toHaveValue(
			"Synthetic latest source that must survive",
		);
		expect(h.mock.requests).toHaveLength(0);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

test("completing import and closing immediately clears the persisted draft", async ({
	browser,
}, info) => {
	const h = await visualHarness(browser, "zh-CN");
	try {
		await h.configure();
		await h.createVault();
		const importer = await h.open();
		await importer
			.locator("#pw-smart-source")
			.fill(
				"Title=Synthetic completed app\nUsername=complete@example.test\nPassword=Synthetic-only!42",
			);
		await importer
			.getByRole("button", { name: h.t("pwSmartRecognize"), exact: true })
			.click();
		await importer
			.getByRole("button", { name: "导入已核对的 1 条", exact: true })
			.click();
		await h.page
			.getByRole("dialog")
			.last()
			.getByRole("button", { name: "确认导入", exact: true })
			.click();
		await expect(importer.locator(".pw-smart-receipt")).toBeVisible();
		await h.page
			.locator(".password-smart-import-dialog > header")
			.getByRole("button", { name: h.t("pwVaultClose"), exact: true })
			.click();
		await expect(importer).toHaveCount(0);
		const download = h.page.waitForEvent("download");
		await h.page
			.getByRole("button", { name: h.t("pwVaultExport"), exact: true })
			.click();
		const exported = await download;
		const path = info.outputPath("synthetic-completed.kdbx");
		await exported.saveAs(path);
		const entries = await inspectVisualKdbx(path);
		expect(entries).toHaveLength(1);
		expect(entries[0].draft.username).toBe("complete@example.test");
		await h.page.reload();
		await openVaultAccess(h.page);
		await h.page.locator("#password-vault-unlock-master").fill(visualMaster);
		await h.page
			.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true })
			.click();
		const reopened = await h.open();
		await expect(reopened.locator("#pw-smart-source")).toHaveValue("");
		expect(h.mock.requests).toHaveLength(0);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});
