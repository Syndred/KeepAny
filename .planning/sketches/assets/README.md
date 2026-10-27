# 草图资产来源

- 图标：使用当前项目已安装 `lucide-react@1.48.0`，通过其 React 导出及项目现有 ReactDOM 服务端渲染 API 输出 SVG；未复制上游业务源码。来源基线的 `package.json`／`pnpm-lock.yaml` 为 `65636db`；原包路径 `node_modules/lucide-react/dist/cjs/lucide-react.js`。只统一输出大小24、描边1.8和当前深蓝颜色，未改图标路径；原 ISC 许可保留于 `LUCIDE-LICENSE`。
- K标志：直接引用仓库 `apps/web/public/icons/keepany.svg`，未另制品牌资产。
- 无远程字体、图片、统计或外部脚本；虚构示例只在内存中演示。

这些 SVG 与 HTML 仅用于本轮可审阅草图；正式实现继续调用既有 Lucide React 组件，不把输出图标另造为应用组件库。
