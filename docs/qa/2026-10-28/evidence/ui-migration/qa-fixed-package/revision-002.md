# 正式包修复与验证输入更新

ISSUE-001 有效红测保留于 ../status-red；修复后同一既有回归中英四种宽度 8/8 通过（../status-green.log）。来源提交 dbee5d3af305；最终 ZIP SHA256 b5a68ce727d97ee35bd4130878f27f80a68d8174c458fffdb04fdcddf4dfe957，108 Web / 454 source / 109 distributed license records。

使用新隔离源 http://127.0.0.1:4217 排除旧 Service Worker 和缓存；原 4216 旧观察标 superseded，继续使用同一个 qa-fixed-package/deadline.json（不延长、不重置）。截图旧文件保留，新结果另命名。后续重新恢复同一合成 .ka1、核对持久化结果，并重走原问题及相邻流程；不得把旧包 14/14 自动化回执当新包结果，新包后台独立重跑。
