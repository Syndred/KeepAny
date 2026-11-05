import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readCandidate, selectCandidate } from './lib/portable-candidate.mjs';
const output=resolve(process.argv[2]??'test-results/detail-followup-ci');
if(existsSync(output)&&readdirSync(output).length)throw Error('Choose a new evidence directory.');
mkdirSync(output,{recursive:true});
const directory=process.env.KEEPANY_WEB_CANDIDATE;
const manifest=directory?JSON.parse(readFileSync(join(directory,'CANDIDATE.json'),'utf8')):readCandidate(selectCandidate()).release;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(manifest.sourceDirty)throw Error('Commit the candidate source before acceptance.');
if(directory)for(const file of manifest.webFiles)if(hash(readFileSync(join(directory,file.path)))!==file.sha256)throw Error(`Changed candidate: ${file.path}`);
if(directory&&manifest.sourceFiles.find(file=>file.path==='tests/e2e/asset-detail-followup.spec.ts')?.sha256!==hash(readFileSync('tests/e2e/asset-detail-followup.spec.ts')))throw Error('Executed contract differs from candidate source.');
const identity=manifest.webFiles.find(file=>file.path==='index.html')?.sha256;
writeFileSync(join(output,'candidate.json'),JSON.stringify({sourceCommit:manifest.sourceCommit,indexSha256:identity}));
const report=join(output,'playwright.json');
const run=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','playwright.detail-followup.config.ts','--reporter=json,line'],{env:{...process.env,KEEPANY_EVIDENCE_DIR:join(output,'browser'),PLAYWRIGHT_JSON_OUTPUT_FILE:report},stdio:'inherit',timeout:900000});
if(run.error||run.status!==0){writeFileSync(join(output,'result.json'),JSON.stringify({status:'incomplete',error:run.error?.message,exitCode:run.status}));process.exitCode=1;}
else {
 const data=JSON.parse(readFileSync(report,'utf8')),tests=[];
 const walk=suites=>suites.forEach(suite=>{for(const spec of suite.specs??[])tests.push(...spec.tests);walk(suite.suites??[]);});walk(data.suites);
 if(data.errors?.length||tests.length!==4||tests.some(test=>test.status!=='expected'||test.results.length!==1||test.results[0].status!=='passed'))throw Error('Missing, failed, skipped or retried contract.');
 const attachments=tests.flatMap(test=>test.results[0].attachments??[]);
 const receipts=attachments.filter(a=>a.name==='contract-results.json').map(a=>JSON.parse(a.path?readFileSync(a.path,'utf8'):Buffer.from(a.body,'base64').toString()));
 for(const locale of ['zh-CN','en'])for(const id of ['DF01','DF02','DF03','DF04','DF05'])if(!receipts.some(r=>r.locale===locale&&r.ids.includes(id)&&r.candidate===identity&&r.result==='passed'))throw Error(`Missing ${locale}/${id}`);
 const images=attachments.filter(a=>a.contentType==='image/png');
 for(const locale of ['zh-CN','en'])for(const width of [390,768,1280,1920,1976,1986])for(const state of ['ordinary-full','item-full','subscription-full','wallet-full','ordinary-minimal','ordinary-long','expanded'])if(!images.some(a=>a.name===`${locale}-${width}-${state}.png`))throw Error(`Missing ${locale}/${width}/${state}`);
 if(images.some(a=>!a.path||!existsSync(a.path)))throw Error('Missing evidence.');
 writeFileSync(join(output,'visual-manifest.json'),JSON.stringify(images.map(a=>({name:a.name,path:a.path,sha256:hash(readFileSync(a.path))})),null,2));
 writeFileSync(join(output,'result.json'),JSON.stringify({status:'machine-checks-passed',candidate:identity,tests:4,screenshots:images.length,manualVisual:'separate',controller:'separate',independent:'separate'},null,2));
}
