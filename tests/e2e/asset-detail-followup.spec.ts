import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { newAsset, projectDomainSchema } from '../../packages/domain/src';
import { resources } from '../../apps/web/src/i18n';
import { prepareCompletionArchive, restoreCompletionArchive } from './helpers/completion-archive';
import { acceptanceCandidate } from './helpers/acceptance-candidate';
const password = 'DF-fictional-only-2026';
const stamp = '2026-11-05T00:00:00.000Z';
const kinds = ['ordinary', 'item', 'subscription', 'wallet'] as const;
const paths = { ordinary: '/assets', item: '/assets/item', subscription: '/assets/subscription', wallet: '/cards' };
let archive: string;
test.beforeAll(async ({}, info) => {
 const dir = resolve(process.env.KEEPANY_EVIDENCE_DIR ?? 'test-results/detail-followup', `fixture-${info.workerIndex}`);
 archive = resolve(dir, 'fixture.ka1');
 await prepareCompletionArchive(dir, password, async db => {
  const category = await db.saveCatalogCategory(null, { name: 'DF Fictional / 虚构分类' });
  const photos: string[] = [];
  for (let index = 0; index < 6; index++) photos.push(await db.putFile(new File([readFileSync('apps/web/public/samples/laptop.png')], `fictional-${index}.png`, { type: 'image/png' })));
  for (const kind of kinds) for (const variant of ['full', 'minimal', 'long']) {
   const baseKind = kind === 'ordinary' || kind === 'wallet' ? 'project' : kind;
   const asset = { ...newAsset(baseKind), id: `df-${kind}-${variant}`, name: `DF ${kind} ${variant}${variant === 'long' ? ' 长标题 / Long title '.repeat(6) : ''}`, catalogCategoryId: category.id, createdAt: stamp, updatedAt: stamp,
    ...(variant !== 'minimal' ? { url: 'https://fictional.example.test/' + (variant === 'long' ? 'long-url/'.repeat(18) : 'studio'), tags: ['fictional', '虚构'], description: variant === 'long' ? 'Long description / 长内容 '.repeat(100) : 'Fictional description / 虚构描述', notes: 'Fictional notes / 虚构备注', attachments: variant === 'full' ? photos : photos.slice(0,1) } : {}),
    ...(kind === 'wallet' ? { walletCard: { type: 'storedValue' as const, issuer: 'DF Fictional', lastFour: '1234', balanceMinor: 12000, remainingUses: null } } : {}),
    ...(kind === 'ordinary' && variant === 'full' ? { contact: 'fictional@example.test', projectTitle: 'DF retained title', projectLaunchMonth: '2026-08', projectInspectionDate: '2026-11-20', projectDomains: [projectDomainSchema.parse({ id: '11111111-1111-4111-8111-111111111111', name: 'fictional.example.test', registrar: 'DF Registrar', annualAmount: 8800, currency: 'CNY', expiryDate: '2027-03-18', autoRenew: 'unknown' })] } : {}),
   };
   await db.saveBatch([{ type: 'asset', value: asset }]);
   if (variant !== 'minimal') {
    await db.saveBatch(Array.from({ length: variant === 'full' ? 2 : 1 }, (_, index) => ({ type: 'history' as const, value: { id: `${asset.id}-history-${index}`, assetId: asset.id, action: 'expense', title: `DF history ${index}`, note: 'Fictional fee / 虚构费用', amount: 8800, currency: 'CNY', eventDate: '2026-10-27', createdAt: stamp, deleted: false } })));
    await db.saveBatch(Array.from({ length: 4 }, (_, index) => ({ type: 'task' as const, value: { id: `${asset.id}-task-${index}`, name: `DF task ${index} / 虚构待办 ` + (index === 3 ? 'Long task content / 长待办内容 '.repeat(7) : ''), assetId: asset.id, dueDate: '2026-11-20', done: false, createdAt: stamp, deleted: false } })));
   }
  }
  return { synthetic: true };
 });
});
const identity = () => acceptanceCandidate().release.webFiles.find(file => file.path === 'index.html')!.sha256;
async function start(page: Page, locale: 'zh-CN' | 'en') {
 await page.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
 await page.goto('/assets');
 expect(createHash('sha256').update(await (await page.request.get('/')).body()).digest('hex')).toBe(identity());
 await restoreCompletionArchive(page, password, archive);
}
async function enter(page: Page, kind: typeof kinds[number], variant = 'full') {
 await page.goto(paths[kind]);
 const card = page.locator('.asset-summary-card').filter({ hasText: `DF ${kind} ${variant}` });
 await expect(card).toBeVisible();
 await card.click();
 await expect(page.locator('.unified-detail-main')).toBeVisible();
 if (kind === 'ordinary' && variant === 'full') await expect(page.locator('.unified-detail-project-info')).toBeVisible();
 await page.locator('.unified-detail-main').scrollIntoViewIfNeeded();
 await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => {}))); });
}
async function shot(page: Page, info: TestInfo, name: string) {
 await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
 await info.attach(`${name}.png`, { path: info.outputPath(`${name}.png`), contentType: 'image/png' });
}
async function geometry(page: Page, width: number) {
 const fields = page.locator('.unified-detail-record-fields');
 const media = page.locator('.unified-detail-media');
 const expected = await fields.evaluate(el => { const p=document.createElement('span'); p.style.background='var(--yellow-soft)'; el.append(p); const c=getComputedStyle(p).backgroundColor; p.remove(); return c; });
 expect(expected).toBe('rgb(255, 210, 76)');
 expect(await fields.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 210, 76)');
 expect(await media.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
 const h = await page.locator('.unified-detail-history').boundingBox();
 const tasks = await page.locator('.unified-detail-tasks').boundingBox();
 if (width >= 1280) expect(h!.height).toBeLessThan(tasks!.height - 20);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
for (const locale of ['zh-CN', 'en'] as const) {
 const t = (key: string) => (resources[locale].translation as Record<string, string>)[key];
 test(`${locale} DF01 DF02 DF05 shared theme and independent heights`, async ({ page }, info) => {
  await start(page, locale);
  for (const width of [390, 768, 1280, 1920, 1976, 1986]) {
   await page.setViewportSize({ width, height: 1000 });
   for (const kind of kinds) {
    await enter(page, kind);
    await shot(page, info, `${locale}-${width}-${kind}-full`);
    await geometry(page, width);
   }
   for (const variant of ['minimal', 'long']) {
    await enter(page, 'ordinary', variant);
    await shot(page, info, `${locale}-${width}-ordinary-${variant}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
   }
  }
  await info.attach('contract-results.json', { body: JSON.stringify({ ids: ['DF01','DF02','DF05','TM05'], candidate: identity(), locale, result: 'passed' }), contentType: 'application/json' });
 });

 test(`${locale} DF03 DF04 TM02 TM03 TM04 merged original data and domain edits`, async ({ page }, info) => {
  await start(page, locale);
  await page.setViewportSize({width:1280,height:1000});
  await enter(page,'ordinary');
  await expect(page.getByText(t('detailMoreInfo'),{exact:true})).toHaveCount(0);
  await expect(page.locator('#project-detail-extras,.asset-project-profile-card,.asset-project-costs,.asset-project-reminders')).toHaveCount(0);
  await expect(page.locator('.unified-detail-info')).toContainText('fictional@example.test');
  await expect(page.locator('.unified-detail-project-info')).toContainText('88.00');
  const editDomain=page.locator('.unified-detail-project-info').getByRole('button',{name:new RegExp('^'+t('projectEditDomain'))}).first();
  await editDomain.hover(); await shot(page,info,`${locale}-hover`);
  await editDomain.focus(); await shot(page,info,`${locale}-focus`);
  await page.keyboard.down('Space'); await shot(page,info,`${locale}-pressed`); await page.keyboard.up('Space');
  let dialog=page.getByRole('dialog');
  await dialog.getByRole('textbox',{name:t('projectRegistrar'),exact:true}).fill('DF Cancelled');
  await dialog.getByRole('button',{name:t('cancel'),exact:true}).click();
  await editDomain.click();
  await expect(page.getByRole('dialog').getByRole('textbox',{name:t('projectRegistrar'),exact:true})).toHaveValue('DF Registrar');
  await page.getByRole('dialog').getByRole('textbox',{name:t('projectRegistrar'),exact:true}).fill('DF Saved');
  await page.getByRole('dialog').locator('input[inputmode="decimal"]').fill('invalid');
  await page.getByRole('dialog').getByRole('button',{name:t('save'),exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible(); await shot(page,info,`${locale}-domain-error`);
  await page.getByRole('dialog').locator('input[inputmode="decimal"]').fill('88');
  await page.getByRole('dialog').getByRole('button',{name:t('save'),exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.locator('.unified-detail-header').getByRole('button',{name:t('edit'),exact:true}).click();
  await expect(page.locator('#catalog-record-contact')).toHaveValue('fictional@example.test');
  await page.locator('#catalog-record-contact').fill('changed@example.test');
  await page.getByRole('dialog').getByRole('button',{name:t('save'),exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden(); await page.reload();
  await expect(page.locator('.unified-detail-project-info')).toContainText('changed@example.test');
  for (const width of [390,768,1280,1920,1976,1986]) {await page.setViewportSize({width,height:1000});await shot(page,info,`${locale}-${width}-merged`);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
  for (const hash of ['project-details','project-domains','project-domain-11111111-1111-4111-8111-111111111111']) {
   await page.goto(`/assets/project/df-ordinary-full#${hash}`); await expect(page.locator('.unified-detail-main')).toBeVisible();
   await expect(page.getByRole('heading',{level:1})).toHaveText(hash.startsWith('project-domain-')?'fictional.example.test':'DF ordinary full');
   await expect(page.locator('.unified-detail-project-info')).toBeVisible(); await page.reload();
   await expect(page.locator('.unified-detail-project-info')).toBeVisible();
   if(hash.startsWith('project-domain-'))await expect(page.locator('.unified-detail-project-info')).toContainText('DF Saved');
  }
  await page.goto('/records/asset:df-ordinary-full');
  await page.getByRole('button',{name:t('projectAddDomain'),exact:true}).click();
  const addedName=`new-${locale.toLowerCase()}.example.test`;
  await page.getByRole('dialog').getByRole('textbox',{name:t('projectDomain'),exact:true}).fill(addedName);
  await page.getByRole('dialog').getByRole('button',{name:t('save'),exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.locator('.unified-detail-domains a').filter({hasText:addedName}).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText(addedName);
  await page.getByRole('button',{name:t('projectEditDomain'),exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:t('projectDomainDelete'),exact:true}).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('DF ordinary full');await page.reload();
  await expect(page.locator('.unified-detail-domains a').filter({hasText:addedName})).toHaveCount(0);
  await info.attach('contract-results.json',{body:JSON.stringify({ids:['DF03','DF04','TM02','TM03','TM04'],candidate:identity(),locale,result:'passed'}),contentType:'application/json'});
 });
 test(`${locale} TM01 TM06 global accent color and shared consumers`, async ({page},info)=>{
  await start(page,locale);await page.setViewportSize({width:1280,height:900});
  for(const route of ['/','/assets','/cards','/collections','/settings','/backup','/intake','/accounts']){
   await page.goto(route);await expect(page.getByRole('heading',{level:1}).first()).toBeVisible();
   const palette=await page.evaluate(()=>{const values:Record<string,string>={};for(const name of ['--yellow','--yellow-soft','--accent','--accent-soft','--accent-hover']){const el=document.createElement('span');el.style.background=`var(${name})`;document.body.append(el);values[name]=getComputedStyle(el).backgroundColor;el.remove();}return values;});
   expect(Object.values(palette)).toEqual(Array(5).fill('rgb(255, 210, 76)'));
   await shot(page,info,`${locale}-theme-${route==='/'?'overview':route.slice(1)}`);
  }
  await page.goto('/assets');const primary=page.locator('.button.primary').first();await expect(primary).toBeVisible();
  await primary.hover();await expect(primary).toHaveCSS('background-color','rgb(255, 210, 76)');await primary.focus();await expect(primary).toHaveCSS('outline-color','rgb(32, 48, 74)');
  await info.attach('contract-results.json',{body:JSON.stringify({ids:['TM01','TM06'],candidate:identity(),locale,result:'passed'}),contentType:'application/json'});
 });
}
