# Android N24 I/O 拒绝与同稿重试实装回执（2026-10-28）

本片在唯一 emulator-5580 上执行三项英文真实 OS 权限拒绝和三项中文明确合成桥拒绝。旧数据/草稿保留及正常重试均已核对；图片错误文案和密码库持久错误位置保留为 N24 UX 红。真实权限拒绝不等于 ENOSPC，中文合成结果不等于磁盘满或系统 provider 实际失败，本片不能核销整个 M0-09。

## 身份、授权与同步

- N24 source 9cf21a7ae3646679a33c035934b3bb51052a6e5e，APK 23694603B，host 与实际 base.apk SHA-256 51b81f1b5cfd8a54d1a01264f2f1f4a10c223c58b8fb63f60ba39e828d8e6d57，安装后及最终再次核验一致。保数据 same-package install-r，没有 uninstall/clear-data/downgrade。
- Root 主授权 SHA ff31f901d375214c4cc054c643c32e6fa64d995a01babb919b6a30b1753804e4；CACHE SGID 单次补充授权 SHA 4e18b55a812fa431ef0755a8b56d8fe5ffa0d72adf63ae23fd4e1b8d38736246。canonical plan/旧 fixture executionAuthorized=false 原件不变；本次独立 runtime 已 completed、不可再 arm。
- 起点为 M0-06 ef699de8 handoff 与 6e8d0105 post-cut 基线；Target 已是此前合法换图后的 revision4，不能再按最初旧图状态比较。
- 本片唯一候选 keepany-data-3e252b67-823c-49d3-b1e7-98a5b77ab6f2；Target c7241691-3ec9-4b28-a747-e4e6dd82c011，Keeper d892e8c4-1b29-48e2-b5c2-b2cd91e4324c。原 keepany-v1 不读取业务或 KDBX；135/70/两历史20只作授权只读保持比对。
- 安装前后五库完整 rows/review/files/指针、control metadata 与 Preferences 字节保持，旧五份 Saved 的 host/Downloads bytes/SHA 一致。control 只接受已知版本 0/1，本片未改 user_version。
- 收尾检查 git status/remote 并 fetch origin。最后一次比较 HEAD...origin/main 为 ahead293/behind1，已报告主控处理共享分叉；没有擅自 merge、改其它代理文件或 push。此结论是 fetch 状态，不假称远端新 main 已合入。

## 六项实际步骤和结果

| 流程 | 语言和证据类别 | 失败与保留 | 同稿/同 URL 重试 | N24 UI 边界 |
| --- | --- | --- | --- | --- |
| 图片权限拒绝 | 英文，真实 own files 0700→0500 | 原 write 1 次真实 permission-denied；26 行/审核/旧指针/文件全部相同，190B 稿保留 | 一次 Confirm，Target revision4→5，其余25行不变 | 合法 PNG 写失败误说格式/20 MB 限制，真红 |
| 密码库权限拒绝 | 英文，真实 own vaults 0700→0500 | 原 write 1 次真实拒绝；旧密文/指针/普通行/审核相同，Title 稿和 session 保留 | 原 sole UUID，Title 修改，原历史保留并新增1项 | 持久错误在编辑 Dialog 外，后续不可见；首次即时 toast 未拍到，不能说从未提示 |
| CACHE 备份权限拒绝 | 英文，真实 OS + 明确桥时序/受控自有临时目录 | 唯一 job 原 write 1 次真实拒绝；provider 原调用0，无系统 UI/假 Saved，原 URL/11348B 不变 | 同一 URL/同加密字节，系统实际 Saved002并读回 | 错误替换先前 Saved，完整 error/Save 同框 |
| 图片 ENOSPC 合成拒绝 | 中文，C_ASSISTED_NATIVE_UI_BRIDGE_REJECTION_NO_OS_IO | 精确 own write 边界固定拒绝，原 Native write 0；稿/旧数据保持 | 正常同稿一次 Confirm，Target revision5→6 | 同一个错误文案红复现 |
| 密码库 ENOSPC 合成拒绝 | 中文，同上 | 原 Native write 0，旧 cipher/session/Title 稿保持 | 同 UUID，Title 再改，历史1→2；本次原生 retry write 实测1成功/0拒绝 | 即时正确 toast 原图可见，但持久状态仍在 Dialog 外，toast 遮住部分 Save 上缘 |
| provider 边界合成拒绝 | 中文，同上；仅被拒绝边界不执行 OS provider | CACHE staging 是真实正常 I/O；原 KeepAnyFiles.save 调用0，无系统 UI/假 Saved | 同 URL/同12293B，系统实际 Saved并读回 | 中文 error/Save 与 Saved/Save 原图均完整同框 |

每项均先正式切到本候选、核当前 pointer、空三 journal、无无关编辑，再操作。没有改业务 API/SQL 记录以造成功；正式系统 picker 按唯一可见 Search 文件名选择同一 190B m0-replacement.png，SHA 1e8fb50dca8db1dbb43c9fe9fb815c9e262c904282a4ffc9065504532c9b9167，预览实际 decode32×24。PhotoPicker→Browse/DocumentsUI 的短暂旧 AX 树按同一个 intent 被动等实际绘制后继续，未重开业务动作掩盖失败。

真实 image/vault chmod 只针对已核 canonical/UID10150/inode/dev/原mode700 的本候选 files 或 vaults 单目录，非递归；原 Filesystem 调用、this、args、结果/错误均透传，finally 身份复核后恢复700。固定分类只保留 permission-denied/other，不日志原 native error 对象、data 或 SQL values。三项中文注入只匹配本边界一次并恢复 delegate，固定 ENOSPC 不调用被替代原方法。

## CACHE 原有 SGID 与单次受控夹具边界

初始三轮工具前置均未取得符合合同的 OS 拒写证据，原件保留：

1. 普通 mkdir 的 job 实际继承2777，预设700守卫拒绝；release-only watchdog 后原写成功、打开 DocumentsUI，正常 Back 取消，未外部 Save。
2. 精确 mode 校验/恢复遇到 SGID 与 run-as 组差异，未完成有效拒写合同；原写被 watchdog 放行、正常取消。该次不能称已恢复原2777；job 后由原 export finally 清除，无遗留被改目录。
3. mkdir -m700 仍未满足严格700前置，在调用原 write 前以工具固定 abort 收尾，无系统 UI；没有再把这一项算 OS 失败。该前置未保完整有效身份链，不能用作产品结论。

上述两次正常取消及一次工具 abort 都保持同一个生成 URL 和加密字节。此前成功 Saved001 只是有效外部文件，不冒充权限拒绝后重试。Root 另发单次 addendum 后才执行下面的有效切片，未无限尝试。

有效切片 job 为 cache/exports/0d90612b-11df-4b96-9273-734e323736e4：创建前确认为 missing；初始 UID10150/GID20150/inode557235/dev65077/mode2777 与 canonical 均记录。仅该新目录在身份守卫内 chmod g-s、再0700，实核 same UID/GID/inode/dev 且700，**这是受控夹具初始化，不是恢复产品原2777**。随后0500、原写真实拒绝，watchdog 未触发。原 export finally 自动移除此新 job；因此收尾证明 absence，不假称2777被恢复。父 cache/exports 的身份/模式前后精确相同，未改任何父目录/旧 job，无 root/chgrp/setgroups。

旁路只暂停原 write 调用前的交付时机，原 args 未改；条件满足才调用原方法一次。该项类别为 N_WITH_EXPLICIT_BRIDGE_TIMING_AND_CONTROLLED_OWN_TEMP_DIR_REAL_OS_PERMISSION_REFUSAL_NOT_ENOSPC。

## 密码库仅改 Title 的白名单核对

只正式解锁本合成库的唯一条目，主密码与备份密码按已有 F20 源码引用由程序取入内存，不读取旧7928/7731等控制器。两个公开测试 Title 分别为 M0 permission retry 20261028 和 M0 no-space retry 20261028；不改 master/password/KDF/链接，不新增条目。

同一 UUID UatkMfd2Njw9J99+HRdTWQ==；每次旧 history 逐项保持，新增 history 恰为该次之前完整 entry，计数 0→1→2。Title 外所有字段/custom keys/links/binaries/tags 相同；creation/expiry/usage/location 等时间保持，只有合法 modification/access 时间可更新。普通26行与完整审核在密码操作前后全相同，图像 bytes/元数据保持。

KDBX 版本、KDF $UUID/P/I/M/V 均保持；S 是正常每次保存的随机 salt。初版工具把 S 也当固定成本参数比较，出现一个工具 false；已单独保留参数逐键 equality 与后续无新增 Save 的读取核对，没有放宽算法、内存或迭代预算。英文成功为一次正式 Save/一条新历史/一次最终 CAS revision更换；当时未额外计数原生成功 write，不能仅凭端态称已观测全部中间调用。中文成功另有被动统计 calls1/resolved1/rejected0。

## UI 红与截图纠正

图片失败即时 Native 原图中英完整显示了错误的格式/大小提示，预览及可重试 Confirm 仍在；它们是文案问题，不是文件超限。主控已另行分配窄修，本 N24 仍保红。

密码库正确失败文案的持久 .password-vault-message 位于编辑 Dialog 外。英文最初工具因全局重复 notice 查找未完成即时拍摄；后补图是在 toast 已退场时，状态文本 y<0。这不能证明最初“完全无提示”。中文即时原图确实显示完整正确 toast，但它覆盖部分 Save 上缘；持久错误仍在背景。按这一准确范围保留红，不把 DOM isVisible 或晚截图替代即时视觉证据。Root 后续 Dialog 内可见性修复不属于本冻结 APK。

自然 Native PNG 全部未裁切、未蒙 DOM/CSS、未拼图或 AI 编辑。备份两语 error/Saved 和44px Save 同框已实际 view；图片两语错误/预览、密码库中文即时错误与成功也已实际 view。密码字段是 password 掩码，未展示明文。英文密码即时提示截图和每个控件所有时刻无覆盖不能补称已验。

## 真实 Saved 文件与完整读回

| 独立 Downloads 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| keepany-n24-m0-backup-permission-20261028-001.ka1 | 11348 | aacfad63e36ba6ff08029b5a671775ee090b66b9bedd578e22cac93556001eb0 |
| keepany-n24-m0-backup-permission-20261028-002.ka1 | 11348 | aacfad63e36ba6ff08029b5a671775ee090b66b9bedd578e22cac93556001eb0 |
| keepany-n24-m0-backup-synthetic-20261028-001.ka1 | 12293 | d5e3dbea93bfd655a688d29e90f865fdb57963451fbbdc38747c4ca2e047b238 |

英文001和002与最初 ready URL 的11348B逐字节相同；002是有效 OS 拒写后的真实系统重试，未覆盖001。中文12293B是后续合法图片/Title 更新后的独立一次生成，provider 合成拒绝与成功重试用同 URL/字节，未重生文件冒充重试。

每份都有 Native Saved/read-back 文案、实际系统 DocumentsUI 保存、外部文件头 KEEPANY1、host与Downloads实际bytes/SHA一致。只解密这些合成 KA1 验证26行全部 ID/type/payload/updatedAt、审核、所有图像原bytes、KDBX原cipher/revision/update metadata；该备份检查不解密其中 KDBX。Native CAS revision/internal_deleted 属于本地元数据，由独立全 Native 快照核，不假装它们是 KA1 RecordRow 字段。附件按 id 映射逐字段比较；最初工具把引用序和 SQL id序当同序数组产生 false，旧 JSON 保留，排序映射核对不删除任何字段。

## 递进基线与正常 GC

图片两次合法重试只改 Target，revision4→6；Keeper 和其余25行完整保持，原 loan/return 行不变。每次失败按当时最近合法基线严格比较，未把前次成功更新当成丢失，也未忽略未知差异。

正常延后 GC 移除以下已明确无当前指针/引用的前次重试旧文件；都是原路径/hash单列，未手工删除，也不将删除任意未知文件作为 waiver：

| 前后观察 | 被移除的旧物理文件 | 字节 | SHA-256 |
| --- | --- | ---: | --- |
| image-permission-success → vault-permission-before | files/4319a478-e949-4881-bd4d-fde6ae2a0ec5.bin | 190 | 1e8fb50dca8db1dbb43c9fe9fb815c9e262c904282a4ffc9065504532c9b9167 |
| vault-permission-success → backup-permission-before | vaults/91d1c610-995f-46b4-98a1-cf4a270ae6ce.kdbx | 4101 | 4329ced89a5ce02b03df901a9270bdf6199b5b0e28c171cc31970d23db51d55f |
| image-synthetic-success → vault-synthetic-before | files/3cc096c3-b5ba-425f-85d1-7bc610fb6889.bin | 190 | 1e8fb50dca8db1dbb43c9fe9fb815c9e262c904282a4ffc9065504532c9b9167 |
| vault-synthetic-success → backup-synthetic-before | vaults/f8390957-405a-4c7d-8673-778fbb423401.kdbx | 5205 | d3c7846a165c874bd45e9690c7f6e9b2e24a7cdc85a6627a4e4408e9303b874d |

最终 test-results/native-m0-io-n24/final-baseline.json，44250B，SHA db2bfc4bfcb5f24f532470b6e4e728ccc654263b0752d33ba66aedd1f7ad494f，26行 raw SHA ad19de6f3bd069c51d587653859e617d2f737a0da549a7e530b5d6f9b26b44f1。最终两张当前图片和唯一 KDBX 均实际存在且mode600；root/files/vaults/recovery mode700。当前 KDBX 6149B/SHA cf02ac0ddcc893f2e3e47c2bfdf4fb560eca8ee17dedffbaeed838d8251314e6、revision 0d6af37c-7537-41f1-9df8-091c58b3d40b，UUID和两项历史已核；这些是本合成库的新合法基线，不能再要求它等于原4101B密文。

## 安全收尾、同步及限制

原135/70/两历史20完整行、六列审核、图/KDBX原bytes/metadata及各三张 journal保持。原五份 Saved host与Downloads均不变，三份新 Saved 留存；原control全部metadata、Preferences字节、AI control字节相同。没有创建新资料集，候选名册无新增delta。

正式锁本合成库、主密码清空，清备份输入并确认 Save link移除；恢复英文后正式切原 Initial keepany-v1，只到 English Locked/master空。回原后再次核本26全row/review/指针/文件仍等最终基线。只删除本次重新推送的 m0-replacement.png 与精确临时 XML；old deferred、旧001/002/所有Saved/其它公共文件及服务/CA/hosts不动。

所有旁路/newDoc/owned watchdog无残留，CDP断开、forward/reverse空。控制器89233正常 CtrlC退出，随后独立 Win32_Process 只匹配本 controller 路径为0；先前草稿 toolReady=false，直到外部退出核验才 READY。最终 handoff 12082B，SHA 0e994df336a0da9ad3ef8fe42c215c70dd36886dd5e9b8961ecb0063657ed03e。其后未再 ADB。

本机本批 480 文件的三项已知合成密码字节扫描为0；不外推全部内存或图片 OCR。一次工具定位曾回显已有合成常量源码行，已纠正为程序内提取，未将值复制进本回执/本机证据；因此不声称整个对话从无合成常量回显。

本批0 SIGKILL/force-stop、无填盘/mount/root/新AVD/SDK，无AI/MCP请求，不读取/解锁原库。没有实际 ENOSPC、真实 provider拒绝、物理设备或 iOS 结果；三中文合成只证明指定拒绝边界下的正式 UI处理。没有把新包未验的 UX修复记通过，也未合 main/部署/发布。

## 本机证据索引

证据位于 ignored test-results/native-m0-io-n24/；本次仅提交此报告，未提交 SQL、密文、截图或大文件。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| root-authorization.json | 5973 | ff31f901d375214c4cc054c643c32e6fa64d995a01babb919b6a30b1753804e4 |
| root-cache-sgid-addendum.json | 2330 | 4e18b55a812fa431ef0755a8b56d8fe5ffa0d72adf63ae23fd4e1b8d38736246 |
| install-receipt.json | 345 | b8a1f637ecafd05da56787906694d2abfcd265bd83a4387a972eeaad217c6583 |
| image-permission-result.json | 2593 | 4ab55282b44100250cd04142e25a6aabf4685d9fcded29369c96e33d8f3cb05b |
| image-permission-progressive-baseline.json | 39113 | 8e51224a4dae38f3aa31a89d9dbf1ca48f275ac31d7d134f8c9daec0c7f8e469 |
| vault-permission-failure.json | 2474 | 102bce3e8013f1143901a233d55ecfd3937e3672734321e8eca8b4bb776caf43 |
| vault-permission-progressive-baseline.json | 39344 | 9f6ddf2aaea0aec4ba53b9465741a5f1e0d4e62b28628cd8517928c636508504 |
| vault-permission-untouched-time-check.json | 167 | 9aab6c77c5060298d1bc3b69ea40d28b75c4b17f9e3c45926f57a5e1e1fe9710 |
| sgid-addendum-attempt.json | 129 | f65c289c491fcce34aa2c414ef54fd0a43e4c3dde22d017b95fcb1b6b9422047 |
| backup-sgid-failure.json | 3358 | 1f72aeec615aeb99a9baded60b820384fde71fe13658ac95ff72cd7d821c3529 |
| backup-sgid-success.json | 1467 | 5b13345218477ff581cccc26cc318be812422f11bb0b99fb9a9398be562fe2d0 |
| backup-permission-002-saved-readback.json | 701 | 10273860c3008d70b1f89956dd075a6a99a206d4995056cc9ecb0623fe0e1578 |
| image-synthetic-result.json | 2210 | d2f10106d2ac5df39361f2b0ebd3909825ee33945b99dd3262c204d3f031eb27 |
| image-synthetic-progressive-baseline.json | 39107 | e59bf6926b825480ce4e0034dbd825978d76d02baeb17a259dccc36ffb1b74fc |
| vault-synthetic-failure.json | 2173 | 765054e61700b40073448018d9ddc6b4c10ce1659fe4acce21ba5b2ba48c15ba |
| vault-synthetic-progressive-baseline.json | 38735 | 8350d1e1c382f8b8af255c7187b760c16264ae9d21414ef298b1392314601c4b |
| vault-synthetic-retry-native-count.json | 70 | 69673c4ba6c642b0c0cd497512b62e04f8dcc35a493165c6ad1ff3a8ce51ceab |
| backup-synthetic-failure.json | 1727 | afeda90ef52d229e80c981ac5bc8ece57c68462f42564e7f0d8e88475ad27e42 |
| backup-synthetic-success.json | 1542 | 4965648d10f2040580a57d9738184f2655c37f2340bf4c1a31296b65475bdf47 |
| backup-synthetic-saved-readback.json | 700 | 61b15eaa6a0489f5d7e9f706ad3c1ae7297176d87100395845e20d1042d8b8d7 |
| known-post-retry-maintenance.json | 2526 | 220412cf845964081487e282f2f71af2479565ce0bce5f23b4230dc973290534 |
| final-baseline.json | 44250 | db2bfc4bfcb5f24f532470b6e4e728ccc654263b0752d33ba66aedd1f7ad494f |
| final-preservation.json | 5431 | b70581921014776688e7dfbac6acc6ecbc11d97314ec2f2b6f3b1fc740b6894f |
| credential-scan.json | 257 | a379ee3e609f744406d628edf5834b7bc1cef1d75e383b1178bd7c0cbc0c6858 |
| execution-manifest.json | 2231 | 6bf1a6b84be04ce58ddfc41942008455655edbe96f624cbcc43c8cfee8772e64 |
| handoff.json | 12082 | 0e994df336a0da9ad3ef8fe42c215c70dd36886dd5e9b8961ecb0063657ed03e |
