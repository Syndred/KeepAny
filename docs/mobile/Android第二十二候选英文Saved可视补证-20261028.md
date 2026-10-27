# N22英文 Saved 收据真实可视补证

2026-10-28，承接 [N22历史双品牌回执](Android第二十二候选历史KA1双品牌实装回执-20261028.md) 的明确视觉缺口。旧001实际系统保存、DOM收据、逐字段回拉仍有效；旧 `stackperch-real-saved-en.png` 仍只证明当时备份卡区域，**不倒改为英文收据图**。本片只生成一个新002系统保存文件并补英文原生可视证据，没有重复恢复或新增资料集。

## 身份与范围

开工 fetch origin 成功，相对origin/main缺失0、工作树无他人变更。核原 handoff `0e50f369822c2981ab6297c50ff0319b6c73be5c0e0427bb9272aca1320729af`，原英文 `keepany-v1` Locked / Master password 空、135和70以及两个20条历史候选的完整基线。仍是唯一 `emulator-5580`：设备实际 base.apk SHA256 `e9ca2b93e4a92632fa64801d6758b0204277becb3c1581f0ac553c5f53a83b68`，源 `85ff2ba3e4de1074115ff372cf6144e6c3377063`。没有再次安装主包。

只沿正式 More → Create backup → 对应时间唯一卡片切到既有 StackPerch namespace `keepany-data-3300b57f-e84c-4380-84b4-40e345f1743a`，控制库 active pointer 精确核实。没有新建恢复、解锁任何 Native KDBX、编辑普通记录，0 AI/MCP请求；没有操作4248或9445/9446/9447服务。

## 新002真实系统保存

程序读取既有合成备份密码引用，只填正式 password 控件；Create backup → Save or share file → Android DocumentsUI Downloads，唯一新文件名 `keepany-n22-stackperch-saved-visual-20261028-002.ka1`，确认文件名后点 SAVE。正式 UI 等到准确 saved/read-back 文案，立即读回实际 `/sdcard/Download/` 文件并核 `KEEPANY1`，没有用App缓存或旧001代替。

- host原件：`test-results/native-stackperch-saved-visual-n22/keepany-n22-stackperch-saved-visual-20261028-002.ka1`。
- 9006 B；SHA256 `0e378d949b3a527a79c0adb978758eadab332ba12152d98cf033f0738b8f4c83`。
- 正式 `decryptBackup` / `inspectArchive` 只读回拉：全部20条ID/type/完整payload/updatedAt、1待审核、原图、KDBX密文与revision/updatedAt同对应expected。仅在Node内存加载该合成输出KDBX，原主密码有效、v4/1entry/root UUID同前置，随后释放；不是Native密码UI或另一次干净Web恢复。没有要求接收器重复跑002。

旧两份001的host及Downloads实际字节在结束前再次核同：KeepAny9030 B / `6c4adb01dfdc165851cb52ab8853da71c08495339e238bbda0d55dfac946d9f3`；StackPerch9007 B / `6bd8d12dbe993a99ba1966a78a536bead693427291b77c2a5d9d8a4bb2f5a8c5`。未覆盖、移动或删除001。

## 原生自然滚动与实际目检

本次在清密码前保留真实Saved状态，只有正常只读几何/绘制观察，没有改DOM、CSS、文案、业务状态或截图。Native视口412×660 CSS px，初始notice顶部y2237.32，处在长资料集列表之后；9次真实 `adb shell input swipe` 从屏幕右侧向上滚动，最终notice矩形x16、y444.94、width380.19、height66.81，完整落在底栏上方，中心原生页面hit-test为自身。密码控件仍type=password且非空，已自然滚到视口外。

等待正常两次requestAnimationFrame和500ms实际绘制后，`adb exec-out screencap -p` 保存未经裁切/蒙层/拼接/图像编辑的原图，并实际view：

`test-results/native-stackperch-saved-visual-n22/english-saved-notice-natural-viewport.png`

185570 B，SHA256 **`b4516ebdeee61d95e4e892abc793aa1aafb93d5a87895328ef8c63efd5677ccd`**。

原图黄色notice中完整两句实际可见：

> The file was saved and read back for verification. Keep the file and its password safe.

文字没有被底栏或键盘遮挡，密码框不在图内。DOM矩形与命中仅作辅助，结论来自该原生原图目检；没有拿heading、DOM文本存在或旧Encrypted file ready文案当成功反馈。当前自然滚动可以到达完整正文，未发现本次收据不可达UX红。

## 保持、清理和READY

截图目检后才用正式输入清空备份密码，确认值为空；正式切回Initial dataset / In use，再进入原英文 Passwords，Locked / Master password 空。最终原锁页原图 `final-original-locked.png` 已实际view，SHA `81bac17ce880ea9ee697df98077027acb16155fa0389e49f5540fa99388d6be0`。未直接读取或解锁原业务/KDBX。

四个授权合成namespace前后全部记录和审核完整保持，三类journal均0；两个历史候选还核实际图/KDBX字节和完整pointer元数据前后相同。control名册/恢复意图/原active pointer完全同开工，没有新增候选。135原SHA `67e9e98e8892c1e0b73fb9241c2f7aa73759fcc0c8f48843a9ef6e3412012c67`；70原SHA `6a0a383ef7ad9747448e0d8fa2dfe00e46c7e6585d090749a1633737b67ee69e`；7审核六列SHA `20aa4e6a6bd910c6f5fb6d5a0300be1bcfe855a716de7ef4448c4771211d7090`。AI配置和既有control文件原字节不变。

无hook/newDoc脚本；自造DocumentsUI XML已删，CDP断开，自有9436 forward移除，forward/reverse列表空。controller3529已退出、内存合成凭据清除；自有84文件秘密字面扫描0。保留唯一002新保存原件，旧001、历史输入、旧deferred、其他服务未动。

正式工具/产品READY handoff：`test-results/native-stackperch-saved-visual-n22/handoff.json`，5780 B，SHA256 `91e6a2750d530a4c77aad32fdc49f493c38348b7d57ecb9f4054b3030a44f9fc`，已交主控并停止设备操作。

| 自有ignored证据 | SHA256 |
| --- | --- |
| `notice-geometry.json` | `cb591078f1bceac715a4b82909082d601ed32cf4561835ee268298ac304457d1` |
| `visual-confirmation.json` | `4d57550828d1a79caed8a1b37f9546539294d9ded79a652d787e4ef22616d4ca` |
| `stackperch-saved-readback.json` | `c9f11fb449acbb230b40444d99d522d5db985e839fb116f0531e906d3bd14df3` |
| `final-preservation.json` | `0b63a01a49c47d861e26641ea00677ca6b3a0b7166ef8ffbad8c1cbe17f24038` |

## 边界与提交

本片只关闭英文Saved反馈可视缺口，保留原845回执在原时点的限制；不重复归因旧截图、不扩张F20/23组为全部通过。F10、其他M0故障、Native密码UI/干净Web往返/物理Android/iOS不在本片。只提交本新中文回执，所有合成文件/控制器/原图保持ignored；未改产品、共享152/08/README，未push或干扰正在运行的Apple CI。
