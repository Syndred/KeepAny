# 独立源码诊断（不是最终包验收）

2026-10-29。使用隔离虚构资料、source地址4397、单worker、重试0。产品在同会话继续修正，因此这些结果不声称最终消费候选的一致性或完整验收。后续必须使用冻结编译包重放。

## 新流程首轮

- 原始6例：5通过，英语矩阵1失败。原报告、截图、trace原样保留于 `test-results/accounts-single-entry/independent-source-results` 及同级JSON。
- 英语矩阵的断言误按DOM顺序将expanded/compact反向赋值。已实际打开原失败截图：长账号在右侧展开，左侧邻账号保持约195px紧凑，截图未显示邻卡拉高。修正为按已定位的两个账号分别读取几何，保留原严格几何断言。
- 修正后仅重放该英语矩阵：1通过、12.0秒。原5通过与本次1通过是两次源码诊断事实，不能改写首轮为6/6，更不能代作最终包视觉通过。

## 相邻准备适配

- `password-history-version`首次使用“新建→解除关联”准备独立条目，解除关联本身真实新增一条历史，导致原“初始历史为空”失败。失败原件保留于 `test-results/accounts-single-entry/independent-source-history-results`。
- 该场景本来不要求standalone；改为唯一新增后保留自动账号关联。原空历史、各版本数量/顺序、精确恢复、未选条目不变、导出/刷新全部断言保留。
- 后续单worker4例真实源码执行通过：`account-shared-identity` zh-CN1536、`account-unlink-focus` zh-CN1280、`password-history-version` zh-CN1280、`vault-dual-login` zh-CN1536；2.1分钟。输出保留于 `test-results/accounts-single-entry/independent-source-adjacent-results`，功能图保留于同级 `independent-source-adjacent`。
- 4类账号审核发布/族谱/回执及导入夹具，按主控确认改用Node真实VaultSession生成虚构KDBX→真实文件选择器导入准备纯密码库；普通账号href严格不变。此准备不冒充用户手工全局新增。

## 保留与后续

完整source浏览器附件及截图从docs移入test-results，迁移映射的from/to和原件SHA256见 `independent-source-迁移映射.json` 与 `independent-adjacent-迁移映射.json`。迁移未改写原始失败报告；测试报告内旧路径由映射对应实际位置。

静态适配和测试收集已完成；源代码审查尚未发现确认的秘密泄露/稳定ID重试缺陷。实际最终编译候选的独立用户路径、66张截图逐图视觉检查、3个旧核心流程及关键相邻流程仍待执行。主控本人体验由主控独立负责，不能由本报告代填。
