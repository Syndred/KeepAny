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
