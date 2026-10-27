# Capacitor 手机依赖

2026-10-27 接入。使用发布包和CLI生成的平台工程，没有复制上游业务代码。生成模板随 Capacitor CLI 8.5.3，后续本地修改以 Git diff 保留。

| 依赖 | 固定版本 | 许可证与来源 |
|---|---|---|
| @capacitor/core、cli、android、ios | 8.5.3 | MIT；https://github.com/ionic-team/capacitor |
| @capacitor/app | 8.1.2 | MIT；https://github.com/ionic-team/capacitor-plugins |
| @capacitor/filesystem | 8.1.5 | MIT；同上 |
| @capacitor/preferences | 8.0.1 | MIT；同上 |
| @capacitor/share | 8.0.3 | MIT；同上 |
| @capacitor-community/sqlite | 8.1.1 | MIT；https://github.com/capacitor-community/sqlite/tree/3f3f71606c8f292a3d6d841937bcfc5b5c45aeb5 |

SQLite原文件核对：`src/definitions.ts`、`android/build.gradle`、`ios/Plugin/Utils/UtilsFile.swift`；不复制、不修改插件。保留发布包中的许可与测试，工程级新增实际磁盘SQLite合同测试以及原生探针。插件 Android 使用 SQLCipher 4.17.0、Room 2.6.1、AndroidX SQLite 2.4.0；启用加密不是当前承诺，普通记录未设SQLCipher密钥，密码仍仅独立KDBX。

发布前仍须按实际 Android/iOS 解析产物更新 SBOM 和完整原生传递依赖许可；本文件不能代替最终安装包法律清单。

## Android 桥接重载回包时序补丁

- 固定包：`@capacitor/android@8.5.3`，npm registry `gitHead` 为 `06e3e1984337f836a4c28b2afc92faa977dea315`；远端 `8.5.3` tag ref 为 `7d5168d70eb41ad0d77f2cba6adcd8c8702bc1d8`，两种指针分别记录，不假定相同。
- 原文件：`android/capacitor/src/main/java/com/getcapacitor/MessageHandler.java`；发布包内路径为 `capacitor/src/main/java/com/getcapacitor/MessageHandler.java`。MIT，保留依赖原始 LICENSE（Drifty Co.）及原文件其余逻辑。
- 修改：现代 WebMessageListener 先把当前文档的 `replyProxy` 发布给插件线程，再派发 `postMessage`。之前顺序相反，重载后快速的首个 Preferences.keys 可能向旧文档回包，JS promise 永久等待。保留 main-frame 与 origin 限制，没有启用更宽松的 legacy bridge。
- 补丁：`patches/@capacitor__android@8.5.3.patch`，通过 pnpm `patchedDependencies` 和锁文件哈希重现；不依赖手改 node_modules。
- 证据：第五候选在真实 Android WebView 恢复后的重载及手动重载间歇卡住；第二次独立 keys 立即成功，其他原生调用正常。补丁后的原生连续重载及实际恢复复验结果见 Android 环境回执，不用静态源码推断通过。发布包未附上游测试源，未删除/改变其运行逻辑；现有工程测试与本次实际设备步骤保留。

同一发布包另修 `android/capacitor/src/main/java/com/getcapacitor/plugin/util/CapacitorHttpUrlConnection.java`：`dataType=file` 原分支仅在API26+写入解码字节，API24/25会写空请求。改用API8已提供的 `android.util.Base64` 在本项目minSdk24起一致解码；保留原输出流、TLS、方法、头与错误处理。发布来源、提交和MIT许可同上；补丁仍由同一pnpm patch/锁哈希管理。TS合同已核对二进制PUT/GET原字节、JSON原生返回形态、固定服务/禁止重定向与取消；API24/25实机网络尚未验证，不能把静态修复当该版本设备通过。
