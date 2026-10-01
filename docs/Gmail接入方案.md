# Gmail 接入方案（2026-10-01，待实现）

## 用户提出的用途

用户希望通过邮箱接收到期通知，并连接 Gmail，从注册、登录、订阅及续费邮件中发现使用的网站，回填 KeepAny。当前仓库没有 Gmail、SMTP 或邮件通知接入；本文件是可实施方案，不是交付或授权成功证据。此前确认的当前通知范围仍为应用内＋浏览器，关页后台推送后续做。

## 建议首个切片：只读连接与候选回填

复用 Google Identity Services 的 OAuth token model，不收集 Gmail 密码；只请求 `gmail.readonly`，不申请发送、修改、删除邮箱权限。首版手动同步，选择日期／标签和批次上限；通过 messages.list 的 q / labelIds 和 messages.get 读取必要邮件。邮箱 API 的按日期查询默认 PST，跨时区使用 Unix 秒边界。浏览器短期 access token 只在会话，失效时重新授权，断开清除凭据；不把凭据写入普通 RxDB 资产或常规同步。长期后台凭据另作独立授权和服务端加密方案。

复用既有收录审核与稳定候选 ID：本机按邮箱＋messageId去重，保留邮件日期、发件人、来源依据；给出网站名称／网址／账号邮箱、可证实的订阅金额、币种、账期和续费日期。显示「新资料」或「已有资料更新」，用户核对后写入 RxDB；更新必须显示字段差异并比较当前记录。历史邮件不得覆盖用户后来编辑的数据。重复同步、取消、错误授权、无效响应、旧请求晚返回不能增加重复资产。

注册／登录邮件只能作为账号线索，不能认定当前账号有效，更不能从单次登录通知创建订阅。同域名多账号分别审核；抄送、转发和共享邮箱不得误判为当前用户注册。验证发件人与网站归属，拒绝把邮件中的操作指令当系统指令，不自动点击登录／找回密码链接或执行邮件动作。

默认先本机规则筛选与提取；需要 AI 时用户明确选择候选和模型，预览即将发送的必要字段。排除验证码、一次性登录链接、重置链接、密码和密钥；不默认发送整邮箱。AI 只返回受限候选，不自主写库。是否保留最小来源摘要纳入实际加密备份，原始邮件正文默认不长期保存。

## 邮件提醒：独立后台切片

收件地址可以是 Gmail 或其他邮箱，接收 KeepAny 通知不要求连接邮箱读取权限。复用现有提醒时间／时区／重复规则、完成／删除过滤及持久收据，后台调度通过成熟事务邮件 SDK 或自部署 SMTP 发送；密钥只在服务器，不进入网页包。需要明确配置发信域名／服务与收件地址验证，回读实际收件箱后才能称送达。

用户明确开启邮件通道后，上传该通道所需的最少日程和显示字段；开源本地核心仍可离线运行。取消、延期、完成或禁用通道须同步撤销后台计划；失败重试用同一幂等键，避免重复发信。只用匿名计时或端到端密文存储无法生成有内容的服务器邮件，设计中需明确服务器可见的通知字段。

若要求新邮件在关页后自动识别，另接 Gmail watch＋Cloud Pub/Sub、history.list 增量处理和失效重建。watch 至少每7天续期，官方建议每天续期；该机制是邮箱变化通知，不是现成的 KeepAny 到期提醒发送器。此部分不冒称浏览器本机能力。

## 上线与验收

Gmail `gmail.readonly` 是 Google 限制类权限。公开应用须按 Google OAuth 验证要求准备；限制数据传输／服务器存储涉及安全评估，接入 AI 前还需核对 Google Workspace 数据使用政策。产品用途是根据邮件持续整理和监测账号／订阅，改善用户邮件处理；Google禁止仅做一次性或手动邮件导出的应用，不能把整邮箱导出工具当作此功能。正式OAuth申请需核对适用的批准用途，不预先承诺审核通过。测试OAuth client、来源／回调、测试账号授权、真实收件／真实邮件读取分别验收，不能把Google登录当成邮箱授权已完成。

建议顺序：先手动只读同步→有来源的候选与更新确认；再邮件通知→定时／即时摘要、关闭应用实际收件、撤销与重复抑制；最后关页增量同步。界面均需中英 keys 和现有 React 组件。验收使用合成测试邮件，取消0写入、确认刷新回读、重复同步去重、原库不覆盖，以及失败／撤销后的可见状态。

## 官方依据与复用入口

- [Gmail 权限清单](https://developers.google.com/workspace/gmail/api/auth/scopes)：只读、发送等权限分离及公开审核要求。
- [搜索与过滤](https://developers.google.com/workspace/gmail/api/guides/filtering)：q、labelIds和日期时区规则。
- [Google Identity Services token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)：浏览器短期授权、令牌失效和重新请求。
- [Gmail push 指南](https://developers.google.com/workspace/gmail/api/guides/push)：Pub/Sub、watch续期与history增量。
- 项目复用：现有 `ai-workflow-model`、收录审核 FileStore、RxDB 资产仓库、领域金额／提醒规则；服务器凭据及邮箱原文不进入普通资产、密码库明文或 MCP。

- [Google Workspace数据使用政策](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)：批准用途、限制数据与AI使用要求。
