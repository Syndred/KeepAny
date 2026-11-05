import { acceptanceCandidate } from "./helpers/acceptance-candidate";
import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resources } from '../../apps/web/src/i18n';
import { newAsset } from '../../packages/domain/src';
import { prepareCompletionArchive, restoreCompletionArchive } from './helpers/completion-archive';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import { unzipSync, strFromU8 } from 'fflate';

const evidence=process.env.KEEPANY_EVIDENCE_DIR ?? 'test-results/assets-approved';
const fixture=resolve(evidence,'approved-fixture'), password='Fictional-assets-only-2026';
const manifest=()=>acceptanceCandidate().release;
const copy=(locale:'zh-CN'|'en')=>(key:string)=>(resources[locale].translation as Record<string,string>)[key];
let ids:{photo:string;foreign:string};
test.beforeAll(async()=>{
 ids=await prepareCompletionArchive(fixture,password,async db=>{
  const category=await db.saveCatalogCategory(null,{name:'学习与收藏 / Personal collections'});
  const image=await db.putFile(new File([readFileSync('apps/web/public/samples/laptop.png')],'fictional-uploaded-laptop.png',{type:'image/png'}));
  const photo={...newAsset('item'),name:'Uploaded camera / 已上传照片',description:'实际附件缩略图 / Uploaded attachment',amount:680000,itemPurchasePriceKnown:true,purchaseDate:'2026-03-01',warrantyDate:'2027-06-01',location:'书房 / Study',tags:['摄影','Travel'],attachments:[image],itemMedia:{coverId:image,detailIds:[],receiptIds:[]},itemLifecycleStatus:'inUse' as const};
  const foreign={...newAsset('subscription'),name:'Annual document subscription',currency:'USD' as const,amount:4900,cycle:'year' as const,dueDate:'2027-01-26',billingAnchor:'2027-01-26',description:'Legacy original currency is retained'};
  const rows=[photo,foreign,{...newAsset('item'),name:'No photo / 无图实物',amount:12900,itemPurchasePriceKnown:true,location:'玄关 / Hall'},{...newAsset('subscription'),name:'Monthly cloud / 月付云盘',amount:2500,dueDate:'2026-11-12',billingAnchor:'2026-11-12'},{...newAsset('project'),name:'摄影入门课程 / Photography course',catalogCategoryId:category.id,description:'周末继续学习构图 / Weekend composition',url:'https://learn.example.test/course',tags:['摄影','待学习']},{...newAsset('project'),name:'Long title '.repeat(12),catalogCategoryId:category.id,description:'Long description '.repeat(25),url:'https://notes.example.test/'+ 'long-path/'.repeat(25),tags:['Long tag '.repeat(6)]},{...newAsset('project'),name:'Minimal / 极简',catalogCategoryId:category.id},{...newAsset('item'),name:'Expired warranty / 已过保修',purchaseDate:'2025-01-01',warrantyDate:'2026-01-01'}];
  for(const row of rows)await db.save('asset',row);
  await db.save('history',{id:crypto.randomUUID(),assetId:foreign.id,action:'renew',billDate:'2025-01-26',amount:4900,currency:'USD',note:'Preserved original receipt',createdAt:'2025-01-26T00:00:00.000Z'});
  return {photo:photo.id,foreign:foreign.id};
 });
});
async function start(page:Page,locale:'zh-CN'|'en') {
 await page.addInitScript(l=>localStorage.setItem('keepany-language',l),locale);
 await page.clock.setFixedTime(new Date('2026-11-05T04:00:00Z'));
 await page.goto('/assets');
 await expect(page.locator('.workspace-navigation')).toBeVisible();
 const response=await page.request.get('/');
 expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(manifest().webFiles.find((f:any)=>f.path==='index.html')!.sha256);
}
async function choose(page:Page,label:string,option:string) {await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();}
for(const locale of ['zh-CN','en'] as const) {
 test(`${locale}: AP01 AP03 AP04 AP05 AP06 AP07 compiled assets and CNY journeys`,async({page},info)=>{
  const t=copy(locale);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await start(page,locale);
  await page.screenshot({path:info.outputPath('empty.png'),fullPage:true});
  await expect(page.locator('.catalog-summary-bar')).toBeVisible();
  await restoreCompletionArchive(page,password,resolve(fixture,'fixture.ka1'));await page.goto('/assets');
  const cards=page.locator('.workspace-asset-grid > .asset-summary-card');await expect(cards).toHaveCount(8);
  await expect(page.locator('.summary-card-photo img')).toHaveCount(1);
  await expect(page.locator('.workspace-asset-grid')).toContainText(t('subscriptionCnyMissing'));
  await expect(page.locator('.catalog-summary-bar')).toContainText(t('subscriptionCnyPartial').replace('{{count}}','1'));
  await page.getByRole('button',{name:t('subscriptionRates'),exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.getByRole('textbox').first().fill('6.7');await dialog.getByRole('button',{name:t('save'),exact:true}).click();
  await expect(dialog).toBeHidden();await expect(cards.filter({hasText:'Annual document subscription'})).toContainText('328.30');
  await expect(page.locator('.catalog-summary-bar')).toContainText('52.36');
  await expect(page.locator('.workspace-catalog')).not.toContainText(/US\$|USD|\$49/);
  // 2026-11-05: the approved wallet replaces the ledger UI. Original receipts are checked in the backup below.
  await expect(page.locator('a[href="/finance"]')).toHaveCount(0);
  await page.locator('.workspace-navigation a[href="/assets"]').click();
  await expect(page.locator('.asset-view-toggle')).toHaveCount(0);await expect(page.locator('.reminder-runtime-banner')).toHaveCount(0);await expect(page.locator('.workspace-catalog > .page-header')).toHaveCount(0);
  await expect(cards.filter({hasText:'Photography course'}).locator('progress')).toHaveCount(0);await expect(cards.filter({hasText:'Expired warranty'}).locator('progress')).toHaveCount(0);
  await page.getByRole('searchbox',{name:t('workspaceSearch')}).fill('Monthly cloud');await expect(cards).toHaveCount(1);await page.reload();await expect(cards).toHaveCount(1);
  await page.getByRole('searchbox',{name:t('workspaceSearch')}).fill('');await choose(page,t('assetSort'),t('nearestDue'));await expect(cards).toHaveCount(8);
  await cards.filter({hasText:'Annual document subscription'}).click();await expect(page.getByRole('heading',{level:1,name:'Annual document subscription'})).toBeVisible();await expect(page.locator('main')).not.toContainText(/US\$|USD/);
  await page.getByRole('button',{name:t('edit'),exact:true}).click();await expect(page.getByRole('dialog')).not.toContainText(/US\$|USD/);await page.getByRole('dialog').locator('#amount').fill('330');await page.getByRole('dialog').getByRole('button',{name:t('save'),exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();await page.reload();await expect(page.locator('main')).toContainText('330.00');
  await expect(page.locator('.topbar-back-link')).toHaveAttribute('href','/assets');
  await page.getByRole('button',{name:t('renew'),exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:t('renew'),exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();await expect(page.locator('main')).toContainText('2028');
  await page.goto('/assets/subscription');await page.getByRole('searchbox',{name:t('workspaceSearch')}).fill('Annual document');await page.locator('.asset-summary-card').filter({hasText:'Annual document'}).click();await expect(page.locator('.topbar-back-link')).toHaveAttribute('href','/assets/subscription');await page.locator('.topbar-back-link').click();await expect(page.getByRole('searchbox',{name:t('workspaceSearch')})).toHaveValue('Annual document');await page.getByRole('searchbox',{name:t('workspaceSearch')}).fill('');await page.getByRole('button',{name:t('workspaceAddAsset'),exact:true}).click();const editor=page.getByRole('dialog');await editor.locator('#name').fill('New CNY / 新订阅');await editor.locator('#amount').fill('39');await editor.getByRole('button',{name:t('save'),exact:true}).click();await expect(editor).toBeHidden();await page.reload();await expect(page.locator('.workspace-asset-grid')).toContainText('39.00');
  // Export through the visible backup UI and inspect only the synthetic archive.
  await page.goto('/backup');const backup=page.locator('.intake-backup-card');await backup.locator('#backup-password').fill(password);
  await backup.getByRole('button',{name:t('backup'),exact:true}).click();await expect(backup.getByRole('link',{name:t('saveBackupFile'),exact:true})).toBeVisible();const download=page.waitForEvent('download');await backup.getByRole('link',{name:t('saveBackupFile'),exact:true}).click();const file=await (await download).path();
  const zip=unzipSync(await decryptBackup(new Uint8Array(readFileSync(file!)),password));const archive=JSON.parse(strFromU8(zip['records.json']));
  const raw=JSON.stringify(archive);expect(raw).toContain('subscriptionCny');expect(raw).toContain('USD');expect(raw).toContain('4900');
  expect(errors).toEqual([]);
  await info.attach('contract-results.json',{body:JSON.stringify({ids:['AP01','AP03','AP04','AP05','AP06','AP07'],candidate:manifest().webFiles.find((f:any)=>f.path==='index.html')!.sha256,result:'passed'}),contentType:'application/json'});
 });
 for(const width of [390,768,1280,1920,2262]) test(`${locale} ${width}: AP08 compiled responsive states`,async({page},info)=>{
  const t=copy(locale);await page.setViewportSize({width,height:900});await start(page,locale);
  await restoreCompletionArchive(page,password,resolve(fixture,'fixture.ka1'));await page.goto('/assets');await expect(page.locator('.workspace-asset-grid > a')).toHaveCount(8);
  await page.getByRole('button',{name:t('subscriptionRates'),exact:true}).click();await page.getByRole('dialog').getByRole('textbox').first().fill('6.7');await page.getByRole('dialog').getByRole('button',{name:t('save'),exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(width>=1920)expect(await page.locator('.workspace-asset-grid').evaluate(n=>Number(getComputedStyle(n).getPropertyValue('--masonry-columns')))).toBe(4);
  await page.screenshot({path:info.outputPath('populated.png'),fullPage:true});await page.locator('.asset-summary-card').first().hover();await page.screenshot({path:info.outputPath('hover.png'),fullPage:true});await page.getByRole('searchbox',{name:t('workspaceSearch')}).focus();await page.screenshot({path:info.outputPath('focus.png'),fullPage:true});
  for(const kind of ['item','subscription']) {await page.locator(`.workspace-navigation a[href="/assets/${kind}"]`).click();await page.screenshot({path:info.outputPath(`${kind}.png`),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
  await page.getByRole('button',{name:t('workspaceAddAsset'),exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:t('save'),exact:true}).click();await expect(page.getByRole('dialog').locator('#name')).toHaveAttribute('aria-invalid','true');await page.screenshot({path:info.outputPath('editor-error.png'),fullPage:true});await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();
  await page.locator('.workspace-navigation').getByRole('link',{name:'学习与收藏 / Personal collections',exact:true}).click();await page.locator('.asset-summary-card').filter({hasText:'Photography course'}).click();await expect(page.locator('.unified-asset-detail details, .unified-asset-detail summary')).toHaveCount(0);await page.locator('.unified-detail-description').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('expanded.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await info.attach('contract-results.json',{body:JSON.stringify({ids:['AP08'],locale,width,candidate:manifest().webFiles.find((f:any)=>f.path==='index.html')!.sha256,result:'passed'}),contentType:'application/json'});
 });
}

