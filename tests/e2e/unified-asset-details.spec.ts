import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resources } from '../../apps/web/src/i18n';
import { newAsset, projectDomainSchema, type Asset, type History } from '../../packages/domain/src';
import { acceptanceCandidate } from './helpers/acceptance-candidate';
import { prepareCompletionArchive, restoreCompletionArchive } from './helpers/completion-archive';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { importVisualKdbxEntries } from './fixtures/password-smart-import-visual';

const password = 'Unified-Details-Fictional-only-2026';
const stamp = '2026-11-05T00:00:00.000Z';
type Locale = 'zh-CN' | 'en';
type Kind = 'ordinary' | 'item' | 'subscription' | 'wallet';
const kinds: Kind[] = ['ordinary','item','subscription','wallet'];
const names: Record<Kind,string> = {ordinary:'UD Fictional studio / 虚构工作室',item:'UD Fictional camera / 虚构相机',subscription:'UD Fictional monthly / 虚构月付',wallet:'UD Fictional card / 虚构储值卡'};
const ids: Record<Kind,string> = {ordinary:'ud-ordinary',item:'ud-item',subscription:'ud-subscription',wallet:'ud-wallet'};
const paths: Record<Kind,string> = {ordinary:'/assets',item:'/assets/item',subscription:'/assets/subscription',wallet:'/cards'};
const tFor = (locale:Locale) => (key:string) => (resources[locale].translation as Record<string,string>)[key];
const identity = () => acceptanceCandidate().release.webFiles.find(file=>file.path==='index.html')!.sha256;
let fixture: string;
let categoryId: string;
let domainId: string;

test.beforeAll(async({},info)=>{
 fixture=resolve(process.env.KEEPANY_EVIDENCE_DIR??'test-results/unified-asset-details',`fixture-${info.workerIndex}`);
 const result=await prepareCompletionArchive(fixture,password,async db=>{
  const category=await db.saveCatalogCategory(null,{name:'UD 虚构资料 / Fictional records'});
  const photoBytes=readFileSync('apps/web/public/samples/laptop.png');
  const photos:string[]=[];
  for(const name of ['cover','detail','receipt','other']) photos.push(await db.putFile(new File([photoBytes],`ud-${name}.png`,{type:'image/png'})));
  const base=(kind:Asset['kind'],id:string,name:string):Asset=>({...newAsset(kind),id,name,createdAt:stamp,updatedAt:stamp});
  const ordinary={...base('project',ids.ordinary,names.ordinary),catalogCategoryId:category.id,url:'https://fictional.example.test/studio',description:'UD description / 完整描述',notes:'UD notes / 完整备注',tags:['fictional','虚构'],attachments:photos.slice(0,3),projectMedia:{logoId:photos[0],homeScreenshotId:photos[1],productScreenshotIds:[photos[2]],promoCoverId:''},projectTitle:'Preserved historical title',longDescription:'UD retained long description'};
  const item={...base('item',ids.item,names.item),category:'electronics',description:'UD item description / 实物描述',notes:'UD item notes / 实物备注',amount:480000,currency:'CNY' as const,itemPurchasePriceKnown:true,purchaseDate:'2026-05-20',warrantyDate:'2027-05-20',location:'书房 / Study',itemLifecycleStatus:'inUse' as const,attachments:photos,itemMedia:{coverId:photos[0],detailIds:[photos[1]],receiptIds:[photos[2]]}};
  const subscription={...base('subscription',ids.subscription,names.subscription),category:'software',url:'https://fictional.example.test/notes',description:'UD subscription description / 订阅描述',notes:'UD subscription notes / 订阅备注',amount:2800,currency:'CNY' as const,cycle:'month' as const,dueDate:'2026-11-28',billingAnchor:'2026-11-28',attachments:photos.slice(0,3)};
  const wallet={...base('project',ids.wallet,names.wallet),description:'UD wallet description / 卡包描述',notes:'UD wallet notes / 卡包备注',dueDate:'2027-05-31',walletCard:{type:'storedValue' as const,issuer:'UD Fictional Coffee / 虚构咖啡',lastFour:'0826',balanceMinor:26800,remainingUses:null},attachments:photos.slice(0,3)};
  const neighbors=Array.from({length:8},(_,index)=>({...base(index===0?'account':'project',`ud-neighbor-${index}`,`UD Neighbor ${index+1} / 关联资料 ${index+1}`),catalogCategoryId:index===0?undefined:category.id,username:index===0?'fictional@example.test':''}));
  const minimal=kinds.map(kind=>({...base(kind==='ordinary'||kind==='wallet'?'project':kind,`ud-minimal-${kind}`,`UD Minimal ${kind}`),...(kind==='wallet'?{walletCard:{type:'membership' as const,issuer:'',lastFour:'',balanceMinor:null,remainingUses:null}}:{}),...(kind==='ordinary'?{catalogCategoryId:category.id}:{})}));
  const long=kinds.map(kind=>({...base(kind==='ordinary'||kind==='wallet'?'project':kind,`ud-long-${kind}`,`UD Long ${kind} / 长标题 `.repeat(6).slice(0,155)),description:'UD long description 长描述 '.repeat(250),notes:'UD long notes 长备注 '.repeat(150),url:'https://fictional.example.test/'+ 'long-path/'.repeat(70),tags:['长标签 long tag '.repeat(3)],attachments:photos,...(kind==='wallet'?{walletCard:{type:'countPass' as const,issuer:'UD long issuer 长发行方 '.repeat(7),lastFour:'9876',balanceMinor:0,remainingUses:12}}:{}),...(kind==='ordinary'?{catalogCategoryId:category.id}:{})}));
  const foreign={...base('subscription','ud-foreign','UD Foreign pending'),amount:2000,currency:'EUR' as const,dueDate:'2026-12-15'};
  const cancelled={...base('subscription','ud-cancelled','UD Cancelled subscription'),amount:2800,status:'cancelled' as const,dueDate:'2026-12-15'};
  const loaned={...base('item','ud-loaned','UD Already loaned'),status:'loaned' as const,borrower:'Fictional borrower',itemExpectedReturnDate:'2027-01-01'};
  const repairing={...base('item','ud-repairing','UD Under repair'),itemLifecycleStatus:'repairing' as const};
  const archived={...base('item','ud-archived','UD Archived item'),status:'archived' as const};
  const walletKinds=(['membership','countPass','gift'] as const).map((type,index)=>({...base('project',`ud-wallet-${type}`,`UD Wallet ${type}`),dueDate:'2027-04-01',walletCard:{type,issuer:'UD Issuer',lastFour:index===0?'':'1038',balanceMinor:type==='gift'?12000:null,remainingUses:type==='countPass'?3:null}}));
  const domain=projectDomainSchema.parse({id:crypto.randomUUID(),name:'historical.example.test',registrar:'UD Registrar',expiryDate:'2027-03-01',annualAmount:5000,currency:'CNY',autoRenew:'off',catalog:{categoryId:category.id,name:'UD Historical domain',url:'https://historical.example.test',tags:['domain'],status:'active',notes:'UD historical domain note',attachments:[photos[0]],deleted:false}});
  const legacy={...base('project','ud-legacy','UD Legacy owner'),category:'legacy',description:'UD legacy description',projectTitle:'UD legacy protected title',attachments:[photos[0]],projectDomains:[domain]};
  const retiredVault=base('vault','ud-retired-vault','UD Retired vault reference');
  const deleted={...base('project','ud-deleted','UD Deleted record'),deleted:true};
  const rows=[ordinary,item,subscription,wallet,...neighbors,...minimal,...long,foreign,cancelled,loaned,repairing,archived,...walletKinds,legacy,retiredVault,deleted];
  await db.saveBatch(rows.map(value=>({type:'asset' as const,value:value.kind==='item'&&['ud-loaned','ud-repairing','ud-archived'].includes(value.id)?{...value,status:'active',borrower:'',itemExpectedReturnDate:'',itemLifecycleStatus:'inUse'}:value})));
  const loanBase=(await db.get<Asset>('asset','ud-loaned'))!;
  await db.recordItemAction(loanBase,{...loanBase,status:'loaned',borrower:'Fictional borrower',itemExpectedReturnDate:'2027-01-01',lastItemEventId:'ud-fixture-loan',updatedAt:stamp},{id:'ud-fixture-loan',assetId:loanBase.id,action:'loan',borrower:'Fictional borrower',expectedReturnDate:'2027-01-01',eventDate:'2026-11-05',note:'Synthetic fixture state preparation',createdAt:stamp,deleted:false});
  const repairBase=(await db.get<Asset>('asset','ud-repairing'))!;
  await db.recordItemAction(repairBase,{...repairBase,itemLifecycleStatus:'repairing',itemStatusDate:'2026-11-05',lastItemEventId:'ud-fixture-repair',updatedAt:stamp},{id:'ud-fixture-repair',assetId:repairBase.id,action:'itemStatus',itemStatusBefore:'inUse',itemStatusAfter:'repairing',eventDate:'2026-11-05',note:'Synthetic fixture state preparation',createdAt:stamp,deleted:false});
  await db.setItemArchived('ud-archived','active');
  const relations=kinds.flatMap(kind=>neighbors.map((neighbor,index)=>({id:`ud-relation-${kind}-${index}`,from:ids[kind],to:neighbor.id,label:`UD link ${index+1}`,createdAt:stamp,verifiedAt:index%2?'':stamp,deleted:false})));
  relations.push({id:'ud-preserved-task-link',from:ids.ordinary,to:ids.item,label:'UD near asset',createdAt:stamp,verifiedAt:'',deleted:false});
  await db.saveBatch(relations.map(value=>({type:'relation' as const,value})));
  const histories:History[]=[
   {id:'ud-item-history',assetId:ids.item,action:'maintenance',note:'UD historical maintenance',eventDate:'2026-10-01',createdAt:'2026-10-01T00:00:00.000Z',deleted:false},
   {id:'ud-renewal-history',assetId:ids.subscription,action:'renew',note:'UD historical renewal',billDate:'2026-10-28',amount:2800,currency:'CNY',createdAt:'2026-10-28T00:00:00.000Z',deleted:false},
   {id:'ud-shared-history',assetId:ids.ordinary,assetIds:[ids.ordinary,ids.wallet],action:'expense',note:'UD shared fee',title:'UD shared receipt',eventDate:'2026-09-01',amount:1000,currency:'CNY',createdAt:'2026-09-01T00:00:00.000Z',deleted:false},
   {id:'ud-corrected-renewal',assetId:ids.subscription,action:'renew',note:'UD original corrected note',billDate:'2026-09-28',amount:2800,currency:'CNY',createdAt:'2026-09-28T00:00:00.000Z',deleted:false,financeCorrection:{note:'UD corrected visible note',eventDate:'2026-09-28',amount:2100,currency:'CNY',hidden:false,assetIds:[ids.ordinary,ids.wallet]}},
   {id:'ud-hidden-renewal',assetId:ids.subscription,action:'renew',note:'UD hidden original',billDate:'2026-08-28',amount:2800,currency:'CNY',createdAt:'2026-08-28T00:00:00.000Z',deleted:false,financeCorrection:{note:'UD hidden receipt',eventDate:'2026-08-28',amount:2800,currency:'CNY',hidden:true,assetIds:[ids.ordinary]}},
  ];
  await db.saveBatch(histories.map(value=>({type:'history' as const,value})));
  await db.save('task',{id:'ud-retained-task',assetId:ids.item,name:'UD task must not appear in detail',dueDate:'2026-12-01',createdAt:stamp});
  return {categoryId:category.id,domainId:domain.id,photoIds:photos,ids};
 });
 categoryId=result.categoryId;domainId=result.domainId;
});

async function start(page:Page,locale:Locale){
 await page.addInitScript(language=>localStorage.setItem('keepany-language',language),locale);
 await page.goto('/assets');await expect(page.locator('.workspace-navigation')).toBeVisible();
 expect(createHash('sha256').update(await (await page.request.get('/')).body()).digest('hex')).toBe(identity());
 await restoreCompletionArchive(page,password,resolve(fixture,'fixture.ka1'));
 await page.goto('/assets');await expect(page.locator('.asset-summary-card').filter({hasText:names.ordinary})).toBeVisible();
}
async function enter(page:Page,kind:Kind,variant:'normal'|'minimal'|'long'='normal'){
 await page.goto(paths[kind]);
 const needle=variant==='normal'?names[kind]:variant==='minimal'?`UD Minimal ${kind}`:`UD Long ${kind}`;
 const card=page.locator('.asset-summary-card').filter({hasText:needle});await expect(card).toHaveCount(1);await card.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{level:1})).toContainText(needle);await expect(page.locator('.topbar-back-link')).toHaveAttribute('href',paths[kind]);const main=page.locator('main.unified-asset-detail');if(await main.count())await expect(main.locator('.graph')).toHaveAttribute('data-layout-ready','true');return main;
}
async function screenshot(page:Page,info:TestInfo,name:string){
 const file=info.outputPath(`${name}.png`);await page.screenshot({path:file,fullPage:false});await info.attach(`${name}.png`,{path:file,contentType:'image/png'});return file;
}
async function receipt(info:TestInfo,ids:string[],extra:Record<string,unknown>={}){await info.attach('contract-results.json',{body:JSON.stringify({ids,candidate:identity(),result:'passed',...extra}),contentType:'application/json'});}
async function exportRows(page:Page,locale:Locale){
 const t=tFor(locale);await page.goto('/backup');const card=page.locator('.intake-backup-card');await card.locator('#backup-password').fill(password);await card.getByRole('button',{name:t('backup'),exact:true}).click();const link=card.getByRole('link',{name:t('saveBackupFile'),exact:true});await expect(link).toBeVisible();const event=page.waitForEvent('download');await link.click();const downloaded=await event;const file=await downloaded.path();if(!file)throw Error('Backup download missing');const zip=unzipSync(await decryptBackup(readFileSync(file),password));return (JSON.parse(strFromU8(zip['records.json'])) as {type:string;payload:string}[]).map(row=>({...row,value:JSON.parse(row.payload)}));
}
async function selectOption(page:Page,selector:string,name:string){await page.locator(selector).click();await page.getByRole('option',{name,exact:true}).click();}
async function uploadThroughButton(page:Page,button:import('@playwright/test').Locator,file:string){const event=page.waitForEvent('filechooser');await button.click();await (await event).setFiles(file);}
async function geometry(page:Page){
 const result=await page.evaluate(()=>{
  const main=document.querySelector('main.unified-asset-detail')!;
  const boxes=Array.from(main.querySelectorAll('.unified-detail-info,.unified-detail-description,.unified-detail-relations,.unified-detail-history')).map(el=>{const b=el.getBoundingClientRect();return {class:el.className,x:b.x,y:b.y,w:b.width,h:b.height,right:b.right};});
  const clippedLabels=Array.from(main.querySelectorAll('.asset-graph-label')).filter(el=>el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1).map(el=>({text:el.textContent,width:el.clientWidth,scrollWidth:el.scrollWidth,height:el.clientHeight,scrollHeight:el.scrollHeight}));
  return {scrollWidth:document.documentElement.scrollWidth,width:innerWidth,boxes,details:main.querySelectorAll('details,summary').length,text:main.textContent,clippedLabels};
 });
 expect(result.scrollWidth).toBeLessThanOrEqual(result.width+1);expect(result.details).toBe(0);
 expect(result.clippedLabels).toEqual([]);await expect(page.locator('.unified-detail-header')).toHaveCSS('border-top-width','0px');
 expect(result.boxes).toHaveLength(4);for(const box of result.boxes){expect(box.w).toBeGreaterThan(200);expect(box.x).toBeGreaterThanOrEqual(-1);expect(box.right).toBeLessThanOrEqual(result.width+1);}
 return result;
}

test('UD01 UD04 UD05 structural contract before and after',async({page},info)=>{
 await page.setViewportSize({width:1920,height:1080});await start(page,'zh-CN');
 const observations=[];
 for(const kind of kinds){
  await enter(page,kind);const main=page.locator('main.page').last();
  if(await page.locator('main.unified-asset-detail').count())await expect(main.locator('.unified-detail-relations .graph')).toHaveAttribute('data-layout-ready','true');
  observations.push({kind,folds:await main.locator('details,summary').count(),tasks:await main.locator('.asset-tasks-card').count(),descriptionImages:await main.locator('.unified-detail-description img').count(),graph:await main.locator('.unified-detail-relations .graph').count()});
  await screenshot(page,info,`contract-${kind}`);
 }
 await info.attach('structural-observations.json',{body:JSON.stringify({candidate:identity(),observations}),contentType:'application/json'});
 for(const row of observations){expect(row.folds,`${row.kind}: no collapsed detail content`).toBe(0);expect(row.tasks).toBe(0);expect(row.descriptionImages,`${row.kind}: photos inside description`).toBeGreaterThanOrEqual(3);expect(row.graph).toBe(1);}
 await receipt(info,['UD01','UD04','UD05']);
});

for(const locale of ['zh-CN','en'] as const){
 test(`${locale} UD01 UD03 all four editors cancel error save and reload`,async({page},info)=>{
  const t=tFor(locale);await start(page,locale);
  for(const kind of kinds){
   await enter(page,kind);await expect(page.locator('.unified-asset-detail')).toBeVisible();
   await page.getByRole('button',{name:t('edit'),exact:true}).click();let dialog=page.getByRole('dialog');
   const input=dialog.locator(kind==='ordinary'||kind==='wallet'?'#catalog-record-name':'#name');await input.fill('UD cancelled edit');await dialog.getByRole('button',{name:t('cancel'),exact:true}).click();await expect(page.getByRole('heading',{level:1})).toContainText(names[kind]);
   await page.getByRole('button',{name:t('edit'),exact:true}).click();dialog=page.getByRole('dialog');await input.fill('');await dialog.getByRole('button',{name:t('save'),exact:true}).click();await expect(input).toHaveAttribute('aria-invalid','true');await screenshot(page,info,`${kind}-required-error`);
   await input.fill(`${names[kind]} edited`);await dialog.getByRole('button',{name:t('save'),exact:true}).click();await expect(dialog).toBeHidden();await page.reload();await expect(page.getByRole('heading',{level:1})).toContainText(`${names[kind]} edited`);
  }
  await receipt(info,['UD01','UD03'],{locale});
 });

 for(const width of [390,768,1280,1920,1991,2262])test(`${locale} ${width} UD11 open content and graph matrix`,async({page},info)=>{
  const t=tFor(locale);await page.setViewportSize({width,height:1080});await start(page,locale);
  for(const kind of kinds){
   const main=await enter(page,kind);await expect(main).toBeVisible();await expect(main.locator('.unified-detail-description img')).toHaveCount(kind==='item'?4:3);
   await expect(main.locator('.graph')).toHaveAttribute('data-layout-ready','true');await geometry(page);await screenshot(page,info,`${kind}-default`);
   const description=main.locator('.unified-detail-description');await description.scrollIntoViewIfNeeded();await screenshot(page,info,`${kind}-description`);
   const history=main.locator('.unified-detail-history');await history.scrollIntoViewIfNeeded();await screenshot(page,info,`${kind}-history`);
   const edit=page.getByRole('button',{name:t('edit'),exact:true});await edit.scrollIntoViewIfNeeded();await edit.hover();await screenshot(page,info,`${kind}-hover`);await page.mouse.move(0,0);await edit.focus();await screenshot(page,info,`${kind}-focus`);
   const box=await edit.boundingBox();await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();await screenshot(page,info,`${kind}-pressed`);await page.mouse.up();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await screenshot(page,info,`${kind}-editor`);await dialog.getByRole('button',{name:t('cancel'),exact:true}).click();
  }
  await enter(page,'ordinary','long');await geometry(page);await page.locator('.unified-detail-description').scrollIntoViewIfNeeded();await screenshot(page,info,'long-description');
  const text=await page.locator('.unified-detail-description').innerText();expect(text).toContain('UD long notes');
  await enter(page,'wallet','minimal');await geometry(page);await screenshot(page,info,'minimal-empty-wallet');
  await receipt(info,['UD01','UD04','UD05','UD07','UD10','UD11'],{locale,width,matrix:true});
 });
}

for(const locale of ['zh-CN','en'] as const){
 test(`${locale} UD04 album original preview cancel add replace remove and role persistence`,async({page},info)=>{
  const t=tFor(locale),photo=resolve('apps/web/public/samples/laptop.png');await start(page,locale);
  for(const kind of kinds){
   await enter(page,kind);const description=page.locator('.unified-detail-description'),figures=description.locator('figure');const initial=kind==='item'?4:3;await expect(figures).toHaveCount(initial);
   const popupEvent=page.waitForEvent('popup');await figures.first().getByRole('link').click();const popup=await popupEvent;await expect(popup.locator('img')).toBeVisible();await popup.close();
   await uploadThroughButton(page,description.locator('button').filter({hasText:t('addPhoto')}),photo);let preview=page.getByRole('dialog');await expect(preview.locator('.image-preview')).toBeVisible();await screenshot(page,info,`${kind}-photo-preview`);await preview.getByRole('button',{name:t('cancel'),exact:true}).click();await expect(figures).toHaveCount(initial);
   await uploadThroughButton(page,description.locator('button').filter({hasText:t('addPhoto')}),photo);preview=page.getByRole('dialog');await expect(preview.getByRole('button',{name:t('confirm'),exact:true})).toBeEnabled();await preview.getByRole('button',{name:t('confirm'),exact:true}).click();await expect(preview).toBeHidden();await expect(figures).toHaveCount(initial+1);await page.reload();await expect(figures).toHaveCount(initial+1);
   const oldSource=await figures.first().locator('img').getAttribute('src');await uploadThroughButton(page,figures.first().getByRole('button',{name:t('replaceImage'),exact:true}),photo);preview=page.getByRole('dialog');await preview.getByRole('button',{name:t('confirm'),exact:true}).click();await expect(preview).toBeHidden();await expect(figures).toHaveCount(initial+1);await expect(figures.first().locator('img')).not.toHaveAttribute('src',oldSource!);
   await figures.first().getByRole('button',{name:t('removeImage'),exact:true}).click();await expect(figures).toHaveCount(initial);await page.reload();await expect(figures).toHaveCount(initial);await screenshot(page,info,`${kind}-album-saved`);
  }
  const rows=await exportRows(page,locale);const ordinary=rows.find(row=>row.type==='asset'&&row.value.id===ids.ordinary)!.value as Asset,item=rows.find(row=>row.type==='asset'&&row.value.id===ids.item)!.value as Asset;
  expect(ordinary.projectTitle).toBe('Preserved historical title');expect(ordinary.projectMedia.logoId).toBe('');expect(ordinary.attachments).toContain(ordinary.projectMedia.homeScreenshotId);expect(ordinary.projectMedia.productScreenshotIds.every(id=>ordinary.attachments.includes(id))).toBe(true);
  expect(item.itemMedia.coverId).toBe('');expect(item.itemMedia.detailIds).toHaveLength(1);expect(item.itemMedia.receiptIds).toHaveLength(1);expect(item.itemMedia.detailIds.every(id=>item.attachments.includes(id))).toBe(true);expect(item.itemMedia.receiptIds.every(id=>item.attachments.includes(id))).toBe(true);
  expect(rows.some(row=>row.type==='task'&&row.value.id==='ud-retained-task')).toBe(true);await receipt(info,['UD04'],{locale});
 });

 test(`${locale} UD06 relations disabled duplicate cancel save unlink and reload`,async({page},info)=>{
  const t=tFor(locale);await start(page,locale);
  for(const kind of kinds){
   await enter(page,kind);const relations=page.locator('.unified-detail-relations');await expect(relations.locator('.graph')).toHaveAttribute('data-layout-ready','true');const originalEdges=await relations.locator('.react-flow__edge').count();
   await relations.getByRole('button',{name:t('addRelation'),exact:true}).click();let dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:t('save'),exact:true})).toBeDisabled();await dialog.locator('#detail-relation-target').click();await expect(page.getByRole('option',{name:'UD Retired vault reference',exact:true})).toHaveCount(0);await expect(page.getByRole('option',{name:'UD Deleted record',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');await dialog.getByRole('button',{name:t('cancel'),exact:true}).click();
   await relations.getByRole('button',{name:t('addRelation'),exact:true}).click();dialog=page.getByRole('dialog');await selectOption(page,'#detail-relation-target','UD Neighbor 2 / 关联资料 2');await dialog.locator('#detail-relation-label').fill('UD link 2');await dialog.getByRole('button',{name:t('save'),exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await screenshot(page,info,`${kind}-relation-duplicate`);await dialog.getByRole('button',{name:t('cancel'),exact:true}).click();
   await relations.getByRole('button',{name:t('addRelation'),exact:true}).click();dialog=page.getByRole('dialog');await selectOption(page,'#detail-relation-target','UD Minimal ordinary');await dialog.locator('#detail-relation-label').fill(`UD manual ${kind}`);await dialog.getByRole('button',{name:t('save'),exact:true}).click();await expect(dialog).toBeHidden();await expect(relations.locator('.react-flow__edge')).toHaveCount(originalEdges+1);await page.reload();await expect(relations.locator('.graph')).toHaveAttribute('data-layout-ready','true');await expect(relations.locator('.react-flow__edge')).toHaveCount(originalEdges+1);
   const edge=relations.locator(`.react-flow__edge[aria-label*="UD manual ${kind}"]`);await expect(edge).toHaveCount(1);await edge.focus();await page.keyboard.press('Enter');await expect(relations.locator('.account-graph-selection-panel')).toContainText(`UD manual ${kind}`);
   await relations.getByRole('button',{name:t('deleteRelation'),exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:t('cancel'),exact:true}).click();await expect(relations.locator('.react-flow__edge')).toHaveCount(originalEdges+1);await relations.getByRole('button',{name:t('deleteRelation'),exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:t('deleteRelation'),exact:true}).click();await expect(dialog).toBeHidden();await expect(relations.locator('.react-flow__edge')).toHaveCount(originalEdges);await page.reload();await expect(relations.locator('.react-flow__edge')).toHaveCount(originalEdges);
  }
  await receipt(info,['UD06'],{locale});
 });
}

for(const locale of ['zh-CN','en'] as const)for(const width of [390,1920])test(`${locale} ${width} UD11 lazy loading resource error and reload`,async({browser},info)=>{
 const baseURL=String(info.project.use.baseURL),t=tFor(locale),pattern=/\/assets\/account-family-graph-view-[^/]+\.js(?:\?|$)/;
 const loadingContext=await browser.newContext({baseURL,viewport:{width,height:1080}});let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 try{
  const page=await loadingContext.newPage();await page.route(pattern,async route=>{await held;await route.continue();});await start(page,locale);await page.locator('.asset-summary-card').filter({hasText:names.ordinary}).click();await expect(page.locator('.unified-detail-relations').getByRole('status')).toContainText(t('loading'));await screenshot(page,info,'graph-loading');release();await expect(page.locator('.unified-detail-relations .graph')).toHaveAttribute('data-layout-ready','true');await screenshot(page,info,'graph-loaded');
 }finally{release();await loadingContext.close();}
 const errorContext=await browser.newContext({baseURL,viewport:{width,height:1080}});
 try{
  const page=await errorContext.newPage();await page.route(pattern,route=>route.abort('failed'));await start(page,locale);await page.locator('.asset-summary-card').filter({hasText:names.ordinary}).click();await expect(page.locator('[data-testid="route-load-error"]')).toHaveAttribute('data-error-kind','module-load');await screenshot(page,info,'graph-resource-error');await page.unroute(pattern);await page.getByRole('button',{name:t('pageLoadErrorReload'),exact:true}).click();await expect(page.getByRole('heading',{level:1})).toContainText(names.ordinary);await expect(page.locator('.unified-detail-relations .graph')).toHaveAttribute('data-layout-ready','true');await expect(page.locator('.unified-detail-description img')).toHaveCount(3);await screenshot(page,info,'graph-resource-reloaded');
 }finally{await errorContext.close();}
 await receipt(info,['UD11'],{locale,width,states:['loading','resource-error','reloaded']});
});

for(const locale of ['zh-CN','en'] as const)test(`${locale} UD11 specialized action dialogs at four widths`,async({page},info)=>{
 const t=tFor(locale);await start(page,locale);
 for(const width of [390,768,1280,1920]){
  await page.setViewportSize({width,height:1080});await enter(page,'item');await page.getByRole('button',{name:t('detailRecordActivity'),exact:true}).click();let dialog=page.getByRole('dialog');await screenshot(page,info,`item-activity-${width}`);
  const fields=await dialog.locator('.field').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {w:r.width,left:r.left,right:r.right};}));for(const field of fields)expect(field.w).toBeGreaterThanOrEqual(width===390?200:150);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await dialog.getByRole('button',{name:t('loan'),exact:true}).click();await expect(dialog.getByRole('alert')).toContainText(t('borrowerRequired'));await screenshot(page,info,`item-activity-error-${width}`);await dialog.getByRole('button',{name:t('close'),exact:true}).click();
  await enter(page,'subscription');await page.getByRole('button',{name:t('renew'),exact:true}).click();dialog=page.getByRole('dialog');await screenshot(page,info,`subscription-activity-${width}`);const amount=await dialog.locator('.renewal-amount-field input').boundingBox();expect(amount!.width).toBeGreaterThanOrEqual(150);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await dialog.getByRole('button',{name:t('close'),exact:true}).click();
  await enter(page,'ordinary');await page.getByRole('button',{name:t('addRelation'),exact:true}).click();dialog=page.getByRole('dialog');await selectOption(page,'#detail-relation-target','UD Neighbor 2 / 关联资料 2');await dialog.locator('#detail-relation-label').fill('UD link 2');await dialog.getByRole('button',{name:t('save'),exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await screenshot(page,info,`relation-error-${width}`);await dialog.getByRole('button',{name:t('cancel'),exact:true}).click();
 }
 await receipt(info,['UD06','UD08','UD09','UD11'],{locale,actionWidths:[390,768,1280,1920]});
});

for(const locale of ['zh-CN','en'] as const)test(`${locale} UD12 ordinary private and overview graphs retain default labels`,async({page},info)=>{
 const t=tFor(locale),master='UD-Fictional-Account-Master-2026';await start(page,locale);await page.goto('/accounts');await page.locator('#password-vault-master').fill(master);await page.locator('#password-vault-master-confirm').fill(master);await page.getByRole('button',{name:t('accountSetUp'),exact:true}).click();await page.locator('.account-toolbar-actions').getByRole('button',{name:t('add'),exact:true}).click();await page.locator('#password-vault-entry-title').fill('UD normal account');await page.locator('#password-vault-entry-username').fill('ud-normal@example.test');await page.locator('#password-vault-entry-password').fill('UD fictional secret only');await page.getByRole('dialog').getByRole('button',{name:t('save'),exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
 const card=page.locator('.compact-account-card').filter({hasText:'UD normal account'});await card.locator('.compact-account-title-block').click();await expect(page.locator('.graph')).toHaveAttribute('data-layout-ready','true');await expect(page.locator('.graph.account-graph-wrap-labels')).toHaveCount(0);await screenshot(page,info,'ordinary-account-graph');await page.locator('.topbar-back-link').click();
 await importVisualKdbxEntries(page,t,[{title:'UD private account',username:'ud-private@example.test',password:'UD fictional private secret',linkedAssetIds:[ids.ordinary]}]);await page.locator('.compact-account-card').filter({hasText:'UD private account'}).locator('.compact-account-title-block').click();await expect(page.locator('.graph')).toHaveAttribute('data-layout-ready','true');await expect(page.locator('.graph.account-graph-wrap-labels')).toHaveCount(0);await expect(page.locator('.graph .react-flow__node')).toHaveCount(2);await screenshot(page,info,'private-account-graph');
 await page.goto('/');await expect(page.locator('.overview-page .graph')).toHaveAttribute('data-layout-ready','true');await expect(page.locator('.overview-page .graph.account-graph-wrap-labels')).toHaveCount(0);await screenshot(page,info,'overview-default-labels');await page.goto('/accounts');await page.locator('.account-toolbar-actions').getByRole('button',{name:t('pwVaultLock'),exact:true}).click();await expect(page.locator('#password-vault-unlock-master')).toBeVisible();await screenshot(page,info,'account-locked-after-detail');
 await enter(page,'item');await expect(page.locator('.reminder-task-context')).toHaveCount(0);await page.getByTestId('reminder-bell').click();await page.locator('[data-reminder-id="task-ud-retained-task"]').click();let reminder=page.getByRole('dialog');await expect(reminder.locator('.reminder-task-context')).toContainText('UD task must not appear in detail');await screenshot(page,info,'bell-linked-task-open');await reminder.getByRole('button',{name:t('close'),exact:true}).click();await expect(page.locator('.reminder-task-context')).toHaveCount(0);await expect(page).toHaveURL(/\/assets\/item\/ud-item$/);
 await page.getByTestId('reminder-bell').click();await page.locator('[data-reminder-id="task-ud-retained-task"]').click();reminder=page.getByRole('dialog');await reminder.getByRole('button',{name:t('complete'),exact:true}).click();await expect(reminder.getByRole('button',{name:t('reopen'),exact:true})).toBeVisible();await page.reload();reminder=page.getByRole('dialog');await expect(reminder.getByRole('button',{name:t('reopen'),exact:true})).toBeVisible();await screenshot(page,info,'bell-linked-task-completed');await reminder.getByRole('button',{name:t('close'),exact:true}).click();await expect(page.locator('.reminder-task-context')).toHaveCount(0);await receipt(info,['UD12'],{locale});
});

test('UD05 real graph fit zoom fullscreen node navigation and UD07 complete history',async({page},info)=>{
 const t=tFor('en');await page.setViewportSize({width:1920,height:1080});await start(page,'en');
 for(const kind of kinds){
  const main=await enter(page,kind);const graph=main.locator('.graph');await expect(graph).toHaveAttribute('data-layout-ready','true');
  await expect(graph.locator('.react-flow__node')).toHaveCount(kind==='ordinary'||kind==='item'?10:9);
  await graph.getByRole('button',{name:t('accountGraphZoomOut'),exact:true}).click();
  const view=graph.locator('.account-graph-view-toggle');
  if(await view.getAttribute('aria-label')===t('accountGraphFocus'))await view.click();
  await expect(view).toHaveAttribute('aria-label',t('accountGraphFit'));await view.click();
  await screenshot(page,info,`${kind}-fit`);
  const fit=await graph.evaluate(el=>{const viewport=el.querySelector('.react-flow')!.getBoundingClientRect();return Array.from(el.querySelectorAll('.react-flow__node')).map(node=>{const b=node.getBoundingClientRect();return b.left>=viewport.left-2&&b.right<=viewport.right+2&&b.top>=viewport.top-2&&b.bottom<=viewport.bottom+2;});});expect(fit.every(Boolean)).toBe(true);
  await graph.getByRole('button',{name:t('accountGraphExpand'),exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.locator('.graph')).toHaveAttribute('data-layout-ready','true');await screenshot(page,info,`${kind}-fullscreen`);await dialog.getByRole('button',{name:t('accountGraphCollapse'),exact:true}).click();await expect(dialog).toBeHidden();
 }
 await enter(page,'subscription');const history=page.locator('.unified-detail-history');await expect(history).toContainText('UD original corrected note');await expect(history).toContainText('UD hidden original');await expect(history).not.toContainText('UD corrected visible note');await expect(history).not.toContainText('UD hidden receipt');await expect(history).toContainText('28.00');
 await enter(page,'wallet');await expect(page.locator('.unified-detail-history')).toContainText('UD shared fee');await expect(page.locator('.unified-detail-history')).toContainText('UD corrected visible note');await expect(page.locator('.unified-detail-history')).toContainText('21.00');
 await page.locator('.unified-detail-relations .asset-graph-link').filter({hasText:'UD Neighbor 2'}).click();await expect(page.getByRole('heading',{level:1})).toContainText('UD Neighbor 2');
 await receipt(info,['UD05','UD07']);
});

test('UD02 domain projection and UD10 card variants remain real',async({page},info)=>{
 await start(page,'en');
 await page.goto('/assets');await page.locator('.asset-summary-card').filter({hasText:'UD Historical domain'}).click();await expect(page.getByRole('heading',{level:1})).toContainText('UD Historical domain');await expect(page.locator('.unified-detail-description')).toContainText('UD historical domain note');
 await page.getByRole('button',{name:tFor('en')('edit'),exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('#catalog-record-name').fill('UD Historical domain edited');await dialog.getByRole('button',{name:tFor('en')('save'),exact:true}).click();await expect(dialog).toBeHidden();await page.reload();await expect(page.getByRole('heading',{level:1})).toContainText('UD Historical domain edited');
 for(const type of ['membership','countPass','gift']){await page.goto('/cards');await page.locator('.asset-summary-card').filter({hasText:`UD Wallet ${type}`}).click();await expect(page.locator('.unified-asset-detail')).toBeVisible();await screenshot(page,info,`wallet-${type}`);if(type==='countPass')await expect(page.locator('.unified-detail-info')).toContainText('3');if(type==='gift')await expect(page.locator('.unified-detail-info')).toContainText('120.00');}
 await page.goto('/records/asset:ud-does-not-exist');await expect(page.getByText(tFor('en')('noMatches'),{exact:true})).toBeVisible();
 await receipt(info,['UD02','UD10']);
});

test('UD01 category and all-list return origins; UD12 overview account and legacy consumers',async({page},info)=>{
 const t=tFor('en');await page.setViewportSize({width:1920,height:1080});await start(page,'en');
 await page.goto('/assets');await page.locator(`.workspace-navigation a[href="/assets/category/${categoryId}"]`).click();await page.locator('.asset-summary-card').filter({hasText:names.ordinary}).click();await expect(page.locator('.topbar-back-link')).toHaveAttribute('href',`/assets/category/${categoryId}`);await page.reload();await expect(page.locator('.topbar-back-link')).toHaveAttribute('href',`/assets/category/${categoryId}`);await page.locator('.topbar-back-link').click();await expect(page).toHaveURL(new RegExp(`/assets/category/${categoryId}$`));
 for(const kind of ['item','subscription','wallet'] as const){await page.goto('/assets');await page.locator('.asset-summary-card').filter({hasText:names[kind]}).click();await expect(page.locator('.topbar-back-link')).toHaveAttribute('href','/assets');await page.locator('.topbar-back-link').click();await expect(page).toHaveURL(/\/assets$/);}
 await enter(page,'ordinary');await page.getByRole('link',{name:t('catalogLegacy'),exact:true}).click();await expect(page.locator('.asset-detail-project')).toBeVisible();await expect(page.locator('.asset-project-profile-card')).toContainText('https://fictional.example.test/studio');await screenshot(page,info,'legacy-consumer');
 await page.goto('/');await expect(page.locator('.overview-page .graph')).toHaveAttribute('data-layout-ready','true');await screenshot(page,info,'overview-consumer');await page.goto('/accounts');await expect(page.locator('#password-vault-master')).toBeVisible();await screenshot(page,info,'accounts-locked-consumer');
 await receipt(info,['UD01','UD12']);
});

for(const locale of ['zh-CN','en'] as const){
 test(`${locale} UD08 real item location status loan return maintenance and reload`,async({page},info)=>{
  const t=tFor(locale);await start(page,locale);await enter(page,'item');const main=page.locator('.unified-asset-detail');
  await main.getByRole('button',{name:t('itemEditLocation'),exact:true}).click();let dialog=page.getByRole('dialog');await dialog.getByLabel(t('itemLocationArea'),{exact:true}).fill('');await dialog.getByLabel(t('itemLocationContainer'),{exact:true}).fill('Box');await dialog.getByRole('button',{name:t('itemSaveLocation'),exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await screenshot(page,info,'location-invalid');await dialog.getByRole('button',{name:t('cancel'),exact:true}).click();await expect(main.locator('.unified-detail-info')).toContainText('书房 / Study');
  await main.getByRole('button',{name:t('itemEditLocation'),exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel(t('itemLocationArea'),{exact:true}).fill('UD Room');await dialog.getByLabel(t('itemLocationContainer'),{exact:true}).fill('UD Box');await dialog.getByLabel(t('itemLocationSpot'),{exact:true}).fill('UD Top');await dialog.getByRole('button',{name:t('itemSaveLocation'),exact:true}).click();await expect(dialog).toBeHidden();await page.reload();await expect(main.locator('.unified-detail-info')).toContainText('UD Room');
  await main.getByRole('button',{name:t('itemStatusChange'),exact:true}).click();dialog=page.getByRole('dialog');await selectOption(page,'#item-lifecycle-status',t('itemStatus_idle'));await dialog.getByRole('button',{name:t('itemStatusSave'),exact:true}).click();await expect(dialog).toBeHidden();await page.reload();await expect(main.locator('.unified-detail-state')).toContainText(t('itemStatus_idle'));
  await main.getByRole('button',{name:t('detailRecordActivity'),exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:t('loan'),exact:true}).click();await expect(dialog.getByRole('alert')).toContainText(t('borrowerRequired'));await screenshot(page,info,'borrower-required');await dialog.getByLabel(t('borrower'),{exact:true}).fill('UD Cancelled borrower');await dialog.getByRole('button',{name:t('close'),exact:true}).click();await expect(main.locator('.unified-detail-info')).not.toContainText('UD Cancelled borrower');
  await main.getByRole('button',{name:t('detailRecordActivity'),exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel(t('borrower'),{exact:true}).fill('UD Fictional borrower');await dialog.getByLabel(t('loanReturnNote'),{exact:true}).fill('UD lent after check');await dialog.getByRole('button',{name:t('loan'),exact:true}).click();await expect(dialog).toBeHidden();await page.reload();await expect(main.locator('.unified-detail-info')).toContainText('UD Fictional borrower');await expect(main.locator('.unified-detail-history')).toContainText('UD lent after check');
  await main.getByRole('button',{name:t('detailRecordActivity'),exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel(t('loanReturnNote'),{exact:true}).fill('UD returned and checked');await dialog.getByRole('button',{name:t('return'),exact:true}).click();await expect(dialog).toBeHidden();await main.getByRole('button',{name:t('detailRecordActivity'),exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:t('maintenance'),exact:true}).click();await expect(dialog.getByRole('alert')).toContainText(t('maintenanceNoteRequired'));await dialog.getByLabel(t('maintenanceNotes'),{exact:true}).fill('UD cleaned lens');await dialog.getByRole('button',{name:t('maintenance'),exact:true}).click();await expect(dialog).toBeHidden();await screenshot(page,info,'maintenance-success');await page.reload();await expect(main.locator('.unified-detail-history')).toContainText('UD returned and checked');await expect(main.locator('.unified-detail-history')).toContainText('UD cleaned lens');await expect(main.locator('a[href="/tasks"]')).toHaveCount(0);await expect(main).not.toContainText('UD task must not appear in detail');
  await page.goto('/assets/item');await page.locator('.asset-summary-card').filter({hasText:'UD Under repair'}).click();await page.getByRole('button',{name:t('detailRecordActivity'),exact:true}).click();dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:t('loan'),exact:true})).toBeDisabled();await screenshot(page,info,'repairing-disabled');await dialog.getByRole('button',{name:t('close'),exact:true}).click();
  await receipt(info,['UD08'],{locale});
 });

 test(`${locale} UD09 renewal cancel invalid success inactive and CNY missing`,async({page},info)=>{
  const t=tFor(locale);await start(page,locale);await enter(page,'subscription');const main=page.locator('.unified-asset-detail');
  await main.getByRole('button',{name:t('renew'),exact:true}).click();let dialog=page.getByRole('dialog');await dialog.getByRole('textbox',{name:t('notes'),exact:true}).fill('UD cancelled renewal');await dialog.getByRole('button',{name:t('close'),exact:true}).click();await expect(main.locator('.unified-detail-history')).not.toContainText('UD cancelled renewal');
  await main.getByRole('button',{name:t('renew'),exact:true}).click();dialog=page.getByRole('dialog');await dialog.locator('.renewal-amount-field input').fill('-1');await dialog.getByRole('button',{name:t('renew'),exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await screenshot(page,info,'renewal-invalid');await dialog.locator('.renewal-amount-field input').fill('29.25');await dialog.getByRole('textbox',{name:t('notes'),exact:true}).fill('UD actual local renewal');await dialog.getByRole('button',{name:t('renew'),exact:true}).click();await expect(dialog).toBeHidden();await page.reload();await expect(main.locator('.unified-detail-history')).toContainText('UD actual local renewal');await expect(main.locator('.unified-detail-history')).toContainText('29.25');await expect(main.locator('.unified-detail-info')).toContainText('2026');
  for(const name of ['UD Foreign pending','UD Cancelled subscription']){await page.goto('/assets/subscription');if(name==='UD Cancelled subscription'){await page.getByRole('combobox',{name:t('assetStatusView'),exact:true}).click();await page.getByRole('option',{name:t('all'),exact:true}).click();}await page.locator('.asset-summary-card').filter({hasText:name}).click();await expect(page.getByRole('button',{name:t('renew'),exact:true})).toBeDisabled();await screenshot(page,info,name==='UD Foreign pending'?'renewal-no-cny':'renewal-cancelled');}
  const rows=await exportRows(page,locale);const subscription=rows.find(row=>row.type==='asset'&&row.value.id===ids.subscription)!.value as Asset;expect(subscription.dueDate).toBe('2026-12-28');expect(subscription.renewalCount).toBe(1);expect(rows.filter(row=>row.type==='history'&&row.value.assetId===ids.subscription&&row.value.note==='UD actual local renewal')).toHaveLength(1);await receipt(info,['UD09'],{locale});
 });
}
