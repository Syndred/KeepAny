# 手机草图索引

## 设计方向

沿用现有暖黄、米白、深蓝描边与轻量硬阴影，不引入另一套品牌。手机优先保证查找、维护待办、密码库独立入口和备份恢复可读。桌面布局继续保留。本轮使用已有方向直接出稿，采用 gsd-sketch 的 quick 路径；用户已要求先交付草图，布局选择留在实物预览之后。

## 参考来源

- 基线 `65636db` 的 `apps/web/src/styles.css` 与现有 React 组件。
- 仓库合成截图 `docs/evidence/2026-10-27/keepany-return/onboarding/onboarding-zh-390-sample.png`。
- 数据字段及恢复状态来自当前本地仓库和备份合同。

## 草图

| # | 名称 | 设计问题 | 方案 | 用户选择 | 标签 |
|---|---|---|---|---|---|
| 001 | 手机日常使用 | 打开先看维护事项，还是先搜索资料？ | A概览优先／B资料优先；建议A | 待确认 | mobile, navigation, accounts, vault |
| 002 | 手机迁入与备份 | 首次恢复的来源、范围和目标如何排布？ | A全页核对／B紧凑核对；建议A | 待确认 | mobile, backup, restore, failure |

未选定 winner，不把推荐当作用户确认。两组 HTML 共享静态 CSS／JS，便于同一演示规则与双语文案复用；无需构建、无需安装依赖。它们是可丢弃的设计稿，不进入正式应用。

迁移合同见 `docs/mobile/Capacitor-SQLite迁移方案-20261027.md`。本轮浏览器证据见 `docs/evidence/2026-10-27/mobile-sqlite-design/`。
