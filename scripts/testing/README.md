# 检查入口

日常反馈、完整发布检查和临时诊断分开执行；日常绿色只说明下面列出的有限范围。人工视觉、主控本人体验及独立复核仍按根目录 AGENTS.md 记录，机器回执不能代替。

| 入口 | 触发与范围 | 上限与产物 |
|---|---|---|
| `Daily checks`（`daily.yml`） | push/PR/手动；无外部数据库的单元检查、类型检查及一次新便携候选编译、包/服务器合同、账号展开与匹配弹窗各2条既有用例 | job 25分钟；`quick-feedback-<run>-<attempt>`，失败截图/trace/回执在 `test-results/` |
| `Verify local release`（`verify.yml`） | 手动选择分支/提交；许可证、本地事务/收录竞态、补齐功能的源码CAS/存储故障子集、保留的本地业务、PDF输入拒绝与旧候选恢复、路由故障、离线和历史升级基线；并调用账号、密码工具和平台检查 | 各job保留独立预算；失败产物及被调用检查的产物分别上传。实际清单以当前配置为准 |
| `account-layout.yml`、`vault-tools.yml`、`preview-package.yml` | 可单独手动定位问题；也由完整发布使用同一提交的本地 reusable workflow 调用。单独绿色不等于完整发布绿色 | 35/35/25分钟；布局、工具回执/截图与三平台ZIP分别保留 |
| `Diagnose module loading` | 仅手动；现有bundled/Chrome与trace开关比较 | job 35分钟；`module-navigation-<run>-<attempt>` |

完整业务回归只在新编译便携候选上运行一次；`playwright.release.config.ts`保留为检查指定已交付目录的独立入口，不再与新候选重复运行相同业务矩阵。备份、KDBX、离线、旧品牌和数据迁移断言均保留。

官网发布会检查 `verify.yml` 的完整手动运行：精确source SHA、工作流路径和所有必需job均须成功，缺失、跳过、取消、同名日常运行均拒绝。原有仅公开文档变更可复用祖先源码检查的白名单保持。普通push/PR不会自动启动完整发布；发布前需从Actions运行完整检查。当前旧AL/route记录与新源码不匹配会严格失败，必须补当前候选的真实记录，不能改旧SHA或将日常绿色当发布许可。

## 本地针对性检查

先按改动运行 `pnpm typecheck`、相关 `pnpm exec vitest run <file>`。需要最终包时，在干净的已提交源码上 `pnpm build:preview`。使用输出的**明确ZIP路径**设置 `KEEPANY_PREVIEW_ARCHIVE`，再运行 `pnpm verify:preview` 或对应Playwright配置。CI的 `select-preview-candidate.mjs` 只选择当前HEAD的干净产物，不选最新文件，也不回退源码。

- `pnpm test:final:workflows`：当前保留的本地业务spec，含以下补齐功能、PDF拒绝和历史恢复场景；不再将已删除模块的成功路径作为新版合同。
- `pnpm exec playwright test --config playwright.completion-source.config.ts`：T16重复/竞态、普通候选非法字段/合并写入中断，以及旧PDF费用审核中断恢复的源码故障子集。有意使用内部准备或故障注入，记录为白盒源码证据，不代替最终包用户任务。
- `pnpm exec playwright test --config playwright.pdf-removal.config.ts`：同一显式最终候选的普通/AI输入PDF拒绝、无副作用和保留CSV/AI文字对照；也包含在完整本地业务入口，手动定位时可单独执行。
- `pnpm test:final:layout`：显式编译候选的账号矩阵及机器证据核对。
- `pnpm test:final:links`：FC24全部14组合；按需配合 `scripts/verify-vault-links-layout-evidence.mjs --create <evidenceDir> <new-record.json>`，不覆盖历史记录。
- `node node_modules/@playwright/test/cli.js test -c playwright.independent-layout.config.ts`：独立账号/最简/分类/busy等现有用例；须显式ZIP，busy每个语言尺寸包含三个消费者（共30状态），social为10组合。记录候选身份共用 `portableCandidate()`。

`--list`仅证明发现清单，未启动服务或执行产品任务。Windows上带 `|` 的 `--grep`请直接调用上面的Node CLI，避免 `pnpm.cmd`再次解释参数。开发源码检查使用 `playwright.config.ts`；`test:functional:layout`允许源码开发检查，不能登记为最终编译包验收。

公共配置在 `browser-config.ts`，编译候选选择、校验、解包在 `../lib/portable-candidate.mjs`。不同平台/场景的配置继续保留，不按文件数量合并。截图基线仅在明确提供人工审过的 `KEEPANY_REVIEWED_BASELINES` 时严格比较；没有该输入时回执记录待人工查看，不声称自动视觉验收。

## RF03 补齐功能与持续回归

|原合同|最终包既有场景|核对点|
|---|---|---|
|T14-01～04|`qa-t14-completion.spec.ts`，8场景|四种普通资产/项目实物多归属、金额日期编辑、取消/删除、续费事实隔离、第二标签旧编辑/删除拒绝、搜索与实际KA1干净恢复|
|T16-03|`qa-task-link-portable-completion.spec.ts`，中英2场景|待办名称/日期编辑及取消、日期交集/返回/刷新、原ID/历史/邻条保持、实际KA1恢复；该历史文件名中的link不再表示新版外链管理能力|
|T18-01/02|`qa-t18-portable-completion.spec.ts`，中英2场景|真实公开URL元数据/私网拒绝、CSV BOM/CRLF原文和共享引用、逐项确认/重复拒绝、待审编辑与实际KA1恢复|
|T19-01|`qa-t19-merge-completion.spec.ts`，中英390/1280共4场景|默认不选字段、空选择拒绝、取消焦点、明确字段合并、双击不重复、原值/来源/决定/ID、刷新与实际KA1恢复|

T14、T19字段合并、待办及旧PDF兼容资料由`tests/e2e/helpers/completion-archive.ts`在Node中使用fake-indexeddb及既有公开仓库导出/加密函数准备，**不是用户操作证据**。生成的`preparation.json`明确标记来源；编译包页面只使用可见KA1恢复，不启动Vite。旧PDF夹具直接表示已提取的历史候选，不运行PDF解析器、不证明新PDF输入。现有保留功能断言、15秒动作预算、各业务场景预算和零重试保持；人工图审、主控本人体验与独立复核仍须分别执行。

## 2026-10-29 用户删除功能后的合同变更

用户明确移除PDF新输入及B1/B2/B8/B9/B10。旧PDF导入/离线worker成功合同、单条外链删除、ExternalLink导入、外部vault引用及远端同步/迁移成功用例，不再适用于新版；本轮不是降低这些功能的通过标准，而是删除该产品能力。既有Git历史和原失败证据保留。

- PDF reader、worker及仅为其添加的缓存扩展已移出产品；原离线缺陷、随后未交付的修复/用例副本保留在本次忽略证据目录`test-results/retired-pdf-20261029/`，原已提交用例仍可从`beca326519bf6dd23dd9f52aa560ac1d585248fd`读取。
- 新PDF输入合同由`pdf-removal-release.spec.ts`验证扩展名或MIME拒绝、无AI请求/普通资产写入副作用，以及保留CSV和AI文字。
- `intake-review-backup.spec.ts`、`intake-expense.spec.ts`、`intake-expense-recovery.spec.ts`与T14旧PDF候选两例保留历史原文/决定/金额/ID/费用审核/KA1断言，仅将此前“新导入PDF”准备改为明确的旧候选KA1恢复；新PDF重复输入改验拒绝且旧数据不变。
- `qa-task-link-portable-completion.spec.ts`保留全部本地待办/日期/KA1断言，原B1外链创建/删除段按新需求退役；源码故障子集不再包含已删除的`qa-t19-delete.spec.ts`。
