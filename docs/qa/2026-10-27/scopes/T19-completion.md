# T19-01 普通候选逐字段合并：源码补齐回执

2026-10-27，Windows、固定依赖、隔离Chromium与4208。全部为合成项目、CSV与备份；没有使用用户4180或真实资料。主控已核对云端f72ac57并确认用户批准本轮草图。

## 完成

- 候选新增与原批量确认保留；新增明确选择同类型目标及逐字段勾选的合并入口。所有字段默认不选，取消不写入，同名不自动覆盖。沿用既有React Dialog、Select、Button和主题变量，中文/英文同步。
- 只替换明确勾选字段。保留目标ID、未选字段、关联、创建时间和操作标记；候选ID与候选原值继续保留，收据记录目标ID、选择、原值、合并值、时间和原始来源。
- 冻结意图使用既有FileStore importJournal；资产仍只有RxDB一份权威状态。跨存储CAS、失败重试、取消未提交意图与启动重放均有检查。已写入后发生新的目标修改时不覆盖新值，冲突保留待核对。
- 备份、恢复、同步和永久删除识别待完成合并；启动不会将合并目标错当新增导入回滚。永久删除目标时移除对应合并收据。
- CSV原文采用一份carrier及同hash引用，保留旧CSV缺省兼容。删除carrier时将完整原文转移到同文件剩余候选，不以每行复制全文突破原备份预算。

## 实际验证

|范围|结果与证据|
|---|---|
|新增数据层13项＋原候选存储16项|29/29通过。包括非法字段、未选非法URL、过期候选/目标、实际写入失败、CAS后收据中断、重启恢复、后写保护、真实加密备份恢复、待处理意图阻止备份恢复。|
|CSV边界|近2MiB、200行，1份完整BOM/CRLF原文＋199引用；实际导出、独立库恢复逐字等值，候选JSON小于3MiB；缺carrier归档明确拒绝。|
|中英390/1280原操作|4/4。真实CSV预览、源文逐字核对、默认不勾选、缺选择拒绝、勾选后取消不写入、焦点返回、只合并描述、双击防重、刷新后目标及收据回读、跳转原目标、下载KA1并在独立context正式恢复，再下载解密逐项等值。|
|关键异常|1/1。打开核对后修改目标，确认拒绝且新值保留；重新核对后注入一次实际RxDB写入异常，冻结意图保留，原表单重试只写一次，刷新后原值/决定/目标读回。|
|相邻原路径|PDF显式类型与决定4项＋审核迟到刷新/其他行编辑5项通过；与本包共14/14（1.1分钟），0失败/跳过。|
|静态检查|TypeScript无错误；本包8个TS/TSX文件lint零诊断；diff检查通过。|

正式最终命令：

```powershell
$env:KEEPANY_E2E_PORT='4208'
node node_modules/@playwright/test/cli.js test tests/e2e/qa-t19-merge-completion.spec.ts tests/e2e/intake-refresh-race.spec.ts tests/e2e/intake-pdf.spec.ts --config=playwright.windows-qa.config.ts --workers=1 --reporter=line --output=test-results/T19-completion-final
```

本机最终日志：`test-results/T19-completion-final.log`。保留[中文390](../evidence/T19-completion/fields-source-zh-390.png)与[英文1280](../evidence/T19-completion/fields-source-en-1280.png)代表图，已目检可读性与操作间距；不提交全量PDF重复截图或原生备份下载。

## 首次失败与执行边界

- 首次14场景为13过/1失败：英文390备份操作期间主控修改共享workflows.tsx触发Vite热更新，密码/下载会话重挂载。原断言、首次截图留于`test-results/T19-completion-adjacent`；统一源码冻结后原场景及全组14/14通过，没有改弱断言。
- 便携预检初版在另一个“新建项目”前置夹具等待超时，尚未到候选合并，见`test-results/T19-source-free-ui-check`；后续未继续该前置路径，改复用正式下载的合成KA1目标夹具，与T14采用同样交付测试方法。这不是便携包产品失败或通过证据。
- 当前源码使用隔离Chromium，不是Ego、真机或公开部署。本包没有更新4180、官网、Release。

## 便携包续验与提交

`qa-t19-merge-completion.spec.ts`支持`KEEPANY_T19_PORTABLE=1`，以源码预先真实下载的`test-results/T19-merge-fixture/fixture.ka1`及元数据为前置，生产网页仅操作UI导入、CSV核对、合并、取消、刷新、KA1下载与独立context恢复，不通过页面源码模块注入。生产包需另跑4个双语/宽度场景；源码专用存储异常注入仍单独保留。

数据层提交：71ffc69。UI、测试与本回执随小包提交；提交SHA以git log为准。没有单独推送或公开发布。4208自建Vite与全部浏览器context随Playwright正常收尾；合成备份/日志留忽略目录供主控真实包续验。

自动审批拒绝清理本包目录中2张初版重复字段图与8张PDF相邻重复图（blocked by policy，未提供具体原因）。操作未执行，没有换工具或拆命令重试；仅两张最终字段代表图纳入本提交，其余保留本机。
