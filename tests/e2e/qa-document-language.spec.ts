import { expect, test } from '@playwright/test';
import { selectChoice } from './helpers/select-choice';

for (const [locale, width] of [['zh-CN', 390], ['en-US', 1280]] as const) {
  test(`${locale} document language follows UI selection, reload and navigation`, async ({ browser }) => {
    const context = await browser.newContext({ locale, viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto('/settings');
      const initial = locale === 'zh-CN' ? 'zh-CN' : 'en';
      const opposite = initial === 'en' ? 'zh-CN' : 'en';
      await expect(page.locator('html')).toHaveAttribute('lang', initial);
      await selectChoice(page.getByRole('combobox', { name: initial === 'en' ? 'Language' : '语言', exact: true }), { value: opposite });
      await expect(page.locator('html')).toHaveAttribute('lang', opposite);
      await expect(page.getByRole('heading', { name: opposite === 'en' ? 'Settings' : '设置', exact: true })).toBeVisible();
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', opposite);
      await selectChoice(page.getByRole('combobox', { name: opposite === 'en' ? 'Language' : '语言', exact: true }), { value: initial });
      await expect(page.locator('html')).toHaveAttribute('lang', initial);
      await page.goto('/assets/vault#vault-references');
      await expect(page.locator('html')).toHaveAttribute('lang', initial);
      await expect(page.locator('.workspace-navigation a[aria-current="page"]')).toHaveCount(1);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
