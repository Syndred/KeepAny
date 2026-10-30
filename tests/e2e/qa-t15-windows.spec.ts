import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";
import { activeAccountGraph, setAccountRelationDetailsOpen, waitForAccountGraphLayout } from "./helpers/account-graph";

const repo = `/@fs/${resolve("packages/local-db/src/index.ts").replaceAll("\\", "/")}`;
const domain = `/@fs/${resolve("packages/domain/src/index.ts").replaceAll("\\", "/")}`;
const evidence = "test-results/qa/2026-10-27/evidence/T15-windows";
mkdirSync(evidence, { recursive: true });

async function rows(page: Page) {
	return page.evaluate(async path => {
		const { localRepository } = await import(path);
		const db = await localRepository();
		return { relations: await db.list("relation", true), tasks: await db.list("task", true) };
	}, repo);
}

for (const locale of ["zh-CN", "en-US"] as const) for (const width of [390, 1280]) {
	test(`${locale} ${width}px T15 relation IDs, restore and impact replacement history`, async ({ browser }) => {
		test.setTimeout(100_000);
		const zh = locale === "zh-CN";
		const copy = { add: zh ? "添加关联" : "Add connection", save: zh ? "保存" : "Save", remove: zh ? "删除关系" : "Delete connection", cancel: zh ? "取消" : "Cancel", restore: zh ? "恢复" : "Restore", generate: zh ? "生成检查待办" : "Create checklist", complete: zh ? "完成" : "Complete", remind: zh ? "稍后提醒" : "Remind later", inactive: zh ? "原关联已移除或资产已删除；此待办保留生成时的记录。" : "The original connection or asset was removed. This task retains its recorded details." };
		const context = await browser.newContext({ locale, viewport: { width, height: 900 } });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", e => errors.push(e.message));
		try {
			await page.goto("/");
			const assets = await page.evaluate(async ([repositoryPath, domainPath]) => {
				const { saveBatch } = await import(repositoryPath);
				const { newAsset } = await import(domainPath);
				const data = [{ ...newAsset("account"), name: "T15 Phone owner", category: "phone", username: "+8613900001542" }, { ...newAsset("account"), name: "T15 Same named service", username: "t15.primary@example.test" }, { ...newAsset("account"), name: "T15 Same named service", username: "t15.alternate@example.test" }];
				await saveBatch(data.map(value => ({ type: "asset", value })));
				return data;
			}, [repo, domain]);
			const root = `/assets/account/${assets[0].id}`;
			async function add(label: string, source: string, verified: string) {
				await page.getByRole("button", { name: copy.add, exact: true }).click();
				const form = page.getByRole("dialog");
				await selectChoice(form.locator("#relation-target"), assets[1].id);
				await form.locator("#relation-label").fill(label);
				await form.locator("#relation-source").fill(source);
				await form.locator("#relation-verified").fill(verified);
				await form.getByRole("button", { name: copy.save, exact: true }).click();
				await expect(form).toBeHidden();
				return (await rows(page)).relations.find((r: { label: string; deleted: boolean }) => r.label === label && !r.deleted);
			}
			async function remove(id: string, cancel = false) {
				const relation = (await rows(page)).relations.find((r: { id: string }) => r.id === id);
				const detail = await setAccountRelationDetailsOpen(page);
				await detail.locator(".relation-row").filter({ hasText: relation.label }).getByRole("button", { name: new RegExp(`^${copy.remove} ·`) }).click();
				await page.getByRole("dialog").getByRole("button", { name: cancel ? copy.cancel : copy.remove, exact: true }).click();
				await expect(page.getByRole("dialog")).toBeHidden();
			}
			// T15-01: target IDs disambiguate identical names and preserve direction.
			await page.goto(root);
			const first = await add("T15 Recovery", "T15 verified account note", "2026-10-27");
			expect(first).toMatchObject({ from: assets[0].id, to: assets[1].id, source: "T15 verified account note", verifiedAt: "2026-10-27", deleted: false });
			await page.reload();
			await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
			await expect(activeAccountGraph(page).locator(`.react-flow__edge[data-from="${assets[0].id}"][data-to="${assets[1].id}"]`)).toHaveCount(1);
			await page.goto(`/assets/account/${assets[1].id}`);
			await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
			await expect((await setAccountRelationDetailsOpen(page)).locator(".relation-row")).toContainText("T15 verified account note");
			await page.goto(`/assets/account/${assets[2].id}`);
			await waitForAccountGraphLayout(page, { nodes: 1, edges: 0 });
			await page.goto(root);
			const second = await add("T15 Billing", "T15 other purpose", "");
			// T15-02: cancel preserves exact rows; delete/restore keeps the original ID.
			await remove(first.id, true);
			expect((await rows(page)).relations.find((r: { id: string }) => r.id === first.id)).toEqual(first);
			await remove(first.id);
			expect((await rows(page)).relations.find((r: { id: string }) => r.id === second.id)).toEqual(second);
			await page.goto("/trash");
			await page.locator(`.trash-row[data-relation-id="${first.id}"]`).getByRole("button", { name: copy.restore, exact: true }).click();
			await expect(page.locator(`.trash-row[data-relation-id="${first.id}"]`)).toHaveCount(0);
			await page.reload();
			const restored = await rows(page);
			expect(restored.relations.filter((r: { id: string }) => r.id === first.id)).toEqual([first]);
			expect(restored.relations.find((r: { id: string }) => r.id === second.id)).toEqual(second);
			// T15-03: create through change-impact, then persist completion/reminder.
			await page.goto("/change-impact");
			await expect(page.locator(".change-impact-snapshot strong")).toHaveText(assets[0].name);
			await page.getByRole("button", { name: `${copy.generate} · 2`, exact: true }).click();
			await expect(page.locator(".impact-task-row")).toHaveCount(2);
			await expect(page.getByRole("button", { name: `${copy.generate} · 0`, exact: true })).toBeDisabled();
			let tasks = (await rows(page)).tasks;
			const taskA = tasks.find((t: { impactSnapshot?: { relationId: string } }) => t.impactSnapshot?.relationId === first.id);
			const taskB = tasks.find((t: { impactSnapshot?: { relationId: string } }) => t.impactSnapshot?.relationId === second.id);
			expect(taskA.impactSnapshot).toMatchObject({ accountId: assets[0].id, relationId: first.id, fromAssetId: assets[0].id, toAssetId: assets[1].id, label: first.label, source: first.source, verifiedAt: first.verifiedAt });
			await page.locator(`#task-${taskA.id}`).getByRole("button", { name: new RegExp(`^${copy.complete} ·`) }).click();
			await page.locator(`#task-${taskB.id}`).getByLabel(copy.remind, { exact: true }).fill("2026-11-15");
			await expect.poll(async () => (await rows(page)).tasks.find((t: { id: string }) => t.id === taskB.id)?.dueDate).toBe("2026-11-15");
			await page.reload();
			tasks = (await rows(page)).tasks;
			const completed = tasks.find((t: { id: string }) => t.id === taskA.id);
			const reminded = tasks.find((t: { id: string }) => t.id === taskB.id);
			expect(completed).toMatchObject({ done: true, impactSnapshot: taskA.impactSnapshot });
			expect(completed.completionHistory).toHaveLength(1);
			expect(completed.completedAt).toBe(completed.completionHistory[0]);
			expect(reminded).toMatchObject({ done: false, dueDate: "2026-11-15", impactSnapshot: taskB.impactSnapshot });
			// T15-04: a replacement same-neighbor/same-label relation gets a fresh task.
			await page.goto(root);
			await remove(first.id);
			const replacement = await add(first.label, "T15 replacement evidence", "2026-10-26");
			expect(replacement.id).not.toBe(first.id);
			await page.goto("/change-impact");
			await expect(page.locator(`#task-${taskA.id}`).getByText(copy.inactive, { exact: true })).toBeVisible();
			await page.getByRole("button", { name: `${copy.generate} · 1`, exact: true }).click();
			await expect(page.locator(".impact-task-row")).toHaveCount(3);
			await page.reload();
			const final = await rows(page);
			expect(final.tasks.find((t: { id: string }) => t.id === completed.id)).toEqual(completed);
			expect(final.tasks.find((t: { id: string }) => t.id === reminded.id)).toEqual(reminded);
			const fresh = final.tasks.find((t: { impactSnapshot?: { relationId: string } }) => t.impactSnapshot?.relationId === replacement.id);
			expect(fresh).toMatchObject({ done: false, completedAt: "", completionHistory: [], impactSnapshot: { label: first.label, source: "T15 replacement evidence", verifiedAt: "2026-10-26" } });
			expect(fresh.id).not.toBe(completed.id);
			await expect(page.getByRole("button", { name: `${copy.generate} · 0`, exact: true })).toBeDisabled();
			await expect(page.locator(".toast")).toBeHidden({ timeout: 10_000 });
			await page.locator(".change-impact-task-records").screenshot({ path: `${evidence}/T15-${locale}-${width}.png` });
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}

