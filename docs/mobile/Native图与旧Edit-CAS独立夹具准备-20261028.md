# Native 图与旧 Edit CAS 独立夹具准备（2026-10-28）

仅正式生产 Web 生成与预验，**不是 Native 恢复/图/CAS通过**。没有ADB/CDP、原库/现有候选读写或push。原M0 26行故障fixture、两历史原件/expected均未改。后续由Root重新授权唯一设备owner才可恢复。

## 当前可交付原件

| 文件 | 身份 |
| --- | --- |
| `test-results/native-graph-cas-fixture/native-graph-cas-original.ka1` | 2092 B；SHA `0945dc552333d9444c55b002e4190db0edb6958f126ead9f3b736d3104448927` |
| `expected.json` | SHA `f2f565822c2e24ac3ab07f2eb91aafa4814f92ad2f4707e3cd34099bc2d6606e`，完整rows/payload/updatedAt、review/categories/preferences/attachments/vault范围 |
| `manifest.json` | SHA `9f7537c4d8865b0919ef65476198b212aedf9663755c6b4bf09be36c4e0efefa`；包含源码/结果/身份/截图/实际方向/清理记录 |

相对路径未标全的文件均在同一ignored自有目录。原件由实际Web download保存，未重新加密或离线拼装。独立再用正式decryptBackup/inspectArchive核原SHA、全部rows与expected完全相等。备份口令只程序读取现正式F20测试唯一 `f20Password` 字面量，manifest只留来源变量，不写口令值。没有KDBX/额外主密码或真实账号凭据。

## 数据身份（全部自造）

9行仅5个普通资产（4账号＋1项目）和4条关系。review、category、preference、附件及KDBX均为0/无，expected明确记录这些空范围；不把内置分类或Web图相机状态说成已存普通preference。

| 用途 | 实际名称 | 原ID |
| --- | --- | --- |
| 图账号 | Graph Mail QA abb4f7ab | `9938c470-e475-47f9-9293-e0c2f4f9a338` |
| 图账号 | Graph Studio QA abb4f7ab | `36397f74-a85f-4ac1-bf8a-bef2b7eca02c` |
| 图账号 | Graph Design QA abb4f7ab | `82506815-cb68-4ac9-b0c0-8082853fc342` |
| 图账号 | Graph Backup QA abb4f7ab | `6109cb05-e150-4585-818a-e80d4ed51e87` |
| 仅name允许后续明确批准的CAS目标 | CAS Target QA abb4f7ab | `c022983b-cece-449a-b09e-fa6c22c9e87f` |

| 关系ID | from→to | 用途／来源／核验日 |
| --- | --- | --- |
| `96645fc7-68dd-4aee-97ea-9aa7ab115b4a` | `9938c470-e475-47f9-9293-e0c2f4f9a338` → `36397f74-a85f-4ac1-bf8a-bef2b7eca02c` | Ring 1 QA abb4f7ab / Synthetic UI source 1 abb4f7ab / 2026-10-20 |
| `b2130d5c-836d-4e66-938a-3238e2f46925` | `36397f74-a85f-4ac1-bf8a-bef2b7eca02c` → `82506815-cb68-4ac9-b0c0-8082853fc342` | Ring 2 QA abb4f7ab / Synthetic UI source 2 abb4f7ab / 2026-10-21 |
| `84f7fbe9-3391-431c-950f-452aeda58068` | `82506815-cb68-4ac9-b0c0-8082853fc342` → `6109cb05-e150-4585-818a-e80d4ed51e87` | Ring 3 QA abb4f7ab / Synthetic UI source 3 abb4f7ab / 2026-10-22 |
| `3a332478-b0f6-4971-8da5-e6c5c68c66de` | `6109cb05-e150-4585-818a-e80d4ed51e87` → `9938c470-e475-47f9-9293-e0c2f4f9a338` | Ring 4 QA abb4f7ab / Synthetic UI source 4 abb4f7ab / 2026-10-23 |

四账号按Mail→Studio→Design→Backup→Mail形成有向环；CAS项目完全不建立关系，不加入其连通分量。默认Direct应是当前账号与两邻居3nodes/2edges，显式选择Family后才4nodes/4edges；不能要求恢复新context默认就是Family。每个资产/关系完整全部字段、原id/createdAt/updatedAt都在expected，不仅靠计数。

## 实际生成与Web预验

构建在Repo Swift/CI提交后实际clean窗口进行：`ea72c065babf95e135144162ed5714ebb62ba655`；构建前后HEAD相同、工作树均clean，413个产品文件逐SHA无变化，原件在source-before.json/source-after.json。之后他人产生的release/web untracked产物未读取改写/暂存，不以构建前clean推定其它时刻整树clean。

生产静态4250，自有全新context、390×844/hasTouch且真实coarse=true；无HMR、`/@fs`、源码/DB写、隐藏hook或ShipAny。所有账号、别名、关系用途/方向/来源/日期和孤立项目均通过正式新增表单、Select、Save建立。复用原account-detail-dedupe约198行的4账号环步骤与现有account-graph/select-choice helper，没有修改共同测试或产品。

最终一次实际执行23.730秒：同一9行数据切英文/中文，各自完整执行内联Direct3/2→Family4/4→展开→逐一访问另外3账号；每次核全4原节点ID、4边ID及原from/to，相同Dialog DOM仍连接；下一节点点击前Fit all并核4节点入框。浏览器Back/Forward后scope保持；退出全屏后展开按钮获得焦点/zoom1；Escape与header关闭均恢复焦点；切Direct并reload仍3/2。没有用点入口代替完整流程。

两语`family-three-visits-*.png`为自然390×844截图，前后inner尺寸逐值相同；已目检。它们是最后账号zoom1 Focus状态，允许相邻节点裁出视框，**不是声称最后截图是Fit all**；每次点击前的4节点入框有独立真实几何断言。正式`formal-backup-ready-original.png`已目检，密码输入遮蔽、真实Save backup file出现；按actualdownload读取才交付原件。

最早两次夹具前置失败独立保留：首次误用Project新增并不存在的notes控件，实际停未保存项目表单至180秒；第二次英语UI下误找中文语言标签，英文图流程已过但中文未开始。最后只改ignored脚本为实际Short description与正式language value，15秒操作上限，重新空context生成最终新ID；没有产品修复、数据补写或继承旧失败的ID作成功。

## 下一Native owner的最小合同

1. 先核固定APK/安全handoff及本KA1完整SHA，用真实DocumentsUI恢复到新的隔离namespace，不覆盖原库、M0故障26行或历史候选。恢复后先全9row/payload/updatedAt与空review/附件/KDBX范围核对，再做UI。
2. 从Mail账号Direct开始，显式Family验证4/4，触控展开后按实际ID连续3账号，核关系ID/方向、同Dialog与范围；Android系统Back是本片没有的新N证据。不要把4条边就当任意拓扑已经满足。
3. CAS仅选上表project：手机旧Edit改稿未保存，PC真实SDK仅preview该project.name并获手机明确批准后confirm；手机旧Save应拒绝且保稿、新name/其他完整字段不被覆盖。取消重读后明确重试；没有图片并发或第二Native writer承诺。
4. Native回传若需Web接收另开receiver/端口及新context，原件/expected保持不可变，不拿本Web预验倒灌为N。

## 收尾

自有context已finally关闭，4250前台PTY正常Ctrl+C；实际listener0、自有fixture/preview Node0。下载临时副本随context正常关闭，保留原件/expected/manifest/截图和失败原记录。对整个自有目录逐文件扫描两项F20合成秘密原始literal，命中0；仅此限定literal阴性，不承诺所有编码/所有日志。没有打印凭据，临时进程退出，无后台继续持有它们。

READY：仅可交付fixture与Web预验，等待Root正式Native恢复交接。此片只提交本独立中文报告，所有夹具/脚本/产物在ignored目录。
