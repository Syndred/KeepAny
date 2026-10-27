# 第三方许可证材料

`manifest.json` 是本仓库随代码交付的第三方许可证材料索引。每个已核验条目同时记录：精确 npm 版本、npm 注册表元数据与 tarball 完整性值、上游仓库 commit 或精确 tag commit、原始许可证文件路径、下载地址和本地文件 SHA-256。

`packages` 中标记为 `verified` 的条目，其 `materials` 指向本目录内保留的上游原文。`declared-with-supplement` 保存精确 npm tarball 中原始的 MIT 声明、package.json／README／作者元数据和明确标注的 SPDX MIT 规范补充；规范补充不冒充该包上游 LICENSE，也不填造版权年份或版权方。两个 Better Auth 条目另保存 SLSA 对应精确提交的 README 声明。标记为 `unresolved` 的条目只保留官方 npm 元数据和阻塞原因。不会以相邻版本或默认分支冒充精确版本材料。

本材料是再分发核对资料，不是整体法律兼容性结论。原清单覆盖2026-10-01安装树中包根目录缺少许可证正文的32个版本；2026-10-28另登记手机PDF兼容实现实际使用的core-js 3.50.0及pdfjs-dist 6.3.289。当前共34个版本：29项有精确上游正文，5项有精确MIT声明和明确标注的规范补充，0项授权／材料未解决，共32份正文与声明证据。这个历史材料索引不是当前全部依赖清单。五项未找到的上游独立LICENSE仍如实记录；原包未提供版权通知，原始作者字段被保存但不推断为版权归属。生产bundle的实际模块集合和平台原生包仍需按具体构建产物独立确认。

手机Vite构建另输出`third-party-notices.md`，由实际bundle的模块生成。core-js与PDF.js的LICENSE原文均按精确npm gitHead下载并与安装文件逐字节相等；源文件、commit、SHA和npm完整性值见manifest。core-js实现未改；PDF.js 6.3.289的`legacy/build/pdf.mjs`有单列的`patches/pdfjs-dist@6.3.289.patch`：仅补初始化握手完成前的Worker所有权与销毁，保留官方握手和fake-worker回退，不改worker实现或LICENSE。对应原源码`src/display/api.js`、固定commit及修改点见manifest的`localModifications`。保留`tests/e2e/intake-pdf-timeout-cleanup.spec.ts`、`intake-pdf-compatibility.spec.ts`及原PDF收录相邻测试，覆盖真实worker故障清理、主线程／独立worker缺失API、继承资源PDF、预览确认与原限制。最低WebView111／iOS16.4不变，软件兼容注入测试不替代实际旧系统验收。

使用以下只读命令核验已提交材料，不会读取 `node_modules`，也不会联网、生成或修改文件：

```bash
node scripts/phase0/verify-third-party-license-materials.mjs
```

整理或开发期间，上述命令允许如实保留 `unresolved`，通过只表示索引、来源字段和已保存正文的哈希一致。发布前必须运行严格门槛：

```bash
node scripts/phase0/verify-third-party-license-materials.mjs --release
```

严格模式拒绝未知／冲突声明、未解决项、缺失证据或失配哈希；允许有完整证据的 `declared-with-supplement`，但不会把通过写成每项都有上游独立 LICENSE、整体兼容性已裁定或正式发布成功。补充材料的可复现生成命令为 `node scripts/phase0/supplement-declared-mit-materials.mjs`，会先核对原 tarball 的 SHA-1／SHA-512，当前材料完成后再跑为只读 no-op。有界追查见 [2026-10-11 发布审计](../../docs/开源发布审计-2026-10-11.md)。

## elkjs 0.12.0 源码与分发说明

账号关系布局直接使用未修改的 `elkjs@0.12.0` npm 包。包内原始声明为 `EPL-2.0 OR GPL-3.0-or-later`，KeepAny 本次按 **Eclipse Public License 2.0（EPL-2.0）** 分支使用和分发该依赖，保留原版权、免责声明及次级许可通知。该程序的源码按 EPL-2.0 提供，可从以下固定地址取得源码与构建材料；KeepAny 没有修改或另行授权这些上游文件。

- elkjs：[`ff5771d7165445c42c408bb8a090c8035272218c` 源码](https://github.com/kieler/elkjs/tree/ff5771d7165445c42c408bb8a090c8035272218c)及[该提交源码归档](https://github.com/kieler/elkjs/archive/ff5771d7165445c42c408bb8a090c8035272218c.tar.gz)。该提交同时对应 npm `gitHead`、GitHub `0.12.0` 标签和 [npm 发布 provenance](https://registry.npmjs.org/-/npm/v1/attestations/elkjs@0.12.0)记录。
- ELK 算法源码：[ELK 0.12.0 标签提交 `323312916048544e4e594eab3303cdb0d01e2929`](https://github.com/eclipse-elk/elk/tree/323312916048544e4e594eab3303cdb0d01e2929)及[源码归档](https://github.com/eclipse-elk/elk/archive/323312916048544e4e594eab3303cdb0d01e2929.tar.gz)。此版本映射依据 [elkjs 官方发布说明](https://github.com/kieler/elkjs/releases/tag/0.12.0)，不是从 npm 版本号推断的精确二进制重现结论。上游[版权／第三方说明](https://github.com/eclipse-elk/elk/blob/323312916048544e4e594eab3303cdb0d01e2929/NOTICE.md)随该源码归档保留。
- 构建材料：elkjs 同一固定提交的 [`README.md` 构建说明](https://github.com/kieler/elkjs/blob/ff5771d7165445c42c408bb8a090c8035272218c/README.md#building)、[`build.gradle`](https://github.com/kieler/elkjs/blob/ff5771d7165445c42c408bb8a090c8035272218c/build.gradle)、[`package.json`](https://github.com/kieler/elkjs/blob/ff5771d7165445c42c408bb8a090c8035272218c/package.json)、[`package-lock.json`](https://github.com/kieler/elkjs/blob/ff5771d7165445c42c408bb8a090c8035272218c/package-lock.json)和 [`gradle/wrapper`](https://github.com/kieler/elkjs/tree/ff5771d7165445c42c408bb8a090c8035272218c/gradle/wrapper)。上游要求 `elkjs` 与 `elk` 源码目录并列，使用 npm／Gradle 构建；该提交 CI 使用 JDK 17。上游构建还会获取 Gradle／Maven／npm 依赖，其中 `build.gradle` 的 `melk` 为 `0.12.0-SNAPSHOT`，本轮未验证其离线重建或可重复构建。
- 精确 npm 产物：[`elkjs-0.12.0.tgz`](https://registry.npmjs.org/elkjs/-/elkjs-0.12.0.tgz)，SHA-1 `7dc1bc71ab8f402d1b6564e2fa509ca1caee276c`，SRI `sha512-YZcKynxVxYoKIOEpywEPwCFdg+BTbxQRNf3pbwdDCvc8O3kQD8bmIwSxKU1eOTVc4Xo+VG9Te+575mlfvOrhEQ==`；2026-10-22 读取该产物计算的摘要与官方 npm 元数据一致。
- 许可原文：[`LICENSE.md`](https://github.com/kieler/elkjs/blob/ff5771d7165445c42c408bb8a090c8035272218c/LICENSE.md)，SHA-256 `637e81f4a1b6b4079535c499fca05e238cf7605c1ff5b76d60d7da7ce96700c9`，与本次安装包中的文件一致。包中 API 源码保留 Kiel University and others 的 2017／2021 年版权通知。

ELK 的 npm 包自带 `LICENSE.md`，因此不计入上文 32 项“包根目录缺少正文”的 `manifest.json` 范围。现有便携打包流程会从实际使用的依赖复制完整许可原文到 `legal/installed/elkjs@0.12.0/LICENSE.md`，在 `legal/preview-license-inventory.json` 中记录其摘要，并将本说明随 `legal/third-party` 一起提供。发布时仍需核对实际产物中的许可原文、版权通知、源码说明及 SBOM；文档登记和材料脚本通过不代表整体法律兼容性已裁定。
