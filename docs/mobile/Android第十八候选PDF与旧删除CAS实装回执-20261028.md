# Android 第十八候选 PDF 与旧删除 CAS 实装回执（2026-10-28）

## 范围与候选身份

本片仅在唯一 emulator-5580 上执行，独占 CDP9438。交接前核 N17 READY handoff SHA256 `3ef99d80e8b74a956ece61eabaf05b165cd12b4dabc76245cbc139ee5dd3de37`，实际已装 N17 base.apk SHA `557b5c8f6db9e127fdab6418d5c9a9d4145435470e38b3350493999d54da7669`。只 `install -r` 主代理冻结 N18，没有 clear data、自行构建、修改生产代码或 push。

N18 源 `60303f5d53d0f8d72b90dac2b8f1979bb4804da6`，APK 23694603 B，实际安装后 base.apk SHA256 `96463769eb02452d1d6e3b7d570c07632fd9cb131ab58b39ebdc96425fb14c96`。构建方另核108个dist文件与APK相同、PDF worker SHA `64d491d1a29c75d5565286f2e865047612dbeaa18256a394be604dc806edae0e`；本片不把当前源码变化继承到冻结包。

主机 Asia/Shanghai 2026-10-28，设备 UTC 2026-10-27；保留真实动作时间。正式界面切回自有普通候选 `a3544b4c-12a3-4b8a-86da-b3498a68236e`，接管130行 SHA `3b40b02f1f68bbea7a7a54a00dc4ac494bd266fc8de0cdd6a67ae5e8b91acdc3`。原 keepany-v1、主控秘密控制器7928/7731、其他候选、原KDBX/KA1/主密码未读写；没有动CA、hosts、reverse9445–7或服务控制。所有 SQL 检查只读自有普通候选的一致性快照，不注入业务状态。

## PDF：真实系统选择、正常返回与明确保留的观察

683 B 继承资源原样文件 SHA `a3d884367a63416634b2613377d4f20c816d14f44a45494cc11688a96837bf07`；697 B 英文继承资源 SHA `e7c21144389367d6216209e193ca9bdf45f8f9f63a8d835d71ed28c4fa288991`。经实际 Android DocumentsUI 精确文件名选择，不使用 setInputFiles。新一轮解析以本次 change、匹配文件名/大小、旧notice清空、busy和新notice、input重新启用为准，没有拿原已确认行代替新解析结果。

中文683正常解析1764.7 ms。另生成仅供待审后忽略的723 B继承资源，中文 SHA `bfc7505079ebf064073aa1c862204ab4f59f015bde0ff71ff0039acc3b6eab0d`、英文 SHA `b6961ed0bac2324698bf42ae822c65bb7c218f8ba8ffaf3aeafc564830e71266`。两行虚构原文为 `N18 zh/en private worker ownership 20261028` 与 `Synthetic inherited resources, review then ignore only`。中文实际预览1529.6 ms，原文完整、未选类型确认禁用、点击忽略后状态保留；不新增普通资产或账单。

中文同一页面 blank拒绝852.1 ms→683正常1513 ms；broken拒绝1309.8 ms→683正常1665.4 ms；20001字符限额拒绝1203 ms。每次错误均有明确notice，文件输入可重新使用。

### 首轮 timeout 的身份纠正与被动诊断

首轮20001之后，工具期待697文件成功但40秒未满足；实际App显示“PDF读取超时”，input可用、普通130行不变。截图 `n18-valid-after-budget-timeout-visible.png` 与 `pdf-native-timeout-red.json` 保留。**当轮未保留被动change的实际文件名/SHA，因此不能确证这是697正常文件失败，更不能据此宣布清理逻辑根因。** 原动作不重写，另追加 `N18-timeout-file-identity-correction` 纠正；此身份未确证观察不因后来成功被抹去。

获准的下一次诊断前置也曾停在系统选择器：唯一标题在导航栏下被裁切，实际change=false、hash/worker均0。这是选文件工具前置失败，不是第二次PDF产品失败。随后物理截图目检，通过系统搜索得到清晰可见的唯一标题再触控，首个实际697 SHA=e7c…8991成功。

仅按授权再执行一次20001→同697：20001限额2544.9 ms，697成功1473.4 ms且SHA相同。临时Worker构造/发收/terminate只记录白名单action、callback/stream数字、performance时间与固定错误类型，不记录消息正文、路径或原文；3个独立Worker均有真实terminate，完整GetDoc/GetTextContent/Terminate回调可见。`worker-passive-final.json` 保留。所有Worker/File观察hook及额外listener已恢复/移除；没有修改业务函数、预算或超时，没有循环重试。

本片不把被动诊断成功算作30秒故障注入验证；N17工具后台截图中断也不改判成Native worker挂死。原启动暂态仍未定因，N18正式切到自有资料本轮成功不等于其根因已修复。

英文正常697首次本轮2084.5 ms；英文新723待审1906.8 ms，展开完整两行原文，确认类型未选时保存禁用，点Ignore后实际0 pending/状态Ignored。英文同一context：blank拒绝1440.6 ms→697正常1508.6 ms；broken拒绝1465.7 ms→697正常1920.6 ms；20001字符限额2204.4 ms→697正常2232.9 ms。均以真实本次change、名称/大小、新notice和input启用为准。中文/英文新候选各1且最终均Ignored，原已确认683/697的asset ID/字段和决定未变，普通PDF新增0。统计器恰逢onCsvStaged刷新时短暂reviewRows=0不作删除或完成判据，实际稳定列表/SQL分别回读。

## 旧删除确认：真实手机与电脑并发

电脑使用冻结 dist launcher SHA `126e30da08cae9c756e4d292a68a0af56f2d0414bef15792ca3d51fce2a5eea1` 与官方 SDK。系统DocumentsUI实际保存新唯一票据，只复制该文件到严格owner-only私有目录，明确Activate后连接。exact `127.0.0.1`、同Native随机端口ADB forward保留原URI/Host/SAN/CA/SPKI严格校验；这是AVD原生TLS链，不外推物理LAN、物理Android或iOS。

第一票据只允许专用project名称读写，公开比较码 `7E9142D5` 手机相同；完成英文project后正式撤销，旧CLI拒读且关闭。第二票据只含下列4条自造记录、Name读写、15分钟，公开比较码 `80E5B1ED` 手机核对后明确批准；其他字段/原127不在范围。不延长TTL或关闭TLS验证。

| 类型 | 专用ID | 保存字段/关联边界 |
| --- | --- | --- |
| project | `9ecee0d0-9054-430b-94a6-13850c3e8c28` | 沿用N16专用项目，其他描述/notes不变 |
| account | `f43ae7ca-f920-4d19-9a27-8196296d6aac` | 正式新建，合成描述保留 |
| subscription | `d84bbcd8-5550-4d03-9cb8-2df60c7bf59f` | 正式新建，2027-12-31、合成支付备注、关联本表project/account |
| item | `6ebe902c-ce3c-4ce1-865d-e98121ec2cda` | 正式新建，合成存放位置保留 |

逐次操作：电脑preview→手机明确批准→手机正式打开删除确认保留旧快照→电脑confirm收到applied→手机点旧删除确认。预期提示资料已更新且不删除，实际8次均显示准确stale，真实SDK读到新名称、deleted=false。每个operationId独立，不用audit总数代替幂等或应用证明。

| n18-delete-project-en-001 | project / en | 7946 ms | applied → stale=true；最新名称可读=true |
| n18-delete-account-en-001 | account / en | 12802 ms | applied → stale=true；最新名称可读=true |
| n18-delete-subscription-en-001 | subscription / en | 12831 ms | applied → stale=true；最新名称可读=true |
| n18-delete-item-en-001 | item / en | 7552 ms | applied → stale=true；最新名称可读=true |
| n18-delete-project-zh-001 | project / zh-CN | 9463 ms | applied → stale=true；最新名称可读=true |
| n18-delete-account-zh-001 | account / zh-CN | 11734 ms | applied → stale=true；最新名称可读=true |
| n18-delete-subscription-zh-001 | subscription / zh-CN | 9405 ms | applied → stale=true；最新名称可读=true |
| n18-delete-item-zh-001 | item / zh-CN | 9260 ms | applied → stale=true；最新名称可读=true |


## 正常删除与同 ID 恢复

第二grant已在手机正式撤销确认；旧CLI立即读isError=true，再关闭SDK。四类型均在撤销后正式重开最新详情、打开新的删除确认、确认删除，再从回收站点恢复；没有永久删除。project另有首次英文正常删除/恢复（rev8→9→10），中文最后一轮在已有两关联条件下再次正常删除/恢复（rev11→12→13）。account/subscription/item各rev3→4→5。

实际预期：旧确认被拒后不残留已删除状态；正常删除可在Trash找到准确名称；恢复同ID且保最新name、完整其他字段、关联及历史。实际四条全部deleted=false，其他业务字段相对CAS完成时只变化updatedAt；18条relation和2条history逐行完全相同。没有解锁或验证真实KDBX，普通关联引用不等于密码库链路验收。

首次正常删除后脚本在More定位`/trash`匹配到手机与隐藏桌面两个入口，停止在导航前。保留对应删除快照；改用`main a[href="/trash"]`后正式UI恢复，不重复提交已完成删除。不把该定位前置当产品错误。订阅账号下拉最初触控目标在长列表底部、脚本未确认选择；真实键盘End/Enter后按钮显示专用account，再保存回读两条正式关系。此前未确认动作不计保存。

## 完整资料比较与安全交接

接管130行；最终135行 SHA256 `67e9e98e8892c1e0b73fb9241c2f7aa73759fcc0c8f48843a9ef6e3412012c67`。增加3个专用asset及2个专用relation：`4aa67f08-25d9-490a-9e9d-f8701394becc`、`9335a8ec-d615-4647-a954-b04392316653`。基线除专用project外的129行（包括原127与两条N17 PDF）按id/type/完整payload/updatedAt/revision/internalDeleted逐行相同，意外变化0。3个新asset及project最后均恢复原ID；除name、操作推进的updatedAt/revision外无字段丢失。`all-stale-diff.json`/`lifecycle-diff.json`/`final-diff.json`分别保留对应对照，不用数量相等代替完整字段检查。

正式资料切换返回原keepany-v1，本轮没有重现startup错误。实际`/assets/vault`解锁页可见且master输入为空，不解锁/读取原KDBX；控制库只读确认当前指针keepany-v1。自有普通候选journal/importJournal/categoryEditJournal均0、UI无pending transfer。安装后与交接前两次实际base.apk SHA相同。两个grant均经手机明确撤销，旧CLI拒绝，无活动ticket/SDK/监听本轮操作。

4份自有PC ticket/profile在严格私有目录经过DACL/文件identity复核后逐个unlink，remaining0；设备仅删除10个精确本轮公共fixture/ticket/UIXML路径，没有递归删除。own42005/43551/9438 forward全部移除；所有自有SDK、CDP和controller正常关闭。实际forward列表为空；reverse只读观察为空，本片未执行reverse增删，不据此声称其内容一直不变。CA/hosts/服务/其他控制器未动。

明确READY handoff：`test-results/native-eighteenth/handoff.json`，2600 B，SHA256 `b795ebc6dc4da4c2ad32c07a5e520e61c8e66c5b30d070b323c42f4d6a5889e2`。交接后停止ADB/CDP，后续必须主代理另行明确授权。

## 证据、限制与提交

独立ignored证据目录 `test-results/native-eighteenth/`：`actions.jsonl`（冻结源/APK元数据）、8个operationId同名截图、系统选择各阶段截图、真实只读行快照/摘要/差异、`worker-passive-final.json`、`final-installed-apk.json`、`final-safety.json`、`private-cleanup.json`、`cleanup.json`、handoff。最终锁定页截图 `n18-final-original-vault-locked.png`。公开回执不提交SQL、凭据文件、配对secret或原秘密资料。

本片完成受影响PDF正常/错误返回与四kind中英旧删除CAS局部Native路径，不能据此核销整152行、完整F14/F23、物理LAN、iOS或KDBX。30秒cleanup故障注入是另片软件B；首个身份未确认timeout及N16 startup暂态仍未定因，不把自然成功或一轮正常返回当根因关闭。没有改生产代码、构建新APK、运行Gradle或push。提交仅本回执，设备已READY交回。
