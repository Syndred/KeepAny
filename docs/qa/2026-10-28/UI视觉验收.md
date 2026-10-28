# UI视觉验收：最终941d

2026-10-28，gstack design-review，主控本人。本轮页面为概览、资产列表/卡片、实物、待办、分类、账本、账号、工作区设置及备份收录入口。固定输入941d，gstack自有Chromium；实际[67探针和逐操作检查点](evidence/ui-migration/qa-completion-browser/README.md)。每张采用的截图已打开检查，不从DOM数字推断全部视觉质量。

**Design Score：A（本轮限定合同的主观等级）；AI Slop Score：A（没有大占位封面、假预览或宣传块）。** 旧版未按同一十维评级，baseline为未评级，不编造等级差值。评分从各类A起，已发现的High/Medium在最终输入均关闭；等级不代替真实图、操作与尺寸。人工可感知响应不等于benchmark，颜色检查不等于完整WCAG审计。

|维度/权重|当前等级|实际观察|
|---|---|---|
|视觉层级15%|A|资产标题、事实、状态与操作分列，概览核心操作同排，日期错误靠近输入|
|排版15%|A|图标与标题同行，长标题换行，金额数字对齐；中英文均可读|
|间距布局15%|A|卡片上限360、最终宽269.28、同排底部一致；分类紧接12px；无计划无空列|
|颜色对比10%|A|沿用深蓝/纸面/黄色主题；唯一选中态；红色续期状态与普通事实区分|
|交互状态10%|A|hover留在导航内，日期非法态/清空/关闭焦点，菜单真实导航；手机44px目标|
|响应式10%|A|双语四断点源码回归；正式包额外2220宽屏，390日历和分类菜单在屏内|
|核心文案10%|A|概览去宣传大段，缺资料表达缺失事实，未向UI输出框架/实现说明|
|AI Slop5%|A|移除假浏览器封面和遮挡装饰，实际缩略图只用于真实图片，无新装饰卡片占位|
|动效5%|A|本轮页面以直接状态切换为主，没有遮挡任务的装饰动画；未做真机运动敏感性专项|
|响应感5%|A|本轮菜单、日期、页面切换正常响应、保存后有实际回读；未计Web Vitals或性能基准|

Goodwill为启发式记录：70起，紧凑列表清楚展示期限/费用/状态+10，默认列表和实际菜单少步骤+5，日期非法输入可清除恢复+10，本轮限定流程最终95/100。此分数不是用户调研结果，不能证明全系统都令人满意。

## 发现、修复与重验

6项发现均verified；best-effort/reverted/deferred均0。原问题、红测日志及截图见[总报告对应表](UI统一迁移最终验收.md)。

|发现|提交/涉及文件|前后证据|
|---|---|---|
|项目状态列位置不同|dbee5d3af305，`asset-restoration.css`、`asset-views.css`、`page-asset-list.tsx`及密度回归|failures/status-red；当前资产列表图|
|无计划仍保留右空列|03c676734e3e，待办布局与密度回归|failures/empty-plan-red；最终probe015|
|同排卡片底部不齐|120373026486，公共资产视图/卡片样式及密度回归|failures/card-align-red；当前2220卡片图/probe030|
|手机日历和分类目标不足44|8457271ded6a，日期/分类/触控样式与回归|failures/mobile-target-red；手机日期/分类图/probe054/058|
|概览页头与卡片占位大|98da5cae494c，WorkspaceOverview/AccountCard和公共样式|failures/overview-density-red；中英概览图/probe010|
|真实到期提醒占94.8px|941d8c64173a，AppShell提醒样式、合成资料与回归|checks/local-4180-assets.png→local-4180-assets-final.png；当前44px|

最新源码8/8密度回归和正式包14/14功能回归分开记录，见[总报告](UI统一迁移最终验收.md)。当前页内功能错误0，RxDB既有premium warning保留。静态设计detector：off，未运行，不报告虚构的违规数量变化。外部评审：disabled，没有独立外部结论。没有全历史104条、真实服务或真机全验声明。

本浏览器目录的machine evidence数组为空，物化判定inconclusive；纯视觉观察不会自动变成机器功能pass。机器功能pass来自[单独最终功能容器](evidence/ui-migration/qa-completion-functional/evidence.json)。

可用于变更说明的一句话：本轮实际设计复查发现6项问题，6项修复并复测；最终限定合同Design A、AI Slop A，旧输入未评级，未计算虚构改善分数。
