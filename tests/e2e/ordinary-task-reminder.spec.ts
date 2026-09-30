import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const repositoryUrl = `/@fs${process.cwd()}/packages/local-db/src/index.ts`;
const domainUrl = `/@fs${process.cwd()}/packages/domain/src/index.ts`;
test.use({ timezoneId: "Asia/Shanghai" });

type StoredTask = {
	id: string;
	assetId: string;
	name: string;
	dueDate: string;
	dedupeKey: string;
	done: boolean;
	completedAt: string;
	completionHistory: string[];
};

const languages = [
	{
		language: "en",
		add: "Add",
		name: "Name",
		date: "Date",
		save: "Save",
		cancel: "Cancel",
		complete: "Complete",
		reopen: "Reopen",
		remind: "Remind later",
		postpone: "Postpone 1 day",
		duplicate: "This task is already pending.",
		missing: "Related record unavailable",
		history: "Completion history",
		trash: "Move to trash",
	},
	{
		language: "zh-CN",
		add: "新增",
		name: "名称",
		date: "日期",
		save: "保存",
		cancel: "取消",
		complete: "完成",
		reopen: "重新打开",
		remind: "稍后提醒",
		postpone: "稍后 1 天",
		duplicate: "同一待办已存在且尚未完成。",
		missing: "关联资料不可用",
		history: "完成记录",
		trash: "移至回收站",
	},
] as const;
type Labels = (typeof languages)[number];

async function storedTasks(page: Page, name: string): Promise<StoredTask[]> {
	return page.evaluate(
		async ({ modulePath, taskName }) => {
			const { localRepository } = await import(modulePath);
			return (await (await localRepository()).list("task")).filter(
				(task: StoredTask) => task.name === taskName,
			);
		},
		{ modulePath: repositoryUrl, taskName: name },
	);
}

async function addTask(
	page: Page,
	labels: Labels,
	assetId: string,
	name: string,
	dueDate: string,
) {
	await page.goto(`/assets/item/${assetId}`);
	await page
		.locator(".asset-tasks-card")
		.getByRole("button", { name: labels.add, exact: true })
		.click();
	const editor = page.getByRole("dialog");
	await editor.getByLabel(labels.name, { exact: true }).fill(name);
	await editor.getByLabel(labels.date, { exact: true }).fill(dueDate);
	await editor.getByRole("button", { name: labels.save, exact: true }).click();
	return editor;
}

async function expectReachable(page: Page, control: Locator, width: number) {
	await control.scrollIntoViewIfNeeded();
	await expect(control).toBeVisible();
	const box = await control.boundingBox();
	expect(
		box &&
			box.x >= -1 &&
			box.x + box.width <= width + 1 &&
			box.y >= -1 &&
			box.y + box.height <= 845,
	).toBeTruthy();
	await expect(
		page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
	).resolves.toBe(true);
}

for (const labels of languages) {
	for (const width of [390, 1280]) {
		test(`${labels.language} ordinary task linked reminder, duplicate and orphan boundaries at ${width}px`, async ({
			page,
		}) => {
			test.setTimeout(60_000);
			await page.setViewportSize({ width, height: 844 });
			await page.clock.setFixedTime(new Date("2026-09-30T04:00:00Z"));
			const errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			await page.goto("/");
			await page.evaluate(
				(language) => localStorage.setItem("keepany-language", language),
				labels.language,
			);
			const asset = await page.evaluate(
				async ([repositoryPath, domainPath]) => {
					const { save } = await import(repositoryPath);
					const { newAsset } = await import(domainPath);
					const item = {
						...newAsset("item"),
						name: "Ordinary reminder camera",
					};
					await save("asset", item);
					return { id: item.id as string, name: item.name };
				},
				[repositoryUrl, domainUrl],
			);
			const taskName =
				labels.language === "en"
					? "Inspect camera records before renewal"
					: "续费前核对相机资料和购买记录";
			await expect(
				await addTask(page, labels, asset.id, taskName, "2026-10-31"),
			).toBeHidden();
			await expect
				.poll(async () => (await storedTasks(page, taskName)).length)
				.toBe(1);
			const taskId = (await storedTasks(page, taskName))[0].id;
			const row = page.locator(`#task-${taskId}`);
			const reminder = row.getByLabel(labels.remind, { exact: true });
			await page.goto("/tasks");
			await expect(
				row.getByRole("link", { name: asset.name, exact: true }),
			).toHaveAttribute("href", `/assets/item/${asset.id}`);
			await row.getByRole("link", { name: asset.name, exact: true }).click();
			await expect(page).toHaveURL(new RegExp(`/assets/item/${asset.id}$`));
			await expect(
				page.getByRole("heading", { name: asset.name, exact: true }),
			).toBeVisible();
			await page.goto("/tasks");
			await expectReachable(page, reminder, width);
			await expectReachable(
				page,
				row.getByRole("button", { name: labels.postpone, exact: true }),
				width,
			);
			await row
				.getByRole("button", { name: labels.postpone, exact: true })
				.click();
			await expect(reminder).toHaveValue("2026-11-01");
			await expect
				.poll(async () =>
					(await storedTasks(page, taskName))[0].dedupeKey.endsWith(
						":2026-11-01",
					),
				)
				.toBe(true);
			await page.reload();
			await expect(reminder).toHaveValue("2026-11-01");
			await reminder.fill("2026-11-30");
			await expect
				.poll(async () => (await storedTasks(page, taskName))[0].dueDate)
				.toBe("2026-11-30");
			await row
				.getByRole("button", { name: labels.postpone, exact: true })
				.click();
			await expect(reminder).toHaveValue("2026-12-01");
			await page.screenshot({
				path: join(
					tmpdir(),
					`keepany-ordinary-task-${labels.language}-${width}.png`,
				),
				fullPage: true,
			});

			await row
				.getByRole("button", { name: labels.complete, exact: true })
				.click();
			await expect
				.poll(async () => (await storedTasks(page, taskName))[0])
				.toMatchObject({
					done: true,
					dueDate: "2026-12-01",
					completionHistory: ["2026-09-30T04:00:00.000Z"],
				});
			await expect(row).toContainText(labels.history);
			await expect(reminder).toHaveCount(0);
			await page.reload();
			await row
				.getByRole("button", { name: labels.reopen, exact: true })
				.click();
			await expect(reminder).toHaveValue("2026-12-01");
			await expect
				.poll(async () => (await storedTasks(page, taskName))[0])
				.toMatchObject({
					done: false,
					completedAt: "",
					dueDate: "2026-12-01",
					completionHistory: ["2026-09-30T04:00:00.000Z"],
				});
			await page.clock.setFixedTime(new Date("2026-09-30T04:01:00Z"));
			await row
				.getByRole("button", { name: labels.complete, exact: true })
				.click();
			await expect
				.poll(
					async () => (await storedTasks(page, taskName))[0].completionHistory,
				)
				.toEqual(["2026-09-30T04:00:00.000Z", "2026-09-30T04:01:00.000Z"]);
			await row
				.getByRole("button", { name: labels.reopen, exact: true })
				.click();
			await expect
				.poll(async () => (await storedTasks(page, taskName))[0].done)
				.toBe(false);
			await page.reload();
			await expect(reminder).toHaveValue("2026-12-01");
			await expect(row).toContainText(labels.history);

			const duplicateEditor = await addTask(
				page,
				labels,
				asset.id,
				taskName,
				"2026-12-01",
			);
			await expect(duplicateEditor.getByRole("alert")).toContainText(
				labels.duplicate,
			);
			await duplicateEditor
				.getByRole("button", { name: labels.cancel, exact: true })
				.click();
			expect(await storedTasks(page, taskName)).toHaveLength(1);
			await expect(
				await addTask(page, labels, asset.id, taskName, "2026-12-02"),
			).toBeHidden();
			await page.goto("/tasks");
			await reminder.fill("2026-12-02");
			await expect(page.locator(".toast[role='status']")).toContainText(
				labels.duplicate,
			);
			await expect(reminder).toHaveValue("2026-12-01");
			await row
				.getByRole("button", { name: labels.postpone, exact: true })
				.click();
			await expect(page.locator(".toast[role='status']")).toContainText(
				labels.duplicate,
			);
			await expect(reminder).toHaveValue("2026-12-01");
			const remaining = await storedTasks(page, taskName);
			expect(remaining).toHaveLength(2);
			expect(remaining.find((task) => task.id === taskId)).toMatchObject({
				dueDate: "2026-12-01",
				done: false,
				completionHistory: [
					"2026-09-30T04:00:00.000Z",
					"2026-09-30T04:01:00.000Z",
				],
			});
			const otherTask = remaining.find((task) => task.id !== taskId);
			if (!otherTask) throw Error("second ordinary task missing");
			const otherRow = page.locator(`#task-${otherTask.id}`);
			await otherRow
				.getByLabel(labels.remind, { exact: true })
				.fill("2026-09-01");
			await expect
				.poll(
					async () =>
						(await storedTasks(page, taskName)).find(
							(task) => task.id === otherTask.id,
						)?.dueDate,
				)
				.toBe("2026-09-01");
			await otherRow
				.getByRole("button", { name: labels.postpone, exact: true })
				.click();
			await expect(
				otherRow.getByLabel(labels.remind, { exact: true }),
			).toHaveValue("2026-10-01");

			await row.getByRole("link", { name: asset.name, exact: true }).click();
			await page
				.locator("main > .page-header")
				.getByRole("button", { name: labels.trash, exact: true })
				.click();
			await page
				.getByRole("dialog")
				.getByRole("button", { name: labels.trash, exact: true })
				.click();
			await expect(page).toHaveURL(/\/assets\/item$/);
			await page.goto("/tasks");
			await expect(row).toContainText(labels.missing);
			await expect(row.locator("a")).toHaveCount(0);
			await expect(otherRow).toContainText(labels.missing);
			await expect(otherRow.locator("a")).toHaveCount(0);
			await page.reload();
			await expect(row).toContainText(labels.missing);
			await expect(row.locator("a")).toHaveCount(0);
			await expect(reminder).toHaveValue("2026-12-01");
			expect(errors).toEqual([]);
			await expect(
				page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth + 1,
				),
			).resolves.toBe(true);
		});
	}
}
