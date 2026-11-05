import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { newAsset, taskSchema } from '../../packages/domain/src';
import { resources } from '../../apps/web/src/i18n';
import { defaultReminderSettings, dueReminders } from '../../apps/web/src/reminders';
import { prepareCompletionArchive, restoreCompletionArchive } from './helpers/completion-archive';
import { acceptanceCandidate } from './helpers/acceptance-candidate';

const password='FictionalUnifiedAssets2026!';
const now=new Date('2026-11-05T04:00:00Z');
let fixture:string;
test.beforeAll(async({},info)=>{
 fixture=resolve(process.env.KEEPANY_EVIDENCE_DIR??'test-results/unified-local',`unified-fixture-${info.workerIndex}`);
 await prepareCompletionArchive(fixture,password,async repo=>{
  const category=await repo.saveCatalogCategory(null,{name:'家庭资料 / Family records'});
  const assets=[{...newAsset('project'),id:'unify-note',name:'Fixture receipt / 虚构收据',catalogCategoryId:category.id},{...newAsset('item'),id:'unify-item',name:'Minimal adapter / 极简插头'},{...newAsset('subscription'),id:'unify-sub',name:'Annual document / 文档年费',currency:'USD' as const,amount:4900,cycle:'year' as const,dueDate:'2026-11-07'},{...newAsset('project'),id:'unify-wallet',name:'Fictional transit / 虚构交通卡',walletCard:{type:'storedValue' as const,issuer:'Fictional issuer',lastFour:'0826',balanceMinor:8600,remainingUses:null}}];
  const task=taskSchema.parse({id:'unify-due-task',name:'Fictional due reminder / 虚构到期提醒',dueDate:'2026-11-05',createdAt:now.toISOString()});
  const settings={...defaultReminderSettings(),timeZone:'UTC',time:'01:00',subscriptionEnabled:false};
  expect(dueReminders([task],assets,settings,now.getTime())).toHaveLength(1);
  await repo.saveBatch([...assets.map(value=>({type:'asset' as const,value})),{type:'task',value:task},{type:'preference',value:{id:'reminder-settings',value:settings}},{type:'preference',value:{id:'subscriptionCnyRatesV1',value:{USD:'6.7'}}}]);
  return {categoryId:category.id};
 });
});
const t=(locale:'zh-CN'|'en')=>(key:string)=>(resources[locale].translation as Record<string,string>)[key];
const identity=()=>acceptanceCandidate().release.webFiles.find(f=>f.path==='index.html')!.sha256;
async function start(page:Page,locale:'zh-CN'|'en'){
 await page.addInitScript(l=>localStorage.setItem('keepany-language',l),locale);await page.clock.setFixedTime(now);
 await page.goto('/assets');await expect(page.locator('.workspace-navigation')).toBeVisible();
 expect(createHash('sha256').update(await (await page.request.get('/')).body()).digest('hex')).toBe(identity());
 await restoreCompletionArchive(page,password,resolve(fixture,'fixture.ka1'));
}
async function assets(page:Page){await page.goto('/assets');await expect(page.getByRole('heading',{level:1,name:/^(资产|Assets)$/})).toBeVisible();}

for(const locale of ['zh-CN','en'] as const){
 test(`${locale} U08 asset detail reminder row removed with live positive control`,async({page},info)=>{
  await start(page,locale);await page.goto('/tasks');await expect(page.locator('.reminder-runtime-banner')).toHaveCount(1);
  await assets(page);await page.locator('.asset-summary-card').filter({hasText:'Fixture receipt'}).click();await expect(page.getByRole('heading',{level:1,name:'Fixture receipt / 虚构收据'})).toBeVisible();
  await page.screenshot({path:info.outputPath('asset-detail-reminder.png')});await expect(page.locator('.reminder-runtime-banner')).toHaveCount(0);
  await info.attach('contract-results.json',{body:JSON.stringify({ids:['U08'],locale,candidate:identity(),result:'passed'}),contentType:'application/json'});
 });
 test(`${locale} U09 card surfaces keep colors during interaction`,async({page},info)=>{
  await start(page,locale);await assets(page);
  const samples=['Fixture receipt','Minimal adapter','Annual document','Fictional transit'];
  const states=[];
  for(const width of [390,768,1280,1920,2262]){
   await page.setViewportSize({width,height:1000});await expect.poll(()=>page.locator('.asset-summary-card').first().evaluate(el=>el.getBoundingClientRect().width>0)).toBe(true);
   for(const name of samples){
    const card=page.locator('.asset-summary-card').filter({hasText:name});await page.mouse.move(0,0);await card.scrollIntoViewIfNeeded();
    const read=()=>card.evaluate(el=>{const style=getComputedStyle(el);return {background:style.backgroundColor,transform:style.transform,outline:style.outlineColor,border:style.borderTopColor,focused:el.matches(':focus-visible')};});
    const normal=await read();await card.hover();const hover=await read();
    await info.attach(`surface-${width}-${name.replaceAll(' ','-')}.json`,{body:JSON.stringify({normal,hover}),contentType:'application/json'});
    expect(hover.background).toBe(normal.background);expect(hover.transform).not.toBe('none');
    await page.mouse.move(0,0);await page.keyboard.press('Tab');await card.focus();const focus=await read();expect(focus.background).toBe(normal.background);expect(focus.focused).toBe(true);expect(focus.outline).toBe(normal.border);
    const box=await card.boundingBox();await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();const pressed=await read();expect(pressed.background).toBe(normal.background);expect(pressed.transform).not.toBe('none');
    if(name==='Fictional transit')await page.screenshot({path:info.outputPath(`surface-pressed-${width}.png`)});
    await page.mouse.move(0,0);await page.mouse.up();states.push({width,name,normal,hover,focus,pressed});
   }
   await page.screenshot({path:info.outputPath(`surface-normal-${width}.png`)});
  }
  await info.attach('surface-all.json',{body:JSON.stringify(states),contentType:'application/json'});
  await info.attach('contract-results.json',{body:JSON.stringify({ids:['U09'],locale,candidate:identity(),result:'passed'}),contentType:'application/json'});
 });
 for(const width of [390,768,1280,1920,2262])test(`${locale} ${width} U02 U04 U08 unified asset entries`,async({page},info)=>{
  const copy=t(locale);await page.setViewportSize({width,height:1000});await start(page,locale);await assets(page);
  await expect(page.locator('a[href="/finance"]')).toHaveCount(0);await expect(page.locator('.reminder-runtime-banner')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('all.png')});
  for(const kind of ['item','subscription','wallet']){
   await page.locator(`.workspace-navigation a[href="${kind==='wallet'?'/cards':`/assets/${kind}`}"]`).click();await expect(page.getByRole('heading',{level:1,name:copy(kind),exact:true})).toBeVisible();await expect(page.locator('.asset-summary-card')).toHaveCount(1);
   await expect(page.locator('.reminder-runtime-banner')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`${kind}.png`)});
   await page.locator('.asset-summary-card').click();await expect(page.locator('.workspace-navigation')).toHaveCount(0);await expect(page.locator('.reminder-runtime-banner')).toHaveCount(0);await page.screenshot({path:info.outputPath(`${kind}-detail.png`)});
   await page.locator('.topbar-back-link').click();await expect(page.locator('.workspace-navigation')).toBeVisible();
  }
  await assets(page);await page.locator('.workspace-navigation').getByRole('link',{name:'家庭资料 / Family records',exact:true}).click();await expect(page.locator('.asset-summary-card')).toHaveCount(1);await page.locator('.asset-summary-card').click();await expect(page.getByRole('heading',{level:1,name:'Fixture receipt / 虚构收据'})).toBeVisible();await expect(page.locator('.reminder-runtime-banner')).toHaveCount(0);await page.screenshot({path:info.outputPath('ordinary-detail.png')});
  await info.attach('contract-results.json',{body:JSON.stringify({ids:['U02','U04','U08'],locale,width,candidate:identity(),result:'passed'}),contentType:'application/json'});
 });
}
