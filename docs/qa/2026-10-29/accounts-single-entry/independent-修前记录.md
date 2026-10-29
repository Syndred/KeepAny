# 独立修前复现

2026-10-29。非实现者执行，使用全新隔离 Chromium context 和虚构主密码。仅针对源码服务器 `http://127.0.0.1:4397/accounts`；不是最终编译包验收。

候选 HEAD：`2c5c7405684cd65b690d4da20a6f53f78bbd39f5`。实际3个产品文件SHA256写入 [原始结果](independent-before/result.json)。截图在主控产品改动前生成，之后未覆盖。

|合同ID|实际UI操作与观察|判定|证据|
|---|---|---|---|
|SE01|空工作区建立本机密码库后，账号标题旁「新增」与工具栏黄色「+ 新建条目」同时出现，合计2个全局新增|失败|[重复入口](independent-before/two-global-adds.png)|
|SE03|点标题新增，看到普通「新增记录」表单，分类/服务商/账号/用途/状态/日期/标签/备注齐全，缺密码|失败|[普通账号表单](independent-before/ordinary-account-form.png)|
|SE03|关闭，再点黄色新建条目，看到名称/用户名/可选密码/备注/关联资产；分类、服务商、联系方式、用途、状态、核实日期、标签均缺失|失败|[密码表单](independent-before/password-form-missing-account-fields.png)|
|SE07|顶部密码回收站按钮与下方可见区域重复；本次点击导航为 `/assets/vault#vault-trash`|失败（重复入口）|原始JSON与重复入口截图；本次不声称所有点击都无响应|

上述3张PNG均已通过 `view_image` 实际打开，视觉确认两个全局新增及两张字段不同的表单。页面无 `pageerror`。未读取用户实际资料、密码或4180环境。

准备阶段第一次 Node 脚本导入 `playwright` 包失败（pnpm未提供此顶层导入）；改为项目已有的 `@playwright/test` 后，脚本完整执行。该准备错误不是产品失败，不混入上表。

后续测试脚本及最终候选独立复核未完成；本记录不能代替主控本人最终包体验。
