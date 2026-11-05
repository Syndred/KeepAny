import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { resources } from '../../apps/web/src/i18n';
import { acceptanceCandidate } from './helpers/acceptance-candidate';

const identity = () => acceptanceCandidate().release.webFiles.find(f => f.path === 'index.html')!.sha256;
async function openSidebar(page: Page) {
  if (page.viewportSize()!.width <= 760 && !await page.locator('.sidebar').evaluate(el => el.classList.contains('open'))) {
    await page.locator('.mobile-menu').click();
    await expect(page.locator('.sidebar')).toHaveClass(/open/);
  }
}
async function aligned(page: Page) {
  const rows = await page.locator('.side-bottom a').evaluateAll(links => links.map(link => {
    const rect = link.getBoundingClientRect(), icon = link.querySelector('svg')!.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(link.lastChild!);
    return { x: rect.x, width: rect.width, height: rect.height, iconX: icon.x, iconWidth: icon.width, textX: range.getBoundingClientRect().x };
  }));
  expect(rows).toHaveLength(3);
  for (const row of rows.slice(1)) expect(row).toEqual(rows[0]);
  return rows;
}
for (const locale of ['zh-CN', 'en'] as const) {
  const t = (key: string) => (resources[locale].translation as Record<string, string>)[key];
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(l => localStorage.setItem('keepany-language', l), locale);
    await page.goto('/');
    await expect(page.locator('.sidebar-trash')).toHaveCount(1);
    expect(createHash('sha256').update(await (await page.request.get('/')).body()).digest('hex')).toBe(identity());
  });
  for (const width of [390, 768, 1280, 1920, 1991]) test(`${locale} ${width} SB01-SB03 bottom navigation`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    await openSidebar(page);
    const trash = page.locator('.sidebar-trash');
    expect(await page.locator('.side-bottom a').evaluateAll(els => els.map(e => e.getAttribute('href')))).toEqual(['/trash', '/backup', '/settings']);
    const geometry = await aligned(page);
    await expect(trash).toBeInViewport();
    await page.locator('.sidebar').screenshot({ path: info.outputPath('default.png') });
    await trash.hover(); await page.locator('.sidebar').screenshot({ path: info.outputPath('hover.png') });
    await page.mouse.move(width - 1, 1); await page.keyboard.press('Tab'); await trash.focus();
    expect(await trash.evaluate(el => el.matches(':focus-visible'))).toBe(true);
    await page.locator('.sidebar').screenshot({ path: info.outputPath('focus.png') });
    await trash.hover(); await page.mouse.down();
    expect(await trash.evaluate(el => el.matches(':active'))).toBe(true);
    await page.locator('.sidebar').screenshot({ path: info.outputPath('pressed.png') });
    await page.mouse.up();
    await expect(page.getByRole('heading', { level: 1, name: t('trash'), exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByRole('heading', { level: 1, name: t('trash'), exact: true })).toBeVisible();
    await openSidebar(page); await expect(trash).toHaveAttribute('aria-current', 'page');
    await page.locator('.sidebar').screenshot({ path: info.outputPath('selected.png') });
    await page.locator('.side-bottom a[href="/backup"]').click(); await expect(page).toHaveURL(/\/backup$/);
    await expect(page.getByRole('heading', { level: 1, name: t('backupAndRestore'), exact: true })).toBeVisible();
    await openSidebar(page); await page.locator('.side-bottom a[href="/settings"]').click();
    await expect(page.getByRole('heading', { level: 1, name: t('settings'), exact: true })).toBeVisible();
    await openSidebar(page); await trash.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: t('trash'), exact: true })).toBeVisible();
    if (width <= 760) {
      await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
      await openSidebar(page); await page.locator('.mobile-close').click(); await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await info.attach('contract-results.json', { body: JSON.stringify({ ids: ['SB01','SB02','SB03'], locale, width, candidate: identity(), result: 'passed', geometry }), contentType: 'application/json' });
  });
  test(`${locale} SB04 long and multiple collections`, async ({ page }, info) => {
    await page.locator('.sidebar a[href="/collections"]').click();
    for (let index = 0; index < 8; index++) {
      await expect(page.locator('#collection-name')).toBeVisible();
      const name = `${index} ${locale === 'en' ? 'Long category name' : '虚构很长的分类名称用于侧栏排版验证'}`;
      await page.locator('#collection-name').fill(name);
      await expect(page.locator('#collection-name')).toHaveValue(name);
      await page.getByRole('button', { name: t('collectionSave'), exact: true }).click();
      await expect(page.locator('.sidebar-collection')).toHaveCount(index + 1);
      if (index === 0) await page.locator('.sidebar').screenshot({ path: info.outputPath('single-collection.png') });
      if (index < 7) await page.locator('.sidebar a[href="/collections"]').click();
    }
    await page.reload(); await expect(page.locator('.sidebar-collection')).toHaveCount(8);
    for (const width of [390, 768, 1280, 1920, 1991]) {
      await page.setViewportSize({ width, height: 620 }); await openSidebar(page);
      await page.locator('.side-bottom a[href="/settings"]').scrollIntoViewIfNeeded();
      await expect(page.locator('.sidebar-trash')).toBeInViewport(); await aligned(page);
      await page.locator('.sidebar').screenshot({ path: info.outputPath(`multiple-${width}.png`) });
    }
    await info.attach('contract-results.json', { body: JSON.stringify({ ids: ['SB04'], locale, candidate: identity(), result: 'passed' }), contentType: 'application/json' });
  });
}
