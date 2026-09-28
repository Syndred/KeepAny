# 可选自部署同步服务

阶段 3 的基础同步服务使用 Hono、PostgreSQL 事务与工作区成员表。服务端只保存密文和路由元数据。`POST /workspaces` 由已验证主体创建工作区；`POST /sync/push` 和 `POST /sync/pull` 每次在数据库内核查工作区读写权限。重复 `operationId` 幂等，期望版本不匹配返回冲突，墓碑不会被普通写入复活，拉取按工作区序号分页。

认证模式必须显式选择。`self-host` 仅适合单主体自部署，使用长随机 Bearer；它不是商业绑定认证。`bound` 是受控试验模式，验证商业侧签发的设备绑定 JWT 与每次请求的设备 DPoP，并要求服务端预置已批准绑定映射。正式多人官方服务、设备加入/恢复/实时撤销与端到端密钥协议尚未通过验收，不应对外开放同步服务。

本机单主体运行时先设置 `DATABASE_URL`、`KEEPANY_SYNC_AUTH_MODE=self-host` 和至少 32 字符的 `KEEPANY_SYNC_TOKEN`，再执行：

```sh
pnpm exec vite build --ssr apps/sync-server/src/main.ts --outDir apps/sync-server/dist
node apps/sync-server/dist/main.js migrate
node apps/sync-server/dist/main.js
```

Docker Compose 文件位于本目录，明确选择 `self-host`。需在 Compose 环境设置 `POSTGRES_PASSWORD`、包含 URL 编码密码且主机为 `postgres` 的 `DATABASE_URL`、`KEEPANY_SYNC_TOKEN`，然后在仓库根目录运行 `docker compose -f apps/sync-server/compose.yaml up --build`。服务只绑定宿主机 `127.0.0.1:8787`；需要外部访问时自行配置 HTTPS 反向代理。

`003_change_operation_id` 迁移给拉取记录补上原始 `operationId`，并按旧版已接受操作的工作区序号回填；旧迁移的校验和保持不变。若旧记录找不到对应的已接受操作，迁移会回滚并报错，需先排查数据一致性，不能跳过或生成替代 ID。执行迁移后再启动新版服务。

## 设备绑定验签试验

`bound` 模式要求 `KEEPANY_BOUND_ISSUER` 为商业侧固定 issuer origin，`KEEPANY_BOUND_JWKS_JSON` 为从其 `/.well-known/jwks.json` **经受信任渠道钉住的公钥 JSON**，`KEEPANY_SYNC_PUBLIC_ORIGIN` 为客户端访问同步服务的固定 HTTPS origin，`KEEPANY_BOUND_BINDINGS_JSON` 为运营方确认后配置的数组。每项需有 `bindingId`、`subject`、`instanceIdHash`（SHA-256 hex）、`jkt`（设备 P-256 公钥指纹）及 `scopes`（`sync:read`/`sync:write`）。模式为 `bound` 时不得设置 `KEEPANY_SYNC_TOKEN`；缺少配置、未知绑定或签名/声明不匹配均拒绝。公钥轮换及绑定映射变更目前需由运营方安全更新配置并重启。

同步请求用 `Authorization: DPoP <accessToken>` 与 `DPoP: <proof>`。服务仅用本地固定 JWKS 验证 RS256、精确 issuer、`aud=keepany-sync-bound`、`sub`、`binding_id`、`instance_id_hash`、`cnf.jkt`、读写 scope 与最多 60 秒的令牌寿命；`Bearer` 和通用登录 `aud=keepany-sync` 均无效。证明须由绑定设备的 P-256 私钥签名，公钥指纹等于 `cnf.jkt`，且 `htm`、由固定公开 origin 加请求路径组成的 `htu`、访问令牌 SHA-256 的 `ath`、一分钟内 `iat` 和未用过的 `jti` 匹配。不同 `Origin` 的浏览器请求拒绝，服务不返回跨源 CORS 授权。证明重放缓存目前仅覆盖单进程，水平扩展须改为共享原子重放存储。

此模式尚无连接商业 `/bindings/state` 的服务端桥，也不保存或轮换刷新凭证。商业侧解绑、取消或到期后，**已签发令牌在剩余最多 60 秒内仍可能离线验过**；实时撤销未验证，不能对外承诺。预置映射不是自动设备绑定，也不能证明套餐当前有效。生产认证、反向代理 URL/HTTPS、真实商业服务与多实例重放仍需端到端联调。

## 密文附件接口

设置 `KEEPANY_S3_BUCKET`、`KEEPANY_S3_REGION`，并按存储提供商设置 `KEEPANY_S3_ENDPOINT` 与访问密钥。未设置 bucket 时附件接口返回 503，不影响记录同步。服务端使用 AWS SDK v3 的 S3 API；对象键由服务端按 `workspaceId/attachmentId` 生成，调用者不能指定 bucket 或对象键。

`PUT /workspaces/{workspaceId}/attachments/{attachmentId}` 使用所选认证模式、`Content-Type: application/vnd.keepany.ciphertext`、`X-Ciphertext-SHA256: <64位小写hex>`，请求体为 1 字节至 4 MiB 密文字节；成功返回 201，同 ID 与相同字节重试返回 200。请求哈希不符返回 400，相同 ID 不同哈希返回 409。`GET` 使用同一身份，返回相同 MIME 与哈希头；每次读回都校验 S3 字节的长度和 SHA-256，不符返回 502，待上传记录返回 404。每次数据库操作重新核查工作区成员权限。请求体和对象字节不写入应用日志。

上传先在 PostgreSQL 留 `pending` 元数据，S3 写入成功后才标记 `ready`。网络中断后客户端须用相同工作区、附件 ID、密文字节和哈希重发；若 S3 已写入而 SQL 确认中断，重发会覆盖同一对象并完成确认。服务端只能验证传输字节一致性，**无法证明客户端确实加密**；MIME 只是协议声明。SHA-256 不验证密文的真实性，解密和 AEAD 认证必须由客户端执行。尚未实现分块上传、孤儿对象清理、对象版本锁、真实 S3/R2 联调及附件与资产引用的服务端生命周期联动。

基础测试以 PGlite 覆盖幂等、版本冲突、租户隔离、墓碑、分页和 HTTP 拒绝；附件以本地对象存储 mock 测试权限、失败重试和哈希读回，并用本地 S3 兼容 HTTP mock 验证 AWS SDK 签名 PUT/GET。真实 PostgreSQL 协议测试见下节。本机隔离 Compose 构建/启动及重启读回已通过；外部干净环境部署、TLS/反向代理、真实 S3/R2 与认证服务仍未验收。

## 真实 PostgreSQL 本机协议测试

`apps/sync-server/src/real-postgres.test.ts` 仅在显式提供 `KEEPANY_TEST_DATABASE_URL` 时运行。测试会在指定数据库新建随机 schema，迁移并运行 Hono Node HTTP 服务，然后删除该 schema；请使用专门的测试数据库账号。它用两条独立 HTTP 客户端会话模拟离线并发修改，验证版本冲突、重复提交、墓碑、分页、工作区拒绝和经本机 S3 兼容 HTTP mock 上传/下载的加密附件。未设置 URL 时该用例跳过，不把 PGlite 结果冒充真实 PostgreSQL。

```sh
KEEPANY_TEST_DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:PORT/TEST_DB' \
  pnpm exec vitest run apps/sync-server/src/real-postgres.test.ts
```

2026-09-28 本机验证使用临时 `postgres:17.11-alpine3.24` 容器，端口仅绑定回环地址；真实 PostgreSQL 17.11 的测试通过，测试 schema 已清理。另用独立 Compose 项目实际构建并启动服务，HTTP 健康检查、工作区创建、推送、拉取、401 拒绝及容器重启后读回均通过。服务重启后的第一次请求须等待健康检查；客户端应对连接中断重试。服务日志仅见监听地址，未见测试密文或令牌。两条客户端会话仍在同一台机器，附件对象存储仍是本机 mock；尚未做两台物理设备、真实 R2/S3、外部干净主机或生产认证服务联调。
