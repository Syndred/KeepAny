# 检查入口

所有最终包检查均显式选择同一干净便携ZIP；证据保存在忽略的test-results或仓库外。失败保留原目录，禁止覆盖、删除用例或重试凑绿。机器身份/结果/几何与人工视觉、主控体验、独立复核分别判断。

- Daily checks：单元、编译/便携校验；当前账号编辑/compact/关系38例；PDF拒绝与旧项目兼容子集；本轮收录/AI/备份34例及120张图摘要；匹配弹窗2个pilot。job上限30分钟，绿色只代表这些范围。
- Verify local release：手动完整发布工作流。保留业务、故障、离线、历史升级与平台检查。账号38例由仍同名的account-layout job执行，portable-workflows不重复这三份spec。
- node scripts/check-account-entry.mjs candidate.zip newOutput：当前账号合同、zh-CN/en×390/768/1280/1920/2262/2560矩阵、机器证据校验。test:final:layout是兼容入口，指向同一合同。
- node scripts/check-cleanup-ux.mjs candidate.zip newOutput：当前收录/AI/备份及项目交互合同，拒绝缺项、跳过、重试或候选混版。模型服务为合成协议测试，真实提供商调用另列。
- 源码故障注入使用completion-source；真实最终包使用portable相关配置；两类证据不能互称。其余专项配置供定向排错，按涉及范围选择，不反复跑无关全套。

旧冻结档案校验已退役，不再补回历史截图和旧hash。历史AL展开卡片合同与当前compact卡片的差异及保留覆盖记录在账号检查器receipt；旧测试文件暂留作业务断言迁移参考，不是当前UI验收口径。可选旧golden未配置，不宣称自动视觉通过。
