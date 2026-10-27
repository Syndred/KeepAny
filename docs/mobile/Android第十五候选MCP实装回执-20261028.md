# Android 第十五候选 MCP 实装回执（2026-10-28，首批准备失败）

## 完成与范围

本轮真实使用唯一 AOSP emulator-5580。主代理正式交接后核验 `android-5580-mcp-authority-handoff-20261028.json` SHA256 `78fa09bb384160656037b24fd5de8e0e58e696711cf2480650c72ef22113b2fc`，ready=true；接管前设备实际 base.apk 是冻结 14，SHA256 `2b11587eb26a721909d5146bdf06814c3b75fa92c696156116dc0a60d9ad3533`。

只执行 `install -r` 覆盖安装冻结 15，没有清 data、另开模拟器或构建新包。候选源 `afcea1f43b839a976ee5589a03469a4ba1e8e302`，稳定 APK 23694526 B，SHA256 `0f60fd7b5a0c8b017e6bb2536f921a6bbebf1678c4f31bf50a7132d19c69615b`；安装后、收尾时均对设备实际 base.apk 独立实算相同。程序读取该 APK 内 capacitor.config，确认 `loggingBehavior=none`，没有开启秘密日志。

只创建自有 CDP9438，未用 9436；所有业务操作经过正式界面。Android 系统触控由 ADB input 与实际 UI 坐标执行，系统 UI 元信息来自 uiautomator；没有安装 Playwright Android driver APK，没有通过 SQL/仓库 API 注入资产。此轮实际屏幕 CSS 412×660、DPR 2.625、物理 1080×1920，不冒称 390 真机或物理 LAN/iOS。

主机已跨日：Asia/Shanghai 2026-10-28；设备读到 2026-10-27T17:45:29+00:00、GMT。没有改系统日期/时区，没有删除跨日提醒来调整数量。

## 点击 → 预期 → 实际

| 操作 | 预期 | 实际/范围 |
| --- | --- | --- |
| N15 冷启 → 更多 → Passwords | 原库密码仍锁定，不读取/输入主密码 | 实际 Locked、Unlock vault，密码输入空白可见；没有解锁、读取 KDBX 或原 master/controller |
| 更多 → Import & backup → `Restored 10/27/2026, 2:55:37 PM` → Switch → Confirm | 返回自己保留的 a354…836e，原资料保留 | 正式 UI 切回 `keepany-data-a3544b4c-12a3-4b8a-86da-b3498a68236e`；只读该库 127 行，完整逻辑 row 指纹 `b3e351813d1c6c2b1b26cdbb5d25a9a5f9ac879630d05c40bcf99fc6e5e961fe` 与 N13 checkpoint 完全相同 |
| Assets → Add asset → Projects → Continue → 填名称/描述 → Save；再 Edit 展开 Contact details 补备注 → Save | 只新增本轮专用项目，原 127 行不变 | 新项目 `9ecee0d0-9054-430b-94a6-13850c3e8c28`，名称 `N15 MCP ordinary 20261028`；非空 description 与 notes 均实际保存。总数 128，原 127 行逐 ID/type/完整 parsed payload/updatedAt/revision/internalDeleted 0 差异 |
| 更多 → 设置/助手 → 只选该新项目，默认 name 只读、write 无，填 exact `127.0.0.1` → Prepare pairing file | 只准备两分钟 ticket；仍未导出、监听或授权 | **实际失败**：`Could not prepare the pairing file. Check this device’s address and retry.`；没有导出链接/Activate，只有 Prepare/Stop。首轮英文 N 红，不能核销 F23-02 |
| 首轮失败后按主代理许可分层检查，再正式 Stop | 只读、不修数据、不直接初始化/探测 TLS | 得到下节固定元信息；正式 Stop 后返回原 Initial dataset → Confirm → Passwords，Locked 可见。无 ticket、CLI 或新 TLS 转发 |

原 127 行包括 asset95/category2/history2/preference3/relation16/submission1/task8。新增专用项目后 asset96，其余数量不变。该项目先保存名称/描述，首次 notes fill 因 Contact details 未展开而超时；随后重新 Edit、实际展开并验证 open，再补入备注成功。未把首次未保存的 notes 当作成功；没有改原项目来制作 MCP fixture。

## 真实失败的分层诊断

首轮红截图：`test-results/native-mcp-fifteenth/n15-first-prepare-red-en.png`，英文错误在当前屏幕可见。正式失败与后续诊断均追加在 `actions.jsonl`；原红没有被重复重试或模拟成功覆盖。

1. 主代理许可的只读能力检查：Capacitor `isNativePlatform=true`、platform=android；KeepAnyMcpAuthority/KeepAnyMcpTransport 均 available=true。仅按已知 own candidate name 计算 SHA256，再调用已注册 authority.readState；未调用 initialize/update，结果是固定 `mcp-native-unavailable`，没有返回或输出 payload。
2. 主代理提出系统路径别名假设。只读 `run-as pwd`、realpath、exact path stat：no_backup absolute/canonical 相等=true；exact `no_backup/keepany-mcp-authority-v1` 存在、相等=true、mode700。仅 own scope 的 `.enc/.enc.bak/.enc.new` 均不存在，只检查存在/长度，不读内容。**此机没有证明路径别名根因**；不得据此猜测修 Java。Keystore alias 未检查，不能用文件不存在推断从未创建 key。
3. 依主代理许可，临时 pass-through wrap `window.Capacitor.nativePromise`，只保存允许的 plugin/method/begin/fulfilled/rejected 与固定 code，不保存 args/result/body；一次正式 UI Stop→Prepare，finally 还原。真实调用序列只有 `KeepAnyMcpAuthority.initialize begin → rejected(mcp-native-unavailable)`，没有 readState 或 Transport。由此确定已进入 Java initialize，而非 loadContext 前失败，也尚不能归因 TLS。
4. 主代理再许可的最后一次 UI 诊断只附加参数**形状**：Object.keys=`[scope]`、typeof=string、length64、hex64=true；仍在 initialize 被拒。没有 scope 值/秘密/原生结果输出，finally 还原。此为诊断重复，**不是新成功验收**。

未直接 initialize/prepareTransport，没有清空或修复失败 scope，没有放宽 TLS/Host/IP SAN/pin/Origin，也没有复制浏览器模拟权限状态来绕过。由主代理接手独立 instrumentation，使用其自造 scope 定位具体异常 class/栈；本片没有擅改 root main/provider/session/Java。

## 未执行、不能核销

由于首次 prepare 失败，后续均未开始：真正系统 DocumentsUI 保存唯一 ticket、Save/onPause 准备态存活、同 endpoint/pin 显式 activate、实际电脑 packaged CLI、同端口 ADB loopback 转发、手机先拒绝/再核八位码批准、四工具与只读字段投影、旧 profile 重连/撤销、逐批 write 预览/拒绝/批准/幂等、stale conflict、Home 后台停止、新 start pin 轮换。中文对应 Native 操作也未执行；本片没有成对中英 N 绿。

F23-01 仅真实能力入口可见和未假授权；F23-02 为 prepare N 红；F23-03—06 保留未验，不因共享 B/C、Java OS 存储单测或旧准确 unsupported 核销。冻结 15 中 history helper 尚未接 cold history UI，本轮没有当作已实现。物理 LAN、物理 Android 与 iOS 全不外推。

## 工具观察与证据边界

- CDP 默认上下文不支持 Playwright tap，改用实际系统触控；NodeREPL 初始工具探测超时后改用本轮独立控制器。9438 一次消失后仅重建自有 forward，App 和 devtools socket仍在；主代理确认其他 agent 没有用 ADB。此为控制桥工具观察，不当 App 失败。
- 首次实时顺序复制 db/WAL 在本机读取出现 malformed，闲置重读正常；随后采用设备自带 sqlite3 `-readonly -json` 一致性查询。没有向设备 SQL 写记录，没有把不一致的复制当 phone 数据损坏；原捕获留史。
- 控制器 Stop/quit 已关闭 CDP，但 readline TTY 仍使自有 tsx 父/子进程存活；按精确本轮 controller.mjs 命令行核对 PID 后，仅清理这 14 个自有进程并确认 0，补齐控制器退出清理。没有读取/终止 7928/7731 或其他控制器/服务。

证据均位于 ignored `test-results/native-mcp-fifteenth/`：baseline/final logical rows、summary、首红/锁态/项目截图、actions、path-metadata 与 handoff。普通数据 readback 仅限自己 a354 候选；没有读取原库 SQL/KDBX、primary 六字符候选或私密 fixture。最终 logical rows SHA256 `6acb3298c57755f27b5e339a940266d1d712bbcba35b74f282563a81753cec35`，128 行且原 127 逐行保留。

## 安全交接、提交与下步

已通过正式 UI Stop → Initial dataset/Confirm → Passwords，原 `keepany-v1` 在用且 Locked 可见。只读 control 指针确认原库；未读/重新散列原 SQL/KDBX/外部 KA1。own 128 行保留供续验，journal/importJournal/categoryEditJournal 均 0。自有 controller/CDP 实际关闭，9438 已移除；从未创建新的 Native TLS forward、ticket/profile 或 CLI。自有系统 UI XML已删除；原 CA/hosts/reverse9445/6/7、秘密控制器与先前被拒清理的 TEMP/PG 路径未动。

明确 READY：`test-results/native-mcp-fifteenth/handoff.json` SHA256 `c700352dfde1515d25cc4e13dfd56f9cccea633a56b1259753ef8a0cab005e65`，ready=true。只由主代理正式转交设备后再继续，不抢 instrumentation 或设备。

本片仅提交本中文回执，没有产品修改。fetch origin 成功、无远端缺失；未推送/部署。下一步为主代理定位真实 initialize 异常并在新候选复验；之后仍须从原失败 UI 准备步骤重跑完整只读小批，再做写入/后台/轮换与中文，而不是跳过准备障碍。
