# 本机 MCP 权限核心

本包使用官方 `@modelcontextprotocol/server@2.1.0` 注册四个工具：`list_assets`、`get_asset`、`preview_asset_update`、`confirm_asset_update`。传输入口 `serveKeepAnyMcpStdio` 仅使用 stdio，不监听 HTTP 端口。

## 授权边界

- 可信应用调用 `McpAuthority.issueGrant`，明确选择资产 ID、可读字段、可写字段和 1 分钟至 7 天有效期。写字段必须同时可读。随机密钥仅签发时返回一次，状态文件只保存哈希。
- MCP 工具不能签发、批准或撤销授权。可信应用调用 `revokeGrant` 后，后续请求重新检查状态并拒绝；待确认预览同时失效。浏览器执行器在写前及 RxDB `incrementalModify` 每次回调中复查本地取消、请求/会话期限和桥上授权；显式撤销先阻止新写并等待已进入存储的写结束，再返回成功。若写已交给存储，界面提示核对资料；已落库但应答丢失仍保持 `operation-uncertain`，不得自动重试。
- `run(signal)` 的外部取消与浏览器关闭、显式撤销共用写取消守卫：暂停的读恢复后不得进入 CAS，已排队写在回调前复查。每个 `/check-write` 使用携带 AbortSignal 的 HTTP 请求，并受当前 MCP 请求和配对会话剩余期限约束；取消或到期会终止尚未提交的权限检查。浏览器实际已交给 RxDB 存储的写仍须等待结果，不能把取消网络请求冒充为回滚。
- 读取只返回授权资产的指定字段。查询只搜索投影后可见内容。删除资产不会返回。
- 写入仅允许 `name`、`category`、`tags`、`description`、`url`。工具先返回旧值和新值预览。可信应用向用户展示**准确预览**后，单独调用 `approvePreview`；模型拿到预览 ID 本身不能批准。确认时再次校验授权、预览哈希、操作 ID、过期时间和资产版本，RxDB 适配器通过 `incrementalModify` 拒绝并发覆盖。
- 操作 ID 先持久占位再写资产，成功后写完成回执。重复确认返回 `duplicate`。若进程在写入与回执之间中断，操作保持 `pending` 并返回 `operation-uncertain`，需要人工核对，不能自动重放。
- 审计只记录授权 ID、动作、结果、资产 ID、字段名、操作 ID 和时间，不记录字段值或授权密钥。`FileAuthorityStorage` 用权限 `0700` 的目录、`0600` 的文件、排他锁和原子替换保存状态；异常残留的 `.lock` 须由本机操作者核查后处理。

## 当前接线状态

`RxdbMcpAssetStore` 可在**持有 Web 应用同一个 IndexedDB 上下文**的代码中操作现有 RxDB 资产集。独立 Node stdio 进程不能直接打开浏览器 IndexedDB。`bridge.ts` 提供只监听数值 loopback 的单会话 RPC，`browser-bridge.ts` 提供同源仓库执行器。配对须由可信启动器把随机密钥交给 Web 应用，再由用户对作用域进行一次批准。桥只发送获批可读字段的投影；写入在浏览器端合并原记录并按版本比较。威胁边界见 [ADR 0002](../../docs/adr/0002-mcp-bridge.md)。

开发版正式 Web 设置页、逐次写批准和独立 [本机 stdio 启动器](../../apps/mcp-launcher/README.md) 已接通同一 RxDB 资料库；用户须自行配置 MCP 客户端并选择一次性配对文件。真实官方 SDK 子进程与隔离 Chromium 已完成本机联调。**普通用户入口尚未发布**：正式跨平台打包、生产 HTTPS/PWA 回环、安全审计和真实设备仍待验收。不得提供“从备份复制出第二份可写资产库”的启动脚本，这会造成两个状态源。同一操作系统账户下可读取进程内存或浏览器资料的恶意进程不受本桥隔离。

## 验证

`pnpm exec vitest run packages/mcp/src apps/mcp-launcher/src` 覆盖字段/资产范围、错误密钥、撤销、预览批准、重放、并发冲突、未决操作、持久状态、RxDB 同源写入、官方 SDK stdio/内存传输协议和真实 loopback 桥。`bridge-race.test.ts` 确定性暂停浏览器读、CAS 和可取消的 `/check-write`，验证显式撤销、关闭、外部 `run(signal)`、授权及期限在提交前阻断；`rxdb-store.test.ts` 验证真正 `incrementalModify` 回调中的取消及与桥同跑的撤销。`bridge-browser.test.ts` 用随机端口页面和 Chromium 验证跨源拒绝、CORS 与字段投影；`tests/e2e/mcp-web.spec.ts` 再用正式 Web、启动器、官方 SDK 和真实浏览器 RxDB 验证手工连接、批准及挂起网络检查时的撤销。测试只用合成资料，不输出密钥；本机通过不证明正式打包或生产环境可用。

SDK 依据：[官方 TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)、[stdio 指南](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md)。未复制上游源码，仅使用 npm MIT 包 API。
