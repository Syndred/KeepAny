# 阶段 0 同步加密原型

本目录验证 `libsodium-wrappers@0.8.4` 的版本化密文信封、随机恢复凭据、第二设备密钥授权和撤销后的后续密钥轮换。代码与测试没有真实用户密钥或服务端连接。

## 已验证的边界

- 文档信封使用 XChaCha20-Poly1305-IETF；每条消息独立随机 24 字节 nonce。v2 AAD 绑定格式版本、工作区、记录 ID 与 kind、schema 版本、密钥 epoch、**记录版本**（`expectedVersion + 1`）、操作 id 与删除标记。服务端分配的工作区全局 `sequence` 仅作拉取游标，不进入 v2 AAD。解密时使用 `openSyncChangeEnvelope` 从外部 `SyncChange` 和本机可信工作区/密钥 epoch 构造预期上下文，逐项核对后验证 AEAD；不能从信封自身取预期值。
- 恢复凭据是独立生成的 32 字节随机密钥，文本格式 `ka1_…`。它通过同一认证加密算法包装工作区数据密钥，不能由登录密码重置代替。
- 第二设备加入使用 `crypto_box_easy`；接收设备需要持有自身私钥，并从独立可信渠道取得已有设备的公钥。测试覆盖错误设备、错误发送者和篡改。
- 撤销原型只向保留设备分发新的 epoch 和新数据密钥，并生成新的恢复包装。旧设备不能解密新密文，但已经获得的历史明文或旧密钥无法收回。
- `ReplayGuard` 要求操作 id 唯一且每个记录的版本单调递增。`openSyncChangeEnvelope` 返回 `{ plaintext, context, recordVersion }`；调用者在记录写入成功后调用 `markApplied(context, recordVersion)`，并将 `snapshot()` 与业务写入原子持久化。旧 v1 信封只在其认证 `sequence` 等于外部变更的实际序号时可读取；如此读取并保存外部记录版本后，快照可转到 v2。只有旧全局序号而没有可信记录版本的旧快照遇到同记录 v2 变更会拒绝，需通过可信重建基线处理；不能按序号猜测版本。

运行：`pnpm exec vitest run packages/crypto/src/index.test.ts`；`pnpm typecheck`；`node packages/crypto/scripts/run-browser-smoke.mjs`。测试覆盖跨记录交错写入、重放、墓碑与元数据篡改，以及 v1 读取和快照迁移。浏览器烟测只使用内存中的合成密钥，不写 IndexedDB 或服务端。参见 [libsodium XChaCha20-Poly1305 文档](https://libsodium.gitbook.io/doc/secret-key_cryptography/aead/chacha20-poly1305/xchacha20-poly1305_construction)、[authenticated public-key encryption](https://libsodium.gitbook.io/doc/public-key_cryptography/authenticated_encryption) 与 [libsodium.js 官方 README](https://github.com/jedisct1/libsodium.js/blob/master/README.md)。依赖许可证为安装包声明的 ISC，正式发布前仍须核查分发内容。

## 尚未满足的上线门槛

- 这是内存中的协议原型，没有服务端租户/设备授权、可信公钥配对 UI、撤销鉴权、密钥安全存储、失窃设备处理或原子持久化接线。服务端仍会看到工作区与记录标识、时间和密文长度。
- `ReplayGuard` 快照可能无限增长；生产需要持久事务、去重保留策略和旧设备重新同步协议。`keyEpoch` 切换还需服务端拒绝撤销设备的 push/pull，不能只依赖客户端不发新授权。
- 不处理大附件的分块、清单认证和中断恢复；不负责旧 epoch 历史数据迁移或密钥销毁证明。
- 未经密码学专项审查、跨浏览器测试、真实第二设备配对、攻击演练和服务端联调，不得宣称端到端同步安全已经完成或开放官方同步。
