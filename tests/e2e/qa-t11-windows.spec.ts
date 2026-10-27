import { expect, type Page, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { resources } from "../../apps/web/src/i18n";
import { selectChoice } from "./helpers/select-choice";

const domainPath = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/domain/src/index.ts`;
const evidence = "docs/qa/2026-10-27/evidence/T11-windows";
mkdirSync(evidence, { recursive: true });

const repositoryPath = `/@fs/${process.cwd().replaceAll("\\", "/")}/packages/local-db/src/index.ts`;

async function png(page: Page, color: string) {
	const base64 = await page.evaluate((fill) => {
		const canvas = document.createElement("canvas");
		canvas.width = 24;
		canvas.height = 24;
		const context = canvas.getContext("2d");
		if (!context) throw Error("canvas-unavailable");
		context.fillStyle = fill;
		context.fillRect(0, 0, 24, 24);
		return canvas.toDataURL("image/png").split(",")[1];
	}, color);
	return Buffer.from(base64, "base64");
}

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
			await expect(page.locator(".project-workflow-preview-row")).toHaveCount(5);
			await page.getByRole("button", { name: t("workflowCreatePlan"), exact: true }).click();
			await expect(page.getByRole("alert")).toHaveText(t("workflowProposalRequired"));
			await expect(page.locator(".project-workflow-task")).toHaveCount(0);
			await page.getByLabel(t("workflowProposedName")).fill("T11 proposed brand");
			await page.getByLabel(t("workflowProposedDescription")).fill("T11 proposed description");
			await page.getByLabel(t("workflowProposedUrl")).fill("https://proposed.example.test");
			await page.getByLabel(t("workflowChangeNote")).fill("T11 proposed scope");
			await page.getByRole("button", { name: t("workflowCreatePlan"), exact: true }).click();
			const tasks = page.locator(".project-workflow-task");
			await expect(tasks).toHaveCount(5);
			const snapshot = await workflowReadback(page, ids.id);
			expect(snapshot.tasks.every((task: { projectWorkflow: { projectName: string; proposedName: string } }) => task.projectWorkflow.projectName === "T11 Workflow Project" && task.projectWorkflow.proposedName === "T11 proposed brand")).toBe(true);
			await page.reload();
			expect(await workflowReadback(page, ids.id)).toEqual(snapshot);
			await expect(page.locator(".project-workflow-before-after")).toContainText("T11 proposed description");
			await expect(page.getByRole("button", { name: t("workflowNewRound"), exact: true })).toBeDisabled();
			for (let index = 0; index < 5; index++) {
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
			await expect(tasks).toHaveCount(7);
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
			for (let index = 0; index < 6; index++) {
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
			expect(archived.tasks).toHaveLength(12);
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

async function stored(page: Page, name: string) {
	return page.evaluate(async ({ path, name }) => {
		const { localRepository } = await import(path);
		const repository = await localRepository();
		const asset = (await repository.list("asset")).find((row: { name: string }) => row.name === name);
		const blobs = await repository.fileStore.blobs.toArray();
		return { asset, ids: blobs.map((blob: { id: string }) => blob.id) };
	}, { path: repositoryPath, name });
}

async function pixel(page: Page, role: string) {
	return page.locator(`[data-project-media-role="${role}"] img.asset-image`).first().evaluate((image: HTMLImageElement) => {
		const canvas = document.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		const context = canvas.getContext("2d");
		if (!context) throw Error("canvas-unavailable");
		context.drawImage(image, 0, 0, 1, 1);
		return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
	});
}

for (const locale of ["zh-CN", "en"] as const) for (const width of [390, 1280]) {
	test(`T11-01/02 ${locale} ${width}px materials and role images preserve cancellation and failures`, async ({ browser }) => {
		test.setTimeout(120_000);
		const context = await browser.newContext({ locale, viewport: { width, height: 844 } });
		const page = await context.newPage();
		const pageErrors: string[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));
		const name = `Project form media ${locale} ${width}`;
		const saveLabel = locale === "zh-CN" ? "保存" : "Save";
		try {
			await page.goto("/");
			await page.evaluate((value) => localStorage.setItem("keepany-language", value), locale);
			await page.goto("/assets/project");
			await page.getByRole("button", { name: locale === "zh-CN" ? "新增" : "Add", exact: true }).click();
			let dialog = page.getByRole("dialog");
			await dialog.locator("#name").fill(name);
			await dialog.locator("#url").fill("https://t11.example.test");
			await dialog.locator("#description").fill("T11 saved material description");
			await dialog.locator("#projectTitle").fill("T11 material title");
			await dialog.locator("#projectPromoUrl").fill("https://t11.example.test/promo");
			await dialog.locator("#projectLogoFile").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: await png(page, "#ef4030") });
			await dialog.locator("#projectHomeFile").setInputFiles({ name: "home.png", mimeType: "image/png", buffer: await png(page, "#235ac8") });
			await dialog.locator("#projectProductFiles").setInputFiles([
				{ name: "product-a.png", mimeType: "image/png", buffer: await png(page, "#239a50") },
				{ name: "product-b.png", mimeType: "image/png", buffer: await png(page, "#efbd29") },
			]);
			await dialog.locator("#projectPromoFile").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: await png(page, "#8726b0") });
			await expect(dialog.locator(".project-editor-image")).toHaveCount(5);
			await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
			await dialog.locator(".project-editor-media").scrollIntoViewIfNeeded();
			// Role pixels and persisted IDs are the acceptance evidence; avoid duplicate screenshots.
			await dialog.getByRole("button", { name: saveLabel, exact: true }).click();
			await expect(dialog).toBeHidden();
			const created = await stored(page, name);
			const initial = created.asset as { id: string; attachments: string[]; projectMedia: { logoId: string; homeScreenshotId: string; productScreenshotIds: string[]; promoCoverId: string } };
			expect(created.asset).toMatchObject({ description: "T11 saved material description", projectTitle: "T11 material title", projectPromoUrl: "https://t11.example.test/promo" });
			expect(initial.projectMedia.productScreenshotIds).toHaveLength(2);
			expect(initial.attachments[0]).toBe(initial.projectMedia.homeScreenshotId);
			for (const id of [initial.projectMedia.logoId, initial.projectMedia.homeScreenshotId, initial.projectMedia.promoCoverId, ...initial.projectMedia.productScreenshotIds]) {
				expect(initial.attachments).toContain(id);
				expect(created.ids).toContain(id);
			}
			await page.goto(`/assets/project/${initial.id}`);
			await page.locator("#asset-project-materials > summary").click();
			for (const role of ["logoId", "homeScreenshotId", "productScreenshotIds", "promoCoverId"]) await expect(page.locator(`[data-project-media-role="${role}"] img.asset-image`).first()).toBeVisible();
			expect(await pixel(page, "logoId")).toEqual([239, 64, 48]);
			expect(await pixel(page, "homeScreenshotId")).toEqual([35, 90, 200]);
			expect(await pixel(page, "productScreenshotIds")).toEqual([35, 154, 80]);
			expect(await pixel(page, "promoCoverId")).toEqual([135, 38, 176]);
			await expect(page.locator("#asset-project-materials").getByRole("link", { name: "https://t11.example.test/promo", exact: true })).toHaveAttribute("href", "https://t11.example.test/promo");
			// Preparing a replacement followed by Cancel must not write any new blob or role.
			await page.getByRole("button", { name: locale === "zh-CN" ? "编辑" : "Edit", exact: true }).first().click();
			dialog = page.getByRole("dialog");
			await dialog.locator("#projectLogoFile").setInputFiles({ name: "cancel-logo.png", mimeType: "image/png", buffer: await png(page, "#ff00ff") });
			await dialog.getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel", exact: true }).click();
			await expect(dialog).toBeHidden();
			const afterCancel = await stored(page, name);
			expect(afterCancel.asset).toEqual(created.asset);
			expect(afterCancel.ids.sort()).toEqual(created.ids.sort());
			await page.getByRole("button", { name: locale === "zh-CN" ? "编辑" : "Edit", exact: true }).first().click();
			dialog = page.getByRole("dialog");
			await dialog.locator("#projectLogoFile").setInputFiles({ name: "logo-new.png", mimeType: "image/png", buffer: await png(page, "#6839dd") });
			await dialog.locator("#projectProductFiles").setInputFiles({ name: "product-new.png", mimeType: "image/png", buffer: await png(page, "#15c7aa") });
			await dialog.getByRole("button", { name: saveLabel, exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			await page.locator("#asset-project-materials > summary").click();
			const edited = await stored(page, name);
			const updated = edited.asset as typeof initial;
			expect(updated.projectMedia.logoId).not.toBe(initial.projectMedia.logoId);
			expect(updated.projectMedia.productScreenshotIds).toHaveLength(1);
			expect(updated.projectMedia.homeScreenshotId).toBe(initial.projectMedia.homeScreenshotId);
			expect(updated.projectMedia.promoCoverId).toBe(initial.projectMedia.promoCoverId);
			for (const oldId of [initial.projectMedia.logoId, ...initial.projectMedia.productScreenshotIds]) {
				expect(updated.attachments).not.toContain(oldId);
				expect(edited.ids).not.toContain(oldId);
			}
			expect(await pixel(page, "logoId")).toEqual([104, 57, 221]);
			expect(await pixel(page, "productScreenshotIds")).toEqual([21, 199, 170]);
			expect(await pixel(page, "homeScreenshotId")).toEqual([35, 90, 200]);
			expect(await pixel(page, "promoCoverId")).toEqual([135, 38, 176]);
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
			if (locale === "en" && width === 390) {
				await page.getByRole("button", { name: "Edit", exact: true }).first().click();
				dialog = page.getByRole("dialog");
				await dialog.locator("#projectPromoFile").setInputFiles({ name: "stale-cover.png", mimeType: "image/png", buffer: await png(page, "#ff00ff") });
				await page.evaluate(async ({ path, id }) => {
					const { localRepository } = await import(path);
					const repository = await localRepository();
					const current = await repository.get("asset", id);
					await repository.saveAssetIfCurrent(current, { ...current, description: "Concurrent edit", updatedAt: new Date().toISOString() });
				}, { path: repositoryPath, id: initial.id });
				await dialog.getByRole("button", { name: saveLabel, exact: true }).click();
				await expect(dialog.getByRole("alert")).toBeVisible();
				await expect(dialog).toBeVisible();
				await expect(dialog.locator("#name")).toHaveValue(name);
				await expect(dialog.locator(".project-editor-image")).toHaveCount(4);
				const afterFailure = await stored(page, name);
				expect((afterFailure.asset as typeof initial).projectMedia.promoCoverId).toBe(updated.projectMedia.promoCoverId);
				expect(afterFailure.ids.sort()).toEqual(edited.ids.sort());
				await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
			}
			const beforeRemove = await stored(page, name);
			const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
			await page.locator('[data-project-media-role="promoCoverId"]').getByRole("button", { name: t("removeImage"), exact: true }).click();
			await expect(page.locator('[data-project-media-role="promoCoverId"] img.asset-image')).toHaveCount(0);
			await page.reload();
			await page.locator("#asset-project-materials > summary").click();
			const afterRemove = await stored(page, name);
			const removed = afterRemove.asset as typeof initial;
			const beforeRemovedAsset = beforeRemove.asset as typeof initial;
			expect(removed.projectMedia).toEqual({ ...beforeRemovedAsset.projectMedia, promoCoverId: "" });
			expect(removed.attachments).not.toContain(beforeRemovedAsset.projectMedia.promoCoverId);
			await expect.poll(async () => (await stored(page, name)).ids).not.toContain(beforeRemovedAsset.projectMedia.promoCoverId);
			expect(await pixel(page, "homeScreenshotId")).toEqual([35, 90, 200]);
			expect(await pixel(page, "logoId")).toEqual([104, 57, 221]);
			await expect(page.locator("#asset-project-materials")).toContainText("T11 material title");
			expect(pageErrors).toEqual([]);
		} finally { await context.close(); }
	});
}

