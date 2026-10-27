import { expect, test, type Page } from '@playwright/test';
import { newAsset, type Relation } from '../../packages/domain/src';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
test.use({ actionTimeout: 15_000 });
const evidence = process.env.KEEPANY_GRAPH_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });

const repositoryPath = `/@fs/${process.cwd().replaceAll('\\', '/')}/packages/local-db/src/index.ts`;
const assets = [
  { ...newAsset('account'), id: 'graph-account', name: 'Graph account' },
  { ...newAsset('project'), id: 'graph-project', name: 'Graph project' },
  { ...newAsset('item'), id: 'graph-item', name: 'Graph item' },
  { ...newAsset('subscription'), id: 'graph-leaf', name: 'Graph subscription' },
];
const relation = (id: string, from: string, to: string, label: string, source: string, verifiedAt = ''): Relation => ({ id, from, to, label, source, verifiedAt, createdAt: '2026-10-27T00:00:00Z', deleted: false });
const relations = [
  relation('graph-primary', 'graph-project', 'graph-account', 'Primary', 'Original source', '2026-10-20'),
  relation('graph-recovery', 'graph-project', 'graph-account', 'Recovery', 'Unverified source'),
  relation('graph-reverse', 'graph-account', 'graph-project', 'Reverse', 'Reverse source', '2026-10-21'),
  relation('graph-item-link', 'graph-account', 'graph-item', 'Dependency', 'Item source'),
  relation('graph-indirect', 'graph-item', 'graph-leaf', 'Indirect', 'Subscription source'),
];
async function storedRelation(page: Page, id: string) {
  return page.evaluate(async ({ path, id }) => (await (await import(path)).localRepository()).get('relation', id), { path: repositoryPath, id });
}
async function ready(page: Page) {
  await expect(page.locator('.account-family-graph')).toHaveAttribute('data-layout-ready', 'true');
}
async function selectPair(page: Page) {
  const edge = page.locator('.react-flow__edge[data-from="graph-project"][data-to="graph-account"]');
  await edge.focus(); await edge.press('Enter');
  await expect(page.locator('.account-graph-connection-details')).toBeVisible();
  return page.locator('.account-graph-connection-details');
}

for (const language of ['en', 'zh-CN'] as const) {
  for (const width of [390, 1280]) {
    test(`${language} complete account and project graph interactions at ${width}px`, async ({ page }, info) => {
      test.setTimeout(120_000);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const zh = language === 'zh-CN';
      const text = { save: zh ? '保存' : 'Save', edit: zh ? '编辑关系' : 'Edit connection', remove: zh ? '删除关系' : 'Delete connection', close: zh ? '关闭' : 'Close', restore: zh ? '恢复' : 'Restore', family: zh ? '完整关系' : 'All connections', expand: zh ? '全屏查看' : 'Expand graph', collapse: zh ? '退出全屏' : 'Exit expanded view' };
      await page.addInitScript(value => localStorage.setItem('keepany-language', value), language);
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await page.evaluate(async ({ path, assets, relations }) => {
        const repository = await (await import(path)).localRepository();
        for (const asset of assets) await repository.save('asset', asset);
        for (const relation of relations) await repository.save('relation', relation);
      }, { path: repositoryPath, assets, relations });
      for (const kind of ['account', 'project'] as const) {
        const rootId = `graph-${kind}`;
        const originalAsset = await page.evaluate(async ({ path, id }) => (await (await import(path)).localRepository()).get('asset', id), { path: repositoryPath, id: rootId });
        await page.goto(`/assets/${kind}/${rootId}#account-relations`);
        await ready(page);
        await page.locator('.graph').evaluate(element => element.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: evidence ? join(evidence, `${kind}-current-${language}-${width}.png`) : info.outputPath(`${kind}-current-${language}-${width}.png`), fullPage: false });
        await expect(page.locator('#relation-filter')).toBeVisible();
        const panel = await selectPair(page);
        await expect(panel.locator('[data-relation-id="graph-primary"]')).toContainText('Original source');
        await expect(panel.locator('[data-relation-id="graph-primary"]')).toContainText('2026');
        await expect(panel.locator('[data-relation-id="graph-recovery"]')).toContainText('Unverified source');
        await expect(panel.locator('[data-relation-id="graph-recovery"]')).toContainText(zh ? '未记录' : 'Not recorded');
        await expect(panel.getByRole('button', { name: new RegExp(`^${text.edit} ·`) })).toHaveCount(2);
        await expect(panel.getByRole('button', { name: new RegExp(`^${text.remove} ·`) })).toHaveCount(2);
        await expect(page.locator('.react-flow__edge[data-from="graph-account"][data-to="graph-project"] .react-flow__edge-path')).toHaveAttribute('marker-end', /url/);
        await expect(page.locator('.react-flow__edge[data-from="graph-project"][data-to="graph-account"] .react-flow__edge-path')).toHaveCSS('stroke-dasharray', '5px, 4px');
        await panel.scrollIntoViewIfNeeded();
        await page.screenshot({ path: evidence ? join(evidence, `${kind}-selected-${language}-${width}.png`) : info.outputPath(`${kind}-selected-${language}-${width}.png`), fullPage: false });
        await panel.getByRole('button', { name: text.close, exact: true }).click();
        await page.getByRole('button', { name: text.family, exact: true }).click();
        await ready(page); await expect(page.locator('.react-flow__node')).toHaveCount(4);
        await page.locator('#relation-filter').fill('Subscription source');
        await expect(page.locator('.account-relation-details .relation-row')).toHaveCount(1);
        await page.locator('#relation-filter').fill('');
        // Drag an actual React Flow node, keep positions in presentation state only.
        const root = page.locator(`.react-flow__node[data-id="${rootId}"]`);
        const initial = await root.evaluate(element => (element as HTMLElement).style.transform);
        await root.evaluate(element => element.scrollIntoView({ block: 'center' }));
        const box = await root.boundingBox(); if (!box) throw Error('root-node-missing');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 20, { steps: 8 }); await page.mouse.up();
        await expect.poll(() => root.evaluate(element => (element as HTMLElement).style.transform)).not.toBe(initial);
        const movedTransform = await root.evaluate(element => (element as HTMLElement).style.transform);
        const pane = page.locator('.react-flow__pane');
        await pane.evaluate(element => element.scrollIntoView({ block: 'center' }));
        const paneBox = await pane.boundingBox(); if (!paneBox) throw Error('graph-pane-missing');
        const beforePan = await page.locator('.react-flow__viewport').getAttribute('style');
        await page.mouse.move(paneBox.x + 6, Math.max(120, paneBox.y + 80));
        await page.mouse.down(); await page.mouse.move(paneBox.x + 26, Math.max(120, paneBox.y + 80) + 15, { steps: 6 }); await page.mouse.up();
        await expect(page.locator('.react-flow__viewport')).not.toHaveAttribute('style', beforePan ?? '');
        const viewToggle = page.locator('.account-graph-view-toggle');
        await viewToggle.click();
        await expect(viewToggle).toHaveAttribute('aria-label', zh ? '适应画布' : 'Fit all');
        await viewToggle.click();
        await expect(viewToggle).toHaveAttribute('aria-label', zh ? '回到当前' : 'Back to current');
        await page.locator('.account-graph-view-actions').getByRole('button', { name: zh ? '缩小' : 'Zoom out', exact: true }).click();
        const before = await page.locator('.react-flow__viewport').getAttribute('style');
        await page.locator('.account-graph-view-actions').getByRole('button', { name: text.expand, exact: true }).click();
        await ready(page); await expect(page.getByRole('dialog')).toBeVisible();
        const expandedRoot = await root.boundingBox();
        const expandedCanvas = await page.locator('.react-flow').boundingBox();
        if (!expandedRoot || !expandedCanvas) throw Error('expanded-geometry-missing');
        expect(expandedRoot.x + expandedRoot.width).toBeGreaterThan(expandedCanvas.x);
        expect(expandedRoot.x).toBeLessThan(expandedCanvas.x + expandedCanvas.width);
        expect(expandedRoot.y + expandedRoot.height).toBeGreaterThan(expandedCanvas.y);
        expect(expandedRoot.y).toBeLessThan(expandedCanvas.y + expandedCanvas.height);
        const expandedPanel = await selectPair(page);
        await expandedPanel.getByRole('button', { name: `${text.edit} · Primary`, exact: true }).click();
        const expandedEditor = page.getByRole('dialog', { name: text.edit, exact: true });
        await expandedEditor.locator('#relation-source').fill(`Original source · ${kind}`);
        await expandedEditor.getByRole('button', { name: text.save, exact: true }).click();
        await expect(expandedEditor).toBeHidden();
        await expect(page.getByRole('dialog')).toHaveCount(1);
        await ready(page);
        expect((await storedRelation(page, 'graph-primary')).source).toBe(`Original source · ${kind}`);
        await page.locator('.account-graph-connection-details').getByRole('button', { name: text.close, exact: true }).click();
        // Expanded navigation keeps its return action inside the active modal.
        await page.locator('.asset-graph-link').filter({ hasText: kind === 'account' ? 'Graph project' : 'Graph account' }).press('Enter');
        await ready(page); await expect(page.getByRole('dialog')).toBeVisible();
        await page.getByRole('button', { name: zh ? `返回 Graph ${kind} 的关联图` : `Back to Graph ${kind} connections`, exact: true }).click();
        await ready(page); await expect(page.getByRole('dialog')).toBeVisible();
        await page.locator('.account-graph-view-actions').getByRole('button', { name: text.collapse, exact: true }).click();
        await ready(page); await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect.poll(() => root.evaluate(element => (element as HTMLElement).style.transform)).toBe(movedTransform);
        await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', before ?? '');
        expect(await page.evaluate(async ({ path, id }) => (await (await import(path)).localRepository()).get('asset', id), { path: repositoryPath, id: rootId })).toEqual(originalAsset);
        await page.locator('#relation-filter').fill('Original source');
        await page.locator('.asset-graph-link').filter({ hasText: kind === 'account' ? 'Graph project' : 'Graph account' }).click();
        await ready(page);
        await page.getByRole('button', { name: zh ? `返回 Graph ${kind} 的关联图` : `Back to Graph ${kind} connections`, exact: true }).click();
        await ready(page); await expect(page.locator('#relation-filter')).toHaveValue('Original source');
        await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style', before ?? '');
        await page.locator('#relation-filter').fill('');
        await page.locator('.graph').scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: evidence ? join(evidence, `${kind}-${language}-${width}.png`) : info.outputPath(`${kind}-${language}-${width}.png`), fullPage: false });
      }
      // Edit uses real optimistic concurrency: external write happens after opening the draft.
      const panel = await selectPair(page);
      await panel.getByRole('button', { name: `${text.edit} · Recovery`, exact: true }).click();
      const editor = page.getByRole('dialog', { name: text.edit, exact: true });
      await editor.locator('#relation-label').fill('Recovery edited');
      await editor.locator('#relation-source').fill('Edited source');
      await editor.locator('#relation-verified').fill('2026-10-25');
      await page.evaluate(async path => {
        const repository = await (await import(path)).localRepository();
        const current = await repository.get('relation', 'graph-recovery');
        await repository.saveRelationIfCurrent(current, { ...current, source: 'Concurrent source' });
      }, repositoryPath);
      await editor.getByRole('button', { name: text.save, exact: true }).click();
      await expect(editor.getByRole('alert')).toContainText(zh ? '草稿已保留' : 'Your draft is kept');
      await expect(editor.locator('#relation-source')).toHaveValue('Edited source');
      expect((await storedRelation(page, 'graph-recovery')).source).toBe('Concurrent source');
      await editor.getByRole('button', { name: zh ? '已核对最新内容，保留我的草稿' : 'Use latest version, keep my draft', exact: true }).click();
      await editor.getByRole('button', { name: text.save, exact: true }).click();
      await expect(editor).toBeHidden();
      expect(await storedRelation(page, 'graph-recovery')).toMatchObject({ id: 'graph-recovery', source: 'Edited source', verifiedAt: '2026-10-25', label: 'Recovery edited', deleted: false });
      await selectPair(page);
      await page.locator('.account-graph-connection-details').getByRole('button', { name: `${text.remove} · Recovery edited`, exact: true }).click();
      const removal = page.getByRole('dialog', { name: text.remove, exact: true });
      await removal.getByRole('button', { name: text.remove, exact: true }).click();
      await expect(removal).toBeHidden();
      expect((await storedRelation(page, 'graph-recovery')).deleted).toBe(true);
      expect((await storedRelation(page, 'graph-primary')).deleted).toBe(false);
      expect((await storedRelation(page, 'graph-reverse')).deleted).toBe(false);
      await page.locator('.graph-deleted-relations > summary').click();
      await page.getByRole('button', { name: `${text.restore} · Recovery edited`, exact: true }).click();
      await expect(page.locator('[data-deleted-relation-id="graph-recovery"]')).toHaveCount(0);
      expect(await storedRelation(page, 'graph-recovery')).toMatchObject({ id: 'graph-recovery', source: 'Edited source', verifiedAt: '2026-10-25', deleted: false });
      await ready(page);
      expect(errors).toEqual([]);
    });
  }
}

test('indirect connection deletion rejects stale contents and keeps restoration reachable after disconnecting a branch', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(async ({ path, assets, relations }) => {
    const repository = await (await import(path)).localRepository();
    for (const asset of assets) await repository.save('asset', asset);
    for (const relation of relations) await repository.save('relation', relation);
  }, { path: repositoryPath, assets, relations });
  await page.goto('/assets/project/graph-project#account-relations');
  await page.getByRole('button', { name: 'All connections', exact: true }).click();
  await ready(page);
  async function deleteIndirect() {
    const edge = page.locator('.react-flow__edge[data-from="graph-item"][data-to="graph-leaf"]');
    await edge.focus(); await edge.press('Enter');
    await page.locator('.account-graph-connection-details').getByRole('button', { name: 'Delete connection · Indirect', exact: true }).click();
  }
  await deleteIndirect();
  await page.evaluate(async path => {
    const repository = await (await import(path)).localRepository();
    const current = await repository.get('relation', 'graph-indirect');
    await repository.saveRelationIfCurrent(current, { ...current, source: 'Changed before removal' });
  }, repositoryPath);
  const dialog = page.getByRole('dialog', { name: 'Delete connection', exact: true });
  await dialog.getByRole('button', { name: 'Delete connection', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect((await storedRelation(page, 'graph-indirect')).deleted).toBe(false);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await deleteIndirect();
  await dialog.getByRole('button', { name: 'Delete connection', exact: true }).click();
  await expect(dialog).toBeHidden(); await ready(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  // Recovery must not depend on the in-memory list of recently removed IDs.
  await page.reload(); await ready(page);
  await page.getByRole('button', { name: 'All connections', exact: true }).click();
  await ready(page); await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await page.locator('.graph-deleted-relations > summary').click();
  const restore = page.getByRole('button', { name: 'Restore · Indirect', exact: true });
  await expect(restore).toBeVisible();
  await page.evaluate(async path => {
    const repository = await (await import(path)).localRepository();
    const endpoint = await repository.get('asset', 'graph-leaf');
    await repository.save('asset', { ...endpoint, deleted: true });
  }, repositoryPath);
  await expect(restore).toBeDisabled();
  await page.evaluate(async path => {
    const repository = await (await import(path)).localRepository();
    await repository.restoreEntity('asset', 'graph-leaf');
    const original = repository.restoreRelationIfCurrent.bind(repository);
    let fail = true;
    repository.restoreRelationIfCurrent = async (...args: unknown[]) => {
      if (fail) { fail = false; throw Error('synthetic-restore-write-failure'); }
      return original(...args);
    };
  }, repositoryPath);
  await expect(restore).toBeEnabled(); await restore.click();
  await expect(page.locator('.graph-deleted-relations').getByRole('alert')).toBeVisible();
  expect((await storedRelation(page, 'graph-indirect')).deleted).toBe(true);
  await restore.click();
  await expect(page.locator('[data-deleted-relation-id="graph-indirect"]')).toHaveCount(0);
  await ready(page); await expect(page.locator('.react-flow__node')).toHaveCount(4);
  expect(await storedRelation(page, 'graph-indirect')).toMatchObject({ id: 'graph-indirect', source: 'Changed before removal', deleted: false });
});
