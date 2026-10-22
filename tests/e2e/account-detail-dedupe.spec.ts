import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { activeAccountGraph, expectAllAccountGraphNodesInFrame, expectCanvasActionsOutsideStage, fitAccountGraph, setAccountRelationDetailsOpen, waitForAccountGraphLayout } from "./helpers/account-graph";
import { selectChoice } from "./helpers/select-choice";

// Production-bundle acceptance: fixtures are created only through visible forms.
// DOM reads below measure rendered UI; they never import source or access the DB.
const evidence = process.env.KEEPANY_EVIDENCE_DIR;
const variants = ["zh-CN", "en-US"] as const;
type Locale = (typeof variants)[number];
const copyFor = (locale: Locale) => locale === "zh-CN" ? {
	add: "新增", save: "保存", cancel: "取消", edit: "编辑", close: "关闭",
	trash: "移至回收站", restore: "恢复", addRelation: "添加关联", deleteRelation: "删除关系",
	fit: "适应画布", focus: "回到当前", expand: "全屏查看", zoomIn: "放大", zoomOut: "缩小",
	direct: "直接关联", family: "完整关系", category: "分类", phone: "手机", other: "其他",
	username: "账号标识", password: "管理这个账号的密码", addImage: "添加图片", replaceImage: "替换图片",
	removeImage: "移除图片", confirm: "确认", complete: "完成", reopen: "重新打开",
	postpone: "稍后 1 天", generate: "生成检查待办", all: "全部", pending: "待处理", done: "已完成",
	remind: "稍后提醒", viewTask: "查看待办",
} : {
	add: "Add", save: "Save", cancel: "Cancel", edit: "Edit", close: "Close",
	trash: "Move to trash", restore: "Restore", addRelation: "Add connection", deleteRelation: "Delete connection",
	fit: "Fit all", focus: "Back to current", expand: "Expand graph", zoomIn: "Zoom in", zoomOut: "Zoom out",
	direct: "Direct", family: "All connections", category: "Category", phone: "Phone", other: "Other",
	username: "Username / identifier", password: "Manage this account’s passwords", addImage: "Add image", replaceImage: "Replace image",
	removeImage: "Remove image", confirm: "Confirm", complete: "Complete", reopen: "Reopen",
	postpone: "Postpone 1 day", generate: "Create checklist", all: "All", pending: "Pending", done: "Completed",
	remind: "Remind later", viewTask: "View task",
};
type Copy = ReturnType<typeof copyFor>;
type Account = { name: string; username?: string; category?: "phone" | "other"; description?: string; url?: string; longDescription?: string; contact?: string; notes?: string; tags?: string };

async function openSession(browser: Browser, locale: Locale, width: number) {
	const baseURL = test.info().project.use.baseURL;
	if (!baseURL) throw Error("Account detail acceptance requires a configured application baseURL");
	const appOrigin = new URL(baseURL).origin;
	const context = await browser.newContext({ locale, viewport: { width, height: 1000 }, reducedMotion: "reduce", timezoneId: "Asia/Shanghai" });
	await context.addInitScript(({ language, appOrigin }) => {
		if (location.origin === appOrigin) localStorage.setItem("keepany-language", language);
	}, { language: locale === "en-US" ? "en" : locale, appOrigin });
	await context.route("https://example.test/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html><title>Synthetic external page</title><h1>Local acceptance destination</h1></html>" }));
	const errors: string[] = [];
	context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
	const page = await context.newPage();
	page.setDefaultTimeout(15_000);
	return { context, page, errors, copy: copyFor(locale) };
}

function accountCard(page: Page, name: string) {
	return page.locator(".asset-account-card").filter({ has: page.locator("strong", { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });
}

async function addAccount<T extends Account>(page: Page, copy: Copy, account: T) {
	await page.goto("/assets/account");
	await page.getByRole("button", { name: copy.add, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.locator("#name").fill(account.name);
	await selectChoice(dialog.locator("#category"), account.category ?? "other");
	for (const field of ["username", "description", "url", "longDescription", "contact", "notes", "tags"] as const)
		if (account[field]) await dialog.locator(`#${field}`).fill(account[field]);
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
	const card = accountCard(page, account.name);
	await expect(card).toHaveCount(1);
	const href = await card.getAttribute("href");
	if (!href) throw Error("Created account is missing its detail link");
	const id = href.split("/").at(-1);
	if (!id) throw Error("Created account is missing its ID");
	return { ...account, href, id };
}

async function addRelation(page: Page, copy: Copy, target: string, purpose: string, source: string, verifiedAt = "2026-10-22") {
	await page.locator("#account-relations").getByRole("button", { name: copy.addRelation, exact: true }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("button", { name: copy.save, exact: true })).toBeDisabled();
	await selectChoice(dialog.locator("#relation-target"), { label: target });
	await dialog.locator("#relation-label").fill(purpose);
	await dialog.locator("#relation-source").fill(source);
	if (verifiedAt) await dialog.locator("#relation-verified").fill(verifiedAt);
	await dialog.getByRole("button", { name: copy.save, exact: true }).click();
	await expect(dialog).toBeHidden();
}

function purposeRow(page: Page, purpose: string) {
	return page.locator("details.account-relation-details .relation-row").filter({ has: page.locator(".relation-purpose", { hasText: purpose }) });
}

async function camera(page: Page) {
	return activeAccountGraph(page).locator(".react-flow__viewport").evaluate(element => {
		const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
		return { x: matrix.e, y: matrix.f, zoom: Math.hypot(matrix.a, matrix.b) };
	});
}

async function unchangedCamera(page: Page, before: Awaited<ReturnType<typeof camera>>) {
	await waitForAccountGraphLayout(page);
	const after = await camera(page);
	expect(after.x, "Reading/searching/selecting must preserve camera x").toBeCloseTo(before.x, 1);
	expect(after.y, "Reading/searching/selecting must preserve camera y").toBeCloseTo(before.y, 1);
	expect(after.zoom, "Reading/searching/selecting must preserve camera zoom").toBeCloseTo(before.zoom, 3);
}

async function screenshot(page: Page, name: string) {
	if (!evidence) return;
	mkdirSync(evidence, { recursive: true });
	await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true, animations: "disabled" });
}

function formattedDay(value: string, locale: Locale) {
	return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

async function assertGeometry(page: Page, scope: Locator = page.locator("main.asset-detail-account")) {
	const failures = await scope.evaluate(element => {
		const failures: string[] = [];
		const visible = (node: Element) => {
			const box = node.getBoundingClientRect();
			return box.width > 0 && box.height > 0 && getComputedStyle(node).visibility !== "hidden" && !node.closest("details:not([open]) > :not(summary)");
		};
		const name = (node: Element) => node.getAttribute("aria-label") || node.textContent?.trim().slice(0, 70) || node.className;
		const targets = [...element.querySelectorAll("button, a.button, summary, a.topbar-back-link")];
		if (element.matches("button, a.button, summary, a.topbar-back-link")) targets.push(element);
		for (const button of targets) {
			if (!visible(button)) continue;
			const box = button.getBoundingClientRect();
			if (box.width < 43.5 || box.height < 43.5) failures.push(`${name(button)} target ${box.width.toFixed(1)}×${box.height.toFixed(1)} <44`);
		}
		for (const group of element.querySelectorAll(".actions, .account-graph-action-buttons, .react-flow__controls, .task-filters, .image-item")) {
			const buttons = [...group.querySelectorAll(":scope > button, :scope > a.button")].filter(visible);
			for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) {
				const a = buttons[i].getBoundingClientRect(), b = buttons[j].getBoundingClientRect();
				const gapX = Math.max(b.left - a.right, a.left - b.right);
				const gapY = Math.max(b.top - a.bottom, a.top - b.bottom);
				if (Math.max(gapX, gapY) < 7.5) failures.push(`${name(buttons[i])} / ${name(buttons[j])} gap ${Math.max(gapX, gapY).toFixed(1)} <8`);
			}
		}
		const cards = [...element.querySelectorAll(":scope > .card, :scope > .detail-grid > .card, :scope > .account-facts-grid > .card")].filter(visible);
		for (const card of cards) {
			const box = card.getBoundingClientRect();
			if (box.left < -1 || box.right > innerWidth + 1 || card.scrollWidth > card.clientWidth + 1) failures.push(`${name(card)} card overflows horizontally`);
		}
		for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
			const a = cards[i].getBoundingClientRect(), b = cards[j].getBoundingClientRect();
			const gap = Math.max(b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
			if (gap < 7.5) failures.push(`Cards ${i}/${j} gap ${gap.toFixed(1)} <8`);
		}
		return failures;
	});
	expect(failures, "Retained controls are 44px, separate actions/cards have ≥8px gaps, and cards do not overflow").toEqual([]);
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), "Page must not overflow horizontally").toBeLessThanOrEqual(1);
}

async function assertGraphActions(page: Page, copy: Copy) {
	const graph = await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
	await expect(graph.getByRole("button", { name: copy.fit, exact: true })).toHaveCount(1);
	await expect(graph.locator(".react-flow__controls button")).toHaveCount(4);
	await expect(graph.locator(".react-flow__controls-fitview")).toHaveCount(0);
	await graph.getByRole("button", { name: copy.fit, exact: true }).click();
	const fit = await camera(page);
	await graph.getByRole("button", { name: copy.zoomIn, exact: true }).click();
	await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(fit.zoom + 0.01);
	const zoomed = await camera(page);
	await graph.getByRole("button", { name: copy.zoomOut, exact: true }).click();
	await expect.poll(async () => (await camera(page)).zoom).toBeLessThan(zoomed.zoom - 0.01);
	await graph.getByRole("button", { name: copy.focus, exact: true }).click();
	await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1, 2);
	await graph.getByRole("button", { name: copy.fit, exact: true }).click();
}

for (const locale of variants) for (const width of [390, 1536]) {
	test(`${locale} ${width}px graph fullscreen stays open across connected accounts with four merged icon controls`, async ({ browser }) => {
		test.setTimeout(150_000);
		const { context, page, errors, copy } = await openSession(browser, locale, width);
		const records: Awaited<ReturnType<typeof addAccount>>[] = [];
		try {
			for (const name of ["Graph Mail", "Graph Studio", "Graph Design", "Graph Backup"])
				records.push(await addAccount(page, copy, { name, username: `${name.toLowerCase().replaceAll(" ", ".")}@example.test` }));
			for (let index = 0; index < records.length; index++) {
				await page.goto(records[index].href);
				await addRelation(page, copy, records[(index + 1) % records.length].name, `Connection ${index + 1}`, "Synthetic full screen acceptance");
			}
			await page.goto(records[0].href);
			let graph = await waitForAccountGraphLayout(page, { nodes: 3, edges: 2 });
			const controls = graph.locator(".react-flow__controls");
			await expect(controls.locator("button")).toHaveCount(4);
			for (const button of await controls.locator("button").all()) await expect(button).toHaveText("");
			await expect(graph.locator(".account-graph-view-toggle")).toHaveCount(1);
			await expect(graph.getByRole("button", { name: copy.focus, exact: true })).toHaveCount(0);
			await expect(graph.getByRole("button", { name: copy.fit, exact: true })).toHaveCount(1);
			await expectCanvasActionsOutsideStage(page);
			await assertGeometry(page, graph);
			const smallView = await camera(page);
			await graph.getByRole("button", { name: copy.fit, exact: true }).click();
			if (width === 1536) {
				await unchangedCamera(page, smallView);
				await expect(graph.getByRole("button", { name: copy.focus, exact: true })).toHaveCount(0);
			} else await graph.getByRole("button", { name: copy.focus, exact: true }).click();
			await graph.getByRole("button", { name: copy.zoomIn, exact: true }).click();
			await expect(graph.getByRole("button", { name: copy.focus, exact: true })).toHaveCount(1);
			await graph.getByRole("button", { name: copy.focus, exact: true }).click();
			await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(1, 3);
			await expect(graph.getByRole("button", { name: copy.fit, exact: true })).toHaveCount(1);
			await page.getByRole("button", { name: copy.family, exact: true }).click();
			graph = await waitForAccountGraphLayout(page, { nodes: 4, edges: 4 });
			const expectedIds = records.map(record => record.id).sort();
			const directions = await graph.locator(".react-flow__edge").evaluateAll(edges => edges.map(edge => [edge.getAttribute("data-from"), edge.getAttribute("data-to")]).sort());
			await graph.getByRole("button", { name: copy.expand, exact: true }).click();
			const dialog = page.getByRole("dialog");
			await expect(dialog).toBeVisible();
			const dialogHandle = await dialog.elementHandle();
			const exitLabel = locale === "zh-CN" ? "退出全屏" : "Exit expanded view";
			await expect(dialog.getByRole("button", { name: exitLabel, exact: true })).toHaveAttribute("aria-pressed", "true");
			for (const record of records.slice(1)) {
				await waitForAccountGraphLayout(page, { nodes: 4, edges: 4 });
				await fitAccountGraph(page);
				await expectAllAccountGraphNodesInFrame(page);
				const edge = activeAccountGraph(page).locator(".react-flow__edge").first();
				await edge.focus();
				await page.keyboard.press("Enter");
				await expect(activeAccountGraph(page).locator(".account-graph-connection-details")).toHaveCount(1);
				await activeAccountGraph(page).locator(`.react-flow__node[data-id="${record.id}"] a.asset-graph-link`).click();
				await expect(page).toHaveURL(new RegExp(`${record.href}$`));
				await expect(dialog, "Following a related account keeps the expanded graph open").toBeVisible();
				graph = await waitForAccountGraphLayout(page, { nodes: 4, edges: 4 });
				await expect(graph.locator(".asset-graph-center")).toHaveAttribute("data-id", record.id);
				expect(await graph.locator(".react-flow__node").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-id")).sort())).toEqual(expectedIds);
				expect(await graph.locator(".react-flow__edge").evaluateAll(edges => edges.map(edge => [edge.getAttribute("data-from"), edge.getAttribute("data-to")]).sort())).toEqual(directions);
				expect(await dialogHandle?.evaluate(element => element.isConnected), "Account navigation must preserve the same dialog").toBe(true);
				expect(await dialog.evaluate(element => element.contains(document.activeElement)), "Keyboard focus stays inside the expanded graph after account navigation").toBe(true);
				await expect(graph.locator(".account-graph-connection-details")).toHaveCount(0);
				await expectCanvasActionsOutsideStage(page);
				await assertGeometry(page, dialog);
			}
			await page.goBack();
			await expect(page).toHaveURL(new RegExp(`${records[2].href}$`));
			await expect(dialog).toBeVisible();
			await waitForAccountGraphLayout(page, { nodes: 4, edges: 4 });
			await page.goForward();
			await expect(page).toHaveURL(new RegExp(`${records[3].href}$`));
			await expect(dialog).toBeVisible();
			await waitForAccountGraphLayout(page, { nodes: 4, edges: 4 });
			await screenshot(page, `graph-fullscreen-after-three-account-visits-${locale}-${width}`);
			await dialog.getByRole("button", { name: exitLabel, exact: true }).click();
			await expect(dialog).toBeHidden();
			graph = await waitForAccountGraphLayout(page, { nodes: 4, edges: 4 });
			await expect(graph.locator(".asset-graph-center")).toHaveAttribute("data-id", records[3].id);
			await expect(graph.getByRole("button", { name: copy.expand, exact: true })).toBeFocused();
			expect((await camera(page)).zoom).toBeCloseTo(1, 3);
			await expect(page.getByRole("button", { name: copy.family, exact: true })).toHaveAttribute("aria-pressed", "true");
			for (const closeMethod of ["escape", "header"] as const) {
				await graph.getByRole("button", { name: copy.expand, exact: true }).click();
				await waitForAccountGraphLayout(page, { nodes: 4, edges: 4 });
				if (closeMethod === "escape") await page.keyboard.press("Escape");
				else await dialog.locator(":scope > header").getByRole("button", { name: copy.close, exact: true }).click();
				await expect(dialog).toBeHidden();
				graph = await waitForAccountGraphLayout(page, { nodes: 4, edges: 4 });
				await expect(graph.getByRole("button", { name: copy.expand, exact: true })).toBeFocused();
			}
			await page.getByRole("button", { name: copy.direct, exact: true }).click();
			await waitForAccountGraphLayout(page, { nodes: 3, edges: 2 });
			await page.reload();
			await waitForAccountGraphLayout(page, { nodes: 3, edges: 2 });
			await screenshot(page, `graph-four-icon-controls-${locale}-${width}`);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});

	test(`${locale} ${width}px account detail merged actions, relationship evidence and recovery`, async ({ browser }) => {
		test.setTimeout(180_000);
		const { context, page, errors, copy } = await openSession(browser, locale, width);
		const suffix = crypto.randomUUID().slice(0, 6);
		const description = `Synthetic purpose ${suffix}`;
		const updatedDescription = `Reviewed purpose ${suffix}`;
		const purposeA = `Login ${suffix}`, purposeB = `Recovery ${suffix}`, source = `Manual review ${suffix}`;
		try {
			const phone = await addAccount(page, copy, { name: "13800138000", username: "13800138000", category: "phone" });
			const service = await addAccount(page, copy, { name: `Studio ${suffix}`, username: `studio.${suffix}@example.test`, description, url: `https://example.test/${suffix}`, longDescription: `Long local details ${suffix}`, contact: `Operations ${suffix}`, notes: `Local review note ${suffix}`, tags: `qa-${suffix}` });
			const empty = await addAccount(page, copy, { name: `Empty ${suffix}` });
			const categoryUsername = await addAccount(page, copy, { name: `Literal identifier ${suffix}`, username: copy.other });
			await expect(accountCard(page, phone.name).locator("small")).toHaveCount(0);
			await expect(accountCard(page, phone.name).getByText(phone.name, { exact: true })).toHaveCount(1);
			await expect(accountCard(page, service.name).locator("small")).toHaveText(service.username);
			await expect(accountCard(page, empty.name).locator("small")).toHaveCount(0);
			await expect(accountCard(page, empty.name).getByText(copy.other, { exact: true })).toHaveCount(1);
			await expect(accountCard(page, categoryUsername.name).locator("small")).toHaveText(copy.other);
			await screenshot(page, `account-detail-dedupe-list-${locale}-${width}`);
			await accountCard(page, categoryUsername.name).click();
			await addRelation(page, copy, empty.name, `Literal username ${suffix}`, "Synthetic identifier evidence");
			await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
			await expect(activeAccountGraph(page).locator(`.react-flow__node[data-id="${categoryUsername.id}"] .asset-graph-label small`)).toHaveText(copy.other);
			await expect(activeAccountGraph(page).locator(`.react-flow__node[data-id="${empty.id}"] .asset-graph-label small`)).toHaveCount(0);
			await page.locator(".topbar-back-link").click();
			await expect(page).toHaveURL(/\/assets\/account$/);
			await accountCard(page, phone.name).click();
			const hero = page.locator(".page-header");
			await hero.getByRole("button", { name: copy.edit, exact: true }).click();
			const dialog = page.getByRole("dialog");
			await expect(dialog.locator("#username")).toHaveValue(phone.username);
			await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
			await expect(dialog).toBeHidden();
			await expect(hero.getByRole("button", { name: copy.edit, exact: true })).toBeFocused();
			await expect(page.locator(".account-facts-card").first().getByText(copy.username, { exact: true })).toHaveCount(0);
			await expect(hero.locator(".eyebrow")).toContainText(copy.phone);
			await page.locator(".topbar-back-link").click();
			await expect(page).toHaveURL(/\/assets\/account$/);
			await accountCard(page, service.name).click();
			await expect(page.locator(".topbar-back-link")).toHaveCount(1);
			await assertGeometry(page, page.locator(".topbar-back-link"));
			await expect(page.locator("main .back-link")).toHaveCount(0);
			await expect(page.getByRole("button", { name: copy.edit, exact: true })).toHaveCount(1);
			await expect(page.getByRole("button", { name: /^(编辑资料|Edit profile)$/ })).toHaveCount(0);
			await expect(page.locator(".account-links-card")).toHaveCount(0);
			await expect(page.locator(".account-facts-grid > .card")).toHaveCount(2);
			const basic = page.locator(".account-facts-card").first();
			await expect(hero.locator(".eyebrow")).toContainText(copy.other);
			await expect(basic.locator("dt").filter({ hasText: new RegExp(`^${copy.category}$`) })).toHaveCount(0);
			await expect(page.locator(".account-facts-grid").getByText(copy.other, { exact: true })).toHaveCount(0);
			await expect(page.locator("main").getByText(description, { exact: true })).toHaveCount(1);
			await expect(basic.getByText(description, { exact: true })).toBeVisible();
			await expect(basic.getByText(service.contact, { exact: true })).toBeVisible();
			await expect(basic.locator(".note")).toHaveText(service.notes);
			await expect(basic.locator(".chips")).toContainText(service.tags);
			const more = basic.locator("details.more");
			await expect(more).toHaveJSProperty("open", false);
			await more.locator("summary").click();
			await expect(more.getByText(service.longDescription, { exact: true })).toBeVisible();
			await more.locator("summary").click();
			await expect(more).toHaveJSProperty("open", false);
			const popupPromise = page.waitForEvent("popup");
			await basic.getByRole("link", { name: service.url, exact: true }).click();
			const popup = await popupPromise;
			try {
				await expect(popup).toHaveURL(service.url);
				await expect(popup.getByRole("heading", { name: "Local acceptance destination" })).toBeVisible();
			} finally { await popup.close(); }
			await hero.getByRole("button", { name: copy.edit, exact: true }).click();
			await dialog.locator("#description").fill(`Discard ${suffix}`);
			await assertGeometry(page, dialog);
			await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
			await expect(basic).toContainText(description);
			await hero.getByRole("button", { name: copy.edit, exact: true }).click();
			await expect(dialog.locator("#description")).toHaveValue(description);
			await expect(dialog.locator("#username")).toHaveValue(service.username);
			await dialog.locator("#description").fill(updatedDescription);
			await dialog.locator("#accountProvider").fill("Synthetic provider");
			await dialog.locator("#accountProfileVerifiedAt").fill("2026-10-21");
			await dialog.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(dialog).toBeHidden();
			await page.reload();
			await expect(basic).toContainText(updatedDescription);
			await hero.getByRole("button", { name: copy.edit, exact: true }).click();
			await expect(dialog.locator("#username")).toHaveValue(service.username);
			await expect(dialog.locator("#description")).toHaveValue(updatedDescription);
			await expect(dialog.locator("#accountProvider")).toHaveValue("Synthetic provider");
			await expect(dialog.locator("#accountProfileVerifiedAt")).toHaveValue("2026-10-21");
			await expect(dialog.locator("#contact")).toHaveValue(service.contact);
			await expect(dialog.locator("#notes")).toHaveValue(service.notes);
			await expect(dialog.locator("#tags")).toHaveValue(service.tags);
			await expect(dialog.locator("#longDescription")).toHaveValue(service.longDescription);
			await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
			await page.locator("#account-relations").getByRole("button", { name: copy.addRelation, exact: true }).click();
			await page.keyboard.press("Escape");
			await expect(dialog).toBeHidden();
			await addRelation(page, copy, phone.name, purposeA, source);
			await addRelation(page, copy, phone.name, purposeB, `${source} B`, "2026-10-20");
			await page.reload();
			const details = page.locator("details.account-relation-details");
			await expect(details).toHaveJSProperty("open", false);
			await assertGraphActions(page, copy);
			const graph = activeAccountGraph(page);
			const phoneNode = graph.locator(`.react-flow__node[data-id="${phone.id}"] .asset-graph-label`);
			await expect(phoneNode.locator("strong")).toHaveText(phone.name);
			await expect(phoneNode.locator("small")).toHaveCount(0);
			await expect(graph.locator(`.react-flow__node[data-id="${service.id}"] .asset-graph-label small`)).toHaveText(service.username);
			const before = await camera(page);
			await setAccountRelationDetailsOpen(page);
			await unchangedCamera(page, before);
			await expect(details.locator(".relation-row")).toHaveCount(2);
			for (const [purpose, evidenceSource, verifiedAt] of [[purposeA, source, "2026-10-22"], [purposeB, `${source} B`, "2026-10-20"]]) {
				await expect(purposeRow(page, purpose).locator(".relation-endpoints")).toHaveText(`${service.name} → ${phone.name}`);
				await expect(purposeRow(page, purpose)).toContainText(evidenceSource);
				await expect(purposeRow(page, purpose)).toContainText(formattedDay(verifiedAt, locale));
			}
			await setAccountRelationDetailsOpen(page, false);
			await unchangedCamera(page, before);
			await page.locator("#relation-filter").fill(purposeA);
			await expect(details).toHaveJSProperty("open", true);
			await expect(details.locator(".relation-row")).toHaveCount(1);
			await expect(purposeRow(page, purposeA)).toBeVisible();
			await unchangedCamera(page, before);
			await page.locator("#relation-filter").fill("");
			await expect(details.locator(".relation-row")).toHaveCount(2);
			await unchangedCamera(page, before);
			const edge = graph.locator(".react-flow__edge");
			await edge.focus();
			await page.keyboard.press("Enter");
			await expect(graph.locator(".account-graph-connection-details")).toContainText(purposeA);
			await expect(graph.locator(".account-graph-connection-details")).toContainText(purposeB);
			await unchangedCamera(page, before);
			await graph.getByRole("button", { name: copy.expand, exact: true }).click();
			await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
			await expect(page.getByRole("dialog").locator(".account-graph-connection-details")).toContainText(purposeA);
			await page.keyboard.press("Escape");
			await expect(page.getByRole("dialog")).toBeHidden();
			await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
			await expect(graph.getByRole("button", { name: copy.expand, exact: true })).toBeFocused();
			expect((await camera(page)).zoom).toBeCloseTo(before.zoom, 3);
			await expect(graph.locator(".account-graph-connection-details")).toContainText(purposeA);
			await graph.locator(".account-graph-connection-details").getByRole("button", { name: copy.close, exact: true }).click();
			await expect(graph.locator(".account-graph-connection-details")).toHaveCount(0);
			await page.locator(".account-graph-guide > summary").click();
			await expect(page.locator(".account-graph-guide")).toHaveJSProperty("open", true);
			await page.locator(".account-graph-guide > summary").click();
			for (const scope of [copy.direct, copy.family]) {
				await page.locator(".account-graph-toolbar").getByRole("button", { name: scope, exact: true }).click();
				await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
			}
			await purposeRow(page, purposeA).getByRole("button").click();
			await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
			await expect(details.locator(".relation-row")).toHaveCount(2);
			await purposeRow(page, purposeA).getByRole("button").click();
			await dialog.getByRole("button", { name: copy.deleteRelation, exact: true }).click();
			await expect(dialog).toBeHidden();
			await expect(purposeRow(page, purposeA)).toHaveCount(0);
			await expect(purposeRow(page, purposeB)).toBeVisible();
			await page.reload();
			await setAccountRelationDetailsOpen(page);
			await expect(details.locator(".relation-row")).toHaveCount(1);
			await addRelation(page, copy, phone.name, purposeA, source);
			await expect(details.locator(".relation-row")).toHaveCount(2);
			await page.locator(".account-security-card").getByRole("link", { name: copy.password, exact: true }).click();
			await expect(page).toHaveURL(new RegExp(`/assets/vault#asset-${service.id}$`));
			await page.goBack();
			await expect(page).toHaveURL(new RegExp(`${service.href}$`));
			await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
			await setAccountRelationDetailsOpen(page);
			await assertGeometry(page);
			await screenshot(page, `account-detail-dedupe-main-${locale}-${width}`);
			await hero.getByRole("button", { name: copy.trash, exact: true }).click();
			await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
			await expect(page.getByRole("heading", { name: service.name, exact: true })).toBeVisible();
			await hero.getByRole("button", { name: copy.trash, exact: true }).click();
			await dialog.getByRole("button", { name: copy.trash, exact: true }).click();
			await expect(page).toHaveURL(/\/assets\/account$/);
			await expect(accountCard(page, service.name)).toHaveCount(0);
			await page.goto("/trash");
			const deleted = page.locator(".list-row").filter({ has: page.getByText(service.name, { exact: true }) }).filter({ has: page.getByRole("button", { name: copy.restore, exact: true }) });
			await deleted.getByRole("button", { name: copy.restore, exact: true }).click();
			await expect(deleted).toHaveCount(0);
			await page.goto("/assets/account");
			await accountCard(page, service.name).click();
			await expect(page).toHaveURL(new RegExp(`${service.href}$`));
			await expect(basic).toContainText(updatedDescription);
			await expect(basic).toContainText(service.username);
			await expect(basic).toContainText(service.contact);
			await expect(basic.locator(".note")).toHaveText(service.notes);
			await expect(basic.locator(".chips")).toContainText(service.tags);
			await expect(basic.getByRole("link", { name: service.url, exact: true })).toBeVisible();
			await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
			await setAccountRelationDetailsOpen(page);
			await expect(details.locator(".relation-row")).toHaveCount(2);
			await expect(purposeRow(page, purposeA)).toContainText(source);
			await expect(purposeRow(page, purposeB)).toContainText(`${source} B`);
			await screenshot(page, `account-detail-dedupe-restored-${locale}-${width}`);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});

	test(`${locale} ${width}px account detail images, manual tasks and impact checklist`, async ({ browser }) => {
		test.setTimeout(150_000);
		const { context, page, errors, copy } = await openSession(browser, locale, width);
		const suffix = crypto.randomUUID().slice(0, 6), purposeA = `Billing ${suffix}`, purposeB = `Recovery ${suffix}`;
		try {
			const target = await addAccount(page, copy, { name: `Target ${suffix}`, username: `target.${suffix}@example.test` });
			const owner = await addAccount(page, copy, { name: `Media ${suffix}`, username: `media.${suffix}@example.test` });
			await accountCard(page, owner.name).click();
			await addRelation(page, copy, target.name, purposeA, "Synthetic checklist source");
			await addRelation(page, copy, target.name, purposeB, "Synthetic recovery source", "2026-10-20");
			const images = page.locator(".asset-attachments-card");
			const first = await syntheticPng(page, "#2468ac"), replacement = await syntheticPng(page, "#d87129");
			const dialog = page.getByRole("dialog");
			async function choose(button: Locator, name: string, buffer: Buffer) {
				const chooser = page.waitForEvent("filechooser");
				await button.click();
				await (await chooser).setFiles({ name, mimeType: "image/png", buffer });
				await expect(dialog.getByRole("button", { name: copy.confirm, exact: true })).toBeEnabled();
				await expect(dialog.locator("img")).toBeVisible();
				await expect.poll(() => dialog.locator("img").evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(8);
			}
			const addImage = images.getByRole("button", { name: copy.addImage, exact: true });
			await choose(addImage, "first.png", first);
			await assertGeometry(page, dialog);
			await screenshot(page, `account-detail-dedupe-image-preview-${locale}-${width}`);
			await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
			await expect(page.locator(".asset-image")).toHaveCount(0);
			await expect(addImage).toBeFocused();
			await choose(addImage, "first.png", first);
			await dialog.getByRole("button", { name: copy.confirm, exact: true }).click();
			await expect(dialog).toBeHidden();
			await expect(page.locator(".asset-image")).toHaveCount(1);
			await expect.poll(() => renderedImageBytes(page)).toEqual([...first]);
			await page.reload();
			await expect.poll(() => renderedImageBytes(page)).toEqual([...first]);
			const replace = images.getByRole("button", { name: copy.replaceImage, exact: true });
			await choose(replace, "replacement.png", replacement);
			await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
			await expect.poll(() => renderedImageBytes(page)).toEqual([...first]);
			await expect(replace).toBeFocused();
			await choose(replace, "replacement.png", replacement);
			await dialog.getByRole("button", { name: copy.confirm, exact: true }).click();
			await expect(dialog).toBeHidden();
			await expect(page.locator(".asset-image")).toHaveCount(1);
			await expect.poll(() => renderedImageBytes(page)).toEqual([...replacement]);
			await page.reload();
			await expect.poll(() => renderedImageBytes(page)).toEqual([...replacement]);
			const tasks = page.locator(".asset-tasks-card"), manualName = `Manual review ${suffix}`;
			await tasks.getByRole("button", { name: copy.add, exact: true }).click();
			await dialog.locator("#taskName").fill(`Discarded ${suffix}`);
			await dialog.getByRole("button", { name: copy.cancel, exact: true }).click();
			await expect(tasks.locator(".task-card")).toHaveCount(0);
			await tasks.getByRole("button", { name: copy.add, exact: true }).click();
			await dialog.locator("#taskName").fill(manualName);
			await dialog.locator("#taskDue").fill("2030-10-22");
			await dialog.getByRole("button", { name: copy.save, exact: true }).click();
			await expect(dialog).toBeHidden();
			const manual = tasks.locator(".task-card").filter({ hasText: manualName });
			await expect(manual).toHaveCount(1);
			await expect(manual.locator(`a[href="${owner.href}"]`)).toHaveCount(0);
			await manual.getByRole("button", { name: copy.complete, exact: true }).click();
			await expect(manual.getByRole("button", { name: copy.reopen, exact: true })).toBeEnabled();
			await expect(manual.locator("strong.done")).toHaveText(manualName);
			await manual.getByRole("button", { name: copy.reopen, exact: true }).click();
			await expect(manual.getByRole("button", { name: copy.complete, exact: true })).toBeEnabled();
			await manual.getByRole("button", { name: copy.postpone, exact: true }).click();
			await expect(manual.getByLabel(copy.remind, { exact: true })).toHaveValue("2030-10-23");
			await expect(manual.getByLabel(copy.remind, { exact: true })).toBeEnabled();
			await manual.getByLabel(copy.remind, { exact: true }).fill("2030-11-01");
			await expect(manual.getByLabel(copy.remind, { exact: true })).toBeEnabled();
			const checklist = page.locator(".impact-checklist");
			await checklist.getByRole("button", { name: `${copy.generate} · 2`, exact: true }).click();
			await expect(checklist.locator(".impact-task-row")).toHaveCount(2);
			await expect(checklist.getByRole("button", { name: `${copy.generate} · 0`, exact: true })).toBeDisabled();
			await expect(tasks.locator(".task-card")).toHaveCount(1);
			const firstImpact = checklist.locator(".impact-task-row").filter({ hasText: purposeA });
			await expect(firstImpact).toContainText(`${owner.name} → ${target.name}`);
			await expect(firstImpact).toContainText("Synthetic checklist source");
			await expect(firstImpact).toContainText(formattedDay("2026-10-22", locale));
			await firstImpact.getByRole("button", { name: `${copy.complete} · ${target.name} · ${purposeA}`, exact: true }).click();
			await expect(firstImpact.getByText(copy.done, { exact: true })).toBeVisible();
			await checklist.getByRole("button", { name: `${copy.pending} · 1`, exact: true }).click();
			await expect(checklist.locator(".impact-task-row")).toHaveCount(1);
			await expect(checklist.locator(".impact-task-row")).toContainText(purposeB);
			await checklist.getByRole("button", { name: `${copy.done} · 1`, exact: true }).click();
			await expect(checklist.locator(".impact-task-row")).toHaveCount(1);
			await expect(firstImpact).toBeVisible();
			await firstImpact.getByRole("button", { name: `${copy.reopen} · ${target.name} · ${purposeA}`, exact: true }).click();
			await expect(checklist.locator(".impact-task-row")).toHaveCount(0);
			await checklist.getByRole("button", { name: `${copy.all} · 2`, exact: true }).click();
			await expect(checklist.locator(".impact-task-row")).toHaveCount(2);
			await expect(firstImpact.getByText(copy.pending, { exact: true })).toBeVisible();
			await firstImpact.getByLabel(copy.remind, { exact: true }).fill("2030-12-01");
			await expect(firstImpact.getByLabel(copy.remind, { exact: true })).toBeEnabled();
			await page.reload();
			await expect(manual.getByLabel(copy.remind, { exact: true })).toHaveValue("2030-11-01");
			await expect(checklist.locator(".impact-task-row")).toHaveCount(2);
			await expect(checklist.getByRole("button", { name: `${copy.generate} · 0`, exact: true })).toBeDisabled();
			await expect(firstImpact.getByLabel(copy.remind, { exact: true })).toHaveValue("2030-12-01");
			await expect(firstImpact.getByText(copy.pending, { exact: true })).toBeVisible();
			await firstImpact.getByRole("link", { name: copy.viewTask, exact: true }).click();
			await expect(page).toHaveURL(/\/tasks#task-/);
			await expect(page.locator(".impact-task-row").filter({ hasText: purposeA })).toHaveCount(1);
			await page.goBack();
			await expect(page).toHaveURL(new RegExp(`${owner.href}$`));
			await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
			await assertGeometry(page);
			await screenshot(page, `account-detail-dedupe-media-tasks-${locale}-${width}`);
			await images.getByRole("button", { name: copy.removeImage, exact: true }).click();
			await expect(page.locator(".asset-image")).toHaveCount(0);
			await page.reload();
			await expect(page.locator(".asset-image")).toHaveCount(0);
			await expect(tasks.locator(".task-card")).toHaveCount(1);
			await expect(checklist.locator(".impact-task-row")).toHaveCount(2);
			expect(errors).toEqual([]);
		} finally { await context.close(); }
	});
}

async function syntheticPng(page: Page, color: string) {
	const encoded = await page.evaluate(fill => {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 8;
		const drawing = canvas.getContext("2d");
		if (!drawing) throw Error("Synthetic PNG canvas unavailable");
		drawing.fillStyle = fill;
		drawing.fillRect(0, 0, 8, 8);
		return canvas.toDataURL("image/png").split(",")[1];
	}, color);
	return Buffer.from(encoded, "base64");
}

async function renderedImageBytes(page: Page) {
	const image = page.locator("img.asset-image");
	await expect(image).toBeVisible();
	return image.evaluate(async element => {
		const image = element as HTMLImageElement;
		await image.decode();
		const response = await fetch(image.currentSrc);
		if (!response.ok) throw Error("Rendered synthetic image cannot be read");
		return [...new Uint8Array(await response.arrayBuffer())];
	});
}
