const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const output = __dirname;
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4396', viewport: { width: 1280, height: 1000 }, locale: 'en', permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addInitScript(() => localStorage.setItem('keepany-language', 'en'));
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto('/');
    await page.locator('.sidebar nav').getByRole('link', { name: 'Accounts', exact: true }).click();
    const access = page.locator('.unified-vault-access');
    await access.waitFor({ state: 'visible' });
    if (!await access.evaluate(n => n.open)) await access.locator(':scope > summary').click();
    await page.locator('#password-vault-master').fill('SyntheticDateReviewMaster2026!');
    await page.locator('#password-vault-master-confirm').fill('SyntheticDateReviewMaster2026!');
    await page.getByRole('button', { name: 'Create vault', exact: true }).click();
    await page.locator('.password-vault-toolbar').waitFor({ state: 'visible' });
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.waitForTimeout(600);
    await page.locator('.password-vault-header').getByRole('button', { name: 'Add', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#password-vault-entry-title').fill('Synthetic sequential validation review');
    await dialog.locator('#password-vault-entry-url').fill('ftp://example.test/synthetic');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await dialog.getByRole('alert').waitFor({ state: 'visible' });
    await dialog.locator('#password-vault-entry-url').fill('https://example.test/ok');
    await dialog.getByRole('alert').waitFor({ state: 'hidden' });
    for (const item of await dialog.locator('details').all()) {
      if (!await item.evaluate(n => n.open)) await item.locator(':scope > summary').click();
    }
    await dialog.locator('#account-entry-reviewed').fill('2026-02-30');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    async function observe(name) {
      const state = await dialog.evaluate(node => {
        const field = node.querySelector('#account-entry-reviewed');
        const rect = n => { const r = n.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom }; };
        const footer = node.querySelector('.account-entry-actions, .password-vault-editor-actions, footer');
        const r = field.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, Math.max(0, Math.min(innerHeight-1, r.y + r.height / 2)));
        return { field:rect(field), validity:field.validity.valid, validationMessage:field.validationMessage, focused:document.activeElement === field, hit:hit?.outerHTML.slice(0,300), dialog:rect(node), footer:footer ? rect(footer) : null, viewport: { width:innerWidth, height:innerHeight }, scroll:node.scrollTop };
      });
      fs.writeFileSync(path.join(output, name+'.json'), JSON.stringify(state,null,2));
      await page.screenshot({ path:path.join(output,name+'.png'), fullPage:true });
      console.log(name, JSON.stringify(state));
    }
    await observe('date-invalid-immediate');
    await page.waitForTimeout(2000);
    await observe('date-invalid-settled');
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
