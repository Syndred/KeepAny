# T18-01/02 功能补齐与实际验收

日期：2026-10-27；Windows、隔离 Chromium、源码测试端口4207。合成文件、合成受控网页；另使用公开 `https://example.com/` 核对正式默认抓取路由。未访问用户4180或真实浏览器资料。

## 完成

- CSV保持原2MiB/200行上限，以严格UTF-8读取，保留BOM、CRLF、引号内换行与原始全部文本。首个有效候选保存全文，其他候选以fileHash引用；兼容旧候选缺少原文的格式，不改变原ID/hash/行号或已有审核决定。完整跨行引用、重导与删除载体保护由普通审核数据层小包共同接线。
- 普通URL由本机同源接口执行有界GET，不依赖AI或目标站CORS；标题、description只进入可编辑预览。确认才入库，切换模式取消不新增记录；读取失败保留手动收录路径。
- 公共目标仅http(s)，拒绝URL凭据、私网/loopback/保留地址与混合public/private DNS。每跳重定向重新校验DNS，连接固定到已验证地址；不携带Cookie、Authorization或浏览器页面凭据。最多4跳、1MiB HTML、8秒，接口同源Host/Origin/custom-header校验、4并发上限、4KiB请求体与取消释放。
- 浏览器在inert template中读取元数据，不将目标HTML挂入页面。实际合成脚本未执行，图片/iframe目标请求数为0。

## 已运行证据

|范围|真实结果|证据|
|---|---|---|
|独立单测|10/10通过，0失败/跳过。CSV全文/非法UTF-8/近2MiB×200行只保存单份；真实HTTP、私网/映射IPv6、混合DNS、固定DNS连接、重定向、内容类型/编码、大小/超时、同源与请求体、4并发取消重试。|`test-results/T18-core-unit-final.json`；测试源见 `intake-csv.test.ts`、`intake-url-metadata.test.ts`。|
|源码中英390/1280|4/4通过。预览title/description，编辑、取消、确认、刷新；CSV重复拒绝、仅确认项入库、未选草稿保留、BOM/CRLF全文与引用逐字回读；pageerror为0，无页面横向溢出。|`qa-t18-completion.spec.ts`，冻结运行 `test-results/T18-completion-frozen-results.json`。|
|正式默认Vite路由|1/1通过。实际抓取公网Example Domain标题；未注入例外的本机目标返回422 metadata-private；资产保持0。|同上第5场景。|
|凭据URL边界|1/1修复复测通过。含用户名/密码和仅含用户名的http(s)输入均提示非法、零候选、零资产、零目标请求。|同上第6场景；红测 `test-results/T18-credential-red-final-results.json`。|
|检查|类型通过；8个本包文件Biome lint零诊断。|本机命令输出。|

冻结源码原5场景为 **5 passed，18.205秒**。随后独立review发现凭据URL仍可退回普通候选，主控修复入口并整理description字段间距；最终 **6 passed，20.807秒，0失败/跳过/重试**，回执 `test-results/T18-completion-guard-final-results.json`。受控网页4组合通过Playwright截获同源接口，再调用同一Node handler并注入精确合成loopback origin；handler执行真实HTTP GET。此为受控服务验证，不冒充正式默认接口允许私网；另1条使用未注入例外的真实Vite接口核对公网和私网拒绝。

首次失败：Playwright接口截获发生在浏览器传输层补Host之前，夹具构造的Request缺Host，产品正确403并显示手动fallback，四组合都在标题断言失败。夹具改为由实际目标URL重建传输Host，并保留浏览器Origin/custom header；原断言全部通过。没有放宽产品同源门槛。首次输出保留在 `test-results/T18-completion-first`、第二轮2/2在 `T18-completion-second`；最终以冻结运行回执为准。

真实产品问题：元数据helper拒绝凭据URL，但入口把所有读取错误转为手动预览，实际仍出现1个可确认候选（0资产/0目标请求）。有效红测复现后，主控在入口拒绝username/password及超长URL，仍保留正常网络失败的手动回退；第6场景原断言通过。首次红测英文错误文案曾猜错，改用实际文案key后再独立复现，未把夹具文本错误混算成产品缺陷。

中英代表图在 [T18-completion](../evidence/T18-completion/)。已工具目检中文390原文、中文390/英文1280元数据预览：原文换行、名称/description/来源/确认入口可见，description改为统一字段宽度后不再和URL叠挤；页面可滚动，实际确认操作通过。

## 最终便携候选实际续验

最终本机候选为 `KeepAny-0.1.0-preview.745565a93c5d.dirty-portable.zip`，版本manifest的sourceCommit为 `745565a93c5dfa3b6e2ff2a3496c105c7ac5234b`、sourceDirty为true。实际回读ZIP SHA256为 `925736b7aa36efc098f85bcf400d3fec954e89f339b3e83af9a5fee161fe77c9`，在主控启动的4211验收；没有把源码服务冒充便携服务。

`qa-t18-portable-completion.spec.ts` 最终 **2/2通过，17.363秒，0失败/跳过/重试**，报告 `test-results/completion-t18-production-results.json`。中文390、英文1280均从正式UI读取公网Example Domain标题、取消后实际备份为零记录，再确认人工修改的名称/description并刷新。默认接口拒绝合成loopback目标，返回422 metadata-private；探针使用127.0.0.1:1，未将用户4180作为目标。

两组合均选择CSV、确认首条、拒绝重复、保留另两条待审核资料及修改稿，实际下载KA1并在干净context正式预览/恢复/刷新，再下载解密逐字段相等：2资产、3候选、原BOM/CRLF全文1份及2个引用完整。两个context均记录 `sourceRequests=[]`、`pageerror=[]`，没有浏览器 `/@fs/` 或 `/@vite/` 源码注入。已目检 [中文390恢复图](../evidence/T18-completion/T18-portable-zh-CN-390.png) 和 [英文1280恢复图](../evidence/T18-completion/T18-portable-en-1280.png)，原文、已确认项、待审核修改稿和操作可读，无页面横向溢出。

近2MiB/200行的完整备份与独立库恢复、载体移除后的原文转移、缺carrier归档拒绝，已由 [T19普通审核数据层回执](T19-completion.md) 补齐：单份原文＋199引用、候选JSON小于3MiB，不提高原备份预算。普通CSV原文与URL元数据两个缺口已有本轮源码、异常路径及新候选交付包证据；最终104项总表由主控统一收口。

## 提交、部署与清理

独立解析/抓取与单测提交 `38a4de9`，源码验收小回执 `ce6d841`。主控拥有workflows、Vite与便携server接线，普通审核小包拥有review schema与原文引用持久化。最终生产续验文档由主控统一串行提交与推送；未发布官网/Release、未替换4180。全部本包测试context已finally关闭，4207源码测试服务早已退出，4211和PG由主控管理，本包没有停服或更改。临时报告与原生备份下载留忽略目录；机器回执已补最终包身份及两条结果。

## 最终候选类型标注收口补验

主控收尾补开发配置缓存变量的显式类型，运行代码不变；重打7df5d0e最终候选（SHA256 b006efe0…e97db2a），103Web和本机服务与前述32项通过的首候选逐字节一致。仍实际补跑源码6/6（20.4秒）、最终生产2/2（17.1秒）及Windows启动器，全部通过；原始回执为test-results/completion-final-affected-source.json、completion-final-affected-production.json，完整身份和限制见主控最终记录。没有把首候选全部32场景冒称重跑在最终ZIP。
