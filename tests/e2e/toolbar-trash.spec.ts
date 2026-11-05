import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { resources } from "../../apps/web/src/i18n";
import { portableCandidate } from "./helpers/portable-candidate";
import { selectChoice } from "./helpers/select-choice";
const output = resolve(process.env.KEEPANY_TOOLBAR_EVIDENCE ?? "test-results/toolbar-trash/evidence");
mkdirSync(output, { recursive: true });
const master = "SyntheticToolbarMaster2026!";
type T = (key: string) => string;
async function setup(page: Page, t: T) {
 await page.goto("/accounts"); await page.locator("#password-vault-master").fill(master); await page.locator("#password-vault-master-confirm").fill(master);
 await page.getByRole("button", {name:t("accountSetUp"),exact:true}).click(); await page.locator(".account-toolbar-actions").waitFor();
}
async function create(page: Page, t:T, title="Toolbar Mail", username="synthetic@example.test") {
 await page.locator(".account-toolbar-actions").getByRole("button",{name:t("add"),exact:true}).click();
 await page.locator("#password-vault-entry-title").fill(title); await page.locator("#password-vault-entry-username").fill(username); await page.locator("#password-vault-entry-password").fill("SyntheticOnlySecret2026!");
 await page.locator("#password-vault-entry-url").fill("https://example.test/"+"long-url/".repeat(20)); await selectChoice(page.locator("#account-entry-category"),{label:t("email")});
 await page.getByRole("dialog").getByRole("button",{name:t("save"),exact:true}).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function trashLogin(page:Page,t:T,index=0) {
 await page.locator(".compact-account-card").nth(index).getByRole("button",{name:t("accountDeleteLogin"),exact:true}).click();
 await page.getByRole("dialog").getByRole("button",{name:t("accountDeleteLogin"),exact:true}).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function accounts(page:Page,t:T){ await page.locator(".sidebar nav").getByRole("link",{name:t("accountsWorkspace"),exact:true}).click(); }
async function unlock(page:Page,t:T){ await page.locator("#password-vault-unlock-master").fill(master); await page.getByRole("button",{name:t("accountUnlockAction"),exact:true}).click(); await expect(page.locator("#password-vault-unlock-master")).toHaveCount(0); }
async function shot(page:Page,name:string){await page.screenshot({path:join(output,name+".png"),fullPage:true});}
for (const language of ["zh-CN", "en"] as const) {
 const t = (key: string) => (resources[language].translation as Record<string,string>)[key] ?? key;
 test.describe(language, () => {
 test.beforeEach(async ({ page }) => { await page.addInitScript(lang => localStorage.setItem("keepany-language", lang), language); });
 test(`${language} TT01-02 baseline unified toolbar`, async ({ page }) => {
  await page.goto("/accounts");
  await page.locator("#password-vault-master").fill(master); await page.locator("#password-vault-master-confirm").fill(master);
  await page.getByRole("button", { name: t("accountSetUp"), exact: true }).click();
  await page.locator("#password-vault-search-input").waitFor();
  await page.screenshot({path: join(output, `baseline-${language}.png`),fullPage:true});
  await expect(page.locator(".unified-accounts-page .password-vault-header")).toHaveCount(0);
  await expect(page.locator(".asset-category-toolbar").getByRole("button", { name: t("add"), exact:true })).toBeVisible();
  await expect(page.locator("#vault-trash")).toHaveCount(0);
 });
 test(`${language} TT04-09 unified encrypted and ordinary trash lifecycle`,async({page})=>{
  await setup(page,t); await create(page,t); const card=page.locator(".compact-account-card");
  await trashLogin(page,t); await expect(page.locator("#vault-trash")).toHaveCount(0);
  await card.getByRole("button",{name:t("pwVaultDeleteEntry"),exact:true}).click(); await page.getByRole("dialog").getByRole("button",{name:t("pwVaultDeleteEntry"),exact:true}).click(); await expect(card).toHaveCount(0);
  await page.locator(".sidebar-trash").click(); const encrypted=page.locator(".password-vault-entry-trash"),ordinary=page.locator(".trash-row");
  await expect(encrypted).toHaveCount(1); await expect(ordinary).toHaveCount(1); await shot(page,`mixed-trash-${language}`);
  await encrypted.getByRole("button",{name:t("deletePermanently"),exact:true}).click(); await page.getByRole("dialog").getByRole("button",{name:t("cancel"),exact:true}).click(); await expect(encrypted).toHaveCount(1);
  await ordinary.getByRole("button",{name:t("deletePermanently"),exact:true}).click(); await page.getByRole("dialog").getByRole("button",{name:t("cancel"),exact:true}).click(); await expect(ordinary).toHaveCount(1);
  await page.reload(); await expect(encrypted).toHaveCount(0); await page.locator("#password-vault-unlock-master").fill("WrongSyntheticMaster!"); await page.getByRole("button",{name:t("pwVaultUnlock"),exact:true}).click(); await expect(page.getByRole("status").filter({hasText:t("pwVaultUnlockFailed")})).toBeVisible(); await shot(page,`trash-wrong-password-${language}`);
  await page.locator("#password-vault-unlock-master").fill(master); await page.getByRole("button",{name:t("pwVaultUnlock"),exact:true}).click(); await expect(encrypted).toHaveCount(1);
  await ordinary.getByRole("button",{name:t("restore"),exact:true}).click(); await expect(ordinary).toHaveCount(0);
  await encrypted.getByRole("button",{name:t("pwVaultRestoreEntry"),exact:true}).click(); await expect(encrypted).toHaveCount(0); await accounts(page,t); await expect(card).toHaveCount(1); await expect(card).toContainText("synthetic@example.test"); await page.reload(); await unlock(page,t); await expect(card).toContainText("synthetic@example.test");
  for(const path of ["/accounts#vault-trash","/assets/account#vault-trash","/assets/vault#vault-trash"]){await page.goto(path);await expect(page).toHaveURL(/\/trash$/); await expect(page.getByRole("heading",{name:t("trash"),exact:true})).toBeVisible();}
  await shot(page,`empty-trash-${language}`);
 });
 test(`${language} TT03-05 tools, category cancel and locked navigation`,async({page})=>{
  await setup(page,t); await create(page,t); const actions=page.locator(".account-toolbar-actions");
  await page.locator("#password-vault-search-input").fill("missing search"); await expect(page.locator(".compact-account-card")).toHaveCount(0); await page.locator("#password-vault-search-input").press("Escape"); await expect(page.locator(".compact-account-card")).toHaveCount(1);
  await page.getByRole("button",{name:t("newCategory"),exact:true}).click(); await page.locator("#category-name").fill("Synthetic category"); await page.getByRole("button",{name:t("categoryCollapse"),exact:true}).click(); await expect(page.locator("#category-name")).toHaveCount(0);
  for(const key of ["pwConnectTitle","pwVaultImport","pwSmartTitle","pwVaultChangeMaster"]){await page.locator(".account-options-trigger").click();await page.getByRole("menuitem",{name:t(key),exact:true}).click();await expect(page.getByRole("dialog")).toBeVisible();await shot(page,`tool-${key}-${language}`);await page.getByRole("dialog").getByRole("button",{name:t("close"),exact:true}).click();}
  await page.locator(".account-options-trigger").click(); const download=page.waitForEvent("download"); await page.getByRole("menuitem",{name:t("pwVaultExport"),exact:true}).click(); expect((await download).suggestedFilename()).toMatch(/\.kdbx$/);
  await actions.getByRole("button",{name:t("pwVaultLock"),exact:true}).click();await expect(actions).toHaveCount(0);await expect(page.locator(".compact-account-card")).toHaveCount(0);await unlock(page,t);await expect(page.locator(".compact-account-card")).toHaveCount(1);
  await page.locator(".sidebar").getByRole("link",{name:t("settings"),exact:true}).click();await page.locator("#advanced-settings > summary").click();await page.getByRole("button",{name:t("loadSample"),exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:t("loadSample"),exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
  await accounts(page,t);await expect(page.locator(".reminder-runtime-banner")).toHaveCount(0);const count=await page.locator(".compact-account-card").count();expect(count).toBeGreaterThan(1);
  await page.locator(".account-options-trigger").click();await page.getByRole("menuitem",{name:t("sampleLogins"),exact:true}).click();await expect(page.locator(".compact-account-card[data-entry-id]")).toHaveCount(count);await page.locator(".account-options-trigger").click();await expect(page.getByRole("menuitem",{name:t("sampleLogins"),exact:true})).toHaveCount(0);await page.keyboard.press("Escape");await shot(page,`demo-logins-${language}`);
  await page.locator("#asset-tag-filter-account").click();const options=await page.getByRole("option").all();expect(options.length).toBeGreaterThan(1);await options[1].click();await expect(page.locator(".compact-account-card")).not.toHaveCount(count);await page.locator("#asset-tag-filter-account").click();await page.getByRole("option",{name:t("allTags"),exact:true}).click();await expect(page.locator(".compact-account-card")).toHaveCount(count);
 });
 test(`${language} TT08 encrypted and ordinary purge keep confirmations and survive one write failure`,async({page})=>{
  await setup(page,t);await create(page,t);await trashLogin(page,t);await page.locator(".compact-account-card").getByRole("button",{name:t("pwVaultDeleteEntry"),exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:t("pwVaultDeleteEntry"),exact:true}).click();
  await create(page,t,"Second synthetic","second@example.test");await trashLogin(page,t);await page.locator(".sidebar-trash").click();const rows=page.locator(".password-vault-entry-trash");await expect(rows).toHaveCount(2);
  await rows.first().getByRole("button",{name:t("deletePermanently"),exact:true}).click();
  // A single synthetic IndexedDB failure prepares the error branch; actions use real UI.
  await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==="passwordVault"){IDBObjectStore.prototype.put=original;throw new DOMException("Synthetic one-write fault","QuotaExceededError");}return key===undefined?original.call(this,value):original.call(this,value,key);};});
  await page.getByRole("dialog").getByRole("button",{name:t("deletePermanently"),exact:true}).click();await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(t("pwVaultError"));await expect(rows).toHaveCount(2);await shot(page,`purge-write-failure-${language}`);await page.getByRole("dialog").getByRole("button",{name:t("cancel"),exact:true}).click();
  await rows.first().getByRole("button",{name:t("deletePermanently"),exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:t("deletePermanently"),exact:true}).click();await expect(rows).toHaveCount(1);
  await page.getByRole("button",{name:t("pwVaultEmptyTrash"),exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:t("cancel"),exact:true}).click();await expect(rows).toHaveCount(1);
  await page.getByRole("button",{name:t("pwVaultEmptyTrash"),exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:t("emptyTrash"),exact:true}).click();await expect(rows).toHaveCount(0);
  await page.getByRole("button",{name:t("trashEmptyAssets"),exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:t("cancel"),exact:true}).click();await expect(page.locator(".trash-row")).toHaveCount(1);
  await page.getByRole("button",{name:t("trashEmptyAssets"),exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:t("emptyTrash"),exact:true}).click();await expect(page.locator(".trash-row")).toHaveCount(0);await page.reload();await page.locator("#password-vault-unlock-master").fill(master);await page.getByRole("button",{name:t("pwVaultUnlock"),exact:true}).click();await expect(rows).toHaveCount(0);await expect(page.locator(".trash-row")).toHaveCount(0);await shot(page,`purged-reloaded-${language}`);
 });
 test(`${language} TT02 TT06 TT08 layouts and confirmation states`,async({page})=>{
  test.setTimeout(180000);await setup(page,t);await create(page,t);await create(page,t,"Long account name · 很长的账号名称 "+"Example ".repeat(15),"long-identifier-".repeat(6)+"@example.test");await trashLogin(page,t,1);
  const matrix=[];
  for(const width of [390,768,1280,1920,2262]){
   await page.setViewportSize({width,height:1000});await page.locator(".asset-category-manage").hover();await page.locator("#password-vault-search-input").focus();await shot(page,`toolbar-${language}-${width}`);
   const geometry=await page.locator(".asset-category-toolbar").evaluate(node=>[node.querySelector(".asset-category-scroll button"),node.querySelector(".asset-account-search"),node.querySelector(".themed-select-trigger"),node.querySelector(".asset-category-manage"),...node.querySelectorAll(".account-toolbar-actions button")].map(n=>{const r=n!.getBoundingClientRect();return {y:r.y,h:r.height,center:r.y+r.height/2};}));
   for(const control of geometry)expect(control.h).toBe(44); if(width>=1280)expect(Math.max(...geometry.map(v=>v.center))-Math.min(...geometry.map(v=>v.center))).toBeLessThanOrEqual(1);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false); matrix.push({width,geometry});
   await page.locator(".account-options-trigger").click(); await shot(page,`menu-${language}-${width}`);await page.keyboard.press("Escape");
   await page.locator(".asset-category-add").click();await shot(page,`category-${language}-${width}`);await page.getByRole("button",{name:t("categoryCollapse"),exact:true}).click();
  }
  await page.setViewportSize({width:1280,height:1000});await page.locator(".sidebar-trash").click();
  for(const width of [390,768,1280,1920,2262]){await page.setViewportSize({width,height:1000});await page.locator(".password-vault-entry-trash").getByRole("button",{name:t("deletePermanently"),exact:true}).click();await shot(page,`purge-${language}-${width}`);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);await page.getByRole("dialog").getByRole("button",{name:t("cancel"),exact:true}).click();}
  writeFileSync(join(output,`matrix-${language}.json`),JSON.stringify({ids:["TT02","TT06","TT08"],candidate:portableCandidate(),matrix},null,2));
 });
 });
}
