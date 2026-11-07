import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resources } from "../../apps/web/src/i18n";
import { selectChoice } from "./helpers/select-choice";
import { importVisualKdbxEntries } from "./fixtures/password-smart-import-visual";
import { portableCandidate } from "./helpers/portable-candidate";
import { waitForAccountGraphLayout } from "./helpers/account-graph";
const output = resolve(process.env.KEEPANY_TEMPLATE_EVIDENCE ?? "test-results/account-template/evidence");
mkdirSync(output, { recursive: true });
const master = "SyntheticTemplateMaster2026!";
type T = (key: string) => string;
const cards = (page: Page) => page.locator(".compact-account-card");
const byName = (page: Page, name: string) => cards(page).filter({ has: page.getByRole("link", { name, exact: true }) });
// List fixtures still verify the new-account destination before returning through the UI.
async function returnCreatedAccountToList(page: Page, t: (key: string) => string, title: string, username: string) {
 await expect(page).toHaveURL(/\/assets\/account\/[^/#]+$/);
 const accountId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
 await expect(page.locator(".page-header h1")).toHaveText(title);
 await expect(page.locator(".account-login-summary [data-login-username]")).toHaveText(username);
 await page.getByRole("link", { name: t("accountBack"), exact: true }).click();
 await expect(page).toHaveURL(/\/accounts$/);
 await expect(page.locator(".account-toolbar-actions")).toBeVisible();
 return accountId;
}
async function save(page: Page, t: T) { const dialog = page.getByRole("dialog"); await dialog.getByRole("button", { name: t("save"), exact: true }).click(); await expect(dialog).toHaveCount(0); }
async function shot(page: Page, name: string) { if (page.viewportSize()!.width < 768) await expect.poll(() => page.locator(".sidebar").evaluate(node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(1); await page.screenshot({ path: join(output, `${name}.png`), fullPage: true }); }
async function setup(page: Page, t: T) {
 await page.goto("/"); await page.locator(".sidebar nav").getByRole("link", { name: t("accountsWorkspace"), exact: true }).click();
 await page.locator("#password-vault-master").fill(master); await page.locator("#password-vault-master-confirm").fill(master); await page.getByRole("button", { name: t("accountSetUp"), exact: true }).click();
 await expect(page.locator(".account-toolbar-actions")).toBeVisible();
 await page.locator(".asset-category-toolbar").getByRole("button", { name: t("add"), exact: true }).click();
 await page.locator("#password-vault-entry-title").fill("Template Mail"); await page.locator("#password-vault-entry-username").fill("source@example.test");
 await page.locator("#password-vault-entry-password").fill("Synthetic source secret"); await page.locator("#password-vault-entry-notes").fill("Private source notes"); await page.locator("#password-vault-entry-url").fill("https://mail.example.test/");
 await selectChoice(page.locator("#account-entry-category"), { label: t("email") }); await save(page, t);
 await returnCreatedAccountToList(page,t,"Template Mail","source@example.test");
}
async function openDetails(page: Page, card: Locator) { await card.locator(".compact-account-title-block").click(); await expect(page.locator(".account-login-summary")).toBeVisible(); await expect(page.locator(".account-history-card")).toBeVisible(); }
for (const language of ["zh-CN", "en"] as const) {
 test.describe(language, () => {
 test.use({ locale: language });
 const t: T = key => (resources[language].translation as Record<string, string>)[key] ?? key;
 test.beforeEach(async ({ page }) => { await page.addInitScript(lang => localStorage.setItem("keepany-language", lang), language); });
 test(`${language} AT01-05 template creates a new durable card and cancel keeps the source`, async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]); await setup(page, t);
  const source = byName(page, "Template Mail"), sourceId = await source.getAttribute("data-account-id");
  await shot(page, `before-contract-${language}`);
  await expect(source.getByRole("button", { name: t("moreActions"), exact: true })).toHaveCount(0);
  await expect(source.locator("header button")).toHaveCount(0); await expect(source.locator("footer button")).toHaveCount(4);
  await expect(source.locator("[data-account-switch]")).toBeDisabled();
  const add = source.getByRole("button", { name: t("add"), exact: true }); await add.click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toHaveAccessibleName(t("workspaceAddAccount"));
  for (const [field, value] of Object.entries({ title: "Template Mail", username: "", password: "", notes: "", url: "https://mail.example.test/" })) await expect(dialog.locator(`#password-vault-entry-${field}`)).toHaveValue(value);
  await expect(dialog.locator("#account-entry-category")).toContainText(t("email")); expect((await dialog.locator("label").allTextContents()).join(" ")).not.toMatch(/可选|optional/i);
  await dialog.locator("#password-vault-entry-username").fill("discard@example.test"); await dialog.getByRole("button", { name: t("cancel"), exact: true }).click(); await expect(cards(page)).toHaveCount(1); await expect(add).toBeFocused();
  await add.click(); await page.keyboard.press("Escape"); await expect(cards(page)).toHaveCount(1);
  await add.click(); await dialog.locator("#password-vault-entry-username").fill("new@example.test"); await dialog.locator("#password-vault-entry-password").fill("Synthetic new secret"); await save(page, t);
  const createdId = await returnCreatedAccountToList(page,t,"Template Mail","new@example.test");
  expect(createdId).not.toBe(sourceId);
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).locator("[data-account-switch]")).toBeEnabled();
  const search = page.locator(".asset-account-search input");
  await search.fill("Template Mail");
  await expect(cards(page)).toHaveCount(2);
  const created = page.locator(`.compact-account-card[data-account-id="${createdId}"]`);
  const original = page.locator(`.compact-account-card[data-account-id="${sourceId}"]`);
  await expect(created.locator("[data-login-username]")).toHaveText("new@example.test");
  await expect(original.locator("[data-login-username]")).toHaveText("source@example.test");
  await expect(original.locator(".compact-account-switch")).toHaveCount(0);
  await created.getByRole("button", { name: t("edit"), exact: true }).click(); await expect(dialog.locator("#password-vault-entry-notes")).toHaveValue(""); await expect(dialog.locator("#account-entry-category")).toContainText(t("email")); await dialog.getByRole("button", { name: t("cancel"), exact: true }).click();
  await search.fill("");
  await page.reload(); await page.locator("#password-vault-unlock-master").fill(master); await page.getByRole("button", { name: t("accountUnlockAction"), exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).locator("[data-account-switch]")).toBeEnabled();
  await search.fill("Template Mail");
  await expect(cards(page)).toHaveCount(2); await expect(created).toBeVisible(); await expect(original).toBeVisible(); await shot(page, `saved-reloaded-${language}`);
  // The same-name templates must remain distinguishable when used from Assets.
  await page.locator(".sidebar nav").getByRole("link", { name: t("assetsWorkspace"), exact: true }).click();
  await page.locator(".workspace-navigation").getByRole("link", { name: t("subscription"), exact: true }).click();
  await page.getByRole("button", { name: t("workspaceAddAsset"), exact: true }).click();
  await dialog.locator("#subscriptionLoginAccount").click();
  await expect(page.getByRole("option", { name: "Template Mail · source@example.test", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Template Mail · new@example.test", exact: true }).click();
  await dialog.locator("#name").fill("Template-linked subscription"); await dialog.locator("#amount").fill("20"); await save(page, t);
  await page.locator(".asset-summary-card").filter({ hasText: "Template-linked subscription" }).click();
  await page.getByRole("button", { name: t("edit"), exact: true }).click();
  await expect(dialog.locator("#subscriptionLoginAccount")).toHaveAttribute("data-value", createdId);
  await dialog.getByRole("button", { name: t("cancel"), exact: true }).click();
 });
 test(`${language} AT08-11 detail actions work for linked and private cards`, async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]); await setup(page, t);
  const source = byName(page, "Template Mail"); await source.getByRole("button", { name: t("edit"), exact: true }).click(); await page.locator("#password-vault-entry-notes").fill("Updated source notes"); await save(page, t);
  await openDetails(page, source); const login = page.locator(".account-login-summary"), unlink = page.locator(".account-unlink-action");
  // Approved detail contract supersedes the former More actions card and history modal.
  await expect(page.locator(".account-detail-actions,.account-impact-details,.asset-tasks-card")).toHaveCount(0); await expect(page.locator(".page-header").getByRole("button", { name: t("pwVaultHistory"), exact: true })).toHaveCount(0);
  await login.getByRole("button", { name: t("compactAccountCopyUrl"), exact: true }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("https://mail.example.test/");
  await expect(page.locator(".account-history-row")).not.toHaveCount(0); await shot(page, `history-${language}`);
  await page.locator(".account-history-row").first().getByRole("button", {name:/^(恢复|Restore) ·/}).click(); await expect(page.getByRole("dialog")).toHaveAccessibleName(t("pwVaultHistoryRestore"));
  await page.getByRole("dialog").getByRole("button", { name: t("pwVaultHistoryRestore"), exact: true }).first().click(); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.locator(".account-note-summary")).toContainText("Private source notes");
  await expect(page.getByRole("button", { name: t("accountViewRelations"), exact: true })).toHaveCount(0); await expect(page.locator("#account-relations")).toBeInViewport();
  await unlink.click(); await page.getByRole("dialog").getByRole("button", { name: t("cancel"), exact: true }).click(); await expect(unlink).toBeFocused();
  await unlink.click(); await page.getByRole("dialog").getByRole("button", { name: t("pwVaultUnlink"), exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".account-detail-back")).toHaveCount(0); await page.locator(".topbar-back-link").click(); await expect(cards(page)).toHaveCount(2);
  // Existing password-only data is prepared by importing a synthetic KDBX through the UI.
  await importVisualKdbxEntries(page, t, [{ title: "Private template", username: "private@example.test", password: "Synthetic private source", url: "https://private.example.test/" }]);
  await openDetails(page, byName(page, "Private template")); await page.locator(".page-header").getByRole("button", { name: t("add"), exact: true }).click(); await expect(page.locator("#password-vault-entry-title")).toHaveValue("Private template"); await expect(page.locator("#password-vault-entry-password")).toHaveValue("");
  await page.locator("#password-vault-entry-username").fill("private-new@example.test"); await save(page, t); await returnCreatedAccountToList(page,t,"Private template","private-new@example.test"); await expect(cards(page).filter({ hasText: "private-new@example.test" })).toBeVisible(); await shot(page, `private-template-created-${language}`);
 });
 test(`${language} AT05-06 input and storage failures retain the draft and retry once`, async ({ page }) => {
  await setup(page, t);
  const source = byName(page, "Template Mail");
  const sourceId = await source.getAttribute("data-account-id");
  await source.getByRole("button", { name: t("add"), exact: true }).click(); const dialog = page.getByRole("dialog");
  await dialog.locator("#password-vault-entry-title").fill(""); await dialog.getByRole("button", { name: t("save"), exact: true }).click(); expect(await dialog.locator("#password-vault-entry-title").evaluate((node: HTMLInputElement) => node.validity.valueMissing)).toBe(true);
  await dialog.locator("#password-vault-entry-title").fill("Retry template"); await dialog.locator("#password-vault-entry-url").fill("ftp://example.test/"); await dialog.getByRole("button", { name: t("save"), exact: true }).click(); await expect(dialog.getByRole("alert")).toHaveText(t("pwVaultInvalidUrl")); await shot(page, `invalid-${language}`);
  await dialog.locator("#password-vault-entry-url").fill("https://mail.example.test/"); await dialog.locator("#password-vault-entry-username").fill("retry@example.test");
  // One injected disk failure, restored immediately; the save and retry are normal UI actions.
  await page.evaluate(() => { const original = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(value, key) { if (this.name === "passwordVault") { IDBObjectStore.prototype.put = original; throw new DOMException("Synthetic KDBX write fault", "QuotaExceededError"); } return key === undefined ? original.call(this, value) : original.call(this, value, key); }; });
  await dialog.getByRole("button", { name: t("save"), exact: true }).click(); await expect(dialog.getByRole("alert")).toHaveText(t("accountEntryPartial")); await expect(dialog.locator("#password-vault-entry-username")).toHaveValue("retry@example.test"); await shot(page, `write-failure-${language}`);
  await save(page, t);
  const retriedId = await returnCreatedAccountToList(page,t,"Retry template","retry@example.test");
  await expect(cards(page)).toHaveCount(1);
  const changeAccount = cards(page).locator("[data-account-switch]");
  await expect(changeAccount).toBeEnabled();
  if (await cards(page).getAttribute("data-account-id") === sourceId) await changeAccount.click();
  await expect(byName(page, "Retry template")).toHaveAttribute("data-account-id", retriedId);
  await expect(byName(page, "Retry template").locator("[data-login-username]")).toHaveText("retry@example.test");
  await changeAccount.click();
  await expect(source).toHaveAttribute("data-account-id", sourceId!);
  await expect(source.locator("[data-login-username]")).toHaveText("source@example.test");
  await changeAccount.click();
  await expect(byName(page, "Retry template")).toHaveAttribute("data-account-id", retriedId);
 });
 test(`${language} AT12-13 visible layouts and modal states at supported widths`, async ({ page }) => {
  test.setTimeout(180000); await setup(page, t); const matrix: unknown[] = [];
  for (const width of [390, 768, 1058, 1280, 1920, 2262]) {
   await page.setViewportSize({ width, height: 1000 }); const source = byName(page, "Template Mail"); await source.getByRole("button", { name: t("add"), exact: true }).hover(); await source.getByRole("button", { name: t("edit"), exact: true }).focus(); await shot(page, `card-${language}-${width}`);
   await source.getByRole("button", { name: t("edit"), exact: true }).click(); const dialog = page.getByRole("dialog");
   await dialog.locator("#password-vault-entry-title").fill("Long template · 很长的账号名称用于核对换行和按钮布局 " + "Example ".repeat(12)); await dialog.locator("#password-vault-entry-notes").fill("Long notes · 备注 ".repeat(100));
   await shot(page, `edit-${language}-${width}`);
   const geometry = await dialog.evaluate(node => { const category = node.querySelector("#account-entry-category")!.getBoundingClientRect(), buttons = node.querySelector(".pw-import-field-actions button")!.getBoundingClientRect(); return { category: { y: category.y, h: category.height }, buttons: { y: buttons.y, h: buttons.height }, overflow: node.scrollWidth > node.clientWidth + 1 }; });
   expect(geometry.overflow).toBe(false); expect(geometry.category.h).toBe(geometry.buttons.h); if (width >= 768) expect(Math.abs(geometry.category.y + geometry.category.h / 2 - geometry.buttons.y - geometry.buttons.h / 2)).toBeLessThanOrEqual(1); matrix.push({ width, geometry, alignment: width < 768 ? "N/A: title actions and category occupy separate rows on mobile" : "same row" });
   await dialog.locator("#account-entry-category").click(); await page.getByRole("option", { name: t("phone"), exact: true }).waitFor({ state: "visible" }); await shot(page, `category-open-${language}-${width}`); await page.keyboard.press("Escape"); await dialog.getByRole("button", { name: t("cancel"), exact: true }).click();
   await source.getByRole("button", { name: t("add"), exact: true }).click(); await shot(page, `create-${language}-${width}`); await dialog.getByRole("button", { name: t("cancel"), exact: true }).click();
   await openDetails(page, source); await waitForAccountGraphLayout(page, { nodes: 1, edges: 0 }); await shot(page, `detail-${language}-${width}`); await expect(page.locator(".account-history-empty")).toHaveText(t("pwVaultHistoryEmpty")); await shot(page, `history-empty-${language}-${width}`);
   await page.locator(".account-unlink-action").click(); await shot(page, `unlink-${language}-${width}`); await page.getByRole("dialog").getByRole("button", { name: t("cancel"), exact: true }).click(); await expect(page.locator(".account-detail-back")).toHaveCount(0); await page.locator(".topbar-back-link").click();
   expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  }
  writeFileSync(join(output, `matrix-${language}.json`), JSON.stringify({ ids: ["AT01", "AT12", "AT13"], candidate: portableCandidate(), matrix }, null, 2));
 });
 });
}
