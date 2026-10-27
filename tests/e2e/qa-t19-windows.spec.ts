import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { sourceModuleUrl } from "./helpers/source-module-url";
import { selectChoice } from "./helpers/select-choice";

const repo = sourceModuleUrl("packages/local-db/src/index.ts");
const domain = sourceModuleUrl("packages/domain/src/index.ts");
const evidence = "docs/qa/2026-10-27/evidence/T19-windows";
mkdirSync(evidence, { recursive: true });
async function state(page: Page) {
	return page.evaluate(async path => {
		const { localRepository } = await import(path);
		const db = await localRepository();
		return { assets: await db.list("asset", true), submissions: await db.list("submission", true), candidates: await db.fileStore.intakeReview.toArray() };
	}, repo);
}
function exportFixture() {
	const receipt = { profileId: "T19Profile", status: "success", confirmedBy: "agent", evidence: "Synthetic receipt 19", evidenceUrl: "https://directory.example/receipt/19", submittedAt: "2026-10-26T08:00:00Z" };
	return { format: "externallink-submission-backup", version: 2, siteProfiles: { T19Profile: { id: "T19Profile", name: "T19 source profile", fields: { Name: "T19 source profile", Url: "https://t19.example/", "Cloud LOGO": "https://cdn.example/t19-logo.png", "Screenshot 1": "https://cdn.example/t19-screen.png", "Screenshot 2": "javascript:alert(1)" } }, Other: { id: "Other", name: "Other profile", fields: {} } }, submissionRecords: { "submitted.example::T19Profile": { ...receipt, destinationKey: "submitted.example", destinationUrl: "https://submitted.example/", publicationStatus: "submitted" }, "claim.example::T19Profile": { ...receipt, destinationKey: "claim.example", destinationUrl: "https://claim.example/", publicationStatus: "published" }, "unproven.example::T19Profile": { profileId: "T19Profile", destinationKey: "unproven.example", status: "success", confirmedBy: "migration", evidence: "table.xlsx submitted seed", submittedAt: receipt.submittedAt }, "other.example::Other": { ...receipt, profileId: "Other", destinationKey: "other.example" } } };
}

for (const locale of ["zh-CN", "en-US"] as const) for (const width of [390, 1280]) {
	test(`${locale} ${width}px T19 bulk correction, source-profile receipts and explicit backlink review`, async ({ browser }) => {
		test.setTimeout(130_000);
		const zh = locale === "zh-CN";
		const c = { name: zh ? "名称" : "Name", url: zh ? "网址" : "URL", description: zh ? "简短描述" : "Short description", save: zh ? "保存" : "Save", confirm: zh ? "已确认" : "Confirmed", cancel: zh ? "取消" : "Cancel", addBacklink: zh ? "新增外链" : "Add backlink", check: zh ? "核验" : "Verify", update: zh ? "更新" : "Update", invalid: zh ? "请检查此项" : "Please check this field", evidence: zh ? "依据" : "Evidence" };
		const context = await browser.newContext({ locale, timezoneId: "Asia/Shanghai", viewport: { width, height: 900 } });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
		const page = await context.newPage();
		await page.clock.setFixedTime(new Date("2026-10-27T04:00:00Z"));
		const errors: string[] = [], remote: string[] = [];
		page.on("pageerror", e => errors.push(e.message));
		page.on("request", request => { if (new URL(request.url()).hostname.endsWith(".example")) remote.push(request.url()); });
		try {
			await page.goto("/intake");
			const existing = await page.evaluate(async ([repositoryPath, domainPath]) => {
				const { newAsset } = await import(domainPath);
				const { save } = await import(repositoryPath);
				const asset = { ...newAsset("project"), name: "T19 Similar", url: "https://existing.example/", description: "Original retained description", notes: "Original retained note" };
				await save("asset", asset);
				return asset;
			}, [repo, domain]);
			// T19-01/02: duplicate refuses overwrite; batch keeps per-row failures retryable.
			await page.locator(".intake-mode-tabs").getByRole("button", { name: zh ? "表格" : "Spreadsheet", exact: true }).click();
			await page.locator("#csv-file").setInputFiles({ name: "T19-review.csv", mimeType: "text/csv", buffer: Buffer.from("name,kind,url\nT19 Similar,project,https://reviewed.example/\nT19 Valid,project,https://valid.example/\nT19 Invalid,project,https://initial.example/") });
			const batch = page.getByRole("region", { name: "T19-review.csv", exact: true });
			const rows = batch.locator(".intake-review-row");
			await expect(rows).toHaveCount(3);
			await rows.nth(2).getByLabel(c.url, { exact: true }).fill("javascript:alert(1)");
			await rows.nth(0).getByLabel(c.description, { exact: true }).fill("Only explicitly edited candidate description");
			await batch.getByRole("checkbox", { name: zh ? "全选待确认" : "Select all pending", exact: true }).check();
			await batch.getByRole("button", { name: zh ? "确认所选（3）" : "Confirm selected (3)", exact: true }).click();
			await expect(rows.nth(1)).toContainText(c.confirm);
			await expect(rows.nth(0).getByRole("alert")).toBeVisible();
			await expect(rows.nth(2).getByRole("alert")).toBeVisible();
			expect((await state(page)).assets.find((a: { id: string }) => a.id === existing.id)).toEqual(existing);
			const firstSaved = (await state(page)).assets.find((a: { name: string }) => a.name === "T19 Valid");
			await rows.nth(0).getByLabel(c.name, { exact: true }).fill("T19 Reviewed distinct");
			await rows.nth(2).getByLabel(c.url, { exact: true }).fill("https://corrected.example/");
			await expect.poll(async () => (await state(page)).candidates.find((v: { asset: { name: string } }) => v.asset.name === "T19 Invalid")?.asset.url).toBe("https://corrected.example/");
			await page.reload();
			await expect(rows.nth(0).getByLabel(c.name, { exact: true })).toHaveValue("T19 Reviewed distinct");
			await expect(rows.nth(0).getByLabel(c.description, { exact: true })).toHaveValue("Only explicitly edited candidate description");
			await batch.getByRole("checkbox", { name: zh ? "全选待确认" : "Select all pending", exact: true }).check();
			await batch.getByRole("button", { name: zh ? "确认所选（2）" : "Confirm selected (2)", exact: true }).click();
			await expect(rows.filter({ hasText: c.confirm })).toHaveCount(3);
			await page.reload();
			const accepted = await state(page);
			expect(accepted.assets).toHaveLength(4);
			expect(accepted.assets.find((a: { id: string }) => a.id === existing.id)).toEqual(existing);
			expect(accepted.assets.find((a: { id: string }) => a.id === firstSaved.id)).toEqual(firstSaved);
			expect(accepted.candidates.every((v: { status: string }) => v.status === "accepted")).toBe(true);
			// T19-03: formal JSON import maps a selected Profile to a selected local project.
			await page.locator("details").filter({ has: page.locator(".external-import-panel") }).locator("summary").click();
			const panel = page.locator(".external-import-panel");
			await selectChoice(panel.getByLabel(zh ? "选择本机项目" : "Choose local project", { exact: true }), existing.id);
			await panel.locator("#ext-file").setInputFiles({ name: "T19-externallink.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exportFixture())) });
			await selectChoice(panel.getByLabel(zh ? "选择来源资料" : "Choose source profile", { exact: true }), "T19Profile");
			await panel.getByRole("button", { name: zh ? "预览" : "Preview", exact: true }).click();
			await expect(panel).not.toContainText("other.example");
			await panel.locator("#ext-min-images").fill("2");
			await expect(panel).toContainText(zh ? "缺少 1 张截图" : "1 screenshots missing");
			const claimed = panel.locator(".external-import-row").filter({ hasText: "claim.example" });
			await expect(claimed).toContainText(zh ? "公开页面尚未核验" : "Public page has not been verified");
			await expect(panel.locator(".external-import-row").filter({ hasText: "unproven.example" }).locator("input[type=checkbox]")).toBeDisabled();
			for (const host of ["submitted.example", "claim.example"]) await panel.locator(".external-import-row").filter({ hasText: host }).locator("input[type=checkbox]").check();
			await panel.getByRole("button", { name: zh ? "导入所选 2 条" : "Import 2 selected", exact: true }).click();
			await expect(panel.getByRole("status")).toContainText(zh ? "已导入 2 条台账记录" : "Imported 2 ledger records");
			let submissions = (await state(page)).submissions;
			expect(submissions).toHaveLength(2);
			for (const row of submissions) expect(row).toMatchObject({ assetId: existing.id, externalLink: { profileId: "T19Profile" } });
			expect(submissions.find((v: { externalLink: { destinationKey: string } }) => v.externalLink.destinationKey === "claim.example")).toMatchObject({ status: "verify", verifiedAt: "" });
			expect(submissions.find((v: { externalLink: { destinationKey: string } }) => v.externalLink.destinationKey === "submitted.example")).toMatchObject({ status: "submitted" });
			// T19-04: evidence gates indexed state, double click only writes one row.
			await page.goto(`/assets/project/${existing.id}`);
			await page.getByRole("button", { name: c.addBacklink, exact: true }).click();
			const form = page.getByRole("dialog", { name: c.addBacklink, exact: true });
			await form.locator("#submission-name").fill("T19 Manual receipt");
			await form.locator("#submission-url").fill("https://manual.example/listing");
			await selectChoice(form.locator("#submission-status"), "indexed");
			await form.locator("#submission-date").fill("2026-10-26");
			await form.getByRole("button", { name: c.save, exact: true }).click();
			await expect(form.getByRole("alert")).toBeVisible();
			await form.locator("#submission-evidence").fill("plain text cannot prove indexed state");
			await form.getByRole("button", { name: c.save, exact: true }).click();
			await expect(form.getByRole("alert")).toBeVisible();
			await form.locator("#submission-evidence").fill("https://search.example/result/t19");
			await form.getByRole("button", { name: c.save, exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
			await expect(form).toBeHidden();
			submissions = (await state(page)).submissions;
			const manual = submissions.find((v: { name: string }) => v.name === "T19 Manual receipt");
			expect(submissions.filter((v: { name: string }) => v.name === manual.name)).toHaveLength(1);
			expect(manual).toMatchObject({ status: "indexed", evidence: "https://search.example/result/t19", submittedAt: "2026-10-26", verifiedAt: "2026-10-27" });
			const ledger = page.locator(".asset-backlinks-card");
			const row = ledger.locator("tr").filter({ hasText: manual.name });
			await row.getByRole("button", { name: c.update, exact: true }).click();
			await row.getByLabel(`${manual.name} ${c.name}`, { exact: true }).fill("T19 cancelled name");
			await row.getByRole("button", { name: c.cancel, exact: true }).click();
			expect((await state(page)).submissions.find((v: { id: string }) => v.id === manual.id)).toEqual(manual);
			await row.getByRole("button", { name: c.update, exact: true }).click();
			await selectChoice(row.getByRole("combobox"), "verify");
			await row.getByLabel(`${manual.name} ${c.evidence}`, { exact: true }).fill("T19 changed source awaiting recheck");
			await row.getByRole("button", { name: c.save, exact: true }).click();
			await expect(row.getByRole("combobox")).toHaveCount(0);
			await page.reload();
			expect((await state(page)).submissions.find((v: { id: string }) => v.id === manual.id)).toMatchObject({ status: "verify", verifiedAt: "", evidence: "T19 changed source awaiting recheck" });
			await ledger.locator("summary").click();
			await expect(ledger.locator("tr").filter({ hasText: manual.name })).toHaveCount(1);
			if ((zh && width === 390) || (!zh && width === 1280)) await ledger.screenshot({ path: `${evidence}/T19-ledger-${locale}-${width}.png` });
			expect(remote).toEqual([]);
			expect(errors).toEqual([]);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
		} finally { await context.close(); }
	});
}
