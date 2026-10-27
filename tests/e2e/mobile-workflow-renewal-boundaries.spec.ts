import { expect, test, type Page } from '@playwright/test';
import { resources } from '../../apps/web/src/i18n';
import { sourceModuleUrl } from './helpers/source-module-url';
import { selectChoice } from './helpers/select-choice';

test.use({viewport:{width:390,height:844},hasTouch:true,timezoneId:'Asia/Shanghai'});
const repo=sourceModuleUrl('packages/local-db/src/index.ts'),domain=sourceModuleUrl('packages/domain/src/index.ts'),workflow=sourceModuleUrl('packages/domain/src/project-workflow.ts');
const png='iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAAhUlEQVR4nLXNuRXCQBAE0WJCIQlZikEJYZLZ5iGfLOTyYI85Wu3NlPEfn2Pja/vzhXT2c7fzfS+A2rDuV2jYKKgMmzSJYfPcysYCoGysAWqGC6BgeAGyRgAgZcQA4kYYIGhkACJGEsBt5AF8RgnAYVQBVoYAYGpoAMaGDGBgKIGuIQb+jQtZ/TPNXBjnggAAAABJRU5ErkJggg==';
async function fixture(page:Page,locale:'zh-CN'|'en') {
  await page.goto('/');
  return page.evaluate(async({repo,domain,workflow,png,titles})=>{
    const {newAsset,relationSchema,submissionSchema,historySchema,taskSchema}=await import(domain),{buildProjectWorkflowTasks,recordProjectWorkflowTask}=await import(workflow),repository=await(await import(repo)).localRepository();
    const file=new File([Uint8Array.from(atob(png),character=>character.charCodeAt(0))],'workflow-fixture.png',{type:'image/png'}),attachment=await repository.putFile(file);
    const project={...newAsset('project'),name:'Boundary project',description:'Preserve original project description',notes:'Ordinary nonsecret notes',url:'https://workflow.example.test',tags:['retained'],attachments:[attachment],projectMedia:{logoId:attachment,homeScreenshotId:'',productScreenshotIds:[],promoCoverId:''},projectDomains:[{id:crypto.randomUUID(),name:'workflow.example.test',registrar:'Fixture registry',accountId:'',expiryDate:'2027-01-31',annualAmount:1200,currency:'USD',autoRenew:'unknown'}]};
    const other={...newAsset('project'),name:'Unrelated project'},account={...newAsset('account'),name:'Ordinary linked account',username:'operator@example.test'},subscription={...newAsset('subscription'),name:'Linked subscription',dueDate:'2026-12-31'},reference={...newAsset('vault'),name:'External password reference only',url:'bitwarden://vault/item/synthetic-reference',notes:'No password or KDBX content in this reference'};
    const assets=[project,other,account,subscription,reference],relations=[account,subscription,reference].map(asset=>relationSchema.parse({id:crypto.randomUUID(),from:project.id,to:asset.id,label:'uses',source:'Local fixture evidence',createdAt:'2026-10-20T00:00:00.000Z'}));
    const submission=submissionSchema.parse({id:crypto.randomUUID(),assetId:project.id,name:'Retained listing',url:'https://listing.example.test/item',status:'review',evidence:'Original review evidence',deleted:false});
    const history=historySchema.parse({id:crypto.randomUUID(),assetId:project.id,action:'maintenance',title:'Retained project history',note:'Original ordinary history',createdAt:'2026-10-20T00:00:00.000Z'});
    const round=crypto.randomUUID(),initial=buildProjectWorkflowTasks({project,assets,relations,submissions:[submission],kind:'close',roundId:round,at:'2026-10-20T01:00:00.000Z',title:(step:string,name:string)=>`${titles[step]} · ${name}`});
    const tasks=initial.map((task:unknown,index:number)=>{let value=task;if(index===0)value=recordProjectWorkflowTask(value,'blocked','Initial blocker retained in history','2026-10-20T02:00:00.000Z');return recordProjectWorkflowTask(value,index===0||index===initial.length-1?'done':'na',`Completed fixture evidence ${index}`,'2026-10-20T03:00:00.000Z');});
    const otherTask=taskSchema.parse({id:crypto.randomUUID(),assetId:other.id,name:'Unrelated task',createdAt:'2026-10-20T00:00:00.000Z'});
    await repository.saveBatch([...assets.map(value=>({type:'asset',value})),...relations.map(value=>({type:'relation',value})),...tasks.map((value:unknown)=>({type:'task',value})),{type:'task',value:otherTask},{type:'submission',value:submission},{type:'history',value:history}]);
    return {id:project.id,round,attachment,reference:reference.id,other:other.id,total:tasks.length};
  },{repo,domain,workflow,png,titles:Object.fromEntries(Object.entries(resources[locale].translation).filter(([key])=>key.startsWith('workflowStep_')).map(([key,value])=>[key.slice('workflowStep_'.length),value]))});
}
async function state(page:Page,id:string) {
  return page.evaluate(async({repo,id})=>{const repository=await(await import(repo)).localRepository(),project=await repository.get('asset',id);const rows:Record<string,unknown>={};for(const type of ['asset','relation','task','submission','history'])rows[type]=(await repository.list(type,true)).sort((a:{id:string},b:{id:string})=>a.id.localeCompare(b.id));const url=await repository.fileUrl(project.attachments[0]);try{const bytes=await(await fetch(url)).arrayBuffer();return {project,rows,imageSha:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(value=>value.toString(16).padStart(2,'0')).join(''),vaultExists:Boolean(await repository.readPasswordVault())};}finally{URL.revokeObjectURL(url);}}, {repo,id});
}
function withoutProjectState(value:Awaited<ReturnType<typeof state>>) {
  const cloned=structuredClone(value);for(const item of cloned.rows.asset as {id:string;status?:string;updatedAt?:string}[])if(item.id===cloned.project.id){delete item.status;delete item.updatedAt;}delete cloned.project.status;delete cloned.project.updatedAt;return cloned;
}
async function archiveDialog(page:Page,id:string,locale:'zh-CN'|'en') {
  const t=(key:keyof typeof resources.en.translation)=>resources[locale].translation[key];
  await page.goto(`/assets/project/${id}/workflow/close`);await page.getByRole('button',{name:t('workflowViewReport'),exact:true}).tap();await page.getByRole('button',{name:t('workflowArchiveLocal'),exact:true}).tap();await expect(page.getByRole('dialog')).toBeVisible();
}
for(const locale of ['zh-CN','en'] as const) {
  test(`${locale} F08-04 archived project reactivation preserves original records, round evidence and ordinary password refs`,async({page},info)=>{
    await page.addInitScript(language=>localStorage.setItem('keepany-language',language),locale);const ids=await fixture(page,locale),before=await state(page,ids.id),t=(key:keyof typeof resources.en.translation)=>resources[locale].translation[key];
    await archiveDialog(page,ids.id,locale);await page.getByRole('dialog').getByRole('button',{name:t('workflowConfirmArchive'),exact:true}).tap();await expect(page.getByRole('dialog')).toBeHidden();
    await expect.poll(async()=>(await state(page,ids.id)).project.status).toBe('archived');expect(withoutProjectState(await state(page,ids.id))).toEqual(withoutProjectState(before));
    await page.goto(`/assets/project/${ids.id}`);await expect(page.getByRole('heading',{name:'Boundary project',exact:true})).toBeVisible();
    const reactivate=page.locator('.asset-project-action-bar').getByRole('button',{name:locale==='en'?'Reactivate project':'重新启用项目',exact:true});
    await expect(reactivate).toBeVisible();await reactivate.tap();
    for(const width of [360,390,430]){
      await page.setViewportSize({width,height:844});const dialog=page.getByRole('dialog'),box=await dialog.boundingBox();if(!box)throw Error('missing-reactivation-dialog');expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      for(const button of await dialog.getByRole('button').all()){const target=await button.boundingBox();if(!target)throw Error('missing-confirmation-control');expect(target.width).toBeGreaterThanOrEqual(44);expect(target.height).toBeGreaterThanOrEqual(44);}
      await page.keyboard.press('Tab');expect(await dialog.evaluate(element=>element.contains(document.activeElement))).toBe(true);await page.screenshot({path:info.outputPath(`reactivation-confirm-${width}.png`)});
    }
    await page.setViewportSize({width:390,height:844});await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).tap();expect((await state(page,ids.id)).project.status).toBe('archived');
    await reactivate.tap();await page.getByRole('dialog').getByRole('button',{name:locale==='en'?'Reactivate project':'重新启用项目',exact:true}).tap();await expect(page.getByRole('dialog')).toBeHidden();
    await expect.poll(async()=>(await state(page,ids.id)).project.status).toBe('active');await page.reload();const after=await state(page,ids.id);expect(after.vaultExists).toBe(false);expect(withoutProjectState(after)).toEqual(withoutProjectState(before));
    await page.goto(`/assets/project/${ids.id}/workflow/close`);await page.getByRole('button',{name:t('workflowViewReport'),exact:true}).tap();await expect(page.locator('.project-workflow-report')).toContainText('Completed fixture evidence 0');
    await page.screenshot({path:info.outputPath('reactivated-history-retained.png')});await info.attach('retained-records',{body:JSON.stringify({projectId:ids.id,roundId:ids.round,taskCount:ids.total,imageSha:after.imageSha,passwordRefId:ids.reference,kdbxOpened:false}),contentType:'application/json'});
  });
  test(`${locale} F08-04 reactivation write failure and a real second-page stale confirmation never overwrite newer records`,async({page},info)=>{
    await page.addInitScript(language=>localStorage.setItem('keepany-language',language),locale);const ids=await fixture(page,locale),t=(key:keyof typeof resources.en.translation)=>resources[locale].translation[key];
    await page.evaluate(async({repo,id,round})=>{const repository=await(await import(repo)).localRepository();await repository.archiveProjectIfWorkflowComplete(await repository.get('asset',id),round);},{repo,id:ids.id,round:ids.round});
    await page.goto(`/assets/project/${ids.id}`);
    const label=locale==='en'?'Reactivate project':'重新启用项目',open=()=>page.locator('.asset-project-action-bar').getByRole('button',{name:label,exact:true}).tap(),confirm=()=>page.getByRole('dialog').getByRole('button',{name:label,exact:true});
    await page.evaluate(async({repo,id})=>{const repository=await(await import(repo)).localRepository(),original=repository.saveAssetIfCurrent.bind(repository);let fail=true;repository.saveAssetIfCurrent=async(expected:{id:string},next:unknown)=>{if(expected.id===id&&fail){fail=false;throw Error('synthetic-write-failure');}return original(expected,next);};},{repo,id:ids.id});
    const archived=await state(page,ids.id);await open();await confirm().tap();await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(t('error'));expect(await state(page,ids.id)).toEqual(archived);
    await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).tap();await open();
    const other=await page.context().newPage();try{
      await other.goto(`/assets/project/${ids.id}`);await other.locator('.asset-project-action-bar').getByRole('button',{name:t('edit'),exact:true}).tap();await other.getByRole('dialog').locator('#name').fill('Later project name');await other.getByRole('dialog').getByRole('button',{name:t('save'),exact:true}).tap();await expect(other.getByRole('dialog')).toBeHidden();
      const latest=await state(other,ids.id);await confirm().tap();await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(t('assetStale'));await expect(confirm()).toBeDisabled();expect(await state(page,ids.id)).toEqual(latest);
      await page.screenshot({path:info.outputPath('reactivation-stale-keeps-later-name.png')});await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).tap();await open();await confirm().tap();await expect(page.getByRole('dialog')).toBeHidden();await expect.poll(async()=>(await state(page,ids.id)).project.status).toBe('active');expect(withoutProjectState(await state(page,ids.id))).toEqual(withoutProjectState(latest));
    }finally{await other.close();}
  });
  test(`${locale} F08-05 archive captures old project and round then rejects actual second-page project, round and outcome changes`,async({page},info)=>{
    test.setTimeout(90_000);await page.addInitScript(language=>localStorage.setItem('keepany-language',language),locale);const t=(key:keyof typeof resources.en.translation)=>resources[locale].translation[key],results:unknown[]=[];
    for(const change of ['project','new-round','blocked-outcome']){
      const ids=await fixture(page,locale);await archiveDialog(page,ids.id,locale);
      await page.evaluate(async path=>{const repository=await(await import(path)).localRepository(),original=repository.archiveProjectIfWorkflowComplete.bind(repository);const barrier={entered:false,release:()=>{}};Object.assign(window,{archiveBoundary:barrier});repository.archiveProjectIfWorkflowComplete=async(project:unknown,round:string)=>{const frozen=structuredClone(project);barrier.entered=true;await new Promise<void>(resolve=>{barrier.release=resolve;});return original(frozen,round);};},repo);
      await page.getByRole('dialog').getByRole('button',{name:t('workflowConfirmArchive'),exact:true}).tap();await expect.poll(()=>page.evaluate(()=>(window as unknown as{archiveBoundary:{entered:boolean}}).archiveBoundary.entered)).toBe(true);
      const other=await page.context().newPage();try{
        if(change==='project'){
          await other.goto(`/assets/project/${ids.id}`);await other.locator('.asset-project-action-bar').getByRole('button',{name:t('edit'),exact:true}).tap();await other.getByRole('dialog').locator('#name').fill('Changed while archive was pending');await other.getByRole('dialog').getByRole('button',{name:t('save'),exact:true}).tap();await expect(other.getByRole('dialog')).toBeHidden();
        }else{
          await other.goto(`/assets/project/${ids.id}/workflow/close`);
          if(change==='new-round'){await other.getByRole('button',{name:t('workflowNewRound'),exact:true}).tap();await other.getByRole('button',{name:t('workflowCreatePlan'),exact:true}).tap();await expect(other.getByRole('button',{name:t('workflowCreatePlan'),exact:true})).toHaveCount(0);}
          else{const row=other.locator('.project-workflow-task').first();await row.getByRole('button',{name:t('workflowEditRecord'),exact:true}).tap();await selectChoice(row.getByLabel(t('workflowResult')),'blocked');await row.getByLabel(t('workflowEvidence')).fill('New blocker recorded in real second page');await row.getByRole('button',{name:t('workflowSaveRecord'),exact:true}).tap();await expect(row).toContainText('New blocker recorded in real second page');}
        }
        const latest=await state(other,ids.id);await page.evaluate(()=>(window as unknown as{archiveBoundary:{release:()=>void}}).archiveBoundary.release());await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(t(change==='project'?'assetStale':'workflowRoundStale'));
        const after=await state(page,ids.id);expect(after.project.status).toBe('active');expect(after).toEqual(latest);await page.screenshot({path:info.outputPath(`archive-stale-${change}.png`)});results.push({change,projectId:ids.id,rejected:true,latestPreserved:true});
        await page.getByRole('dialog').getByRole('button',{name:t('cancel'),exact:true}).tap();
      }finally{await other.close();}
    }
    await info.attach('actual-interleavings',{body:JSON.stringify(results),contentType:'application/json'});
  });
  test(`${locale} F09-02 continuous renewals preserve anchors across Gregorian boundaries and custom intervals`,async({page},info)=>{
    test.setTimeout(120_000);await page.addInitScript(language=>localStorage.setItem('keepany-language',language),locale);await page.goto('/');
    const cases=[
      {cycle:'month',interval:1,anchor:'2026-01-31',next:['2026-02-28','2026-03-31','2026-04-30']},
      {cycle:'year',interval:1,anchor:'2024-02-29',next:['2025-02-28','2026-02-28','2027-02-28','2028-02-29']},
      {cycle:'day',interval:1,anchor:'2024-02-28',next:['2024-02-29','2024-03-01','2024-03-02']},
      {cycle:'week',interval:1,anchor:'2024-02-23',next:['2024-03-01','2024-03-08','2024-03-15']},
      {cycle:'day',interval:100,anchor:'2023-12-25',next:['2024-04-03','2024-07-12','2024-10-20']},
      {cycle:'week',interval:2,anchor:'2026-12-25',next:['2027-01-08','2027-01-22','2027-02-05']},
      {cycle:'month',interval:100,anchor:'2026-01-31',next:['2034-05-31','2042-09-30','2051-01-31']},
      {cycle:'year',interval:4,anchor:'2024-02-29',next:['2028-02-29','2032-02-29','2036-02-29']},
    ],results:unknown[]=[];
    for(const [index,sample]of cases.entries()){
      const id=await page.evaluate(async({repo,domain,sample,index})=>{const {newAsset}=await import(domain),repository=await(await import(repo)).localRepository(),asset={...newAsset('subscription'),name:`Boundary renewal ${index}`,amount:1200,currency:'USD',cycle:sample.cycle,interval:sample.interval,dueDate:sample.anchor,billingAnchor:sample.anchor,renewalCount:0};await repository.save('asset',asset);return asset.id;},{repo,domain,sample,index});
      await page.goto(`/assets/subscription/${id}`);
      for(const [occurrence,next]of sample.next.entries()){
        await page.getByRole('button',{name:resources[locale].translation.renew,exact:true}).tap();
        await expect.poll(()=>page.evaluate(async({repo,id})=>{const repository=await(await import(repo)).localRepository(),asset=await repository.get('asset',id),history=(await repository.list('history')).filter((row:{assetId:string;action:string})=>row.assetId===id&&row.action==='renew');return {due:asset.dueDate,anchor:asset.billingAnchor,count:asset.renewalCount,historyCount:history.length,historyIds:new Set(history.map((row:{id:string})=>row.id)).size,amounts:history.map((row:{amount:number})=>row.amount)};},{repo,id})).toEqual({due:next,anchor:sample.anchor,count:occurrence+1,historyCount:occurrence+1,historyIds:occurrence+1,amounts:Array(occurrence+1).fill(1200)});
      }
      await page.reload();await expect(page.getByRole('heading',{name:`Boundary renewal ${index}`,exact:true})).toBeVisible();results.push({...sample,id,records:sample.next.length});
      if(index===4||index===6)await page.screenshot({path:info.outputPath(`renewal-custom-${sample.cycle}.png`)});
    }
    await info.attach('renewal-matrix',{body:JSON.stringify(results),contentType:'application/json'});
  });
}
