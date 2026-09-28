# KeepAny 本机 MCP 启动器

本启动器是独立 Node stdio 进程。它把正式 Web 中用户选中的资产与字段交给现有 `McpAuthority`，再通过只监听 `127.0.0.1` 随机端口的单会话桥访问**同一个浏览器 RxDB 仓库**。模型不能签发授权、执行本机命令或批准写预览。

## 开发版连接步骤

1. 在 KeepAny Web 的 MCP 设置中选择资产、可读字段、可写字段和有效期，下载请求 JSON。请求包含资产 ID，但没有配对密钥；保存后五分钟内启动 MCP 客户端。
2. 将以下示例中的三个绝对路径换成自己机器上的路径，加入支持 stdio 的 MCP 客户端配置。`--request` 必填；可加 `--pairing-file /绝对/路径/pairing.json`，目标父目录须已存在、属当前用户且权限为 `0700`。未指定时会在 `~/.keepany/mcp/` 建立随机文件名。测试或显式隔离时可加 `--state-dir /绝对/私有目录`，该目录须**预先存在**、非符号链接、属当前用户、权限恰为 `0700`；授权状态和默认配对文件都写入该目录。
3. MCP 客户端启动后，启动器只向 **stderr** 输出配对文件路径。在 Web 设置中手动选择该文件，核对范围并批准。文件为 `0600`、仅新建不覆盖；成功配对或两分钟超时即删除。请求过期时重新下载并启动新进程。

```json
{
  "mcpServers": {
    "keepany-local": {
      "command": "/ABSOLUTE/KeepAny/node_modules/.bin/tsx",
      "args": [
        "/ABSOLUTE/KeepAny/apps/mcp-launcher/src/main.ts",
        "--request",
        "/ABSOLUTE/Downloads/keepany-mcp-request.json"
      ],
      "cwd": "/ABSOLUTE/KeepAny"
    }
  }
}
```

源码开发时也可在仓库根目录直接运行：

```bash
pnpm exec tsx apps/mcp-launcher/src/main.ts --request /绝对/路径/keepany-mcp-request.json
```

配对前 MCP 工具返回 `bridge-unpaired`。授权后，读取只返回选中资产和字段。`preview_asset_update` 把准确旧值、新值送到 Web 的待批准队列；用户在 Web 中另行批准后，`confirm_asset_update` 才能按版本比较写入。关掉 MCP 客户端会撤销本进程授权、关闭 loopback 桥并删除尚存的配对文件。持久权限状态位于 `~/.keepany/mcp/authority.json`，含授权哈希、回执及不含字段值的审计。不要手动删除未决操作回执；`operation-uncertain` 必须人工核对。

请求 JSON 只接受严格 schema、单一精确来源、五分钟内创建时间与合法字段范围。HTTP 来源仅允许本机回环；远端来源必须 HTTPS。配对密钥仅写私有文件，不进 URL、MCP stdout、普通日志或浏览器持久存储。浏览器不执行客户端配置中的命令。配置示例仅适用于本源码工作树；正式打包与跨平台安装仍需单独验收。

## 验证

```bash
pnpm exec vitest run apps/mcp-launcher/src
pnpm typecheck
pnpm exec biome lint apps/mcp-launcher/src
```

测试用官方 `@modelcontextprotocol/client` 的 stdio 传输启动真实子进程，覆盖配对前拒绝、配对后字段投影和一次性文件删除；另测严格请求校验、符号链接、权限、排他创建与文件替换清理。测试使用合成资产与临时 HOME，不连接用户资料库。
