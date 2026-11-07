import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resources } from '../../apps/web/src/i18n';
import { enterAccounts } from './helpers/vault-access';
const master='SyntheticDetailDelete2026!',backupPassword='SyntheticDeleteBackup2026!';
let directory='',backup='';
test.beforeAll(async()=>{
 // Isolated synthetic preparation only; every product mutation below uses the normal UI.
 const require=createRequire(join(process.cwd(),'package.json'));require('fake-indexeddb/auto');
 const {Kdbx,Credentials,ProtectedValue}=require('kdbxweb');
 const {openLocalRepository}=await import('../../packages/local-db/src/index');
 const {newAsset}=await import('../../packages/domain/src/index');
 const {encryptBackup}=await import('../../packages/local-db/src/backup-crypto');
 const repo=await openLocalRepository('detail-delete-'+crypto.randomUUID().replaceAll('-',''));
 try {
  const a={...newAsset('account'),id:'detail-delete-a',name:'Synthetic Delete A',username:'public-a'};
  const b={...newAsset('account'),id:'detail-delete-b',name:'Synthetic Delete B',username:'public-b'};
  const empty={...newAsset('account'),id:'detail-delete-empty',name:'Empty plain account',username:'empty-public'};
  for(const asset of [a,b,empty])await repo.save('asset',asset);
  const db=Kdbx.create(new Credentials(ProtectedValue.fromString(master)),'Synthetic detail deletion');db.setVersion(3);
  const ids:string[]=[];
  for(const row of [{title:a.name,username:'delete-a@example.test',links:[a.id],aliases:['keep-alias@example.test']},{title:b.name,username:'keep-b@example.test',links:[b.id],aliases:[]},{title:'Synthetic Delete Private C',username:'private-delete@example.test',links:[],aliases:[]}]) {
   const entry=db.createEntry(db.getDefaultGroup());
   for(const [key,value] of Object.entries({Title:row.title,UserName:row.username,Password:'SyntheticOnlySecret!',URL:'https://example.test/',Notes:'Synthetic note','KeepAny.LinkedAssetIds':JSON.stringify(row.links),'KeepAny.UsernameAliases':JSON.stringify(row.aliases)}))entry.fields.set(key,ProtectedValue.fromString(value));
   ids.push(entry.uuid.id);
  }
  await repo.savePasswordVault(new Uint8Array(await db.save()),null);
  await repo.save('preference',{id:'keepany-account-card-groups-v1',value:[[a.id,b.id,`login-${ids[2]}`]]});
  directory=mkdtempSync(join(tmpdir(),'keepany-detail-delete-'));backup=join(directory,'synthetic.ka1');
  writeFileSync(backup,await encryptBackup(await repo.exportArchive(),backupPassword));
 } finally {await repo.close();}
});
test.afterAll(()=>{if(directory)rmSync(directory,{recursive:true,force:true});});
for(const language of ['zh-CN','en'] as const)test(`${language} detail deletion reuses current-login and empty-account confirmation`,async({browser},info)=>{
 const t=(key:string)=>(resources[language].translation as Record<string,string>)[key]??key;
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:{width:1280,height:900}});
 await context.addInitScript(lang=>localStorage.setItem('keepany-language',lang),language);
 const page=await context.newPage(),cards=page.locator('.compact-account-card');
 try {
  await page.goto('/backup');await page.locator('#backup-password').fill(backupPassword);
  await page.locator('summary').filter({hasText:t('restoreBackup')}).click();await page.locator('#restore-file').setInputFiles(backup);
  await page.getByRole('button',{name:t('preview'),exact:true}).click();await page.getByRole('button',{name:new RegExp(`^${t('confirm')} ·`)}).click();await expect(page.getByRole('button',{name:new RegExp(`^${t('confirm')} ·`)})).toHaveCount(0);
  await page.getByRole('link',{name:t('accountsWorkspace'),exact:true}).click();await enterAccounts(page,language,master);
  await cards.getByRole('link',{name:'Synthetic Delete A',exact:true}).click();
  const remove=page.locator('[data-account-detail-delete]');await expect(remove).toBeEnabled();
  for(const width of [390,768,1280,1920]) {
   await page.setViewportSize({width,height:900});
   await expect(page.getByRole('heading',{name:'Synthetic Delete A',exact:true})).toBeVisible();
   const controls=await page.locator('.page-header > .actions .button').evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,width:r.width,height:r.height};}));
   expect(controls).toHaveLength(5);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
   for(const rect of controls){expect(rect.height).toBeGreaterThanOrEqual(44);expect(rect.width).toBeGreaterThanOrEqual(44);expect(rect.right).toBeLessThanOrEqual(width);}
   for(let i=1;i<controls.length;i++)if(Math.abs(controls[i].y-controls[i-1].y)<1)expect(controls[i].x-controls[i-1].right).toBeGreaterThanOrEqual(7.5);
   await page.locator('.page-header').screenshot({path:info.outputPath(`header-${width}.png`)});
  }
  const original=page.url();await remove.click();await expect(page.getByRole('dialog')).toHaveAccessibleName(t('accountDeleteLogin'));
  await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await expect(page).toHaveURL(original);
  await remove.click();await page.getByRole('dialog').getByRole('button',{name:t('accountDeleteLogin'),exact:true}).click();await expect(page).toHaveURL(/\/accounts$/);
  await expect(cards.filter({hasText:'Synthetic Delete A'}).locator('[data-login-username]')).toHaveText('keep-alias@example.test');
  const search=page.locator('#password-vault-search-input');await search.fill('keep-b');await expect(cards.locator('[data-login-username]')).toHaveText('keep-b@example.test');
  await search.fill('private-delete');await cards.locator('.compact-account-title-block').click();await expect(page).toHaveURL(/#login-detail-/);
  await remove.click();await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await expect(page).toHaveURL(/#login-detail-/);
  await remove.click();await page.getByRole('dialog').getByRole('button',{name:t('accountDeleteLogin'),exact:true}).click();await expect(page).toHaveURL(/\/accounts$/);
  await search.fill('Empty plain account');await cards.locator('.compact-account-title-block').click();await expect(page.locator('.account-login-summary [data-login-password]')).toHaveText(t('pwVaultNoPassword'));
  await remove.click();await expect(page.getByRole('dialog')).toHaveAccessibleName(t('pwVaultDeleteEntry'));await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await expect(page).toHaveURL(/detail-delete-empty/);
  await remove.click();await page.getByRole('dialog').getByRole('button',{name:t('pwVaultDeleteEntry'),exact:true}).click();await expect(page).toHaveURL(/\/accounts$/);
  await search.fill('keep-b');await expect(cards.locator('[data-login-username]')).toHaveText('keep-b@example.test');
 } finally {await context.close();}
});
