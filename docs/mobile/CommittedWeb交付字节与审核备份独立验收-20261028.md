# Committed Web 交付字节与审核备份独立验收（2026-10-28）

本片独立只读审查 `8323212aba8fd688c835201b62f2da0e277fb2b5` 的attributes/verifier窄改及交付原件，并实际执行现有两语审核备份用例。没有改产品、公共测试、Root的attributes/脚本/retained manifest/release或CI；不把2B算267项、23组、Android或desktop整包验收。

## 源码审查与生成身份

- `release/web/** -text`、`apps/web/public/** -text` 保持交付原字节；`apps/web/index.html text eol=lf` 固定构建HTML输入。用户 `core.autocrlf=true` 前后保持，未改全局或仓库配置。
- verifier只为 `assets/pdf.worker.min-Dswkl-cV.mjs` 且SHA `8ab0e5e30031b4a06ecfddd5ae9562f0227f830ee7ec9ed1a968b134243d2386` 增加精确例外。该continue仍经过后续retained manifest digest核对；其它mjs不进原JS/CSS白名单，current每文件bytes相等检查没有放宽。
- Root生成元数据的源码是 `3f04bf9e6b7531871a938641c19486966f5ac2e9`。初始clean与最后canonical-input重建非整树clean需区分，Root已更正原字段；本片不把最后重建称clean。本片审计开始时存在他人iOS dirty，未改动/暂存它们。
- Root随后独立完成 `9cf21a7ae3646679a33c035934b3bb51052a6e5e` postcommit clean复构；`committed-web-refresh/post-commit-source.json` SHA `f04b66e5b3f5ce30f71e24136aaf2e36c48792017bf15b0002d3d5939276948e`。它是Root另一次窗口，不倒灌为本片832审查或浏览器源身份。

## 独立实际字节核对

1. 实际 `git archive 8323212a` 读取release/web、public、index共2787文件/288601501 B，每一entry计算Git blob对象哈希，全部等于该提交tree OID；未手工解读所有minified chunk。
2. 使用自有ignored临时index与worktree实际checkout相同2787目标文件，显式保 `core.autocrlf=true`；每文件SHA均等于archive canonical bytes。共享Git index未改。archive和checkout两条均实际执行，不假设archive永远忽略EOL转换。
3. 再对真实将被浏览器服务的工作树目标逐SHA核对，也全部等于832 archive，不仅验证某份解包副本。实际served index SHA `c0e070b808520cdddd7707cb04f8ec443b2b314f833a598b7894a3d89bcdef4b`。
4. 前一提交中的2678个旧versioned路径（含仍被current复用者）全保相同Git blob，无缺失/改字节；它不是retained manifest的2659项计数。正常只读verifier实际通过116 current逐bytes＋2659明确retained，未运行record写模式。
5. 在自有hermetic目录复制现verifier实际CLI独立复核五条件：合法旧worker接受；worker改bytes即使改manifest仍拒；任意mjs即使manifest匹配仍拒；意外JSON拒；current错bytes拒。没有改Root原五条件脚本或结果。

初次审计脚本把`.gitattributes`等策略外metadata也放入“每entry canonical”目标，该文件本身仍受普通autocrlf转换，触发范围错误；保留`initial-audit-scope-note.json`，后只核用户要求的交付/public/index目标。未改设置或目标内容来获得通过，该前置不算产品交付红。

## 实际 committed-release Web 两语回归

使用原 `playwright.release.config.ts` 与原 `tests/e2e/intake-review-backup.spec.ts`，专用空闲4252，`KEEPANY_RELEASE_WEB_DIR=../../release/web`；直接node CLI、独立output/evidence，未启动开发源服务或HMR。4253未使用。

原两语完整步骤全部保留：正式CSV三个候选→编辑pending草稿/确认一条/忽略一条→两个真实文本PDF，选择资料类型/编辑草稿/查看提取原文/忽略→真实加密KA1 download→正式decryptBackup读取records与完整intake-review→新干净context预览确认/刷新→导出全review深等→重命名同CSV/PDF再次收录去重仍5条→全rows/candidates深等→恢复PDF原文/类型/草稿保持→最后正式确认入库并在账号列表可见。

结果：zh-CN与en-US两条12.095秒通过，0失败/skip/retry，pageerror为空、原无横溢出断言保持。没有为了获得绿修改前置、locator或业务断言。输入合成口令只由原测试自身使用，本片不额外输出；下载临时文件按原context正常清理，没有声称另留新的KA1原件SHA。

两语原PNG已目检：它们是原spec的390px全页长审核截图（英文390×4067、中文390×3746），用于保留草稿/回执界面；不把全页截图里的fixed footer位置当自然390×844的完整键盘/遮挡验收，也不以两图给全应用视觉结项。

## 证据与收尾

同一ignored目录 `test-results/committed-web-audit/`：

| 证据 | SHA256 |
| --- | --- |
| `summary.json` | `fed83285165071c0b6001dafc00d5aaa2207171b6d2122ca36997ca0a671ab5a` |
| `git-byte-audit.json`（archive/真实checkout/实际工作树全目标） | `9fd060fd2a29d5f75abd724488a5d7c026254ebe628df12d6b8fb7a79b874bc7` |
| `playwright-results.json` | `7a1a082acb1d6dbf5b134b394c59ead48336db0752d946ee879d9e8290bccfda` |

其余独立五CLI结果、旧versioned全保结果、checkout及PNG保留原件供复核。源码审查未发现需报告的新增窄修错误，已知构建clean元数据按上述Root更正分开。

Playwright管理的自有4252服务正常结束，4252/4253 listener均0，自有audit Node后台0；原两用例的4个source/destination contexts均finally关闭。保留自有证据目录，不删除用户/他人资料或此前审批拒绝目标。无ADB/CDP、Native服务、4180/4196、依赖安装、CI触发或push。只提交本独立报告。
