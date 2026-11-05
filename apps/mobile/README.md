# KeepAny 手机 MVP

共享 `apps/web/src` 的最新 React 页面。Android 使用 Capacitor；普通资料和恢复日志通过同一领域仓库写入 SQLite，图片和 KDBX 保存在应用持久目录。原生打开失败会显示重试，不回退到浏览器空库。

当前整合基线为 `49afe755`，手机直接使用本仓库的 `apps/web/src`，保留最新版 H5 页面与卡片；手机侧滑入口改为底部导航。原生底座精选自 `61173c9a`，保留原包名 `io.github.syndred.keepany`、SQLite 默认库及附件/KDBX 持久目录，避免用浏览器空库替代旧手机资料。原生打开失败仍显示重试。

系统返回先关闭菜单或对话框，再处理搜索/更多导航，最后才返回路由或最小化应用。后台锁定、原生 AI 网络与系统文件交付继续使用原底座，不恢复同步、绑定、MCP 服务、PDF 或远端备份实验。实际 Android 返回、系统选择器、冷启动与覆盖安装由手机验收确认，浏览器合成事件不作为真机通过。

```powershell
pnpm install --frozen-lockfile
pnpm mobile:build
pnpm mobile:sync
./scripts/build-mobile-android.ps1 -JavaPath <JDK21目录> -SdkPath <AndroidSDK目录>
```

Android 运行基线为 API24+、System WebView111+；构建需要 JDK21 和 Android SDK37.0。产物为 `android/app/build/outputs/apk/debug/app-debug.apk`，属于调试签名验收候选。原包名和默认库/文件路径保持；恢复先写新库、核验后切换，保留原资料和恢复入口。KDBX/.ka1 仍需各自密码。

SQLite 8.1.1 的遗留事务关闭补丁及 Capacitor 8.5.3 的文档回执顺序补丁通过 `pnpm-workspace.yaml` 锁定，来源为本仓库旧手机提交 `c0a538c4`；补丁文件注明上游路径。相关原生回归需在 Android 执行，软件 SQLite 和 Java 单元结果不能代替。

本轮只交付 Android 工程和构建依赖，不提供 iOS 产物或验收结论。

原生文件来源为本仓库 `61173c9a` 的 `apps/mobile/`、`packages/local-db-native/`、`packages/platform-native/`、原生构建/候选校验脚本与两份补丁；共享仓库适配最初来自 `e5a73dee`，按 `e52c4e47` 共同祖先三方移植到当前 main，保留当前业务修复和页面。两份补丁只覆盖其文件内列明的上游路径；各自原单元检查继续保留。

本轮不运行模拟器或 AEHD。完整手机验收尚未完成；构建通过与 APK 身份核对不等于已在手机走完流程。结果及 APK 在仓库外另存，源码不携带用户资料、签名私钥或验收截图。
