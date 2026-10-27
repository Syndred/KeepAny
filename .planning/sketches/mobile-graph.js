/* Design-only graph. Uses the same in-memory relation records as its editor and trash. */
window.KeepAnySketchGraph=function(env){
  'use strict';
  const {esc,icon}=env;
  const words={title:['关联图','Relationship map'],open:['打开关联图','Open relationship map'],
    root:['当前资料','Current record'],all:['全部关系','All connections'],verified:['已核验','Verified'],pending:['待核验','To review'],
    search:['搜索节点或关系','Search records or connections'],status:['核验状态','Review status'],
    zoomIn:['放大','Zoom in'],zoomOut:['缩小','Zoom out'],fit:['适应全图','Fit map'],focus:['回到当前资料','Focus current record'],
    expand:['展开关联图','Expand map'],collapse:['收起关联图','Collapse map'],close:['关闭','Close'],
    help:['拖动画布移动，点节点查看资料，点连线核对关系。','Drag to pan. Select a record to open it, or a line to review its connection.'],
    records:['关系记录','Connection records'],add:['添加关系','Add connection'],edit:['编辑关系','Edit connection'],
    delete:['移除这条关系','Remove this connection'],source:['来源','Source'],checked:['最近核验日','Last reviewed'],
    from:['起点资料','From record'],to:['终点资料','To record'],label:['关系用途','Purpose'],
    view:['查看资料','Open record'],center:['以此为当前资料','Use as current record'],none:['没有匹配的关系','No matching connections'],
    empty:['当前没有关联关系','No connections yet'],login:['登录邮箱','Login email'],manage:['维护账号','Maintenance account'],
    usedBy:['使用账号','Uses account'],owns:['所属项目','Parent project'],manual:['手工核对','Manually reviewed'],
    legend:['实线：已核验 · 虚线：待核验','Solid: verified · Dashed: to review'],
    invalid:['起点和终点不能相同。','Choose two different records.'],phone:['联系手机','Contact phone'],
    total:['条关系','connections'],more:['查看关系记录','View connection records']};
  const T=k=>words[k]?.[env.lang()==='en'?1:0]||env.t(k);
  const nodes=()=>[
    {id:'hosting',key:'hosting',kind:'account',icon:'HardDrive',x:180,y:240},
    {id:'workmail',key:'workmail',kind:'account',icon:'KeyRound',x:88,y:80},
    {id:'project',key:'forest',kind:'project',icon:'Folder',x:272,y:80},
    {id:'registrar',key:'registrar',kind:'account',icon:'Globe',x:88,y:400},
    {id:'hosting-sub',key:'hosting',kind:'subscription',icon:'CreditCard',x:272,y:400}];
  const node=id=>nodes().find(x=>x.id===id),name=id=>id==='hosting-sub'?env.t('hosting')+' · '+env.t('subscription'):env.t(node(id)?.key||id);
  const button=(k,a,cls='')=>`<button type="button" class="${cls}" data-action="graph:${a}" aria-label="${esc(T(k))}" title="${esc(T(k))}">${esc(T(k))}</button>`;
  function state(p){return p.graphState||(p.graphState={scale:1,x:0,y:0,query:'',status:'all',selected:null,expanded:false});}
  const edgeName=r=>r.labelKey?T(r.labelKey):r.direction||r.name;
  function edges(p){const s=state(p);return env.records().map((r,index)=>({...r,index,from:r.from||'workmail',to:r.to||'hosting'})).filter(r=>(s.status==='all'||(s.status==='verified'?!!r.checked:!r.checked))&&[name(r.from),name(r.to),edgeName(r)].join(' ').toLowerCase().includes(s.query.toLowerCase()));}
  function transform(p){const s=state(p);return `translate(${180+s.x} ${240+s.y}) scale(${s.scale}) translate(-180 -240)`;}
  function canvas(p,mini=false){
    const rows=edges(p),s=state(p),root=p.graphRoot||'hosting',activeNodes=new Set([root,...rows.flatMap(r=>[r.from,r.to])]);
    const lines=rows.map(r=>{const a=node(r.from),b=node(r.to);if(!a||!b)return '';const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len,offset=Math.min(73/Math.max(Math.abs(ux),.01),31/Math.max(Math.abs(uy),.01)),peers=rows.filter(x=>x.from===r.from&&x.to===r.to),shift=(peers.findIndex(x=>x.index===r.index)-(peers.length-1)/2)*30,nx=-uy*shift,ny=ux*shift;const start={x:a.x+ux*offset+nx,y:a.y+uy*offset+ny},end={x:b.x-ux*(offset+6)+nx,y:b.y-uy*(offset+6)+ny};
      return `<g class="map-edge ${r.checked?'verified':'pending'} ${s.selected?.type==='edge'&&s.selected.id===r.index?'selected':''}" data-edge-index="${r.index}" role="button" tabindex="0" aria-label="${esc(name(r.from)+' → '+name(r.to)+' · '+edgeName(r)+' · '+T(r.checked?'verified':'pending'))}" data-action="graph:edge:${r.index}"><path class="edge-hit" d="M${start.x},${start.y} L${end.x},${end.y}"/><path class="edge-line" d="M${start.x},${start.y} L${end.x},${end.y}" marker-end="url(#arrow-${p.i}-${r.checked?'verified':'pending'})"/><rect x="${(a.x+b.x)/2+nx-34}" y="${(a.y+b.y)/2+ny-11}" width="68" height="22" rx="7"/><text x="${(a.x+b.x)/2+nx}" y="${(a.y+b.y)/2+ny+4}">${esc(edgeName(r).slice(0,env.lang()==='en'?15:8))}</text></g>`;}).join('');
    const vertices=nodes().filter(n=>activeNodes.has(n.id)).map(n=>`<g class="map-node ${root===n.id?'current':''} ${s.selected?.type==='node'&&s.selected.id===n.id?'selected':''}" transform="translate(${n.x-76} ${n.y-34})" role="button" tabindex="0" aria-label="${esc(name(n.id)+' · '+env.t(n.kind))}" data-node-id="${n.id}" data-action="graph:node:${n.id}"><rect width="152" height="68" rx="13"/><image href="../assets/${n.icon}.svg" x="12" y="13" width="19" height="19"/><text class="map-node-kind" x="40" y="23">${esc(root===n.id?T('root'):env.t(n.kind))}</text><text class="map-node-label" x="76" y="49">${esc(name(n.id).slice(0,env.lang()==='en'?19:11))}</text></g>`).join('');
    return `<div class="map-canvas ${mini?'mini':''}" data-map-canvas="${p.i}"><svg viewBox="0 0 360 480" role="group" aria-label="${esc(T('title'))}"><defs>${['verified','pending'].map(k=>`<marker id="arrow-${p.i}-${k}" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="${k==='verified'?'#246b50':'#687585'}"/></marker>`).join('')}</defs><g class="map-world" transform="${transform(p)}">${lines}${vertices}</g></svg>${!rows.length?`<p class="map-empty">${esc(T(env.records().length?'none':'empty'))}</p>`:''}</div>`;
  }
  function selection(p){const s=state(p);if(!s.selected)return '';if(s.selected.type==='node'){const n=node(s.selected.id);if(!n)return '';return `<section class="map-selection" aria-live="polite"><div class="section-heading"><h2>${esc(name(n.id))}</h2>${button('close','clear')}</div><p class="sub">${esc(env.t(n.kind))}</p><div class="map-selection-actions">${button('view',`visit:${n.id}`,'action primary')}${button('center',`center:${n.id}`,'action')}</div></section>`;}const r=env.records()[s.selected.id];if(!r)return '';return `<section class="map-selection" aria-live="polite"><div class="section-heading"><h2>${esc(name(r.from||'workmail')+' → '+name(r.to||'hosting'))}</h2>${button('close','clear')}</div><p>${esc(edgeName(r))}</p><span class="pill ${r.checked?'green':''}">${esc(T(r.checked?'verified':'pending'))}</span><dl class="map-meta"><dt>${esc(T('source'))}</dt><dd>${esc(r.sourceKey?T(r.sourceKey):r.source||'—')}</dd><dt>${esc(T('checked'))}</dt><dd>${esc(r.checked||'—')}</dd></dl><div class="map-selection-actions">${button('edit',`edit:${s.selected.id}`,'action')}${button('delete',`delete:${s.selected.id}`,'action')}</div></section>`;}
  function view(p){const s=state(p);return `<h1>${esc(T('title'))}</h1><section class="relation-map ${s.expanded?'is-expanded':''}" aria-label="${esc(T('title'))}"><div class="map-top"><label class="search">${icon('Search')}<input data-map-search="${p.i}" value="${esc(s.query)}" placeholder="${esc(T('search'))}" aria-label="${esc(T('search'))}"></label><select class="form-input" data-map-status="${p.i}" aria-label="${esc(T('status'))}">${['all','verified','pending'].map(k=>`<option value="${k}" ${s.status===k?'selected':''}>${esc(T(k))}</option>`).join('')}</select></div><div class="map-controls">${button('zoomIn','zoom-in')}${button('zoomOut','zoom-out')}${button('fit','fit')}${button('focus','focus')}${button(s.expanded?'collapse':'expand','expand')}</div>${canvas(p)}<p class="map-legend">${esc(T('legend'))}</p>${selection(p)}${!s.expanded?`<p class="map-help">${esc(T('help'))}</p>`:''}</section><div class="section-heading"><h2>${esc(T('records'))}</h2><span class="sub">${edges(p).length} ${esc(T('total'))}</span></div><div class="card">${edges(p).map(r=>`<button type="button" class="menu-row" data-action="graph:edge:${r.index}">${icon('Network')}<div><strong>${esc(name(r.from)+' → '+name(r.to))}</strong><span class="sub">${esc(edgeName(r)+' · '+T(r.checked?'verified':'pending'))}</span></div>${icon('ChevronRight')}</button>`).join('')||`<p class="map-help">${esc(T('none'))}</p>`}</div>${button('add','add','action full')}`;}
  function preview(p,root){const prev=p.graphRoot;p.graphRoot=root;const html=`<section class="map-preview"><div class="section-heading"><h2>${esc(T('title'))}</h2><button type="button" class="text-action" data-action="module:graph">${esc(T('open'))}${icon('ArrowRight')}</button></div>${canvas(p,true)}<p class="map-legend">${esc(T('legend'))}</p></section>`;p.graphRoot=prev;return html;}
  function fields(r={}){return ['from','to'].map(k=>`<div class="form-group"><label class="form-label">${esc(T(k))}<select class="form-input" name="${k}">${nodes().map(n=>`<option value="${n.id}" ${n.id===(r[k]||(k==='from'?'workmail':'hosting'))?'selected':''}>${esc(name(n.id))} · ${esc(env.t(n.kind))}</option>`).join('')}</select></label></div>`).join('');}
  function handle(i,action){if(!action.startsWith('graph:'))return false;const p=env.phones[i],s=state(p),[a,id]=action.slice(6).split(':');
    if(a==='zoom-in')s.scale=Math.min(2,s.scale+.2);if(a==='zoom-out')s.scale=Math.max(.55,s.scale-.2);
    if(a==='fit'){s.scale=1;s.x=0;s.y=0;}if(a==='focus'||a==='center'){const n=node(a==='center'?id:p.graphRoot||'hosting');if(n){p.graphRoot=n.id;s.scale=1;s.x=180-n.x;s.y=240-n.y;}s.selected=null;}
    if(a==='node'||a==='edge'){s.selected={type:a,id:a==='edge'?Number(id):id};if(p.module!=='graph'||p.page!=='module'){env.open(i);}}
    if(a==='clear')s.selected=null;if(a==='expand')s.expanded=!s.expanded;
    if(a==='edit'||a==='delete'||a==='add'){p.recordKey='graph';p.recordIndex=a==='add'?'new':id;p.modal='flow:record';if(a==='delete'){p.deleteKind='record-delete';p.modal='flow:confirm-delete';}}
    if(a==='visit'){s.expanded=false;const n=node(id);if(n){env.handle(i,(n.kind==='account'?'account:':'asset:')+id);return true;}}
    env.render();return true;
  }
  let drag=null;
  document.addEventListener('pointerdown',e=>{const canvas=e.target.closest('[data-map-canvas]');if(!canvas||e.button!==0)return;drag={i:Number(canvas.dataset.mapCanvas),startX:e.clientX,startY:e.clientY,x:state(env.phones[Number(canvas.dataset.mapCanvas)]).x,y:state(env.phones[Number(canvas.dataset.mapCanvas)]).y,canvas,moved:false,pointer:e.pointerId};});
  document.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.startX,dy=e.clientY-drag.startY;if(Math.hypot(dx,dy)<6&&!drag.moved)return;drag.moved=true;const s=state(env.phones[drag.i]),factor=360/drag.canvas.clientWidth;s.x=drag.x+dx*factor;s.y=drag.y+dy*factor;drag.canvas.querySelector('.map-world').setAttribute('transform',transform(env.phones[drag.i]));e.preventDefault();},{passive:false});
  document.addEventListener('pointerup',()=>{if(drag?.moved){const canvas=drag.canvas;canvas.dataset.ignoreClick='yes';setTimeout(()=>delete canvas.dataset.ignoreClick,0);}drag=null;});
  document.addEventListener('pointercancel',()=>drag=null);
  document.addEventListener('click',e=>{const canvas=e.target.closest('[data-map-canvas]');if(canvas?.dataset.ignoreClick==='yes'){delete canvas.dataset.ignoreClick;e.stopImmediatePropagation();}},true);
  document.addEventListener('input',e=>{if(e.target.dataset.mapSearch===undefined)return;const i=Number(e.target.dataset.mapSearch),p=env.phones[i];state(p).query=e.target.value;const pos=e.target.selectionStart;env.render();const el=document.querySelector(`[data-map-search="${i}"]`);el?.focus();el?.setSelectionRange(pos,pos);});
  document.addEventListener('change',e=>{if(e.target.dataset.mapStatus===undefined)return;state(env.phones[Number(e.target.dataset.mapStatus)]).status=e.target.value;env.render();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){const p=env.phones.find(x=>state(x).expanded);if(p){state(p).expanded=false;env.render();}}if(['Enter',' '].includes(e.key)&&e.target.matches('svg [data-action]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
  return {view,preview,handle,fields,T,clearSelection:p=>state(p).selected=null};
};
