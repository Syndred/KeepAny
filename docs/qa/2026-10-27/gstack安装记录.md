# gstack 安装记录

日期：2026-10-27。用户明确要求安装 gstack /qa，并先审阅 KeepAny 测试总表。

## 来源与安装

- 上游：[garrytan/gstack](https://github.com/garrytan/gstack)。固定源码commit：`6bbd0a536f99430f6760931e912ce4428e8ecd5e`。上游版本：`1.91.266.0`；package.json为`1.91.266`。许可证：MIT；原文保留在全局工具目录的LICENSE。
- 使用系统skill-installer的`install-skill-from-github.py`按commit下载完整仓库到`/Users/syndred/.codex/toolchains/gstack`；下载器未保留可执行位，按上游git tree的100755模式恢复192个文件。安装元信息保存在该目录`.keepany-install-source.json`。
- 按官方`./setup --host codex --no-team`构建运行时并注册全局技能。没有把gstack源码、依赖或工作流复制到KeepAny应用；没有修改本项目package.json和锁文件。
- Codex技能入口：`/Users/syndred/.codex/skills/gstack-qa/SKILL.md`；路由根：`/Users/syndred/.codex/skills/gstack/SKILL.md`。同套辅助技能由官方setup一起注册。该目录的SKILL.md实际frontmatter名称为`qa`；下一轮按技能列表的实际名称发现和调用，不仅凭目录名推断。
- 本机原无可执行Bun；经npm安装固定`bun@1.4.2`到`/Users/syndred/.codex/toolchains/bun`，只在既有PATH目录`~/.local/bin/bun`增加链接，未修改shell启动配置。
- 浏览器运行时：gstack依赖Playwright 1.62.1，Chromium/headless shell 1234。官方安装将Codex兼容等级标为experimental；不等于在Codex已完成所有技能的实际验收。

## 配置与限制

- `telemetry=off`、`codex_reviews=disabled`、`auto_upgrade=false`。本轮没有调用收费模型、外部评审CLI、云AI或真实账号；没有开启团队自动更新或更改KeepAny的AGENTS.md。
- 官方setup的可选coreutils安装因耗时主动中止；setup继续成功。它用于外部评审命令的超时保护，与本次关闭的外部评审及/qa浏览器能力无关。未为此更改产品依赖。
- CSO容器镜像未预载，因为本机固定Docker socket不可用；本次只验收/qa安装，不宣称整套安全审计环境可用。
- 安装器曾清理Playwright共享缓存中的1243浏览器；随后使用本项目1.63.0、设置`PLAYWRIGHT_SKIP_BROWSER_GC=1`恢复1243，两套浏览器缓存保留。
- 使用官方自带隔离Chromium验证工具；没有操作真实Chrome密码页或用户4180资料，不冒称Ego原生已验证。

## 自检回执

|检查|实际结果|
|---|---|
|官方安装|setup退出0，输出gstack ready (codex)|
|Codex注册|setup --status退出0；global/current 1.91.266.0|
|入口与模块|根router为真实文件；26处section链接全部可解析|
|Bun|bun --version为1.4.2|
|浏览器启动|在一次性独立目录启动headless Chromium并打开本机测试HTML成功|
|实际点击|snapshot识别Install check按钮；click @e1后页面从not-clicked变成clicked-once|
|退出清理|browse stop成功；一次性HTML、git目录、浏览器状态及临时下载检查文件已清理|
|KeepAny的Playwright 1.63环境|Chromium及headless shell 1243重新安装成功；原有1.63.0浏览器启动自检通过|
|KeepAny产品测试|未开始；总表104项均未执行，等待用户审阅|

上述点击只验证安装工具，没有把它算作KeepAny产品用例通过。
