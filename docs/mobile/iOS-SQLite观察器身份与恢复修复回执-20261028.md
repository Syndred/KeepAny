# iOS SQLite 观察器：身份与恢复修复回执

## 本轮结论与原始失败

这是测试证据基础设施修复，不改 App、SQLite 数据或 UI 业务断言，尚未在 Apple 执行。不能据此核销项目全字段、同 ID 改名或 MCP Prepare 的 Native 验收。

实际 Apple `20ffd3f9` 的原始 artifact 保留在本机 `C:/Users/Administrator/.codex/toolchains/keepany-mobile/evidence/ios-ci-20ffd3f9/contents/`：Core 29/29；UI 8 项中 5 成功、3 失败。`ui-tests.log` 中两语项目测试停在第 346 行分类控件 AX 前置，英文 MCP 测试停在第 276 行 Save 可见性前置，均未到本片所需完整保存链。观察器 `summary.json` 为 744 polls、312 successfulQueries、427 database-missing、5 query-timeout、0 marker、normalStop=true，verification=observation-error。

0 marker 不构成数据库丢失证据；427 次 missing 也不能证明容器已换代。已证实的静态问题是 workflow 在 xcodebuild 前冻结路径，以及任何累计错误会永久否决后来完整、健康的读取。本片修复这两项，不追认原失败为成功。

## 改动与安全边界

- workflow 仅观察器块改用精确 simulator UDID + bundle ID。每次查询前后分别以 `xcrun simctl get_app_container <same-UDID> <same-bundle> data` 解析，不搜索其他数据库，不回落到启动时旧路径。解析结果须匹配该 UDID 的 `data/Containers/Data/Application/<UUID>`，真实目录/数据库均拒绝符号链接或非 regular 类型。
- 以规范路径摘要及设备号、inode、birthtimeNs 摘要跟踪容器/数据库身份；查询前后必须一致，未证明的结果全部丢弃。不同容器路径仅能在尚未见到任何 marker、无 fatal、前后 OS 映射稳定时建立新 generation；旧代去重/阶段证据不混入新代。同路径容器目录或数据库 inode 替换、marker 后换代、解析身份不符均永久 fail closed。
- live 模式每代首次健康查询建立 baseline，排除当时已有的 marker ID 与名称；它们以后改名也不计本轮证据。baseline 中见到 marker 同样禁止后续换代。新输出逐条带 generation 和身份摘要，不输出原容器路径、SQLite 错误正文或其他表。
- `health` 区分 waiting / unavailable / healthy / blocked，`errors` 和 `lastError` 保留历史诊断。初始未创建数据库为 waiting。timeout/busy/暂时解析失败，只有后续相同身份被前后完整证明健康后才能恢复；未确认查询身份保留至成功，不能通过超时后换文件恢复。损坏、无证明身份、非 regular、非法行及未知错误均保留 sticky fatal。
- 原 full payload（除 name/updatedAt）、两语各唯一 marker、原始阶段先于改名、相同 SQL/payload ID、原查询/输出限制保持。正常 SIGTERM/SIGINT 仍只清理自身查询子进程并等待 close，normalStop 不伪装完整业务证据。写 summary 的固定错误映射移入该函数，finally 仍 await 写入，失败仍抛 output-unavailable。
- 独立观察器 gate 要求 normalStop、真实 simctl resolver、baseline 已建立、当前 healthy、无 fatal、完整阶段；DI 或静态绑定不能通过该 workflow gate。xcodebuild 的 8 项真实 UI 成败仍是独立 gate，没有 continue-on-error 或互相替代。

## 本机实际验证

`node node_modules/vitest/vitest.mjs run scripts/observe-ios-project-fixtures.test.mjs`：保留原 18 项，新增 15 项，合计 **33/33**；实际 7.68s。新增使用真实合成 SQLite/文件及受控 resolver DI，覆盖：

1. 初始 missing 后创建数据库，完整原始/改名证据恢复；同身份 timeout/busy 后恢复，历史计数仍留。
2. 真实损坏字节后恢复同文件仍永久阻止验收；默认 sqlite 错误分类仅固定 corruption code。
3. 同路径数据库替换（包括第一次 timeout 后替换）、同路径容器目录替换、非 regular 数据库均拒绝。
4. pre-marker 稳定新容器只采新代；旧 baseline 的原始/改名均不计新 UI；marker 后换代及 query 前后换代不混合、不追加。
5. exact UDID/bundle/路径验证；暂时 resolver 不可用后同身份恢复；错误 tuple 永久拒绝。
6. 真实本机子进程 1500ms timeout 与在途 abort，均等待自身 close，无遗留 resolver；原查询 deadline/normalStop 清理用例仍通过。
7. 两个只读 CLI 均使用 SIGKILL 强制终止精确 owned child。新增子进程安装 TERM handler，分别测 deadline 和 ready 后 abort，必须实际 close 且 4500ms 自救定时器未触发才通过。Windows 的 SIGTERM 本身也强制退出，故本机只证明真实子进程退出/清理与 SIGKILL 配置；同一测试在下一 macOS 才能实际证明 POSIX 忽略 TERM 仍有界，尚未提前称 Apple 绿。此前 SIGTERM + 无界等待 close 的风险修复保留原 1500ms deadline，不提前 reject 留进程。

两个文件 `node --check`、定向 Biome lint、`git diff --check` 通过。独立 C gate 探针执行 workflow 实际 gate 表达式：合成完整健康=exit 0；缺阶段、fatal、DI resolver、非正常停止、原 20ffd summary 均 exit 1。该探针不是 Apple/OS 结果。

证据均在忽略目录：

- `test-results/ios-observer-recovery-final.log`，SHA256 `19785481633856b5469435bc4ff2e595a00cf2677b5460fe87384e76d0ad7b1f`。
- `test-results/ios-observer-recovery/workflow-gate-results.json`，SHA256 `f1dead8e87a6ca6e3cc97bd90b441bab3f58731b4194139a252165581afea6a6`。

## 开销、未完成与交接

每次健康 poll 增加前后各一次 simctl，初始化另一次；每个子进程独立 1500ms、16KiB 输出上限，原 SQLite 1500ms/2MiB 和串行无重叠 poll 保持。deadline/abort 均只 SIGKILL 自身 child 并等待真实 close，不发送全局 kill。极端单轮三个 deadline 累计可达约 4.5s，再加 OS 强制退出/close 的调度和 1s 间隔；不是无限堆积的并行 simctl。summary 新增 resolver/query 调用数、累计及最大 wall time，供下一 Apple artifact 读取实际开销。本机 7.68s 是 C 矩阵时间，不能替代 macOS simctl 延迟，后者未实测。

下一轮仍须 Apple 真正跑原 8UI、取得新摘要/逐阶段 NDJSON 并核对原 ID/所有字段；UI 前置由主控另修，本片不修改或放宽。未 push、触发/取消 CI、操作 Android、读取密码库或改用户资料。已 fetch origin，当前提交包含 origin/main，无缺失；共享分支其他变动不在本片所有权内。
