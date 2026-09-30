# AI 模型配置交接（2026-10-01）

## 完成

- 新增独立的 `AiSettingsPanel`，沿用项目 Button、Radix Select、field、form-grid 和主题变量；供应商、API 基础地址、模型／方舟接入点 ID 均可修改，设置页路由与 i18n 合并由主会话接线。
- `ai-copy.ts` 提供完整中英文字典；面板的输入标签、帮助说明、错误和结果均通过文案 key 展示。密码库来源只显示所选条目标题，密码和 API Key 采用密码输入。
- 本机持久化只接受供应商、地址、模型、密钥来源和可选密码库条目 ID。API Key 默认只存在当前页面内存；刷新、关闭或在另一标签页修改配置后需重新输入。
- 永久密钥复用既有 KDBX 密码库：用户明确选择条目后，从该条目的密码字段取 API Key；不创建新加密格式，不读全库密码，不向模型发送条目详情。密码库锁定、条目修改／删除或版本变化后，内存密钥作废，需重新选择或启用。
- 配置保存失败保留原有可用连接；切换服务或地址不隐式沿用旧密钥；地址拒绝嵌入用户名、密码、query/hash 密钥，以及远端明文 HTTP。
- 连接测试只发送短合成测试文字，显示模型与服务端实际返回的输入／输出 token 数；错误映射为固定双语文案，不展示原始服务商异常。

## 接线接口

`useAiConnection()` 返回：

- `loaded`、`configured`、`settings`、`connection` 和 `revision`；已保存配置但没有有效密钥时 `configured=true`、`connection=null`。
- `saveConfiguration(input)`：`input={provider,baseURL,model,keySource:'session'|'vault'|'none',vaultEntryId?,apiKey?}`；同服务和同地址的 session 模式省略 `apiKey` 可保留当前密钥，显式空字符串会清空。
- `clearConfiguration()`、`setSessionApiKey(key)` 和 `activateVaultKey()`。保存的密码库引用在刷新后不自动读密码；启用必须来自用户动作。

`getAiConnection()` 提供当前可用连接；执行网络操作应使用 `acquireAiConnection(signal?)`，得到 `{connection,signal,isCurrent(),release()}`。设置变化、锁库或密钥失效会立即中止旧请求；异步结果落到界面前必须检查 `isCurrent()`，结束后调用 `release()`。

组件导出 `AiSettingsPanel`、可重用 `AiConnectionFields` 和 `createDefaultAiConfiguration`。`aiCopy` 需要合入主 i18next 字典。

## 验证证据

- `ai-settings-store.test.ts` 定向测试覆盖：密钥不进入持久化、刷新丢弃 session key、切换服务／地址清 key、明确密码条目访问、锁库取消在途请求、刷新与密码库版本变化需再次启用、外部 AbortSignal、存储失败保留旧连接、地址密钥与远端 HTTP 拒绝。当前 7 项通过。
- 新增 TypeScript 与 TSX 文件经 Biome 检查，0 错误、0 警告。
- 本交接记录的是配置模块源码与定向测试，主会话负责统一模型 SDK、设置页／AI 工作流接线、双语浏览器回读及真实 DeepSeek 请求。

## 未完成、阻塞与下一步

- 待统一 `packages/ai` 落盘后做整体类型检查，并在正式应用中验证保存、刷新、临时密钥重填、KDBX 解锁／锁定、模型切换和失败提示。
- 真实模型连接须以实际服务请求及用量读回验收；配置已保存或合成 SDK 测试不等于真实供应商已通过。
- 后台推送由用户确认后续处理，本模块仅提供模型连接配置。

## 提交、远端与部署

- 本子任务只提交所属配置源码、测试、样式和本文档，主会话负责推送与版本打包；尚未部署。
- 会话检查到 `origin`，远端同步由主会话统一执行，避免并发更新共享工作树。
