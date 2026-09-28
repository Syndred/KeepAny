# 本机账户绑定桥（隔离验证切片）

KeepAnyAdm 的绑定接口不开放任意跨源浏览器 CORS。本服务只在 `127.0.0.1` 监听，转发固定商业 issuer 的五个绑定/公钥路径，不接受请求指定目标 URL。启动时必须配置：

```bash
KEEPANY_BINDING_ISSUER=http://127.0.0.1:3199 \
KEEPANY_BINDING_WEB_ORIGIN=http://127.0.0.1:5173 \
KEEPANY_BINDING_BRIDGE_PORT=0 \
pnpm exec tsx apps/binding-bridge/src/main.ts
```

生产商业 issuer 必须使用 HTTPS；HTTP 只允许 `localhost`、`127.0.0.1` 或 `[::1]` 回环开发。`KEEPANY_BINDING_BRIDGE_PORT=0` 使用系统分配端口并打印监听地址；也可设明确端口。Web 的 Origin 必须与配置完全一致，且请求 Host 必须是实际监听的 `127.0.0.1:<端口>`。调用方需用进程启动输出取得桥地址，不能假定随机端口。桥不启动商业服务，也不会创建或登录商业账户。

允许路径只有 `POST /api/keepany/v1/bindings/{device,poll,refresh,state}` 和 `GET /.well-known/jwks.json`。浏览器预检只允许相应方法及 `Content-Type`/必要时的 `DPoP`；拒绝无 Origin、其他 Origin/Host、Cookie、Authorization、查询参数、额外路径、错误字段和超过 2 KiB 的请求。上游响应限定 JSON 与大小，强制 `no-store`，429 只透传合法的秒数 `Retry-After`。私钥绝不经过桥；桥仅按需转发已由本地设备私钥签署的 DPoP。服务不记录请求体、令牌、响应或错误详情。

**消费端集成边界：** 商业 issuer 是票据和访问令牌的签名 `iss`，DPoP 的 `htu` 也必须是商业公开接口 URL。网络请求可由 `BindingTransport` 的 fetch adapter 从商业 URL 映射到固定桥地址；不能把桥地址填成 `BindingTransport.issuer`，否则票据验签与 DPoP 都会失败。JWKS 可以从桥取得，但必须继续以商业 issuer 验证签名。当前 Web 还没有该 adapter 和正式绑定 UI，桥的本地 HTTP 测试不等于真实账号联通。

威胁边界：精确 Origin/Host 和浏览器 CORS 只约束普通网页。恶意本机进程或浏览器扩展可以伪造 Origin 并访问回环端口；若将桥暴露到非回环网络、错误配置受信任 Origin，或同源 Web 遭 XSS，桥不能保护本地刷新凭证。本桥不执行商业登录、不保存凭证、不替代票据/访问令牌验签或商业状态查询。正式发布前需可信启动器、端口发现与退出管理、浏览器实际联调、安全审查及撤销传播验收。
