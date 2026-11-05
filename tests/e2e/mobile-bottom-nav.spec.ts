import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { acceptanceCandidate } from './helpers/acceptance-candidate';

for (const language of ['zh-CN', 'en']) {
  const zh = language === 'zh-CN';
  const labels = zh ? ['概览', '资产', '账号', '更多'] : ['Overview', 'Assets', 'Accounts', 'More'];
  for (const width of [390, 768, 1280, 1920]) test(`${language} ${width} MN01 MN02 MN03 MN06`, async ({page}, info) => {
    await page.setViewportSize({width, height:844});
    await page.addInitScript(l => localStorage.setItem('keepany-language', l), language);
    await page.goto('/');
    await expect(page.getByRole('heading', {level:1}).first()).toBeVisible();
    const candidate = acceptanceCandidate().release.webFiles.find(file => file.path === 'index.html')!.sha256;
    expect(createHash('sha256').update(await (await page.request.get('/')).body()).digest('hex')).toBe(candidate);
    const nav = page.locator('.mobile-nav');
    if (width > 760) {
      await expect(nav).toBeHidden(); await expect(page.locator('.sidebar')).toBeVisible();
      await page.locator('.sidebar a[href="/assets"]').click();
      await expect(page).toHaveURL(/\/assets$/);
      await expect(page.getByRole('heading',{name: labels[1],exact:true})).toBeVisible();
      await page.screenshot({path:info.outputPath('desktop.png')});
    } else {
      await expect(page.locator('.sidebar')).toBeHidden();
      await expect(page.locator('.mobile-menu')).toHaveCount(0);
      await expect(nav.locator('a,button')).toHaveText(labels);
      await expect(nav.getByRole('link',{name:labels[0],exact:true})).toHaveAttribute('aria-current','page');
      await page.screenshot({path:info.outputPath('default.png')});
      for (const [label,path] of [[labels[1],'/assets'],[labels[2],'/accounts']]) {
        await nav.getByRole('link',{name:label,exact:true}).click(); await expect(page).toHaveURL(new RegExp(path+'$'));
        await expect(nav.getByRole('link',{name:label,exact:true})).toHaveAttribute('aria-current','page');
      }
      const more = nav.getByRole('button',{name:labels[3],exact:true});
      await more.hover(); await page.screenshot({path:info.outputPath('hover.png')});
      await page.keyboard.press('Tab'); await more.focus(); await expect(more).toBeFocused();
      await page.screenshot({path:info.outputPath('focus.png')});
      await more.hover(); await page.mouse.down(); await page.screenshot({path:info.outputPath('pressed.png')}); await page.mouse.up();
      const dialog = page.getByRole('dialog',{name:labels[3],exact:true});
      await expect(dialog).toBeVisible(); await page.screenshot({path:info.outputPath('more-open.png')});
      await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(more).toBeFocused();
      await more.click();
      // Synthetic native event validates shell consumption, not Android hardware behavior.
      expect(await page.evaluate(() => !window.dispatchEvent(new Event('keepany-native-back',{cancelable:true})))).toBe(true);
      await expect(dialog).toBeHidden();
      for (const [path,heading] of [['/settings',zh?'设置':'Settings'],['/backup',zh?'备份与恢复':'Backup & restore'],['/trash',zh?'回收站':'Trash']]) {
        await more.click(); await dialog.locator(`a[href="${path}"]`).click();
        await expect(dialog).toBeHidden(); await expect(page).toHaveURL(new RegExp(path+'$'));
        await expect(page.getByRole('heading',{name:heading,exact:true}).first()).toBeVisible();
        await page.reload(); await expect(page.getByRole('heading',{name:heading,exact:true}).first()).toBeVisible();
        await expect(more).toHaveAttribute('aria-current','page');
      }
      await more.click(); await page.setViewportSize({width:768,height:844}); await expect(dialog).toBeHidden();
      await expect(nav).toBeHidden(); await expect(page.locator('.sidebar')).toBeVisible();
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await info.attach('contract-results.json',{body:JSON.stringify({ids:['MN01','MN02','MN03','MN06'],language,width,candidate,result:'passed'}),contentType:'application/json'});
  });
}

for (const language of ['zh-CN', 'en']) test(`${language} MN04 MN05 original record flow and long collections`, async ({page}, info) => {
  const zh=language==='zh-CN';
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(l=>localStorage.setItem('keepany-language',l),language);
  await page.goto('/assets');
  const add=page.getByRole('button',{name:zh?'新增资产':'Add asset',exact:true});
  await add.click(); await page.getByRole('dialog').getByRole('button',{name:zh?'继续':'Continue',exact:true}).click();
  let dialog=page.getByRole('dialog');
  await dialog.locator('#catalog-record-name').fill('cancelled-record');
  await dialog.getByRole('button',{name:zh?'取消':'Cancel',exact:true}).click();
  await expect(page.getByText('cancelled-record',{exact:true})).toHaveCount(0);
  await add.click(); await page.getByRole('dialog').getByRole('button',{name:zh?'继续':'Continue',exact:true}).click();
  dialog=page.getByRole('dialog'); await dialog.getByRole('button',{name:zh?'保存':'Save',exact:true}).click();
  await expect(dialog).toBeVisible(); await expect(dialog.locator('#catalog-record-name')).toBeFocused();
  await page.screenshot({path:info.outputPath('required-error.png')});
  const recordName=zh?'虚构导航测试资料：长标题保留原有内容与布局':'Fictional navigation record with a longer title';
  await dialog.locator('#catalog-record-name').fill(recordName);
  await dialog.locator('#catalog-record-url').fill('https://notes.example.com/long-path');
  await dialog.locator('#catalog-record-notes').fill('Fictional notes. '.repeat(12));
  await dialog.getByRole('button',{name:zh?'保存':'Save',exact:true}).click(); await expect(dialog).toBeHidden();
  await page.getByText(recordName,{exact:true}).click();
  await expect(page).toHaveURL(/\/(records|assets)\//);
  await expect(page.locator('.mobile-nav a[href="/assets"]')).toHaveAttribute('aria-current','page');
  await page.reload(); await expect(page.getByText(recordName,{exact:true}).first()).toBeVisible();
  await page.screenshot({path:info.outputPath('record-reloaded.png')});
  const more=page.locator('#mobile-more-trigger');
  for (let i=0;i<3;i++) {
    await more.click(); await page.getByRole('dialog').locator('a[href="/collections"]').click();
    await page.locator('#collection-name').fill(`${i} ${zh?'虚构很长的分类名称用于手机导航换行与滚动检查':'A long fictional collection name for navigation wrapping'}`);
    await page.getByRole('button',{name:zh?'保存分类':'Save collection',exact:true}).click();
    await expect(page.locator('#collection-name')).toHaveAttribute('aria-invalid','true');
    await page.locator('#collection-name').fill(`${i} ${zh?'虚构很长的分类名称用于手机导航检查':'Long collection name'}`.slice(0,20));
    await page.getByRole('button',{name:zh?'保存分类':'Save collection',exact:true}).click();
    await expect(page.locator('.sidebar-collection')).toHaveCount(i+1);
  }
  await more.click(); dialog=page.getByRole('dialog');
  await expect(dialog.locator('.sidebar-collection')).toHaveCount(3);
  await dialog.locator('a[href="/settings"]').scrollIntoViewIfNeeded();
  await expect(dialog.locator('a[href="/settings"]')).toBeInViewport();
  await page.screenshot({path:info.outputPath('long-collections.png')});
  await page.keyboard.press('Escape');
  await more.click(); await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.top-search-panel input')).toBeFocused();
  await page.evaluate(()=>window.dispatchEvent(new Event('keepany-native-back',{cancelable:true})));
  await expect(page.locator('.top-search-panel')).toBeHidden(); await expect(page.locator('.top-search-trigger')).toBeFocused();
});
