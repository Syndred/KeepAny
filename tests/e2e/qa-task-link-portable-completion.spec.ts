import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { resources } from "../../apps/web/src/i18n";
import { newAsset, taskSchema } from "../../packages/domain/src";
import { openBackupRestorePanel } from "./helpers/backup-restore";
import { prepareCompletionArchive } from "./helpers/completion-archive";
import { manualTaskDedupeKey } from "../../apps/web/src/task-edit";

const portable = process.env.KEEPANY_TASK_LINK_PORTABLE === "1";
const directory = resolve("test-results/task-link-completion-fixture");
const password = "Synthetic-task-link-backup";
type Copy = (key: string) => string;
type Row = { type: string; payload: string };
type Entity = { id: string; [key: string]: unknown };
async function archive(page: Page, t: Copy) {
	await page.goto("/intake"); await page.locator("#backup-password").fill(password);
	await page.getByRole("button", { name: t("backup"), exact: true }).click();
	const link = page.getByRole("link", { name: t("saveBackupFile"), exact: true }); await expect(link).toBeVisible();
	const wait = page.waitForEvent("download"); await link.click(); const download = await wait;
	const path = await download.path(); if (!path) throw Error("missing-download");
	const files = unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)), password));
	const records = JSON.parse(strFromU8(files["records.json"])) as Row[];
	const entities = (type: string) => records.filter(row => row.type === type).map(row => JSON.parse(row.payload) as Entity);
	return { download, path, tasks: entities("task"), assets: entities("asset") };
}
async function restore(page: Page, t: Copy, path: string) {
	await page.goto("/intake"); await page.locator("#backup-password").fill(password);
	await openBackupRestorePanel(page);
	await page.locator("#restore-file").setInputFiles(path);
	await page.getByRole("button", { name: t("preview"), exact: true }).first().click();
	await page.getByRole("button", { name: /^确认 ·|^Confirm ·/ }).click();
	await expect(page.getByText(/已恢复 \d+ 条记录|Restored \d+ records/)).toBeVisible();
}
let fixture: { asset: Entity; tasks: Entity[] };
test.beforeAll(async () => {
		fixture = await prepareCompletionArchive(directory, password, async db => {
			const asset = { ...newAsset("project"), name: "Local task fixture" };
			const tasks = ["2026-10-26", "2026-10-28"].map((dueDate, index) => taskSchema.parse({ id: crypto.randomUUID(), name: `Portable task ${index}`, assetId: asset.id, dueDate, createdAt: "2026-10-27T00:00:00Z", completionHistory: ["2026-10-20T00:00:00Z"] }));
			await db.saveBatch([{ type: "asset", value: asset }, ...tasks.map(value => ({ type: "task" as const, value }))]); return { asset, tasks };
		});
});
for (const [language, width] of [["zh-CN", 390], ["en", 1280]] as const) {
	test(`${language} ${width} real UI local task editing, date filters and KA1 restore`, async ({ browser }) => {
		test.setTimeout(120_000);
		const t: Copy = key => resources[language].translation[key];
		const context = await browser.newContext({ viewport: { width, height: 900 }, locale: language });
		const destination = await browser.newContext({ viewport: { width, height: 900 }, locale: language });
		const errors: string[] = [], sourceRequests: string[] = [];
		for (const current of [context, destination]) { await current.addInitScript(value => { if (location.protocol === "http:" || location.protocol === "https:") localStorage.setItem("keepany-language", value); }, language); current.on("page", tab => { tab.on("pageerror", error => errors.push(error.message)); tab.on("request", request => { if (/\/@(?:fs|vite)\//.test(request.url())) sourceRequests.push(request.url()); }); }); }
		const page = await context.newPage(); const restored = await destination.newPage();
		try {
			await restore(page, t, resolve(directory, "fixture.ka1")); await page.goto("/tasks");
			const target = fixture.tasks[1]; const row = page.locator(`#task-${target.id}`);
			await row.getByRole("button", { name: t("edit"), exact: true }).click();
			await page.getByRole("dialog").getByLabel(t("name"), { exact: true }).fill("Cancelled edit");
			await page.getByRole("dialog").getByRole("button", { name: t("cancel"), exact: true }).click();
			expect((await archive(page, t)).tasks.find(value => value.id === target.id)).toEqual(target);
			await page.goto("/tasks"); await row.getByRole("button", { name: t("edit"), exact: true }).click();
			await page.getByRole("dialog").getByLabel(t("name"), { exact: true }).fill("Updated portable task");
			await page.getByRole("dialog").getByLabel(t("date"), { exact: true }).fill("2026-10-30");
			await page.getByRole("dialog").getByRole("button", { name: t("save"), exact: true }).click(); await expect(page.getByRole("dialog")).toBeHidden();
			await page.getByLabel(t("taskDateFrom"), { exact: true }).fill("2026-10-29");
			await page.getByLabel(t("taskDateTo"), { exact: true }).fill("2026-10-30");
			await expect(page.locator(".tasks-list-card .impact-task-info > strong")).toHaveText(["Updated portable task"]);
			await row.getByRole("link", { name: String(fixture.asset.name), exact: true }).click(); await page.goBack(); await page.reload();
			await expect(page.getByLabel(t("taskDateFrom"), { exact: true })).toHaveValue("2026-10-29");
			await expect(page.locator(".tasks-list-card .impact-task-info > strong")).toHaveText(["Updated portable task"]);
			for (const size of [360, 768, 1440]) { await page.setViewportSize({ width: size, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
			await page.setViewportSize({ width, height: 900 });
			const result = await archive(page, t);
			expect(result.tasks.find(value => value.id === target.id)).toEqual({ ...target, name: "Updated portable task", dueDate: "2026-10-30", dedupeKey: await manualTaskDedupeKey("Updated portable task", String(target.assetId), "2026-10-30") });
			expect(result.tasks.find(value => value.id === fixture.tasks[0].id)).toEqual(fixture.tasks[0]);
			expect(result.assets).toEqual([fixture.asset]);
			await restore(restored, t, result.path); await restored.reload();
			const readback = await archive(restored, t); expect(readback.tasks).toEqual(result.tasks); expect(readback.assets).toEqual(result.assets);
			if (portable) expect(sourceRequests).toEqual([]);
			expect(errors).toEqual([]);
		} finally { await context.close(); await destination.close(); }
	});
}
