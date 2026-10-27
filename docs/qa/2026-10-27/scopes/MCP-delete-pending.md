# Windows MCP 并发锁释放：原整合失败的定位与修复

日期：2026-10-27。仅使用Windows合成私有目录；未触碰4180、真实浏览器资料、旧清理拒绝目标或商业代码。

## 原始失败与根因

原整合报告 `test-results/completion-pg/all-final.json` 为994条中993通过、1失败、0跳过。失败项为 `local authority state preserves every metadata row when separate processes concurrently replace state`：3个独立Node进程各更新8次，b进程抛 `native-file-5`。该测试及24条唯一metadata断言没有删除或修改。首次隔离精确重跑通过，但没有把它当作原失败消失的证明。

已用真实Windows句柄稳定复现：事务持有 `.lock`，另开一个允许共享删除的只读观察句柄，再释放事务。旧helper先在同句柄上设置删除标记，固定锁名仍处于delete-pending，直至所有观察句柄关闭；此时另一个CREATE_NEW返回Win32 ERROR_ACCESS_DENIED(5)，并非EEXIST。上层只重试EEXIST，故直接失败。根因来自实际OS行为，不归咎于整合负载。

定位性实验在 `test-results/mcp-delete-pending-red.json`：直接native.transaction已确定返回native-file-5；随后正式storage.update也被拒绝。把“必须得到native5”的定位性断言移开后，真正功能合同单独再红：观察句柄仍在时下一次更新应完成、原确认历史及本次历史均准确；结果仍因native-file-5失败，见 `test-results/mcp-delete-pending-contract-red.json`。

## 最小修复

产品提交 `32b442c65cf5469c6776e047297a3251534b89e6`，只改 `windows-private-files.ts` 并新增 `file-storage.test.ts` 的真实句柄回归。

- 事务结束的release先用已持有的锁句柄，将其原子重命名为同一私有目录中的随机 `.lock.<GUID>.released`，明确no-replace，再对该句柄标删除并关闭。固定 `.lock` 名立即空出，旧观察句柄的delete-pending状态只影响已退出事务自己的随机名字。
- 不按路径重开锁，不扩大共享写权限，不改ACL/FileID检查，不改父链、reparse/hardlink保护，不改状态的同句柄原子替换，也不吞掉或泛化重试ACCESS_DENIED。
- 重命名失败时finally只关闭原句柄，不进入Delete，原固定锁保留并继续fail closed。碰撞目标不覆盖是原生no-replace参数；此失败顺序经源码审查，未声称额外做过随机GUID碰撞注入。
- 未进入release即崩溃的owner仍留原 `.lock`。POSIX实现未改。

最终回归进一步移除定时关闭窗口：只读观察句柄一直保持到下一次storage.update及两条历史读回完成后才在finally关闭。此功能断言验证的是用户可见的正确串行更新，不要求内部继续抛旧错误。

## 验证证据

|范围|结果|报告|
|---|---|---|
|新增真正合同红→绿|旧实现native-file-5失败；修后下一更新完成，两条历史原顺序保留，观察句柄仍打开。|`mcp-delete-pending-contract-red.json`、`mcp-delete-pending-contract-green.json`；最终强化断言纳入下述全组。|
|原并发测试不改断言，独立5轮|每轮3进程×8更新，24条audit且24个唯一ID；5轮均通过。按名称筛选时的其他5项是未选执行，不折算成安全通过。|`test-results/mcp-original-concurrent-round-1.json` 至 `-5.json`。|
|完整file-storage|6/6通过，0失败/跳过。|`test-results/mcp-storage-fix-final.json`。|
|完整MCP模块|8文件51/51通过，0失败/跳过。|`test-results/mcp-all-fix-final.json`。|
|类型与lint|类型通过；2个改动文件lint零诊断、diff检查通过。|本机命令输出。|

完整MCP仍实测ACL与其他principal/null或空DACL/owner拒绝、junction和父链不能替换、同用户tmp路径替换和内容写入、准确8MiB/边界+1、只读状态替换失败后保持原身份与内容、崩溃锁fail closed、force-terminate后已确认操作读回等原负例。

## 未完成、交付与清理

源码修复与本机安全相邻已闭环；主控需要重新执行全仓真实PG整合、重新构建bundled CLI和便携候选，并对最终包重跑既有16场景矩阵。不能用本报告51/51替代打包后的交付证据。

所有本包观察句柄均finally关闭；辅助进程随私有helper关闭，测试只清理各自创建的合成目录。未推送、未发布官网/Release、未更新4180，未删除或重写旧证据。机器摘要见 [MCP-delete-pending/checks.json](../evidence/MCP-delete-pending/checks.json)。
