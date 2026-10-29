# gstack：Windows 隔离浏览器补充复核

2026-10-27，使用固定 gstack 1.91.268.0 的 `browse.exe`、自有 Chromium、源码4210及合成示例资料。没有用户 cookie、密码、4180 或外部服务操作。安装身份见[工具回执](../测试工具-Windows安装.md)。

## 发现与修复

`GSTACK-001`（中等，可访问性）：中文/英文界面正常切换，但根 `<html>` 没有 `lang`，浏览器无法从文档语言声明确定界面语言。gstack 原观察030、原样重放031均读到空字符串；新建回归先在中文启动路径红测（期望zh-CN，实际缺属性），不是静态猜测。

仅为入口HTML补默认en，并让现有i18next初始化/语言改变时按其实际resolvedLanguage更新文档语言。没有新增存储、改变资料或调整页面布局。原全局语言选择器、原文案key继续使用。

修复后，两条正式浏览器测试（中文390/英文1280）2/2通过，4.8秒：各自初始语言、正式选择相反语言、刷新保持、切回初始语言、密码页hash导航及唯一活跃标签，pageerror为空。原gstack观察032回读en，随后实际选择中文的039回读zh-CN，无根页面横向溢出。相关i18n/汇总单测9/9、类型检查、改动lint通过。最终便携包范围另由主控整合回执确认。

## 补充观察及工具局限

修复前还实际经过概览→示例设置→加入示例→资产→刷新，三种示例资产仍在；账号→密码→外部引用，每次仅一项active。这些是修复前诊断基线，不充当修改后全项目绿色证书。

保留工具/夹具错误：PowerShell未引用`@e23`导致参数丢失；gstack密码标签ref两次匹配多个元素；误用aria-label（实际aria-labelledby）；自定义Radix选项选择器超时。改用实际属性/唯一ref后继续，没有将它们归为产品缺陷，也没有删除失败记录。

浏览器逐探针、下一步假设、900秒deadline和完整报告保留忽略目录`test-results/gstack-round2`，共39次原生观察/操作；它们不是39条新增验收。evidence materializer首次传入相对路径重复前缀失败，修正为根内文件名后成功产出，工具总裁决为`inconclusive: no evidence rows`（浏览器模式没有functional capture行），未冒称其自动认证通过。这里的缺陷结论依据实际DOM原观察和新浏览器回归；未做全站健康评分或真实读屏器测试。

仅保留[小回执](../evidence/gstack-round2/checks.json)和两张已目检图：[中文390诊断基线](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-27/evidence/gstack-round2/zh-390.png)、[英文1280修复后](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-27/evidence/gstack-round2/en-1280-after.png)，合计约149KiB。原完整测试大报告不加入Git，不把工具安装当作104条完成。

```powershell
$env:KEEPANY_E2E_PORT='4210'
node node_modules/@playwright/test/cli.js test tests/e2e/qa-document-language.spec.ts -c playwright.windows-qa.config.ts --workers=1 --reporter=line
node node_modules/vitest/vitest.mjs run apps/web/src/i18n.test.ts apps/web/src/workspace-summary.test.ts
```
