import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resources } from '../../apps/web/src/i18n';
import { openVaultAccess } from './helpers/vault-access';
const output = 'test-results/account-card-switch/evidence';
mkdirSync(output, { recursive: true });
for (const language of ['zh-CN', 'en'] as const) test(`${language} notes and independent whole-account switch`, async ({ browser }, info) => {
 const t = (key: string) => (resources[language].translation as Record<string,string>)[key] ?? key;
 const context = await browser.newContext({ baseURL: info.project.use.baseURL, permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 900 } });
 await context.addInitScript(lang => localStorage.setItem('keepany-language', lang), language);
 const page = await context.newPage();
 const notes = 'Long synthetic note '.repeat(40) + '\nLast line';
 const master = 'SyntheticCardSwitchMaster2026!';
 const cards = page.locator('.compact-account-card');
 const save = async () => { await page.getByRole('dialog').getByRole('button', { name: /^(保存|Save|保存条目|Save entry)$/ }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); };
 try {
  await page.goto('/accounts'); await openVaultAccess(page);
  await page.locator('#password-vault-master').fill(master); await page.locator('#password-vault-master-confirm').fill(master);
  await page.getByRole('button', { name: t('accountSetUp'), exact: true }).click();
  await page.locator('.asset-category-toolbar').getByRole('button', { name: t('add'), exact: true }).click();
  await page.locator('#password-vault-entry-title').fill('Synthetic platform');
  await page.locator('#password-vault-entry-username').fill('first-login');
  await page.locator('#password-vault-entry-password').fill('SyntheticFirstPassword!');
  await page.locator('#password-vault-entry-notes').fill(notes);
  await page.getByRole('dialog').getByRole('button', { name: t('pwVaultAddIdentifier'), exact: true }).click();
  await page.locator('.pw-smart-identifier-row input').last().fill('first-alias');
  await save(); await expect(cards).toHaveCount(1);
  await cards.getByRole('button', { name: t('compactAccountCopyNotes'), exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(notes);
  await cards.getByRole('button', { name: t('add'), exact: true }).click();
  await page.locator('#password-vault-entry-title').fill('Synthetic second');
  await page.locator('#password-vault-entry-username').fill('second-login');
  await page.locator('#password-vault-entry-password').fill('SyntheticSecondPassword!');
  await expect(page.locator('#password-vault-entry-notes')).toHaveValue('');
  await save(); await expect(cards).toHaveCount(1);
  const whole = cards.getByRole('button', { name: /^(切换账号|Switch account)/ });
  // The new account can be initially selected; start deterministically on the first.
  if ((await cards.locator('[data-login-username]').innerText()) !== 'first-login') await whole.click();
  await expect(cards.locator('[data-login-username]')).toHaveText('first-login');
  await cards.getByRole('button', { name: t('pwVaultRevealPassword'), exact: true }).click();
  await whole.click();
  await expect(whole).toBeFocused();
  await expect(cards.locator('[data-login-username]')).toHaveText('second-login');
  await expect(cards.locator('[data-login-password]')).toHaveText('••••••••••');
  await expect(cards.locator('[data-login-notes]')).toHaveText(t('compactAccountNoNotes'));
  await expect(cards.getByRole('button', { name: t('compactAccountCopyNotes'), exact: true })).toBeDisabled();
  await cards.getByRole('button', { name: t('pwVaultCopyPassword'), exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('SyntheticSecondPassword!');
  await cards.getByRole('button', { name: t('edit'), exact: true }).click();
  await expect(page.locator('#password-vault-entry-username')).toHaveValue('second-login');
  await page.getByRole('dialog').getByRole('button', { name: t('cancel'), exact: true }).click();
  for (const width of [390, 768, 1280, 1920]) {
   await page.setViewportSize({ width, height: 900 });
   if (width < 768) await expect.poll(() => page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
   else await expect.poll(() => page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(0);
   await expect(cards.locator('.compact-account-row')).toHaveCount(3);
   const emptyLayout = await cards.evaluate(el => ({ height: el.getBoundingClientRect().height, loginRow: el.querySelector('.compact-account-row')!.getBoundingClientRect().height, noteRow: el.querySelector('[data-login-notes]')!.closest('.compact-account-row')!.getBoundingClientRect().height }));
   await whole.click();
   await expect(cards.locator('[data-login-notes]')).toHaveText(notes);
   const layout = await cards.evaluate(el => ({ height: el.getBoundingClientRect().height, overflow: el.scrollWidth > el.clientWidth, row: el.querySelector('[data-login-notes]')!.getBoundingClientRect().height, loginRow: el.querySelector('.compact-account-row')!.getBoundingClientRect().height, noteRow: el.querySelector('[data-login-notes]')!.closest('.compact-account-row')!.getBoundingClientRect().height }));
   expect(layout.overflow).toBe(false); expect(layout.noteRow).toBe(emptyLayout.noteRow); expect(layout.height - emptyLayout.height).toBeCloseTo(layout.loginRow - emptyLayout.loginRow, 1); expect(layout.row).toBeLessThan(45);
   await page.screenshot({ path: `${output}/${language}-${width}-notes.png`, fullPage: true });
   await cards.locator('.compact-account-switch').click();
   await expect(cards.locator('[data-login-username]')).toHaveText('first-alias');
   await whole.click();
   await expect(cards.locator('[data-login-username]')).toHaveText('second-login');
  }
  await page.reload(); await openVaultAccess(page);
  await page.locator('#password-vault-unlock-master').fill(master);
  await page.getByRole('button', { name: t('accountUnlockAction'), exact: true }).first().click();
  await expect(cards).toHaveCount(1);
  await expect(cards.getByRole('button', { name: /^(切换账号|Switch account)/ })).toBeEnabled();
 } finally { await context.close(); }
});

for (const language of ['zh-CN', 'en'] as const) test(`${language} platform detail switch follows the whole account`, async ({ browser }, info) => {
 const t = (key: string) => (resources[language].translation as Record<string,string>)[key] ?? key;
 const context = await browser.newContext({ baseURL: info.project.use.baseURL, permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 900 } });
 await context.addInitScript(lang => localStorage.setItem('keepany-language', lang), language);
 const page = await context.newPage(), master = 'SyntheticDetailSwitch2026!';
 const save = async () => { await page.getByRole('dialog').getByRole('button', { name: /^(保存|Save|保存条目|Save entry)$/ }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); };
 try {
  await page.goto('/accounts'); await openVaultAccess(page);
  await page.locator('#password-vault-master').fill(master); await page.locator('#password-vault-master-confirm').fill(master);
  await page.getByRole('button', { name: t('accountSetUp'), exact: true }).click();
  await page.locator('.asset-category-toolbar').getByRole('button', { name: t('add'), exact: true }).click();
  await page.locator('#password-vault-entry-title').fill('Synthetic first platform');
  await page.locator('#password-vault-entry-username').fill('first-login');
  await page.locator('#password-vault-entry-password').fill('SyntheticFirstPassword!');
  await page.locator('#password-vault-entry-notes').fill('First account note');
  await page.getByRole('dialog').getByRole('button', { name: t('pwVaultAddIdentifier'), exact: true }).click();
  await page.locator('.pw-smart-identifier-row input').last().fill('first-alias');
  await save();
  const cards = page.locator('.compact-account-card');
  await cards.getByRole('button', { name: t('add'), exact: true }).click();
  await page.locator('#password-vault-entry-title').fill('Synthetic second platform');
  await page.locator('#password-vault-entry-username').fill('second-login');
  await page.locator('#password-vault-entry-password').fill('SyntheticSecondPassword!');
  await page.locator('#password-vault-entry-notes').fill('Second account note'); await save();
  if ((await cards.locator('[data-login-username]').innerText()) !== 'first-login') await cards.locator('[data-account-switch]').click();
  await cards.locator('.compact-account-title-block').click();
  const whole = page.locator('[data-account-detail-switch]'), login = page.locator('.account-login-summary');
  await expect(page.getByRole('heading', { name: 'Synthetic first platform', exact: true })).toBeVisible();
  const firstURL = page.url().split("#")[0];
  if(await page.locator('[data-account-default]').isEnabled()) await page.locator('[data-account-default]').click();
  await expect(page.locator('[data-account-default]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-account-default]')).toBeDisabled();
  await whole.click();
  await expect(page.locator('[data-login-username]')).toHaveText('second-login');
  await expect(page.locator('[data-account-default]')).toBeEnabled();
  // Synthetic storage outage: the existing persistence adapter must reject this preference write.
  await page.evaluate(() => {
   const put = IDBObjectStore.prototype.put, add = IDBObjectStore.prototype.add, update = IDBCursor.prototype.update;
   const fail = (_value: unknown) => { throw new DOMException('Synthetic isolated storage outage', 'QuotaExceededError'); };
   IDBCursor.prototype.update = function(value) { fail(value); return update.call(this,value); };
   IDBObjectStore.prototype.put = function(value, key) { fail(value); return key === undefined ? put.call(this,value) : put.call(this,value,key); };
   IDBObjectStore.prototype.add = function(value, key) { fail(value); return key === undefined ? add.call(this,value) : add.call(this,value,key); };
   addEventListener('keepany-test-clear-fault', () => { IDBObjectStore.prototype.put=put; IDBObjectStore.prototype.add=add; IDBCursor.prototype.update=update; }, {once:true});
  });
  await page.locator('[data-account-default]').click();
  await expect(page.getByRole('status').filter({hasText:t('error')})).toBeVisible();
  await expect(page.locator('[data-account-default]')).toBeEnabled();
  await expect(page.locator('[data-account-default]')).toHaveAttribute('aria-pressed','false');
  await page.screenshot({path:`${output}/${language}-default-save-error.png`,fullPage:true});
  await page.evaluate(() => dispatchEvent(new Event('keepany-test-clear-fault')));
  await page.locator('[data-account-default]').click();
  await expect(page.locator('[data-account-default]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-account-default]')).toBeDisabled();
  await page.getByRole('link', { name:t('accountBack'), exact:true }).click();
  await expect(cards.locator('[data-login-username]')).toHaveText('second-login');
  await page.reload(); await openVaultAccess(page);
  await page.locator('#password-vault-unlock-master').fill(master); await page.getByRole('button', { name:t('accountUnlockAction'),exact:true }).first().click();
  await expect(cards.locator('[data-login-username]')).toHaveText('second-login');
  await page.getByRole('searchbox', { name:t('accountListSearch'),exact:true }).fill('first-login');
  await expect(cards.locator('[data-login-username]')).toHaveText('first-login');
  await page.getByRole('searchbox', { name:t('accountListSearch'),exact:true }).fill('');
  await expect(cards.locator('[data-login-username]')).toHaveText('second-login');
  await cards.locator('.compact-account-title-block').click(); await whole.click();
  await expect(page.locator('[data-login-username]')).toHaveText('first-login');

  await login.getByRole('button', { name: /^(切换登录账号|Next login)/ }).click();
  await expect(login.locator('[data-login-username]')).toHaveText('first-alias');
  await expect(page.getByRole('heading', { name: 'Synthetic first platform', exact: true })).toBeVisible();
  for (const width of [390,768,1280,1920,2262]) {
   await page.setViewportSize({width,height:900});
   await login.getByRole('button', { name: t('pwVaultRevealPassword'), exact: true }).click();
   await whole.press('Enter');
   await expect(page.getByRole('heading', { name: 'Synthetic second platform', exact: true })).toBeVisible();
   await expect(whole).toBeFocused();
   await expect(login.locator('[data-login-username]')).toHaveText('second-login');
   await expect(login.locator('[data-login-password]')).toHaveText('••••••••••');
   await expect(page.locator('.account-note-summary')).toContainText('Second account note');
   await login.getByRole('button', { name: t('pwVaultCopyPassword'), exact: true }).click();
   await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('SyntheticSecondPassword!');
   await page.locator('.page-header').getByRole('button', { name: t('edit'), exact: true }).click();
   await expect(page.locator('#password-vault-entry-username')).toHaveValue('second-login');
   await page.getByRole('dialog').getByRole('button', { name: t('cancel'), exact: true }).click();
   expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
   const buttons = await page.locator('.page-header > .actions .button').evaluateAll(elements => elements.map(e => { const r=e.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,height:r.height}; }));
   expect(buttons[0].width).toBeGreaterThanOrEqual(44); expect(buttons[0].height).toBeGreaterThanOrEqual(44);
   for(let i=1;i<buttons.length;i++) expect(buttons[i].x-buttons[i-1].right).toBeGreaterThanOrEqual(7);
   await page.screenshot({path:`${output}/${language}-${width}-detail-second.png`,fullPage:true});
   await whole.click();
   await expect(page).toHaveURL(firstURL);
   await expect(login.locator('[data-login-username]')).toHaveText('first-login');
   await expect(page.locator('.account-note-summary')).toContainText('First account note');
  }
  await whole.click(); const secondURL=page.url(); await page.goBack(); await expect(page).toHaveURL(firstURL); await page.goForward(); await expect(page).toHaveURL(secondURL);
  await page.reload(); await openVaultAccess(page);
  await page.locator('#password-vault-unlock-master').fill(master); await page.getByRole('button', { name:t('accountUnlockAction'),exact:true }).first().click();
  await expect(login.locator('[data-login-username]')).toHaveText('second-login'); await expect(whole).toBeEnabled();
 } finally { await context.close(); }
});

for (const language of ['zh-CN','en'] as const) test(`${language} list edit modal switches accounts without losing drafts`, async ({browser},info) => {
 const t=(key:string)=>(resources[language].translation as Record<string,string>)[key]??key;
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:{width:1280,height:900}});
 await context.addInitScript(lang=>localStorage.setItem('keepany-language',lang),language);
 const page=await context.newPage(),master='SyntheticEditorSwitch2026!';
 const save=async()=>{await page.getByRole('dialog').getByRole('button',{name:/^(保存|Save|保存条目|Save entry)$/}).click();await expect(page.getByRole('dialog')).toHaveCount(0);};
 try {
  await page.goto('/accounts');await openVaultAccess(page);await page.locator('#password-vault-master').fill(master);await page.locator('#password-vault-master-confirm').fill(master);await page.getByRole('button',{name:t('accountSetUp'),exact:true}).click();
  await page.locator('.asset-category-toolbar').getByRole('button',{name:t('add'),exact:true}).click();
  await page.locator('#password-vault-entry-title').fill('Editor platform A');await page.locator('#password-vault-entry-username').fill('editor-a');await page.locator('#password-vault-entry-password').fill('SyntheticA!');await page.locator('#password-vault-entry-notes').fill('Note A');await save();
  const cards=page.locator('.compact-account-card');await cards.getByRole('button',{name:t('add'),exact:true}).click();
  await page.locator('#password-vault-entry-title').fill('Editor platform B');await page.locator('#password-vault-entry-username').fill('editor-b');await page.locator('#password-vault-entry-password').fill('SyntheticB!');await page.locator('#password-vault-entry-notes').fill('Note B');await save();
  // Establish B as the persisted default, then manually show A before changing defaults twice.
  if(await cards.locator('[data-login-username]').innerText()!=='editor-b') await cards.locator('[data-account-switch]').click();
  await cards.getByRole('button',{name:t('edit'),exact:true}).click();
  if(await page.locator('[data-account-default]').isEnabled()) await page.locator('[data-account-default]').click();
  await expect(page.locator('[data-account-default]')).toHaveAttribute('aria-pressed','true');
  await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();
  if(await cards.locator('[data-login-username]').innerText()!=='editor-a') await cards.locator('[data-account-switch]').click();
  await cards.getByRole('button',{name:t('edit'),exact:true}).click();
  const switcher=page.locator('[data-account-editor-switch]'),def=page.locator('[data-account-default]');
  await expect(switcher).toBeEnabled();if(await def.isEnabled()) await def.click();await expect(def).toHaveAttribute('aria-pressed','true');await expect(def).toBeDisabled();
  await switcher.click();await expect(page.locator('#password-vault-entry-username')).toHaveValue('editor-b');await expect(def).toBeEnabled();
  await page.locator('#password-vault-entry-notes').fill('Unsaved B draft');await def.click();await expect(def).toHaveAttribute('aria-pressed','true');await expect(def).toBeDisabled();await expect(page.locator('#password-vault-entry-notes')).toHaveValue('Unsaved B draft');
  await switcher.click();await expect(page.getByRole('dialog',{includeHidden:true})).toHaveCount(2);await expect(page.getByRole('dialog')).toHaveCount(1);await page.getByRole('dialog').last().getByRole('button',{name:t('accountEditorKeepEditing'),exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page.locator('#password-vault-entry-notes')).toHaveValue('Unsaved B draft');
  await switcher.click();await page.getByRole('dialog').last().press('Escape');await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page.locator('#password-vault-entry-username')).toHaveValue('editor-b');
  await switcher.click();await page.getByRole('dialog').last().getByRole('button',{name:t('accountEditorDiscardSwitch'),exact:true}).click();await expect(page.locator('#password-vault-entry-username')).toHaveValue('editor-a');await expect(page.locator('#password-vault-entry-notes')).toHaveValue('Note A');
  await page.locator('#password-vault-entry-notes').fill('Saved A only');await save();await expect(cards.locator('[data-login-username]')).toHaveText('editor-b');
  await cards.getByRole('button',{name:t('edit'),exact:true}).click();await expect(page.locator('#password-vault-entry-notes')).toHaveValue('Note B');await switcher.click();await expect(page.locator('#password-vault-entry-notes')).toHaveValue('Saved A only');
  for(const width of [390,768,1280,1920,2262]) {
   await page.setViewportSize({width,height:900});await expect(switcher).toBeVisible();
   const layout=await page.getByRole('dialog').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth,buttons:Array.from(el.querySelectorAll('.account-entry-platform-actions .button')).map(b=>{const r=b.getBoundingClientRect();return{x:r.x,right:r.right,y:r.y,height:r.height};})}));
   expect(layout.overflow).toBe(false);expect(layout.buttons[0].height).toBeGreaterThanOrEqual(44);expect(layout.buttons[1].x-layout.buttons[0].right).toBeGreaterThanOrEqual(8);
   await page.screenshot({path:`${output}/${language}-${width}-edit-modal.png`,fullPage:true});
  }
  await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();
  await page.locator('.asset-category-toolbar').getByRole('button',{name:t('add'),exact:true}).click();await expect(switcher).toHaveCount(0);await expect(def).toHaveCount(0);await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();
  if(await cards.locator('[data-login-username]').innerText()!=='editor-a') await cards.locator('[data-account-switch]').click();
  await cards.locator('.compact-account-title-block').click();
  const history=page.locator('.account-history-row');await expect(history).toHaveCount(1);
  await history.getByRole('button',{name:/^(恢复|Restore) ·/}).click();await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();
  await history.getByRole('button',{name:/^(删除|Delete) ·/}).click();await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();await expect(history).toHaveCount(1);
  for(const width of [390,768,1280,1920,2262]) {
   await page.setViewportSize({width,height:900});await expect(history.getByRole('button',{name:/^(删除|Delete) ·/})).toBeVisible();
   await page.screenshot({path:`${output}/${language}-${width}-history-icons.png`,fullPage:true});
  }
  await history.getByRole('button',{name:/^(删除|Delete) ·/}).click();await page.getByRole('dialog').getByRole('button',{name:t('accountHistoryDeleteAction'),exact:true}).click();await expect(history).toHaveCount(0);await expect(page.locator('.account-note-summary')).toContainText('Saved A only');
  await page.locator('.page-header').getByRole('button',{name:t('edit'),exact:true}).click();await page.locator('#password-vault-entry-notes').fill('Latest A note');await save();await expect(history).toHaveCount(1);
  await history.getByRole('button',{name:/^(恢复|Restore) ·/}).click();await page.getByRole('dialog').getByRole('button',{name:t('pwVaultHistoryRestore'),exact:true}).click();await expect(page.locator('.account-note-summary')).toContainText('Saved A only');

 } finally {await context.close();}
});

for(const language of ['zh-CN','en'] as const) test(`${language} reordered platform cycle is shared by cards details and editor`,async({browser},info)=>{
 const t=(key:string)=>(resources[language].translation as Record<string,string>)[key]??key;
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:{width:1280,height:900}});await context.addInitScript(lang=>localStorage.setItem('keepany-language',lang),language);const page=await context.newPage(),master='SyntheticOrderCycle2026!';
 const save=async()=>{await page.getByRole('dialog').getByRole('button',{name:/^(保存|Save|保存条目|Save entry)$/}).click();await expect(page.getByRole('dialog')).toHaveCount(0);};
 try{
  await page.goto('/accounts');await openVaultAccess(page);await page.locator('#password-vault-master').fill(master);await page.locator('#password-vault-master-confirm').fill(master);await page.getByRole('button',{name:t('accountSetUp'),exact:true}).click();
  const cards=page.locator('.compact-account-card');
  for(const name of ['A','B','C','D']){
   if(name==='A') await page.locator('.asset-category-toolbar').getByRole('button',{name:t('add'),exact:true}).click();else await cards.getByRole('button',{name:t('add'),exact:true}).click();
   await page.locator('#password-vault-entry-title').fill(`Order ${name}`);await page.locator('#password-vault-entry-username').fill(`order-${name.toLowerCase()}`);await page.locator('#password-vault-entry-password').fill(`Synthetic${name}!`);await save();
  }
  if(await cards.locator('[data-login-username]').innerText()!=='order-a') for(let i=0;i<4&&await cards.locator('[data-login-username]').innerText()!=='order-a';i++) await cards.locator('[data-account-switch]').click();
  await cards.locator('.compact-account-title-block').click();
  const handles=page.getByRole('button',{name:/^(调整|Reorder)/});
  await expect(handles).toHaveCount(3);
  await handles.first().press('Space');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('Space');
  await expect(page.locator('.account-related-info > strong')).toHaveText(['Order C','Order D','Order B']);
  await expect(page.locator('[data-account-default]')).toBeDisabled();
  for(const name of ['c','d','b','a']){await page.locator('[data-account-detail-switch]').click();await expect(page.locator('[data-login-username]')).toHaveText(`order-${name}`);}
  await page.getByRole('link',{name:t('accountBack'),exact:true}).click();await expect(cards.locator('[data-login-username]')).toHaveText('order-a');
  await page.reload();await openVaultAccess(page);await page.locator('#password-vault-unlock-master').fill(master);await page.getByRole('button',{name:t('accountUnlockAction'),exact:true}).first().click();await expect(cards.locator('[data-login-username]')).toHaveText('order-a');
  await cards.locator('[data-account-switch]').click();await expect(cards.locator('[data-login-username]')).toHaveText('order-c');await cards.getByRole('button',{name:t('edit'),exact:true}).click();
  for(const name of ['d','b','a']){await page.locator('[data-account-editor-switch]').click();await expect(page.locator('#password-vault-entry-username')).toHaveValue(`order-${name}`);}
  await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).click();
 }finally{await context.close();}
});
