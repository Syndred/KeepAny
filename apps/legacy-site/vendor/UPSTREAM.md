# 跳转模板来源

- 项目：<https://github.com/jekyll/jekyll-redirect-from>
- 固定 commit：`839a7984eb00f70acd275fc825f7658711d3e8ce`
- 原文件：`lib/jekyll-redirect-from/redirect.html`
- 许可证：MIT，原 `LICENSE.txt` 一起保留。
- 本目录的 `redirect.html` 与 `LICENSE.txt` 为上游原文；渲染器 `../page.tsx` 复用 canonical、无索引、0 秒 meta refresh、脚本跳转和显式链接的结构。
- 修改：以已有 React 静态渲染器和应用 Button/TextLink 输出；增加中英文、viewport 和现有设计变量；脚本改用固定同域路径的 `location.replace`，保留当前查询与片段，不读取可控目标参数；未知路径仅给出404说明，不自动跳转。
- 保留行为测试：canonical 与无 JS 的 meta／显式链接、脚本 query/hash、外部查询不能改变目标、已知路径白名单、未知404、固定资源原字节复制。

上游是 Jekyll/Liquid，测试依赖 Ruby；本仓库保留模板原文，使用 Vitest 在实际 React 输出和构建器上验证同等跳转行为，没有引入 Jekyll 运行时。
