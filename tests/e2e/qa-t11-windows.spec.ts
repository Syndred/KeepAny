// 2026-10-29: user removed B1 backlinks and B2 promotional fields/materials.
// Prior expectations/evidence remain in Git and the private pre-change snapshot; retained core checks are unchanged.
import { expect, type Page, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { resources } from "../../apps/web/src/i18n";
import { selectChoice } from "./helpers/select-choice";

const domainPath = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/domain/src/index.ts`;
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/T11-retained-core";
mkdirSync(evidence, { recursive: true });

const repositoryPath = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/local-db/src/index.ts`;

async function workflowFixture(page: Page) {
	return page.evaluate(async ({ repositoryPath, domainPath }) => {
		const { newAsset, relationSchema, submissionSchema } = await import(domainPath);
		const { saveBatch } = await import(repositoryPath);
		const project = { ...newAsset("project"), name: "T11 Workflow Project", description: "Original profile snapshot", url: "https://t11.example.test", projectDomains: [{ id: crypto.randomUUID(), name: "t11.example.test", registrar: "T11 Registrar", expiryDate: "2027-01-01", annualAmount: 12000, currency: "CNY", autoRenew: "on" }] };
		const account = { ...newAsset("account"), name: "T11 administration", username: "admin@t11.example.test" };
		const subscription = { ...newAsset("subscription"), name: "T11 hosting", amount: 9800, currency: "CNY", dueDate: "2026-10-22" };
		const relations = [account, subscription].map((asset) => relationSchema.parse({ id: crypto.randomUUID(), from: project.id, to: asset.id, label: "T11 dependency", createdAt: project.createdAt }));
		const submission = submissionSchema.parse({ id: crypto.randomUUID(), assetId: project.id, name: "T11 listing", url: "https://directory.example/t11", status: "indexed", deleted: false });
		await saveBatch([...([project, account, subscription].map((value) => ({ type: "asset", value }))), ...relations.map((value) => ({ type: "relation", value })), { type: "submission", value: submission }]);
		return { id: project.id, subscription: subscription.id, account: account.id };
	}, { repositoryPath, domainPath });
}

async function workflowReadback(page: Page, projectId: string) {
	return page.evaluate(async ({ repositoryPath, projectId }) => {
		const repository = await (await import(repositoryPath)).localRepository();
		return { project: await repository.get("asset", projectId), tasks: (await repository.list("task")).filter((task: { assetId: string }) => task.assetId === projectId).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)) };
	}, { repositoryPath, projectId });
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`T11-03/04 ${locale} ${width}px brand snapshots and evidence-gated local archive`, async ({ browser }) => {
		test.setTimeout(150_000);
		const context = await browser.newContext({ locale, viewport: { width, height: 900 } });
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
		try {
			await page.addInitScript((language) => localStorage.setItem("keepany-language", language), locale);
			await page.goto("/");
			const ids = await workflowFixture(page);
			await page.goto(`/assets/project/${ids.id}`);
			await page.getByRole("link", { name: t("workflowBrandEntry"), exact: true }).click();
			await expect(page.locator(".project-workflow-preview-row")).toHaveCount(4);
			await page.getByRole("button", { name: t("workflowCreatePlan"), exact: true }).click();
			await expect(page.getByRole("alert")).toHaveText(t("workflowProposalRequired"));
			await expect(page.locator(".project-workflow-task")).toHaveCount(0);
			await page.getByLabel(t("workflowProposedName")).fill("T11 proposed brand");
			await page.getByLabel(t("workflowProposedDescription")).fill("T11 proposed description");
			await page.getByLabel(t("workflowProposedUrl")).fill("https://proposed.example.test");
			await page.getByLabel(t("workflowChangeNote")).fill("T11 proposed scope");
			await page.getByRole("button", { name: t("workflowCreatePlan"), exact: true }).click();
			const tasks = page.locator(".project-workflow-task");
			await expect(tasks).toHaveCount(4);
			const snapshot = await workflowReadback(page, ids.id);
			expect(snapshot.tasks.every((task: { projectWorkflow: { projectName: string; proposedName: string } }) => task.projectWorkflow.projectName === "T11 Workflow Project" && task.projectWorkflow.proposedName === "T11 proposed brand")).toBe(true);
			await page.reload();
			expect(await workflowReadback(page, ids.id)).toEqual(snapshot);
			await expect(page.locator(".project-workflow-before-after")).toContainText("T11 proposed description");
			await expect(page.getByRole("button", { name: t("workflowNewRound"), exact: true })).toBeDisabled();
			for (let index = 0; index < 4; index++) {
				const row = tasks.nth(index);
				await row.getByRole("button", { name: t("workflowRecordResult"), exact: true }).click();
				if (index === 0) {
					await row.getByRole("button", { name: t("workflowSaveRecord"), exact: true }).click();
					await expect(row).toHaveAttribute("data-outcome", "pending");
				}
				await selectChoice(row.getByLabel(t("workflowResult")), index === 0 ? "done" : "na");
				await row.getByLabel(t("workflowEvidence")).fill(`T11 synthetic brand evidence ${index}`);
				await row.getByRole("button", { name: t("workflowSaveRecord"), exact: true }).click();
				await expect(row).toHaveAttribute("data-outcome", index === 0 ? "done" : "na");
				await expect(row.locator(".project-workflow-record")).toContainText(`T11 synthetic brand evidence ${index}`);
				if (index === 0) {
					await page.getByRole("button", { name: t("workflowViewReport"), exact: true }).click();
					await expect(page.locator(".project-workflow-report")).toContainText(t("workflowReportIncomplete"));
					await page.getByRole("button", { name: t("workflowBackToPlan"), exact: true }).click();
				}
			}
			const brandComplete = await workflowReadback(page, ids.id);
			expect(brandComplete.project.name).toBe("T11 Workflow Project");
			expect(brandComplete.project.url).toBe("https://t11.example.test");
			await page.reload();
			expect(await workflowReadback(page, ids.id)).toEqual(brandComplete);
			await page.getByRole("button", { name: t("workflowViewReport"), exact: true }).click();
			await expect(page.locator(".project-workflow-report")).toContainText(t("workflowReportComplete"));
			await page.getByRole("button", { name: t("workflowBackToPlan"), exact: true }).click();
			await expect(page.getByRole("button", { name: t("workflowNewRound"), exact: true })).toBeEnabled();

			await page.goto(`/assets/project/${ids.id}`);
			await page.getByRole("link", { name: t("workflowCloseEntry"), exact: true }).click();
			await page.getByRole("button", { name: t("workflowCreatePlan"), exact: true }).click();
			await expect(tasks).toHaveCount(6);
			await expect(tasks.filter({ hasText: "T11 hosting" })).toContainText("98.00");
			await expect(tasks.filter({ hasText: "t11.example.test" }).first()).toContainText("T11 Registrar");
			await expect(tasks.last().getByRole("button", { name: t("workflowRecordResult"), exact: true })).toBeDisabled();
			await tasks.first().getByRole("button", { name: t("workflowRecordResult"), exact: true }).click();
			await selectChoice(tasks.first().getByLabel(t("workflowResult")), "blocked");
			await tasks.first().getByLabel(t("workflowEvidence")).fill("T11 backup destination unavailable");
			await tasks.first().getByRole("button", { name: t("workflowSaveRecord"), exact: true }).click();
			await expect(tasks.first()).toHaveAttribute("data-outcome", "blocked");
			await page.reload();
			await expect(tasks.first()).toContainText("T11 backup destination unavailable");
			await page.getByRole("button", { name: t("workflowViewReport"), exact: true }).click();
			await expect(page.locator(".project-workflow-report")).toContainText(t("workflowReportIncomplete"));
			await expect(page.getByRole("button", { name: t("workflowArchiveLocal"), exact: true })).toHaveCount(0);
			await page.getByRole("button", { name: t("workflowBackToPlan"), exact: true }).click();
			for (let index = 0; index < 5; index++) {
				const row = tasks.nth(index);
				await row.getByRole("button", { name: t(index === 0 ? "workflowEditRecord" : "workflowRecordResult"), exact: true }).click();
				await selectChoice(row.getByLabel(t("workflowResult")), index === 0 ? "done" : "na");
				await row.getByLabel(t("workflowEvidence")).fill(`T11 synthetic close evidence ${index}; no external action performed`);
				await row.getByRole("button", { name: t("workflowSaveRecord"), exact: true }).click();
				await expect(row).toHaveAttribute("data-outcome", index === 0 ? "done" : "na");
			}
			await tasks.last().getByRole("button", { name: t("workflowRecordResult"), exact: true }).click();
			await tasks.last().getByLabel(t("workflowEvidence")).fill("T11 synthetic final local archive decision");
			await tasks.last().getByRole("button", { name: t("workflowSaveRecord"), exact: true }).click();
			await expect(tasks.last()).toHaveAttribute("data-outcome", "done");
			await page.getByRole("button", { name: t("workflowViewReport"), exact: true }).click();
			await expect(page.locator(".project-workflow-report")).toContainText(t("workflowReportComplete"));
			await page.getByRole("button", { name: t("workflowArchiveLocal"), exact: true }).click();
			await expect(page.getByRole("dialog")).toContainText(t("workflowArchiveConfirm"));
			await page.getByRole("dialog").getByRole("button", { name: t("cancel"), exact: true }).click();
			expect((await workflowReadback(page, ids.id)).project.status).toBe("active");
			await page.getByRole("button", { name: t("workflowArchiveLocal"), exact: true }).click();
			await page.getByRole("dialog").getByRole("button", { name: t("workflowConfirmArchive"), exact: true }).click();
			await expect(page.locator(".project-workflow-report")).toContainText(t("workflowArchivedLocal"));
			const archived = await workflowReadback(page, ids.id);
			expect(archived.project.status).toBe("archived");
			expect(archived.project.id).toBe(ids.id);
			expect(archived.tasks).toHaveLength(10);
			await page.reload();
			expect(await workflowReadback(page, ids.id)).toEqual(archived);
			await page.getByRole("button", { name: t("workflowViewReport"), exact: true }).click();
			await expect(page.locator(".project-workflow-report")).toContainText(t("workflowArchivedLocal"));
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			await page.screenshot({ path: join(evidence, `T11-workflow-${locale}-${width}.png`), fullPage: true });
			await test.info().attach("T11-workflow-readback", { body: JSON.stringify(archived, null, 2), contentType: "application/json" });
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
