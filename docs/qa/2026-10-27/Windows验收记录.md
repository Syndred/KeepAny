> **最终更新（2026-10-27）**：原104条全部闭环，998/998单测、188套件、0失败/跳过。首候选32实际场景全过，最终重打包运行文件全相同并复验受影响生产2/源码6及Windows启动器。详见[最终闭环验收记录](最终闭环验收记录.md)；以下95/104及更早数字仅为历史快照，不需从头重新派工。

# Windows 第二轮验收记录

2026-10-27。已按用户要求在Windows安装并实际使用GSD Core1.19.0、gstack1.91.268.0，继续同一份总表。每次先核对status/remote、fetch并fast-forward确认；origin/main仍为f659db1，本轮在其后的本地提交上完成。工具身份、配置备份与范围见[安装回执](测试工具-Windows安装.md)。

## 当前结论

**104条已全部执行：95通过，9项功能缺口待继续，0阻塞、0条件未具备、0未执行。整个项目仍未全部验收通过。** 子代理完成执行和回执不等于每条需求已经实现。

剩余编号：T14-01～04（项目/实物记账、既有账单编辑/删除、多资产归属）、T16-03（既有待办名称编辑及日期筛选）、T18-01/02（CSV原始全文、网页元数据）、T19-01/04（普通候选逐字段合并、单条外链删除）。[T14第二轮](scopes/T14-round2.md)用GSD goal-backward与实际中英UI再核对，2条新增行为测试通过，原四条要求仍全部为部分；没有删除要求或用旁路冒充通过。

## 完成、修复与证据

- **独立PG补齐**：[T24第二轮](scopes/T24-round2.md)安装官方来源PostgreSQL17.11到用户工具目录，7/7单测、3/3自托管浏览器、原官方绑定完整流程1/1通过。原KeepAnyAdm同级独立仓库固定7589b6d完整SHA及原锁，商业路由/合同未改；仅一次性测试启动配置适配Windows，真实DPoP、令牌刷新、撤销、密文图片和ka1恢复均执行，没有复制商业业务进核心。
- **Windows MCP闭环**：[T23第二轮](scopes/T23-round2.md)新增系统PowerShell/.NET固定Win32原语后端，检查同句柄SID/DACL/FileID、父链/reparse/hardlink/ADS，原子私密创建和真实句柄替换；配对秘密拒绝共享写并由DELETE_ON_CLOSE清理。范围、秘密排除、审批/回执协议和POSIX分支保留。独立[GSD复核](scopes/T23-independent-review.md)实证发现的超8MiB写后自锁、tmp路径替换及tmp内容改写三项均修复并独立复验；最终生产便携Web＋bundled官方SDK矩阵16/16过，本包22单测过。
- **文档语言修复**：[gstack补充复核](scopes/gstack-round2.md)真实发现html缺lang；9df5764同步初始化/切换语言的文档声明。先红后绿，源码中英2/2、真实便携中英2/2，覆盖切换、刷新和密码页hash导航；相关9单测过。gstack自有materializer的浏览器模式裁决仍为inconclusive，未冒称它提供全项目自动认证。
- **最终全仓**：独立PG环境下952/952单测，180 suites全部通过，0失败/跳过、exit0，128秒。全仓类型检查、35个改动文件lint零警告/错误。初轮951中一条ACL清理夹具失败，随后952行为全过但误收5份test-results中的Playwright副本；两次非绿均保留，修复仅排除生成test-results目录，正式952条未减少。最终[小回执](evidence/integration-round2/checks.json)含三次结果、产品哈希和包身份。

## 最终便携候选与边界

最终本机候选为`dist/preview/KeepAny-0.1.0-preview.d9db69ed54cd.dirty-portable.zip`，4,813,121字节（约4.59MiB），SHA256 `1b8de82cb9ce8dab9403257d4184cbe2ce71822cd780be8ae822dc0f5ad1ae76`。产品源码提交d9db69e；dirty仅表示打包时尚有本轮交接文档待提交，产品差异已核对为空。102个Web文件与实际通过生产浏览器矩阵的9df5764候选逐文件SHA完全一致；最终MCP bundle SHA为`01f98849e55e3743a64b7364d4679fec6d023a1a1bddda95da13adf5d75d4c37`。

最终ZIP、逐文件校验、完整源码/许可、离仓解压、真实Windows启动停止、Host/路径/状态及停止安全再次验证通过。没有声称Windows断电强持久性、macOS/Linux本轮运行、物理双设备、Ego、真实第三方供应商或线上付费账户通过。

## 清理、提交与部署

本轮GSD/gstack/Bun/PG只在用户工具目录，不进入Git。gstack自建浏览器已停止；4207/4208/4209/4210/4211及PG61090无监听。PG全部keepany测试schema回读0、精确cluster正常停止，私密连接文件已删除；商业合成账户/私钥/SQLite/快照已清理，用户4180和原浏览器未动。

自动审批拒绝了早期合成ACL夹具、空PG/商业临时目录及两份旧便携候选的清理，均返回blocked by policy而无详细原因；已记录并保留，未拆命令或换工具重试删除。最终候选保留，旧02a4622/9df5764候选也因该拒绝仍存在；不把它们误称为最终交付。

本轮本地提交：9df5764文档语言、e4fc05c独立PG/绑定测试、8114afa记账缺口复核、75698c5生成夹具隔离与测试类型、d9db69e Windows MCP，最终总表/工具/交接另提交。**尚未推送、未部署，release/web、官网、公开Release和用户4180均未更新。** 后续按原总表明确并实现9条缺失能力，涉及新界面按AGENTS先草图确认后再实现、逐项复验。

# Windows 首轮验收记录（88/104，历史快照）

2026-10-27。用户要求继续验收并解释四百多MB下载。会话开始检查干净main、origin，fetch后fast-forward确认f659db1为最新远端；没有重建仓库、改历史或替换数据。

## 完成

[104项总表](测试总表.md)全部已有结果：**88通过、9部分验证待继续、4阻塞、3条件未具备，0未执行**。这不是104全通过。前轮14条已整合结果保留，本轮补齐T25与其余包，并对原导航/汇总/账号作中英1280六项Windows抽样。按每次一个小包、最多三执行代理，独立浏览器上下文与文件所有权推进；全部合成资料，未触及用户4180或真实账号/秘密。

四处产品问题均有真实红测、最小修复、原步骤复测及独立复核：

|问题|修复|提交|
|---|---|---|
|密码/外部引用二级标签同时高亮|Router当前标签判断包含hash|c20f4f6|
|资产汇总项目预览越界60px盖住描述|内部预览随封面减已有30px标题条|79f5830|
|待办详情返回丢状态筛选|会话内只持久all/pending/done三值偏好|659e29e|
|损坏图片仍新增资产与blob|两条图片收录写入前本机decode，失败无副作用且保留输入|02a4622|

另修Windows包验证子进程继承PowerShell7模块路径导致Windows PowerShell5无法加载Expand-Archive；仅对子进程整理环境，不改系统配置。旧测试的侧栏文案、Vite /@fs盘符/分隔符、MCP Node启动方式等夹具适配单列，不当作产品修复；密码网格密度断言扣除合并后新增导航行，仍检查字段/列数/末行可达，不删行为断言。

产品继续复用React、RxDB和独立KDBX，没有新增依赖、第二资产源，未改变完整schema、存储键、记录ID、品牌兼容入口、备份及同步/MCP协议。

## 未完成与阻塞

|原总表|当前事实与后续|
|---|---|
|T14-01～04|账本只接受账号/订阅，不具备项目/实物目标、既有账单编辑/删除及一笔多资产关联。已验精确金额/币种/记录/关系/恢复，不冒称这些缺失入口通过。|
|T16-03|返回筛选已修；日期过滤与既有待办名称编辑取消/保存入口不存在。|
|T18-01/02|普通CSV未存原始全文；普通网址入口只解析URL，不抓网页元数据。原文与选择性审核等现有范围逐项记录。|
|T19-01/04|普通候选没有逐字段合并入口，单条外链没有独立删除；实际本机整记录迁移合并/撤销、收据门槛等已验。|
|T23-01～04|Windows MCP私有目录/权限/no-follow文件安全检查不兼容。不能放宽安全验证冒充支持；需Windows ACL及文件身份安全方案后重验。|
|T24-01～03|没有独立PG、Docker或测试数据库配置，无法完整验会话双用户/DPoP绑定/图片与丢应答冲突。T24-04是真实本机Hono HTTP＋嵌入PGlite密钥流程，不能代替独立PG或物理双设备。|

9项能力缺口保留原要求，没有为“全绿”删除要求，也未擅自新增财务、抓站、原文存储或新编辑交互。下一轮先判定哪些是测试规划误写、哪些确需扩建，再按项目要求单独设计/实现；MCP与PG前置分别处理。真实手机、Ego和真实供应商/生产云仍未验。Windows未发现可用Ego或gstack-qa；本轮明确使用项目现有Playwright隔离Chromium。

## 验证证据

- 每包实际步骤与首次失败在[scopes](scopes/)，截图只保留中英代表，完整JSON/下载/临时媒体在忽略的test-results。普通测试次数有重叠，不能相加冒充104条。
- 主控独立复核：原T01/T02/T03中英1280六项；T04/T10/T25英文1280四项；T08/T11/T15/T16英文1280六项；待办筛选改动后普通搜索中英1280两项。另独立执行代理在未修改行为断言的副本上复跑T12/T17/T18/T19/T21英文1280各一项5/5。见[integration-windows](evidence/integration-windows/)。
- 最终类型检查、改动38文件lint、Git diff检查通过，应用/便携构建通过；构建原有crypto外置、大chunk提示保留。正式playwright.windows-qa.config.ts在关闭手动4205后自行启动/停止源码服务，四处修复代表路径再7/7通过40.6秒。
- **全仓单测不全绿**：937项，924通过、7失败、6个真实PG条件跳过。密码库5秒超时的原断言单独2/2通过；仍有6个Windows MCP安全兼容失败。没有跳过、删除或放宽这些失败。详见[精简机器回执](evidence/integration-windows/checks.json)。
- 隔离固定便携包：离线/合并入口/KDBX与备份7项、关闭旧PWA升级1项、打开旧标签保存草稿后更新1项、真实QuotaExceededError失败/同草稿恢复2项，共11个不同浏览器场景全部通过；实际Windows启动器与端口/路径/Host/停止安全验证通过。详见[T26](scopes/T26.md)。
- S3/WebDAV使用真实本机TLSv1.3 HTTPS随机服务及只限测试目标的CONNECT隧道，4场景验鉴权、持续断连、篡改、读回门槛和实际KA1干净恢复。没有route.fulfill模拟服务器结果，未改变系统代理/信任；不代表真实供应商兼容认证。详见[T22](scopes/T22.md)。

## 体积解释

克隆前基线的Git pack **405.16MiB**，PNG对象 **367.08MiB（90.6%）**。当前基线检出728.80MiB，其中历史验收证据444.85MiB、release/web268.08MiB；后者有2590个旧兼容资源261.02MiB，当前102文件仅7.06MiB。apps＋packages源码3.21MiB。没有node_modules时Git下载就这么大，原因是截图和旧构建进了仓库。

本轮隔离便携包约4.58MiB，仅102个当前Web文件；未把新构建加入release/web。仅删除当前截图或加.gitignore不会缩小既有Git历史；后续证据附件化、构建与源码分离、支持期和历史迁移须保持引用及旧标签兼容。此次没有删历史、重写Git或破坏旧资源。完整明细见[仓库体积核查](repository-size-audit.md)。

## 复跑与交付状态

源码验收正式入口：

```powershell
npm exec --yes --package=pnpm@11.10.0 -- pnpm install --frozen-lockfile
node node_modules/@playwright/test/cli.js install chromium
node node_modules/@playwright/test/cli.js test -c playwright.windows-qa.config.ts tests/e2e/qa-t25-windows.spec.ts --workers=1
```

本机原pnpm.exe shim返回CommandNotFound，使用指定版本npm exec完成锁文件安装，没有升级项目依赖或修全局NVM。各包中`test-results/qa-windows.config.ts`是本轮同一4205无webServer的临时窄配置；后续用已提交的`playwright.windows-qa.config.ts`复跑，自动管理独立源码服务并避免该shim。本轮主控JSON已归一化到test-results根路径，原嵌套副本保留；小回执纳入Git，完整报告不入Git。

四处产品修复分开提交，可独立回滚；其余测试/中文总表/交接另行提交，最终以git log为准。**尚未推送**；没有更新release/web、用户4180、官网、公开Release或正式下载包。隔离候选ZIP及身份回执只用于本机验收，最终包以[evidence/T26-windows/package.json](evidence/T26-windows/package.json)所列快照/哈希为准。所有自建浏览器上下文、模型/TLS/CONNECT服务由finally关闭，主控4205在最终收尾关闭。

收尾清理：分包报告中“下载保留test-results”描述执行时状态；最终已对本轮183个合成KA1/KDBX/ZIP下载先记录SHA256，再删除（逻辑字节239,794,535，含稀疏超限夹具，不等同实际释放磁盘数）。早一份重复便携候选及解压目录同时删除，仅留最终02a4622隔离候选。原始JSON、首次失败截图、小回执和回归源码保留；清单见[cleanup.json](evidence/integration-windows/cleanup.json)。所有已知测试4205/4391/4403监听已退出；用户数据/依赖和release/web不动。
