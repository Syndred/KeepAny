# Android N25 图片与密码保存失败反馈定向复验（2026-10-28）

N25 在同一 emulator-5580 上完成约定四项：英文图片/密码库真实权限拒绝，中文图片/密码库明确合成拒绝；四项均保旧数据和同稿，正确错误在当前 Dialog 内持续可见，正常单次实际触控重试成功。N24 原红和取样纠正保留，本片只关闭对应保存失败反馈缺口，不核销真实 ENOSPC、全部 M0 或 iOS/物理设备。

## 身份、范围及同步

- N25 source：362ac6a27418194e08d6afde541d31fbfee350c6；host 与安装后/结束前实际 base.apk SHA-256 均为 cdf84d83b6a59021bd6bd79e155f858eca64b493ec8dc4cf20750e623d85c4e4，23694603B。保资料 install-r，无 clear-data/uninstall/downgrade。108资源/DEX同源等构建属性归 Root 冻结回执，本片实际独立核的是完整 APK 身份和正式运行行为。
- Root 授权 SHA 34cd415b58d7977a24fdf82edc8cb82739bc3c5412cc8aecee6ab686fd33ec39；离线计划 SHA 41e90de29d522ceee20739825edc226b6e68d44f22ff403d4dc56f855166598d。准备文件保持 executionAuthorized=false 原件，Root 新授权覆盖本批执行，结束 runtime 已 consumed/不可再 arm。
- 起点是 N24 26行基线44250B/db2bfc4b…ad494f，Target6、Keeper3、唯一密码条目历史2；没有用更早旧图/旧密文状态比较。只用 namespace keepany-data-3e252b67-823c-49d3-b1e7-98a5b77ab6f2，未创建新候选。
- 安装前后五库既定records逻辑投影、审核、文件/指针/mode、Preferences/control及旧八份 Saved 的 host与实际Downloads bytes/SHA均精确保持。结束再次核完整保护，最终回原英文 Locked/master空。
- 本片检查 git status/remote、fetch origin，最后观察 HEAD...origin/main behind=0；未 push、触发或取消CI。没有改产品源码、公共测试、08交接、总表或其他代理文件。

## 四项实际结果

| 对象 | 语言／失败类别 | 失败边界原Native write次数 | 持久可见反馈 | 恢复后正常重试 |
| --- | --- | ---: | --- | --- |
| 图片 | 英文／真实OS权限拒绝 | 1 | 6500ms后当前Dialog完整alert＋44px重试 | Target 6→7，同稿单次实际ADB tap成功 |
| 密码库 | 英文／真实OS权限拒绝 | 1 | 6500ms后当前Dialog完整alert＋44px重试 | 同UUID/history2→3，同稿单次实际ADB tap成功 |
| 图片 | 中文／明确桥合成 | 0 | 6500ms后当前Dialog完整alert＋44px重试 | Target 7→8，同稿单次实际ADB tap成功 |
| 密码库 | 中文／明确桥合成 | 0 | 6500ms后当前Dialog完整alert＋44px重试 | 同UUID/history3→4，同稿单次实际ADB tap成功 |

英文各仅 exact own files 或 vaults 目录，canonical/UID10150/GID/inode/dev/原mode700核过后非递归0500。旁路只做计数并透传原this/args/error，原Native写入确实返回permission-denied；没有以合成拒绝替代OS。finally身份复核恢复700，20s restore-only watchdog均未触发，不发送任何进程信号。

中文各只匹配本候选一次图片或KDBX写边界，固定ENOSPC拒绝且不调用原Native write，类别明确 C_ASSISTED_NATIVE_UI_BRIDGE_REJECTION_NO_OS_IO。它们证明合成拒绝下的实际Native UI处理，不是实际磁盘满。两语均先恢复delegate/权限，再单次同稿正常Save/Confirm，不重新选文件或重填新稿掩盖原失败。

每次失败后，26行既定records逻辑投影、审核六列、旧blob/vault指针、当前引用文件bytes/hash/mode均同该次递进基线；图片仍同一个190B预览 File，密码库保留原Title稿/旧cipher/session，无假Saved，重试可用。图片旧格式/20MB错误文本已不存在，现为“图片未能保存，请重试。”及其英文；密码库原保存失败文本现在位于当前编辑Dialog内。

## 真实可视与触控证据

每项都取即时原图，并等6500ms（超过普通瞬时toast窗口）再取持续错误原图。用当前 Dialog 内 scoped role=alert 定位，避免N24全局重复notice工具问题；同时核全文bbox、retry≥44px与elementFromPoint中心命中。失败触发和正常重试均按实际WebView surface/viewport比例换算，单次 adb input tap，保存物理坐标与几何，不做第二tap或触背景。

四张6500ms后的Native截图均由执行者实际view，Root另行独立view：正确完整错误与重试按钮同框无遮挡，密码字段是掩码。密码表单其余字段位于scrollbody，不声称整个长表单同屏；没有裁切、蒙DOM/CSS、拼图或AI编辑。

| 原图（目录test-results/native-m0-feedback-n25/） | 字节 | SHA-256 |
| --- | ---: | --- |
| image-permission-persistent-error.png | 148190 | cd96c83450f63ce23e2ea6bba6267bdd464ff7af6fd0efa8353741a91b877f57 |
| vault-permission-persistent-error.png | 158027 | 049f5ec5a80b5097ff9aa9e535727d319b47db78da46238b844295812f237072 |
| image-synthetic-persistent-error.png | 145895 | 548d554ccff8920babbd1ec0b02ac8846ab93f52d3f11727cf99a589334295ef |
| vault-synthetic-persistent-error.png | 161114 | 077f86f466593bd1442deaba58af72f6d46d27d3ca76e4ff8a97ab08ba2446d3 |

Root 的独立visual JSON只支持可视判断，不代替本机原Native拒写、数据保留、重试或密文证据。通知中英文vault PNG曾手打多一个末尾字符，原图未变；本报告全部hash由文件程序计算，原通知打字误差不改原件。

## 最小合法变更与完整比较

Target 真实CAS revision 6→7→8；仅 attachments、itemMedia.coverId、相关合法更新时间/CAS变化。每次新图是独立immutable逻辑/物理文件，但实际仍同190B、32×24、SHA 1e8fb50dca8db1dbb43c9fe9fb815c9e262c904282a4ffc9065504532c9b9167。Keeper3和其余25行完整保持，原借还历史行不变，完整审核相同。

密码库只正式解锁本合成库，程序读取已引用合成master，未读取旧私密controller或原keepany-v1业务/KDBX。sole UUID UatkMfd2Njw9J99+HRdTWQ==保持。公开Title分别为 N25 permission retry 20261028、N25 synthetic retry 20261028，历史 2→3→4；旧history全内容保留，新history恰为该次保存前的完整entry。其它字段/custom keys/links/binaries/tags及creation/expiry/usage/location等时间保持；只允许合法修改/访问时间。

两次成功都另有被动Native统计：write calls1/resolved1/rejected0。未改master/password、KDBX版本或KDF算法/成本（$UUID/P/I/M/V精确保持），随机S盐正常轮换；不把正常随机盐差异误报为参数下降。不把Title变化后合法新cipher/revision当旧数据丢失。普通26行、审核、图像在密码操作前后保持。

每次正常重试后有界等待17000ms维护，再核已提交rows/review/pointers精确相同与所有当前引用文件。只以下已证明无当前引用的旧重试文件被正常GC，记录原logical/path/hash，不手工删，不泛忽略未知删除：

| 成功阶段 | 旧逻辑ID | 旧物理文件 | 字节 | SHA-256 |
| --- | --- | --- | ---: | --- |
| image-permission | e04d3777-a31d-42bd-b3db-2db442f146b6 | files/24a2fa59-ff17-4b19-94e9-11b1d598feb4.bin | 190 | 1e8fb50dca8db1dbb43c9fe9fb815c9e262c904282a4ffc9065504532c9b9167 |
| vault-permission | local | vaults/b5db75d5-1a35-4484-b587-1636dfd5a585.kdbx | 6149 | cf02ac0ddcc893f2e3e47c2bfdf4fb560eca8ee17dedffbaeed838d8251314e6 |
| image-synthetic | 59ea2a66-ce91-4498-b6da-47d7d54ea60b | files/50077b7b-f939-4cde-9064-9cc46d01dc54.bin | 190 | 1e8fb50dca8db1dbb43c9fe9fb815c9e262c904282a4ffc9065504532c9b9167 |
| vault-synthetic | local | vaults/8db5ca62-c0ec-4d1c-afdf-96c3ad4e26bf.kdbx | 7093 | 04e6b1831138b706c0db47b7e06d8abca82263a09a49237f9ad187018c3815d5 |

最终新合法基线 test-results/native-m0-feedback-n25/final-baseline.json，43929B，SHA 2d706d10241025477bab863454c4d2ef5edb2ca4bed64817726dcae680a41861；26行raw SHA 5f4975332d93ba88c562a2f5aa5a7c8760033308377222d4234d649de645f071。Keeper和其他25行/审核全同N24；Target8、sole vault历史4。最终两张当前图片＋唯一密码库共3文件均hash/mode核实，root/files/vaults/recovery全700；该基线供后续独立授权使用。

## 业务records保护覆盖边界（后续只读审计澄清）

既有snapshot先SELECT records全表，再filter(!internal_deleted)。因此本片26／135／70／两历史20的行数、records摘要及对等比较，是排除CAS内部墓碑后的逻辑投影；业务payload.deleted记录仍保留。上文“行／records”均按此口径，不能据它单独断言没有内部墓碑或隐藏物理行变化。

原始DB/-wal/-shm物理副本复制未过滤，已保留可供后续离线全表witness。Repo另行补含内部墓碑的物理witness结果尚待独立引用；本次澄清不改旧投影hash、原始证据或已完成Native失败/重试结果，不重跑故障、不访问原私有库。后续完整物理覆盖须以单独witness证明，不能只守本投影hash。

## 八份Saved与收尾

本片没有生成新备份、没有CACHE/provider故障、没有系统Save或改旧归档。以下八份原文件的host与实际Downloads均保持原bytes/hash；其它公共文件/old deferred未动。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| keepany-n22-keepany-roundtrip-20261028-001.ka1 | 9030 | 6c4adb01dfdc165851cb52ab8853da71c08495339e238bbda0d55dfac946d9f3 |
| keepany-n22-stackperch-roundtrip-20261028-001.ka1 | 9007 | 6bd8d12dbe993a99ba1966a78a536bead693427291b77c2a5d9d8a4bb2f5a8c5 |
| keepany-n22-stackperch-saved-visual-20261028-002.ka1 | 9006 | 0e378d949b3a527a79c0adb978758eadab332ba12152d98cf033f0738b8f4c83 |
| keepany-n23-feedback-en-20261028-001.ka1 | 9764 | 14852a5091e87ea72f8ffd5aa9c4e56345c35f8ed220b3f9a327b7745bf0dd22 |
| keepany-n23-feedback-zh-20261028-001.ka1 | 9765 | 364c3ee5b0583bdde3a991e5328f7a3f9c365a549cb98b7111ce4db7faaaa86a |
| keepany-n24-m0-backup-permission-20261028-001.ka1 | 11348 | aacfad63e36ba6ff08029b5a671775ee090b66b9bedd578e22cac93556001eb0 |
| keepany-n24-m0-backup-permission-20261028-002.ka1 | 11348 | aacfad63e36ba6ff08029b5a671775ee090b66b9bedd578e22cac93556001eb0 |
| keepany-n24-m0-backup-synthetic-20261028-001.ka1 | 12293 | d5e3dbea93bfd655a688d29e90f865fdb57963451fbbdc38747c4ca2e047b238 |

四个保护库（135、70、两历史20）的既定records逻辑投影、审核全部六列、图/KDBX密文及指针metadata/mode精确保持，各三journal0；control metadata/版本、Preferences和AI control字节保持，无名册delta。自身库锁定且master清空、语言恢复en后，通过正式UI切回Initial keepany-v1，仅显示原English Locked/master空；回原后本26既定records逻辑投影/review/files再核等新基线。

只删除重新推送的本次190B输入和精确临时XML。工具hooks/timers/newDoc无残留，CDP断开，forward/reverse空；App主PID 26821在断CDP前后相同且存活，没有强停它。控制器54649退出后独立Win32_Process只匹配本controller路径为0，才把toolReady由false置true。最终 handoff 13544B，SHA 845a5c89b38f8deeca8b529623a3efbeef2f55a063bb273c552d74340e650253；其后未再ADB。

本批404个本机证据文件、2项已知合成密码字节扫描0；不外推全部内存或图片OCR。密码只用于授权本库解锁和内存检查，不日志字段值、native.data、SQL values或原error对象；原密码字段仍掩码，原库不解锁。

## 工具前置与未验边界

- 安装前一次工具把node:sqlite返回的null-prototype审核行和JSON普通对象直接deepEqual，产生false；实际26行/审核全部六列JSON及所有storage精确相同，未安装或写业务时已定位，改完整值规范比较，不删字段/断言。
- 安装后首次启动连接前置未完成，未保留底层首因，不据此断言产品失败或精确时序原因；被动原图实际Overview正常，没有再次启动App，而是连接同一已启动进程继续。
- 原PhotoPicker/Docs短暂旧AX树只在同一个intent内等实际绘制并完成唯一Search选择，未重做已触发的业务Save，未mock解析/直接写库。

本片无SIGKILL/force-stop/填盘/mount/root/新AVD/额外浏览器，无AI/MCP，没有启动后续control0/1/77或低空间任务。在RAM受限提示后仍仅复用原AVD/WebView，KDF检查顺序执行，没有renderer/系统UI不稳观察。不能据四项软件模拟器路径外推物理设备、iOS、最低WebView版本、所有保存错误分支或整个M0；N24历史红和正确取样边界继续保留，只将新包相应反馈路径记为红→绿。

## 本机原件索引

原件留在ignored test-results/native-m0-feedback-n25/；本次只提交这份回执，不提交SQL、密文、PNG或大文件。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| root-authorization.json | 2474 | 34cd415b58d7977a24fdf82edc8cb82739bc3c5412cc8aecee6ab686fd33ec39 |
| preflight-plan.json | 20222 | 41e90de29d522ceee20739825edc226b6e68d44f22ff403d4dc56f855166598d |
| install-receipt.json | 469 | 8212b278bea4c835eac677a7d1b01c2896977a3b55a146bb9bfabdd7a0f1a82e |
| image-permission-failure.json | 5246 | 2bfcddbc21f3d52d62db08c2a91966f962f9f249c8e354eaf3edb948052dc830 |
| image-permission-progressive-baseline.json | 39627 | 532de702906f080734138709e44537f01e30d0ad068d1233855cd5ce4330c3cc |
| image-permission-settled-maintenance.json | 735 | 1e437249dec8426890e701fd99718581ab9b59abd7243737e9c737e76c5f9db5 |
| vault-permission-failure.json | 5327 | f67c761f8b3d778972f75649300544b2e3f10551bd9e5c672e7e991082c9418d |
| vault-permission-progressive-baseline.json | 39367 | 9196fd17ceaf980544ee68f2f2f2bb89b96791d6ab705834bd1a58ea4fe91614 |
| vault-permission-settled-maintenance.json | 826 | aa8d4207526075ebe0e83bcb3c9eb845d5c79778e2e0c80fc8d042008986a8f9 |
| image-synthetic-failure.json | 4825 | f3857e7168a8ca0917d37bb091eddcf340026fc3bb2123dbc5e2cd65f40af65d |
| image-synthetic-progressive-baseline.json | 39622 | decff525f2f027cb56aed8770b8559b5b742546056a3231c751bbcb957e4ea75 |
| image-synthetic-settled-maintenance.json | 733 | f4ea097afa269d222ddfc0c72b5c10623ca08fe850cd25de4525df93a97f8c8f |
| vault-synthetic-failure.json | 4849 | 108104c81912d7a6d2616e8f1448467b7696571b4962da846fdc50811bbe8dee |
| vault-synthetic-progressive-baseline.json | 39349 | 94a2f47650d1aa57503ac3448a6ec5d0cdc1983ad9bd4844c0760d15261a6ff1 |
| vault-synthetic-settled-maintenance.json | 824 | d843f4f390e0f576da400e8e76d1f8aee8959be8485edc3eb779a6e976b4d769 |
| vault-permission-retry-native-count.json | 70 | 69673c4ba6c642b0c0cd497512b62e04f8dcc35a493165c6ad1ff3a8ce51ceab |
| vault-synthetic-retry-native-count.json | 70 | 69673c4ba6c642b0c0cd497512b62e04f8dcc35a493165c6ad1ff3a8ce51ceab |
| root-image-english-visual.json | 672 | b0c1da555e14e0c49c81067cf29748d92514db44c43a8b4de9345328f388dffb |
| root-vault-english-visual.json | 697 | c6012eeebd82640fd701ddd590944e234e8ae02911aae4bac1591da35c942ae7 |
| root-chinese-visual.json | 1184 | ff6a1ed06e5f62b5cd94e9cfc64849bbf64dcefe5ba7cdc0ce7787c826fd3683 |
| final-baseline.json | 43929 | 2d706d10241025477bab863454c4d2ef5edb2ca4bed64817726dcae680a41861 |
| final-preservation.json | 6312 | 4b18b8b84dcb66375d2186affc425ccfd9ba4551d1045056b8d58b56ca47c594 |
| final-original-lock.json | 371 | d855929acac168f6f8760bf1279c92d0874a229085e7573c47f1116aadfedc44 |
| credential-scan.json | 215 | 2e6af07cbcc2d8542f5e34f9ecaa573ee2c2c0d74c8cd0fba1af2729f29e6bf0 |
| execution-manifest.json | 4572 | 8af30fbf8928fd3864942f90cc6c65c7d2d08fa2686306512d69bf50ca66f014 |
| handoff.json | 13544 | 845a5c89b38f8deeca8b529623a3efbeef2f55a063bb273c552d74340e650253 |
