# F23 Android 正式 Context 初始化诊断回执（2026-10-28）

本片仅诊断独立 MCP authority 的 Android OS/Bridge 入口，不代表手机 MCP 配对、SDK 或完整 F23 已通过。所有 scope、alias 和 marker 均由测试现场随机生成；没有读取或清除 N15 原失败 scope、普通资料、KDBX、Prefs 或他人测试目录。

## 实际环境与原始红证据

- 已 fetch origin；主线无缺失。共享 worktree 的其他 UI/iOS 改动保持原样，没有 merge、stash、回退或 push。
- 目标为已经安装的 N15，源码 `afcea1f43b839a976ee5589a03469a4ba1e8e302`，package `io.github.syndred.keepany`。安装前交接 SHA `c700352dfde1515d25cc4e13dfd56f9cccea633a56b1259753ef8a0cab005e65`；实际 base.apk 在诊断前后均为 `0f60fd7b5a0c8b017e6bb2536f921a6bbebf1678c4f31bf50a7132d19c69615b`。
- 只覆盖安装测试 APK；原诊断测试包 597345 B、SHA `5b133f63d1fa5ff3b66acae2f49660a28072d30594782f71adcd823ec8b55839`。未安装/重建主 APK、未 sync/clear data、未连接 CDP，也未更改 CA、hosts、reverse 或网络服务。
- 执行 `McpAuthorityBridgeDiagnosticTest` 原四项，5.712 秒，**4 项真实 red**。原始脱敏输出 `test-results/native-mcp-authority-diagnostic/run-n15.txt`，SHA `ef1ce465e802fbf9ba25fa91bf7f065df2814271418c49d75a820f8f535e8ecc`。此结果保留，不用后续源码编译覆盖。

| 测试/实际操作 | 预期 | N15 实际 |
| --- | --- | --- |
| a：真实 target/application Context，新 scope initialize → 再 initialize → 新实例 read | fresh 四空数组、幂等、重开同 revision | 首个 initialize 拒绝；`McpAuthorityCodec$Failure`，`NativeBackend.root:58` → `path:63` → `hasFile:69` → `initialize:32` |
| b：反射正式 backend，仅包装首次阶段记录，再 initialize | 首个 backend 阶段成功，后续初始化完成 | 首错 `backend.hasFile`，同一个 root 检查拒绝；未被 rollback/read 重试覆盖首错 |
| c：真实 backend 分阶段 hasFile/hasKey/createKey/key → snapshot/seal → commit/read/open | 密钥、codec 和文件阶段均成功 | hasFile/commit 失败；**hasKey/createKey/key/snapshot/seal/open-own-memory-frame 均成功**，故不能据此归因为 BC、Keystore 或 GCM |
| d：真实 Activity Bridge 正式注册插件，新 scope PluginCall initialize → readState | 注册桥确认 initialize，readState 为四数组 | 正式实例存在、桥日志关闭、参数仅 scope/String/64hex；initialize 固定拒绝，未伪造成功或空历史 |

每项均报告真实 `android.app.ContextImpl` / `android.app.Application`；`getNoBackupFilesDir()` 的 absolute 与 canonical **不相等**，其 namespace 路径也不相等。输出只有阶段、异常类和 stack 类/方法/行，没有 exception message、参数、key、scope 或 payload。

## 根因、最小修复与守卫

先前 shell 对规范路径的检查不能代表 Java Context 返回路径的原始拼写。原六项 OS 白盒使用了预 canonical 的 ContextWrapper 随机 child，因此没有覆盖该正式入口；原六项 green 不应替代本轮四项 red。

`McpAuthoritySecureStore.NativeBackend.root()` 现仅对可信 OS `getNoBackupFilesDir()` 先 `getCanonicalFile()`，再拼独立 namespace。原 namespace 自身和精确 `.enc/.bak/.new` 路径的 canonical==absolute 拒绝守卫、owner 权限、alias、AAD、密文格式、CAS、AtomicFile 和 fail-closed 行为不变。没有移动/删除旧 state，没有因失败另建空历史。

新增的 test-only e/f 不调用未进入旧 target 的生产新方法：

| 测试 | 操作 → 预期 | 当前证据 |
| --- | --- | --- |
| e：正式 namespace 精确 scope 文件 symlink | 真实 Context 正常路径先作为控制；只在新随机 `.enc` 建链接到自造非秘密 marker；initialize/read 均拒绝，链接仍在、marker 字节不变、alias 不存在；After 精确 unlink，不跟随 | 已编译，**待 N16 实装** |
| f：隔离 namespace symlink | 自有 ContextWrapper 的随机 canonical child 中先建正常空 namespace 控制；只替换这个自有空 namespace 为指向自有 marker 目录的链接；initialize/read 拒绝、marker 不变、alias 不存在；After 精确 unlink/删 marker/仅删空目录 | 已编译，**待 N16 实装**；不替换共享 namespace root |

After 不枚举其他 alias/files，不递归删除。原四项每项的随机 scope/精确 alias 均已清理并确认不存在。新负例 cleanup 对链接用 lstat 与精确 unlink；marker 和目录均为测试本身创建。

## 软件检查与下一步

使用 JDK `C:/Users/Administrator/.codex/toolchains/keepany-mobile/java/jdk-21.0.13.0.2+1`，进程内 `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:/Users/Administrator/.keepany-jvm -Djava.net.useSystemProxies=true`，不改系统环境。

```powershell
# apps/mobile/android；仅 unit 与测试 APK，不 assemble 主 APK
./gradlew.bat :app:testDebugUnitTest --tests io.github.syndred.keepany.McpAuthorityCodecTest :app:assembleDebugAndroidTest --no-daemon --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx512m' --console=plain
# 主控交接 N16、核验实际主 APK SHA 后，才安装测试包并执行指定 class：
adb -s emulator-5580 install -r -t <本片测试APK>
adb -s emulator-5580 shell am instrument -w -r -e class io.github.syndred.keepany.McpAuthorityBridgeDiagnosticTest,io.github.syndred.keepany.McpAuthorityInstrumentationTest io.github.syndred.keepany.test/androidx.test.runner.AndroidJUnitRunner
```

本轮 codec 8 项 JVM 零失败，测试 APK 编译成功；这是 C/构建证据，**不是修复后 N green**。新六项诊断与旧六项 OS 测试须在主控冻结安装 N16 后执行；N15 正式 Prepare、后续 Bridge/TLS/配对/SDK 整链仍未核销。现有测试没有改写。

最终测试包 `test-results/native-mcp-authority-diagnostic/authority-diagnostic-final-androidTest.apk` 为 599745 B，SHA256 `08029b921bdc8a56a3a70e212016352e9a186eb0ee52ac8e2202a2854b2590eb`，含 e/f 两个真实 symlink 负例；不是主应用。最终 Gradle 16 秒成功，日志 `test-results/mcp-authority-canonical-base-final-build.log`；已有 flatDir/SDK XML/AGP 对 API37.0 的警告原样保留，没有抑制。签名核验首次因新进程未设 JAVA_HOME 未执行，随后显式设置上述本进程 JDK 后核验成功。

## 收尾与安全交接

N15 测试包已单独卸载，主包 SHA 保持。已通过可见 More → Passwords 返回原 `keepany-v1` 的 Password vault Locked 页，主密码框为空，没有输入密码或展开记录；截图 `test-results/native-mcp-authority-diagnostic/return-n15-locked.png` 已目检。无本片 CDP/forward，未把设备交给其他 agent。设备当前无人操作，等待主控 N16 冻结和正式交接；本轮不自行安装 dirty target。精确提交仅最小 Java 修复、新诊断测试和本回执。
