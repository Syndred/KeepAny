# T24 第二轮：独立 PostgreSQL 条件补齐与实测

2026-10-27。主控已检查main/origin并fetch/fast-forward确认远端无更新，接手源码为1bb1c08。Windows、Node24.21.0、Playwright1.63.0隔离Chromium。仅使用合成账号、图片、密码库和本机HTTP服务；不操作用户4180、真实数据库/云账号或系统代理。

## 完成

- 原机器没有PostgreSQL/Docker，WSL也未安装。采用[PostgreSQL官方Windows下载页](https://www.postgresql.org/download/windows/)指向的[EDB二进制发行](https://www.enterprisedb.com/download-postgresql-binaries)，固定`postgresql-17.11-5-windows-x64-binaries.zip`。实际381,531,864字节，SHA256为`80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f`，与同源`.sha256`完全一致；运行`postgres --version`确认为17.11。
- 工具放在`C:/Users/Administrator/.codex/toolchains/postgresql/17.11-5/pgsql`，只提取bin/lib/share共1,563文件、140,784,906字节，不注册Windows服务、不改PATH。上游17.11的COPYRIGHT另从官方PostgreSQL源码保留。381MB原始下载校验、提取后删除，没有放进KeepAny Git。
- 新建独立随机数据目录`test-results/T24-round2/data-49f87e3a`，仅监听127.0.0.1:61090、PID18044，使用scram-sha-256及本轮随机密码。连接URL只在忽略目录`pg.env.json`，不输出到回执；元信息在同目录`postgres-metadata.json`。
- 五个单测文件 **7/7通过，0失败/跳过**，包含前轮6个因无PG而跳过的真实数据库用例及1个静态配置合同。真实迁移003～008、共享CAS/撤销墓碑、并发32上限、双RxDB客户端丢应答/冲突/墓碑、Hono＋PG＋签名S3 HTTP、双Better Auth会话/成员/图片隔离均实际运行。
- 三条正式浏览器流程 **3/3通过（59.4秒），0失败/跳过/flaky**。实际独立Node Hono与PG、随机本机对象HTTP服务；源测试服务4207。没有用PGlite或route mock代替服务主链路，现有错误分支仍按原测试注入。
- 官方绑定原整条浏览器流程另 **1/1通过（2.6分钟），0失败/跳过/flaky**。主控通过已连接GitHub核实原私有仓库`Syndred/KeepAnyAdm`（repository ID1394374935），本轮在同级独立目录只读获取固定提交`7589b6d087a778cbddb9c99d3e7af5f76cf1e2d3`。按其`pnpm@11.10.0`与原始锁文件执行`install --frozen-lockfile --ignore-scripts`，887包中885复用缓存、仅2包下载；不复制商业业务代码进KeepAny、不部署、无真实账户或付费操作。

## 总表逐项结论

|用例|现场结果|建议状态|
|---|---|---|
|T24-01|正式UI注册两个合成自托管用户，分别创建工作区、项目和图片并手动同步；第三个干净浏览器以用户A登录、校验工作区密钥后读回原项目与32px图。用户B读/预检/下载A工作区被403，伪主体/无会话/坏cookie401，不可信Origin拒绝；刷新、退出和换账号保持原归属。新增通过正式UI创建独立KDBX、写入合成凭据、刷新解锁回读条目后再同步；PG文档只有1条普通asset、附件只有2个图片块，同账户新浏览器仍显示创建库而非解锁库，密码库没有被同步。|本机独立PG范围通过|
|T24-02|补齐真实商业固定fixture后，原official-bound-sync整条1/1通过。合成Plus账户、真实商业HTTP与DPoP授权、两个独立浏览器资料/图片密文同步、丢应答单operation、跨账户工作区和错key拒绝、60秒短令牌刷新、商业撤销到PG墓碑、合成Plus到期后拒绝同步均实际执行。撤销后本地CRUD仍可用，真实ka1备份在第三个干净context恢复原项目及32px图片。|本机独立PG＋固定商业fixture范围通过|
|T24-03|两独立上下文实际自托管同步，丢应答后刷新重试保持同operationId、不造重复；双端冲突需显式选择，墓碑不复活，A→B→A拒绝误认领且保留原资料；图片上传已存但丢应答时复用原密文对象，缺块/篡改在拉取前拒绝且游标不推进，恢复后原图可回读；目标迁移读回失败后可重试。|本机独立PG范围通过|
|T24-04|前轮真实本机Hono＋PGlite密钥加入/独立恢复结果保留，本轮未将它重复计数，也不扩大为独立PG、物理双设备或生产密钥轮换验收。|沿用前轮本机通过范围|

## 命令、修改与证据

完整执行命令由忽略目录`run-pg-tests.mjs`读取本轮pg.env.json注入子进程，不打印连接密钥：

```powershell
node test-results/T24-round2/run-pg-tests.mjs pg-unit unit run apps/sync-server/src/real-client.test.ts apps/sync-server/src/real-migration.test.ts apps/sync-server/src/real-postgres.test.ts apps/sync-server/src/bound-state-writer-db.test.ts apps/sync-server/src/self-host-session.test.ts --reporter=json --outputFile=test-results/T24-round2/pg-unit.json
node test-results/T24-round2/run-pg-tests.mjs pg-browser browser test -c test-results/T24-round2/playwright.config.ts tests/e2e/self-host-session.spec.ts tests/e2e/self-host-sync.spec.ts tests/e2e/self-host-photo-sync.spec.ts --workers=1 --reporter=line,json --output=test-results/T24-round2/browser
node test-results/T24-round2/run-pg-tests.mjs pg-official-blocker browser test -c test-results/T24-round2/playwright.config.ts tests/e2e/official-bound-sync.spec.ts --workers=1 --reporter=line,json --output=test-results/T24-round2/official-blocker
node test-results/T24-round2/run-pg-tests.mjs pg-official browser test -c test-results/T24-round2/playwright.config.ts tests/e2e/official-bound-sync.spec.ts --workers=1 --reporter=line,json --output=test-results/T24-round2/official
```

第三条是首次明确失败的前置诊断，不计通过；第四条为补齐真实fixture后的最终通过。精简安装/数据库/测试结果见[evidence/T24-round2/checks.json](../evidence/T24-round2/checks.json)。保留[中文资料](../evidence/T24-round2/session-photo-zh-390.png)、[英文配置](../evidence/T24-round2/session-en-390.png)、[官方设备中文390](../evidence/T24-round2/official-devices-zh-390.png)、[官方设备英文390](../evidence/T24-round2/official-devices-en-390.png)代表图；已目检没有横向溢出、入口可达，配置密钥遮罩。官方设备另有1280中英截图在忽略日志目录，测试同时断言无横向溢出。截图本身不代替真实HTTP/SQL与图片读回断言。当前附件与项目保存默认显示本机状态，不把后续离开同步页后的本机标签解释为远端未写入或“自动同步”。

产品代码零修改。本包只改4个既有测试文件：Windows下把`.bin/tsx`和`.bin/vite`改为`process.execPath`直调已锁定的tsx/Vite，保留原参数、环境、HTTP/SQL断言；session额外增强真实KDBX不入同步证明。official-bound只补跨平台测试启动：固定Git ZIP由现有fflate解包、规范Windows长路径、临时目录当前用户SID独占ACL并校验、Node直调固定Paraglide/Drizzle、快照内独立Vite缓存及精确允许快照/既有依赖两个根目录、只终止已记录的自建子进程树。商业原仓文件未改；仅一次性Git快照中的测试启动器和Vite启动配置做上述适配，冻结业务源/路由/合同/种子未改。四文件lint、全仓类型检查、diff-check通过。没有删测试、放宽安全检查或把部分执行当整条通过。

本轮先后暴露Windows tar中文路径、TMP短路径、Vite依赖目录联接缓存和默认fs边界问题；冻结商业夹具清理还曾因自身SQLite连接占用报EBUSY，原始运行诊断只放忽略日志。最小启动兼容处理后原整条测试通过，最终finally清理断言也通过，没有通过修改商业业务或mock主服务获得绿灯。

## 首次环境问题与清理交接

首次PG已真实ready，但pg_ctl启动时后代进程继承管道，Node同步等待无法返回；正常停止这份空测试服务，改为文件日志句柄后新随机目录一次启动成功。该环境问题不属于产品缺陷。自动审批拒绝了清理首次空data目录的递归删除；未换工具重试同一删除，保留停止后的空目录，采用新目录安全继续。

本包浏览器上下文、Hono/绑定桥/商业Vite、对象HTTP及4207源服务均由finally关闭。独立核对无本轮商业快照/启动器进程，无4207/51906监听，只有隔离PG61090；真实数据库查询所有`keepany_%`测试schema为0。最终商业快照、临时合成SQLite账户、签名/reader私钥与测试资料已删除。一个首次ACL启动失败后遗留的空临时目录`keepany-official-e2e-AW8Ipk`，其空目录清理也被自动审批拒绝；未换工具重试。PG61090暂按已告知主控保留供本轮整合测试，仍只有loopback监听；最终由持有该环境的主控用metadata的精确runtime/data执行`pg_ctl -D <metadata.data> -m fast -w stop`，不按名称停止其他Postgres，不删其他目录。密码文件与全部临时SQL资料只在忽略目录，不纳入Git。

未Git提交/推送、未改总表与项目进度，等待主控独立复核后更新T24-01/02/03；未更新release/web、4180、官网、公开Release或正式云服务。独立进程/多个浏览器上下文不等于物理双设备，受控对象HTTP不等于真实R2/S3，固定商业合成fixture不等于真实线上账户或付费订阅验收。
