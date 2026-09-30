import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "docs/evidence/2026-09-29";
const repositoryModuleUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;

async function taskRows(page: Page) {
	return page.evaluate(async (modulePath) => {
		const { localRepository } = await import(modulePath);
		return (await (await localRepository()).list("task", true)) as {
			id: string;
			dedupeKey: string;
			done: boolean;
			dueDate: string;
			completedAt: string;
			completionHistory: string[];
			impactSnapshot?: { accountId: string; relationId: string; label: string; source: string; verifiedAt: string; legacyDedupeKey?: string };
		}[];
	}, repositoryModuleUrl);
}

for (const scenario of [
	{ language: "en", width: 1280, add: "Add", name: "Name", save: "Save", addRelation: "Add connection", target: "Connect to", label: "Connection label", source: "Connection source", verified: "Last verified", generate: "Create checklist", complete: "Complete", reopen: "Reopen", remind: "Remind later", pending: "Pending", done: "Completed", all: "All", task: "View task", backup: "Create backup", download: "Save backup file", preview: "Preview", restored: /Restored \d+ records/ },
	{ language: "en", width: 390, add: "Add", name: "Name", save: "Save", addRelation: "Add connection", target: "Connect to", label: "Connection label", source: "Connection source", verified: "Last verified", generate: "Create checklist", complete: "Complete", reopen: "Reopen", remind: "Remind later", pending: "Pending", done: "Completed", all: "All", task: "View task", backup: "Create backup", download: "Save backup file", preview: "Preview", restored: /Restored \d+ records/ },
	{ language: "zh-CN", width: 1280, add: "新增", name: "名称", save: "保存", addRelation: "添加关联", target: "关联至", label: "关联用途", source: "关系来源", verified: "最近核验", generate: "生成检查待办", complete: "完成", reopen: "重新打开", remind: "稍后提醒", pending: "待处理", done: "已完成", all: "全部", task: "查看待办", backup: "创建备份", download: "保存备份文件", preview: "预览", restored: /已恢复 \d+ 条记录/ },
	{ language: "zh-CN", width: 390, add: "新增", name: "名称", save: "保存", addRelation: "添加关联", target: "关联至", label: "关联用途", source: "关系来源", verified: "最近核验", generate: "生成检查待办", complete: "完成", reopen: "重新打开", remind: "稍后提醒", pending: "待处理", done: "已完成", all: "全部", task: "查看待办", backup: "创建备份", download: "保存备份文件", preview: "预览", restored: /已恢复 \d+ 条记录/ },
] as const) {
	test(`${scenario.language} ${scenario.width}px account impact checklist and fresh .ka1 restore`, async ({ browser }) => {
		test.setTimeout(150_000);
		mkdirSync(evidence, { recursive: true });
		const context = await browser.newContext({
			locale: scenario.language === "en" ? "en-US" : "zh-CN",
			viewport: { width: scenario.width, height: 844 },
			acceptDownloads: true,
		});
		await context.addInitScript((language) => localStorage.setItem("keepany-language", language), scenario.language);
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.setDefaultTimeout(12_000);
		const suffix = crypto.randomUUID().slice(0, 6);
		const account = `Account ${suffix}`;
		const project = `Project ${suffix}`;
		const labelA = `Recovery ${suffix}`;
		const labelB = `Billing ${suffix}`;
		const password = `impact-local-${suffix}-2026`;
		async function addAsset(kind: "account" | "project", name: string) {
			await page.goto(`/assets/${kind}`);
			await page.getByRole("button", { name: scenario.add, exact: true }).click();
			const dialog = page.getByRole("dialog");
			await dialog.getByLabel(scenario.name, { exact: true }).fill(name);
			await dialog.getByRole("button", { name: scenario.save }).click();
			await expect(dialog).toBeHidden();
			await page.getByText(name, { exact: true }).first().click();
			await expect(page.getByRole("heading", { name })).toBeVisible();
			return page.url();
		}
		async function addRelation(label: string, metadata: boolean) {
			await page.getByRole("button", { name: scenario.addRelation }).click();
			const dialog = page.getByRole("dialog");
			await selectChoice(dialog.getByLabel(scenario.target), { label: project });
			await dialog.getByLabel(scenario.label).fill(label);
			if (metadata) {
				await dialog.getByLabel(scenario.source).fill("Local relationship note");
				await dialog.getByLabel(scenario.verified).fill("2026-09-29");
			}
			await dialog.getByRole("button", { name: scenario.save }).click();
			await expect(dialog).toBeHidden();
		}
		try {
			await addAsset("project", project);
			const accountUrl = await addAsset("account", account);
			await addRelation(labelA, true);
			await addRelation(labelB, false);
			const checklist = page.locator(".impact-checklist");
			await expect(checklist.getByRole("button", { name: `${scenario.generate} · 2` })).toBeEnabled();
			await checklist.getByRole("button", { name: `${scenario.generate} · 2` }).click();
			await expect(checklist.locator(".impact-task-row")).toHaveCount(2);
			await expect(checklist.getByRole("button", { name: `${scenario.generate} · 0` })).toBeDisabled();
			const initial = (await taskRows(page)).filter((row) => row.impactSnapshot);
			expect(initial).toHaveLength(2);
			expect(new Set(initial.map((row) => row.impactSnapshot?.relationId)).size).toBe(2);
			expect(initial.find((row) => row.impactSnapshot?.label === labelA)?.impactSnapshot).toMatchObject({ source: "Local relationship note", verifiedAt: "2026-09-29" });
			const first = checklist.locator(".impact-task-row").filter({ hasText: labelA });
			const second = checklist.locator(".impact-task-row").filter({ hasText: labelB });
			await expect(first.getByRole("link", { name: project })).toBeVisible();
			await first.getByRole("button", { name: new RegExp(scenario.complete) }).click();
			await expect(first.getByText(scenario.done, { exact: true })).toBeVisible();
			await second.getByLabel(scenario.remind).fill("2026-10-05");
			await expect(second.getByLabel(scenario.remind)).toHaveValue("2026-10-05");
			await expect(checklist.getByRole("button", { name: `${scenario.pending} · 1` })).toBeVisible();
			await checklist.getByRole("button", { name: `${scenario.pending} · 1` }).click();
			await expect(checklist.locator(".impact-task-row")).toHaveCount(1);
			await checklist.getByRole("button", { name: `${scenario.done} · 1` }).click();
			await expect(checklist.locator(".impact-task-row")).toHaveCount(1);
			await checklist.getByRole("button", { name: `${scenario.all} · 2` }).click();
			await expect(page.locator(".react-flow__node")).toHaveCount(2);
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.screenshot({ path: `${evidence}/impact-${scenario.language}-${scenario.width}-account.png`, fullPage: true });
			await first.getByRole("link", { name: scenario.task }).click();
			await expect(page).toHaveURL(/\/tasks#task-/);
			await expect(page.locator(".impact-task-row")).toHaveCount(2);
			await page.screenshot({ path: `${evidence}/impact-${scenario.language}-${scenario.width}-tasks.png`, fullPage: true });
			await page.locator(".impact-task-row").filter({ hasText: labelA }).getByRole("button", { name: new RegExp(scenario.reopen) }).click();
			await expect(page.locator(".impact-task-row").filter({ hasText: labelA }).getByText(scenario.pending, { exact: true })).toBeVisible();
			await page.locator(".impact-task-row").filter({ hasText: labelA }).getByRole("button", { name: new RegExp(scenario.complete) }).click();
			await expect(page.locator(".impact-task-row").filter({ hasText: labelA }).getByText(scenario.done, { exact: true })).toBeVisible();
			await expect.poll(async () => (await taskRows(page)).find((row) => row.impactSnapshot?.label === labelA)?.completionHistory?.length).toBe(2);
			await page.goto(accountUrl);
			await expect(checklist.locator(".impact-task-row")).toHaveCount(2);
			const before = (await taskRows(page)).filter((row) => row.impactSnapshot).sort((a, b) => a.id.localeCompare(b.id));
			expect(before).toHaveLength(2);
			expect(before.find((row) => row.impactSnapshot?.label === labelA)?.completionHistory).toHaveLength(2);
			expect(before.find((row) => row.impactSnapshot?.label === labelB)?.dueDate).toBe("2026-10-05");
			await page.reload();
			await expect(checklist.locator(".impact-task-row")).toHaveCount(2);
			await page.goto("/intake");
			await page.locator("#backup-password").fill(password);
			await page.getByRole("button", { name: scenario.backup }).click();
			const saveFile = page.getByRole("link", { name: scenario.download });
			await expect(saveFile).toBeVisible();
			const downloadPromise = page.waitForEvent("download");
			await saveFile.click();
			const download = await downloadPromise;
			expect(download.suggestedFilename()).toMatch(/\.ka1$/);
			const path = await download.path();
			if (!path) throw Error("backup download missing");
			expect(readFileSync(path).byteLength).toBeGreaterThan(52);
			const restoreContext = await browser.newContext({ locale: scenario.language === "en" ? "en-US" : "zh-CN", viewport: { width: scenario.width, height: 844 } });
			await restoreContext.addInitScript((language) => localStorage.setItem("keepany-language", language), scenario.language);
			const restored = await restoreContext.newPage();
			restored.on("pageerror", (error) => errors.push(error.message));
			try {
				await restored.goto("/intake");
				await restored.locator("#backup-password").fill(password);
				await restored.locator("#restore-file").setInputFiles(path);
				await restored.getByRole("button", { name: scenario.preview, exact: true }).first().click();
				await restored.getByRole("button", { name: /Confirm ·|确认 ·/ }).click();
				await expect(restored.getByText(scenario.restored)).toBeVisible();
				const after = (await taskRows(restored)).filter((row) => row.impactSnapshot).sort((a, b) => a.id.localeCompare(b.id));
				expect(after).toEqual(before);
				await restored.goto(new URL(accountUrl).pathname);
				await expect(restored.locator(".impact-task-row")).toHaveCount(2);
				await expect(restored.locator(".react-flow__node")).toHaveCount(2);
				await expect(restored.locator(".impact-checklist").getByRole("button", { name: `${scenario.generate} · 0` })).toBeDisabled();
				await restored.screenshot({ path: `${evidence}/impact-${scenario.language}-${scenario.width}-restored.png`, fullPage: true });
				const overflow = await restored.evaluate(() => document.documentElement.scrollWidth - innerWidth);
				expect(overflow).toBeLessThanOrEqual(1);
			} finally {
				await restoreContext.close();
			}
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
}

test("relation changes preserve completed impact history and add only new relation tasks", async ({ page }) => {
	test.setTimeout(75_000);
	page.setDefaultTimeout(10_000);
	const suffix = crypto.randomUUID().slice(0, 6);
	const account = `Account ${suffix}`;
	const project = `Project ${suffix}`;
	const other = `Other ${suffix}`;
	const label = `Recovery ${suffix}`;
	const newLabel = `Owner ${suffix}`;
	async function addAsset(kind: "account" | "project", name: string) {
		await page.goto(`/assets/${kind}`);
		await page.getByRole("button", { name: "Add", exact: true }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill(name);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await page.getByText(name, { exact: true }).first().click();
		return page.url();
	}
	async function addRelation(target: string, name: string) {
		await page.getByRole("button", { name: "Add connection" }).click();
		const dialog = page.getByRole("dialog");
		await selectChoice(dialog.getByLabel("Connect to"), { label: target });
		await dialog.getByLabel("Connection label").fill(name);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
	}
	await addAsset("project", project);
	await addAsset("project", other);
	const accountUrl = await addAsset("account", account);
	await addRelation(project, label);
	const checklist = page.locator(".impact-checklist");
	await checklist.getByRole("button", { name: "Create checklist · 1" }).click();
	await expect(checklist.locator(".impact-task-row")).toHaveCount(1);
	await checklist.locator(".impact-task-row").getByRole("button", { name: /Complete/ }).click();
	await expect(checklist.locator(".impact-task-row").getByText("Completed", { exact: true })).toBeVisible();
	const original = (await taskRows(page)).find((row) => row.impactSnapshot?.label === label);
	if (!original) throw Error("original impact task missing");
	await page.getByRole("button", { name: `Delete connection · ${label} · ${project}` }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Delete connection" }).click();
	await expect(checklist.getByText("The original connection or asset was removed.", { exact: false })).toBeVisible();
	await expect(checklist.locator(".impact-task-row")).toHaveCount(1);
	await page.goto("/trash");
	await page.locator(".relation-row").filter({ hasText: label }).getByRole("button", { name: "Restore" }).click();
	await page.goto(accountUrl);
	await expect(checklist.getByText("The original connection or asset was removed.", { exact: false })).toHaveCount(0);
	await addRelation(other, newLabel);
	await expect(checklist.getByRole("button", { name: "Create checklist · 1" })).toBeEnabled();
	await checklist.getByRole("button", { name: "Create checklist · 1" }).click();
	await expect(checklist.locator(".impact-task-row")).toHaveCount(2);
	const after = (await taskRows(page)).filter((row) => row.impactSnapshot);
	expect(after).toHaveLength(2);
	expect(after.find((row) => row.id === original.id)).toMatchObject({ done: true, completedAt: original.completedAt, completionHistory: original.completionHistory });
	expect(after.filter((row) => row.impactSnapshot?.relationId === original.impactSnapshot?.relationId)).toHaveLength(1);
});

test("legacy neighbor task fixture upgrades in place through the checklist UI", async ({ page }) => {
	const suffix = crypto.randomUUID().slice(0, 6);
	const account = `Account ${suffix}`;
	const project = `Project ${suffix}`;
	const label = `Owner ${suffix}`;
	async function addAsset(kind: "account" | "project", name: string) {
		await page.goto(`/assets/${kind}`);
		await page.getByRole("button", { name: "Add", exact: true }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill(name);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await page.getByText(name, { exact: true }).first().click();
	}
	await addAsset("project", project);
	await addAsset("account", account);
	await page.getByRole("button", { name: "Add connection" }).click();
	const dialog = page.getByRole("dialog");
	await selectChoice(dialog.getByLabel("Connect to"), { label: project });
	await dialog.getByLabel("Connection label").fill(label);
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(dialog).toBeHidden();
	const legacyId = crypto.randomUUID();
	const legacyFixture = await page.evaluate(async ({ modulePath, legacyId, account, project, label }) => {
		const { localRepository, save } = await import(modulePath);
		const repository = await localRepository();
		const assets = await repository.list("asset", true) as { id: string; name: string }[];
		const relations = await repository.list("relation", true) as { label: string; createdAt: string }[];
		const accountId = assets.find((asset) => asset.name === account)?.id;
		const projectId = assets.find((asset) => asset.name === project)?.id;
		const relation = relations.find((item) => item.label === label);
		if (!accountId || !projectId || !relation) throw Error("fixture inputs missing");
		const createdAt = new Date(Date.parse(relation.createdAt) + 1).toISOString();
		const completedAt = new Date(Date.parse(relation.createdAt) + 2).toISOString();
		await save("task", {
			id: legacyId, name: `Legacy check ${project}`, assetId: projectId,
			dueDate: "2026-10-05", done: true, completedAt,
			createdAt, dedupeKey: `impact:${accountId}:${projectId}`, deleted: false,
		});
		return { completedAt };
	}, { modulePath: repositoryModuleUrl, legacyId, account, project, label });
	await page.reload();
	const checklist = page.locator(".impact-checklist");
	await expect(checklist.getByRole("button", { name: "Create checklist · 1" })).toBeEnabled();
	await checklist.getByRole("button", { name: "Create checklist · 1" }).click();
	await expect(checklist.locator(".impact-task-row")).toHaveCount(1);
	await expect(checklist.getByRole("button", { name: "Create checklist · 0" })).toBeDisabled();
	const rows = (await taskRows(page)).filter((row) => row.impactSnapshot);
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({ id: legacyId, done: true, dueDate: "2026-10-05", completedAt: legacyFixture.completedAt, completionHistory: [legacyFixture.completedAt] });
});

test("old completed neighbor task cannot complete a replacement relation after .ka1 restore", async ({ browser }) => {
	test.setTimeout(120_000);
	mkdirSync(evidence, { recursive: true });
	const context = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 }, acceptDownloads: true });
	const page = await context.newPage();
	page.setDefaultTimeout(10_000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const suffix = crypto.randomUUID().slice(0, 6);
	const account = `Account ${suffix}`;
	const project = `Project ${suffix}`;
	const oldLabel = `Old owner ${suffix}`;
	const newLabel = `New owner ${suffix}`;
	const afterRestoreLabel = `Later owner ${suffix}`;
	const completedId = crypto.randomUUID();
	const pendingId = crypto.randomUUID();
	const password = `legacy-impact-${suffix}-2026`;
	async function addAsset(kind: "account" | "project", name: string) {
		await page.goto(`/assets/${kind}`);
		await page.getByRole("button", { name: "Add", exact: true }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill(name);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
		await page.getByText(name, { exact: true }).first().click();
	}
	async function addRelation(targetPage: Page, label: string) {
		await targetPage.getByRole("button", { name: "Add connection" }).click();
		const dialog = targetPage.getByRole("dialog");
		await selectChoice(dialog.getByLabel("Connect to"), { label: project });
		await dialog.getByLabel("Connection label").fill(label);
		await dialog.getByRole("button", { name: "Save" }).click();
		await expect(dialog).toBeHidden();
	}
	try {
		await addAsset("project", project);
		await addAsset("account", account);
		const accountUrl = page.url();
		await addRelation(page, oldLabel);
		// The old neighbor-keyed tasks are fixture records; asset and relation creation above used the UI.
		const fixture = await page.evaluate(async ({ modulePath, account, project, oldLabel, completedId, pendingId }) => {
			const { localRepository, saveBatch } = await import(modulePath);
			const repository = await localRepository();
			const assets = await repository.list("asset", true) as { id: string; name: string }[];
			const relations = await repository.list("relation", true) as { id: string; label: string; createdAt: string }[];
			const accountId = assets.find((asset) => asset.name === account)?.id;
			const projectId = assets.find((asset) => asset.name === project)?.id;
			const first = relations.find((relation) => relation.label === oldLabel);
			if (!accountId || !projectId || !first) throw Error("fixture inputs missing");
			const start = Date.parse(first.createdAt);
			const key = `impact:${accountId}:${projectId}`;
			const completedAt = new Date(start + 2).toISOString();
			await saveBatch([
				{ type: "task", value: { id: completedId, name: "Old completed check", assetId: projectId, createdAt: new Date(start + 1).toISOString(), dueDate: "", done: true, completedAt, dedupeKey: key, deleted: false } },
				{ type: "task", value: { id: pendingId, name: "Newer pending check", assetId: projectId, createdAt: new Date(start + 3).toISOString(), dueDate: "", done: false, completedAt: "", dedupeKey: key, deleted: false } },
			]);
			return { accountId, key, firstRelationId: first.id, completedAt };
		}, { modulePath: repositoryModuleUrl, account, project, oldLabel, completedId, pendingId });
		await page.reload();
		const checklist = page.locator(".impact-checklist");
		await checklist.getByRole("button", { name: "Create checklist · 1" }).click();
		await expect(checklist.locator(".impact-task-row")).toHaveCount(1);
		const upgraded = (await taskRows(page)).find((task) => task.id === pendingId);
		expect(upgraded).toMatchObject({ done: false, completedAt: "", completionHistory: [fixture.completedAt], impactSnapshot: { relationId: fixture.firstRelationId, legacyDedupeKey: fixture.key } });
		expect((await taskRows(page)).find((task) => task.id === completedId)).toMatchObject({ done: true, completedAt: fixture.completedAt, dedupeKey: fixture.key });
		await page.getByRole("button", { name: `Delete connection · ${oldLabel} · ${project}` }).click();
		await page.getByRole("dialog").getByRole("button", { name: "Delete connection" }).click();
		await addRelation(page, newLabel);
		await expect(checklist.getByRole("button", { name: "Create checklist · 1" })).toBeEnabled();
		await checklist.getByRole("button", { name: "Create checklist · 1" }).click();
		await expect(checklist.locator(".impact-task-row")).toHaveCount(2);
		await expect(checklist.getByRole("button", { name: "Pending · 2" })).toBeVisible();
		await expect(checklist.getByRole("button", { name: "Completed · 0" })).toBeVisible();
		const newTask = (await taskRows(page)).find((task) => task.impactSnapshot?.label === newLabel);
		expect(newTask).toMatchObject({ done: false, completedAt: "", completionHistory: [] });
		expect(newTask?.id).not.toBe(completedId);
		await page.reload();
		await expect(checklist.getByRole("button", { name: "Create checklist · 0" })).toBeDisabled();
		await expect(checklist.getByRole("button", { name: "Pending · 2" })).toBeVisible();
		await page.goto("/intake");
		await page.locator("#backup-password").fill(password);
		await page.getByRole("button", { name: "Create backup" }).click();
		const downloadPromise = page.waitForEvent("download");
		await page.getByRole("link", { name: "Save backup file" }).click();
		const download = await downloadPromise;
		const path = await download.path();
		if (!path || !download.suggestedFilename().endsWith(".ka1")) throw Error("real archive missing");
		const restoredContext = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
		const restored = await restoredContext.newPage();
		restored.on("pageerror", (error) => errors.push(error.message));
		try {
			await restored.goto("/intake");
			await restored.locator("#backup-password").fill(password);
			await restored.locator("#restore-file").setInputFiles(path);
			await restored.getByRole("button", { name: "Preview", exact: true }).first().click();
			await restored.getByRole("button", { name: /Confirm ·/ }).click();
			await expect(restored.getByText(/Restored \d+ records/)).toBeVisible();
			await restored.goto(new URL(accountUrl).pathname);
			const restoredChecklist = restored.locator(".impact-checklist");
			await expect(restoredChecklist.getByRole("button", { name: "Pending · 2" })).toBeVisible();
			await expect(restoredChecklist.getByRole("button", { name: "Create checklist · 0" })).toBeDisabled();
			const restoredTasks = await taskRows(restored);
			expect(restoredTasks.find((task) => task.id === completedId)).toMatchObject({ done: true, completedAt: fixture.completedAt });
			expect(restoredTasks.find((task) => task.id === pendingId)?.impactSnapshot).toMatchObject({ relationId: fixture.firstRelationId, legacyDedupeKey: fixture.key });
			expect(restoredTasks.find((task) => task.id === newTask?.id)).toMatchObject({ done: false, completedAt: "", completionHistory: [] });
			await restored.getByRole("button", { name: `Delete connection · ${newLabel} · ${project}` }).click();
			await restored.getByRole("dialog").getByRole("button", { name: "Delete connection" }).click();
			await addRelation(restored, afterRestoreLabel);
			await restoredChecklist.getByRole("button", { name: "Create checklist · 1" }).click();
			await expect(restoredChecklist.getByRole("button", { name: "Pending · 3" })).toBeVisible();
			await expect(restoredChecklist.getByRole("button", { name: "Completed · 0" })).toBeVisible();
			const latest = (await taskRows(restored)).find((task) => task.impactSnapshot?.label === afterRestoreLabel);
			expect(latest).toMatchObject({ done: false, completedAt: "", completionHistory: [] });
			await expect(restored.locator(".toast")).toHaveCount(0);
			await restoredChecklist.screenshot({ path: `${evidence}/impact-legacy-replacement-en-390-restored.png` });
			expect(await restored.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
			await restored.goto("/tasks");
			await expect(restored.getByRole("button", { name: "All · 4" })).toBeVisible();
			await expect(restored.getByRole("button", { name: "Pending · 3" })).toBeVisible();
			await expect(restored.getByRole("button", { name: "Completed · 1" })).toBeVisible();
			await expect(restored.locator(".impact-task-row").filter({ hasText: afterRestoreLabel }).getByText("Pending", { exact: true })).toBeVisible();
		} finally {
			await restoredContext.close();
		}
		expect(errors).toEqual([]);
	} finally {
		await context.close();
	}
});

test("built PWA keeps the account checklist editable across offline reloads", async ({ browser }) => {
	test.skip(process.env.KEEPANY_PRODUCTION_OFFLINE !== "1", "Run against a built PWA preview");
	test.setTimeout(90_000);
	const context = await browser.newContext({ locale: "en-US" });
	const page = await context.newPage();
	page.setDefaultTimeout(10_000);
	const suffix = crypto.randomUUID().slice(0, 6);
	try {
		for (const [kind, name] of [["project", `Project ${suffix}`], ["account", `Account ${suffix}`]] as const) {
			await page.goto(`/assets/${kind}`);
			await page.getByRole("button", { name: "Add", exact: true }).click();
			const dialog = page.getByRole("dialog");
			await dialog.getByLabel("Name", { exact: true }).fill(name);
			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(dialog).toBeHidden();
			await page.getByText(name, { exact: true }).first().click();
		}
		await page.getByRole("button", { name: "Add connection" }).click();
		const relation = page.getByRole("dialog");
		await selectChoice(relation.getByLabel("Connect to"), { label: `Project ${suffix}` });
		await relation.getByLabel("Connection label").fill(`Recovery ${suffix}`);
		await relation.getByRole("button", { name: "Save" }).click();
		await expect(relation).toBeHidden();
		const accountUrl = page.url();
		await page.locator(".impact-checklist").getByRole("button", { name: "Create checklist · 1" }).click();
		await expect(page.locator(".impact-task-row")).toHaveCount(1);
		await page.evaluate(async () => { await navigator.serviceWorker.ready; });
		await page.reload();
		await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
		await context.setOffline(true);
		await page.reload();
		await expect(page.locator(".impact-task-row")).toHaveCount(1);
		await page.locator(".impact-task-row").getByRole("button", { name: /Complete/ }).click();
		await expect(page.locator(".impact-task-row").getByText("Completed", { exact: true })).toBeVisible();
		await page.locator(".impact-task-row").getByLabel("Remind later").fill("2026-10-05");
		await expect(page.locator(".impact-task-row").getByLabel("Remind later")).toHaveValue("2026-10-05");
		await page.goto("/tasks");
		await expect(page.locator(".impact-task-row")).toHaveCount(1);
		await page.goto(accountUrl);
		await expect(page.locator(".impact-task-row").getByText("Completed", { exact: true })).toBeVisible();
		await expect(page.locator(".impact-task-row").getByLabel("Remind later")).toHaveValue("2026-10-05");
		await page.reload();
		await expect(page.locator(".impact-task-row")).toHaveCount(1);
		await expect(page.locator(".impact-task-row").getByText("Completion history:", { exact: false })).toBeVisible();
	} finally {
		await context.close();
	}
});
