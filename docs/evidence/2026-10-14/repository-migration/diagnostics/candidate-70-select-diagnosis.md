# Select 鼠标选择竞态诊断

- 测试源：70efcd37975b582d18df286d390fa7574dce8210；固定 release/web 服务；独立端口 4443。
- 保留原 selectChoice helper、真实鼠标和所有原断言，没有重试，没有产品修改。
- 完全使用已有合成 fixture。CPU 节流在首轮 reload/unlock 后、进入映射前设置，维持到 finally。
- CPU 4 倍：1 worker、repeat 5，5/5 通过；CPU 6 倍：2 workers、repeat 5，5/5 通过。
- 未复现 tag CI 的第 3 行 password 选择后 closed + 空 data-value 故障。此结果不能判定原 CI 失败原因。
- 安全 JSON 仅记录选项枚举、节点 ID/角色、矩形、焦点、指针坐标和事件；未记录原密码/原文/备注值。trace 使用合成 fixture。
- 每轮 finally 均关闭 context/mock，诊断结束恢复测试文件，逐字节与 source70 原文件一致。

映射点击 70 次，命中期望选项矩形 70 次，偏差 0 次。
初始选项 focus 范围 17.8–202.6 ms；开菜单至 pointerdown 范围 90.7–6291.3 ms。
恢复文件 SHA256：2f16afbcd9d21ca66b8fcf414d663b9ab4a5fce81fd65ace1c897629bd5f854b。

证据：rate4.log / rate6.log、每轮 safe event JSON 和 trace.zip、safe-summary.json、instrumented.ts。
