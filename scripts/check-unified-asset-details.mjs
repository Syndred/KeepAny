import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readCandidate, selectCandidate } from './lib/portable-candidate.mjs';
const output=resolve(process.argv[2]??'test-results/unified-asset-details-ci');
if(existsSync(output)&&readdirSync(output).length)throw Error('Choose a new evidence directory; existing failures must be preserved.');
mkdirSync(output,{recursive:true});
const candidate=process.env.KEEPANY_WEB_CANDIDATE;
const manifest=candidate?JSON.parse(readFileSync(join(candidate,'CANDIDATE.json'),'utf8')):readCandidate(selectCandidate()).release;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(candidate)for(const file of manifest.webFiles)if(hash(readFileSync(join(candidate,file.path)))!==file.sha256)throw Error(`Candidate changed: ${file.path}`);
const identity=manifest.webFiles.find(file=>file.path==='index.html')?.sha256;
if(!identity)throw Error('Missing compiled identity.');
if(manifest.sourceDirty)throw Error('Acceptance requires a clean committed source candidate.');
if(candidate && manifest.sourceFiles.find(file=>file.path==='tests/e2e/unified-detail-v7.spec.ts')?.sha256!==hash(readFileSync('tests/e2e/unified-detail-v7.spec.ts')))throw Error('Candidate source and executed V7 contract differ.');
writeFileSync(join(output,'candidate.json'),JSON.stringify({sourceCommit:manifest.sourceCommit,sourceDirty:manifest.sourceDirty,indexSha256:identity,specSha256:hash(readFileSync('tests/e2e/unified-detail-v7.spec.ts'))},null,2));
const report=join(output,'playwright.json');
const run=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','playwright.unified-details.config.ts','--reporter=json,line'],{env:{...process.env,KEEPANY_EVIDENCE_DIR:join(output,'browser'),PLAYWRIGHT_JSON_OUTPUT_FILE:report},stdio:'inherit',timeout:1500000});
if(run.error||run.status!==0){writeFileSync(join(output,'result.json'),JSON.stringify({status:'incomplete',exitCode:run.status,error:run.error?.message}));process.exitCode=1;}
else{
 const data=JSON.parse(readFileSync(report,'utf8')),tests=[];
 const walk=suites=>suites.forEach(suite=>{for(const spec of suite.specs??[])tests.push(...spec.tests);walk(suite.suites??[]);});walk(data.suites);
 if(data.errors?.length||tests.length!==43||tests.some(test=>test.status!=='expected'||test.results.length!==1||test.results[0].status!=='passed'))throw Error('Missing, failed, skipped or retried checks.');
 const receipts=tests.flatMap(test=>test.results[0].attachments??[]).filter(attachment=>attachment.name==='contract-results.json').map(attachment=>JSON.parse(attachment.path?readFileSync(attachment.path,'utf8'):Buffer.from(attachment.body,'base64').toString()));
 for(const id of ['V701','V702','V703','V704','V705','V706','V707','V708','V709','V710','V711'])if(!receipts.some(receipt=>receipt.ids.includes(id)))throw Error(`Missing ${id}`);
 if(receipts.some(receipt=>receipt.candidate!==identity||receipt.result!=='passed'))throw Error('Candidate mismatch.');
 for(const locale of ['zh-CN','en'])for(const width of [390,768,1280,1920,1991,2262])if(!receipts.some(receipt=>receipt.matrix&&receipt.locale===locale&&receipt.width===width))throw Error(`Missing ${locale}/${width}`);
 for(const locale of ['zh-CN','en'])for(const width of [390,1920])if(!receipts.some(receipt=>receipt.locale===locale&&receipt.width===width&&['loading','resource-error','reloaded'].every(state=>receipt.states?.includes(state))))throw Error(`Missing loading/error/reload ${locale}/${width}`);
 const screenshots=tests.flatMap(test=>test.results[0].attachments??[]).filter(attachment=>attachment.contentType==='image/png');
 if(screenshots.length<500||screenshots.some(attachment=>!attachment.path||!existsSync(attachment.path)))throw Error('Incomplete screenshot evidence.');
 for(const test of tests){
  const receipt=test.results[0].attachments?.find(attachment=>attachment.name==='contract-results.json');
  if(!receipt)throw Error('Test has no contract receipt.');
  const value=JSON.parse(receipt.path?readFileSync(receipt.path,'utf8'):Buffer.from(receipt.body,'base64').toString());
  if(value.matrix)for(const kind of ['ordinary','item','subscription','wallet'])for(const state of ['default','description','history','tasks','hover','focus','pressed','editor','menu','minimal','long','long-description'])if(!test.results[0].attachments.some(attachment=>attachment.name===`${kind}-${state}.png`))throw Error(`Missing ${value.locale}/${value.width}/${kind}/${state}`);
  if(value.actionWidths)for(const width of [390,768,1280,1920])for(const state of ['item-activity','item-activity-error','subscription-activity','relation-error'])if(!test.results[0].attachments.some(attachment=>attachment.name===`${state}-${width}.png`))throw Error(`Missing ${value.locale}/${state}/${width}`);
 }
 writeFileSync(join(output,'visual-manifest.json'),JSON.stringify(screenshots.map(attachment=>({name:attachment.name,path:attachment.path,sha256:hash(readFileSync(attachment.path))})),null,2));
 writeFileSync(join(output,'result.json'),JSON.stringify({status:'machine-checks-passed',candidate:identity,tests:tests.length,screenshots:screenshots.length,manualVisual:'separate',controller:'separate',independentReview:'separate'},null,2));
}
