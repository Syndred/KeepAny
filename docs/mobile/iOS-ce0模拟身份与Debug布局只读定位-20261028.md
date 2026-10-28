# iOS ce0 模拟身份定位与门禁纠正回执（2026-10-28）

## 结论与实际范围

ce0beb8e 的签名字典硬门禁不能据此证明 Simulator 缺少 App 身份。实际 Xcode 26.6 日志已把 `application-identifier=io.github.syndred.keepany` 展开到 `App.app-Simulated.xcent`，并把该 XML 及对应 DER 链入主程序 App stub；host codesign 使用的 `App.app.xcent` 是空字典。这两个身份来源不同。**当前可确认门禁只检查了 host 签名字典，没有检查 SDK 真正生成的模拟段；不能确认已安装二进制的模拟段内容或 Keychain 已可用。**

本轮 App `BUILD SUCCEEDED`，签名 verify / ad-hoc / bundle / stub 字节比较均 true；compile 阶段以 `ios-simulator-application-identity-missing` 停止。**Core / UI 均未执行**，不继承 114 轮的 Core 29/29 或 UI 5/8。调查阶段仅只读，随后 Root 依据这些证据授权实施下述 metadata gate 纠正；没有修改 PBX、产品、Keychain 守卫或错误映射，没有运行设备 / Xcode / 新 CI，也没有 push。

Root 已核 artifact 12780402259：ZIP 327946 B，SHA256 `05e5a58a575535dfc7c260607fdd307539dde5e711849a607ebe62230eb104f2`。实际读取目录 `C:/Users/Administrator/.codex/toolchains/keepany-mobile/evidence/ios-ci-ce0beb8e/contents` 只有 7 个 log / JSON / plist / helper 文件，**没有 App、debug dylib 或 Mach-O 原件**；本机 Windows 也不能运行 Apple 工具。因此以下“链接位置”来自实际构建命令，不能冒称已对产物执行 otool。

## ce0 实际日志证据

`build.log` SHA256：`48b1b315a154695bf4a6e6f0ce2aaca6569e5db8b380e1213af551bf1547bffa`。

| 日志行 | 实际内容 / 含义 |
| --- | --- |
| 8 | `KEEPANY_CI_SIMULATOR_ENTITLEMENTS` 指向本次生成的 CI plist，参数没有漏传 |
| 32066–32074 | 正常 `App.app.xcent` 被 SDK 生成为空 Entitlements 字典 |
| 32076–32085 | `App.app-Simulated.xcent` 包含精确本 App 的 `application-identifier`，没有伪造 TeamID / 共享组 |
| 32087–32093 | 两份 xcent 均各自由实际 `/usr/bin/derq query -f xml ... --raw` 生成对应 DER |
| 32789 / 32791、32799 / 32801 | x86_64 / arm64 的 **App.debug.dylib** 链接命令是 dynamiclib；命令未带 `__entitlements` / `__ents_der` |
| 32810、32823 | 两架构的主 **App stub** 使用 `___debug_blank_executor_main`，且明确 `-sectcreate __TEXT __entitlements App.app-Simulated.xcent` 和 `__ents_der App.app-Simulated.xcent.der` |
| 32244、32248 | `__preview.dylib` 的单独链接也带上述两段；不能把 preview 当正式运行主体 |
| 32859、32866 | debug / preview dylib 分别 ad-hoc 签名，没有额外手工注入 entitlement |
| 32873 | 主 App codesign `--entitlements App.app.xcent`，即上面的空 host 字典 |
| 32887 | `BUILD SUCCEEDED` |

因此，通用“Debug 的 sections 在 debug dylib”说明不能替代本轮逐命令检查；本轮 **明确传入模拟身份节的是主 App stub**。反过来，现 helper 只比较 `${app}/App` 和 built stub 的字节，不足以证明已安装 App 的业务代码体与本次 built body 相同。

## 上游一手依据与未证明部分

[Apple 的 Debug 布局文档](https://developer.apple.com/documentation/xcode/understanding-build-product-layout-changes)说明，未优化 App 可由主 stub 加独立 debug dylib 组成；扫描符号 / section 的工具应适配这一布局。`ENABLE_DEBUG_DYLIB=NO` 是 per-target 选择，并非应全局关闭的默认修法。本轮实际 stub 已携带模拟节，没有证据要求改该设置。

只读保存的 [Apple Security 固定提交 db15acbe… 的 SecTask.c](https://github.com/apple-oss-distributions/Security/blob/db15acbe6a7f257a859ad9a3bb86097bfe0679d9/sectask/SecTask.c#L256) 在实际原文件 256–260、291–303 行明确区分 Simulator：请求 `CS_OPS_ENTITLEMENTS_BLOB`，并将其作为 property list 解析；非 Simulator 使用 DER 路径。161–168 行通过 `csops_audittoken` 取任务数据。

这支持“Simulator 身份不能只从 host codesign 字典判定”的分层，但该公开源码**不是已安装 Xcode 26.6 SDK 二进制的逐字节对应证明**。本次未找到可确定映射到本轮 CoreSimulator 的 csops shim 一手实现，不能据静态源码断言 shim 已读取正确 stub / debug 节，也不能将后续 -34018 预先标成已修。真实 App Keychain / MCP 步骤仍是必要证据。

## 从调查形成的最窄方案

1. 保留当前 ad-hoc、`codesign --verify --strict`、精确 bundle / executable 身份、四阶段 built / installed 校验和禁止共享组的门槛。host 签名字典继续读取并记录，禁止把意外共享组当可忽略；**不再要求本应为空的 host 字典必须承载 Simulator AppID**。
2. 对本次 App 主 stub 的各实际架构，提取真实 `__TEXT,__entitlements` 原始字节，严格 plist 解析；要求唯一的完整字典与本次 SDK 展开的最小模拟身份相等、AppID 精确等于本 App bundle。不能搜索任意字符串或接受任意 dylib 中碰巧存在正确 ID。按 ce0 已知链接布局，应要求 stub 存在该节；扫描 body 只用于发现 / 拒绝矛盾，而不是缺失时随意 fallback。
3. 同架构同时核 `__TEXT,__ents_der` 非空、完整，且与本次 SDK 对已验证 XML 执行原 `derq` 转换生成的 DER 精确字节一致。不要自行发明 DER 解码 / 重签算法。若工具语法或产物缺失，固定诊断失败，不能跳过。
4. 推荐 `lipo -archs` 后按架构得到 own 临时 thin 文件，再以 `otool -l` 的唯一 section offset / size 有界提取原始 bytes；`otool -X -s` 可作为只读原件旁证，但不可未经验证就把多架构、带 header、不同端序的文本拼成 plist。偏移 / 长度 / 重复节 / 缺节 / 超限都应拒绝，不从源码 plist 代替最终二进制。
5. 四 phase 比较实际 installed / built 的主 stub **及存在时的 App.debug.dylib 完整 bytes / SHA**；presence 也必须一致。debug body 自身也应通过实际签名校验。若实际架构中发现模拟节，要求其与 stub 一致；不要为通过而修改 stub、body 或签名。实际 `__preview.dylib` 可独立记录验证，不把它误认作正常业务体。
6. 门禁正确读取模拟段之后，必须继续执行原实际 App Keychain / MCP 初始化与 Core / UI 断言，保留 numeric OSStatus / 固定 stage。若仍 -34018，再据 runtime 证据调查，不改 SecureStore 的 -34018 分类、不加共享 access group、不虚构生产 TeamID、不手动 codesign 全部 targets。

这只是建议的验证来源纠正，不是“放宽门禁通过即证明 Keychain 可用”。当前证据不支持先关闭 Debug dylib、不支持再向 host 签名字典强塞模拟权限，也不支持把 ce0 两轮未执行的用例计为通过。

## 本片交付

ignored `test-results/ios-ce0-entitlement-review/` 保存精确的 `build-metadata.json`、`body-link-metadata.json`、`sources-and-artifacts.json`、固定 SecTask.c 与 Apple 文档原件。所有既有 artifact / hash 保持。Vault 采样修正文档已另提交 `ad0a6d8b`，不改其 B 证据或 Native 原件。

## 授权后的局部实现与本机验证

新增 `scripts/verify-ios-simulator-signature.mjs`：四 phase 均读取实际 App 主 Mach-O，`lipo` 严格只接受唯一 arm64 / x86_64 架构集合；fat 文件逐架构 thin 后用 `otool -l` 唯一 section offset / size 读取实际 bytes。缺 / 重复 / 错段、重叠、越界、工具错误均失败，不用源码 plist 代替实际段。实际 XML 经严格 UTF-8 / `plutil` 解析，只接受完整最小 AppID 字典；重复 key、错 ID、额外共享组不能通过。每架构 XML / DER 必须与同次 SDK Simulated.xcent / .der 全 bytes 相同，SDK DER 还要通过同次真实 `derq` 从已核 XML 重新生成并精确比较；两架构必须一致。

host codesign 字典分开记录，空字典 / 空输出不再当模拟身份缺失；非空时错 AppID、共享组 / 伪 Team entitlement 和非法权限类型仍拒绝。`get-task-allow` 两种实际 host key 单独记录存在性和值，不手工添加。保留 ad-hoc / verify / bundle，并在 installed phase 比较主 stub 和存在时的 debug body 的完整 bytes / SHA；body 自身也验证签名。缺 body / 多 body / 内容不符仍阻断。

helper 输出只承诺 `metadataVerified`。通过的实际主段最小公有 XML / DER 保存在 `signature-PHASE-ARCH.plist/.der`，失败 JSON 保留 phase、固定错误码、已取得的 hash / 布尔，不打印工具 stderr。只清本调用自建 `.signature-*` 临时目录，不改 build product。

workflow 仅将原 inline helper 提取为可单测自包含脚本，再复制到原 artifact 路径；四 phase 调用、两次 xcodebuild、失败真实 exit、observer trap、Core / UI 整段保持。新增精确 helper 的 CI path 触发，cache 使用 `simulator-main-macho-v3` 命名空间。未修改 `CODE_SIGN_ENTITLEMENTS` / `ENABLE_DEBUG_DYLIB` / PBX / 生产权限。

本机实际执行：

- `node node_modules/vitest/vitest.mjs run scripts/verify-ios-simulator-signature.test.mjs`：**30/30 mock 工具合同通过**。覆盖四 phase 的空 host 字典 + 正确模拟节、thin/no body、缺节、错 ID、第二架构不一致、重复 XML key、SDK DER / 嵌入 DER 错、重叠 / 越界 / 错 segment、非法架构、非 ad-hoc、错 bundle、host 共享组、工具失败、installed main / debug body 变化及 body 缺失。所有目录为随机自有临时 fixture，无实际 Apple 工具调用。
- 首次 29/30 时，负例 mock 同时把 main 和 body 都设为非 ad-hoc，实际先报 body 签名码，和测试预期的 main 码不同；修正为只针对 main 的负例后全过。这是测试 fixture 的错误分类前置，不是新的 Apple 产品根因。
- `node --check` 通过；workflow 七个真实 shell run block 均 `bash -n` 通过。程序对比从 Core step 开始到 workflow 尾的内容与原 HEAD 完全相同，因此旧 Core / UI / observer 断言和失败退出没有被削弱。`git diff --check` 通过。
- 结果原件：`gate-local-result.json`、`static-proof.json`。**这是 Windows C / 静态门禁，不是实际 codesign / otool / derq / Keychain / iOS 实证**。未跑全仓单测，未声称新 Apple 已成功。

下一轮必须保留新的实际段原件 / hash、四 phase JSON，并让原 App MCP prepare / numeric OSStatus、Core 与八个 UI 用例实际执行。若运行时仍 -34018，继续按实际 stage 调查，不据本机 mock 绿核销。
