import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
const repositoryPath = `/@fs/${resolve("packages/local-db/src/index.ts").replaceAll("\\", "/")}`;
const domainPath = `/@fs/${resolve("packages/domain/src/index.ts").replaceAll("\\", "/")}`;
const editPath = `/@fs/${resolve("apps/web/src/task-edit.ts").replaceAll("\\", "/")}`;
const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/T16-completion";
async function tasks(page: Page) { return page.evaluate(async path => (await (await import(path)).localRepository()).list("task", true), repositoryPath); }
for (const zh of [true, false]) for (const width of [390, 1280]) {
	test(`${zh ? "zh" : "en"} ${width} T16-03 edit cancel/save, date intersection and return`, async ({ browser }) => {
		const context = await browser.newContext({ locale: zh ? "zh-CN" : "en-US", viewport: { width, height: 900 } });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
		const page = await context.newPage(); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
		try {
			await page.goto("/");
			const fixture = await page.evaluate(async ([rp, dp, ep]) => {
				const { saveBatch } = await import(rp); const { newAsset, taskSchema } = await import(dp);
				const asset = { ...newAsset("project"), name: "T16 date project" };
				const task = taskSchema.parse({ id: crypto.randomUUID(), name: "T16 original ".repeat(13).trim(), assetId: asset.id, dueDate: "2026-10-28", createdAt: new Date().toISOString(), completionHistory: ["2026-10-20T00:00:00Z"] });
				const occupied = { ...task, id: crypto.randomUUID(), name: "T16 occupied" };
				const { manualTaskDedupeKey } = await import(ep);
				task.dedupeKey = await manualTaskDedupeKey(task.name, task.assetId, task.dueDate);
				occupied.dedupeKey = await manualTaskDedupeKey(occupied.name, occupied.assetId, occupied.dueDate);
				const past = { ...task, id: crypto.randomUUID(), name: "T16 past", dueDate: "2026-10-26", dedupeKey: "" };
				const done = { ...task, id: crypto.randomUUID(), name: "T16 done", dueDate: "2026-10-29", dedupeKey: "", done: true, completedAt: "2026-10-27T00:00:00Z" };
				await saveBatch([{ type: "asset", value: asset }, ...[task, occupied, past, done].map(value => ({ type: "task", value }))]);
				return { asset, task, occupied, past, done };
			}, [repositoryPath, domainPath, editPath]);
			await page.goto("/tasks");
			const row = page.locator(`#task-${fixture.task.id}`);
			const edit = zh ? "编辑" : "Edit", cancel = zh ? "取消" : "Cancel", save = zh ? "保存" : "Save", name = zh ? "名称" : "Name";
			await row.getByRole("button", { name: edit, exact: true }).click();
			let dialog = page.getByRole("dialog");
			await dialog.getByLabel(name, { exact: true }).fill("Cancelled task edit");
			await dialog.getByRole("button", { name: cancel, exact: true }).click();
			expect((await tasks(page)).find((task: { id: string }) => task.id === fixture.task.id)).toEqual(fixture.task);
			await row.getByRole("button", { name: edit, exact: true }).click();
			dialog = page.getByRole("dialog");
			await dialog.getByLabel(name, { exact: true }).fill("");
			await dialog.getByRole("button", { name: save, exact: true }).click();
			await expect(dialog).toBeVisible();
			expect((await tasks(page)).find((task: { id: string }) => task.id === fixture.task.id)).toEqual(fixture.task);
			await dialog.getByLabel(name, { exact: true }).fill(fixture.occupied.name);
			await dialog.getByRole("button", { name: save, exact: true }).click();
			await expect(dialog.getByRole("alert")).toHaveText(zh ? "同一待办已存在且尚未完成。" : "This task is already pending.");
			await dialog.getByLabel(name, { exact: true }).fill("T16 edited task");
			await dialog.getByLabel(zh ? "日期" : "Date", { exact: true }).fill("2026-10-30");
			await page.evaluate(async path => { const db = await (await import(path)).localRepository(); const original = db.saveTaskIfCurrent.bind(db); db.saveTaskIfCurrent = async () => { db.saveTaskIfCurrent = original; throw new DOMException("Synthetic quota", "QuotaExceededError"); }; }, repositoryPath);
			await dialog.getByRole("button", { name: save, exact: true }).click();
			await expect(dialog.getByRole("alert")).toBeVisible();
			await expect(dialog.getByLabel(name, { exact: true })).toHaveValue("T16 edited task");
			expect((await tasks(page)).find((task: { id: string }) => task.id === fixture.task.id)).toEqual(fixture.task);
			await dialog.getByRole("button", { name: save, exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			const saved = (await tasks(page)).find((task: { id: string }) => task.id === fixture.task.id);
			expect(saved).toMatchObject({ name: "T16 edited task", dueDate: "2026-10-30", assetId: fixture.asset.id, completionHistory: fixture.task.completionHistory, createdAt: fixture.task.createdAt });
			expect((await tasks(page)).filter((task: { id: string }) => task.id !== fixture.task.id)).toEqual([fixture.occupied, fixture.past, fixture.done].sort((a, b) => a.id.localeCompare(b.id)));
			await page.getByLabel(zh ? "开始日期" : "Start date", { exact: true }).fill("2026-10-29");
			await page.getByLabel(zh ? "结束日期" : "End date", { exact: true }).fill("2026-10-30");
			await page.locator(".task-filters").getByRole("button", { name: new RegExp(`^${zh ? "待处理" : "Pending"}`) }).click();
			await expect(page.locator(".tasks-list-card .impact-task-info > strong")).toHaveText(["T16 edited task"]);
			await row.getByRole("link", { name: fixture.asset.name, exact: true }).click();
			await page.goBack(); await page.reload();
			await expect(page.getByLabel(zh ? "开始日期" : "Start date", { exact: true })).toHaveValue("2026-10-29");
			await expect(page.locator(".tasks-list-card .impact-task-info > strong")).toHaveText(["T16 edited task"]);
			await page.getByLabel(zh ? "结束日期" : "End date", { exact: true }).fill("2026-10-28");
			await expect(page.getByRole("alert")).toHaveText(zh ? "结束日期不能早于开始日期。" : "The end date must be on or after the start date.");
			await page.getByRole("button", { name: zh ? "清除日期" : "Clear dates", exact: true }).click();
			await expect(page.locator(".tasks-list-card .impact-task-info > strong")).toHaveCount(3);
			// A competing save after this editor opened must not become its new expected version.
			await row.getByRole("button", { name: edit, exact: true }).click();
			await page.getByRole("dialog").getByLabel(name, { exact: true }).fill("T16 stale draft");
			await page.evaluate(async ({ path, id }) => { const db = await (await import(path)).localRepository(); const current = await db.get("task", id); await db.saveTaskIfCurrent(current, { ...current, name: "T16 other tab" }); }, { path: repositoryPath, id: fixture.task.id });
			await page.getByRole("dialog").getByRole("button", { name: save, exact: true }).click();
			await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
			expect((await tasks(page)).find((task: { id: string }) => task.id === fixture.task.id)?.name).toBe("T16 other tab");
			await page.getByRole("dialog").getByRole("button", { name: cancel, exact: true }).click();
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
			if ((zh && width === 390) || (!zh && width === 1280)) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: `${evidence}/${zh ? "zh-390" : "en-1280"}.png`, fullPage: true }); }
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}
