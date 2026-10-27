# iOS后续Core与UI分开验收

2026-10-28。此片仅变更Apple CI执行条件与构建时间预算，不改变产品TLS、CA/SAN、授权、30秒写入或120秒传输等任何运行时限制。

## 已发生的事实

- 4de5a460/run40558067136的App实际编译成功，Core仅记录Build complete后无case结果；job35分钟自然超时cancelled，UI跳过。
- 3ae2eed9/run40566551923/job122409245244在安装723包后因`ERR_PNPM_IGNORED_BUILDS core-js@3.50.0`失败，App/Core/UI均跳过，不拿旧编译背书此轮。
- f7e8a30b/run40567103655/job122411199305已实际通过frozen安装、shared build和App compile，目前Core执行中；截至本片没有Core/UI结果。没有人为取消该run，下面变更尚未push，不追认当前run包含它。

## 后续执行条件

给实际App编译步骤设置`id: compile_ios`。安装／8个UI测试仅在`always() && !cancelled() && steps.compile_ios.outcome == 'success'`时执行：App未编译成功或workflow已取消仍跳过；App已真实编译而独立Core失败时继续收集UI证据。没有`continue-on-error`，Core的非零结果仍使job失败；UI通过不能把Core失败或整个job变绿。

普通全字段及MCP准备探针令原5UI扩为8UI；后续job预算60分钟，编译步骤15分钟、Core仍12分钟、安装/UI25分钟，留诊断上传时间。此为CI工序预算，不延长任何产品操作截止，也不把“给更多时间”写成已修挂点。独立Core stage NDJSON与UI只读SQLite同ID观察器继续保留。

依据[GitHub状态条件](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions)与[steps outcome](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#steps-context)，以及[窄审回执中的只读建议](手机最低运行时API窄审及AI兼容修复-20261028.md)。本地diff检查无误；真实GitHub条件、17Core和8UI待此变更下一次实际运行验证，不能仅凭YAML判断验收通过。

分支提交、不合main、不改4180/4196或发布生产；同一当前Apple run允许自然结束后再统一触发下一候选。

## f7实际结果与下一轮证书分层诊断

f7 run40567103655/job122411199305已自然failure，并非超时或人为取消。App编译成功；SwiftPM实际Build complete 209.33s后，17个XCTest在0.587s内完成，2个case通过、15个失败（14 unexpected）。主要为实际trusted TLS握手`CERTIFICATE_VERIFY_FAILED`，wrong-IP阴性也因链先失败未到达预期IP SAN错误；不把它算作正确SAN拒绝。30秒预算等依赖TLS成功的测试没有到达原断言。后续8UI被旧workflow默认success条件跳过，5405解耦尚未在此run生效。

独立stage文件实际存在：43773B，17次case-start/setup-complete/teardown-after均完整；失败cleanup先settle再close/shutdown，随后deinit记录already-started并退出。它证明本轮所有case确已退出，不能据此反推旧4de无case日志的挂点已唯一定位。原fail和其余未验条件保留。

原始附件12763857605为339346B，下载严格HTTPS且ZIP SHA256与GitHub摘要相同：`d7387c18a8a6975ef4510e64deee5d1d504addaa8a5be757b5fe53beae20b9a1`。已解压在本机toolchains/evidence/ios-ci-f7e8a30b；Core log SHA`c9081c099e2a50d0dbb003ae4f07ac52aaf186fd8e53e2fcb09d416db782d13e`，stage SHA`0dc22b9fad22d0f5786976f44adc474dbc162f1f53d7db38d88af27d8787b08a`。job logs连接器返回Transport closed，未反复重试或虚构完整job日志；实际结论来自校验后的附件。

下一轮只在原身份测试增加公开X509签名自验，并把自造临时公有证书导出到独立artifact文件，使用系统OpenSSL严格检查purpose/IP/显式信任锚；绝不导出私钥、票据或authority状态。源API为固定[Swift Certificates 1.21.1的isValidSignature](https://github.com/apple/swift-certificates/blob/1.21.1/Sources/X509/CertificatePublicKey.swift)。同时核对[NIOSSL 2.37.5 trustRoots/验证接线](https://github.com/apple/swift-nio-ssl/blob/2.37.5/Sources/NIOSSL/SSLContext.swift)：显式certificates使用BoringSSL验证，不能将其混称系统默认Security验证。未复制或修改上游代码。

生产`EphemeralIdentity.swift` SHA仍`cc64a2cabc4d17593683cc514842d9684059c321cd4088c6887f4f4df3f31fe0`，未改CA能力、证书有效期、IP SAN或信任方式。未提供自定义接受所有证书回调。签名自验／独立OpenSSL／新8UI均待下一Apple实际执行，不能写已修。全部7个实际workflow shell块已提取并通过`bash -n`，不是Windows上执行Apple或完整Actions语义验证。

后续把既有Xcode缓存拆为同版本的restore/save，App真实编译成功即保存同一path/key，独立Core后来失败不再丢弃成功编译缓存。没有skip-build：后续xcodebuild仍实际构建并检查改动。此仅减少重复定位等待，不继承旧case通过状态；真实缓存写入/恢复仍待Actions证据。
