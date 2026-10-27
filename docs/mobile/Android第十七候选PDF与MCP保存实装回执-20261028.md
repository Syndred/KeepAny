# Android 第十七候选 PDF 与 MCP 保存实装回执（2026-10-28）

## 完成与范围

唯一 AOSP emulator-5580，自有 CDP9438，主代理明确交接；没有操作9436、原秘密控制器7928/7731、其他候选或原 KDBX。先核 `native-mcp-sixteenth/handoff.json` SHA256 `6ef0ca9fbf11ff853ce6ea90b5b1e754a3fa1e1518de98528431ffc2857bf47d`/READY，实际已装 N16 为23694526 B、SHA256 `e56714ffe7e31caad4fc1800834e5967eda4412c1127606451d6d3bfef3c3c66`。

保留 N16 同一有效 PDF 失败后，仅 `install -r` 主代理冻结 N17。源 `3ae2eed910cba048ca141f1a032fe7d9bd7d1f0d`；23694603 B；实际设备 base.apk 安装后和收尾均独立实算 SHA256 `557b5c8f6db9e127fdab6418d5c9a9d4145435470e38b3350493999d54da7669`。没有自行 build、clear data、改产品源、安装第二模拟器或 push。构建方另提供108个dist文件与APK逐项相同、worker SHA `64d491d1a29c75d5565286f2e865047612dbeaa18256a394be604dc806edae0e`；本片设备身份以实际base.apk校验为准。

主机 Asia/Shanghai 10-28，设备 GMT/UTC 10-27；按实际时间记录，未改时钟。WebView Chrome133.0.6943.137，实际 CSS412×660/DPR2.625。全部文件经真实 Android DocumentsUI 选择/保存，触控由实际 ADB坐标与系统UI元信息核对；没有 `setInputFiles`、仓库 API 注入或 SQL 写入。只读 SQL 一致性检查仅针对自有普通候选及控制库当前指针，不读取原库SQL/KDBX/KA1或秘密。

## 合成文件与资料基线

原清单 `test-results/pdf-compatibility/native-synthetic/manifest.json` SHA256 `283103420d08f4916682d6b3344225090a54d3d371d76f92735cf87f15dbc6f0`，7文件全部核hash。核心对照 `inherited-resources.pdf` 683 B，SHA256 `a3d884367a63416634b2613377d4f20c816d14f44a45494cc11688a96837bf07`，真实继承父级资源；预期两行 `Synthetic invoice reference 123` / `Service total USD 12.00`。N16与N17使用完全相同字节，没有换样例掩盖失败。

中文PDF预期精确 `中文账单服务费用`，1219 B；另有 image-only、blank、broken、21页、20001字符。所有内容虚构。英文首次确认使用主代理另授权的独立继承资源 `n17-english-inherited.pdf`：697 B，SHA256 `e7c21144389367d6216209e193ca9bdf45f8f9f63a8d835d71ed28c4fa288991`，预期 `English Native PDF fixture 20261028` / `Synthetic service total USD 19.99`。它不替换原红绿对照。额外10MiB+1零字节文件沿现有软件oversize夹具，仅测大小前置，不声称该零缓冲是有效PDF。

正式切回自有 `keepany-data-a3544b4c-12a3-4b8a-86da-b3498a68236e`。接管128行 SHA `f2a57f601dfb43147a9a2bd3d419ba352bdb699f514fd6899782ca244797016e` 与N16一致。此前127行和MCP专用项目均不得改；本轮只允许两次明确PDF确认新增2条项目。普通金额文字没有自动成为账单，也没有发送AI。

## N16 前置启动暂态：保留未定因

原库 → 自有资料 → 正式确认切换后，`https://localhost/intake` 出现“本机资料暂时无法打开。请重试。”；普通重试一次仍失败。此时尚未打开PDF选择器，不能归因PDF。仅自身PID9700的固定启动码日志过滤无返回。自有128行完整指纹始终不变。

经主代理分别许可，两次诊断重试：最早console只观察 `KeepAny startup:` 后白名单固定码，得到 `startup-failed`，不记录其余参数/错误/正文；随后许可的最早bridge观察在addInitScript时 `nativePromise` 尚不存在，available=false/events=[]，因此没有实际替换bridge方法、没有捕获失败stage。后一次正式重试自然恢复路由，未清库、改Preferences、强停或换包。截图 `n16-switch-own-bootstrap-unavailable.png`、固定码/bridge-stage JSON留存。

**根因未定，不核销。** N17安装启动、收尾自有冷启和正式切回原库成功，只证明对应条件下成功；不把一轮自然恢复当作修复。主代理后续安全startup阶段诊断不在N17包内，本片没有声称已具备。

## PDF 点击 → 预期 → 实际

正式路径：更多/More → 收录与备份/Import & backup → 快速收录的PDF文档/PDF document → `#csv-file` → Android DocumentsUI。没有使用上方AI导入输入框。

| 操作 | 预期 | 实际/证据 |
| --- | --- | --- |
| N16 真正选择683 B继承资源PDF | 有效文字应成为待审核候选 | **原N红**：提示“此PDF未生成候选…”；没有新增PDF候选、普通128行指纹未变，原有两条文字审核保留。图 `n16-inherited-picker-post-selection.png` |
| N17 选完全相同字节 → 展开提取原文 | 完整提取、预览不写普通资料，先选类型 | 两行逐字一致；类型未选Confirm禁用，普通128行仍f2a57…016e。图 `n17-zh-inherited-preview-no-asset.png` |
| 中文明确选择项目、核名称 → 确认入库 | 才新增普通项目，保原文 | 已确认；名称 `N17 PDF 已核对项目`，description为完整两行；固定原ID见下。普通129行，原128完整row零差异 |
| 英文重新选择同字节 | 沿内容去重，不改原决定/ID | 原候选仍Confirmed、同ID，129行仍原指纹；没有新账单/项目 |
| 英文独立697 B样例 → 提取原文 → 先选Projects/填名 → Confirm | 英文也实际首次确认，不借中文结果代替 | 类型未选禁确认、预览不增普通资产；明确确认后名称 `N17 English explicitly reviewed PDF`、完整两行description，新增第130行 |
| 英文同文件再次选择 | 同ID/Confirmed，不再新增 | 实际仍同英文候选/ID，130行保持 |
| 中文PDF提取 → Ignore/忽略；中英重复选择 | 精确中文，忽略决定持久，不入库 | `中文账单服务费用` 逐字一致；同候选Ignored/已忽略，中英重复均保持，没有第三条普通资产 |
| blank、image-only，分别中英实际选取 | 无文字准确拒绝，不承诺OCR | 均提示至少一页无可读文字/扫描或空白需人工整理，候选数与普通资产保持 |
| broken，分别中英实际选取 | 损坏文件不产生候选 | 均准确未生成候选；没有把该夹具称为真实加密PDF测试 |
| 21页、20001字符、10MiB+1，分别中英实际选取 | 原10MB/20页/20000字预算不放宽 | 均显示原预算提示；普通130行与原审核决定保持。没有改更小限额或静默截断原文 |
| 正式冷启后回审核 → 再用改名的同683字节PDF | 决定和原ID保留，文件名不绕去重 | 两条已确认/一条已忽略保留；系统搜索明确选中 `keepany-n17-renamed-inherited.pdf`，仅被动记录选中名匹配=true/size683，仍原已确认ID/5条总审核行，普通130行指纹不变 |

两条新增普通ID分别为 `pdf-a3d884367a63416634b2613377d4f20c816d14f44a45494c` 与 `pdf-e7c21144389367d6216209e193ca9bdf45f8f9f63a8d835d`，kind=project、revision1。最终130行 SHA256 `3b40b02f1f68bbea7a7a54a00dc4ac494bd266fc8de0cdd6a67ae5e8b91acdc3`，asset98/category2/history2/preference3/relation16/submission1/task8。`n17-final-pdf-diff.json` 对原128逐ID/type/完整payload/updatedAt/revision/internalDeleted零差异；因此此前原127也保持，不靠数量代替完整字段证据。

N16公共能力 Map.getOrInsertComputed/fromBase64 为undefined，Promise.withResolvers为function；N17实际读取后主线程三者均function。Native原界面仅显示通用提取失败，**没有在本片捕获Map异常堆栈**；缺失Map的精确因果来自core独立软件复现，不把通用N红夸成原生异常直接观测。N17有效文件与错误边界是真实原生复验，未注入polyfill/替换worker或降低预算。

## 工具前置失败与修正

1. N16选择返回后一次ADB `device offline`，随即恢复、应用PID9700未变；自有9438 forward重建，原包/普通资料不变。连接中断与PDF失败分别记录，没有重启ADB server/模拟器。
2. 首次Confirm后立即只读时仍待确认/128行，没有报成功。确认控件可达后真实触控，并等待已确认状态与129行回读才核销。英文首次确认前焦点仍在名称输入，顶层命中检查阻止误点；通过正式点击展开原文标题移开焦点后再真实Confirm，等待130行，不盲目按无回执重复写。
3. 中文20001字符夹具已通过notice等待，随后截图停顿；物理屏幕是Launcher、app PID仍在。正式回App后显示预算提示、input可用，129行指纹与确认后相同。helper堆栈停在 `page.screenshot`，不是PDF读取等待；故**未证明PDF cleanup挂住**。原物理图与 `n17-zh-text20001-after-foreground-return.png` 保留，没有重选或改30s产品超时。
4. 英文duplicate工具最初等待词prepared，实际文案为ready；独立读UI已Confirmed和SQL同ID后修正期待，不重写失败记录。部分读取中即时DOM审核行数短暂0，后续明确等待/回读稳定5行，不用短暂值作丢数据结论。
5. 改名文件最初不在可见列表，未把helper的file-not-visible当产品错。系统Search实际是AutoCompleteTextView，首次按EditText查找失败；随后明确系统搜索、核对唯一结果title并真实触控。被动change监听只记录自有合成名匹配/size，不伪造文件。`renamed-actual-selection.json` 为最终实际选择证据。

## N17 MCP 保存回执局部复验

两语均在正式设置展开“助手授权/Assistant access”，只选N16专用项目 `9ecee0d0-9054-430b-94a6-13850c3e8c28`、name只读、地址127.0.0.1 → Prepare → 真正系统DocumentsUI保存 → 返回App。保存前Activate禁用，saved/readback后启用；**从未点击Activate**，随后明确Stop并等仅Prepare可用。OS无本轮监听，原authority仍4 grants/52 audit，未新增授权，也未重跑CLI/全部MCP。

英文实际提示“The pairing file was saved and read back for verification. Give it only to a trusted computer.”；中文“配对文件已保存，并已读回核对。请仅交给你信任的电脑。”。两张 `n17-en-mcp-saved-native-green.png` / `n17-zh-mcp-saved-native-green.png` 实际目检，N16通用“文件和密码”原红图保留。由此仅核销本专用saved文案的N17实装复验，不外推未重跑的分享opened/cancel/远端客户端。

英文初次改唯一文件名动作早于系统输入就绪，未确认改名；实际使用默认 `keepany-mcp-mobile-pairing.json` 保存1107 B。只读mtime=1793129414确认本批创建后精确清理，不声称保存了预设唯一名。中文等DocumentsUI已呈现后改名成功，实际唯一 `keepany-n17-mcp-saved-zh-20261028.json`，1111 B。未打印/复制票据内容或凭据至普通日志/PC文件；没有改变KA1/KDBX通用提示。

## 未完成、收尾与提交

原152合同不改ID/步骤/预期；本片只补F14的普通PDF真实N分支与F23专用Saved局部。物理Android/iOS、用户PDF、真实加密PDF、OCR、强制timeout/取消等未在这些合成操作中执行；不以软件故障注入或一个界面数量代替。N16启动暂态仍未定因。没有依本片结果把F14/F23整组标绿。

正式冷启自有候选和切回原库均成功；最终control指针keepany-v1，密码锁页可见/master空；自有130行原ID保留，journal/importJournal/categoryEditJournal均0、无保存/恢复/传输在途。N17实际base再次核hash/大小相同。所有自有CDP/控制器结束、9438移除，forward list为空；12个本轮自建系统PDF/中文票据/XML按精确路径清理，英文默认票据此前已按本批mtime确认清理，没有递归删除或碰此前被拒的TEMP/PG目录。

READY交接 `test-results/native-pdf-seventeenth/handoff.json` 1716 B，SHA256 `3ef99d80e8b74a956ece61eabaf05b165cd12b4dabc76245cbc139ee5dd3de37`。**只读看到reverse list当前为空**，未执行reverse增删，不能声称与交接前逐项相同；已告知主代理供下个网络owner检查。CA/hosts和服务均未修改。

原始非秘密证据位于ignored `test-results/native-pdf-seventeenth/`：actions.jsonl、各次一致性snapshot/差异JSON、启动固定码、实际UI/物理截图与handoff。只提交本回执，没有产品源/测试依赖修改、push或部署；设备已释放，后续ADB须主代理重新交接。
