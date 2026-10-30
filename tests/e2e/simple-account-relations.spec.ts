import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { resources } from "../../apps/web/src/i18n";
import { importVisualKdbxEntries } from "./fixtures/password-smart-import-visual";
import { selectChoice } from "./helpers/select-choice";
import { waitForAccountGraphLayout } from "./helpers/account-graph";
import { prepareCompletionArchive, restoreCompletionArchive } from "./helpers/completion-archive";
import { newAsset } from "../../packages/domain/src";
import { decryptBackup } from "../../packages/local-db/src/backup-crypto";
import { strFromU8, unzipSync } from "fflate";

const evidence = resolve(process.env.KEEPANY_SIMPLE_ACCOUNT_EVIDENCE ?? "test-results/simple-account/evidence");
mkdirSync(evidence, { recursive: true });
const master = "SyntheticSimpleMaster2026!";
const legacyDirectory = join(evidence, "legacy-preparation");
const legacyNote = "Legacy ordinary note", supplemental = "L".repeat(20000), privateNote = "P".repeat(50000);
test.beforeAll(async () => { await prepareCompletionArchive(legacyDirectory, master, async repo => {
 const asset = { ...newAsset("account"), id: "sr-legacy-note", name: "SR legacy old", category: "email", username: "old@example.test", accountProvider: "Preserved provider", contact: "Preserved contact", description: "Preserved purpose", notes: legacyNote, longDescription: supplemental };
 await repo.save("asset", asset); return { id: asset.id };
}); });
const text = (language: "zh-CN" | "en") => (key: string) => (resources[language].translation as Record<string, string>)[key] ?? key;
type T = (key: string) => string;
const card = (page: Page, name: string) => page.locator(".compact-account-card").filter({ has: page.getByRole("link", { name, exact: true }) });
async function save(page: Page, t: T) { await page.getByRole("dialog").getByRole("button", { name: t("save"), exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); }
async function setup(page: Page, t: T) { await page.goto("/accounts"); await page.locator("#password-vault-master").fill(master); await page.locator("#password-vault-master-confirm").fill(master); await page.getByRole("button", { name: t("accountSetUp"), exact: true }).click(); await expect(page.locator(".password-vault-toolbar")).toBeVisible(); }
async function create(page: Page, t: T, name: string, alias = false) {
 await page.locator(".password-vault-header").getByRole("button", { name: t("add"), exact: true }).click();
 const d = page.getByRole("dialog");
 await d.locator("#password-vault-entry-title").fill(name);
 await d.locator("#password-vault-entry-username").fill("main@example.test");
 await d.locator("#password-vault-entry-password").fill("SyntheticSimple!2026");
 await d.locator("#password-vault-entry-url").fill("https://mail.example.test/" + "long-path/".repeat(8));
 await d.locator("#password-vault-entry-notes").fill("One note · 唯一备注\nFor work and registration. ".repeat(4));
 if (alias) { await d.getByRole("button", { name: t("pwVaultAddIdentifier"), exact: true }).click(); await d.locator(".pw-smart-identifier-row input").fill("alias@example.test"); }
 await expect(d.locator("textarea")).toHaveCount(1);
 await expect(d.locator("#account-entry-provider,#account-entry-contact,#account-entry-purpose,#account-entry-notes,.account-entry-profile,.password-vault-linked-picker")).toHaveCount(0);
 await save(page, t);
}
async function unlock(page: Page, t: T) { await page.locator("#password-vault-unlock-master").fill(master); await page.getByRole("button", { name: t("accountUnlockAction"), exact: true }).click(); await expect(page.locator(".account-login-summary,.password-vault-toolbar").first()).toBeVisible(); expect(await page.getByText(t("pwVaultStatusUnlocked"), { exact: true }).count()).toBeLessThanOrEqual(1); }
async function connect(page: Page, t: T, name: string) {
 await page.getByRole("button", { name: t("addRelation"), exact: true }).click();
 await expect(page.getByRole("dialog").getByRole("button", { name: t("save"), exact: true })).toBeDisabled();
 await selectChoice(page.locator("#relation-target"), { label: name });
 await page.locator("#relation-label").fill("Login connection"); await save(page, t);
}
async function shot(page: Page, name: string) {
 if (page.viewportSize()!.width < 768) await expect.poll(() => page.locator(".sidebar").evaluate(n => n.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
 await page.screenshot({ path: join(evidence, name + ".png"), fullPage: true });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const language of ["zh-CN", "en"] as const) {
 const t = text(language);
 test(`${language} SR01-SR07 legacy notes combine once, retry safely and stay encrypted`, async ({browser},info) => {
  const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:{width:1280,height:1000},locale:language,acceptDownloads:true});await context.addInitScript(lang=>localStorage.setItem("keepany-language",lang),language);const page=await context.newPage();
  try {
   await setup(page,t);await restoreCompletionArchive(page,master,join(legacyDirectory,"fixture.ka1"));await page.locator(".sidebar nav").getByRole("link",{name:t("accountsWorkspace"),exact:true}).click();
   await expect(page.locator(".password-vault-toolbar,#password-vault-unlock-master").first()).toBeVisible(); if(await page.locator("#password-vault-unlock-master").count())await unlock(page,t); await expect(page.locator(".password-vault-toolbar")).toBeVisible();
   await importVisualKdbxEntries(page,t,[{title:"SR legacy old",username:"old@example.test",password:"LegacySynthetic!2026",notes:privateNote,linkedAssetIds:["sr-legacy-note"]}]);
   const row=card(page,"SR legacy old"), combined=`${supplemental}\n\n${legacyNote}\n\n${privateNote}`;
   await row.getByRole("button",{name:t("edit"),exact:true}).click();await expect(page.locator("#password-vault-entry-notes")).toHaveValue(combined);await page.getByRole("dialog").getByRole("button",{name:t("cancel"),exact:true}).click();
   await row.getByRole("button",{name:t("edit"),exact:true}).click();
   // Single synthetic storage fault; preparation only. Save/retry use the real form.
   await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==="passwordVault"){IDBObjectStore.prototype.put=put;throw new DOMException("Synthetic note write failure","QuotaExceededError");}return key===undefined?put.call(this,value):put.call(this,value,key);};});
   await page.getByRole("dialog").getByRole("button",{name:t("save"),exact:true}).click();await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();await expect(page.locator("#password-vault-entry-notes")).toHaveValue(combined);await save(page,t);
   await page.reload();await unlock(page,t);await row.getByRole("button",{name:t("edit"),exact:true}).click();await expect(page.locator("#password-vault-entry-notes")).toHaveValue(combined);await page.getByRole("dialog").getByRole("button",{name:t("cancel"),exact:true}).click();
   await page.goto("/intake");await page.locator("#backup-password").fill(master);await page.getByRole("button",{name:t("backup"),exact:true}).click();const download=page.waitForEvent("download");await page.getByRole("link",{name:t("saveBackupFile"),exact:true}).click();const path=info.outputPath("notes-public.ka1");await(await download).saveAs(path);
   const files=unzipSync(await decryptBackup(new Uint8Array(readFileSync(path)),master)),rows=JSON.parse(strFromU8(files["records.json"]));const ordinary=rows.find((r:{type:string;value:{id:string}})=>r.type==="asset"&&r.value.id==="sr-legacy-note").value;
   expect(ordinary).toMatchObject({notes:"",longDescription:"",accountProvider:"Preserved provider",contact:"Preserved contact",description:"Preserved purpose"});expect(JSON.stringify(rows)).not.toContain(privateNote);
  }finally{await context.close();}
 });
 test(`${language} SR01-SR04 simplified fields, title navigation and relation tasks survive refresh`, async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1605, height: 1000 }, locale: language, permissions: ["clipboard-read", "clipboard-write"] });
  await context.addInitScript(lang => localStorage.setItem("keepany-language", lang), language);
  const page = await context.newPage(), errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  try {
   await setup(page, t); await create(page, t, "SR A main", true); await create(page, t, "SR B service"); await create(page, t, "SR C project");
   await card(page, "SR B service").getByRole("link", { name: "SR B service", exact: true }).click(); await connect(page, t, "SR C project");
   await page.getByRole("link", { name: t("accountBack"), exact: true }).click();
   const main = card(page, "SR A main");
   await expect(main.locator(".compact-account-title-block .compact-account-associations")).toHaveCount(1);
   await expect(main.locator(".compact-account-footer .compact-account-associations")).toHaveCount(0);
   await main.getByRole("link", { name: "SR A main", exact: true }).click();
   await expect(page.getByRole("dialog")).toHaveCount(0);
   await expect(page.locator(".account-login-summary")).toBeVisible(); await expect(page.locator(".account-note-summary")).toContainText("唯一备注");
   await expect(page.locator(".account-facts-grid,.account-entry-profile")).toHaveCount(0);
   await page.getByRole("button", { name: t("pwVaultCopyUsername"), exact: true }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("main@example.test");
   await page.getByRole("button", { name: t("pwVaultRevealPassword"), exact: true }).click(); await expect(page.locator("[data-login-password]")).toHaveText("SyntheticSimple!2026");
   await page.locator(".account-detail-switch").click(); await expect(page.locator("[data-login-username]")).toHaveText("alias@example.test"); await expect(page.locator("[data-login-password]")).toHaveText("••••••••••");
   await page.getByRole("button", { name: t("pwVaultCopyPassword"), exact: true }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("SyntheticSimple!2026");
   await page.getByRole("button", { name: t("addRelation"), exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: t("close"), exact: true }).click();
   await connect(page, t, "SR B service"); await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
   await page.getByRole("button", { name: t("accountGraphFamily"), exact: true }).click(); await waitForAccountGraphLayout(page, { nodes: 3, edges: 2 });
   await page.locator(".relation-filter input").fill("SR C project"); await expect(page.locator(".relation-filter small")).toBeVisible(); await page.locator(".relation-filter input").clear();
   await page.locator(".asset-graph-link").filter({hasText:"SR B service"}).click(); await page.locator(".page-header").getByRole("button",{name:t("edit"),exact:true}).click(); await page.locator("#password-vault-entry-notes").fill("Unsaved B draft"); await page.goBack(); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.locator(".page-header h1")).toHaveText("SR A main");
   await page.getByRole("button", { name: t("accountGraphExpand"), exact: true }).click(); await expect(page.locator(".account-family-graph--expanded")).toBeVisible(); await shot(page, `relation-fullscreen-${language}`); await page.keyboard.press("Escape"); await expect(page.locator(".account-family-graph--expanded")).toHaveCount(0);
   await page.locator(".asset-tasks-card").getByRole("button", { name: t("add"), exact: true }).click(); await page.getByRole("dialog").getByLabel(t("name"), { exact: true }).fill("SR verify account"); await save(page, t); await expect(page.locator(".asset-tasks-card")).toContainText("SR verify account");
   const taskRow=page.locator(".account-compact-task"); expect((await taskRow.boundingBox())!.height).toBeLessThan(100); await taskRow.getByRole("button",{name:t("moreActions"),exact:true}).click(); await page.getByRole("menuitem",{name:t("edit"),exact:true}).click(); await page.getByRole("dialog").getByLabel(t("name"),{exact:true}).fill("SR verify account · updated"); await save(page,t);
   await taskRow.getByRole("button",{name:t("moreActions"),exact:true}).click(); await page.getByRole("menuitem",{name:t("remindLater"),exact:true}).click(); await page.locator("[id^=compact-task-due-]").fill("2027-01-12"); await page.getByRole("dialog").getByRole("button",{name:t("cancel"),exact:true}).click(); await expect(taskRow).not.toContainText("2027");
   await taskRow.getByRole("button",{name:t("moreActions"),exact:true}).click(); await page.getByRole("menuitem",{name:t("remindLater"),exact:true}).click(); await page.locator("[id^=compact-task-due-]").fill("2027-01-12"); await save(page,t); await expect(taskRow).toContainText("2027"); await taskRow.getByRole("button",{name:t("complete"),exact:true}).click(); await expect(taskRow.locator("strong")).toHaveClass("done"); await taskRow.getByRole("button",{name:t("reopen"),exact:true}).click(); await expect(taskRow.locator("strong")).not.toHaveClass("done");
   await page.locator(".account-impact-details > summary").click(); await expect(page.locator(".account-impact-details")).toHaveJSProperty("open", true); await shot(page, `relation-expanded-${language}`);
   await page.locator(".page-header").getByRole("button", { name: t("edit"), exact: true }).click(); await expect(page.getByRole("dialog").locator("textarea")).toHaveCount(1); await page.locator("#password-vault-entry-notes").fill("One saved note · 保存后的唯一备注"); await save(page, t); await expect(page.locator(".account-note-summary")).toContainText("保存后的唯一备注");
   await page.reload(); await unlock(page, t); await expect(page.locator(".account-note-summary")).toContainText("保存后的唯一备注"); await expect(page.locator(".asset-tasks-card")).toContainText("SR verify account");
   await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 });
   const edge = page.locator(".react-flow__edge").first(); await edge.focus(); await edge.press("Enter"); await page.locator(".account-graph-selection-panel").getByRole("button", { name: t("deleteRelation"), exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: t("cancel"), exact: true }).click(); await expect(page.locator(".react-flow__edge")).toHaveCount(1);
   await page.locator(".account-graph-selection-panel").getByRole("button", { name: t("deleteRelation"), exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: t("deleteRelation"), exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await waitForAccountGraphLayout(page, { nodes: 1, edges: 0 }); await expect(page.locator("[data-login-username]")).toHaveText("main@example.test");
   await shot(page, `relation-after-delete-${language}`); expect(errors).toEqual([]);
  } finally { await context.close(); }
 });

 test(`${language} SR02-SR03 supported widths retain compact cards and usable relation layouts`, async ({ browser }, info) => {
  test.setTimeout(180000);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 1000 }, locale: language }); await context.addInitScript(lang => localStorage.setItem("keepany-language", lang), language); const page = await context.newPage();
  try {
   await setup(page, t); await create(page, t, "SR Long account · 用于验证长标题和内容换行 " + "long-name ".repeat(8), true);
   const account = page.locator(".compact-account-card"), title = account.locator(".compact-account-title-block");
   await title.click(); await page.locator(".asset-tasks-card").getByRole("button",{name:t("add"),exact:true}).click(); await page.getByRole("dialog").getByLabel(t("name"),{exact:true}).fill("A long task · 长内容需要自然换行 " + "Review connection ".repeat(5)); await save(page,t); await page.getByRole("link",{name:t("accountBack"),exact:true}).click();
   for (const width of [390, 768, 1280, 1920, 2262]) {
    await page.setViewportSize({ width, height: 1000 }); await shot(page, `simple-card-${language}-${width}`);
    await title.focus(); await expect(title).toBeFocused(); await title.hover(); await title.click(); await expect(page.locator(".account-login-summary")).toBeVisible(); await waitForAccountGraphLayout(page);
    await shot(page, `simple-detail-${language}-${width}`);
    await page.locator(".account-compact-task").getByRole("button",{name:t("moreActions"),exact:true}).click(); await shot(page,`simple-task-${language}-${width}`); await page.getByRole("menuitem",{name:t("remindLater"),exact:true}).click(); await shot(page,`simple-reminder-${language}-${width}`); await page.getByRole("dialog").getByRole("button",{name:t("cancel"),exact:true}).click();
    if (width > 1000) { const left = await page.locator(".asset-relations-card").boundingBox(), right = await page.locator(".account-login-summary").boundingBox(); expect(Math.abs(left!.y - right!.y)).toBeLessThanOrEqual(1); expect(left!.x + left!.width).toBeLessThan(right!.x); }
    await page.locator(".account-impact-details > summary").click(); await shot(page, `simple-impact-${language}-${width}`); await page.locator(".account-impact-details > summary").click();
    await page.getByRole("button", { name: t("accountGraphExpand"), exact: true }).click(); await expect(page.locator(".account-family-graph--expanded")).toBeVisible(); await waitForAccountGraphLayout(page); await shot(page, `simple-graph-${language}-${width}`); await page.keyboard.press("Escape");
    await page.locator(".page-header").getByRole("button", { name: t("edit"), exact: true }).click(); await expect(page.getByRole("dialog").locator("textarea")).toHaveCount(1); await shot(page, `simple-edit-${language}-${width}`); await page.getByRole("dialog").getByRole("button", { name: t("cancel"), exact: true }).click();
    await page.getByRole("link", { name: t("accountBack"), exact: true }).click();
   }
  } finally { await context.close(); }
 });

 test(`${language} SR05-SR06 KDBX-only detail links remain encrypted and unlock does not duplicate status`, async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 1000 }, locale: language }); await context.addInitScript(lang => localStorage.setItem("keepany-language", lang), language); const page = await context.newPage();
  try {
   await setup(page, t); await create(page, t, "SR ordinary asset");
   await importVisualKdbxEntries(page, t, [{ title: "SR private import", username: "private@example.test", password: "PrivateOnly!2026", notes: "Single imported note", usernameAliases: ["private-alias@example.test"] }]);
   await card(page, "SR private import").locator(".compact-account-title-block").click(); await expect(page.locator(".account-login-summary")).toBeVisible(); await expect(page.locator(".account-note-summary")).toContainText("Single imported note");
   await page.getByRole("button", { name: t("addRelation"), exact: true }).click(); await expect(page.locator("#account-entry-category")).toHaveCount(0); await page.locator("#password-vault-entry-asset").click(); await page.getByRole("option",{name:`SR ordinary asset · ${t("account")}`,exact:true}).click(); await expect(page.locator(".password-vault-linked-chip")).toContainText("SR ordinary asset"); await save(page, t); await waitForAccountGraphLayout(page, { nodes: 2, edges: 1 }); await shot(page, `private-detail-${language}`);
   const edge = page.locator(".react-flow__edge"); await edge.focus(); await edge.press("Enter"); await page.locator(".account-graph-selection-panel").getByRole("button", { name: t("deleteRelation"), exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: t("pwVaultUnlink"), exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); await waitForAccountGraphLayout(page, { nodes: 1, edges: 0 });
   await page.reload(); await unlock(page, t); await expect(page.locator(".account-login-summary")).toBeVisible(); await page.getByRole("link", { name: t("accountBack"), exact: true }).click(); await expect(page.locator(".compact-account-card:not([data-private-only])")).toHaveCount(1); await expect(card(page, "SR private import")).toHaveAttribute("data-private-only", "true");
   await page.getByRole("button", { name: t("pwVaultLock"), exact: true }).click(); await page.locator("#password-vault-unlock-master").fill("Wrong-fictional-password"); await page.getByRole("button", { name: t("accountUnlockAction"), exact: true }).click(); await expect(page.getByRole("alert").first()).toBeVisible(); await unlock(page, t); await shot(page, `unlock-single-status-${language}`);
   await card(page, "SR private import").locator(".compact-account-title-block").click(); await page.locator(".page-header").getByRole("button", { name: t("edit"), exact: true }).click(); await page.locator("#password-vault-entry-notes").fill("Discarded private note");
   // A second real page saves a revision, exercising the existing cross-tab lock boundary.
   const other = await context.newPage(); await other.goto("/accounts"); await unlock(other, t); await card(other, "SR private import").getByRole("button", {name:t("edit"),exact:true}).click(); await other.locator("#password-vault-entry-password").fill("OtherTabPrivate!2026"); await save(other,t);
   await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.locator(".account-login-summary")).toHaveCount(0); await unlock(page, t); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.locator(".account-note-summary")).toContainText("Single imported note");
  } finally { await context.close(); }
 });
}
