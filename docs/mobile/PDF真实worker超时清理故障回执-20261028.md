# PDF真实worker超时清理故障回执（2026-10-28）

## 结论与范围

**独立软件B已确认一条超时清理红，尚未修产品源。** 合法合成PDF经正式worker成功准备后，精确丢失 `GetTextContent` 和 `Terminate` 两类消息，实际35,022ms仍未返回超时提示，文件输入一直禁用、本次worker仍未被产品terminate。正常对照解析、候选及worker释放均通过；普通资产/history均0。

这是可控worker消息不响应的独立失败处理合同，**不能据此推断N17 Android 20001样本曾卡PDF清理**。主控已另行定位该Native片的PDF正确返回20k limit/input enabled，之后截图因应用在后台而挂；两者不混因。

本片仅拥有新 `tests/e2e/intake-pdf-timeout-cleanup.spec.ts` 和本回执。没有改 `intake-pdf.ts`、`pdf-worker.ts`、PDF/core-js兼容方案、AI、workflow或设备；没有安装/重装node_modules、push或触发CI。

## 官方及安装代码依据

本树安装 `pdfjs-dist@6.3.289/legacy/build/pdf.mjs`：

- `PDFDocumentLoadingTask.destroy`（22121附近）先await setup与transport.destroy，随后才调用PDFWorker.destroy。
- `WorkerTransport.destroy`（23069附近）发送 `sendWithPromise("Terminate")` 并等待它，与页面清理一起完成后才resolve destroyCapability。
- `PDFWorker.destroy`（22921附近）调用实际WebWorker.terminate。

这与[Mozilla官方API源码](https://mozilla.github.io/pdf.js/api/draft/api.js.html)的销毁职责一致。本项目 `apps/web/src/intake-pdf.ts` 用真实30秒Promise.race触发pdfTimeout，但finally仍无界 `await task.destroy()`；对方没有Terminate回复时，外层错误不能越过finally交还调用者。

这里只根据源码解释已观测的故障，不修改上游、不降低30秒/20页/20k文字/10MB限制，也不使用模拟解析结果。

## 测试方法

使用4238独立Vite server、全新浏览器context及合法自造一页短PDF。沿正式UI“收录→PDF document→选文件”；解析、文字提取、stagePdfForReview和实际仓库实现不替换。唯一注入为测试中的Worker子类：记录安全action和时间，正常转发全部消息；故障模式仅在main→worker的postMessage处丢失两个指定action，不回填任何reply或text。

此注入模拟的是确定的消息不响应条件，**不是声称worker线程本身发生了CPU死循环或浏览器真实故障**。GetDoc/GetPage等先由官方worker执行，证明故障前已完成有效文档准备。read-only allRecords仅用于核对asset/history数，不直接调用review写库或伪造成功。

两个用例：

1. 正常对照：同PDF提取出 `Synthetic timeout cleanup control`，正式候选1行、普通记录0，收到GetDoc，转发GetTextContent/Terminate，实际worker terminate=true。
2. 故障预期：丢失GetTextContent后保持等待，原30秒deadline到达后也丢失Terminate；要求原预算加5秒观测余量内出现真实pdfTimeout对应UI提示、输入恢复、产品释放worker且没有候选/普通记录。使用真实时钟，没有缩时间、skip或把失败写成成功。

## 前置排除与实际结果

首轮约14秒两项未到有效worker：workers/events均空，浏览器trace中React依赖URL的hash在一次选择后变化并重新启动Vite客户端，页面状态被开发依赖重载重置。该轮保存在 `initial-harness.log` / `initial-harness-report.json`，**不记产品red**。也避开about:blank不可访问localStorage的测试初始化问题。

有效轮在ignored配置中使用独立cache，显式预热正式PDF legacy和core-js模块，关闭HMR/watch；未放宽产品fs.allow、未重装依赖。正常对照完整绿后，故障达到预定两个action，排除了“根本没启动真实worker”的前置失败。

| 有效轮观测 | 实际值 |
|---|---|
| 总结果 | 1 passed / 1 failed，0 skipped，43.8秒 |
| 对照worker | 1个；真实GetDoc/GetTextContent/Terminate；terminated=true |
| 故障worker首个test action | performance.now约2100.9ms |
| 故障GetDoc/GetPage | 约2680.5ms，真实worker已准备文档 |
| 被丢GetTextContent | 1次，约2681.3ms |
| 被丢Terminate | 1次，约32102.4ms，距worker最初交互约30001.5ms，符合原30秒deadline触发finally |
| 故障观测窗口末尾 | 自选文件起35022ms，returnedWithinBudget=false |
| 清理/UI | worker terminated=false；inputEnabled=false；notice=[] |
| 数据 | ordinary asset/history0，reviewRows0，无假保存 |

故障断言实际失败于“非响应worker不能无限延长PDF超时”。快照在关闭context前采集；最后测试关闭自己的context/server属于测试清场，**未记为产品主动释放worker**。截图已目检，PDF输入与其它收录动作仍处busy/禁用，没有超时提示。

## 证据文件

所有原始文件均在 `test-results/pdf-timeout-cleanup/`，大图/trace不入Git。

| 文件 | SHA256 |
|---|---|
| red.log | `1fffbcd11dcdf07c6b6ebb1483ba4884a556df4fe049e6aa9a8380337353ae30` |
| red-report.json | `d4dccd5666e68e8edb9fdea7ad64a907c4b6d9718639cd6f01a06627116fb3e6` |
| red-observation.json | `fa9b59d0a9992dff9607538fe6b1ec6ec898edc11076b8eb5817ffa6e965a5dd` |
| control-observation.json | `61f43502e803cce7cc579550c63bdd6df156b6436e9671f87925b278ec438033` |
| initial-harness-report.json | `4f221be911796881a5bd159570833e2a72df27d2c5b885f4a3c3c63ca21e7cc3` |

JSON报告包含附件及准确时序；故障截图为 `browser-output/intake-pdf-timeout-cleanup-783b9-eases-the-worker-and-loader/pdf-message-loss-after-real-deadline.png`。保留对应trace.zip和错误上下文，不把测试断言打印当唯一证据。

## 检查、未完成和下一步

- 本轮fetch origin成功，未覆盖共享其他文件。新测试targeted tsc及biome lint通过，diff-check通过。4238测试server已收尾，没有监听；未接ADB/CDP或其他端口。
- 当前两条正式测试保留预期成功断言，故障测试仍红，不用test.fail/skip掩盖。此提交是故障回归及回执，**不是PDF修复完成**。
- 主控决定并分配源码所有权后，再实现有界错误清理：本次读取应握有独立worker终止控制，不让无回应的destroy ACK挡住原超时；保持正常成功清理与既有预算，需原同一故障链红→绿及正常对照相邻。当前不擅自改源或替上游destroy实现。
- Native/iOS、真实系统内存压力、浏览器崩溃等未在此片实测，不能外推。当前Apple自然运行不因本片被取消或重启。
