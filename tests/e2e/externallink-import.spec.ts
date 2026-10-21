import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const captureEvidence = process.env.KEEPANY_CAPTURE_EVIDENCE === "1";
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "docs/evidence/2026-09-29";

function exportFixture() {
	return {
		format: "externallink-submission-backup",
		version: 2,
		siteProfiles: {
			DemoProject: {
				id: "DemoProject",
				name: "Demo product",
				fields: {
					Name: "Demo product",
					Url: "https://demo.example",
					Title: "A useful demo",
					"Short description(20-30 words)": "A small local test product.",
					"Cloud LOGO": "https://cdn.example/logo.png",
					"Screenshot 1": "https://cdn.example/screen.png",
					"Screenshot 2": "javascript:alert(1)",
				},
			},
			Other: { id: "Other", name: "Other product", fields: {} },
		},
		submissionRecords: {
			"directory.example/submit::DemoProject": {
				destinationKey: "directory.example/submit",
				destinationUrl: "https://directory.example/submit",
				profileId: "DemoProject",
				status: "success",
				confirmedBy: "agent",
				evidence: "Submission receipt shown",
				evidenceUrl: "https://directory.example/receipt/123",
				submittedAt: "2026-09-29T08:00:00Z",
				publicationStatus: "submitted",
			},
			"unproven.example::DemoProject": {
				destinationKey: "unproven.example",
				profileId: "DemoProject",
				status: "success",
				confirmedBy: "migration",
				evidence: "table.xlsx submitted seed",
				submittedAt: "2026-09-29T08:00:00Z",
			},
			"other.example::Other": {
				destinationKey: "other.example",
				profileId: "Other",
				status: "success",
				confirmedBy: "agent",
				evidence: "Other receipt",
				submittedAt: "2026-09-29T08:00:00Z",
			},
		},
		sheetTableData: { privateValue: "not imported" },
	};
}

for (const variant of [
	{
		locale: "en-US",
		width: 1280,
		add: "Add",
		name: "Name",
		save: "Save",
		profile: "Choose source profile",
		project: "Choose local project",
		preview: "Preview",
		import: "Import 1 selected",
		done: "Imported 1 ledger records",
		submitted: "Submitted",
	},
	{
		locale: "zh-CN",
		width: 390,
		add: "新增",
		name: "名称",
		save: "保存",
		profile: "选择来源资料",
		project: "选择本机项目",
		preview: "预览",
		import: "导入所选 1 条",
		done: "已导入 1 条台账记录",
		submitted: "已提交",
	},
] as const) {
	test(`${variant.locale} explicitly imports one evidenced ExternalLink row at ${variant.width}px`, async ({
		browser,
	}) => {
		test.setTimeout(60_000);
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
		});
		const page = await context.newPage();
		const errors: string[] = [];
		const remoteRequests: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("request", (request) => {
			if (/https:\/\/(?:demo|directory|cdn)\.example/.test(request.url()))
				remoteRequests.push(request.url());
		});
		const projectName = `Mapped project ${crypto.randomUUID().slice(0, 8)}`;
		try {
			await page.goto("/assets/project");
			await page
				.getByRole("button", { name: variant.add, exact: true })
				.click();
			const dialog = page.getByRole("dialog");
			await dialog.getByLabel(variant.name, { exact: true }).fill(projectName);
			await dialog.getByRole("button", { name: variant.save }).click();
			await expect(page.getByText(projectName).first()).toBeVisible();
			await page.goto("/intake");
			await page.locator("details").filter({ has: page.locator(".external-import-panel") }).locator("summary").click();
			const panel = page.locator(".external-import-panel");
			await selectChoice(panel
				.getByLabel(variant.project), { label: projectName });
			await panel
				.locator("#ext-file")
				.setInputFiles({
					name: "externallink-backup.json",
					mimeType: "application/json",
					buffer: Buffer.from(JSON.stringify(exportFixture())),
				});
			await selectChoice(panel.getByLabel(variant.profile), "DemoProject");
			await panel.getByRole("button", { name: variant.preview }).click();
			await expect(panel).toContainText("A useful demo");
			await expect(panel).toContainText("DemoProject");
			await expect(panel).toContainText("directory.example/submit");
			await expect(panel).not.toContainText("other.example");
			await panel.locator("#ext-min-images").fill("2");
			await expect(panel).toContainText(
				variant.locale === "en-US" ? "1 screenshots missing" : "缺少 1 张截图",
			);
			const proven = panel
				.locator(".external-import-row")
				.filter({ hasText: "directory.example/submit" });
			const unproven = panel
				.locator(".external-import-row")
				.filter({ hasText: "unproven.example" });
			await expect(unproven.locator("input[type=checkbox]")).toBeDisabled();
			await proven.locator("input[type=checkbox]").check();
			if (captureEvidence) {
				mkdirSync(evidence, { recursive: true });
				await page.screenshot({
					path: `${evidence}/externallink-import-${variant.locale === "en-US" ? "en" : "zh"}-${variant.width}.png`,
					fullPage: true,
				});
			}
			await panel.getByRole("button", { name: variant.import }).click();
			await expect(panel.getByRole("status")).toContainText(variant.done);
			await page.goto("/assets/project");
			await page.getByText(projectName).first().click();
			await page.locator("#asset-backlinks > summary").click();
			const row = page
				.locator("tr")
				.filter({ hasText: "directory.example/submit" });
			await expect(row).toBeVisible();
			await expect(row.locator(".backlink-status-submitted")).toHaveText(variant.submitted);
			await expect(row).toContainText("DemoProject");
			await expect(
				page.locator("tr").filter({ hasText: "unproven.example" }),
			).toHaveCount(0);
			await page.reload();
			await page.locator("#asset-backlinks > summary").click();
			await expect(
				page.locator("tr").filter({ hasText: "directory.example/submit" }),
			).toHaveCount(1);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth > innerWidth,
			);
			expect(overflow).toBe(false);
			expect(remoteRequests).toEqual([]);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
}
