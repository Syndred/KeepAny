import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";

const shots = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/cleanup-ux/evidence";
async function prepare(page: Page, lang = "en") { await page.addInitScript(language => localStorage.setItem("keepany-language", language), lang); await page.goto("/"); await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); }
async function sample(page: Page, lang = "en") {
  await page.getByRole("button", { name: lang === "en" ? "Start with sample records" : "用示例资料开始", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: lang === "en" ? "Add sample records" : "加入示例资料", exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(page.locator(".overview-project-card")).toHaveCount(4);
}
async function capture(page: Page, name: string) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: `${shots}/${name}.png` }); }

test("UX01 local capture and AI stay independently reachable; backup has its own entry", async ({ page }) => {
  await prepare(page); await page.goto("/intake");
  await expect(page.locator(".intake-quick-card")).toBeVisible(); await expect(page.locator(".ai-import-panel")).toBeHidden();
  await page.locator("#import-url").fill("https://draft.example.com");
  await page.getByRole("button", { name: "Organize with AI", exact: true }).click();
  await expect(page.locator(".ai-import-panel")).toBeVisible(); await expect(page.locator("#ai-import-text")).toBeVisible();
  await page.locator("#ai-import-text").fill("A synthetic input draft");
  await page.getByRole("button", { name: "Local capture", exact: true }).click(); await expect(page.locator("#import-url")).toHaveValue("https://draft.example.com");
  await page.getByRole("button", { name: "Organize with AI", exact: true }).click(); await expect(page.locator("#ai-import-text")).toHaveValue("A synthetic input draft");
  await page.getByRole("link", { name: "Backup & restore", exact: true }).first().click(); await expect(page).toHaveURL(/\/backup$/); await expect(page.locator("#backup-password")).toBeVisible();
});

test("UX02 direct manual save keeps input on duplicates and survives reload", async ({ page }) => {
  await prepare(page); await page.goto("/intake"); await page.getByRole("button", { name: "Manual", exact: true }).click();
  await page.locator("#intake-manual-name").fill("Synthetic direct project");
  await page.locator(".intake-quick-card").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open saved record" })).toBeVisible();
  await page.locator("#intake-manual-name").fill("Synthetic direct project"); await page.locator(".intake-quick-card").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("#intake-manual-name")).toHaveValue("Synthetic direct project");
  await expect(page.locator(".intake-recent a").filter({ hasText: "Synthetic direct project" })).toHaveCount(1);
  // The duplicate failure must not erase the link to the successfully saved record.
  await page.locator(".intake-recent a").filter({ hasText: "Synthetic direct project" }).click(); await page.reload();
  await expect(page.getByRole("heading", { name: "Synthetic direct project", exact: true })).toBeVisible();
});

test("UX03 context creation and cancellation consume the hash without reopening", async ({ page }) => {
  await prepare(page); await page.getByRole("button", { name: "Add a record", exact: true }).click();
  await page.getByRole("menuitem", { name: "Project", exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible(); await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden(); await page.reload(); await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Add a record", exact: true }).click(); await page.getByRole("menuitem", { name: "Project", exact: true }).click(); await expect(page.getByRole("dialog")).toBeVisible();
});

test("UX06 UX07 UX08 sample cancel is safe, inactive filters remain discoverable and task defaults focus pending", async ({ page }) => {
  await prepare(page); await page.getByRole("button", { name: "Start with sample records", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click(); await expect(page.locator(".overview-project-card")).toHaveCount(0);
  await sample(page); await page.goto("/assets"); await expect(page.getByText("Sample | Paused media library", { exact: true })).toBeHidden();
  await selectChoice(page.getByLabel("Records to show"), "all"); await expect(page.locator(".asset-list-content")).toContainText("Paused");
  await page.goto("/tasks"); await expect(page.getByRole("button", { name: /^Pending ·/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^All ·/ }).click(); await page.reload(); await expect(page.getByRole("button", { name: /^All ·/ })).toHaveAttribute("aria-pressed", "true");
});

for (const language of ["zh-CN", "en"] as const) for (const width of [390, 768, 1280, 1920, 2560]) {
  test(`VR01 ${language} ${width} local AI backup menus and expanded project`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await prepare(page, language); await sample(page, language);
    await page.goto("/intake"); await expect(page.locator(".intake-quick-card")).toBeVisible();
    await page.getByRole("button", { name: language === "en" ? "Local capture" : "本地收录", exact: true }).focus(); await capture(page, `${language}-${width}-capture-focus`);
    await page.getByRole("button", { name: language === "en" ? "Organize with AI" : "AI 整理", exact: true }).click(); await page.locator("#ai-import-text").fill("Synthetic review input");
    await capture(page, `${language}-${width}-ai-disabled`);
    await page.goto("/backup"); await expect(page.locator("#backup-password")).toBeVisible(); await capture(page, `${language}-${width}-backup`);
    await page.goto("/"); await page.locator(".overview-project-card").filter({ hasText: language === "en" ? "Pinecone Studio" : "松果工作室" }).click(); await expect(page.locator(".asset-project-profile-card")).toBeVisible();
    await capture(page, `${language}-${width}-project-collapsed`);
    const graph = page.locator("#account-relations"); await graph.locator(":scope > summary").click(); await expect(graph.locator(".react-flow")).toBeVisible();
    await graph.scrollIntoViewIfNeeded(); await capture(page, `${language}-${width}-project-graph`);
    await expect(page.locator(".asset-project-facts")).not.toContainText(language === "en" ? "comma separated" : "逗号分隔");
    const media = page.locator(".asset-project-media-disclosure"); await media.locator(":scope > summary").click(); await media.scrollIntoViewIfNeeded(); await capture(page, `${language}-${width}-project-media`);
    await page.getByRole("button", { name: language === "en" ? "More actions" : "更多操作", exact: true }).click(); await capture(page, `${language}-${width}-project-menu`); await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
