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
- [PR Review 标准](../.oo/rules/REVIEW.md)

## Workflow 地图

- `quality.yml`：所有 `main` push / 源码 PR / Merge Queue 组合提交 / 手动触发都保持 `lint`、`format-check`、`typecheck`、`commit-message` 的稳定 check 身份。PR 与 `merge_group` 统一调用 validation-scope v2，按 client / node / shared、env contract 与 docs-media 目标选择检查，未知路径 fail closed 到全量；client production closure 在现有 typecheck runner 内执行 Vite build，format 与 env contract 使用无 workspace install 的轻量入口。依赖安装、ESLint 与 TypeScript 增量状态使用精确 cache key；上一 PR revision 已有成功证据、before / head 都是 mode 未变的普通文件 blob，且当前 head blob 逐字节等于 ESLint 自动修复结果时，只重跑 lint / format / commit message，typecheck 与 client build 复用不可变证据。复用 verifier 必须从 PR merge ref 使用 current base 的受审工具链，不能要求旧 PR head 自带新脚本或读取 mutable worktree；队列生成的组合 revision 必须重新验证，不能复用单个 PR 的证据。
- `pr-change-policy.yml`：保持 `pr-change-policy` required check 身份，使用无 workspace install 的 CJS 入口；独立监听 PR 创建、同步、正文编辑和 `merge_group`。PR 事件验证正文与变更，队列事件只维持稳定 context，因为每个入队 head 已经通过同一门禁；policy concurrency 与 Quality / Desktop 相互独立。
- GitHub 把正文 / 标题编辑和 PR base 变更都归入 `edited`。Quality / Desktop 用 `changes.base` 隔离 concurrency：普通 metadata edit 只有在 exact base/head 的 required checks 已成功时才复用证据；base retarget 一律禁用复用并针对新 base 完整重检。证据 miss、cache miss、Autofix 判定失败或输出不完整都必须 fail closed 到当前 validation scope。
- `.github/actions/setup-workspace/action.yml`：Quality 与 Desktop PR smoke 的唯一 workspace 安装入口；cache key 必须同时绑定 runner OS / arch、Node / pnpm authority、全部 workspace manifests 与 `patchedDependencies` 的 patch 字节。cache miss 才运行 frozen install；不得加入不精确 restore key 或跨平台复用 `node_modules`。
- `pr-experience-review.yml`：PR 创建、编辑或同步时通过 Pull Requests API upsert 经验复盘提醒 review summary；硬门禁由 `pr-change-policy.yml` 调用 `scripts/pr-change-check.cjs` 执行。
- `release-tags.yml`：按 package version / scripts 相关路径触发，创建 `pkg/*/v*` release tags，并按 tag 显式调度对应自动发布 workflow；VS Code prerelease 不建 tag，stable tag 只创建不自动 dispatch。
- `npm-publish-alpha.yml`：手动发布 npm 包；默认 `auth_mode=oidc`，在首次 publish 前完成 exact identity 的 npm OIDC exchange，之后核验 registry bytes/provenance。新 identity 仅能用受限的 `new-identity-bootstrap` onboarding token mode。
- `vscode-extension-ci.yml`：按 VS Code 扩展相关路径触发，构建并上传临时 VSIX artifact；alpha / beta / rc 只走这条 CI，不创建公开 release 或发布商店。
- `vscode-extension-release.yml`：只接受人工输入的精确 annotated stable tag，把同一个 authoritative VSIX 发布到 VS Code Marketplace、Open VSX 和 GitHub Release。
- `desktop-package.yml`：PR 与 `merge_group` 先在 Ubuntu 复用 validation-scope v2；普通 client、adapter、品牌资产和文档改动只完成 `macOS installer` required gate，不申请 macOS runner。桌面源码、native authority、打包工具、根 manifest / lockfile、正式包内 runtime closure 或未知路径才构建 arm64+x64 unsigned app bundle 并跑 authority smoke；只有 PR 的同 base 后续 revision 可以在上一 macOS smoke 成功且本次精确匹配 ESLint Autofix 时复用 Desktop evidence，队列组合 revision 总是重新验证。`merge_group` 只能进入 PR smoke / required gate，显式禁止进入 installer、签名、公证和发布 job。nightly 用 unsigned arm64 DMG 跑完整 package / smoke / install verify，保留 3 天用于提前暴露发布回归。`pkg/oneworks-desktop/v*` tag 或手动 dispatch 统一构建 arm64+x64 的 DMG / PKG / ZIP；签名构建先无等待提交公证并保留精确字节、摘要、attempt / submission ID 和 build metadata，再做有界轮询，Apple 延迟时用 `notarization_run_id` / `notarization_stage` 恢复并固化更新状态，不得重签或重复提交。`notarization_history_only` 只读查询团队历史。带 `release_tag`、不勾 `create_release` 可生成正式身份的候选产物，之后用 `candidate_run_id` 提升同一 artifact，无需重打包。GitHub Release 成功后复用 `deploy-homepage.yml` 自动等待官网刷新。
- `relay-ci.yml`：只在 Relay Server / Admin / config hook 相关路径变化时跑 server test、admin test 和真实 `relay-config live-smoke`。
- `deploy-relay-dev.yml`：Cloudflare dev Relay/Admin 由 Actions 部署并 smoke；Vercel dev Relay/Admin 由 Vercel GitHub App 部署，Actions 只轮询 `dev.vc.oneworks.cloud` 做 smoke，不能恢复长期 Vercel CLI token 发布路径。
- `deploy-relay-server.yml`：手动把已批准的精确 `origin/main` SHA 提升到 Relay production；按必填 `platform` input 选择 external handoff、Cloudflare、Vercel 或两套官方平台，并验证 build SHA、登录、未授权边界和真实 Admin 静态资产。
- `deploy-relay-admin.yml`：只监听 Relay Admin 前端及其 UI 依赖，构建独立 Admin 平台 artifact 并可按变量触发外部前端部署。
- `deploy-pwa.yml`：从 app 仓库触发 `oneworks-ai/pwa` 的部署 workflow。
- `deploy-avatar.yml`：从 app 仓库触发 `oneworks-ai/avatar` 的 GitHub Pages 部署 workflow，只监听 avatar 相关路径。
- `deploy-homepage.yml`：从 app 仓库触发 `oneworks-ai/oneworks-ai.github.io` 的 GitHub Pages 部署 workflow，只监听 `.oo/docs` 和自身 workflow。
- `sync-brand-studio.yml`：产品品牌 catalog、adapter / model-provider / channel 元数据变化后向 Brand Studio 发送 `product-catalog-updated`；专用 token 缺失时输出 notice，并保留 Brand Studio 每六小时同步作为兜底。

## 凭据接口

本文件只记录公开 workflow 的输入契约，不记录仓库当前已配置、未配置或正在迁移的凭据状态。需要核对 live 状态时，使用有权访问仓库 Settings 的维护者会话；不要把查询结果回写到公开文档。

- `NPM_TOKEN`
- `VSCE_PAT`
- `OVSX_PAT`
- `PWA_DEPLOY_TOKEN`
- `AVATAR_DEPLOY_TOKEN`
- `HOMEPAGE_DEPLOY_TOKEN`

Brand Studio 即时同步可使用可选的 `BRAND_STUDIO_SYNC_TOKEN`；缺少时 workflow 不失败或复用其他仓库 token，Brand Studio 的定时同步继续兜底。

Relay production 通过 `deploy-relay-server.yml` 人工 promotion。选择 external target 时，三项配置必须同时存在：

- secret: `RELAY_SERVER_DEPLOY_TOKEN`
- variables: `RELAY_SERVER_DEPLOY_REPOSITORY`、`RELAY_SERVER_DEPLOY_WORKFLOW`

Cloudflare production 只使用完整成对的 `RELAY_PROD_CLOUDFLARE_API_TOKEN` / `RELAY_PROD_CLOUDFLARE_ACCOUNT_ID`；缺少任一项必须失败，不能回退到 dev 凭据，也不能跨 production / dev 拼接 token 和 account id。production Worker / Pages / origin 可通过 `RELAY_PROD_CF_WORKER_NAME`、`RELAY_PROD_CF_PAGES_PROJECT`、`RELAY_PROD_CF_ORIGIN` 覆盖。`RELAY_PROD_CF_DEVICE_API_ORIGIN` 可把设备 bearer API 指向同一 Worker 的直连 HTTPS origin；workflow 会生成同源 WSS control endpoint，浏览器登录 / OAuth / Passkey 仍使用公开 Pages origin。

同一 manual production promotion 在非 external 接管路径还部署官方 Vercel 单项目 Relay/Admin。Vercel production 只使用完整成对的 `RELAY_PROD_VERCEL_TOKEN` / `RELAY_PROD_VERCEL_ORG_ID`；缺少任一项必须失败，不能读取 dev pair。`RELAY_PROD_VERCEL_PROJECT_ID` 可显式指定，否则按精确 `vc.oneworks.cloud` 域名唯一发现项目。常规 dev 部署仍由 Vercel GitHub App 完成，不能把这条 production CLI 路径用于 dev。

独立 Relay Admin 外部 artifact 发布仍由 `deploy-relay-admin.yml` 读取：

- secret: `RELAY_ADMIN_DEPLOY_TOKEN`
- variables: `RELAY_ADMIN_DEPLOY_REPOSITORY`、`RELAY_ADMIN_DEPLOY_WORKFLOW`

Relay dev workflow 使用独立的 dev 输入：

- Cloudflare dev 需要 `RELAY_DEV_CLOUDFLARE_API_TOKEN`、`RELAY_DEV_CLOUDFLARE_ACCOUNT_ID`。
- `RELAY_DEV_CF_DEVICE_API_ORIGIN` 可覆盖 dev Worker 的设备直连 HTTPS origin；不得包含 token、userinfo 或路径。
- Vercel dev 通过 Vercel GitHub App 连接 `oneworks-ai/app` 的 `main` 分支和 `apps/relay-server` root directory；GitHub 侧只配置可选变量 `RELAY_DEV_VC_ORIGIN` 和 smoke 相关变量，不配置 `RELAY_DEV_VERCEL_TOKEN`。

桌面签名 workflow 使用以下成组输入；是否启用签名由 workflow 配置决定：

- `APPLE_ID`
- `APPLE_ID_PASSWORD`
- `APPLE_TEAM_ID`
- `DESKTOP_CSC_LINK`
- `DESKTOP_CSC_KEY_PASSWORD`
- `DESKTOP_CSC_INSTALLER_LINK`
- `DESKTOP_CSC_INSTALLER_KEY_PASSWORD`

其他发布 workflow 读取 `VSCODE_EXTENSION_PUBLISHER`。桌面 workflow 还读取以下可选 variables，并在 workflow 内提供默认行为：

- `DESKTOP_SIGN=false`（只表示签名能力 / 凭据总开关；具体版本 policy 由 `apps/desktop/package.json` 锁定）
- `DESKTOP_AUTO_UPDATE=true`

## 维护约束

- 不把 token 明文写入仓库、issue、日志或文档。
- 新增 workflow 时统一设置 `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`。
- 修改 `.github/workflows/*.yml` 后至少跑 `pnpm exec eslint .github/workflows`；可用 `actionlint` 时一并检查。`dprint` 只检查同批 Markdown 等已配置格式的文件，不要把 “No files found” 当作 YAML 已通过。
- Relay Server 直接导入 `@oneworks/icon/*` 的已发布子路径；Cloudflare Wrangler bundle 与 Vercel `build:vercel` 在干净 CI 中必须先构建 `packages/icon`，不能依赖其他 job 或本地残留的 `dist/`。
- PR workflow 不得用顶层 `paths` / `paths-ignore` 过滤 required check；`quality.yml` 与 `desktop-package.yml` 必须始终创建稳定 required context，再在 job 内根据 `scripts/pr-validation-scope.cjs` 选择轻量或全量步骤。classifier 规则只能在该脚本维护，workflow 不复制 path list。
- required workflow 必须同时监听 `pull_request` 与 `merge_group: checks_requested`。队列范围使用 `merge_group.base_sha...merge_group.head_sha`，不读取 PR body、不校验合成 merge commit message，也不保存 / 复用 PR evidence；任何 release job 都必须显式排除 `merge_group`。
- 需要验证 GitHub 侧真实结果时，用 `gh run list` / `gh run view` 看远端 workflow，不只看本地脚本。
- 调整 homepage docs 跨仓部署时，还要确认 `oneworks-ai/oneworks-ai.github.io` 的 `Deploy Pages` workflow 真实通过，并验证 `https://oneworks.cloud/docs/`。
- `.github/AGENTS.md` 必须保持精简；详细过程、踩坑和轮换步骤继续拆到 `.oo/rules/release/`。

## 已知风险

- 当前迁移期会把仓库 force push 成单提交快照；这会让 GitHub `paths` 过滤在部分 push 上近似看到整仓变化，导致 Desktop / PWA / VS Code CI 在文档改动后也被触发。
- `Release Tags` 在 force push 后可能找不到可比较 base 并进入 initial plan；已存在 tag 会跳过，但 force push 不会移动旧 tag。
- VS Code 官方 Marketplace 和 Open VSX 是两套发布系统；`VSCE_PAT` 不能用于 Open VSX。
- npm Trusted Publishing 不能创建全新 package identity；新增 public 包先用受限 token bootstrap，随后立即按 [npm Trusted Publishing SOP](../.oo/rules/release/npm-trusted-publishing.md) 用 `npm trust` 配置并验证 Publisher，网页只作 fallback。
