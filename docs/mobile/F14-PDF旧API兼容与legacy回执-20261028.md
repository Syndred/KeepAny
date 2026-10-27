# F14 PDF 旧 API 兼容与 legacy 回执（2026-10-28）

完成最小两行产品修复：PDF 主模块与 worker 同时切换现有 `pdfjs-dist@6.3.289` 的配套 legacy 构建。新增兼容 B 实测 3/3、原 PDF 相邻 B 4/4 通过；原 modern 在当前 Native 缺失 API 条件下的**真实功能红**保留。没有升级依赖、复制上游源码、自写全局 polyfill、改 Native/OS 最低版本或业务存储。

**边界：本片是共享浏览器 B，不是 Android/iOS Native 实跑。N16 不包含本修复，待主控冻结新 N17 后由设备 owner 实验；不能据此核销 F14 全组。** 全部文件与资料是自造 PDF，未使用私密 fixture、设备、KDBX、真实凭据或 paid provider。

## 事实、来源与上游复用

- 设备 owner 公共能力回执确认 N16 为 Android16 / Chrome133.0.6943.137；`Promise.withResolvers=function`，`Map.prototype.getOrInsertComputed=undefined`，`Uint8Array.fromBase64=undefined`。此前 Chrome111 的假设不适用于当前 N16，本片没有拿缺 Promise 的更老浏览器当当前 Native 红。
- [上游 README](https://www.npmjs.com/package/pdfjs-dist)建议旧环境使用 legacy；[官方支持 FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions#faq-support)明确 modern 面向最新浏览器，当前 legacy 表列 Chrome125+、Safari18+。这是相应运行时条件，**不保证全部 Android minSdk24 旧 WebView 或 iOS15 都能读取 PDF**；没有自行降低该边界。
- 固定包 6.3.289，官方 [release](https://github.com/mozilla/pdf.js/releases/tag/v6.3.289) / [源码 commit](https://github.com/mozilla/pdf.js/commit/1c8020a7d4e43668ac287a3ecf9a8dbea17e4c56)，安装文件头 `pdfjsBuild=1c8020a7d`。原入口 `build/pdf.mjs`、`build/pdf.worker.min.mjs`；新入口 `legacy/build/pdf.mjs`、`legacy/build/pdf.worker.min.mjs`，没有混版本/混主 worker。
- `node_modules/pdfjs-dist/LICENSE` 与两 legacy 文件头为 Apache-2.0；legacy 已内嵌 core-js3.50.0 的 Map/Uint8 等官方兼容实现，其元信息指向 [core-js v3.50.0 MIT LICENSE](https://github.com/zloirock/core-js/blob/v3.50.0/LICENSE)。本片只 import，未复制/修改上游源；分发许可证全局机制由主控法律 owner 统筹，本片不改全局 manifest。
- legacy 仍调用 `Promise.withResolvers`，没有因“legacy”承诺兼容更老未知环境。主模块/worker 的真实功能与 worker before/after 能力有独立证据；不把 window 全局函数是否都变成 function 当产品功能合同，也不额外补 window API。
- 原应用 owning source 仍为 `android.minWebViewVersion=111`、iOS 最低16.4；本片没有将其升级成 PDF.js 的支持下限。当前133修复可独立验收，但原最低线的 Promise 能力缺口仍待独立 B 确认/闭合，目标继续，不叫“全兼容”。

## 原始功能红与根因

自有隔离 Vite 端口 4236，watch/HMR 关闭；优化预热后固定消费者。Playwright 独立 context、zh-CN/en、390×844。initScript 在页面应用模块前移除上述两个实际缺失 API；测试路由只给**真实 worker 原脚本**加同样删除和 before/after 能力探针，不替换 PDF 解析结果、消息协议、文档字节或 repository 写入。

复用既有 `fixtures/pdf.ts`，只扩第三个可选 options：给父 Pages 添加标准继承 Resources，页保留自身 Resources，原 PDF writer 按新对象字节重新产生正确 xref。默认空白/英文/中文旧调用逐 byte 保持，未造非法 PDF。

| 点击/输入 → 预期 | 原 modern 实际 | 证据 |
| --- | --- | --- |
| 正常浏览器 API 控制：收录 → PDF 文档 → 同一继承资源 PDF → 应得到可读原文候选 | 控制例 1/1 通过，Short description 为合成完整原文 | `inherited-final-red-run.txt` 控制例；不是仅检查函数类型 |
| 中英各收录 → PDF 文档 → 选择同一合法 PDF；仅主/worker 两项 API 缺失 → 应 preview、尚未写资产 | 两语候选 **0**，普通 asset/history records **0**，页面提示此 PDF 未生成候选/No candidate；worker 采到 `getOrInsertComputed` 错误 1 次，两个 API after 仍 undefined | `frozen-red-output/**/runtime-observations.json`、两语失败截图；`frozen-red-run.txt` SHA `8401a5c7fb0819ba4e88bf9b5b7bf4b12637b1dd4c6e589d9f2da175555b0431` |

根因是 worker 的 Page `#getInheritableProperty('Resources')` → `Dict.merge` → `properties.getOrInsertComputed`（安装的 modern worker:940）。简单单页没有走这个分支，ASCII/中文简单样本可通过；不能仅因缺 API 宣称所有 PDF 都失败。标准 parent Resources 控制例把“文档非法”的解释排除，实际 worker 错误与源码位置一致。

早期只要求 worker/window 全局函数恢复的断言失败属于测试错误，不是功能红。重复文件选择曾未等前次结束，另有 20001 字符用 12pt 单行伸出页面造成提取不足的夹具问题；已分别等文件输入恢复 enabled，并将长文本字号设 0.01pt 确保真实文字落页。上述失败文件保留在独立历史输出，不混入本段产品红。初次预热语言未固定也只记工具夹具失败，随后明确 en 预热成功。

## 最小修复后的逐项复验

产品 `apps/web/src/intake-pdf.ts` 仅两条 import 变化。10MiB、20 页、20000 字符、30s、useWorkerFetch=false/useWasm=false、错误映射/destroy、先 preview 后逐条确认、无 OCR/无猜金额/无自动写入均保留原代码。

| 实际操作 → 预期 | 最终 B 实际 |
| --- | --- |
| 两语 390，主页面和 worker 前都删除 Map/Uint8 API → 真实继承资源 PDF 可读取 | 两语候选各 1，原文含两行固定合成内容；普通 records 0、未选类型确认按钮 disabled |
| 核对 worker before/after，不 mock 提取 | before 两项 undefined、Promise function；真实 legacy worker after 两项 function、Map 错误 0；原文真实返回 |
| 选择 project/填写名称 → 明确确认 → 只写本候选 | asset 1/history 0，完整提取 description 与 preview 一致；后续同一 asset ID 保持 |
| 页面重开 → 选择同字节改文件名 | 原 confirmed 决定保留、候选不重复、原资产 ID 不变 |
| 真实中文文本 PDF → 核对中文 → Ignore → 同字节再次选择 | 精确中文“中文账单服务费用”；ignored 保留、总候选 2、普通资产仍仅前一个 |
| 空白 PDF、真实 image-only XObject PDF（无文字） | 两者都显示无可读文字、不生成候选；没有 OCR/自动金额或隐式普通写入 |
| 损坏 PDF | 显示未生成候选；既有候选与原资产保持 |
| >10MiB、21 个独立 Page refs、落页 20001 字符 | 均按原 PDF 限额拒绝；不是用坏 PDF 充当限额测试 |
| 中英 390 全程 | 原流程能操作、无横向滚动，pageerror 0；两语 preview/final 截图已目检，不外推全部 UI/UX |

最终新兼容测试 3/3，20.8s，输出 `test-results/pdf-compatibility/final-frozen-green-output/`；日志 `final-frozen-green-run.txt` SHA `a1bac0db7e66cd22f5ced902f8ae714e752f9aa1da0b05b60b2d3873bea1404d`。其中 2 项两语完整流程，另 1 项合法 PDF 控制，不将数量当整个手机版完成证明。

保留并执行原 `intake-pdf.spec.ts` 中英×390/1280 四项，4/4、25.1s；日志 `adjacent-run.txt` SHA `15d88492bc5b8ea00ea012a5722de59593ed6ee84d58a8613e92498c63dce9ae`。使用独立 output/evidence 目录，没有覆盖旧交接截图或其他 agent 输出。

默认 fixture 三组逐 byte 检查 `default-fixture-check.txt` SHA `e0e63daada869fa3fe33502953504af5747fa83885eb27a91816e4c91a4aea81`：空白 569B SHA `20fb6f70…03634d`、英文 633B SHA `a1883e32…bd0d19`、中文 1219B SHA `9a76153a…b1143c`，均与原 HEAD writer 相同。新兼容测试与 fixture 定向 Biome 无错误，`tsc --noEmit` 退出0；首次新测试两处隐式 any 已补准确返回类型，未放宽 tsconfig。

## 复现命令、收尾与 Native 待验

```powershell
# 自有4236已由本片关闭；主控下次需独立启动再运行
$env:KEEPANY_E2E_PORT='4236'
node node_modules/@playwright/test/cli.js test tests/e2e/intake-pdf-compatibility.spec.ts --grep 'N16 missing APIs|control with native' --workers=1 --output=test-results/pdf-compatibility/recheck-output
```

测试 helper/兼容 E2E 是原 PDF 流程的真实输入扩展，不是另造提取或存储实现。实际 30s 超时分支本片没有等时故障注入，源码定时器未改；加密 PDF、所有字体/特殊文档、所有旧 WebView、物理设备与 iOS 不外推。

为 N17 owner 留小型公开合成输入 `test-results/pdf-compatibility/native-synthetic/`：继承资源、中文、image-only、空白、损坏、21页、20001字符。manifest SHA `283103420d08f4916682d6b3344225090a54d3d371d76f92735cf87f15dbc6f0`；关键继承资源 PDF 683B/SHA `a3d884367a63416634b2613377d4f20c816d14f44a45494cc11688a96837bf07`。没有向设备推送这些文件或操作设备；只有正式新包后才由 owner 操作原生 picker 核验。

本片新建 browser/context 均 finally 正常关闭，自有 Vite/4236 已停止，无下载服务或并行浏览器遗留；合成证据按本回执保留供复验。已 fetch origin、主线无缺失；精确提交只包含两行产品改动、一个既有 fixture 小扩展、新兼容 E2E 和本回执。没有改共享 node_modules、lockfile、Native、其他 agent 文件，没有 push/触发 CI；N16 实际 PDF 尚未验证，更不能以本 B green 宣称 Native 已修复。

## 最低线 Promise 缺口续记：独立 B 仍 red

当前133修已独立提交 `e56a677226021bfd2249af7ec08aeec139bcf3a0`，不阻止保留这一真实修复。其后按 owning source 的 WebView111/iOS16.4 最低线，新增两个**预期成功**的合同用例，没有 skip/xfail 或把准确 unsupported 当完成。仅模拟缺 API，不模拟完整旧版 JS parser、所有浏览器行为或真实 iOS 系统。

| 缺失条件/操作 | 最终实际 B |
| --- | --- |
| 主页面应用模块前删 Promise，真实 worker 请求也配置先删 → 同合法继承资源 PDF 应 preview | 候选0，主模块先拒绝，workerStarts=0；直接调用同一正式 readPdfText 返回 `TypeError: Promise.withResolvers is not a function`；UI 通用 Could not finish。不能声称此例已运行 worker |
| 主 Promise 保留，只在实际 worker 模块前删 Promise → 同 PDF 应 preview | 主 before Promise=function；真实 worker before Promise=undefined，legacy worker after Map/Uint8=function 而 Promise 仍 undefined；实际 workerStarts=2（原 UI 一次＋限3秒只读提取 probe 一次），workerPromiseErrors=2，pageerror 两条 Promise 错误；候选0，UI 到原30秒超时提示，probe 仍 pending |

可信最终运行 `test-results/pdf-compatibility/tagged-worker-run.txt`（SHA `c9b5665182d9ab0999d61a8d6494f68863ce0fc59af7133a55e01fe5add1ae08`）：**当前133两语完整流程+合法控制3 passed，最低线2 failed，58.3s**。独立 `minimum-runtime-observations.json` 与失败截图保留在 `tagged-worker-output/**`，不含私密资料或伪造 DB 写入。只读 probe 重读同一合成 PDF，没有 stage/确认/资产回放。context 收尾关闭了实际 worker，没有留后台解析。

测试自审发现并修正过一次重要误差：原路由也命中 Vite `pdf.worker…mjs?url` 的**主线程 URL 模块**，其 worker-only 红实际上 workerStarts=0，因此那一版不算独立 worker 证据。尝试依赖 sec-fetch-dest 过滤时，本机路由拿不到该头，造成未注入与能力探针断言失败，也不算产品红。最终仅实际 Worker 构造器对 PDF worker URL 加专用 query；只给此请求加前缀，跳过 `?url` 与 fake-worker 主线程 import。probe 证明真实 worker 起点与能力变化。此前当前133的 actual worker Map 错误仍保留，最终3项 green也重新执行，不能把错误的 worker-only 结果混用。

当前 legacy worker 是无静态 imports 的上游单文件 bundle，前缀删 API 发生在其代码执行前；**后续若增加有静态 imports 的自有 worker entry，必须改为受控 bootstrap 先删 API 再 dynamic import 真模块，并排除 bootstrap 递归**，不能在 ESM imports 已执行后才删掉兼容实现制造假红。

```powershell
# 这两项当前明确 red；依赖/worker兼容修复后必须真正转绿
node node_modules/@playwright/test/cli.js test tests/e2e/intake-pdf-compatibility.spec.ts --grep 'minimum-runtime' --workers=1 --output=test-results/pdf-compatibility/minimum-recheck-output
```

本续记只扩测试/证据，产品仍为 e56 的两行 import。没有提高 minWebView/iOS 下限，没有手抄 Promise polyfill、修改共享 node_modules/lock 或新增依赖。官方 core-js 子模块、配套 worker entry 与分发许可的后续方案由主控统筹；最低线 gap 保持 active，不能称全兼容。最终 tsc/定向 Biome 通过，4236 和自有 context 已关闭；不 ADB、不 push、不触发 CI。
