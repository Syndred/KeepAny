# T14 第二轮：四条原要求仍为部分完成

2026-10-27；本轮候选 `1bb1c081b43310605fe3fe7bef9ec361a94afa93`，主控已 fetch 确认远端 `f659db1`，本地领先六个提交。Windows / Node 24.21.0 / Playwright 1.63.0；源码服务 `127.0.0.1:4208`，每例独立 Chromium context，全合成资料。用户 4180 未触碰。

结论：新增的 2 条行为回归通过；原总表 T14-01～04 均不能标为完整通过。四个缺口在当前候选中确实没有对应正式实现，未发现遗漏的替代入口。不能据此推断它们在所有历史提交中“从未实现”。本轮没有产品修复、没有减去原合同，也没有以安装工具或测试场景数量替代验收完成度。

## 按原合同核对

| 原用例 | 完成度 | 已有能力与实际证据 | 缺口及 GSD 真值判定 |
|---|---|---|---|
| T14-01 项目/实物新增关联费用 | 部分 | 本轮同一 context 同时有项目、实物、账号、订阅。正式记账菜单实际只有账号/订阅；选择订阅，输入 12.34 CNY、2026-10-20、付款来源后，确认前历史不变，确认后 RxDB 精确为 1234 最小单位，刷新保持。 | 项目/实物作为账单目标 **FAILED / BLOCKER**。`page-finance.tsx:39` 的目标过滤和 `:115` 的保存校验都限制账号/订阅。PDF 费用入口 `IntakeReview.tsx:33`、`packages/local-db/src/intake-review.ts:256` 同样限制，不能替代。 |
| T14-02 精度/分币种/编辑账单 | 部分 | 既有精度与备份测试合同保留；本轮新增证据证明“订阅关联”中的编辑把订阅计划改为 25.50、2026-12-22，RxDB 资产回读为 2550 与该日期，同时两条既存历史逐字段及 ID 不变。 | 已存账单的金额/日期编辑 **FAILED / BLOCKER**。`page-finance.tsx:137` 的编辑按钮接 `AssetEditor`（`:149`），编辑的是订阅；账单行 `:146` 无编辑按钮或回调。不能把此测试计为账单编辑通过。 |
| T14-03 一笔多资产/移除其中归属 | 部分 | 一个订阅同时关联项目和账号，两张关联链接都真实出现；总账仅一笔 12.34 手工费用和一笔 5.00 续费。原续费 ID、日期、金额、备注不被手工记账或订阅编辑覆盖。 | 一笔费用多归属及移除其中一项 **FAILED / BLOCKER**。`packages/domain/src/index.ts:121-142` 历史仅有单值 `assetId`；`FinanceEntryFields.tsx:6` 草稿及 `:19` 选择也是单值。资产关系的 Remove 操作编辑关系图，不是账单归属，不能混同。 |
| T14-04 非法/取消编辑/确认删单 | 部分 | 本轮非法小数 1.234 显示错误且两条历史不变；改为合法 99.99 后取消新建，刷新仍逐字段与原两条历史相等。 | 已有账单编辑取消、单张账单删除确认 **FAILED / BLOCKER**。总账行没有可操作控件；详情 `page-asset-detail.tsx:1941-1967` 同为只读历史。资产“移至回收站”或永久清理关联历史不满足“只删目标账单”。本轮取消的是新建草稿，不冒充取消编辑。 |

## GSD 准则如何实际使用

已读取本机 `C:/Users/Administrator/.codex/agents/gsd-verifier.md` 及 verification-overrides / gates / verifier-phase-gates / verifier-evidence-gate 参考。采用其 goal-backward 方法，把总表原四条行为当作不可缩减目标，再查实现实体、表单到保存的接线、RxDB 数据流及真实操作；前轮报告的结论只用作待证假说。

- 对可以自动验证的确认、取消、无效输入、订阅编辑不改历史等行为，新增真实 UI 操作和精确 RxDB 回读，不依赖“符号存在”判通过。
- 对观察到实现缺失的目标明确记 FAILED，不用 UNCERTAIN 或人工 UAT 问答掩盖。包级报告沿用总表“部分”，GSD 目标结果为 `gaps_found`，四条原目标完整通过数为 `0/4`，不是新增测试 `2/2`。
- 未创建 `.planning`、未重新 onboarding、未引入无用户授权的 override、未要求用户逐条手工回答。没有修改总表、交接或产品。
- 对新测试做测试质量核对：2 个 active、0 skip/todo；断言为多步行为与独立指定数值。receipt JSON 仅记录观察值，不是生成测试期望。菜单/行控件缺失写入观察回执，不添加“功能必须永远不存在”的回归断言。

## 验证证据与清理

新增 [qa-t14-round2.spec.ts](../../../../tests/e2e/qa-t14-round2.spec.ts)，执行：

```powershell
$env:KEEPANY_E2E_PORT='4208'
node node_modules/@playwright/test/cli.js test tests/e2e/qa-t14-round2.spec.ts --config=playwright.windows-qa.config.ts --workers=1 --output=test-results/T14-round2 --reporter=line
```

最终 2/2 passed，10.4 秒。初跑亦为 2/2，后补订阅精确回读后复跑。两轮无产品失败。完整运行日志在忽略目录 `test-results/T14-round2-run.log`；两份小回执包含实际菜单、账单行控件、各详情按钮、原历史及订阅回读：[en-receipt.json](../evidence/T14-round2/en-receipt.json)、[zh-CN-receipt.json](../evidence/T14-round2/zh-CN-receipt.json)。

双语截图已目视核对：[中文390](../evidence/T14-round2/zh-CN-390.png)、[英文1280](../evidence/T14-round2/en-1280.png)。截图可见订阅计划 25.50、已记支出 17.34、单独的 12.34 账单与 5.00 续费，未出现布局裁切。

Playwright 已关闭两个测试 context 和自建 4208 服务，端口回查无监听。无真实支付、Ego、真实用户资料或最终便携包验收。本轮未提交 Git、未部署。下一步需在保留四条原要求的前提下实现缺失能力，再做对应行为回归；不能宣布整个费用包或整个项目验收完成。
