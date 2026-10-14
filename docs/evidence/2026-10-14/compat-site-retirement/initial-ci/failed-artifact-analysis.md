# fc5d4f5 固定版 CI 失败证据

- Run `38540911489` / job `115775141638`，固定版 186 通过、1 失败；792 单测（85文件）、race 5通过；后续同步未执行。
- 失败测试 `tests/e2e/password-smart-import-visual.spec.ts:686:1`：`zh-CN atomic KDBX save supplementary import and cross-tab stale draft recovery`。
- 错误为整用例 180000 ms timeout，随后 `browserContext.close: Test ended`。不能将末尾关闭上下文错误当成最初失败步骤。
- `test.trace` 的 `pw:api@162` 指向第 828 行，locator 为 `secondaryPage .password-vault-entry-list .password-vault-entry`、包含合成账号 `alex@example.com`、role button / 精确名「编辑」。
- `1-trace.trace` 的 `call@14536` 在 679992.660 ms 开始 click；679998.175 ms 仅有 waiting-for-locator 日志，此后没有目标解析/点击完成/after 事件，直至全用例超时。
- 前面的副标签页主密码 fill（820行）和解锁 click（823行）均已完成。Click 完成仅代表按钮动作，不能证明异步解锁已经保持稳定。
- `test-failed-2.png` 副页显示「密码库在其他标签页发生变化，已锁定。请重新解锁。」且没有条目编辑按钮。
- `test-failed-1.png` 原页的智能导入抽屉仍在，合成备注 `Synthetic draft survives cross-tab change` 仍可见。不能声称丢失密码、原稿或发生原选择器 data-value 失败。
- 这证明副页在编辑前/等待期间处于跨标签页锁定状态；哪个持久化事件造成锁定需要与测试源及持久化实现结合分析，此报告不臆断根因。
- 失败 artifact `11883108022` 已下载并实际 SHA256 校验为 `10e8a90e907788126ae702ac7f1a37b8c7d3489411311f1ba7168432ac70217e`，与 GitHub 元数据一致。完整 ZIP、trace、截图均在本目录，未写入产品仓库。
- 未 rerun、未改源码、未降低断言。
