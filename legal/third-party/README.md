# 第三方许可证材料

`manifest.json` 是本仓库随代码交付的第三方许可证材料索引。每个已核验条目同时记录：精确 npm 版本、npm 注册表元数据与 tarball 完整性值、上游仓库 commit 或精确 tag commit、原始许可证文件路径、下载地址和本地文件 SHA-256。

`packages` 中标记为 `verified` 的条目，其 `materials` 指向本目录内保留的上游原文。`declared-with-supplement` 保存精确 npm tarball 中原始的 MIT 声明、package.json／README／作者元数据和明确标注的 SPDX MIT 规范补充；规范补充不冒充该包上游 LICENSE，也不填造版权年份或版权方。两个 Better Auth 条目另保存 SLSA 对应精确提交的 README 声明。标记为 `unresolved` 的条目只保留官方 npm 元数据和阻塞原因。不会以相邻版本或默认分支冒充精确版本材料。

本材料是再分发核对资料，不是整体法律兼容性结论。当前清单覆盖安装树中包根目录缺少许可证正文的 32 个版本：27 项有精确上游正文，5 项有精确 MIT 声明和明确标注的规范补充，0 项授权／材料未解决，共 30 份正文与声明证据。五项未找到的上游独立 LICENSE 仍如实记录；原包未提供版权通知，原始作者字段被保存但不推断为版权归属。生产 bundle 的实际模块集合和平台原生包仍需按具体构建产物独立确认。

使用以下只读命令核验已提交材料，不会读取 `node_modules`，也不会联网、生成或修改文件：

```bash
node scripts/phase0/verify-third-party-license-materials.mjs
```

整理或开发期间，上述命令允许如实保留 `unresolved`，通过只表示索引、来源字段和已保存正文的哈希一致。发布前必须运行严格门槛：

```bash
node scripts/phase0/verify-third-party-license-materials.mjs --release
```

严格模式拒绝未知／冲突声明、未解决项、缺失证据或失配哈希；允许有完整证据的 `declared-with-supplement`，但不会把通过写成每项都有上游独立 LICENSE、整体兼容性已裁定或正式发布成功。补充材料的可复现生成命令为 `node scripts/phase0/supplement-declared-mit-materials.mjs`，会先核对原 tarball 的 SHA-1／SHA-512，当前材料完成后再跑为只读 no-op。有界追查见 [2026-10-11 发布审计](../../docs/开源发布审计-2026-10-11.md)。
