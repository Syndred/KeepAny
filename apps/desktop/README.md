# KeepAny 桌面版

桌面版把现有 KeepAny 界面打包到 Tauri。启动时打开独立窗口和本机应用资料。终端用户无需 Node.js、pnpm 或本地 Web 服务。

| 系统 | 构建产物 | 使用方式 |
| --- | --- | --- |
| Windows x64 | `KeepAny_…_x64-setup.exe`，另提供可直接运行的 `KeepAny_…_x64.exe` | 运行安装器后从开始菜单打开。Windows 需有 WebView2，安装器可联网补装 |
| macOS 14 或更新 | Apple Silicon 的 `…_aarch64.dmg` 或 Intel 的 `…_x64.dmg` | 打开 DMG，将 KeepAny 拖到 Applications |

当前配置生成供本机测试的候选。Windows 候选使用未签名 EXE。macOS 使用临时签名，未做 Apple 公证，下载后可能被 Gatekeeper 拦截。产物与实际验证状态见[桌面验收记录](../../docs/Tauri桌面验收.md)。

## 导入已有资料

从原 KeepAny 打开「备份与恢复」，生成并保存加密 `.ka1`。在桌面版的同一页面选取文件，输入备份密码，核对预览后再恢复。账号密码库仍使用原主密码解锁。若只需密码库，在账号入口导入单独的 `.kdbx`。桌面版有自己的资料目录，原浏览器资料保留。

桌面版提供应用内提醒、手工 URL 收录及本地备份。URL 收录需要手工核对标题和描述。可选 AI 连接使用系统 WebView 的网络能力，服务端需要允许对应来源。桌面版的 MCP 连接和关窗后提醒未开放。

## 桌面开发与热更新

安装下方的构建依赖，在仓库根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
```

首次启动会编译 Tauri。打开「KeepAny · 开发预览」后，保存共享界面的组件或样式即可在当前桌面窗口查看改动；修改 Rust 原生代码时 Tauri 会重新编译并重启窗口。开发服务固定监听 `127.0.0.1:1420`，端口占用时报错。开发窗口使用独立资料空间，可通过内置示例体验。终端按 Ctrl+C 可以停止开发服务。

## 从源码打包

Windows 构建需 Rust MSVC 工具链、C++ Build Tools 和 Windows SDK。macOS 构建需 Rust 和 Xcode 命令行工具。使用项目规定的 Node.js 和 pnpm 版本。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm desktop:build
```

Tauri 将当前平台的包输出到 `apps/desktop/src-tauri/target/release/bundle/`。Windows 为 `nsis`，macOS 为 `dmg`。Windows 的 `target/release/keepany.exe` 可直接启动。

GitHub Actions 中的 **Build KeepAny desktop** 工作流按 Windows x64、Apple Silicon、Intel macOS 分别构建。工作流验证打包文件和原生保存写入，并上传安装包、构建提交和 SHA-256。日常 5173 和便携包仍沿用各自的运行方式。
