# M0-03 / X-07 未知 schema 拒绝与 control 守卫回执（2026-10-28）

## 完成与验证边界

本片使用随机目录中的真实 Node SQLite 数据库与真实磁盘文件，验证生产 `NativeStore.open`、`NativeDatasetManager.open` / `openActive` 的版本拒绝合同，并修复 control 初始化遗漏的检查。它是 C 层验证，不是 Capacitor SQLite 插件、Android/iOS、系统冷启或正式 Native UI 的通过证据。没有 ADB/CDP、安装、Gradle、运行服务、原用户库、26 故障候选或共享安装树操作；没有执行 pnpm 或 push。

已 fetch origin，检查时 HEAD 相对 origin/main 为 276 ahead / 0 behind；没有覆盖远端变更。只修改 control 初始化 guard、新增定向测试及本回执；原 15 个测试源码前缀保持，原 `NativeStore` / driver / schema 定义及默认迁移策略不改。

## 实际入口与首次红

- `apps/mobile/src/main.tsx` 先在 datasets 阶段调用 `openNativeDatasetManager`，再注册 `datasets.openActive` 为正式仓库工厂；repository 阶段调用正式本地仓库。
- `packages/local-db-native/src/index.ts` 的数据路径是 `openNativeDriver → NativeStore.open → openRepositoryFromBackend`。数据仓库已经在 DDL/事务前读取真实 `PRAGMA user_version`，`>1` 拒绝并关闭本次 driver。
- control 路径直接将 `openNativeDriver('keepany-control')` 交给 `NativeDatasetManager.open`，没有经过 `NativeStore.open`。原 manager 在 `BEGIN IMMEDIATE` 后直接建表和初始化默认记录，没有版本检查。
- 当前 SQLite SDK 8.1.1 的 Android `SQLite/Database.java:297–305` 与 iOS `Plugin/Database.swift:175–177` 仅在目标版本大于现版本且有升级配置时执行升级；不能依赖该代码替 control 拒绝未来版本。这里只读源码，不把它当 OS 实跑。

首次复现先由正式 manager 创建随机磁盘 control 的完整现有结构，加入合成 active 指针、保留记录和未来 canary，再通过真实 SQLite 设置 `user_version=77`。重新调用原生产 `NativeDatasetManager.open` **错误地返回成功**。版本仍为 77，全部 logical rows、DB 字节和 active 指针都未改变，factory 调用为 0：这是“没有拒绝未知版本”的合同红，不是数据损坏或空库覆盖。

原件保留在 `test-results/native-future-schema/`：

| 原件 | SHA256 / 结果 |
| --- | --- |
| control-first-red.json | `5c887e3673d332226fc8a111377aeb603f7cc6928dd493b2146e4d4d2c1a960a`；accepted=true |
| control-target-red.json | `bc89f11e24757a7046d54d5c8dbe237359c74376151cdea5bf05958fcbcd9660`；对应正式 Vitest 1 fail |
| 首红随机 control | `control-c-24uIvq/control.sqlite`，仅本任务合成元数据，保留未重写 |

## 最小生产修复

`NativeDatasetManager.open` 在任何 `BEGIN`、DDL 或 DML 之前查询真实 `user_version`。保持现兼容：control **0 和 1 都接受，且不写回版本号**；`>1` 使用既有 `native-schema-newer` 拒绝。版本读取错误也安全关闭本次 owned control driver；close 自身失败不替换首个版本/读取错误。

没有 closeAll、数据库重命名、回退 IndexedDB、factory 重试、默认 active 重置、0→1 自动迁移或新权限/字段。没有添加负数/非整数版本新政策；此片不以未测防御扩大保证。

## 新增五个真实磁盘 C 用例

| 用例 | 构造与实际断言 | 结果 |
| --- | --- | --- |
| M0-03/X-07 数据库未来版本 | 正常完整 NativeStore 结构，完整 item payload 含 legacy title、revision/updatedAt、旧 PNG、审核 side row、实际小 KDBX 与指针，另有 future table/canary；设真实版本 77，再由 manager.openActive 进入实际 NativeStore.open | 拒 `native-schema-newer`；调用仅 version→close；factory 只请求原指针目标一次；完整 schema/全部表行/原 payload 字符串/title/指针/物理文件 hash、DB bytes、control bytes、目录清单相同；没有 fallback DB |
| M0-03/X-07 control 未来版本 | 完整 control 三表、active/retained 记录、prepared restore metadata、未来 canary，真实版本 77 | 红→绿；拒绝后仅 version→close，关闭一次；factory=0、exists=0；重开只读比较版本、schema、全部行、DB bytes 与文件清单保持 |
| 已支持 control 0 | 正式 open，再保留完整 active/catalog/restore metadata 后重新正式 open | 成功；版本仍 0；完整逻辑状态和 DB bytes 不变，无 factory/exists 副作用 |
| 已支持 control 1 | 同上，真实版本 1 | 成功；版本仍 1；完整逻辑状态和 DB bytes 不变，无 factory/exists 副作用 |
| 真实 SQLite PRAGMA 读取错误 | 随机磁盘 SQLite handle 正式关闭后查询，产生实际 closed-handle 错误；随后 owned close 同样报错 | 尝试仅本次 close；返回的错误对象仍是最初 PRAGMA 查询错误；不进入初始化、factory 或 exists |

所有 SQL 前置只在随机合成测试目录内创建场景；运行步骤调用实际生产入口。数据用例的 PNG 复用已有 local-db 合成图片，KDBX 由实际 VaultSession 创建后锁定，不是将明文或假字节当密码库；本合同验证其密文字节与指针保持，不宣称再次验收密码功能。

## 实际运行

均使用直接 Node 入口，未运行 pnpm：

```text
node node_modules/vitest/vitest.mjs run packages/local-db-native/src/store.test.ts -t 'M0-03/X-07|supported control schema|SQLite control PRAGMA' --reporter=json --outputFile=test-results/native-future-schema/target-green.json
node node_modules/vitest/vitest.mjs run packages/local-db-native/src/store.test.ts --reporter=json --outputFile=test-results/native-future-schema/full-file-green.json
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@biomejs/biome/bin/biome lint packages/local-db-native/src/datasets.ts packages/local-db-native/src/store.test.ts --reporter=summary
```

- 定向新用例 **5/5 通过**（其余 15 个是该定向命令未选择，不是删掉或 skip 产品合同）。
- 完整该文件 **20/20 通过、0 skip、10.186s**；包含原 15 个实际回归。
- tsc 退出 0；Biome 退出 0、0 error，8 个原有 non-null warning，无新增 warning；`git diff --check` 通过。
- 原 15 个归一化源码前缀 SHA256 `55d4d433aedadf5a9919617ba89fa47ce32b49d2511a63e54830feb9879d55af`，与本片前完全相同。没有重跑无关全仓套件。

| 新证据 | SHA256 |
| --- | --- |
| target-green.json | `cecec0492f9a7f75b62965c9186159de14fb0301e026ccba73be98f9174c312d` |
| full-file-green.json | `4cde70507788746b8a2abd2fc55082d0d33b95d94c7f9c3c44c87b31a4889d16` |
| source-proof.json | `87d4a627c18290191131144ce383188fe296985f907e457f81f716e0787908ac` |

## 未完成与后续 Native 安全前置建议

真实 Native 未知版本分支仍待新包与唯一设备 owner 执行。Node 适配器没有覆盖 Capacitor SDK、WAL 协商、OS 文件锁、WebView 启动和用户错误提示；不能把这里的 DB byte 相等推广为 OS 插件打开前后物理 SQLite header 必定不变。

后续只能在 Root 明确分配的**新独立合成 candidate**执行：先正式系统 picker 恢复与导出一份可回读的合成 KA1，记录实际 dataset 名、全 rows/revisions、review/journals、blob/vault 物理映射/hash；确认原库 Locked、无在途、只修改该新候选的版本元数据为未来值作为故障前置，再按正式切库/启动入口验证拒绝与错误反馈。前置 SQL 注入需单独标注，不能当无注入自然迁移。

不修改共享 `keepany-control` 的版本来做设备试验，因为它含原库/其他候选指针；control 的真实 OS 层试验需另行授权独立测试 namespace/测试宿主，不能冒充正式 UI startup 已通过。26 故障候选、原库、135/70 和历史候选都不属于此计划操作范围。没有在本片执行上述 Native 计划。

本片精确提交仅 control guard、该测试文件新增区和本报告；未 push，不取消正在执行的 Apple/CI，也不把新源结果倒灌已冻结 Native 包。
