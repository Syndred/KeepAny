import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { randomUUID, createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { GraphBootRecorder, installControllerObserver, observeGraphBoot, inspectFailedScriptCache, staticScriptManifest } from './account-graph-boot-diagnostics.ts';
const fixtureRoot=resolve('test-results/account-graph-boot-diagnostics-unit');
const ownedFixtures=new Set();
async function fixtureDirectory(){
 await mkdir(fixtureRoot,{recursive:true});
 const directory=resolve(fixtureRoot,randomUUID());
 await mkdir(directory);ownedFixtures.add(directory);return directory;
}
afterEach(async()=>{
 for(const directory of ownedFixtures){
  if(dirname(directory)!==fixtureRoot||!/^[a-f0-9-]{36}$/.test(basename(directory)))throw Error('unit-fixture-scope');
  try{await unlink(resolve(directory,'account-graph-boot-diagnostics.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  await rmdir(directory);ownedFixtures.delete(directory);
 }
});
const origin='http://127.0.0.1:4391';
const request=(id='1',url=`${origin}/assets/index-test.js`)=>({requestId:id,type:'Script',frameId:'frame1',loaderId:'loader1',timestamp:12,
 request:{method:'GET',url},initiator:{type:'parser'}});

test('only loopback origin is eligible; documents redact identifiers and all queries',()=>{
 assert.throws(()=>new GraphBootRecorder('https://outside.example.test'));
 const recorder=new GraphBootRecorder(origin);
 recorder.request({...request('doc',`${origin}/assets/account/private-identifier?credential=canary-credential`),type:'Document'});
 recorder.request(request('foreign','https://outside.example.test/assets/a.js'));
 recorder.request(request('user','http://user:canary-credential@127.0.0.1:4391/assets/a.js'));
 recorder.request(request('api',`${origin}/api/private?credential=canary-credential`));
 recorder.request(request('static',`${origin}/assets/index-test.js?credential=canary-credential`));
 const snapshot=recorder.snapshot(), text=JSON.stringify(snapshot);
 assert.equal(snapshot.events.length,2);
 assert.equal(snapshot.events[0].path,'/assets/account/:id');
 assert.ok(!text.includes('private-identifier'));
 assert.ok(!text.includes('canary-credential'));
 assert.ok(!text.includes('outside.example.test'));
});

test('metadata collection never accesses request/response headers, bodies or data payload',()=>{
 const recorder=new GraphBootRecorder(origin), input=request();
 Object.defineProperty(input.request,'headers',{get(){throw Error('must-not-read');}});
 Object.defineProperty(input.request,'postData',{get(){throw Error('must-not-read');}});
 recorder.request(input);
 const response={mimeType:'text/javascript',status:200,fromServiceWorker:true,fromDiskCache:false,encodedDataLength:12};
 Object.defineProperty(response,'headers',{get(){throw Error('must-not-read');}});
 recorder.response({requestId:'1',response});
 const data={requestId:'1',encodedDataLength:34};
 Object.defineProperty(data,'data',{get(){throw Error('must-not-read');}});
 recorder.data(data);
 recorder.complete({requestId:'1',errorText:'net::ERR_ABORTED',canceled:true,timestamp:13},true);
 const events=recorder.snapshot().events;
 assert.equal(events[1].mime,'text/javascript');
 assert.equal(events[1].fromServiceWorker,true);
 assert.equal(events[1].fromDiskCache,false);
 assert.equal(events[2].errorCode,'net::ERR_ABORTED');
 assert.equal(events[2].observedEncodedDataLength,34);
 assert.equal(events[2].dataEvents,1);
});

test('unexpected protocol errors and MIME are redacted; successful bytes finish removes request',()=>{
 const recorder=new GraphBootRecorder(origin);
 recorder.request(request());
 recorder.response({requestId:'1',response:{status:200,mimeType:'canary-credential value'}});
 recorder.complete({requestId:'1',errorText:'canary-credential value'},true);
 recorder.request(request('2'));
 recorder.complete({requestId:'2',encodedDataLength:1200,timestamp:14},false);
 const result=recorder.snapshot();
 assert.ok(!JSON.stringify(result).includes('canary-credential'));
 assert.equal(result.events[1].mime,'redacted');
 assert.equal(result.events[2].errorCode,'redacted');
 assert.equal(result.events[4].encodedDataLength,1200);
 assert.equal(result.pendingRequests,0);
});

test('event ring and live request tables are bounded with explicit loss counters',()=>{
 const recorder=new GraphBootRecorder(origin);
 for(let i=0;i<1000;i++)recorder.request(request(String(i)));
 const result=recorder.snapshot();
 assert.equal(result.events.length,512);
 assert.equal(result.droppedEvents,488);
 assert.equal(result.pendingRequests,256);
 assert.equal(result.droppedRequests,744);
});

test('foreign frame lifecycle and worker scopes cannot leak paths; controller values are metadata only',()=>{
 const recorder=new GraphBootRecorder(origin);
 recorder.frame({frame:{id:'own',url:`${origin}/assets/account/secret-id?key=canary-credential`,loaderId:'L'}});
 recorder.frame({frameId:'own',loaderId:'L',name:'load',timestamp:1},true);
 recorder.frame({frame:{id:'own',url:'https://outside.example.test/private'}});
 recorder.frame({frameId:'own',loaderId:'foreign',name:'load',timestamp:2},true);
 recorder.workers({versions:[{scriptURL:`${origin}/sw.js?key=canary-credential`,registrationId:'1',versionId:'2',status:'activated',runningStatus:'running',controlledClients:['tab1']},
 {scriptURL:'https://outside.example.test/sw.js',registrationId:'3',versionId:'4'}]});
 recorder.controller({event:'controllerchange',documentPath:'/assets/account/secret-id',controllerPresent:true,controllerPath:'/sw.js',readyState:'complete',body:'canary-credential'});
 recorder.controller({event:{toString:()=> 'controllerchange',toJSON:()=> 'canary-credential'},documentPath:'/'});
 const result=recorder.snapshot();
 assert.equal(result.events.length,4);
 assert.equal(result.events[1].kind,'frame-lifecycle');
 assert.equal(result.events[2].kind,'worker-version');
 assert.equal(result.events[3].path,'/assets/account/:id');
 assert.ok(!JSON.stringify(result).includes('canary-credential'));
 assert.ok(!JSON.stringify(result).includes('secret-id'));
});

function pageSandbox(url=`${origin}/assets/account/fixture`){
 const windowEvents=new Map(),swEvents=new Map(),values=[];
 const serviceWorker={controller:{scriptURL:`${origin}/sw.js?discard-query=canary-credential`},addEventListener:(n,f)=>swEvents.set(n,f),removeEventListener:n=>swEvents.delete(n)};
 const window={addEventListener:(n,f)=>windowEvents.set(n,f),removeEventListener:n=>windowEvents.delete(n)};window.top=window;
 const sandbox={window,navigator:{serviceWorker},location:new URL(url),document:{readyState:'complete',getElementById:()=>({childElementCount:0})},URL,Promise,Reflect};
 return{sandbox,windowEvents,swEvents,values};
}
test('about:blank and denied serviceWorker access do not throw or add page listeners',()=>{
 const blank=pageSandbox('about:blank');
 Object.defineProperty(blank.sandbox.navigator,'serviceWorker',{get(){throw Error('denied');}});
 vm.runInNewContext(`(${installControllerObserver.toString()})(${JSON.stringify({bindingName:'binding',cleanupName:'cleanup',origin})})`,blank.sandbox);
 assert.equal(blank.windowEvents.size,0);
 const denied=pageSandbox();Object.defineProperty(denied.sandbox.navigator,'serviceWorker',{get(){throw Error('denied');}});
 vm.runInNewContext(`(${installControllerObserver.toString()})(${JSON.stringify({bindingName:'binding',cleanupName:'cleanup',origin})})`,denied.sandbox);
 assert.equal(denied.windowEvents.size,0);
});

test('page controller observer emits no query, handles missing SW and removes only its own listeners',async()=>{
 const state=pageSandbox();state.sandbox.window.binding=value=>{state.values.push(value);};
 vm.runInNewContext(`(${installControllerObserver.toString()})(${JSON.stringify({bindingName:'binding',cleanupName:'cleanup',origin})})`,state.sandbox);
 assert.equal(state.values.length,1);
 assert.equal(state.values[0].controllerPath,'/sw.js');
 state.swEvents.get('controllerchange')();state.windowEvents.get('pageshow')({persisted:true});
 assert.ok(!JSON.stringify(state.values).includes('canary-credential'));
 state.sandbox.window.cleanup();assert.equal(state.windowEvents.size,0);assert.equal(state.swEvents.size,0);
 const absent=pageSandbox();delete absent.sandbox.navigator.serviceWorker;absent.sandbox.window.binding=value=>absent.values.push(value);
 vm.runInNewContext(`(${installControllerObserver.toString()})(${JSON.stringify({bindingName:'binding',cleanupName:'cleanup',origin})})`,absent.sandbox);
 assert.equal(absent.values[0].controllerPresent,false);absent.sandbox.window.cleanup();
});

test('session lifecycle sends only passive commands, detaches, and does not replace failure on unavailable APIs',async()=>{
 const state=pageSandbox(),commands=[];
 class Session extends EventEmitter{async send(method){commands.push(method);if(method==='ServiceWorker.enable')throw Error('fixed unsupported');return{};}async detach(){this.detached=true;}}
 const session=new Session();const frame={url:()=>`${origin}/assets/account/fixture`};
 let page;
 const context={newCDPSession:async()=>session};
 page={mainFrame:()=>frame,exposeBinding:async(name,callback)=>{state.sandbox.window[name]=value=>callback({page,frame},value);},
 addInitScript:async()=>{},evaluate:async(fn,args)=>vm.runInNewContext(`(${fn.toString()})(${JSON.stringify(args)})`,state.sandbox)};
 const dir=await fixtureDirectory();
 const info={project:{use:{baseURL:origin}},outputPath:name=>resolve(dir,name),attach:async()=>{throw Error('fixed attachment refusal');}};
 const observer=await observeGraphBoot(context,page,info);
 session.emit('Network.requestWillBeSent',request());
 session.emit('Network.loadingFailed',{requestId:'1',errorText:'net::ERR_ABORTED',canceled:true});
 await observer.finish();await observer.finish();
 assert.deepEqual(commands,['Network.enable','Page.enable','ServiceWorker.enable','Runtime.enable','Log.enable','Page.setLifecycleEventsEnabled']);
 assert.equal(session.detached,true);
 assert.equal(session.eventNames().length,0);
 assert.equal(state.windowEvents.size,0);assert.equal(state.swEvents.size,0);
 const proof=JSON.parse(await readFile(resolve(dir,'account-graph-boot-diagnostics.json'),'utf8'));
 assert.equal(proof.schema,'keepany-graph-boot-diagnostics-v2');
 assert.equal(proof.observerAffectsTiming,true);
 assert.equal(proof.networkOrCacheInterventions,false);
 assert.equal(proof.capabilities.ServiceWorker,false);
 assert.ok(proof.unavailable.includes('serviceworker-unavailable'));
 assert.ok(!commands.some(name=>/setCache|Bypass|autoAttach|reload|Fetch\./.test(name)));
});

test('failed original case keeps natural viewport screenshot and capture failure is only a fixed diagnostic code',async()=>{
 const state=pageSandbox(),frame={url:()=>`${origin}/assets/account/fixture`};
 class Session extends EventEmitter{async send(){return{};}async detach(){}}
 const session=new Session();let shot;let page;
 const context={newCDPSession:async()=>session};
 page={mainFrame:()=>frame,exposeBinding:async(name,callback)=>{state.sandbox.window[name]=value=>callback({page,frame},value);},addInitScript:async()=>{},
 evaluate:async(fn,args)=>vm.runInNewContext(`(${fn.toString()})(${JSON.stringify(args)})`,state.sandbox),
 screenshot:async options=>{shot=options;throw Error('not serialized arbitrary error');}};
 const dir=await fixtureDirectory();
 const info={project:{use:{baseURL:origin}},outputPath:name=>resolve(dir,name),attach:async()=>{}};
 const observer=await observeGraphBoot(context,page,info);await observer.finish(true);
 assert.equal(shot.fullPage,false);assert.equal(shot.animations,'allow');assert.equal(shot.caret,'initial');
 assert.equal(Object.hasOwn(shot,'mask'),false);assert.equal(Object.hasOwn(shot,'clip'),false);assert.equal(Object.hasOwn(shot,'style'),false);
 const proof=JSON.parse(await readFile(resolve(dir,'account-graph-boot-diagnostics.json'),'utf8'));
 assert.equal(proof.originalCaseFailed,true);assert.ok(proof.unavailable.includes('failure-screenshot-unavailable'));
 assert.ok(!JSON.stringify(proof).includes('arbitrary error'));assert.equal(session.eventNames().length,0);
});

test('denied SW is marked unavailable while an out-of-origin final page is never read or photographed',async()=>{
 const denied=pageSandbox();denied.sandbox.window.binding=value=>denied.values.push(value);
 Object.defineProperty(denied.sandbox.navigator,'serviceWorker',{get(){throw Error('must not serialize detail');}});
 vm.runInNewContext(`(${installControllerObserver.toString()})(${JSON.stringify({bindingName:'binding',cleanupName:'cleanup',origin})})`,denied.sandbox);
 assert.equal(denied.values.length,1);assert.equal(denied.values[0].event,'observer-unavailable');
 assert.ok(!JSON.stringify(denied.values).includes('serialize detail'));
 const foreign=pageSandbox('https://outside.example.test/private'),frame={url:()=>foreign.sandbox.location.href};
 Object.defineProperty(foreign.sandbox.document,'readyState',{get(){throw Error('out-of-scope read');}});
 class Session extends EventEmitter{async send(){return{};}async detach(){}}
 const session=new Session();let shots=0;let page;
 page={mainFrame:()=>frame,exposeBinding:async(name,callback)=>{foreign.sandbox.window[name]=value=>callback({page,frame},value);},addInitScript:async()=>{},
 evaluate:async(fn,args)=>vm.runInNewContext(`(${fn.toString()})(${JSON.stringify(args)})`,foreign.sandbox),screenshot:async()=>{shots++;}};
 const context={newCDPSession:async()=>session};const dir=await fixtureDirectory();
 const info={project:{use:{baseURL:origin}},outputPath:name=>resolve(dir,name),attach:async()=>{}};
 const observer=await observeGraphBoot(context,page,info);await observer.finish(true);
 const proof=JSON.parse(await readFile(resolve(dir,'account-graph-boot-diagnostics.json'),'utf8'));
 assert.equal(shots,0);assert.equal(proof.finalPage.outsideScope,true);assert.equal(proof.finalPage.available,false);
 assert.ok(proof.unavailable.includes('failure-screenshot-outside-scope'));
 assert.ok(!JSON.stringify(proof).includes('outside.example.test'));
});

test('runtime/log metadata ignores exception descriptions, values, stack and raw text',()=>{
 const recorder=new GraphBootRecorder(origin);
 const exception={className:'TypeError'};for(const key of ['description','value','preview'])Object.defineProperty(exception,key,{get(){throw Error('forbidden');}});
 const details={url:`${origin}/assets/index-test.js?credential=canary-credential`,lineNumber:12,columnNumber:3,exception};
 for(const key of ['text','stackTrace'])Object.defineProperty(details,key,{get(){throw Error('forbidden');}});
 recorder.exception({exceptionDetails:details,timestamp:2});
 const entry={source:'worker',level:'error',url:`${origin}/sw.js?credential=canary-credential`,lineNumber:5};
 for(const key of ['text','args','stackTrace'])Object.defineProperty(entry,key,{get(){throw Error('forbidden');}});
 recorder.log({entry});recorder.exception({exceptionDetails:{url:'https://foreign.test/private',exception:{className:'canary-credential'}}});
 recorder.log({entry:{source:'canary-credential',level:'canary-credential',url:`${origin}/api/private`}});
 const events=recorder.snapshot().events;assert.equal(events[0].errorClass,'TypeError');assert.equal(events[0].path,'/assets/index-test.js');
 assert.equal(events[1].source,'worker');assert.equal(events[1].path,'/sw.js');assert.equal(events[2].path,null);
 assert.ok(!JSON.stringify(events).includes('canary-credential'));assert.ok(!JSON.stringify(events).includes('foreign.test'));
});

test('page script/resource/rejection listeners are passive, static-scoped and removed',()=>{
 const state=pageSandbox();state.sandbox.window.binding=value=>state.values.push(value);
 vm.runInNewContext(`(${installControllerObserver.toString()})(${JSON.stringify({bindingName:'binding',cleanupName:'cleanup',origin})})`,state.sandbox);
 const error=state.windowEvents.get('error'),rejection=state.windowEvents.get('unhandledrejection');
 const forbidden=()=>{throw Error('must not prevent default');};
 error({target:{tagName:'SCRIPT',src:`${origin}/assets/test.js?secret=canary-credential`},preventDefault:forbidden});
 error({target:{tagName:'LINK',href:'https://outside.test/assets/a.js'},preventDefault:forbidden});
 error({filename:`${origin}/assets/test.js?secret=canary-credential`,lineno:7,colno:2,error:{name:'SyntaxError',message:'canary-credential'},preventDefault:forbidden});
 rejection({reason:{name:'TypeError',message:'canary-credential'},preventDefault:forbidden});
 rejection({reason:'canary-credential',preventDefault:forbidden});
 const recorder=new GraphBootRecorder(origin);for(const value of state.values.slice(1))recorder.pageError(value);
 const events=recorder.snapshot().events;assert.equal(events.length,4);assert.equal(events[0].path,'/assets/test.js');
 assert.equal(events[1].errorClass,'SyntaxError');assert.equal(events[2].errorClass,'TypeError');assert.equal(events[3].errorClass,'redacted');
 assert.ok(!JSON.stringify(events).includes('canary-credential'));state.sandbox.window.cleanup();assert.equal(state.windowEvents.size,0);
});

const scriptSource=(path,body)=>({path,bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')});
async function runCacheWitness(manifest,match,url=origin){
 return vm.runInNewContext(`(${inspectFailedScriptCache.toString()})(${JSON.stringify({origin,manifest})})`,{
  location:new URL(url),performance,URL,Uint8Array,Promise,Number,Reflect,setTimeout,clearTimeout,crypto:webcrypto,
  caches:{match,put(){throw Error('must not put');},delete(){throw Error('must not delete');},open(){throw Error('must not open');}},
  fetch(){throw Error('must not fetch');}
 });
}

test('failure cache witness hashes only explicitly scoped public scripts without network or mutation',async()=>{
 const paths=[],body='export const synthetic = true;',source=scriptSource('/assets/synthetic.js',body);
 const result=await runCacheWitness([source,scriptSource('/assets/different.js','original'),scriptSource('/assets/missing.js','x')],async url=>{
  paths.push(url);if(url.endsWith('missing.js'))return undefined;
  return new Response(body,{headers:{'content-type':'text/javascript; charset=utf-8'}});
 });
 assert.equal(paths.length,3);assert.ok(paths.every(p=>p.startsWith(`${origin}/assets/`)));
 assert.equal(result.evidence[0].sha256,source.sha256);assert.equal(result.evidence[0].matchesSource,true);
 assert.equal(result.evidence[1].matchesSource,false);assert.equal(result.evidence[2].found,false);
 assert.equal(result.networkResponse,false);assert.equal(result.readonly,true);assert.equal(result.firstCacheMatchOnly,true);
});

test('cache witness rejects foreign/query/business/oversized sources and caps eight paths',async()=>{
 let matches=0;const valid=scriptSource('/assets/test.js','x');
 const invalid=[{...valid,path:'https://outside.test/assets/a.js'},{...valid,path:'/api/private'},
 {...valid,path:'/assets/test.js?secret=canary-credential'},{...valid,bytes:2*1024*1024+1},{...valid,sha256:'canary-credential'}];
 const first=await runCacheWitness(invalid,async()=>{matches++;});assert.equal(matches,0);assert.equal(first.evidence.length,0);
 const foreign=await runCacheWitness([valid],async()=>{matches++;},'https://outside.test');assert.equal(foreign.outsideScope,true);assert.equal(matches,0);
 const bounded=await runCacheWitness(Array.from({length:20},(_,i)=>scriptSource(`/assets/file${i}.js`,'x')),async()=>{matches++;});
 assert.equal(matches,8);assert.equal(bounded.evidence.length,8);
});

test('cache stream byte budget and stalled match total deadline fail closed without delaying original case',async()=>{
 const source=scriptSource('/assets/test.js','x');let canceled=0;
 const budget=await runCacheWitness([source],async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(2*1024*1024+1));},cancel(){canceled++;}})));
 assert.equal(budget.evidence[0].errorCode,'cache-budget');assert.equal(canceled,1);assert.equal(Object.hasOwn(budget.evidence[0],'sha256'),false);
 const started=performance.now();const deadline=await runCacheWitness([source],()=>new Promise(()=>{}));
 assert.equal(deadline.evidence[0].errorCode,'cache-deadline');assert.ok(performance.now()-started<2200);
});

test('source manifest and failed-path selection are bounded public build files only',async()=>{
 const directory=await fixtureDirectory(),assets=resolve(directory,'assets');await mkdir(assets);
 const body='export const synthetic = true;',file=resolve(assets,'test.js');await writeFile(file,body);
 try{
  const manifest=await staticScriptManifest(directory,['/api/private','/assets/../test.js','/assets/test.js?query=x','/assets/test.js','/assets/test.js','/assets/missing.js']);
  assert.deepEqual(manifest,[scriptSource('/assets/test.js',body)]);
  const recorder=new GraphBootRecorder(origin);for(let i=0;i<12;i++){recorder.request(request(String(i),`${origin}/assets/file${i}.js`));recorder.complete({requestId:String(i),errorText:'net::ERR_ABORTED'},true);}
  assert.deepEqual(recorder.failedScriptPaths(),Array.from({length:8},(_,i)=>`/assets/file${11-i}.js`));
 }finally{await unlink(file);await rmdir(assets);}
});

test('cache witness stops before opening another cache match after the aggregate eight MiB limit',async()=>{
 const body='x'.repeat(2*1024*1024);let matches=0;
 const sources=Array.from({length:8},(_,i)=>scriptSource(`/assets/large${i}.js`,body));
 const result=await runCacheWitness(sources,async()=>{matches++;return new Response(body,{headers:{'content-type':'text/javascript'}});});
 assert.equal(matches,4);assert.equal(result.bytesRead,8*1024*1024);assert.equal(result.evidence.length,4);
 assert.ok(result.evidence.every(row=>row.matchesSource));
});
