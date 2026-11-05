import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { newAsset, taskSchema } from "../../packages/domain/src";
import { resources } from "../../apps/web/src/i18n";
import { acceptanceCandidate } from "./helpers/acceptance-candidate";
import { prepareCompletionArchive, restoreCompletionArchive } from "./helpers/completion-archive";
import { importVisualKdbxEntries } from "./fixtures/password-smart-import-visual";
import { openAccountOption } from "./helpers/account-options";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/overview-approved";
const directory = resolve(evidence, "fixture"), password = "FictionalOverview2026!";
test.use({ serviceWorkers: "block" }); // Explicit network-fault tests must not be satisfied by a PWA cache.
const t = (locale: "zh-CN" | "en") => (key: string) => (resources[locale].translation as Record<string, string>)[key] ?? key;
const identity = () => acceptanceCandidate().release.webFiles.find(file => file.path === "index.html")!.sha256;
test.beforeAll(async () => {
 await prepareCompletionArchive(directory, password, async repo => {
  const category = await repo.saveCatalogCategory(null, { name: "家庭资料 / Family records" });
  const row = (id: string, kind: "project" | "account" | "item" | "subscription", name: string, extra = {}) => ({ ...newAsset(kind), id, name, ...extra });
  const rows = [
   row("ov-mail", "account", "个人邮箱 / Personal mail"), row("ov-shop", "account", "购物账号 / Shopping login"),
   row("ov-video", "account", "视频账号 / Video login"), row("ov-apple", "account", "音乐账号 / Music login"),
   row("ov-gpt", "account", "学习账号 / Learning login"),
   row("ov-two", "subscription", "Music plan / 音乐订阅", { dueDate: "2026-11-07", billingAnchor: "2026-11-07" }),
   row("ov-three", "subscription", "Learning plan / 学习订阅", { dueDate: "2026-11-08", billingAnchor: "2026-11-08" }),
   row("ov-seven", "subscription", "Video plan / 视频订阅", { dueDate: "2026-11-12", billingAnchor: "2026-11-12" }),
   row("ov-old", "subscription", "Overdue plan / 逾期订阅", { dueDate: "2026-11-04", billingAnchor: "2026-11-04" }),
   row("ov-cancelled", "subscription", "Cancelled / 已取消", { status: "cancelled" as const, dueDate: "2026-11-06", billingAnchor: "2026-11-06" }),
   row("ov-camera", "item", "随身相机 / Camera", { warrantyDate: "2027-02-05", notes: "Long notes ".repeat(100) }),
   row("ov-laptop", "item", "笔记本电脑 / Laptop"), row("ov-air", "item", "空气净化器 / Air cleaner"),
   row("ov-receipt", "project", "购买凭证 / Receipt", { catalogCategoryId: category.id }),
   row("ov-warranty", "project", "保修资料 / Warranty record", { catalogCategoryId: category.id }),
   row("ov-long", "project", "资料名称很长 / Long personal record ".repeat(6).slice(0, 160), { catalogCategoryId: category.id, url: "https://example.test/" + "long/".repeat(60), description: "Personal notes ".repeat(60) }),
   row("ov-isolated", "project", "极简孤立资料 / Isolated minimal", { catalogCategoryId: category.id }),
   row("ov-undated", "subscription", "Undated / 未设日期"),
  ];
  for (const asset of rows) await repo.save("asset", asset);
  const pairs = [["ov-shop", "ov-mail"], ["ov-video", "ov-mail"], ["ov-apple", "ov-mail"], ["ov-gpt", "ov-mail"], ["ov-two", "ov-apple"], ["ov-three", "ov-gpt"], ["ov-seven", "ov-video"], ["ov-camera", "ov-shop"], ["ov-receipt", "ov-camera"], ["ov-warranty", "ov-camera"], ["ov-laptop", "ov-air"], ["ov-long", "ov-laptop"]];
  for (const [from, to] of pairs) await repo.save("relation", { id: `${from}-${to}`, from, to, label: "显式关联 / Saved connection", createdAt: "2026-01-01T00:00:00Z", verifiedAt: "", deleted: false });
  for (const task of [taskSchema.parse({ id: "ov-today", name: "Today task / 今日事项", dueDate: "2026-11-05", createdAt: "" }), taskSchema.parse({ id: "ov-done", name: "Completed / 已完成", dueDate: "2026-11-06", done: true, createdAt: "" })]) await repo.save("task", task);
  return { rows: rows.map(asset => asset.id), connections: pairs.length };
 });
});
async function start(page: Page, locale: "zh-CN" | "en", clockMode: "timers" | "date" = "timers") {
 await page.addInitScript(lang => localStorage.setItem("keepany-language", lang), locale);
 if (clockMode === "timers") await page.clock.install({ time: new Date("2026-11-05T04:00:00Z") });
 else await page.clock.setFixedTime(new Date("2026-11-05T04:00:00Z"));
 await page.goto("/");
 await expect(page.locator(".overview-stats")).toBeVisible();
 expect(createHash("sha256").update(await (await page.request.get("/")).body()).digest("hex")).toBe(identity());
}
async function populated(page: Page) {
 await restoreCompletionArchive(page, password, resolve(directory, "fixture.ka1"));
 // Return through the visible navigation, retaining the local session.
 if (await page.locator(".mobile-menu").isVisible()) await page.locator(".mobile-menu").click();
 await page.locator('.sidebar nav a[href="/"]').click();
 await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();
 await expect(page.locator(".react-flow__node")).toHaveCount(18);
 await expect(page.locator(".react-flow__edge-path")).toHaveCount(12);
}
for (const locale of ["zh-CN", "en"] as const) {
 test(`${locale} OV02 OV05 OV07 single record save cancel error and midnight`, async ({ page }, info) => {
  const text = t(locale); await start(page, locale);
  await page.locator(".overview-graph-empty a").click();
  const dialog = page.getByRole("dialog"); await expect(dialog.locator("#catalog-record-name")).toBeVisible();
  await dialog.locator("#catalog-record-name").fill("Cancelled fictional record");
  await dialog.getByRole("button", { name: text("cancel"), exact: true }).click();
  await page.locator('.sidebar nav a[href="/"]').click(); await expect(page.locator(".overview-graph-empty")).toBeVisible();
  await page.locator(".overview-graph-empty a").click(); await dialog.getByRole("button", { name: text("save"), exact: true }).click();
  await expect(dialog.locator("#catalog-record-name")).toHaveAttribute("aria-invalid", "true");
  await page.screenshot({ path: info.outputPath("validation-error.png"), fullPage: false });
  await dialog.locator("#catalog-record-name").fill("Single fictional record / 单条资料");
  await dialog.locator("#catalog-record-date").fill("2026-11-06"); await dialog.locator("#catalog-record-name").click();
  await dialog.getByRole("button", { name: text("save"), exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.locator('.sidebar nav a[href="/"]').click(); await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(1); await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await expect(page.locator(".overview-action-date")).toContainText(locale === "zh-CN" ? "剩余 1 天" : "1 day");
  await page.screenshot({ path: info.outputPath("single.png"), fullPage: false });
  // Reset near local midnight, dispatch the ordinary focus update, then let its timer fire.
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await page.clock.setSystemTime(await page.evaluate(() => new Date(2026, 10, 5, 23, 59, 59, 900).getTime())); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.clock.runFor(250); await expect(page.locator(".overview-action-date")).toContainText(text("workspaceDueToday"));
  await page.reload(); await expect(page.locator(".react-flow__node")).toHaveCount(1); await expect(page.locator(".overview-action-row")).toContainText("Single fictional record");
  await info.attach("contract-results.json", { body: JSON.stringify({ ids: ["OV02", "OV05", "OV07"], timeZone: zone, candidate: identity(), result: "passed" }), contentType: "application/json" });
 });
 test(`${locale} OV08 graph loading and resource error`, async ({ page }, info) => {
  const text = t(locale); let release: () => void = () => {}, intercepted = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/account-family-graph-view-.*\.js$/, async route => { intercepted++; await gate; await route.abort("failed"); });
  await start(page, locale);
  await restoreCompletionArchive(page, password, resolve(directory, "fixture.ka1"));
  await page.locator('.sidebar nav a[href="/"]').click();
  await expect.poll(() => intercepted).toBe(1);
  await expect(page.locator(".overview-graph-panel [role=status]")).toContainText(text("loading"));
  await page.screenshot({ path: info.outputPath("graph-loading.png"), fullPage: false });
  release();
  await expect(page.locator(".route-load-error")).toBeVisible();
  await page.screenshot({ path: info.outputPath("graph-load-error.png"), fullPage: false });
  await page.unroute(/account-family-graph-view-.*\.js$/);
  await page.getByRole("button", { name: text("pageLoadErrorReload"), exact: true }).click();
  await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(18);
  await info.attach("contract-results.json", { body: JSON.stringify({ ids: ["OV08"], injected: "compiled graph chunk blocked, then aborted; no data writes", candidate: identity(), result: "passed" }), contentType: "application/json" });
 });
 test(`${locale} OV01-07 compiled overview journeys and privacy`, async ({ page }, info) => {
  const text = t(locale), errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await start(page, locale);
  await expect(page.locator(".overview-hero,.overview-project-grid")).toHaveCount(0);
  await expect(page.locator('.sidebar nav a[href="/tasks"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("empty.png"), fullPage: false });
  await populated(page);
  const upcoming = page.locator(".overview-panels > section").first();
  await expect(upcoming.locator(".overview-action-copy strong")).toHaveText(["Today task / 今日事项", "Music plan / 音乐订阅", "Learning plan / 学习订阅"]);
  await expect(upcoming).toContainText(text("workspaceDueToday"));
  await expect(upcoming).not.toContainText("Cancelled"); await expect(upcoming).not.toContainText("Completed");
  await upcoming.getByRole("button", { name: text("viewAll"), exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Video plan");
  await expect(page.getByRole("dialog")).not.toContainText("Overdue plan");
  await page.getByRole("dialog").locator("header").getByRole("button", { name: text("close"), exact: true }).click();
  await upcoming.locator(".overview-countdown-footer button").click();
  await expect(page.getByRole("dialog").locator(".overview-action-row")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toContainText("Overdue plan"); await page.keyboard.press("Escape");
  const zoom = page.locator(".react-flow__viewport"), original = await zoom.getAttribute("style");
  await page.getByRole("button", { name: text("accountGraphZoomIn"), exact: true }).click(); await expect(zoom).not.toHaveAttribute("style", original!);
  await page.getByRole("button", { name: text("accountGraphFit"), exact: true }).click();
  await page.getByRole("button", { name: text("accountGraphExpand"), exact: true }).click();
  await expect(page.getByRole("dialog").locator('[data-layout-ready="true"]')).toBeVisible();
  await page.screenshot({ path: info.outputPath("fullscreen.png"), fullPage: false });
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator('.sidebar nav a[href="/accounts"]').click();
  await page.locator("#password-vault-master").fill(password); await page.locator("#password-vault-master-confirm").fill(password);
  await page.getByRole("button", { name: text("accountSetUp"), exact: true }).click(); await expect(page.locator(".account-toolbar-actions")).toBeVisible();
  await page.locator('.sidebar nav a[href="/"]').click(); await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();
  await page.locator('.react-flow__node[data-id="ov-shop"] a').focus(); await page.keyboard.press("Enter");
  await expect(page.locator("main.asset-detail-account")).toBeVisible();
  // Original account graph is family-scoped, and remains smaller than the total graph.
  await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();
  expect(await page.locator(".react-flow__node").count()).toBeLessThan(18);
  await page.locator(".react-flow__edge").first().focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".account-graph-selection-panel")).toBeVisible();
  await page.screenshot({ path: info.outputPath("ordinary-detail-selected.png"), fullPage: false });
  await page.locator('.sidebar nav a[href="/accounts"]').click(); await expect(page.locator(".account-toolbar-actions")).toBeVisible();
  await importVisualKdbxEntries(page, text, [{ title: "Private isolated / 私密独立", username: "private@example.test", password: "SyntheticOverviewSecret!", notes: "PRIVATE-NOTES-NEVER-IN-GRAPH", linkedAssetIds: ["ov-air"] }, { title: "Mixed private login / 混合关联登录", username: "mixed@example.test", password: "SyntheticMixed!", linkedAssetIds: ["ov-mail", "ov-camera"] }]);
  await page.locator('.sidebar nav a[href="/"]').click(); await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();
  await expect(page.locator(".react-flow__node")).toHaveCount(20);
  await expect(page.locator('.react-flow__edge[data-to="ov-camera"][data-from^="login-"]')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge[data-to="ov-mail"][data-from^="login-"]')).toHaveCount(1);
  await expect(page.locator(".overview-page")).toContainText("Private isolated"); await expect(page.locator(".overview-page")).not.toContainText(/SyntheticOverviewSecret|PRIVATE-NOTES|private@example/);
  await page.locator(".react-flow__node").filter({ hasText: "Private isolated" }).locator("a").click();
  await expect(page.locator("main.asset-detail-account")).toBeVisible();
  await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();
  await page.locator(".react-flow__edge").first().focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".account-graph-selection-panel")).toBeVisible();
  await page.screenshot({ path: info.outputPath("private-detail-selected.png"), fullPage: false });
  await page.goto("/accounts"); await page.locator("#password-vault-unlock-master").fill(password); await page.getByRole("button", { name: text("accountUnlockAction"), exact: true }).click();
  await page.locator('.sidebar nav a[href="/"]').click(); await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();
  // The standard inactivity lock must also remove private nodes from an open fullscreen portal.
  await page.getByRole("button", { name: text("accountGraphExpand"), exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible();
  await page.clock.fastForward(16 * 60_000); await expect(page.locator("body")).not.toContainText("Private isolated"); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(18);
  await page.clock.setSystemTime(new Date("2026-11-06T04:00:00Z")); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(upcoming).not.toContainText("Today task");
  await expect(upcoming.locator(".overview-action-date").first()).toContainText(locale === "zh-CN" ? "剩余 1 天" : "1 day");
  await page.reload(); await expect(page.locator('[data-layout-ready="true"]')).toBeVisible(); await expect(page.locator(".react-flow__node")).toHaveCount(18);
  await expect(page.locator(".overview-page")).not.toContainText("Private isolated"); expect(errors).toEqual([]);
  await info.attach("contract-results.json", { body: JSON.stringify({ ids: ["OV01", "OV02", "OV03", "OV04", "OV05", "OV06", "OV07", "OV09"], candidate: identity(), result: "passed" }), contentType: "application/json" });
 });
 for (const width of [390, 768, 1280, 1920, 2262]) test(`${locale} ${width} OV08 responsive overview states`, async ({ page }, info) => {
  const text = t(locale); await page.setViewportSize({ width, height: 1000 }); await start(page, locale, "date");
  await page.screenshot({ path: info.outputPath("empty.png"), fullPage: false }); await populated(page);
  // Keep the original feedback evidence in prior runs; stable layout checks wait for
  // the existing notification timeout so it cannot cover the countdown content.
  await expect(page.locator(".toast")).toHaveCount(0, { timeout: 10_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Edge positions settle one paint after node measurement; inspect first-visit selection too.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: info.outputPath("populated.png"), fullPage: false });
  // React Flow reacts to viewport changes. Full-page capture perturbs its ResizeObserver
  // during capture, so keep the real viewport and inspect the bottom by ordinary scrolling.
  await page.locator(".overview-footer").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("countdown.png"), fullPage: false });
  await page.locator(".overview-stats").scrollIntoViewIfNeeded();
  await page.locator(".react-flow__edge").first().focus(); await page.keyboard.press("Enter");
  const selection = page.locator(".account-graph-selection-panel"); await expect(selection).toBeVisible();
  expect(await selection.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  await page.screenshot({ path: info.outputPath("edge-selected-first-visit.png"), fullPage: false });
  await selection.getByRole("button", { name: text("close"), exact: true }).click();
  const link = page.locator(".overview-action-row").first(); await link.hover(); await page.screenshot({ path: info.outputPath("hover.png"), fullPage: false });
  const box = (await link.boundingBox())!; await page.mouse.move(box.x + 15, box.y + 15); await page.mouse.down();
  await page.screenshot({ path: info.outputPath("pressed.png"), fullPage: false }); await page.mouse.move(0, 0); await page.mouse.up();
  await link.focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  expect(await link.evaluate(node => node.matches(":focus-visible"))).toBe(true);
  await page.screenshot({ path: info.outputPath("focus.png"), fullPage: false });
  await page.locator(".overview-countdown-footer button").click(); await page.screenshot({ path: info.outputPath("overdue.png"), fullPage: false });
  await page.keyboard.press("Escape"); await page.getByRole("button", { name: text("accountGraphExpand"), exact: true }).click();
  await expect(page.getByRole("dialog").locator('[data-layout-ready="true"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("fullscreen.png"), fullPage: false }); await page.keyboard.press("Escape");
  await info.attach("contract-results.json", { body: JSON.stringify({ ids: ["OV08"], locale, width, screenshots: ["empty", "populated", "countdown", "hover", "pressed", "focus", "overdue", "fullscreen", "edge-selected-first-visit"].map(name=>info.outputPath(`${name}.png`)), candidate: identity(), result: "passed" }), contentType: "application/json" });
 });
}
