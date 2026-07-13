# GitHub Actions 凭据

这个文件记录 `oneworks-ai/app` 的 Actions secrets、variables 和相关发布凭据维护方式。`README.md` 与文档站不放这些内部信息。

## Secret 总览

当前仓库需要这些 Actions secrets：

- `NPM_TOKEN`：只用于 npm 新包首次 bootstrap 发布；正常发布走 npm Trusted Publishing。
- `VSCE_PAT`：发布 VS Code 官方 Marketplace 扩展。
- `OVSX_PAT`：发布 Open VSX Registry 扩展，给 VSCodium、Theia、Code OSS 等 VS Code 兼容 IDE 使用。
- `PWA_DEPLOY_TOKEN`：从 `oneworks-ai/app` 触发 `oneworks-ai/pwa` 的部署 workflow。
- `AVATAR_DEPLOY_TOKEN`：从 `oneworks-ai/app` 触发 `oneworks-ai/avatar` 的 GitHub Pages 部署 workflow。
- `HOMEPAGE_DEPLOY_TOKEN`：从 `oneworks-ai/app` 触发 `oneworks-ai/oneworks-ai.github.io` 的 GitHub Pages 部署 workflow。
- `RELAY_DEV_CLOUDFLARE_API_TOKEN`、`RELAY_DEV_CLOUDFLARE_ACCOUNT_ID`：部署官方 Cloudflare dev Relay/Admin。
- `APPLE_ID`、`APPLE_ID_PASSWORD`、`APPLE_TEAM_ID`、`DESKTOP_CSC_LINK`、`DESKTOP_CSC_KEY_PASSWORD`、`DESKTOP_CSC_INSTALLER_LINK`、`DESKTOP_CSC_INSTALLER_KEY_PASSWORD`：macOS App Store 外分发签名和 notarization；未做 Apple Developer 签名时可以缺省。

Chrome Web Store 发布不使用长期 OAuth refresh token 或 service-account JSON key，因此不新增 repository secret。它使用 GitHub OIDC -> Google Cloud Workload Identity Federation -> Chrome Web Store service account 的短期 token。

官方 Vercel dev Relay/Admin 不再使用 GitHub repository secret 里的 CLI token 部署。常规路径是 Vercel GitHub App 监听 `oneworks-ai/app` 的 `main` 分支并部署 `apps/relay-server` project；GitHub Actions 只轮询 `dev.vc.oneworks.cloud` 做 smoke 验证。不要为常规 dev deploy 新增或轮换 `RELAY_DEV_VERCEL_TOKEN`、`RELAY_DEV_VERCEL_ORG_ID`、`RELAY_DEV_VERCEL_PROJECT_ID`。

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

`NPM_TOKEN` 只作为 `npm-publish-alpha.yml` 的 bootstrap fallback。

默认发布路径：

- workflow 使用 GitHub OIDC / npm Trusted Publishing。
- `NPM_CONFIG_PROVENANCE=true`。
- 不把 `NPM_TOKEN` 写进 `.npmrc`。

只有新增 npm 包还不存在、无法先配置 Trusted Publishing 时，才在 workflow 手动输入里显式设置：

```text
bootstrap_with_token=true
```

这时 workflow 才读取 `secrets.NPM_TOKEN`，用它完成首次 `npm publish`。首发后必须马上去 npm 给这个新包配置 Trusted Publishing：

- Publisher type: GitHub Actions
- Repository: `oneworks-ai/app`
- Workflow filename: `npm-publish-alpha.yml`
- Permission: allow `npm publish`

后续同包版本继续走 Trusted Publishing，不再依赖 `NPM_TOKEN`。

创建或轮换 token：

1. 登录 npm，使用发布账号。
2. 创建 Automation / publish 用 token。
3. 写入仓库 secret：`gh secret set NPM_TOKEN --repo oneworks-ai/app`
4. 用一个需要 bootstrap 的新包或 dry-run 发布计划验证。不要为了验证而重复发布已存在版本。

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

已验证发布记录：

- Extension: `oneworks-ai.oneworks-vscode-extension`
- Version: `0.1.0`
- `preRelease=true`
- Timestamp: `2026-06-11T10:10:05.530948Z`

Open VSX API 目前显示 `verified=false` 和 `unrelatedPublisher=true`。这不阻塞发布和下载，但后续应该单独做 namespace ownership claim / verification。

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

- Token name: `oneworks-app-trigger-pwa`
- Resource owner: `oneworks-ai`
- Repository access: only `oneworks-ai/pwa`
- Expiration: 366 days, ending on 2027-06-12
- Permissions: `Actions` read/write, `Metadata` read-only

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

Homepage Pages token 的配置、轮换和验证见 [homepage-github-pages.md](./homepage-github-pages.md)。

Avatar Pages token 的配置、轮换和验证见 [avatar-github-pages.md](./avatar-github-pages.md)。

## Relay Dev Deploy

Relay dev deployment workflow secrets、variables 和 smoke check 维护方式见 [Relay dev deploy GitHub Actions](./relay-dev-deploy-github-actions.md)。
