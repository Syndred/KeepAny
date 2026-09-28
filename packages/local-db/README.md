# 本地数据 API

- `database()`：兼容 Web 现有 RxDB `records` 观察查询；文档字段为 `RecordRow {id,type,payload,updatedAt}`。
- `save(type,value)`、`deleteEntity(type,id)`、`restoreEntity(type,id)`：Zod 校验、本机保存、墓碑与显式恢复。`save` 不会意外复活已删除资产。
- `saveBatch([{type,value}, ...])`：只新增 ID，整批预校验，写入前创建 Dexie 回滚日志；局部写入失败或重开时撤销本批已插入项。适合 CSV 候选项经用户确认后导入；不处理已有 ID 的覆盖合并。
- `openLocalRepository(name)`：打开独立测试/设备库；`get`、`list`、`allRecords` 与 `close` 在实例上提供。
- `putFile`、`fileUrl`：图片二进制存 Dexie，资产仅引用 UUID。调用 `URL.revokeObjectURL` 释放展示 URL。
- `exportArchive`、`inspectArchive`、`restoreArchive`：ZIP 包含记录、墓碑、关系及原图，预检格式、哈希、引用和冲突。导出的是**明文 ZIP**；向用户提供私密备份时须先调用 `encryptBackup`，恢复时先 `decryptBackup`。
- `applyPulledBatch`、`syncCursor`：同步客户端批次落盘与游标恢复。它们不自动推送本地修改，也不解决冲突。

阶段 0 测试用 `fake-indexeddb` 验证离线重开、备份恢复、回滚、冲突和恢复日志。浏览器清理/配额、大文件及设备差异仍需真实浏览器实验；备份体积目前限压缩后 100 MiB、解压后 300 MiB，超限需要后续流式归档。
