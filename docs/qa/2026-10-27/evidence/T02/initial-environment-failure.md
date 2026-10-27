# 首轮环境失败保留

基线 b06208b，独立Vite4202，但最初通过符号链接共用 node_modules/.vite。

首轮执行 unified-workspaces、finance-linked-assets、finance-ledger 中相关10项：9通过1失败。失败为 finance-ledger.spec.ts:87 的 View bills 不可见；页面实际不是正常订阅详情，而是路由错误边界：`Failed to fetch dynamically imported module: http://127.0.0.1:4202/src/page-asset-detail.tsx`。Vite输出有同一TypeError、React Lazy/CatchBoundary及没有errorComponent的警告。不能据此判断产品删除了按钮。

原命令最小重放：`KEEPANY_E2E_PORT=4202 node node_modules/@playwright/test/cli.js test tests/e2e/finance-ledger.spec.ts --workers=1 --grep 'ledger records' --reporter=line`，1/1通过（4.2s），未改源码和断言。

首轮失败截图在后续原命令重放时被Playwright默认outputDir清理，未成功保存原图；此处明确披露，没有伪造首轮图片。后续边界失败截图已在重跑前复制到独立目录。

随后 resolveConfig 实际回读：cacheDir为工作树node_modules/.vite，realpath为 `/Users/syndred/Desktop/projects/KeepAny/node_modules/.vite`。多个工作树Vite并发、共用优化缓存已证实，但不据一次重跑声称完整根因。已仅把自建4202服务inline cacheDir隔离为工作树 `.gstack/qa-runtime/T02/vite-cache`；不改产品config，不计产品修复。后续仍需在隔离缓存上重跑同组合同。
