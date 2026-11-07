## KeepAny 桌面预览版 0.1.1

- 账号列表按创建时间从新到旧排列。编辑账号不会改变顺序。
- 多选后可以合并账号或将所选账号移入回收站。合并后默认显示一张卡，原有登录资料和备注仍可查看。
- 账号工具栏在滚动时保持可用，搜索框保留原样输入，清除按钮更易辨认。
- 在 Mac 上可以选择通过本机钥匙串记住密码库解锁。

下载对应系统的文件并安装。桌面版在独立窗口运行，无需 Node.js。

| 系统 | 下载文件 | 安装方式 |
| --- | --- | --- |
| Windows x64 | `KeepAny_0.1.1_x64-setup.exe` | 双击安装，然后从开始菜单打开 |
| macOS 14+，Apple Silicon（M 系列） | `KeepAny_0.1.1_aarch64.dmg` | 打开磁盘映像，将 KeepAny 拖到「应用程序」 |
| macOS 14+，Intel | `KeepAny_0.1.1_x64.dmg` | 打开磁盘映像，将 KeepAny 拖到「应用程序」 |

Mac 预览版使用临时签名，尚未通过 Apple 公证。系统可能拦截首次打开。确认文件来自本发布页且 SHA-256 一致后，可在「系统设置 → 隐私与安全性」选择「仍要打开」。[Apple 支持](https://support.apple.com/zh-cn/102445)

Windows 安装器尚未签名，可能显示发布者提示。缺少 WebView2 时，安装器会联网补装。已有 WebView2 也可直接运行 `KeepAny_0.1.1_x64.exe`。

升级前可在「备份与恢复」导出加密 `.ka1`。如需迁移资料，在新版预览并恢复该文件。加密密码库仍用原主密码解锁。

## KeepAny Desktop Preview 0.1.1

- Accounts are sorted newest first by creation time. Editing an account keeps its position.
- Select multiple accounts to merge them or move them to Trash. A merged group shows one card by default and keeps its existing logins and notes accessible.
- The account toolbar stays accessible while scrolling. Search keeps the entered text as typed and makes the clear button easier to spot.
- On Mac, you can choose to remember vault unlock with the local Keychain.

Use the x64 setup EXE on Windows or the DMG for your Mac (Apple Silicon or Intel, macOS 14 or later). On macOS, drag KeepAny into Applications. The desktop app runs in its own window without Node.js.

- The Mac previews have ad-hoc signatures and are not notarized. If macOS blocks the first launch, verify the download and checksum, then choose **Open Anyway** in System Settings → Privacy & Security. [Apple Support](https://support.apple.com/en-us/102445)
- The Windows installer is unsigned. It downloads WebView2 if needed. The standalone EXE requires WebView2 to be installed.
- Before upgrading, export an encrypted `.ka1` from **Backup and restore**. To move your data, preview and restore the file in the new version. Keep using your original vault master password.

## 校验与源码 / Checksums and source

下载校验值见 `SHA256SUMS.txt`，许可材料见 `KeepAny-desktop-licenses.zip`。对应源码及构建说明见提交 [`d2da82c1`](https://github.com/Syndred/KeepAny/tree/d2da82c15f474f487b08a1362b3e141154a283d6)。

See `SHA256SUMS.txt` for the downloads and `KeepAny-desktop-licenses.zip` for license materials. Build instructions and dependency lockfiles are in the [corresponding source](https://github.com/Syndred/KeepAny/tree/d2da82c15f474f487b08a1362b3e141154a283d6).
