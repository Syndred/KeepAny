# iOS 20ffd：Core 实际通过，UI 三项仍失败

2026-10-28。源 `20ffd3f93c4c4b72d46f8f9517e168382bf8acb4`，实际 [Apple run40578765049](https://github.com/Syndred/KeepAny/actions/runs/40578765049)、job122452204501 自然结束为 failure；未人工取消。App 编译和编译缓存保存成功。以下来自校验后的原始附件，不以步骤状态推测功能结果。

## 完成与验证证据

SwiftPM 实际执行 **29 项、0 失败、0 跳过，36.366 秒**：原 Preparation 7 项、Transport 10 项保留；新增 NodeInterop 1 项、父端进程收尾 3 项和严格会话叶验证 8 项均实际执行。

- 正式 Node `createMobileTlsFetch` 与真实 Swift 会话身份完成一次严格 TLS 请求/响应；错误 CA、SPKI、IP 被拒绝，错误 IP 的独立严格 TLS 要求到达精确 SAN 错误，而非链验证提前失败或普通 reset。不是页面桥模拟。
- 原 Transport 的真实 30 秒总截止用例实际 30.076 秒，四并发、取消、重启、HTTP/桥/响应预算等原断言保留。
- 测试客户端只接受指定会话的精确单叶、元组/SPKI、自签、时间、服务端用途及签名用法；真实 Security 验证和 NIO 的实际 IP 验证仍执行。空链、额外链、其他叶、错误 SPKI、自签损坏、错误用途、过期/未来等阴性均执行。
- 父端真实子进程 EOF/退出码、双管道限额和忽略 TERM 后的截止/KILL 收尾均通过。日志里的阴性证书错误是预期测试过程，不能数成 case 失败。

此结果关闭本轮测试客户端接线下的原 Core 红测；生产证书、CA:false、KeyUsage、SAN、授权及产品期限未因测试客户端调整而改变。它不证明物理局域网、iPhone 配对或完整原生 UI 链已通过。

## UI 逐操作实际结果

8 项实际执行、5 通过、3 失败、0 unexpected，430.233 秒。

| 操作 | 预期 | 实际 | 判定与边界 |
|---|---|---|---|
| 中文/英文待办点日期 | 打开真实系统 DatePicker | 两语均打开，52.989/20.516 秒 | 本模拟器该入口通过；不扩大到选值/旋转矩阵 |
| 中文五栏导航 | 真实路由与语言正确 | 42.300 秒通过 | 不代表全部工具 |
| 英文最小项目新增→结束→重开→滚动开详情 | 项目仍可达 | 60.300 秒通过 | 非完整字段或排除双写证明 |
| 普通待办双语校验/冷启/完成/删除取消 | 原业务断言通过 | 130.933 秒通过 | 保留原范围 |
| 中文/英文全字段项目选择非默认分类 | 分类控件可操作，再核全字段/取消/改名冷启 | Continue 后控件查询失败，34.866/23.680 秒；尚未执行完整保存 | 两项失败，后续字段与 SQLite 不认绿 |
| 英文 MCP 准备/停止 | 先正式保存隔离项目，再选择只读范围并准备/停止 | 名称已完整输入；在保存前的可达性 helper 失败，64.649 秒 | 未到 Prepare，不宣称原生权限/准备/停止通过 |

只读观察器记录 744 次 poll、312 次成功查询、427 次 database-missing、5 次 query-timeout、0 marker，正常停止并报 observation-error。UI 在保存前失败已足以解释未获得目标 marker；本轮不能据此判定资料持久化错误。当前观察器冻结容器路径、累积错误永久污染结论的风险另修，不声称已经证明容器更换是本轮根因。

## 主控实际定位与后续窄修

已阅读两语原生 AX、原始失败日志并目检原图：

1. 分类的真实语义控件是 `Other label=分类/Category value=网站/Websites`，不同于无 value 的包装 Other。其 AX frame 错报为 `{0,-50,511,383}`；关联的可见 StaticText 标签 frame 正常。旧 helper 仅查询 comboBox/popUpButton/button，因而漏选实际控件。
2. 英文保存失败图无键盘，Save 真正位于 `{309,732,62,45}`，包含在实际 dialog `{16,100,370,702}` 内。旧 helper 用缓存底栏和 hittable 的组合条件拒绝了可见按钮；日志没分开记录两道门，不能断言唯一是哪一道造成失败。

后续仅改 XCUITest 操作层：读取带 value 的真实分类语义，原生触摸关联标签后等待实际可点选项；按当前 dialog 与 WebView 交集判断弹窗可视区，页面仍按实际底栏判定，正文还避开粘性页脚与键盘。仅对确属当前 dialog、完整可见且 enabled 的保存/取消按钮允许有界原生坐标点击；不对隐藏正文/错误 Other frame 强点。失败追加原始几何附件，后续业务断言仍须证明点击效果。

Windows 本地使用实际 Chromium、WebKit，各两语 touch context，正式现有分类标签触摸→真实选项→选择 repository→取消，共 4 条通过；没有 DOM/CSS 注入或产品改动。`test-results/inspect-category-accessible-name.mjs` 与每语每引擎 JSON 保留，所有自建 context/browser/4239 已关闭。这是浏览器前置，不冒称 XCUITest 或新 Swift 已编译。

原 5 个 UI 实现所在前缀及全部 8 个 test 名称程序比对不变；全字段、同 ID、取消、改名、原生 SQLite 核对合同未删改。窄修后的 Apple 实跑仍待，不能倒灌本轮失败为通过。

## 附件身份

artifact12769464188，ZIP 125599177 字节，严格 HTTPS 下载；SHA256 `d345381a93d5990483feba858695bfced9eea3313b9c8eefa49f8078771a19f0` 与 GitHub 摘要一致，校验解压路径后取得 1671 项/159107382 字节。job 日志连接器曾失败一次，未以重试代替原件核对。

原件位于本机 `C:/Users/Administrator/.codex/toolchains/keepany-mobile/evidence/ios-ci-20ffd3f9/contents/`：

| 文件 | SHA256 |
|---|---|
| mcp-transport-tests.log | d173dc66de7e2479f9bfcbe6fba15040a1c23fd76e66bc7d30f5391ce484456e |
| mcp-stage-events.ndjson | 09c3aa64fb7429155675ffe89957c44db604093005c174b10396e9af33ff40e5 |
| ui-tests.log | 0f4a9e2d730a52594179c144e251fa80b9ba550eb6e6e9dd3a1260524622dcb3 |
| project-fixture-observer/summary.json | 806abe994de42ade325e6d85f3e661da1edc06d07429cac89523d7e4c5298efd |
| 中文分类 AX 03817794…txt | 54205768ef3d14a50dcf0aca3db5ba3a574423fc8cdc91542bbcc487479294d4 |
| 英文分类 AX 0B3AB7AF…txt | 5fcf234eb45abc33b79886531a4a78b8e8280f31d642d084fc27b32d341f1f33 |
| 英文保存 AX 44561DEA…txt | 2ee57e1c15e4b5cf5dc1d789b95097503bad13931058d51b7d3785157dde6dbf |
| 中文分类原图 827C4538…png | be55ad0256f6cefb7d388028fc317c0cf7554ed6e63d100f065e043e12f978c3 |
| 英文保存原图 D5963BF8…png | a2a32ac5d42f5eb86e69586e088b2dce98999a9cf98f6f8588d439e99a3e9377 |

## 未完成、下步与提交部署

继续 Apple 全字段/同 ID 观察及 MCP 真 UI 准备停止；23 组未验分支、原生密码/备份/真实网络与物理设备不因 Core 绿而核销。Android 的本轮项目搜索缺口另由真实 70 条资料双语复现并修复。便携三 OS 包校验虽已绿，完整功能作业仍有实际失败，独立跟进。

仅 `codex/mobile-app` 分片提交，统一推送后再触发下一 Apple；未合 main、修改用户 4180/4196、发商店、公开 Release 或生产。开工 fetch 成功，主线缺失 0；历史失败附件与原合同均保留。
