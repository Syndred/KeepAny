# T23 第二轮：Windows MCP 安全兼容诊断与修复方案

2026-10-27。本轮用户要求安装 GSD/gstack 并继续实际测试。主控已 fetch/fast-forward 核对远端；诊断基于本地主分支 `1bb1c08`（包含上轮6个本地提交）。主控随后授权本分包实现 Windows 私有文件后端并复测；本报告保留初始诊断和失败历史，不把原语探针或过渡快照冒充最终验收。

## 已确认的阻塞

1. `pairing-file.ts` 把 POSIX 0700/0600 模式位当作唯一私有权限判定；`file-storage.ts` 同样检查其他用户模式位。Node 在 Windows 不提供这些模式位所表达的 ACL 语义。
2. Windows 运行时 `constants.O_NOFOLLOW` 为 undefined，`process.getuid` 不存在。现有位运算把 undefined 当0，因此 request 的“拒绝符号链接”断言真实失败，不能只修目录权限放行。
3. 隔离临时目录 ACL 实测：owner 是 Administrators，继承未关闭，除当前用户/SYSTEM/Administrators外，另有两个其他用户SID拥有 Modify/Synchronize。没有把完整SID写入本报告。它说明本机默认临时目录也不能被默认为私有目录。
4. 两个 stdio 单测仍直接执行 `node_modules/.bin/tsx` 无扩展文件，需沿上轮 e2e 的做法用 `process.execPath --import tsx` 启动。此项仅测试启动夹具，不是安全修复。
5. 两个写入路径在创建文件/rename后以 Node `open(directory)` 调目录fsync；需在Windows后端实际验证其等价持久化路径，不能直接吞掉错误。Windows 的强制进程结束也不会执行Node退出清理，原SIGTERM单测不能只改成跳过。

上轮失败6条分布：request读文件1条、配对权限/替换清理2条、真实SDK stdio2条、权限状态文件1条。最初诊断时上轮4条基准用例仍为阻塞；后续结果见本报告末尾，旧过渡绿灯均不能替代最新候选复测。

## 原始资料与边界

- [Node v24 文件系统](https://nodejs.org/docs/latest-v24.x/api/fs.html)：Windows chmod只支持有限权限语义；POSIX标志不是ACL证明。该页面实际读取于本轮，运行机版本仍为Node24.21.0。
- [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)：用OPEN_REPARSE_POINT得到对象本身的句柄，CREATE_NEW实现排他创建；目录句柄需BACKUP_SEMANTICS。应同时限制共享删除并拒绝所有reparse点，而不是路径上先检查、随后普通readFile。
- [GetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-getsecurityinfo)：可按打开的同一对象handle读取owner和DACL，避免检查路径A后读取已替换的路径B。
- [SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle)：可按已核对身份的handle标记删除/重命名，不把lstat→unlink两次路径调用当原子身份操作。
- [FlushFileBuffers](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)：文件handle需相应写入权限；持久化语义必须按Windows路径验证，不承诺等同POSIX目录fsync。
- [Node v24 信号](https://nodejs.org/docs/latest-v24.x/api/process.html#signal-events)：Windows信号/强制终止语义应单独验证。配对文件若要求强制结束也不留密钥，应由原生句柄/独立守护清理，不能依赖exit回调。

未复制任何上游业务代码，无新增依赖、许可证变动或原生二进制。本仓库检索未找到可复用的Windows ACL/no-follow安全模块。

## 建议的最小安全实现

保留现有POSIX后端，新增共享的Windows原生文件后端；launcher与FileAuthorityStorage只通过这个统一边界读写，不在各处堆 `if(win32)` 放宽检查。

1. Windows后端可用系统PowerShell/.NET承载少量固定Win32调用；只在隐藏子进程的stdio管道传结构化请求，不把路径或数据拼入可执行代码，不改系统执行策略/ACL/信任。helper不可用、ACL查询失败或未知文件系统均失败关闭。
2. 私有目录/临时文件在创建时就附当前用户owner与受保护DACL；不先创建公开文件再修改权限。已有不安全状态目录拒绝，不擅自接管或收紧用户既有目录。
3. 对请求/配对/authority/lock/tmp使用原生no-follow句柄；检查磁盘普通文件、链接数1、界限大小、ownerSID、DACL、reparse属性及稳定FileID。拒绝UNC/设备路径/ADS等当前入口不需要的路径形态。必要时持有父目录句柄防止祖先替换，不把最终组件检查误当整条路径保护。
4. 私有状态仍以同一JSON结构、固定authority.json、原operationId/授权ID和审计格式保存；跨进程排他锁、临时写入、flush、原子替换及失败清理均需原路径验证。
5. 配对文件清理按handle/FileID，只删除本进程创建的对象。当前路径被另一个文件替换后不碰替代品；正常stdio关闭、超时和强制结束分别测试。如果OS/Node无法提供强制结束清理保证，则需原生DELETE_ON_CLOSE或受控helper寿命方案，不能误称已支持。

这不是通过单次 `Get-Acl` 输出或 `lstat` 正对照就能验收的小改动。建议先做阶段0原生原语探针，再接产品；若阶段0任一安全语义不能证明，保持T23阻塞。

## 文件所有权申请

主控已确认由本代理独占以下范围；没有覆盖其他代理的产品或同步改动：

- 新共享Node私有文件接口与Windows helper，建议 `packages/mcp/src/node-private-files.ts`、对应测试及helper源。
- `apps/mcp-launcher/src/request.ts`、`pairing-file.ts`、`main.ts`及`request.test.ts`、`stdio.test.ts`。
- `packages/mcp/src/file-storage.ts`及`file-storage.test.ts`。
- 如helper有独立资源，`scripts/build-mcp-launcher.mjs`只补打包/检查，不改变普通Web打包。
- `tests/e2e/mcp-web.spec.ts`、`mcp-dialog-matrix.spec.ts`仅把私有目录/模式位夹具改成真实Windows ACL等价断言；所有范围/拒绝/秘密排除/写批准/撤销行为断言保留。

不碰主控安装目录、其他代理PG任务、用户4180、密码库、普通资产schema和主总表；任何新增共享文件冲突先回报。

## 验证清单

- 当前用户私有ACL正例；Everyone/Users/Authenticated Users/其他SID读或写权限、空DACL/未知ACL、owner不匹配的拒绝反例。
- 符号链接、目录junction、其他reparse点、硬链接、父目录替换、打开后文件路径替换、ADS和超限输入；必须证明未读到目标内容且未改目标。
- 排他创建不覆盖已有路径，write/flush失败无秘密残留；清理只删除原FileID。
- 两个进程并行修改同authority，保留操作ID、撤销墓碑与metadata-only审计；崩溃留下锁必须失败关闭，不自动清未知锁或未决回执。
- 配对前拒绝→正式UI授权→只读投影→未选资产/密码拒绝→准确写预览/拒绝/批准→过期/重复/冲突→撤销，官方SDK stdio与实际浏览器中英390/1280。
- 原POSIX断言在相应平台继续保留；Windows用真实ACL/原生handle证明等价条件，不以模式位的假值凑绿。

## 阶段0独立原语探针：13个检查通过

已在忽略目录写本轮自有C#/PowerShell最小探针，直接调用系统Win32 API；没有接入产品或替换测试。最终约3.34秒完成以下实际正/负对照，结果见[小回执](../evidence/T23-round2/native-probe.json)：

1. 用SECURITY_ATTRIBUTES/受保护SDDL原子创建当前用户拥有的私有目录，打开同一handle读owner/DACL验证通过。
2. 原子创建私有普通文件、同handle验证并读回非秘密合成文本。
3. CREATE_NEW遇已有文件拒绝、原内容不变。
4. OPEN_REPARSE_POINT打开符号链接后拒绝，读取计数没有增加。
5. 硬链接数2时拒绝，读取计数没有增加。
6. ADS路径在打开前拒绝。
7. 仅给本轮合成文件添加Everyone Read后，原生同handle ACL验证拒绝；随后移除该测试ACE，不改其他目录。
8. 原路径换成另一个文件后，以旧FileID请求删除返回false，替代文件仍在。
9. 以匹配FileID按handle删除当前对象成功。
10. 持有父目录FILE_LIST_DIRECTORY、不共享DELETE，真实Directory.Move被拒绝。
11. 独立隐藏子进程持有DELETE_ON_CLOSE文件时，配对占位文件实际存在。
12. 该handle仍持有时，真实隔离Chromium的文件输入和浏览器File.text能够读回合成占位内容。
13. 强制终止该自建子进程后，OS删除文件；不依赖JS或PowerShell正常退出回调。

保留两次前置/探针修正：本机不允许直接执行.ps1文件，所以用当前进程内固定自有ScriptBlock执行，没有修改ExecutionPolicy；初版目录handle只有READ_ATTRIBUTES，rename仍可成功，补实际FILE_LIST_DIRECTORY后原拒绝断言成立。不能把仅拿到目录handle当成防替换证据。

此13项只是Windows原语可行性，不是T23四条产品验收通过。阶段0结束时尚缺逐层父目录/reparse路径遍历、junction、owner不匹配/空DACL/复杂ACE、并发锁/原子持久替换、真实进程崩溃恢复和完整MCP stdio/浏览器链路；后续实现和测试如下。探针来源SHA256保存在回执，不包含SID、文件内容或密码。源码位于忽略的test-results/mcp-native-probe.cs、.ps1和mcp-doc-browser-probe.mjs；不将原型直接当作已审计库。

## 实现完成情况

- 新 `node-private-files.ts` 仅供 Node 调用；固定 C# 源在 `windows-private-files.ts`，由固定系统 PowerShell 隐藏进程编译，源码和请求通过私有管道传输。数据路径/JSON 从未拼入可执行代码；没有改 ExecutionPolicy、系统安全配置、真实目录 ACL 或新增 npm 依赖。helper 无法启动即拒绝。
- 每级祖先以 no-follow 句柄打开，检查 reparse 属性，并持有 FILE_LIST_DIRECTORY、不共享删除，阻止目录换位。只支持本轮证明的本机 NTFS 路径形态，拒绝 UNC、设备前缀、ADS 和未识别文件系统。
- 私密目录/文件创建时设置当前 User SID owner 和 protected DACL，仅当前用户/SYSTEM；同句柄检查普通文件、单链接和 ACL。请求提案沿原 POSIX owner-only 合同，可接受当前 token 的默认 Owner 或 User，未扩展到私密状态。
- Pairing 使用 DELETE_ON_CLOSE 和保留句柄；配对成功/关闭释放原对象，路径被换成别的文件时保留替代品。Node 强杀后的管道 EOF 令 helper 释放，helper 自身强杀也由 OS 关闭句柄。没有把 Windows SIGTERM 当成会执行 JS 清理。
- 持久库保留原 authority JSON、身份、撤销与操作回执字段；跨进程 CREATE_NEW 锁，写临时句柄并 flush，按该真实句柄 [FileRenameInfo](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_rename_info) 原子替换，再 flush 并核对目标 FileID。崩溃锁不自动接管或删除，后续写入失败关闭。
- 原 POSIX 实现与模式位/owner/no-follow安全断言保留；新 helper 未加入浏览器共用导出。独立 browser esbuild 复核未包含 Node imports/native/helper/file-storage。
- 两份 e2e 夹具都通过当前 Node 执行源码/打包 mjs，不依赖 Windows 无扩展 tsx 或 shebang。Windows 权限断言用实际原生 ACL 验证；POSIX 仍验证 0700/0600。

## 独立复核抓到并修复的问题

独立回执：[T23-independent-review.md](T23-independent-review.md)。三项产品发现均实际复现后修复，早期绿灯已作废：

1. 最初持久替换使用 MoveFileEx 的源路径，有同用户替换 tmp 的窗口。改为持有真实 tmp handle 的 FileRenameInfo；确定性负例先挪走真实 tmp、旧路径放替代品，仍提交原 FileID/内容并保留替代文件。
2. 最初读有 8 MiB 上限而写无同界，能成功写出随后不可读的库。现在写前按 UTF-8 字节检查，同界也由 native 再检查；恰好8MiB允许，+1先拒绝、原FileID/完整内容/历史可读。不裁剪 audit 或 operations；POSIX 原读写无限制，没有该读写不一致问题，未新增其大小限制。
3. 最初 tmp/配对句柄允许 SHARE_WRITE，同一用户能在 prepare 后改内容，FileID校验不足。现不共享写，只保留读取和移动所需共享；实际 writeFile 返回 EBUSY，原 prepared 数据与配对内容不变。

另外记录两项真实夹具问题：首轮 mcp-web 使用已不存在的侧栏 Projects，卡在导航；改为当前真实 Assets 导航并保留修改后读回。新增 ACL 负例 finally 曾用包含 Owner 的新 FileSecurity 请求 WRITE_OWNER，空DACL下失败；修为只恢复 DACL 的 AccessControlSections.Access，没有提权或改系统，7种ACL负例和清理定向2/2通过。首次原生 rename 缓冲缺尾部NUL曾报 ERROR_INVALID_NAME，补齐后重复替换、并发、身份负例通过。

## 实测与证据

- 原6个失败连同原解析正例已实跑7/7。最新主控PG环境完整单测已解析核对：952/952、180 suites、0失败、0跳过、success=true；其中本包4份测试文件恰为22/22（request4、stdio2、FileStorage5、native11）。小回执：[checks.json](../evidence/T23-round2/checks.json)。
- 新 native 11条覆盖创建ACL、Everyone/Users/Authenticated Users/其他SID、null/empty DACL、Deny、owner不匹配、helper缺失、符号/硬链接/ADS、junction祖先、父/叶目录替换、替换路径保留、同用户原位写拒绝、精确字节边界、写入失败保原库和临时文件清理。
- FileStorage新增三独立进程各8次更新，最终24审计/24不同ID；锁owner强杀后 authority-locked、完整原库不变；提交operation后确认再强杀，新实例逐字段读回；超限更新拒绝且保完整历史。
- 源码4209中英5种宽度+范围/拒绝/逐次写/撤销16/16通过，但随后 SHARE_WRITE 修复使该快照过渡化。最终候选在主控4211真实便携生产Web、最新 bundled CLI 重跑16/16、0失败、0跳过，用时3.4分钟；全部16项都运行该bundled CLI，包含真实下载请求/导入配对、字段投影、写拒绝/批准/重复、过期/冲突、撤销竞态。Web候选为 `dist/preview/KeepAny-0.1.0-preview.9df576480f7f.dirty-portable/web`；CLI和源文件SHA见小回执，与独立复核一致。
- bundled CLI由 `node scripts/build-mcp-launcher.mjs` 构建，SHA256 `01f98849e55e3743a64b7364d4679fec6d023a1a1bddda95da13adf5d75d4c37`。C#已嵌入，无额外helper文件；Node直接运行mjs。npm pack dry-run 5文件、压缩68266字节、解包292847字节，仍仅原3项runtime dependencies。此为构建和实际SDK包纵切，不冒充仓库外全新npm安装。
- 13个涉及文件 biome lint 无警告/错误，类型检查通过；主控最终35文件lint与全仓tsc亦通过。28张中英文截图批量保留于忽略 `test-results/T23-round2-production-final-evidence`；仅复制2张390代表图进入本小回执目录：[英文](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-27/evidence/T23-round2/write-en-390.png)、[中文](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-27/evidence/T23-round2/write-zh-390.png)，合计72561字节。第二次误把打包标志对4209 Vite跑时，测试强等ServiceWorker超时；这是配置误用，保留失败日志，不算产品验收；正确生产来源为4211。

## 未完成与适用边界

没有断电/存储设备故障证明；只声称已确认提交的正常退出和进程强杀读回、原子替换及拒绝不完整/损坏状态，不声称 Windows 目录 fsync 或断电强保证。系统PowerShell/.NET动态编译被组织策略限制时失败关闭；SystemRoot启动环境可信、本机NTFS为本轮范围。没有 macOS/Linux 本轮运行、仓库外干净安装、公开HTTPS站点到loopback权限、真实用户MCP或全项目验收证明。私有authority仍有8MiB写前上限，达到上限会拒绝更新并保留全部历史。

## 清理、提交与部署状态

原阶段0探针及本轮正常新夹具已清理；原生/浏览器只用自有合成数据和隔离context。4209为本分包自建测试服务，最终不留监听；4211为主控已有生产预览，未停止它，4180从未操作。

4个早期失败的合成ACL夹具保留，不含实际秘密：`C:/Users/Administrator/AppData/Local/Temp/keepany-native-test-32758914-f777-4979-a4ed-4bbc772d0ba5`、`keepany-native-test-868485c6-dc8d-4342-9cfc-0cc1393eaef0`、`keepany-native-test-8766759c-e7b2-40be-9872-cd21f78d563f`、`keepany-native-test-f2a7dc4e-913d-4c03-aa2f-ff50bc31600d`（后3个与首项同父目录）。对868项尝试组合恢复测试ACL再递归删除时，自动批准审查拒绝，返回 `blocked by policy`，未给更具体理由；主控明确要求不拆命令重试该旧清理目标，本分包遵守。后续新夹具 finally 仅处理本次精确合成对象，不操作这些旧目录。

本分包未提交、未推送、未部署，不改全项目测试总表。T23本轮Windows本机4条场景已具备真实SDK/生产Web和安全回归证据；这不等于公开HTTPS或全项目终验。下一步由主控合并本回执、独立复核、最终完整PG单测和生产矩阵结果，按候选实际覆盖范围更新总表、提交和重打最终便携候选。
