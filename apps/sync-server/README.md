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

已用 PGlite 执行实际 PostgreSQL SQL，覆盖幂等、版本冲突、租户隔离、墓碑、分页和 HTTP 拒绝。当前机器的 Docker daemon 未启动，尚未完成真实 PostgreSQL 多连接并发、干净容器部署、TLS/反向代理、附件对象存储与认证服务验收。
