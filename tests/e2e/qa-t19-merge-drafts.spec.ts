import { expect, test, type Page } from "@playwright/test";
import { sourceModuleUrl } from "./helpers/source-module-url";
import { selectChoice } from "./helpers/select-choice";
import { resources } from "../../apps/web/src/i18n";

const repositoryPath = sourceModuleUrl("packages/local-db/src/index.ts");
const domainPath = sourceModuleUrl("packages/domain/src/index.ts");
const reviewPath = sourceModuleUrl("packages/local-db/src/intake-review.ts");

async function state(page: Page) {
	return page.evaluate(async path => {
		const repository = await (await import(path)).localRepository();
		return { assets: await repository.list("asset", true), candidates: await repository.fileStore.intakeReview.toArray(), journals: await repository.fileStore.importJournal.toArray() };
	}, repositoryPath);
}

for (const [language, width] of [["zh-CN", 390], ["en", 1280]] as const) {
	test(`${language} ${width} T19 selected merge fields never reuse invalid amount or interval drafts`, async ({ browser }) => {
		const context = await browser.newContext({ locale: language, viewport: { width, height: 900 } });
		await context.addInitScript(value => localStorage.setItem("keepany-language", value), language);
		const page = await context.newPage(), errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		const t = (key: string) => resources[language].translation[key];
		try {
			await page.goto("/intake");
			const fixture = await page.evaluate(async ([rp, dp, sp]) => {
				const repository = await (await import(rp)).localRepository(), { newAsset } = await import(dp), { stageReviewedCandidates } = await import(sp);
				const target = { ...newAsset("subscription"), name: "T19 numeric target", amount: 555, currency: "USD", interval: 3, dueDate: "2026-11-01", description: "Original target description" };
				await repository.save("asset", target);
				const hash = "d".repeat(64), id = `ai-${hash}-1`;
				const candidate = { id, fileHash: hash, fileName: "Synthetic numeric review", rowNumber: 1, source: "ai", sourceText: "Synthetic source: amount 12.34, interval 1, currency requires review.",
					asset: { ...newAsset("subscription"), id: `ai-${hash.slice(0, 48)}-1`, name: "T19 numeric incoming", amount: 1234, currency: "CNY", interval: 1, dueDate: "2026-11-01", description: "Incoming description" },
					ai: { provider: "synthetic", model: "local-fixture", evidence: "Synthetic data only; no AI request", missingFields: ["currency"] }, status: "pending" };
				await stageReviewedCandidates(repository.fileStore, [candidate]);
				return { target, id };
			}, [repositoryPath, domainPath, reviewPath]);
			await page.reload();
			const row = page.locator(`#intake-review-${fixture.id}`), amount = row.locator(`[id="${fixture.id}-amount"]`), interval = row.locator(`[id="${fixture.id}-interval"]`);
			await amount.fill(""); await interval.fill("0");
			await row.locator(`[id="${fixture.id}-description"]`).fill("Reviewed description only");
			const open = async () => {
				await row.getByRole("button", { name: t("reviewMerge"), exact: true }).click();
				const dialog = page.getByRole("dialog", { name: t("reviewMergeTitle"), exact: true });
				await selectChoice(dialog.locator("#candidate-merge-target"), fixture.target.id);
				return dialog;
			};
			let dialog = await open();
			for (const field of ["amount", "interval", "currency"]) {
				const checkbox = dialog.getByRole("checkbox", { name: t("reviewMergeUseField").replace("{{field}}", t(field)), exact: true });
				await expect(checkbox).toBeDisabled(); await expect(checkbox).not.toBeChecked();
				const incoming = checkbox.locator("xpath=ancestor::label").locator(".candidate-merge-value").last();
				await expect(incoming).toHaveText(field === "interval" ? "0" : t("reviewMergeEmpty"));
				await expect(checkbox.locator("xpath=ancestor::label")).toContainText(t("reviewMergeDraftInvalid"));
			}
			await dialog.getByRole("button", { name: t("reviewMergeConfirm"), exact: true }).click();
			await expect(dialog.getByRole("alert")).toHaveText(t("reviewMergeSelectFields"));
			await dialog.getByRole("button", { name: t("cancel"), exact: true }).click();
			await expect(amount).toHaveValue(""); await expect(interval).toHaveValue("0");
			const cancelled = await state(page);
			expect(cancelled.assets).toEqual([fixture.target]); expect(cancelled.candidates[0].status).toBe("pending"); expect(cancelled.journals).toEqual([]);
			// Invalid, unselected fields must not prevent a legitimate description merge.
			dialog = await open();
			await dialog.getByRole("checkbox", { name: t("reviewMergeUseField").replace("{{field}}", t("description")), exact: true }).check();
			await dialog.getByRole("button", { name: t("reviewMergeConfirm"), exact: true }).click();
			await expect(dialog).toBeHidden(); await page.reload();
			const actual = await state(page);
			expect(actual.assets).toHaveLength(1);
			expect(actual.assets[0]).toEqual({ ...fixture.target, description: "Reviewed description only", updatedAt: actual.assets[0].updatedAt });
			expect(actual.assets[0]).toMatchObject({ amount: 555, currency: "USD", interval: 3 });
			expect(actual.candidates[0]).toMatchObject({ status: "accepted", merge: { fields: ["description"], before: fixture.target, after: actual.assets[0] } });
			expect(actual.journals).toEqual([]); expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
