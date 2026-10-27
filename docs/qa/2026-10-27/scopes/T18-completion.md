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

## 未完成与下步

- 已增加无浏览器源码导入的 `qa-t18-portable-completion.spec.ts`，待主控重打最终便携候选后执行：真实默认URL接口、UI确认/取消、CSV原文、实际下载KA1及干净隔离context恢复/刷新/再下载逐条相等。
- 大CSV完整备份/恢复及sourceText载体被清理时转移，由普通审核数据层小包补证；不以CSV stage单测代替真实备份。
- 主控已修复URL description字段对齐和凭据URL手动fallback问题，本包最终6场景复验通过。后续新便携候选仍须重新验收，不能以源码结果替代。

## 提交、部署与清理

独立解析/抓取与单测提交 `38a4de9`。主控拥有workflows、Vite与便携server接线，普通审核小包拥有review schema与原文引用持久化。未推送、未发布官网/Release、未替换4180。全部测试context由finally关闭，4207测试服务已退出；临时大报告留忽略目录。新便携候选身份和最终总表结论由主控统一回读后补记。
