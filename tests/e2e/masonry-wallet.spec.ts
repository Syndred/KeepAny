import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resources } from '../../apps/web/src/i18n';
import { newAsset } from '../../packages/domain/src';
import { prepareCompletionArchive, restoreCompletionArchive } from './helpers/completion-archive';
import { acceptanceCandidate } from './helpers/acceptance-candidate';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import { unzipSync, strFromU8 } from 'fflate';

const password='Fictional-wallet-only-2026';
const copy=(locale:'zh-CN'|'en')=>(key:string)=>(resources[locale].translation as Record<string,string>)[key];
const candidate=()=>acceptanceCandidate().release.webFiles.find(f=>f.path==='index.html')!.sha256;
let fixture:string;
test.beforeAll(async({},info)=>{
 fixture=resolve(process.env.KEEPANY_EVIDENCE_DIR??'test-results/masonry-wallet',`fixture-${info.workerIndex}`);
 await prepareCompletionArchive(fixture,password,async db=>{
  const category=await db.saveCatalogCategory(null,{name:'学习 / Learning'});
  const image=await db.putFile(new File([readFileSync('apps/web/public/samples/laptop.png')],'fictional-photo.png',{type:'image/png'}));
  const subscription={...newAsset('subscription'),name:'Annual document',amount:4900,currency:'USD' as const,cycle:'year' as const,dueDate:'2027-02-01',billingAnchor:'2027-02-01'};
  const rows=[{...newAsset('item'),name:'Minimal adapter / 极简插头'},{...newAsset('item'),name:'Photo laptop / 有图电脑',description:'Actual uploaded image / 实际图片',itemPurchasePriceKnown:true,amount:899900,purchaseDate:'2026-01-01',warrantyDate:'2027-01-01',attachments:[image],itemMedia:{coverId:image,detailIds:[],receiptIds:[]}},{...newAsset('subscription'),name:'Monthly cloud / 月付服务',amount:3900,dueDate:'2026-12-01'},subscription,{...newAsset('project'),name:'Photography / 摄影',catalogCategoryId:category.id,description:'Weekend learning / 周末学习',url:'https://learn.example.test/course'},{...newAsset('project'),name:'Long title 很长的标题 '.repeat(7),catalogCategoryId:category.id,description:'Long description 很长的描述 '.repeat(12),url:'https://learn.example.test/'+ 'long/'.repeat(60),tags:['Long tag 很长的标签 '.repeat(3)]},{...newAsset('project'),name:'Archived / 已归档',status:'archived' as const},{...newAsset('project'),name:'Minimal record / 极简记录',catalogCategoryId:category.id}];
  await db.saveBatch([...rows.map(value=>({type:'asset' as const,value})),{type:'history',value:{id:'mw-old-expense',assetId:subscription.id,action:'expense',title:'Historical fee',note:'Fictional historical receipt',eventDate:'2026-10-01',amount:4900,currency:'USD',createdAt:'2026-10-01T00:00:00.000Z'}},{type:'preference',value:{id:'subscriptionCnyRatesV1',value:{USD:'6.7'}}}]);
  return {categoryId:category.id};
 });
});
async function start(page:Page,locale:'zh-CN'|'en',restore=true){
 await page.addInitScript(l=>localStorage.setItem('keepany-language',l),locale);
 await page.goto('/assets');await expect(page.locator('.workspace-navigation')).toBeVisible();
 const response=await page.request.get('/');expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(candidate());
 if(restore){await restoreCompletionArchive(page,password,resolve(fixture,'fixture.ka1'));await page.goto('/assets');await expect(page.locator('.asset-summary-card')).toHaveCount(7);}
}
async function choose(page:Page,label:string,text:string){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:text,exact:true}).click();}
async function geometry(page:Page){
 await expect(page.locator('.workspace-asset-grid')).toHaveAttribute('data-laid-out','true');
 await expect.poll(()=>page.locator('.workspace-asset-grid').evaluate(el=>{const cols=Number(getComputedStyle(el).getPropertyValue('--masonry-columns'));const card=el.firstElementChild as HTMLElement;return Math.abs(card.getBoundingClientRect().width-(el.clientWidth-16*(cols-1))/cols)<1;})).toBe(true);
 const data=await page.locator('.workspace-asset-grid').evaluate(el=>{
  const root=el.getBoundingClientRect();const cards=Array.from(el.children).map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,b:b.bottom,name:n.textContent,top:(n as HTMLElement).style.top,offsetHeight:(n as HTMLElement).offsetHeight};});
  return {columns:Number(getComputedStyle(el).getPropertyValue('--masonry-columns')),root:{bottom:root.bottom},cards};
 });
 await test.info().attach(`geometry-${Date.now()}.json`,{body:JSON.stringify(data),contentType:'application/json'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 for(let i=0;i<data.cards.length;i++)for(let j=i+1;j<data.cards.length;j++){
  const a=data.cards[i],b=data.cards[j];expect(a.x+a.w<=b.x+1 || b.x+b.w<=a.x+1 || a.b<=b.y+1 || b.b<=a.y+1).toBe(true);
 }
 const columns=new Map<number,typeof data.cards>();for(const card of data.cards){const x=Math.round(card.x);columns.set(x,[...(columns.get(x)??[]),card]);}
 for(const cards of columns.values()){cards.sort((a,b)=>a.y-b.y);for(let i=1;i<cards.length;i++)expect(Math.abs(cards[i].y-cards[i-1].b-16)).toBeLessThan(1.1);}
 for(const card of data.cards)expect(card.b).toBeLessThanOrEqual(data.root.bottom+1);
 return data;
}

test('MW01 baseline and final natural-height, masonry, wallet entry',async({page},info)=>{
 await page.setViewportSize({width:1920,height:1000});await start(page,'zh-CN');
 await page.screenshot({path:info.outputPath('natural-height.png'),fullPage:true});
 const minimal=page.locator('.asset-summary-card').filter({hasText:'Minimal adapter'});
 const box=await minimal.boundingBox();await info.attach('observed.json',{body:JSON.stringify({height:box?.height,candidate:candidate()}),contentType:'application/json'});
 expect(box!.height).toBeLessThan(160);
 const data=await geometry(page);expect(data.columns).toBe(4);expect(new Set(data.cards.map(c=>c.h)).size).toBeGreaterThan(2);
 for(const width of [1280,768,390,1920]){await page.setViewportSize({width,height:1000});await geometry(page);}
 await expect(page.locator('.summary-card-photo img')).toBeVisible();await expect.poll(()=>page.locator('.summary-card-photo img').evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
 await expect(page.locator('.workspace-navigation a[href="/cards"]')).toBeVisible();await expect(page.locator('a[href="/finance"]')).toHaveCount(0);
 await minimal.focus();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{level:1,name:'Minimal adapter / 极简插头'})).toBeVisible();
});

for(const locale of ['zh-CN','en'] as const){
 test(`${locale} MW02-06 wallet CRUD, samples, filtering and archive`,async({page,context},info)=>{
  const t=copy(locale);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await start(page,locale);
  await page.locator('.workspace-navigation a[href="/cards"]').click();await expect(page.locator('.empty')).toBeVisible();
  await page.getByRole('button',{name:t('walletSamples'),exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await expect(page.locator('.asset-summary-card')).toHaveCount(0);
  await page.getByRole('button',{name:t('workspaceAddAsset'),exact:true}).click();let dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:t('save'),exact:true}).click();await expect(dialog.locator('#catalog-record-name')).toHaveAttribute('aria-invalid','true');
  await dialog.locator('#catalog-record-name').fill('Fictional card / 虚构卡片');await dialog.locator('#wallet-balance').fill('-1');await dialog.locator('#wallet-uses').fill('1.5');await dialog.getByRole('button',{name:t('save'),exact:true}).click();await expect(dialog.locator('#wallet-balance')).toHaveAttribute('aria-invalid','true');await expect(dialog.locator('#wallet-uses')).toHaveAttribute('aria-invalid','true');
  await dialog.locator('#wallet-balance').fill('0');await dialog.locator('#wallet-uses').fill('0');await dialog.locator('#wallet-last-four').fill('12345');await dialog.getByRole('button',{name:t('save'),exact:true}).click();await expect(dialog.locator('#wallet-last-four')).toHaveAttribute('aria-invalid','true');
  await dialog.locator('#wallet-last-four').fill('0826');await dialog.locator('#wallet-issuer').fill('Fictional club / 虚构发行方');await dialog.getByRole('button',{name:t('save'),exact:true}).click();await expect(dialog).toBeHidden();await expect(page.locator('.asset-summary-card')).toHaveCount(1);await expect(page.locator('.wallet-card-values')).toContainText('0.00');await page.reload();
  await page.locator('.asset-summary-card').click();await expect(page.getByRole('heading',{name:'Fictional card / 虚构卡片',exact:true})).toBeVisible();await expect(page.locator('.back-link')).toHaveAttribute('href','/cards');await expect(page.locator('.topbar-back-link')).toHaveAttribute('href','/cards');
  await page.getByRole('button',{name:t('edit'),exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('#wallet-balance').fill('78.25');await dialog.getByRole('button',{name:t('cancel'),exact:true}).click();await expect(page.locator('.wallet-card-values')).toContainText('0.00');
  await page.getByRole('button',{name:t('edit'),exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('#wallet-balance').fill('78.25');await dialog.locator('#wallet-uses').fill('');await dialog.getByRole('button',{name:t('save'),exact:true}).click();await expect(dialog).toBeHidden();await page.reload();await expect(page.locator('.wallet-card-values')).toContainText('78.25');await expect(page.locator('.wallet-card-values')).not.toContainText(t('walletRemaining'));
  await page.locator('.back-link').click();await page.getByRole('button',{name:t('walletSamples'),exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:t('walletSamples'),exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();await expect(page.locator('.asset-summary-card')).toHaveCount(5);await page.reload();await expect(page.locator('.asset-summary-card')).toHaveCount(5);await expect(page.getByRole('button',{name:t('walletSamples'),exact:true})).toHaveCount(0);
  await page.getByRole('searchbox',{name:t('workspaceSearch')}).fill('0826');await expect(page.locator('.asset-summary-card')).toHaveCount(2);await page.reload();await expect(page.locator('.asset-summary-card')).toHaveCount(2);await page.getByRole('searchbox',{name:t('workspaceSearch')}).fill('');await choose(page,t('assetStatusView'),t('all'));await choose(page,t('assetSort'),t('nearestDue'));await geometry(page);
  await page.locator('.workspace-navigation a[href="/assets"]').click();await expect(page.locator('.asset-summary-card')).toHaveCount(13);await expect(page.locator('.catalog-summary-stat').last()).toContainText('5');
  for(const [from,expected] of [['/cards','/cards'],['/assets','/assets']] as const){
   await page.goto(from);await page.getByRole('button',{name:t('globalSearch'),exact:true}).click();await page.locator('#top-search-query').fill(t('walletSample_transit'));await page.locator('.search-results a').filter({hasText:t('walletSample_transit')}).click();await expect(page.locator('.topbar-back-link')).toHaveAttribute('href',expected);await expect(page.locator('.back-link')).toHaveAttribute('href',expected);await page.locator('.topbar-back-link').click();await expect(page).toHaveURL(new RegExp(`${expected}$`));
  }
  await page.goto('/finance');await expect(page).toHaveURL(/\/assets$/);await expect(page.locator('.finance-page')).toHaveCount(0);
  await page.goto('/backup');const backup=page.locator('.intake-backup-card');await backup.locator('#backup-password').fill(password);await backup.getByRole('button',{name:t('backup'),exact:true}).click();const link=backup.getByRole('link',{name:t('saveBackupFile'),exact:true});await expect(link).toBeVisible();const wait=page.waitForEvent('download');await link.click();const file=await (await wait).path();const bytes=readFileSync(file!);const zip=unzipSync(await decryptBackup(bytes,password));const archive=JSON.parse(strFromU8(zip['records.json']));const raw=JSON.stringify(archive);expect(raw).toContain('walletCard');expect(raw).toContain('7825');expect(raw).toContain('mw-old-expense');expect(raw).toContain('USD');
  const fresh=await context.browser()!.newContext();const restored=await fresh.newPage();await restored.addInitScript(l=>localStorage.setItem('keepany-language',l),locale);await restored.goto(new URL('/assets',page.url()).href);await expect(restored.locator('.workspace-navigation')).toBeVisible();await restoreCompletionArchive(restored,password,file!);await restored.goto(new URL('/cards',page.url()).href);await expect(restored.locator('.asset-summary-card')).toHaveCount(5);await expect(restored.locator('.asset-summary-card').filter({hasText:'Fictional card'})).toContainText('78.25');await fresh.close();
  expect(errors).toEqual([]);await info.attach('contract-results.json',{body:JSON.stringify({ids:['MW02','MW03','MW04','MW05','MW06'],locale,candidate:candidate(),result:'passed'}),contentType:'application/json'});
 });
 for(const width of [390,768,1280,1920,2262])test(`${locale} ${width} MW01 MW07 responsive states`,async({page},info)=>{
  const t=copy(locale);await page.setViewportSize({width,height:1000});await start(page,locale);
  await geometry(page);await page.screenshot({path:info.outputPath('assets.png'),fullPage:true});
  const first=page.locator('.asset-summary-card').first();await first.hover();await page.screenshot({path:info.outputPath('hover.png'),fullPage:true});await page.mouse.move(0,0);await first.focus();await page.screenshot({path:info.outputPath('focus.png'),fullPage:true});
  const box=await first.boundingBox();await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();await page.screenshot({path:info.outputPath('pressed.png'),fullPage:true});await page.mouse.up();await expect(page.locator('.workspace-asset-grid')).toHaveCount(0);await page.goBack();await expect(page.locator('.asset-summary-card')).toHaveCount(7);await page.mouse.move(0,0);
  await page.getByRole('searchbox',{name:t('workspaceSearch')}).fill('Minimal adapter');await expect(page.locator('.asset-summary-card')).toHaveCount(1);await geometry(page);await page.screenshot({path:info.outputPath('single.png'),fullPage:true});await page.getByRole('searchbox',{name:t('workspaceSearch')}).fill('no-such-fictional-card');await expect(page.locator('.empty')).toBeVisible();await page.screenshot({path:info.outputPath('no-matches.png'),fullPage:true});await page.getByRole('searchbox',{name:t('workspaceSearch')}).fill('');
  for(const kind of ['item','subscription']){await page.locator(`.workspace-navigation a[href="/assets/${kind}"]`).click();await geometry(page);await page.screenshot({path:info.outputPath(`${kind}.png`),fullPage:true});}
  await page.locator('.workspace-navigation a[href="/cards"]').click();await page.screenshot({path:info.outputPath('wallet-empty.png'),fullPage:true});await page.getByRole('button',{name:t('walletSamples'),exact:true}).click();await page.screenshot({path:info.outputPath('samples-confirm.png'),fullPage:true});await page.getByRole('dialog').getByRole('button',{name:t('walletSamples'),exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();await expect(page.locator('.asset-summary-card')).toHaveCount(4);await geometry(page);await page.screenshot({path:info.outputPath('wallet.png'),fullPage:true});
  await page.getByRole('button',{name:t('workspaceAddAsset'),exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:t('save'),exact:true}).click();await expect(dialog.locator('#catalog-record-name')).toHaveAttribute('aria-invalid','true');await page.screenshot({path:info.outputPath('editor-error.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await dialog.getByRole('button',{name:t('cancel'),exact:true}).click();
  await page.locator('.asset-summary-card').first().click();await page.locator('details.catalog-record-extra > summary').click();await page.screenshot({path:info.outputPath('detail-expanded.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await info.attach('contract-results.json',{body:JSON.stringify({ids:['MW01','MW07'],locale,width,candidate:candidate(),result:'passed'}),contentType:'application/json'});
 });
}
