# 可选自部署同步服务

阶段 3 的基础同步服务使用 Hono、PostgreSQL 事务与工作区成员表。服务端只保存密文和路由元数据。`POST /workspaces` 由已验证主体创建工作区；`POST /sync/push` 和 `POST /sync/pull` 每次在数据库内核查工作区读写权限。重复 `operationId` 幂等，期望版本不匹配返回冲突，墓碑不会被普通写入复活，拉取按工作区序号分页。

本仓库当前可自部署的认证入口是单主体长随机 Bearer token。将来接入 Better Auth 时替换 `Authenticate` 回调，不得把提交的工作区 ID 当身份凭据。正式多人官方服务、设备加入/恢复/撤销与端到端密钥协议尚未通过验收，不应对外开放同步服务。

本机运行时先设置 `DATABASE_URL` 和至少 32 字符的 `KEEPANY_SYNC_TOKEN`，再执行：

```sh
pnpm exec vite build --ssr apps/sync-server/src/main.ts --outDir apps/sync-server/dist
node apps/sync-server/dist/main.js migrate
node apps/sync-server/dist/main.js
```

Docker Compose 文件位于本目录。需在 Compose 环境设置 `POSTGRES_PASSWORD`、包含 URL 编码密码且主机为 `postgres` 的 `DATABASE_URL`、`KEEPANY_SYNC_TOKEN`，然后在仓库根目录运行 `docker compose -f apps/sync-server/compose.yaml up --build`。服务只绑定宿主机 `127.0.0.1:8787`；需要外部访问时自行配置 HTTPS 反向代理。

## 密文附件接口

设置 `KEEPANY_S3_BUCKET`、`KEEPANY_S3_REGION`，并按存储提供商设置 `KEEPANY_S3_ENDPOINT` 与访问密钥。未设置 bucket 时附件接口返回 503，不影响记录同步。服务端使用 AWS SDK v3 的 S3 API；对象键由服务端按 `workspaceId/attachmentId` 生成，调用者不能指定 bucket 或对象键。

`PUT /workspaces/{workspaceId}/attachments/{attachmentId}` 使用 Bearer 身份、`Content-Type: application/vnd.keepany.ciphertext`、`X-Ciphertext-SHA256: <64位小写hex>`，请求体为 1 字节至 4 MiB 密文字节；成功返回 201，同 ID 与相同字节重试返回 200。请求哈希不符返回 400，相同 ID 不同哈希返回 409。`GET` 使用同一身份，返回相同 MIME 与哈希头；每次读回都校验 S3 字节的长度和 SHA-256，不符返回 502，待上传记录返回 404。每次数据库操作重新核查工作区成员权限。请求体和对象字节不写入应用日志。

上传先在 PostgreSQL 留 `pending` 元数据，S3 写入成功后才标记 `ready`。网络中断后客户端须用相同工作区、附件 ID、密文字节和哈希重发；若 S3 已写入而 SQL 确认中断，重发会覆盖同一对象并完成确认。服务端只能验证传输字节一致性，**无法证明客户端确实加密**；MIME 只是协议声明。SHA-256 不验证密文的真实性，解密和 AEAD 认证必须由客户端执行。尚未实现分块上传、孤儿对象清理、对象版本锁、真实 S3/R2 联调及附件与资产引用的服务端生命周期联动。

已用 PGlite 执行实际 PostgreSQL SQL，覆盖幂等、版本冲突、租户隔离、墓碑、分页和 HTTP 拒绝；附件以本地对象存储 mock 测试权限、失败重试和哈希读回，并用本地 S3 兼容 HTTP mock 验证 AWS SDK 签名 PUT/GET。当前机器的 Docker daemon 未启动，尚未完成真实 PostgreSQL 多连接并发、干净容器部署、TLS/反向代理、真实 S3/R2 与认证服务验收。
