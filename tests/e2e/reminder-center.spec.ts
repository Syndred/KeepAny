import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { newAsset, taskSchema } from "../../packages/domain/src";
import { createMaintenanceSchedule } from "../../packages/domain/src/task-repeat";
import { resources } from "../../apps/web/src/i18n";
import { acceptanceCandidate } from "./helpers/acceptance-candidate";
import { prepareCompletionArchive, restoreCompletionArchive } from "./helpers/completion-archive";

const evidence = process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/reminder-center";
const fixture = resolve(evidence, "fixture"), password = "FictionalReminders2026!";
const identity = () => acceptanceCandidate().release.webFiles.find(file => file.path === "index.html")!.sha256;
type Locale = "zh-CN" | "en";
const text = (locale: Locale) => (key: string) => (resources[locale].translation as Record<string, string>)[key] ?? key;
const center = (page: Page) => page.getByTestId("reminder-center");
const bell = (page: Page) => page.getByTestId("reminder-bell");
const row = (page: Page, id: string) => page.locator(`[data-reminder-id="${id}"]`);
async function shot(page: Page, info: TestInfo, name: string) { const path=info.outputPath(`${name}.png`); await page.screenshot({path,fullPage:false}); return path; }
async function receipt(info: TestInfo, ids: string[], extra = {}) { await info.attach("contract-results.json",{body:JSON.stringify({ids,candidate:identity(),result:"passed",...extra}),contentType:"application/json"}); }

test.beforeAll(async () => {
 await prepareCompletionArchive(resolve(fixture,"single"),password,async repo=>{
  await repo.save("task",taskSchema.parse({id:"nr-single",name:"One reminder / 单条提醒",dueDate:"2026-11-05",createdAt:"2026-11-01T00:00:00Z"}));
  return {tasks:1};
 });
 await prepareCompletionArchive(fixture,password,async repo => {
  const rows = [
   {...newAsset("subscription"),id:"nr-renew",name:"CloudNest hosting / 云主机续费",dueDate:"2026-11-03",billingAnchor:"2026-11-03"},
   {...newAsset("item"),id:"nr-item",name:"Work laptop / 工作笔记本",warrantyDate:"2026-11-05"},
   {...newAsset("project"),id:"nr-project",name:"Studio / 工作室",dueDate:"2026-11-10"},
   {...newAsset("subscription"),id:"nr-later",name:"Future renewal / 远期续费",dueDate:"2026-12-20",billingAnchor:"2026-12-20"},
   {...newAsset("subscription"),id:"nr-paused",name:"Paused must not remind",status:"paused" as const,dueDate:"2026-11-04"},
  ];
  for(const asset of rows) await repo.save("asset",asset);
  const tasks=[
   {id:"nr-linked",name:"Check laptop warranty / 检查笔记本保修",assetId:"nr-item",dueDate:"2026-11-05"},
   {id:"nr-alone",name:"Standalone item / 未关联事项",dueDate:"2026-11-05"},
   {id:"nr-undated",name:"Undated historical / 无日期历史事项",dueDate:""},
   {id:"nr-done",name:"Completed historical / 已完成历史事项",dueDate:"2026-11-04",done:true},
   {id:"nr-deleted",name:"Deleted must not remind",dueDate:"2026-11-04",deleted:true},
   {id:"nr-paused-linked",name:"Paused owner must not remind",assetId:"nr-paused",dueDate:"2026-11-05"},
   {id:"nr-plan",name:"Recurring maintenance / 循环维护",assetId:"nr-item",dueDate:"2026-11-06",maintenancePlan:{active:true,schedule:createMaintenanceSchedule({dueDate:"2026-11-06",leadDays:2,rule:{mode:"fixed",every:1,unit:"month"}}),records:[],deferredUntil:""}},
   {id:"nr-long",name:"长内容提醒 Long reminder title / ".repeat(7),dueDate:"2026-11-07"},
   ...Array.from({length:12},(_,i)=>({id:`nr-many-${i}`,name:`Additional reminder ${i+1} / 更多提醒`,dueDate:"2026-11-10"})),
  ];
  for(const task of tasks)await repo.save("task",taskSchema.parse({createdAt:"2026-11-01T00:00:00Z",...task}));
  return {assets:rows.length,tasks:tasks.length,kind:"synthetic-preparation-consumed-through-visible-restore"};
 });
});
async function start(page:Page,locale:Locale,populated=true) {
 await page.addInitScript(language=>localStorage.setItem("keepany-language",language),locale);
 await page.clock.setFixedTime(new Date("2026-11-05T04:00:00Z"));
 await page.goto("/");await expect(bell(page)).toBeVisible();
 expect(createHash("sha256").update(await(await page.request.get("/")).body()).digest("hex")).toBe(identity());
 if(populated){await restoreCompletionArchive(page,password,resolve(fixture,"fixture.ka1"));await overview(page);}
}
async function overview(page:Page){ if (await page.locator(".mobile-menu").isVisible()) await page.locator(".mobile-menu").click(); await page.locator('.sidebar nav a[href="/"]').click(); }
async function open(page:Page){await bell(page).click();await expect(center(page)).toBeVisible();}
for(const locale of ["zh-CN","en"] as const){
 const t=text(locale);
 test(`${locale} NR01-05 grouping read-state persistence and keyboard`,async({page},info)=>{
  await start(page,locale,false);await open(page);await expect(center(page)).toContainText(t("reminderCenterEmpty"));
  const screenshots=[await shot(page,info,"empty")];await page.keyboard.press("Escape");await expect(center(page)).toHaveCount(0);await expect(bell(page)).toBeFocused();
  await restoreCompletionArchive(page,password,resolve(fixture,"fixture.ka1"));await overview(page);
  await bell(page).focus();await page.keyboard.press("Enter");await expect(center(page)).toBeVisible();
  await expect(row(page,"renew-nr-renew")).toBeVisible();await expect(row(page,"task-nr-linked")).toBeVisible();
  await expect(center(page)).not.toContainText(/Paused must|Completed historical|Deleted must|Paused owner/);
  await expect(row(page,"renew-nr-later")).toHaveCount(1);await expect(row(page,"task-nr-undated")).toHaveCount(1);
  const initial=await center(page).locator('[data-reminder-id][data-read="false"]').count();expect(initial).toBeGreaterThan(10);
  screenshots.push(await shot(page,info,"populated"));
  await center(page).getByRole("button",{name:t("reminderCenterMarkAllRead"),exact:true}).click();
  await expect(center(page).locator('[data-reminder-id][data-read="false"]')).toHaveCount(0);
  await expect(center(page).locator('[data-reminder-id]')).toHaveCount(initial);
  screenshots.push(await shot(page,info,"all-read"));await page.keyboard.press("Escape");await page.reload();await open(page);
  await expect(center(page).locator('[data-reminder-id][data-read="false"]')).toHaveCount(0);
  await center(page).getByRole("tab",{name:/未读|Unread/}).click();await expect(center(page).locator('[data-reminder-id]')).toHaveCount(0);
  screenshots.push(await shot(page,info,"unread-empty"));await receipt(info,["NR01","NR02","NR03","NR04","NR05"],{screenshots});
 });
 test(`${locale} NR06-10 source and standalone editing completion legacy links`,async({page},info)=>{
  await start(page,locale);await open(page);await row(page,"task-nr-linked").click();
  await expect(page).toHaveURL(/\/assets\/item\/nr-item#reminder-task-nr-linked$/);
  const source=page.locator(".reminder-task-context");await expect(source).toContainText("Check laptop warranty");
  await source.getByRole("button",{name:t("moreActions"),exact:true}).click();await page.getByRole("menuitem",{name:t("edit"),exact:true}).click();
  const dialog=page.locator(".dialog");await expect(dialog.locator('[name="taskName"]')).toBeVisible();
  await dialog.locator('[name="taskName"]').fill("Cancelled changes");await dialog.getByRole("button",{name:t("cancel"),exact:true}).click();
  await expect(source).toContainText("Check laptop warranty");await source.getByRole("button",{name:t("complete"),exact:true}).click();await expect(source.getByRole("button",{name:t("reopen"),exact:true})).toBeVisible();
  const screenshots=[await shot(page,info,"source-completed")];await page.reload();await expect(source.getByRole("button",{name:t("reopen"),exact:true})).toBeVisible();
  await source.getByRole("button",{name:t("close"),exact:true}).click();await expect(source).toHaveCount(0);await expect(bell(page)).toBeFocused();
  await page.goto("/tasks#task-nr-alone");await expect(page).toHaveURL(/\/#reminder-task-nr-alone$/);await expect(center(page)).toContainText("Standalone item");
  await center(page).getByRole("button",{name:t("moreActions"),exact:true}).click();await page.getByRole("menuitem",{name:t("edit"),exact:true}).click();
  await dialog.locator('[name="taskName"]').fill("");await dialog.getByRole("button",{name:t("save"),exact:true}).click();await expect(dialog).toContainText(t("required"));
  screenshots.push(await shot(page,info,"standalone-validation"));await dialog.locator('[name="taskName"]').fill("Revised standalone / 已修改事项");await dialog.getByRole("button",{name:t("save"),exact:true}).click();
  await expect(dialog).toHaveCount(0);await expect(center(page)).toContainText("Revised standalone");await page.keyboard.press("Escape");await page.reload();await expect(center(page)).toContainText("Revised standalone");
  await center(page).getByRole("button",{name:t("complete"),exact:true}).click();await expect(center(page).getByRole("button",{name:t("reopen"),exact:true})).toBeVisible();
  await page.keyboard.press("Escape");await page.goto("/tasks#task-nr-done");await expect(center(page)).toContainText("Completed historical");
  await page.keyboard.press("Escape");await page.goto("/tasks#task-missing");await expect(center(page)).toContainText(t("reminderCenterMissingTask"));
  screenshots.push(await shot(page,info,"missing-item"));await page.keyboard.press("Escape");
  await page.goto("/tasks");await expect(center(page)).toBeVisible();await expect(page.locator(".tasks-page")).toHaveCount(0);await expect(page.locator('a[href^="/tasks"]')).toHaveCount(0);
  await page.keyboard.press("Escape");await page.locator(".overview-countdown-footer").getByRole("button",{name:t("reminderEntryOpen"),exact:true}).click();await expect(center(page)).toBeVisible();await page.keyboard.press("Escape");
  await page.locator(".overview-panels > section").first().getByRole("button",{name:t("viewAll"),exact:true}).click();await page.locator(".overview-countdown-dialog").getByRole("button",{name:t("reminderEntryOpen"),exact:true}).click();await expect(center(page)).toBeVisible();await page.keyboard.press("Escape");
  await page.getByRole("button",{name:t("globalSearch"),exact:true}).click();await page.locator("#top-search-query").fill("Undated historical");
  await page.locator(".reminder-search-result").click();await expect(center(page)).toContainText("Undated historical");
  screenshots.push(await shot(page,info,"search-undated"));await receipt(info,["NR06","NR07","NR08","NR09","NR10","NR14"],{screenshots});
 });
 test(`${locale} NR05 explicit standalone link marks the opened occurrence read`,async({page},info)=>{
  await start(page,locale);await page.goto("/tasks#task-nr-alone");await expect(center(page)).toContainText("Standalone item");
  await center(page).getByRole("button",{name:t("reminderCenterBackToList"),exact:true}).click();
  await expect(row(page,"task-nr-alone")).toHaveAttribute("data-read","true");
  await receipt(info,["NR04","NR05","NR10"],{screenshots:[await shot(page,info,"standalone-marked-read")]});
 });
 test(`${locale} NR05 NR11 storage failure is visible and can recover`,async({page},info)=>{
  await start(page,locale);await open(page);
  const initial=await center(page).locator('[data-read="false"]').count();
  await page.evaluate(()=>{
   const proto=IDBObjectStore.prototype,put=proto.put,add=proto.add;
   (window as Window & {restoreReminderWrites?:()=>void}).restoreReminderWrites=()=>{proto.put=put;proto.add=add;};
   proto.put=function(){throw new DOMException("Synthetic isolated write failure","QuotaExceededError");};
   proto.add=function(){throw new DOMException("Synthetic isolated write failure","QuotaExceededError");};
  });
  await center(page).getByRole("button",{name:t("reminderCenterMarkAllRead"),exact:true}).click();
  await expect(center(page).getByRole("alert")).toBeVisible();await expect(center(page).locator('[data-read="false"]')).toHaveCount(initial);
  const screenshots=[await shot(page,info,"write-error")];
  await page.evaluate(()=>(window as Window & {restoreReminderWrites?:()=>void}).restoreReminderWrites?.());
  await center(page).getByRole("button",{name:t("reminderCenterMarkAllRead"),exact:true}).click();await expect(center(page).locator('[data-read="false"]')).toHaveCount(0);
  screenshots.push(await shot(page,info,"write-recovered"));await receipt(info,["NR05","NR11"],{screenshots,injected:"standard IndexedDB add/put failure in isolated browser; then restored"});
 });
 test(`${locale} NR11 local storage unavailable shows load error`,async({page},info)=>{
  await page.setViewportSize({width:390,height:1000});
  await page.addInitScript(()=>{Object.defineProperty(indexedDB,"open",{value:()=>{throw new DOMException("Isolated unavailable storage","InvalidStateError");}});});
  await start(page,locale,false);await open(page);await expect(center(page).getByRole("alert")).toContainText(t("reminderCenterLoadFailed"));
  await expect(center(page).getByRole("button",{name:t("reminderCenterMarkAllRead"),exact:true})).toBeDisabled();
  await expect(page.locator(".toast.error")).toHaveCount(0);await expect(center(page).getByRole("button",{name:t("reminderCenterReload"),exact:true})).toBeVisible();
  await receipt(info,["NR11"],{screenshots:[await shot(page,info,"storage-load-error")],injected:"IndexedDB.open throws in isolated browser; no source records"});
 });
 test(`${locale} NR13 immediate shell feedback stays inside mobile panel`,async({page},info)=>{
  await page.setViewportSize({width:390,height:1000});await start(page,locale,false);
  await restoreCompletionArchive(page,password,resolve(fixture,"fixture.ka1"));await open(page);
  await expect(center(page).locator(".reminder-center-notice")).toBeVisible();await expect(page.locator(".toast")).toHaveCount(0);
  const notice=await center(page).locator(".reminder-center-notice").boundingBox(),list=await page.getByTestId("reminder-list").boundingBox();
  expect(notice!.y+notice!.height).toBeLessThanOrEqual(list!.y+1);
  await receipt(info,["NR11","NR13","NR14"],{screenshots:[await shot(page,info,"mobile-shell-feedback")]});
 });
 test(`${locale} NR12 recurrence and midnight update`,async({page},info)=>{
  await start(page,locale);await page.goto("/tasks#task-nr-plan");const source=page.locator(".reminder-task-context");await expect(source).toContainText("Recurring maintenance");
  await source.getByRole("button",{name:t("maintenanceComplete"),exact:true}).click();
  const form=source.locator(".maintenance-action-form");await expect(form).toBeVisible();await form.getByRole("button",{name:t("cancel"),exact:true}).click();
  await expect(form).toHaveCount(0);await expect(source).toContainText("Recurring maintenance");
  await source.getByRole("button",{name:t("maintenanceComplete"),exact:true}).click();
  await form.locator("textarea").fill("Fictional device cleaned and checked / 虚构维护记录");await form.getByRole("button",{name:t("maintenanceSaveRecord"),exact:true}).click();
  await expect(form).toHaveCount(0);await expect(source).toContainText("Fictional device cleaned");await page.reload();await expect(source).toContainText("Fictional device cleaned");
  await page.goto("/");await open(page);await expect(row(page,"task-nr-plan")).toHaveAttribute("data-read","false");
  const todayRow=row(page,"task-nr-alone");await expect(todayRow).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-11-06T04:00:00Z"));await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await expect(todayRow).toContainText(/逾期|overdue/i);await receipt(info,["NR12","NR14"],{screenshots:[await shot(page,info,"next-day")]});
 });
 for(const width of [390,768,1280,1810,1920,2262])test(`${locale} ${width} NR13 responsive states`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});await start(page,locale,false);await open(page);
  const screenshots=[await shot(page,info,"empty")];await page.keyboard.press("Escape");
  await restoreCompletionArchive(page,password,resolve(fixture,"single","fixture.ka1"));await overview(page);await open(page);await expect(center(page).locator("[data-reminder-id]")).toHaveCount(1);screenshots.push(await shot(page,info,"single"));await page.keyboard.press("Escape");
  await restoreCompletionArchive(page,password,resolve(fixture,"fixture.ka1"));await overview(page);await open(page);
  await row(page,"task-nr-linked").hover();screenshots.push(await shot(page,info,"hover"));
  await row(page,"task-nr-linked").focus();screenshots.push(await shot(page,info,"focus"));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const bounds=await center(page).boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(1001);
  await row(page,"task-nr-long").scrollIntoViewIfNeeded();screenshots.push(await shot(page,info,"long-content"));
  await row(page,"task-nr-undated").scrollIntoViewIfNeeded();screenshots.push(await shot(page,info,"scroll-bottom"));
  await center(page).getByRole("button",{name:t("reminderCenterMarkAllRead"),exact:true}).click();await expect(center(page).locator('[data-read="false"]')).toHaveCount(0);
  screenshots.push(await shot(page,info,"all-read"));await center(page).getByRole("tab",{name:/未读|Unread/}).click();screenshots.push(await shot(page,info,"unread-empty"));
  await page.keyboard.press("Escape");await expect(center(page)).toHaveCount(0);await expect(bell(page)).toBeFocused();
  await page.goto("/tasks#task-nr-alone");await expect(center(page)).toContainText("Standalone item");screenshots.push(await shot(page,info,"expanded-item"));
  await center(page).getByRole("button",{name:t("complete"),exact:true}).click();await expect(center(page).locator(".reminder-center-task-feedback")).toContainText(t("saved"));
  await expect(center(page).getByRole("button",{name:t("reopen"),exact:true})).toBeVisible();screenshots.push(await shot(page,info,"inline-completed"));
  await receipt(info,["NR01","NR02","NR04","NR07","NR13","NR14"],{locale,width,screenshots});
 });
}


