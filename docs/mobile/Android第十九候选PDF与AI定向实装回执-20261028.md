# Android 第十九候选 PDF 与 AI 定向实装回执（2026-10-28）

## 完成与候选身份

只操作主控正式交接的 `emulator-5580`，独占自有 CDP9436。接管前核 N18 handoff SHA256 `b795ebc6dc4da4c2ad32c07a5e520e61c8e66c5b30d070b323c42f4d6a5889e2`，确认原 `keepany-v1` Locked、主密码输入为空。仅 `install -r` 保留资料覆盖安装主控冻结 N19，没有 clear data、重启 ADB server、启动新 AVD、自行构建或 push。

N19 固定源 `39046f3158e6f7d818e983e04af943259ab380df`；实际安装后从设备 `pm path` 得到的 base.apk 读回 **23694603B**，SHA256 **`cfa4514057dd9dbf2bcff047e29422118e5c864ba6459e94eec35fba5e7448dc`**，与冻结包完全相同。首开真实概览可交互。主控已核产物中的 worker 1270778B / SHA `d2b7b27957ae448dbe8ce0ec789f238905cc6d36b3cb2b72c4ea161324734b95`；本片不拿后来工作区源码替代冻结包身份。

通过正式“本机资料”界面切入授权普通候选 `keepany-data-a3544b4c-12a3-4b8a-86da-b3498a68236e`。前、中、结束后的真实 Android SQLite 普通 records 都是 **135 行**，完整投影 SHA256 均为 **`67e9e98e8892c1e0b73fb9241c2f7aa73759fcc0c8f48843a9ef6e3412012c67`**；因此交接保全的旧127子集也随这135行保持。不是 IndexedDB 代替证据。

## PDF：实际系统选择、原限制与旧决定

文件均为已知合成 PDF，仅经 Android DocumentsUI 的 fresh Search / 唯一可见 title 实选。被动 change 观察核对实际名称、大小和 SHA，再以 busy、旧 notice 清空、新 notice、输入恢复判本次返回；没有 setInputFiles、模拟解析或绕 UI 写库。

| 操作 / 预期 | 实际 |
| --- | --- |
| 英文683B继承父资源读取 | SHA `a3d884367a63416634b2613377d4f20c816d14f44a45494cc11688a96837bf07`；1401.3ms，输入恢复 |
| 英文697B独立继承资源读取 | SHA `e7c21144389367d6216209e193ca9bdf45f8f9f63a8d835d71ed28c4fa288991`；1601.2ms，输入恢复 |
| 20001字符应拒绝 | 20582B，SHA `8f1e3201ebcf23fc64e1a4530c7a0a5c37c98c91f879017587f929f3b4a2f723`；1766.7ms，正式20k限额提示、输入恢复 |
| 拒绝后重新实选同697字节 | 实际同名/同大小/同 SHA；1470.9ms 返回。展开提取原文，完整两行均匹配 |
| 中文同683最小界面 | 实际同 SHA；1922.8ms，中文新 notice、输入恢复，完整两行原文匹配 |
| 旧 duplicate / Ignore 决策 | 两语界面都保留原7审核行（3 confirmed、3 ignored、1原文字 pending）。原同 SHA 已确认记录显示原项目链接与撤销入口，没有重复 Confirm；没有点击确认、撤回或修改旧决定 |

PDF 后实际关闭 App 并取 SQLite 一致性副本：135行全量不变，`intakeReview` 的 id/status 与接管副本逐行相同，7条审核保留；`journal` / `importJournal` / `categoryEditJournal` 全为0。重开后继续普通资料工作。

初次截图恰逢 `onCsvStaged` 刷新时 reviewRows 暂为0，随后稳定7行和 SQL 独立核对，不据中间渲染声称删除。数次 helper 在系统 Search 展开前尚未收到 File change 就停止，属于选择器前置；保留截图/状态，等待 fresh 窄 Search 图标、唯一 title 后才继续，没有盲点文件，也不记为 PDF 读取失败。辅助监听最后移除，进程重开和最终原库页面均无观察 hook。

## AI：实际 Native HTTPS、范围与错误后重试

只用主控既有无 CORS 的受控9447 HTTPS 服务及原测试 CA/hosts。公有 CA DER SHA `d4f22271eaeee836e4f4171e802bfc00c5b47131e91ce4b834b1965c210aae15` 匹配；没有修改 CA、SAN、信任或 TLS 校验。确认 reverse 空后才建立自有9447 reverse，每批结束移除。9445/9446、服务器进程及其他控制文件不动。

仅程序读取指定文件中的三项合成 AI 参数，值不打印。正式 More → AI 问答对话框使用临时 compatible 配置，不保存设置或 KDBX；唯一选择合成项目 `9ecee0d0-9054-430b-94a6-13850c3e8c28` / revision13。两语均先显示发送范围说明，配置、选择、问题就绪后实际新增 POST 为0，再明确点击发送。

实际服务收到的 user prompt 每次仅一条该项目，`kind/name/description/url/dueDate/amount/currency` 与该记录精确匹配，问题相同；没有 notes、密码字段、全库或其他记录。system/user只有两条消息、输出预算3000；最后一次还独立核 SDK 外壳字段白名单、body 无 API key 字面值。私密请求正文只在内存审计，不复制入证据或 Git；不读取原主密码来做不可证的字符串比较。

| 语言 / 操作 | 实际 |
| --- | --- |
| 英文200 | 实际 Android → HTTPS → 200，约4301ms。已收到固定合成回答，scope精确、cookie0、服务无CORS头 |
| **英文**真实在途取消 | 服务已接受8s延迟请求后才点击 Stop generation；UI恢复739ms，服务记录 client-closed；问题和1项选择保留、未补答，同稿200重试成功 |
| **英文**原默认30s | 服务实际延迟35s；30935ms 显示专用 timeout 提示，完整位于视口；问题/选择保留，新增请求仅1、服务实际关闭连接；同稿200重试成功 |
| 英文503 | 实际503后1444ms 显示 Native 固定通用错误，无CORS建议且在视口；问题/选择保留、无自动重试；同稿200成功 |
| 中文最小补片 | 仅新增3 POST：中文200 → 503中文可视口提示 → 同稿200。scope仍同一项目/7字段，确认前0 POST、问题和选择保持、503只有1次请求；不重复或外推英文取消/30s矩阵 |

英文共7个真实请求：200×4、503×1、实际 client-closed×2；中文共3个：200×2、503×1。10个 accepted 都有终态，结束 pending0。这里是受控 compatible 协议的真实 Android 软件路径，不外推付费供应商、实体手机、iOS 或故意忽略 abort 的迟响应。

## 未完成、图片自审与阻塞

**正常回答正文完整进入视口的截图尚未满足。** 两语原 success 图仅露回答卡标题，正文在 dialog 滚动容器下方；协议/实际正文等待通过不等于已经目检全文可见。尚未测试实际滚动到正文后的完整呈现，不能据此声称正文不可访问，也不将本项写成视觉通过。

Native CDP 的 locator mask 在图片里发生偏移，不能当遮罩成功；可见模型只是公开合成模型，不记泄密。API key 本身仍是 password 圆点，英文46份、中文51份自有文件的该合成 key 字面扫描均为0；扫描范围不包括原库基线，结果不代表全 App 安全审计。错误提示的视口几何已实测且原图能看到全文，但后续可分享图片仍需可靠捕获，不能用有偏移的 mask 冒充遮挡完成。

设备已 READY 正式交出，由 Acceptance 继续 Native70；本代理停止全部 ADB/CDP。下一次须主控明确再交接，只补两语各一个200：真实滚动 dialog 使配置自然出视口，再用原生截图或可靠 viewport 捕获完整回答，不改业务 DOM/CSS、不裁图取绿、不用 AI 改截图。若实际无法滚到完整答案，先留真实 UI 红再修。

历史 N16 transient startup 未关因；N18第一次 PDF timeout 未保留精确输入身份，N19已知样本成功不证明其根因。没有用本片核销密码全文 AI、全部PDF失败路径或全功能合同。

## 结束安全状态与证据

2026-10-27T21:03:06Z 交接时，真实指针 `keepany-v1`，原库 Locked / master空；未打开原KDBX文件、未解锁、未访问旧7928/7731私密控制器。候选135及7审核决定保持，三个 journal0。每批临时 key/model/address 清空、dialog关闭，原 AI control 逐字恢复、语言恢复en，两个方向转发列表均空；自有9436断开、自有控制器正常退出，3份自有设备PDF和自有UI XML清理，原KA1/KDBX文件未选择或修改。

所有原始日志、SQLite副本、图片只在忽略目录 `test-results/native-nineteenth/`，不入 Git。

| 证据 | SHA256 |
| --- | --- |
| `handoff.json` | `c5d634833acddd4bf74dfe28971f3f763acc386fd81005da810f8c187c66cf28` |
| `actions.jsonl` | `a05dd70105d60092db201c04ad1a3b658bae73cd3ddfb2ca30f7c62cd81badd5` |
| `final-safety.json` | `c9cb931eda55edd429538e13109d6343e17890b33fe916b86f6d1da197be5255` |
| `ai-native-metrics-en.json` | `2003efd938c01190865a1157da72f8f8411c068466920b395932492b9f7dbcf5` |
| `ai-native-metrics-zh.json` | `109bb84917719702456e6c750c9d2e5067785d1e88c396edfbd849f29fcc8697` |
| `evidence-manifest.json`（25份图/JSON/日志摘要） | `48871faf199e1f8875395097b73a4f6dcabdcdfbc447e97bab19359d40a66f1d` |

图：`pdf-en-full-review.png` / `pdf-zh-full-review.png` 为实际两语完整原文；`ai-timeout-visible.png`、`ai-503-visible.png` / `ai-zh-503-visible.png` 为实际错误反馈；`ai-success.png` / `ai-zh-success.png` **仅为最初部分可见的界面观察，未满足正常全文截图**；`final-original-locked.png` 是交接锁页。mask偏移问题按上一节保留，不把有瑕疵的证据展示成已完成图片。

## 135行摘要的精确格式

`67e9…12c67` 是记录投影 JSON 的 SHA，不是 SQLite 文件 SHA。读取 `SELECT * FROM records ORDER BY id`，使用 SQLite 默认 BINARY 排序；过滤 `!internal_deleted`。按以下固定 key 顺序投影，payload解析后保留原对象成员顺序，不排序 keys：

```js
const projected = rows.filter(row => !row.internal_deleted).map(row => ({
  id: row.id, type: row.type, payload: JSON.parse(row.payload),
  updatedAt: row.updated_at, revision: row.revision,
  internalDeleted: Number(row.internal_deleted),
}));
const digest = createHash('sha256').update(JSON.stringify(projected), 'utf8').digest('hex');
```

数字字段保持数字；尤其 internalDeleted 是数字0，不是false。JSON无缩进、尾换行、replacer或ASCII转义。初次辅助投影误转布尔时摘要不同，核对字段后修正，真实记录未变；保留此测试前置纠正，不记产品红。可复核的公开合成135数组是 `before-ordinary-rows.json` / `final-ordinary-rows.json`（pretty数组、payload对象）；对其 `JSON.stringify(JSON.parse(file))` 即得相同摘要。不同投影摘要先逐字段核对，不能仅凭摘要差异断言业务数据变化。

## 提交与部署状态

本片只提交这份新回执；产品源码、其他代理测试和总表不改。安装的是主控已冻结N19；没有新构建、push、部署或操作 Apple CI。后续两语完整正常截图在明确设备交接后补，不能提前标绿。
