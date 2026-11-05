import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { readCandidate, selectCandidate } from './lib/portable-candidate.mjs';

const output=resolve(process.argv[2] ?? 'test-results/reminder-center-ci');
if(existsSync(output)&&readdirSync(output).length)throw Error('Choose a new evidence directory.');
mkdirSync(output,{recursive:true});
const web=process.env.KEEPANY_WEB_CANDIDATE;
const manifest=web?JSON.parse(readFileSync(join(web,'CANDIDATE.json'),'utf8')):readCandidate(selectCandidate()).release;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=manifest.webFiles.find(file=>file.path==='index.html')?.sha256;
if(!identity)throw Error('Missing compiled candidate identity.');
if(web)for(const file of manifest.webFiles)if(hash(readFileSync(join(web,file.path)))!==file.sha256)throw Error(`Candidate changed: ${file.path}`);
if(manifest.webFiles.some(file=>/(?:^|\/)page-tasks[-.]/.test(file.path)))throw Error('Removed standalone task page is still compiled.');
const source=readFileSync('apps/web/src/router.tsx','utf8');
if(!source.includes('beforeLoad: ({ location })')||source.includes('import("./page-tasks")'))throw Error('Historical task route must redirect.');
writeFileSync(join(output,'candidate.json'),JSON.stringify({sourceCommit:manifest.sourceCommit,sourceDirty:manifest.sourceDirty,indexSha256:identity,specSha256:hash(readFileSync('tests/e2e/reminder-center.spec.ts'))},null,2));
const report=join(output,'playwright.json');
const run=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config',web?'playwright.reminder-center.config.ts':'playwright.portable-release.config.ts','tests/e2e/reminder-center.spec.ts','--reporter=json,line'],{env:{...process.env,KEEPANY_EVIDENCE_DIR:join(output,'browser'),PLAYWRIGHT_JSON_OUTPUT_FILE:report},stdio:'inherit',timeout:420000});
if(run.error||run.status!==0){writeFileSync(join(output,'result.json'),JSON.stringify({status:'incomplete',exitCode:run.status,error:run.error?.message}));process.exitCode=1;}else{
 const data=JSON.parse(readFileSync(report,'utf8')),tests=[];
 const walk=suites=>suites.forEach(s=>{for(const spec of s.specs??[])tests.push(...spec.tests);walk(s.suites??[]);});walk(data.suites);
 if(data.errors?.length||tests.length<24||tests.some(t=>t.status!=='expected'||t.results.length!==1||t.results[0].status!=='passed'))throw Error('Missing, failed, skipped or retried checks.');
 const receipts=tests.flatMap(t=>t.results[0].attachments??[]).filter(a=>a.name==='contract-results.json').map(a=>JSON.parse(a.path?readFileSync(a.path,'utf8'):Buffer.from(a.body,'base64').toString()));
 for(const id of ['NR01','NR02','NR03','NR04','NR05','NR06','NR07','NR08','NR09','NR10','NR11','NR12','NR13','NR14'])if(!receipts.some(r=>r.ids.includes(id)))throw Error(`Missing ${id}`);
 for(const receipt of receipts){if(receipt.candidate!==identity||receipt.result!=='passed')throw Error('Candidate mismatch.');for(const path of receipt.screenshots??[])if(!existsSync(path))throw Error(`Missing screenshot ${path}`);}
 for(const locale of ['zh-CN','en'])for(const width of [390,768,1280,1810,1920,2262])if(!receipts.some(r=>r.locale===locale&&r.width===width&&r.screenshots?.length===10))throw Error(`Missing states for ${locale}/${width}`);
 writeFileSync(join(output,'result.json'),JSON.stringify({status:'machine-checks-passed',candidate:identity,sourceCommit:manifest.sourceCommit,tests:tests.length,coveredIds:['NR01','NR02','NR03','NR04','NR05','NR06','NR07','NR08','NR09','NR10','NR11','NR12','NR13','NR14'],manualVisual:'required-separate',privacyWhitebox:'required-separate',controller:'required-separate',independentReview:'required-separate',localActivation:'required-separate'},null,2));
}
