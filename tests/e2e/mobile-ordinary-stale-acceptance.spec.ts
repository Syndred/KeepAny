import {expect,test,type Locator,type Page} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import type {Asset} from '../../packages/domain/src';
import {sourceModuleUrl} from './helpers/source-module-url';

// Reuse the preceding full-field slice's synthetic fixture and raw snapshots; all writers below are actual UI Pages.
type Kind='project'|'account'|'subscription'|'item';
type RecordRow={id:string;type:string;payload:string;[key:string]:unknown};
type Snapshot={rows:RecordRow[];files:{id:string;name:string;type:string;bytes:number;sha256:string}[]};
type Seed={targets:Record<Kind,string>;newProject:string;newAccount:string};
const repositoryPath=sourceModuleUrl('packages/local-db/src/index.ts');
const domainPath=sourceModuleUrl('packages/domain/src/index.ts');
const kinds:Kind[]=['project','account','subscription','item'];
async function seed(page: Page): Promise<Seed> {
  return page.evaluate(async ({ repositoryPath, domainPath }) => {
    const { localRepository } = await import(repositoryPath); const { newAsset, relationSchema, historySchema, assetSchema } = await import(domainPath);
    const repository = await localRepository(); const oldTime = '2026-09-01T08:00:00.000Z';
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
    const paint = canvas.getContext('2d'); if (!paint) throw Error('synthetic-canvas-unavailable'); paint.fillStyle = '#e2bc51'; paint.fillRect(0, 0, 8, 8);
    const image = await (await fetch(canvas.toDataURL('image/png'))).blob();
    async function imageId(name: string) { return repository.putFile(new File([image], name, { type: 'image/png' })); }
    const projectFiles = await Promise.all(['logo', 'home', 'product', 'promo'].map(role => imageId(`seed-project-${role}.png`)));
    const itemFiles = await Promise.all(['cover', 'detail', 'receipt'].map(role => imageId(`seed-item-${role}.png`)));
    const accountFile = await imageId('seed-account-evidence.png'), subscriptionFile = await imageId('seed-subscription-evidence.png');
    const common = { createdAt: '2024-01-01T08:00:00.000Z', updatedAt: oldTime };
    const peer = { ...newAsset('item'), ...common, name: 'Protected unrelated endpoint' };
    const oldProject = { ...newAsset('project'), ...common, name: 'Existing subscription project' };
    const newProject = { ...newAsset('project'), ...common, name: 'New explicit subscription project' };
    const oldAccount = { ...newAsset('account'), ...common, name: 'Existing subscription account' };
    const newAccount = { ...newAsset('account'), ...common, name: 'New explicit subscription account' };
    const project = assetSchema.parse({ ...newAsset('project'), ...common, name: 'Seed full-field project', category: 'website',
      url: 'https://project.example.invalid/before', projectLaunchMonth: '2024-01', projectInspectionDate: '2026-11-01', contact: 'Original public contact',
      description: 'Original short project description', projectTitle: 'Original product title', projectPromoUrl: 'https://project.example.invalid/before-promo',
      tags: ['before-project'], projectMediumDescription: 'Original medium introduction', longDescription: 'Original complete introduction',
      projectFeatures: 'Original feature', projectPricing: 'Original public pricing', projectPricingType: 'Original pricing type', projectEmail: 'before@project.example.invalid',
      notes: 'Original synthetic project notes', status: 'paused', username: 'protected.unedited.project.value',
      projectDomains: [{ id: crypto.randomUUID(), name: 'preserved.example.invalid', expiryDate: '2027-08-01', annualAmount: 2200, currency: 'USD', registrar: 'Synthetic registrar', accountId: oldAccount.id, autoRenew: 'on' }],
      attachments: projectFiles, projectMedia: { logoId: projectFiles[0], homeScreenshotId: projectFiles[1], productScreenshotIds: [projectFiles[2]], promoCoverId: projectFiles[3] } });
    const account = assetSchema.parse({ ...newAsset('account'), ...common, name: 'Seed full-field account', category: 'other',
      url: 'https://account.example.invalid/before', accountProvider: 'Original provider', username: 'original.login', contact: 'Original account contact',
      description: 'Original account purpose', status: 'active', accountProfileVerifiedAt: '2026-09-02', tags: ['before-account'], notes: 'Original synthetic account notes',
      projectMediumDescription: 'Protected unedited legacy account field', attachments: [accountFile] });
    const subscriptionHistoryId = crypto.randomUUID();
    const subscription = assetSchema.parse({ ...newAsset('subscription'), ...common, name: 'Seed full-field subscription', category: 'software',
      url: 'https://subscription.example.invalid/before', subscriptionPaymentMethod: 'Original payment label', amount: 1234, currency: 'EUR', cycle: 'month', interval: 1,
      dueDate: '2026-11-30', billingAnchor: '2026-10-30', renewalCount: 1, lastRenewalId: subscriptionHistoryId,
      trialEndsAt: '2026-09-10', discountAmount: 111, discountUntil: '2026-10-01', status: 'active', tags: ['before-subscription'], notes: 'Original synthetic subscription notes',
      description: 'Protected non-editor subscription description', contact: 'Protected non-editor subscription contact', attachments: [subscriptionFile] });
    const item = assetSchema.parse({ ...newAsset('item'), ...common, name: 'Seed full-field item', category: 'device', amount: 0, currency: 'CNY', itemPurchasePriceKnown: false,
      purchaseDate: '2024-01-15', itemStartDate: '2024-02-01', itemWarrantyStatus: 'unverified', warrantyDate: '2027-02-01', location: 'Original cupboard', tags: ['before-item'], notes: 'Original synthetic item notes',
      status: 'active', borrower: '', itemExpectedReturnDate: '', itemLifecycleStatus: 'inUse', itemStatusDate: '',
      url: 'https://item.example.invalid/protected', description: 'Protected non-editor item description',
      attachments: itemFiles, itemMedia: { coverId: itemFiles[0], detailIds: [itemFiles[1]], receiptIds: [itemFiles[2]] } });
    const targets = [project, account, subscription, item];
    const relations = targets.map(value => relationSchema.parse({ id: crypto.randomUUID(), from: value.id, to: peer.id, label: 'protected-peer', source: 'Original unrelated evidence', verifiedAt: '2026-09-01', createdAt: oldTime }));
    relations.push(...[oldProject, oldAccount].map(value => relationSchema.parse({ id: crypto.randomUUID(), from: subscription.id, to: value.id, label: 'Original selected connection', source: 'Original connection evidence', createdAt: oldTime, verifiedAt: '2026-09-02' })));
    const history = targets.map(value => historySchema.parse({ id: value.kind === 'subscription' ? subscriptionHistoryId : crypto.randomUUID(), assetId: value.id,
      action: value.kind === 'subscription' ? 'renew' : 'maintenance', note: `Preserved synthetic ${value.kind} history`, createdAt: oldTime,
      ...(value.kind === 'subscription' ? { amount: 1234, currency: 'EUR' } : {}) }));
    await repository.saveBatch([...targets, peer, oldProject, newProject, oldAccount, newAccount].map(value => ({ type: 'asset', value }))
      .concat(relations.map(value => ({ type: 'relation', value })), history.map(value => ({ type: 'history', value }))));
    // The repository requires dedicated event operations for lifecycle/loan state, including synthetic preconditions.
    let currentItem = await repository.get('asset', item.id);
    const statusEvent = historySchema.parse({ id: crypto.randomUUID(), assetId: item.id, action: 'itemStatus',
      itemStatusBefore: currentItem.itemLifecycleStatus, itemStatusAfter: 'idle', eventDate: '2026-09-01', note: 'Protected synthetic lifecycle', createdAt: oldTime });
    await repository.recordItemAction(currentItem, { ...currentItem, itemLifecycleStatus: 'idle', itemStatusDate: '2026-09-01', lastItemEventId: statusEvent.id }, statusEvent);
    currentItem = await repository.get('asset', item.id);
    const loanEvent = historySchema.parse({ id: crypto.randomUUID(), assetId: item.id, action: 'loan', borrower: 'Protected synthetic borrower',
      expectedReturnDate: '2026-12-31', note: 'Protected synthetic loan', createdAt: oldTime });
    await repository.recordItemAction(currentItem, { ...currentItem, status: 'loaned', borrower: loanEvent.borrower,
      itemExpectedReturnDate: '2026-12-31', lastItemEventId: loanEvent.id }, loanEvent);
    return { targets: Object.fromEntries(targets.map(value => [value.kind, value.id])), newProject: newProject.id, newAccount: newAccount.id };
  }, { repositoryPath, domainPath });
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(async repositoryPath => {
    const repository = await (await import(repositoryPath)).localRepository();
    const rows = (await repository.allRecords()).filter((row: { type: string }) => ['asset', 'relation', 'history'].includes(row.type))
      .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
    const files = await Promise.all((await repository.fileStore.blobs.toArray()).map(async (entry: { id: string; name: string; type: string; blob: Blob }) => {
      const bytes = await entry.blob.arrayBuffer(); const digest = await crypto.subtle.digest('SHA-256', bytes);
      return { id: entry.id, name: entry.name, type: entry.blob.type, bytes: bytes.byteLength, sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('') };
    }));
    return { rows, files: files.sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)) };
  }, repositoryPath);
}
function targetAsset(state: Snapshot, id: string): Asset {
  const row = state.rows.find(value => value.id === `asset:${id}`); if (!row) throw Error('synthetic-target-missing'); return JSON.parse(row.payload);
}
async function openEditor(page: Page, zh: boolean) {
  await page.getByRole('button', { name: zh ? '编辑' : 'Edit', exact: true }).first().tap();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  for (const group of await dialog.locator('details').all()) if (await group.getAttribute('open') === null) await group.locator('summary').tap();
  return dialog;
}
async function formValues(dialog: Locator) {
  return dialog.locator('input:not([type=file]):not([type=hidden]), textarea, [role=combobox]').evaluateAll(elements => Object.fromEntries(elements
    .map(element => [element.id, element.getAttribute('role') === 'combobox' ? element.getAttribute('data-value') : (element as HTMLInputElement).value])
    .sort(([a], [b]) => String(a).localeCompare(String(b)))));
}

function preserveOtherRows(before:Snapshot,after:Snapshot,id:string,deleted=false){
 expect(after.files).toEqual(before.files);
 expect(after.rows.map(row=>row.id)).toEqual(before.rows.map(row=>row.id));
 for(const row of before.rows.filter(row=>row.id!==`asset:${id}`))expect(after.rows.find(value=>value.id===row.id)).toEqual(row);
 const old=targetAsset(before,id),next=targetAsset(after,id);
 expect(next.id).toBe(old.id);expect(next.createdAt).toBe(old.createdAt);expect(next.deleted).toBe(deleted);
 for(const key of Object.keys(old) as (keyof Asset)[])if(!['name','notes','updatedAt','lastSubscriptionSaveId','deleted'].includes(key))expect(next[key],`retained ${key}`).toEqual(old[key]);
}
async function uiUpdate(page:Page,zh:boolean,name:string,notes:string){const dialog=await openEditor(page,zh);await dialog.locator('#name').fill(name);await dialog.locator('#notes').fill(notes);await dialog.getByRole('button',{name:zh?'保存':'Save',exact:true}).tap();await expect(dialog).toBeHidden();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();}
async function openDelete(page:Page,zh:boolean){await page.getByRole('button',{name:zh?'移至回收站':'Move to trash',exact:true}).first().tap();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();return dialog;}
for(const language of ['zh-CN','en'] as const)for(const kind of kinds)test(`F02-06 ${language} ${kind} two touch Pages stale edit and delete`,async({browser},info)=>{
 test.setTimeout(90_000);const zh=language==='zh-CN';const context=await browser.newContext({locale:language,viewport:{width:390,height:844},hasTouch:true,timezoneId:'Asia/Shanghai'});
 const first=await context.newPage(),second=await context.newPage();const errors:string[]=[];for(const page of[first,second])page.on('pageerror',e=>errors.push(e.message));
 const write=(name:string,value:unknown)=>writeFileSync(info.outputPath(name),JSON.stringify(value,null,2));
 await context.addInitScript(value=>localStorage.setItem('keepany-language',value),language);
 try{
  await first.goto('/');const ids=await seed(first),id=ids.targets[kind],url=`/assets/${kind}/${id}`;await first.goto(url);await second.goto(url);
  const before=await snapshot(first);write('before.json',before);const old=targetAsset(before,id);
  let dialog=await openEditor(first,zh);await dialog.locator('#name').fill(`A unsaved ${kind}`);await dialog.locator('#notes').fill(`A preserved unsaved ${kind} note`);const draft=await formValues(dialog);write('a-old-draft.json',draft);
  await uiUpdate(second,zh,`B first committed ${kind}`,`B first committed ${kind} note`);const latest=await snapshot(second);write('b-ui-first-save.json',latest);preserveOtherRows(before,latest,id);
  await dialog.getByRole('button',{name:zh?'保存':'Save',exact:true}).tap();await expect(dialog).toBeVisible();await expect(dialog.getByRole('alert')).toHaveText(zh?'资料已在另一处更新，请重新打开后再保存。':'This record changed elsewhere. Reopen it before saving.');expect(await formValues(dialog)).toEqual(draft);
  const rejectedEdit=await snapshot(first);write('after-a-stale-save.json',rejectedEdit);expect(rejectedEdit).toEqual(latest);await first.screenshot({path:info.outputPath(`stale-edit-${language}-${kind}.png`),fullPage:true});
  await dialog.getByRole('button',{name:zh?'取消':'Cancel',exact:true}).tap();await expect(dialog).toBeHidden();await first.reload();dialog=await openEditor(first,zh);await expect(dialog.locator('#name')).toHaveValue(`B first committed ${kind}`);await expect(dialog.locator('#notes')).toHaveValue(`B first committed ${kind} note`);
  await dialog.locator('#name').fill(`A explicit reread retry ${kind}`);await dialog.getByRole('button',{name:zh?'保存':'Save',exact:true}).tap();await expect(dialog).toBeHidden();await first.reload();const retry=await snapshot(first);write('after-a-explicit-reread-save.json',retry);preserveOtherRows(before,retry,id);expect(targetAsset(retry,id)).toMatchObject({id,name:`A explicit reread retry ${kind}`,notes:`B first committed ${kind} note`,createdAt:old.createdAt});
  // The pending Delete confirmation must retain its opening snapshot while Page B commits a new version.
  await second.reload();dialog=await openDelete(first,zh);write('delete-opening.json',await snapshot(first));
  await uiUpdate(second,zh,`B newer before delete ${kind}`,`B newer before delete ${kind} note`);const beforeStaleDelete=await snapshot(second);write('b-ui-before-stale-delete.json',beforeStaleDelete);preserveOtherRows(before,beforeStaleDelete,id);
  await dialog.getByRole('button',{name:zh?'移至回收站':'Move to trash',exact:true}).tap();await expect(dialog).toBeVisible();await expect(dialog.getByRole('alert')).toHaveText(zh?'资料已更新，删除未执行。请关闭弹窗核对最新资料后重试。':'This record changed. Nothing was deleted. Close this dialog, review the latest record, and try again.');
  const rejectedDelete=await snapshot(first);write('after-a-stale-delete.json',rejectedDelete);expect(rejectedDelete).toEqual(beforeStaleDelete);await first.screenshot({path:info.outputPath(`stale-delete-${language}-${kind}.png`),fullPage:true});
  await dialog.getByRole('button',{name:zh?'取消':'Cancel',exact:true}).tap();await expect(dialog).toBeHidden();await first.reload();await expect(first.getByRole('heading',{name:`B newer before delete ${kind}`,exact:true})).toBeVisible();
  dialog=await openDelete(first,zh);await expect(dialog.getByRole('alert')).toHaveCount(0);await dialog.getByRole('button',{name:zh?'取消':'Cancel',exact:true}).tap();await expect(dialog).toBeHidden();expect(await snapshot(first)).toEqual(beforeStaleDelete);expect(errors).toEqual([]);
  dialog=await openDelete(first,zh);await dialog.getByRole('button',{name:zh?'移至回收站':'Move to trash',exact:true}).tap();await expect(dialog).toBeHidden();await expect(first).toHaveURL(new RegExp(`/assets/${kind}$`));
  const deleted=await snapshot(second);write('after-explicit-current-delete.json',deleted);preserveOtherRows(before,deleted,id,true);expect(targetAsset(deleted,id)).toMatchObject({name:`B newer before delete ${kind}`,notes:`B newer before delete ${kind} note`});
  await first.goto('/trash');const row=first.locator(`[data-asset-id="${id}"]`);await expect(row).toBeVisible();await row.getByRole('button',{name:zh?'恢复':'Restore',exact:true}).tap();await expect(row).toBeHidden();await first.goto(url);await first.reload();
  const restored=await snapshot(first);write('after-normal-ui-restore-reload.json',restored);preserveOtherRows(before,restored,id);expect(targetAsset(restored,id)).toMatchObject({id,name:`B newer before delete ${kind}`,notes:`B newer before delete ${kind} note`,createdAt:old.createdAt});expect(errors).toEqual([]);
  await first.screenshot({path:info.outputPath(`normal-restore-${language}-${kind}.png`),fullPage:true});
  write('result.json',{language,kind,id,mode:'B two real UI Pages, shared browser context',editRejectedDraftRetained:true,explicitRereadRetrySaved:true,staleDeleteRejected:true,normalDeleteAndRestoreSameId:true,unrelatedRowsHistoryAndBlobHashesPreserved:true});
 }finally{write('page-errors.json',errors);try{write('final-observed.json',await snapshot(second));}catch{write('final-observed-unavailable.json',{code:'browser-observation-unavailable'});}await context.close();}
});

for (const language of ['zh-CN', 'en'] as const) test(`F02-06 ${language} pending delete blocks close and ignores an old route completion (C-assisted B)`, async ({ browser }, info) => {
  const zh = language === 'zh-CN';
  const context = await browser.newContext({ locale: language, viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await context.addInitScript(value => localStorage.setItem('keepany-language', value), language);
  try {
    await page.goto('/'); const ids = await seed(page); const projectId = ids.targets.project;
    await page.goto(`/assets/project/${projectId}`); const before = await snapshot(page);
    const peerRow = before.rows.find(row => row.type === 'asset' && JSON.parse(row.payload).name === 'Protected unrelated endpoint');
    if (!peerRow) throw Error('synthetic-peer-missing');
    const peerId = (JSON.parse(peerRow.payload) as Asset).id;
    // Actual in-app navigation supplies a same-document history entry; goBack below exercises the route cleanup.
    await page.locator(`a[href="/assets/item/${peerId}"]`).first().tap();
    await expect(page).toHaveURL(new RegExp(`/assets/item/${peerId}(?:#.*)?$`));
    await page.evaluate(async path => {
      const repository = await (await import(path)).localRepository();
      const original = repository.deleteAssetIfCurrent.bind(repository);
      let release: () => void = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
      const state = { calls: 0, release, restore: () => { repository.deleteAssetIfCurrent = original; } };
      (window as unknown as { __syntheticPendingDelete: typeof state }).__syntheticPendingDelete = state;
      repository.deleteAssetIfCurrent = async (expected: Asset) => { state.calls++; await held; return original(expected); };
    }, repositoryPath);
    let dialog = await openDelete(page, zh); const confirm = dialog.getByRole('button', { name: zh ? '移至回收站' : 'Move to trash', exact: true });
    const box = await confirm.boundingBox(); if (!box) throw Error('synthetic-confirm-not-visible');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __syntheticPendingDelete: { calls: number } }).__syntheticPendingDelete.calls)).toBe(1);
    await expect(confirm).toBeDisabled();
    await expect(dialog.getByRole('button', { name: zh ? '取消' : 'Cancel', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: zh ? '关闭' : 'Close', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
    await page.screenshot({ path: info.outputPath(`pending-delete-${language}.png`) });
    await page.goBack(); await expect(page).toHaveURL(new RegExp(`/assets/project/${projectId}(?:#.*)?$`));
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.evaluate(() => (window as unknown as { __syntheticPendingDelete: { release: () => void } }).__syntheticPendingDelete.release());
    await expect.poll(async () => targetAsset(await snapshot(page), peerId).deleted).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/assets/project/${projectId}(?:#.*)?$`));
    expect(targetAsset(await snapshot(page), projectId)).toEqual(targetAsset(before, projectId));
    dialog = await openDelete(page, zh); await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: zh ? '取消' : 'Cancel', exact: true }).tap(); await expect(dialog).toBeHidden();
    const after = await snapshot(page);
    expect(after.files).toEqual(before.files);
    for (const row of before.rows.filter(row => row.id !== `asset:${peerId}`)) expect(after.rows.find(value => value.id === row.id)).toEqual(row);
    writeFileSync(info.outputPath('pending-route-result.json'), JSON.stringify({ language, mode: 'C-assisted B: held actual public delete method, real two touches/Escape/in-app navigation/history back', calls: 1, originalRoutePreserved: true, unrelatedRowsAndBlobsPreserved: true }, null, 2));
  } finally {
    await page.evaluate(() => { const state = (window as unknown as { __syntheticPendingDelete?: { release: () => void; restore: () => void } }).__syntheticPendingDelete; state?.release(); state?.restore(); }).catch(() => {});
    await context.close();
  }
});
