# KeepAny 本机 MCP 启动器

现有 `keepany-mcp` 命令、`@keepany` 包名和 `~/.keepany` 配置路径保留，已有客户端配置无需因品牌更名而修改。

本启动器是独立 Node stdio 进程。它把正式 Web 中用户选中的资产与字段交给现有 `McpAuthority`，再通过只监听 `127.0.0.1` 随机端口的单会话桥访问**同一个浏览器 RxDB 仓库**。模型不能签发授权、执行本机命令或批准写预览。

## macOS 本机安装包

需要 Node.js `>=20.19.0`、npm；从本仓库构建 tarball 还需要 pnpm。安装包提供 `keepany-mcp` 命令，运行时无需 KeepAny 源码目录、pnpm、tsx 或 `cwd`。npm 安装会获取包声明的三个运行依赖，离线安装需要这些依赖已在 npm 缓存中。当前是**本机安装技术验证包**，没有发布到 npm，也没有完成第三方许可证再分发核查。

```bash
pnpm install --frozen-lockfile
pnpm pack:mcp
mkdir -p "$HOME/.local/keepany-mcp"
npm install -g --prefix "$HOME/.local/keepany-mcp" ./dist/keepany-mcp-launcher-0.1.0.tgz
```

构建产物为 `dist/keepany-mcp-launcher-0.1.0.tgz`，可用 `npm pack ./dist/mcp-launcher --dry-run` 查看打包文件。安装后按实际用户名填写**绝对路径**，例如：

```json
{
  "mcpServers": {
    "keepany-local": {
      "command": "/Users/你的用户名/.local/keepany-mcp/bin/keepany-mcp",
      "args": [
        "--request",
        "/Users/你的用户名/Downloads/keepany-mcp-request.json",
        "--pairing-file",
        "/Users/你的用户名/.keepany/mcp/pairing.json"
      ]
    }
  }
}
```

先安装并填好客户端配置，再从 Web 生成请求：请求五分钟后过期。请使用客户端实际支持的 stdio 配置格式，并确认它传给启动器的是绝对文件路径。`--pairing-file` 指定便于在 Web 选择的固定路径，已有同名文件时启动器会拒绝覆盖；确认旧进程已经退出后再处理旧文件。

## 连接步骤

1. 在 KeepAny Web 的 MCP 设置中选择资产、可读字段、可写字段和有效期，下载请求 JSON。请求包含资产 ID，但没有配对密钥；保存后五分钟内启动 MCP 客户端。
2. 将上面的绝对路径换成自己机器上的路径，加入支持 stdio 的 MCP 客户端配置。`--request` 必填；示例用固定的 `--pairing-file` 路径，方便从客户端启动后在 Web 选择。目标父目录由默认启动器建立为当前用户的 `0700` 私有目录；已有同名配对文件时会拒绝覆盖，须先核查旧进程与文件。未指定配对路径时会在 `~/.keepany/mcp/` 建立随机文件名。测试或显式隔离时可加 `--state-dir /绝对/私有目录`，该目录须**预先存在**、非符号链接、属当前用户、权限恰为 `0700`；授权状态和默认配对文件都写入该目录。
3. MCP 客户端启动后，启动器只向 **stderr** 输出配对文件路径。在 Web 设置中手动选择该文件，核对范围并批准。文件为 `0600`、仅新建不覆盖；成功配对或两分钟超时即删除。请求过期时重新下载并启动新进程。

源码开发时也可在仓库根目录直接运行：

```bash
pnpm exec tsx apps/mcp-launcher/src/main.ts --request /绝对/路径/keepany-mcp-request.json
```

配对前 MCP 工具返回 `bridge-unpaired`。授权后，读取只返回选中资产和字段。`preview_asset_update` 把准确旧值、新值送到 Web 的待批准队列；用户在 Web 中另行批准后，`confirm_asset_update` 才能按版本比较写入。关掉 MCP 客户端会撤销本进程授权、关闭 loopback 桥并删除尚存的配对文件。持久权限状态位于 `~/.keepany/mcp/authority.json`，含授权哈希、回执及不含字段值的审计。不要手动删除未决操作回执；`operation-uncertain` 必须人工核对。

请求 JSON 只接受严格 schema、单一精确来源、五分钟内创建时间与合法字段范围。HTTP 来源仅允许本机回环；远端来源必须 HTTPS。配对密钥仅写私有文件，不进 URL、MCP stdout、普通日志或浏览器持久存储。浏览器不执行客户端配置中的命令。本机 macOS 包已通过仓库外安装与生产构建预览纵切；Windows/Linux 安装、公开 HTTPS 页面到 loopback 的浏览器权限及真实客户端环境仍未验收，普通用户入口尚未开放。

## 生产 HTTPS 与 PWA 边界

本机生产构建预览位于 `http://127.0.0.1`：Chromium 在 Service Worker 接管后完成了配对、读取、写入批准和撤销。这证明本机回环安全上下文中的构建产物可用，**不证明公开 HTTPS 站点可以直接连接每位用户的本机桥**。桥只监听随机 `127.0.0.1` HTTP 端口，并要求精确 Origin/CORS。Chrome 对公开站点访问 loopback 的 [Local Network Access 权限](https://developer.chrome.com/blog/local-network-access/)可能弹出提示；用户拒绝、浏览器差异、站点 CSP `connect-src` 和部署代理的安全响应头均要在真实来源上验证。PWA 清单已有安装图标；本机离线图标检查不等于各浏览器和设备都已满足安装条件。

后续需在有有效证书的受控公开 HTTPS 测试域、最终部署同类响应头和正常浏览器权限流程下，分别验证允许/拒绝权限、预检/POST、配对/逐次写/撤销及离线 PWA。当前没有该测试域和证书证据，不绕过浏览器证书或安全提示。

## 验证

```bash
pnpm exec vitest run apps/mcp-launcher/src
pnpm typecheck
pnpm exec biome lint apps/mcp-launcher/src
pnpm pack:mcp
```

测试用官方 `@modelcontextprotocol/client` 的 stdio 传输启动真实子进程，覆盖配对前拒绝、配对后字段投影和一次性文件删除；另测严格请求校验、符号链接、权限、排他创建与文件替换清理。测试使用合成资产与临时 HOME，不连接用户资料库。

## 手机前台 HTTPS 连接

这是独立于上述 Web `--request` 的模式。手机先准备连接、通过系统导出配对文件，再回到 App **显式启用连接**；分享窗口仍打开时不能认为服务已经运行。准备、导出和启用沿用同一 endpoint 与证书 pin，配对票据只有两分钟。手机须保持前台，网络须允许电脑访问该私有 IPv4 地址和端口；手机的 localhost 属于手机，不能换成电脑的 localhost。只有明确转发到同一手机端点时才可使用 `127.0.0.1`。

将配对文件安全复制到电脑当前用户的私有目录后，用支持 stdio 的客户端启动：

```bash
keepany-mcp --mobile-pairing /绝对/私有目录/mobile-pairing.json
```

文件必须是普通、单链接、当前用户独占的文件；POSIX 文件权限 `0600`、父目录 `0700`，Windows 使用严格 owner-only DACL。启动器拒绝符号链接、重解析点和不安全权限，不替用户修改权限。手机配对文件与旧 Web 请求格式不能互换。

电脑在 stderr 显示一次八位核对码；在手机核对客户端、核对码及资产/字段/有效期并明确批准。电脑不能自行授权，写入仍须先预览，再由手机逐批批准。stdout 只承载 MCP 协议，不输出凭据或配对文件内容。

成功后，启动器在默认私有 `~/.keepany/mcp/` 写入一个随机名称的独立连接文件，并在 stderr 显示路径。可用 `--state-dir /绝对/已存在私有目录` 指定配对模式的输出目录。文件包含会话凭据，须按秘密保管；它不会在 CLI 退出时删除，也不会覆盖用户已有文件。初始配对文件为只读导入，过期后请自行安全删除。

在**同一次手机前台会话**和授权有效期内，可重连：

```bash
keepany-mcp --mobile-connection /绝对/私有目录/connection-UUID.json
```

停止手机服务、授权过期/撤销或证书变化都会使旧连接失效。重新启动手机连接会轮换证书，须重新显式配对；启动器不自动接受新证书。TLS 同时验证本次配对的证书信任、正常 IP SAN 与 SPKI pin，不关闭系统校验，不设置全局 CA。关闭电脑 CLI 仅断开本次连接，授权撤销由手机执行。取消/断开不会自动重放写入；若提交回执不确定，先在手机核对。

本模式的 Windows Node 合成 TLS/官方 SDK 子进程合同已有定向验证；这不代表真实手机监听、系统网络权限或各第三方客户端已经通过实装验收。
