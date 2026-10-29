# 最终输入功能验收章程

用户授权范围：KeepAny最新稳定shadcn/Base UI/Tailwind迁移和高密度UI修复。输入941d8c64173a；便携ZIP SHA256 b27c8ae0b44b9e0b88c9e42e1c63c0a0c282bddb41f005421f48db67abfbad4a。浏览器视觉单独记qa-completion-browser，历史报告不冒充最终输入。

采用仓库原生命令，功能Full范围仅本轮UI、邻近保存/取消/验证/回读及便携CLI。通过gstack-qa-evidence记录stdout/stderr/exit，两个探针有限命令超时120000/180000ms；功能面无总计时器，不生成或重置浏览器deadline。所有页面使用隔离Playwright context和合成表单输入；4222静态交付包；4180用户Chrome不做破坏性测试。环境名KEEPANY_E2E_PORT、KEEPANY_EVIDENCE_DIR仅指本机隔离目标与截图目录。

1. CLI合同：node scripts/verify-preview-release.mjs dist/preview/KeepAny-0.1.0-preview.941d8c64173a.dirty-portable.zip。预期exit0、JSON sourceCommit一致、108文件摘要、路由/非法路径/Host/停止授权与跨源拒绝/重复启动/无关占用服务/原生Win32启动关闭全部成功，停止后无私有控制状态残留。脚本维护的临时提取目录自清理。
2. UI功能合同：仓库Playwright CLI使用playwright.windows-qa.config.ts，对collections-ledger-release、task-theme-release、themed-select、shell-reference四套原生规范运行，reporter=json。预期14个成功、0异常/跳过/重试失败。分别覆盖中英文、手机/桌面，分类编辑/保存/取消/成员回读、账单保存/取消/刷新、待办和维护计划状态、统一Select合法/非法/清除/required/键盘/长文本、全局搜索和实际路由/三菜单。

成功由最终业务回读与断言证明，不以启动或200替代。源ui-density回归另有8项，包含有到期提醒的紧凑横条和正常UI改期后无提醒状态的原密度标准；不靠隐藏/删除横条凑首屏。

未改数据协议、RxDB/KDBX职责或同步模型；真实云端/真实供应商/支付、进程断电恢复、跨设备和历史104全量不在本轮声称通过范围。CLI权限边界只按现有本地服务器的既有合同。没有新增远端API/worker/webhook，不虚构并发/重试/恢复语义。源码静态检查、初始单元回归和历史前置测试分别列证。
