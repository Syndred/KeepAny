# Android 第十六候选 MCP 实装回执（2026-10-28）

## 范围与候选身份

唯一 AOSP emulator-5580，由主代理正式交接后使用自有 CDP9438。交接文件 `test-results/native-mcp-authority-diagnostic/handoff-n16.json` SHA256 为 `9fa2274ded35301c88e30f1db86ab78abd38f20955b97b6f63af2711b1d308d5`，READY。实际已装源 `4de5a460e00ecc7ece5b36acca0d5234d35c960e`，base.apk SHA256 `e56714ffe7e31caad4fc1800834e5967eda4412c1127606451d6d3bfef3c3c66`，23694526 B；本轮没有重装、构建、清 data 或新增模拟器。

实际电脑程序为 `dist/mcp-launcher/bin/keepany-mcp.mjs`，SHA256 `126e30da08cae9c756e4d292a68a0af56f2d0414bef15792ca3d51fce2a5eea1`，由 Node24 与官方 SDK 父客户端通过真实 stdio 调用。手机仅 exact `127.0.0.1`，每次只增加同端口 ADB forward；endpoint、Host、证书 IP SAN、CA 与 SPKI pin 均不改写。这是 **AVD 原生 TLS + ADB 同端口转发 + 真实桌面 CLI**，不外推物理 LAN、物理 Android、iOS 或用户尚未指定的第三方客户端。

主机 Asia/Shanghai 已为 10-28；设备 GMT/UTC 仍为 10-27。审计保留设备实际毫秒时间与界面日期，没有改时钟。实际 WebView CSS 412×660、DPR2.625。所有资产变更来自正式 UI 或已经手机批准的真实 MCP 工具，没有 SQL/仓库注入。只读 SQL 检查仅针对自有普通候选。

## 普通资料基线与隔离

正式界面切回 `keepany-data-a3544b4c-12a3-4b8a-86da-b3498a68236e`。N15 留存 128 行完整逻辑指纹 `6acb3298c57755f27b5e339a940266d1d712bbcba35b74f282563a81753cec35` 在接管时相同。只允许专用项目 `9ecee0d0-9054-430b-94a6-13850c3e8c28` 的 name 被本次操作更改；其 description、notes 不在授权范围。原 127 行逐 ID/type/完整 payload/updatedAt/revision/internalDeleted 比较，始终零差异。

本候选没有创建 KDBX、没有密码会话；原 keepany-v1 密码库保持锁定，不读主密码、KDBX 内容、其他候选、7928/7731 或私密 fixture。未改 CA、hosts、9445–9447 reverse 或服务。

## 逐步实际结果

| 点击/调用 | 预期 | 实际与证据范围 |
| --- | --- | --- |
| 英文只选专用项目，read=name、write=[]、地址127.0.0.1 → Prepare | 只准备，不提前激活 | N15 initialize 红在 N16 修复后可准备；Activate 初始禁用。原 N15 失败回执保留 |
| 导出 → 真正 DocumentsUI 改唯一文件名 → SAVE → 返回 App | 准备态跨系统 onPause 存活，交付确认后才能开始 | 实际保存 `keepany-n16-deny-en-20261028a.json`，回读交付成功后 Activate 启用；英文保存回执含不适用的 password 文案，另记真红 |
| 明确 Activate → 只复制实际唯一文件到严格 owner-only 目录 → 同端口 forward → 真实 CLI | 只有显式开始才监听，先核对公开码 | 首次 D31B22F5 手机/电脑相同；手机 Deny 后无 grant，CLI 固定 `mobile-mcp-pairing-invalid`。这是实际退出结果，未伪称精细的用户拒绝错误码 |
| 新票据/系统保存/明确开始 → 英文 Allow | 精确范围，不能仅 socket 即授权 | D038A5A0 相同；手机 Allow 后才 Authorized。只返回四个原工具，name 投影只有专用项目；未选 ID、额外 notes 参数、未授权 name 写入均拒绝 |
| 关闭 CLI → 实际 `--mobile-connection` 重开 | 同一次手机前台会话可重新连接 | 严格私有 profile 可读、重新连接仍只读同项目；没有重新配对或创建电脑 authority |
| 手机 Revoke → Cancel；再次 Revoke → Confirm | 取消不变，确认后旧连接/旧 profile 都失效 | Cancel 后仍可读；Confirm 后旧 client isError，新 profile 连接固定 `mobile-mcp-unavailable`。128 行仍为原基线 |
| 英文新票据明确授权 name 读写 → preview → confirm（手机批准前）→手机 Deny | 每次写不能自批准 | operation `n16-en-denied-name-001` 在批准前与拒绝后均 `preview-not-approved`，没有改资产 |
| 新 operation → 手机 Approve → confirm 两次 → 正式资产详情 | 一次实际应用，重复幂等 | `n16-en-approved-name-002` 第一次 applied，第二次 duplicate；同 ID 名称可见，revision2→3；原127行未变 |
| 新 preview → 手机 Approve → 正式 Edit/Save → confirm旧preview | 完整 expected CAS 拒绝旧版本 | `n16-en-stale-name-003` 返回 write-conflict，保留正式手动名称，revision4 |
| 英文活跃授权元数据确认后，精确自身 PID SIGKILL，再冷启 | 真正未撤销 grant 的冷启动恢复应撤销，不自动监听 | 杀前同 grant 未撤销、未过期；杀后重启同 grant revokedAt=1793126009058，旧15条审计前缀保留并追加 revoke；界面无有效连接，旧 profile 拒绝、原端口不监听。不是先 Home/onPause 撤销后的伪 orphan 测试 |
| 正式设置切中文 → 新票据真实系统保存 → 手机拒绝 | 双语正式路径同边界 | 61A2E892 双端一致，拒绝后无新 grant，CLI 同固定拒绝结果 |
| 中文新票据 → Allow → 四工具/排他范围/profile重连 → 撤销取消/确认 | 中文也实际逐步执行 | 0A975B3D 一致；只读投影与拒绝边界、profile重连、取消仍可读、确认后旧新 client 拒绝均实际复验 |
| 中文 name-write 新票据 → 拒绝/批准/重复确认 | 中文逐批审批而非复用英文结论 | 65178904 一致；`n16-zh-denied-name-005` 两次拒绝，`n16-zh-approved-name-006` applied/duplicate；正式详情显示中文新名称 |
| 中文 stale 首轮与重做 | 前置必须已实际保存，再判断CAS | 首轮 `007` 草稿未保存，已批准修改正确 applied，属于测试前置失败，合法 effect/audit 保留。重做 `008` 先确认 Dialog 关闭、详情手动名及SQL revision7，再 confirm→write-conflict，重复仍 conflict，保留手动名。未把首轮当产品 CAS 红或绿 |
| 中文活跃授权 → 真 Home 后台 → 返回 App | 后台停止并撤销，不自动恢复授权/监听 | 同 grant 杀前未过期未撤销，Home 后 revokedAt=1793126950403、仍未到期；旧 client/profile 拒绝，返回时 OS 只余系统5555监听，无 MCP listener |
| 中文重新准备/系统保存/明确开始 → 旧 profile 原样重开 | 新 start 不自动信任旧连接文件 | 新端口42841、新 pin 与前次不同；旧 profile `mobile-mcp-unavailable`。旧 endpoint/Host/pin 没有改写。端口也已变化，因此不把此条当作独立 wrong-pin Native 阴性证明 |
| 本次票据无新批准，等待设备时间越过 expiresAt | 两分钟后停止等待，不能自动授权 | expiresAt=1793127162552，设备1793127164672后只余可用 Prepare；42841已不监听，grants仍4/audit仍52，没有新增授权。到期前两张文件名含 expiry 的截图实际还是 waiting，原图留存；真正到期图为 `n16-zh-ticket-expired-after-deadline.png` |
| 无授权/票据后中文普通冷启 → 助手授权 | 历史保留，无自动启动 | 中文历史仍有建立/拒绝/批准/applied/duplicate/conflict及18:49撤销；同grant时间与审计一致，无有效连接/自动监听。此轮不是 orphan 测试；真正 orphan 证据来自前述英文 SIGKILL |

## 每次有效写入与测试失败保留

只在专用项目发生三次合法 MCP applied：英文 `002`、中文 `006`、中文前置失败 `007`。英文 `002` 与中文 `006` 各自的同 operation 重复 confirm 为 duplicate；没有用审计总数代替幂等证据。两次正式手动 Save 形成 revision4、7。最终名称为 `第十六候选手机手动名称`，revision7，128 行指纹 `f2a57f601dfb43147a9a2bd3d419ba352bdb699f514fd6899782ca244797016e`；只变化该项目 name、updatedAt 与 revision。

中文首轮 Save 使用的系统文本定位不唯一，草稿仍在 Dialog；当时后续 confirm 得到合法 applied。随后取消未保存草稿，采用实际顶层元素命中检查后的 ADB 触控 Save，三项保存确认全部满足后再测新 operation。旧截图 `n16-zh-stale-precondition-save-not-confirmed.png`、合法审计和动作日志不改写。

## 安全、真实红与未完成

配对/连接文件只在控制器内存和严格私有目录；stdout 为 SDK 协议，stderr 只有公开核对码/私有路径/固定错误码。实际扫描本轮生成的原始 pairingSecret/grantSecret，在自有普通 SQL payload、已知 CapacitorStorage.xml、当时应用 PID logcat 与 CLI stderr 中均未发现。此为限定对象和时间的原始值阴性，**不声称全部编码/全部历史日志无秘密**。已安装包保持 loggingBehavior=none。没有放宽 TLS、SAN、pin、Origin/Host，没直接调用 prepareTransport 绕过正式流程。

真实 UI 红：MCP 保存成功沿用通用备份文案“请妥善保管文件和密码”/英文同义句，ticket 没有用户密码。英文 `post-system-save.png`、中文 `n16-zh-saved-generic-password-copy-red.png` 保留。主代理已授权后续仅 Native MCP 专用 copy 修复；晚于冻结16，必须新包再验，不能用共享B算本包已绿。

本轮局部补 F23-01—06 手机准备/审批/限定读写/撤销/幂等/CAS/持久历史；不核销整组或其他未验原步骤。物理LAN/第三方客户端接入、真实网络切换与长连接中断、iOS实际手机UI均未验。设备后台停止不承诺后台运行；profile仅同一手机前台 session 重连。

证据位于 ignored `test-results/native-mcp-sixteenth/`：`actions.jsonl`、各阶段一致性只读 snapshots、`before-kill-final.json`/`after-cold.json`、`before-home.json`/`after-home.json`、`readonly-listener-gate.json`、`cold-no-automatic-listener.json`、两语 actual screenshots。原始票据/profile不纳入版本控制或公共回执。

## 收尾与提交状态

已明确 READY 并停止设备操作。`test-results/native-mcp-sixteenth/handoff.json` 为1536 B，SHA256 `6ef0ca9fbf11ff853ce6ea90b5b1e754a3fa1e1518de98528431ffc2857bf47d`。正式 UI 切回初始资料，control 只读指针 keepany-v1；密码锁页可见、master为空。没有读取/重算原 SQL/KDBX/KA1，没有改原秘密控制器。

收尾独立重算实际 base.apk 仍 e567…c66、23694526 B；自有候选128行仍 f2a57…016e，原127完整逻辑指纹 b3e351…61fe；journal/importJournal/categoryEditJournal均0，UI无待传输。所有 grant 已撤销、最后 ticket 到期、无本轮监听。所有 SDK/控制器/CDP关闭；9438与本轮TLS转发移除，forward list为空。严格私有目录11个自建 UUID ticket/profile 经普通文件/单硬链/严格私有检查与前后identity检查后逐个清理，目录剩0；本轮实际 Downloads 唯一文件和系统 XML 也清理。原 CA/hosts/reverse/服务保持，不重试此前被策略拒清理的 TEMP/旧PG目录。

回执独立提交；没有产品改动、没有部署/换包或 push。保存提示修复另片提交、不推送，由主代理统一处理候选。完成前再次 fetch origin，当前无 behind；没有覆盖其他代理的 PDF 源码/测试修改。后续设备使用须再获主代理正式交接。
