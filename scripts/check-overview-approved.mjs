import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { readCandidate, selectCandidate } from './lib/portable-candidate.mjs';
const output=resolve(process.argv[2] ?? 'test-results/overview-approved-ci');
if(existsSync(output)&&readdirSync(output).length)throw Error('Choose a new evidence directory.');
mkdirSync(output,{recursive:true});
const web=process.env.KEEPANY_WEB_CANDIDATE;
const manifest=web?JSON.parse(readFileSync(join(web,'CANDIDATE.json'),'utf8')):readCandidate(selectCandidate()).release;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=manifest.webFiles.find(f=>f.path==='index.html')?.sha256;
if(!identity)throw Error('Missing compiled candidate identity.');
if(web)for(const file of manifest.webFiles)if(hash(readFileSync(join(web,file.path)))!==file.sha256)throw Error(`Candidate changed: ${file.path}`);
writeFileSync(join(output,'candidate.json'),JSON.stringify({sourceCommit:manifest.sourceCommit,sourceDirty:manifest.sourceDirty,indexSha256:identity,specSha256:hash(readFileSync('tests/e2e/overview-approved.spec.ts'))},null,2));
const report=join(output,'playwright.json');
const run=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config',web?'playwright.catalog.config.ts':'playwright.portable-release.config.ts','tests/e2e/overview-approved.spec.ts','--reporter=json,line'],{env:{...process.env,KEEPANY_EVIDENCE_DIR:join(output,'browser'),PLAYWRIGHT_JSON_OUTPUT_FILE:report},stdio:'inherit',timeout:300000});
if(run.error||run.status!==0){writeFileSync(join(output,'result.json'),JSON.stringify({status:'incomplete',exitCode:run.status,error:run.error?.message}));process.exitCode=1;}else{
 const data=JSON.parse(readFileSync(report,'utf8'));const tests=[];
 const walk=suites=>suites.forEach(s=>{for(const spec of s.specs??[])tests.push(...spec.tests);walk(s.suites??[]);});walk(data.suites);
 if(data.errors?.length||tests.length!==16||tests.some(t=>t.status!=='expected'||t.results.length!==1||t.results[0].status!=='passed'))throw Error('Missing, failed, skipped or retried checks.');
 const receipts=tests.flatMap(t=>t.results[0].attachments??[]).filter(a=>a.name==='contract-results.json').map(a=>JSON.parse(a.path?readFileSync(a.path,'utf8'):Buffer.from(a.body,'base64').toString()));
 for(const id of ['OV01','OV02','OV03','OV04','OV05','OV06','OV07','OV08','OV09'])if(!receipts.some(r=>r.ids.includes(id)))throw Error(`Missing ${id}`);
 for(const receipt of receipts.filter(r=>r.locale&&r.width))for(const path of receipt.screenshots??[])if(!existsSync(path))throw Error(`Missing screenshot ${path}`);
 if(receipts.some(r=>r.candidate!==identity||r.result!=='passed'))throw Error('Candidate mismatch.');
 for(const locale of ['zh-CN','en'])for(const width of [390,768,1280,1920,2262])if(!receipts.some(r=>r.locale===locale&&r.width===width&&r.screenshots?.length===8))throw Error(`Missing ${locale}/${width}`);
 writeFileSync(join(output,'result.json'),JSON.stringify({status:'machine-checks-passed',candidate:identity,tests:tests.length,manualVisual:'separate',controller:'separate',independentReview:'separate'},null,2));
}
