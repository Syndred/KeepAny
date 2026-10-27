# F23 iOS Apple 首轮 promise 崩溃修复

本片仅修改自有 `apps/mobile/ios/KeepAnyMcpTransport/` 与新增本回执；未连接设备、未修改主控TS/UI、Android或其他iOS包，未自行push/开CI。与已提交 `b5192514` prepare/activate兼容。

## Apple 首次实际失败保留

主控统一运行源 `a39718d8`、run `40544336230` / job `122330761105`。artifact `12753026806`，237945B，主控严格TLS下载核SHA256 `29d1ef85518dd5889151b02d2e626b0317c1196fd52b84011de42ff33ab65b7c`。本片实际读取仓外完整 `ios-ci-a39718d8/contents/mcp-transport-tests.log`，其文件SHA256 `1827a62a3150cf5c51577ee8b69ef913a0c5b331dd85a0de4a73bdd2d0144168`，没有覆盖原失败。

日志显示SwiftPM构建完成238.49s，`testAddressPolicyAndEphemeralIdentity` 实际0.026s通过；第二项 `testCancellationDiscardsAllChunksAndReleasesSlot` 在旧 `TransportTests.swift:74` 的reply promise泄漏触发signal5。**这不是9项测试通过**；最后Testing Library显示0 tests也不是XCTest组通过。该轮尚未包含b519新增准备测试，后续UI步骤被跳过，不能核销平台功能。主控另报该源App本体/iOS桥编译成功，与本次运行时失败分别记录。

## 可证实根因与修复

旧TLSProbe在配置/handler创建之前分配promise，但initializer catch只关闭event loop group，没有完成promise。如果NIOSSL构建client handler失败，ResponseBytes尚未安装、没有channelInactive来完成它；析构触发NIO的leaking-promise fatal，掩盖真正初始化错误。

官方固定2.37.5的[ClientSNITests](https://github.com/apple/swift-nio-ssl/blob/2.37.5/Tests/NIOSSLTests/ClientSNITests.swift)明确验证IP literal传给serverHostname会抛 `cannotUseIPAddressInSNI`。旧探针所有正常IP请求却默认传127.0.0.1，符合首个socket测试就进入该失败分支。修复没有关闭证书/身份验证：默认SNI为nil，仍为 `fullVerification`；官方[IdentityVerification](https://github.com/apple/swift-nio-ssl/blob/2.37.5/Sources/NIOSSL/IdentityVerification.swift)会用实际peer socket IP匹配证书IP SAN。

- handler初始化失败、外层配置/connect失败、channel error、inactive、deadline和deinit均通过同一ResponseBytes完成状态；失败完成明确在所属event loop上运行，幂等只完成一次，然后才shutdown group。正常完成、异常和关闭均保留真实结果，没有用忽略promise泄漏或关闭NIO断言掩盖崩溃。
- 新增回归先显式传IP SNI，必须得到原 `cannotUseIPAddressInSNI`；另用坏PEM触发配置失败，随后同listener的正常严格TLS请求必须成功。它检查初始化失败可被观察、清理且不污染下次请求，不是删掉失败分支。
- server与client SSL handler都在NIO已保证的channel initializer event loop中，使用 `pipeline.syncOperations` 安装，不再将明确非Sendable的NIOSSLHandler传入跨线程async addHandler。仍为Swift5 language mode，未声称Swift6模式通过；下一次Apple日志应继续核对警告。
- assertNoBytes先在普通 `do` 中实际 `try reply()`，再将数据交给XCTest断言。原写法的throw被XCTest autoclosure消费，使外层catch不可达；现在关闭错误与真正探针超时可被区分，仍要求实收字节0。

额外核对官方身份算法发现：给127.0.0.1连接随意传一个错误DNS SNI，仍可能匹配真实remote IP SAN，不能证明错误身份拒绝。保留强拒绝要求，改用成熟NIOSSL测试服务在127.0.0.1出示受信但SAN为127.0.0.2的证书，必须得到 `failedToValidateHostname`；未信任证书和旧TLS拒绝检查仍保留。没有使用accept-all回调、信任降级、改成只验pin或普通DNS失败当TLS拒绝。

## 已停止UUID的有界确认

按主控确认的跨层合同，新增最近16项已确认停止UUID的内存记录，不含私钥或grant。只有prepared已清或active listener/child/group实际清理成功后才记录并发mcpStopped；未确认的清理失败仍抛错，不假报停止。事件从原session开始停止的位置移到实际清理完成后，吻合TS对真实停止事件/ACK的确认语义。

重复stop一个已知已停止ID可幂等确认，供丢失ACK/事件或prepared TTL已到时显式重试；不关闭当前不同ID的新active/prepared。未知ID和被有界记录淘汰的ID仍拒绝。原“旧stop必须throw”断言改为更精确的“已知旧ID可确认但新listener实际仍可严格TLS请求，未知ID拒绝”，没有放宽旧ID不能停止新会话的安全要求。

新增实际socket测试源码覆盖：首次stop结果被调用者忽略后的重试、对新active无影响/停止事件只一次、16项界限淘汰、不认可未知ID；TTL的已有clock-injection边界另外断言到期后stop可确认。TTL仍固定真实120秒；注入时钟不冒称iOS实等两分钟。

## 验证状态与下一轮

本机Windows仍没有Swift，不能把本片报为已编译/运行通过。完成自review、官方固定tag API核对、源码合同静态检查与差异检查；共17项测试入口准备供主控下一轮Apple执行：

```sh
swift test --package-path apps/mobile/ios/KeepAnyMcpTransport
```

必须保留首轮signal5并取回下一实际编译/17项运行日志，再按失败继续修；原30秒真实期限、预算、取消、身份验证、系统导出→回App→显式激活、iOS后台与局域网全链要求不降。SwiftPM macOS成功也不替代iOS平台UI、LAN权限、真实CLI和手机系统交互验收。
