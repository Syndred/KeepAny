# Android第十八候选AI定向回归准备回执（2026-10-28）

## 当前状态

**离线及本机HTTPS前置完成，N18设备回归尚未开始，不能记Native通过。** 5580及Native CDP仍由repository_contracts独占PDF/删除CAS；本片没有连接ADB/CDP、改reverse/hosts/CA、读旧7928/7731或其他凭据控制器、启动AVD、改产品源或push。

范围仅 `7d87a9c2` 删除SDK冗余timeout后的受影响路径：正式Settings Test connection真实受控HTTPS200、原默认30秒timeout、在途取消及同稿重试。不开付费供应商，不解锁KDBX，不发送全库。旧最低引擎兼容C/B、旧N13/N14绿不替代本次N18实际运行。

## 候选与本机条件

| 项目 | 本片实际核对 |
|---|---|
| 本地冻结APK | `test-results/native-candidates/KeepAny-eighteenth-60303f5d-debug.apk`，23694603字节；实读SHA256 `96463769eb02452d1d6e3b7d570c07632fd9cb131ab58b39ebdc96425fb14c96`，与同prefix source.json相符 |
| 修复来源 | source `60303f5d53d0f8d72b90dac2b8f1979bb4804da6`；只读git ancestry确认包含 `7d87a9c25acef188a05d0d891c3789d4f1351985`。没有核当前设备安装身份 |
| Host监听 | 9445/9446为127.0.0.1、PID10896；9447为127.0.0.1、PID25216。不停、不重启任何服务 |
| 既有公有CA | 外部fixture目录ca.cer SHA256 `d4f22271eaeee836e4f4171e802bfc00c5b47131e91ce4b834b1965c210aae15`，与既知公证相符；未读私钥、未改host信任 |
| AI服务源码 | 主控指明 `test-results/native-f21/fault-server.mjs`，只读SHA256 `c2883eeb7efff39d8b2dd8f86b423cb36f1a47245e3fffd983673e811328e062` |
| 参数 | 仅程序从已知fixture-private.json取aiBaseUrl/aiModel/aiSessionKey三字段用于断言和单次请求，不打印其值，不访问accounts/WebDAV字段 |

主控先前handoff观察reverse为空；本片未访问设备，**没有据此声称当前reverse仍为空或已配置成功**。Native所有权交回后才可核实际网络路径，不能先改设备状态。

## 实际S/C前置

脚本位于自有ignored `test-results/native-ai-eighteenth/`。host-preflight.mjs使用正式 `generateAiText` 和明确受控的Node HTTPS fetch factory，仅将已知fixture主机在该请求中lookup到127.0.0.1；显式传公有CA、保持rejectUnauthorized及hostname验证，未改系统DNS/信任、未走Native桥。

- 实际1个POST200；SDK返回文字非空及模型匹配均为布尔断言，不输出返回正文或配置值。
- 请求210B、响应307B，响应小于Native8MiB上限。此为小响应实际比较，**不是8MiB边界或16MiB请求上限压力验收**；原生代码16MiB/8MiB/256KiB/30秒默认保持。
- 请求严格核对Settings固定system/user两条消息、256输出token预算、只允许预期顶层协议字段、没有records/assets/password字段和Cookie；fixture响应无CORS header。该主机Node路径不受浏览器CORS约束，不据此冒充Native绕CORS已验。
- 错hostname以真实TLS `ERR_TLS_CERT_ALTNAME_INVALID` 拒绝；不信任CA也实际以证书链错误拒绝，不接受DNS/普通网络错误替代。
- `host-preflight.json` SHA256 `8586cf93cbca85ae84904152e00293a5cf2a4ff2e9472f2eb187bf0306f3d30d`。JSON只含布尔、码、字节、数量及公开控制计划，不含三个参数值。

没有修改外部ai-control.json。只读服务确认其支持delayMs0–130000、status503、malformed；拟定形态为正常0/200/false、timeout35000/200/false、取消8000/200/false。以上timeout/cancel只是计划，**本片没有实际设置或运行这些控制，也未核销Native30秒/取消**。

## 请求范围与选择器准备

已按实际源码准备 `ui-contract.mjs`，无设备连接或私密读取的import副作用。SHA256 `cd175f91c6f728810efb3fde01b3fca2fc33dc61bf417f501325a98defe0433a`。

| 正式界面 | 已核源码定位与约束 |
|---|---|
| Settings | `/settings#assistant`、`.ai-settings-panel`；provider/url/model/key-source/key对应现有id；选择session-only后只Test connection，不保存配置。按钮有“Test connection/测试连接”，本页没有Stop，不虚构取消按钮 |
| 成功/超时 | success为Connected · model；超时固定提示为The request timed out. Your input is still here. Try again.，需实际可见且字段保留；仅返回200而未出现真实成功不算通过 |
| AI dialog | 实际Dialog没有专用ai-workspace-dialog class；按`[role=dialog]:has(#ai-question)`定位。默认分析资料模式，取消Use saved model configuration，手动填`#ai-endpoint/#ai-model/#ai-key`；无需保存设置或解锁KDBX |
| 显式发送/取消 | `#ai-question`、Send/发送、仅busy时出现Stop generation/停止生成；停止调用invalidate，保留问题/选择，清除答案/usage并abort。此行为仍待N18真实验证 |
| 精确资料范围 | 源码只投影kind/name/description/url/dueDate/amount/currency；**不发送id/category/tags/notes**，不依赖猜测SDK或旧控制器。仅选择handoff确认的独立合成project，问题和该project名称/描述作为本次白名单 |

check-contracts.mjs仅用自造公开数据检查范围audit：单条正确范围可过；多条、password、notes、额外allLibrary、不同问题五种都拒绝；Settings固定消息及256预算可过，多records字段拒绝。`contracts-C.json` SHA256 `80c5ee641342e513cfa90ee2571ee3a052f322f6ba75a0ada66b4e70172692b5`。这是audit helper的C，不是手机真实请求证明。

## 正式交接后待执行顺序

1. 主控明确把5580交回、原owner READY并断CDP后，才建自有新9436连接、核N18实际APK身份/前台状态/无在途。先确认handoff指定的普通合成record，不猜原库资料，不读旧秘密控制器。
2. 若当前reverse缺失，仅在授权拥有设备后配置需要的9447，保留既有CA/host严格验证。错误或不信任证书不能以放宽验证绕过。
3. Settings只输入本次session草稿，不点Save configuration。真实HTTPS200 → 正式成功凭条、实际单POST与字段白名单；新输入字段/回显可能含fixture值时截图遮罩，不输出参数或敏感XML。
4. 取得当前AI控制所有权后，35秒延迟测试实际默认30秒超时，保原稿并用正常控制同稿重试；不要改请求预算或把服务器35秒503当30秒timeout。
5. 对话框手动临时连接、仅选本次普通合成project。确认点击Send前0新增POST；发送后8秒延迟中点击Stop generation，观察Native真实取消/服务client-closed、无补答、问题/选择保留、无额外资产写；同稿重试须成功，不能用人为长等待隐藏单槽清理问题。
6. 实际请求正文只在程序内做严格范围比对，输出摘要，不落全body或凭据到本目录/报告。不读取已有KDBX或主密码，也不宣称逐字扫描未知秘密。
7. finally恢复受控服务原默认、无在途；关闭对话框/设置草稿，确保临时key不再激活、原设置未被保存改写、原库锁态及合成record保持，断自有CDP并明确READY。具体数据hash/状态必须由实际handoff与收尾取得，此处不填假值。

## 当前未完成/阻碍与交付

唯一当前执行边界是设备仍由另一代理独占；所有可独立的Host前置、公开APK/CA身份、协议预算/范围和selector准备已完成。Native实际200、30秒、取消/同稿重试、原状态收尾与截图均待正式handoff，未把本机S/C写成N。

本回执是独立准备checkpoint；本轮fetch origin成功，没有回滚其他代理或改产品/控制文件。未push，以免取消当前Apple `40571793329`。后续实跑在本回执另节追加，不用新结果改写本次“未开始”。
