import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resources } from '../../apps/web/src/i18n';
import { enterAccounts } from './helpers/vault-access';
import { waitForAccountGraphSnapshot } from './helpers/account-graph';
const master='SyntheticDetailDelete2026!',backupPassword='SyntheticDeleteBackup2026!';
let directory='',backup='',privateCardId='';
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
  const listEmpty={...newAsset('account'),id:'detail-delete-list-empty',name:'Empty list account',username:'empty-list-public'};
  const linked = { ...newAsset('item'), id: 'detail-delete-linked', name: 'Synthetic Default Connection' };
  for(const asset of [a,b,empty,listEmpty,linked])await repo.save('asset',asset);
  await repo.save('relation', { id: 'detail-delete-default-link', from: b.id, to: linked.id, label: 'Default connection', createdAt: new Date().toISOString() });
  const db=Kdbx.create(new Credentials(ProtectedValue.fromString(master)),'Synthetic detail deletion');db.setVersion(3);
  const ids:string[]=[];
  for(const row of [{title:a.name,username:'delete-a@example.test',links:[a.id],aliases:['keep-alias@example.test']},{title:'Synthetic Delete A second login',username:'second-a@example.test',links:[a.id],aliases:['second-a-alias@example.test']},{title:b.name,username:'keep-b@example.test',links:[b.id],aliases:[]},{title:'Synthetic Delete Private C',username:'private-delete@example.test',links:[],aliases:[]}]) {
   const entry=db.createEntry(db.getDefaultGroup());
   for(const [key,value] of Object.entries({Title:row.title,UserName:row.username,Password:'SyntheticOnlySecret!',URL:'https://example.test/',Notes:'Synthetic note','KeepAny.LinkedAssetIds':JSON.stringify(row.links),'KeepAny.UsernameAliases':JSON.stringify(row.aliases)}))entry.fields.set(key,ProtectedValue.fromString(value));
   ids.push(entry.uuid.id);
  }
  await repo.savePasswordVault(new Uint8Array(await db.save()),null);
  privateCardId=`login-${ids.at(-1)}`;
  await repo.save('preference',{id:'keepany-account-card-groups-v1',value:[[a.id,b.id,privateCardId]]});
  directory=mkdtempSync(join(tmpdir(),'keepany-detail-delete-'));backup=join(directory,'synthetic.ka1');
  writeFileSync(backup,await encryptBackup(await repo.exportArchive(),backupPassword));
 } finally {await repo.close();}
});
test.afterAll(()=>{if(directory)rmSync(directory,{recursive:true,force:true});});
for(const language of ['zh-CN','en'] as const)test(`${language} whole account deletion opens the remaining platform default without ghost cards`,async({browser},info)=>{
 const t=(key:string)=>(resources[language].translation as Record<string,string>)[key]??key;
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:{width:1280,height:900}});
 await context.addInitScript(lang=>localStorage.setItem('keepany-language',lang),language);
 await context.addInitScript(() => {
  const NativeResizeObserver = window.ResizeObserver;
  // Suppress automatic node measurements until the destination canvas is ready.
  // Container measurements and other observers still run normally.
  window.ResizeObserver = class extends NativeResizeObserver {
   constructor(callback: ResizeObserverCallback) {
    super((entries, observer) => {
     const graph = document.querySelector('[data-delay-default-graph] .account-family-graph');
     const ready = graph?.getAttribute('data-layout-ready') === 'true';
     const deliver = entries.filter(({ target }) => ready || !graph || !graph.contains(target) || !target.matches('.react-flow__node'));
     if (deliver.length) callback(deliver, observer);
    });
   }
  };
 });
 const page=await context.newPage(),cards=page.locator('.compact-account-card');
 try {
  await page.goto('/backup');await page.locator('#backup-password').fill(backupPassword);
  await page.locator('summary').filter({hasText:t('restoreBackup')}).click();await page.locator('#restore-file').setInputFiles(backup);
  await page.getByRole('button',{name:t('preview'),exact:true}).click();await page.getByRole('button',{name:new RegExp(`^${t('confirm')} ·`)}).click();await expect(page.getByRole('button',{name:new RegExp(`^${t('confirm')} ·`)})).toHaveCount(0);
  await page.getByRole('link',{name:t('accountsWorkspace'),exact:true}).click();await enterAccounts(page,language,master);
  await cards.getByRole('link',{name:'Synthetic Delete A',exact:true}).click();
  // Choose B as the platform default through the ordinary detail control, then return to A.
  await page.locator('[data-account-detail-switch]').click();
  await expect(page.getByRole('heading',{name:'Synthetic Delete B',exact:true})).toBeVisible();
  const setDefault=page.locator('[data-account-default]');if(await setDefault.isEnabled())await setDefault.click();
  await expect(setDefault).toHaveAttribute('aria-pressed','true');await expect(setDefault).toBeDisabled();
  await page.locator('[data-account-detail-switch]').click();await expect(page.getByRole('heading',{name:'Synthetic Delete Private C',exact:true})).toBeVisible();await page.locator('[data-account-detail-switch]').click();
  await expect(page.getByRole('heading',{name:'Synthetic Delete A',exact:true})).toBeVisible();
  const remove=page.locator('[data-account-detail-delete]');await expect(remove).toBeEnabled();
  for(const width of [390,768,1280,1920]) {
   await page.setViewportSize({width,height:900});
   await expect(page.getByRole('heading',{name:'Synthetic Delete A',exact:true})).toBeVisible();
   const header=await page.locator('.page-header').boundingBox();expect(header).not.toBeNull();
   const controls=await page.locator('.page-header > .actions .button').evaluateAll(elements=>elements.map(e=>{
    const r=e.getBoundingClientRect(),svg=e.querySelector('svg')?.getBoundingClientRect();
    const text=Array.from(e.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE && node.textContent?.trim()).flatMap(node=>{const range=document.createRange();range.selectNodeContents(node);return Array.from(range.getClientRects()).map(rect=>({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}));});
    return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,svg:svg?{left:svg.left,right:svg.right,top:svg.top,bottom:svg.bottom,width:svg.width,height:svg.height}:null,text};
   }));
   expect(controls).toHaveLength(5);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
   await expect(remove).toHaveText(t('accountDetailDelete'));
   for(const rect of controls){
    expect(rect.height).toBeGreaterThanOrEqual(44);expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.x).toBeGreaterThanOrEqual(Math.max(0,header!.x)-1);expect(rect.right).toBeLessThanOrEqual(Math.min(width,header!.x+header!.width)+1);
    expect(rect.scrollWidth).toBeLessThanOrEqual(rect.clientWidth+1);expect(rect.svg).not.toBeNull();expect(rect.text).toHaveLength(1);
    for(const content of [...rect.text,...(rect.svg?[rect.svg]:[])]){expect(content.left).toBeGreaterThanOrEqual(rect.x);expect(content.right).toBeLessThanOrEqual(rect.right);expect(content.top).toBeGreaterThanOrEqual(rect.y);expect(content.bottom).toBeLessThanOrEqual(rect.bottom);}
   }
   for(let i=1;i<controls.length;i++)if(Math.abs(controls[i].y-controls[i-1].y)<1)expect(controls[i].x-controls[i-1].right).toBeGreaterThanOrEqual(7.5);
   await page.locator('.page-header').screenshot({path:info.outputPath(`header-${width}.png`)});
  }
  const original=page.url();await remove.click();await expect(page.getByRole('dialog')).toContainText('Synthetic Delete A');
  await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await expect(page).toHaveURL(original);
  // Whole-member removal must include both logins and every alias, not just the displayed identifier.
  await page.evaluate(() => document.documentElement.setAttribute('data-delay-default-graph', ''));
  await remove.click();await page.getByRole('dialog').getByRole('button',{name:t('accountDetailDelete'),exact:true}).click();
  await expect(page).toHaveURL(/\/assets\/account\/detail-delete-b(?:#.*)?$/);
  await expect(page.getByRole('heading',{name:'Synthetic Delete B',exact:true})).toBeVisible();
  await expect(page.locator('.account-login-summary [data-login-username]')).toHaveText('keep-b@example.test');
  const defaultGraph = await waitForAccountGraphSnapshot(page, { nodes: 2, edges: 1 });
  await page.evaluate(() => document.documentElement.removeAttribute('data-delay-default-graph'));
  expect(defaultGraph.nodes).toEqual(['detail-delete-b', 'detail-delete-linked']);
  await expect(page.locator('#account-relations').getByRole('link', { name: 'Synthetic Default Connection', exact: true })).toBeVisible();
  await page.locator('#account-relations').screenshot({ path: info.outputPath('default-relations-after-delete.png') });
  await expect(page.locator('.account-related-link').filter({hasText:'Synthetic Delete A'})).toHaveCount(0);
  await page.getByRole('link',{name:t('accountBack'),exact:true}).click();
  const search=page.locator('#password-vault-search-input');
  for(const query of ['Synthetic Delete A','delete-a@example.test','keep-alias@example.test','second-a@example.test','second-a-alias@example.test']){await search.fill(query);await expect(cards).toHaveCount(0);}
  await search.fill('');
  const platformCard=cards.filter({has:page.locator('[data-account-switch]:not(:disabled)')});
  const survivingMembers:string[]=[];
  for(let index=0;index<2;index++){
   await expect(platformCard).toHaveCount(1);const memberId=(await platformCard.getAttribute('data-account-id'))!;survivingMembers.push(memberId);
   await platformCard.locator('[data-account-switch]').click();await expect(platformCard).not.toHaveAttribute('data-account-id',memberId);
  }
  expect(survivingMembers.sort()).toEqual(['detail-delete-b',privateCardId].sort());
  await page.reload();await enterAccounts(page,language,master);
  await expect(cards.getByRole('link',{name:'Synthetic Delete A',exact:true})).toHaveCount(0);
  await cards.getByRole('link',{name:'Synthetic Delete B',exact:true}).click();
  const bURL=page.url();await remove.click();await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await expect(page).toHaveURL(bURL);
  await remove.click();await page.getByRole('dialog').getByRole('button',{name:t('accountDetailDelete'),exact:true}).click();
  await expect(page).toHaveURL(/\/accounts#login-detail-/);
  await expect(page.getByRole('heading',{name:'Synthetic Delete Private C',exact:true})).toBeVisible();
  await expect(page.locator('.account-login-summary [data-login-username]')).toHaveText('private-delete@example.test');
  const privateGraph = await waitForAccountGraphSnapshot(page, { nodes: 1, edges: 0 });
  expect(privateGraph.nodes).toEqual([privateCardId]);
  await expect(page.locator('[data-account-default]')).toBeDisabled();
  // Only the final platform member returns to the account list.
  const privateURL=page.url();await remove.click();await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await expect(page).toHaveURL(privateURL);
  await remove.click();await page.getByRole('dialog').getByRole('button',{name:t('accountDetailDelete'),exact:true}).click();await expect(page).toHaveURL(/\/accounts$/);
  for(const query of ['Synthetic Delete A','keep-b@example.test','private-delete@example.test']){await search.fill(query);await expect(cards).toHaveCount(0);}
  // A list deletion remains in the list and retains the user's query.
  await search.fill('Empty list account');await expect(cards).toHaveCount(1);
  await cards.getByRole('button',{name:t('accountDeleteAccountTitle'),exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Empty list account');
  await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await expect(page).toHaveURL(/\/accounts$/);await expect(search).toHaveValue('Empty list account');await expect(cards).toHaveCount(1);
  await cards.getByRole('button',{name:t('accountDeleteAccountTitle'),exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:t('accountDetailDelete'),exact:true}).click();
  await expect(page).toHaveURL(/\/accounts$/);await expect(search).toHaveValue('Empty list account');await expect(cards).toHaveCount(0);
  // Private account search is intentionally not persisted across lock/reload.
  await page.reload();await enterAccounts(page,language,master);await search.fill('Empty list account');await expect(cards).toHaveCount(0);
  await search.fill('Empty plain account');await cards.locator('.compact-account-title-block').click();await expect(page.locator('.account-login-summary [data-login-password]')).toHaveText(t('pwVaultNoPassword'));
  await remove.click();await expect(page.getByRole('dialog')).toContainText('Empty plain account');await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await expect(page).toHaveURL(/detail-delete-empty/);
  await remove.click();await page.getByRole('dialog').getByRole('button',{name:t('accountDetailDelete'),exact:true}).click();await expect(page).toHaveURL(/\/accounts$/);
  await search.fill('');await expect(cards).toHaveCount(0);
  await page.reload();await enterAccounts(page,language,master);await expect(cards).toHaveCount(0);

 } finally {await context.close();}
});
