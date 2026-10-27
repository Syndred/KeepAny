# PDF 官方 fallback 原有失败回执（2026-10-28）

## 实际红与边界

在初始化 Worker 所有权补丁相邻探针中，合法小 PDF 的 Worker 构造失败、异步模块加载失败两项均未生成预览。用隔离 Vite alias 仅将 PDF legacy display main 指向未补丁官方 6.3.289 文件，元数据确认原文件路径后，同两项再次复现，故不能归为 pendingWorker 补丁引入的回归。

这不是把 5 秒断言失败当成产品超时：有效基线在等待故障确实发生并恢复 input 后，正式页面明确显示 `pdfInvalid` 对应无法读取、可能损坏或受密码保护的提示。测试文件为合法 PDF，未替换解析结果；普通写入不经过测试绕行。

| 基线分支 | 故障证据 | 实际结果 |
| --- | --- | --- |
| 构造失败 | 仅正式 PDF module Worker 构造抛合成 SecurityError，faults=1 | input enabled，preview 0，pdfInvalid；未产生 raw Worker，terminate 0 |
| 异步模块失败 | 真实 module Worker 加载不存在的模块触发 error，faults=1 | input enabled，preview 0，pdfInvalid；原 Worker terminate 1 |

有效基线总耗时 19802.161ms，2 failed / 0 skipped。原补丁矩阵为 4 项通过、这 2 项失败，不写成 6 项全绿。现有测试保留强要求，应能在正式 fallback 正常时解析合法 PDF，不接受错误提示当通过。

## 定位与待修

固定上游 [6.3.289 display 源码](https://github.com/mozilla/pdf.js/blob/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/src/display/api.js) 的 fake-worker loader 动态导入 workerSrc 并读取返回模块的 `WorkerMessageHandler`。当前应用 `pdf-worker.ts` 只有兼容导入与 worker side-effect import，未显式 re-export 该符号；生产 Vite worker 格式亦需核对。

这只是目前得到源码支持的接线原因推断，尚未捕获底层 namespace 错误原值，不能称确切异常栈已证实。测试已证明现有正式 UI fallback 不可用；源修复待主控分配，当前不改 worker 入口或 Vite 产品配置。即使修复小样本 fallback，也不能宣称主线程 CPU 已获得原生 worker 式强制中断能力。

## 证据与试验前置

- `test-results/pdf-timeout-cleanup/fallback-baseline-verified.log`：SHA256 `bd817783ad8eeb5212311ea331d09add5ef812eecce0c551ff9244ca44736e70`。附加 JSON 包含 input/fault/terminate/正式 notice。
- `test-results/pdf-timeout-cleanup/pending-observations.jsonl`：SHA256 `46c3dc7a9230270d50d76cb70b9fedf034d3344111e453637d738df19b38eeb7`。
- 正式补丁包的 `pending-verified.log` 和基线输出、trace 均保留；失败截图不提交 Git。
- 首次 baseline 辅助配置误用 Windows URL.pathname，产生 `C:\C:\...` 缓存路径错误，未满足前置；记录在 `fallback-baseline.log`，不计产品证据。只停止本次两个精确匹配的自身 Node 进程，用 `fileURLToPath` 修正后得到上述有效基线。没有停止任何他人进程或反复安装缓存。

所有操作使用独立 4238；无 Android/iOS 设备操作，无 Native 因果推断，无推送或 CI 操作。
