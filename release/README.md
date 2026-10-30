# KeepAny 本地测试版

项目统一使用 KeepAny，曾以 StackPerch 名称发布。正式仓库为 [Syndred/KeepAny](https://github.com/Syndred/KeepAny)，[官网](https://syndred.github.io/KeepAny/)使用 KeepAny 地址；旧 StackPerch GitHub 链接仍转到同一仓库。本机 4180 地址、旧备份格式及数据库标识保留；更新前保存编辑、备份并停止旧服务。以下历史验收记录保留当时名称和版本，以最新发布说明为准。

普通试用者请从 [GitHub Releases](https://github.com/Syndred/KeepAny/releases) 下载标注 `Pre-release` 的 `KeepAny-…-portable.zip`，按照包内 `START-HERE.md` 启动。便携包只需 Node.js 22+，不需要拉代码、安装 pnpm 或项目依赖。中英文入门见 [试用指南](../docs/试用指南.md)。发布状态和实际验证范围以对应 Release 为准。

维护者从**已提交的干净仓库**构建便携包：

```bash
pnpm install --frozen-lockfile
pnpm build:preview
# Bash / zsh: select this checkout's clean candidate explicitly.
candidate="$(node scripts/select-preview-candidate.mjs)"
pnpm verify:preview "$candidate"
```

PowerShell 中最后两行使用：

```powershell
$candidate = node scripts/select-preview-candidate.mjs
pnpm verify:preview $candidate
```

验证命令必须显式指定本次候选；裸 `pnpm verify:preview` 不会自动选择目录中最新的 ZIP。CI 中同一选择脚本通过 `GITHUB_ENV` 设置后续步骤的候选，普通本地终端则使用上述变量传参。

生成 `dist/preview/` 中的 ZIP、SHA-256 和对应源码。便携包使用本次完整构建，包含本机启动器、当前 Web 文件、对应源码与第三方材料；不携带仓库里的历年哈希资源。默认拒绝未提交改动；`--allow-dirty` 仅用于内部候选，不能当公开版本。

验收须包括仓库外解压启动、实际启动器上的完整本地流程，以及同来源旧 PWA 的已记录升级路径；仅测试 Vite 开发或预览服务器不能替代便携包验收。公开介绍页另用 `pnpm build:public-site` 构建，发布目录只有 `dist/public-site/`。公开页面的手动发布工作流要求同一提交的本地交付和三系统打包 CI 成功。

## 交付主路径

当前只维护便携候选的构建、清单校验与实际启动器测试；不再提交 `release/web` 或无限累积的哈希资源。

日常运行使用已验收候选目录。已有用户的旧页签升级所需资源只保留在本机部署目录，切换前核对当前版本并保留一个明确回退包。新下载的干净包只含当前构建；历史PWA升级测试从固定Git提交提取旧包，不能用最新源码冒充旧版本。

兼容的 `release/start.command` / `stop.command` 要求显式传入便携候选的绝对目录，不再隐式启动仓库内旧包。

[历史启动及验收记录](../docs/archive/2026-10-30/历史固定包说明.md)。
