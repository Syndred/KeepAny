# 本地数据 API

- `database()`：仅保留 Web RxDB 诊断兼容；页面用 `localRepository().observe` 订阅同一仓库。业务包络仍为 `RecordRow {id,type,payload,updatedAt}`。
- `save(type,value)`、`deleteEntity(type,id)`、`restoreEntity(type,id)`：Zod 校验、本机保存、墓碑与显式恢复。`save` 不会意外复活已删除资产。
- `saveBatch([{type,value}, ...])`：只新增 ID，整批预校验，写入前创建 Dexie 回滚日志；局部写入失败或重开时撤销本批已插入项。适合 CSV 候选项经用户确认后导入；不处理已有 ID 的覆盖合并。
- `openLocalRepository(name)`：打开独立测试/设备库；`get`、`list`、`allRecords` 与 `close` 在实例上提供。
- `putFile`、`fileUrl`：图片二进制存 Dexie，资产仅引用 UUID。调用 `URL.revokeObjectURL` 释放展示 URL。
- `exportArchive`、`inspectArchive`、`restoreArchive`：ZIP 包含记录、墓碑、关系及原图，预检格式、哈希、引用和冲突。导出的是**明文 ZIP**；向用户提供私密备份时须先调用 `encryptBackup`，恢复时先 `decryptBackup`。
- `applyPulledBatch`、`syncCursor`：同步客户端批次落盘与游标恢复。它们不自动推送本地修改，也不解决冲突。

阶段 0 测试用 `fake-indexeddb` 验证离线重开、备份恢复、回滚、冲突和恢复日志。浏览器清理/配额、大文件及设备差异仍需真实浏览器实验；备份体积目前限压缩后 100 MiB、解压后 300 MiB，超限需要后续流式归档。

## 手机仓库接口（2026-10-27）

`storage-contracts.ts` 限定记录后端为 ID／类型查询、插入、带 revision 的条件批次写入、可重试修改、内部删除与变更订阅；不提供通用 RxDB 查询语言。`web-storage.ts` 适配现有 RxDB／Dexie，手机后端由 `packages/local-db-native` 提供。业务 `payload.deleted` 是可恢复回收站；`internalDeleted` 只用于内部撤销，不能混用。

原生入口在页面读库之前调用 `registerRepositoryFactory`；通过 `openRepositoryFromBackend(records, fileStore)` 复用全部领域校验、持久 intent 重放和 `.ka1` 原格式。导入本模块不会创建默认 Web 库；已注册原生工厂的失败只重试原工厂，不退回 IndexedDB。`files` 是仅为 Web 保留的惰性兼容句柄，手机不能使用它。

每个侧表事务显式向回调传入 `scope`。回调、其内部的 `LocalRepository` 与审核／分类 helper 必须使用 `scope.records` 和 scope 的表；不能闭包捕获根仓库去排队等待自己持有的原生事务。原生根操作由后端串行调度，事务 scope 复用自己的连接；不得使用全局 `transactionActive` 让无关请求混入。

Web 的 `outsideTransaction` 保留记录与侧表两个物理库的提交方式；原生可在同一 SQLite 事务中提供更强原子性。首次 intent 仍必须先独立持久提交，后续失败才有可重放依据。侧表对象中原有 `Blob`／`Uint8Array` 保留类型；原生实现将原图、KDBX 密文及日志中的二进制外置到持久目录，只在 SQL 保存引用，不能通用 JSON 序列化成普通业务字段。

`observe` 合并记录和侧表的实际提交事件，并用读取代际丢弃迟到快照；失败不清空已显示资产。针对性回归覆盖工厂无 Web 回退、Web HMR、CAS／续费／审核／分类 intent、图片和 KDBX／备份恢复、迁移及 MCP 最终授权，不能据此声称已完成手机设备验收。
