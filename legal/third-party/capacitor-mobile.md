# KeepAny Android 原生依赖与来源

2026-11-05 在最新版 H5 上恢复原有 Android 底座。原生工程、平台适配、SQLite 仓库和已有针对检查来自本仓库提交 `61173c9a`；共享仓库抽象来源为 `e5a73dee`，以共同祖先 `e52c4e47` 三方移植并保留当前业务改动。未合入旧手机 UI 或旧工作台。

| 依赖 | 固定版本 | 许可 / 上游 |
|---|---|---|
| @capacitor/core、cli、android | 8.5.3 | MIT，ionic-team/capacitor |
| @capacitor/app | 8.1.2 | MIT，ionic-team/capacitor-plugins |
| @capacitor/clipboard | 8.0.1 | MIT，ionic-team/capacitor-plugins |
| @capacitor/filesystem | 8.1.5 | MIT，ionic-team/capacitor-plugins |
| @capacitor/preferences | 8.0.1 | MIT，ionic-team/capacitor-plugins |
| @capacitor/share | 8.0.3 | MIT，ionic-team/capacitor-plugins |
| @capacitor-community/sqlite | 8.1.1 | MIT，capacitor-community/sqlite |

包由 pnpm 精确版本与锁文件安装，上游 LICENSE 保留在各发布包中。Capacitor CLI 生成工程保留本仓库原修改；没有复制同级商业仓库代码。Android 原生解析依赖沿用项目 Gradle 文件，完整传递依赖法律审核不因本次构建被宣称完成。

## 已有兼容补丁

- SQLite `8.1.1` 上游 tag peeled commit `3f3f71606c8f292a3d6d841937bcfc5b5c45aeb5`；文件 `android/src/main/java/com/getcapacitor/community/database/sqlite/SQLite/Database.java`。补丁在关闭连接前结束本线程遗留事务，不标记成功、不替换数据、不改变加密承诺。MIT，保留原 LICENSE 与原有测试。
- Capacitor Android `8.5.3` 发布来源 gitHead `06e3e1984337f836a4c28b2afc92faa977dea315`；文件 `capacitor/src/main/java/com/getcapacitor/MessageHandler.java`。先发布当前文档 replyProxy，再派发首个插件调用，避免重载后快速回包发送到旧文档。MIT，保留主框架与 origin 检查。
- 补丁文件分别为 `patches/@capacitor-community__sqlite@8.1.1.patch`、`patches/@capacitor__android@8.5.3.patch`；通过 pnpm patchedDependencies 与锁文件重现。不修改 node_modules。

已有 NativeStore、兼容、平台生命周期、导出、剪贴板、元资料及 AI 传输单元测试继续保留；Android Java 测试与原生测试源码也保留。软件 SQLite、Java 单元、编译和 APK 字节核验分别记录，均不代替本轮真机验收。
