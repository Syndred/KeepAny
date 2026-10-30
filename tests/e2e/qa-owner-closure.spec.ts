import { openBackupPage } from "./helpers/backup-restore";
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { decryptBackup } from '../../packages/local-db/src/backup-crypto';
import { selectChoice } from './helpers/select-choice';

const output = resolve(process.env.KEEPANY_OWNER_EVIDENCE ?? 'test-results/owner-closure-matrix');
const password = 'Synthetic-owner-closure-backup';
const csv = '\ufeffkind,name,url,description\r\nproject,Owner CSV Project,https://original.example.test/,"Original first line\r\n原文第二行"\r\nproject,Owner CSV Project,https://original.example.test/,Duplicate candidate\r\nitem,Owner Waiting Item,,Keep pending\r\n';
type Entity = { id: string; [key: string]: unknown };
type Candidate = { id: string; status: string; sourceText?: string; sourceTextRef?: string; merge?: { targetId: string; fields: string[]; before: Entity; after: Entity }; [key: string]: unknown };
type Archive = { file: string; records: Array<{ type: string; payload: string }>; candidates: Candidate[] };
type Observation = { id: string; operation: string; expected: string; actual: string; passed: boolean };

for (const zh of [true, false]) for (const width of [390, 1280]) {
  test(`owner closure ${zh ? 'zh' : 'en'} ${width}: CSV source, field merge and pointer completion`, async ({ browser }) => {
    test.setTimeout(120_000);
    const tag = `${zh ? 'zh' : 'en'}-${width}`;
    const directory = resolve(output, tag);
    mkdirSync(directory, { recursive: true });
    const c = zh ? {
      spreadsheet: '表格', source: '查看原始全文', name: '名称', url: '网址', description: '简短描述',
      confirm: '确认入库', accepted: '已确认', merge: '合并到已有资料', mergeTitle: '逐字段核对合并',
      mergeConfirm: '确认合并', useDescription: '使用候选值：简短描述', cancel: '取消', receipt: '合并记录',
      backup: '创建备份', saveBackup: '保存备份文件', preview: '预览', newTask: '新建待办',
      date: '日期', save: '保存', complete: '完成', reopen: '重新打开', taskEdit: '编辑',
    } : {
      spreadsheet: 'Spreadsheet', source: 'View original source', name: 'Name', url: 'URL', description: 'Short description',
      confirm: 'Confirm and save', accepted: 'Confirmed', merge: 'Merge into existing record', mergeTitle: 'Review fields to merge',
      mergeConfirm: 'Confirm merge', useDescription: 'Use candidate value: Short description', cancel: 'Cancel', receipt: 'Merge record',
      backup: 'Create backup', saveBackup: 'Save backup file', preview: 'Preview', newTask: 'New task',
      date: 'Date', save: 'Save', complete: 'Complete', reopen: 'Reopen', taskEdit: 'Edit',
    };
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: zh ? 'zh-CN' : 'en-US', acceptDownloads: true });
    const destination = await browser.newContext({ viewport: { width, height: 844 }, locale: zh ? 'zh-CN' : 'en-US', acceptDownloads: true });
    const page = await context.newPage(), restored = await destination.newPage();
    const observations: Observation[] = [], errors: string[] = [], sourceRequests: string[] = [];
    let archiveNumber = 0;
    for (const current of [page, restored]) {
      current.on('pageerror', error => errors.push(error.message));
      current.on('request', request => { if (/\/@(?:fs|vite)\//.test(request.url())) sourceRequests.push(request.url()); });
    }
    async function step(id: string, operation: string, expected: string, action: () => Promise<string>) {
      try { observations.push({ id, operation, expected, actual: await action(), passed: true }); }
      catch (error) { observations.push({ id, operation, expected, actual: String(error), passed: false }); throw error; }
    }
    async function language(current: Page) {
      await current.goto('/settings');
      // A clean browser may already select English from its browser locale.
      await selectChoice(current.getByRole('combobox', { name: /^(语言|Language)$/ }), 'zh-CN');
      if (!zh) await selectChoice(current.getByRole('combobox', { name: '语言', exact: true }), 'en');
      await current.reload();
      await expect(current.getByRole('heading', { name: zh ? '设置' : 'Settings', exact: true })).toBeVisible();
    }
    async function archive(current: Page): Promise<Archive> {
      if (!current.url().endsWith('/intake')) await current.goto('/intake');
      await openBackupPage(current); await current.locator('#backup-password').fill(password);
      await current.getByRole('button', { name: c.backup, exact: true }).click();
      const link = current.getByRole('link', { name: c.saveBackup, exact: true });
      await expect(link).toBeVisible();
      const waiting = current.waitForEvent('download'); await link.click(); const download = await waiting;
      const file = resolve(directory, `backup-${++archiveNumber}.ka1`); await download.saveAs(file);
      const files = unzipSync(await decryptBackup(new Uint8Array(readFileSync(file)), password));
      return { file, records: JSON.parse(strFromU8(files['records.json'])), candidates: JSON.parse(strFromU8(files['intake-review.json'])) };
    }
    const assets = (backup: Archive) => backup.records.filter(row => row.type === 'asset').map(row => JSON.parse(row.payload) as Entity);
    const rows = page.locator('.intake-review-row');
    const dialog = page.getByRole('dialog', { name: c.mergeTitle, exact: true });
    let original: Archive, final: Archive, originalAsset: Entity;
    const changedDescription = 'Reviewed description only\n仅替换描述';
    async function openMerge() {
      await rows.nth(1).getByRole('button', { name: c.merge, exact: true }).click();
      await selectChoice(dialog.locator('#candidate-merge-target'), { label: 'Owner CSV Project' });
    }
    try {
      await step('S01', '从空白资料进入设置，选择语言并刷新', '语言偏好保存；不注入数据库或语言存储键。', async () => {
        await language(page); await page.goto('/intake'); return `正式设置控件及刷新后为${zh ? '中文' : 'English'}，进入收录页。`;
      });
      await step('S02', '表格入口点击文件选择器，选择真实UTF-8 CSV文件', '生成3条待确认候选，不自动入库。', async () => {
        const file = resolve(directory, 'original.csv'); writeFileSync(file, csv, 'utf8');
        await page.locator('.intake-mode-tabs').getByRole('button', { name: c.spreadsheet, exact: true }).click();
        const waiting = page.waitForEvent('filechooser'); await page.locator('#csv-file').click(); const chooser = await waiting; await chooser.setFiles(file);
        await expect(rows).toHaveCount(3); await expect(rows.locator('.chip')).toHaveText([zh ? '待确认' : 'Pending', zh ? '待确认' : 'Pending', zh ? '待确认' : 'Pending']);
        return '实际文件选择完成，候选数3，状态均pending。';
      });
      await step('S03', '展开CSV原始全文', 'BOM、CRLF、引号内换行及重复行逐字保留。', async () => {
        await page.getByText(c.source, { exact: true }).click(); expect(await page.locator('.intake-review-original pre').textContent()).toBe(csv);
        return `原文严格相等，UTF-8 SHA256=${createHash('sha256').update(csv).digest('hex')}。`;
      });
      await step('S04', '清空第三候选名称并尝试确认', '必填错误可见，候选保留，不生成资产。', async () => {
        await rows.nth(2).getByLabel(c.name, { exact: true }).fill(''); await rows.nth(2).getByRole('button', { name: c.confirm, exact: true }).click();
        await expect(rows.nth(2).getByRole('alert')).toBeVisible(); return await rows.nth(2).getByRole('alert').innerText();
      });
      await step('S05', '修正第三候选名称后刷新', '未选草稿保持，原CSV不变。', async () => {
        await rows.nth(2).getByLabel(c.name, { exact: true }).fill('Owner Waiting Edited'); await page.reload();
        await expect(rows.nth(2).getByLabel(c.name, { exact: true })).toHaveValue('Owner Waiting Edited');
        await page.getByText(c.source, { exact: true }).click(); expect(await page.locator('.intake-review-original pre').textContent()).toBe(csv); return '修改稿持久化，全文逐字相等。';
      });
      await step('S06', '只确认首条，再尝试确认第二条同名同URL候选', '仅首条保存；第二条明确拒绝重复，第三条待审核。', async () => {
        await rows.nth(0).getByRole('button', { name: c.confirm, exact: true }).click(); await expect(rows.nth(0).locator('.chip')).toHaveText(c.accepted);
        await rows.nth(1).getByRole('button', { name: c.confirm, exact: true }).click(); await expect(rows.nth(1).getByRole('alert')).toContainText(zh ? '重复' : 'Duplicate');
        original = await archive(page); originalAsset = assets(original)[0]; expect(assets(original)).toHaveLength(1); expect(original.candidates.map(row => row.status)).toEqual(['accepted', 'pending', 'pending']);
        return '真实下载备份：1资产，三候选accepted/pending/pending。';
      });
      await step('S07', '修改第二候选名称、网址与描述，再选择合并目标', '只改草稿；默认所有字段不选，展示现有值和候选值。', async () => {
        await rows.nth(1).getByLabel(c.name, { exact: true }).fill('Candidate name not selected'); await rows.nth(1).getByLabel(c.url, { exact: true }).fill('https://incoming.example.test/');
        await rows.nth(1).getByLabel(c.description, { exact: true }).fill(changedDescription); await openMerge(); await expect(dialog.locator('input[type=checkbox]:checked')).toHaveCount(0);
        await expect(dialog).toContainText('https://original.example.test/'); await expect(dialog).toContainText('https://incoming.example.test/'); return '明确选中原项目，勾选0，原/候选URL同时可见。';
      });
      await step('S08', '不勾选字段直接确认', '显示错误且弹窗保留。', async () => {
        await dialog.getByRole('button', { name: c.mergeConfirm, exact: true }).click(); await expect(dialog.getByRole('alert')).toBeVisible(); return await dialog.getByRole('alert').innerText();
      });
      await step('S09', '勾选描述后取消，再实际下载回读', '目标整条不变，候选仍pending，焦点回合并按钮。', async () => {
        await dialog.getByRole('checkbox', { name: c.useDescription, exact: true }).check(); await dialog.getByRole('button', { name: c.cancel, exact: true }).click();
        await expect(rows.nth(1).getByRole('button', { name: c.merge, exact: true })).toBeFocused(); const cancelled = await archive(page);
        expect(assets(cancelled)).toEqual([originalAsset]); expect(cancelled.candidates[1].status).toBe('pending'); return '取消后完整资产严格相等，审核未确认，焦点正确。';
      });
      await step('S10', '重开合并，只选描述并确认', '不沿用取消的勾选；仅description变更，保留原ID与未选字段。', async () => {
        await openMerge(); await expect(dialog.locator('input[type=checkbox]:checked')).toHaveCount(0); await dialog.getByRole('checkbox', { name: c.useDescription, exact: true }).check();
        await dialog.screenshot({ path: resolve(directory, 'merge.png') }); await dialog.getByRole('button', { name: c.mergeConfirm, exact: true }).click(); await expect(dialog).toBeHidden(); await expect(rows.nth(1).locator('.chip')).toHaveText(c.accepted);
        await page.reload(); const merged = await archive(page), target = assets(merged)[0]; expect(assets(merged)).toEqual([{ ...originalAsset, description: changedDescription, updatedAt: target.updatedAt }]);
        expect(merged.candidates[1].merge).toMatchObject({ targetId: target.id, fields: ['description'], before: originalAsset, after: target });
        return '备份完整对象比较：只有description和updatedAt变化，merge.fields精确为description；资产数仍1。';
      });
      await step('S11', '刷新后展开合并记录并点击目标链接', '旧值、新值、字段决定和原目标链接可回读。', async () => {
        await rows.nth(1).getByText(c.receipt, { exact: true }).click(); const receipt = rows.nth(1).locator('.candidate-merge-receipt'); await expect(receipt).toContainText('Original first line'); await expect(receipt).toContainText(changedDescription);
        const values = receipt.locator('.candidate-merge-field > div > p');
        await expect(values).toHaveCount(2);
        await expect(values.nth(0)).toHaveCSS('white-space', 'pre-wrap');
        await expect(values.nth(1)).toHaveCSS('white-space', 'pre-wrap');
        expect(await values.nth(0).textContent()).toBe('Original first line\r\n原文第二行');
        expect(await values.nth(1).textContent()).toBe(changedDescription);
        await rows.nth(1).locator(`a[href="/assets/project/${originalAsset.id}"]`).click(); await expect(page).toHaveURL(new RegExp(`/assets/project/${originalAsset.id}$`)); return '合并旧/新描述可见，打开原项目ID。';
      });
      await step('S12', '从待办页通过表单新增一个普通任务', '创建1条任务，日期按填写值保存。', async () => {
        await page.goto('/tasks'); await page.getByRole('button', { name: c.newTask, exact: true }).click(); const editor = page.getByRole('dialog');
        await editor.getByLabel(c.name, { exact: true }).fill('Owner pointer task'); await editor.getByLabel(c.date, { exact: true }).fill('2026-10-28'); await editor.getByRole('button', { name: c.save, exact: true }).click(); await expect(editor).toBeHidden();
        await expect(page.locator('.tasks-list-card article')).toHaveCount(1); return '正式表单新增唯一任务，任务日期2026-10-28。';
      });
      await step('S13', '窄/宽屏真实鼠标完成→重开→再次完成', '每次单击生效，两条完成历史保留；不使用DOM.click或Space替代。', async () => {
        const row = page.locator('.tasks-list-card article'); await page.screenshot({ path: resolve(directory, 'task-before.png'), fullPage: false });
        await row.getByRole('button', { name: c.complete, exact: true }).click(); await expect(row.getByRole('button', { name: c.reopen, exact: true })).toBeVisible();
        await row.getByRole('button', { name: c.reopen, exact: true }).click(); await expect(row.getByRole('button', { name: c.complete, exact: true })).toBeVisible();
        await row.getByRole('button', { name: c.complete, exact: true }).click(); await expect(row.getByRole('button', { name: c.reopen, exact: true })).toBeVisible(); await page.reload(); await expect(row.getByRole('button', { name: c.reopen, exact: true })).toBeVisible();
        final = await archive(page); const tasks = final.records.filter(r => r.type === 'task').map(r => JSON.parse(r.payload)); expect(tasks).toHaveLength(1); expect(tasks[0]).toMatchObject({ name: 'Owner pointer task', dueDate: '2026-10-28', done: true }); expect(tasks[0].completionHistory).toHaveLength(2);
        return '鼠标三次动作及刷新通过；真实备份1任务、done=true、completionHistory两条。';
      });
      await step('S14', '备份回读CSV全文载体与未选草稿', '全文单份及2个引用完整，第三候选仍pending且保留修改名。', async () => {
        expect(final.candidates.find(r => r.sourceText)?.sourceText).toBe(csv); expect(final.candidates.filter(r => r.sourceText)).toHaveLength(1); expect(final.candidates.filter(r => r.sourceTextRef)).toHaveLength(2);
        expect(final.candidates[2]).toMatchObject({ status: 'pending', asset: { name: 'Owner Waiting Edited' } }); return '1份全文+2引用，第三候选未确认，修改稿保持。';
      });
      await step('S15', '干净浏览器资料中用正式文件选择器预览并恢复KA1', '预览列明范围，确认才恢复，刷新后记录与审核完整。', async () => {
        await language(restored); await restored.goto('/intake'); await openBackupPage(restored); await restored.locator('#backup-password').fill(password);
        const summary = restored.locator('summary').filter({ hasText: zh ? '恢复备份' : 'Restore backup' }); await summary.click();
        const waiting = restored.waitForEvent('filechooser'); await restored.locator('#restore-file').click(); const chooser = await waiting; await chooser.setFiles(final.file);
        await restored.getByRole('button', { name: c.preview, exact: true }).first().click(); await expect(restored.getByRole('button', { name: /^确认 ·|^Confirm ·/ })).toBeVisible();
        await restored.getByRole('button', { name: /^确认 ·|^Confirm ·/ }).click(); await expect(restored.locator('.intake-review-row')).toHaveCount(3); await restored.reload(); const roundTrip = await archive(restored);
        expect(roundTrip.records).toEqual(final.records); expect(roundTrip.candidates).toEqual(final.candidates); return '实际选择下载的KA1，确认恢复后刷新；全部records和intake-review逐字段严格相等。';
      });
      await step('S16', '恢复后展开原文和合并记录，检查窄屏布局及异常', '全文和合并审计可读；无横向溢出，无源码导入或页面异常。', async () => {
        await restored.getByText(c.source, { exact: true }).click(); expect(await restored.locator('.intake-review-original pre').textContent()).toBe(csv);
        await restored.locator('.intake-review-row').nth(1).getByText(c.receipt, { exact: true }).click(); await expect(restored.locator('.candidate-merge-receipt')).toContainText(changedDescription);
        await expect(restored.locator('.candidate-merge-receipt .candidate-merge-field > div > p').first()).toHaveCSS('white-space', 'pre-wrap');
        await restored.locator('.intake-review-original').scrollIntoViewIfNeeded(); await restored.screenshot({ path: resolve(directory, 'restored-source.png'), fullPage: false });
        const size = await restored.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); expect(size.scroll).toBeLessThanOrEqual(size.width); expect(errors).toEqual([]); expect(sourceRequests).toEqual([]);
        return `width=${size.width}, scrollWidth=${size.scroll}；pageerror0，源码请求0；恢复后原文和合并旧/新值保持。`;
      });
    } finally {
      writeFileSync(resolve(directory, 'steps.json'), JSON.stringify({ tag, mode: 'portable-real-UI-no-source-imports', observations, errors, sourceRequests }, null, 2));
      await test.info().attach('owner-operation-results', { body: JSON.stringify(observations), contentType: 'application/json' });
      await destination.close(); await context.close();
    }
  });
}
