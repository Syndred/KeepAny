import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";
import { activeAccountGraph, exerciseAccountGraphControls, expectAccountGraphGeometry, fitAccountGraph, panAccountGraphNodeIntoView, setAccountRelationDetailsOpen, waitForAccountGraphLayout } from "./helpers/account-graph";

const repo = `/@fs/${resolve("packages/local-db/src/index.ts").replaceAll("\\", "/")}`;
const domain = `/@fs/${resolve("packages/domain/src/index.ts").replaceAll("\\", "/")}`;
const evidence = "docs/qa/2026-10-27/evidence/T04-windows";
mkdirSync(evidence, { recursive: true });

async function fixture(page: Page) {
	return page.evaluate(async ([repositoryPath, domainPath]) => {
		const { saveBatch } = await import(repositoryPath);
		const { newAsset, relationSchema } = await import(domainPath);
		const names = ["T04 Root service", "T04 Separate service", "T04 Small account", "T04 Recovery phone", "T04 Intermediate service", "T04 Remote exceptionally long account name that stays readable in the graph", "T04 Other branch", "T04 New verified target"];
		const assets = names.map((name, i) => ({ ...newAsset("account"), name, username: i < 3 ? "t04.owner@example.test" : i === 3 ? "+8613900001234" : `t04-${i}@example.test` }));
		const paths = [[0, 1], [0, 3], [1, 4], [4, 5], [0, 6], [6, 5]];
		const relations = paths.map(([from, to], i) => relationSchema.parse({ id: crypto.randomUUID(), from: assets[from].id, to: assets[to].id, label: `T04 link ${i}`, source: i === 0 ? "Manual synthetic record" : "Synthetic suggested source", verifiedAt: i === 0 ? "2026-10-20" : "", createdAt: new Date().toISOString() }));
		await saveBatch([...assets.map(value => ({ type: "asset", value })), ...relations.map(value => ({ type: "relation", value }))]);
		return { assets, relations };
	}, [repo, domain]);
}

for (const locale of ["zh-CN", "en-US"] as const) for (const width of [390, 1280]) {
	test(`${locale} ${width}px T04 identity, graph navigation, search and precise connection deletion`, async ({ browser }) => {
		test.setTimeout(120_000);
		const zh = locale === "zh-CN";
		const text = { edit: zh ? "编辑" : "Edit", save: zh ? "保存" : "Save", direct: zh ? "直接关联" : "Direct", family: zh ? "完整关系" : "All connections", add: zh ? "添加关联" : "Add connection", remove: zh ? "删除关系" : "Delete connection", cancel: zh ? "取消" : "Cancel" };
		const context = await browser.newContext({ locale, viewport: { width, height: 900 } });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", error => errors.push(error.message));
		try {
			await page.goto("/");
			const data = await fixture(page);
			const root = `/assets/account/${data.assets[0].id}`;
			const state = () => page.evaluate(async path => {
				const { localRepository } = await import(path);
				const db = await localRepository();
				return { assets: await db.list("asset"), relations: await db.list("relation", true) };
			}, repo);
			// T04-01: edits persist without merging another service or a small account.
			await page.goto(root);
			for (const identifier of ["+8613900001234", "t04.owner@example.test"]) {
				await page.locator(".page-header").getByRole("button", { name: text.edit, exact: true }).click();
				await page.locator("#username").fill(identifier);
				await page.getByRole("dialog").getByRole("button", { name: text.save, exact: true }).click();
				await expect(page.getByRole("dialog")).toBeHidden();
				await page.reload();
				const saved = await state();
				expect(saved.assets).toHaveLength(8);
				expect(saved.assets.find((a: { id: string }) => a.id === data.assets[0].id)?.username).toBe(identifier);
				for (const other of data.assets.slice(1)) expect(saved.assets.find((a: { id: string }) => a.id === other.id)).toEqual(other);
			}
			// T04-02: direct/full topology and actual node navigation/return.
			await page.getByRole("button", { name: text.direct, exact: true }).click();
			await waitForAccountGraphLayout(page, { nodes: 4, edges: 3 });
			await page.getByRole("button", { name: text.family, exact: true }).click();
			await waitForAccountGraphLayout(page, { nodes: 6, edges: 6 });
			await expectAccountGraphGeometry(page);
			await panAccountGraphNodeIntoView(page, data.assets[1].id);
			await activeAccountGraph(page).locator(`.react-flow__node[data-id="${data.assets[1].id}"] a`).click();
			await expect(page).toHaveURL(new RegExp(data.assets[1].id));
			await expect(page.locator(".page-header h1")).toHaveText(data.assets[1].name);
			await page.goBack();
			await expect(page).toHaveURL(new RegExp(data.assets[0].id));
			await page.locator('.topbar-back-link[href="/assets/account"]').click();
			await expect(page).toHaveURL(/\/assets\/account$/);
			await expect(page.locator(`a[href="${root}"]`).first()).toBeVisible();
			await page.locator(`a[href="${root}"]`).first().click();
			// T04-03: matching remote node keeps both required routes and controls usable.
			await page.getByRole("button", { name: text.family, exact: true }).click();
			await page.locator("#relation-filter").fill("Remote exceptionally");
			await waitForAccountGraphLayout(page);
			await expect(activeAccountGraph(page).locator(`.react-flow__node[data-id="${data.assets[5].id}"]`)).toHaveClass(/asset-graph-match/);
			await expect(activeAccountGraph(page).locator(`.react-flow__node[data-id="${data.assets[1].id}"]`)).toHaveCount(1);
			await expect(activeAccountGraph(page).locator(`.react-flow__node[data-id="${data.assets[4].id}"]`)).toHaveCount(1);
			await exerciseAccountGraphControls(page);
			await activeAccountGraph(page).locator("#account-graph-expand").click();
			await expect(page.getByRole("dialog")).toBeVisible();
			await waitForAccountGraphLayout(page);
			await expectAccountGraphGeometry(page);
			await activeAccountGraph(page).locator("#account-graph-expand").click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await expect(page.locator("#relation-filter")).toHaveValue("Remote exceptionally");
			await page.locator("#relation-filter").fill("");
			// T04-04: record a newly verified manual connection beside suggested ones.
			await page.getByRole("button", { name: text.add, exact: true }).click();
			const form = page.getByRole("dialog");
			await selectChoice(form.locator("#relation-target"), data.assets[7].id);
			await form.locator("#relation-label").fill("T04 explicitly verified");
			await form.locator("#relation-source").fill("T04 manual verification");
			await form.locator("#relation-verified").fill("2026-10-27");
			await form.getByRole("button", { name: text.save, exact: true }).click();
			await expect(form).toBeHidden();
			await page.reload();
			const verified = (await state()).relations.find((r: { label: string }) => r.label === "T04 explicitly verified");
			expect(verified).toMatchObject({ from: data.assets[0].id, to: data.assets[7].id, source: "T04 manual verification", verifiedAt: "2026-10-27", deleted: false });
			const detail = await setAccountRelationDetailsOpen(page);
			const row = detail.locator(".relation-row").filter({ hasText: "T04 explicitly verified" });
			await expect(row).toContainText("T04 manual verification");
			const button = row.getByRole("button", { name: new RegExp(`^${text.remove} ·`) });
			await button.click();
			await page.getByRole("dialog").getByRole("button", { name: text.cancel, exact: true }).click();
			expect((await state()).relations.find((r: { id: string }) => r.id === verified.id)).toEqual(verified);
			await button.click();
			await page.getByRole("dialog").getByRole("button", { name: text.remove, exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			await page.reload();
			const final = await state();
			expect(final.relations.find((r: { id: string }) => r.id === verified.id)?.deleted).toBe(true);
			for (const previous of data.relations) expect(final.relations.find((r: { id: string }) => r.id === previous.id)).toEqual(previous);
			await fitAccountGraph(page);
			await expect(page.locator(".toast")).toBeHidden({ timeout: 10_000 });
			await page.screenshot({ path: `${evidence}/T04-${locale}-${width}.png` });
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}


