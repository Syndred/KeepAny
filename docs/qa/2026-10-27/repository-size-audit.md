# 仓库下载体积核查

2026-10-27，Windows。核查提交 `f659db1cfe08e7f18c1f15974b83416f092cfd3f`。只读统计 Git 对象和该提交的文件树；没有删除证据、构建资源或改写提交历史。以下统一使用 MiB（1 MiB = 1,048,576 字节），不包含后续安装的 node_modules。

## 结论

初次克隆的四百多 MB 主要来自纳入 Git 的历次验收截图。当前本机 Git pack 和索引为 **405.16 MiB**；PNG 对象在 pack 中约 **367.08 MiB**，约占整体 90.6%。应用与领域/存储包源码（apps + packages）在当前提交仅 **3.21 MiB**。

不只是遥远历史：当前提交本身仍携带大量截图与旧版构建资源，因此只做浅克隆、删除本机缓存或加 .gitignore 都不能解决主要问题。

## Git 下载对象

|路径归类|pack 内实际压缩条目合计|字节|
|---|---:|---:|
|docs/evidence|367.04 MiB|384,868,523|
|docs/qa|7.03 MiB|7,372,765|
|release/web|24.72 MiB|25,919,940|

这三类合计约 398.79 MiB。其余为源码、文档、提交/目录对象及索引等。归类使用 `git rev-list --objects --all` 为每个 blob 提供的代表路径；同一 blob 跨路径复用和 Git 跨对象差分会影响归属，因此该表不是删除目录后可精确节省的下载量。

最大单项并非几百 MB 的单个文件，而是成千张截图累积。例：`docs/evidence/2026-10-21/password-grid/已确认UI图.png` 原始 1,491,661 字节，pack 内 1,303,120 字节；`docs/evidence/2026-10-13/stackperch/source-full.json` 原始 2,337,068 字节，pack 内 1,279,877 字节。

## 当前提交检出文件

`git ls-tree -r -l HEAD`：8,270 个文件，合计 **728.80 MiB**（764,204,415 字节）。这是解压后的文件内容，不应与压缩下载量相加或混为一个口径；本机 .git 另占空间。

|范围|文件数|原始体积|
|---|---:|---:|
|docs/evidence|4,770|444.85 MiB|
|release/web|2,692|268.08 MiB|
|docs/qa|196|8.02 MiB|
|apps + packages|338|3.21 MiB|

`docs/evidence` 中 PNG 有 3,832 个，共 423.67 MiB。`release/retained-assets.json` 列出的 2,590 个旧哈希资源共 **261.02 MiB**；release/web 中其余 102 个当前文件合计仅 **7.06 MiB**。这些旧资源是为未关闭旧标签的延迟加载兼容而保留，不能直接清空后声称升级兼容不变。参见 `release/README.md` 升级说明。

## 后续处理建议

1. 新验收仅提交精简回执与必要代表图；大批截图、完整执行日志改为可追溯的 CI/发布附件或专门证据存储。先明确保留期限和引用迁移，不能让现有证据链接静默失效。
2. 固定构建产物与源码分离；旧标签兼容资源按明确支持版本/保留期管理。现有 `build-preview-release.mjs` 已从新构建产物打包，不读取历史 release/web；便携包源码快照也已有排除历史资源的实现，可以优先复用。
3. 仅从当前分支移走文件可减小后续源码 ZIP 和检出体积，完整克隆仍会下载旧历史。要减少完整克隆大小，需要另行规划历史迁移/重写，并处理同仓库提交历史、现有标签/发布引用与协作克隆；本轮没有实施。
4. 临时轻量开发可用 Git partial clone（`--filter=blob:none --no-checkout`）配合 sparse-checkout 排除历史截图和 release/web，再检出所需源码；仅 `--depth=1` 仍要获取当前大文件。完整测试、公开站构建和固定包验收需要按各自输入补取素材，不能把稀疏检出宣称为完整验收环境。

## 复核命令

- `git count-objects -vH`
- `git -c core.quotepath=false ls-tree -r -l HEAD`
- `git rev-list --objects --all`
- 对本机实际 `.git/objects/pack/*.idx` 文件逐个运行 `git verify-pack -v <完整idx路径>`，按 blob 的压缩条目字节汇总。
- `git cat-file --batch-all-objects --batch-check='%(objectname) %(objecttype) %(objectsize)'` 用于复核完整 blob 原始大小；不能把 verify-pack 对 delta 的表示长度当成还原文件大小。
- `release/retained-assets.json` 与 HEAD 中 release/web 路径交叉统计旧资源。

核查未连接用户数据库、未读取浏览器资料、未更新4180或发布。
# 第二轮补充（2026-10-27）

新增Windows MCP安全后端与回归后，当前Git跟踪的`apps/`＋`packages/`共342个文件、3,482,435字节（3.32MiB）；本轮最终便携ZIP为4,813,121字节（约4.59MiB）。GSD、gstack、Bun、PostgreSQL和各自依赖均在用户工具目录或同级独立商业仓，不进入KeepAny Git。

下文405.16MiB Git pack与367.08MiB PNG对象是接手时对“四百多MB拉取”的实际基线，仍解释原下载的大头。第二轮没有重写历史、删已有证据或动release/web；只删除当前工作树图片也不会移除已有Git历史对象。旧候选包的本轮清理被自动审批拒绝后保留在忽略dist目录，具体见最新Windows验收记录。
