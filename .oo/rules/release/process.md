# 发布步骤

返回入口：[RELEASE.md](../RELEASE.md)

## 发布前最小检查

- 把拟发布包列表收敛到最小范围，并能逐个说明为什么需要发版
- 跑目标包相关测试，不只看仓库全量状态
- 用 `pnpm tools publish-plan -- ...` 确认发布顺序和候选包
- 用 `npm view <pkg> version` 确认 registry 当前版本
- 用 `npm whoami` 确认 npm 登录态
- 在目标包目录执行 `npm pack --dry-run`

## PR 分工

- 功能 / 修复 PR 不 bump `package.json` 版本号，不创建发布 tag。
- 功能 / 修复 PR 只补对应的 changelog 和截图证据，说明这次变更会进入哪个后续版本。
- Release PR 专门负责 bump 需要发布的 package manifest、整理该版本 changelog 和发布元数据。
- Release PR 合入 `main` 后，`Release Tags` workflow 会比较合入前后的 workspace package manifest；已有包 `version` 变化、新增包带有 `name` 与 `version` 时，自动创建 `pkg/<normalized-package-name>/v<version>` tag。
- 自动 tag 由 `Release Tags` workflow 使用内置 `GITHUB_TOKEN` 创建；不要配置个人全仓库 PAT 作为 release tag secret。`GITHUB_TOKEN` 创建的 tag 不会触发普通 tag workflow，因此 workflow 会在创建 tag 后显式 `workflow_dispatch` 对应的发布 workflow。

## 单包发布

1. 确认自上次发布以来存在应计入发版范围的变更
2. 区分 alpha / 正式版
3. 更新目标包 `package.json` 版本号
4. 补 `changelog/<version>/<package>.md`
5. 如有需要，更新锁文件或其他发布元数据
6. 执行发布前最小检查
7. 提交 release commit
8. 正式版应先合入默认分支，再执行发布
9. 合入默认分支后由 `Release Tags` workflow 创建 release tag

## 整体发布

1. 明确纳入发布的 public workspace 包及其发版依据
2. 补 `changelog/<version>/readme.md`
3. 执行发布前最小检查
4. 提交 release commit
5. 合入默认分支后由 `Release Tags` workflow 为实际版本变化的包分别创建 release tag
6. 由对应 tag workflow 执行产物发布；尚未自动化的 npm 包仍按 publish-plan 手动发布

## npm alpha 发布

- 首次发布或需要 npm provenance 时，使用 `.github/workflows/npm-publish-alpha.yml` 手动触发发布。
- workflow 默认使用 npm Trusted Publishing：GitHub OIDC `id-token: write`、`NPM_CONFIG_PROVENANCE=true`，不向 `npm publish` 注入 `NPM_TOKEN`。只有首次 bootstrap npm 上还不存在、不能使用 Trusted Publishing 的新包时，才显式勾选 `bootstrap_with_token=true`，用 `NPM_TOKEN` 作为 fallback。
- `packages` 不能为空，除非明确勾选 `publish_all=true`。发布整组 public workspace 包时必须显式打开 `publish_all`，避免误触发把所有 public 包发布到 npm。
- workflow 通过 `pnpm tools publish-plan -- --publish --no-git-checks --skip-existing --tag <publish_tag>` 发布 public workspace 包；`publish_tag` 默认 `alpha`。
- 新增 public workspace 包不需要改 workflow；只要被 `pnpm-workspace.yaml` 收录、`package.json` 带 `name` / `version` 且没有 `private: true`，在 `publish_all=true` 时会自动进入全量发布计划。只想发新包时优先填写 `packages=<new-package>`，让发布计划自动补内部依赖顺序。
- `onework`、`oneork`、`oneorks` 是 `oneworks` bootstrap 的 typo publish alias，必须从 `apps/bootstrap/package.json` 的 `oneworks.publishAliases` 自动展开，同源改名发布；不要为它们创建独立 workspace 包，不要让它们依赖 `oneworks`，也不要写额外 redirect 逻辑。发布这组包且要保证裸 `npx onework` 和 `npx oneworks` 行为一致时，必须在首次发布该版本时使用 `publish_tag=latest`，或在发布后立刻用有 2FA 权限的 npm 登录态执行 `npm dist-tag add <pkg>@<version> latest` 补齐 `oneworks` 和三个 publish alias 包。
- `--skip-existing` 只在真实发布时跳过 npm registry 已存在的同名同版本；dry-run 仍完整打包所有候选包。新增 public 包时，旧包会跳过，新包会继续首发。
- npm Trusted Publishing 要求 package 已存在。新增包第一次发布必须依赖 `NPM_TOKEN` 完成 bootstrap；首发成功后，必须在 npm 为该包配置 Trusted Publisher：GitHub Actions、`oneworks-ai/app`、workflow filename `npm-publish-alpha.yml`、允许 `npm publish`。后续同包版本再通过 Trusted Publishing 发布。
- 发布流水线必须在任何 package 发布失败时退出失败；失败后先重新运行同一个 workflow，已发布的包会被 `--skip-existing` 跳过，只继续处理未发布或新增的包。

## 发布中断

- 不要直接重跑整批发布命令
- 先逐包检查 registry 当前版本
- 已经在 registry 上出现目标版本的包，不要重复发布
- 分别核对 npm registry、远端分支和远端 tag，缺什么补什么

## VS Code 扩展发布

- VS Code Marketplace 不支持 `0.1.0-alpha.0` 这种 semver prerelease 字符串；预发布必须使用 `major.minor.patch` 三段式版本，再通过 `vsce package --pre-release` 和 `vsce publish --pre-release` 标记。
- 本仓 `apps/vscode-extension/package.json` 可以继续跟随仓库发布节奏使用 `0.1.0-alpha.0`，但 VSIX release stage 必须把 Marketplace manifest version 映射为 `0.1.0`，同时保留 `--pre-release`。后续 alpha 版本如果需要再次发布到 Marketplace，需要 bump 到新的三段式版本，例如 `0.1.1`。
- VS Code 官方建议预发布版本使用奇数 minor、稳定版使用偶数 minor；因此 One Works VS Code 扩展的 `0.1.x` 应视作 alpha/pre-release channel，稳定发布从 `0.2.x` 开始。
- VS Code Marketplace 发布依赖仓库 secret `VSCE_PAT` 和 variable `VSCODE_EXTENSION_PUBLISHER`；GitHub Release / VSIX artifact 成功不等于 Marketplace 已发布。
- VS Code Marketplace 和 Open VSX publish 都必须带 duplicate skip 语义；release workflow 允许重跑来补齐某个分发源，不应因为另一个分发源已发布同版本而失败。
- Open VSX Registry 是 VS Code 兼容 IDE 的通用扩展分发源，必须和 VS Code Marketplace 并行发布同一个 VSIX。Open VSX 发布依赖仓库 secret `OVSX_PAT`，并且 registry 里必须已创建和 extension publisher 一致的 namespace，例如 `oneworks-ai`；`VSCE_PAT` 不能用于 Open VSX。
- Open VSX namespace 首次创建走 `npx ovsx create-namespace oneworks-ai -p <token>`；如需 verified owner，创建后还要在 Open VSX 里单独 claim namespace ownership。
- `pkg/oneworks-vscode-extension/v*` 触发的 GitHub Release 对预发布版本应标记为 prerelease。

## 外部浏览器 Chrome 扩展发布

- `@oneworks/plugin-chrome-driver` 的 workspace semver 是发布身份；构建阶段把 `x.y.z-alpha.n` / `beta.n` / `rc.n` 映射为 Chrome 的四段整数版本，并把原版本保存在 `version_name`。稳定版使用第四段 `65535`，确保同一 patch 的 prerelease 小于稳定版。
- `pnpm --filter @oneworks/plugin-chrome-driver package:extension:all` 同时生成正式开发者 ZIP 与可选 minimal ZIP。无后缀的正式包复用 audited privileged flavor，声明 `debugger` / `proxy` 并进入 Chrome Web Store；`-minimal.zip` 仅作为低权限备用。E2E flavor 不得进入 CI artifact、GitHub Release 或商店。
- `Release Tags` 创建并推送 `pkg/oneworks-plugin-chrome-driver/v*` 后，必须显式 dispatch `chrome-extension-release.yml`：tag 由 `GITHUB_TOKEN` 推送，GitHub 会抑制该 token 产生的递归 workflow 事件，不能依赖 `on.push.tags`。release workflow 自动生成 checksums、artifact attestation 和 GitHub Release，预发布版本标记为 prerelease；人手或外部凭据推送 tag 时仍可由 `on.push.tags` 直接触发。
- main 首次创建 Chrome Driver tag 时，`Release Tags` 会显式 dispatch `chrome-extension-release.yml` 并传入 `publish_store=true`；workflow 创建 GitHub Release 后，通过 `chrome-web-store` environment，使用 WIF impersonation 的短期 service-account access token 自动提交包含 `debugger` / `proxy` 的正式开发者 ZIP，不上传 minimal ZIP。
- release run 若失败，优先 rerun failed jobs。重新运行 `Release Tags` 时，已有 Chrome tag 仍会显式 dispatch，但传入 `publish_store=false`，只用 clobber 语义恢复 GitHub Release，避免重复提交商店。商店 job 失败时，从同一 tag 手动 dispatch 并显式设置 `publish_store=true` 恢复。
- Chrome Web Store API 只能更新已有 item。首次 item、Store listing、Privacy、测试说明、可见性和 service-account 授权必须先在 Developer Dashboard 完成；Package 页公钥、Item ID、仓库 canonical identity 与服务端 allowlist 必须一致，发布脚本也会在上传前交叉校验。workflow 不尝试绕过这些人工步骤。
- 商店提交启用 `blockOnWarnings=true`、不跳过 review；上传处理失败、超时、警告阻断或返回未知发布状态时流水线必须失败。重跑前先用 Developer Dashboard / `fetchStatus` 确认当前 submission，避免重复提交。

## CLI 发布后的 Homebrew tap 同步

`@oneworks/cli` 正式版发布成功并能通过 `npm view @oneworks/cli@<version>` 查到后，需要同步 Homebrew tap：

1. 更新 tap formula：

   ```bash
   pnpm tools homebrew-tap sync-cli --version <version>
   ```

2. 在 tap submodule 内格式检查、提交并推送：

   ```bash
   brew style infra/homebrew-tap/Formula/oneworks.rb
   git -C infra/homebrew-tap status
   git -C infra/homebrew-tap add Formula/oneworks.rb
   git -C infra/homebrew-tap commit -m "chore: update oneworks to <version>"
   git -C infra/homebrew-tap push origin main
   ```

3. 用正式 tap 路径验证并回到主仓库提交 submodule 指针：

   ```bash
   brew update
   brew audit --strict oneworks-ai/tap/oneworks
   brew reinstall --build-from-source oneworks-ai/tap/oneworks
   brew test oneworks-ai/tap/oneworks
   git add infra/homebrew-tap
   ```

4. 如本次 CLI 发布已经修复 npm bin shebang，删除 `Formula/oneworks.rb` 里的临时 `inreplace "cli.js"` 补丁，并随同 tap 更新一起提交。

注意：

- `sync-cli` 会从 npm tarball 计算真实 `sha256`，所以必须在 npm 包已经发布后执行。
- 只发 alpha / beta 时，除非明确要让 Homebrew 跟进预发布版本，否则不要更新 stable formula。

## CLI 发布后的 Windows 安装同步

`@oneworks/cli` 正式版发布成功并能通过 `npm view @oneworks/cli@<version>` 查到后，需要同步 Windows 安装资产：

1. 更新 Scoop manifest 和 winget manifest 模板：

   ```bash
   pnpm tools windows-install sync-cli --version <version>
   ```

2. 在 Scoop bucket submodule 内检查、提交并推送：

   ```bash
   git -C infra/windows/scoop-bucket status
   git -C infra/windows/scoop-bucket add bucket/oneworks.json
   git -C infra/windows/scoop-bucket commit -m "chore: update oneworks to <version>"
   git -C infra/windows/scoop-bucket push origin main
   ```

3. 如果本次发布了 Windows portable zip，用真实下载地址和 SHA256 重新同步 winget 模板：

   ```bash
   pnpm tools windows-install sync-cli \
     --version <version> \
     --winget-installer-url <windows-zip-url> \
     --winget-installer-sha256 <windows-zip-sha256>
   ```

4. 把 `infra/windows/winget/` 下的 manifest 模板复制到 `microsoft/winget-pkgs` fork 中对应版本目录，执行 `winget validate` 后提交 PR。也可以使用 `wingetcreate` 生成 / 更新 manifest，但需要保证 `PackageIdentifier` 仍为 `OneWorks.OneWorks`。

5. 回到主仓库提交 submodule 指针、winget 模板和一键安装脚本：

   ```bash
   git add infra/windows scripts/install-windows.ps1
   ```

注意：

- Scoop bucket 使用 npm tarball 作为下载源，`sync-cli` 会计算真实 tarball `sha256`。
- winget 公开安装依赖 `microsoft/winget-pkgs` 接受 manifest；未接受前，用户应使用 PowerShell 一键安装脚本或 Scoop。
