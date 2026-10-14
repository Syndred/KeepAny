# CI 失败的点击链路只读分析

分析对象为 clean 70efcd37975b582d18df286d390fa7574dce8210、tag run 38495358157、job 115629775474 的首次失败。未修改源码、断言或 CI，未重跑。

## 已证事实

- 失败在 `password-import-draft-input.spec.ts:77` 第一次恢复输入后选择第 3 行 `password`，还没有编辑映射密码或执行第二次 reload。
- `helpers/select-choice.ts:17-50` 用 ArrowDown 打开 Radix，再仅等 listbox 与 option 可见后调用真实 option.click；最终 data-value 与菜单关闭断言完整保留。
- 应用 Select 为 controlled value，`components/ui/select.tsx:186-206` 直接把 onValueChange 交给父组件；当前字段仍空时，trigger data-value 也为空。
- 已装 `@radix-ui/react-select` 为 2.3.7。其 Content 在 isPositioned 后的 effect 调用 focusSelectedItem，内部 scrollIntoView、viewport.scrollTop 与 focus；源码 `dist/index.mjs:338-358`。
- 其鼠标选择动作在 option pointerup 上调用 onValueChange 后关闭；鼠标 click 本身不选择。源码 `dist/index.mjs:827-882`。
- 另有 DismissableLayer 的 outside dismiss、window blur/resize 关闭路径。因此 closed+empty 并不能证明目标 option 的 onValueChange 曾被调用。
- 本轮 tag 的固定测试 186 过、1 失败；同 SHA main 固定 187 和 main/tag portable 187 通过。说明本次观察没有稳定复现，不能据此直接断言根因是测试偶发。

## 尚未建立的因果

代码证明 helper 没有等 Radix 完成初始定位后的 focus/scroll，但原 CI 没有 trace 或上传截图可用，不能证明该缺口导致本次 pointerup 偏离目标，也不能排除真实产品 state 恢复覆盖。仅有完整日志中的 screenshot/error-context 路径。

## 定向 trace 应区分

1. 第 3 行 option pointerdown 与 pointerup 是否落在同一 password option。
2. 点击前后菜单定位、viewport scrollTop 和自动 focus 是否发生变化。
3. 若 option onValueChange 已触发，父组件 value 是否随后被恢复逻辑覆盖；此项由产品 state 探查负责。

## 条件性的最小 helper 修复

只有 trace 确认鼠标定位/初始 focus 时序问题时，先等正确 trigger aria-controls 对应的 popup 完成初始 option focus，再真实 hover 目标 option、断言目标获得 focus，最后仍 option.click。保留 data-value、closed、popup hidden，以及后续密码/草稿/reload/无 AI 的所有核心断言。不要改用 selectOption、evaluate 注入、force click、键盘直接选中、重复点击重试或固定 sleep。

上述方案是定位证据明确后的候选，不是已经确认的根因或已完成的修复。
