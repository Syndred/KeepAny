import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { resources } from '../../apps/web/src/i18n';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import { inspectArchive } from '../../packages/local-db/src';
import { selectChoice } from './helpers/select-choice';
import { sourceModuleUrl } from './helpers/source-module-url';
import { aiServer, labels, model, openAssistant, syntheticKey } from './helpers/ai-workflow';

const repo = sourceModuleUrl('packages/local-db/src/index.ts');
const domain = sourceModuleUrl('packages/domain/src/index.ts');
const reminderModule = sourceModuleUrl('apps/web/src/reminders.ts');
const backupPassword = 'F13-synthetic-archive-only-20261028';
const now = '2026-02-01T14:00:00.000Z';
const consumerFiles = ['apps/web/src/workflows.tsx', 'apps/web/src/TaskRow.tsx', 'apps/web/src/MaintenanceTaskRow.tsx', 'apps/web/src/components/ReminderSettingsPanel.tsx', 'apps/web/src/reminders.ts', 'packages/local-db/src/index.ts', 'packages/domain/src/task-reminder.ts', 'packages/domain/src/task-repeat.ts'];
const hashes = () => Object.fromEntries(consumerFiles.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const frozen = hashes();

async function snapshot(page: Page) {
  return page.evaluate(async path => {
    const db = await (await import(path)).localRepository();
    return { rows: (await db.allRecords()).sort((a: {id:string}, b: {id:string}) => a.id.localeCompare(b.id)), tasks: await db.list('task'), assets: await db.list('asset'), preference: await db.get('preference', 'reminder-settings') };
  }, repo);
}

async function inventory(page: Page) {
  return page.getByRole('dialog').evaluate(node => ({ text: node.textContent, controls: Array.from(node.querySelectorAll('input,textarea,button[role=combobox],select')).map(element => ({ id: element.id, type: element.getAttribute('type'), role: element.getAttribute('role') })) }));
}

async function derivedInstants(page: Page) {
  return page.evaluate(async ({ reminderModule, repo }) => {
    const db = await (await import(repo)).localRepository();
    const { dueReminders, readReminderSettings } = await import(reminderModule);
    return dueReminders(await db.list('task'), await db.list('asset'), readReminderSettings((await db.get('preference', 'reminder-settings'))?.value), Date.parse('2026-04-08T00:00:00Z')).map((reminder: {source:{id:string};dueAt:string;scheduledAt:string}) => ({ id: reminder.source.id, dueAt: reminder.dueAt, scheduledAt: reminder.scheduledAt }));
  }, { reminderModule, repo });
}

async function saveEvidence(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name}.json`);
  writeFileSync(path, JSON.stringify(value, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}

async function exportAndReadInOtherZone(browser: Browser, page: Page, locale: 'zh-CN' | 'en', info: TestInfo, expected: Awaited<ReturnType<typeof snapshot>>, restoredRow = '.maintenance-task-row') {
  const t = (key: string) => (resources[locale].translation as Record<string,string>)[key] ?? key;
  await page.goto('/intake');
  await page.locator('#backup-password').fill(backupPassword);
  await page.getByRole('button', { name: t('backup'), exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('link', { name: t('saveBackupFile'), exact: true }).click();
  const download = await pending;
  const path = info.outputPath('synthetic-recurring-reminder.ka1');
  await download.saveAs(path);
  const bytes = readFileSync(path);
  const inspected = await inspectArchive(await decryptBackup(new Uint8Array(bytes), backupPassword));
  expect(inspected.rows.sort((a,b) => a.id.localeCompare(b.id))).toEqual(expected.rows);
  const expectedInstants = await derivedInstants(page);
  const restoredContext = await browser.newContext({ locale, timezoneId: 'America/Los_Angeles', viewport: { width: 390, height: 844 }, hasTouch: true });
  await restoredContext.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
  try {
    const restored = await restoredContext.newPage();
    await restored.clock.setFixedTime(new Date(now));
    await restored.goto('/intake');
    expect((await snapshot(restored)).tasks).toEqual([]);
    await restored.locator('#backup-password').fill(backupPassword);
    await restored.locator('#restore-file').setInputFiles(path);
    await restored.getByRole('button', { name: t('preview'), exact: true }).first().click();
    await restored.getByRole('button', { name: locale === 'en' ? /^Confirm ·/ : /^确认 ·/ }).click();
    await expect.poll(async () => (await snapshot(restored)).tasks).toEqual(expected.tasks);
    const result = await snapshot(restored);
    expect(result.rows).toEqual(expected.rows);
    expect(result.assets).toEqual(expected.assets);
    expect(result.preference).toEqual(expected.preference);
    expect(await derivedInstants(restored)).toEqual(expectedInstants);
    if (expected.preference) {
      await restored.goto('/settings');
      await expect(restored.locator('#reminder-clock')).toHaveValue(expected.preference.value.time);
      await expect(restored.locator('#reminder-time-zone')).toHaveValue(expected.preference.value.timeZone);
    }
    await restored.goto('/tasks');
    await expect(restored.locator(restoredRow)).toHaveCount(1);
    await restored.screenshot({ path: info.outputPath('los-angeles-clean-ka1-restored.png'), fullPage: true });
    await saveEvidence(info, 'archive-cross-zone', { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, restoredBrowserZone: 'America/Los_Angeles', expected, actual: result });
    return result;
  } finally { await restoredContext.close(); await download.delete(); }
}

for (const locale of ['zh-CN', 'en'] as const) {
  test(`${locale} F13-05 existing manual settings plus maintenance recurrence, completion, defer and cross-zone KA1`, async ({ browser }, info) => {
    test.setTimeout(90_000);
    const t = (key: string) => (resources[locale].translation as Record<string,string>)[key] ?? key;
    const context = await browser.newContext({ locale, timezoneId: 'Asia/Shanghai', viewport: { width: 390, height: 844 }, hasTouch: true });
    await context.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
    const errors: string[] = [];
    let modelRequests = 0;
    try {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.name));
      context.on('request', request => { if (/chat\/completions|\/api\/chat|generativelanguage/.test(request.url())) modelRequests++; });
      await page.clock.setFixedTime(new Date(now));
      await page.goto('/settings');
      const settings = page.locator('section').filter({ has: page.getByRole('heading', { name: t('reminderSettingsTitle'), exact: true }) });
      await expect(settings.locator('#reminder-clock')).toBeVisible();
      await settings.locator('#reminder-clock').fill('09:00');
      await settings.locator('#reminder-time-zone').fill('America/New_York');
      await settings.getByRole('button', { name: t('save'), exact: true }).click();
      await expect(settings.getByRole('status').filter({ hasText: t('reminderSettingsSaved') })).toBeVisible();
      await settings.screenshot({ path: info.outputPath('manual-global-clock-zone.png') });
      const owner = await page.evaluate(async ({ repo, domain, locale }) => {
        const db = await (await import(repo)).localRepository(), { newAsset } = await import(domain);
        const asset = { ...newAsset('item'), name: `F13 synthetic maintenance owner ${locale}` };
        await db.save('asset', asset);
        return asset;
      }, { repo, domain, locale });
      await page.goto('/tasks');
      await page.getByRole('button', { name: t('newTask'), exact: true }).click();
      const simpleNew = await inventory(page);
      const simpleName = `F13 simple task inventory ${locale}`;
      let dialog = page.getByRole('dialog');
      await dialog.locator('#taskName').fill(simpleName);
      await dialog.locator('#taskDue').fill('2026-01-31');
      await dialog.getByRole('button', { name: t('save'), exact: true }).click();
      await expect(dialog).toBeHidden();
      const ordinary = (await snapshot(page)).tasks.find((task: {name:string}) => task.name === simpleName);
      expect(ordinary).toBeTruthy();
      const simpleRow = page.locator(`#task-${ordinary.id}`);
      await simpleRow.getByRole('button', { name: t('edit'), exact: true }).click();
      const simpleEdit = await inventory(page);
      await page.getByRole('dialog').screenshot({ path: info.outputPath('simple-task-edit-inventory.png') });
      await page.getByRole('dialog').getByRole('button', { name: t('cancel'), exact: true }).click();
      expect((await snapshot(page)).tasks.find((task: {id:string}) => task.id === ordinary.id)).toEqual(ordinary);
      await page.getByRole('button', { name: t('newMaintenancePlan'), exact: true }).click();
      dialog = page.getByRole('dialog');
      const name = `F13 manual recurring maintenance ${locale}`;
      await dialog.locator('#maintenanceName').fill(name);
      await selectChoice(dialog.locator('#maintenanceAsset'), owner.id);
      await selectChoice(dialog.locator('#maintenanceRule'), 'fixed');
      await dialog.locator('#maintenanceEvery').fill('2');
      await selectChoice(dialog.locator('#maintenanceUnit'), 'month');
      await dialog.locator('#maintenanceDue').fill('2026-01-31');
      await dialog.locator('#maintenanceLead').fill('0');
      const maintenanceNew = await inventory(page);
      await dialog.screenshot({ path: info.outputPath('manual-maintenance-recurring-fields.png') });
      await dialog.getByRole('button', { name: t('maintenanceCreate'), exact: true }).click();
      await expect(dialog).toBeHidden();
      const created = (await snapshot(page)).tasks.find((task: {name:string}) => task.name === name);
      expect(created).toMatchObject({ assetId: owner.id, dueDate: '2026-01-31', maintenancePlan: { active: true, schedule: { anchorDate: '2026-01-31', occurrence: 0, rule: { mode: 'fixed', unit: 'month', every: 2 } } } });
      const row = page.locator(`#task-${created.id}`);
      await row.getByRole('button', { name: t('maintenanceComplete'), exact: true }).click();
      await row.getByLabel(t('maintenanceActionDate'), { exact: true }).fill('2026-02-01');
      await row.getByLabel(t('maintenanceEvidence'), { exact: true }).fill('Synthetic F13 completion with preserved fixed anchor');
      await row.getByRole('button', { name: t('maintenanceSaveRecord'), exact: true }).click();
      await expect.poll(async () => (await snapshot(page)).tasks.find((task: {id:string}) => task.id === created.id)?.dueDate).toBe('2026-03-31');
      const completed = (await snapshot(page)).tasks.find((task: {id:string}) => task.id === created.id);
      expect(completed).toMatchObject({ id: created.id, done: false, completedAt: '', completionHistory: [now], maintenancePlan: { active: true, schedule: { anchorDate: '2026-01-31', dueDate: '2026-03-31', occurrence: 1 }, records: [{ action: 'complete', previousDueDate: '2026-01-31', nextDueDate: '2026-03-31' }] } });
      await page.reload();
      expect((await snapshot(page)).tasks.find((task: {id:string}) => task.id === created.id)).toEqual(completed);
      await row.locator('.maintenance-history > summary').click();
      await expect(row).toContainText('Synthetic F13 completion with preserved fixed anchor');
      await row.getByRole('button', { name: t('maintenanceDefer'), exact: true }).click();
      await row.getByLabel(t('maintenanceEvidence'), { exact: true }).fill('Synthetic F13 explicit seven-day defer');
      await row.getByRole('button', { name: t('maintenanceSaveRecord'), exact: true }).click();
      await expect.poll(async () => (await snapshot(page)).tasks.find((task: {id:string}) => task.id === created.id)?.dueDate).toBe('2026-04-07');
      await page.reload();
      const final = await snapshot(page);
      const deferred = final.tasks.find((task: {id:string}) => task.id === created.id);
      expect(deferred).toMatchObject({ id: created.id, completionHistory: [now], maintenancePlan: { deferredUntil: '2026-04-07', schedule: { anchorDate: '2026-01-31', dueDate: '2026-03-31', occurrence: 1 } } });
      expect(deferred.maintenancePlan.records.map((record: {action:string}) => record.action)).toEqual(['complete', 'defer']);
      expect(final.assets).toEqual([owner]);
      expect(final.rows.filter((record: {type:string}) => record.type === 'history')).toEqual([]);
      await row.screenshot({ path: info.outputPath('manual-completed-deferred-same-id.png') });
      const instants = await derivedInstants(page);
      expect(instants.find((entry: {id:string}) => entry.id === created.id)).toEqual({ id: created.id, dueAt: '2026-04-07T13:00:00.000Z', scheduledAt: '2026-04-07T13:00:00.000Z' });
      const restored = await exportAndReadInOtherZone(browser, page, locale, info, final);
      expect(restored.tasks.find((task: {id:string}) => task.id === created.id)).toEqual(deferred);
      await saveEvidence(info, 'manual-entry-and-lifecycle', { locale, viewport: '390x844 touch', sourceHashes: frozen, simpleNew, simpleEdit, maintenanceNew, created, completed, deferred, instants, modelRequests, boundary: 'B formal UI plus read-only C derived instants; not native notification delivery' });
      expect(modelRequests).toBe(0);
      expect(errors).toEqual([]);
      expect(hashes()).toEqual(frozen);
    } finally { await context.close(); }
  });

  test(`${locale} F13-05 ordinary task.reminder month-end completion, DST, explicit reschedule and cross-zone KA1`, async ({ browser }, info) => {
    test.setTimeout(90_000);
    const t = (key: string) => (resources[locale].translation as Record<string,string>)[key] ?? key;
    const copy = labels[locale];
    const mock = await aiServer();
    const context = await browser.newContext({ locale, timezoneId: 'Asia/Shanghai', viewport: { width: 390, height: 844 }, hasTouch: true });
    await context.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
    const errors: string[] = [];
    try {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.name));
      await page.clock.setFixedTime(new Date(now));
      await page.goto('/settings#assistant');
      const settings = page.locator('.ai-settings-panel');
      await selectChoice(settings.locator('#ai-settings-provider'), 'compatible');
      await settings.locator('#ai-settings-url').fill(mock.baseURL);
      await settings.locator('#ai-settings-model').fill(model);
      await selectChoice(settings.locator('#ai-settings-key-source'), 'session');
      await settings.locator('#ai-settings-api-key').fill(syntheticKey);
      await settings.getByRole('button', { name: copy.saveSettings, exact: true }).click();
      await expect(settings.getByRole('status').filter({ hasText: copy.ready })).toBeVisible();
      const name = `F13 ordinary recurring reminder ${locale}`;
      const proposal = { operation: 'create', name, taskQuery: '', assetQuery: '', localDate: '2026-01-31', localTime: '09:00', timeZone: 'America/New_York', leadMinutes: 30, leadDays: 0, rule: { mode: 'fixed', unit: 'month', every: 1 } };
      const dialog = await openAssistant(page, copy);
      await dialog.getByRole('button', { name: copy.reminderTab, exact: true }).click();
      mock.responses.push(JSON.stringify(proposal));
      await dialog.getByRole('textbox', { name: copy.question, exact: true }).fill(`Create ${name} on 2026-01-31 at 09:00 America/New_York, remind 30 minutes before, fixed monthly recurrence.`);
      await dialog.getByRole('button', { name: copy.send, exact: true }).click();
      const preview = dialog.locator('.ai-plan');
      await expect(preview.getByLabel(copy.time, { exact: true })).toHaveValue('09:00');
      await expect(preview.getByLabel(copy.zone, { exact: true })).toHaveValue('America/New_York');
      await expect(preview.locator('#ai-reminder-repeat')).toHaveAttribute('data-value', 'month');
      expect((await snapshot(page)).tasks).toEqual([]);
      await preview.screenshot({ path: info.outputPath('ordinary-real-ai-preview-no-task-yet.png') });
      await preview.getByRole('button', { name: copy.confirmAction, exact: true }).click();
      await expect(preview.getByRole('link', { name: copy.saved, exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: copy.close, exact: true }).click();
      await page.goto('/tasks');
      const created = (await snapshot(page)).tasks.find((task: {name:string}) => task.name === name);
      expect(created).toMatchObject({ dueDate: '2026-01-31', done: false, completionHistory: [], reminder: { at: '2026-01-31T14:00:00.000Z', anchorAt: '2026-01-31T14:00:00.000Z', occurrence: 0, timeZone: 'America/New_York', leadMinutes: 30, rule: { mode: 'fixed', unit: 'month', every: 1 } } });
      expect(created.maintenancePlan).toBeUndefined();
      const row = page.locator(`#task-${created.id}`);
      await row.getByRole('button', { name: t('complete'), exact: true }).click();
      await expect.poll(async () => (await snapshot(page)).tasks[0]?.reminder?.at).toBe('2026-02-28T14:00:00.000Z');
      const completed = (await snapshot(page)).tasks[0];
      expect(completed).toMatchObject({ id: created.id, createdAt: created.createdAt, dueDate: '2026-02-28', done: false, completedAt: '', completionHistory: [now], reminder: { anchorAt: created.reminder.anchorAt, occurrence: 1 } });
      await page.reload();
      expect((await snapshot(page)).tasks).toEqual([completed]);
      await expect(row.locator('time').nth(0)).toHaveAttribute('datetime', '2026-02-28T14:00:00.000Z');
      const secondCompletedAt = '2026-03-01T14:00:00.000Z';
      await page.clock.setFixedTime(new Date(secondCompletedAt));
      await row.getByRole('button', { name: t('complete'), exact: true }).click();
      await expect.poll(async () => (await snapshot(page)).tasks[0]?.reminder?.at).toBe('2026-03-31T13:00:00.000Z');
      const advancedAcrossDst = (await snapshot(page)).tasks[0];
      expect(advancedAcrossDst).toMatchObject({ id: created.id, dueDate: '2026-03-31', done: false, completionHistory: [now, secondCompletedAt], reminder: { anchorAt: created.reminder.anchorAt, occurrence: 2, timeZone: 'America/New_York', leadMinutes: 30 } });
      await page.reload();
      expect((await snapshot(page)).tasks).toEqual([advancedAcrossDst]);
      await expect(row.locator('time').nth(0)).toHaveAttribute('datetime', '2026-03-31T13:00:00.000Z');
      await expect(row.locator('time').nth(1)).toHaveAttribute('datetime', '2026-03-31T12:30:00.000Z');
      await row.screenshot({ path: info.outputPath('ordinary-dst-advanced-history-two.png') });
      await row.getByRole('button', { name: t('taskPostponeDay'), exact: true }).click();
      await expect.poll(async () => (await snapshot(page)).tasks[0]?.reminder?.at).toBe('2026-04-01T13:00:00.000Z');
      await page.reload();
      const final = await snapshot(page), postponed = final.tasks[0];
      expect(final.tasks).toHaveLength(1);
      expect(postponed).toMatchObject({ id: created.id, name, createdAt: created.createdAt, dueDate: '2026-04-01', done: false, completedAt: '', completionHistory: [now, secondCompletedAt] });
      expect(postponed.reminder).toEqual({ ...advancedAcrossDst.reminder, at: '2026-04-01T13:00:00.000Z', anchorAt: '2026-04-01T13:00:00.000Z', occurrence: 0 });
      expect(Object.hasOwn(postponed.reminder, 'snoozedUntil')).toBe(false);
      expect(Object.hasOwn(postponed, 'snoozedUntil')).toBe(false);
      expect(postponed.dedupeKey).toBe(`${created.dedupeKey.slice(0, created.dedupeKey.lastIndexOf(':'))}:2026-04-01`);
      expect(final.rows.filter((record: {type:string}) => record.type === 'history')).toEqual([]);
      expect(JSON.stringify(final.rows).includes(syntheticKey)).toBe(false);
      await expect(row.locator('time').nth(0)).toHaveAttribute('datetime', '2026-04-01T13:00:00.000Z');
      await expect(row.locator('time').nth(1)).toHaveAttribute('datetime', '2026-04-01T12:30:00.000Z');
      await row.screenshot({ path: info.outputPath('ordinary-explicit-date-reschedule.png') });
      const instants = await derivedInstants(page);
      expect(instants).toEqual([{ id: created.id, dueAt: '2026-04-01T13:00:00.000Z', scheduledAt: '2026-04-01T12:30:00.000Z' }]);
      const restored = await exportAndReadInOtherZone(browser, page, locale, info, final, `#task-${created.id}`);
      expect(restored.tasks).toEqual([postponed]);
      await saveEvidence(info, 'ordinary-reminder-lifecycle', { locale, sourceHashes: frozen, created, completed, advancedAcrossDst, postponed, instants, modelRequestCount: mock.requests.length, boundary: 'B real SDK against own synthetic loopback model fixture; completion/reschedule UI plus read-only exact rows and C derived instants; no N/OS/provider claim' });
      expect(mock.requests.length).toBe(1);
      expect(errors).toEqual([]);
      expect(hashes()).toEqual(frozen);
    } finally { await context.close(); await mock.close(); }
  });
}
