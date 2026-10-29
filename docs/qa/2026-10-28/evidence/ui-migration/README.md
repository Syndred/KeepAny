# UI迁移证据索引

当前产品941d8c64173a。最终功能、视觉/交互、源码断点回归和用户原资料检查分别列出；历史修复检查点保留，不叠加测试计数。

- [最终功能：机器判定pass](qa-completion-functional/README.md)
- [最终浏览器：67条原生命令、截图和边界](qa-completion-browser/README.md)
- [当前检查及历史输入区别](checks/current-checks.json)
- [4180逐文件身份](checks/local-4180-identity.json)
- [4180浏览器实际状态](checks/local-browser-receipt.json)
- [4180最终截图](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-28/evidence/ui-migration/checks/local-4180-assets-final.png)
- [当前控制台统计](checks/console-summary.json)
- [源码中英文四断点截图](source-density/)

历史检查点：

- [qa-fixed-package](qa-fixed-package/README.md)：历史：统一组件后发现状态列和空计划列问题；后续输入替代。
- [qa-final-recheck](qa-final-recheck/README.md)：历史：空计划列修复后发现混合卡片底部未对齐；后续输入替代。
- [qa-final-1203](qa-final-1203/README.md)：历史：卡片对齐修复后发现移动日期和分类触发区不足44px；后续输入替代。
- [qa-final-8457](qa-final-8457/README.md)：历史：移动触发区修复后发现概览页头和卡片密度不足；后续输入替代。
- [qa-delivery](qa-delivery/README.md)：历史：概览修复后，在真实4180又发现启用提醒条占高；后续941d输入替代。

failures/保存原失败截图与错误上下文，checks/保存红绿日志。提醒首轮绿测仍触发原首屏门槛的失败也保留，最终通过未降低原标准。所有测试资料均为虚构；未复制用户密码、浏览器控制状态、加密备份或真实库。静态草图与真实截图分目录，草图不构成功能验收。
