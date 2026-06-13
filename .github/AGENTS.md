# GitHub Actions Agent Notes

这个目录维护 One Works 的 GitHub Actions 配置。这里的 `AGENTS.md` 只记录 CI/CD 内部结构、入口和当前已知风险；详细凭据维护放到 `.oo/rules/release/`。

## 继续阅读

- [发布凭据与 secret](../.oo/rules/release/github-actions-secrets.md)
- [macOS Developer ID 签名](../.oo/rules/release/macos-signing.md)
- [发布步骤](../.oo/rules/release/process.md)
- [tag 与经验沉淀](../.oo/rules/release/tags.md)

## Workflow 地图

- `quality.yml`：所有 `main` push / PR / 手动触发都会跑 lint、format、typecheck、commit message 检查。
- `release-tags.yml`：按 package version / scripts 相关路径触发，创建 `pkg/*/v*` release tags，并按 tag 显式调度对应发布 workflow。
- `npm-publish-alpha.yml`：手动发布 npm alpha 包；默认走 Trusted Publishing，新增包 bootstrap 才允许显式使用 `NPM_TOKEN`。
- `vscode-extension-ci.yml`：按 VS Code 扩展相关路径触发，构建并上传 VSIX artifact，不发布商店。
- `vscode-extension-release.yml`：通过 release tag 或手动输入 tag 发布 VS Code Marketplace、Open VSX 和 GitHub Release。
- `desktop-package.yml`：构建 macOS 桌面包；PR 上总是产出 `macOS installer` check，非桌面打包相关改动会快速跳过，tag / 手动 release 模式会创建 GitHub Release。
- `deploy-pwa.yml`：从 app 仓库触发 `oneworks-ai/pwa` 的部署 workflow。
- `deploy-avatar.yml`：从 app 仓库触发 `oneworks-ai/avatar` 的 GitHub Pages 部署 workflow，只监听 avatar 相关路径。

## 当前 Secrets / Variables

已配置仓库 secrets：

- `NPM_TOKEN`
- `VSCE_PAT`
- `OVSX_PAT`
- `PWA_DEPLOY_TOKEN`
- `AVATAR_DEPLOY_TOKEN`

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
- `.github/AGENTS.md` 必须保持精简；详细过程、踩坑和轮换步骤继续拆到 `.oo/rules/release/`。

## 已知风险

- 当前迁移期会把仓库 force push 成单提交快照；这会让 GitHub `paths` 过滤在部分 push 上近似看到整仓变化，导致 Desktop / PWA / VS Code CI 在文档改动后也被触发。
- `Release Tags` 在 force push 后可能找不到可比较 base 并进入 initial plan；已存在 tag 会跳过，但 force push 不会移动旧 tag。
- VS Code 官方 Marketplace 和 Open VSX 是两套发布系统；`VSCE_PAT` 不能用于 Open VSX。
- npm Trusted Publishing 不能用来创建全新包的首次 package settings；新增 public 包首发后要去 npm 配 Trusted Publisher。
