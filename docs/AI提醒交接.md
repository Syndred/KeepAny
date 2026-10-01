# AI 提醒交接（2026-10-01）

## 范围与完成情况

用户已选择本轮做到应用内提醒与浏览器系统通知；关闭应用后的后台推送留待后续。提醒由固定数据规则调度，不依赖持续 AI 调用。

- 普通任务支持绝对 UTC 时间 `at`、用户 IANA 时区、提前分钟、现有 `once / fixed / afterCompletion` 重复规则。任务完成记录继续保留；重复任务完成后安排下一期，仍作为未完成待办。
- 订阅提醒从当前真实 `dueDate` 生成；全局默认和单订阅覆盖都保存在既有 RxDB `preference`。提前天数与当地几点均可配置，不修改账期、不自动登记续费或支付。
- 普通旧任务与实物维护计划复用日期与维护提前天数；关联资产已删除、任务已完成／删除、订阅暂停／取消时，不产生通知。
- `ReminderRuntime` 可挂到 `AppContext` 内；提供应用内逾期提醒卡片、相关任务／订阅入口，每 15 秒及重新聚焦时检查。浏览器通知权限仅在用户点击时申请；系统通知可以单独开关、发送测试。
- 同一个事项／期次使用确定性哈希生成投递回执，保存于 RxDB preference。在已有 IndexedDB mutation gate 内重新读取源记录、关联资产与设置，写回执后同步执行通知；任务延期、设置变更、暂停、取消、删除与过期页面不投递旧快照。跨标签源修改与提醒投递共享既有 gate。
- 新增中英文 key；权限拒绝、不支持、系统通知失败、应用关闭不运行、最近 7 天补发政策均有用户文案。开发说明不进入 UI。

## 主代理接线约定

1. `AppShell.tsx` 的 `AppContext` 内挂载 `ReminderRuntime`；组件会渲染应用内提醒卡片，挂载位置由主代理按现有页面布局选择。
2. `page-settings.tsx` 挂载 `ReminderSettingsPanel`。
3. `i18n.ts` 引入 `reminderCopy`，与既有 `passwordVaultCopy` 一样 `Object.assign(copy, reminderCopy)`。
4. 创建／修改普通提醒：

```ts
import { createTaskReminder, localReminderInstant, zonedParts } from "packages/domain/src/task-reminder";
const reminder = createTaskReminder({
  at: localReminderInstant("2026-10-02", "09:00", "Asia/Shanghai"),
  timeZone: "Asia/Shanghai", leadMinutes: 30,
  rule: { mode: "fixed", unit: "month", every: 1 },
});
// Task 必须保持 dueDate 与所选时区中的到期日一致。
const dueDate = zonedParts(reminder.at, reminder.timeZone).date;
// AI 结果先校验、用户确认，再通过既有 save/saveTaskIfCurrent 写入 Task。
```

`Task.reminder = { at, timeZone, leadMinutes, rule, anchorAt, occurrence }`。`createTaskReminder` 补齐初始 anchor/occurrence。`taskSchema` 限制提醒仅与普通任务结合，不能混入维护、外链影响或项目工作流任务。

普通任务日期编辑可用 `rescheduleTaskReminder(reminder, newDueDate)` 保留时区、当地时间、提前分钟和重复规则，并从新日期开始重复。实物维护计划的原始固定锚点规则不变。`setTaskDone(id, expectedDone, task.reminder?.at, task)` 的第三参数必须传当前提醒时刻，以免旧标签的按钮重复完成下一期；第四可选完整确认快照在仓库 gate 内和 RxDB CAS callback 中校验，AI 确认操作应传第四参数，避免先查再写的并发窗口。旧普通任务调用仍兼容。

5. AI 单订阅提醒结果用户确认后调用：

```ts
await configureSubscriptionReminder(asset.id, {
  enabled: true, leadDays: 3, time: "09:00", timeZone: "Asia/Shanghai",
}, asset); // 使用用户预览时的 asset，源变更会拒绝写入。
```

来自 `apps/web/src/reminders.ts`；同时导出 `readSubscriptionReminder`、`readReminderSettings`、`dueReminders`。配置偏好 ID 为 `reminder-settings`，结构：

```ts
{
  enabled: true, browserEnabled: false, subscriptionEnabled: true,
  leadDays: 3, time: "09:00", timeZone: "Asia/Shanghai",
  subscriptionOverrides: {
    "asset-id": { enabled: true, leadDays: 3, time: "09:00", timeZone: "Asia/Shanghai" }
  }
}
```

`enabled` 为全部提醒总开关；`subscriptionEnabled` 是订阅默认开关，单订阅配置覆盖默认。浏览器通知总开关独立且要求实际权限。AI 只修改数据，不调用通知投递方法或浏览器权限 API。

## 验证证据

- 自行复核时修复了 reactive receipt 更新取消 effect 导致投递记录已保存而通知被丢弃的问题；已提交回执的同步 callback 总会执行，仍由仓库源快照检查保护。
- `node_modules/.bin/vitest run packages/domain/src/task-reminder.test.ts packages/domain/src/task-repeat.test.ts packages/domain/src/index.test.ts apps/web/src/reminders.test.ts packages/local-db/src/reminder-delivery.test.ts`：5 文件 35／35 通过。覆盖当地时区、DST 跳过／重复时刻、固定月底锚点、完成后循环、显式日期调整、提前提醒、状态／删除过滤、配置快照变化、并发客户端原子回执。
- MockNotification 纵切：真实 `new MockNotification` 发生在到期任务经仓库源／设置核对与回执后；两个仓库客户端竞争，通知构造仅一次。该证据是软件模拟，不能代替实际 OS 通知或真实浏览器跨标签回读。
- `node_modules/.bin/vitest run packages/local-db/src/index.test.ts -t 'task|completion|maintenance'`：现有受影响任务路径 3／3 通过，42 项因筛选未运行。
- 8 个新增 TS／TSX 文件 Biome lint 无诊断，`git diff --check` 通过。
- 后续接线：`TaskRow.tsx` 完成传当前提醒时刻，延期保留精确提醒配置，“延期一天”按提醒时区计算日期；清空日期同时移除精确提醒。后续完整快照 CAS 定向 `task-reminder.test.ts + reminder-delivery.test.ts` 为 2 文件 11／11，通过变更后的确认快照拒绝与正确新快照完成／重开，TaskRow／新增仓库测试 lint 无诊断。
- 全仓类型检查尚待并行整合：先前缺 `packages/ai/src`，最新被其他代理正在修改的 `IntakeReview.tsx` JSX 语法错误阻断；提醒自有文件未报告类型错误。主代理修复整合后必须重新 typecheck／构建。

## 未完成、边界与下步

- 实际 Ego 的用户点击授权、系统设置／OS 展示及中英文当前固定包浏览器流程由主代理验收；本交接不冒称已验。
- 浏览器关闭后不运行；后台被浏览器节能限流时检查可能延迟。重新打开仅为最近 7 天尚未投递事项补发系统通知；更早逾期事项保留应用内入口。投递采用最多一次政策：回执成功后若系统通知构造失败，不自动重试，以防重复；应用内事项继续可见。
- 夏令时跳过的当地时间拒绝解析；重复的当地时间取较早时刻。未来循环若落在跳过时刻，完成操作会拒绝保存，用户需调整提醒时间。
- 旧事项回执与偏好随现有记录备份／恢复，不增加新资产状态源。任务改名不重新通知；提醒时刻／日期／提前规则变更才生成新回执身份。
- 本分工不负责主代理 UI 接线、固定包、推送、CI 或公网部署；上述状态必须由主代理另行记录。

## 提交与部署状态

源码按领域／仓库与界面／调度两个可回滚范围提交：`d8cc996`（Task 字段、时区／重复、仓库原子投递）和 `e956581`（应用内卡片、系统通知、单订阅设置）。初始交接 `387ead8`；后续接线 `0304b00`（TaskRow 完成与延期）、`b2099e0`（完整确认快照 CAS 与定向测试）。本次分工不推送、不构建固定包、不部署。
