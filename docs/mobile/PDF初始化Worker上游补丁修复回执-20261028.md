# PDF 初始化 Worker 上游补丁修复回执（2026-10-28）

## 完成与实际结果

补齐 PDF.js 初始化期间原始 Worker 的所有权空窗。原握手丢失用例保持故障语义和全部断言，实际红转绿：30328ms 返回 `pdfTimeout`、文件输入恢复、review/普通 asset/history 均 0、Worker 已终止、unhandled rejection 0。

正常 worker 提取、GetTextContent 与 Terminate 双丢失（同上下文重复两次再正常读取）、仅 Terminate 丢失（随后正常读取）全部通过。原 9 项 PDF 相邻检查全部通过；最终带 Apache 修改声明的包重新生产构建后，实际生产 worker 最低 API 缺失烟测通过。这里是浏览器软件 B 验证，不外推实际最低版本设备、Native 697 原因或所有主线程 fallback 的 CPU 可中断能力。

另新增的两项官方 fallback 探针为红；未补丁官方基线同样返回 `pdfInvalid`，独立记录于 [PDF 官方 fallback 原有失败回执](PDF官方fallback原有失败回执-20261028.md)。不能把本片写为全部 PDF 功能通过。

## 上游来源、许可证与修改

- 精确 npm 包：`pdfjs-dist@6.3.289`；官方 tarball 的完整性校验与 registry 的 `sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==` 一致。
- 固定上游 commit：[`1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56`](https://github.com/mozilla/pdf.js/tree/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56)，源码 `src/display/api.js`，发布文件 `legacy/build/pdf.mjs`，原始发布文件 SHA256 `91e29f812c593904e8d48d022db5ddf93e3443575d4765ac9bfbb42494cfbd8d`。
- Apache-2.0：[原 LICENSE](https://github.com/mozilla/pdf.js/blob/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56/LICENSE) 字节不改。官方提取、最终隔离包、已登记正文三份 SHA256 均为 `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594`。
- 补丁 `patches/pdfjs-dist@6.3.289.patch` 只修改上述 legacy display 文件：新增私有 `#pendingWorker`；原始构造成功立即持有，原 test 成功移交后清空，原 `terminateEarly` 终止后清空，公开 `destroy()` 同时终止并清空 pending。未提前赋 `#webWorker`，原 error 判断、握手、fake-worker fallback 分支及 worker 实现均保留。
- 被修改源码内新增明确的 KeepAny 修改声明。仅使用 legacy 入口的现有应用导入受影响；标准 `build/pdf.mjs` 不打补丁。`intake-pdf.ts` 和 `pdf-worker.ts` 未改。
- `legal/third-party/manifest.json` 只增加 pdfjs 对应修改记录。保留原 PDF 收录、兼容、故障注入测试；新增 fallback 故障覆盖，不删除或跳过原测试。

最终补丁 SHA256 / pnpm patch hash：`1ea7b1ab5e5676afb6c41a055a6e5a0de8ee29230f627b3bd526ba0b07bf18e3`。最终 patched legacy 文件 SHA256：`dab4336559abae846a37973bfdcf67a5d47acd0e59476ad9560bc1b0cf7f2e2a`。

## 安装与回滚边界

没有原地写共享 pnpm store 或 hardlink，没有在本树执行 normal reinstall。

在仓外 `C:/Users/Administrator/.codex/toolchains/keepany-mobile/deps/pdfjs-dist-6.3.289-pending-worker/` 下载并核验官方包，再由 pnpm 11.10.0 对最小独立项目生成 lock 并执行 `install --frozen-lockfile --ignore-scripts`。带修改声明的最终补丁重新完成同样安装验证。

根 manifest/workspace/既有 lock/补丁复制到另一隔离 lockcheck 项目，由 pnpm 生成根 lock；差异仅补丁 hash、PDF importer 引用、对应 snapshot key 三处，没有更改依赖版本，原根 lock 的可选 canvas 1.0.9 保留。随后隔离 root-copy `--lockfile-only --frozen-lockfile --ignore-scripts` 验证通过，再复制回根 lock。

只替换本树 `node_modules/pdfjs-dist` 链接：先确认它原为 SymbolicLink，目标为本树 `.pnpm/pdfjs-dist@6.3.289/node_modules/pdfjs-dist`；只 unlink 该链接并建立到隔离已补丁包的 Junction。原目标保留且原文件 hash 未变。原链接类型、target、原/新文件 SHA 与最终目标记录在忽略目录 `test-results/pdf-timeout-cleanup/package-link-rollback.json`。若回滚本机链接，必须先确认其仍指向记录中的最终隔离包，再只替换此链接到原 target；不得递归删除任一包目录。

`pnpm licenses list --json` 实际成功，记录 Apache-2.0；原 `verify-third-party-license-materials.mjs --release` 通过（34 个版本、32 份材料、0 未解决）。未改全仓 SBOM 或生成的法律快照。

## 逐项验证

| 项目 | 实际结果 |
| --- | --- |
| 原握手丢失 | 30328ms，真实 ready + 丢失 test；原 Worker terminate，input enabled，普通/review 0 |
| GetTextContent + Terminate 丢失 | 两次 30493/30324ms；各自 Worker terminate，输入恢复，普通/review 0，无未处理拒绝；同上下文第三次正常读取成功 |
| 仅 Terminate 丢失 | 30499ms，Worker terminate，输入恢复，普通/review 0；同上下文随后正常读取成功 |
| 正常 control | 实际 worker GetDoc/GetTextContent/Terminate 与提取通过，普通 0 |
| 原 9 项相邻 | 9 passed / 0 skipped，70388.645ms；含中英 390/1280 收录与兼容 API 注入 |
| 最终生产构建与 worker 烟测 | build 成功；1 passed，998ms，真实生产 worker + 主/worker 缺失 API 注入 |
| 定向 tsc / 测试文件 lint / diff check | 通过 |
| 新增 fallback 2 项 | 保留原有红，见独立回执；没有称绿 |

第一轮替换本机链接后仍复用了旧 Vite 优化缓存，元数据明确指向旧官方文件、优化 JS 不含 pendingWorker；该轮 patched 前置无效，单独保留 `pending-green.log`。随后仅强制重新优化一次；正式 `pending-verified.log` 元数据和实际优化 JS 均确认使用已补丁包。正式 4 项绿使用的 patch hash 为 `959efb...25703`；后续仅增加源码修改声明，逻辑完全相同，重新安装冻结并以最终 hash 完成生产构建/烟测，不重复整套真实 30 秒矩阵。

本次原 9 项运行漏传 `KEEPANY_EVIDENCE_DIR`，旧测试输出覆盖了开跑前 clean 的 8 个精确历史 PDF PNG。已先完整复制本次输出至 `pending-regression-screenshots/` 并记 SHA，然后只对这 8 个路径 `git restore -- <精确列表>`；没有恢复整个目录或他人 dirty。该测试输出纠正不算产品红，未重复有效 9 项。对应清单为 `pending-regression-screenshots/output-correction.json`。

## 证据、未完成与提交范围

以下路径均在忽略目录 `test-results/pdf-timeout-cleanup/`，图片和 trace 不入 Git。

| 文件 | SHA256 |
| --- | --- |
| `pending-verified.log`（4 绿 / fallback 2 红） | `6846394de84ca7f17b1333cf8657a71d5dfc5e414b6e8b02048bfe15e2ad14d3` |
| `pending-regression.log` | `0546efed24101d6eacd8f93cc7a0f00935ecfa406e28df74effaa9523160574a` |
| `pending-production-build.log` | `14f7b30a510d2c8a2a74d14b05dd3e6eac84a28bb6e82d1f4b48fe905eaee8ea` |
| `pending-production.log` | `9df3e8cdaac426b96e2e9f75e8436476be9395e2882b9885c4ca4afbfd5bdcf8` |
| `pending-final-frozen-install.log` | `a1f2b843c4a267cbac4b87771808a276879fec76a89ebe4a730d7014b789a40d` |
| `pending-final-root-frozen-lock.log` | `254f350fb5a482addd2bdc176227ef03476203a54fbf3de270cbba5ec26147cc` |
| `pending-regression-screenshots/output-correction.json` | `542f91d88dfa02a4a2dcd8826468f3cf46bb0735fcc20592df347e85ff0706bf` |

首次真实红在 `1c6eb095` 独立保存。本补丁不属于已经冻结的 N18 或运行中的 Apple 产物，未接设备、未 push/触发 CI。下一步由主控独立分配 fallback 接线修复及新候选实装；本片不能核销那些尚未完成的分支。
