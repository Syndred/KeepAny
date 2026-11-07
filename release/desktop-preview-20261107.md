## KeepAny 桌面预览版 0.1.0

下载对应系统的文件并安装。桌面版在独立窗口运行，无需 Node.js。

| 系统 | 下载文件 | 安装方式 |
| --- | --- | --- |
| Windows x64 | `KeepAny_0.1.0_x64-setup.exe` | 双击安装，然后从开始菜单打开 |
| macOS 14+，Apple Silicon（M 系列） | `KeepAny_0.1.0_aarch64.dmg` | 打开磁盘映像，将 KeepAny 拖到「应用程序」 |
| macOS 14+，Intel | `KeepAny_0.1.0_x64.dmg` | 打开磁盘映像，将 KeepAny 拖到「应用程序」 |

**Mac 首次打开**：这两份预览包使用临时签名，尚未通过 Apple 公证。系统可能拦截首次打开。确认文件来自本发布页且 SHA-256 一致后，可按 Apple 说明在「系统设置 → 隐私与安全性」对 KeepAny 选择「仍要打开」。 [Apple 支持](https://support.apple.com/zh-cn/102445)

**Windows**：安装器尚未签名，系统可能显示发布者提示。Windows 缺少 WebView2 时，安装器会联网补装。已有 WebView2 的用户也可下载 `KeepAny_0.1.0_x64.exe` 直接运行。

**已有资料**：在原 KeepAny 的「备份与恢复」导出加密 `.ka1`，然后在桌面版预览并恢复。加密密码库仍用原主密码解锁。桌面版的关窗后提醒与 MCP 连接暂未开放。

## KeepAny Desktop Preview 0.1.0

Use the x64 setup EXE on Windows, or the DMG for your Mac (Apple Silicon or Intel, macOS 14 or later). Drag KeepAny into Applications on macOS. The desktop app runs in its own window without Node.js.

- **macOS** has ad-hoc signatures and is not notarized. If macOS blocks the first launch, verify the download and checksum, then follow Apple's instructions to allow this app in System Settings → Privacy & Security. [Apple Support](https://support.apple.com/en-us/102445)
- **Windows** installers are unsigned. The setup EXE downloads WebView2 if it is missing. The standalone EXE requires WebView2 to be present.
- To move your existing KeepAny data, export an encrypted `.ka1` backup from the original app, then preview and restore it in the desktop app. Keep your original vault master password.

## 校验与源码 / Checksums and source

See `SHA256SUMS.txt` for the downloadable files. The corresponding source is commit [`130a368f`](https://github.com/Syndred/KeepAny/tree/130a368f50bc1e069da1351b602c9c7e608e8862). Build instructions and dependency lockfiles are in the linked source. License materials are attached in `KeepAny-desktop-licenses.zip`.

The published binaries are from [desktop build 42346276575](https://github.com/Syndred/KeepAny/actions/runs/42346276575). Windows installation and uninstallation and native-window launches on all three targets were checked in [acceptance run 42349295899](https://github.com/Syndred/KeepAny/actions/runs/42349295899).
