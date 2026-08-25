# 发布步骤

返回入口：[RELEASE.md](../RELEASE.md)

## 多会话协调门禁

整体发布或同时涉及多个独立分发面的发布，在准备 Release PR、创建 tag、手动 publish / dispatch 或商店提交前，必须先按[多会话发布协调](./coordination.md)建立单一协调者、不可变发布身份、分面 owner、终态回调和独立审计。单包且只有一个外部副作用面的发布可以保留单会话，但仍须遵守同一来源、幂等恢复和终态核验要求。

发布 owner / reviewer / Git operator 的实际权限探测、官方 `gh` 入口与失败重建遵守[权限预检与审批恢复](../maintenance/task-planning.md#权限预检与审批恢复)；发布规则本身的文档改动按[变更风险分级验证](../maintenance/task-planning.md#按变更风险选择验证)，不要在这里复制另一套授权或 CI 规则。

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
- workflow 默认 `auth_mode=oidc`：GitHub OIDC `id-token: write`、`NPM_CONFIG_PROVENANCE=true`，不向 `npm publish` 注入 `NPM_TOKEN`，并在第一个 publish 前为完整 alias closure 逐 identity 验证 npm OIDC exchange。新 identity 只能选 `auth_mode=new-identity-bootstrap`：明确非空 `packages`、`publish_all=false`、`publish_tag=onboarding`，所有 selected identity 均必须 registry-absent；bootstrap 只发布当前 pre-target 版本，不能作为目标版本 provenance。`missing-trust-recovery` 在要求目标版本 provenance 的 release 中一律拒绝。
- `packages` 不能为空，除非明确勾选 `publish_all=true`。发布整组 public workspace 包时必须显式打开 `publish_all`，避免误触发把所有 public 包发布到 npm。
- `publish_tag=latest` 的首次 stable 发布会强制 `publish_all=true`、`packages` 为空，并且 workflow 必须从精确的 `pkg/oneworks/v<version>` tag 运行。发生 mixed-result 后，先由 postflight 完整列出缺失 identity；目标版本要求 provenance 时必须修复 trust 并用 `auth_mode=oidc` 定向恢复，不能以 token mode 绕过 provenance。
- workflow 先用 publish-plan 生成 alias-closed order，再由 npm publish guard 冻结该顺序中每个本地 `.tgz` 的 digest，并仅发布这些精确 tarball；发布前每项重新检查目标 version 不存在，绝不以 `--skip-existing` 接受未知 registry bytes；`publish_tag` 默认 `alpha`。
- 新增 public workspace 包默认不需要改 workflow；只要被 `pnpm-workspace.yaml` 收录、`package.json` 带 `name` / `version` 且没有 `private: true`，在 `publish_all=true` 时会自动进入本仓全量发布计划。唯一例外是由获准独立源码仓库拥有并发布的 workspace 包：其 `repository.url` 必须命中 `publish-plan` 的显式 allowlist，计划必须把它列入 `skippedIndependent`，无论全量还是按包点名都不得从本仓发布；未知独立仓库或显式点名必须 fail closed。版本、tag、provenance 与 npm postflight 由该独立仓库自己的受保护发布流程负责。
- `onework`、`oneork`、`oneorks` 是 `oneworks` bootstrap 的 typo publish alias，必须从 `apps/bootstrap/package.json` 的 `oneworks.publishAliases` 自动展开，同源改名发布；不要为它们创建独立 workspace 包，不要让它们依赖 `oneworks`，也不要写额外 redirect 逻辑。发布这组包且要保证裸 `npx onework` 和 `npx oneworks` 行为一致时，必须在首次发布该版本时使用 `publish_tag=latest`，或在发布后立刻用有 2FA 权限的 npm 登录态执行 `npm dist-tag add <pkg>@<version> latest` 补齐 `oneworks` 和三个 publish alias 包。
- 发布 guard 在目标 version 已存在时失败而非跳过；mixed-result 必须由 postflight 完整对账并按恢复规则处理。
- npm Trusted Publishing 要求 package 已存在。新增包第一次发布必须依赖 `NPM_TOKEN` 完成 bootstrap；首发成功后，必须在 npm 为该包配置 Trusted Publisher：GitHub Actions、`oneworks-ai/app`、workflow filename `npm-publish-alpha.yml`、允许 `npm publish`。后续同包版本再通过 Trusted Publishing 发布。
- 发布流水线必须在任何 package 发布失败时退出失败。mixed-result 后先逐 identity 对账 version、dist-tag 与 integrity，只对缺失项执行定向 recovery；`--skip-existing` 是保护措施，不能代替对账。
- stable `latest` 流程结束前会逐 identity 核对目标版本、`latest` dist-tag，并重新下载所有 tarball 计算 SHA-512 integrity 与 SHA-1 shasum；任一 identity 尚未传播或字节不一致都会保留失败状态。

## 发布中断

- 不要直接重跑整批发布命令
- 先逐包检查 registry 当前版本
- 已经在 registry 上出现目标版本的包，不要重复发布
- 分别核对 npm registry、远端分支和远端 tag，缺什么补什么

## 发布证据层级与大文件获取

- 不可变发布证据的最小单位是绑定在一起的版本化页面快照、精确 package tag peeled source、具体 workflow run / attempt、候选 manifest、Release asset 名称 / 大小 / byte digest 与 provenance；版本化 URL 或 GitHub Release 容器本身不能脱离这份快照单独作证。同版本资产仅能按已授权恢复流程替换：先保留旧资产和摘要审计链，再生成新的完整证据快照，并明确旧 byte snapshot 已被后继快照取代，不能静默把 URL 下的新字节冒充原证据。
- 首页、未版本化下载入口、PWA / Avatar 当前入口以及其他随 `main` 自动部署的 live alias 是可变视图，可能被后续合入覆盖。它们可以证明当前线上状态，但不能单独否定已经通过版本化 URL、Release 和 digest 证明的旧版本发布。
- 大型 Release asset 下载必须使用有界重试和可恢复下载；单条长连接持续失败时，改用确定性的 range / segmented download，逐段校验 `Content-Range`（或等价范围证据）和精确长度，按顺序组装后再核对最终文件大小与权威 SHA-256。最终摘要通过前不得解压、挂载或安装。
- 本机代理、DNS、TLS 或长连接失败属于取证通道问题，不是远端候选失败。先恢复 / 替换只读取证方式；不能因此重复 dispatch、重建 candidate、覆盖 Release 或再次提交商店。

## 发布终态收口

workflow 显示 success 还不等于整个发布完成。协调者在最终报告前必须逐项收口：

1. 由独立 reviewer 按冻结 source 对 tag、registry、Release / asset、部署、商店与明确排除面做跨表面审计，并核对 provenance / digest 与版本身份。
2. 对所有可能的重复 run、额外 tag、并发 deployment 和恢复动作完成归因，确认没有因为重试产生第二份外部副作用。
3. 核验并归档已经终止的 owner / reviewer / operator task，删除各自 heartbeat；不得归档用户主任务或仍在运行的外部审核 monitor。
4. 安装验证成功后，把旧应用备份和 release 下载 / 安装归档移到可恢复的废纸篓；只在安全卸载后直接移除可重新生成的 mount point、空目录和隔离 profile 临时文件。不永久删除当前应用、用户数据或唯一的发布证据。
5. 对发布窗口邮件做保守分类：加版本专用 label，只归档例行成功通知，把 pending review、warning、failure 和 action-required 留在 Inbox；不回复、转发或删除邮件。
6. 向用户提交一份合并报告，覆盖不可变来源、各发布面、外部 mutation、验证、偏差、剩余外部审核和生命周期清理，避免让分面回调代替最终结论。

## macOS 桌面候选与提升

- 触达桌面风险源码、workflow、配置、manifest、lockfile、脚本、测试或混合范围的普通 PR，其 macOS installer 使用 macos-26 runner，构建 unsigned arm64 候选、验证 native closure 并执行 arm64 smoke；Merge Queue 的组合 revision 构建 arm64+x64。纯文档和 avatar-only gitlink PR 只完成同名 required context 的范围确认；avatar 仍由 client production build、full typecheck 与 lint 覆盖。nightly 仍只覆盖发布打包回归，不能替代正式候选。
- 正式发版仍构建 arm64+x64 的 DMG / PKG / ZIP。构建成功后必须生成 `oneworks-desktop-release-candidate.json`，记录 tag、源 SHA、签名状态、架构、目标和每个文件的 SHA-256；后续发布前必须重新核对清单。
- 需要先验收候选但暂不发布时，手动触发 `desktop-package.yml`，传 `release_tag` 且保持 `create_release=false`。这会使用正式版本身份构建，但只保存 Actions artifact。
- 提升已验证候选时，再触发同一 workflow，设置 `create_release=true`、相同 `release_tag` 和原成功构建的 `candidate_run_id`。package job 会跳过，GitHub Release 只消费并校验原候选，不重新编译或打包。
- GitHub Release job 失败时优先 rerun failed jobs；成功的 package job 和 artifact 不需要重跑。跨 run 恢复时使用 `candidate_run_id`，不能临时拿本地产物替换。
- Release 资产上传成功后，workflow 必须复用 `deploy-homepage.yml` 触发并等待 homepage Pages。官网失败只重试 release / homepage 阶段，不重建候选。
- nightly 只覆盖发布打包回归，不替代正式候选的双架构、全目标、签名 / notarization 和清单验证。
- 对 alpha / beta / rc，唯一人工 Production gate 位于签名、公证和安装验证开始前的 `package` job。只有候选清单、tag source、签名策略和全部 asset digest 验证通过后，GitHub Release 与 Homepage 才在 `Release Automation` 环境连续完成；不要为同一不可变候选增加第二、第三次人工审批。stable 仍使用 `Production` 保护发布与 Homepage。
- Desktop GitHub Release 必须在上传前对已验证的完整 release-artifacts 集使用 GitHub artifact attestation；候选 manifest、远端 SHA-256 和 attestation 三者共同构成可下载二进制的证据链。

## VS Code 扩展发布

- `apps/vscode-extension/package.json` 的 alpha / beta / rc 版本只参加普通 `vscode-extension-ci.yml` typecheck、build 和 VSIX package 验证。Release Tags 必须过滤这些预发布身份；不得创建 `pkg/oneworks-vscode-extension/v<prerelease>`、GitHub VSIX Release，或发布到 Marketplace / Open VSX。
- 只有三段式 stable semver source version 可以获得 `pkg/oneworks-vscode-extension/v<stable>` 并发布。`vscode-extension-release.yml` 只能人工 `workflow_dispatch`，输入必须是精确 annotated stable package tag；tag version、package version、peeled tag commit、checkout HEAD 与 build source SHA 必须一致。
- VS Code Marketplace / Open VSX 的数值版本不可覆盖。One Works 的 `0.1.0` 至 `0.1.3` 已被历史预发布占用，`0.1.4` 是已有首个稳定扩展；新的 prerelease source 不再消耗商店数值版本。
- VS Code Marketplace 发布依赖仓库 secret `VSCE_PAT` 和 variable `VSCODE_EXTENSION_PUBLISHER`；GitHub Release / VSIX artifact 成功不等于 Marketplace 已发布。
- 手动稳定发布在创建 GitHub Release 前必须确认 `VSCODE_EXTENSION_PUBLISHER`、`VSCE_PAT` 和 `OVSX_PAT` 都已配置；不能把缺失商店凭据降级成跳过后成功。
- VS Code Marketplace 和 Open VSX publish 都必须带 duplicate skip 语义，但 duplicate skip 只用于同一稳定 release tag、同一不可变 source 和同一 VSIX 的恢复重跑。不同 release tag 映射到相同数值版本时必须失败，不能把 registry 仍提供旧字节视作本次发布成功。
- store-version guard 默认不会因 exact release tag 已存在而放宽碰撞或单调性检查。只有该 exact tag 的 GitHub Release 已经通过元数据校验并包含预期命名的 authoritative VSIX asset 时，恢复重跑才允许绕过这些 prior-tag 检查；guard、`reuse` 判定和随后的 create / upload / reuse 必须在同一 metadata snapshot 的同一 workflow shell step 内相邻执行。该 asset 随后必须下载、验证并复用。这不会使历史跨 tag 碰撞合法化，协调终态仍必须独立证明目标 registry 提供的是该逻辑 tag 的获批字节。
- 手动稳定 release 必须 checkout resolved release tag，并核对 peeled tag commit、HEAD 和 build source SHA 完全一致。商店发布前先把 VSIX 作为该 tag 的 GitHub Release asset 持久化；同 tag 重跑必须下载并复用已有 asset，不能重新打包覆盖或 clobber，再由 Marketplace 与 Open VSX 共同消费这个 authoritative 文件。
- VSIX 打包完成后必须核对 `extension/package.json` 的三段式稳定版本且不存在 prerelease marker，之后才能上传 artifact 或进入商店发布。
- Open VSX Registry 是 VS Code 兼容 IDE 的通用扩展分发源，必须和 VS Code Marketplace 并行发布同一个 VSIX。Open VSX 发布依赖仓库 secret `OVSX_PAT`，并且 registry 里必须已创建和 extension publisher 一致的 namespace，例如 `oneworks-ai`；`VSCE_PAT` 不能用于 Open VSX。
- Open VSX namespace 首次创建走 `npx ovsx create-namespace oneworks-ai -p <token>`；如需 verified owner，创建后还要在 Open VSX 里单独 claim namespace ownership。
- `OVSX_PAT` 发布成功与 namespace verification 独立：`verified=false` / `unrelatedPublisher=true` 本身不表示发布失败。独立核对 public VSIX bytes/hash、version 与 `preRelease`；verification 走官方 namespace-claim 和 maintainer review，不要为了 metadata 重发或轮换 token。

## 外部浏览器 Chrome 扩展发布

- `@oneworks/plugin-external-browser-driver` 的 workspace semver 是发布身份；构建阶段把 `x.y.z-alpha.n` / `beta.n` / `rc.n` 映射为 Chrome 的四段整数版本，并把原版本保存在 `version_name`。稳定版使用第四段 `65535`，确保同一 patch 的 prerelease 小于稳定版。
- `pnpm --filter @oneworks/plugin-external-browser-driver package:extension:all` 同时生成正式开发者 ZIP 与可选 minimal ZIP。无后缀的正式包复用 audited privileged flavor，声明 `debugger` / `proxy` 并进入 Chrome Web Store；`-minimal.zip` 仅作为低权限备用。E2E flavor 不得进入 CI artifact、GitHub Release 或商店。
- `Release Tags` 创建并推送 `pkg/oneworks-plugin-external-browser-driver/v*` 后，必须显式 dispatch `chrome-extension-release.yml`：tag 由 `GITHUB_TOKEN` 推送，GitHub 会抑制该 token 产生的递归 workflow 事件，不能依赖 `on.push.tags`。release workflow 自动生成 checksums、artifact attestation 和 GitHub Release，预发布版本标记为 prerelease；人手或外部凭据推送 tag 时仍可由 `on.push.tags` 直接触发。
- `Release Tags` 对首次与既有 Browser Control tag 都显式 dispatch `chrome-extension-release.yml` 并传入 `publish_store=false`，只创建 checksums、artifact attestation 和 GitHub Release。Web Store 是独立分面：先用官方 `fetchStatus` 对账，只有没有 active upload、submitted revision、warning 或 takedown 时，才由单一 owner 从同一 tag 手动 dispatch 一次 `publish_store=true`。
- release run 失败时优先 rerun failed jobs。Release Tags 重跑仍只恢复 GitHub Release，绝不触发商店提交；同 tag 商店提交如果看到已存在 active / accepted submission、状态无法解析或需 Dashboard 操作，保留为外部审核，不能重试 upload / publish。
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

Windows 安装资产、Scoop 与 winget 的同步流程见 [Windows 安装同步](./windows-install-sync.md)。
