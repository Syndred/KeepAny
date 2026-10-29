# 独立复核：398c 阶段事实（SE16 未完成）

2026-10-29，非产品实现者 independent_single_entry。候选 `398cdba992ac3364bc0f5d8d3ae06e0fc9288d53`，clean ZIP `dist/preview/KeepAny-0.1.0-preview.398cdba992ac-portable.zip`，实测 SHA256 `57a3f6885cc64ec98cc6ecca92f9a7822741831ffc898539192110757d284a1a`。实际包内入口 `http://127.0.0.1:4405/` 的 index 与 ZIP 中编译 index 字节一致，SHA256 `834bcd959d167bc04afe455137e948748e6940d1755b6e75fd3c70ee8919c871`。

**本候选未完成验收。** 补验连续输入时独立发现 SE16：FTP 网址被拒后，将网址纠正，再输入原生校验不通过的日期，表单仍显示旧的“请检查：网址。”。日期拒绝、取消和刷新后零写入均正确，但错误反馈已过期。主控已接受为有效 UI 缺陷，需新候选重验；以下通过事实不能覆盖此失败。

## 当前候选已执行事实

|项目|实际结果|边界|
|---|---|---|
|新6＋原账号密码合并、关联恢复、用户旅程核心|20/20 首轮通过，322.2秒|worker1、重试0、无跳过；真实编译包隔离资料|
|原 SE14 busy＋共享消费布局＋toast＋关联审核|8/8 首轮通过，139.4秒|原44px、8条ID、取消/保存与刷新精确断言保留|
|真实自定义分类→唯一新增→无库保存→刷新|zh1280/en390 各通过|实际UI准备与操作，4张图已打开|
|两语言×六宽主要矩阵及关键流程|70张逐张实际打开|390/768/1268/1280/1920/2560；真实空态、长内容展开、默认表单、更多资料错误、分类浮层、完整资料、SE05部分保存、SE13、SE15|
|选定相邻实际图审|busy/恢复12张＋其他相邻22张|独立打开本版图片，未沿用旧候选结论|
|主控本人流程审证|12张及3份JSON已独立审阅|操作者主控；不冒称本代理亲自完成主控任务|
|实际4180独立HTTP|3个静态样本通过|index/入口JS匹配ZIP，保留旧hash样本匹配本地静态文件；未读取真实profile或资料|

核心报告位于 `test-results/accounts-single-entry/independent-final-398cdb/playwright.json`、`adjacent/playwright.json`。版本、逐用例状态、SHA、图审索引和当前失败在 `independent-results-398cdb.json`，主70图在 `independent-visual-reviewed-398cdb.json`，相邻/主控/失败审证在 `independent-adjacent-reviewed-398cdb.json`。旧普通资产回收站2张手机辅助截图捕到侧栏过渡，不在本次布局变更范围，不作为稳定视觉通过证据；本需求密码回收站另有稳定图。

70张原图及两份几何JSON归档 `test-results/accounts-single-entry/independent-final-398cdb/visual-evidence-70.zip`，SHA256 `35972b361ef241b4bba93584b092f6050d5dc59cb77a4f33c3c1df9cc93e5bca`；docs 的 `independent-final-398cdb` 仅保留8张关键稳定图及SE16失败图/JSON，完整浏览器trace与附件留test-results。

## SE16 有效失败与测试观察区别

精确路径：正常导航→账号→唯一新增，名称填虚构资料；网址填 `ftp://example.test/synthetic` 保存，出现“请检查：网址。”；改为 `https://example.test/ok`，展开更多账号资料，核实日期填 `2026-02-30` 后点保存。DOM 原生日期 `validity.valid=false`，`validationMessage=请输入有效日期（年-月-日）`，表单旧 alert 仍为“请检查：网址。”。取消、刷新后普通账号数严格0。

初始补充脚本错误地要求新的自定义日期 alert，实际浏览器原生校验先拦截，所以该断言失败不能称“日期被写入”。独立诊断后确认的是已经纠正的网址错误未清除，造成当前反馈误导。原脚本 `validation-edges.mjs`、诊断脚本 `validation-edges-diagnose.mjs` 和原目录图保持不动；失败截图已实际打开并复制至 `independent-final-398cdb/se16-invalid-date-retains-old-url-error.png`，结构记录见同目录 `se16-failure.json`。

## 已闭环部分及历史边界

398c 本版对旧SE13错误遮挡、SE14触控小于44、SE15永久删除误称导入的原路径均通过。SE05真实UI前仅一次原生passwordVault写入故障准备，明确部分成功，双击重试及刷新解锁后严格1普通账号＋1密码；SE15故障保留回收站，错误为通用操作文案，取消后继续原恢复；主控另实际完成删除成功/刷新与损坏KDBX导入文案对照。模拟故障、剪贴板拒绝和Node虚构KDBX均标为准备，真实UI操作未用私有API代替。

白盒只读复核普通/KDBX秘密边界、预验证、稳定账号ID重试、锁定竞态找回、busy与重复点击、锁定时立即隐藏私密草稿/手动复制、共享容器44px以及操作/导入错误上下文。当前新增SE16是UI验证反馈残留；不改写为数据失败。主控修复和本版根gate/平台检查由主控另列，不能代替独立结论。

修前2c5c三个有效失败、494原14/20与SE13、7a原20/20及相邻6/8的SE14、cc阶段SE15及toast准备观察修正全部保留。源码诊断从未冒称编译包通过。本报告不扩成全项目、正式发布、原生真机或云端CI结论；本候选因SE16未完成，待新clean包按原20＋8及新增连续校验路径复核。
