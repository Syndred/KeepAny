# 本机 MCP 权限核心

本包使用官方 `@modelcontextprotocol/server@2.1.0` 注册四个工具：`list_assets`、`get_asset`、`preview_asset_update`、`confirm_asset_update`。传输入口 `serveKeepAnyMcpStdio` 仅使用 stdio，不监听 HTTP 端口。

## 授权边界

- 可信应用调用 `McpAuthority.issueGrant`，明确选择资产 ID、可读字段、可写字段和 1 分钟至 7 天有效期。写字段必须同时可读。随机密钥仅签发时返回一次，状态文件只保存哈希。
- MCP 工具不能签发、批准或撤销授权。可信应用调用 `revokeGrant` 后，后续请求重新检查状态并拒绝；待确认预览同时失效。
- 读取只返回授权资产的指定字段。查询只搜索投影后可见内容。删除资产不会返回。
- 写入仅允许 `name`、`category`、`tags`、`description`、`url`。工具先返回旧值和新值预览。可信应用向用户展示**准确预览**后，单独调用 `approvePreview`；模型拿到预览 ID 本身不能批准。确认时再次校验授权、预览哈希、操作 ID、过期时间和资产版本，RxDB 适配器通过 `incrementalModify` 拒绝并发覆盖。
- 操作 ID 先持久占位再写资产，成功后写完成回执。重复确认返回 `duplicate`。若进程在写入与回执之间中断，操作保持 `pending` 并返回 `operation-uncertain`，需要人工核对，不能自动重放。
- 审计只记录授权 ID、动作、结果、资产 ID、字段名、操作 ID 和时间，不记录字段值或授权密钥。`FileAuthorityStorage` 用权限 `0700` 的目录、`0600` 的文件、排他锁和原子替换保存状态；异常残留的 `.lock` 须由本机操作者核查后处理。

## 当前接线状态

`RxdbMcpAssetStore` 可在**持有 Web 应用同一个 IndexedDB 上下文**的代码中操作现有 RxDB 资产集。独立 Node stdio 进程不能直接打开浏览器 IndexedDB。本包提供 `McpAssetStore` 注入契约和 stdio 服务工厂，但尚未接入可信本机桥接、Web 授权/批准界面或实际 MCP 客户端配置。因此目前是经过协议测试的权限核心，**尚不能声称用户已可通过 MCP 访问自己的浏览器资料**。

可信桥接完成前，不应提供“从备份复制出第二份可写资产库”的启动脚本，这会造成两个状态源。部署时还需验证桥接双方身份、进程权限、撤销时效、日志保留与异常未决操作的处理流程。授权无法约束同一操作系统账户下可任意读取浏览器资料或状态文件的恶意进程。

## 验证

`pnpm exec vitest run packages/mcp/src` 覆盖字段/资产范围、错误密钥、撤销、预览批准、重放、并发冲突、未决操作、持久状态、RxDB 同源写入及官方 SDK 内存传输协议。`pnpm typecheck` 校验 SDK 和跨包接口。

SDK 依据：[官方 TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)、[stdio 指南](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md)。未复制上游源码，仅使用 npm MIT 包 API。
