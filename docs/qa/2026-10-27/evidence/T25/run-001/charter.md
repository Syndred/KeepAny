# T25 范围与基线

目标：设置语言/示例、普通全局搜索排除秘密、笔记与回收站、外部密码库引用。界面为React本机隔离Chromium，测试端口4204，所有夹具合成。禁止用户4180资料、外部收费端点及其他会话。

原生执行：复用global-search.spec.ts、notes-trash-release.spec.ts、english-demo-release.spec.ts、vault-reference-release.spec.ts；每个CLI结果只映射确实执行的行为，不外推未覆盖边界。使用项目已有Playwright/Vitest，不引入依赖或改CI。预期以总表T25-01～04及既有合同为准。初始观察后再决定补探，缺覆盖不提前通过。

退出：4项结果有可定位证据；缺陷先确认复现再修复，原步骤和相邻回归通过；中英文390/1280截图复核。先运行已存在的真实浏览器测试作为一条原生探测命令；15分钟探索限时不代替显式用例要求。
