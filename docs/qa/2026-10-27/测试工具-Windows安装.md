# Windows 测试工具安装与使用回执

2026-10-27。用户明确要求在本机安装 GSD、gstack 并继续验收。工具均放在用户工具目录，没有把工具源码、浏览器或数据库二进制加入 KeepAny。

## 安装身份

|工具|固定来源与版本|本机核验|
|---|---|---|
|GSD Core|官方新仓库 [open-gsd/gsd-core](https://github.com/open-gsd/gsd-core)，npm 官方 registry 的 `@opengsd/gsd-core@1.19.0`；旧 gsd-build 仓库已迁移|Node24.21.0；官方 installer `--codex --global --profile=full --no-legacy-cleanup`；`validate agents` 无 missing/incomplete，Codex 与 sandbox posture 均 ok；35 个 TOML 角色|
|gstack|[garrytan/gstack](https://github.com/garrytan/gstack)，固定 commit `76aa68fc9e7a23c68f81843d0e1cf99a478dd31f`，setup 身份 `1.91.268.0`，MIT|用 skill-installer 下载固定源码，再运行上游 `setup --host codex --global --no-team`；`setup --status` 注册与 section 链接检查通过；Codex 支持由上游标记 experimental|
|gstack 浏览器|Bun1.4.2，本机 Git Bash；上游构建的 `browse.exe` + Chromium|`gstack-browser-ensure` 实际返回 `BROWSER_OK node 151.0.7922.34`；真实访问隔离4210成功，不只是命令存在|

GSD 源包位于 `C:/Users/Administrator/.codex/toolchains/gsd-core`，运行时在 `.codex/gsd-core`，技能在 `C:/Users/Administrator/.agents/skills/gsd-*`。gstack 源和浏览器位于 `C:/Users/Administrator/.codex/toolchains/gstack`，Codex 注册在 `.codex/skills/gstack*`。新技能的自动发现需下一次会话/重新载入；本轮已经直接读取安装后的技能并运行其工具。

## 配置与限制

- 安装前备份 `.codex/config.toml`，SHA256 `ee5aa273121206031bb6f3added296d57501206c953713c74502dc8cd766e08d`，备份位于工具目录 `install-backups/20261027-testing-skills`。逐字段比较：原有字段未删除、未改值；GSD 仅新增 `features.hooks`、`hooks.state`、`agents.max_depth` 和自有角色/钩子。没有更改原模型、服务商或账号。
- GSD 的 SessionStart 更新检查使用 `.codex/hooks/gsd-check-update.cmd`，固定已有 Node 路径后调用同目录 JS；没有安装新系统服务。
- gstack telemetry=off、codex_reviews=disabled、auto_upgrade=false；没有云端模型 review。首次启动检测到上游又发布269，仍保留本轮已验证的268固定源码，不把它称为最新上游。
- 上游Codex安装遗漏了browse的命令参考section；把同一固定commit的原始`browse/sections/command-list.md`原样放入已注册`gstack-browse/sections/`，供下轮技能按相对路径读取，没有改工具逻辑或采用其他版本文件。
- 上游可选字体/coreutils/CSO 原生助手未安装。不能把本次安装解释为 CSO 安全扫描通过。
- Ego/Aside 在此 Windows 环境不可用；实际用 gstack 自有隔离 Chromium，没有导入用户 cookie、密码、浏览器配置或访问用户4180。

## 实际使用

- GSD verifier 的 goal-backward、artifact、wiring、behavior 四层检查用于 [T14复核](scopes/T14-round2.md)，结论 `gaps_found`；新增双语行为测试2/2过，原四项要求仍全部为部分。没有创建替代总表的 `.planning`，也没有强迫用户重复手工UAT。
- gstack QA 用于隔离4210的正式UI补充复核，保留逐探针观察与下一步假设；本轮导航及中英文浏览器结果另见 [gstack补充复核](scopes/gstack-round2.md)。安装或单个冒烟成功均不等于整个项目验收完成。
- Windows MCP 另有原生句柄负例、真实 SDK/浏览器及独立审查；其最终状态以 T23 回执和总表为准，不以工具品牌或测试数量推断。

安装没有改 KeepAny 产品依赖/锁文件、GitHub 仓库身份、官网或正式发行。来源许可证保留在各自工具源码目录；未复制上游业务代码进入产品。
