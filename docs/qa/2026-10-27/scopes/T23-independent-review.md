# T23 Windows native 文件边界：独立复核

2026-10-27。仅审查 Windows helper 与启动器接入，不运行其他代理的服务或修改产品。采用已安装 GSD verifier 的 goal-backward、artifact / wiring / behavior 准则；测试绿灯不直接等同于目标达成。

**最终复核更新：IR-01、IR-02 以及后续实证的 IR-03 均已修复并通过本代理独立行为复测；本小包当前没有未关闭的具体阻断发现。以下首轮内容保留真实失败过程，最终状态见文末。此结论不代替 T23 完整 UI/SDK/构建验收或整个项目验收。**

## 可复现发现

**IR-01 / P1：状态提交成功后自身无法读回，当前需修复。**

`windows-private-files.ts` 的 `ReadState` 拒绝超过 8 MiB 的文件，但当时的 `commit` 和 `FileAuthorityStorage.updateWindows` 没有同一写入边界。授权审计、回执和授权数组均可累计增长。独立探针用合成的合法 metadata audit 一次性构造临界状态，通过正式 `FileAuthorityStorage.update`，结果为：

```json
{"scenario":"state above read boundary","updateResolved":true,"readResolved":false,"bytes":8389733,"readError":"unsafe-size"}
```

复现命令：`node --import tsx test-results/t23-independent-size-probe.mjs`。探针仅创建自有 `TEMP/keepany-independent-size-*` 私有目录，结束已关闭本进程 helper 并删除整个自有目录，不触用户状态。探针源码保留在忽略目录，未复制真实数据到报告。

这不是性能猜测：已有成功提交及随后被拒绝的真实回读。修复应在覆盖旧文件前按 UTF-8 字节检查一致上限，超限保留旧状态、FileID 和全部历史；不能截断审计或回执。已同时通知主控和实现代理，实现代理确认并准备修复及恰好边界 / 超限测试。

**IR-02 / P1：路径式临时文件 rename 存在同用户替换窗口，修复进行中。**

复核快照使用 `MoveFileExW(temporary, lease.path, ...)`，持有祖先目录句柄能阻止目录更名，但不能阻止同用户把临时文件叶子路径换成另一文件。该项由实现代理先行自查发现，主控同步要求按真实临时文件句柄 `SetFileInformationByHandle(FileRenameInfo)` 改造，不能将路径预查当作安全边界。本报告不把其原始发现归为独立探针结果；等待最终源与确定性替换攻击回执复核。

## 已核对的边界

| 目标 | 源码 / 接线结论 | 行为证据与限度 |
|---|---|---|
| 失败关闭 | helper 不可用、超时、ACL 不可解析、无 DACL、不受保护的 DACL、未知 ACE、错误 owner、reparse、硬链接、设备/UNC/ADS 形态均无放行 fallback。错误输出稳定码，native stderr 不转发路径或内容。 | 现有 native tests 包含 Everyone ACL、symlink/hardlink、junction/祖先更名、ADS 等反例。未知 ACL / owner 不匹配等分支主要由源码支持，不能伪称全部已运行。IR-01 证明正常数据边界仍有缺陷。 |
| owner 与 tokenOwner | 私有目录/文件强制 `Owner == current.User SID`、protected DACL，只接受该 SID 与 SYSTEM 的普通 Allow ACE，并要求用户 FullControl；原子创建时即附该 descriptor。`tokenOwner` 只用于读取无秘密的 request proposal，可能是 elevated token 的 Administrators 组；它没有扩大私有状态 owner 白名单。 | request 合同原本是 owner 检查，未要求私有 ACL。测试明确允许 proposal 的 Everyone Read ACE，不能把它当作私有 secret 文件正例；当前目录、pairing 和 authority 仍走 Private。 |
| helper 执行边界 | PowerShell suffix、bootstrap、C# 源为固定值；路径与内容经 JSON stdin 传递，不进入可执行代码；`-NoProfile -NonInteractive -EncodedCommand`，`windowsHide:true`，无 shell。 | 路径根来自继承的 `SystemRoot` 环境，并非通过 OS API 验证的绝对系统目录；当前边界假设启动环境可信。未发现由 request 内容控制 executable、bootstrap 或 C# 源的接线。不承诺防御可修改整个启动环境的同用户攻击者。 |
| 祖先与读取 | 父链逐级 `OPEN_REPARSE_POINT` + 句柄属性检查，每层持有不共享 DELETE 的目录句柄；输入叶子从同一已核对句柄读取，文件读取不共享 WRITE。 | 现有测试真实阻止目录/祖先 rename。它不自动保护临时叶子路径（IR-02）。 |
| 配对清理 | CREATE_NEW + private descriptor + DELETE_ON_CLOSE，lease 保留原始句柄；释放按原对象关闭，因此路径换成别的文件不会删除替代品；Node pipe EOF / 进程退出最终让 helper 释放句柄。 | 已有 pairing replacement 和 stdio SIGTERM 测试。Windows 强杀不能依赖 Node exit 回调；依靠独立 helper stdin EOF / OS handle close，仍需以完整产品测试回执为准。 |
| 排他锁与提交 | `.lock` 通过 CREATE_NEW 排他建立，正常 release 通过原句柄 disposition 删除；helper 崩溃残锁故意保留，之后有限重试失败关闭，无自动清未知锁。每进程还有 Promise queue。 | 目前 native 事务竞争测试在同一个 helper，不能据此声称两个独立进程并发均已验证。最终原子更新应待 IR-02 修复后复核；不承诺未证明的断电强持久性。 |
| 浏览器隔离 | Web 实际从 browser-bridge、rxdb-store、fields 及 type-only 路径导入，不经过 Node barrel。Node barrel 既有的 file-storage 导出属于 Node 入口。 | 独立 `esbuild` 使用 `platform:'browser',bundle:true,write:false,metafile:true,packages:'external'` 构建 browser-bridge + rxdb-store 成功。本地输入只有 domain、fields、authority、browser-bridge、rxdb-store，共 8 个；`nodeImports=[]`，无 native/helper/file-storage。没有改建产物或占用其他测试服务。 |
| POSIX 保持 | request、pairing 和 state 的 POSIX 分支检查/写入/清理保留；Windows 分支在入口提前返回，浏览器不执行 Node helper。 | Windows 机器仅能给出源码保持证据，不能报告 macOS/Linux 运行通过。原来 POSIX 的路径/owner 语义也未被提升成“所有平台完全防 TOCTOU”。 |

## 首轮状态（已被文末最终复核更新）

当前独立评审结果为 **gaps_found**。IR-01 已实证，IR-02 的危险路径已在源码确认；待实现代理修复后必须复核真实接线与反例，不能因原先 7+5 个测试通过就关闭 T23。完整中英正式 UI、权限/写预览/拒绝/批准/撤销链与打包行为由主控和 T23 代理汇总，本报告不冒充已执行。

本包仅新增本报告和忽略目录的一次性边界探针，无产品改动、Git 提交、部署或用户 4180 操作。

## 最终候选独立复核（15:18）

本轮再次按实际实现、接线、行为证据逐层核查，未沿用实现代理的通过数字作结论。对前述首轮表格中“等待修复”“同一 helper 并发”及“owner 反例未跑”的描述，本节给出后续变化；首轮事实保留，不能理解成最终候选仍未改造。

### IR-01 关闭：超限写入先拒绝，原库完全保留

Node `transaction.prepare/commit` 与 C# `prepare` 均在创建临时文件及替换目标之前按 UTF-8 字节检查 `<= 8 MiB`，与 ReadState 上限一致；没有删除或裁剪审计、回执、授权数据。

本代理改造原独立探针，先正式提交一条原始审计，记录 FileID 与完整内容，再执行原来导致自锁的同一超限更新。最终两次运行结果一致：

```json
{"scenario":"state above read boundary after fix","updateResolved":false,"readResolved":true,"updateError":"authority-file-too-large","bytes":149,"sameIdentity":true,"sameContent":true,"originalAuditRetained":true}
```

命令仍为 `node --import tsx test-results/t23-independent-size-probe.mjs`。原来“成功写后读失败”的反例已转成“写前拒绝且原始状态不变”。实现代理另有三字节中文组成的恰好 8 MiB / 加 1 字节用例，本代理审读其独立数值断言，没有把字符数当字节数。

### IR-02 关闭：从真实临时文件句柄重命名

最终 C# 源已无 `MoveFileEx`；`RenameHandle` 使用 `SetFileInformationByHandle` 的 `FileRenameInfo`，源对象为 `lease.temporary.SafeFileHandle`，不通过旧临时路径重新定位源。提交前写入并 `Flush(true)`，提交后对同一流再 flush，并打开目标核对实际 FileID。目标祖先句柄全程保留。

本代理独立运行 `renames the held tmp identity even when the same user replaces its old path`：先 prepare 真临时文件，把它移动到另一名称，在原临时路径塞入攻击文件，再 commit；正式状态必须是原 prepare 内容及原 FileID，攻击文件仍保留，移动后的真临时路径消失。该反例通过，不依赖仅检查函数名或成功码。

### IR-03 发现并关闭：持有的真实暂存文件仍可被写入

修复 IR-02 后，本代理进一步发现 `NewFile` 当时仍使用 `FILE_SHARE_WRITE`。独立新探针 `test-results/t23-independent-stage-probe.mjs` 实测：

1. `prepare` 正常空 audit 的 JSON；
2. 用另一个 Node 文件打开者直接覆盖该真实暂存文件的内容；
3. `commit()` 成功，但读回 audit 变成覆盖后的记录，FileID 核对不能发现内容改变。

原始输出为 `{"stagedWrite":"allowed","committed":[{"id":"changed-after-prepare"}]}`。本代理立即通知主控及实现代理；实现代理将 `NewFile` 共享模式改为 `SR|SD`，拒绝共享写，保留读取及 rename 所需共享删除，并增加对暂存状态和存活配对秘密文件的写入拒绝测试。

修改后本代理再次执行**同一独立探针**，输出 `{"stagedWrite":"EBUSY","committed":[]}`，真实 prepare 内容准确提交；另独立选跑 `denies same-user writes to prepared state and the live pairing secret`，1/1 passed（1.89 秒）。IR-03 关闭，不以文件身份保护替代内容保护。

### 独立选跑的并发与强杀证据

命令：

```powershell
node node_modules/vitest/vitest.mjs run packages/mcp/src/node-private-files.test.ts packages/mcp/src/file-storage.test.ts --maxWorkers=1 --no-file-parallelism -t 'renames the held|rejects in-place|separate processes|crashed owner|acknowledging'
node node_modules/vitest/vitest.mjs run packages/mcp/src/node-private-files.test.ts --maxWorkers=1 --no-file-parallelism -t 'denies same-user'
```

第一条实际选中 4 条（`rejects in-place` 没有匹配任何标题），4/4 passed，22.58 秒；12 条因命令筛选未执行。第二条选中 1 条，1/1 passed，1.89 秒；其余 10 条未选中。这些是定向 spot-check，不是“全部原语通过”。日志分别为忽略目录 `test-results/T23-independent-selected.log` 和 `test-results/T23-independent-no-write.log`。

四条实际行为为：

- 真实临时文件被移动、旧路径替代后，仍提交原 FileID 和内容。
- `execFile` 启动三个独立 Node 进程，各执行 8 次 read-modify-write，最终审计恰为 24 条、24 个不同 ID，非同一 helper 的串行假并发。
- 子进程取得锁后被 SIGKILL；另一个更新明确 `authority-locked`，已确认状态逐字段不变，不自动删除未知残锁。
- 子进程先成功提交 operation 并写确认信号，再被 SIGKILL；新实例准确读回完整的 operationId、grantId、previewId、patchHash、assetId、状态和时间。

### 接口、浏览器与剩余验证边界

对比补丁，request 形状、MCP 方法/范围/秘密协议、pairing payload、authority JSON、operation 与审计字段均未改变；新增 `prepare` 是 Node 原生事务内部 API，用于两阶段状态操作和确定性攻击测试，没有接到浏览器或 MCP 公共工具上。POSIX 分支原有检查及读写清理保留，没有降低其断言；但本轮仍无 macOS/Linux 运行证明。

最终再次执行 browser 平台的内存 esbuild，仍为 8 个本地输入、`nodeImports=[]`，没有 native/helper/file-storage。私有状态 owner 必须为 user SID；request 可接受 tokenOwner 的旧 owner-only 合同没有扩展到秘密状态。新增 ACL 负例覆盖 Users/Authenticated Users/其他 SID/null DACL/empty DACL/Deny/owner mismatch，但其中一次 finally 恢复权限夹具失败的日志真实保留，需由主控结合实现代理最终完整测试结果确认该组最终绿灯；本代理没有将其失败当作测试通过，也没有因此声称原语放行。

最终审阅生产文件 SHA-256：

```text
packages/mcp/src/windows-private-files.ts 430B72A55EA0A0848DC604D653CBF3818C915AE9E49100FF8AC25CBD9978E202
packages/mcp/src/node-private-files.ts    A9E15B2F832DB49543C00C420C03025295861F3D3F06DB93255DB30121B879F1
packages/mcp/src/file-storage.ts          80308FACC28228E92B348BFD7E548E89AAACC4B19A20EFABE4A2117010F73EE6
```

**最终结论：独立代码与定向行为复核完成，三个具体发现全部关闭；目前未发现未关闭的产品阻断项。** 仍保留可信 `SystemRoot` 启动环境、本机 NTFS、未证明断电持久性和未运行 POSIX 的边界。完整 T23 UI/SDK/构建测试由主控整合，不能把本小包 5 条选跑或缺口关闭说成全部项目验收完成。

两份独立探针的自有 TEMP 目录、句柄及 helper 均已清理；没有打开产品端口或用户页签，没有修改产品、提交 Git 或部署。
