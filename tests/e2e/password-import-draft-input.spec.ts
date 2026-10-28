import { openVaultAccess } from "./helpers/vault-access";
import { expect, test } from "@playwright/test";
import {
	visualHarness,
	visualMaster,
} from "./fixtures/password-smart-import-visual";
import { selectChoice } from "./helpers/select-choice";

test.setTimeout(120_000);
type Harness = Awaited<ReturnType<typeof visualHarness>>;

async function saved(h: Harness) {
	await expect(h.page.locator(".pw-smart-draft-status")).toHaveText(
		h.t("pwSmartDraftSaved"),
	);
}

async function reloadAndOpen(h: Harness) {
	await h.page.reload();
	await openVaultAccess(h.page);
	await h.page.locator("#password-vault-unlock-master").fill(visualMaster);
	await h.page
		.getByRole("button", { name: h.t("pwVaultUnlock"), exact: true })
		.click();
	await expect(h.page.locator(".password-vault-toolbar")).toBeVisible();
	return h.open();
}

async function preserveAndClose(h: Harness) {
	await h.page
		.locator(".password-smart-import-dialog > header")
		.getByRole("button", { name: "关闭", exact: true })
		.click();
	await h.page
		.getByRole("dialog")
		.last()
		.getByRole("button", { name: h.t("pwSmartCloseKeepDraft"), exact: true })
		.click();
	await expect(h.page.locator(".password-smart-import")).toHaveCount(0);
}

test("zh-CN input source and unfinished line mapping recover after reload and unlock without AI requests", async ({
	browser,
}) => {
	const h = await visualHarness(browser, "zh-CN");
	const source = [
		"Synthetic first app",
		"first@example.test",
		"  Demo first!42  ",
		"Synthetic ignored note",
		"Synthetic second app",
		"second@example.test",
		"Demo second!42",
	].join("\n");
	const editedPassword = "  Unsubmitted mapped password!42;|  ";
	try {
		await h.configure();
		await h.createVault();
		let importer = await h.open();
		await importer.locator("#pw-smart-source").fill(source);
		await saved(h);

		importer = await reloadAndOpen(h);
		await expect(importer.locator("#pw-smart-source")).toHaveValue(source);
		await expect(importer.locator(".pw-smart-mapping")).toHaveCount(0);
		await importer
			.getByRole("button", { name: h.t("pwSmartMap"), exact: true })
			.click();
		const mapping: [number, string][] = [
			[1, "title"],
			[2, "username"],
			[3, "password"],
			[4, "ignore"],
			[5, "title"],
			[6, "username"],
			[7, "password"],
		];
		for (const [line, field] of mapping)
			await selectChoice(importer.locator(`#pw-map-field-${line}`), field);
		await importer.locator("#pw-map-value-3").fill(editedPassword);
		await importer
			.getByRole("checkbox", {
				name: h.t("pwSmartMapStart", { line: 5 }),
				exact: true,
			})
			.check();
		await saved(h);

		importer = await reloadAndOpen(h);
		await expect(importer.locator(".pw-smart-mapping")).toBeVisible();
		await expect(importer.locator(".pw-smart-map-line")).toHaveCount(7);
		for (const [line, field] of mapping)
			await expect(importer.locator(`#pw-map-field-${line}`)).toHaveAttribute(
				"data-value",
				field,
			);
		await expect(importer.locator("#pw-map-value-3")).toHaveValue(
			editedPassword,
		);
		await expect(importer.locator("#pw-map-value-4")).toHaveValue(
			"Synthetic ignored note",
		);
		await expect(
			importer.getByRole("checkbox", {
				name: h.t("pwSmartMapStart", { line: 5 }),
				exact: true,
			}),
		).toBeChecked();
		await importer
			.getByRole("button", { name: h.t("pwSmartEditSource"), exact: true })
			.click();
		await expect(importer.locator("#pw-smart-source")).toHaveValue(
			source.replace("  Demo first!42  ", editedPassword),
		);
		await saved(h);
		expect(h.mock.requests).toHaveLength(0);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

test("zh-CN saved draft keeps recognition edits when vault changes and recheck resets review selections without AI", async ({
	browser,
}) => {
	const h = await visualHarness(browser, "zh-CN");
	const source =
		"Synthetic retained app\nretained@example.test\nDemo retained!42";
	const editedTitle = "Synthetic retained app edited before refresh";
	const editedNotes = "Unsubmitted review note\n保持填写内容";
	try {
		await h.configure();
		await h.createVault();
		let importer = await h.open();
		await importer.locator("#pw-smart-source").fill(source);
		await importer
			.getByRole("button", { name: h.t("pwSmartRecognize"), exact: true })
			.click();
		const current = importer.locator(".pw-work-candidate");
		await expect(importer.locator(".pw-work-list-row")).toHaveCount(1);
		await current.locator("[id$='-title']").fill(editedTitle);
		await current.locator("[id$='-notes']").fill(editedNotes);
		await current
			.getByRole("button", { name: "核对完成，下一条", exact: true })
			.click();
		await importer.getByRole("tab", { name: "已核对 1", exact: true }).click();
		await expect(
			importer.getByRole("button", { name: "导入已核对的 1 条", exact: true }),
		).toBeEnabled();
		await saved(h);
		await preserveAndClose(h);

		await h.seedExisting({
			title: "Synthetic formal vault change",
			username: "changed@example.test",
			password: "Demo unrelated formal save!42",
		});
		importer = await h.open();
		await expect(importer.locator(".pw-smart-stale")).toContainText(
			h.t("pwSmartDraftVaultChanged"),
		);
		await expect(
			importer.locator(".pw-work-candidate [id$='-title']"),
		).toHaveValue(editedTitle);
		await expect(
			importer.locator(".pw-work-candidate [id$='-notes']"),
		).toHaveValue(editedNotes);
		await expect(
			importer.getByRole("button", { name: "导入已核对的 1 条", exact: true }),
		).toBeDisabled();
		await importer
			.getByRole("button", { name: h.t("pwSmartRecheckDraft"), exact: true })
			.click();

		await expect(importer.locator(".pw-smart-stale")).toHaveCount(0);
		await expect(
			importer.getByRole("tab", { name: "已核对 0", exact: true }),
		).toBeVisible();
		await expect(
			importer.getByRole("tab", { name: "待处理 1", exact: true }),
		).toBeVisible();
		await expect(
			importer.getByRole("button", { name: "导入已核对的 0 条", exact: true }),
		).toBeDisabled();
		await expect(importer.locator(".pw-work-list-row")).toHaveCount(1);
		await expect(
			importer.locator(".pw-work-candidate [id$='-title']"),
		).toHaveValue(editedTitle);
		await expect(
			importer.locator(".pw-work-candidate [id$='-notes']"),
		).toHaveValue(editedNotes);
		await expect(
			importer.locator(".pw-work-candidate [id$='-username']"),
		).toHaveValue("retained@example.test");
		await expect(
			importer.locator(".pw-work-candidate [id$='-password']"),
		).toHaveValue("Demo retained!42");
		await saved(h);
		expect(h.mock.requests).toHaveLength(0);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});
