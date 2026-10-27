# F23 iOS BoringSSL 叶信任锚只读审查（2026-10-28）

## 结论与边界

**支持具体假设**：NIOSSL固定2.37.5所带BoringSSL，在当前默认flags与显式certificates store路径下，不会仅因store含同一证书，就接受当前“自签、CA:false、KeyUsage只有digitalSignature”的叶。直接障碍是其self-signed/issuer识别依赖keyCertSign；不能简化成“CA:false一律不能作叶锚”。

**反对据此改生产**：不能推断Node/OpenSSL生产CLI失败，也不能为NIOSSL测试改CA:true/keyCertSign、关闭验证或只pin绕过SAN。Android同样的CA:false/digitalSignature/serverAuth参数已在N16真实Node严格TLS链通过；那是不同实际证书/平台的证据，尚不能替代同一iOS公有PEM的对照实跑。

**仍不确定**：f7实际失败没有精确X509 verify_result/error_depth，尚不能排除证书编码/签名/用途/有效期等其他问题叠加。此片是固定源码支持的可检验解释，不是17项测试根因已实跑核销。

## 已核实际证据

Apple run40567103655/job122411199305对应本机artifact目录 `C:/Users/Administrator/.codex/toolchains/keepany-mobile/evidence/ios-ci-f7e8a30b/contents`。Corelog SHA256 `C9081C099E2A50D0DBB003AE4F07AC52AAF186FD8E53E2FCB09D416DB782D13E`；stage SHA256 `0DC22B9FAD22D0F5786976F44ADC474DBC162F1F53D7DB38D88AF27D8787B08A`，实际重算一致。Core为17项、15失败/14unexpected；stage有17次start、17次teardown-before/after，完整退出，不能再称本轮hang。trusted client为CERTIFICATE_VERIFY_FAILED，wrongIP也先链失败；未证明其SAN阴性已执行到位。

正式 `EphemeralIdentity.swift:17–29` 为自签v3/P256、critical CA:false、critical digitalSignature-only、serverAuth/IP SAN。测试 `TransportTests.swift:169–175` 使用fullVerification和显式 `[leaf]` trustRoots。这是NIOSSL测试客户端验证路径；服务端身份仍未修改。

## 固定版本源码链

上游tag2.37.5实际ref `322f3c2a4a21df31c84ca416bf65ee5e9059e440`，只读官方apple/swift-nio-ssl固定提交，不用最新版或一般PKI印象代替。没有移植代码到产品、编译上游或新增测试。

| 位置 | 可直接确定的行为 | 对当前组合的含义 |
| --- | --- | --- |
| [v3_purp.cc:31–32、301–307](https://github.com/apple/swift-nio-ssl/blob/322f3c2a4a21df31c84ca416bf65ee5e9059e440/Sources/CNIOBoringSSL/crypto/x509/v3_purp.cc#L301) | 有KU却缺keyCertSign时ku_reject为真；subject=issuer仍不会设置EXFLAG_SS | 密码学自签并不等于这里被标记为self-signed |
| [v3_purp.cc:459–477](https://github.com/apple/swift-nio-ssl/blob/322f3c2a4a21df31c84ca416bf65ee5e9059e440/Sources/CNIOBoringSSL/crypto/x509/v3_purp.cc#L459) | issuer KU缺certSign则X509_check_issued返回KEYUSAGE_NO_CERTSIGN | 同一叶作为自身issuer也被该规则拒绝 |
| [x509_vfy.cc:80–87、248–270](https://github.com/apple/swift-nio-ssl/blob/322f3c2a4a21df31c84ca416bf65ee5e9059e440/Sources/CNIOBoringSSL/crypto/x509/x509_vfy.cc#L80) | cert_self_signed只看EXFLAG_SS；单自签叶的exact-store匹配路径依赖该判断 | 当前KU组合进不了该捷径，不能只说“已经放入store所以必信任” |
| [x509_lu.cc:473–507](https://github.com/apple/swift-nio-ssl/blob/322f3c2a4a21df31c84ca416bf65ee5e9059e440/Sources/CNIOBoringSSL/crypto/x509/x509_lu.cc#L473)；[x509_vfy.cc:422–450](https://github.com/apple/swift-nio-ssl/blob/322f3c2a4a21df31c84ca416bf65ee5e9059e440/Sources/CNIOBoringSSL/crypto/x509/x509_vfy.cc#L422) | store按subject找到证书后仍须check_issued；失败通常返回找不到可用issuer | 显式store内容不会绕开KU发行者过滤 |
| [x509_trs.cc:75–91](https://github.com/apple/swift-nio-ssl/blob/322f3c2a4a21df31c84ca416bf65ee5e9059e440/Sources/CNIOBoringSSL/crypto/x509/x509_trs.cc#L75) | 无额外trust/reject设置时兼容信任仍看EXFLAG_SS | 普通PEM经add_cert不是额外显式信任用途标记 |
| [SSLContext.swift:640–659、731–738](https://github.com/apple/swift-nio-ssl/blob/322f3c2a4a21df31c84ca416bf65ee5e9059e440/Sources/NIOSSL/SSLContext.swift#L640)；[x509_vpm.cc:353–367](https://github.com/apple/swift-nio-ssl/blob/322f3c2a4a21df31c84ca416bf65ee5e9059e440/Sources/CNIOBoringSSL/crypto/x509/x509_vpm.cc#L353) | 默认flags及NIOSSL设置都是TRUSTED_FIRST；certificates调用X509_STORE_add_cert | 未开启PARTIAL_CHAIN；不会自动变成exact-leaf直接锚模式 |

重要反证：[x509_vfy.cc:459–486](https://github.com/apple/swift-nio-ssl/blob/322f3c2a4a21df31c84ca416bf65ee5e9059e440/Sources/CNIOBoringSSL/crypto/x509/x509_vfy.cc#L459) 的CA要求针对链位置i>0，而非对所有叶直接要求CA:true；不能由当前链失败推出必须改BasicConstraints。

## 公开partial-chain/explicit-anchor接口

BoringSSL底层确有成熟partial-chain语义：[x509_vfy.cc:678–691](https://github.com/apple/swift-nio-ssl/blob/322f3c2a4a21df31c84ca416bf65ee5e9059e440/Sources/CNIOBoringSSL/crypto/x509/x509_vfy.cc#L678) 在该flag下可精确匹配store中leaf并令last_untrusted=0；[1265–1271](https://github.com/apple/swift-nio-ssl/blob/322f3c2a4a21df31c84ca416bf65ee5e9059e440/Sources/CNIOBoringSSL/crypto/x509/x509_vfy.cc#L1265) 也为partial chain设置专门分支。

但在本片审查的固定版公开 `TLSConfiguration`、`NIOSSLContext`/ClientHandler接口中，未发现专门partial-chain/verify-flags配置或公开底层context指针；不能声称已有可直接复用的一行安全Swift配置。`sslContextCallback` 是动态上下文/身份用途，不是已证明的验证flags入口。

公开 [customVerificationCallback（NIOSSLClientHandler.swift:118–135）](https://github.com/apple/swift-nio-ssl/blob/322f3c2a4a21df31c84ca416bf65ee5e9059e440/Sources/NIOSSL/NIOSSLClientHandler.swift#L118) 明确替换正常验证逻辑、接收未经预处理的证书，不能随便返回certificateVerified。若未来采用完整独立验证器，必须另证链/签名/时效/用途、IP SAN和exact leaf/SPKI等合同，当前没有实现或批准其替代。

Darwin内建Security.framework路径只在default roots启用；[SecurityFrameworkCertificateVerification.swift:59–66](https://github.com/apple/swift-nio-ssl/blob/322f3c2a4a21df31c84ca416bf65ee5e9059e440/Sources/NIOSSL/SecurityFrameworkCertificateVerification.swift#L59) 对additional roots明确调用AnchorCertificatesOnly=false恢复系统根。`default + additionalTrustRoots`因此不是本次“仅本会话单叶”信任集合的同义替换，不能悄悄扩大来让测试绿。

## 实际下一分层

先等主代理0162b9ec已准备、尚未执行的公有PEM/SwiftX509自签/OpenSSL strict诊断；不重复写这些测试。记录同一PEM、工具版本与精确验证flags，区分签名/有效期/用途、链、IP SAN和SPKI。OpenSSL结果不能单独代替此固定BoringSSL路径。

若仍需最小BoringSSL诊断，可仅在自造测试上下文对同一公开leaf记录：X509_check_issued(leaf,leaf)、X509_check_trust、X509_verify_cert的整数结果/error_depth；比较原flags与仅测试的PARTIAL_CHAIN路径。预期KU发行者拒绝与exact-leaf分支差异须实跑确认；这不是要求改生产证书或验收门槛。wrongIP必须在trusted positive链成功后独立验证仍失败。

若同iOS leaf的Node/OpenSSL严格验证通过而固定NIOSSL客户端失败，应对齐测试客户端的真实显式叶锚语义；保留原CA:false、KU、完整验证与独立SAN/pin阴性，不以test client政策倒推生产失败。后续方案仍由主代理在实际结果后决定。

本片只新增此读码回执；没有生产/测试修改、ADB、依赖安装、服务、push或新iOS运行，不核销17项。设备继续READY，由主代理另行交接。
