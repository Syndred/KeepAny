# T25 Windows续接回执

日期：2026-10-27。起始源码为最新远端main `f659db1`，主控已执行fetch与fast-forward检查。运行环境为Windows、Node24.21.0、Playwright1.63.0、独立Chromium上下文、本机源码4205；全部资料、密码、网站响应均为合成样本。没有操作用户4180、真实密码或外部站点。

## 完成

- **T25-01补验**：通过正式界面创建独立KDBX，写入只存在于密码字段的唯一合成秘密；刷新、重新解锁并打开条目，按原值回读，确认秘密实际保存。另通过本机识别生成私密导入草稿，等待“已加密保存草稿”，刷新解锁后按草稿名称及密码原值回读；该草稿没有导入为普通记录。保持密码库解锁，逐次用普通账号查询作正对照（1个可点击结果），再查KDBX秘密、草稿名称与草稿密码，结果均为0。最后从正对照结果进入账号详情。模型请求0。
- **T25-04补验**：中英390/1280四组合均走非法javascript协议→可见字段错误→取消→刷新无新增；合法HTTPS新增→列表回读→详情；编辑取消→刷新原名保留；编辑保存→刷新新名保留；点击合法外链实际打开新页并命中本机拦截的合成响应；删除取消→刷新仍在；删除确认→原详情不能再访问条目。引用表单不索取外部密码库密码。
- **QA-003修复**：外部引用页二级导航原有两个`aria-current=page`。Router按同一路径判active时忽略hash，给“密码管理”和“外部引用”同时加当前页状态。仅为两个Link增加`activeOptions.includeHash=true`，保留所有路径、存储和协议。修复后引用入口和切回密码入口均只有一个当前标签。

T25-02/03沿用先前已记录的通过状态，本次没有把它们重新计为Windows全量验收。T25-01/04本次补验可与原先普通四来源搜索、关联/备份恢复结果合并判定整条合同；总表由主控独立复核后更新。

## 验证证据

新增回归：`tests/e2e/qa-t25-windows.spec.ts`，2条流程×中英×390/1280，共8条。最终执行结果以[精简回执](../evidence/T25/windows/checks.json)为准。原始Playwright报告位于忽略目录`test-results/T25-final-results.json`。

```powershell
$env:KEEPANY_E2E_PORT='4205'
$env:KEEPANY_EVIDENCE_DIR='docs/qa/2026-10-27/evidence/T25/windows'
$env:PLAYWRIGHT_JSON_OUTPUT_NAME='test-results/T25-final-results.json'
node node_modules/@playwright/test/cli.js test tests/e2e/qa-t25-windows.spec.ts --workers=1 --reporter=line,json --output=test-results/T25-final-all
node node_modules/typescript/bin/tsc --noEmit
node node_modules/@biomejs/biome/bin/biome lint apps/web/src/page-workspaces.tsx tests/e2e/qa-t25-windows.spec.ts
```

类型检查、两文件lint均通过。截图仅保留[中文390](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-27/evidence/T25/windows/reference-zh-CN-390.png)、[中文1280](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-27/evidence/T25/windows/reference-zh-CN-1280.png)、[英文390](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-27/evidence/T25/windows/reference-en-390.png)、[英文1280](https://github.com/Syndred/KeepAny/blob/b8acfe562d8a4852fffad7fb8aa5ef55104e3fb5/docs/qa/2026-10-27/evidence/T25/windows/reference-en-1280.png)。已目检中文390与英文1280：外部引用单一黄色高亮，操作可达、文字可读，手机引用表使用既有横向滚动。

## 首次失败与夹具纠正

- QA-003首次真实红测：英文1280期望当前标签1，实际2，未改产品前失败；原始截图与上下文在`test-results/source/qa-t25-windows-en-1280-T25-e8c73-ellation-and-one-active-tab/`。精简红测信息写入checks.json，便于不提交重复大图仍可追踪。
- 合法外链首请求属于popup，`page.route`不能拦截popup首导航，改为`context.route`；保留真实点击、新页URL与本机响应，不访问外网。
- 刷新恢复的导入草稿进入核对页，原文输入框此时不存在；改为从核对表单按名称与密码原值回读，验证语义不变。
- 旧补探的中文文案有两处错误：密码标签实际叫“密码管理”，非法字段提示实际为“请检查此项”；按真实DOM及i18n修正定位，没有放宽断言。首次四组合为6过/2夹具失败，后续用修正脚本全部重跑，结果单列于checks.json。

## 未完成、阻塞与交付状态

本包没有新增产品阻塞。未验证真实Ego、真机或第三方密码服务；Windows隔离Chromium不冒充Ego。源码改动、测试和本回执交主控review与提交；本代理未提交Git、未更新release/web/4180/官网/Release/便携ZIP。浏览器与popup在各测试finally关闭；4205由主控统一清理。
