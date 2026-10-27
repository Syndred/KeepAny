import { expect, test } from '@playwright/test';

for (const locale of ['zh-CN', 'en'] as const) {
  test(`${locale} closed drawer cannot receive keyboard focus and open drawer returns focus`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
    await page.goto('/more');
    await expect(page.locator('main h1')).toHaveText(locale === 'en' ? 'More' : '更多');
    const trigger = page.locator('.mobile-menu');
    const sidebar = page.locator('.sidebar');
    const close = sidebar.getByRole('button', { name: locale === 'en' ? 'Close' : '关闭', exact: true });
    await page.keyboard.press('Tab');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(close).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Shift+Tab');
    await expect(sidebar.locator('.sidebar-user')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sidebar).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await sidebar.locator('nav').getByRole('link', { name: locale === 'en' ? 'Tasks' : '待办', exact: true }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(sidebar).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 844 });
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('.workspace-current')).toBeVisible();
    await sidebar.locator('.workspace-current').focus();
    await page.keyboard.press('Tab');
    expect(await page.locator(':focus').evaluate(element => element.closest('.sidebar') !== null)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(sidebar).toBeHidden();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.screenshot({ path: test.info().outputPath(`navigation-focus-${locale}-390.png`) });
  });
}
