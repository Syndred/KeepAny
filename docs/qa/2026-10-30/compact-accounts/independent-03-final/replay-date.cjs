const { chromium } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const output = __dirname;
const text = language => language === 'en' ? {accounts:'Accounts',add:'Add',create:'Create vault',save:'Save',date:'Enter a valid date (YYYY-MM-DD)'} : {accounts:'账号',add:'新增',create:'创建密码库',save:'保存',date:'请输入有效日期（年-月-日）'};
(async () => {
  const browser = await chromium.launch({ headless: true });
  const receipts = [];
  const servedIndex = await (await fetch('http://127.0.0.1:4396/')).text();
  const indexSha256 = crypto.createHash('sha256').update(servedIndex).digest('hex');
  try {
    for (const language of ['zh-CN','en']) for (const width of [390,1280]) {
      const t = text(language);
      const context = await browser.newContext({ baseURL:'http://127.0.0.1:4396',viewport:{width:1280,height:1000},locale:language,permissions:['clipboard-read','clipboard-write'] });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror',e=>errors.push(e.message));
      page.setDefaultTimeout(15000);
      try {
        await page.addInitScript(lang=>localStorage.setItem('keepany-language',lang),language);
        await page.goto('/');
        await page.locator('.sidebar nav').getByRole('link',{name:t.accounts,exact:true}).click();
        const access=page.locator('.unified-vault-access');
        await access.waitFor({state:'visible'});
        if(!await access.evaluate(n=>n.open)) await access.locator(':scope > summary').click();
        await page.locator('#password-vault-master').fill('SyntheticDateReviewMaster2026!');
        await page.locator('#password-vault-master-confirm').fill('SyntheticDateReviewMaster2026!');
        await page.getByRole('button',{name:t.create,exact:true}).click();
        await page.locator('.password-vault-toolbar').waitFor({state:'visible'});
        await page.setViewportSize({width,height:1000});
        if(width<768) await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);
        await page.locator('.password-vault-header').getByRole('button',{name:t.add,exact:true}).click();
        const dialog=page.getByRole('dialog');
        await dialog.locator('#password-vault-entry-title').fill(`Synthetic date validation ${language} ${width}`);
        await dialog.locator('#password-vault-entry-username').fill('date-review@example.test');
        await dialog.locator('#password-vault-entry-url').fill('ftp://example.test/synthetic');
        await dialog.getByRole('button',{name:t.save,exact:true}).click();
        await dialog.getByRole('alert').waitFor({state:'visible'});
        const firstUrlError=await dialog.getByRole('alert').innerText();
        await dialog.locator('#password-vault-entry-url').fill('https://example.test/ok');
        await dialog.getByRole('alert').waitFor({state:'hidden'});
        for(const item of await dialog.locator('details').all()) if(!await item.evaluate(n=>n.open)) await item.locator(':scope > summary').click();
        await dialog.locator('#account-entry-reviewed').fill('2026-02-30');
        await dialog.getByRole('button',{name:t.save,exact:true}).click();
        await dialog.getByRole('alert').waitFor({state:'visible'});
        await page.waitForTimeout(300);
        const invalid=await dialog.evaluate(node=>{
          const field=node.querySelector('#account-entry-reviewed'),alert=node.querySelector('[role=alert]'),footer=node.querySelector('.password-vault-editor-actions');
          const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};
          const r=field.getBoundingClientRect();
          const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          const er=alert.getBoundingClientRect();
          const ehit=document.elementFromPoint(er.x+er.width/2,er.y+er.height/2);
          return {field:rect(field),footer:rect(footer),alert:rect(alert),valid:field.validity.valid,validationMessage:field.validationMessage,errorText:alert.textContent,focused:document.activeElement===field,fieldExposed:hit===field,alertExposed:ehit===alert||alert.contains(ehit),errorColor:getComputedStyle(alert).color,dialogScroll:node.scrollTop};
        });
        assert.equal(invalid.valid,false); assert.equal(invalid.focused,true); assert.equal(invalid.fieldExposed,true); assert.equal(invalid.alertExposed,true); assert(invalid.field.bottom<invalid.footer.y); assert.equal(await page.locator('.asset-account-card').count(),0);
        await page.screenshot({path:path.join(output,`date-invalid-${language}-${width}.png`),fullPage:true});
        await dialog.locator('#account-entry-reviewed').fill('2026-10-29');
        await dialog.getByRole('alert').waitFor({state:'hidden'});
        assert.equal(await dialog.locator('#account-entry-reviewed').evaluate(n=>n.validity.valid),true);
        await page.screenshot({path:path.join(output,`date-corrected-${language}-${width}.png`),fullPage:true});
        await dialog.getByRole('button',{name:t.save,exact:true}).click();
        await dialog.waitFor({state:'hidden'});
        await page.locator('.compact-account-card').waitFor({state:'visible'});
        const saveFeedback=await page.locator('.compact-account-feedback-message').evaluate(n=>({text:n.textContent,color:getComputedStyle(n).color,ink:getComputedStyle(n).getPropertyValue('--ink').trim(),bounds:(()=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}})()}));
        assert.equal(await page.locator('.asset-account-card').count(),1);
        await page.screenshot({path:path.join(output,`save-feedback-${language}-${width}.png`),fullPage:true});
        const accountCopy=page.locator('.compact-account-card').getByRole('button',{name:language==='en'?'Copy username':'复制用户名',exact:true});
        await accountCopy.click();
        const copied=await page.evaluate(()=>navigator.clipboard.readText());
        assert.equal(copied,'date-review@example.test');
        const copyFeedback=await page.locator('.compact-account-feedback-message').evaluate(n=>({text:n.textContent,color:getComputedStyle(n).color,bounds:(()=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}})()}));
        await page.screenshot({path:path.join(output,`copy-feedback-${language}-${width}.png`),fullPage:true});
        assert.deepEqual(errors,[]);
        const receipt={sourceCommit:'03e186de181321cff5843e1ee194679acb81a0e3',zipSha256:'89f820f2b35f23b162b025778285cc2d06d037e8b128c37741752d573b1df391',origin:'http://127.0.0.1:4396',indexSha256,language,width,firstUrlError,invalid,errorClearedByCorrection:true,saveCreatedOneAccount:true,saveFeedback,copyFeedback,clipboardMatchesSyntheticAccount:true,pageErrors:errors};
        receipts.push(receipt); fs.writeFileSync(path.join(output,`date-${language}-${width}.json`),JSON.stringify(receipt,null,2));
        console.log(language,width,'passed',JSON.stringify({invalid,saveFeedback,copyFeedback}));
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(output,'date-replay.json'),JSON.stringify(receipts,null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
