# Contributing to StackPerch / 参与贡献

StackPerch, formerly KeepAny, is a local digital asset workspace for independent developers. The current focus is making the local preview understandable, easy to run, and reliable to recover. Commercial expansion is paused. Issues and pull requests in English or Simplified Chinese are welcome.

StackPerch（原名 KeepAny）面向维护多个项目的独立开发者。当前优先完善本地试用、资料关联和备份恢复，商业功能暂停扩展。欢迎使用简体中文或英语提交问题与 PR。

## Report a problem / 反馈问题

Search [existing issues](https://github.com/Syndred/StackPerch/issues) first. Include:

- App version or source commit, OS, browser, and language.
- Reproduction steps, expected behavior, and actual behavior.
- Whether you used the portable preview or a source build.
- A screenshot or minimal synthetic example if it helps.

先搜索已有问题。说明应用版本／提交、系统、浏览器、语言、使用的包、复现步骤与预期／实际结果。界面问题请注明窗口宽度。使用虚构数据，不上传真实密码、API Key、主密码、个人资料或完整备份。

For security issues, follow [SECURITY.md](SECURITY.md). Do not post exploit details or secrets in a public issue.

## Development setup / 开发环境

Read [README](README.md), [product boundaries](docs/00-产品范围与开放边界.md), the latest [handoff](docs/08-项目进度交接.md), and the relevant [acceptance criteria](docs/06-开发计划与验收清单.md). Check `git status` before syncing or editing; preserve local changes. Maintainers should fetch the remote and fast-forward only when safe.

Use Node.js 22+ and the pnpm version in `package.json`:

```bash
npm install --global pnpm@11.10.0
pnpm install --frozen-lockfile
pnpm dev
```

The development app uses `http://127.0.0.1:5173/`; the portable preview uses port 4180. Browser stores are separated by origin and profile. Use an isolated test profile and synthetic data. Do not refresh a user's page with an unsaved draft.

## Change guidelines / 改动约束

- Reuse existing project components and patterns first. For new dependencies or copied upstream code, record source, precise version or commit, original path, license, modifications, and retained tests.
- Keep the React app and shared design variables consistent. Review spacing, long content, empty/error/loading states, focus, keyboard behavior, and narrow layouts.
- User-facing copy belongs in locale keys and must support zh-CN/en. Developer explanations belong in docs, not in the UI.
- RxDB is the local asset source. TanStack Query is for remote services; do not add another asset state source.
- Passwords and persistent AI keys stay in the separate KDBX boundary. Do not place sensitive values in assets, logs, ordinary AI context, MCP, or asset sync. Any new external data transmission needs an explicit, accurate user-facing scope.
- Keep ShipAny and KeepAnyAdm source, keys, production data, and unlicensed assets out of this repository.
- Keep changes scoped and reversible. Remove temporary fixtures, records, processes, and unrelated files when done.

优先复用现有实现；界面需自查中英文及窄屏间距；敏感资料边界不可扩大。开发说明不进入用户 UI，临时测试资料和服务及时清理。

## Verify and submit / 验证与提交

Run the checks relevant to the change, and include commands and results in the PR. Standard checks are:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Sync tests require an **isolated** PostgreSQL database via `KEEPANY_TEST_DATABASE_URL`; never point tests at production. Browser tests and fixed-package validation have dedicated configurations; use the instructions for the affected flow rather than treating a development page as proof of a released package.

For UI changes, inspect the actual React app in both languages and relevant desktop/mobile widths. For storage or recovery changes, verify the downloaded file in a clean profile and check actual records and images. Add meaningful regression tests for corrected behavior; documentation-only edits do not need new tests.

Keep commits focused. Explain the problem, changed behavior, verification, and remaining limitations. Update the Chinese project handoff when behavior or delivery state changes. Distinguish source changes, commits, pushes, built packages, CI, deployment, and live verification.

By contributing, you agree that your contribution is provided under the repository's [AGPL-3.0-only license](LICENSE), except for identified third-party material retained under its own license. Do not contribute code or assets you lack permission to distribute.
