# iOS ea72 显式 Simulator 身份门禁修复回执（2026-10-28）

## 本轮实际结果

实际 ea72 Apple artifact `12778893653`：ZIP 321456B，SHA256 `b31a954ab43feb8b237862ab2f1680c2dc1259cdf89af0350e755d26bda2fcff`。Root 校验并安全提取到 `C:/Users/Administrator/.codex/toolchains/keepany-mobile/evidence/ios-ci-ea72c065/contents`，本片直接读取了原件，未重新运行 CI 或设备。

| 层次 | 实际结果 |
| --- | --- |
| App 编译 | build.log 明确 `BUILD SUCCEEDED` |
| App ad hoc 签名 | `Sign to Run Locally`；实际签名 verify=true、adHoc=true |
| bundle / 可执行文件 | bundleMatches=true、binaryMatchesBuild=true |
| 实际签名 App ID | applicationIdentifier=null、applicationIdentityPresent=false |
| 门禁失败 | 固定 `ios-simulator-application-identity-missing` |
| Core | 因 compile step 的签名门禁失败而未执行；无本轮 Core 日志 |
| Simulator UI | 未执行；无本轮 UI 日志 |

这是“App 已编译、签名缺少身份”的前置红，不是 Swift 编译红。不能把其他 run 的 Core 或 UI 通过数继承给本轮，也没有本轮运行时 Keychain/配对/字段保存成功证据。

## 原件分层证据

旧 build.log 的 `ProcessProductPackaging` 从空 entitlement 输入生成 `App.app-Simulated.xcent`，其中有 Xcode 自动生成的模拟身份，linker 将它放入 `__TEXT/__entitlements`。最终唯一主 App 的 `/usr/bin/codesign --force --sign -` 命令只有 DER 生成等参数，**没有 `--entitlements` 文件参数**。实际 codesign 回读无 App ID，与失败 JSON 相符。模拟器二进制段不是实际签名 entitlement 的替代证明。

旧 build.log 未出现 `get-task-allow`。这不等于已经从实际 signed plist 完整证明其不存在，因为旧 helper 在缺 App ID 时提前拒绝；新 helper 记录 actual key 列表及该项存在/布尔值，不能凭空添加权限。

原件 hash：

| 文件 | 字节 / SHA256 |
| --- | --- |
| build.log | 12038636 / `ebc3450307cd0757b8adaffc90f639523d2e01a457a7cce35dfcc37f2e350fe2` |
| signature-compile.json | 367 / `a92cad97015c5f3d44bdfe79fde083b729df4e8d9feb9bc7f09666953c75a15e` |
| 原运行签名 helper | 3588 / `5593ba8309447f4df9da195a161d7198c7c600f3ef4f60df131affcfcb58041a` |
| 独立归类 actual-evidence.json | `ffe52e97a043f2d899b901d02372eed955a88fee742617193054595681298163` |

独立证据与本机检查都在 ignored `test-results/ios-ea72-signing-review/`。没有更改旧 artifact，也没有输出凭据、签名下载 URL 或资产字段值。

## 本片最小改动

1. 只在 **App target / Debug / `sdk=iphonesimulator*`** 加入 `CODE_SIGN_ENTITLEMENTS` 条件引用，指向可选 `KEEPANY_CI_SIMULATOR_ENTITLEMENTS`；默认值为空。去掉新增的两行后，整个 pbxproj 与本片前完全一致。device、Release、UITest runner、framework 的签名配置不改。
2. workflow 在 `test-results/ios/simulator-app-identity.plist` 生成只有一个 key 的 CI-only plist：`application-identifier` 的输入是 Xcode `$(PRODUCT_BUNDLE_IDENTIFIER)`。两次 xcodebuild 都传同一绝对 **custom build setting** 路径；没有全局传 `CODE_SIGN_ENTITLEMENTS`，避免把同一 App 身份送给 runner/framework。没有虚构生产 Team ID，没有添加 Keychain group、App Group 或 `get-task-allow`。
3. 保持 Simulator ad hoc 和实际 codesign verify。此明确 CI-only 方案下，actual signed identity 必须 **严格等于 actual bundle ID**；缺值、未展开宏、其他 App ID、带假 Team 前缀都拒绝。不再沿用之前未经证实的“必须有 Team 前缀”假设。
4. 保留 compile、installed-before、test 重建、installed-after 四个阶段；检查实际 App bundle、无共享组、签名与实际可执行文件和当次构建字节相同。诊断只保留公共 App ID、实际 entitlement key 名、`get-task-allow` 的存在/布尔值及固定 code/布尔；不记录秘密。是否有自动生成的 `get-task-allow` 不作为必须为 true 的条件。
5. 缓存使用新的 `simulator-app-identity-v2` namespace，避免旧身份方案缓存静默复用。UI 命令失败后仍运行重建及安装副本签名诊断，停 observer，最终保持原 UI exit code；always artifact 保留诊断。生产 SecureStore、`kSecAttrAccessGroup`、文件路径、TLS 和错误映射均不改，未把 `-34018` 转成 not-found。

## 本机验证与限制

- `node test-results/ios-ea72-signing-review/check-fix.mjs`：18 个纯逻辑模拟 gate 通过，包括显式 plain-bundle CI 身份、仅默认组、无签名/无身份/错误 App ID/假 Team 前缀/共享组/非 ad hoc、两次安装副本字节核对、未展开宏，以及自动 `get-task-allow` true/false 的独立诊断。它们不是 actual codesign 或 Keychain 结果。
- Python 标准 `plistlib` 实际解析生成的 plist，确认只有 `application-identifier` 且仍为等待 Xcode 展开的 bundle 宏；无新依赖。
- PBX 静态检查确认只有 App Debug 的两个新增 setting，原其余设置逐字相同；正式 workflow 会先执行 Apple `plutil -lint`。
- 7 段 CI shell 通过 Git Bash `bash -n`，抽出的 Node helper 通过 `node --check`；own diff 通过 `git diff --check`。没有运行 pnpm、安装或改共享依赖。
- Windows 没有执行 Xcode/Swift/codesign。本机没有生成 actual expanded signed entitlement，也没有证明 Keychain 可用；这两项显式保持 false/pending。

下一轮必须实际证明：Xcode 将 App-only 输入展开并送入真正签名；四阶段实际 App 身份精确一致；正常 App 启动与真实 Keychain initialize/配对 prepare 成功。随后才继续原 Core 和 UI 各 case/全字段同 ID observer 链。若 Xcode 仍未展开或未将文件签入，本门禁继续失败，不能以输入 plist 存在当成功。

本片只精确提交 workflow、App pbxproj 与此回执，不 push；Root 的 release/旧资源/gitattributes 在途修改全部保留。不会将本片 iOS CI 结果倒灌到已冻结 Android N23。
