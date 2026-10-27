# KeepAnyIdentity

本地 Capacitor 原生插件，模块名 `KeepAnyIdentity`，桥名 `KeepAnyIdentity`。

在 iOS 项目中加入此本地 Swift 包、链接其 library，在现有 bridge controller 注册 `KeepAnyIdentityPlugin()`。主项目接线由主代理负责，此包不自行改 Xcode 项目。

插件提供 `initialize`、`readState`、`compareAndSet`、`publicKey`、`sign`。私钥是永久 P-256 SecKey，位于 `AfterFirstUnlockThisDeviceOnly` Keychain；刷新凭据和短期 deviceCode 随同原子状态保存在同设备 Keychain。仅公钥允许导出；桥不提供私钥导出 API。不强制 Secure Enclave，不宣称硬件支持。

排除备份的 Application Support 安装标记用于防止继承遗留 Keychain 身份。无标记但已有 Keychain 项时拒绝初始化，不擅自销毁旧凭据；后续需要显式重置流程。已有安装标记但密钥／状态缺失也返回错误，不静默切换新身份。首次确认无旧项、创建新 key 后状态写入失败，会仅清除本次未提交材料以允许重试；有效提交保留。整包状态 CAS 由串行锁和原子 Keychain 更新完成，失败保留旧状态。

状态暂时不可读或签名失败只影响主动使用的实验绑定，本地资料启动应使用懒工厂。关闭 Capacitor 日志；插件异常只返回固定错误代码。

实现复用 Apple Security／CryptoKit 与项目已固定的 Capacitor 8.5.3 API；没有复制第三方加密实现。Windows 本片未编译或运行 Swift，仍须 macOS／模拟器／设备验证。
