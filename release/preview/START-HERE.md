# KeepAny 本地测试版 / Local preview

项目统一使用 KeepAny，曾以 StackPerch 名称发布。正式仓库为 `Syndred/KeepAny`，旧 StackPerch GitHub 链接转到同一仓库。本机入口和旧 `.ka1`、KDBX 备份继续使用。

KeepAny was previously published as StackPerch. The repository is `Syndred/KeepAny`; older StackPerch GitHub links redirect to it. The local address and existing `.ka1` and KDBX backups remain compatible.

把项目、账号、订阅和维护事项放在一起管理。无需注册，资料保存在当前浏览器。

Keep projects, accounts, subscriptions, and maintenance tasks together. No account is required; data is stored in your browser.

## 开始 / Start

1. 安装 [Node.js 22 或更新版本](https://nodejs.org/)。无需 Git、pnpm 或安装项目依赖。 / Install Node.js 22 or newer. Git, pnpm, and project dependency installation are not required.
2. 解压整个 ZIP。 / Extract the entire ZIP.
3. macOS 双击 `start.command`；Linux 执行 `./start.sh`；Windows 双击 `start.bat`。 / On macOS, double-click `start.command`; on Linux, run `./start.sh`; on Windows, double-click `start.bat`.
4. 浏览器会打开 `http://127.0.0.1:4180/`。如果没有自动打开，手动打开这个地址。保持启动终端打开。 / Your browser opens `http://127.0.0.1:4180/`. Open it manually if needed. Keep the startup terminal open.

从一个项目开始：添加项目，再添加它使用的账号和订阅，建立关联，创建下一次维护待办。设置中可切换中文与英语。

Start with one project: add its accounts and subscriptions, connect them, then create a maintenance task. You can choose Chinese or English in settings.

## 停止与备份 / Stop and back up

- 在启动终端按 `Ctrl+C`，或运行 `stop.command` / `./stop.sh` / `stop.bat`。停止服务不会删除浏览器资料。 / Press `Ctrl+C` in the startup terminal, or run the matching stop script. Stopping the server does not delete browser data.
- 同一浏览器和 `127.0.0.1:4180` 地址会保留已有资料。不同浏览器、配置文件或地址使用各自的资料；想空白试用，请建立独立浏览器配置文件。 / The same browser and address retain existing data. Different browsers, profiles, or addresses have separate data; create a separate browser profile for an empty trial.
- 定期在应用中导出加密 `.ka1` 备份，清除浏览器数据或迁移前先备份。更换端口或浏览器后可在新环境恢复。密码库使用独立加密 KDBX。 / Export encrypted `.ka1` backups regularly and before clearing browser data or moving environments. Restore the backup in a new browser or address. The password vault uses separate encrypted KDBX storage.
- 端口已占用时启动器会拒绝启动，不停止已有服务。核查原服务或关闭其启动终端后重试。 / If the port is occupied, the launcher refuses to start and leaves the existing service running. Check the existing service or close its startup terminal before trying again.
- macOS 若提示权限不足，在终端运行 `sh ./start.command`；Linux 可运行 `sh ./start.sh`。 / If macOS reports insufficient permissions, run `sh ./start.command` in Terminal; on Linux, use `sh ./start.sh`.

## 版本与边界 / Version and scope

这是需 Node.js 的便携浏览器测试版。本包不启动同步、商业账号或 MCP 服务。官方托管尚未开放；自部署、远端备份及 AI 功能各有额外条件，使用前请阅读仓库说明。AI 请求仅在你配置模型并主动使用相应功能后发送。

This is a portable browser preview requiring Node.js. It does not start sync, commercial account, or MCP services. Official hosting is not available yet. Self-hosting, remote backup, and AI have additional requirements described in the repository. AI requests are sent when you configure a model and actively use the relevant feature.

`RELEASE.json` 记录版本、源码提交和文件指纹。`SHA256SUMS.txt` 可核查包内文件；下载旁的 `.sha256` 可核查 ZIP。`source/` 包含对应构建源码、锁文件和脚本；`LICENSE` 为 AGPL-3.0-only，第三方许可材料位于 `legal/`。`SBOM.spdx.json` 是依赖清单，`legal/preview-license-inventory.json` 说明本次收集范围和缺失项。

`RELEASE.json` records version, source commit, and file fingerprints. `SHA256SUMS.txt` verifies package files; the adjacent `.sha256` verifies the ZIP. `source/` contains the corresponding build source, lockfile, and scripts. `LICENSE` is AGPL-3.0-only; third-party materials are under `legal/`. `SBOM.spdx.json` is the dependency inventory, and `legal/preview-license-inventory.json` records collected materials and missing items.

源码与问题反馈 / Source and issues: https://github.com/Syndred/KeepAny

官网 / Website: https://syndred.github.io/KeepAny/
