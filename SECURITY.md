# Security / 安全报告

KeepAny is an early preview. Security-related tests and encryption implementations are not a claim that the entire product has been independently audited. Experimental sync, account binding, remote storage, and MCP have additional limits described in the release notes and project documentation.

KeepAny 当前为早期测试版。加密实现和已有测试不等于完成独立安全审计。同步、账户绑定、远端存储和 MCP 仍有各自的实验边界，请以实际版本说明为准。

## Report privately / 私密报告

If the repository's [Security page](https://github.com/Syndred/KeepAny/security) offers **Report a vulnerability**, use that private reporting form. This document does not imply that the form is enabled.

若 Security 页显示 **Report a vulnerability**，请使用该私密报告入口。本文不代表该功能已启用。若入口不可用，请在 [普通 issue](https://github.com/Syndred/KeepAny/issues) 仅说明需要私密安全报告渠道及不含攻击细节的概要，等待维护者提供渠道后再传递完整材料。

Do not post passwords, API keys, master passwords, real vaults, backups, private records, or actionable exploit details publicly. Use fictional records and a minimal reproduction. Include the affected release or commit, component, impact, reproduction steps, and any proposed fix. No response-time SLA or bounty program is currently promised.

不要公开上传密码、API Key、主密码、真实密码库、备份、个人资料或可直接利用的攻击步骤。完整报告用虚构资料，注明受影响版本／提交、组件、影响、最小复现和可选修复建议。目前不承诺响应时限或漏洞奖励。

## Scope and data boundaries / 范围与资料边界

- Ordinary records are stored in the current browser profile and origin. Clearing site data or browser storage can remove them; keep downloaded backups and verify recovery.
- The password vault and persistent model keys use a separate encrypted KDBX store. A full `.ka1` backup can include the vault ciphertext. Its master password is still required after restoring and cannot be reset by a server.
- Passwords are excluded from ordinary assets, global search, MCP, and asset sync. The optional full-text AI import in the vault sends the **current list**, potentially including passwords, only after the user reviews the provider, destination, and scope. It does not send the existing vault or master password.
- Enabling optional services changes the data flow. Read their scope before enabling them. Asset sync is not password sync or a backup.
- Use only your own local environment and synthetic data for testing. Do not test against other users, production accounts, or services without permission.

默认资料按浏览器配置和站点来源隔离；定期下载并验证备份。主密码无法后台重置。独立密码全文 AI 导入是主动授权的特殊发送范围，普通问答不因它取得密码库访问权限。测试请只用自己的本机环境和虚构资料。

## Versions / 版本

The latest preview is the maintenance focus. Use the release notes to identify your build and its known limits; there is no promised support period for earlier preview builds. Retain and verify a backup before updating. Avoid downgrading a data store with a newer schema unless the release instructions explicitly support it.

当前维护重点为最新测试版，旧测试包没有承诺的支持周期。更新前保留并验证备份；未经发布说明支持，不应直接用旧版打开新版数据结构。
