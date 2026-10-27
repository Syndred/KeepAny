# Android 第二十一候选：正式启动与两语 AI 正文补证

## 本片实际完成

同一自建 emulator-5580，N21 已完成正式首次启动、135→70→135 切换、单次 intake 全重载，以及 N20 原失败项目详情的精确 document 导航。之后仅英文/中文各一次受控 HTTPS 200；两张 ADB 原图经真实触控滚动，完整回答正文已分别目检，配置自然滚出视口。结束正式回原 keepany-v1 英文 Locked、master 输入为空。

这是明确的窄范围 Native 实装结果，不表示全部手机合同/物理设备/iOS/所有供应商通过。原 N20 database-locked 红原件、独立 V3 旧红→N21 OS 绿，以及 N19 原正常正文截图缺口均保留，不倒改旧结果。

## 冻结身份与原故障入口

N21 实际安装 base.apk 为 23694603B、SHA256 `fcdb05ea0d5a9db1ab3aa85c8153f51c89dbfc6b83b7ff6946aba3b410e3540e`，冻结源 `907ff9d694e2e3b0096fb1877665b75690b58067`。N21 使用独立控制器/计划副本，旧 c770/8b064 守卫文件没有覆盖。最初 relative import 的工具前置失败发生在 am start 之前；改正为独立 N21 plan 路径并重新核身份后才启动一次，不能记作 App 首启失败或重试。

- MainActivity 只启动一次，没有点 Try again。最早快速截图在 Native 尚未绘制时为白底；保留该图，随后未重启/重试/重载即到完整可交互壳，正常原生图已目检。未测精确首帧性能，不把 DOM-ready 直接当视觉验收。
- 正式 Local datasets 按唯一时间卡片确认切换；每次必须见 performance.timeOrigin 改变、正式壳无 startup stage、目标 In use。135→70 为 4317ms，70→135 为 4809ms；另一次显式 intake full reload 为 2244ms。期间无用户写事务中断。
- 原 N20 精确失败入口是 `/assets/project/9ecee0d0-9054-430b-94a6-13850c3e8c28`。本片在该详情做完整 document goto，timeOrigin 1793139971034.9→1793140027834.6、1814ms 到正式 heading，startup stage=null。随即 Native 135 快照仍原 SHA，固定 record revision=13，渲染 heading 与该 Native 记录匹配；不把 revision 说成 UI 显式显示值。

上述耗时包含驱动与就绪观察，仅当前软件模拟器本机结果。原 N16/其他未保全身份的瞬态原因不由本片推定关闭。

## 两语真实请求和正文

正式 More→询问 AI 助手，使用 dialog 临时 compatible 配置，不保存配置或 KDBX。每语先见真实发送范围说明，仅选 `asset:9ecee0d0-9054-430b-94a6-13850c3e8c28`，显式 Send 前新增请求=0；实际按一次按钮，各产生一个 accepted 与一个 200，总计 2 POST/2 success/0 pending。

| 界面语言 | Send 到响应及审计完成 | 实际正文原图 |
| --- | --- | --- |
| en | 3323ms | ai-en-normal-full-answer-final.png，完整两行回答 |
| zh-CN | 2745ms | ai-zh-normal-full-answer-final.png，完整中文单行回答含末标点 |

实际正文只在内存审计：单一选中项目，精确 `kind,name,description,url,dueDate,amount,currency` 七字段；没有 notes/password/master 字段、没有 API key 混入 body、只有固定 system+user 两消息、3000 输出预算。服务 metrics 的 cookiePresent=false/corsHeaders=false，固定假 model 匹配。本批是受控无 CORS 兼容 HTTPS fixture，不是付费供应商或模型质量/费用验证；合成服务返回 token 123/45 也不是实际账单。

两语最初仅返回标题在底边，正文确在框外，原图保留。随后各用两次真实 ADB input swipe，未改 DOM/CSS、未滚动脚本代替触控、未 mask/裁切/编辑图像。412×660 CSS 视口下，正文矩形均完整在 dialog 内、hit-test 无遮挡；这仅作辅证，最终两张 Native PNG 均实际目检，主控也独立目检。API key 输入始终 password；最终截图配置自然出框，不靠遮罩。先前聊天手抄图 SHA 的换行拼接错误，以本表程序计算 64 位 SHA 为准，原 PNG 未改。

## 全量保持与安全收尾

首次启动、切换重载链、AI 后及切回原库后，只对授权普通两库比较全部记录 JSON：SQL id 顺序，固定 `{id,type,payload:parsedJSON,updatedAt,revision,internalDeleted:Number}` 投影。所有字段、ID、类型、revision 与前置逐项一致，未仅按数量通过。

| 库 | 全记录 | 审核 |
| --- | --- | --- |
| 普通135 | 135，`67e9e98e8892c1e0b73fb9241c2f7aa73759fcc0c8f48843a9ef6e3412012c67` | 7，id/payload SHA `927b3618dec3f5afdb6fce4fa826cc9a47be432692960308eb388ebe75d265e2` |
| Native70 | 70，`6a0a383ef7ad9747448e0d8fa2dfe00e46c7e6585d090749a1633737b67ee69e` | 0，`4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |

另对这批真实 Native 前后快照的审核全部六列 `id,payload,scope,assetId,fileHash,status` 离线逐项比较，完全一致；普通135全列 SHA `20aa4e6a6bd910c6f5fb6d5a0300be1bcfe855a716de7ef4448c4771211d7090`。该补充与交接 id/payload 摘要不同，不能混写算法。`full-review-columns-comparison.json` SHA `e46ef04865f8f28ecf5337f2a605734fbb9735bc146aac8d806b1d655ca0db91`。两库 journal/importJournal/categoryEditJournal 均 0。

两语临时 key/model/URL 各自清空后才关闭 dialog；Native AI 持久配置值与前置原字节相同，ai-control 原 bytes 恢复。语言恢复 en。正式切 Initial dataset、等新文档 In use 后只进入 Passwords Locked，不直接读原业务表/KDBX、不解锁/输入主密码。最终原生 Locked 图已目检。

没有安装任何诊断 hook/newDoc 脚本；关自有 CDP、移除 only9436 forward 与 only9447 reverse，实际列表空。controller35156 已退出，fake key 引用清；76 自有证据文件已知合成 key literal 扫描 0。CA/hosts/9445–9447 服务进程未改，未创建设备公共文件、未清旧 deferred、未做历史备份/F10/额外 AI 错误批次。新 N22 没有在本片安装。

## 原件与交接

原件仅在忽略目录 `test-results/native-twenty-first-ui-ai/`，未将大 PNG/数据库/私密正文入 Git：

| 文件 | SHA256 |
| --- | --- |
| `startup-switch-reload.json` | `6c5dcb5747467ab07ca95de922fe3471a2a389da08fa191ab13a73e39742719f` |
| `original-detail-document-navigation.json` | `875e5dd99e4bbfd4ab1b8342cc1778ee89a3d8adce498f23099fa73a05c1f16c` |
| `ai-en-normal-full-answer-final.png` | `f806471c8b923ebe4e6bdd1f39e368ae865c3132cabfed6de1b2334ac18ec5ff` |
| `ai-zh-normal-full-answer-final.png` | `59bffdbb6beabb7dda69feabfe3c094a1071d8d10b10d54963fe2b18ea1438a5` |
| `ai-en-final-viewport.json` | `7f2b1e9350d80add71f7fefc7489d383e530d7288f04afc5788083602b634e18` |
| `ai-zh-final-viewport.json` | `eb9f8c6a2c847692cf04ce8060d7a397d1bac77b5f04024c2147e7cf93a8b077` |
| `all-ai-metrics.json` | `c3c2b46e5d99255e1101babd3f8db749b011044a96a19902abef643146e7e022` |
| `final-safety.json` | `6b61443b63bfc19151faa15e1d794245d1ad27a5650bdf984ea2a98a6e53e11d` |
| `final-original-locked.png` | `15eded4aaab3612398349d73d85bd5fbffbe3285d6adba67ae421e0e55864fcc` |
| `cleanup.json` | `b7aea19248568a2a7868ad6494dd1243330fa7b020c3df54675d0c705f164883` |

精确 handoff.json 为 7603B，SHA256 `c6752ab0196891492f5c5e930f01305fa81dd59a48c5682bf3e4dc0dc13f81c4`，toolReady/productReady 均只针对本片为 true；补充全部审核列比较另存上述文件，没有覆盖已交付 handoff。只提交本新回执，不改 source/共享152、08、README、不 push/触发或取消 CI。已 fetch origin/main，无远端缺失。后续设备范围仍须主控明确授权。
