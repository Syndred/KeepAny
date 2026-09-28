# 可选自部署同步服务

阶段 3 的基础同步服务使用 Hono、PostgreSQL 事务与工作区成员表。同步资产只保存密文和路由元数据；会话模式另由 Better Auth 保存登录账号、密码哈希和会话。`POST /workspaces` 由已验证主体创建工作区；`POST /sync/push` 和 `POST /sync/pull` 每次在数据库内核查工作区读写权限。重复 `operationId` 幂等，期望版本不匹配返回冲突，墓碑不会被普通写入复活，拉取按工作区序号分页。

认证模式必须显式选择。`self-host` 仅适合单主体自部署，使用长随机 Bearer；它不是商业绑定认证。`bound` 是受控试验模式，验证商业侧签发的设备绑定 JWT 与每次请求的设备 DPoP，并由可信写入器读取商业签名状态断言、写入 PostgreSQL 短租约。正式多人官方服务、真实账号、设备加入/恢复、生产密钥/TLS 与端到端密钥协议尚未通过验收，不应对外开放同步服务。

`self-host-session` 是另一种可选自部署模式：Better Auth 1.7.6 管理用户密码和 Cookie 会话，PG 工作区成员主体为 `selfhost:<Better Auth 用户 ID>`。它不接受旧 `self-host` Bearer、商业 bound JWT 或按邮箱合并商业身份。工作区记录与密文附件仍由原有服务按每次请求的成员权限检查；`GET /workspaces` 只列当前账号的有效成员工作区。退出登录后本机资产与导出继续可用，已绑定另一账号/工作区的本机数据集不得自动改绑。

本机单主体运行时先设置 `DATABASE_URL`、`KEEPANY_SYNC_AUTH_MODE=self-host` 和至少 32 字符的 `KEEPANY_SYNC_TOKEN`，再执行：

```sh
pnpm exec vite build --ssr apps/sync-server/src/main.ts --outDir apps/sync-server/dist
node apps/sync-server/dist/main.js migrate
node apps/sync-server/dist/main.js
```

Docker Compose 文件位于本目录，明确选择 `self-host`。需在 Compose 环境设置 `POSTGRES_PASSWORD`、包含 URL 编码密码且主机为 `postgres` 的 `DATABASE_URL`、`KEEPANY_SYNC_TOKEN`，然后在仓库根目录运行 `docker compose -f apps/sync-server/compose.yaml up --build`。服务只绑定宿主机 `127.0.0.1:8787`；需要外部访问时自行配置 HTTPS 反向代理。

## 自部署多用户会话

先在专用 PostgreSQL 数据库运行包含 Better Auth 官方 1.7.6 SQL 的 `007_self_host_session` 迁移，再启动服务。所支持的生产拓扑为 Web 静态文件与 Hono API **共用一个 HTTPS origin**；反向代理把 `/api/auth/*`、`/sync/*`、`/workspaces`、`/workspaces/*` 转给 Node 服务。`KEEPANY_SYNC_PUBLIC_ORIGIN` 必须是浏览器地址栏中的精确 origin；反向代理负责 TLS、Host 与请求体转发，Node 只监听内网/回环。会话 Cookie 不跨域、不可由脚本读取，在 HTTPS 下为 Secure、HttpOnly、SameSite=Lax；会话模式不开放跨源 CORS，改变状态的 API 要求精确 Origin。不要把商业域名的 Cookie 共享给此服务，也不要把服务暴露在 HTTP 公网。

运行配置为 `DATABASE_URL`、`KEEPANY_SYNC_AUTH_MODE=self-host-session`、`KEEPANY_SYNC_PUBLIC_ORIGIN=https://你的站点` 和仓库外生成并保管的至少 32 字符高熵 `BETTER_AUTH_SECRET`。此模式禁止 `KEEPANY_SYNC_TOKEN` 与 `KEEPANY_SYNC_WEB_ORIGIN`。注册默认关闭；由部署者需要新增用户时显式设 `KEEPANY_SESSION_ALLOW_SIGNUP=true`，通过同源设置页创建账号后关闭该开关并重启服务。当前只支持 Better Auth 本地邮件地址/密码登录，不发送验证邮件、不提供邮件找回；邮箱不等于已验证的真实身份。生产启用前还需完成 HTTPS、备份、密钥管理、长期负载和外部设备验收。

本机开发可在非 production 环境用回环 HTTP：服务的 `KEEPANY_SYNC_PUBLIC_ORIGIN` 设为 Vite 实际 origin，例如 `http://127.0.0.1:5173`，服务监听 `127.0.0.1:8787`；另开 Web 进程执行 `KEEPANY_SELFHOST_DEV_PROXY_TARGET=http://127.0.0.1:8787 pnpm dev --port 5173 --strictPort`。此开发代理仅接受回环目标，将 `/api/auth`、`/sync`、`/workspaces` 转给 Hono，让浏览器仍是同源 Cookie 请求。更换账号时，同一浏览器本机资料不会自动变成新账号的资料；已绑定的数据集只能回到原服务、账号和工作区，另一个账号请用独立浏览器资料。工作区密钥依然只在页面内存中，需另行安全保存。

`003_change_operation_id` 迁移给拉取记录补上原始 `operationId`，并按旧版已接受操作的工作区序号回填；旧迁移的校验和保持不变。若旧记录找不到对应的已接受操作，迁移会回滚并报错，需先排查数据一致性，不能跳过或生成替代 ID。执行迁移后再启动新版服务。

## 设备绑定验签试验

`bound` 模式要求 `KEEPANY_BOUND_ISSUER` 为商业侧固定签名 issuer origin，`KEEPANY_BOUND_JWKS_JSON` 为从商业 `/.well-known/jwks.json` **经受信任渠道钉住的仅公钥 JSON**，`KEEPANY_SYNC_PUBLIC_ORIGIN` 为客户端访问同步服务的固定 HTTPS origin。可信写入器另需 `KEEPANY_BOUND_STATE_COMMERCIAL_ORIGIN`（状态接口固定 origin）、`KEEPANY_BOUND_STATE_READER_ISSUER`、`KEEPANY_BOUND_STATE_READER_KID` 与 `KEEPANY_BOUND_STATE_READER_PRIVATE_KEY_FILE`（仓库外受保护的独立 RSA 私钥文件）；商业侧须先配置对应 reader 公钥。生产 origin 用 HTTPS，回环 HTTP 只用于本机隔离验收。模式为 `bound` 时不得设置 `KEEPANY_SYNC_TOKEN` 或旧的 `KEEPANY_BOUND_BINDINGS_JSON`；缺少/无效配置使服务拒绝启动。商业签名公钥可预置多个不同 `kid`：先发布新公钥并滚动更新核心配置，再切换签发钥，等待旧状态断言与实例更新完成后移除旧钥；reader 钥也先在商业端发布新公钥，再切核心私钥/kid。

同步请求用 `Authorization: DPoP <accessToken>` 与 `DPoP: <proof>`。服务仅用本地固定 JWKS 验证 RS256、精确 issuer、`aud=keepany-sync-bound`、`sub`、`binding_id`、`instance_id_hash`、`cnf.jkt`、读写 scope 与最多 60 秒的令牌寿命；`Bearer` 和通用登录 `aud=keepany-sync` 均无效。证明须由绑定设备的 P-256 私钥签名，公钥指纹等于 `cnf.jkt`，且 `htm`、由固定公开 origin 加请求路径组成的 `htu`、访问令牌 SHA-256 的 `ath`、一分钟内 `iat` 和未用过的 `jti` 匹配。不同 `Origin` 的浏览器请求拒绝，服务不返回跨源 CORS 授权。证明 `jti` 在 PostgreSQL 唯一约束下原子消费，多个进程共享判重；数据库故障时拒绝请求。

可信写入器向固定商业 origin 的 `GET /api/keepany/v1/bound-state/:bindingId` 发送独立 reader JWT，核验商业状态 JWT 的签名、issuer、audience、`typ`、绑定身份、scope、epoch 和时间，再以数据库条件写入短租约。已知非撤销绑定按签名租约截止时间提前调度刷新；慢请求与失败绑定各自重试，不串行阻塞其他绑定。试验容量上限为 32 个非撤销绑定，首次纳入由 PostgreSQL 跨进程原子准入；超过上限拒绝新绑定并记录容量错误，启动发现超额存量时拒绝监听。首次有效 bound JWT 与设备 DPoP 均验过且本地没有状态行时，才受限地按 ID 拉取。只在数据库中保存经核验状态，不保存或轮换设备刷新凭证；旧 epoch、同 epoch 改状态、旧观测续租和撤销墓碑复活均拒绝。每次资源请求重查 PostgreSQL，访问 JWT 的 `iat` 严格晚于状态 cutoff；异步状态拉取或数据库锁等待后重查 JWT/DPoP 有效期，过期证明不消费。商业 503、网络/签名故障或写入失败不会续租，旧租约到期后拒绝；租约截止取商业 JWT `exp` 与签名 `state_expires_at` 的较早者，不从 HTTP 收到时重算。撤销仍有拉取周期和最长剩余租约的延迟，不承诺即时生效。32 个绑定是当前试验边界；扩大规模前需设计分片或扩容并复测。真实付费账号、生产服务、反向代理、密钥管理与多机部署尚未验收。

本机合成账号的双进程验收从商业仓库固定提交 `7589b6d` 建临时源码快照，使用隔离 SQLite、实际商业 Vite HTTP、核心 `main.ts` 与测试 PostgreSQL 的随机 schema。脚本需要同级只读商业仓库、其已安装依赖、macOS APFS 文件克隆能力及专用测试数据库；它不改商业工作树，结束时清理临时进程、目录和 schema。在仓库根目录运行：

```sh
KEEPANY_TEST_DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:PORT/TEST_DB' \
  node --import tsx scripts/accept-bound-state-cross-process.ts
```

验收覆盖第二设备商业 HTTP 批准/刷新、首次资源请求自动写入后 201、商业 HTTP 暂停至租约过期后 401、恢复取得新签名状态后 200、商业 HTTP 撤销后的旧令牌 401。临时合成 Plus 不代表真实订单或生产服务验收。

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
