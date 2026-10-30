import { portableCandidate } from "./helpers/portable-candidate";
import { openBackupPage } from "./helpers/backup-restore";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { selectChoice } from "./helpers/select-choice";
import { openBackupRestorePanel } from "./helpers/backup-restore";
import { openVaultAccess } from "./helpers/vault-access";

test.beforeEach(async ({ page }, info) => {
 const candidate = portableCandidate();
 const actualIndex = createHash("sha256").update(await (await page.request.get("/")).body()).digest("hex");
 expect(actualIndex).toBe(candidate.release.webFiles.find((file: { path: string }) => file.path === "index.html")!.sha256);
 await info.attach("candidate", { body: JSON.stringify({ sourceCommit: candidate.release.sourceCommit, sourceDirty: candidate.release.sourceDirty, archiveSha256: candidate.archiveSha256, indexSha256: candidate.release.webFiles.find((file: { path: string }) => file.path === "index.html")!.sha256 }), contentType: "application/json" });
});
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

test("AI01 same-route global AI entry opens the AI channel", async ({ page }) => {
  await prepare(page); await page.goto("/intake"); await expect(page.locator(".intake-quick-card")).toBeVisible();
  await page.getByRole("button", { name: /^(New record|Add a record)$/ }).click();
  await page.getByRole("menuitem", { name: "Organize with AI", exact: true }).click();
  await expect(page.locator(".ai-import-panel")).toBeVisible();
  await page.getByRole("button", { name: "Local capture", exact: true }).click();
  await page.getByRole("button", { name: /^(New record|Add a record)$/ }).click();
  await page.getByRole("menuitem", { name: "Organize with AI", exact: true }).click();
  await expect(page.locator(".ai-import-panel")).toBeVisible();
});

test("UX02 UX03 manual account name survives vault setup and cancellation", async ({ page }) => {
  await prepare(page); await page.goto("/intake");
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await page.locator("#intake-manual-name").fill("Synthetic carried account");
  await selectChoice(page.locator("#intake-manual-kind"), "account");
  await page.locator(".intake-quick-card").getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page).toHaveURL(/\/accounts#new-account$/);
  await openVaultAccess(page);
  await page.locator("#password-vault-master").fill("Synthetic account setup 2026!");
  await page.locator("#password-vault-master-confirm").fill("Synthetic account setup 2026!");
  await page.locator(".unified-vault-access").getByRole("button", { name: "Set up and continue", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("#password-vault-entry-title")).toHaveValue("Synthetic carried account");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden(); await page.reload(); await expect(dialog).toBeHidden();
  await expect(page.getByText("Synthetic carried account", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add a record", exact: true }).click();
  await page.getByRole("menuitem", { name: "Account", exact: true }).click();
  await expect(dialog.locator("#password-vault-entry-title")).toHaveValue("");
  await dialog.locator("#password-vault-entry-title").fill("Synthetic saved account");
  await dialog.locator("#password-vault-entry-username").fill("synthetic@example.test");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden(); await page.reload();
  await expect(page.getByText("Synthetic saved account", { exact: true })).toBeVisible();
});

test("UX04 sample backup rejects wrong passwords, supports cancellation and restores images and relations", async ({ page, browser }) => {
  await prepare(page); await sample(page); await page.goto("/backup");
  const password = "Synthetic-Backup-2026!";
  await openBackupPage(page); await page.locator("#backup-password").fill(password); await page.getByRole("button", { name: "Create backup", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("link", { name: "Save backup file", exact: true }).click();
  const file = test.info().outputPath("synthetic.ka1"); await (await download).saveAs(file);
  const context = await browser.newContext(); const restored = await context.newPage();
  try {
    await prepare(restored); await restored.goto("/backup"); await openBackupRestorePanel(restored);
    await openBackupPage(restored); await restored.locator("#backup-password").fill("Synthetic-Wrong-Password!"); await restored.locator("#restore-file").setInputFiles(file);
    await restored.getByRole("button", { name: "Preview", exact: true }).click(); await expect(restored.getByText("Incorrect password or damaged backup.", { exact: true })).toBeVisible();
    await openBackupPage(restored); await restored.locator("#backup-password").fill(password); await restored.getByRole("button", { name: "Preview", exact: true }).click();
    const confirm = restored.getByRole("button", { name: /^Confirm ·/ }); await expect(confirm).toBeVisible();
    await restored.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(confirm).toBeHidden();
    await restored.getByRole("button", { name: "Preview", exact: true }).click(); await confirm.click();
    await expect(restored.getByText(/^Restored \d+ records/).first()).toBeVisible();
    await restored.goto("/"); await expect(restored.locator(".overview-project-card")).toHaveCount(4); await restored.reload(); await expect(restored.locator(".overview-project-card")).toHaveCount(4);
    await restored.locator(".overview-project-card").filter({ hasText: "Pinecone Studio" }).click();
    const graph = restored.locator("#account-relations"); await graph.locator(":scope > summary").click(); await expect(graph.locator(".react-flow")).toBeVisible();
    const media = restored.locator(".asset-project-media-disclosure"); await media.locator(":scope > summary").click(); await expect(media.locator("img").first()).toBeVisible();
  } finally { await context.close(); }
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
    await page.getByRole("button", { name: language === "en" ? "Organize with AI" : "AI 整理", exact: true }).hover(); await capture(page, `${language}-${width}-capture-hover`);
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
    await page.locator(".asset-project-action-bar").getByRole("button", { name: language === "en" ? "More actions" : "更多操作", exact: true }).click(); await capture(page, `${language}-${width}-project-menu`); await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: language === "en" ? "Add a record" : "新增资料", exact: true }).click();
    await capture(page, `${language}-${width}-global-menu`);
    await page.getByRole("menuitem", { name: language === "en" ? "Project" : "项目", exact: true }).click();
    const form = page.getByRole("dialog");
    await form.locator("#name").fill(language === "en" ? "Minimal synthetic project" : "极简虚构项目");
    await form.getByRole("button", { name: language === "en" ? "Save" : "保存", exact: true }).click();
    await expect(form).toBeHidden();
    await page.locator(".asset-project-card").filter({ hasText: language === "en" ? "Minimal synthetic project" : "极简虚构项目" }).first().click();
    await expect(page.locator(".asset-project-profile-card")).toBeVisible();
    await capture(page, `${language}-${width}-project-minimal`);
    await page.locator(".asset-project-action-bar").getByRole("button", { name: language === "en" ? "Edit" : "编辑", exact: true }).click();
    await form.locator("#name").fill((language === "en" ? "Long synthetic project name " : "较长的虚构项目名称").repeat(4));
    await form.locator("#notes").fill((language === "en" ? "Long synthetic notes, kept for checking wrapping and readable content. " : "用于检查换行和阅读体验的虚构长备注内容。").repeat(10));
    await capture(page, `${language}-${width}-project-long-edit`);
    await form.getByRole("button", { name: language === "en" ? "Save" : "保存", exact: true }).click();
    await expect(form).toBeHidden(); await capture(page, `${language}-${width}-project-long`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
