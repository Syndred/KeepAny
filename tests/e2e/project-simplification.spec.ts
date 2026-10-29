// 2026-10-29 user scope: B1/B2/B8 retired; historical schema/KA1 data stays lossless.
// Node preparation is synthetic, not user interaction. Mutations and readback use
// the compiled candidate's visible UI and downloaded encrypted backup only.
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { assetSchema, historySchema, newAsset, submissionSchema, type Asset } from "../../packages/domain/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { resources } from "../../apps/web/src/i18n";
import { openBackupRestorePanel } from "./helpers/backup-restore";
import { prepareCompletionArchive, recordDevelopmentRequests } from "./helpers/completion-archive";

const password = "Synthetic-project-retirement-compatibility";
const directory = resolve("test-results/project-simplification-fixture");
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function prepare() {
	return prepareCompletionArchive(directory, password, async db => {
		const file = readFileSync(resolve("apps/web/public/samples/logo.png"));
		const id = await db.putFile(new File([file], "legacy-logo.png", { type: "image/png" }));
		const project = assetSchema.parse({ ...newAsset("project"), name: "Legacy project", category: "", url: "https://project.example.test/",
			description: "Basic description", contact: "Basic contact", notes: "Basic note", tags: ["legacy"],
			projectLaunchMonth: "2025-11", projectInspectionDate: "2026-11-15",
			projectTitle: "Legacy title", projectPromoUrl: "https://promo.example.test/", projectMediumDescription: "Legacy medium copy",
			longDescription: "Legacy long copy must not merge into ordinary notes", projectFeatures: "Legacy features", projectPricing: "Legacy pricing",
			projectPricingType: "Legacy type", projectEmail: "legacy@example.test", attachments: [id],
			projectMedia: { logoId: id, homeScreenshotId: "", productScreenshotIds: [], promoCoverId: "" } });
		const vault = { ...newAsset("vault"), name: "Legacy external vault", location: "Synthetic location" };
		const relation = { id: crypto.randomUUID(), from: project.id, to: vault.id, label: "Historical relation", createdAt: project.createdAt, verifiedAt: "", deleted: false };
		const submission = submissionSchema.parse({ id: crypto.randomUUID(), assetId: project.id, name: "Legacy backlink", url: "https://directory.example.test/old", status: "verify", evidence: "Historical receipt" });
		await db.saveBatch([{ type: "asset", value: project }, { type: "asset", value: vault }, { type: "relation", value: relation }, { type: "submission", value: submission }]);
		const expense = historySchema.parse({ id: crypto.randomUUID(), assetId: project.id, action: "expense", title: "Legacy project expense",
			note: "Ordinary retained project expense", amount: 1234, currency: "USD", eventDate: "2026-10-27", createdAt: "2026-10-27T00:00:00.000Z" });
		await db.createFinanceEntry(expense);
		return { project, vault, relation, submission, expense, fileDigest: digest(file) };
	});
}
let fixture: Awaited<ReturnType<typeof prepare>>;
test.beforeAll(async () => { fixture = await prepare(); });

for (const [locale, width] of [["zh-CN", 390], ["en", 1280]] as const) test(`${locale} ${width}: removed project UI preserves legacy backup data`, async ({ browser }) => {
	test.setTimeout(120_000);
	const context = await browser.newContext({ locale, viewport: { width, height: 900 }, acceptDownloads: true });
	await context.addInitScript(language => localStorage.setItem("keepany-language", language), locale);
	const developmentRequests = recordDevelopmentRequests(context), errors: string[] = [];
	const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
	const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
	async function archive() {
		await page.goto("/intake"); await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: t("backup"), exact: true }).click();
		const link = page.getByRole("link", { name: t("saveBackupFile"), exact: true }); await expect(link).toBeVisible();
		const pending = page.waitForEvent("download"); await link.click(); const path = await (await pending).path();
		if (!path) throw Error("backup-download-missing");
		const entries = unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)), password));
		const rows = JSON.parse(strFromU8(entries["records.json"])) as { id: string; type: string; payload: string }[];
		return { entries, rows, asset: JSON.parse(rows.find(row => row.type === "asset" && JSON.parse(row.payload).id === fixture.project.id)!.payload) as Asset };
	}
	const goProject = () => page.goto(`/assets/project/${fixture.project.id}`);
	const edit = () => page.locator(".asset-project-action-bar").getByRole("button", { name: t("edit"), exact: true }).click();
	try {
		await page.goto("/intake"); await page.locator("#backup-password").fill(password); await openBackupRestorePanel(page);
		await page.locator("#restore-file").setInputFiles(resolve(directory, "fixture.ka1"));
		await page.getByRole("button", { name: t("preview"), exact: true }).first().click();
		await page.getByRole("button", { name: /^(确认|Confirm) ·/ }).click();
		await expect(page.getByText(locale === "en" ? /Restored \d+ records/ : /已恢复 \d+ 条记录/)).toBeVisible();
		await expect(page.getByText(t("intakeExternalLinkImport"), { exact: true })).toHaveCount(0);
		await goProject();
		await expect(page.locator(".asset-backlinks-card, .asset-project-materials, .asset-project-stats, [data-project-media-role]")).toHaveCount(0);
		await expect(page.locator(".asset-attachments-card .image-item img")).toHaveCount(1);
		await expect(page.locator(".asset-project-profile-card")).toContainText("Basic contact");
		await expect(page.locator(`.asset-finance-card [data-bill-id="${fixture.expense.id}"]`)).toContainText(fixture.expense.title!);
		const layout = await page.locator("main.asset-detail-project").evaluate(main => {
			const hero = main.querySelector(":scope > .page-header")!.getBoundingClientRect();
			const finance = main.querySelector(":scope > .asset-finance-card")!.getBoundingClientRect();
			return { heroBottom: hero.bottom, financeTop: finance.top,
				emptyMetaSpans: [...main.querySelectorAll(".asset-project-hero-meta > span")].filter(node => !node.textContent?.trim()).length,
				overflow: document.documentElement.scrollWidth > innerWidth + 1 };
		});
		await test.info().attach("project-expense-layout", { body: JSON.stringify(layout), contentType: "application/json" });
		await page.screenshot({ path: test.info().outputPath("project-expense-layout.png"), fullPage: true });
		expect.soft(layout.heroBottom, "Project title and hero precede its ordinary expense ledger").toBeLessThanOrEqual(layout.financeTop);
		expect.soft(layout.emptyMetaSpans, "An empty category must not render an empty capsule").toBe(0);
		expect.soft(layout.overflow, "The restored project with an expense fits the viewport").toBe(false);
		await edit(); const form = page.getByRole("dialog");
		await expect(form.locator("#projectTitle, #projectPromoUrl, #projectEmail, #projectLogoFile, #longDescription")).toHaveCount(0);
		await expect(form.locator("#notes")).toHaveValue("Basic note");
		await form.locator("#name").fill("Cancelled name"); await form.getByRole("button", { name: t("cancel"), exact: true }).click();
		expect((await archive()).asset).toEqual(fixture.project);
		await goProject(); await edit();
		await form.locator("#name").fill("Updated basic project"); await form.locator("#notes").fill("Updated ordinary note");
		await form.locator("#tags").fill("legacy, retained");
		await form.getByRole("button", { name: t("save"), exact: true }).click(); await expect(form).toHaveCount(0); await page.reload();
		await expect(page.locator(".asset-project-profile-card")).toContainText("Updated ordinary note");
		const result = await archive();
		const { name, notes, tags, updatedAt, ...retained } = result.asset;
		const { name: oldName, notes: oldNotes, tags: oldTags, updatedAt: oldUpdatedAt, ...before } = fixture.project;
		expect({ name, notes, tags }).toEqual({ name: "Updated basic project", notes: "Updated ordinary note", tags: ["legacy", "retained"] });
		expect(retained).toEqual(before);
		expect(digest(result.entries[`files/${fixture.project.attachments[0]}`])).toBe(fixture.fileDigest);
		for (const record of [fixture.submission, fixture.vault, fixture.relation, fixture.expense]) expect(JSON.parse(result.rows.find(row => JSON.parse(row.payload).id === record.id)!.payload)).toEqual(record);
		await page.goto(`/assets/vault/${fixture.vault.id}`);
		await expect(page.getByText(t("vaultReferenceRetired"), { exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: t("edit"), exact: true })).toHaveCount(0);
		await page.getByRole("link", { name: t("vaultReferenceBackup"), exact: true }).click(); await expect(page).toHaveURL(/\/intake$/);
		expect(developmentRequests).toEqual([]); expect(errors).toEqual([]);
		await test.info().attach("legacy-preservation-readback", { body: JSON.stringify({ rows: result.rows, developmentRequests, errors }), contentType: "application/json" });
	} finally { await context.close(); }
});
