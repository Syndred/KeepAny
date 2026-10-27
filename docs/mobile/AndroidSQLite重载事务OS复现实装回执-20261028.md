# Android SQLite 重载事务：独立 OS 复现

## 实际结论

在唯一自建 emulator-5580 上，指定未补丁 SDK instrumentation 实跑 **2 项、1 成功、1 真实失败**。真实 WebView 文档替换、旧 continuation=0、重开与 WAL/FULL/基线检查均完成后，第一条新 BEGIN 在约 **2650ms** 后拒绝，固定错误为 `first-begin-after-reload/database-locked`。未降低期望或把预期红计为测试通过。

这是正式 Android SQLite SDK implementation + 专用单线程 + 真实 WebView 文档替换的独立合成 OS 复现，未走完整 React/Capacitor JS bridge 业务链。它与 N20 正式 UI 启动红互补，不代替该 UI 的修复后验收。

## 身份与授权边界

先阅读复现目录 README 与完整 Java 源码，仅安装：

- `test-results/native-sqlite-startup-investigation/SqliteReloadTransactionTest-unpatched-N20-androidTest.apk`，实际 608340B，SHA256 `7b0c868a748a24487141026ff3bfd542e5d9648b37f10e7d7eb5fb975dc922ce`。
- 唯一指定 class：`io.github.syndred.keepany.SqliteReloadTransactionTest`；runner：`io.github.syndred.keepany.test/androidx.test.runner.AndroidJUnitRunner`。
- 固定 SDK `@capacitor-community/sqlite@8.1.1`，正式 N20 主 APK 没有安装、重建或替换；没有执行其他 class、AI 请求、原库/135/70读取、恢复或清数据。

主控明确授权 `am instrument` 替换 target 主进程。原失败 PID 在安装 test APK 后仍为 17586，随后 instrumentation 启动会替换该进程、释放旧现场锁。**不能把这一进程边界后的可打开状态称作自愈或修复**；本批没有打开 MainActivity 做此尝试。

## 两项实际结果

| 项目 | 实际结果 |
| --- | --- |
| `a_committedClosePreservesAnotherLiveConnection` | 通过。两个随机合成 DB 各自提交 baseline；精确 close primary 后另一连接仍 live、字段/ID保持；primary 正常重开、BEGIN/ROLLBACK 成功。 |
| `b_documentReloadUncommittedTransactionMustRollbackBeforeReopen` | 真实失败于首新 BEGIN，非前置失败。旧文档开始未提交事务并写合成 marker，真实新文档替换完成，旧 resolver 消失、oldContinuationCalls=0。官方 empty consistency 后重新 create/open、WAL/FULL、精确 baseline 与无未提交 marker 可见检查均成功；719ms 发新 BEGIN，3369ms 拒 database-locked。 |

失败项的 finally 仍实际重开另一随机库并验证 baseline 字段/ID保持。empty consistency 本身会关闭此独立 SDK 实例管理的全部连接，故这一项只能说明另一库已提交内容重开后保持；“另一连接始终 live”的验证来自第一项，不能混写。重开连接看不到未提交 marker，也不能据此称原事务已回滚；新 BEGIN 仍锁住是保留的真红。

JUnit 原输出 `Tests run: 2, Failures: 1`、`Time: 4.03`。ADB 命令退出码为 0，不作为测试成功判据。测试仅触 UUID 随机 `keepany-reload-probe-*` 合成库，没有生产 SDK 修改；未在新 BEGIN 之前失败，也未删断言、skip 或重跑成绿。

## 清理与进程状态

Java 测试自行销毁 WebView、退出专用 HandlerThread，清理没有孤儿事务的精确自有文件。失败 primary 按设计留在 deferred：

`keepany-reload-probe-8befb083-438d-42c2-b86b-f140f36a2004`

本 owner 未清该文件或 sidecars，等待主控。结束只读核验：target pidof 为空（exit 1）、无匹配 keepany/test 进程、无匹配活动 instrumentation；forward/reverse 列表均空，没有 CDP/controller。READY 仅指本次工具已结束，不表示原 App 页面恢复或原启动红已关闭。从此停止 ADB，等待明确新任务。

## 原件、未完成与提交

本机忽略目录 `test-results/native-sqlite-startup-investigation/os-unpatched-n20/` 保留完整输出及固定安全 JSON（仅阶段/耗时/固定类别/自有 DB 名，不含 SQL、原错误正文或用户字段）：

| 文件 | SHA256 |
| --- | --- |
| `instrumentation-full.log` | `2eb29e1bb4e1e5f8c2a1d306d8db6883bd434da66098d4de13a199a6e761e00a` |
| `safe-results.json` | `ff2fcd4b9ac22dcab191519021ba42d2faea9c1f4638bbccef5b29f6ffea417b` |
| `before-install-state.json` | `c04ec53e243e48ab1094c9fc4f5a4b1cf3a005d87c139d72b7132cc497b4ba1c` |
| `after-process-state.json` | `cdd8462d734beb64cdf3ffb8ed44b8abc122d7ffca272794eaeddf11a0314e50` |
| `instrumentation-exit.json` | `3a02e4bdd78fbc95b31fff46d019eccfa17a43a8b4428995a6aff7417996e20c` |

下一步由主控决定 SDK 修复及同合同红→绿，随后仍需正式 UI 重载/资料保持和两语正常 AI 正文补证。物理 Android/iOS 不在本片。已 fetch origin/main、无远端缺失；只提交本新增回执，未改共享 README/表/08/产品、未 push/触发或取消 CI。
