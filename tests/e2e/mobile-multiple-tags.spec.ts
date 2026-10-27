import { expect, test } from '@playwright/test';
import { resources } from '../../apps/web/src/i18n';
import { selectChoice } from './helpers/select-choice';
import { sourceModuleUrl } from './helpers/source-module-url';

test.use({ viewport: { width: 390, height: 844 } });
for (const language of ['en', 'zh-CN'] as const) test(`two tag filters intersect with category and keyword and survive return in ${language}`, async ({ page }, info) => {
  test.setTimeout(75_000);
  await page.addInitScript(value => localStorage.setItem('keepany-language', value), language);
  await page.goto('/accounts');
  // Declared fixture preparation only; the filtering and return flow uses real UI.
  await page.evaluate(async ({ domain, repository }) => {
    const { newAsset } = await import(/* @vite-ignore */ domain);
    const { localRepository } = await import(/* @vite-ignore */ repository);
    await (await localRepository()).saveBatch(Array.from({ length: 70 }, (_, index) => ({ type: 'asset', value: {
      ...newAsset('account'), name: `Tag account ${String(index).padStart(3, '0')}`, category: index < 65 ? 'email' : 'phone', tags: index < 60 ? ['Work', 'Critical'] : ['Work'],
    } })));
  }, { domain: sourceModuleUrl('packages/domain/src/index.ts'), repository: sourceModuleUrl('packages/local-db/src/index.ts') });
  const cards = page.locator('.asset-list-content .asset-account-card');
  await expect(cards).toHaveCount(70);
  await selectChoice(page.locator('#asset-tag-filter'), 'Work');
  await expect(cards).toHaveCount(70);
  await page.locator('#asset-tag-filter-add').press('ArrowDown');
  await page.getByRole('option', { name: 'Critical', exact: true }).click();
  await expect(cards).toHaveCount(60);
  const labels = resources[language].translation;
  await page.getByRole('button', { name: language === 'en' ? 'Email' : '邮箱', exact: true }).click();
  await expect(cards).toHaveCount(60);
  const search = page.getByRole('searchbox', { name: String(labels.accountListSearch) });
  await search.fill('Tag account');
  await page.screenshot({ path: info.outputPath(`selected-two-tags-${language}-390.png`), fullPage: false });
  const card = cards.nth(50);
  await card.scrollIntoViewIfNeeded();
  const clickedName = await card.locator('strong').innerText();
  const before = await page.evaluate(() => scrollY);
  expect(before).toBeGreaterThan(500);
  await card.click();
  await expect(page.getByRole('heading', { name: clickedName, exact: true })).toBeVisible();
  await page.getByRole('banner').getByRole('link', { name: String(labels.back), exact: true }).click();
  await expect(cards).toHaveCount(60);
  await expect(search).toHaveValue('Tag account');
  await expect(page.locator('#asset-tag-filter')).toHaveAttribute('data-value', 'Work');
  await expect(page.locator('[data-selected-asset-tag="Critical"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before - 150);
  await page.reload();
  await expect(cards).toHaveCount(60);
  await expect(page.locator('[data-selected-asset-tag="Critical"]')).toBeVisible();
  await search.fill('zero matching records');
  await expect(cards).toHaveCount(0);
  await expect(page.getByText(String(labels.noMatches), { exact: true })).toBeVisible();
  await search.fill('Tag account');
  await page.locator('[data-selected-asset-tag="Critical"]').getByRole('button').click();
  await expect(cards).toHaveCount(65);
  await selectChoice(page.locator('#asset-tag-filter'), '');
  await expect(cards).toHaveCount(65);
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath(`multiple-tags-${language}-390.png`), fullPage: false });
});
