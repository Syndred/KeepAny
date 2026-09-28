# 阶段 0 同步实验

`SyncService` 接受版本化密文写入，按工作区分配序号和记录版本。`operationId` 重复投递返回 `duplicate`；同记录版本不符返回 `conflict`；墓碑只能通过明确的 `restore` 意图和当前版本恢复。`createSyncApp(service, authorize)` 提供 Hono `/sync/push`、`/sync/pull`，调用方必须注入身份与工作区授权。

`JsonFileSyncStateStore` 是单进程实验存储：每个操作先原子替换 JSON 文件再确认成功。它不能承担多进程或多副本并发生产流量。生产服务仍需 PostgreSQL 事务、租户鉴权、游标保留策略、速率限制和密钥管理。

拉取变更包含写入时的 `operationId`，旧 JSON 状态会从已接受操作的持久结果回填。v2 加密信封绑定客户端可预知的 `expectedVersion + 1`，服务端工作区全局 `sequence` 仅用于游标；拉取方从外部变更元数据构造预期 AAD 并验证。旧 v1 信封仅在预封装 `sequence` 恰与服务端实际序号一致时可读取，旧快照迁移边界见 `packages/crypto/README.md`。这只是协议原型，正式加密同步仍需真实设备与持久状态验收。

本地端 `LocalRepository.applyPulledBatch(changes, cursorStart)` 先写 Dexie 操作日志，逐条写入 RxDB，再在同一 Dexie 事务内提交游标和删除日志。重开会重放未完成批次；同记录本地编辑冲突时保留本地内容与原游标，并设置 `syncRecoveryError`。冲突解决界面尚未实现，不能宣传自动合并。

运行 `pnpm exec vitest run packages/sync-core/src packages/local-db/src` 可复现阶段 0 断网重试、重复 push、两设备离线同字段冲突、墓碑与跨类型中断恢复。双设备测试使用测试专用共享 AES-GCM 密钥；它不证明设备加入、恢复密钥、撤销、跨设备密钥轮换、附件分块认证、真实网络故障或外部部署安全。正式云同步需先完成这些门槛。
