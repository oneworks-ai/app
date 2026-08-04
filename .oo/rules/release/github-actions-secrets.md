# GitHub Actions 凭据

这个文件记录 `oneworks-ai/app` 的 Actions secrets、variables 和相关发布凭据维护方式。`README.md` 与文档站不放这些内部信息。

## Secret 总览

当前仓库需要这些 Actions secrets：

- `NPM_TOKEN`：只用于 npm 新 identity 首次 bootstrap，或经 registry 对账确认的 missing-trust 定向恢复；正常发布走 npm Trusted Publishing。
- `VSCE_PAT`：发布 VS Code 官方 Marketplace 扩展。
- `OVSX_PAT`：发布 Open VSX Registry 扩展，给 VSCodium、Theia、Code OSS 等 VS Code 兼容 IDE 使用。
- `PWA_DEPLOY_TOKEN`：从 `oneworks-ai/app` 触发 `oneworks-ai/pwa` 的部署 workflow。
- `AVATAR_DEPLOY_TOKEN`：从 `oneworks-ai/app` 触发 `oneworks-ai/avatar` 的 GitHub Pages 部署 workflow。
- `HOMEPAGE_DEPLOY_TOKEN`：从 `oneworks-ai/app` 触发 `oneworks-ai/oneworks-ai.github.io` 的 GitHub Pages 部署 workflow。
- `RELAY_DEV_CLOUDFLARE_API_TOKEN`、`RELAY_DEV_CLOUDFLARE_ACCOUNT_ID`：部署官方 Cloudflare dev Relay/Admin。
- `RELAY_PROD_CLOUDFLARE_API_TOKEN`、`RELAY_PROD_CLOUDFLARE_ACCOUNT_ID`：作为完整原子 pair 直接部署官方 Cloudflare production Relay/Admin；production workflow 不回退使用 dev 凭据。
- `RELAY_SERVER_DEPLOY_TOKEN`：仅供 `platform=external` 将经过验证的 immutable source handoff 给外部或 Node Relay deployment；必须与 repository variables `RELAY_SERVER_DEPLOY_REPOSITORY`、`RELAY_SERVER_DEPLOY_WORKFLOW` 完整配套，三项缺一即失败。
- `APPLE_ID`、`APPLE_ID_PASSWORD`、`APPLE_TEAM_ID`、`DESKTOP_CSC_LINK`、`DESKTOP_CSC_KEY_PASSWORD`、`DESKTOP_CSC_INSTALLER_LINK`、`DESKTOP_CSC_INSTALLER_KEY_PASSWORD`：macOS App Store 外分发签名和 notarization；未做 Apple Developer 签名时可以缺省。

Chrome Web Store 发布不使用长期 OAuth refresh token 或 service-account JSON key，因此不新增 repository secret。它使用 GitHub OIDC -> Google Cloud Workload Identity Federation -> Chrome Web Store service account 的短期 token。

官方 Vercel dev Relay/Admin 不再使用 GitHub repository secret 里的 CLI token 部署。常规路径是 Vercel GitHub App 监听 `oneworks-ai/app` 的 `main` 分支并部署 `apps/relay-server` project；GitHub Actions 只轮询 `dev.vc.oneworks.cloud` 做 smoke 验证。不要为常规 dev deploy 新增或轮换 `RELAY_DEV_VERCEL_TOKEN`、`RELAY_DEV_VERCEL_ORG_ID`、`RELAY_DEV_VERCEL_PROJECT_ID`。

Relay production manual promotion 只使用 `RELAY_PROD_VERCEL_TOKEN` / `RELAY_PROD_VERCEL_ORG_ID`，两项必须成对配置。`RELAY_PROD_VERCEL_PROJECT_ID` 可作为 explicit target；否则按精确 `vc.oneworks.cloud` 域名唯一发现 project，0 或多个命中直接失败。production workflow 不读取 dev pair；常规 dev 仍不用 token。

External Relay handoff 仅在 manual production dispatch 选择 `platform=external` 时读取 `RELAY_SERVER_DEPLOY_TOKEN`、`RELAY_SERVER_DEPLOY_REPOSITORY` 与 `RELAY_SERVER_DEPLOY_WORKFLOW`。前者是 secret，后两者是 repository variables；workflow 将它们当作一个原子 tuple，不允许缺省、跨平台复用或 dev fallback。它可以触发外部 / Node deployment，但不替代本地 Node package 的独立部署与回滚流程。

macOS Developer ID 签名的完整创建和验证步骤见 [macOS signing](./macos-signing.md)。

写 secret 时优先用 stdin：

```bash
gh secret set <SECRET_NAME> --repo oneworks-ai/app
```

核对仓库 secret 名称：

```bash
gh secret list --repo oneworks-ai/app
```

## npm：NPM_TOKEN

`NPM_TOKEN` 只作为 `npm-publish-alpha.yml` 的 bootstrap / 定向恢复 fallback；日常发布不使用它。完整身份审计、Trusted Publisher CLI 配置和 mixed-result 恢复见 [npm Trusted Publishing 与 Open VSX 认证](./npm-trusted-publishing.md)。

默认发布路径：

- workflow 使用 GitHub OIDC / npm Trusted Publishing。
- `NPM_CONFIG_PROVENANCE=true`。
- 不把 `NPM_TOKEN` 写进 `.npmrc`。

只有以下任一情况经过 registry / trust 对账后，才在 workflow 手动输入里显式设置：

- 新 npm identity 尚不存在，无法先配置 Trusted Publishing，需要首次 bootstrap。
- 已存在的 identity 缺少 Trusted Publisher，OIDC 发布出现 token-exchange / publish 认证失败，且 targeted package set 已冻结为 registry 中仍缺少目标版本的 identities。

```text
bootstrap_with_token=true
```

这时 workflow 才读取 `secrets.NPM_TOKEN`，用它完成首次 bootstrap 或 missing-trust 定向恢复。完成后必须立即为相关 package 配置 Trusted Publisher，随后发布改用 OIDC。配置前后都要审计所有 public identity（包括 publish aliases）；不要把 browser login 当作 CLI 或 OIDC 认证证据。

后续同包版本继续走 Trusted Publishing，不再依赖 `NPM_TOKEN`。`NPM_TOKEN` 不能用于 `npm trust` 配置。

创建或轮换 fallback token：

1. 登录 npm，使用发布账号。
2. 创建最短可行有效期的 Granular Access Token，只给本次 fallback package / scope read and write 权限；只有非交互式 publish 确实需要时才打开 bypass 2FA。
3. 写入仓库 secret：`gh secret set NPM_TOKEN --repo oneworks-ai/app`
4. 用 dry-run 发布计划验证范围；不要为了验证而重复发布已存在版本。

## Chrome Web Store

Chrome Web Store 不使用长期 repository secret；WIF、service account、environment、Actions variables、首次 item identity 和正式提交命令见 [Chrome Web Store 发布配置](./chrome-web-store.md)。

## VS Code Marketplace：VSCE_PAT

`VSCE_PAT` 用于 `.github/workflows/vscode-extension-release.yml` 发布官方 VS Code Marketplace。

相关配置：

- GitHub variable: `VSCODE_EXTENSION_PUBLISHER=oneworks-ai`
- Marketplace extension id: `oneworks-ai.oneworks-vscode-extension`
- Workflow tag: `pkg/oneworks-vscode-extension/v*`

创建 token：

1. 打开 `https://dev.azure.com/Yi-Jie/_usersSettings/tokens`。
2. New Token。
3. Name 建议：`oneworks-ai-app-vsce-publish-global`
4. Organization 必须选 `All accessible organizations`。
5. Scopes 选 Custom defined。
6. 展开 Show all scopes。
7. 只勾 `Marketplace: Manage`。
8. Generate 后立刻复制 token。
9. 写入 GitHub secret：`gh secret set VSCE_PAT --repo oneworks-ai/app`

验证发布链路：

```bash
gh workflow run vscode-extension-release.yml \
  --repo oneworks-ai/app \
  --ref main \
  -f release_tag=pkg/oneworks-vscode-extension/v0.1.0-alpha.0
```

发布后核对 Marketplace 元数据：

```bash
pnpm --filter @oneworks/vscode-extension exec vsce show \
  oneworks-ai.oneworks-vscode-extension --json
```

踩坑：

- Organization 只选 `Yi-Jie` 的 PAT 会导致 VS Marketplace 发布失败：`TF400813` not authorized。
- 必须使用创建 / 管理 `oneworks-ai` publisher 的同一个 Microsoft account 生成 PAT。
- workflow 已给 `vsce publish` 加 `--skip-duplicate`，允许重跑 release 来补齐其他分发源。
- Azure DevOps 页面提示 Global PAT 会在 2026-12-01 后废弃；之后需要按微软新发布凭据方案迁移。

## Open VSX：OVSX_PAT

`OVSX_PAT` 用于 `.github/workflows/vscode-extension-release.yml` 并行发布 Open VSX Registry。Open VSX 是 VS Code 兼容 IDE 的通用扩展源，不是微软官方 Marketplace。

一次性前置条件：

- Open VSX 账号已通过 GitHub 登录。
- Profile 显示已签署 Eclipse Foundation Open VSX Publisher Agreement。
- namespace 已创建：`pnpm dlx ovsx@1.0.1 create-namespace oneworks-ai -p <token>`

创建 token：

1. 打开 `https://open-vsx.org/user-settings/tokens`。
2. 点击 Generate new token。
3. Description 建议：`oneworks-ai/app GitHub Actions Open VSX publish`
4. Generate Token。
5. 必须点击页面里的 Copy 按钮复制真实 token；页面上可见的 `ovsxat_<uuid>` 可能只是 token 标识。
6. 写入 GitHub secret：`gh secret set OVSX_PAT --repo oneworks-ai/app`

本地验证 token 和 namespace：

```bash
pnpm dlx ovsx@1.0.1 verify-pat oneworks-ai -p <token>
```

workflow 里 `ovsx@1.0.1` 对 token 参数顺序敏感，必须把 `-p "$OVSX_PAT"` 放在命令末尾。

发布成功与 namespace verification 独立。`verified=false` 或 `unrelatedPublisher=true` 不足以判断发布失败；独立核对 version、`preRelease`、公开下载 VSIX bytes/hash。namespace verification 走 Open VSX 官方 claim 流程和外部 maintainer review；不要为改变这些 metadata 而重发或轮换 `OVSX_PAT`。完整操作边界见 [npm Trusted Publishing 与 Open VSX 认证](./npm-trusted-publishing.md)。

## PWA：PWA_DEPLOY_TOKEN

`PWA_DEPLOY_TOKEN` 只用于 `.github/workflows/deploy-pwa.yml`，让 app 仓库触发 PWA 仓库部署并等待下游运行结果：

```bash
gh workflow run deploy-pwa.yml \
  --repo oneworks-ai/pwa \
  --ref main \
  -f source_ref=main \
  -f source_sha=<app commit sha>
```

当前 token 来源：

- Token name: `oneworks-app-trigger-pwa`; Resource owner: `oneworks-ai`
- Repository access: only `oneworks-ai/pwa`
- Expiration: 366 days, ending on 2027-06-12; Permissions: `Actions` read/write, `Metadata` read-only

轮换方式：

1. GitHub user settings -> Developer settings -> Personal access tokens -> Fine-grained tokens。
2. Generate new token。
3. Resource owner 选 `oneworks-ai`。
4. Repository access 只选 `oneworks-ai/pwa`。
5. Repository permissions 只开 `Actions: read and write` 与 `Metadata: read-only`。
6. 生成后立即复制 token。
7. 写入 app 仓库 secret：`gh secret set PWA_DEPLOY_TOKEN --repo oneworks-ai/app`

验证触发链路：

```bash
gh workflow run deploy-pwa.yml --repo oneworks-ai/app --ref main
```

确认 `oneworks-ai/app` 的 Trigger PWA Deploy 成功、`oneworks-ai/pwa` 的 Deploy PWA 被触发并成功、`https://oneworks.cloud/pwa/` 返回 `200`。如果 `PWA_DEPLOY_TOKEN` 缺失，app 仓库 workflow 必须失败，不能 warning 后成功退出。

Homepage Pages token 的配置、轮换和验证见 [homepage-github-pages.md](./homepage-github-pages.md)；Avatar Pages token 的配置、轮换和验证见 [avatar-github-pages.md](./avatar-github-pages.md)。

## Relay Deploy

Relay dev deployment workflow secrets、variables 和 smoke check 维护方式见 [Relay dev deploy GitHub Actions](./relay-dev-deploy-github-actions.md)。
Relay production 的人工 promotion、外部发布目标、Cloudflare 凭据与 smoke check 规则见 [Relay production deploy GitHub Actions](./relay-production-deploy-github-actions.md)。
