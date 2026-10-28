# ISSUE-006：有到期提醒时仍占95px

实际Chrome原资料回读揭示隔离样例未覆盖的状态。98da5cae494c，4180资产页，1条到期提醒：card padded reminder-runtime-banner，高94.800003px；同一只读DOM命令原样重放仍94.800003。原实机截图另存local-4180-assets.png。没有修改用户任务日期或密码库来复现。

根因：提醒组件沿用card padded两段块布局，并把宽度限制居中，空横条把内容向下挤。

修复：独立提醒组件移除padded，以同排计数/提醒链接呈现；布局和内边距由.card.reminder-runtime-banner拥有，避免global .card覆盖；移动端链接保留44px触控高度，可换行，异常提示仍可读。

补齐合成样例第一任务当天到期。红测reminder-density-red.log复现横条过高。首次绿测捕捉新提醒条占据空间使原无提醒卡片首屏门槛不适用；不降低原>=6门槛，改为先验证有提醒横条，再通过真实改期让提醒消失后做原密度对照。reminder-final-green.log最终8/8，包含zh/en和4种屏宽；前面混合CSS时序的v2不作为最终证明。

此修复为941d8c64173a；最终包/原Chrome同状态再检查另存qa-completion-browser与本机更新回执。
