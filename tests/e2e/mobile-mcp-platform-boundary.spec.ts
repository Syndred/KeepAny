import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { sourceModuleUrl } from './helpers/source-module-url';
import { resources } from '../../apps/web/src/i18n';

test.use({viewport:{width:390,height:844},hasTouch:true});
for(const language of ['zh-CN','en'] as const) for(const platform of ['android','ios'] as const) test(`${language} synthetic ${platform} capability refuses unavailable MCP without a fake grant`,async({page},info)=>{
  await page.addInitScript(language=>localStorage.setItem('keepany-language',language),language);await page.goto('/assets/project');
  await page.getByRole('button',{name:language==='en'?'Add':'新增',exact:true}).tap();await page.getByRole('dialog').getByLabel(language==='en'?'Name':'名称',{exact:true}).fill('Native capability fixture');await page.getByRole('dialog').getByRole('button',{name:language==='en'?'Save':'保存',exact:true}).tap();await expect(page.getByRole('dialog')).toBeHidden();
  await page.locator('.mobile-tabbar a[href="/more"]').tap();await page.locator('main a[href="/assistant-access"]').tap();
  await expect(page.locator('.assistant-access-connection')).toHaveCount(0);
  await page.locator('main a[href="/settings#assistant"]').tap();await expect(page.locator('#assistant')).toHaveJSProperty('open',true);
  const panel=page.locator('.mcp-panel');await panel.getByLabel('Native capability fixture',{exact:true}).check();
  const oldDownload=page.waitForEvent('download');await panel.getByRole('button',{name:language==='en'?'Create connection request':'生成连接请求',exact:true}).tap();await oldDownload;
  await page.evaluate(async({platform,path})=>{if(platform==='android')Object.assign(window,{androidBridge:{}});else Object.assign(window,{webkit:{messageHandlers:{bridge:{}}}});const repository=await(await import(path)).localRepository(),asset=(await repository.list('asset')).find((row:{name:string})=>row.name==='Native capability fixture');await repository.saveAssetIfCurrent(asset,{...asset,notes:'Capability refresh fixture'});},{platform,path:sourceModuleUrl('packages/local-db/src/index.ts')});
  await expect(panel.getByRole('button',{name:language==='en'?'Create connection request':'生成连接请求',exact:true})).toBeDisabled();
  await expect(panel.getByLabel('Native capability fixture',{exact:true})).toBeDisabled();await expect(panel.locator('#mcp-duration')).toBeDisabled();
  const hint=language==='en'?'This device does not currently support local assistant connections.':'此设备目前不支持本机助手连接。';await expect(panel.getByText(hint,{exact:true})).toBeVisible();
  await expect(panel.locator('input[type=file]')).toBeDisabled();await expect(panel.locator('.mcp-active')).toHaveCount(0);await expect(panel.getByRole('link',{name:language==='en'?'Download request file':'下载请求文件',exact:true})).toHaveCount(0);
  let loopback=0;await page.route('http://127.0.0.1:65500/**',route=>{loopback++;return route.abort();});
  await panel.locator('input[type=file]').setInputFiles({name:'synthetic-unavailable-pairing.json',mimeType:'application/json',buffer:Buffer.from('{}')});
  await expect(panel.getByRole('alert')).toHaveText(hint);expect(loopback).toBe(0);await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('native-mcp-unavailable.png')});
  await page.locator('.mobile-tabbar a[href="/more"]').tap();await page.locator('main a[href="/assistant-access"]').tap();await expect(page.locator('.assistant-access-banner')).toHaveText(hint);await expect(page.locator('.assistant-access-connection')).toHaveCount(0);
  await expect(page.locator('.assistant-access-history')).toContainText(resources[language].translation.mcpNativeNoActivity);await expect(page.locator('.assistant-access-allowed')).toContainText(resources[language].translation.mcpNativeNoAccess);
  const ai=page.getByRole('button',{name:resources[language].translation.settingsAskAssistant,exact:true});await expect(ai).toBeEnabled();await ai.tap();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
  await page.locator('.mobile-tabbar a[href="/assets"]').tap();await expect(page.getByText('Native capability fixture',{exact:true}).first()).toBeVisible();
  await info.attach('capability-scope',{body:JSON.stringify({platform,language,syntheticCapacitor:true,nativeEvidence:false,loopbackRequests:loopback,activeGrants:0,aiDialogStillAvailable:true}),contentType:'application/json'});
});

test('Web MCP request preparation remains available and exports the real selected scope',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('keepany-language','en'));await page.goto('/assets/project');await page.getByRole('button',{name:'Add',exact:true}).tap();await page.getByRole('dialog').getByLabel('Name',{exact:true}).fill('Web MCP scope fixture');await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).tap();await expect(page.getByRole('dialog')).toBeHidden();
  await page.locator('.mobile-tabbar a[href="/more"]').tap();await page.locator('main a[href="/settings#assistant"]').tap();const panel=page.locator('.mcp-panel');await panel.getByLabel('Web MCP scope fixture',{exact:true}).check();
  const download=page.waitForEvent('download');await panel.getByRole('button',{name:'Create connection request',exact:true}).tap();const path=await(await download).path();if(!path)throw Error('missing-request-file');const request=JSON.parse(readFileSync(path,'utf8'));
  expect(request.kind).toBe('keepany-mcp-local-request-v1');expect(request.assetIds).toHaveLength(1);expect(request.readFields).toEqual(['name']);expect(request.writeFields).toEqual([]);await expect(panel.locator('input[type=file]')).toBeEnabled();
});
