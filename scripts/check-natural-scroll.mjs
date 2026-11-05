import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {readCandidate,selectCandidate} from './lib/portable-candidate.mjs';
const output=resolve(process.argv[2]??'test-results/natural-scroll');
if(existsSync(output))throw Error('Choose a new evidence directory; preserve previous failures.');mkdirSync(output,{recursive:true});
const web=process.env.KEEPANY_WEB_CANDIDATE;
const manifest=web?JSON.parse(readFileSync(join(web,'CANDIDATE.json'),'utf8')):readCandidate(selectCandidate()).release;
const sha=b=>createHash('sha256').update(b).digest('hex');
const index=manifest.webFiles.find(f=>f.path==='index.html')?.sha256;if(!index)throw Error('Missing candidate identity');
if(web)for(const f of manifest.webFiles)if(sha(readFileSync(join(web,f.path)))!==f.sha256)throw Error('Compiled candidate changed');
const report=join(output,'report.json');
const run=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','playwright.natural-scroll.config.ts'],{env:{...process.env,KEEPANY_SCROLL_EVIDENCE:join(output,'evidence'),KEEPANY_SCROLL_OUTPUT:join(output,'browser'),KEEPANY_SCROLL_REPORT:report},stdio:'inherit',timeout:600000});
const result={schema:'keepany.natural-scroll-check.v1',candidate:{sourceCommit:manifest.sourceCommit,indexSha256:index},coverage:['NF01','NF02','NF03','NF04','NF05'],manual:{NF06:'Controller experience, independent review and actual image inspection remain separate'},status:'incomplete'};
try{
 if(run.error||run.status!==0)throw Error(run.error?.message??'Compiled UI checks failed');
 const data=JSON.parse(readFileSync(report,'utf8')),tests=[];const walk=suites=>suites.forEach(s=>{for(const spec of s.specs??[])tests.push(...spec.tests);walk(s.suites??[])});walk(data.suites);
 if(data.errors?.length||tests.length!==6||tests.some(t=>t.status!=='expected'||t.results.length!==1||t.results[0].status!=='passed'))throw Error('Missing, skipped, failed or retried contract test');
 const receipts=tests.flatMap(t=>t.results[0].attachments??[]).filter(a=>a.name==='contract-results.json').map(a=>JSON.parse(a.path?readFileSync(a.path,'utf8'):Buffer.from(a.body,'base64').toString()));
 if(receipts.length!==6||receipts.some(r=>r.status!=='passed'||r.candidate.release.sourceCommit!==manifest.sourceCommit||r.candidate.indexSha256!==index))throw Error('Receipt or version mismatch');
 for(const lang of ['zh-CN','en'])for(const id of result.coverage)if(!receipts.some(r=>r.ids.includes(id)&&r.shots.some(s=>s.includes(lang))))throw Error('Missing coverage '+lang+'/'+id);
 const shots=receipts.flatMap(r=>r.shots);if(shots.length!==72||new Set(shots).size!==72)throw Error('Incomplete visual evidence');
 const hashes=shots.map(file=>{const bytes=readFileSync(file);if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid image');return{file,sha256:sha(bytes)}});
 writeFileSync(join(output,'screenshots.json'),JSON.stringify(hashes,null,2));result.status='machine-checks-passed';
}catch(e){result.error=e.message;process.exitCode=1;}
writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));
