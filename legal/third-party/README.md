# 第三方许可证材料

`manifest.json` 是本仓库随代码交付的第三方许可证材料索引。每个已核验条目同时记录：精确 npm 版本、npm 注册表元数据与 tarball 完整性值、上游仓库 commit 或精确 tag commit、原始许可证文件路径、下载地址和本地文件 SHA-256。

`packages` 中标记为 `verified` 的条目，其 `materials` 指向本目录内保留的上游原文。标记为 `unresolved` 的条目只保留官方 npm 元数据和阻塞原因；没有可信的版本到上游提交映射或没有可定位的上游许可证文件时，不以相邻版本、默认分支或 SPDX 标准文本替代。

本材料是再分发核对资料，不是法律兼容性审查结论。当前清单同时覆盖安装树中包根目录缺少许可证正文的 31 个版本；生产 bundle 的实际模块集合和平台原生包仍需按具体构建产物独立确认。

使用以下只读命令核验已提交材料，不会读取 `node_modules`，也不会联网、生成或修改文件：

```bash
node scripts/phase0/verify-third-party-license-materials.mjs
```
