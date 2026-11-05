import {test,expect,type Page,type Locator} from "@playwright/test";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {resources} from "../../apps/web/src/i18n";
import {selectChoice} from "./helpers/select-choice";
import {portableCandidate} from "./helpers/portable-candidate";
import {importVisualKdbxEntries} from "./fixtures/password-smart-import-visual";
import {waitForAccountGraphLayout} from "./helpers/account-graph";
import {openAccountOption} from "./helpers/account-options";

const output=resolve(process.env.KEEPANY_ACCOUNT_DETAIL_EVIDENCE??"test-results/account-detail-approved/evidence");mkdirSync(output,{recursive:true});
const master="SyntheticAccountDetail2026!", rootName="Synthetic Douyin";
type T=(key:string)=>string;
const card=(page:Page,username:string)=>page.locator(".compact-account-card").filter({has:page.locator("[data-login-username]",{hasText:username})});
async function save(page:Page,t:T){await page.getByRole("dialog").getByRole("button",{name:t("save"),exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0)}
// Auxiliary deterministic resource-error fixture. Normal save/retry remain public UI actions.
async function injectMemoryFailure(page:Page){await page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(this.name==='passwordVault'){IDBObjectStore.prototype.put=original;throw Error('vault-memory')}return key===undefined?original.call(this,value):original.call(this,value,key)}})}
async function create(page:Page,t:T,name:string,username:string,notes=""){
 await page.locator(".asset-category-toolbar").getByRole("button",{name:t("add"),exact:true}).click();
 await page.locator("#password-vault-entry-title").fill(name);await page.locator("#password-vault-entry-username").fill(username);await page.locator("#password-vault-entry-url").fill("https://account.example.test/");await page.locator("#password-vault-entry-notes").fill(notes);await save(page,t);
 return (await card(page,username).filter({has:page.getByRole("link",{name,exact:true})}).getAttribute("data-account-id"))!;
}
async function setup(page:Page,t:T){
 await page.goto("/accounts");await page.locator("#password-vault-master").fill(master);await page.locator("#password-vault-master-confirm").fill(master);await page.getByRole("button",{name:t("accountSetUp"),exact:true}).click();
 const root=await create(page,t,rootName,"13800000056","Original account notes");
 await card(page,"13800000056").locator("footer").getByRole("button",{name:t("add"),exact:true}).click();await page.locator("#password-vault-entry-username").fill("backup@example.test");await save(page,t);
 const template=(await card(page,"backup@example.test").getAttribute("data-account-id"))!;
 const phone=await create(page,t,"Phone-related account","13800000056");
 const sameName=await create(page,t,rootName,"personal@example.test");
 await create(page,t,"Unrelated account","unrelated@example.test");
 await page.locator(`.compact-account-card[data-account-id="${root}"] .compact-account-title-block`).click();await expect(page.locator(".account-history-card")).toBeVisible();await page.locator(".account-graph-stage.is-ready").waitFor();
 return {root,template,phone,sameName};
}
async function screenshot(page:Page,name:string){
 await waitForAccountGraphLayout(page);
 if(name.startsWith('default-')||name.startsWith('long-')){
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{(document.activeElement as HTMLElement|null)?.blur();scrollTo(0,0);requestAnimationFrame(()=>resolve())}))));
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
 }
 const path=join(output,name+".png");await page.screenshot({path});return path;
}
async function addRelations(page:Page,t:T,ids:string[]){for(const id of ids){await page.locator("#account-relations").getByRole("button",{name:t("addRelation"),exact:true}).click();await selectChoice(page.locator("#relation-target"),{value:id});await page.locator("#relation-label").fill("Synthetic connection");await page.getByRole("dialog").getByRole("button",{name:t("save"),exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0)}}
async function checkHistoryViewport(page:Page,name:string){
 for(const height of [720,800]){
 await page.setViewportSize({width:1280,height});await waitForAccountGraphLayout(page);
 await page.evaluate(()=>{(document.activeElement as HTMLElement|null)?.blur();scrollTo(0,0)});
 expect(await page.evaluate(()=>document.documentElement.scrollHeight)).toBeLessThanOrEqual(height+1);
 const list=page.locator('.account-history-list'),row=page.locator('.account-history-row').first();
 expect(await list.evaluate(e=>e.clientHeight)).toBeGreaterThanOrEqual((await row.boundingBox())!.height);
 await page.locator('.account-history-row').last().getByRole('button').scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>scrollY)).toBe(0);await screenshot(page,`${name}-${height}`);
 }
}

for(const language of ["zh-CN","en"] as const){
 const t:T=key=>(resources[language].translation as Record<string,string>)[key]??key;
 test.describe(language,()=>{
 test.use({locale:language});
 test.beforeEach(async({page})=>{await page.addInitScript(lang=>localStorage.setItem("keepany-language",lang),language)});

 test(`${language} AS01 AS02 AS05 AS08 AS09 AS10 AS11 normal account user flow`,async({page,context})=>{
  await page.setViewportSize({width:1280,height:900});await context.grantPermissions(["clipboard-read","clipboard-write"]);const ids=await setup(page,t);
  await expect(page.locator(".account-impact-details,.asset-tasks-card,.account-detail-actions")).toHaveCount(0);
  await expect(page.locator(".page-header").getByRole("button")).toHaveCount(2);await expect(page.getByRole("button",{name:t("accountViewRelations"),exact:true})).toHaveCount(0);
  const related=page.locator(".account-related-link");await expect(related).toHaveCount(3);expect(await related.first().getAttribute("href")).toContain(ids.template);await expect(related.first()).toContainText(t("accountRelated_template"));await expect(related.nth(1)).toContainText(t("accountRelated_phone"));await expect(related.nth(2)).toContainText(t("accountRelated_name"));
  const url=page.url();await related.first().click();await expect(page.locator(".account-login-summary [data-login-username]")).toHaveText("backup@example.test");await page.goBack();await expect(page).toHaveURL(url);
  const login=page.locator(".account-login-summary");await login.getByRole("button",{name:t("pwVaultCopyUsername"),exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe("13800000056");await login.getByRole("button",{name:t("compactAccountCopyUrl"),exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe("https://account.example.test/");
  await login.getByRole("button",{name:t("accountDetailAddPassword"),exact:true}).click();await page.locator("#password-vault-entry-title").fill("");await page.getByRole("dialog").getByRole("button",{name:t("save"),exact:true}).click();expect(await page.locator("#password-vault-entry-title").evaluate((e:HTMLInputElement)=>e.validity.valueMissing)).toBe(true);await page.getByRole("dialog").getByRole("button",{name:t("cancel"),exact:true}).click();await expect(login.locator("[data-login-password]")).toHaveText(t("pwVaultNoPassword"));
  await page.locator(".page-header").getByRole("button",{name:t("edit"),exact:true}).click();await page.locator("#password-vault-entry-title").fill("Updated account title");await page.locator("#password-vault-entry-username").fill("changed@example.test");await page.locator("#password-vault-entry-url").fill("https://changed.example.test/new");await page.locator("#password-vault-entry-notes").fill("Updated account notes");await page.locator("#password-vault-entry-password").fill("Synthetic edited password");
  await injectMemoryFailure(page);await page.getByRole('dialog').getByRole('button',{name:t('save'),exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(t('accountEntryPartialMemory'));await expect(page.locator('#password-vault-entry-notes')).toHaveValue('Updated account notes');await expect(page.locator('#password-vault-entry-password')).toHaveValue('Synthetic edited password');await screenshot(page,`memory-error-${language}`);
  await save(page,t);await expect(page.locator(".account-note-summary")).toContainText("Updated account notes");await expect(page.locator(".account-history-row")).toHaveCount(1);await checkHistoryViewport(page,`history-one-${language}`);
  await login.getByRole("button",{name:t("pwVaultRevealPassword"),exact:true}).click();await expect(login.locator("[data-login-password]")).toHaveText("Synthetic edited password");await login.getByRole("button",{name:t("pwVaultHidePasswordValue"),exact:true}).click();await login.getByRole("button",{name:t("pwVaultCopyPassword"),exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe("Synthetic edited password");
  const restore=page.locator(".account-history-row").first().getByRole("button");await restore.click();await page.getByRole("dialog").getByRole("button",{name:t("cancel"),exact:true}).click();await expect(page.locator(".account-note-summary")).toContainText("Updated account notes");
  await restore.click();await page.getByRole("dialog").getByRole("button",{name:t("pwVaultHistoryRestore"),exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);await expect(page.locator(".account-note-summary")).toContainText("Original account notes");await expect(login.locator("[data-login-password]")).toHaveText(t("pwVaultNoPassword"));await expect(page.locator(".account-history-row")).toHaveCount(2);await expect(page.locator(".page-header h1")).toHaveText(rootName);await expect(login.locator("[data-login-username]")).toHaveText("13800000056");await expect(login.locator(".account-login-url-value")).toHaveAttribute("href","https://account.example.test/");await expect(page.locator(`#account-relations [data-id="${ids.root}"]`)).toContainText(rootName);
  await checkHistoryViewport(page,`history-multiple-${language}`);
  await page.reload();await page.locator("#password-vault-unlock-master").fill(master);await page.getByRole("button",{name:t("accountUnlockAction"),exact:true}).click();await expect(page.locator(".account-note-summary")).toContainText("Original account notes");await expect(related.first()).toContainText(t("accountRelated_template"));
  // An injected clipboard rejection is an auxiliary error fixture; user interaction remains visible.
  await login.getByRole("button",{name:t("compactAccountCopyUrl"),exact:true}).click();await expect(login.getByRole('button',{name:t('compactAccountCopyUrl'),exact:true}).locator('.lucide-check')).toHaveCount(1);
  await page.evaluate(()=>Object.defineProperty(navigator.clipboard,"writeText",{configurable:true,value:async()=>{throw Error("synthetic clipboard rejection")}}));await login.getByRole("button",{name:t("compactAccountCopyUrl"),exact:true}).click();await expect(page.locator("#account-detail-manual-copy")).toHaveValue("https://account.example.test/");await expect(login.getByRole('button',{name:t('compactAccountCopyUrl'),exact:true}).locator('.lucide-check')).toHaveCount(0);await screenshot(page,`copy-error-${language}`);await page.getByRole("dialog").getByRole("button",{name:t("close"),exact:true}).click();
  const unlink=page.locator(".account-unlink-action");await unlink.click();await page.getByRole("dialog").getByRole("button",{name:t("cancel"),exact:true}).click();await expect(unlink).toBeFocused();
  await page.locator(".topbar-back-link").click();await expect(page.locator('.compact-account-card')).toHaveCount(5);await page.getByRole("button",{name:t("pwVaultLock"),exact:true}).click();await page.goto(url);await expect(page.locator(".account-history-card,.account-related-card")).toHaveCount(0);await page.goto("/change-impact");await expect(page).toHaveURL(/\/accounts$/);
  writeFileSync(join(output,`functional-${language}.json`),JSON.stringify({ids:["AS01","AS02","AS05","AS08","AS09","AS10","AS11"],candidate:portableCandidate(),status:"passed"},null,2));
 });

 test(`${language} AS02 AS03 AS04 compiled visual states`,async({page,context})=>{
  await context.grantPermissions(["clipboard-read","clipboard-write"]);await page.setViewportSize({width:1920,height:1080});const ids=await setup(page,t);await addRelations(page,t,[ids.template,ids.phone,ids.sameName]);
  const shots:string[]=[];
  for(const width of [390,768,1280,1920,1991]){
   await page.setViewportSize({width,height:width<1000?900:width===1280?800:990});await page.evaluate(()=>scrollTo(0,0));await page.locator(".account-graph-stage.is-ready").waitFor();
   const dimensions=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,pageBottom:document.querySelector("main.account-relation-layout")!.getBoundingClientRect().bottom}));
   expect(dimensions.scrollWidth).toBeLessThanOrEqual(width+1);if(width>1000)expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height+1);
   const left=await page.locator('.asset-detail-secondary').boundingBox(),relationCard=await page.locator('#account-relations').boundingBox(),relatedCard=await page.locator('.account-related-card').boundingBox();
   expect(Math.abs(left!.width-relationCard!.width)).toBeLessThanOrEqual(1);expect(relatedCard!.y).toBeGreaterThanOrEqual(relationCard!.y+relationCard!.height);
   await expect.poll(()=>page.locator('.account-graph-stage').evaluate(stage=>{const frame=stage.getBoundingClientRect();return [...stage.querySelectorAll('.react-flow__node')].every(node=>{const r=node.getBoundingClientRect();return r.left>=frame.left-1&&r.right<=frame.right+1&&r.top>=frame.top-1&&r.bottom<=frame.bottom+1})})).toBe(true);
   shots.push(await screenshot(page,`default-${language}-${width}`));
   const copy=page.locator(".account-login-summary").getByRole("button",{name:t("pwVaultCopyUsername"),exact:true});await copy.scrollIntoViewIfNeeded();await copy.hover();shots.push(await screenshot(page,`hover-${language}-${width}`));await copy.focus();shots.push(await screenshot(page,`focus-${language}-${width}`));const r=await copy.boundingBox();await page.mouse.move(r!.x+r!.width/2,r!.y+r!.height/2);await page.mouse.down();shots.push(await screenshot(page,`pressed-${language}-${width}`));await page.mouse.up();if(await page.getByRole("dialog").count())await page.keyboard.press("Escape");
   const guide=page.locator(".account-graph-guide>summary");await guide.click();shots.push(await screenshot(page,`guide-${language}-${width}`));await guide.click();
   const details=page.locator(".account-relation-details>summary");await details.click();shots.push(await screenshot(page,`connections-${language}-${width}`));
   expect(await page.locator('.account-relation-details').evaluate(e=>e.getBoundingClientRect().bottom<=e.closest('.asset-relations-card')!.getBoundingClientRect().bottom+1)).toBe(true);await details.click();
   const expanded=page.locator(".account-graph-fullscreen");await expanded.click();await expect(expanded).toHaveAttribute("aria-pressed","true");shots.push(await screenshot(page,`fullscreen-${language}-${width}`));await page.keyboard.press("Escape");await expect(expanded).toHaveAttribute("aria-pressed","false");
  }
  await page.setViewportSize({width:1280,height:800});await page.locator(".page-header").getByRole("button",{name:t("edit"),exact:true}).click();await page.locator("#password-vault-entry-title").fill("Long account title · 很长的账号名称 ".repeat(5));await page.locator("#password-vault-entry-notes").fill("Long account notes / 很长的备注\n".repeat(100));await page.locator("#password-vault-entry-url").fill("https://account.example.test/"+"long-path-segment/".repeat(18));await save(page,t);
  for(const width of [390,768,1280,1920,1991]){await page.setViewportSize({width,height:width===1280?800:990});await page.evaluate(()=>scrollTo(0,0));shots.push(await screenshot(page,`long-${language}-${width}`));expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);expect(await page.locator('.account-note-summary p').evaluate(e=>e.clientHeight)).toBeGreaterThanOrEqual(32);expect(await page.locator('.account-history-card').evaluate(e=>e.getBoundingClientRect().bottom<=e.closest('main')!.getBoundingClientRect().bottom+1)).toBe(true)}
  writeFileSync(join(output,`visual-${language}.json`),JSON.stringify({ids:["AS02","AS03","AS04"],candidate:portableCandidate(),screenshots:shots,status:"machine geometry only; manual review separate"},null,2));
 });

 test(`${language} AS05 AS09 AS10 AS11 private account history and template navigation`,async({page})=>{
  await page.setViewportSize({width:1280,height:900});await page.goto("/accounts");await page.locator("#password-vault-master").fill(master);await page.locator("#password-vault-master-confirm").fill(master);await page.getByRole("button",{name:t("accountSetUp"),exact:true}).click();
  await importVisualKdbxEntries(page,t,[{title:"Private related",username:"first@example.test",password:"Synthetic private password",notes:"Private original notes"},{title:"Private related",username:"second@example.test",password:"Other synthetic password"}],async dialog=>{
   await injectMemoryFailure(page);await dialog.getByRole('button',{name:t('pwVaultImportNow'),exact:true}).click();
   await expect(dialog.getByRole('alert')).toHaveText(t('pwVaultMemoryUnavailable'));await expect(dialog.locator('#password-vault-import-password')).not.toHaveValue('');expect(await dialog.locator('#password-vault-import-file').evaluate((e:HTMLInputElement)=>e.files?.length)).toBe(1);await screenshot(page,`import-memory-${language}`);
  });
  await openAccountOption(page,t,'pwVaultImport');await page.locator('#password-vault-import-password').fill('Synthetic cancelled import password');await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await openAccountOption(page,t,'pwVaultImport');await expect(page.locator('#password-vault-import-password')).toHaveValue('');await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);expect(await page.locator('#password-vault-import-file').evaluate((e:HTMLInputElement)=>e.files?.length)).toBe(0);await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();
  await card(page,"first@example.test").locator(".compact-account-title-block").click();await expect(page.locator(".account-related-link")).toHaveCount(1);await page.locator(".page-header").getByRole("button",{name:t("edit"),exact:true}).click();await page.locator("#password-vault-entry-notes").fill("Private updated notes");await save(page,t);await page.locator(".account-history-row").first().getByRole("button").click();await page.getByRole("dialog").getByRole("button",{name:t("pwVaultHistoryRestore"),exact:true}).click();await expect(page.locator(".account-note-summary")).toContainText("Private original notes");
  await screenshot(page,`private-history-${language}`);await page.locator(".page-header").getByRole("button",{name:t("add"),exact:true}).click();await expect(page.locator("#password-vault-entry-username")).toHaveValue("");await expect(page.locator("#password-vault-entry-password")).toHaveValue("");await page.locator("#password-vault-entry-username").fill("child@example.test");await save(page,t);await card(page,"first@example.test").locator(".compact-account-title-block").click();await expect(page.locator(".account-related-link").first()).toContainText(t("accountRelated_template"));await page.locator(".account-related-link").first().click();await expect(page.locator(".account-login-summary [data-login-username]")).toHaveText("child@example.test");
 });
 });
}
