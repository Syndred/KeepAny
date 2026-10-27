# F23 Android 受限 TLS 传输回执

实际日期：2026-10-28（Asia/Shanghai）。本片仅实现 Android 原生 HTTP/TLS IO；不注册插件、不修改 Manifest、不启动手机 listener、不连接设备、不构建或替换 APK。不能据此将原 152 表 F23-02—05 核销为 Native SDK 已通过。

## 实现与原合同

新增 `KeepAnyMcpTransportPlugin`、`McpHttpsServer`、`McpTlsIdentity`。与共享 TS `native-mcp-transport.ts` 的接口逐项对照：

| 入口/动作 | 预期与实际实现 | 本轮证据/边界 |
|---|---|---|
| 显式 `start({address})` | 只接受实际处于 up 的本机接口所拥有的 RFC1918 IPv4 或 exact `127.0.0.1`；拒 wildcard/public/link-local、名字、其他 loopback、非标准数字/未分配地址；OS 分配端口，只 HTTPS `/mcp`、`/pair`。不自动挑网络。 | C/JVM 实际仅绑定 127.0.0.1，地址负例逐个拒绝；没有在 LAN/手机上启动。 |
| start 返回身份 | 每次显式 start 用 JCA 生成内存 P-256 私钥；BC 只构建非 CA、自签、serverAuth、正确 IP SAN 的证书；返回 canonical UUID、endpoint、PEM、SPKI SHA256。TLS 至少 1.2；不安装根证书、不注册全局 provider、不落盘。stop 丢弃引用，平台支持时请求销毁私钥，不声称可物理擦除所有运行时副本。 | 真实 TLS：默认 CA 拒绝自签、只信本次证书仍拒 localhost 错 SAN、正确 IP 成功；核证书 SAN/EC/non-CA、SPKI、TLS1.2/1.3 和重启不同 SPKI。Android OS 实际 TLS 尚待 N。 |
| 请求事件 | Netty 正式解析器；仅 POST、HTTP1.1、精确路径，拒 absolute URI/query/重复敏感头/CLTE。实际单一 Host 原值单独传递，headers 小写；Cookie/Origin 不隐去，其他重复头逗号合并。原始头最多 64 项/16KiB；UTF8 fatal、正文最多 1,000,000 字节；不接受 trailers。 | 真实 TLS 验 Host 与 Origin/Cookie、一般重复头；Host/Authorization/Content-Length/Content-Type/Origin/Transfer-Encoding 重复逐个拒，CLTE/路径/GET/头数量及字节/坏 UTF8/声明与 chunked 超限拒绝；恰好 1,000,000 字节通过。 |
| responseStart/Write/End | 只允许约定响应头；拒 Set-Cookie、重定向、CRLF。每个 base64 桥块 ≤256KiB，累计 ≤8MiB；Start/Write 仅内存缓存，End 才整体 flush，ACK 等实际 write future。Native 自设 Connection/Content-Length。 | TLS 客户端在 End 前实际读超时，无半段成功；完整 8MiB 有限 SSE 实际传输、长度核对；超块/超总量、Set-Cookie/CRLF/302 拒绝且不输出部分正文。此层不解析 MCP JSON，不等于 SDK 授权流程通过。 |
| cancel/断开/期限/stop | 最多 4 个连接槽（TLS/header/body/JS/flush 都计入，保守于仅计算完整请求）；accept 起 30s 总期限，不随块重置。cancel 丢缓存并关该连接、发 mcpCancelled、释放槽；stale 请求失败不碰其他。stop 关闭 listener/连接/线程、发取消和一次 mcpStopped。 | 实际第 5 连接拒绝；断开/显式取消/stop 后新槽可用，旧响应失败；完整请求等待约 30s 和未写完 body 等待约 30s 都 408/释放；不伪造时钟。 |
| reset/单实例/应用生命周期 | reset 严格空字段，和 start/stop 同单线程队列；在途 start 完成后 reset 停它，后续 start 才可创建新实例。有 active 拒绝重复 start；旧实例 stop 幂等但不会停新实例，随机实例拒绝。pause/destroy 停全部；resume 不自动启动。所有 bridge 方法拒绝未知字段，未知异常固定脱敏。start 的 JS ACK 失败也立即 stop。 | 直接运行真实 plugin lifecycle 队列，捕获 JS resolve/reject（没有真实 WebView）；`start→reset→start`、旧 stop/随机 stop/重复 start、pause/重开、ACK 故障后端口关闭/重试均断言。N 中真实 pause/WebView reload/destroy 仍待。 |

请求/响应/授权/私钥均不写文件或日志；只在显式 start 返回公开证书/SPKI。HTTP 错误固定 `mcp-transport-failed`，bridge 仅有固定 failed/active/stale，不包含底层异常。注册本身不打开端口；配对、授权、批准、审计、密码隔离仍归共享 MCP 层，不在本片重造。

## 成熟依赖、来源与分发

没有复制上游业务实现或自行编写 HTTP parser。固定生产依赖：

- Netty `netty-codec-http` / `netty-handler` **4.1.139.Final**，Apache-2.0。tag object `c46e5fff738c7056152aaa63e0be0ae02742edd5`，peeled commit **`7bc0414acbb21f752dd615c386821f58e722c5f5`**。[官方安全发布](https://netty.io/news/2026/10/06/4-1-139-Final.html)、[4.1 Android 支持边界](https://netty.io/wiki/new-and-noteworthy-in-4.1.html)、[固定版配置源码](https://github.com/netty/netty/blob/netty-4.1.139.Final/codec-http/src/main/java/io/netty/handler/codec/http/HttpDecoderConfig.java)。4.1 支持 Android 4+，上游明确没有自动 Android 测试；本仓库 minSdk24 未因此降低。4.1 EOL 为 2027-07-01，后续维护需要跟进。
- BC `bcpkix-jdk18on` **1.86**（传递 bcprov/bcutil 同版），BC License（上游明确按 MIT 理解）。核官方 tag `r1rv86` **`eacda831fbe15b272933e40841d8b0827b556fae`**，以实际 Maven artifact SHA256 固定二进制证据；未假定后续 v1/v2 tag 与该 Maven jar 一致。[官方 tag](https://github.com/bcgit/bc-java/releases/tag/r1rv86)、[许可证](https://www.bouncycastle.org/license.html)。只使用公开证书构建/codec API，签名/TLS 保留系统 JCA/JDK provider；未改全局 provider/trust。

上游源码/测试均未修改；保留上游测试不作已执行声明。本仓库新增实际传输及 lifecycle 回归。新增生产资源 `META-INF/keepany-mcp-netty-LICENSE.txt`、`keepany-mcp-netty-NOTICE.txt` 是固定 Netty tag 根目录 `LICENSE.txt`/`NOTICE.txt` **原文，无修改**，随 Android Java 资源分发，`.gitattributes` 仅为这两条精确路径设 `-text` 保留字节。Netty Maven jars 本身未带这两文件，不能仅靠仓库链接替代分发。BC `META-INF/LICENSE.md` 合并保留；只去掉 Android 不使用的 JAR `META-INF/INDEX.LIST`，没有全局排除许可证。已实际从最终 merged Java resources ZIP 读回两份 Netty 原文（11360/9039 字节，哈希与下表相等）及 BC 合并 LICENSE.md（3513 字节），并非只确认源文件存在。

| 文件 | SHA256 |
|---|---|
| Netty LICENSE 原文 | `aac73b3148f6d1d7111dbca32099f68d26c644c6813ae1e4f05f6579aa2663fe` |
| Netty NOTICE 原文 | `64e368e79be71463922ebb102b33088667cf975edeed8df7f68efe9f89835ca1` |
| netty-buffer | `48d805b74e56dc5f92b1f288858185abc86db16d293e8da183542df6243427f2` |
| netty-codec | `ad43f07219dfb757a87b9c2b4765002be478c5401971379954e3d182f285fe6b` |
| netty-codec-http | `627cfdac2cd5dbd8a33af85977fb81fa6b46f0c00389ab4c8677a415f0f85480` |
| netty-common | `50372d86e27b4b1cf0810d75eb534795966a199049a1e85a0c41bbd2bb97f519` |
| netty-handler | `ff85f00781b956d618b20f33da076c839a5e43e0084108b07bab0c19737168ec` |
| netty-resolver | `562a5388c88325b7d6ed05e8168736871ce0e64ab01e0ce52ea7710760b9b457` |
| netty-transport | `be7bff8b6274e7fae12bbad3c565777539e9b069517e0b3acc06d9ac2cd6ec05` |
| netty-transport-native-unix-common | `8e660ac8a485fc8d8b47d87d04ea33d19902dc6fc5a113e9353b762188b3f333` |
| bcpkix-jdk18on | `8d8b41a4b149bdae8d331f059a578870954d1e3ff29f8269a9eb3ee19a7e4ef7` |
| bcprov-jdk18on | `2af190b300cbb0b35e248ccf5f4a06b6072030aeb3da7a98ec73abe5b4cb371f` |
| bcutil-jdk18on | `1c268e15f785aafb1e4670d8d6e5f856f69475e96c162dadcd1ff9b350e9139f` |

## 执行、初次失败与复验

环境：Windows/JDK21.0.13/AGP8.13.0、实际 SDK37.0、target36/min24，未升级主版本。每次 Gradle 仅当前进程设置 `JAVA_HOME`；沿现有脚本设置短 AF_UNIX temp 路径，下载阶段沿用当前进程 `java.net.useSystemProxies=true`，真实测试 socket 显式 `Proxy.NO_PROXY`，没有全局环境/代理/信任修改。保留 AGP 对 compile37.0 和 SDK XML 的既有警告，未 suppress。

1. 初次 `compileDebugJavaWithJavac` 真红：Netty 没有 `HttpHeaderNames.X_CONTENT_TYPE_OPTIONS`；改用固定合法字符串后编译通过。
2. 初次资源合并真红：Netty `META-INF/INDEX.LIST` 重复；其后 BC `META-INF/LICENSE.md` 重复。精确排除索引/合并许可证，`mergeDebugJavaResource`、`checkDebugDuplicateClasses`、`mergeExtDexDebug` 实际通过；没有为了绕构建而弱化 TLS 或替换 parser。
3. 首轮插件关闭探针 2 例红，测试使用默认 Socket 受到当前进程代理选择影响的可能性；改为显式 `Proxy.NO_PROXY` 并用 2s 有界端口关闭探针，复跑 2 例通过（最终两例合计约 0.086s，并非等待到期限才放行）。不将这次测试夹具纠正包装成产品修复。生产 Netty listener 不经 HTTP/system proxy。
4. 最终 `McpHttpsServerTest` **10** 例 + `McpTransportPluginTest` **2** 例 + 相邻 `McpAuthorityCodecTest` **8** 例，**20/20** 软件绿。TLS 10 例约62.68s，包含两次生产30s期限；没有以计数代替上表的具体动作/断言。输出 `test-results/mcp-native-android-verified.log`，Gradle XML 位于 `apps/mobile/android/app/build/test-results/testDebugUnitTest/`（本机 ignored，可由提交测试重现）。
5. 自 review 补 start ACK 故障关闭用例后，仅重跑受影响 `McpTransportPluginTest` **3/3** 及资源/Dex/重复类检查（`test-results/mcp-native-android-ack-final.log`），原 10 TLS/8 codec 源没有变化，不无故重跑两次 30s。合计 **21 个不同合同用例**有本轮软件证据（13 新传输/生命周期 + 8 相邻 codec），不是 N 完成证明。

复现命令（工作目录 `apps/mobile/android`，先按本仓库 Android 构建脚本配置本次进程 JDK/短 tmpdir）：

```powershell
./gradlew.bat :app:testDebugUnitTest --tests io.github.syndred.keepany.McpHttpsServerTest --tests io.github.syndred.keepany.McpTransportPluginTest --tests io.github.syndred.keepany.McpAuthorityCodecTest --no-daemon --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx512m' --console=plain
./gradlew.bat :app:compileDebugJavaWithJavac :app:mergeDebugJavaResource :app:mergeExtDexDebug :app:checkDebugDuplicateClasses --no-daemon --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx512m' --console=plain
```

收尾只提交本片 Java/新测试、app 依赖/精确资源规则、两份上游许可资源/两条精确属性和本回执；未修改其他协作者 iOS/TS/配对 UI。会话已只读 fetch origin，`HEAD...origin/main` 为 ahead141/behind0（读取时），没有合并/推送。本片不启动常驻服务；JUnit socket/eventloop 均由 finally/After 关闭，Gradle 完成后释放给主控。标准 Gradle 定向重跑会覆盖同 task 的上一轮 XML；本轮最后 XML 为 plugin 3 项，前 20 项以当轮已读取 XML 与 verified 日志为据，不冒称当前 XML 同时保留全部 21 项。

## 未完成

Android 注册/实际 APK、真实设备接口/网络权限及系统 TLS/BC兼容性、手机官方 SDK initialize/tools/配对/逐次批准/撤销/audit 的完整流程、真实 Native pause/reload/stop、iOS transport 都不是本轮实跑。需要主控统一注册/冻结新候选再由唯一设备 owner 操作；不能继承 N14 的 AI 绿或独立 authority C 来证明 MCP 已可用。
