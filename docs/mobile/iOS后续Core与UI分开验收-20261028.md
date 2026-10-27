# iOS后续Core与UI分开验收

2026-10-28。此片仅变更Apple CI执行条件与构建时间预算，不改变产品TLS、CA/SAN、授权、30秒写入或120秒传输等任何运行时限制。

## 已发生的事实

- 4de5a460/run40558067136的App实际编译成功，Core仅记录Build complete后无case结果；job35分钟自然超时cancelled，UI跳过。
- 3ae2eed9/run40566551923/job122409245244在安装723包后因`ERR_PNPM_IGNORED_BUILDS core-js@3.50.0`失败，App/Core/UI均跳过，不拿旧编译背书此轮。
- f7e8a30b/run40567103655/job122411199305已实际通过frozen安装、shared build和App compile，目前Core执行中；截至本片没有Core/UI结果。没有人为取消该run，下面变更尚未push，不追认当前run包含它。

## 后续执行条件

给实际App编译步骤设置`id: compile_ios`。安装／8个UI测试仅在`always() && !cancelled() && steps.compile_ios.outcome == 'success'`时执行：App未编译成功或workflow已取消仍跳过；App已真实编译而独立Core失败时继续收集UI证据。没有`continue-on-error`，Core的非零结果仍使job失败；UI通过不能把Core失败或整个job变绿。

普通全字段及MCP准备探针令原5UI扩为8UI；后续job预算60分钟，编译步骤15分钟、Core仍12分钟、安装/UI25分钟，留诊断上传时间。此为CI工序预算，不延长任何产品操作截止，也不把“给更多时间”写成已修挂点。独立Core stage NDJSON与UI只读SQLite同ID观察器继续保留。

依据[GitHub状态条件](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions)与[steps outcome](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#steps-context)，以及[窄审回执中的只读建议](手机最低运行时API窄审及AI兼容修复-20261028.md)。本地diff检查无误；真实GitHub条件、17Core和8UI待此变更下一次实际运行验证，不能仅凭YAML判断验收通过。

分支提交、不合main、不改4180/4196或发布生产；同一当前Apple run允许自然结束后再统一触发下一候选。
