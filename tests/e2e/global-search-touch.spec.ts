import { expect, test } from '@playwright/test';
import { sourceModuleUrl } from './helpers/source-module-url';

test.use({ hasTouch: true });
for (const language of ['zh-CN', 'en'] as const) {
  test(`${language} global search touch targets and result return at normal and reduced viewport height`, async ({ page }, info) => {
    await page.addInitScript(locale => localStorage.setItem('keepany-language', locale), language);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/assets/project');
    const fixture = await page.evaluate(async ({ repositoryPath, domainPath }) => {
      const { saveBatch } = await import(repositoryPath), { newAsset } = await import(domainPath);
      const asset = { ...newAsset('project'), name: 'Touch search fixture' };
      await saveBatch([{ type: 'asset', value: asset }]); return asset;
    }, { repositoryPath: sourceModuleUrl('packages/local-db/src/index.ts'), domainPath: sourceModuleUrl('packages/domain/src/index.ts') });
    for (const width of [360, 390, 430]) for (const height of [844, 365]) {
      await page.setViewportSize({ width, height });
      await page.locator('.top-search-trigger').tap();
      const input = page.locator('#top-search-query');
      await expect(input).toBeFocused();
      const close = page.locator('.top-search-panel-input > button');
      const bottomClose = page.locator('.top-search-panel-close');
      for (const control of [input, close, bottomClose]) {
        const box = await control.boundingBox();
        if (!box) throw Error('Missing visible search control');
        expect(box.height).toBeGreaterThanOrEqual(43.9); expect(box.width).toBeGreaterThanOrEqual(43.9);
      }
      await input.fill('Touch search fixture');
      const result = page.locator('.top-search-panel .search-results a').filter({ hasText: fixture.name });
      await expect(result).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`search-${language}-${width}-${height}.png`) });
      await (height === 365 ? bottomClose : close).tap(); await expect(input).toBeHidden();
      await page.locator('.top-search-trigger').tap(); await input.fill('Touch search fixture');
      await result.tap();
      await expect(page).toHaveURL(new RegExp(`/assets/project/${fixture.id}$`));
      await expect(page.getByRole('heading', { name: fixture.name, exact: true })).toBeVisible();
      await expect(input).toBeHidden();
      await page.locator('.topbar-back-link:visible').tap();
      await expect(page).toHaveURL(/\/assets\/project$/);
    }
  });
}
