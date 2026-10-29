# 检查入口

日常反馈、完整发布检查和临时诊断分开执行；日常绿色只说明下面列出的有限范围。人工视觉、主控本人体验及独立复核仍按根目录 AGENTS.md 记录，机器回执不能代替。

| 入口 | 触发与范围 | 上限与产物 |
|---|---|---|
| `Daily checks`（`daily.yml`） | push/PR/手动；无外部数据库的单元检查、类型检查及一次新便携候选编译、包/服务器合同、账号展开与匹配弹窗各2条既有用例 | job 25分钟；`quick-feedback-<run>-<attempt>`，失败截图/trace/回执在 `test-results/` |
| `Verify local release`（`verify.yml`） | 手动选择分支/提交；真实隔离PG单元/迁移、许可证、收录竞态、交付文件/同步、一次53份业务spec、路由故障、离线与三个历史升级基线；并调用账号、密码工具和三平台检查 | 各job保留独立预算（最长110分钟）；失败产物及被调用检查的产物分别上传 |
| `account-layout.yml`、`vault-tools.yml`、`preview-package.yml` | 可单独手动定位问题；也由完整发布使用同一提交的本地 reusable workflow 调用。单独绿色不等于完整发布绿色 | 35/35/25分钟；布局、工具回执/截图与三平台ZIP分别保留 |
| `Diagnose module loading` | 仅手动；现有bundled/Chrome与trace开关比较 | job 35分钟；`module-navigation-<run>-<attempt>` |

完整业务回归只在新编译便携候选上运行一次；`playwright.release.config.ts`保留为检查指定已交付目录的独立入口，不再与新候选重复运行相同业务矩阵。备份、KDBX、离线、旧品牌和数据迁移断言均保留。

官网发布会检查 `verify.yml` 的完整手动运行：精确source SHA、工作流路径和所有必需job均须成功，缺失、跳过、取消、同名日常运行均拒绝。原有仅公开文档变更可复用祖先源码检查的白名单保持。普通push/PR不会自动启动完整发布；发布前需从Actions运行完整检查。当前旧AL/route记录与新源码不匹配会严格失败，必须补当前候选的真实记录，不能改旧SHA或将日常绿色当发布许可。

## 本地针对性检查

先按改动运行 `pnpm typecheck`、相关 `pnpm exec vitest run <file>`。需要最终包时，在干净的已提交源码上 `pnpm build:preview`。使用输出的**明确ZIP路径**设置 `KEEPANY_PREVIEW_ARCHIVE`，再运行 `pnpm verify:preview` 或对应Playwright配置。CI的 `select-preview-candidate.mjs` 只选择当前HEAD的干净产物，不选最新文件，也不回退源码。

- `pnpm test:final:workflows`：完整53份业务spec。
- `pnpm test:final:layout`：显式编译候选的账号矩阵及机器证据核对。
- `pnpm test:final:links`：FC24全部14组合；按需配合 `scripts/verify-vault-links-layout-evidence.mjs --create <evidenceDir> <new-record.json>`，不覆盖历史记录。
- `node node_modules/@playwright/test/cli.js test -c playwright.independent-layout.config.ts`：独立账号/最简/分类/busy等现有用例；须显式ZIP，busy每个语言尺寸包含三个消费者（共30状态），social为10组合。记录候选身份共用 `portableCandidate()`。

`--list`仅证明发现清单，未启动服务或执行产品任务。Windows上带 `|` 的 `--grep`请直接调用上面的Node CLI，避免 `pnpm.cmd`再次解释参数。开发源码检查使用 `playwright.config.ts`；`test:functional:layout`允许源码开发检查，不能登记为最终编译包验收。

公共配置在 `browser-config.ts`，编译候选选择、校验、解包在 `../lib/portable-candidate.mjs`。不同平台/场景的配置继续保留，不按文件数量合并。截图基线仅在明确提供人工审过的 `KEEPANY_REVIEWED_BASELINES` 时严格比较；没有该输入时回执记录待人工查看，不声称自动视觉验收。
