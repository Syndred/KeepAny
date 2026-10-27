/* Interactive design only. All sample changes stay in memory and reset on reload. */
window.KeepAnySketchFlows = function (env) {
  'use strict';
  const {esc,icon,phones,tasks}=env;
  const words={
    saved:['演示资料已更新','Demo record updated'],preview:['演示预览','Demo preview'],
    add:['新增','Add'],edit:['编辑','Edit'],save:['保存','Save'],cancel:['取消','Cancel'],
    name:['名称','Name'],date:['日期','Date'],notes:['备注','Notes'],status:['状态','Status'],
    amount:['金额','Amount'],currency:['币种','Currency'],type:['类型','Type'],url:['网址','URL'],
    category:['分类','Category'],tags:['标签','Tags'],owner:['关联项目／账号','Related project / account'],
    due:['到期／续费日','Expiry / renewal date'],bought:['购买日期','Purchase date'],
    price:['购入金额','Purchase price'],cycle:['账期','Billing cycle'],month:['每月','Monthly'],year:['每年','Yearly'],
    username:['登录标识','Login identifier'],password:['密码','Password'],aliases:['附加标识','Additional identifiers'],
    login:['登录资料','Login details'],credentialSaved:['本组登录资料已更新','This login group was updated'],
    required:['请填写名称；金额须为非负数。','Enter a name and a non-negative amount.'],
    delete:['移入回收站','Move to trash'],confirm:['确认移除','Confirm removal'],
    deleteHint:['只移除当前记录；关联对象保留。','Only this record is removed. Connected records are kept.'],
    restore:['恢复','Restore'],remove:['彻底删除','Delete permanently'],empty:['暂无记录','No records yet'],
    action:['操作','Action'],history:['历史记录','History'],record:['添加记录','Add record'],
    noteOnly:['以下为本机台账，不会操作第三方服务。','These are local records; third-party services are not changed.'],
    expense:['支出','Expense'],topup:['充值','Top-up'],refund:['退款','Refund'],balance:['余额','Balance'],
    active:['使用中','Active'],paused:['暂停','Paused'],cancelled:['已取消','Cancelled'],
    itemActive:['使用中','In use'],loaned:['借出','On loan'],returned:['已归还','Returned'],repair:['维修中','Repair'],
    planned:['计划中','Planned'],submitted:['已提交','Submitted'],verify:['待核验','To verify'],indexed:['已收录','Indexed'],
    evidence:['证据／收据','Evidence / receipt'],borrower:['借用人','Borrower'],returnDate:['归还期限','Return date'],
    source:['来源','Source'],checked:['最近核验日','Last reviewed'],direction:['关系方向／用途','Direction / purpose'],
    relationship:['关联关系','Connections'],linked:['已关联','Linked'],unlink:['解除关联','Unlink'],
    newTask:['新增待办','Add task'],pending:['待处理','Pending'],done:['已完成','Done'],all:['全部','All'],
    repeat:['周期','Repeat'],none:['不重复','Does not repeat'],week:['每周','Weekly'],
    capture:['粘贴本次资料','Paste this capture'],sample:['填入示例','Use sample'],review:['预览并审核','Preview & review'],
    choose:['选择要保存的候选','Choose candidates to save'],duplicate:['同名候选：保留已有资料','Matching name: keep existing record'],
    apply:['确认保存所选','Save selected'],applied:['所选候选已加入资产','Selected candidates added to assets'],
    missingInput:['请先输入本次资料。','Enter the capture first.'],
    passwordBoundary:['含密码的内容请使用独立密码导入。','Use the separate password import for content containing passwords.'],
    fileDemo:['选择示例文件','Choose sample file'],sampleFile:['sample-notes.txt · 演示文件','sample-notes.txt · demo file'],
    importScope:['仅导入本次选中内容','Import only the selected content'],
    backupPassword:['备份密码','Backup password'],backupConfirm:['再次输入密码','Confirm password'],
    passwordMismatch:['两次密码须一致且至少8位。','Passwords must match and have at least 8 characters.'],
    backupReady:['加密备份流程预览完成','Encrypted backup flow preview complete'],
    backupHint:['正式应用会生成加密 .ka1 文件；此草图不创建文件。','The app will create an encrypted .ka1 file; this sketch creates no file.'],
    restoreHint:['此处使用示例备份；原资料保留，恢复后密码仍锁定。','Uses a sample backup. Original data is kept and restored logins remain locked.'],
    restorePassword:['输入示例备份密码 demo2026','Enter sample backup password demo2026'],
    wrongPassword:['密码不正确，尚未写入任何资料。','Wrong password. No data was written.'],
    restoreRange:['4项资产 · 3个账号 · 2张原图 · 加密登录资料','4 assets · 3 accounts · 2 images · encrypted logins'],
    restored:['演示恢复完成，登录资料保持锁定','Demo restore complete. Login details stay locked'],
    retry:['重试','Retry'],interrupted:['恢复已中断','Restore interrupted'],
    interruptedHint:['已保存进度；继续恢复或保留当前资料。','Progress is kept. Resume or keep the current library.'],
    resume:['继续恢复','Resume restore'],keep:['保留当前资料','Keep current library'],
    provider:['模型提供方','Model provider'],endpoint:['服务地址','Service URL'],model:['模型','Model'],
    question:['问题','Question'],ask:['预览发送范围','Preview sending scope'],
    aiBoundary:['只发送主动勾选的普通资料；不包含密码和私密备注。','Only selected ordinary records are included; passwords and private notes are excluded.'],
    aiSend:['确认范围并查看示例结果','Confirm scope & see sample result'],
    aiResult:['网站托管将在7天后续费。可核对账期，再决定是否建立提醒。','Website hosting renews in 7 days. Review billing before adding a reminder.'],
    aiExample:['示例回答，未调用模型','Sample answer; no model was called'],
    setupNeeded:['先填写地址、模型、问题并选择资料。','Enter a URL, model and question, and select records.'],
    smartScope:['本次粘贴全文（可能包含密码）','Full pasted content (may contain passwords)'],
    smartBoundary:['发送前核对模型、地址和本次全文。不会读取已有密码库或主密码。','Review the model, URL and pasted text before sending. Existing vaults and master passwords are excluded.'],
    smartConfirm:['确认本次全文范围','Confirm this pasted text'],
    notConnected:['尚未连接','Not connected'],local:['本地保存','Saved locally'],pendingSync:['待同步','Pending sync'],
    conflict:['同步冲突','Sync conflict'],syncFailure:['同步失败','Sync failed'],
    localVersion:['保留本机版本','Keep local version'],remoteVersion:['采用远端示例版本','Use sample remote version'],
    syncBoundary:['连接器为实验能力；此处仅预览配置与状态。','Connectors are experimental; this only previews settings and states.'],
    syncState:['同步状态预览','Sync state preview'],connection:['连接配置','Connection settings'],
    readOnly:['只读','Read only'],writeApproval:['每次写入前批准','Approve each write'],revoke:['撤销授权','Revoke access'],
    request:['查看示例写入请求','View sample write request'],approve:['批准这次写入','Approve this write'],reject:['拒绝','Reject'],
    requestDetail:['助手请求新增一条维护待办：核对续费日期。','The assistant requests one task: review the renewal date.'],
    master:['当前主密码','Current master password'],newMaster:['新主密码','New master password'],
    masterHint:['此草图仅演示修改流程，不读取或更改真实密码库。','This sketch only demonstrates the flow; no real vault is read or changed.'],
    idle:['自动锁定','Auto-lock'],five:['5分钟','5 minutes'],one:['1分钟','1 minute'],fifteen:['15分钟','15 minutes'],
    permission:['提醒方式','Reminder delivery'],inApp:['应用内提醒','In-app reminders'],push:['关页推送尚未开放','Closed-app push is not available'],
    title:['标题','Title'],restoreHistory:['保留原ID与历史','Keep original IDs & history'],
    draft:['未保存的演示草稿','Unsaved demo draft'],reviewed:['已核对','Reviewed'],
    rename:['项目改名核对','Project rename review'],closeProject:['项目收尾','Project closing'],
    checkMail:['核对联系邮箱','Review contact email'],checkDomain:['核对域名指向','Review domain target'],
    checkSub:['核对订阅处理','Review subscriptions'],later:['稍后处理','Do later'],blocked:['受阻','Blocked'],na:['不适用','Not applicable'],
    restoreLogin:['密码回收站需先解锁','Unlock before viewing login trash'],
    demoCopy:['复制交互已演示，未写入剪贴板','Copy interaction previewed; clipboard unchanged'],
    addAsset:['新增资产','Add asset'],addAccount:['新增账号','Add account'],loginHistory:['登录资料历史','Login history'],
    credentialSeparate:['登录资料可在账号详情中逐组编辑。','Edit each login group inside the account details.'],
    v3Title:['手机端 · 完整交互草图','Mobile · Full interaction sketch'],
    v3Note:['交互草图 · 虚构资料，刷新重置。保存、解锁、导入、备份及AI均为演示。','Interactive sketch · Fictional data resets on reload. Save, unlock, import, backup and AI are demonstrations.']
  };
  const T=k=>words[k]?.[env.lang()==='en'?1:0]||env.t(k);
  const button=(k,a,primary=false)=>`<button type="button" class="action ${primary?'primary':''} full" data-action="flow:${a}">${esc(T(k))}</button>`;
  const field=(key,value='',type='text',options=null)=>`<div class="form-group"><label class="form-label">${esc(T(key))}${options?`<select class="form-input" name="${key}">${options.map(([v,k])=>`<option value="${v}" ${String(v)===String(value)?'selected':''}>${esc(T(k))}</option>`).join('')}</select>`:`<${type==='textarea'?'textarea':'input'} class="form-input" name="${key}" ${type==='textarea'?'rows="4"':`type="${type}" value="${esc(value)}"`} autocomplete="off" ${type==='number'?'min="0" step="0.01"':''}>${type==='textarea'?esc(value)+'</textarea>':''}`}</label></div>`;
  const check=(key,name='selected',value='one',on=true)=>`<label class="flow-check"><input type="checkbox" name="${name}" value="${value}" ${on?'checked':''}><span>${esc(T(key))}</span></label>`;
  const form=(kind,body,submit='save')=>`<form data-flow-form="${kind}"><div class="flow-fields">${body}</div><p class="form-error" role="alert"></p><button type="submit" class="action primary full">${esc(T(submit))}</button></form>`;
  const card=s=>`<div class="card pad">${s}</div>`;
  const hint=k=>`<p class="sub">${esc(T(k))}</p>`;
  const saved=()=>`<div class="notice"><div><strong>${esc(T('saved'))}</strong></div></div>`;
  const listRow=(name,sub,a)=>`<button type="button" class="menu-row" data-action="flow:${a}">${icon('NotebookPen')}<div><strong>${esc(name)}</strong><span class="sub">${esc(sub)}</span></div>${icon('ChevronRight')}</button>`;
  const db={assets:[],deleted:[],ledger:[{name:'Website hosting',amount:'98',currency:'CNY',type:'expense',date:'2026-10-03'},{name:'WriteDesk',amount:'12',currency:'USD',type:'expense',date:'2026-10-12'}],collections:[{name:'Forest Notes',notes:'Project / account / plan / item'}],categories:[{name:'Work',tags:'Personal, Essential'}],references:[{name:'External vault reference',url:'https://example.com/vault',notes:'Reference only'}],graph:[{name:'Work email → Website hosting',direction:'Login',source:'Manual review',checked:'2026-10-27'}],backlinks:[{name:'Example Directory',url:'https://directory.example',status:'verify',date:'2026-10-20',evidence:'Manual receipt'}],promo:[{name:'Forest Notes',url:'https://forestnotes.example',notes:'Personal writing and ideas'}],borrow:[{name:'Work laptop',borrower:'Alex',returnDate:'2026-11-05',status:'loaned'}],maintenance:[{name:'Device inspection',date:'2026-10-20',notes:'Battery and storage checked'}],receipts:[{name:'Purchase receipt',date:'2024-05-10',notes:'Original image · demo'}],repeat:[{name:'Review domain renewal',date:'2026-11-01',repeat:'month'}],notes:[{name:'Maintenance notes',notes:'Review once a month.'}],history:[{name:'Primary login updated',date:'2026-10-24',notes:'••••••••••••'}],taskHistory:[]};
  const edits=new Map(),loginEdits=new Map(),pendingLogins=new Map(),taskLog=[],workflow={};
  let serial=0,aiConfig={endpoint:'https://api.example.com/v1',model:'demo-model'},syncMode='local';
  const moduleNames=['collections','categories','references','graph','backlinks','promo','borrow','maintenance','receipts','repeat','notes','history','taskHistory'];
  function recordFields(key,r={}) {
    let s=field('name',r.name||'');
    if(['backlinks','promo','references'].includes(key))s+=field('url',r.url||'https://example.com','url');
    if(key==='graph')s+=field('direction',r.direction||'')+field('source',r.source||'')+field('checked',r.checked||'2026-10-27','date');
    if(key==='borrow')s+=field('borrower',r.borrower||'')+field('returnDate',r.returnDate||'2026-11-05','date')+field('status',r.status||'loaned','text',[['loaned','loaned'],['returned','returned']]);
    if(key==='backlinks')s+=field('status',r.status||'planned','text',['planned','submitted','verify','indexed'].map(x=>[x,x]))+field('evidence',r.evidence||'');
    if(['maintenance','backlinks','receipts','repeat'].includes(key))s+=field('date',r.date||'2026-10-27','date');
    if(key==='categories')s+=field('tags',r.tags||'');
    if(key==='repeat')s+=field('repeat',r.repeat||'month','text',[['week','week'],['month','month'],['year','year']]);
    if(key==='collections')s+=check('project','members','project',(r.members||['project']).includes('project'))+check('account','members','account',(r.members||['account']).includes('account'))+check('subscription','members','subscription',(r.members||['subscription']).includes('subscription'))+check('item','members','item',(r.members||['item']).includes('item'));
    return s+field('notes',r.notes||'','textarea');
  }
  function overviewRecords(p,key){const data=key==='taskHistory'?taskLog:db[key]||[];return `<h1>${esc(env.t(key))}</h1>${key==='history'&&!env.unlocked()?hint('restoreLogin')+button('unlock','unlock'):card(data.length?data.map((r,i)=>listRow(r.name,[r.date,r.status?T(r.status):'',r.amount?`${r.currency} ${r.amount}`:'',r.notes].filter(Boolean).join(' · '),`record:${key}:${i}`)).join(''):hint('empty'))}${!['history','taskHistory'].includes(key)?button('record',`record:${key}:new`,true):''}${['graph','backlinks','borrow'].includes(key)?hint('noteOnly'):''}${key==='graph'?`<div class="card">${env.menuRow('Folder','forest','','asset:project')}${env.menuRow('KeyRound','workmail','','account:workmail')}${env.menuRow('CreditCard','hosting','','asset:hosting-sub')}</div>`:''}`;}
  function moduleView(p){const key=p.module;
    if(moduleNames.includes(key))return overviewRecords(p,key);
    if(key==='linkReview')return `<h1>${esc(env.t(key))}</h1>${hint('restoreLogin')}${env.unlocked()?card(listRow(env.t('vaultOnly'),env.t('hosting'),'link-choice')):button('unlock','unlock')}`;
    if(key==='projectWorkflows'||key==='changeImpact')return `<h1>${esc(env.t(key))}</h1>${hint('noteOnly')}<div class="filter-tabs">${['rename','closeProject'].map(k=>`<button data-action="flow:workflow-tab:${k}" class="${(p.workflowTab||'rename')===k?'active':''}">${esc(T(k))}</button>`).join('')}</div>${card(['checkMail','checkDomain','checkSub'].map((k,i)=>`<div class="field-row"><div><strong>${esc(T(k))}</strong><p class="sub">${esc(T(workflow[(p.workflowTab||'rename')+i]||'pending'))}</p></div><select class="form-input workflow-select" data-flow-work="${(p.workflowTab||'rename')+i}">${['pending','done','blocked','na'].map(x=>`<option value="${x}" ${workflow[(p.workflowTab||'rename')+i]===x?'selected':''}>${esc(T(x))}</option>`).join('')}</select></div>`).join(''))}`;
    if(key==='costs')return `<h1>${esc(env.t(key))}</h1>${hint('noteOnly')}<div class="filter-tabs">${['expense','topup','refund','balance'].map(k=>`<button type="button" class="${(p.ledgerType||'expense')===k?'active':''}" data-action="flow:ledger-tab:${k}">${esc(T(k))}</button>`).join('')}</div>${card(db.ledger.filter(r=>r.type===(p.ledgerType||'expense')).map(r=>listRow(r.name,`${r.currency} ${r.amount} · ${r.date}`,`ledger-edit:${db.ledger.indexOf(r)}`)).join('')||hint('empty'))}${button('record','ledger-new',true)}`;
    if(key==='ai')return `<h1>${esc(env.t(key))}</h1>${hint('aiBoundary')}${form('ai',field('endpoint',aiConfig.endpoint,'url')+field('model',aiConfig.model)+check('project','asset','project')+check('subscription','asset','hosting-sub')+field('question',p.aiQuestion||'','textarea'),'ask')}`;
    if(['settings','assistant'].includes(key))return `<h1>${esc(env.t(key))}</h1>${hint('syncBoundary')}${card(listRow(T('connection'),T('notConnected'),'connection')+listRow(T('syncState'),T(syncMode),'sync-state')+listRow(T('permission'),T('inApp'),'reminders'))}${key==='assistant'?card(listRow(T('writeApproval'),T(p.revoked?'notConnected':'readOnly'),'assistant-scope'))+button('request','assistant-request'):''}${button('language','language')}`;
    if(key==='trash')return `<h1>${esc(env.t(key))}</h1><div class="filter-tabs"><button data-action="flow:trash-tab:ordinary" class="${p.trashTab!=='login'?'active':''}">${esc(env.t('ordinaryTrash'))}</button><button data-action="flow:trash-tab:login" class="${p.trashTab==='login'?'active':''}">${esc(env.t('loginTrash'))}</button></div>${p.trashTab==='login'&&!env.unlocked()?hint('restoreLogin')+button('unlock','unlock'):card(db.deleted.filter(r=>p.trashTab==='login'?r.scope==='login':r.scope!=='login').map((r)=>listRow(r.name,T('restoreHistory'),`trash-item:${db.deleted.indexOf(r)}`)).join('')||hint('empty'))}`;
    return null;
  }
  function sheet(p){const key=p.modal;
    if(key.startsWith('flow:'))return customSheet(p,key.slice(5));
    if(['project','domain','subscription','item','edit','domainEdit'].includes(key))return assetSheet(p,key==='edit'?p.page:key,key!=='edit'&&key!=='domainEdit');
    if(key==='edit-login')return {title:'login',body:env.unlocked()?form('login',field('username',loginEdits.get(p.account+':'+(p.loginIndex||0))?.username||'hello@example.com')+field('password',loginEdits.get(p.account+':'+(p.loginIndex||0))?.password||'Forest-Demo-2026!','password')+field('aliases','secondary@example.com')+button('generate','generate')):hint('restoreLogin')+button('unlock','unlock')};
    if(key==='cancelPlan')return {title:key,body:hint('noteOnly')+form('cancel-plan',field('status','cancelled','text',[['active','active'],['paused','paused'],['cancelled','cancelled']])+field('date','2026-10-27','date')+field('notes','','textarea'))};
    if(['record','renewRecord'].includes(key))return ledgerSheet(p);
    if(key==='taskAdd')return {title:'newTask',body:form('task',field('name')+field('date','2026-11-03','date')+field('owner',env.t('forest'))+field('repeat','none','text',[['none','none'],['week','week'],['month','month']]))};
    if(['paste','url','csv','image','pdf','smartImport','review','importRange','importVault','exportVault'].includes(key))return captureSheet(p,key);
    if(['makeBackup','restore','restoreScope'].includes(key))return backupSheet(p,key);
    if(key==='changeMaster')return {title:'changeMaster',body:hint('masterHint')+form('master',field('master','','password')+field('newMaster','','password')+field('backupConfirm','','password'))};
    if(key==='idleLock')return {title:key,body:form('idle',field('idle','five','text',[['one','one'],['five','five'],['fifteen','fifteen']]))};
    if(['ordinaryTrash','loginTrash'].includes(key)){p.trashTab=key==='loginTrash'?'login':'ordinary';p.modal=null;p.page='module';p.module='trash';return null;}
    return null;
  }
  function assetSheet(p,kind,isNew){if(kind==='domainEdit')kind='domain';p.assetKind=kind;p.assetNew=isNew;const old=edits.get(p.asset||kind)||{},name=kind==='domain'?'forestnotes.example':env.t(({project:'forest',subscription:'hosting',item:'laptop'})[kind]||'forest');return {title:isNew?'addAsset':'edit',body:form('asset',field('name',isNew?'':old.name||name)+field('category',old.category||'Work')+field('tags',old.tags||'Essential')+(['project','domain','subscription'].includes(kind)?field('url',old.url||'https://example.com','url'):'')+(kind==='item'?field('bought',old.bought||'2024-05-10','date')+field('price',old.price||'12999','number'):field('due',old.due||'2026-12-25','date'))+(kind==='subscription'?field('amount',old.amount||'98','number')+field('currency',old.currency||'CNY','text',[['CNY','CNY'],['USD','USD']])+field('cycle',old.cycle||'month','text',[['month','month'],['year','year']]):'')+field('notes',old.notes||'','textarea'))+(!isNew?button('delete','asset-delete'):'')};}
  function ledgerSheet(p){const r=p.editLedger!=null?db.ledger[p.editLedger]:{};return {title:'record',body:form('ledger',field('name',r?.name||env.t('hosting'))+field('type',r?.type||p.ledgerType||'expense','text',['expense','topup','refund','balance'].map(x=>[x,x]))+field('amount',r?.amount||'98','number')+field('currency',r?.currency||'CNY','text',[['CNY','CNY'],['USD','USD']])+field('date',r?.date||'2026-10-27','date')+field('owner',env.t('forest')))+ (p.editLedger!=null?button('delete','ledger-delete'):'')};}
  function captureSheet(p,key){
    if(key==='exportVault')return {title:key,body:hint('masterHint')+button('preview','success')};
    if(key==='review'||key==='importRange')return p.capturePrivate?{title:'review',body:hint('importScope')+card(env.t('hosting'))+form('private-apply',check('login','candidate','login')+field('username','hello@example.com')+field('password','Demo-Imported-2026!','password')+hint('smartBoundary'),'apply')}:{title:'review',body:hint('importScope')+form('capture-apply',check('project','candidate','project')+check('subscription','candidate','subscription')+hint('duplicate'),'apply')};
    p.capturePrivate=['smartImport','importVault'].includes(key);
    return {title:key,body:hint(key==='smartImport'?'smartBoundary':'passwordBoundary')+form('capture',field('capture',p.capture||'','textarea')+(['csv','image','pdf','importVault'].includes(key)?button('fileDemo','capture-sample'):button('sample','capture-sample'))+(key==='smartImport'?field('endpoint',aiConfig.endpoint,'url')+field('model',aiConfig.model)+check('smartScope','consent','yes',false):''),'review')};
  }
  function backupSheet(p,key){
    if(key==='makeBackup')return {title:key,body:hint('backupHint')+form('backup',field('backupPassword','','password')+field('backupConfirm','','password'))};
    if(key==='restoreScope')return {title:key,body:hint('restoreHint')+card(esc(T('restoreRange')))+button('restore','restore-run',true)+button('interrupted','restore-interrupt')};
    return {title:key,body:hint('restoreHint')+card('keepany-2026-10-27.ka1')+form('restore',field('backupPassword','demo2026','password'),'review')};
  }
  function customSheet(p,key){
    if(key==='record'){const list=db[p.recordKey]||[],r=p.recordIndex==='new'?{}:list[Number(p.recordIndex)];return {title:p.recordKey,body:form('record',recordFields(p.recordKey,r))+(p.recordIndex!=='new'?button('delete','record-delete'):'')};}
    if(key==='confirm-delete')return {title:'delete',body:hint('deleteHint')+button('confirm','delete-confirm',true)+button('cancel','close')};
    if(key==='success')return {title:'preview',body:saved()+button('close','close')};
    if(key==='backup-ready')return {title:'backupReady',body:card('keepany-2026-10-27.ka1')+hint('backupHint')+button('close','close')};
    if(key==='interrupted')return {title:'interrupted',body:hint('interruptedHint')+button('resume','restore-run',true)+button('keep','close')};
    if(key==='restore-done')return {title:'restored',body:hint('restoreHistory')+button('close','close')};
    if(key==='ai-scope')return {title:'ask',body:card(`${esc(aiConfig.endpoint)}<br>${esc(aiConfig.model)}`)+hint('aiBoundary')+card(esc(p.aiQuestion||''))+button('aiSend','ai-result',true)};
    if(key==='ai-result')return {title:'aiExample',body:card(esc(T('aiResult')))+button('newTask','task-add',true)};
    if(key==='smart-scope')return {title:'smartConfirm',body:card(`${esc(aiConfig.endpoint)}<br>${esc(aiConfig.model)}`)+hint('smartBoundary')+card(esc(p.capture||''))+button('smartConfirm','capture-review',true)};
    if(key==='connection')return {title:'connection',body:hint('syncBoundary')+form('connection',field('endpoint','https://sync.example.com','url')+field('owner','Demo workspace'))};
    if(key==='sync-state')return {title:'syncState',body:hint('syncBoundary')+['local','pendingSync','conflict','syncFailure'].map(k=>button(k,`sync:${k}`)).join('')};
    if(key==='conflict')return {title:'conflict',body:card('Forest Notes · local / remote')+button('localVersion','sync:local')+button('remoteVersion','sync:pendingSync')};
    if(key==='syncFailure')return {title:'syncFailure',body:hint('syncBoundary')+button('retry','sync:pendingSync',true)};
    if(key==='reminders')return {title:'permission',body:form('reminders',check('inApp')+hint('push'))};
    if(key==='assistant-scope')return {title:'assistant',body:form('assistant',check('readOnly')+check('writeApproval'))+button('revoke','revoke')};
    if(key==='assistant-request')return {title:'writeApproval',body:p.revoked?hint('notConnected')+button('close','close'):hint('requestDetail')+button('approve','assistant-approve',true)+button('reject','close')};
    if(key==='trash-item')return {title:'trash',body:card(esc(db.deleted[p.trashIndex]?.name||''))+button('restore','trash-restore',true)+button('remove','trash-remove')};
    if(key==='link-choice')return {title:'linkReview',body:card(env.t('vaultOnly'))+form('link',field('owner',env.t('hosting')))};
    return null;
  }
  function handle(i,a){const p=phones[i];
    if(['panel:smartImport','panel:importVault'].includes(a)&&!env.unlocked()){p.afterUnlockModal=a.slice(6);p.modal='unlock';env.render();return true;}
    if(a==='new'&&p.page==='module'){if(p.module==='costs')a='flow:ledger-new';else if(moduleNames.includes(p.module))a=`flow:record:${p.module}:new`;else return false;}
    if(a==='new'&&p.page==='tasks')a='flow:task-add';
    if(a==='module:edit'){p.modal='edit';env.render();return true;}
    if(a==='module:domainEdit'){p.modal='domainEdit';env.render();return true;}
    if(a.startsWith('module:')&&['taskAdd','cancelPlan','renewRecord'].includes(a.slice(7))){p.modal=a.slice(7);env.render();return true;}
    if(a==='retry-login'){const key=p.account+':'+(p.loginIndex||0);if(pendingLogins.has(key)){loginEdits.set(key,pendingLogins.get(key));pendingLogins.delete(key);}p.partial=false;env.render();return true;}
    if(a==='copy'){env.toast(i,'demoCopy');return true;}
    if(a==='close'){p.modal=null;env.render();return true;}
    if(a.startsWith('task:')){const task=tasks[Number(a.slice(5))];taskLog.unshift({name:task.label||env.t(task.key),date:'2026-10-27',notes:T(task.done?'pending':'done')});return false;}
    if(!a.startsWith('flow:'))return false;
    const action=a.slice(5),[kind,x,y]=action.split(':');
    if(kind==='record'){p.recordKey=x;p.recordIndex=y;p.modal='flow:record';}
    else if(kind==='ledger-new'||kind==='ledger-edit'){p.editLedger=kind==='ledger-new'?null:Number(x);p.modal='record';}
    else if(kind==='ledger-tab'){p.ledgerType=x;p.modal=null;}
    else if(kind==='task-add')p.modal='taskAdd';
    else if(kind==='workflow-tab'){p.workflowTab=x;p.modal=null;}
    else if(kind==='asset-edit')p.modal='edit';
    else if(['asset-delete','record-delete','ledger-delete','trash-remove'].includes(kind)){p.deleteKind=kind;p.modal='flow:confirm-delete';}
    else if(kind==='delete-confirm'){
      if(p.deleteKind==='record-delete'){const row=db[p.recordKey].splice(Number(p.recordIndex),1)[0];db.deleted.push({...row,scope:p.recordKey});}
      if(p.deleteKind==='ledger-delete'){const row=db.ledger.splice(p.editLedger,1)[0];db.deleted.push({...row,scope:'ledger'});}
      if(p.deleteKind==='asset-delete'){const id=p.asset||p.page;db.deleted.push({name:edits.get(id)?.name||env.t(id==='item'?'laptop':'forest'),scope:'assets',id});env.hideAsset(id);p.page='assets';}
      if(p.deleteKind==='trash-remove')db.deleted.splice(p.trashIndex,1);
      p.modal=null;
    }
    else if(kind==='capture-sample'){p.capture='Forest Notes · https://forestnotes.example\nWebsite hosting · CNY 98 / month';const input=document.querySelector(`[data-device="${i}"] [name="capture"]`);if(input)input.value=p.capture;return true;}
    else if(kind==='capture-review')p.modal='review';
    else if(kind==='restore-run'){env.lock();p.modal='flow:restore-done';}
    else if(kind==='restore-interrupt')p.modal='flow:interrupted';
    else if(kind==='sync'){syncMode=x;p.modal=['conflict','syncFailure'].includes(x)?'flow:'+x:'flow:success';}
    else if(kind==='trash-tab'){p.trashTab=x;p.modal=null;}
    else if(kind==='trash-item'){p.trashIndex=Number(x);p.modal='flow:trash-item';}
    else if(kind==='trash-restore'){const row=db.deleted.splice(p.trashIndex,1)[0];if(row?.scope==='assets')env.showAsset(row.id);else if(row&&['account','login'].includes(row.scope))env.restoreDeleted(row);else if(row&&db[row.scope])db[row.scope].push(row);p.modal=null;}
    else if(kind==='assistant-approve'){tasks.push({label:T('checkSub'),done:false});p.modal='flow:success';}
    else if(kind==='revoke'){p.revoked=true;p.modal='flow:success';}
    else if(['language','unlock','generate'].includes(kind)){env.handle(i,kind);return true;}
    else if(kind==='close')p.modal=null;
    else p.modal='flow:'+action;
    env.render();return true;
  }
  function submit(formEl,i){const kind=formEl.dataset.flowForm;if(!kind)return false;const p=phones[i],d=Object.fromEntries(new FormData(formEl)),fail=k=>{formEl.querySelector('[role="alert"]').textContent=T(k);};
    if(['asset','ledger','task','record'].includes(kind)&&(!d.name?.trim()||d.amount!==undefined&&(!Number.isFinite(Number(d.amount))||Number(d.amount)<0))){fail('required');return true;}
    if(kind==='asset'){const id=p.assetNew?'sample-'+(++serial):p.asset||p.page;edits.set(id,d);if(p.assetNew)db.assets.push({id,kind:p.assetKind,name:d.name,meta:d.tags,main:d.due||d.bought||'',side:T('local'),foot:d.amount?`${d.currency} ${d.amount}`:'',icon:p.assetKind==='item'?'Package':'Folder'});p.page='assets';p.modal=null;env.setPopulated();}
    else if(kind==='ledger'){if(p.editLedger!=null)db.ledger[p.editLedger]=d;else db.ledger.push(d);p.module='costs';p.page='module';p.ledgerType=d.type;p.modal=null;}
    else if(kind==='record'){if(p.recordKey==='collections')d.members=new FormData(formEl).getAll('members');if(p.recordIndex==='new')db[p.recordKey].push(d);else db[p.recordKey][Number(p.recordIndex)]=d;p.modal=null;}
    else if(kind==='task'){tasks.push({label:d.name,done:false,date:d.date});p.page='tasks';p.modal=null;}
    else if(kind==='login'){const key=p.account+':'+(p.loginIndex||0);p.partial=env.state()==='partial';(p.partial?pendingLogins:loginEdits).set(key,d);p.modal=null;env.ensureLogin(p.account);}
    else if(kind==='cancel-plan'){edits.set(p.asset||'hosting-sub',{...edits.get(p.asset||'hosting-sub'),...d,name:edits.get(p.asset||'hosting-sub')?.name||env.t('hosting')});p.modal=null;}
    else if(kind==='capture'){if(!d.capture?.trim()){fail('missingInput');return true;}p.capture=d.capture;if(p.modal==='smartImport'){if(!d.consent){fail('smartBoundary');return true;}aiConfig={endpoint:d.endpoint,model:d.model};p.modal='flow:smart-scope';}else p.modal='review';}
    else if(kind==='capture-apply'){for(const value of new FormData(formEl).getAll('candidate')){const id='import-'+value;if(!db.assets.some(x=>x.id===id))db.assets.push({id,kind:value,name:env.t(value==='project'?'forest':'hosting')+' · '+T('reviewed'),meta:T('reviewed'),main:T('local'),side:T('local'),foot:'',icon:'Folder'});}p.modal=null;p.page='assets';env.setPopulated();}
    else if(kind==='private-apply'){if(!env.unlocked()){p.modal='unlock';p.afterUnlockModal='review';}else if(d.candidate){p.account='hosting';p.loginIndex=0;loginEdits.set('hosting:0',{username:d.username,password:d.password});env.ensureLogin('hosting');p.page='account';p.modal=null;}else p.modal=null;}
    else if(kind==='backup'){if(d.backupPassword.length<8||d.backupPassword!==d.backupConfirm){fail('passwordMismatch');return true;}p.modal='flow:backup-ready';}
    else if(kind==='restore'){if(d.backupPassword!=='demo2026'){fail('wrongPassword');return true;}p.modal='restoreScope';}
    else if(kind==='ai'){if(!d.endpoint||!d.model||!d.question||!d.asset){fail('setupNeeded');return true;}aiConfig={endpoint:d.endpoint,model:d.model};p.aiQuestion=d.question;p.modal='flow:ai-scope';}
    else if(kind==='master'){if(!d.master||d.newMaster.length<8||d.newMaster!==d.backupConfirm){fail('passwordMismatch');return true;}p.modal='flow:success';}
    else p.modal='flow:success';
    env.render();return true;
  }
  document.addEventListener('change',e=>{const key=e.target.dataset.flowWork;if(key){workflow[key]=e.target.value;env.render();}});
  return {T,moduleView,sheet,handle,submit,edits,loginEdits,addedAssets:()=>db.assets,assetSheet,addDeleted:r=>db.deleted.push(r)};
};
