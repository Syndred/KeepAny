# 旧官网兼容站

独立用户站仓库 `Syndred/syndred.github.io` 承接旧 `/KeepAny/` 与 `/KeepAny/zh/`，正式介绍页由 `Syndred/StackPerch` 的项目 Pages 提供。不要重新创建 `Syndred/KeepAny` 仓库，它会破坏 GitHub 对原仓库的自动重定向。

该构建仅分发公开静态介绍、合成截图及跳转页，不读取或发布本地应用、密码库、备份或真实资料。页面复用现有 React 静态渲染、Button/TextLink 和统一样式；不增加商业或资产应用功能。

## 先预置镜像

将已发布旧站的10个白名单文件下载并逐个验证为旧发布字节后，明确指定快照目录：

```bash
pnpm build:legacy-site --mode mirror --mirror-source /absolute/path/to/verified-old-public-site
```

输出 `dist/legacy-site/`。`KeepAny/` 和 `StackPerch/` 都是该公开快照的原字节副本，保留旧 canonical 与链接，供重命名和项目 Pages 部署之间临时过渡。根首页给出双语入口，不自动跳转。只可在确认用户站发布并真实回读两个路径后重命名正式仓库。

产物保留根 `README.md`、AGPL `LICENSE`、上游 MIT 声明和 `TRACE.json`，记录构建模式、源仓库 revision、工作区是否有未提交修改及10个旧公开文件 SHA-256。默认读取当前 Git SHA；可用 `--source-revision` 明确指定完整40位小写 SHA，CI验收与最终部署必须使用干净且实际存在的版本。

## 正式站上线后改为跳转

```bash
pnpm build:public-site
pnpm build:legacy-site --mode redirect --mirror-source /absolute/path/to/verified-old-public-site
```

`--public-source /absolute/path/to/generated-public-site` 可替代默认 `dist/public-site/`；必须为新正式 canonical 的静态介绍。输出仍为 `dist/legacy-site/`，临时 `StackPerch/` 镜像移除，让新路径由项目 Pages 提供。

- 根首页、旧英文／中文页分别 canonical 到正式新地址，提供0秒 meta refresh、固定同域 `location.replace` 和明确链接；关闭 JavaScript 仍可跳转／点击。
- JavaScript 保留当前查询参数与片段。查询中的 `redirect`、`next` 或外部 URL 不参与目标选择；新目标始终是同域固定 `/StackPerch/` 或 `/StackPerch/zh/`。
- 旧 `KeepAny/assets/` 中的 CSS、两张公开截图及两个 SVG 保留旧发布原字节，仍须线上检查HTTP200。旧／根 `llms.txt`、`sitemap.xml`、`robots.txt` 使用新正式链接。
- `404.html` 仅识别旧主页、语言页以及它们的 `index.html` 入口。未知路径显示404说明与官方双语链接，不强制跳转，不承诺任意历史深层路径。
- 输入路径必须为明确绝对目录，所有白名单文件必须为普通文件；拒绝应用运行时、symlink、应用／release目录，以及重叠源／输出。输出固定在 `dist/legacy-site/`。
- Jekyll 官方模板固定版本、原文件、MIT 许可和修改点见 [`vendor/UPSTREAM.md`](vendor/UPSTREAM.md)。原模板许可随产物进入 `assets/redirect-template-LICENSE.txt`。

构建成功不等于公网部署；两阶段部署、GitHub旧链接、真实旧／新页面、无JS跳转、资源与爬虫入口必须由发布回执分别记录。域名根 `robots.txt` 只有用户站实际上线后才生效，不保证GPT索引或推荐。
