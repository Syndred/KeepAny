import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

/**
 * Release checks for the task surface. The fixture deliberately uses the
 * visible application forms so the test can also run against the fixed
 * package, where source-only repository imports are unavailable.
 */
test.setTimeout(120_000);

const evidenceRoot =
	process.env.KEEPANY_EVIDENCE_DIR ??
	"test-results/evidence/2026-09-30/task-theme-release";
mkdirSync(evidenceRoot, { recursive: true });

const variants = [
	{ locale: "zh-CN", width: 390 },
	{ locale: "zh-CN", width: 1280 },
	{ locale: "en-US", width: 390 },
	{ locale: "en-US", width: 1280 },
] as const;

type Variant = (typeof variants)[number];

type Copy = {
	add: string;
	save: string;
	cancel: string;
	name: string;
	url: string;
	project: string;
	account: string;
	tasks: string;
	newTask: string;
	newMaintenance: string;
	date: string;
	maintenanceName: string;
	maintenanceAsset: string;
	maintenanceDue: string;
	maintenanceReminder: string;
	maintenanceRule: string;
	maintenanceCreate: string;
	maintenanceComplete: string;
	maintenanceActionDate: string;
	maintenanceEvidence: string;
	maintenanceSaveRecord: string;
	workflowClose: string;
	workflowCreate: string;
	workflowRecord: string;
	workflowEdit: string;
	workflowResult: string;
	workflowEvidence: string;
	workflowSave: string;
	workflowSnapshotAt: string;
	blocked: string;
	addConnection: string;
	target: string;
	relationLabel: string;
	navigation: string;
	complete: string;
	done: string;
	remindLater: string;
	projectKind: string;
};

function copyFor(locale: Variant["locale"]): Copy {
	return locale === "zh-CN"
		? {
				add: "新增",
				save: "保存",
				cancel: "取消",
				name: "名称",
				url: "网址",
				project: "项目",
				account: "账号",
				tasks: "待办",
				newTask: "新建待办",
				newMaintenance: "新建维护计划",
				date: "日期",
				maintenanceName: "计划名称",
				maintenanceAsset: "关联资产",
				maintenanceDue: "下次日期",
				maintenanceReminder: "提醒日期",
				maintenanceRule: "重复规则",
				maintenanceCreate: "创建计划",
				maintenanceComplete: "确认完成",
				maintenanceActionDate: "处理日期",
				maintenanceEvidence: "处理依据或说明",
				maintenanceSaveRecord: "保存处理记录",
				workflowClose: "关闭与交接",
				workflowCreate: "生成处理计划",
				workflowRecord: "记录处理结果",
				workflowEdit: "修改处理记录",
				workflowResult: "处理结果",
				workflowEvidence: "依据或说明",
				workflowSave: "保存处理记录",
				workflowSnapshotAt: "计划生成时间",
				blocked: "有阻碍，继续跟进",
				addConnection: "添加关联",
				target: "关联至",
				relationLabel: "关联用途",
				navigation: "导航",
				complete: "完成",
				done: "已完成",
				remindLater: "稍后提醒",
				projectKind: "项目",
			}
		: {
				add: "Add",
				save: "Save",
				cancel: "Cancel",
				name: "Name",
				url: "URL",
				project: "Projects",
				account: "Accounts",
				tasks: "Tasks",
				newTask: "New task",
				newMaintenance: "New maintenance plan",
				date: "Date",
				maintenanceName: "Plan name",
				maintenanceAsset: "Linked asset",
				maintenanceDue: "Next date",
				maintenanceReminder: "Reminder date",
				maintenanceRule: "Repeat rule",
				maintenanceCreate: "Create plan",
				maintenanceComplete: "Confirm complete",
				maintenanceActionDate: "Action date",
				maintenanceEvidence: "Evidence or note",
				maintenanceSaveRecord: "Save action record",
				workflowClose: "Close or hand over",
				workflowCreate: "Create action plan",
				workflowRecord: "Record result",
				workflowEdit: "Edit result",
				workflowResult: "Result",
				workflowEvidence: "Evidence or note",
				workflowSave: "Save result",
				workflowSnapshotAt: "Plan created",
				blocked: "Blocked, follow up",
				addConnection: "Add connection",
				target: "Connect to",
				relationLabel: "Connection label",
				navigation: "Navigation",
				complete: "Complete",
				done: "Completed",
				remindLater: "Remind later",
				projectKind: "Projects",
			};
}

type Fixture = {
	projectName: string;
	accountName: string;
	ordinaryName: string;
	maintenanceName: string;
	workflowPath: string;
};

async function createAssetFromForm(
	page: Page,
	copy: Copy,
	kind: "project" | "account",
	name: string,
	url?: string,
) {
	await page.goto(`/assets/${kind}`);
	await page.getByRole("button", { name: copy.add, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible();
	await dialog.getByLabel(copy.name, { exact: true }).fill(name);
	if (url) await dialog.getByLabel(copy.url, { exact: true }).fill(url);
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
}

async function createFixture(
	page: Page,
	variant: Variant,
	copy: Copy,
): Promise<Fixture> {
	// This is intentionally the first route load. It catches lazy route CSS
	// regressions before the workflow route has ever been visited.
	await page.goto("/tasks");
	await expect(page.locator("main.tasks-page")).toBeVisible();
	const coldWorkflowStyles = await page.evaluate(() =>
		[...document.styleSheets]
			.map((sheet) => sheet.href ?? "")
			.filter((href) => /page-project-workflow/i.test(href)),
	);
	expect(coldWorkflowStyles).toEqual([]);

	const zh = variant.locale === "zh-CN";
	const projectName = zh ? "青鸟笔记站" : "Bluebird notes";
	const accountName = zh ? "青鸟管理邮箱" : "Bluebird admin email";
	const ordinaryName = zh ? "更新项目资料" : "Update project details";
	const maintenanceName = zh ? "检查网站备份" : "Check website backups";

	await createAssetFromForm(
		page,
		copy,
		"project",
		projectName,
		"https://bluebird.example",
	);
	await createAssetFromForm(page, copy, "account", accountName);

	await page.goto("/assets/project");
	await page
		.locator(".asset-project-card")
		.filter({ hasText: projectName })
		.click();
	await expect(
		page.getByRole("heading", { name: projectName, exact: true }),
	).toBeVisible();

	const relationDialogPromise = page
		.getByRole("button", { name: copy.addConnection, exact: true })
		.click()
		.then(() => page.getByRole("dialog"));
	const relationDialog = await relationDialogPromise;
	await selectChoice(relationDialog.getByLabel(copy.target, { exact: true }), {
		label: accountName,
	});
	await relationDialog
		.getByLabel(copy.relationLabel, { exact: true })
		.fill("project administration");
	await relationDialog
		.getByRole("button", { name: copy.save, exact: true })
		.click();
	await expect(relationDialog).toBeHidden();

	const taskCard = page.locator(".asset-tasks-card");
	await taskCard.getByRole("button", { name: copy.add, exact: true }).click();
	let editor = page.getByRole("dialog");
	await editor.getByLabel(copy.name, { exact: true }).fill(ordinaryName);
	await editor.getByLabel(copy.date, { exact: true }).fill("2026-10-31");
	await editor.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(editor).toBeHidden();

	await page.goto("/tasks");
	await page
		.getByRole("button", { name: copy.newMaintenance, exact: true })
		.click();
	editor = page.getByRole("dialog");
	await editor
		.getByLabel(copy.maintenanceName, { exact: true })
		.fill(maintenanceName);
	await selectChoice(
		editor.getByLabel(copy.maintenanceAsset, { exact: true }),
		{
			label: `${projectName} · ${copy.projectKind}`,
		},
	);
	await editor
		.getByLabel(copy.maintenanceDue, { exact: true })
		.fill("2026-10-31");
	await editor
		.getByRole("button", { name: copy.maintenanceCreate, exact: true })
		.click();
	await expect(editor).toBeHidden();

	await page.goto("/assets/project");
	await page
		.locator(".asset-project-card")
		.filter({ hasText: projectName })
		.click();
	await page
		.getByRole("link", { name: copy.workflowClose, exact: true })
		.click();
	await page
		.getByRole("button", { name: copy.workflowCreate, exact: true })
		.click();
	await expect(page.locator(".project-workflow-task").first()).toBeVisible();
	const workflowPath = new URL(page.url()).pathname;
	await page.goto("/tasks");
	await expect(page.locator(".tasks-list-card")).toContainText(ordinaryName);
	await expect(page.locator(".tasks-list-card")).toContainText(maintenanceName);
	return {
		projectName,
		accountName,
		ordinaryName,
		maintenanceName,
		workflowPath,
	};
}

async function assertNoOverflow(page: Page, width: number) {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth))
		.toBeLessThanOrEqual(width + 1);
}

async function assertTaskSurface(page: Page, variant: Variant, copy: Copy) {
	await assertNoOverflow(page, variant.width);
	await expect(page.locator(".tasks-list-card")).toBeVisible();
	await expect(page.locator(".tasks-plan-card")).toBeVisible();
	const metrics = await page.evaluate(() => {
		const root = getComputedStyle(document.documentElement);
		const cards = [
			...document.querySelectorAll<HTMLElement>(
				".tasks-columns > .card, .tasks-list-card .task-card",
			),
		];
		const rows = [
			...document.querySelectorAll<HTMLElement>(
				".tasks-list-card .list-row, .tasks-list-card .project-workflow-task",
			),
		];
		const actionGroups = [
			...document.querySelectorAll<HTMLElement>(
				".tasks-list-card .impact-task-actions, .tasks-list-card .maintenance-task-actions",
			),
		];
		const gaps = actionGroups.flatMap((group) => {
			const owner = group.closest<HTMLElement>(
				".list-row, .project-workflow-task",
			);
			if (!owner) return [];
			const ownerBox = owner.getBoundingClientRect();
			const actionBox = group.getBoundingClientRect();
			const children = [...group.children]
				.map((child) => (child as HTMLElement).getBoundingClientRect())
				.filter((box) => box.width > 0 && box.height > 0);
			const childGaps = children.slice(1).map((current, index) => {
				const previous = children[index];
				const overlap =
					Math.min(previous.bottom, current.bottom) -
					Math.max(previous.top, current.top);
				return overlap > 1
					? current.left - previous.right
					: current.top - previous.bottom;
			});
			return [
				{
					leftInset: actionBox.left - ownerBox.left,
					rightInset: ownerBox.right - actionBox.right,
					childGaps,
				},
			];
		});
		return {
			rootFont: root.fontFamily,
			cards: cards.map((card) => {
				const style = getComputedStyle(card);
				return {
					font: style.fontFamily,
					borderWidth: Number.parseFloat(style.borderTopWidth),
					borderRadius: Number.parseFloat(style.borderTopLeftRadius),
					background: style.backgroundColor,
				};
			}),
			rows: rows.length,
			gaps,
		};
	});
	for (const card of metrics.cards) {
		expect(card.font).toBe(metrics.rootFont);
		expect(card.borderWidth).toBeGreaterThanOrEqual(1);
		expect(card.borderRadius).toBeGreaterThan(0);
		expect(card.background).not.toBe("rgba(0, 0, 0, 0)");
	}
	expect(metrics.rows).toBeGreaterThanOrEqual(3);
	for (const action of metrics.gaps) {
		expect(action.leftInset).toBeGreaterThanOrEqual(6);
		expect(action.rightInset).toBeGreaterThanOrEqual(6);
		for (const gap of action.childGaps) expect(gap).toBeGreaterThanOrEqual(4);
	}
	await expect(page.locator(".tasks-cardhead").first()).toContainText(
		copy.tasks === "待办" ? "近期任务" : "Recent tasks",
	);
}

async function assertTaskDateLabels(
	page: Page,
	fixture: Fixture,
	copy: Copy,
	completed = false,
) {
	const ordinary = page
		.locator(".tasks-list-card .impact-task-row")
		.filter({ hasText: fixture.ordinaryName });
	const maintenance = page
		.locator(".tasks-list-card .maintenance-task-row")
		.filter({ hasText: fixture.maintenanceName });
	await expect(ordinary).toContainText(
		completed ? copy.done : copy.remindLater,
	);
	await expect(maintenance).toContainText(copy.maintenanceDue);
	await expect(maintenance).toContainText(copy.maintenanceReminder);
	await expect(maintenance).toContainText(copy.maintenanceRule);
	const planFacts = page.locator(".tasks-plan-facts");
	await expect(planFacts).toContainText(copy.maintenanceDue);
	await expect(planFacts).toContainText(copy.maintenanceReminder);
}

async function assertWorkflowSurface(
	page: Page,
	copy: Copy,
	workflowPage = true,
) {
	const rows = page.locator(".project-workflow-task");
	await expect(rows).not.toHaveCount(0);
	const metrics = await rows.evaluateAll((elements) =>
		elements.map((element) => {
			const style = getComputedStyle(element);
			return {
				paddingTop: Number.parseFloat(style.paddingTop),
				paddingRight: Number.parseFloat(style.paddingRight),
				paddingBottom: Number.parseFloat(style.paddingBottom),
				paddingLeft: Number.parseFloat(style.paddingLeft),
				borderTopWidth: Number.parseFloat(style.borderTopWidth),
				borderRightWidth: Number.parseFloat(style.borderRightWidth),
				borderBottomWidth: Number.parseFloat(style.borderBottomWidth),
				borderLeftWidth: Number.parseFloat(style.borderLeftWidth),
				borderRadius: Number.parseFloat(style.borderTopLeftRadius),
				display: style.display,
			};
		}),
	);
	for (const row of metrics) {
		expect(row.paddingTop).toBeGreaterThanOrEqual(12);
		expect(row.paddingRight).toBeGreaterThanOrEqual(12);
		expect(row.paddingBottom).toBeGreaterThanOrEqual(12);
		expect(row.paddingLeft).toBeGreaterThanOrEqual(12);
		expect(row.borderTopWidth).toBeGreaterThanOrEqual(1);
		expect(row.borderRightWidth).toBeGreaterThanOrEqual(1);
		expect(row.borderBottomWidth).toBeGreaterThanOrEqual(1);
		expect(row.borderLeftWidth).toBeGreaterThanOrEqual(1);
		expect(row.borderRadius).toBeGreaterThanOrEqual(10);
		expect(row.display).toBe("grid");
	}
	if (workflowPage)
		await expect(page.locator(".project-workflow-card").first()).toContainText(
			copy.workflowSnapshotAt,
		);
}

async function assertNavBadgeInset(page: Page, variant: Variant, copy: Copy) {
	if (variant.width <= 620) await page.locator(".mobile-menu").click();
	const navItem = page
		.locator(".nav .sortable-nav-item")
		.filter({ hasText: copy.tasks })
		.first();
	const badge = navItem.locator(".nav-count");
	await expect(navItem).toBeVisible();
	await expect(badge).toBeVisible();
	const inset = await badge.evaluate((element) => {
		const owner = element.closest<HTMLElement>(".sortable-nav-item");
		if (!owner) throw new Error("task nav item missing");
		const badgeBox = element.getBoundingClientRect();
		const ownerBox = owner.getBoundingClientRect();
		return {
			left: badgeBox.left - ownerBox.left,
			right: ownerBox.right - badgeBox.right,
		};
	});
	expect(inset.left).toBeGreaterThanOrEqual(12);
	expect(inset.right).toBeGreaterThanOrEqual(12);
	if (variant.width <= 620) {
		const scrim = page.locator(".mobile-scrim");
		const bounds = await scrim.boundingBox();
		if (!bounds) throw new Error("mobile-scrim-not-visible");
		// The sidebar overlays the scrim's center; close via its exposed right edge.
		await scrim.click({ position: { x: bounds.width - 8, y: bounds.height / 2 } });
		await expect(page.locator(".mobile-scrim")).toBeHidden();
	}
}

async function assertThemedProjectLink(page: Page, projectName: string) {
	const link = page
		.locator(".tasks-list-card a")
		.filter({ hasText: projectName })
		.first();
	await expect(link).toBeVisible();
	const style = await link.evaluate((element) => {
		const computed = getComputedStyle(element);
		const probe = document.createElement("span");
		probe.style.color = "var(--ink)";
		probe.style.display = "none";
		document.body.append(probe);
		const inkColor = getComputedStyle(probe).color;
		probe.remove();
		return {
			color: computed.color,
			inkColor,
			font: computed.fontFamily,
			className: element.className,
		};
	});
	expect(style.className).toMatch(/(^|\s)text-link(\s|$)/);
	expect(style.color).toBe(style.inkColor);
	const rootFont = await page.evaluate(
		() => getComputedStyle(document.documentElement).fontFamily,
	);
	expect(style.font).toBe(rootFont);
}

async function recordWorkflowRow(
	row: Locator,
	copy: Copy,
	outcome: "done" | "na",
	evidence: string,
) {
	await row
		.getByRole("button", {
			name: /Record result|Edit result|记录处理结果|修改处理记录/,
		})
		.click();
	const form = row.locator("form.project-workflow-record-form");
	await selectChoice(
		form.getByRole("combobox", { name: copy.workflowResult, exact: true }),
		outcome,
	);
	await form
		.getByRole("textbox", { name: copy.workflowEvidence, exact: true })
		.fill(evidence);
	await form
		.getByRole("button", { name: copy.workflowSave, exact: true })
		.click();
	await expect(form).toBeHidden();
	await expect(row.locator(".project-workflow-record")).toContainText(evidence);
}

for (const variant of variants) {
	const copy = copyFor(variant.locale);
	const stem = `${variant.locale === "zh-CN" ? "zh" : "en"}-${variant.width}`;

	test(`${variant.locale} ${variant.width}px completes the themed task workflow`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			locale: variant.locale,
			viewport: { width: variant.width, height: 844 },
		});
		const page = await context.newPage();
		page.setDefaultTimeout(10_000);
		try {
			// Context locale covers English; persist zh-CN explicitly because the app
			// prefers its saved language over navigator.language.
			await page.addInitScript(
				(language) => {
					window.localStorage.setItem("keepany-language", language);
				},
				variant.locale === "zh-CN" ? "zh-CN" : "en",
			);
			const fixture = await createFixture(page, variant, copy);

			// 1. Cold /tasks surface: cards, dates, action spacing, and themed links.
			await assertTaskSurface(page, variant, copy);
			await assertWorkflowSurface(page, copy, false);
			expect(
				await page.evaluate(() =>
					Array.from(document.styleSheets)
						.map((sheet) => sheet.href ?? "")
						.filter((href) => /page-project-workflow/i.test(href)),
				),
			).toEqual([]);
			await assertTaskDateLabels(page, fixture, copy);
			await assertThemedProjectLink(page, fixture.projectName);
			await page.screenshot({
				path: join(evidenceRoot, `task-theme-${stem}-surface.png`),
				fullPage: true,
			});

			// 2. A blocked record is persisted through the visible workflow form.
			await page.goto(fixture.workflowPath);
			await assertWorkflowSurface(page, copy);
			const rows = page.locator(".project-workflow-task");
			const first = rows.first();
			const firstTaskId = await first.getAttribute("id");
			await first
				.getByRole("button", { name: copy.workflowRecord, exact: true })
				.click();
			const blockedForm = first.locator("form.project-workflow-record-form");
			await selectChoice(
				blockedForm.getByRole("combobox", {
					name: copy.workflowResult,
					exact: true,
				}),
				"blocked",
			);
			const blockedEvidence = `Blocked handoff ${variant.locale} ${variant.width}`;
			await blockedForm
				.getByRole("textbox", { name: copy.workflowEvidence, exact: true })
				.fill(blockedEvidence);
			await blockedForm
				.getByRole("button", { name: copy.workflowSave, exact: true })
				.click();
			await expect(blockedForm).toBeHidden();
			await expect(first.locator(".project-workflow-record")).toContainText(
				blockedEvidence,
			);
			await expect(first).toContainText(copy.blocked);
			await expect(first).toContainText(blockedEvidence);
			await page.goto("/tasks");
			await assertThemedProjectLink(page, fixture.projectName);
			await page.locator(`#${firstTaskId}`).scrollIntoViewIfNeeded();
			await page.screenshot({
				path: join(evidenceRoot, `task-theme-${stem}-blocked.png`),
				fullPage: false,
			});

			// 3. Cancel an edit, verify the final lock, then reload the completed round.
			await page.goto(fixture.workflowPath);
			await assertWorkflowSurface(page, copy);
			const workflowRows = page.locator(".project-workflow-task");
			const workflowFirst = page.locator(`#${firstTaskId}`);
			const finalRow = workflowRows.last();
			await workflowFirst
				.getByRole("button", { name: copy.workflowEdit, exact: true })
				.click();
			const form = workflowFirst.locator("form.project-workflow-record-form");
			await form
				.getByRole("textbox", { name: copy.workflowEvidence, exact: true })
				.fill("Discarded edit");
			await form
				.getByRole("button", { name: copy.cancel, exact: true })
				.click();
			await expect(form).toBeHidden();
			await expect(workflowFirst).toContainText(blockedEvidence);
			await expect(workflowFirst).not.toContainText("Discarded edit");
			await expect(
				finalRow.getByRole("button", {
					name: copy.workflowRecord,
					exact: true,
				}),
			).toBeDisabled();

			await recordWorkflowRow(
				workflowFirst,
				copy,
				"done",
				`Resolved blocker ${variant.locale} ${variant.width}`,
			);
			for (
				let index = 1;
				index < (await workflowRows.count()) - 1;
				index += 1
			) {
				await recordWorkflowRow(
					workflowRows.nth(index),
					copy,
					"na",
					`Checked step ${index}`,
				);
			}
			await expect(
				finalRow.getByRole("button", {
					name: copy.workflowRecord,
					exact: true,
				}),
			).toBeEnabled();
			await recordWorkflowRow(
				finalRow,
				copy,
				"done",
				`Final decision ${variant.locale} ${variant.width}`,
			);
			await page.reload();
			await assertWorkflowSurface(page, copy);
			await expect(page.locator(".project-workflow-task").last()).toContainText(
				`Final decision ${variant.locale} ${variant.width}`,
			);
			await expect(page.locator(`#${firstTaskId}`)).toContainText(
				`Resolved blocker ${variant.locale} ${variant.width}`,
			);
			await page.screenshot({
				path: join(evidenceRoot, `task-theme-${stem}-workflow-reload.png`),
				fullPage: true,
			});

			// 4. Navigation badge and ordinary/maintenance actions survive reload.
			await page.goto("/tasks");
			await assertNavBadgeInset(page, variant, copy);
			await assertTaskSurface(page, variant, copy);
			await assertWorkflowSurface(page, copy, false);
			expect(
				await page.evaluate(() =>
					Array.from(document.styleSheets)
						.map((sheet) => sheet.href ?? "")
						.filter((href) => /page-project-workflow/i.test(href)),
				),
			).toEqual([]);
			await assertTaskDateLabels(page, fixture, copy);
			const ordinary = page
				.locator(".tasks-list-card .impact-task-row")
				.filter({ hasText: fixture.ordinaryName });
			await ordinary
				.getByRole("button", { name: copy.complete, exact: true })
				.click();
			await expect(ordinary).toContainText(copy.done);
			const maintenance = page
				.locator(".tasks-list-card .maintenance-task-row")
				.filter({ hasText: fixture.maintenanceName });
			await maintenance
				.getByRole("button", { name: copy.maintenanceComplete, exact: true })
				.click();
			await maintenance
				.getByLabel(copy.maintenanceActionDate, { exact: true })
				.fill("2026-09-30");
			await maintenance
				.getByRole("textbox", { name: copy.maintenanceEvidence, exact: true })
				.fill(`Maintenance record ${variant.locale} ${variant.width}`);
			await maintenance
				.getByRole("button", { name: copy.maintenanceSaveRecord, exact: true })
				.click();
			await expect(
				maintenance.locator(".maintenance-action-form"),
			).toBeHidden();
			await expect(maintenance).toContainText(
				`Maintenance record ${variant.locale} ${variant.width}`,
			);
			await page.reload();
			await assertTaskDateLabels(page, fixture, copy, true);
			const reloadedMaintenance = page
				.locator(".tasks-list-card .maintenance-task-row")
				.filter({ hasText: fixture.maintenanceName });
			await reloadedMaintenance.getByText(/Action history|处理记录/).click();
			await expect(reloadedMaintenance).toContainText(
				`Maintenance record ${variant.locale} ${variant.width}`,
			);
			await page.screenshot({
				path: join(evidenceRoot, `task-theme-${stem}-actions-reload.png`),
				fullPage: true,
			});
		} finally {
			await context.close().catch(() => undefined);
		}
	});
}
