# 原生 URL 元数据依赖与安全合同

2026-10-27。原有合同为 `scripts/intake-url-metadata.mjs`。新增原生实现自己编写，不复制第三方业务源码，不使用 CapacitorHttp 或手写 HTTP 解析器。远端 HTML 只经惰性模板提取标题/描述，不执行网页。

## 固定依赖与来源

| 平台 | 依赖/固定版本 | 完整上游提交 | 许可证 | 核对的原文件 |
|---|---|---|---|---|
| Android | `com.squareup.okhttp3:okhttp:5.5.1`，使用正式 Android variant | `be5151ac3b63d3db405b9dbb62632c36cc6a657e` | Apache-2.0，原仓 `LICENSE.txt` | `okhttp/src/commonJvmAndroid/kotlin/okhttp3/OkHttpClient.kt`、`Dns.kt`、`ResponseBody.kt`、`internal/connection/RouteSelector.kt`、`CHANGELOG.md` |
| iOS | `AsyncHTTPClient 1.36.2`，SwiftPM依赖固定revision | `4c005f955e83f888d5616e579717a36d2dfc6301` | Apache-2.0，原仓 `LICENSE.txt` | `Package.swift`、`Sources/AsyncHTTPClient/HTTPClient.swift`、`HTTPHandler.swift`、`ConnectionPool.swift` |

- Android未修改或复制OkHttp实现；新建Java策略、协调器与插件。DNS仅返回全部核验后的首个IP，原URL主机保持TLS SNI和默认主机名/证书校验；禁代理、Cookie、自动重定向、透明压缩和跨跳连接复用。每跳独立client/pool，固定只读请求头。未安装自定义信任根。
- iOS未修改或复制AHC实现；新建本地Swift包、流式delegate、协调器和Capacitor插件。使用POSIX NIO事件循环与AHC解析出的精确`request.host`配置`dnsOverride[host:numericIP]`，保留原hostname SNI/默认TLS校验；独立每跳client、无代理、禁自动重定向和解压。使用库的无日志请求入口，不输出原文/URL/凭据诊断。
- 不修改Info.plist的ATS设置，不增加`NSAllowsArbitraryLoads`、任意信任或客户端白名单。AHC/NIO原生传输不是URLSession。iOS仍须在macOS/Xcode实测系统信任、握手、SNI、HTTP和取消，Windows源码核对不替代这些验收。
- 上述库保留其上游许可证；实际APK/IPA所带传递依赖与许可证仍须纳入冻结候选的产物清单，不把本文件当发布法律审查通过。

## Android选型纠正与构建门槛

- 首次真实Gradle检查明确拒绝5.5.1 Android AAR＋compileSdk36：AAR要求minCompileSdk37。主控已授权只调整编译SDK，不调整targetSdk36、Capacitor8.5.3或默认TLS，也不静默抑制AGP警告。
- 曾定向读取官方Maven AAR元信息：5.4.0最低compileSdk36（提交`61423f472da24e0ccc42b6a2c0863fb27932fea5`）、5.3.2最低compileSdk1（`75b9c267744cdd2e8b222d247052748ff0954304`）。没有把降低依赖版本当作默认解决方案。
- 固定5.5.1的`CHANGELOG.md`明确包含2026-10-22阻止8个受损eMudhra中间证书的修复，说明Google Play Services之外的AOSP/JVM需要该保护。因此保留5.5.1，不为避免编译SDK升级而静默退到缺少该修复的5.4.0。5.5.0另有IP规范化主机名校验修复。未自行拼装另一套TLS信任逻辑。
- SDK目录和版本使用实际sdkmanager包身份；不伪造目录。编译、JVM、模拟器和真机结果必须在执行回执各自记录。

## 共享受限合同

只允许HTTP(S)、URL最长2048、无URL凭据、去fragment；整次8秒涵盖DNS和最多4次手动重定向。每跳核验所有地址，拒绝Node原规则中的私网、保留IPv4、非global-unicast IPv6、mapped/translation、2001特殊与2002 6to4等，再pin首个地址。

最多4个活跃请求；超时或用户取消只通知调用方和取消HTTP，不提前释放仍阻塞在系统DNS的槽。Android进程级槽、iOS静态协调器防止插件/控制器重建绕过限制。DNS返回后再检查原截止时间，超时不能再建连接。

仅2xx HTML/XHTML；`Content-Encoding`只允许缺失或`identity`；声明长度与实际流式字节都不超过1MiB。原生返回`url/contentType/bodyBase64`，同一TS模块用声明charset及`TextDecoder(...,{fatal:true})`解码。插件生产接口仅`read({requestId,url})`和`cancel({requestId})`，不接受headers、白名单、代理或信任根。

## 定向测试与证据边界

- 新增Android `MetadataPolicyTest`：原地址语料、URL/凭据/fragment、首地址pin、代理/自动重定向关闭与默认hostname verifier。
- 新增Android `MetadataFetcherTest`：任何私网DNS答案拒绝、逐跳DNS复查、固定请求头、原始charset字节、重定向/状态/MIME/编码/声明与实际预算；阻塞DNS的4个槽在超时/取消和重建协调器后仍占用至退出。
- 新增TS `packages/platform-native/src/metadata.test.ts`：只发URL/requestId、统一charset fatal解码、AbortSignal取消确切请求、无Web降级、响应预算与脱敏错误；插件为替身，不能外推真实原生HTTP成功。
- 新增Swift `MetadataPolicyTests`：地址/URL/取消合同源码。Windows不具备UIKit/Xcode，未声称Swift编译或iOS设备验收。
- Java HTTP合同测试使用包内受控resolver/client工厂；生产插件固定构造实现且不暴露该注入能力。替身HTTP不能证明真实DNS、TLS、证书拒绝或供应商网络；后续冻结包应在隔离设备补真实公开站与恶意地址拒绝、取消与超时证据。
- 新增 `MetadataDeviceTest` 设备用例：真实 `https://example.com/` HTML、私网/mapped地址拒绝、`wrong.host.badssl.com` 证书/主机名拒绝。TLS用例要求观察到实际SSL异常，普通DNS/连接失败不能冒充证书拒绝通过。本切片只编译这些设备用例，未连接设备执行，需主控冻结后单独验收。

本轮Android实际使用sdkmanager正式包`platforms;android-37.0`（rev2）及AGP8.13的`compileSdkMinor=0`，通过工程级plugin回调传给app与Capacitor libraries；targetSdk仍36。Gradle保留“AGP8.13最高测试至36.1，建议升级以支持37.0”的警告，没有suppress或伪造SDK目录。本机定向JVM结果与新增设备用例编译结果见本切片提交回执；未构建或替换主控冻结APK。

## 本切片执行回执（2026-10-27）

- 已执行 `:app:testDebugUnitTest --tests 'io.github.syndred.keepany.Metadata*'`，JUnit XML实读`MetadataFetcherTest`5项、`MetadataPolicyTest`4项，9项通过、0失败/跳过；包含取消后关闭协调器仍保留阻塞DNS槽及mapped redirect规范化前拒绝。
- 已执行 `:app:compileDebugAndroidTestJavaWithJavac`，BUILD SUCCESSFUL，设备用例class实际生成；这不是设备执行或APK安装。
- 已执行 `vitest run packages/platform-native/src/metadata.test.ts`，5项通过；对应文件与共享URL入口/浏览器用例Biome lint通过，TypeScript noEmit通过。
- 已执行 `tests/e2e/native-metadata.spec.ts`，正式React网址入库入口zh-CN/en两项通过：替身原生handler返回惰性HTML标题/描述、无远端脚本/图片执行、去fragment、取消预览。无middleware调用；此项不证明原生HTTP成功。
- Android设备3项、Swift编译与iOS真机均未执行；公开站、实际系统DNS、TLS和证书拒绝仍须设备回执。没有继承旧Web middleware测试为Native通过。
