# KeepAny 手机应用

正式 React/TypeScript 页面来自 `apps/web/src`；这里提供 Capacitor 8 Android/iOS工程与原生启动入口。手机只注册 Native SQLite 仓库，打开失败时显示重试，不回退到浏览器空库。Web/PWA继续原 RxDB/Dexie。

## 当前可构建部分

```powershell
pnpm install --frozen-lockfile
pnpm mobile:build
pnpm mobile:sync
```

Android需要JDK21+、Android SDK API36与Build Tools。Windows可显式指定本机工具路径，运行：

```powershell
./scripts/build-mobile-android.ps1 -JavaPath <JDK目录> -SdkPath <Android-SDK目录>
```

产物：`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`。这是调试签名测试包，不是商店签名发行版。脚本在本进程设置短路径Java socket目录，修复本轮Windows JDK/Gradle因AF_UNIX临时路径导致无法连接的问题，不修改系统设置。

iOS工程使用Swift Package Manager；在macOS安装Xcode后先`pnpm mobile:sync`，再`node scripts/mobile-cli.mjs open ios`选择自己的签名身份构建。本轮Windows未编译iOS，不能据此声称iPhone验收。

## 持久化与兼容

- 记录、审核、历史、恢复和同步日志由同一SQLite提供，完整payload/ID/schema保留。事务scope显式传递；条件写入使用版本，普通回收站与内部回滚墓碑分别处理。
- 原图和KDBX使用应用持久Library/内部files目录中的不可变文件；读回长度与SHA256后提交指针。密码明文/主密码不进普通SQL，日志内的密文字节也转独立文件引用。
- 闲置文件仅在串行队列内扫描全表引用后回收；枚举或删除失败保留资料可读并下次重试。
- 加密`.ka1 v1`及KDBX沿用现有合同；不同设备不复制设备私钥/refresh token/MCP授权。服务仍按原实验边界开放。
- 导出先生成并读回临时文件，再由用户打开系统保存/分享界面；打开界面不代表已保存外部备份。

## 验证状态

真实磁盘SQLite合同与共享仓库加密KA1/KDBX往返已有本机软件证据；Android工程含所有插件已构建成功。真机、模拟器、系统选择器、低空间/进程中断及iOS证据分别记录，不合并成“手机已验收”。完整功能仍按`docs/mobile/手机功能详细测试表-20261027.md`逐条执行。实现进度及未完成见同目录`实施进度-20261027.md`。
