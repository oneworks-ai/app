# 发布步骤

返回入口：[RELEASE.md](../RELEASE.md)

## 多会话协调门禁

整体发布或同时涉及多个独立分发面的发布，在准备 Release PR、创建 tag、手动 publish / dispatch 或商店提交前，必须先按[多会话发布协调](./coordination.md)建立单一协调者、不可变发布身份、分面 owner、终态回调和独立审计。单包且只有一个外部副作用面的发布可以保留单会话，但仍须遵守同一来源、幂等恢复和终态核验要求。

## 发布前最小检查

- 把拟发布包列表收敛到最小范围，并能逐个说明为什么需要发版
- 跑目标包相关测试，不只看仓库全量状态
- 跑 `pnpm security:audit:production`，确认没有未豁免的 critical / high 生产依赖风险
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

### Relay transport release triad

Relay device transport contract is runtime code shared by `@oneworks/types`, `@oneworks/relay-server`, and `@oneworks/plugin-relay`. The feature PR must not change package versions; its release PR must first, or in the same ordered publication batch, publish `@oneworks/types@0.1.0-rc.1`, then publish `@oneworks/relay-server@0.1.0-rc.2` and `@oneworks/plugin-relay@0.1.0-rc.2`. Use an explicit targeted selection containing all three packages, and run `pnpm tools publish-plan -- --packages @oneworks/types,@oneworks/relay-server,@oneworks/plugin-relay --json` to verify the selected set and that `@oneworks/types` precedes the Relay Server before publishing.

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

认证准备、首次 bootstrap 与 mixed-result 恢复先遵守 [npm Trusted Publishing 与 Open VSX 认证](./npm-trusted-publishing.md)。

- 首次发布或需要 npm provenance 时，使用 `.github/workflows/npm-publish-alpha.yml` 手动触发发布。
- workflow 默认使用 npm Trusted Publishing：GitHub OIDC `id-token: write`、`NPM_CONFIG_PROVENANCE=true`，不向 `npm publish` 注入 `NPM_TOKEN`。只有 npm 上还不存在的新 identity 首次 bootstrap，或经 registry / trust 对账确认的 missing-trust identities 定向恢复时，才显式勾选 `bootstrap_with_token=true`，用 `NPM_TOKEN` 作为 fallback。
- `packages` 不能为空，除非明确勾选 `publish_all=true`。发布整组 public workspace 包时必须显式打开 `publish_all`，避免误触发把所有 public 包发布到 npm。
- `publish_tag=latest` 的首次 stable 发布会强制 `publish_all=true`、`packages` 为空，并且 workflow 必须从精确的 `pkg/oneworks/v<version>` tag 运行。发生 mixed-result 后，只有 `bootstrap_with_token=true`、`publish_all=false` 且选择项解析后恰好覆盖 registry 全部缺失 identity（包含 alias closure）时才能恢复。
- workflow 通过 `pnpm tools publish-plan -- --publish --no-git-checks --skip-existing --tag <publish_tag>` 发布 public workspace 包；`publish_tag` 默认 `alpha`。
- 新增 public workspace 包不需要改 workflow；只要被 `pnpm-workspace.yaml` 收录、`package.json` 带 `name` / `version` 且没有 `private: true`，在 `publish_all=true` 时会自动进入全量发布计划。只想发新包时优先填写 `packages=<new-package>`，让发布计划自动补内部依赖顺序。
- `onework`、`oneork`、`oneorks` 是 `oneworks` bootstrap 的 typo publish alias，必须从 `apps/bootstrap/package.json` 的 `oneworks.publishAliases` 自动展开，同源改名发布；不要为它们创建独立 workspace 包，不要让它们依赖 `oneworks`，也不要写额外 redirect 逻辑。发布这组包且要保证裸 `npx onework` 和 `npx oneworks` 行为一致时，必须在首次发布该版本时使用 `publish_tag=latest`，或在发布后立刻用有 2FA 权限的 npm 登录态执行 `npm dist-tag add <pkg>@<version> latest` 补齐 `oneworks` 和三个 publish alias 包。
- `--skip-existing` 只在真实发布时跳过 npm registry 已存在的同名同版本；dry-run 仍完整打包所有候选包。新增 public 包时，旧包会跳过，新包会继续首发。
- npm Trusted Publishing 要求 package 已存在。新增包第一次发布必须依赖 `NPM_TOKEN` 完成 bootstrap；首发成功后，必须在 npm 为该包配置 Trusted Publisher：GitHub Actions、`oneworks-ai/app`、workflow filename `npm-publish-alpha.yml`、允许 `npm publish`。后续同包版本再通过 Trusted Publishing 发布。
- 发布流水线必须在任何 package 发布失败时退出失败。mixed-result 后先逐 identity 对账 version、dist-tag 与 integrity，只对缺失项执行定向 recovery；`--skip-existing` 是保护措施，不能代替对账。
- stable `latest` 流程结束前会逐 identity 核对目标版本、`latest` dist-tag，并重新下载所有 tarball 计算 SHA-512 integrity 与 SHA-1 shasum；任一 identity 尚未传播或字节不一致都会保留失败状态。

## 发布中断

- 不要直接重跑整批发布命令
- 先逐包检查 registry 当前版本
- 已经在 registry 上出现目标版本的包，不要重复发布
- 分别核对 npm registry、远端分支和远端 tag，缺什么补什么

## macOS 桌面候选与提升

- 普通 PR 的 macOS installer 现在使用 macos-26 runner，构建 unsigned arm64+x64 候选、验证 native closure 并执行 arm64 smoke；nightly 仍只覆盖发布打包回归，不能替代正式候选。
- 正式发版仍构建 arm64+x64 的 DMG / PKG / ZIP。构建成功后必须生成 `oneworks-desktop-release-candidate.json`，记录 tag、源 SHA、签名状态、架构、目标和每个文件的 SHA-256；后续发布前必须重新核对清单。
- 需要先验收候选但暂不发布时，手动触发 `desktop-package.yml`，传 `release_tag` 且保持 `create_release=false`。这会使用正式版本身份构建，但只保存 Actions artifact。
- 提升已验证候选时，再触发同一 workflow，设置 `create_release=true`、相同 `release_tag` 和原成功构建的 `candidate_run_id`。package job 会跳过，GitHub Release 只消费并校验原候选，不重新编译或打包。
- GitHub Release job 失败时优先 rerun failed jobs；成功的 package job 和 artifact 不需要重跑。跨 run 恢复时使用 `candidate_run_id`，不能临时拿本地产物替换。
- Release 资产上传成功后，workflow 必须复用 `deploy-homepage.yml` 触发并等待 homepage Pages。官网失败只重试 release / homepage 阶段，不重建候选。
- nightly 只覆盖发布打包回归，不替代正式候选的双架构、全目标、签名 / notarization 和清单验证。

## VS Code 扩展发布

- VS Code Marketplace 不支持 `0.1.0-alpha.0` 这种 semver prerelease 字符串；预发布必须使用 `major.minor.patch` 三段式版本，再通过 `vsce package --pre-release` 和 `vsce publish --pre-release` 标记。
- 本仓 `apps/vscode-extension/package.json` 可以继续使用带逻辑预发布后缀的版本，但 VSIX release stage 必须把 Marketplace manifest version 映射为同一版本的三段式数值 base，同时保留 `--pre-release`。每个纳入 Marketplace / Open VSX 的后续逻辑预发布都必须使用严格更新且唯一的数值 base；即使只改变 alpha / beta / rc 后缀，也不能复用已被另一个逻辑 release tag 占用的三段式版本。
- VS Code Marketplace / Open VSX 的数值版本不可覆盖；One Works 的 `0.1.0` 至 `0.1.3` 已被历史预发布占用，因此首个稳定扩展使用下一个未占用的 `0.1.4`。后续仍优先为预发布和稳定版分配互不重叠的数值版本。
- VS Code Marketplace 发布依赖仓库 secret `VSCE_PAT` 和 variable `VSCODE_EXTENSION_PUBLISHER`；GitHub Release / VSIX artifact 成功不等于 Marketplace 已发布。
- VS Code Marketplace 和 Open VSX publish 都必须带 duplicate skip 语义，但 duplicate skip 只用于同一逻辑 release tag、同一不可变 source 和同一 VSIX 的恢复重跑。不同逻辑 release tag 映射到相同数值版本时必须在 Release Tags 计划或直接 release workflow 中失败，不能把 registry 仍提供旧字节视作本次发布成功。
- store-version guard 默认不会因 exact release tag 已存在而放宽碰撞或单调性检查。只有该 exact tag 的 GitHub Release 已经通过元数据校验并包含预期命名的 authoritative VSIX asset 时，恢复重跑才允许绕过这些 prior-tag 检查；guard、`reuse` 判定和随后的 create / upload / reuse 必须在同一 metadata snapshot 的同一 workflow shell step 内相邻执行。该 asset 随后必须下载、验证并复用。这不会使历史跨 tag 碰撞合法化，协调终态仍必须独立证明目标 registry 提供的是该逻辑 tag 的获批字节。
- push 与手动 VS Code release 都必须 checkout resolved release tag，并核对 peeled tag commit、HEAD 和 build source SHA 完全一致。商店发布前先把 VSIX 作为该 tag 的 GitHub prerelease asset 持久化；同 tag 重跑必须下载并复用已有 asset，不能重新打包覆盖或 clobber，再由 Marketplace 与 Open VSX 共同消费这个 authoritative 文件。
- VSIX 打包完成后必须核对 `extension/package.json` 的三段式数值版本和 `extension.vsixmanifest` 的 prerelease marker；两者必须同时匹配逻辑 package version，之后才能上传 artifact 或进入商店发布。
- Open VSX Registry 是 VS Code 兼容 IDE 的通用扩展分发源，必须和 VS Code Marketplace 并行发布同一个 VSIX。Open VSX 发布依赖仓库 secret `OVSX_PAT`，并且 registry 里必须已创建和 extension publisher 一致的 namespace，例如 `oneworks-ai`；`VSCE_PAT` 不能用于 Open VSX。
- Open VSX namespace 首次创建走 `npx ovsx create-namespace oneworks-ai -p <token>`；如需 verified owner，创建后还要在 Open VSX 里单独 claim namespace ownership。
- `OVSX_PAT` 发布成功与 namespace verification 独立：`verified=false` / `unrelatedPublisher=true` 本身不表示发布失败。独立核对 public VSIX bytes/hash、version 与 `preRelease`；verification 走官方 namespace-claim 和 maintainer review，不要为了 metadata 重发或轮换 token。
- `pkg/oneworks-vscode-extension/v*` 触发的 GitHub Release 对预发布版本应标记为 prerelease。

## 外部浏览器 Chrome 扩展发布

- `@oneworks/plugin-external-browser-driver` 的 workspace semver 是发布身份；构建阶段把 `x.y.z-alpha.n` / `beta.n` / `rc.n` 映射为 Chrome 的四段整数版本，并把原版本保存在 `version_name`。稳定版使用第四段 `65535`，确保同一 patch 的 prerelease 小于稳定版。
- `pnpm --filter @oneworks/plugin-external-browser-driver package:extension:all` 同时生成正式开发者 ZIP 与可选 minimal ZIP。无后缀的正式包复用 audited privileged flavor，声明 `debugger` / `proxy` 并进入 Chrome Web Store；`-minimal.zip` 仅作为低权限备用。E2E flavor 不得进入 CI artifact、GitHub Release 或商店。
- `Release Tags` 创建并推送 `pkg/oneworks-plugin-external-browser-driver/v*` 后，必须显式 dispatch `chrome-extension-release.yml`：tag 由 `GITHUB_TOKEN` 推送，GitHub 会抑制该 token 产生的递归 workflow 事件，不能依赖 `on.push.tags`。release workflow 自动生成 checksums、artifact attestation 和 GitHub Release，预发布版本标记为 prerelease；人手或外部凭据推送 tag 时仍可由 `on.push.tags` 直接触发。
- main 首次创建 Browser Control tag 时，`Release Tags` 会显式 dispatch `chrome-extension-release.yml` 并传入 `publish_store=true`；workflow 创建 GitHub Release 后，通过 `chrome-web-store` environment，使用 WIF impersonation 的短期 service-account access token 自动提交包含 `debugger` / `proxy` 的正式开发者 ZIP，不上传 minimal ZIP。
- release run 若失败，优先 rerun failed jobs。重新运行 `Release Tags` 时，已有 Chrome tag 仍会显式 dispatch，但传入 `publish_store=false`，只用 clobber 语义恢复 GitHub Release，避免重复提交商店。商店 job 失败时，从同一 tag 手动 dispatch 并显式设置 `publish_store=true` 恢复。
- Chrome Web Store API 只能更新已有 item。首次 item、Store listing、Privacy、测试说明、可见性和 service-account 授权必须先在 Developer Dashboard 完成；Package 页公钥、Item ID、仓库 canonical identity 与服务端 allowlist 必须一致，发布脚本也会在上传前交叉校验。workflow 不尝试绕过这些人工步骤。
- 商店提交启用 `blockOnWarnings=true`、不跳过 review；上传处理失败、超时、警告阻断或返回未知发布状态时流水线必须失败。重跑前先用 Developer Dashboard / `fetchStatus` 确认当前 submission，避免重复提交。

## CLI 发布后的 Homebrew tap 同步

`oneworks` 正式版发布成功并能通过 `npm view oneworks@<version>` 查到后，需要同步 Homebrew tap：

1. 更新 tap formula：

   ```bash
   pnpm tools homebrew-tap sync-oneworks --version <version>
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

- `sync-oneworks` 会从 npm tarball 计算真实 `sha256`；tap 初次为空时会生成完整 formula，所以必须在 npm 包已经发布后执行。
- 只发 alpha / beta 时，除非明确要让 Homebrew 跟进预发布版本，否则不要更新 stable formula。

## CLI 发布后的 Windows 安装同步

`oneworks` 正式版发布成功并能通过 `npm view oneworks@<version>` 查到后，需要同步 Windows 安装资产。`npm-publish-alpha.yml` 在 `publish_tag=latest` 且发布计划包含 `oneworks` 时，会生成并证明版本锁定的 Windows portable ZIP，并以 `pkg/oneworks/v<version>` GitHub Release asset 发布：

1. 更新 Scoop manifest 和 winget manifest 模板：

   ```bash
   pnpm tools windows-install sync-oneworks --version <version>
   ```

2. 在 Scoop bucket submodule 内检查、提交并推送：

   ```bash
   git -C infra/windows/scoop-bucket status
   git -C infra/windows/scoop-bucket add bucket/oneworks.json
   git -C infra/windows/scoop-bucket commit -m "chore: update oneworks to <version>"
   git -C infra/windows/scoop-bucket push origin main
   ```

3. 同步命令默认读取正式 GitHub Release ZIP 并计算真实 SHA256；需要验证候选镜像时才显式覆盖地址：

   ```bash
   pnpm tools windows-install sync-oneworks \
     --version <version> \
     --winget-installer-url <windows-zip-url>
   ```

4. 把 `infra/windows/winget/` 下的 manifest 模板复制到 `microsoft/winget-pkgs` fork 中对应版本目录，执行 `winget validate` 后提交 PR。也可以使用 `wingetcreate` 生成 / 更新 manifest，但需要保证 `PackageIdentifier` 仍为 `OneWorks.OneWorks`。

5. 回到主仓库提交 submodule 指针、winget 模板和一键安装脚本：

   ```bash
   git add infra/windows scripts/install-windows.ps1
   ```

注意：

- Scoop 与 winget 共同使用 GitHub Release 中的 Windows portable ZIP；Scoop bucket 初次为空时，`sync-oneworks` 会生成完整 manifest，并计算真实 ZIP `sha256`。
- winget 公开安装依赖 `microsoft/winget-pkgs` 接受 manifest；未接受前，用户应使用 PowerShell 一键安装脚本或 Scoop。
