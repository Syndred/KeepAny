import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { newAsset } from "../../packages/domain/src";
import { readCandidate, selectCandidate } from "../../scripts/lib/portable-candidate.mjs";
import { importVisualKdbxEntries } from "./fixtures/password-smart-import-visual";
import { prepareCompletionArchive, recordDevelopmentRequests, restoreCompletionArchive } from "./helpers/completion-archive";
import { selectChoice } from "./helpers/select-choice";
import { enterAccounts } from "./helpers/vault-access";

type Locale = "zh-CN" | "en";
const master = "Synthetic account batch master!2026";
const backupPassword = "Synthetic account batch backup!2026";
const names = {
 work: "North Bay · Work",
 personal: "North Bay · Personal",
 unrelated: "Island Mail",
 private: "Private Pine",
 linked: "Fictional linked workspace",
 long: `Very long fictional account ${"name ".repeat(25).trim()}`,
};
const duplicate = "duplicate@example.test";
const cards = ".compact-account-card";
const row = ".account-batch-preview > li";
const toolbar = ".account-list-toolbar";
let fixture: string | undefined;

function copy(locale: Locale) {
 const messages = resources[locale].translation as Record<string, string>;
 const plural = new Intl.PluralRules(locale);
 return (key: string, values: Record<string, number> = {}) => {
  const form = values.count === undefined ? undefined : messages[`${key}_${plural.select(values.count)}`];
  return (form ?? messages[key] ?? key).replace(/\{\{(\w+)\}\}/g, (token, value: string) => String(values[value] ?? token));
 };
}
const card = (page: Page, name: string) =>
 page.locator(cards).filter({ has: page.getByText(name, { exact: true }) });
const dialog = (page: Page) => page.getByRole("dialog");
const topNav = (page: Page) => page.locator(".topbar");
const selection = (page: Page, name: string) => card(page, name).locator(".compact-account-select");

async function verifyCandidate(page: Page, info: TestInfo) {
 const localSHA = process.env.KEEPANY_ACCOUNT_BATCH_INDEX_SHA256;
 const candidate = localSHA ? { mode: "local-compiled", indexSha256: localSHA } : (() => {
  const { release, archiveSha256 } = readCandidate(selectCandidate());
  return {
   mode: "portable",
   indexSha256: release.webFiles.find(file => file.path === "index.html")?.sha256,
   sourceCommit: release.sourceCommit,
   sourceDirty: release.sourceDirty,
   archiveSha256,
  };
 })();
 const response = await page.request.get("/", { maxRedirects: 0 });
 expect(response.status()).toBe(200);
 expect(createHash("sha256").update(await response.body()).digest("hex")).toBe(candidate.indexSha256);
 const path = info.outputPath("candidate.json");
 writeFileSync(path, JSON.stringify({ ...candidate, url: response.url() }, null, 2));
 await info.attach("candidate", { path, contentType: "application/json" });
}

async function start(page: Page, locale: Locale, info: TestInfo) {
 await verifyCandidate(page, info);
 await page.addInitScript(language => localStorage.setItem("keepany-language", language), locale);
 await page.goto("/");
}

async function navigate(page: Page, path: "/accounts" | "/trash") {
 const mobileLink = page.locator(`.mobile-nav a[href="${path}"]`);
 if (await mobileLink.isVisible()) await mobileLink.click();
 else {
  if (await page.locator(".mobile-menu").isVisible() && !(await page.locator(".sidebar.open").count())) await page.locator(".mobile-menu").click();
  await page.locator(`.sidebar a[href="${path}"]`).click();
 }
 await expect(page).toHaveURL(new RegExp(`${path}$`));
}

async function editLogin(page: Page, t: ReturnType<typeof copy>, name: string, notes: string) {
 await card(page, name).getByRole("button", { name: t("edit"), exact: true }).click();
 await dialog(page).locator("#password-vault-entry-password").fill(`Synthetic ${name}!`);
 await dialog(page).locator("#password-vault-entry-notes").fill(notes);
 await dialog(page).getByRole("button", { name: t("save"), exact: true }).click();
 await expect(dialog(page)).toBeHidden();
 await expect(card(page, name).locator("[data-login-notes]")).toHaveText(notes);
}

async function screenshot(page: Page, info: TestInfo, name: string) {
 const path = info.outputPath(`${name}.png`);
 await page.screenshot({ path, animations: "disabled" });
 await info.attach(name, { path, contentType: "image/png" });
}

async function stickyMatrix(page: Page, t: ReturnType<typeof copy>, info: TestInfo) {
 const metrics: unknown[] = [];
 for (const width of [390, 768, 1280, 1920]) {
  const height = width === 390 ? 650 : 720;
  await page.setViewportSize({ width, height });
  await page.evaluate(() => window.scrollTo(0, 0));
  const back = topNav(page).getByRole("link", { name: t("backToOverview"), exact: true });
  const toolbarBox = (await page.locator(toolbar).locator(".asset-category-toolbar").boundingBox())!;
  const left = (await back.boundingBox())!.x;
  const actions = (await topNav(page).locator(".top-actions").boundingBox())!;
  expect(Math.abs(left - toolbarBox.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(actions.x + actions.width - toolbarBox.x - toolbarBox.width)).toBeLessThanOrEqual(2);
  await page.mouse.move(width - 80, height - 100);
  await page.mouse.wheel(0, 730);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(200);
  const after = (await page.locator(toolbar).locator(".asset-category-toolbar").boundingBox())!;
  const shell = (await topNav(page).boundingBox())!;
  const batch = (await page.locator(".account-batch-bar").boundingBox())!;
  expect(shell.y).toBeGreaterThanOrEqual(-1);
  expect(shell.y).toBeLessThanOrEqual(12);
  expect(Math.abs(after.y - toolbarBox.y)).toBeLessThanOrEqual(2);
  expect(batch.y + batch.height).toBeLessThan(height);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  const minButtonHeight = await page.locator(".account-batch-bar button").evaluateAll(buttons =>
   Math.min(...buttons.map(button => button.getBoundingClientRect().height)));
  expect(minButtonHeight).toBeGreaterThanOrEqual(44);
  await screenshot(page, info, `AM06-${width}-scrolled`);
  metrics.push({ width, height, left, actionsRight: actions.x + actions.width, toolbarBox, after, shell, batch, minButtonHeight });
 }
 const path = info.outputPath("AM06-geometry.json");
 writeFileSync(path, JSON.stringify(metrics, null, 2));
 await info.attach("AM06 geometry", { path, contentType: "application/json" });
 await page.setViewportSize({ width: 1280, height: 800 });
 await page.evaluate(() => window.scrollTo(0, 0));
}

test.beforeAll(async () => {
 fixture = mkdtempSync(join(tmpdir(), "keepany-account-batch-"));
 await prepareCompletionArchive(fixture, backupPassword, async repository => {
  const profiles = [
   { ...newAsset("account"), name: names.work, username: duplicate, url: "https://work.example.test/" },
   { ...newAsset("account"), name: names.personal, username: duplicate, url: "https://personal.example.test/" },
   { ...newAsset("account"), name: names.unrelated, username: "unrelated@example.test" },
   { ...newAsset("account"), name: names.long, username: "long@example.test", notes: "Fictional notes ".repeat(120) },
   ...Array.from({ length: 30 }, (_, index) => ({ ...newAsset("account"), name: `Example filler ${index + 1}` })),
  ];
  for (const profile of profiles) await repository.save("asset", profile);
  const linked = { ...newAsset("project"), name: names.linked };
  await repository.save("asset", linked);
  await repository.save("relation", { id: crypto.randomUUID(), from: profiles[0].id, to: linked.id, label: "Fictional owner", createdAt: new Date().toISOString() });
  return { profiles: profiles.length };
 });
});

test.afterAll(() => {
 if (fixture) rmSync(fixture, { force: true, recursive: true });
});

test("AM01 empty and single card via normal add, detail and select", async ({ page }, info) => {
 const t = copy("zh-CN");
 await start(page, "zh-CN", info);
 await navigate(page, "/accounts");
 await enterAccounts(page, "zh-CN", master);
 const tools = page.locator(".account-toolbar-actions");
 const select = tools.getByRole("button", { name: t("accountBatchSelect"), exact: true });
 await expect(select).toBeDisabled();
 await expect(tools.locator("button").nth(0)).toHaveText(t("add"));
 await expect(tools.locator("button").nth(1)).toHaveText(t("accountBatchSelect"));

 await tools.getByRole("button", { name: t("add"), exact: true }).click();
 await dialog(page).locator("#password-vault-entry-title").fill("Solo example");
 await dialog(page).getByRole("button", { name: t("save"), exact: true }).click();
 await expect(page).toHaveURL(/\/assets\/account\//);
 await topNav(page).getByRole("link", { name: t("accountBack"), exact: true }).click();
 await expect(card(page, "Solo example").getByRole("link", { name: "Solo example", exact: true })).toBeVisible();
 await select.click();
 await selection(page, "Solo example").press("Space");
 await expect(page.locator(".account-batch-bar").getByRole("status")).toHaveText(t("accountBatchSelectedOne"));
 await expect(page.locator(".account-batch-bar").getByRole("button", { name: t("accountBatchMerge"), exact: true })).toBeDisabled();
 await expect(page.locator(".account-batch-bar").getByRole("button", { name: t("accountDetailDelete"), exact: true })).toBeEnabled();
 await selection(page, "Solo example").press("Escape");
 await expect(select).toBeFocused();
 await card(page, "Solo example").getByRole("link", { name: "Solo example", exact: true }).click();
 await expect(page).toHaveURL(/\/assets\/account\//);
});

for (const locale of ["zh-CN", "en"] as const) {
 test(`${locale} AM01 AM02 AM03 AM04 AM05 AM06 account batch lifecycle`, async ({ page, context }, info) => {
  const t = copy(locale);
  const dev = recordDevelopmentRequests(context);
  await start(page, locale, info);
  await restoreCompletionArchive(page, backupPassword, join(fixture!, "fixture.ka1"));
  await navigate(page, "/accounts");
  await enterAccounts(page, locale, master);
  await editLogin(page, t, names.work, "Work note before update");
  await editLogin(page, t, names.work, "Work note after update");
  await editLogin(page, t, names.personal, "Personal note");
  await importVisualKdbxEntries(page, t, [{ title: names.private, username: "private@example.test", password: "Synthetic private!", notes: "Private note" }]);
  await expect(card(page, names.private)).toHaveAttribute("data-private-only", "true");

  const select = page.locator(".account-batch-toggle");
  const bar = page.locator(".account-batch-bar");
  const count = bar.getByRole("status");
  const merge = bar.getByRole("button", { name: t("accountBatchMerge"), exact: true });
  const remove = bar.getByRole("button", { name: t("accountDetailDelete"), exact: true });
  const search = page.locator(".asset-account-search input");

  await expect(select).toHaveText(t("accountBatchSelect"));
  await select.click();
  await expect(count).toHaveText(t("accountBatchSelected", { count: 0 }));
  await expect(merge).toBeDisabled();
  await expect(remove).toBeDisabled();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await selection(page, names.work).press("Space");
  await expect(selection(page, names.work)).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, names.work).locator("[inert]")).toBeAttached();
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest("[inert]"))).toBe(false);
  await page.keyboard.press("Tab");
  await expect(selection(page, names.work)).toBeFocused();
  await selection(page, names.work).press("Enter");
  await expect(selection(page, names.work)).toHaveAttribute("aria-pressed", "false");
  await selection(page, names.work).click({ position: { x: 8, y: 8 } });
  await selection(page, names.personal).click();
  await expect(count).toHaveText(t("accountBatchSelected", { count: 2 }));

  await search.fill(names.work);
  await expect(card(page, names.personal)).toHaveCount(0);
  await expect(count).toContainText(t("accountBatchHidden", { count: 1 }));
  await remove.click();
  await expect(dialog(page).getByRole("heading", { name: t("accountBatchDeleteTitle", { count: 2 }), exact: true })).toBeVisible();
  await expect(dialog(page).locator(row).locator("strong")).toHaveText([names.work, names.personal]);
  await dialog(page).getByRole("button", { name: t("cancel"), exact: true }).click();
  await expect(remove).toBeFocused();
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(count).toHaveText(t("accountBatchSelected", { count: 2 }));

  await stickyMatrix(page, t, info);
  const mergeResult = page.locator(".account-list-toolbar .account-merge-result");
  await merge.click();
  await dialog(page).getByRole("button", { name: t("cancel"), exact: true }).click();
  await expect(mergeResult).toHaveCount(0);
  await merge.click();
  await expect(dialog(page).getByRole("heading", { name: t("accountBatchMergeTitle", { count: 2 }), exact: true })).toBeVisible();
  const defaultTrigger = dialog(page).locator(".account-batch-default .themed-select-trigger");
  await selectChoice(defaultTrigger, { label: `${names.personal} · ${duplicate}` });
  await expect(dialog(page).locator(row).filter({ hasText: names.personal }).locator(".badge")).toHaveText(t("accountDefaultAction"));
  await screenshot(page, info, "AM05-merge-review");
  await dialog(page).getByRole("button", { name: t("accountBatchConfirmMerge"), exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(select).toHaveText(t("accountBatchSelect"));
  await expect(card(page, names.work)).toHaveCount(0);
  await expect(card(page, names.personal).locator("[data-login-notes]")).toHaveText("Personal note");
  await expect(mergeResult.getByRole("status")).toHaveText(t("accountBatchMergeDone", { count: 2 }));
  // Regress the previous transient toast, which cleared at 4.5 seconds.
  await page.waitForTimeout(4800);
  for (const width of [390, 768, 1280, 1920]) {
   await page.setViewportSize({ width, height: 520 });
   await expect(mergeResult).toBeInViewport();
   await expect(mergeResult.getByRole("button", { name: t("close"), exact: true })).toBeInViewport();
   await screenshot(page, info, `AM05-merge-result-${width}`);
  }
  if (locale === "zh-CN") {
   await mergeResult.getByRole("button", { name: t("close"), exact: true }).click();
   await expect(select).toBeFocused();
  } else await select.click();
  await expect(mergeResult).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.reload();
  await enterAccounts(page, locale, master);
  await expect(card(page, names.personal).locator("[data-login-username]")).toHaveText(duplicate);
  await card(page, names.personal).locator("[data-account-switch]").click();
  await expect(card(page, names.work).locator("[data-login-username]")).toHaveText(duplicate);
  await expect(card(page, names.work).locator("[data-login-notes]")).toHaveText("Work note after update");
  await expect(card(page, names.work).locator(".compact-account-associations")).toContainText(t("accountConnectionCount", { count: 1 }));
  await expect(card(page, names.work).locator(".compact-account-url")).toHaveAttribute("href", "https://work.example.test/");
  await card(page, names.work).getByRole("link", { name: names.work, exact: true }).click();
  await expect(page).toHaveURL(/\/assets\/account\//);
  await expect(page.locator(".account-history-row")).toHaveCount(1);
  await topNav(page).getByRole("link", { name: t("accountBack"), exact: true }).click();

  await select.click();
  await expect(card(page, names.work)).toBeVisible();
  await expect(card(page, names.personal)).toBeVisible();
  await selection(page, names.work).click();
  await selection(page, names.unrelated).click();
  await merge.click();
  await expect(dialog(page).getByRole("heading", { name: t("accountBatchMissingTitle"), exact: true })).toBeVisible();
  await expect(dialog(page).locator(row).locator("strong")).toHaveText([names.personal]);
  await dialog(page).getByRole("button", { name: t("accountBatchSelectMissing"), exact: true }).click();
  await expect(count).toHaveText(t("accountBatchSelected", { count: 3 }));
  await expect(merge).toBeFocused();
  await merge.press("Escape");
  await expect(select).toHaveText(t("accountBatchSelect"));

  await select.click();
  await selection(page, names.work).click();
  await selection(page, names.private).click();
  await remove.click();
  await expect(dialog(page).locator(row).locator("strong")).toHaveText([names.work, names.private]);
  await page.setViewportSize({ width: 390, height: 650 });
  const narrow = (await dialog(page).boundingBox())!;
  expect(narrow.x).toBeGreaterThanOrEqual(8);
  expect(narrow.x + narrow.width).toBeLessThanOrEqual(382);
  await screenshot(page, info, "AM04-delete-review-390");
  await dialog(page).getByRole("button", { name: t("accountBatchTrash"), exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(card(page, names.work)).toHaveCount(0);
  await expect(card(page, names.private)).toHaveCount(0);
  await expect(card(page, names.personal)).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  await select.click();
  await selection(page, names.personal).click();
  await page.locator(".account-toolbar-actions").getByRole("button", { name: t("pwVaultLock"), exact: true }).click();
  await expect(select).toHaveCount(0);
  await enterAccounts(page, locale, master);
  await expect(select).toHaveText(t("accountBatchSelect"));
  await page.reload();
  await enterAccounts(page, locale, master);
  await expect(card(page, names.work)).toHaveCount(0);
  await expect(card(page, names.private)).toHaveCount(0);
  await expect(card(page, names.personal)).toBeVisible();
  await navigate(page, "/trash");
  await expect(page.locator(".trash-row").getByText(names.work, { exact: true })).toBeVisible();
  await expect(page.locator(".password-vault-entry-trash").getByText(names.work, { exact: true })).toBeVisible();
  await expect(page.locator(".password-vault-entry-trash").getByText(names.private, { exact: true })).toBeVisible();
  await expect(page.getByText(names.personal, { exact: true })).toHaveCount(0);
  expect(dev).toEqual([]);
 });
}
