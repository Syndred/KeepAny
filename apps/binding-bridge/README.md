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

**消费端集成边界：** 商业 issuer 是票据和访问令牌的签名 `iss`，DPoP 的 `htu` 也必须是商业公开接口 URL。`createBindingBridgeFetch` 只把网络目标映射到固定桥地址，`bridgeBindingKeys` 经桥读取 JWKS，仍以商业 issuer 验签；不能把桥地址填成 `BindingTransport.issuer`。Web 设置页在构建时同时配置 `VITE_KEEPANY_BINDING_ISSUER`、`VITE_KEEPANY_BINDING_BRIDGE_ORIGIN` 才显示绑定入口。两项值必须与桥的固定 issuer 和实际监听地址一致；未配置时入口不出现。浏览器入口目前只申请 `sync:read`，保存的是本机绑定关系，不代表云同步已经开启。

2026-09-28 用独立的 KeepAnyAdm 临时合成 Plus 进程、此桥和 Web 浏览器完成跨进程设备码批准、签名票据消费、`/state=active`、DPoP `/refresh` 与账号页面撤销后 `/state=revoked` 回读。本次商业测试服务运行于有未提交改动的同级仓库工作树，因此还不是固定源码版本、真实商业账号或部署验收。

威胁边界：精确 Origin/Host 和浏览器 CORS 只约束普通网页。恶意本机进程或浏览器扩展可以伪造 Origin 并访问回环端口；若将桥暴露到非回环网络、错误配置受信任 Origin，或同源 Web 遭 XSS，桥不能保护本地刷新凭证。本桥不执行商业登录、不保存凭证、不替代票据/访问令牌验签或商业状态查询。正式发布前需可信启动器、端口发现与退出管理、安全审查及生产撤销传播验收。
