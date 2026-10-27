import { expect, test, type Page } from '@playwright/test';

async function installDeferredSettings(page: Page) {
  await page.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
  await page.goto('/settings#assistant');
  await expect(page.getByRole('heading', { name: 'Connect an AI model', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const modulePath = '/src/platform-settings.ts';
    const settings = await import(modulePath);
    const values = new Map([['keepany-language', 'en']]);
    const pending: Array<{ apply(): void; reject(error: Error): void }> = [];
    settings.registerPlatformSettings({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => new Promise<void>((resolve, reject) => {
        pending.push({ apply: () => { values.set(key, value); resolve(); }, reject });
      }),
      removeItem: (key: string) => new Promise<void>((resolve, reject) => {
        pending.push({ apply: () => { values.delete(key); resolve(); }, reject });
      }),
    });
    Object.assign(window, { keepanySettingsFixture: {
      complete(ok: boolean) { const operation = pending.shift(); if (!operation) throw Error('No pending settings operation');
        if (ok) operation.apply(); else operation.reject(Error('synthetic-preferences-error')); },
    } });
  });
}
async function complete(page: Page, ok: boolean) {
  await page.evaluate(value => (window as typeof window & { keepanySettingsFixture: { complete(value: boolean): void } }).keepanySettingsFixture.complete(value), ok);
}

test('language stays confirmed while native-style persistence is pending, then fails visibly or changes after retry', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installDeferredSettings(page);
  const language = page.getByRole('combobox', { name: 'Language', exact: true });
  await language.click(); await page.getByRole('option', { name: /Chinese|简体中文/ }).click();
  await expect(language).toBeDisabled();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await complete(page, false);
  await expect(page.getByRole('status').filter({ hasText: 'Some settings could not be saved' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.screenshot({ path: testInfo.outputPath('settings-failed-en.png'), fullPage: false });
  await language.click(); await page.getByRole('option', { name: /Chinese|简体中文/ }).click();
  await complete(page, true);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('combobox', { name: '语言', exact: true })).toContainText('简体中文');
  await expect(page.getByRole('status').filter({ hasText: 'Some settings could not be saved' })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('settings-saved-zh.png'), fullPage: false });
});

test('AI configuration shows no early success, retains its draft after a failed native-style save and awaits removal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installDeferredSettings(page);
  const panel = page.locator('.ai-settings-panel');
  await panel.getByRole('combobox', { name: 'API key source', exact: true }).click();
  await page.getByRole('option', { name: 'Use for this session only', exact: true }).click();
  await panel.getByLabel('API key', { exact: true }).fill('synthetic-session-key');
  const connection = panel.locator('.notice[role="status"]').first();
  const initial = await connection.innerText();
  await panel.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(panel.getByLabel('Provider', { exact: true })).toBeDisabled();
  await expect(connection).toHaveText(initial);
  await complete(page, false);
  await expect(panel.getByRole('alert')).toBeVisible();
  await expect(panel.getByLabel('API key', { exact: true })).toHaveValue('synthetic-session-key');
  await expect(connection).toHaveText(initial);
  await panel.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await complete(page, true);
  await expect(connection).not.toHaveText(initial);
  await panel.getByRole('button', { name: 'Remove model configuration', exact: true }).click();
  await expect(panel.getByLabel('Provider', { exact: true })).toBeDisabled();
  await expect(connection).not.toHaveText(initial);
  await complete(page, true);
  await expect(connection).toHaveText(initial);
});

test('native storage copy describes app data and omits browser persistence controls in both languages', async ({ page }, testInfo) => {
  // Native runtime detection fixture only; this is not an Android/SQLite test.
  await page.addInitScript(() => Object.assign(window, { androidBridge: { postMessage() {} } }));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [language, hint] of [['en', 'Your records are stored in this app.'], ['zh-CN', '资料保存在此应用中。']] as const) {
    await page.addInitScript(value => localStorage.setItem('keepany-language', value), language);
    await page.goto('/settings');
    await expect(page.getByText(hint, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /Request persistent storage|申请持久存储/ })).toHaveCount(0);
    await expect(page.getByText(/Clearing browser data|清除浏览器资料/)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`native-storage-${language}.png`), fullPage: false });
  }
});
