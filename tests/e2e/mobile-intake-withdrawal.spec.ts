import { readFileSync } from 'node:fs';
import { pdf } from './fixtures/pdf';
import { expect, test, type Page } from '@playwright/test';
import type { RecordRow } from '../../packages/local-db/src';
import type { ReviewedCandidate } from '../../packages/local-db/src/intake-review';
import { resources } from '../../apps/web/src/i18n';
import { sourceModuleUrl } from './helpers/source-module-url';
import { selectChoice } from './helpers/select-choice';
const repo = sourceModuleUrl('packages/local-db/src/index.ts'), domain = sourceModuleUrl('packages/domain/src/index.ts'), review = sourceModuleUrl('packages/local-db/src/intake-review.ts');
test('F14-06 CSV candidates can explicitly select expense review', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/intake');
  const id = await page.evaluate(async ({ repo, domain, review }) => { const db = await (await import(repo)).localRepository(), { newAsset } = await import(domain), { stageReviewedCandidates } = await import(review); const hash = 'a'.repeat(64), row = { id: `csv-${hash}-2`, fileHash: hash, fileName: 'synthetic.csv', rowNumber: 2, sourceText: 'kind,name\nproject,CSV expense', asset: { ...newAsset('project'), id: `csv-${hash.slice(0,48)}-2`, name: 'CSV expense' }, status: 'pending' }; await stageReviewedCandidates(db.fileStore, [row]); return row.id; }, { repo, domain, review });
  await page.reload(); const row = page.locator(`[id="intake-review-${id}"]`); await selectChoice(row.locator(`[id="${id}-kind"]`), 'expense'); await expect(row.locator(`[id="${id}-amount"]`)).toBeVisible();
});
test('F14-08 accepted ordinary candidates offer individual withdrawal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/intake');
  const id = await page.evaluate(async ({ repo, domain, review }) => { const db = await (await import(repo)).localRepository(), { newAsset } = await import(domain), { stageReviewedCandidates, decideReviewedCandidate } = await import(review); const hash = 'b'.repeat(64), row = { id: `csv-${hash}-2`, fileHash: hash, fileName: 'synthetic.csv', rowNumber: 2, sourceText: 'kind,name\nproject,Undo single', asset: { ...newAsset('project'), id: `csv-${hash.slice(0,48)}-2`, name: 'Undo single' }, status: 'pending' }; await stageReviewedCandidates(db.fileStore, [row]); await db.save('asset', row.asset); await decideReviewedCandidate(db.fileStore, row.id, 'accepted', async () => true); return row.id; }, { repo, domain, review });
  await page.reload(); await expect(page.locator(`[id="intake-review-${id}"]`).getByRole('button', { name: /撤销收录|Withdraw acceptance/ })).toBeVisible();
});

const snapshot = (page: Page): Promise<{ records: RecordRow[]; candidates: ReviewedCandidate[] }> => page.evaluate(async ({ repo, review }) => { const db = await (await import(repo)).localRepository(); return { records: await db.allRecords(), candidates: await (await import(review)).listReviewedCandidates(db.fileStore) }; }, { repo, review });
for (const locale of ['zh-CN', 'en'] as const) test(`${locale} 390 CSV PDF review withdrawal, later edits, durable retry and encrypted continuation`, async ({ browser }, info) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.addInitScript(value => localStorage.setItem('keepany-language', value), locale);
  const page = await context.newPage(), t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const password = 'Synthetic-intake-withdrawal-backup';
  try {
    await page.goto('/intake');
    const owners = await page.evaluate(async ({ repo, domain }) => { const db = await (await import(repo)).localRepository(), { newAsset } = await import(domain); const subscription = { ...newAsset('subscription'), name: 'Keep exact schedule', dueDate: '2026-11-27', renewalCount: 2, lastRenewalId: 'old-renewal', amount: 500, currency: 'USD' }, target = { ...newAsset('project'), name: 'Merge target before', notes: 'Keep target note' }; await db.saveBatch([subscription, target].map(value => ({ type: 'asset', value }))); return { subscription, target }; }, { repo, domain });
    const csv = `kind,name,amount,currency,eventDate,assetId,note\r\nproject,Withdraw now,,,,,Original note\r\nproject,Protect later edit,,,,,Keep independent edit\r\nproject,After backup,,,,,Backup acceptance\r\nexpense,Known expense,12.34,USD,2026-10-27,${owners.subscription.id},Known evidence\r\nexpense,Unknown expense,unknown,Unmapped,,,Unknown evidence\r\nproject,Pending editable,,,,,Pending evidence\r\nproject,Ignored original,,,,,Ignored evidence\r\nproject,Merged reviewed title,,,,,Merge evidence\r\n`;
    await page.getByRole('button', { name: t('intakeModeCsv'), exact: true }).click(); await page.locator('#csv-file').setInputFiles({ name: 'withdrawal.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await expect(page.locator('.intake-review-row')).toHaveCount(8);
    const candidates = (await snapshot(page)).candidates;
    const byName = (name: string) => candidates.find(row => row.asset.name === name)!;
    const row = (id: string, target = page) => target.locator(`[id="intake-review-${id}"]`);
    const get = (type: string, id: string, target = page) => target.evaluate(async ({ repo, type, id }) => (await (await import(repo)).localRepository()).get(type, id), { repo, type, id });
    async function accept(name: string) { const item = byName(name); await row(item.id).getByRole('button', { name: t('reviewConfirm'), exact: true }).dblclick(); await expect(row(item.id).locator('.chip')).toHaveText(t('reviewStatusAccepted')); return item; }
    async function openWithdrawal(id: string, target = page) { await row(id, target).getByRole('button', { name: t('reviewWithdrawAcceptance'), exact: true }).click(); await expect(target.getByRole('dialog')).toHaveCount(1); }
    async function confirmWithdrawal(id: string, target = page) { await target.getByRole('dialog').getByRole('button', { name: t('reviewWithdrawAcceptance'), exact: true }).dblclick(); await expect(target.getByRole('dialog')).toBeHidden(); await expect(row(id, target).locator('.chip')).toHaveText(t('reviewStatusWithdrawn')); }
    expect((await snapshot(page)).records.filter(row => row.type === 'history')).toHaveLength(0);
    const first = await accept('Withdraw now'), firstSaved = await get('asset', first.asset.id);
    await openWithdrawal(first.id); await page.getByRole('dialog').getByRole('button', { name: t('cancel'), exact: true }).click(); expect(await get('asset', first.asset.id)).toEqual(firstSaved);
    await openWithdrawal(first.id); await confirmWithdrawal(first.id); expect(await get('asset', first.asset.id)).toMatchObject({ deleted: true });
    const protectedRow = await accept('Protect later edit');
    await page.evaluate(async ({ repo, id }) => { const db = await (await import(repo)).localRepository(), current = await db.get('asset', id); await db.save('asset', { ...current, notes: 'Later independent edit', updatedAt: '2026-10-27T02:00:00Z' }); }, { repo, id: protectedRow.asset.id });
    await openWithdrawal(protectedRow.id); await page.getByRole('dialog').getByRole('button', { name: t('reviewWithdrawAcceptance'), exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(t('reviewWithdrawConflict')); await page.getByRole('dialog').getByRole('button', { name: t('cancel'), exact: true }).click(); expect(await get('asset', protectedRow.asset.id)).toMatchObject({ deleted: false, notes: 'Later independent edit' });
    await accept('After backup');
    const known = byName('Known expense'); await row(known.id).getByRole('button', { name: t('reviewConfirmExpense'), exact: true }).dblclick(); await expect(row(known.id).locator('.chip')).toHaveText(t('reviewStatusAccepted'));
    const knownReceipt = (await snapshot(page)).candidates.find(item => item.id === known.id)!;
    await row(known.id).getByRole('link', { name: t('reviewViewFinance'), exact: true }).click(); await expect(page.locator(`#finance-entry-${knownReceipt.historyId}`)).toContainText('Known expense'); expect(await get('asset', owners.subscription.id)).toEqual(owners.subscription);
    await page.goto('/intake'); await openWithdrawal(known.id);
    // C injection: persist the intent, fail its first CAS, retain an actionable retry.
    await page.evaluate(async repo => { const db = await (await import(repo)).localRepository(), original = db.records.compareAndWrite.bind(db.records); db.records.compareAndWrite = async () => { db.records.compareAndWrite = original; throw Error('synthetic-write-failure'); }; }, repo);
    await page.getByRole('dialog').getByRole('button', { name: t('reviewWithdrawAcceptance'), exact: true }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(t('reviewWithdrawPending')); expect(await get('history', knownReceipt.historyId!)).toMatchObject({ deleted: false });
    await confirmWithdrawal(known.id); expect(await get('history', knownReceipt.historyId!)).toMatchObject({ deleted: true, amount: 1234 }); expect(await get('asset', owners.subscription.id)).toEqual(owners.subscription);
    const unknown = byName('Unknown expense'); await expect(row(unknown.id).locator(`[id="${unknown.id}-amount"]`)).toHaveValue('unknown'); await expect(row(unknown.id).locator(`[id="${unknown.id}-currency"]`)).toContainText(t('aiChooseField'));
    await row(unknown.id).getByRole('button', { name: t('reviewConfirmExpense'), exact: true }).click(); await expect(row(unknown.id).getByRole('alert')).toBeVisible();
    await selectChoice(row(unknown.id).locator(`[id="${unknown.id}-asset"]`), owners.subscription.id); await selectChoice(row(unknown.id).locator(`[id="${unknown.id}-currency"]`), 'JPY'); await row(unknown.id).locator(`[id="${unknown.id}-amount"]`).fill('12.3'); await row(unknown.id).locator(`[id="${unknown.id}-date"]`).fill('2026-10-27');
    await row(unknown.id).getByRole('button', { name: t('reviewConfirmExpense'), exact: true }).click(); await expect(row(unknown.id).getByRole('alert')).toBeVisible(); await row(unknown.id).locator(`[id="${unknown.id}-amount"]`).fill('12'); await row(unknown.id).getByRole('button', { name: t('reviewConfirmExpense'), exact: true }).click(); await expect(row(unknown.id).locator('.chip')).toHaveText(t('reviewStatusAccepted'));
    await row(byName('Ignored original').id).getByRole('button', { name: t('reviewIgnore'), exact: true }).click(); await expect(row(byName('Ignored original').id).locator('.chip')).toHaveText(t('reviewStatusIgnored'));
    await row(byName('Pending editable').id).getByLabel(t('name'), { exact: true }).fill('Pending draft changed');
    const merged = byName('Merged reviewed title'); await row(merged.id).getByRole('button', { name: t('reviewMerge'), exact: true }).click(); await selectChoice(page.locator('#candidate-merge-target'), owners.target.id); await page.getByRole('dialog').getByRole('checkbox', { name: t('reviewMergeUseField').replace('{{field}}', t('name')), exact: true }).check(); await page.getByRole('dialog').getByRole('button', { name: t('reviewMergeConfirm'), exact: true }).click(); await expect(page.getByRole('dialog')).toBeHidden(); await expect(row(merged.id).locator('.chip')).toHaveText(t('reviewStatusAccepted'));
    await page.getByRole('button', { name: t('intakeModePdf'), exact: true }).click(); await page.locator('#csv-file').setInputFiles({ name: 'confirmed-withdrawal.pdf', mimeType: 'application/pdf', buffer: pdf(['Original PDF expense USD 9.50']) });
    const pdfRow = page.getByRole('region', { name: 'confirmed-withdrawal.pdf', exact: true }).locator('.intake-review-row'); await selectChoice(pdfRow.getByLabel(t('intakeRecordType')), 'expense'); await selectChoice(pdfRow.getByLabel(t('financeRelatedAsset')), owners.subscription.id); await pdfRow.getByLabel(t('financeRecordTitle'), { exact: true }).fill('PDF expense after backup'); await pdfRow.getByLabel(t('financeAmount'), { exact: true }).fill('9.50'); await selectChoice(pdfRow.getByLabel(t('currency'), { exact: true }), 'USD'); await pdfRow.getByLabel(t('financeDate'), { exact: true }).fill('2026-10-27'); await pdfRow.getByRole('button', { name: t('reviewConfirmExpense'), exact: true }).click(); await expect(pdfRow.locator('.chip')).toHaveText(t('reviewStatusAccepted'));
    const before = await snapshot(page); expect(before.candidates).toHaveLength(9); expect(before.candidates.find(item => item.id === merged.id)?.merge?.before).toEqual(owners.target);
    await page.locator('#backup-password').fill(password); await page.getByRole('button', { name: t('backup'), exact: true }).click(); const pendingDownload = page.waitForEvent('download'); await page.getByRole('link', { name: t('saveBackupFile'), exact: true }).click(); const download = await pendingDownload, path = await download.path(); if (!path) throw Error('download-missing'); expect(readFileSync(path).subarray(0,8).toString()).toBe('KEEPANY1');
    const clean = await browser.newContext({ locale, viewport: { width: 390, height: 844 } }); await clean.addInitScript(value => localStorage.setItem('keepany-language', value), locale);
    try {
      const restored = await clean.newPage(); await restored.goto('/intake'); await restored.locator('#backup-password').fill(password); await restored.locator('#restore-file').setInputFiles(path); await restored.getByRole('button', { name: t('preview'), exact: true }).first().click(); await restored.getByRole('button', { name: /^(确认|Confirm) ·/ }).click(); await expect.poll(async () => (await snapshot(restored)).candidates).toEqual(before.candidates);
      await expect(row(byName('Pending editable').id, restored).getByLabel(t('name'), { exact: true })).toHaveValue('Pending draft changed');
      const pdfReceipt = before.candidates.find(item => item.source === 'pdf')!;
      for (const candidate of [byName('After backup'), unknown, merged, pdfReceipt]) { await openWithdrawal(candidate.id, restored); await confirmWithdrawal(candidate.id, restored); }
      expect(await get('asset', owners.target.id, restored)).toEqual(owners.target); expect(await get('asset', owners.subscription.id, restored)).toEqual(owners.subscription);
      const after = await snapshot(restored); expect(after.candidates.filter(item => item.status === 'withdrawn')).toHaveLength(6); expect(after.records.filter(item => item.type === 'history').every(item => JSON.parse(item.payload).deleted)).toBe(true);
      await restored.reload(); await expect(row(merged.id, restored).locator('.chip')).toHaveText(t('reviewStatusWithdrawn')); await expect(row(byName('Pending editable').id, restored).getByLabel(t('name'), { exact: true })).toHaveValue('Pending draft changed');
      for (const width of [360, 390, 430]) { await restored.setViewportSize({ width, height: 844 }); expect(await restored.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await restored.screenshot({ path: info.outputPath(`review-withdrawal-restored-${locale}-${width}.png`), fullPage: true }); }
    } finally { await clean.close(); }
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
