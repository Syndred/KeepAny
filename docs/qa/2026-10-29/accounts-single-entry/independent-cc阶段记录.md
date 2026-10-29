# 独立复核：cc 阶段事实（未完成验收）

2026-10-29。非产品实现者 `independent_single_entry`。候选 `cc2e9e351f3d5df8b1cd841658c9ca8ba39939f4`，实际包内入口 `http://127.0.0.1:4403/`；ZIP `dist/preview/KeepAny-0.1.0-preview.cc2e9e351f3d-portable.zip`，实测 SHA256 `9d3e0496b3999176c194d8517083f9fae6c887db41aa9be5595d50e03efb7ad7`。包构建身份 clean；测试脚本后续观察等待修正单独绑定，不混称产品源码相同。

**状态为未完成。** 主控在此包追加 SE15 故障检查，发现密码永久删除失败时误显示导入备份错误。独立已实际打开 `controller-final-cc2e9e/10-purge-fault-preserves-trash.png` 并读取同目录 `purge-boundary-result.json`：错误反馈不符操作，取消/失败仍保留回收站、重试刷新后删除成功且普通账号保留。故障由主控注入与操作，本代理只独立审证。此缺陷使该包不能宣布本需求完整验收；等待修复的新候选重验。

## 已执行结果

|当前包实际运行|首轮结果|说明|
|---|---|---|
|SE14 原 busy 场景，zh1280/en390|2通过，36.8秒|自然 busy 禁用/恢复，严格44px原标准；新增实际77×44与76.25×44|
|新6＋原3类核心流程|20通过，318.2秒|唯一新增、全部普通资料和密码能力、极简无库保存、错误取消、关联回读、刷新解锁、回收站恢复/旧hash|
|6项选定相邻|5通过，1失败，108.2秒|布局共享消费2、关联审核2、toast英文通过；中文toast在刷新后的观察过早|
|toast等待修正后独立重放|2通过，16.1秒|同产品包、新证据目录，保留首轮失败，不改写为首轮6/6|

全部为单worker、重试0、隔离虚构资料、真实UI。全报告、原失败图/trace、候选与逐用例状态见 `independent-results-cc2e9e.json`；原文件位于 `test-results/accounts-single-entry/independent-final-cc2e9e/`。

toast首轮的层级、实际Save命中、原生必填拒绝和取消保留资产均通过。trace显示解锁click在36266ms返回，36272ms即直接读条目DOM，未等异步解锁发布；失败截图随后已有“已解锁”和8账号各1条。仅补实际工具栏ready等待及原8条ID/顺序的精确轮询比较，不增加原总预算、不改ID/数量。原脚本SHA `008f126e9f550e6c97c24643004ecc080cf0b3e5b6ffd0d53f56388aa5a589c2`，修正后SHA `7d96fefbdb0d468fd99e58ed2b9586885a02c436d9faa5bf8aba1dc7431bb278`。此项为测试观察错误，不能混同数据丢失或已知SE15产品错误。

另补真实UI自定义分类→唯一新增选择→无库保存→刷新：zh1280、en390各通过。英文首轮漏开手机导航，隐藏侧栏链接点击超时是准备失败；原脚本与中文已过结果保留在 `custom-category`，修正为先点手机导航后英文单项重放保留在 `custom-category-en`，未覆盖首轮。

## 实际视觉与白盒

- 此包新66张具名图全部逐张 `view_image` 打开；两语言×390/768/1268/1280/1920/2560真实空态、账号展开、默认合并表单、更多资料错误、分类浮层，另含完整表单、建库不匹配、下方回收站。空态已等真实内容、侧栏已等结束几何；错误完整位于固定操作栏独立行；长内容换行、邻卡保持紧凑。
- 另实际打开busy/恢复12图、相邻选定22图、核心旧场景4图、主控体验9图及新增SE15失败图。逐文件观察与SHA见 `independent-visual-reviewed-cc2e9e.json`、`independent-adjacent-reviewed-cc2e9e.json`。主控图只称审证，不冒称自己操作。
- 66图原件及两份几何JSON归档 `test-results/accounts-single-entry/independent-final-cc2e9e/visual-evidence-66.zip`，SHA256 `1389729f6b10a6b98e4aa347cb0a9b9c3ff3440d12841eeccc616d894ab3e44d`；docs只保留6张关键稳定图于 `independent-final-cc2e9e`，完整浏览器附件留test-results。
- 只读审查 `account-entry-save.ts`、`AccountEntryDialog`、普通账号身份保存及共享EntryEditor/Panel、样式组合。普通字段与KDBX秘密分开；预验证在普通写入前；稳定账号ID/expected记录用于部分失败重试；锁定时私密字段与手动复制立即隐藏；header44样式仅约束账号页消费容器。未发现另一个确认的双存储重试/秘密边界缺陷；共用错误上下文SE15按有效产品失败处理。

## 历史证据与边界

修前2c5c的三个有效UI失败、494首轮14/20及主控SE13错误遮挡、7a首轮20/20及独立相邻6/8的真实SE14触控失败均保留。494的6项测试准备/精确预期问题与真实SE13分开；7a的空态fallback/侧栏过渡截图属于证据不足，不能用机器绿掩盖。源码诊断见 `independent-源码诊断.md`，从未冒称最终包通过。

本代理未改产品、未操作用户4180或真实秘密，未停止主控持有的server。此报告仅本轮范围及选定回归；正式发布、全项目、原生真机不据此验收。主控个人体验及云端CI另由主控记录；当前SE15未闭环，独立最终复核仍未完成。
