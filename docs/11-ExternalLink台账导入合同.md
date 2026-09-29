# 11 ExternalLink 台账导入合同

KeepAny 只读取用户主动选择的 ExternalLink Settings“外链库 → 导出 JSON”文件，不连接 ExternalLink 扩展、Neon 或外链站。当前按同级 ExternalLink 本地源码 `bd916b2` 的 `extension/settings.js`、`extension/background.js`、`extension/lib/backup.js`、`extension/lib/queue.js` 和 `extension/lib/profiles.js` 核对导出格式；这不是对该扩展云端当前数据的回读。

## 使用流程

1. 在 ExternalLink 设置中点击“导出 JSON”，自行保管导出文件。文件可能包含多个项目资料、台账和其他运营信息；KeepAny 不会自动读取浏览器扩展或云账户。
2. 在 KeepAny“收录与备份 → 导入 ExternalLink 台账”选择**本机项目**、导出文件和**一个**对应 Profile，再点击“预览”。选择项目与 Profile 是必需步骤，不会按邮箱或名称自动绑定。
3. 预览会列出资料名称、网址、标题、简介、Logo/主图/截图引用数量。可填写目标站要求的最少/最多截图数及 Logo 要求进行数量检查。此处只检查引用，不下载 `cloud-media://` 或远端图片，也不上传图片。
4. 逐条勾选要导入的投递记录，再点击“导入所选”。没有可核对收据的历史 `success` 会显示为“计划中”且不能勾选。已导入同一项目、Profile 和站点组合时，界面明确提示再次勾选会更新本机记录；不会写回 ExternalLink。

只接受 `format=externallink-submission-backup`、`version=2` 的 JSON，文件上限 20 MiB。解析时仅使用 `siteProfiles` 与 `submissionRecords`，不把整个导出文件、Sheet 快照、时间线、图片数据或其他资料写入 KeepAny。台账保存在 KeepAny 的 RxDB 本机仓库，归属用户选定的项目，并保留 Profile ID、目标站规范键和导入时间。源文件及其敏感字段只在当前页面内存中处理；离开页面后需重新选择文件。

## 状态和依据

- 规范键沿用 ExternalLink 的 `destinationKey::profileId`；已知同站不同提交路径的站点按站点域名归一。导出记录的键、内部 Profile ID 和所选 Profile 必须一致，否则整次预览失败。
- `success` 只有 `confirmedBy=agent/manual` 且带非历史迁移占位内容的依据时，才可映射“已提交”。`pending_moderation` 映射“审核中”。`published` 仅映射“待核验”，不会因发布声明直接显示“已收录”。只有另外提供公开 URL、核验时间、索引时间和索引依据时才映射“已收录”。失败记录仅在有原因及日期时可写为“未通过”。
- 缺收据或缺提交时间的记录不可导入为已提交；来源 URL 的查询参数不会写入 KeepAny 台账。导出文件是历史快照，本页面不会实时检查外链站、搜索索引或 Neon。导入不是一次新的站点投递。

目前只有按真实导出合同制作的无敏感样本完成自动化验证。用户真实 Profile、正式导出文件、目标站实际收据和生产 Neon 均未读取；拿到用户授权的导出文件后仍需抽样对照原扩展页面与站点依据，见 [进度交接](08-项目进度交接.md)。
