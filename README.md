# KeepAny

数据由用户掌握的开源个人资产工作台。统一管理项目、账号、订阅、实物及其关联与维护事项。

## 当前状态

**本地核心已有可运行的 React 应用；阶段 0–4 的部分技术原型已完成，尚未达到正式发布或官方云同步门槛。** 逐项证据和剩余工作见 [项目进度交接](docs/08-项目进度交接.md)。

- 首期语言：简体中文 `zh-CN`、英语 `en`。
- 核心：本地可用、不要求注册、可完整导出；官方云同步和AI服务可选。
- 密码：首期只引用专业密码库条目，不保存密码、恢复码或主密码。
- 正式应用使用 React、RxDB + Dexie，支持本地资产、关系、待办、回收站、加密备份和中英文界面；参考 HTML 只保留为设计档案。
- 自备 S3/WebDAV 的手动加密备份已有正式 Web 入口和本机受控 HTTP 读回/恢复验证；真实存储服务和生产 CORS 尚未验收。
- 同步服务、端到端加密与 MCP 为可测试的开发原型；可选自部署服务已接入 Better Auth 多用户会话试验及现有单人令牌模式，本机真实 PostgreSQL 双客户端协议测试、受限账户绑定桥与合成商业账号的批准/续期/撤销联调。MCP 有 macOS 本机可安装 npm tarball，并已从仓库外通过官方 SDK、生产构建 Web 的授权/逐次写批准/撤销纵切；公开 HTTPS 回环、Windows/Linux、真实商业账号与设备、生产部署和安全审计尚未闭环，普通用户入口不开放。

## 本机运行

要直接使用已构建的本地版，请先看 [release/README.md](release/README.md)，在仓库根目录执行 `./release/start.command`，然后打开固定地址 `http://127.0.0.1:4180/`；`./release/stop.command` 停止服务。首次使用需 Node.js、pnpm 及 `pnpm install --frozen-lockfile`。浏览器资料由当前地址和浏览器配置文件隔离；从旧开发端口搬入资料须先导出加密 `.ka1` 再在新地址恢复。

开发源码时依锁文件安装后运行：

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```

`pnpm dev` 默认监听 `127.0.0.1:5173`；若端口已占用，Vite 会选择空闲端口。应用数据存于当前浏览器的本机存储，清除浏览器数据前请先导出加密备份。`pnpm test:e2e` 用隔离 Chromium 验证正式下载与干净上下文恢复，以及中英文五种视口；MCP 本机打包与安装、客户端配置见 [本机启动器说明](apps/mcp-launcher/README.md)，可选账户绑定入口的固定 issuer/本机桥配置见 [绑定桥说明](apps/binding-bridge/README.md)，同步服务的隔离运行说明见 [服务 README](apps/sync-server/README.md)。

## 文档入口

1. [产品范围与开放边界](docs/00-产品范围与开放边界.md)
2. [技术栈与架构决策](docs/01-技术栈与架构决策.md)
3. [依赖版本与许可证快照](docs/02-依赖版本与许可证快照.md)
4. [开源业务模块复用审计](docs/03-开源业务模块复用审计.md)
5. [数据同步与隐私方案](docs/04-数据同步与隐私方案.md)
6. [UIUX与中英文规范](docs/05-UIUX与中英文规范.md)
7. [开发计划与验收清单](docs/06-开发计划与验收清单.md)
8. [ShipAny商业项目拆分](docs/07-ShipAny商业项目拆分.md)
9. [项目进度交接](docs/08-项目进度交接.md)
10. [冻结版UI参考](design/keepany-ui-reference.html)
11. [远端加密备份配置](docs/10-远端加密备份配置.md)
12. [ExternalLink 台账导入合同](docs/11-ExternalLink台账导入合同.md)

## 目录约定

`apps/web` 为本地优先应用，`apps/sync-server` 为可选自部署服务，`packages/*` 放领域模型、本地仓库、同步协议、加密与连接器。`apps/worker` 尚未建立，演示 HTML 不是应用入口。

商业官网、会员与运营后台计划放在同级 `../KeepAnyAdm`，独立仓库，不置于本仓库。用户已在同级 KeepAnyAdm 放入 ShipAny 模板，保持私有独立仓库。

## 许可证状态

仓库已加入 AGPL-3.0-only 的 `LICENSE`、`NOTICE.md` 与按锁文件生成的 `SBOM.spdx.json`；最终发布前仍须核查缺失的包根许可证正文、保留的上游 NOTICE 和整体兼容性。当前没有导入第三方业务源码，也没有把规划文档宣称为已经许可完整产品。不得把 ShipAny 源码、密钥、生产数据或不明来源素材加入本仓库。
