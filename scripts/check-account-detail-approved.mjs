import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {readCandidate,selectCandidate} from './lib/portable-candidate.mjs';
const output=resolve(process.argv[2]??'test-results/account-detail-approved-check');
if(existsSync(output)&&readdirSync(output).length)throw Error('Use a new evidence directory; previous failures are preserved.');
mkdirSync(output,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let candidate;
if(process.env.KEEPANY_WEB_CANDIDATE){
 const root=resolve(process.env.KEEPANY_WEB_CANDIDATE),receipt=JSON.parse(readFileSync(join(root,'CANDIDATE.json'),'utf8'));
 if(receipt.schema!=='keepany.catalog-web.v1'||!receipt.webFiles?.length)throw Error('Invalid compiled Web identity');
 for(const file of receipt.webFiles)if(hash(readFileSync(join(root,file.path)))!==file.sha256)throw Error('Candidate byte mismatch: '+file.path);
 candidate={sourceCommit:receipt.sourceCommit,sourceDirty:receipt.sourceDirty,indexSha256:receipt.webFiles.find(x=>x.path==='index.html')?.sha256};
}else{const{release,archiveSha256}=readCandidate(selectCandidate({archiveOnly:true}));candidate={sourceCommit:release.sourceCommit,archiveSha256};}
const report=join(output,'report.json'),evidence=join(output,'evidence');
const env={...process.env,KEEPANY_ACCOUNT_DETAIL_EVIDENCE:evidence,KEEPANY_ACCOUNT_DETAIL_OUTPUT:join(output,'browser'),KEEPANY_ACCOUNT_DETAIL_REPORT:report};
const run=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','playwright.account-detail-approved.config.ts'],{env,stdio:'inherit',timeout:10*60*1000});
const result={schema:'keepany.account-detail-approved-check.v1',candidate,automatedCoverage:['AS01','AS02','AS03','AS04','AS05','AS08','AS09','AS10'],manual:{AS06:'Reminder integration checked separately',AS07:'Independent review and controller experience separate',visual:'Actual image inspection separate'},status:'incomplete',exitCode:run.status};
try{
 if(run.error||run.status!==0)throw Error(run.error?.message??'Compiled UI checks failed');
 const data=JSON.parse(readFileSync(report,'utf8'));if(data.stats.unexpected||data.stats.flaky||data.stats.skipped||data.stats.expected!==6)throw Error('Missing, skipped, flaky, or failing contract case');
 for(const locale of ['zh-CN','en']){
  const functional=JSON.parse(readFileSync(join(evidence,`functional-${locale}.json`),'utf8')),visual=JSON.parse(readFileSync(join(evidence,`visual-${locale}.json`),'utf8'));
  if(functional.candidate.indexSha256!==visual.candidate.indexSha256||candidate.indexSha256&&candidate.indexSha256!==functional.candidate.indexSha256)throw Error('Candidate versions differ between results');
  const expected=['default','hover','focus','pressed','guide','connections','fullscreen','long'].flatMap(state=>[390,768,1280,1920,1991].map(width=>`${state}-${locale}-${width}.png`));
  const manifest=expected.map(name=>{const bytes=readFileSync(join(evidence,name));if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Invalid PNG: '+name);return{name,sha256:hash(bytes)}});
  if(visual.screenshots.length!==expected.length)throw Error('Missing visual state receipt');
  writeFileSync(join(output,`screenshots-${locale}.json`),JSON.stringify(manifest,null,2));
 }
 result.status='automated checks passed; manual conclusions separate';
}catch(error){result.error=error.message;process.exitCode=1;}
writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));
