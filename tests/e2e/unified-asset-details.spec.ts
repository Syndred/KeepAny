import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resources } from '../../apps/web/src/i18n';
import { newAsset, projectDomainSchema, type Asset, type History } from '../../packages/domain/src';
import { acceptanceCandidate } from './helpers/acceptance-candidate';
import { prepareCompletionArchive, restoreCompletionArchive } from './helpers/completion-archive';

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
  const ordinary={...base('project',ids.ordinary,names.ordinary),catalogCategoryId:category.id,url:'https://fictional.example.test/studio',description:'UD description / 完整描述',notes:'UD notes / 完整备注',tags:['fictional','虚构'],attachments:photos.slice(0,3),projectTitle:'Preserved historical title',longDescription:'UD retained long description'};
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
  const rows=[ordinary,item,subscription,wallet,...neighbors,...minimal,...long,foreign,cancelled,loaned,repairing,archived,...walletKinds,legacy];
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
   {id:'ud-corrected-renewal',assetId:ids.subscription,action:'renew',note:'UD original corrected note',billDate:'2026-09-28',amount:2800,currency:'CNY',createdAt:'2026-09-28T00:00:00.000Z',deleted:false,financeCorrection:{note:'UD corrected visible note',eventDate:'2026-09-28',amount:2100,currency:'CNY',hidden:false}},
   {id:'ud-hidden-renewal',assetId:ids.subscription,action:'renew',note:'UD hidden original',billDate:'2026-08-28',amount:2800,currency:'CNY',createdAt:'2026-08-28T00:00:00.000Z',deleted:false,financeCorrection:{note:'UD hidden receipt',eventDate:'2026-08-28',amount:2800,currency:'CNY',hidden:true}},
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
 await expect(page.getByRole('heading',{level:1})).toContainText(needle);return page.locator('main.unified-asset-detail');
}
async function screenshot(page:Page,info:TestInfo,name:string){
 const file=info.outputPath(`${name}.png`);await page.screenshot({path:file,fullPage:false});await info.attach(`${name}.png`,{path:file,contentType:'image/png'});return file;
}
async function receipt(info:TestInfo,ids:string[],extra:Record<string,unknown>={}){await info.attach('contract-results.json',{body:JSON.stringify({ids,candidate:identity(),result:'passed',...extra}),contentType:'application/json'});}
async function geometry(page:Page){
 const result=await page.evaluate(()=>{
  const main=document.querySelector('main.unified-asset-detail')!;
  const boxes=Array.from(main.querySelectorAll('.unified-detail-info,.unified-detail-description,.unified-detail-relations,.unified-detail-history')).map(el=>{const b=el.getBoundingClientRect();return {class:el.className,x:b.x,y:b.y,w:b.width,h:b.height,right:b.right};});
  return {scrollWidth:document.documentElement.scrollWidth,width:innerWidth,boxes,details:main.querySelectorAll('details,summary').length,text:main.textContent};
 });
 expect(result.scrollWidth).toBeLessThanOrEqual(result.width+1);expect(result.details).toBe(0);
 expect(result.boxes).toHaveLength(4);for(const box of result.boxes){expect(box.w).toBeGreaterThan(200);expect(box.x).toBeGreaterThanOrEqual(-1);expect(box.right).toBeLessThanOrEqual(result.width+1);}
 return result;
}

test('UD01 UD04 UD05 structural contract before and after',async({page},info)=>{
 await page.setViewportSize({width:1920,height:1080});await start(page,'zh-CN');
 const observations=[];
 for(const kind of kinds){
  await enter(page,kind);const main=page.locator('main.page').last();
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
  }
  await enter(page,'ordinary','long');await geometry(page);await page.locator('.unified-detail-description').scrollIntoViewIfNeeded();await screenshot(page,info,'long-description');
  const text=await page.locator('.unified-detail-description').innerText();expect(text).toContain('UD long notes');
  await enter(page,'wallet','minimal');await geometry(page);await screenshot(page,info,'minimal-empty-wallet');
  await receipt(info,['UD01','UD04','UD05','UD07','UD10','UD11'],{locale,width});
 });
}

test('UD05 real graph fit zoom fullscreen node navigation and UD07 complete history',async({page},info)=>{
 const t=tFor('en');await page.setViewportSize({width:1920,height:1080});await start(page,'en');
 for(const kind of kinds){
  const main=await enter(page,kind);const graph=main.locator('.graph');await expect(graph).toHaveAttribute('data-layout-ready','true');
  await expect(graph.locator('.react-flow__node')).toHaveCount(kind==='ordinary'?10:9);
  await graph.getByRole('button',{name:t('accountGraphZoomOut'),exact:true}).click();
  const view=graph.locator('.account-graph-view-toggle');
  if(await view.getAttribute('aria-label')===t('accountGraphFocus'))await view.click();
  await expect(view).toHaveAttribute('aria-label',t('accountGraphFit'));await view.click();
  await screenshot(page,info,`${kind}-fit`);
  const fit=await graph.evaluate(el=>{const viewport=el.querySelector('.react-flow')!.getBoundingClientRect();return Array.from(el.querySelectorAll('.react-flow__node')).map(node=>{const b=node.getBoundingClientRect();return b.left>=viewport.left-2&&b.right<=viewport.right+2&&b.top>=viewport.top-2&&b.bottom<=viewport.bottom+2;});});expect(fit.every(Boolean)).toBe(true);
  await graph.getByRole('button',{name:t('accountGraphExpand'),exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.locator('.graph')).toHaveAttribute('data-layout-ready','true');await screenshot(page,info,`${kind}-fullscreen`);await dialog.getByRole('button',{name:t('accountGraphCollapse'),exact:true}).click();await expect(dialog).toBeHidden();
 }
 await enter(page,'subscription');const history=page.locator('.unified-detail-history');await expect(history).toContainText('UD corrected visible note');await expect(history).not.toContainText('UD original corrected note');await expect(history).not.toContainText('UD hidden receipt');await expect(history).toContainText('21.00');
 await enter(page,'wallet');await expect(page.locator('.unified-detail-history')).toContainText('UD shared fee');
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
