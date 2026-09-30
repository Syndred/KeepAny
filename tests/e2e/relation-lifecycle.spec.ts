import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const evidence = "docs/evidence/2026-09-29";
const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

async function relationRows(page: Page) {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		return (await (await localRepository()).list("relation", true)) as {
			id: string;
			label: string;
			source?: string;
			verifiedAt: string;
			deleted: boolean;
		}[];
	}, repositoryModuleUrl);
}

for (const scenario of [
	{
		language: "en",
		width: 1280,
		add: "Add",
		name: "Name",
		save: "Save",
		addRelation: "Add connection",
		target: "Connect to",
		label: "Connection label",
		source: "Connection source",
		verified: "Last verified",
		deleteRelation: "Delete connection",
		cancel: "Cancel",
		close: "Close",
		category: "Email",
		restore: "Restore",
		back: "Back to list",
		deleteAsset: "Move to trash",
		blocked: "Restore both connected assets before restoring this connection.",
	},
	{
		language: "en",
		width: 390,
		add: "Add",
		name: "Name",
		save: "Save",
		addRelation: "Add connection",
		target: "Connect to",
		label: "Connection label",
		source: "Connection source",
		verified: "Last verified",
		deleteRelation: "Delete connection",
		cancel: "Cancel",
		close: "Close",
		category: "Email",
		restore: "Restore",
		back: "Back to list",
		deleteAsset: "Move to trash",
		blocked: "Restore both connected assets before restoring this connection.",
	},
	{
		language: "zh-CN",
		width: 1280,
		add: "新增",
		name: "名称",
		save: "保存",
		addRelation: "添加关联",
		target: "关联至",
		label: "关联用途",
		source: "关系来源",
		verified: "最近核验",
		deleteRelation: "删除关系",
		cancel: "取消",
		close: "关闭",
		category: "邮箱",
		restore: "恢复",
		back: "返回列表",
		deleteAsset: "移至回收站",
		blocked: "请先恢复关系两端的资产，再恢复这条关系。",
	},
	{
		language: "zh-CN",
		width: 390,
		add: "新增",
		name: "名称",
		save: "保存",
		addRelation: "添加关联",
		target: "关联至",
		label: "关联用途",
		source: "关系来源",
		verified: "最近核验",
		deleteRelation: "删除关系",
		cancel: "取消",
		close: "关闭",
		category: "邮箱",
		restore: "恢复",
		back: "返回列表",
		deleteAsset: "移至回收站",
		blocked: "请先恢复关系两端的资产，再恢复这条关系。",
	},
] as const) {
	test(`${scenario.language} ${scenario.width}px relationship lifecycle and graph navigation`, async ({
		browser,
	}) => {
		test.setTimeout(90_000);
		mkdirSync(evidence, { recursive: true });
		const context = await browser.newContext({
			viewport: { width: scenario.width, height: 844 },
			locale: scenario.language === "en" ? "en-US" : "zh-CN",
		});
		await context.addInitScript(
			(language) => localStorage.setItem("keepany-language", language),
			scenario.language,
		);
		const page = await context.newPage();
		page.setDefaultTimeout(10_000);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const stamp = crypto.randomUUID().slice(0, 6);
		const project = `Project ${stamp}`;
		const account = `Account ${stamp}`;
		const label = `owner ${stamp}`;
		const extra = `invoice ${stamp}`;
		const shot = async (kind: string) =>
			page.screenshot({
				path: `${evidence}/relation-${scenario.language}-${scenario.width}-${kind}.png`,
				fullPage: kind !== "confirm",
			});
		async function addAsset(kind: "project" | "account", name: string) {
			await page.goto(`/assets/${kind}`);
			await page
				.getByRole("button", { name: scenario.add, exact: true })
				.click();
			const dialog = page.getByRole("dialog");
			await dialog.getByLabel(scenario.name, { exact: true }).fill(name);
			await dialog.getByRole("button", { name: scenario.save }).click();
			await expect(dialog).toBeHidden();
			await page.getByText(name, { exact: true }).first().click();
			await expect(page.getByRole("heading", { name })).toBeVisible();
		}
		async function addRelation(labelValue: string, withMetadata = false) {
			await page.getByRole("button", { name: scenario.addRelation }).click();
			const dialog = page.getByRole("dialog");
			await selectChoice(dialog.getByLabel(scenario.target), { label: account });
			await dialog.getByLabel(scenario.label).fill(labelValue);
			if (withMetadata) {
				await dialog.getByLabel(scenario.source).fill("Local account record");
				await dialog.getByLabel(scenario.verified).fill("2026-09-29");
			}
			await dialog.getByRole("button", { name: scenario.save }).click();
			await expect(dialog).toBeHidden();
		}
		try {
			await addAsset("account", account);
			await page.getByRole("link", { name: scenario.back }).click();
			await page
				.getByRole("button", { name: scenario.category, exact: true })
				.click();
			await expect(
				page.getByRole("button", { name: scenario.category, exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await addAsset("project", project);
			await addRelation(label, true);
			await page.getByRole("button", { name: scenario.addRelation }).click();
			const duplicate = page.getByRole("dialog");
			await selectChoice(duplicate
				.getByLabel(scenario.target), { label: account });
			await duplicate.getByLabel(scenario.label).fill(label);
			await duplicate.getByRole("button", { name: scenario.save }).click();
			await expect(duplicate.getByRole("alert")).toBeVisible();
			await duplicate.getByRole("button", { name: scenario.close }).click();
			await addRelation(extra);
			const relationList = page.locator(".relation-list");
			await expect(relationList.locator(".relation-row")).toHaveCount(2);
			await expect(page.locator(".react-flow__node")).toHaveCount(2);
			await expect(page.locator(".react-flow__edge")).toHaveCount(1);
			await expect(page.locator(".react-flow__edge-text")).toContainText(label);
			await expect(page.locator(".react-flow__edge-text")).toContainText(extra);
			await expect(
				relationList.getByText("Local account record", { exact: false }),
			).toBeVisible();
			await expect(page.locator(".toast")).toHaveCount(0);
			await shot("list-graph");
			const original = (await relationRows(page)).find(
				(row) => row.label === label,
			);
			expect(original).toMatchObject({
				source: "Local account record",
				verifiedAt: "2026-09-29",
				deleted: false,
			});
			await relationList
				.getByRole("button", {
					name: `${scenario.deleteRelation} · ${label} · ${account}`,
				})
				.click();
			await expect(page.getByRole("dialog")).toContainText(label);
			await shot("confirm");
			await page
				.getByRole("dialog")
				.getByRole("button", { name: scenario.cancel })
				.click();
			await expect(relationList.locator(".relation-row")).toHaveCount(2);
			await relationList
				.getByRole("button", {
					name: `${scenario.deleteRelation} · ${label} · ${account}`,
				})
				.click();
			await page
				.getByRole("dialog")
				.getByRole("button", { name: scenario.deleteRelation })
				.click();
			await expect(relationList.locator(".relation-row")).toHaveCount(1);
			await page.reload();
			await expect(relationList.locator(".relation-row")).toHaveCount(1);
			expect(
				(await relationRows(page)).find((row) => row.id === original?.id)
					?.deleted,
			).toBe(true);
			await page.goto("/trash");
			const trashRow = page.locator(".relation-row").filter({ hasText: label });
			await expect(trashRow).toBeVisible();
			await shot("trash");
			await trashRow.getByRole("button", { name: scenario.restore }).click();
			await expect(trashRow).toHaveCount(0);
			expect(
				(await relationRows(page)).find((row) => row.id === original?.id)
					?.deleted,
			).toBe(false);
			await page.goto("/assets/project");
			await page.getByText(project, { exact: true }).first().click();
			await page.evaluate(() =>
				sessionStorage.setItem("keepany-scroll-account", "123"),
			);
			await page
				.locator(".react-flow__node")
				.filter({ hasText: account })
				.click();
			await expect(page.getByRole("heading", { name: account })).toBeVisible();
			await page.getByRole("link", { name: scenario.back }).click();
			await expect(page).toHaveURL(/\/assets\/account$/);
			await expect(
				page.getByRole("button", { name: scenario.category, exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			expect(
				await page.evaluate(() =>
					sessionStorage.getItem("keepany-scroll-account"),
				),
			).toBe("123");
			await page.goto("/assets/project");
			await page.getByText(project, { exact: true }).first().click();
			await page
				.locator(".relation-list")
				.getByRole("button", {
					name: `${scenario.deleteRelation} · ${label} · ${account}`,
				})
				.click();
			await page
				.getByRole("dialog")
				.getByRole("button", { name: scenario.deleteRelation })
				.click();
			await expect(page.locator(".relation-row")).toHaveCount(1);
			await page.goto("/assets/account");
			await page.getByText(account, { exact: true }).first().click();
			await page.getByRole("button", { name: scenario.deleteAsset }).click();
			await page
				.getByRole("dialog")
				.getByRole("button", { name: scenario.deleteAsset })
				.click();
			await expect(page).toHaveURL(/\/assets\/account$/);
			await page.goto("/assets/project");
			await page.getByText(project, { exact: true }).first().click();
			await expect(page.locator(".relation-row")).toHaveCount(0);
			await page.goto("/trash");
			await page
				.locator(".relation-row")
				.filter({ hasText: label })
				.getByRole("button", { name: scenario.restore })
				.click();
			await expect(page.getByText(scenario.blocked)).toBeVisible();
			expect(
				(await relationRows(page)).find((row) => row.id === original?.id)
					?.deleted,
			).toBe(true);
			const deletedAccount = page
				.locator("section.card")
				.filter({
					has: page.getByRole("heading", {
						name:
							scenario.language === "en" ? "Deleted assets" : "已删除的资产",
					}),
				})
				.locator(".list-row")
				.filter({ hasText: account });
			await deletedAccount
				.getByRole("button", { name: scenario.restore })
				.click();
			await expect(deletedAccount).toHaveCount(0);
			await page
				.locator(".relation-row")
				.filter({ hasText: label })
				.getByRole("button", { name: scenario.restore })
				.click();
			await expect(
				page.locator(".relation-row").filter({ hasText: label }),
			).toHaveCount(0);
			expect(
				(await relationRows(page)).find((row) => row.id === original?.id)
					?.deleted,
			).toBe(false);
			expect(errors).toEqual([]);
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth),
			).toBeLessThanOrEqual(scenario.width);
		} finally {
			await context.close();
		}
	});
}

test("crowded graph filters neighbors and clears filter on center change", async ({
	browser,
}) => {
	test.setTimeout(90_000);
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		locale: "en-US",
	});
	const page = await context.newPage();
	page.setDefaultTimeout(10_000);
	const suffix = crypto.randomUUID().slice(0, 6);
	const project = `Graph ${suffix}`;
	const neighbors = Array.from(
		{ length: 5 },
		(_, index) => `Neighbor ${index} ${suffix}`,
	);
	try {
		for (const [kind, name] of [
			["project", project],
			...neighbors.map((name) => ["account", name]),
		] as ["project" | "account", string][]) {
			await page.goto(`/assets/${kind}`);
			await page.getByRole("button", { name: "Add", exact: true }).click();
			const dialog = page.getByRole("dialog");
			await dialog.getByLabel("Name", { exact: true }).fill(name);
			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(dialog).toBeHidden();
		}
		await page.goto("/assets/project");
		await page.getByText(project, { exact: true }).first().click();
		for (const [index, neighbor] of neighbors.entries()) {
			await page.getByRole("button", { name: "Add connection" }).click();
			const dialog = page.getByRole("dialog");
			await selectChoice(dialog.getByLabel("Connect to"), { label: neighbor });
			await dialog.getByLabel("Connection label").fill(`role ${index}`);
			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(dialog).toBeHidden();
		}
		const filter = page.getByLabel("Filter connections");
		await expect(filter).toBeVisible();
		await expect(page.locator(".relation-row")).toHaveCount(5);
		await filter.fill(neighbors[4]);
		await expect(page.locator(".relation-row")).toHaveCount(1);
		await expect(page.locator(".react-flow__node")).toHaveCount(2);
		await expect(page.locator(".react-flow__edge")).toHaveCount(1);
		await expect(page.locator(".toast")).toHaveCount(0);
		await page.screenshot({
			path: `${evidence}/relation-en-390-filter.png`,
			fullPage: true,
		});
		await page
			.locator(".react-flow__node")
			.filter({ hasText: neighbors[4] })
			.click();
		await expect(
			page.getByRole("heading", { name: neighbors[4] }),
		).toBeVisible();
		await page.goto("/assets/project");
		await page.getByText(project, { exact: true }).first().click();
		await expect(filter).toHaveValue("");
		await expect(page.locator(".relation-row")).toHaveCount(5);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
		).toBeLessThanOrEqual(390);
	} finally {
		await context.close();
	}
});

test("missing relation endpoint keeps tombstone and explains the failure", async ({
	page,
}) => {
	await page.goto("/trash");
	const label = `missing ${crypto.randomUUID().slice(0, 6)}`;
	await page.evaluate(
		async ({ modulePath, label }) => {
			const { save } = await import(modulePath);
			await save("relation", {
				id: crypto.randomUUID(),
				from: crypto.randomUUID(),
				to: crypto.randomUUID(),
				label,
				createdAt: new Date().toISOString(),
				verifiedAt: "",
				deleted: true,
			});
		},
		{ modulePath: repositoryModuleUrl, label },
	);
	const row = page.locator(".relation-row").filter({ hasText: label });
	await expect(row).toBeVisible();
	await row.getByRole("button", { name: "Restore" }).click();
	await expect(
		row.getByText(
			"A connected asset is missing, so this connection cannot be restored yet.",
		),
	).toBeVisible();
	expect(
		(await relationRows(page)).find((relation) => relation.label === label)
			?.deleted,
	).toBe(true);
});
