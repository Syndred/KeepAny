import { expect, test } from "@playwright/test";
import { inspectVisualKdbx, visualHarness } from "./fixtures/password-smart-import-visual";
import { selectChoice } from "./helpers/select-choice";

test.setTimeout(120_000);
for (const locale of ["zh-CN", "en"] as const) {
	test(`${locale} T07 TXT duplicate skip, explicit password update history and separate entry`, async ({ browser }, info) => {
		const h = await visualHarness(browser, locale, { width: locale === "zh-CN" ? 390 : 1280, height: 1000 });
		try {
			await h.page.goto("/assets/vault");
			await h.createVault();
			await h.seedExisting({ title: "T07 Mail", username: "t07@example.test", password: "Synthetic-old!42" });
			const exportEntries = async () => {
				const download = h.page.waitForEvent("download");
				await h.page.getByRole("button", { name: h.t("pwVaultExport"), exact: true }).click();
				const path = info.outputPath(`round-${Date.now()}.kdbx`);
				await (await download).saveAs(path);
				return inspectVisualKdbx(path);
			};
			for (const [round, password] of ["Synthetic-old!42", "Synthetic-new!42", "Synthetic-separate!42"].entries()) {
				const importer = await h.open();
				const source = `Title=T07 Mail\nUsername=t07@example.test\nPassword="${password}"`;
				await importer.locator("input[type=file]").setInputFiles({ name: "synthetic.txt", mimeType: "text/plain", buffer: Buffer.from(source) });
				await expect(importer.locator("#pw-smart-source")).toHaveValue(source);
				await importer.getByRole("button", { name: h.t("pwSmartRecognize"), exact: true }).click();
				const editor = importer.locator(".pw-work-editor");
				if (round === 0) {
					await expect(editor.locator(".pw-work-conflict-note")).toContainText(locale === "zh-CN" ? "密码库中已有相同条目" : "An identical entry is already in your vault");
				} else {
					const action = editor.getByRole("combobox", { name: locale === "zh-CN" ? "保存方式" : "Save method", exact: true });
					await selectChoice(action, { label: round === 1 ? `${locale === "zh-CN" ? "更新" : "Update"} T07 Mail · t07@example.test` : h.t("pwSmartCreateSeparate") });
					await importer.getByRole("button", { name: /^(核对完成，下一条|Reviewed, next entry|核对更新|Review update)$/ }).click();
					await importer.getByRole("button", { name: /^(导入已核对的 \d+ 条|Import \d+ reviewed)$/ }).click();
					await h.page.getByRole("dialog").last().getByRole("button", { name: /^(确认导入|Confirm import)$/, exact: true }).click();
					await expect(importer.locator(".pw-smart-receipt")).toBeVisible();
				}
				await h.page.locator(".password-smart-import-dialog > header").getByRole("button", { name: /^(关闭|Close)$/, exact: true }).click();
				const clear = h.page.getByRole("button", { name: /^(关闭并清空|Close and clear)$/, exact: true });
				if (await clear.isVisible()) await clear.click();
				await expect(importer).toHaveCount(0);
				const saved = await exportEntries();
				expect(saved).toHaveLength(round === 2 ? 2 : 1);
				const original = saved.find(entry => entry.draft.password === (round === 0 ? "Synthetic-old!42" : "Synthetic-new!42"));
				expect(original).toBeDefined();
				if (round > 0) expect(original?.history.some(entry => entry.draft.password === "Synthetic-old!42")).toBe(true);
				if (round === 2) expect(saved.some(entry => entry.draft.password === password)).toBe(true);
			}
			expect(h.mock.requests).toHaveLength(0);
			expect(h.errors).toEqual([]);
		} finally { await h.close(); }
	});
}
