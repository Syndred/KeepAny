# KeepAny 公开介绍页

项目统一使用 KeepAny，曾以 StackPerch 名称发布。正式仓库和项目 Pages 使用 KeepAny；旧 StackPerch GitHub 入口由 GitHub 重定向。不承诺旧 StackPerch Pages 地址继续可用，也不重建用户已停用的兼容仓库。

这是本地核心的中英文公开文档页，不是在线资产应用，也不是会员或支付网站。主内容通过 ReactDOMServer 生成静态 HTML，无需运行 JavaScript 即可阅读；按钮和文字链接复用应用组件，设计变量与样式复用 `apps/web/src/styles.css`。默认首页英文，`zh/` 为中文。

## 构建

依锁文件安装依赖后，在仓库根目录执行：

```bash
node scripts/build-public-site.mjs
```

产物为 `dist/public-site/`，已在仓库现有 `dist/` 忽略范围。仅发布该目录，不发布 `apps/web`、`release/web`、本地备份或测试资料。目录中不包含资产应用运行时、Service Worker、登录凭据或真实用户记录。

可选配置：

| 环境变量 | 默认与用途 |
|---|---|
| `KEEPANY_PUBLIC_SITE_URL` | `https://syndred.github.io/KeepAny/`，必须是无凭据、查询和片段的 HTTPS 地址；生成 canonical、hreflang、OG 和 sitemap |
| `KEEPANY_PUBLIC_DOWNLOAD_URL` | GitHub Releases 列表；只能在实际发布后改为已存在的版本或资产地址 |
| `KEEPANY_PUBLIC_SCREENSHOT_EN` | 本轮正式包的英文合成示例 PNG；也可明确指定已检查的公开 PNG 截图路径 |
| `KEEPANY_PUBLIC_SCREENSHOT_ZH` | 本轮正式包的中文合成示例 PNG；发布前确认无个人资料、密钥或不明权利素材 |

保留 `STACKPERCH_PUBLIC_*` 环境变量作为兼容配置；对应 `KEEPANY_PUBLIC_*` 有值时优先采用 KeepAny 配置。默认地址使用 KeepAny 项目 Pages 路径，不以构建成功证明本轮已部署。部署、GitHub 仓库公开和下载包发布状态由根交接分别记录。

## 搜索与爬虫文件

- 当前主品牌为 KeepAny，SoftwareApplication 的 `alternateName` 为 StackPerch；页面使用 `keepany.svg`，同时保留 `stackperch.svg` 资源别名。
- 中英文 HTML 的 title、description、canonical、hreflang、OG 与 SoftwareApplication JSON-LD 来自页面实际内容，不编造评分、用户数、安全审计或托管可用性。
- `sitemap.xml` 仅列公开中英文介绍页；`llms.txt` 提供客观产品范围与公开文档链接。`llms.txt` 不是保证被收录或推荐的机制。
- 构建 `robots.txt` 模板允许普通搜索、`OAI-SearchBot`、`ChatGPT-User` 与 `GPTBot` 抓取公开内容；不包含用户本地库或私有服务地址。
- **robots.txt 必须从站点域名根路径 `/robots.txt` 提供才生效。** GitHub 项目 Pages 的 `/KeepAny/robots.txt` 仅为模板，不控制 `syndred.github.io` 的根策略；停用用户兼容站后，根路径的响应由 GitHub Pages 托管行为决定。不能以子目录文件返回 200 宣称根爬虫策略已部署。使用独立域名／根站点时，可把模板作为根策略并复核实际响应。

页面仅有公开介绍和下载入口；爬虫配置不能取得本机资料，也不替代发布质量、外部用户反馈和第三方推荐判断。

## 验证

构建后检查中英文主内容在关闭 JavaScript 时可见、链接有效、390/1280 宽度无横向溢出、按钮和卡片间距，以及下载入口的实际发布状态。检查产物仅包含预期静态文件，部署后回读页面、资源、canonical、sitemap 与域名根 robots。源码构建不等于部署完成。
