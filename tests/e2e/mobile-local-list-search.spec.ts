import { expect, test } from '@playwright/test';
import { resources } from '../../apps/web/src/i18n';
import { selectChoice } from './helpers/select-choice';
import { sourceModuleUrl } from './helpers/source-module-url';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
const categories = { project: ['website', 'repository'], item: ['device', 'other'], subscription: ['software', 'service'] } as const;

for (const language of ['zh-CN', 'en'] as const) for (const kind of ['project', 'item', 'subscription'] as const) {
  test(`${language} ${kind} local keyword/category/two tags, 51st return and reload`, async ({ page }, info) => {
    const labels = resources[language].translation;
    const searchLabel = language === 'en' ? 'Search this list' : '搜索当前列表';
    const clearLabel = language === 'en' ? 'Clear list search' : '清空列表搜索';
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(value => localStorage.setItem('keepany-language', value), language);
    await page.goto(`/assets/${kind}`);
    // Only the synthetic setup uses the repository; all filter/return actions use UI.
    const baseline = await page.evaluate(async ({ kind, primary, secondary, domain, repository }) => {
      const { newAsset } = await import(/* @vite-ignore */ domain);
      const { localRepository } = await import(/* @vite-ignore */ repository);
      const repo = await localRepository();
      await repo.saveBatch(Array.from({ length: 70 }, (_, index) => ({ type: 'asset', value: {
        ...newAsset(kind), name: `Local ${index >= 60 && index < 65 ? 'extra' : 'needle'} ${kind} ${String(index).padStart(3, '0')}`,
        category: index >= 55 && index < 60 ? secondary : primary,
        tags: index >= 65 && index < 68 ? ['Work'] : index >= 68 ? ['Critical'] : ['Work', 'Critical'],
        description: 'Synthetic public description', notes: 'private-list-marker',
      } })));
      return await repo.list('asset', true);
    }, { kind, primary: categories[kind][0], secondary: categories[kind][1], domain: sourceModuleUrl('packages/domain/src/index.ts'), repository: sourceModuleUrl('packages/local-db/src/index.ts') });
    const cards = page.locator(`.asset-list-content .${kind === 'project' ? 'asset-project-card' : 'asset-library-card'}`);
    await expect(cards).toHaveCount(70);
    const search = page.getByRole('searchbox', { name: searchLabel, exact: true });
    await expect(search).toBeVisible({ timeout: 3000 });
    await search.fill('  NEEDLE  ');
    await expect(cards).toHaveCount(65);
    await page.locator('.asset-category-scroll').getByRole('button', { name: String(labels[categories[kind][0]]), exact: true }).click();
    await expect(cards).toHaveCount(60);
    await selectChoice(page.locator('#asset-tag-filter'), 'Work');
    await expect(cards).toHaveCount(58);
    // Adding the last available tag removes the add-filter control; its value
    // intentionally resets, so verify the selected chip rather than that trigger.
    await page.locator('#asset-tag-filter-add').press('ArrowDown');
    await page.getByRole('option', { name: 'Critical', exact: true }).click();
    await expect(cards).toHaveCount(55);
    await expect(page.locator('[data-selected-asset-tag="Critical"]')).toBeVisible();
    await page.getByRole('button', { name: String(labels.globalSearch), exact: true }).click();
    await page.locator('#top-search-query').fill('Local needle');
    await expect(page.locator('.top-search-panel .search-results a')).toHaveCount(15);
    await page.locator('.top-search-panel-input').getByRole('button', { name: String(labels.close), exact: true }).click();
    await expect(search).toHaveValue('  NEEDLE  ');
    await expect(cards).toHaveCount(55);
    const selected = cards.nth(50);
    await selected.scrollIntoViewIfNeeded();
    const expectedName = await selected.locator(kind === 'project' ? '.asset-project-heading > strong' : '.asset-library-body > strong').innerText();
    const href = await selected.getAttribute('href');
    const before = await page.evaluate(() => scrollY);
    expect(before).toBeGreaterThan(500);
    await page.screenshot({ path: info.outputPath(`${language}-${kind}-51st.png`) });
    await selected.click();
    await expect(page).toHaveURL(new RegExp(`${href?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    await expect(page.getByRole('heading', { name: expectedName, exact: true })).toBeVisible();
    await page.getByRole('banner').getByRole('link', { name: String(labels.back), exact: true }).click();
    await expect(cards).toHaveCount(55);
    await expect(search).toHaveValue('  NEEDLE  ');
    await expect(page.locator('#asset-tag-filter')).toHaveAttribute('data-value', 'Work');
    await expect(page.locator('[data-selected-asset-tag="Critical"]')).toBeVisible();
    await expect.poll(() => page.evaluate(expected => Math.abs(scrollY - expected), before)).toBeLessThan(150);
    await page.reload();
    await expect(cards).toHaveCount(55);
    await expect(search).toHaveValue('  NEEDLE  ');
    await expect(page.locator('[data-selected-asset-tag="Critical"]')).toBeVisible();
    await expect.poll(() => page.evaluate(expected => Math.abs(scrollY - expected), before)).toBeLessThan(150);
    await search.fill('private-list-marker');
    await expect(cards).toHaveCount(0);
    await expect(page.getByText(String(labels.noMatches), { exact: true })).toBeVisible();
    await page.getByRole('button', { name: clearLabel, exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(cards).toHaveCount(60);
    await search.fill('needle');
    await expect(cards).toHaveCount(55);
    const otherKind = kind === 'project' ? 'item' : 'project';
    await page.goto(`/assets/${otherKind}`);
    await search.fill('independent other list');
    await page.goto(`/assets/${kind}`);
    await expect(search).toHaveValue('needle');
    await expect(cards).toHaveCount(55);
    await page.locator('[data-selected-asset-tag="Critical"]').getByRole('button').click();
    await expect(cards).toHaveCount(58);
    await selectChoice(page.locator('#asset-tag-filter'), '');
    await expect(cards).toHaveCount(60);
    await page.locator('.asset-category-scroll').getByRole('button', { name: String(labels.all), exact: true }).click();
    await expect(cards).toHaveCount(65);
    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(cards).toHaveCount(70);
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await search.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await expect(search).toHaveCSS('font-size', '16px');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await search.fill('needle');
    const clearBounds = await page.getByRole('button', { name: clearLabel, exact: true }).boundingBox();
    expect(clearBounds?.height).toBeGreaterThanOrEqual(44);
    expect(clearBounds?.width).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath(`${language}-${kind}-search.png`) });
    expect(await page.evaluate(async repository => (await (await import(/* @vite-ignore */ repository)).localRepository()).list('asset', true), sourceModuleUrl('packages/local-db/src/index.ts'))).toEqual(baseline);
    expect(errors).toEqual([]);
  });
}
