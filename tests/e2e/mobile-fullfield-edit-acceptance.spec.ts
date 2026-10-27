import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import type { Asset } from '../../packages/domain/src';
import { selectChoice } from './helpers/select-choice';
import { sourceModuleUrl } from './helpers/source-module-url';

type Kind = 'project' | 'account' | 'subscription' | 'item';
type RecordRow = { id: string; type: string; payload: string; [key: string]: unknown };
type Snapshot = { rows: RecordRow[]; files: { id: string; name: string; type: string; bytes: number; sha256: string }[] };
type Seed = { targets: Record<Kind, string>; newProject: string; newAccount: string };
const repositoryPath = sourceModuleUrl('packages/local-db/src/index.ts');
const domainPath = sourceModuleUrl('packages/domain/src/index.ts');
const kinds: Kind[] = ['project', 'account', 'subscription', 'item'];

const text: Record<Kind, Record<string, string>> = {
  project: { name: 'Changed full-field project', url: 'https://project.example.invalid/changed', projectLaunchMonth: '2025-05',
    projectInspectionDate: '2027-02-01', contact: 'Changed public contact', description: 'Changed short project description',
    projectTitle: 'Changed product title', projectPromoUrl: 'https://project.example.invalid/changed-promo', tags: 'after-project, complete',
    projectMediumDescription: 'Changed medium introduction\nSecond medium line', longDescription: 'Changed complete introduction\nSecond full line',
    projectFeatures: 'Changed first feature\nChanged second feature', projectPricing: 'Changed public pricing terms', projectPricingType: 'Changed pricing model',
    projectEmail: 'changed@project.example.invalid', notes: 'Changed synthetic project notes' },
  account: { name: 'Changed full-field account', url: 'https://account.example.invalid/changed', accountProvider: 'Changed provider',
    username: 'changed.login', contact: 'Changed account contact', description: 'Changed account purpose',
    accountProfileVerifiedAt: '2027-02-02', tags: 'after-account, complete', notes: 'Changed synthetic account notes' },
  subscription: { name: 'Changed full-field subscription', url: 'https://subscription.example.invalid/changed',
    subscriptionPaymentMethod: 'Changed payment label ending 1234', amount: '67.89', interval: '3', dueDate: '2027-02-28',
    trialEndsAt: '2027-02-01', discountAmount: '4.56', discountUntil: '2027-04-30', tags: 'after-subscription, complete', notes: 'Changed synthetic subscription notes' },
  item: { name: 'Changed full-field item', amount: '45.67', purchaseDate: '2024-06-20', itemStartDate: '2024-07-01',
    warrantyDate: '2028-06-20', location: 'Changed cupboard / shelf 2', tags: 'after-item, complete', notes: 'Changed synthetic item notes' },
};
function choices(kind: Kind, ids: Seed): Record<string, string> {
  return kind === 'project' ? { category: 'tool' } : kind === 'account' ? { category: 'social', status: 'paused' }
    : kind === 'subscription' ? { category: 'service', subscriptionProject: ids.newProject, subscriptionLoginAccount: ids.newAccount,
      currency: 'USD', cycle: 'week', status: 'paused' }
    : { category: 'other', currency: 'GBP', itemWarrantyStatus: 'inWarranty' };
}
function expectedFields(kind: Kind): Partial<Asset> {
  if (kind === 'project') return { ...text.project, tags: ['after-project', 'complete'], category: 'tool' };
  if (kind === 'account') return { ...text.account, tags: ['after-account', 'complete'], category: 'social', status: 'paused' };
  if (kind === 'subscription') return { ...text.subscription, tags: ['after-subscription', 'complete'], amount: 6789, discountAmount: 456,
    interval: 3, currency: 'USD', category: 'service', cycle: 'week', status: 'paused', billingAnchor: '2027-02-28', renewalCount: 0 };
  return { ...text.item, tags: ['after-item', 'complete'], category: 'other', amount: 4567, currency: 'GBP', itemPurchasePriceKnown: true, itemWarrantyStatus: 'inWarranty' };
}

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
async function changeEveryField(dialog: Locator, kind: Kind, ids: Seed) {
  for (const [id, value] of Object.entries(text[kind])) { await dialog.locator(`#${id}`).fill(value); await expect(dialog.locator(`#${id}`)).toHaveValue(value); }
  for (const [id, value] of Object.entries(choices(kind, ids))) await selectChoice(dialog.locator(`#${id}`), value);
}

for (const language of ['zh-CN', 'en'] as const) for (const kind of kinds) test(`F02-03 ${language} ${kind} all ordinary editor fields cancel then save at 390 touch`, async ({ browser }, info) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ locale: language, viewport: { width: 390, height: 844 }, hasTouch: true, timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage(); const errors: string[] = []; const zh = language === 'zh-CN';
  page.on('pageerror', error => errors.push(error.message));
  const write = (name: string, value: unknown) => writeFileSync(info.outputPath(name), JSON.stringify(value, null, 2));
  await page.addInitScript(value => localStorage.setItem('keepany-language', value), language);
  await page.clock.setFixedTime(new Date('2026-10-28T03:00:00.000Z'));
  try {
    await page.goto('/'); const ids = await seed(page); const id = ids.targets[kind];
    await page.goto(`/assets/${kind}/${id}`); const before = await snapshot(page); const original = targetAsset(before, id); write('before.json', before);
    await page.clock.setFixedTime(new Date('2026-10-28T04:00:00.000Z'));
    await expect(page.getByRole('heading', { name: original.name, exact: true })).toBeVisible();
    let dialog = await openEditor(page, zh); const initialForm = await formValues(dialog);
    const allValues = { ...text[kind], ...choices(kind, ids) };
    expect(Object.keys(initialForm).sort()).toEqual(Object.keys(allValues).sort());
    await changeEveryField(dialog, kind, ids); const changedForm = await formValues(dialog); write('cancel-draft-fields.json', { initialForm, changedForm });
    expect(changedForm).toEqual(allValues);
    for (const key of Object.keys(allValues)) expect(changedForm[key], `${kind}.${key} must really change`).not.toBe(initialForm[key]);
    await dialog.locator('#name').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath(`all-fields-draft-${language}-${kind}.png`), fullPage: true });
    await dialog.getByRole('button', { name: zh ? '取消' : 'Cancel', exact: true }).tap(); await expect(dialog).toBeHidden();
    const cancelled = await snapshot(page); write('after-cancel.json', cancelled); expect(cancelled).toEqual(before);
    dialog = await openEditor(page, zh); expect(await formValues(dialog)).toEqual(initialForm);
    await changeEveryField(dialog, kind, ids); expect(await formValues(dialog)).toEqual(allValues);
    await dialog.getByRole('button', { name: zh ? '保存' : 'Save', exact: true }).tap(); await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { name: text[kind].name, exact: true })).toBeVisible();
    const saved = await snapshot(page); write('after-save.json', saved); const asset = targetAsset(saved, id); const expected = expectedFields(kind);
    expect(asset).toMatchObject(expected); expect(asset.id).toBe(id); expect(asset.createdAt).toBe(original.createdAt);
    expect(Date.parse(asset.updatedAt)).toBeGreaterThan(Date.parse(original.updatedAt)); expect(Object.keys(asset).sort()).toEqual(Object.keys(original).sort());
    const permitted = new Set([...Object.keys(expected), 'updatedAt', ...(kind === 'subscription' ? ['lastSubscriptionSaveId'] : [])]);
    for (const key of Object.keys(original) as (keyof Asset)[]) if (!permitted.has(key)) expect(asset[key], `preserved ${kind}.${key}`).toEqual(original[key]);
    if (kind === 'subscription') { expect(asset.lastSubscriptionSaveId).toMatch(/^[a-f0-9-]{36}$/i); expect(asset.lastSubscriptionSaveId).not.toBe(original.lastSubscriptionSaveId); }
    expect(saved.files).toEqual(before.files);
    for (const row of before.rows.filter(value => value.id !== `asset:${id}`)) expect(saved.rows.find(value => value.id === row.id), `protected original row ${row.id}`).toEqual(row);
    const extra = saved.rows.filter(row => !before.rows.some(old => old.id === row.id));
    if (kind === 'subscription') {
      expect(extra).toHaveLength(2); expect(extra.every(row => row.type === 'relation')).toBe(true);
      const links = extra.map(row => JSON.parse(row.payload) as { from: string; to: string; deleted: boolean });
      expect(links.every(link => link.from === id && !link.deleted)).toBe(true); expect(links.map(link => link.to).sort()).toEqual([ids.newProject, ids.newAccount].sort());
    } else expect(extra).toEqual([]);
    await page.reload(); const reopened = await snapshot(page); write('after-reload.json', reopened); expect(reopened).toEqual(saved);
    dialog = await openEditor(page, zh); const reloadedForm = await formValues(dialog);
    // Connections are explicitly additive: two old + two selected links make the single-choice selectors blank on reopen.
    const expectedForm = kind === 'subscription' ? { ...allValues, subscriptionProject: '', subscriptionLoginAccount: '' } : allValues;
    expect(reloadedForm).toEqual(expectedForm);
    await dialog.getByRole('button', { name: zh ? '取消' : 'Cancel', exact: true }).tap(); await expect(dialog).toBeHidden();
    expect(await snapshot(page)).toEqual(saved); expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false); expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath(`fullfield-saved-${language}-${kind}.png`), fullPage: true });
    write('result.json', { language, kind, fields: Object.keys(allValues), source: 'shared React B, repository synthetic precondition only', id,
      cancelledExact: true, savedSameId: true, untouchedRowsAndHistoryPreserved: true, mediaBytesAndReferencesPreserved: true, errors });
  } finally { write('page-errors.json', errors); await context.close(); }
});
