from pathlib import Path
from hashlib import sha256
from zipfile import ZipFile
from urllib.request import urlopen
from PIL import Image
import json, datetime

root=Path('C:/Users/Administrator/.codex/worktrees/accounts-compact/KeepAny')
visual=Path('C:/Users/Administrator/.codex/visualizations/2026/10/30/01a18a31-44a4-7f90-ad2e-781b2c50a4a0')
out=visual/'independent-03-final'
source='03e186de181321cff5843e1ee194679acb81a0e3'
zip_path=root/'dist/preview/KeepAny-0.1.0-preview.03e186de1813-portable.zip'
zip_sha=sha256(zip_path.read_bytes()).hexdigest()
assert zip_sha=='89f820f2b35f23b162b025778285cc2d06d037e8b128c37741752d573b1df391'
identity=[]
with ZipFile(zip_path) as z:
    prefix='KeepAny-0.1.0-preview.03e186de1813-portable/web/'
    paths=['index.html']+[n[len(prefix):] for n in z.namelist() if n.startswith(prefix+'assets/') and ('page-workspaces-' in n or 'PasswordVaultPanel-' in n)]
    for name in paths:
        package_sha=sha256(z.read(prefix+name)).hexdigest()
        served_sha=sha256(urlopen('http://127.0.0.1:4396/'+name).read()).hexdigest()
        assert package_sha==served_sha, name
        identity.append({'path':name,'packageSha256':package_sha,'servedSha256':served_sha,'matched':True})
index_sha=next(i['packageSha256'] for i in identity if i['path']=='index.html')
flows=json.loads((out/'date-replay.json').read_text(encoding='utf-8'))
assert len(flows)==4
assert all(f['indexSha256']==index_sha for f in flows)
rows=[]

def add(p,group,lang,width,state,note):
    with Image.open(p) as image: size=list(image.size)
    rows.append({'path':str(p).replace('\\','/'),'sha256':sha256(p.read_bytes()).hexdigest(),'pixelSize':size,'group':group,'language':lang,'viewportWidth':width,'state':state,'actuallyOpenedAndRead':True,'verdict':'通过','observation':note,'candidate':source})

prior=json.loads((visual/'independent-ae76-visual-review/逐图索引.json').read_text(encoding='utf-8'))
for old in prior['images']:
    if old['group']!='layout-settled': continue
    p=root/'test-results/compact-03-layout'/Path(old['path']).name
    note=old['observation']
    if old['state'] in ['expanded','multiple']: note+=' 新03图中的页标题下反馈为深墨色，未遮挡后续工具或列表。'
    add(p,'03-layout',old['language'],old['viewportWidth'],old['state'],note)

base=root/'test-results/compact-03-final-gate/evidence'
for lang in ['zh-CN','en']:
    for width in [390,768,1280,1920,2262]:
        for state in ['normal','locked']:
            note='标题、搜索、分类、紧凑账号卡片及深墨色复制反馈清晰，长标题和值省略未挤压复制/网址入口；各卡高度一致，'+('390使用单列，触控动作空间充足。' if width==390 else '列表与工具布局无叠压。')
            if state=='locked': note+=' 锁定图中无密码值、显隐按钮、登录切换私有计数；就近解锁及展开主密码输入清晰。普通账号值仍显示。'
            else: note+=' 单一登录隐藏无用切换，多登录显示1/2与切换图标，密码保留掩码，复制/显隐按钮可辨。'
            add(base/'compact'/f'matrix-{state}-{lang}-{width}.png','03-normal-locked',lang,width,state,note)
    for width in [390,768,1268,1280,1920,2560]:
        add(base/f'matrix-editor-expanded-error-{lang}-{width}.png','03-expanded-errors',lang,width,'expanded-tag-error','扩展资料长文本、状态/日期、备注及关联区域清晰；标签错误在固定页脚完整可读，与保存/取消无重叠；窄屏单列、其余双列布局无横向溢出。')
    for state in ['sequential-validation-error','same-form-create-error','same-form-save-partial']:
        notes={
            'sequential-validation-error':'原非法日期失败的新包截图：2026-02-30字段及焦点边框在页脚上方，双语日期错误在页脚完整可见，原生气泡不再落在弹窗外。',
            'same-form-create-error':'主密码不一致错误清晰、掩码输入保留，固定页脚未遮挡错误，取消/保存均完整。',
            'same-form-save-partial':'部分保存反馈完整换行，保留原稿并明确账号已保存、密码/关联未全保存；未被底部按钮覆盖。'
        }
        add(base/f'{state}-{lang}.png','03-form-neighbors',lang,390,state,notes[state])
    for width in [390,1280]:
        flow=next(f for f in flows if f['language']==lang and f['width']==width)
        for state in ['date-invalid','date-corrected','save-feedback','copy-feedback']:
            notes={
                'date-invalid':f"独立UI重放：非法日期仍invalid且未写入；字段y{flow['invalid']['field']['y']:.3f}..{flow['invalid']['field']['bottom']:.3f}，页脚y{flow['invalid']['footer']['y']:.0f}开始；字段及alert均真实可命中、无遮挡，错误文本可读。",
                'date-corrected':'独立UI重放：改正为2026-10-29后错误立即清除、validity恢复；日期焦点与底部按钮可见。',
                'save-feedback':'独立UI重放：保存后只有1条虚构账号；标题下反馈rgb(23,36,58)为主题深墨色，未遮挡工具/卡片。',
                'copy-feedback':'独立UI重放：账号复制后真实剪贴板读取与虚构值一致，Copied/已复制反馈为主题深墨色，复制图标勾选与正文分开。'
            }
            add(out/f'{state}-{lang}-{width}.png','03-independent-ui',lang,width,state,notes[state])

controller=root/'docs/qa/2026-10-30/compact-accounts/controller-03'
add(controller/'saving-busy-en-390.png','03-controller-state','en',390,'saving-busy','实际打开主控提供的保存中帧：新增登录的字段、复制/别名按钮与Save entry灰禁用，结构稳定，无文字叠压。主控记录为CPU20倍节流触发自然保存；本复核者仅独立图审此忙碌帧，不声称自己重放该触发。')
add(controller/'switch-pressed-en-390.png','03-controller-state','en',390,'switch-pressed','实际打开主控提供的真实mouse.down帧：切换按钮背景/边框反馈可辨、1/2仍可读，与相邻复制按钮分开。主控记录mouse.up后切至2/2；本复核者仅独立图审该按下帧。')
assert len(rows)==116
report={
 'role':'非产品实现者，只读独立复核',
 'time':str(datetime.datetime.now(datetime.timezone.utc)),
 'candidate':{'sourceCommit':source,'zip':str(zip_path).replace('\\','/'),'zipSha256':zip_sha,'origin':'http://127.0.0.1:4396','indexSha256':index_sha,'servedFiles':identity},
 'conclusion':'本次指定范围独立复核通过：非法日期原失败已在双语390/1280真实UI闭环；116张本候选相关图实际打开，无新增必要布局缺陷。该定向结论不替代主控总体合同与4180升级验收。',
 'counts':{'layout':60,'normalLocked':20,'sixWidthExpandedErrors':12,'neighborForms':6,'independentUiImages':16,'controllerBusyPressed':2,'totalActuallyOpenedImages':len(rows)},
 'uiReplay':flows,
 'whiteBox':{'changedProductFilesFromAe76':['apps/web/src/components/AccountEntryDialog.tsx','apps/web/src/compact-account.css'], 'observations':['日期onInvalidCapture只针对account-entry-reviewed；preventDefault抑制原生气泡而保留输入validity，显示现有invalidDate文案，聚焦并居中滚动；独立UI证实非法日期不保存，更正后清错并可保存。','反馈文字仅由--green改为--ink；新包实测保存与复制反馈rgb(23,36,58)，未改变反馈位置。']},
 'failureClosure':{'beforeCandidate':'ae76b20e8a8c4e07779fd3cfafa4345c8dd37eb8','beforeEvidence':str(visual/'independent-ae76-date-error').replace('\\','/'),'beforeVisualIndex':str(visual/'independent-ae76-visual-review/逐图索引.json').replace('\\','/'),'originalFailurePreserved':True,'afterCandidate':source,'replayedOriginalFtpThenDateSequence':True},
 'boundaries':['本轮产品范围仅本候选日期错误与反馈字色变化，以及指定紧凑状态和表单相关图审；未将ae76截图计入新包结果。','共4个新隔离上下文从正常导航创建虚构库与资料，全部浏览器已关闭，无读取4180实际用户资料。','本次UI脚本额外复制步骤的2次选择器准备超时单列preparation-01/02并保留原图；不算产品失败，最终从新隔离上下文完整重放。','hover图片包含保留的focus环，按组合态记录；忙碌与pressed帧为主控真实触发，独立复核者已实际看图，未冒称自己触发。','create-busy-en-390.png仅已完成建库后的空字段禁用，不作为busy证据。','独立git show fa357da确认：WorkspaceLegacyRoute在上一版已把/assets/account与/assets/vault指向AccountsWorkspace；此前称旧/assets/account仍走AccountCard的边界判断撤回。父任务已将旧spec的16例记为准备失败，不引用为旧路由通过。','临时4396未保留旧哈希，旧SW上下文chunk失败不证明4180升级失败或通过；4180升级、旧哈希保留及真实资料观察由主控另列。','未将本轮未打开的03分类弹层与长内容详情六宽图计入；普通详情五宽双语已在60张layout内实际打开。主控其他视觉/功能覆盖另行负责。','主控本人用户体验、全部合同闭环、发布与部署仍需主控独立判定，本报告不声称全项目完成。'],
 'images':rows
}
(out/'逐图索引.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
lines=['# 03e186de1813 独立复核','',report['conclusion'],'',f'源码 `{source}`；ZIP SHA256 `{zip_sha}`；4396 index SHA256 `{index_sha}`。ZIP与服务的index、账号workspace JS/CSS、密码面板JS/CSS共5文件逐一摘要一致。','',
       '双语390/1280共4个隔离UI上下文重放原失败：先ftp错误→修正https→展开更多→非法日期→保存。非法日期仍invalid且未新增；日期与页脚alert真实可命中。更正立即清错，正常保存只产生1条，实际复制结果正确。每个上下文的保存与复制反馈均为主题深墨色。','',
       '实际打开116张本候选图：60张布局、20张正常/锁定、12张六宽扩展错误、6张邻近错误表单、16张独立UI帧及2张主控忙碌/按下帧。','',
       '修前ae76失败与本次修后证据分别保留。未修改产品、原始截图或主控测试记录。','', '## 结论边界','']
lines+=['- '+x for x in report['boundaries']]
lines+=['','## 逐图 SHA256 索引','','| # | 原图 | 像素 | 状态 | SHA256 | 实际观察 |','|---|---|---|---|---|---|']
for i,row in enumerate(rows,1):
    lines.append(f"| {i} | [{Path(row['path']).name}]({row['path']}) | {row['pixelSize'][0]}×{row['pixelSize'][1]} | {row['language']} / {row['viewportWidth']} / {row['state']} | `{row['sha256']}` | {row['observation']} |")
(out/'独立复核.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'count':len(rows),'indexSha256':index_sha,'matchedFiles':len(identity),'uiFlows':len(flows)},ensure_ascii=False))
