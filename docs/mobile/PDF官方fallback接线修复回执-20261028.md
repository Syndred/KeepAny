# PDF 官方 fallback 接线修复回执（2026-10-28）

## 完成与真实红绿

修复了已由未补丁官方基线复现的两项原有红：真实 Worker 构造抛错、异步模块加载错误后，合法 PDF 现在均由官方主线程 fake-worker fallback 提取出完整预览，输入恢复，普通 asset/history 仍为 0。开发和最终生产配置均实际通过；原失败回执与日志保留，不改写旧记录。

先做的隔离诊断获得实际错误 `Setting up fake worker failed: "Cannot read properties of undefined (reading 'setup')".`，并实测原 workerSrc 的模块 namespace 为 `[]`、`WorkerMessageHandler` 为 undefined，确认不是依据文件字符串猜因。

随后先尝试源转导出 + ES 格式：dev 两项绿，但生产两项仍红。产物实际缺导出；固定安装的 Vite 8.3.1 `dist/node/chunks/node.js:25982` 在 worker 构建中设 `preserveEntrySignatures:false`，会删除入口导出。该安装文件 SHA256 为 `5a604cb8f97126675dbdf9044c919b0fd1fe1280bfa4077de225e6adfa213e4a`；对应 [固定版本上游 worker 插件源码](https://github.com/vitejs/vite/blob/v8.3.1/packages/vite/src/node/plugins/worker.ts)、[官方 worker 配置](https://vite.dev/config/worker-options.html)、[Rolldown 入口导出配置](https://rolldown.rs/reference/InputOptions.preserveEntrySignatures) 和 [公开插件 API](https://rolldown.rs/reference/Interface.Plugin) 均已核对。

## 最小正式改动

- `pdf-worker.ts` 保留官方 core-js shim，公开转导出官方 legacy worker 的 `WorkerMessageHandler`。未复制或改写解析器、握手和官方全局初始化。
- 共享 `apps/web/pdf-worker-options.ts` 用官方 `worker.plugins` 的 `options` hook，仅精确匹配正式 PDF worker 绝对入口路径时保留严格导出；非 PDF 输入原 options 原样返回。网页与手机 Vite 只引用这份 worker 配置，不改 PWA 策略。实际应用源码只有这一处 `?worker&url` 引用。
- 上游包没有 worker 模块声明，新增精确的 `pdf-worker-modules.d.ts`，只声明该单个模块导出的 handler 为 unknown。正式代码仅转导出，不伪造内部 setup 类型，不使用 ts-ignore 或新增依赖。
- 测试补充主线程官方 handler、完整预览、输入恢复与普通 0 的证据。生产没有 source-module URL，生产检查只读已存在的 RxDB Dexie records/docs，数据库不存在即失败，禁止创建或写入；开发原读取路径保留。

没有改 `intake-pdf.ts`、10MiB / 20页 / 20k 字符 / 30秒预算、最低运行时、官方 fallback 机制或依赖补丁。测试中的 Worker 包装只用于故障注入；产品没有替换全局 Worker 或添加手写 parser。

## 实际验证

| 路径 | 实际结果 |
| --- | --- |
| 正式 dev 6 项 | 6 passed / 0 skipped，138695.012ms；正常、原握手丢失、双消息失 ACK 重复两次及恢复、仅 Terminate 失 ACK及恢复、两种 fallback |
| 原 PDF 与兼容矩阵 | 9 passed / 0 skipped，71182.234ms；中英 390/1280、原限制与确认、主/独立 worker 缺 API 注入断言保留 |
| 正式生产两种 fallback + 最低 API worker | 3 passed / 0 skipped，5572.202ms；两故障均 faults=1、mainThreadHandler=true、preview=1、input enabled、ordinary=0；模块错误原 worker terminate=1 |
| 网页 / 手机最终生产构建 | 均成功；相同具名导出 worker `pdf-worker-CHpl55eN.js`，1270778B，SHA256 `d2b7b27957ae448dbe8ce0ec789f238905cc6d36b3cb2b72c4ea161324734b95` |
| 生成 SW 与离线 worker 探针 | 1 passed，2224ms；隔离页面显式注册生成的 SW，activated、预缓存实际 ES worker；离线重载后真实 module Worker starts=1/errors=0、未走主线程 fallback、完整预览、普通0 |
| 类型 / lint / 许可 | 包含 worker、共享配置、两 Vite 配置的定向 tsc 通过；6 文件 lint 通过；手机生成许可含 pdfjs-dist / Apache-2.0；原材料 `--release` 核验通过 |

生产试验中，首次保留导出后预览已经恢复，但旧测试辅助代码无法在 production 导入 `/@fs/...`。这只是测试前置不支持，记录在 `preserve-production-green.log`；增加上述只读生产检查后重新完成有效验证，没有以错误计数当普通0。所有图片都在自有忽略目录，未写历史证据路径。

## 证据与未验边界

以下文件位于 `test-results/pdf-fallback-fix/`，截图、trace、产物均不进 Git。

| 文件 | SHA256 |
| --- | --- |
| `namespace-diagnostic.log` | `5596820449370b5b264e119f00b689dae510e67d84c71ece14c04aa131b4505d` |
| `production-green.log`（首轮 ES 格式仍红） | `eaf32c8c822f0e9f18b0b2ddcbcbd72f7f7515a483f180283ba527b154d38205` |
| `final-dev-green.log` | `0f901348e6afcc7700ba7d52415a3f6eb711b3b7105f3903b4947fe2b1e5fc93` |
| `regression-green.log` | `598f11cc8bc186169c9740a32ba360655b85da00b9ed2807c449ee9da73c39f0` |
| `final-production-green.log` | `3b3d5ad982cb771fdeb5f0c34b5c3a23d23f2742a36950914fc422fc137dd2f7` |
| `sw-green.log` | `24f15097000a3136ab3312cceee61482cce07798bf39f982bfa8ee1aa9293256` |
| `final-build-observation.json` | `52621002d034a4192fa6524cfc26ec4a6baafa5a206a5bbd56e84e66a13043fe` |

只证明合法小样本的官方主线程 fallback 可用；不能宣称主线程 CPU 能被 30 秒 timer 硬中断。SW 为显式测试注册，不能据此声称应用自动注册或 Native 全离线验收。最低版本真实引擎及 Android/iOS 实装未跑，本片晚于 N18，不属于旧冻结产物；无 ADB/CDP、无 node_modules 修改、无 push 或 CI 操作。原红分别保存在 `1c6eb095`、`0c48c436` 及其独立回执，本片只追加新绿。
