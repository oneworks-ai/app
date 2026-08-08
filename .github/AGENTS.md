# GitHub Actions Agent Notes

这个目录维护 One Works 的 GitHub Actions 配置。这里的 `AGENTS.md` 只记录 CI/CD 内部结构、入口和当前已知风险；详细凭据维护放到 `.oo/rules/release/`。

## 继续阅读

- [发布凭据与 secret](../.oo/rules/release/github-actions-secrets.md)
- [macOS Developer ID 签名](../.oo/rules/release/macos-signing.md)
- [发布步骤](../.oo/rules/release/process.md)
- [npm Trusted Publishing 与 Open VSX 认证](../.oo/rules/release/npm-trusted-publishing.md)
- [tag 与经验沉淀](../.oo/rules/release/tags.md)
- [Homepage Docs 维护经验](../.oo/rules/maintenance/homepage-docs.md)
- [PR 经验复盘门禁](../.oo/rules/maintenance/pr-experience-review.md)

## Workflow 地图

- `quality.yml`：所有 `main` push / PR / 手动触发都会跑 lint、format、typecheck、commit message 检查；PR 正文 `edited` 时只运行同 workflow 内的 `pr-change-policy`，避免重跑全量 Quality 且保持 required-check 身份不变。
- `pr-experience-review.yml`：PR 创建、编辑或同步时通过 Pull Requests API upsert 经验复盘提醒 review summary；硬门禁仍由 `quality.yml` 的 `pr-change-policy` 调用 `pnpm tools pr-change-check` 执行。
- `release-tags.yml`：按 package version / scripts 相关路径触发，创建 `pkg/*/v*` release tags，并按 tag 显式调度对应自动发布 workflow；VS Code prerelease 不建 tag，stable tag 只创建不自动 dispatch。
- `npm-publish-alpha.yml`：手动发布 npm alpha 包；默认走 Trusted Publishing，只有新 identity bootstrap 或经对账确认的 missing-trust 定向恢复才允许显式使用 `NPM_TOKEN`。
- `vscode-extension-ci.yml`：按 VS Code 扩展相关路径触发，构建并上传临时 VSIX artifact；alpha / beta / rc 只走这条 CI，不创建公开 release 或发布商店。
- `vscode-extension-release.yml`：只接受人工输入的精确 annotated stable tag，把同一个 authoritative VSIX 发布到 VS Code Marketplace、Open VSX 和 GitHub Release。
- `desktop-package.yml`：构建 macOS 桌面包；普通 PR 只产出几秒钟的同名 `macOS installer` required-check 兼容门禁，不使用 macOS runner，也不构建安装包。nightly 用 unsigned arm64 DMG 跑完整 package / smoke / install verify，保留 3 天用于提前暴露发布回归。`pkg/oneworks-desktop/v*` tag 或手动 dispatch 统一构建 arm64+x64 的 DMG / PKG / ZIP；带 `release_tag`、不勾 `create_release` 可生成正式身份的候选产物，之后用 `candidate_run_id` 提升同一 artifact，无需重打包。GitHub Release 成功后复用 `deploy-homepage.yml` 自动等待官网刷新。
- `relay-ci.yml`：只在 Relay Server / Admin / config hook 相关路径变化时跑 server test、admin test 和真实 `relay-config live-smoke`。
- `deploy-relay-dev.yml`：Cloudflare dev Relay/Admin 由 Actions 部署并 smoke；Vercel dev Relay/Admin 由 Vercel GitHub App 部署，Actions 只轮询 `dev.vc.oneworks.cloud` 做 smoke，不能恢复长期 Vercel CLI token 发布路径。
- `deploy-relay-server.yml`：手动把已批准的精确 `origin/main` SHA 提升到 Relay production；构建 Server + Admin artifact，优先触发完整配置的外部发布目标，否则直发官方 Cloudflare Worker / Pages 与 Vercel 单项目 Relay/Admin，并验证 build SHA、登录、未授权边界和真实 Admin 静态资产。
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
- `HOMEPAGE_DEPLOY_TOKEN`

Relay production 通过 `deploy-relay-server.yml` 人工 promotion。外部发布目标的三项配置必须同时存在或同时缺省：

- secret: `RELAY_SERVER_DEPLOY_TOKEN`
- variables: `RELAY_SERVER_DEPLOY_REPOSITORY`、`RELAY_SERVER_DEPLOY_WORKFLOW`

外部目标缺省时，使用完整成对的 `RELAY_PROD_CLOUDFLARE_API_TOKEN` / `RELAY_PROD_CLOUDFLARE_ACCOUNT_ID` 直发 Cloudflare production；迁移期间两项 production secret 都缺省时，才允许回退到完整成对的 dev Cloudflare 凭据；不能跨 production / dev 拼接 token 和 account id。production Worker / Pages / origin 可通过 `RELAY_PROD_CF_WORKER_NAME`、`RELAY_PROD_CF_PAGES_PROJECT`、`RELAY_PROD_CF_ORIGIN` 覆盖。`RELAY_PROD_CF_DEVICE_API_ORIGIN` 可把设备 bearer API 指向同一 Worker 的直连 HTTPS origin；workflow 会生成同源 WSS control endpoint，浏览器登录 / OAuth / Passkey 仍使用公开 Pages origin。

同一 manual production promotion 在非 external 接管路径还部署官方 Vercel 单项目 Relay/Admin。优先使用完整 `RELAY_PROD_VERCEL_TOKEN` / `RELAY_PROD_VERCEL_ORG_ID`，两项都缺省时才回退到完整的现有 dev pair；`RELAY_PROD_VERCEL_PROJECT_ID` 可显式指定，否则按精确 `vc.oneworks.cloud` 域名唯一发现项目。常规 dev 部署仍由 Vercel GitHub App 完成，不能把这条 production CLI 路径用于 dev。

独立 Relay Admin 外部 artifact 发布仍由 `deploy-relay-admin.yml` 读取：

- secret: `RELAY_ADMIN_DEPLOY_TOKEN`
- variables: `RELAY_ADMIN_DEPLOY_REPOSITORY`、`RELAY_ADMIN_DEPLOY_WORKFLOW`

官方 Relay dev slot：

- Cloudflare dev 需要 `RELAY_DEV_CLOUDFLARE_API_TOKEN`、`RELAY_DEV_CLOUDFLARE_ACCOUNT_ID`。
- `RELAY_DEV_CF_DEVICE_API_ORIGIN` 可覆盖 dev Worker 的设备直连 HTTPS origin；不得包含 token、userinfo 或路径。
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
- 修改 `.github/workflows/*.yml` 后至少跑 `pnpm exec eslint .github/workflows`；可用 `actionlint` 时一并检查。`dprint` 只检查同批 Markdown 等已配置格式的文件，不要把 “No files found” 当作 YAML 已通过。
- 需要验证 GitHub 侧真实结果时，用 `gh run list` / `gh run view` 看远端 workflow，不只看本地脚本。
- 调整 homepage docs 跨仓部署时，还要确认 `oneworks-ai/oneworks-ai.github.io` 的 `Deploy Pages` workflow 真实通过，并验证 `https://oneworks.cloud/docs/`。
- `.github/AGENTS.md` 必须保持精简；详细过程、踩坑和轮换步骤继续拆到 `.oo/rules/release/`。

## 已知风险

- 当前迁移期会把仓库 force push 成单提交快照；这会让 GitHub `paths` 过滤在部分 push 上近似看到整仓变化，导致 Desktop / PWA / VS Code CI 在文档改动后也被触发。
- `Release Tags` 在 force push 后可能找不到可比较 base 并进入 initial plan；已存在 tag 会跳过，但 force push 不会移动旧 tag。
- VS Code 官方 Marketplace 和 Open VSX 是两套发布系统；`VSCE_PAT` 不能用于 Open VSX。
- npm Trusted Publishing 不能创建全新 package identity；新增 public 包先用受限 token bootstrap，随后立即按 [npm Trusted Publishing SOP](../.oo/rules/release/npm-trusted-publishing.md) 用 `npm trust` 配置并验证 Publisher，网页只作 fallback。
