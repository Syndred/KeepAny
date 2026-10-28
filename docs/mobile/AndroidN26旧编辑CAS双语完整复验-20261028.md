# Android N26 旧编辑 CAS 双语完整复验

日期：2026-10-28。真实 Android 模拟器 emulator-5580；N26 source `32f40bc4a2bb36a6a46490c944ef4fe42a091b13`，主机／设备实际 APK SHA `5e8e642c8afbc85658d11ae3ecd001856575267bac6bc764261921794f7e8774`。关闭 N25 首次真实 Native 提示遮挡红的中英定向复验；不外推物理 Android／iOS 或全部 MCP 功能。

## 身份、基线与前置

按 Root N26 授权 255ee8d9，仅用既有 wrapper 正常重开原 keepany-api36-aosp／5580，无 wipe／snapshot load／新 AVD；配置与 index 字节保持。保资料 install-r，安装前确为 N25 cdf84，安装后 actual base 精确等本 N26，MainActivity 启动一次。原 App 冷启进入首页，工具最初直接等 Locked 的前置未满足；随后正式 More→Passwords 得到英文 Locked／master 空，无 Try again 启动红，不做 reload／重装重试。

沿 N25 已接受安全交接 9cbe，当前 Graph9 规范化全 SQL fce7／目标 revision2。正式切回同 QA namespace `keepany-data-8c25e851-7804-44e6-97c2-684a5c41643f`，真实 Native A/B 与 WAL 感知 host 全 SQL 精确同基线。原五 QA／三个 closed 诊断采用已接受 before，写前另核实际 control／文件映射与 mode／八 Saved／偏好／AI control；结束重新完整核对全部十份全 SQL，不重复制造十库 before。原 keepany-v1 仅正式 UI Locked，不读／复制其业务数据库或解锁 KDBX。

新 client／driver 只把已审 QA n25 标记改 n26，并更新 fresh profile 时间门槛；原 N25 源／intent／失败 driver／截图不变。所有目标、launcher 字节 pin、单 ID name 读写、确认时限、单 confirm／unknown ACK 不重放、旧 Save 草稿／alert 九点门槛、fresh 单 Save／两 reload 均保持。

## 两语实际完整链

| 语言 | 合法版本链 | PC confirm | 旧 Save | fresh Save | 完整 document reload |
| --- | --- | --- | --- | --- | --- |
| en | 2 → 3 → 4 | 1 applied | 1 拒绝／0写 | 1 | 2 |
| zh-CN | 4 → 5 → 6 | 1 applied | 1 拒绝／0写 | 1 | 2 |

每语独立正式选择唯一项目＋name read/write＋127.0.0.1→Prepare→真实系统 DocumentsUI 保存唯一新票据／读回→显式 Activate→冻结 launcher／官方 SDK→手机比较码及权限核对并明确 Allow。电脑 get 只接受{id,name}投影，preview 唯一 name；手机正式 Approve 后才打开旧 Edit、填本地稿并发一次 ACK，随后电脑单 confirm applied／get 回读。没有 AI／密码库／全库或额外字段请求。

旧 Save 恰一次：同一个旧 Dialog 继续存在、所有表单值完整保持、精确 asset-stale 文案默认可见；ratio=1 且九个内缩点全部命中 alert／子元素。两份未经编辑的 ADB 原图均由执行者实际目检，错误全文与 Cancel／Save 同框无遮挡；名称输入框本身可横向截断，完整草稿保持由实际 value／整表单比对证明，不称所有字段同时可见。

- en ADB 提示原图：`C:\Users\Administrator\.codex\worktrees\53b1\KeepAny\test-results\native-mcp-edit-cas-n26\device\en-1793156426107-50ce81f5\stale-edit-alert-natural-native-adb.png`；SHA `e951980100c14b59237bcccc70a8a9ccdd43c3e0f5624b1869c374aa66413077`。
- en 完整结果：`test-results/native-mcp-edit-cas-n26/device/en-complete-case.json`。
- zh-CN ADB 提示原图：`C:\Users\Administrator\.codex\worktrees\53b1\KeepAny\test-results\native-mcp-edit-cas-n26\device\zh-CN-1793156601789-265b7c76\stale-edit-alert-natural-native-adb.png`；SHA `a4bb68505ee707d5248fd8464ade4cf2160a76107d6a44b0b64ad40981f99439`。
- zh-CN 完整结果：`test-results/native-mcp-edit-cas-n26/device/zh-complete-case.json`。

每语旧 Save 后完整 SQL 精确等 PC 提交后：schema、所有侧表、内部墓碑列与全部行覆盖，拒绝确为 0 业务写。正式 Cancel 后 Revoke local access／手机确认、原生 stop ACK／票据入口消失／PC child exit0；随后 fresh 实际 reload→核 PC 新值→显式重填同稿→Save 一次→第二 reload 读回。每个合法保存只改变目标 name／正常 payload.updatedAt／SQL updated_at／revision，原 ID／createdAt／title／其它字段与其余 8 条完整记录保持。

Root 独立重读两语完整 SQL JSON 差分：`test-results/native-mcp-edit-cas-n26/device/root-independent-full-delta-proof.json`；SHA `2197ea52097515c7d5e0c74de95f3593fccc1cea670079b28cd3c50dcd34a6c3`，两语完整版本链与旧 Save 0 写均确认；该 Root proof 是独立差分审查，UI 目检与实际 Native A/B／host SQLite 见证分别记账。

## 最终保护、授权与交接

- 当前唯一项目名：`CAS Target QA abb4f7ab phone fresh retry ZH n26 c26b7402`；revision 6，仍 9 行，无新关系、history、review、媒体或 vault。
- 最终规范化完整 SQL SHA `cc0567bfb365bdb2799b470978ca3af45d59df012e64a56dfbcd87d01292d985`；实际 `test-results/native-mcp-edit-cas-n26/device/final-graph/full-sql.json` 文件字节 SHA `f9f38df19552c37403e09e0bac130a0105383a28a5357231308534c0e29d9199`，两种 hash 区分。
- 五旧 QA／三 closed 诊断／control 完整逻辑与原保护基线相同；所有文件指针／mode／bytes、八 Saved、偏好和 AI control 保持。保护报告 `test-results/native-mcp-edit-cas-n26/device/final-full-protection-v2.json`；SHA `8d08f0518b24d370e7b2b72332ae91b51ffe30db3b2fcf46a106bba2572fc02e`。原初版继承了 graphFinalExactAfterPc 标签，但执行比较实际为 afterFresh；初版原件保留，v2 明确改名并记录原 SHA，不修改 SQL／WAL 原件或重新取样充绿。
- 独立 authority 原完整 1 grant／7 audit prefix 保持；本轮只追加 2 grant，均已真实持久 revoked，最终 3 grant／21 audit。完整原 prefix 只在内存比较；公开 metadata 不含 secretHash／secret／patch 值。
- 正常回原英文 Locked／master 空，最终 ADB 原图由执行者实际目检。仅身份匹配的本次两票据／private profile／XML 删除，原八 Saved／旧证据／deferred 不动。observer delegate 恢复、CDP／own forwards 清，forward／reverse 空，pending0。
- 自有 controller／两 pair CLI／两 SDK CLI 全正常 exit0，外部五 PID 及 children 匹配 0，own private directory 0。原模拟器／App PID2038保持正常运行，没有 force-stop／SIGKILL／填盘／权限注入。
- 最终安全 handoff：`test-results/native-mcp-edit-cas-n26/device/handoff.json`；54585 B；SHA `0957500fc4abf74f1f1750263032377dd91758cd418caf562c8de3ba2496e0d6`。

## 未完成、交付与下步

N26 候选已由 Root 复制桌面、核 SHA 并交用户自行手机安装，尚无该物理设备结果。此次仅关闭两语旧 Edit CAS 确切合同，不称完整 MCP／断线／iOS 已通过。M005／触发器／低空间均未执行，待独立新授权；所有原 N25 UI 红保留。

已 fetch origin，远端 main 缺失 0。仅精确提交本独立中文回执，不 push，不改产品／共享总表／README／docs08，其他人工作保持。
