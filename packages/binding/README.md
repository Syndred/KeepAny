# 账户绑定消费端（阶段 3 验证切片）

本包消费 KeepAnyAdm 的人工设备码挑战和短期签名票据。商业仓库保持独立；这里未复制其源码，也没有连接生产账号。接口依据 2026-09-28 商业侧本地代码和合同；本机合成 Plus 账号已通过跨进程批准、续期和撤销回读，商业侧测试时工作树仍有未提交改动，正式联调应固定源码版本后复跑。

## 已实现的边界

- Web 本地实例生成随机 `instanceId` 和不可导出的 P-256 私钥；Dexie 保留私钥 `CryptoKey`、公钥、待轮询设备码、精确 `bindingId` 与商业 `sub`。默认仅申请 `sync:read`，调用方额外申请 `sync:write` 必须在产品 UI 明确展示。
- 固定 issuer 必须是 HTTPS 或本机回环 HTTP；JWKS 路径固定。`bindingTicket` 校验 RS256、签名、`kid`、issuer、`aud=keepany-binding`、`scope=binding:complete`、`iat/exp≤60s`、实例哈希、请求范围，以及轮询响应中的精确 `bindingId`/`sub`。新绑定与本地挑战、商业主体切换在 Dexie 事务内判定；重复同一 ID 幂等，其他主体需要显式切换参数。
- 首次轮询如收到设备绑定的刷新凭证，和绑定关系同一事务持久化。续期用本地设备私钥为商业 `/refresh` 签 `dpop+jwt`，校验返回的 `aud=keepany-sync-bound` 访问令牌后按同一 `requestId` 原子替换刷新凭证。请求超时可在 25 秒内重试同一 ID；结果超过该窗口时停止自动续期，避免错误重放撤销凭证族。访问令牌只在调用返回值中，不持久化。
- `/state` 查询使用设备证明、精确绑定和主体校验；明确返回撤销后清除本地凭证。网络失败不推断为已同步或仍有效。

## 威胁与未完成

本地 IndexedDB 中刷新凭证仍是敏感数据。不可导出私钥限制原始密钥导出，但同源脚本被控制时仍可能调用签名；浏览器数据清理会丢失身份和凭证。此实现没有证明能抵抗 XSS、恶意浏览器扩展或本机恶意软件，不把 `CryptoKey` 当硬件安全模块。

商业接口没有向任意跨源浏览器开放 CORS。Web 设置页的可选绑定入口通过受限本机桥转发；`createBindingBridgeFetch` 保留固定商业 issuer，只改网络目标，`bridgeBindingKeys` 经桥取得 JWKS。桥需另行启动并配置精确 Web Origin/Host；正式发布仍需可信启动器、端口发现、生产 JWKS/凭证管理与设备撤销传播。同步服务已做绑定访问令牌的固定映射验签，但没有商业动态撤销检查；绑定票据不能作为同步 Bearer。

未对真实 KeepAnyAdm 账号申请、批准、续期或撤销；单元测试使用本地 RSA/EC 签名 fixture 和 fake IndexedDB，另用临时合成付费账号完成本机真实 HTTP 跨进程浏览器联调。正式官方云同步上线前还需完成真实账号权限、动态撤销、密钥配对、冲突 UI 和加密附件的端到端验收。

## 原生身份后端（2026-10-27）

`storage.ts` 定义整包 `BindingState` 的读／CAS 和 `DeviceSigner`。`BindingRepository` 共用原身份、挑战、票据、轮换、撤销校验；`web-store.ts` 是延迟加载的原 Web 实现，保留 v2 数据表与 CryptoKey，v3 只增加独立 revision 元数据。状态写入失败不发布新凭据；CAS 冲突重读并重新运行纯本地变更。

生产证明签名调用 `deviceSigner()`，只取得公钥和 `signES256`，返回标准 64 字节 JOSE ES256 签名。旧 Web 消费者的 `deviceKey()` 保留；Native 调用此旧接口明确拒绝，不伪造 CryptoKey，也不把私钥导回 JavaScript。JWT 的 `alg`、`typ`、`jwk`、`htm`、`htu`、`ath`、`iat`、`jti` 和服务验签合同不变。

原生入口可同步注册 `registerBindingRepositoryFactory(createNativeBindingRepository)`（工厂位于 `packages/platform-native/src/native-binding.ts`）。工厂首次实际调用时才初始化插件；本地核心启动不依赖实验绑定能力。初始化／存储／签名失败不回退 Web 存储；绑定状态、挑战 deviceCode、刷新凭据均不进普通 SQL、Preferences、KDBX 资料备份或常规同步。

Android 使用系统 AndroidKeyStore P-256 签名、Keystore AES-GCM 包装状态和 `noBackupFilesDir` 原子文件。iOS 使用永久 SecKey 和 ThisDeviceOnly Keychain 状态，不强制 Secure Enclave；桥没有私钥导出方法，不承诺所有设备硬件支持。原生仍会把必要的当前刷新凭据带入 JavaScript 的瞬时网络调用；这不是 XSS 防护证明。Capacitor 框架日志必须关闭，插件只发固定错误代码，不记录凭据或签名输入。

本片通过原 Web／协议／软件原生桥合同测试和 Android 宿主编码测试，Android 设备测试只完成编译；Windows 没有 iOS 编译／运行证据。移动网络适配、项目注册与真实设备验收由独立切片接续，不能把本后端实现当作已完成生产授权。详见 `docs/mobile/原生绑定身份与签名基础-20261027.md`。
