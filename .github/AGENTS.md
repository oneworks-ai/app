# GitHub Actions Agent Notes

这个目录维护 One Works 的 GitHub Actions 配置。这里的 `AGENTS.md` 只记录 CI/CD 内部结构、入口和当前已知风险；详细凭据维护放到 `.oo/rules/release/`。

## 继续阅读

- [发布凭据与 secret](../.oo/rules/release/github-actions-secrets.md)
- [macOS Developer ID 签名](../.oo/rules/release/macos-signing.md)
- [发布步骤](../.oo/rules/release/process.md)
- [tag 与经验沉淀](../.oo/rules/release/tags.md)
- [Homepage Docs 维护经验](../.oo/rules/maintenance/homepage-docs.md)
- [PR 经验复盘门禁](../.oo/rules/maintenance/pr-experience-review.md)

## Workflow 地图

- `quality.yml`：所有 `main` push / PR / 手动触发都会跑 lint、format、typecheck、commit message 检查。
- `pr-experience-review.yml`：PR 创建、编辑或同步时通过 Pull Requests API upsert 经验复盘提醒 review summary；硬门禁仍由 `quality.yml` 的 `pr-change-policy` 调用 `pnpm tools pr-change-check` 执行。
- `release-tags.yml`：按 package version / scripts 相关路径触发，创建 `pkg/*/v*` release tags，并按 tag 显式调度对应发布 workflow。
- `npm-publish-alpha.yml`：手动发布 npm alpha 包；默认走 Trusted Publishing，新增包 bootstrap 才允许显式使用 `NPM_TOKEN`。
- `vscode-extension-ci.yml`：按 VS Code 扩展相关路径触发，构建并上传 VSIX artifact，不发布商店。
- `vscode-extension-release.yml`：通过 release tag 或手动输入 tag 发布 VS Code Marketplace、Open VSX 和 GitHub Release。
- `desktop-package.yml`：构建 macOS 桌面包；PR 上总是产出 `macOS installer` check，非桌面打包相关改动会快速跳过，tag / 手动 release 模式会创建 GitHub Release。
- `relay-ci.yml`：只在 Relay Server / Admin / config hook 相关路径变化时跑 server test、admin test 和真实 `relay-config live-smoke`。
- `deploy-relay-dev.yml`：Cloudflare dev Relay/Admin 由 Actions 部署并 smoke；Vercel dev Relay/Admin 由 Vercel GitHub App 部署，Actions 只轮询 `dev.vc.oneworks.cloud` 做 smoke，不能恢复长期 Vercel CLI token 发布路径。
- `deploy-relay-server.yml`：只监听 Relay Server runtime 和构建依赖，构建 server 部署 artifact 并可按变量触发外部 Relay Server 部署；纯 Admin 前端改动不会触发它。
- `deploy-relay-admin.yml`：只监听 Relay Admin 前端及其 UI 依赖，构建独立 Admin 平台 artifact 并可按变量触发外部前端部署。
- `deploy-pwa.yml`：从 app 仓库触发 `oneworks-ai/pwa` 的部署 workflow。
- `deploy-avatar.yml`：从 app 仓库触发 `oneworks-ai/avatar` 的 GitHub Pages 部署 workflow，只监听 avatar 相关路径；目标仓库独立安装构建，不应依赖 app 根 workspace install。
- `deploy-homepage.yml`：从 app 仓库触发 `oneworks-ai/oneworks-ai.github.io` 的 GitHub Pages 部署 workflow，只监听 `.oo/docs` 和自身 workflow。

## 当前 Secrets / Variables

已配置仓库 secrets：

- `NPM_TOKEN`
- `VSCE_PAT`
- `OVSX_PAT`
- `PWA_DEPLOY_TOKEN`
- `AVATAR_DEPLOY_TOKEN`

新增 homepage 文档站部署需要配置的 secret：

- `HOMEPAGE_DEPLOY_TOKEN`

Relay 部署可选配置；未配置时 workflow 只验证并上传 artifact，不触发外部部署：

- secrets: `RELAY_SERVER_DEPLOY_TOKEN`、`RELAY_ADMIN_DEPLOY_TOKEN`
- variables: `RELAY_SERVER_DEPLOY_REPOSITORY`、`RELAY_SERVER_DEPLOY_WORKFLOW`、`RELAY_ADMIN_DEPLOY_REPOSITORY`、`RELAY_ADMIN_DEPLOY_WORKFLOW`

官方 Relay dev slot：

- Cloudflare dev 需要 `RELAY_DEV_CLOUDFLARE_API_TOKEN`、`RELAY_DEV_CLOUDFLARE_ACCOUNT_ID`。
- Vercel dev 通过 Vercel GitHub App 连接 `oneworks-ai/app` 的 `main` 分支和 `apps/relay-server` root directory；GitHub 侧只配置可选变量 `RELAY_DEV_VC_ORIGIN` 和 smoke 相关变量，不配置 `RELAY_DEV_VERCEL_TOKEN`。

桌面签名需要但当前未配置的 secrets：

- `APPLE_ID`
- `APPLE_ID_PASSWORD`
- `APPLE_TEAM_ID`
- `DESKTOP_CSC_LINK`
- `DESKTOP_CSC_KEY_PASSWORD`
- `DESKTOP_CSC_INSTALLER_LINK`
- `DESKTOP_CSC_INSTALLER_KEY_PASSWORD`

已配置仓库 variables：

- `VSCODE_EXTENSION_PUBLISHER=oneworks-ai`

桌面 workflow 还读取这些可选 variables；未配置时使用 workflow 内默认值：

- `DESKTOP_SIGN=false`
- `DESKTOP_AUTO_UPDATE=true`

## 维护约束

- 不把 token 明文写入仓库、issue、日志或文档。
- 新增 workflow 时统一设置 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`。
- 修改 `.github/workflows/*.yml` 后至少跑 `pnpm exec dprint check .github/workflows`。
- 需要验证 GitHub 侧真实结果时，用 `gh run list` / `gh run view` 看远端 workflow，不只看本地脚本。
- 调整 homepage docs 跨仓部署时，还要确认 `oneworks-ai/oneworks-ai.github.io` 的 `Deploy Pages` workflow 真实通过，并验证 `https://oneworks.cloud/docs/`。
- `.github/AGENTS.md` 必须保持精简；详细过程、踩坑和轮换步骤继续拆到 `.oo/rules/release/`。

## 已知风险

- 当前迁移期会把仓库 force push 成单提交快照；这会让 GitHub `paths` 过滤在部分 push 上近似看到整仓变化，导致 Desktop / PWA / VS Code CI 在文档改动后也被触发。
- `Release Tags` 在 force push 后可能找不到可比较 base 并进入 initial plan；已存在 tag 会跳过，但 force push 不会移动旧 tag。
- VS Code 官方 Marketplace 和 Open VSX 是两套发布系统；`VSCE_PAT` 不能用于 Open VSX。
- npm Trusted Publishing 不能用来创建全新包的首次 package settings；新增 public 包首发后要去 npm 配 Trusted Publisher。
