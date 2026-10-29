# KeepAny UI统一迁移最终验收

2026-10-28。用户授权统一采用最新稳定版 shadcn + Base UI + Tailwind，并修复已逐张指出的问题、提高全系统信息密度、实际执行 gstack 功能与视觉验收。

本轮修复已完成并启用本机 **http://127.0.0.1:4180/assets**。最终产品输入为 `941d8c64173aea24525fb1d7b1e82246caa7b3b0`。验收中发现的6处追加问题已修复复测，原失败与中间候选没有删除。功能机器结论、浏览器观察和源码回归分别列证，不把历史测试数量相加。

## 实际组件体系

|职责|锁定版本及实现|
|---|---|
|React框架|现有 React / React DOM 19.3.0、TypeScript、Vite|
|shadcn组件源码|CLI 4.23.0，`base-nova`；项目持有并维护生成组件，CLI版本不冒充每个组件的版本|
|统一交互原语|`@base-ui/react` 1.9.0；Button、Dialog、Select、Popover、Menu、Input、useRender|
|CSS体系|Tailwind CSS及Vite插件4.3.3；真实入口、`@theme`、公共控件和设计变量|
|日历|`@daypicker/react` 10.0.2、date-fns 4.4.0，与统一Popover组合|
|其他职责|沿用Lucide、dnd-kit、TanStack Router、RxDB、i18next、独立KDBX；它们不构成另一套基础UI|

这些是本轮2026-10-28核对的稳定版本，已精确锁定。直接Radix依赖和正式应用引用已移除；领域布局CSS保留在对应布局维护位置，不能将这次迁移描述成“没有任何自定义CSS”。按钮、焦点、输入、浮层、菜单的同一职责只有公共入口。普通HTML的复选框、文件选择与文本域保留其正常语义。见[组件架构](../../UI组件架构.md)及[上游提交、文件、许可证和修改说明](../../../legal/third-party/shadcn-ui/SOURCE.json)。

## 用户指出的问题与交付行为

|原问题|修复结果|本轮实际证据|
|---|---|---|
|装饰遮住卡片正文、缺图时保留大封面|删除虚构封面和溢出装饰；有真实图片时标题旁显示缩略图；详情保留原图|[最终卡片](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/qa-completion-browser/screenshots/assets-cards-zh-2220.png)，假封面0|
|卡片拉得过宽、内容少却占大块空间|默认紧凑列表，可切换限宽卡片；图标与标题同排，事实、状态、操作分列；卡片上限360px|1920宽紧凑列表首屏9项；2220宽卡片实测269.28px、首屏21项，详见原生probe026/030|
|没有同时展示资料多与资料少的样例|隔离测试资料同页放完整项目、极简项目、带真实图片的实物、缺日期/金额实物、长标题、订阅、域名，共25资产|[完整与极简并排](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/qa-completion-browser/screenshots/assets-cards-zh-2220.png)、[紧凑列表](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/qa-completion-browser/screenshots/assets-list-zh-1920.png)。没有把合成资料导入用户4180|
|混合卡片边缘和操作不齐|同排卡片拉齐，底部状态/箭头对齐；项目状态使用与实物相同的右列|首排7卡底部同为657.6875；失败截图与红绿日志保留|
|顶部出现多个选中态|按完整路由精确匹配；“全部”不再匹配所有子路由|原生probe030仅“全部”、probe034仅“实物”、probe041仅“费用账本”|
|日期只能点icon、原生日历难用|统一日期输入+Base UI浮层+双语日历；整块点击、手工输入、月份年份、清除/今天、非法值阻止、键盘和焦点返回|[中文日期](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/qa-completion-browser/screenshots/tasks-date-zh-1280.png)、[英文手机日期](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/qa-completion-browser/screenshots/tasks-date-en-390.png)；正常、非法2月30日、清除、保存回读均验|
|待办“全部”位置不合逻辑|统一顺序为“全部→待处理→已完成”|最终probe015为全部6/待处理5/已完成1；无维护计划时列表独占可用列|
|分类下方空白、图标单独占行|左侧入口后12px紧接已有分类；图标、名称、数量、操作同行，右侧编辑器独立|[中文分类](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/qa-completion-browser/screenshots/collections-zh-1280.png)、[英文手机分类](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/qa-completion-browser/screenshots/collections-en-390.png)，8条分类同时检查|
|账本金额、编辑删除按钮不齐且圆角混乱|金额列同一右边界，两个76px宽椭圆按钮；手机高度44px；订阅编辑同一规范|[实际账本操作](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/qa-completion-browser/screenshots/finance-actions-zh-1280.png)，金额右界1068、桌面按钮76×32、radius999|
|个人工作区点了没有用|迁移Base UI真实菜单，连接工作区设置、自定义侧栏和现有收录入口；另两个全局菜单一并迁移|最终原生probe044–048和正式包shell-reference测试；没有同名toast冒充功能|
|侧栏拖动手柄hover溢出|手柄hover/focus/拖动命中区留在导航行内，保持键盘排序和路由行为|[当前hover](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/qa-completion-browser/screenshots/sidebar-hover-zh-2220.png)，4个手柄边界正常；键盘拖动见历史1203检查点及源码相邻回归|
|概览及其他页面继续浪费首屏|页头改成简短任务标题与实际动作；概览最多6张限宽项目、四项近期动作，账号图标/名称同排；提醒条横向紧凑|[有到期提醒的概览](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/qa-completion-browser/screenshots/overview-zh-1280-due.png)、[英文概览](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/qa-completion-browser/screenshots/overview-en-1280.png)、[手机账号](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/qa-completion-browser/screenshots/accounts-en-390.png)|

紧凑列表的单行宽度用于横向扫读事实信息；限宽要求针对卡片。卡片同排为保持边缘和操作一致，极简资料仍可能少于完整资料，但没有额外封面或强制大高度；默认列表提供最高密度。

## 实际gstack功能验收

工具为当前已安装gstack **1.91.268.0**。已读取并采用qa、system-functional、design-review及浏览器证据规范。Ego/Aside在当前Windows环境不可用，按技能后备使用gstack自己的Chromium，未把browser-ready当通过。主控本人操作，未声称独立外部评审；外部Claude评审配置为disabled。

最终功能通过原生`gstack-qa-evidence`捕获，物化报告[机器判定pass](evidence/ui-migration/qa-completion-functional/evidence.json)。两个命令均有stdout/stderr、退出码、合同和回执；第二探针操作前的[检查点002](evidence/ui-migration/qa-completion-functional/exploration-002.json)已发布。

|合同|当前941d实际结果|
|---|---|
|最终便携ZIP验证|exit0；108个Web文件逐摘要一致；源码、许可证、路由、非法路径/Host拒绝、重复启动、停止授权/跨源拒绝、伪造PID、无关占用服务保留、Windows独立启动停止均成功，15.176秒|
|正式包真实表单/UI功能|`collections-ledger-release`、`task-theme-release`、`themed-select`、`shell-reference`四套规范，**14通过、0失败、0跳过、0flaky**，86.357秒|

14项包含中英文、手机/桌面，分类编辑/保存/取消/成员刷新回读、账单保存/取消/刷新、待办/维护计划、Select必填/合法/非法/清除/键盘/长文本、全局搜索和三个实际菜单。测试运行于正式编译包，不从页面导入源码或直接写用户数据库。命令、用例和每个最终断言见[完整功能回执索引](evidence/ui-migration/qa-completion-functional/README.md)。

浏览器报告是另一条证据链：[最终原生浏览器67条命令](evidence/ui-migration/qa-completion-browser/README.md)。其功能`evidence`数组特意为空，因此该目录materializer返回 **inconclusive / no evidence rows**；这不是功能通过，也不是页面失败。功能机器pass来自上表独立功能报告；视觉结论来自实际截图、页面操作和几何观察。没有把两个容器合并成虚构的“gstack全项机器通过”。

## 实际视觉与关键交互验收

最终941d原生浏览器单次900秒预算为02:17:00.096Z–02:32:00.096Z，67探针于02:23:15前完成，期间没有重置预算。先通过正常备份恢复UI恢复38条合成记录，检查当天到期提醒，再通过正常UI改期和刷新验证提醒消失；原37条无到期输入与新输入分名保存，未覆盖。每张用于结论的截图都实际打开检查。

- 中英文，390/768/1280/1920断点由当前源码8项回归覆盖；当前正式包原生浏览器另查2220宽屏、手机日期/分类/账号、768资产列表、1280概览/待办/分类/账本。
- 1280概览页头82.6875px，6张项目卡各251.25px，6个图标标题同排；有提醒时提醒横条44px，改期后消失并保持任务新日期。
- 1920资产列表可用宽1749、scrollWidth1749，无横向溢出；首屏9项。2220卡片269.28宽、首屏21项、首排底部一致；顶部只有一个选中项。
- 手机日历日期格和前后月均44×44；浮层x13/y356/w346/h373，右边359、底边729，位于390视口内。手机分类更多触发与编辑/删除项44px，未挤出屏幕。
- 账本金额和操作同列，分类紧接入口，侧栏hover未溢出；真实工作区菜单可导航到设置并切换英语。
- 当前浏览器控制台范围内error **0**；11条既有RxDB Dexie premium提示为warning，原日志含更早浏览器历史，未删去后冒充全程无警告。见[统计](evidence/ui-migration/checks/console-summary.json)及原始probe062。

按design-review十维人工检查，本轮限定合同的Design Score **A**、AI Slop Score **A**，是修复后的主观等级，不是性能/可访问性认证，不以评分替代上述证据。未建立旧输入可比等级，因此不虚构分数提升。层级、排版、布局、颜色、交互态、响应式、核心文案、空装饰、动效克制和操作响应均在本轮页面观察；没有新增装饰动画或任务阻挡层。性能仅记录本轮操作的可感知响应，未运行benchmark或Web Vitals。静态设计detector未执行，记为off，不能报告“0违规”。完整分项、修复提交与前后图见[视觉评审](UI视觉验收.md)。

## 发现后实际修复的6处问题

|发现及有效失败|根因与修复提交|最终复核|
|---|---|---|
|项目状态落在中部而实物在最右|项目CSS网格与公共布局不一致，`dbee5d3af305`|统一右列，当前列表实测|
|无维护计划仍保留空右列，浪费约38%宽|两列布局无条件启用，`03c676734e3e`|无计划时单列1041px，原计划详情仍可用|
|同排卡片因资料量不同底部差约100px|容器不拉齐且footer跟随正文，`120373026486`|当前首排7个底部同值|
|手机日期格34、箭头28，分类触发36|移动尺寸缺少统一触控规则，`8457271ded6a`|当前日期/箭头/分类触发44|
|概览169px宣传页头、514.5px卡片一行仅2张|概览未纳入密度体系，`98da5cae494c`|页头约83px、最多6张限宽卡片，标题同行|
|用户原4180实际到期提醒横条94.8px|`.card.padded`优先级与提醒纵向布局，`941d8c64173a`|当前原资料44px，未隐藏提醒；UI正常改期后才消失|

[红绿日志和失败截图](evidence/ui-migration/README.md)保留。提醒第一次“绿测”仍因新增有提醒状态触发原无提醒首屏门槛失败，该失败也保留；最终先验提醒、再真实UI改期，继续执行原无提醒**至少6项首屏**标准，没有下调门槛或删除横条。

## 源码与构建检查的准确边界

- 当前最终源码：类型检查exit0、lint检查320文件exit0；密度回归 **8/8，56.2秒**，zh-CN/en×390/768/1280/1920，有/无提醒、列表/卡片、日期、菜单、分类、账本、保存/刷新。
- 首次统一组件输入曾跑源码 **28/28**、相关单元 **6/6**。这两组发生在后续6次补修前，属于相邻回归历史，未称最终941d全套又跑28或全部单元。日志分别标注输入边界。
- 当前编译包功能14项与CLI验证见上，构建及许可证快照已完成；保留构建器的大于500kB chunk提示，未把构建成功当作性能基准。类型、lint、构建日志见[检查索引](evidence/ui-migration/checks/current-checks.json)。

没有声称重新跑完历史104项、真实云端/模型供应商/支付、物理手机或断电恢复。密码库未作为这次真实用户数据复测的对象，未读取用户主密码、密码值或改动已有库；初始导航相邻回归与本次数据检查分别保留。

## 本机4180交付与清理

最终包：`dist/preview/KeepAny-0.1.0-preview.941d8c64173a.dirty-portable.zip`。

SHA256：`b27c8ae0b44b9e0b88c9e42e1c63c0a0c282bddb41f005421f48db67abfbad4a`。

包内108个Web文件、454份源码、109个分发许可证记录；sourceDirty为true，反映打包时保留的未跟踪草图/历史用户产物，不是公开发行。当前产品代码已提交。4180现由本包运行，PID26268；实际HTTP108文件逐摘要一致，Chrome脚本`/assets/index-aRDqBjxo.js`一致，见[本机身份](evidence/ui-migration/checks/local-4180-identity.json)。

用户Chrome通过正式“更新应用”按钮启用新版，没有清站点或导入测试备份。原10项资产与费用汇总¥9,087/¥407/¥127/2一致；最终提醒44px、假封面0、只有“全部”选中。见[实际浏览器状态](evidence/ui-migration/checks/local-browser-receipt.json)和[最终原资料截图](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/checks/local-4180-assets-final.png)。另一张local-4180-assets.png为发现提醒问题时的中间版本，不充当最终图。保留原有页签及一个普通验收页，无群组。

本轮自建4215–4222测试服务及gstack浏览器/保活进程已结束，4180保留；预先存在的10张历史未跟踪图和output/未动。测试自动生成的16张合成图移至忽略的test-results目录，未混入原历史资料。加密合成备份及浏览器控制状态不进入公开证据。产品及报告按可回滚范围提交到`codex/asset-card-layout-20261028`；最终fetch/push回读见[交付回读](交付回读.md)。未合并main、更新官网/公开Release或替换release/web。
