import { expect, test, type Locator } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resources } from '../../apps/web/src/i18n';
import { sourceModuleUrl } from './helpers/source-module-url';

test.use({ hasTouch: true, timezoneId: 'Asia/Shanghai' });
type Finding = { stage: string; target: string; width: number; height: number; x: number; issue: string };
for (const locale of ['zh-CN', 'en'] as const) for (const width of [360,390,430]) {
  test(`${locale} ${width} shared mobile UI touch, focus, scroll, errors and return`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(language => localStorage.setItem('keepany-language', language), locale);
    const t = (key: keyof typeof resources.en.translation) => resources[locale].translation[key];
    const findings: Finding[] = [], steps: { action: string; expected: string; actual: string }[] = [];
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    async function measure(stage: string, scope: Locator) {
      const selector = await scope.evaluate(element=>element.matches('.mobile-tabbar')) ? 'a' : 'button,a.mobile-tool,input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]),textarea,[role=combobox]';
      const controls = await scope.locator(selector).evaluateAll(elements => elements.filter(element => {
        const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 && element.checkVisibility();
      }).map(element => { const box = element.getBoundingClientRect(); let left=Math.max(0,box.left),right=Math.min(innerWidth,box.right),top=Math.max(0,box.top),bottom=Math.min(innerHeight,box.bottom),sticky=false,clipped=false;
        for(let parent=element.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent),rect=parent.getBoundingClientRect();if(style.position==='sticky'||style.position==='fixed')sticky=true;if(style.overflowX!=='visible'){left=Math.max(left,rect.left+parent.clientLeft);right=Math.min(right,rect.left+parent.clientLeft+parent.clientWidth);clipped=true;}if(style.overflowY!=='visible'){top=Math.max(top,rect.top+parent.clientTop);bottom=Math.min(bottom,rect.top+parent.clientTop+parent.clientHeight);}}
        return { target: element.getAttribute('aria-label') || element.id || element.textContent?.trim().slice(0,80) || element.tagName, width: box.width, height: box.height, x: box.x, y: box.y, left,right,top,bottom,sticky,clipped }; }));
      for (const box of controls) {
        if (box.width < 43.9 || box.height < 43.9) findings.push({ stage, ...box, issue: 'touch-below-44' });
        if (!box.clipped && (box.x < -1 || box.x + box.width > width+1)) findings.push({ stage, ...box, issue: 'horizontal-control-overflow' });
      }
      for (let first=0;first<controls.length;first++) for(let second=first+1;second<controls.length;second++) {
        const a=controls[first], b=controls[second];
        if(!a.sticky&&!b.sticky && Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)
          findings.push({stage,...a,target:`${a.target} / ${b.target}`,issue:'control-overlap'});
      }
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) findings.push({ stage, target: 'document', width, height: 0, x: 0, issue: 'page-horizontal-overflow' });
    }
    async function checkpoint(stage: string, scope = page.locator('main')) {
      await measure(stage,scope); await page.screenshot({ path: info.outputPath(`${stage}.png`) });
      await info.attach(`${stage}-geometry`,{body:JSON.stringify(findings.filter(finding=>finding.stage===stage)),contentType:'application/json'});
    }
    async function act(action: string, expected: string, actionFn: () => Promise<void>) {
      await test.step(action, actionFn); steps.push({ action, expected, actual: 'actual UI assertions passed' });
    }
    async function dialogFocus(dialog: Locator) {
      await page.keyboard.press('Tab'); await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Shift+Tab'); await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    const longName = `${locale} ${width} UI ${'Long visible name 多语言名称 '.repeat(3)}`;
    await act('账号→新增→空名保存→输入长名→取消→重开保存', '错误留在表单；取消不创建；长名保存后可回读', async () => {
      await page.goto('/assets/account');
      await page.getByRole('button',{name:t('add'),exact:true}).tap();
      const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
      await dialog.getByRole('button',{name:t('save'),exact:true}).tap();
      await expect(dialog.locator('.field-error').first()).toBeVisible();
      await checkpoint('account-error-dialog',dialog); await dialogFocus(dialog);
      await dialog.getByLabel(t('name'),{exact:true}).fill(longName);
      await dialog.getByRole('button',{name:t('cancel'),exact:true}).tap(); await expect(dialog).toBeHidden();
      await expect(page.locator('main .list-row')).toHaveCount(0);
      await page.getByRole('button',{name:t('add'),exact:true}).tap();
      await dialog.getByLabel(t('name'),{exact:true}).fill(longName);
      await dialog.getByRole('button',{name:t('save'),exact:true}).tap(); await expect(dialog).toBeHidden();
      await page.reload(); await expect(page.locator('main .list-row').filter({hasText:longName})).toHaveCount(1);
      await checkpoint('account-list');
    });
    await act('账号长名行→详情→返回', '长文不断言省略内容等于丢失；详情可读并返回原列表', async () => {
      await page.locator('main .list-row').filter({hasText:longName}).tap();
      await expect(page.getByRole('heading',{name:longName,exact:true})).toBeVisible();
      await checkpoint('account-detail');
      await page.locator('main').getByRole('button',{name:t('delete'),exact:true}).first().tap();
      const confirm = page.getByRole('dialog'); await expect(confirm).toBeVisible();
      await checkpoint('asset-delete-confirm',confirm); await dialogFocus(confirm);
      await confirm.getByRole('button',{name:t('cancel'),exact:true}).tap(); await expect(confirm).toBeHidden();
      await expect(page.getByRole('heading',{name:longName,exact:true})).toBeVisible();
      await page.locator('.topbar-back-link:visible').tap(); await expect(page).toHaveURL(/\/assets\/account$/);
    });
    await act('资产→项目新增→聚焦输入→缩小可视高度→保存→重开', '对话框滚动与保存可达；Tab焦点保留在框内；保存持久回读', async () => {
      await page.goto('/assets/project'); await page.getByRole('button',{name:t('add'),exact:true}).tap();
      const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible(); await dialogFocus(dialog);
      const name = dialog.getByLabel(t('name'),{exact:true}); await name.fill(`Project ${width} ${locale}`); await name.focus();
      await page.setViewportSize({width,height:520}); await expect(name).toBeFocused();
      await name.scrollIntoViewIfNeeded(); await expect(name).toBeInViewport();
      await checkpoint('project-reduced-height',dialog);
      const save = dialog.getByRole('button',{name:t('save'),exact:true}); await save.scrollIntoViewIfNeeded(); await expect(save).toBeInViewport(); await save.tap();
      await expect(dialog).toBeHidden(); await page.setViewportSize({width,height:844}); await page.reload();
      await expect(page.locator('main .list-row').filter({hasText:`Project ${width} ${locale}`})).toHaveCount(1); await checkpoint('asset-list');
    });
    await act('待办→新建→空名错误→填写→保存→刷新', '错误可见；字段/按钮不裁切；任务原文回读且可编辑取消', async () => {
      await page.goto('/tasks'); await checkpoint('tasks-empty');
      await page.getByRole('button',{name:t('newTask'),exact:true}).tap(); const dialog = page.getByRole('dialog');
      await dialog.getByRole('button',{name:t('save'),exact:true}).tap(); await expect(dialog.locator('.field-error').first()).toBeVisible();
      await dialog.getByLabel(t('name'),{exact:true}).fill(`Task ${width} ${locale}`);
      await checkpoint('task-editor',dialog); await dialogFocus(dialog);
      await dialog.getByRole('button',{name:t('save'),exact:true}).tap(); await expect(dialog).toBeHidden(); await page.reload();
      const row = page.locator('.impact-task-row').filter({hasText:`Task ${width} ${locale}`}); await expect(row).toBeVisible();
      await row.getByRole('button',{name:t('edit'),exact:true}).tap(); await dialog.getByRole('button',{name:t('cancel'),exact:true}).tap(); await expect(row).toBeVisible();
      await checkpoint('tasks-saved');
    });
    await act('收录→文字→两行→预览；错误密码备份入口', '原文可编辑、候选可核对；未确认不创建资产；输入/状态/底部按钮可达', async () => {
      await page.goto('/intake'); const quick = page.locator('.intake-quick-card');
      await quick.getByRole('button',{name:locale==='en'?'Text':'文字',exact:true}).tap();
      const source = page.locator('#intake-text-source'); await source.fill('First intake name\nSecond intake name'); await source.focus();
      await page.keyboard.press('End'); await expect(source).toBeFocused();
      await quick.getByRole('button',{name:t('intakePreviewRecords'),exact:true}).tap();
      await expect(page.locator('.intake-review')).toBeVisible(); await checkpoint('intake-review');
      await page.locator('#backup-password').fill('short');
      await expect(page.getByRole('button',{name:locale==='en'?'Create backup':'创建备份',exact:true})).toBeDisabled();
      await checkpoint('backup-short-password');
    });
    await act('更多→末行→AI对话框→Esc→设置→返回更多', '五栏44px、末行不被底栏遮住；弹窗焦点与取消保持页面；返回入口可用', async () => {
      await page.goto('/more'); const tools=page.locator('.mobile-more-page .mobile-tool'); await expect(tools.first()).toBeVisible();
      await tools.last().scrollIntoViewIfNeeded(); await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
      const last=await tools.last().boundingBox(), nav=await page.locator('.mobile-tabbar').boundingBox(); if(!last||!nav)throw Error('missing-navigation');
      expect(last.y+last.height).toBeLessThanOrEqual(nav.y+1); await checkpoint('more-last');
      await page.getByRole('button',{name:new RegExp(locale==='en'?'Ask AI assistant':'询问 AI 助手')}).tap();
      const dialog=page.getByRole('dialog'); await expect(dialog).toBeVisible(); await checkpoint('ai-scope-dialog',dialog); await dialogFocus(dialog); await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
      await page.locator('main a[href="/settings"]').tap(); await expect(page).toHaveURL(/\/settings$/); await checkpoint('settings');
      await page.getByRole('link',{name:t('mobileBackToMore'),exact:true}).tap(); await expect(page).toHaveURL(/\/more$/);
    });
    await act('更多→集合→侧边栏排序与成员复选', '自定义排序控件可点；复选按整行标签触控，不用16px图标冒充目标', async()=>{
      await page.locator('main a[href="/collections"]').tap(); await expect(page.locator('.collections-page')).toBeVisible();
      await checkpoint('collections');
      const rows=page.locator('.collections-nav .sortable-nav-item'), first=await rows.first().locator('.nav-drag-handle').getAttribute('aria-label');
      if(!first)throw Error('missing-drag-name');
      const persisted = (id:string)=>page.evaluate(async({path,id})=>(await (await (await import(path)).localRepository()).get('preference',id))?.value,{path:sourceModuleUrl('packages/local-db/src/index.ts'),id});
      await rows.first().locator('.nav-order-actions button').last().tap(); await expect(rows.nth(1).locator('.nav-drag-handle')).toHaveAttribute('aria-label',first);
      await expect.poll(()=>persisted('sidebarOrder')).toEqual(['tasks','overview','assets','accounts']);
      await rows.nth(1).locator('.nav-order-actions button').first().tap(); await expect(rows.first().locator('.nav-drag-handle')).toHaveAttribute('aria-label',first);
      await expect.poll(()=>persisted('sidebarOrder')).toEqual(['overview','tasks','assets','accounts']);
      await rows.first().locator('.nav-drag-handle').scrollIntoViewIfNeeded();
      const start=await rows.first().locator('.nav-drag-handle').boundingBox(),end=await rows.nth(1).locator('.nav-drag-handle').boundingBox(); if(!start||!end)throw Error('missing-drag-target');
      const touch=await page.context().newCDPSession(page);
      try {
        await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start.x+start.width/2,y:start.y+start.height/2}]});
        for(let index=1;index<=10;index++) await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+start.width/2,y:start.y+start.height/2+(end.y-start.y)*index/10}]});
        await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      }finally{await touch.detach();}
      await expect(rows.nth(1).locator('.nav-drag-handle')).toHaveAttribute('aria-label',first);
      await expect.poll(()=>persisted('sidebarOrder')).toEqual(['tasks','overview','assets','accounts']);
      await page.reload(); await expect(rows.nth(1).locator('.nav-drag-handle')).toHaveAttribute('aria-label',first);
      await rows.nth(1).locator('.nav-order-actions button').first().tap(); await expect(rows.first().locator('.nav-drag-handle')).toHaveAttribute('aria-label',first);
      await expect.poll(()=>persisted('sidebarOrder')).toEqual(['overview','tasks','assets','accounts']);
      const toggle=page.locator('.collections-nav input.nav-visibility-toggle:not(:disabled)').first(), label=toggle.locator('..'), toggleName=await toggle.getAttribute('aria-label');
      if(!toggleName)throw Error('missing-toggle-name');
      const labelBox=await label.boundingBox();if(!labelBox)throw Error('missing-checkbox-hitarea');if(labelBox.width<44||labelBox.height<44)findings.push({stage:'collections',target:'visibility-checkbox-label',width:labelBox.width,height:labelBox.height,x:labelBox.x,issue:'checkbox-label-below-44'});
      await label.tap(); await expect(toggle).not.toBeChecked();await expect.poll(()=>persisted('sidebarHidden')).toContain('tasks'); await page.reload();
      const storedToggle=page.getByRole('checkbox',{name:toggleName,exact:true});await expect(storedToggle).not.toBeChecked();await storedToggle.locator('..').tap();await expect(storedToggle).toBeChecked();
      await expect.poll(()=>persisted('sidebarHidden')).not.toContain('tasks');
      const labels=await page.locator('.collections-option').evaluateAll(elements=>elements.map(element=>{const box=element.getBoundingClientRect();return {target:'collection-checkbox-label',width:box.width,height:box.height,x:box.x};}));
      for(const box of labels)if(box.width<44||box.height<44)findings.push({stage:'collections',...box,issue:'checkbox-label-below-44'});
      const option=page.locator('.collections-option').first(); if(await option.count()){const checkbox=option.locator('input');await option.tap();await expect(checkbox).toBeChecked();await option.tap();await expect(checkbox).not.toBeChecked();}
    });
    await measure('navigation',page.locator('.mobile-tabbar'));
    await info.attach('uiux-findings',{body:JSON.stringify({locale,width,steps,findings,errors},null,2),contentType:'application/json'});
    writeFileSync(info.outputPath('audit.json'),JSON.stringify({locale,width,steps,findings,errors},null,2));
    expect(errors).toEqual([]);
    expect(findings,`${locale}/${width} geometry findings`).toEqual([]);
  });
}
