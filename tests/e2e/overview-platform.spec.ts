import { expect, test } from '@playwright/test';

for (const native of [false, true]) {
  for (const language of ['en', 'zh-CN']) {
    test(`overview storage copy matches ${native ? 'native' : 'web'} runtime in ${language}`, async ({ page }, testInfo) => {
      // Runtime detection fixture only, not Android storage/device validation.
      if (native) await page.addInitScript(() => Object.assign(window, { androidBridge: { postMessage() {} } }));
      await page.addInitScript(value => localStorage.setItem('keepany-language', value), language);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/');
      const hero = page.locator('.overview-hero');
      const hint = language === 'en'
        ? native ? 'Your records stay in this app.' : 'Records stay in this browser.'
        : native ? '资料保存在此应用中。' : '资料保存在当前浏览器。';
      await expect(hero).toContainText(hint);
      if (native) await expect(hero).not.toContainText(/this browser|当前浏览器|SQLite/);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`overview-${native ? 'native' : 'web'}-${language}.png`), fullPage: false });
    });
  }
}
