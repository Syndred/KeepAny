from zipfile import ZipFile
from pathlib import Path
from collections import defaultdict
import json,hashlib
p=Path('test-results/ci32-lifecycle-failure/portable-release/account-lifecycle-release--40202-rts-the-same-account-family/trace.zip');z=ZipFile(p);rows=[json.loads(x) for x in z.read('1-trace.trace').decode().splitlines()];frames=defaultdict(list);nodesCache={};allstats=[]
def rawNodes(fid,i):
 key=(fid,i)
 if key in nodesCache:return nodesCache[key]
 nodes=[]
 def visit(n):
  if isinstance(n,str):nodes.append(n)
  elif isinstance(n,list) and n and isinstance(n[0],str):
   for ch in n[2:]:visit(ch)
   nodes.append(n)
 visit(frames[fid][i]['html']);nodesCache[key]=nodes;return nodes

def resolve(n,fid,i):
 while isinstance(n,list) and n and isinstance(n[0],list):
  delta,index=n[0];i-=delta;n=rawNodes(fid,i)[index]
 return n,i

def walk(n,fid,i):
 n,i=resolve(n,fid,i)
 if isinstance(n,list) and n and isinstance(n[0],str):
  yield n
  for ch in n[2:]:yield from walk(ch,fid,i)
for event in rows:
 if event['type']!='frame-snapshot':continue
 s=event['snapshot'];fid=s['frameId'];i=len(frames[fid]);frames[fid].append(s)
 if not 484000<=s['timestamp']<=485600:continue
 graphs=[]
 def find(n,idx):
  n,idx=resolve(n,fid,idx)
  if not(isinstance(n,list) and n and isinstance(n[0],str)):return
  a=n[1] if len(n)>1 and isinstance(n[1],dict) else {};classes=a.get('class','').split()
  if 'account-family-graph' in classes:
   elements=list(walk(n,fid,idx));cls=lambda c:sum(c in (x[1] if len(x)>1 and isinstance(x[1],dict) else {}).get('class','').split() for x in elements)
   graphs.append({'ready':a.get('data-layout-ready'),'ariaBusy':a.get('aria-busy'),'nodes':cls('react-flow__node'),'edgeWrappers':cls('react-flow__edge'),'edgePaths':cls('react-flow__edge-path'),'frameUrl':s['frameUrl']})
  for ch in n[2:]:find(ch,idx)
 find(s['html'],i)
 if graphs:
  elements=list(walk(s['html'],fid,i));relationRows=sum('relation-row' in (x[1] if len(x)>1 and isinstance(x[1],dict) else {}).get('class','').split() for x in elements)
  allstats.append({'timestamp':s['timestamp'],'callId':s['callId'],'phase':s.get('phase'),'relationRows':relationRows,'graphs':graphs})
out=Path('test-results/account-layout-independent/fc15-trace-audit');out.mkdir(parents=True,exist_ok=True)
(out/'snapshots.json').write_text(json.dumps({'sourceTrace':p.as_posix(),'traceSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'method':'Reference reconstruction follows installed Playwright1.63 snapshotNodes postorder and SnapshotRenderer back-reference indexes, grouped by frame ID. No UI or product state mutation.','snapshots':allstats},indent=2),encoding='utf8')
print('snapshots',len(allstats));previous=None
for s in allstats:
 value=[(g['ready'],g['ariaBusy'],g['nodes'],g['edgeWrappers'],g['edgePaths']) for g in s['graphs']]
 if value!=previous:print(json.dumps(s,ensure_ascii=True));previous=value
