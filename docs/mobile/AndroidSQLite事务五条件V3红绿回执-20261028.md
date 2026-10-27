# Android SQLite 事务：五条件 V3 原红与 N21 复验

## 实际结论与原件保留

同一自建 emulator-5580 上，旧 N20 的正式 V3 合成 OS 合同为 **5 项、3 真实失败**（9.708s），新 N21 为 **5/5 通过**（2.238s）。三个原先锁住的新 BEGIN 均成功，新增写入/事务前置证明与精确回滚后置保留。只说明独立 Android SDK/SQLCipher + 真实 WebView 合同红→绿；尚不代替原 React 启动错误的正式 UI 重放、业务库保持或 AI 正文验收。

v1、v2、旧 V3 全部原件保留，旧 deferred 文件未清理。每次 instrumentation 都替换/启动 target 进程，旧/新组各自均为新进程；没有把进程重启本身称作补丁因果或原 N20 自愈。

## v2 前置不足的明确纠正

旧 N20 的 v2 实跑为 5 项中 3 失败（9.703s），a/c 的 JUnit 状态通过，b/d/e 首新 BEGIN 实际锁失败。但随后独立审查确认固定 SDK 只按 `;\n` 分割 execute script，v2 c 的同一行 UPDATE;INSERT、d 的同一行 SAVEPOINT;INSERT 不能证明后一条 marker 实际写入。

因此不以 v2 的通过状态核销写 rollback marker 或 savepoint 内层 marker 覆盖；其原锁失败和完整日志保留，不倒改为前置已充分。本批没有重跑 v2 或放宽期待。

V3 改为独立 execute，并在中断/rollback/close 前实际查询并精确核值、marker 及事务 active。正式旧 V3 Java 23674B/SHA256 `160aa8c25dfd2f797020a73a2a80143d3b0630e30dea783aec192385335546d7`，主控已提交 `9ce55b6d`；新 cleanup-safe source SHA256 `057faaf9155c29d7b0a649c905b3342743db874ffa162da46c61d41ab552d4df`。

## 冻结身份与限定执行

| 角色 | 实际字节 / SHA256 |
| --- | --- |
| 旧 N20 target（沿原已核安装包，未换主包跑旧 V3） | 23694603 / `8b06465f890d846a2f9fd2a31e43007f516400ef1d81cb32a8f6420dcd1b8ccd` |
| 旧 V3 test APK | 612676 / `e9e722593d3fe259e2bb5e6d4e130177eb9ad2ab86a784cb19aeb5f96bf9afbc` |
| 新 N21 target，install-r 后设备 base.apk 再核 | 23694603 / `fcdb05ea0d5a9db1ab3aa85c8153f51c89dbfc6b83b7ff6946aba3b410e3540e`，源 `907ff9d6` |
| 新 cleanup-safe test APK | 613100 / `1bf564dd4de42944da9d8178956adc38697f087f88370ad6b962c669439e8cba` |

仅执行 `io.github.syndred.keepany.SqliteReloadTransactionV3Test`，同 AndroidJUnitRunner，未跑其他 class。五个业务方法逐字比较相同；差异仅 reload helper 提早标记 deferred 所有权、After 在 active/unknown 时保留文件。首次尝试比较整个 After 前源码会包括这一合法 helper 差异而失败，已纠正为精确五业务方法比较；不是生产失败，也未删除差异。

## 五条件实际结果

| 条件 | 旧 V3 N20 | 新 V3 N21 |
| --- | --- | --- |
| a 精确 close 不影响另一 live 连接 | 通过 | 通过 |
| b 未提交事务后真实文档替换 | marker/active 前置成立、旧 continuation=0；首新 BEGIN database-locked | 相同前置成立，首新 BEGIN/rollback 成功，精确基线保持 |
| c 真写 commit 与真写 rollback | 改值+rollback-marker/active 均已实查，回滚后仅原 committed-v2 | 相同强前后置通过 |
| d 外层事务 + SQL SAVEPOINT 后真实文档替换 | outer/inner/active 前置成立、旧 continuation=0；首新 BEGIN database-locked | 相同前置成立，首新 BEGIN 成功，全部未提交 marker 不留，基线保持 |
| e 原生 SQLCipher 嵌套事务 close | 三行/两 marker/active/WAL/FULL 已实查，重开首新 BEGIN database-locked | 相同前置成立，新 BEGIN/rollback/精确单行基线全部通过 |

b/d 另一随机库的已提交内容在 finally 重开核对保持；它们不等于始终 live，始终 live 由 a 单独证明。所有适用 proof 布尔逐项实核 true；新组无 rejected、无新增 deferred。新三个阶段耗时为 0ms/0ms/48ms，0 只表示毫秒采样同 tick；direct 48ms 还含 rollback/基线读取，不作精密 BEGIN 性能承诺。ADB exit 0 不替代 JUnit 判定；旧组失败期待未改。

## 工具 READY 与独立证据

本 OS 片不启动 MainActivity、不读取 135/70/原业务/KDBX/配置、不发送 AI、不清旧 deferred、不杀服务。N21 install-r 保留应用数据的方式不等于本片已逐行核验业务数据；该验收须后续主控明确授权 UI 片完成。

结束实际 target pidof 为空（exit 1）、无匹配 target/test 进程、无活动 instrumentation 元信息，forward/reverse 为空，无 CDP/controller。工具 READY；没有声称产品 Locked 页面已恢复。

| 本机忽略目录原件 | SHA256 |
| --- | --- |
| `os-unpatched-v2/instrumentation-full.log` | `4673af8751436d13e88046d611bf1321fc98e0950ec572129af6511aa5c93328` |
| `os-unpatched-v2/safe-results.json` | `a9dbdb45d8ed0e4880b1c53bccb7105f6e96ea3dd52cd612c00c0c47548683bc` |
| `os-unpatched-v3/instrumentation-full.log` | `8cb6fa70d2fd9fd82051c06ad26b4bbc5e026019b1eeb8054585a21d207829bc` |
| `os-unpatched-v3/safe-results.json` | `a7dc742a86293961dc6682b419786e54f18299e1a67abd3413cadc415f71a4c0` |
| `os-patched-n21/instrumentation-full.log` | `64f5551146e38b1100c87196025c4fe4ffe3ff3242cf2970dedba6944f820ea5` |
| `os-patched-n21/safe-results.json` | `a3b74d4cce509161208071f5f131847f8ee92cb29dd22d4362c620d45bba6706` |
| `os-patched-n21/after-process-state.json` | `84fe749de2aaad1f4f728f8b3ae3f275081905739ad88597de90aab48ed1efbe` |
| `os-patched-n21/source-comparison.json` | `a0605eafdd20abc6bbd1aef56a4664e3a00aeb44e09006e8f486a1566b35f2c6` |

上述相对目录均在 `test-results/native-sqlite-startup-investigation/`，完整日志与随机 DB 名仅本机留存。只提交本新增回执，未改生产/业务测试/共享文档，未 push 或触发/取消 CI。下一步按主控另行明确授权做 N21 正式启动/切库/重载，再做两语正常 AI 正文补证；未外推物理设备或 iOS。
