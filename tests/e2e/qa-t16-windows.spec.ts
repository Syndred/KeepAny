import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const repo = `/@fs/${resolve("packages/local-db/src/index.ts").replaceAll("\\", "/")}`;
const domain = `/@fs/${resolve("packages/domain/src/index.ts").replaceAll("\\", "/")}`;
const reminders = `/@fs/${resolve("apps/web/src/reminders.ts").replaceAll("\\", "/")}`;
const evidence = "test-results/qa/2026-10-27/evidence/T16-windows";
mkdirSync(evidence, { recursive: true });
const t0 = "2026-10-27T04:00:00.000Z";
const t1 = "2026-10-27T04:01:00.000Z";

async function read(page: Page) {
	return page.evaluate(async path => {
		const { localRepository } = await import(path);
		const db = await localRepository();
		return { tasks: await db.list("task", true), preferences: await db.list("preference") };
	}, repo);
}

for (const locale of ["zh-CN", "en-US"] as const) for (const width of [390, 1280]) {
	test(`${locale} ${width}px T16 linked task dedupe, completion history and return filter`, async ({ browser }) => {
		test.setTimeout(100_000);
		const zh = locale === "zh-CN";
		const c = { add: zh ? "新增" : "Add", name: zh ? "名称" : "Name", date: zh ? "日期" : "Date", save: zh ? "保存" : "Save", cancel: zh ? "取消" : "Cancel", complete: zh ? "完成" : "Complete", reopen: zh ? "重新打开" : "Reopen", pending: zh ? "待处理" : "Pending", done: zh ? "已完成" : "Completed", all: zh ? "全部" : "All", tasks: zh ? "待办" : "Tasks", newTask: zh ? "新建待办" : "New task", duplicate: zh ? "同一待办已存在且尚未完成。" : "This task is already pending.", remind: zh ? "稍后提醒" : "Remind later" };
		const context = await browser.newContext({ locale, timezoneId: "Asia/Shanghai", viewport: { width, height: 900 } });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", e => errors.push(e.message));
		await page.clock.setFixedTime(new Date(t0));
		try {
			await page.goto("/");
			const fixture = await page.evaluate(async ([repositoryPath, domainPath, remindersPath, t0]) => {
				const { saveBatch } = await import(repositoryPath);
				const { newAsset, taskSchema } = await import(domainPath);
				const { defaultReminderSettings, REMINDER_SETTINGS_ID } = await import(remindersPath);
				const project = { ...newAsset("project"), name: "T16 project progress" };
				const tasks = [taskSchema.parse({ id: crypto.randomUUID(), name: "T16 overdue", dueDate: "2026-10-26", createdAt: t0 }), taskSchema.parse({ id: crypto.randomUUID(), name: "T16 future", dueDate: "2026-10-29", createdAt: t0 }), taskSchema.parse({ id: crypto.randomUUID(), name: "T16 deleted completion", assetId: project.id, done: true, deleted: true, completedAt: t0, completionHistory: [t0], createdAt: t0 })];
				await saveBatch([{ type: "asset", value: project }, ...tasks.map(value => ({ type: "task", value })), { type: "preference", value: { id: REMINDER_SETTINGS_ID, value: { ...defaultReminderSettings(), enabled: false } } }]);
				return { project, tasks };
			}, [repo, domain, reminders, t0]);
			const projectPath = `/assets/project/${fixture.project.id}`;
			const name = `T16 ${"Long task title with reachable actions ".repeat(5)}`.trim();
			async function editor() {
				await page.goto(projectPath);
				await page.locator(".asset-tasks-card").getByRole("button", { name: c.add, exact: true }).click();
				const form = page.getByRole("dialog");
				await form.getByLabel(c.name, { exact: true }).fill(name);
				await form.getByLabel(c.date, { exact: true }).fill("2026-10-28");
				return form;
			}
			// T16-01: asset detail supplies the linked project ID.
			await (await editor()).getByRole("button", { name: c.save, exact: true }).click();
			await expect(page.getByRole("dialog")).toBeHidden();
			const task = (await read(page)).tasks.find((v: { name: string }) => v.name === name);
			expect(task).toMatchObject({ assetId: fixture.project.id, dueDate: "2026-10-28", done: false });
			await expect(page.locator(`#task-${task.id}`)).toBeVisible();
			const duplicate = await editor();
			await duplicate.getByRole("button", { name: c.save, exact: true }).click();
			await expect(duplicate.getByRole("alert")).toHaveText(c.duplicate);
			await duplicate.getByRole("button", { name: c.cancel, exact: true }).click();
			expect((await read(page)).tasks.filter((v: { name: string }) => v.name === name)).toHaveLength(1);
			await page.goto("/assets");
			const progress = page.locator(`a[href="${projectPath}"]`).getByRole("progressbar", { name: c.tasks, exact: true });
			await expect(progress).toHaveAttribute("value", "0");
			await expect(progress).toHaveAttribute("max", "1");
			// T16-02: two completion instants survive reopen/reload; deleted task excluded.
			await page.goto("/tasks");
			const row = page.locator(`#task-${task.id}`);
			await row.getByRole("button", { name: c.complete, exact: true }).click();
			await expect.poll(async () => (await read(page)).tasks.find((v: { id: string }) => v.id === task.id)?.completionHistory).toEqual([t0]);
			await row.getByRole("button", { name: c.reopen, exact: true }).click();
			await expect.poll(async () => (await read(page)).tasks.find((v: { id: string }) => v.id === task.id)?.done).toBe(false);
			await page.clock.setFixedTime(new Date(t1));
			await row.getByRole("button", { name: c.complete, exact: true }).click();
			await expect.poll(async () => (await read(page)).tasks.find((v: { id: string }) => v.id === task.id)?.completionHistory).toEqual([t0, t1]);
			await page.reload();
			expect((await read(page)).tasks.find((v: { id: string }) => v.id === task.id)).toMatchObject({ done: true, completedAt: t1, completionHistory: [t0, t1] });
			await page.goto("/assets");
			await expect(progress).toHaveAttribute("value", "1");
			await expect(progress).toHaveAttribute("max", "1");
			// T16-03 available controls: date ordering, state filter and return context.
			await page.goto("/tasks");
			await page.locator(".task-filters").getByRole("button", { name: new RegExp(`^${c.pending} ·`) }).click();
			expect(await page.locator(".tasks-list-card .impact-task-info > strong").allTextContents()).toEqual(["T16 overdue", "T16 future"]);
			await page.locator(".task-filters").getByRole("button", { name: new RegExp(`^${c.done} ·`) }).click();
			await row.getByRole("link", { name: fixture.project.name, exact: true }).click();
			await expect(page).toHaveURL(new RegExp(fixture.project.id));
			await page.goBack();
			await expect(page.locator(".task-filters").getByRole("button", { name: new RegExp(`^${c.done} ·`) })).toHaveAttribute("aria-pressed", "true");
			await page.reload();
			await expect(page.locator(".task-filters").getByRole("button", { name: new RegExp(`^${c.done} ·`) })).toHaveAttribute("aria-pressed", "true");
			await expect(row.getByRole("button", { name: c.reopen, exact: true })).toBeVisible();
			await page.getByRole("button", { name: c.newTask, exact: true }).click();
			await page.getByRole("dialog").getByLabel(c.name, { exact: true }).fill("T16 cancelled draft");
			await page.getByRole("dialog").getByRole("button", { name: c.cancel, exact: true }).click();
			expect((await read(page)).tasks.some((v: { name: string }) => v.name === "T16 cancelled draft")).toBe(false);
			await page.locator(".task-filters").getByRole("button", { name: new RegExp(`^${c.all} ·`) }).click();
			await page.locator(`#task-${fixture.tasks[1].id}`).getByLabel(c.remind, { exact: true }).fill("2026-11-12");
			await expect.poll(async () => (await read(page)).tasks.find((v: { id: string }) => v.id === fixture.tasks[1].id)?.dueDate).toBe("2026-11-12");
			await page.reload();
			await expect(page.locator(".task-filters").getByRole("button", { name: new RegExp(`^${c.all} ·`) })).toHaveAttribute("aria-pressed", "true");
			await expect(page.locator(`#task-${fixture.tasks[1].id}`).getByLabel(c.remind, { exact: true })).toHaveValue("2026-11-12");
			await row.scrollIntoViewIfNeeded();
			await expect(row.getByRole("button", { name: c.reopen, exact: true })).toBeInViewport();
			await expect(page.locator(".toast")).toBeHidden({ timeout: 10_000 });
			if ((zh && width === 390) || (!zh && width === 1280)) await page.locator(".tasks-list-card").screenshot({ path: `${evidence}/T16-core-${locale}-${width}.png` });
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}

for (const { locale, width } of [{ locale: "zh-CN", width: 390 }, { locale: "en-US", width: 1280 }] as const) {
	test(`${locale} ${width}px T16 denied browser permission keeps once-only in-app fallback and postponement`, async ({ browser }) => {
		test.setTimeout(60_000);
		const zh = locale === "zh-CN";
		const context = await browser.newContext({ locale, timezoneId: "Asia/Shanghai", viewport: { width, height: 900 } });
		await context.grantPermissions([], { origin: "http://127.0.0.1:4205" });
		await context.addInitScript(language => localStorage.setItem("keepany-language", language), zh ? "zh-CN" : "en");
		const page = await context.newPage();
		await page.clock.setFixedTime(new Date(t0));
		const errors: string[] = [];
		page.on("pageerror", e => errors.push(e.message));
		try {
			await page.goto("/settings");
			expect(await page.evaluate(() => Notification.permission)).toBe("denied");
			const blocked = zh ? "通知被浏览器阻止。请在此网站的浏览器设置中允许通知，应用内提醒仍可查看。" : "Notifications are blocked. Allow them in this site's browser settings. In-app reminders remain available.";
			await expect(page.getByText(blocked, { exact: true })).toBeVisible();
			const task = await page.evaluate(async ([repositoryPath, domainPath, remindersPath, t0]) => {
				const { saveBatch } = await import(repositoryPath);
				const { taskSchema } = await import(domainPath);
				const { defaultReminderSettings, REMINDER_SETTINGS_ID } = await import(remindersPath);
				const task = taskSchema.parse({ id: crypto.randomUUID(), name: "T16 isolated denied notification", dueDate: "2026-10-27", createdAt: t0 });
				await saveBatch([{ type: "preference", value: { id: REMINDER_SETTINGS_ID, value: { ...defaultReminderSettings(), browserEnabled: true, subscriptionEnabled: false, timeZone: "Asia/Shanghai", time: "09:00" } } }, { type: "task", value: task }]);
				return task;
			}, [repo, domain, reminders, t0]);
			const banner = page.getByRole("complementary", { name: zh ? "需要留意的提醒" : "Reminders to review", exact: true });
			await expect(banner.getByRole("link", { name: task.name, exact: true })).toBeVisible();
			await expect(banner.getByRole("status")).toContainText(zh ? "浏览器通知未能发出" : "The browser notification could not be sent");
			const receipts = async () => (await read(page)).preferences.filter((p: { id: string; value: { sourceId?: string } }) => p.id.startsWith("reminder-delivery:") && p.value.sourceId === task.id);
			await expect.poll(async () => (await receipts()).length).toBe(1);
			const receipt = await receipts();
			await page.reload();
			await page.evaluate(() => window.dispatchEvent(new Event("focus")));
			await expect(banner.getByRole("link", { name: task.name, exact: true })).toHaveCount(1);
			expect(await receipts()).toEqual(receipt);
			await banner.getByRole("link", { name: task.name, exact: true }).click();
			await expect(page.locator(`#task-${task.id}`)).toBeFocused();
			await page.locator(`#task-${task.id}`).getByRole("button", { name: zh ? "稍后 1 天" : "Postpone 1 day", exact: true }).click();
			await expect(page.locator(`#task-${task.id}`).getByLabel(zh ? "稍后提醒" : "Remind later", { exact: true })).toHaveValue("2026-10-28");
			await expect(banner).toHaveCount(0);
			await page.reload();
			await expect(banner).toHaveCount(0);
			expect((await read(page)).tasks.find((v: { id: string }) => v.id === task.id)?.dueDate).toBe("2026-10-28");
			expect(await receipts()).toEqual(receipt);
			await page.locator(`#task-${task.id}`).screenshot({ path: `${evidence}/T16-reminder-${locale}-${width}.png` });
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}



