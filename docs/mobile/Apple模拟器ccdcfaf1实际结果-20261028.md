# Apple 模拟器 ccdcfaf1 实际结果

2026-10-28。本回执只记源 `ccdcfaf1d09884d07232f0f7ce759366212b11da` 的真实 Apple run40617847477／job122584427105；不继承旧轮结果，也不把 Android、Windows 静态门槛当成本轮 iOS 通过。

## 实际完成范围

App 编译成功；真实 loopback TLS MCP Core **29／29通过**。UI 日志只有以下5个 case 明确完成通过，未得到8项完整 suite 结尾：

| UI case | 实际结果 |
|---|---|
| 中文原生日期输入 picker | 通过，25.113s |
| 中文原生语言导航 | 通过，14.775s |
| 英文原生日期输入 picker | 通过，19.670s |
| 英文 Native MCP Prepare／不导出／Activate禁用／无grant／Stop | 通过，120.679s；不外推真实电脑配对／写审批 |
| 英文普通项目保存、终止应用后回读 | 通过，65.548s |
| 中文完整项目文字字段 | 保存前精确文本断言失败，134.992s |
| 英文完整项目文字字段 | 已首次保存／冷启／取消修改，进入再改Name前被中断；没有完成 rename 或case通过 |
| 普通待办完整case | 未开始 |

## 中文全文输入真红

`KeepAnyUITests.swift:363–398` 的 `replaceProjectText` 正式tap后只调用一次 `typeText(value)`，等待完整 value 20秒，然后在396行精确比较。此次中篇文本期待 `Synthetic medium zh-Hans\nSecond medium line`，实际为 `Synthetic medium zh-H\nansSecond medium line`：字符保留但换行位置错了。输入后的等待与保存前断言正确拒绝该值，后续Save未执行。

这不是上一轮category末尾单LF的语义归一化问题；不能trim用户文本、删换行或修改expected。当前证据仅定位到原生typeText／受控字段接收后值已错位，尚未证实键盘事件、文本控件或React更新的具体因果；本片不改产品或驱动。

## 英文中断与清理时序

官方 REST 原始step时间为UTC；Session日志为无offset的同轮runner时钟，时间线一致：

| 时刻 | 实际证据 |
|---|---|
| 02:09:38 | Core后开始Install／launch step，配置 `timeout-minutes:25` |
| 02:17:58附近 | 首个UI case开始；step此前已用于启动、安装与test构建等准备 |
| 02:24:19.199 | 英文完整字段case开始 |
| 02:34:52 | Install／launch step已结束为failure，实际25m14s；转入诊断清理step |
| 02:35:42.097 | Session line2057640记录pid1252 death notice，exit code null、signal9；位于清理step内，晚于失败step结束50.097s |
| 02:35:50 | 诊断清理step结束 |

英文UI最后在约683.72s报告Name snapshot丢失：`mach_error=10000003`／helper endpoint失联。源码335行仍在 `tapProjectControl` 的AX存在性／frame guard，尚未执行重命名typeText或Save。接着XCTest启动crash-report检查；**检查动作本身不是发现了crash报告**。

workflow清理阶段明确执行 `simctl terminate` 与shutdown。上述时序强支持25分钟step截止后清理导致中断，不能把signal9写成App自主崩溃、内存不足或产品保存失败。官方job日志connector本次重取返回Transport closed，尚未取得runner明确timeout原句，因此不把具体取消发起者写成额外已证事实。

已在ZIP中流式扫描231277341B Session、165233564B App stdout、470906B runner stdout及53193885B runtime；仅固定码／进程metadata入ignored证据，不展开大日志或保存字段正文。所扫日志未见EXC／SIGABRT、Jetsam／memorystatus／memory-pressure等自崩或低内存证据；这只限已收日志，不代表排除所有OS原因。最终PNG仍为应用编辑界面，不能据其独立裁定此前进程生命周期。

## 签名与SQLite观察范围

本轮实际有 `signature-compile.json`、`signature-installed-before.json`：ad-hoc／codesign verify／bundle／主binary和debug body比对／模拟XML与DER身份校验都为true；两个fat架构模拟段均精确AppID且无共享组。host签名字典为空不是本轮错误。

**本轮缺少test和installed-after两阶段文件**，不能继承旧轮四phase闭环。Core29与MCP Prepare／Stop实际通过也不能替代缺失的后两阶段或外部客户端流程。

SQLite observer正式达到baseline-ready，normalStop=true／exit0／health healthy；354次成功query，1个英文original snapshot，英文rename0／中文0，`verification.complete=false/status=partial`。114次container-resolver-timeout与2次query-timeout是保留的历史计数，不能当当前fatal，也不能用后续恢复健康把缺失字段证明补绿。普通待办未开始。

## 原件、状态与后续

官方artifact12788100518：62179271B，SHA `215565c8f60dd2656cfd82c70b7863e92098c86bbcf06c06f3c1ff2c054d9382`。Root已核217条ZIP路径／类型／总展开预算；原包在ignored `test-results/ios-ccdc-review/artifact.zip`，23项有界文件在`contents-v3`，大Session／stdout／runtime保在ZIP中只流式读取。

本片固定码扫描与官方step元数据：`test-results/ios-ccdc-review/peer-triage/`；`findings.json` SHA `fd55443201f04840822474a6b4588ddbffe5ab7d640fe6451c302d80f9fb4059`。没有设备、浏览器、构建、生产／Swift／CI修改或push。仅新增此独立回执；原报告保留。后续需单独定位中文输入事件，并将英文尚未完成的rename／普通待办在未被准备阶段耗尽的真实执行窗口内完成，仍保原完整字段与SQLite证明要求。
