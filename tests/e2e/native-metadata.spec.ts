import { expect, test } from '@playwright/test';

for (const zh of [true, false]) {
  test(`${zh ? 'zh-CN' : 'en'} registered native metadata replaces only transport and keeps inert review before save`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(language => localStorage.setItem('keepany-language', language), zh ? 'zh-CN' : 'en');
    let unsafe = 0, middleware = 0;
    await page.route('**/must-not-load**', route => { unsafe++; return route.abort(); });
    await page.route('**/__keepany_intake__/url-metadata', route => { middleware++; return route.abort(); });
    await page.goto('/intake');
    await page.evaluate(async path => {
      const module = await import(path);
      const calls: string[] = [];
      Object.assign(window, { __metadataCalls: calls });
      module.registerNativeMetadataHandler(async (url: string) => {
        calls.push(url);
        return { url: 'https://final.example.test/page', html: '<title>Native &amp; inert</title><meta name="description" content="Reviewed native metadata"><script>window.__metadataExecuted=1</script><img src="/must-not-load-image"><iframe src="/must-not-load-frame"></iframe>' };
      });
    }, '/src/intake-url.ts');
    const quick = page.locator('.intake-quick-card');
    await quick.locator('#import-url').fill('https://source.example.test/start#private');
    await quick.getByRole('button', { name: zh ? '预览资料' : 'Preview records', exact: true }).click();
    const preview = quick.locator('.import-preview');
    await expect(preview.locator('input:not([type=checkbox])')).toHaveValue('Native & inert');
    await expect(preview.locator('textarea')).toHaveValue('Reviewed native metadata');
    expect(await page.evaluate(() => (window as unknown as { __metadataCalls: string[] }).__metadataCalls)).toEqual(['https://source.example.test/start']);
    expect(await page.evaluate(() => '__metadataExecuted' in window)).toBe(false);
    expect(unsafe).toBe(0); expect(middleware).toBe(0);
    await quick.getByRole('button', { name: zh ? '手动' : 'Manual', exact: true }).click();
    await expect(preview).toHaveCount(0);
  });
}
