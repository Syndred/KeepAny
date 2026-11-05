import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {resources} from '../../apps/web/src/i18n';
import {portableCandidate} from './helpers/portable-candidate';
import {waitForAccountGraphLayout} from './helpers/account-graph';

const out=resolve(process.env.KEEPANY_SCROLL_EVIDENCE??'test-results/natural-scroll/evidence');mkdirSync(out,{recursive:true});
const sizes=[{width:390,height:900},{width:768,height:900},{width:1280,height:720},{width:1920,height:1080},{width:2262,height:1344}];
const routes=['/','/assets','/assets/item','/assets/subscription','/cards','/assets/project','/assets/domains','/accounts','/collections','/trash','/backup','/settings','/intake','/assistant-access','/tasks','/change-impact','/finance'];
const master='Synthetic natural scroll 2026!';type T=(key:string)=>string;
async function ready(page:Page){
 await page.waitForFunction(()=>{const m=document.querySelector('main.page');return m&&!m.textContent?.includes('正在打开资料…')&&!m.textContent?.includes('Opening your data…')});
 await page.evaluate(()=>document.fonts.ready);
 await expect.poll(()=>page.locator('.sidebar').evaluate(e=>innerWidth>760||e.getBoundingClientRect().right<=0)).toBe(true);
 await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
}
async function shot(page:Page,name:string){const file=join(out,name+'.png');await page.screenshot({path:file});return file;}
async function receipt(info:TestInfo,ids:string[],shots:string[],extra:unknown={}){
 const value={ids,candidate:portableCandidate(),status:info.errors.length?'failed':'passed',shots,extra};
 const file=join(out,info.title.replace(/[^a-zA-Z0-9-]/g,'_')+'.json');writeFileSync(file,JSON.stringify(value,null,2));await info.attach('contract-results.json',{path:file,contentType:'application/json'});
}
async function samples(page:Page,t:T){await page.goto('/');await page.getByRole('button',{name:t('overviewTrySample'),exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:t('loadSample'),exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}
async function save(page:Page,t:T){await page.getByRole('dialog').getByRole('button',{name:t('save'),exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}
async function natural(page:Page,selector:string){const values=await page.locator(selector).evaluate(e=>({client:e.clientHeight,scroll:e.scrollHeight,max:getComputedStyle(e).maxHeight,overflow:getComputedStyle(e).overflowY}));expect.soft(values.scroll-values.client).toBeLessThanOrEqual(1);expect.soft(values.max).toBe('none');return values;}

for(const language of ['zh-CN','en'] as const){const t:T=key=>(resources[language].translation as Record<string,string>)[key]??key;
 test.describe(language,()=>{test.use({locale:language});test.beforeEach(async({page})=>{await page.addInitScript(v=>localStorage.setItem('keepany-language',v),language)});
 test(`${language} NF01 short pages and real document overflow`,async({page},info)=>{
  const shots:string[]=[],measurements:unknown[]=[];
  for(const route of routes){for(const size of sizes){await page.setViewportSize(size);await page.goto(route);await ready(page);
   const value=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth,pageBottom:document.querySelector('main.page')!.getBoundingClientRect().bottom,sidebarMinimum:[...document.querySelector('.sidebar')!.children].reduce((n,e)=>n+(e as HTMLElement).offsetHeight,0)+42}));
   expect.soft(value.scrollWidth).toBeLessThanOrEqual(value.width+1);
   if(size.width>=768&&value.pageBottom<=size.height-2&&value.sidebarMinimum<=size.height-4)expect.soft(value.scroll).toBeLessThanOrEqual(size.height+1);
   measurements.push({route,size,...value});if(size.width===2262&&!['/tasks','/change-impact','/finance'].includes(route))shots.push(await shot(page,`root-${language}-${route.replaceAll('/','_')}-${size.width}`));
  }}await receipt(info,['NF01'],shots,{measurements});
 });
 test(`${language} NF02 NF05 natural account reading and viewport dialog`,async({page},info)=>{
  const shots:string[]=[];await page.setViewportSize(sizes.at(-1)!);await page.goto('/accounts');await page.locator('#password-vault-master').fill(master);await page.locator('#password-vault-master-confirm').fill(master);await page.getByRole('button',{name:t('accountSetUp'),exact:true}).click();
  await page.locator('.asset-category-toolbar').getByRole('button',{name:t('add'),exact:true}).click();await page.locator('#password-vault-entry-title').fill('Synthetic reading account');await page.locator('#password-vault-entry-username').fill('reading@example.test');await page.locator('#password-vault-entry-url').fill('https://reading.example.test/');await save(page,t);
  await page.getByRole('link',{name:'Synthetic reading account',exact:true}).click();await waitForAccountGraphLayout(page);const url=page.url();
  await page.locator('.page-header').getByRole('button',{name:t('edit'),exact:true}).click();await page.locator('#password-vault-entry-notes').fill('Cancelled synthetic notes');await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await expect(page.locator('.account-note-summary')).not.toContainText('Cancelled synthetic notes');
  await page.locator('.page-header').getByRole('button',{name:t('edit'),exact:true}).click();await page.locator('#password-vault-entry-notes').fill('Synthetic natural note / 虚构自然展开备注\n'.repeat(45)+'LAST SYNTHETIC LINE');await page.locator('#password-vault-entry-url').fill('https://reading.example.test/'+('long-path/'.repeat(60)));await save(page,t);
  for(const size of sizes){await page.setViewportSize(size);await waitForAccountGraphLayout(page);await natural(page,'.account-note-summary p');await natural(page,'.account-login-url-value');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width+1);await page.locator('.account-history-card').scrollIntoViewIfNeeded();shots.push(await shot(page,`account-end-${language}-${size.width}`));await page.locator('.account-note-summary').scrollIntoViewIfNeeded();shots.push(await shot(page,`account-note-${language}-${size.width}`));}
  await page.reload();await page.locator('#password-vault-unlock-master').fill(master);await page.getByRole('button',{name:t('accountUnlockAction'),exact:true}).click();await waitForAccountGraphLayout(page);await expect(page.locator('.account-note-summary')).toContainText('LAST SYNTHETIC LINE');
  await page.setViewportSize(sizes.at(-1)!);await page.locator('.page-header').getByRole('button',{name:t('edit'),exact:true}).click();
  for(let i=0;i<13;i++)await page.getByRole('dialog').getByRole('button',{name:t('pwVaultAddIdentifier'),exact:true}).click();
  for(const size of [sizes.at(-1)!,sizes[0]]){await page.setViewportSize(size);const dialog=page.getByRole('dialog');const box=await dialog.boundingBox();expect.soft(box!.height).toBeLessThanOrEqual(size.height-31);expect.soft(await dialog.evaluate(e=>getComputedStyle(e).maxHeight)).toBe(`${size.height-32}px`);expect.soft(await dialog.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);await dialog.getByRole('button',{name:t('cancel'),exact:true}).scrollIntoViewIfNeeded();await expect(dialog.getByRole('button',{name:t('cancel'),exact:true})).toBeInViewport();shots.push(await shot(page,`dialog-end-${language}-${size.width}`));}
  await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await expect(page.locator('.page-header').getByRole('button',{name:t('edit'),exact:true})).toBeFocused();await expect(page).toHaveURL(url);
  await receipt(info,['NF02','NF05'],shots);
 });
 test(`${language} NF03 NF04 natural member and MCP lists`,async({page},info)=>{
  const shots:string[]=[];await page.setViewportSize(sizes.at(-1)!);await samples(page,t);await page.goto('/collections');await ready(page);await page.locator('#collection-name').fill('Natural members');
  for(const size of sizes){await page.setViewportSize(size);await ready(page);await natural(page,'.collections-options');const last=page.locator('.collections-option input').last();await last.check();await last.uncheck();shots.push(await shot(page,`members-end-${language}-${size.width}`));}
  await page.locator('.collections-option input').last().check();await page.getByRole('button',{name:t('collectionSave'),exact:true}).click();await expect(page).toHaveURL(/\/collections\/.+/);await page.reload();await ready(page);await expect(page.locator('.collections-member-card')).toHaveCount(1);
  await page.goto('/collections');await ready(page);await page.locator('#collection-search').fill('synthetic no matching item');await expect(page.locator('.collections-option')).toHaveCount(0);await natural(page,'.collections-options');await page.locator('#collection-search').fill('');await expect(page.locator('.collections-option')).toHaveCount(24);
  await page.goto('/settings');await ready(page);await page.locator('#assistant > summary').click();await expect(page.locator('.mcp-asset-list')).toBeVisible();
  for(const size of sizes){await page.setViewportSize(size);await natural(page,'.mcp-asset-list');const last=page.locator('.mcp-asset-list input').last();await last.check();await expect(last).toBeChecked();await last.uncheck();shots.push(await shot(page,`mcp-end-${language}-${size.width}`));}
  await receipt(info,['NF03','NF04'],shots);
 });
 });
}
