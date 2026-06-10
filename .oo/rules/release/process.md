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
