# 1939e30 基线 CI 的 12 项便携流程失败诊断

日期：2026-10-27（北京时间）。工作流 `40048011609`，源码 `1939e3020ffd924818b91f20eb0c847bcd2eec77`；原日志结果为 **249 passed / 12 failed**。本记录不将旧失败改记为成功，也不以诊断替代修订后实际复验。

## 证据与处理范围

- Artifact `12543338095`，198,208,826 字节；实际下载 SHA-256 `1f5668b5ef9a48396322d5a0fc46b3b262bc593b89c546c593a608c5e9203448` 与 GitHub API digest 完全一致。
- 只展开 12 个失败上下文与失败 PNG；嵌套 trace 在 ZIP 中按需读取，没有展开 412MB 的全部内容。
- 原日志见 `portable.log`，逐项索引见 `failure-index.json`，trace 最后动作见 `trace-last-actions.json`，上下文/截图在 `failed-artifact-selected/portable-release/`。
- 所有资料来自合成 CI fixture，未访问原用户 4180，未改应用布局或功能。首次阶段仅只读；随后根代理授权修订第 1/2 项的测试前置操作，其他测试由根代理处理。

## 分组结论

| 原失败项 | 数量 | 实际等待/断言 | 证据与最小修订方向 |
|---|---:|---|---|
| account-graph-readability，中文1280 | 1 | spec:1338 要求默认阅读相机下所有12张卡片同时完整入框 | 截图中当前账号居中，字号正常，左侧2张远端卡片裁切。`GraphViewport` 明确在完整图缩放低于11/12时采用1x当前账号阅读模式；固定按宽度>=1280要求all:true，不符合可平移阅读模式。保留真实Fit all的全图边界检查，再逐卡真实平移，继续检查完整卡片、最小字号与遮挡，最后真实回到当前账号。 |
| account-graph-readability，英文1536 | 1 | helper:262 要求当前账号中心误差<=3px | 截图中心约偏16px，工具栏显示Fit all。产品单一相机按钮在偏移<=24px且缩放接近1时显示Fit all；旧`focusAccountGraph()`只找Back to current，因不存在而不操作，随后严格居中检查失败。复用已有真实缩小→Back to current操作，不放宽3px阈值。 |
| custom-category-release，中英 | 2 | spec:101 `getByText(renamedCategory, exact:true)` | 失败上下文确实显示完整 `Accounts · Renamed account L...`，分类没有丢失；分类现在是眉题组合文本，不是独立精确文本节点。应在既有 `.asset-detail .eyebrow` 核对分类内容，保留原长名换行、分类ID、备份/恢复断言。 |
| password-vault，多标识导出恢复，中英390/1280 | 4 | spec:338→helper:103 等待不存在的 `.password-vault-field-actions` | 四个trace都已完成字段与密码眼睛操作，最后卡在这个旧独立工具栏。该重复生成入口已按10/23需求删掉，现仅输入框旁一个生成图标。应验证唯一生成按钮及现有字段布局/真实触达，保留卡片动作16px间距、加密导出、两条密码与别名恢复等原断言。不能把此处150秒超时解释为KDBX保存失败。 |
| vault-reference-release，中英390/1280 | 4 | helper:267 要求 `.account-security-card` 重复显示外部密码库引用名称 | 当前安全卡为资料核实日期、关系核验日期与“管理这个账号的密码”链接；外部引用属于关系图/关联明细。应在现有关联明细核验同一引用关系，再核验安全链接的账号hash，保留外部引用、备份和恢复流程。无需把旧重复内容加回产品布局。 |

## 不应采用的处理

- 没有证据支持将这12项统一归为网络/Runner偶发，不能只重跑碰绿。
- 不调小字体、不放宽3px居中、不删除遮挡/边界/备份检查，不添加sleep、整项retry或吞错。
- `browserContext.close` 是密码四项超时后的收尾错误，不能据此把根因写成浏览器环境故障。
- 上述是限定证据支持的测试/现行UI差异；修订后仍须实际运行目标场景与相应矩阵，才能报告验证结果。

## 图测试修订后的实际复验

- 仅修改 `tests/e2e/account-graph-readability.spec.ts` 与 `tests/e2e/helpers/account-graph.ts`，不改产品布局或相机算法。
- 原两失败场景先独立运行：**2 passed / 0 failed**，220.47秒，实际1 worker，exit0。
- 再运行该文件全部实际发现的8项：**8 passed / 0 failed**，374.20秒，2 workers，exit0。覆盖中英390/1280/1536、24/49节点阅读/总览与额外控件/小地图场景。不是预估的6项，以实际执行8项为准。
- 原3px居中、字号、卡片边界/遮挡、线路、用途与备份恢复断言保留。没有增加sleep、retry、吞错或放宽数值阈值。
- 受测 `apps/web/dist` 入口在矩阵执行期间及结束后均为 `/assets/index-Df5R4iNi.js`。自有4474已退出，原4180未动；自有输出扫描无合成 `.ka1`/`.kdbx` 遗留（0个需删除），日志、JSON与截图保留 `/tmp/keepany-brand-return/graph-test-results/`、`graph-evidence/`。
- 已人工查看中文1280默认关系图、英文1536选线面板、英文390的49节点阅读图，沿用原主题与控件间距。
- 记录索引：`../graph-test-results/summary.json`、`target.log`、`matrix.log`、`graph-test-fix.patch`。未提交或推送，由根代理统一交接。
