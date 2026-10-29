# 单一新增入口对既有测试的影响

2026-10-29。以下保留最初静态调用点审查；其后适配状态见末节。未执行的旧测试不能称为新版通过，也不将旧入口定位失败混同成业务回归失败。

本轮仅按主控分配适配3个直接相关文件，原密码功能断言保留：

|文件|本轮直接入口变更|原业务合同|
|---|---|---|
|`account-password-consolidation.spec.ts`|原顶部第二新增改标题旁唯一新增；新账号自动关联其密码，再通过真实解除关联转为原独立条目|复制/显示/编辑/搜索排除秘密/历史恢复/解除取消确认/回收站/KDBX导出导入均保留；普通账号由8变为明确9（新需求实际新增一个账号），KDBX仍9条|
|`account-link-recovery.spec.ts`|原顶部回收站按钮改滚动下方回收站|移入取消确认、可见回收站、恢复、导出密文及关系回读均保留|
|`password-vault-user-journey.spec.ts`|原顶部回收站按钮改滚动下方回收站|移入/恢复/条目数量/锁定解锁刷新均保留；原仅检查按钮导致hash的断言移入新独立测试的实际旧URL进入兼容检查|

以下仍直接使用删除的全局密码新增入口，或同文件同时有全局及局部调用。尚未逐个重建业务准备流程，不能盲改名称/数量求绿：

- `account-unlink-focus.spec.ts`（局部新增保留；第二个全局新增受影响）
- `account-layout-independent.spec.ts`（工具栏新增及原独立条目准备受影响）
- `account-layout-busy-independent.spec.ts`（工具栏新增恢复状态断言受影响）
- `account-shared-identity.spec.ts`（辅助password()使用全局工具栏新增）
- `password-history-version.spec.ts`
- `password-vault.spec.ts`
- `qa-t09-windows.spec.ts`
- `route-load-recovery.spec.ts`
- `stackperch-upgrade.spec.ts`
- `toast-dialog-layer.spec.ts`
- `vault-links-layout.spec.ts`
- `vault-dual-login.spec.ts`
- `unified-workspaces.spec.ts`（详情内新增保留；跳转全局页后的独立新增受影响）
- `workspace-navigation.regression.spec.ts`

以下同名按钮位于仍保留的账号展开区或详情嵌入，不能按文本匹配一并删除/替换：

- `account-password-layout.spec.ts`
- `account-layout-category-independent.spec.ts`
- `account-layout-minimal-independent.spec.ts`
- `workspace-vault-status.spec.ts`
- `account-unlink-focus.spec.ts` 的首个局部新增、`unified-workspaces.spec.ts` 的详情内新增。

普通账号新增旧测试中使用 `#name/#username/#category` 等原 AssetEditor 字段的调用点也可能需要迁移至合并表单；本轮未批量替换。旧普通账号详情编辑仍保留原ID，不得全局替换。自动检查的适配范围必须在CI配置和交付中明确说明。

## 后续适配

主控要求不遗留本轮直接导致的失效调用点。非实现者已进一步适配 `account-unlink-focus`、`account-layout-independent`、`account-layout-busy-independent`、`account-shared-identity`、`password-history-version`、`route-load-recovery`、`toast-dialog-layer`、`vault-links-layout`、`vault-dual-login`，及共享 `password-smart-import-visual::seedExisting`；主控另负责 `password-vault`、`unified-workspaces`、`workspace-navigation.regression`。

- 直接新增流程使用唯一标题新增。需要原standalone生命周期时，经真实保存后解除自动关联，保留新增普通账号；其计数严格增加1。公共helper为 `tests/e2e/helpers/standalone-entry.ts`。
- 历史版本测试保留新账号自动关联，避免解除关联本身新增历史破坏原始“历史为空”准备；原历史数量、顺序、恢复断言不变。
- 账号审核发布/族谱/回执4类场景及导入专项夹具，经主控确认，改为Node真实VaultSession生成虚构KDBX，再通过真实文件选择器导入来准备纯密码库。明确这是辅助准备，不冒充手工全局新增；普通账号列表严格保持原href，原审核发布、关系图和密码私密字段合同保留。
- `vault-dual-login`先导入空密码的纯KDBX条目，再进入真实编辑器填写其他标识并点击密码生成器，原生成器行为仍被执行。
- busy采样范围补入当前唯一header新增，详情/聚焦账号仍检查保留的局部toolbar新增；不得将原disabled预期删除。
- 进一步查明 `qa-t09-windows` 的显式两处新增及 `stackperch-upgrade` 的新增实际位于详情/聚焦账号局部，继续保留；前者共享夹具的旧全局入口已迁移。

对“普通账号新增”的旧ID只在真实创建表单上下文迁移；详情编辑继续使用原AssetEditor的ID。测试实际结果与候选身份在独立复核报告中另列，此处不以静态替换宣称验收。
