from pathlib import Path
from hashlib import sha256
from PIL import Image
import json, datetime

root = Path('C:/Users/Administrator/.codex/worktrees/accounts-compact/KeepAny')
visual = Path('C:/Users/Administrator/.codex/visualizations/2026/10/30/01a18a31-44a4-7f90-ad2e-781b2c50a4a0')
out = visual / 'independent-ae76-visual-review'
out.mkdir(exist_ok=True)
rows = []

def add(p, group, language, width, state, observation, verdict='通过'):
    # This explicit manifest lists images already opened and read by the reviewer.
    # Hashing/dimensions only bind that observation to the immutable source bytes.
    with Image.open(p) as img:
        size = list(img.size)
    rows.append({'path':str(p).replace('\\','/'), 'sha256':sha256(p.read_bytes()).hexdigest(), 'pixelSize':size,
                 'group':group, 'language':language, 'viewportWidth':width, 'state':state,
                 'actuallyOpenedAndRead':True, 'verdict':verdict, 'observation':observation})

for lang in ['zh-CN','en']:
    for width in [1920,1280,768,390,2560]:
        base = root / 'test-results/compact-ae76-layout-settled'
        card = '手机卡片高221px、复制及切换控件分行空间充分' if width == 390 else '普通卡片高188px、相邻卡片等高'
        notes = {
            'expanded':'登录详情弹窗的账号、密码掩码、网址、备注、解除关联及底部操作可读；弹窗居中且边界在视口内；背景卡片未被撑高。'+(' 手机采用上下字段排布，动作按钮分行。' if width == 390 else ' 标签和值列无重叠。'),
            'multiple':'所选2/2无密码登录显示“未填写/Not set”和“未设置密码/No password set”，复制为禁用；添加按钮、切换计数与卡片页脚互不遮挡；'+card+'。',
            'hover':'实际为保留键盘焦点后的 hover+focus 组合帧，黄色焦点环可见且未裁切；值、复制及切换控件不重叠；不能作为纯 hover 独立帧。',
            'focus':'键盘焦点环可见、未被卡片边框裁切；文字与复制控件可读；'+card+'。',
            'empty':'空账号值与禁用复制图标、无密码添加入口清晰，未出现卡片越界或按钮叠压；'+card+'。',
            'toolbar':'示例新增与工具图标分布清楚，未发生文字截断或按钮叠压。'+(' 390宽工具栏自然换为3行。' if width == 390 else ' 工具保持单行。')
        }
        for state in ['expanded','multiple','hover','focus','empty','toolbar']:
            add(base / f'{state}-{lang}-{width}.png', 'layout-settled',lang,width,state,notes[state])

base = root / 'test-results/compact-ae76-final-gate/evidence'
for lang in ['zh-CN','en']:
    for width in [390,768,1268,1280,1920,2560]:
        notes = {
            'matrix-account-expanded':'长标题、长账号、长网址及长备注在登录详情中换行可读，复制控件未被长内容覆盖；弹窗内部滚动。当前图仅覆盖上部内容，下部动作可达性另由本轮真实UI重放/常规expanded图佐证。'+(' 390单列无横向溢出。' if width == 390 else ' 字段标签与值列分开，无重叠。'),
            'matrix-category-open':'分类弹层内四项、选中高亮和勾选清晰，层级高于后续输入；边界处于弹窗内；固定页脚的错误文案和保存/取消可读。',
            'matrix-editor-expanded-error':'扩展资料及错误页脚清晰；标签、状态、日期、备注与关联资产布局无横向溢出；错误和保存/取消未相互覆盖。'+(' 手机字段为单列，页脚两按钮完整。' if width == 390 else ' 两列字段及全宽备注对齐。')
        }
        for state in notes:
            add(base / f'{state}-{lang}-{width}.png','final-gate-six-widths',lang,width,state,notes[state])

for lang in ['zh-CN','en']:
    form_notes = {
        'same-form-create-error':('390','主密码不一致错误在页脚清晰可见；保存/取消完整，输入保持掩码，复制禁用样式可辨。','通过'),
        'same-form-save-partial':('390','部分保存反馈完整换行，明确普通账号已保存、密码或关联未完整保存；文字未被底部动作覆盖，密码仍为掩码。','通过'),
        'sequential-validation-error':('390','非法日期字段位于sticky footer下方，截图只在弹窗外下方显示原生提示；不能判错误定位可用。已以4396最终包新隔离上下文复现并保留独立证据。','失败'),
        'purge-error':('1280','彻底删除确认弹窗中保留对象名、删除范围及失败可重试反馈，双语文字与取消/删除按钮均可读。','通过'),
        'journey-complete-form':('1280','完整表单含登录别名、密码、私密备注和网址；别名焦点环及复制/删除动作可读、对齐，保存/取消未遮挡字段。','通过')
    }
    for state,(width,note,verdict) in form_notes.items():
        add(base / f'{state}-{lang}.png','additional-forms',lang,int(width),state,note,verdict)

for state in ['date-invalid-immediate','date-invalid-settled']:
    note = '独立最终包原始UI重放：非法日期字段y882.109..923.109，footer y854..923，日期中心命中footer；2秒后位置仍相同，字段聚焦但被覆盖。'+(' 原生提示尚处淡出/淡入帧。' if state.endswith('immediate') else ' 原生提示已可读但在弹窗外下方，仍无法看到对应日期字段。')
    add(visual / 'independent-ae76-date-error' / f'{state}.png','independent-ui-replay','en',390,state,note,'失败')

zip_path = root / 'dist/preview/KeepAny-0.1.0-preview.ae76b20e8a8c-portable.zip'
zip_sha = sha256(zip_path.read_bytes()).hexdigest()
assert zip_sha == '276c8da5fa24704df1ad355195babfc4b3daa759cbfe45e7b487bea43e508e32'
result_files = []
for p in sorted((root / 'test-results/compact-ae76-layout-settled').glob('result-*.json')):
    item = json.loads(p.read_text(encoding='utf-8-sig'))
    result_files.append({'path':str(p).replace('\\','/'),'sha256':sha256(p.read_bytes()).hexdigest(),'language':item['language'],'width':item['width'],'candidate':item['candidate'],'status':item['status']})
report = {
 'reviewerRole':'只读独立复核者，非产品实现者',
 'date':str(datetime.datetime.now(datetime.timezone.utc)),
 'candidate':{'sourceCommit':'ae76b20e8a8c4e07779fd3cfafa4345c8dd37eb8','zip':str(zip_path).replace('\\','/'),'zipSha256':zip_sha,
              'independentReplayOrigin':'http://127.0.0.1:4396','layoutReceiptOrigin':'http://127.0.0.1:4393','indexSha256':'ea991c52c1bce249258aa61352accdc535eed2a425873ff817fb8c111d6a4b9a'},
 'conclusion':'未完成：本次逐图复核发现390非法日期验证时字段被sticky footer覆盖，已实际UI复现；其余所审图保留通过事实。',
 'scope':{'layoutRequiredImages':60,'finalGateSixWidthImages':36,'additionalForms':10,'independentReplayImages':2,'totalActuallyOpenedImages':len(rows)},
 'boundaries':['未修改产品、原始截图或既有失败证据。','逐图原始像素实际打开核对；SHA和尺寸仅作为绑定证据。','hover截图含已保留键盘focus，不能称纯hover独立证据。','busy/pressed当时未提供专门证据，仍待补；普通禁用复制样式不能替代忙碌态。','长fullPage截图中的固定backdrop仅覆盖捕获时的视口区域，不将文档外区未变暗误判为产品遮罩故障。','主控本人用户体验与4180部署验收由主控另行记录，本报告不替代。','ae76修复并重新打包后受影响表单与布局结果需绑定新候选复验。'],
 'layoutMachineReceipts':result_files,
 'images':rows
}
(out/'逐图索引.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
lines = ['# ae76 独立逐图复核（修前）','', report['conclusion'],'',
         f"候选：`{report['candidate']['sourceCommit']}`；ZIP SHA256 `{zip_sha}`。",'',
         '共实际打开108张：紧凑布局60张、详情/分类/扩展错误双语六宽36张、附加表单10张、独立日期错误重放2张。主要布局、文字、复制位置及长内容换行未见新增问题；非法日期定位存在有效失败，尚不能宣布范围完成。','',
         '390日期重放事实：日期字段 y882.109–923.109，页脚 y854–923，中心点命中页脚；立即与2秒后相同。2秒后原生提示在弹窗外下方可读，但日期控件仍被页脚覆盖。脚本、截图及矩形记录位于 ../independent-ae76-date-error/。','',
         '## 边界','']
lines += ['- '+note for note in report['boundaries']]
lines += ['', '## 逐图 SHA256 索引', '', '| # | 原图 | 像素 | 状态 | 判定 | SHA256 | 观察 |','|---|---|---|---|---|---|---|']
for i,row in enumerate(rows,1):
    p = row['path']; label = Path(p).name
    lines.append(f"| {i} | [{label}]({p}) | {row['pixelSize'][0]}×{row['pixelSize'][1]} | {row['language']} / {row['viewportWidth']} / {row['state']} | {row['verdict']} | `{row['sha256']}` | {row['observation']} |")
(out/'逐图复核.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'images':len(rows),'passed':sum(r['verdict']=='通过' for r in rows),'failed':sum(r['verdict']=='失败' for r in rows),'report':str(out/'逐图复核.md'),'index':str(out/'逐图索引.json')},ensure_ascii=False))
