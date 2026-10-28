# Android N25 旧编辑 CAS 真实拒绝与提示遮挡回执

日期：2026-10-28。仅 Android 模拟器 emulator-5580，N25 source `362ac6a27418194e08d6afde541d31fbfee350c6`，设备实际 APK SHA `cdf84d83b6a59021bd6bd79e155f858eca64b493ec8dc4cf20750e623d85c4e4`。本片发现真实 Native UI 红，不能按数据保护通过核销完整旧 Edit 合同。

## 实际完成

沿 Root dfcb 授权及已审 client／driver，使用原 Graph9 独立 QA 库 `keepany-data-8c25e851-7804-44e6-97c2-684a5c41643f`，唯一项目 `c022983b-cece-449a-b09e-fa6c22c9e87f`。没有新恢复、候选、业务行、媒体、密码或 AI 请求。英文正式选择单 ID，只允许 name 读／写；127.0.0.1 Prepare→系统 DocumentsUI 实际 Save／读回→显式 Activate→电脑严格私有票据与冻结 launcher→手机核对比较码及范围后 Allow。所有临时凭据仅运行时内存／正式私有文件，不输出或记录 secret、secretHash、票据正文。

系统文件名输入前置实际形成了首字母 a 加唯一文件名；按唯一 token 找到真实保存文件后精确读取与清理，没有再次保存。首次 Settings 的折叠助手区未展开使 locator 前置失败，之后正式展开再选择；此时尚无 Prepare／写。两项均为工具前置，不作产品红。

电脑官方 SDK：get 单项目 name→preview 唯一 name 修改→手机正式 Approve→打开旧 Edit／填本地草稿→恰一次 owner ACK→恰一次 confirm applied→单次 get 读回，PC child 正常 exit0。手机批准至 ACK 3679ms，保留原 25 秒门槛，没有重放。

- 当前合法项目名：`CAS Target QA abb4f7ab PC CAS n25 e17f2a91`；Native revision 1→2。
- 完整 SQL 差分仅目标 payload.name／updatedAt、SQL updated_at／revision；其它 8 条完整记录、schema 与所有侧表完全保持。
- 旧编辑 Save 恰一次，真实返回精确 asset-stale 文案；旧 Dialog 同一实例，全表单草稿 hash 前后一致。旧 Save 后完整 SQL 精确等 PC 提交后，证明 0 业务写入。
- 英文 client／driver 原件：`test-results/native-mcp-edit-cas-n25/device/en-sdk-public-events.json`；SHA `e0c70701e011a765740d8892a4385380d29c71b081ef38aae96cc231e8750087`。
- 旧拒绝 SQL 证明：`test-results/native-mcp-edit-cas-n25/device/en-first-red-sql-proof.json`；SHA `83f73e6a6cae893e69877b1cb869a504a0c4f10e7e70a24bd101b759d99bd34f`。

## 真实 UI 红与首因边界

英文旧 Save 后 role=alert 全文为 This record changed elsewhere. Reopen it before saving.，但并非自然可见：rect y577.2–625.2，footer.actions y560.5–625.3，九个内缩采样点全部命中 actions。alert 的 viewport ratio=1 不代表无遮挡；固定 driver 正确以 `stale-alert-not-complete-and-unobscured` 失败，没有缩小／跳过断言。

执行者实际查看未经编辑的 ADB 原图：`test-results/native-mcp-edit-cas-n25/device/en-stale-first-failure-natural.png`，SHA `a1ef66bd58588f2d90200442917d18929b529f149de15e65531f2f0e26072499`；图中只有长表单尾部及 Cancel／Save，看不到错误。安全几何：`test-results/native-mcp-edit-cas-n25/device/en-stale-first-failure.json` 与 `en-sticky-layout-proof.json`。实际 N25 dialog scrollPaddingBottom=auto、alert scrollMarginBottom=0，footer sticky bottom=-14px／z-index=1；对应 failure scrollIntoView nearest 与 sticky footer 的布局交叠已报 Root，产品修复由 Root 另片负责。没有改产品 DOM、CSS、源码或重新点击旧 Save。

## 安全收尾与合法新基线

Root 接受首红并限定收尾后，冻结全稿／首图→Cancel 一次→正式 Revoke local access 确认。原生 KeepAnyMcpTransport.stop 有成功 ACK，Stop／Activate／配对链接消失；本次 1 个新 grant 已真实持久 revoked，原 grant／audit 前缀相同（开始均空）。共 7 条脱敏审计，包含 applied 收据，无自动重放；`test-results/native-mcp-edit-cas-n25/device/authority-final-metadata.json` 不含 secretHash 或字段值。

- 最终九行全表基线：`test-results/native-mcp-edit-cas-n25/device/final-graph/full-sql.json`；SHA `fce7b1a55b5e3ccba6e4aa7d76cfaa38b0d4e7964c13210f7b449e1f2de7bdfb`。含内部墓碑列／所有 SQL 表，WAL 感知且静止窗口见证，精确等 afterPc；不是原未修改 G6 名称基线。
- 五保护 QA、三 closed 诊断、control 完整逻辑、所有引用文件映射／mode／bytes、八 Saved、偏好、AI control 实际 final 核对保持。保护证明：`test-results/native-mcp-edit-cas-n25/device/final-full-protection.json`；SHA `9eeef0bb83bcf82927e948b698d643fc2041fa1eb1fe45b2d11797b99e897d4a`。
- 正常切回原英文 Locked／master 空，不读原 keepany-v1 业务或 KDBX。原生 stop 后重新挂载的 Settings 范围未选，Prepare disabled 是前置状态；不以其 enabled 作为停止 ACK，实际 stop resolve／grant revoked／票据入口消失分别留证。
- 仅本次身份匹配的配对票据／私有 profile／XML 移除；旧备份、其它票据和 deferred 不动。自有 controller／pair client／SDK client 全 exit0，外部三 PID 与 children 均 0；delegate 恢复、CDP 关闭、自有 forward 清除，forward／reverse 空。
- 独立最终 handoff：`test-results/native-mcp-edit-cas-n25/device/handoff.json`；33184 B；SHA `9cbe60d6ae3093deb1ddb047ea062d7269130032f9ac1f2a6f22d62586ba707d`。

## 未完成与下步

中文、fresh retry、第二次 reload及 M0-05 bootstrap 均未执行，不列通过。Root 将另行修复提示可见性并冻结 N26，下一轮必须以当前 PC 名／revision2 为起点，用新配对／新 operation 验证完整两语，不改本轮 failed driver phase 或旧失败原件。此为真实模拟器软件结果，不外推物理 Android 或 iOS。

仅精确提交本独立回执；不 push、不改总表／README／docs08／产品或公共测试。
