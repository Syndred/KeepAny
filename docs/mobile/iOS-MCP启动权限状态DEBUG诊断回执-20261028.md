# iOS MCP 启动访问状态 DEBUG 诊断（2026-10-28）

本片只增加诊断，不是 Apple544 产品根因修复或通过回执。544 的地址字段精确 label 定位失败与访问状态 alert 独立保留；当次尚未执行 Prepare。原件、当前 PID 时间线及源代码对照保存在 ignored `test-results/ios-mcp-alert-readonly-review/findings.json`，SHA `9433cbcec4b0d9c4f137edeefd76e43c4b9292b9b6a0817863e3ad0e4ed1d2c0`。

## 已实施的窄改动

- `McpAuthoritySecureStore.swift` 新增受限 `Stage` / `Event` 枚举。新增日志仅两个固定格式：`KeepAnyMcpAuthority stage=<枚举> event=<枚举>` 和 `KeepAnyMcpAuthority stage=<枚举> osStatus=<数字>`，实际输出均在 `#if DEBUG` 内，Release 不输出。
- 覆盖实际文件根目录/保护、文件存在检查、Keychain 存在查询/读取/新增、文件与密钥一致性、首次创建、读取 envelope/解密/解析、写 frame/加密/临时文件/replace/读回步骤。原有首次创建失败清理的 SecItemDelete 也只加数字状态记录；没有新增 Update 调用。
- Plugin 严格参数检查失败记录 `rejected`；串行 worker 执行开始、成功 resolve、固定 reject 分别记录 `begin/complete/failed`。原始 exception、scope、路径、服务名、key、revision、payload 与字段值均不作为日志参数。
- 未改 Keychain 查询属性、可访问性、不备份/文件保护、AES-GCM/AAD、schema、文件/密钥部分缺失守卫、CAS、原子写、错误返回、重试规则或 UI；没有新增恢复/删除路径。首次创建失败先记录固定失败边界，再沿用原清理，防止清理阶段标记掩盖首次失败的时间顺序。

## 如何读取下一轮 Apple 结果

按当前 App PID/线程与 `bridgeInitialize/bridgeRead` 的 begin→complete/failed 对齐。`keyExists` 的数字状态可区分查询成功、未找到与其他 Security 拒绝；仅 stage 不能推断具体 OSStatus。`initializePresence` 后失败仍可能是文件/密钥不一致，不能自动删除原状态。`readDecode` 与后续 Bridge failed 则保留 schema/解码调查方向。日志不承诺能把所有 I/O 失败细分为某个系统错误，更不能把没有日志当成功。

已有 `history()` 顺序仍是确认 reset→固定 dataset context→孤儿撤销恢复→authority history 读取；只读历史失败不能回退空历史。Idle 启动失败不会自动每 5 秒重读，alert 可保留到显式刷新/前台事件，因此下一轮需要真实 Refresh 与状态断言。

## 现有 target 的合成 App-context / Bridge smoke 接线建议（未实施）

现 Xcode 工程只有 `App` 与 `KeepAnyUITests`；UI test bundle 在独立进程，不能直接取得 App 的 CAPBridge/WKWebView。现有 macOS Core target 也不能代替 iOS App 的 Keychain/沙箱。因此不建议在 UI test 进程直接创建 store 后冒充 App-context。

无需新增 target 的可行方案：后续经 Root 授权，在现有 **App target** 加 `#if DEBUG` 且显式测试启动参数门控的短期 smoke harness，由 `KeepAnyUITests` 仅在专用 case 传该参数。App 内生成一个随机 64hex 合成 scope，待现有 Capacitor bridge ready 后，通过本 App 的 WKWebView `callAsyncJavaScript` 调正式 `KeepAnyMcpAuthority.initialize/readState`，随后再次 initialize/readState，断言空四数组、同 revision、同内容；只向测试附录记录固定 pass/fail/stage。不要借普通 UI 隐藏入口触发，不改变正式启动历史，不让 Release 编译该执行路径。

重开可分两次启动：同一专用 case 只把本次随机测试 scope 作为测试启动参数传回；值限定 64hex，不是业务 scope。第二次通过同一 Bridge 读取并比较首次 revision/合成状态。测试 harness 只清理自己明确创建的 scope 的精确文件和该 scope/独立 authority service 对应 Keychain item，不能遍历、清默认 dataset、清 App 数据或清原 authority。该清理能力不加入生产插件协议，失败时保留失败证据后再明确处理。

以上 harness/启动参数/清理均尚未写入本片；当前诊断不需要它即可先定位真实启动调用。已向负责 UITests 的代理建议在原正式页面点现有 Refresh history，必须实际看到 ready 且 alert 清除；持续错误应保失败，不靠重新定位 address/Prepare 或默认刷新认绿。

## 验证与边界

- 已自审两个源文件 diff，`git diff --check` 通过。静态检查确认 Security 调用种类/顺序、Keychain 属性、文件/密钥守卫及固定错误协议保留；所有新增日志只接收固定枚举/数字，日志输出受 DEBUG 编译条件控制。ignored 检查：`test-results/ios-mcp-alert-readonly-review/diagnostic-static-checks.json`。
- 当前 Windows 没有 Swift/Apple 编译器；**未 Swift 编译、未 iOS 运行、未验证实际日志收集**。下一 Apple 必须先编译并核实际日志后再判断，不能把本片当成功恢复。
- 无 ADB/CDP、设备、业务库、私密 fixture、服务器、CI 触发或 push。其他代理的依赖/SQLite/UITests 修改未纳入本片。
