# npm Trusted Publishing 与 Open VSX 发布认证

本页记录 npm Trusted Publishing、bootstrap 恢复和 Open VSX 认证的内部操作规则。它不替代 [发布步骤](./process.md) 中的发布范围、store-version collision 与不可变 VSIX artifact 门禁。

## 先区分两类工作

- **发布**：把已批准的版本和不可变产物发布到 registry。
- **信任配置**：把已存在的 npm package 关联到 GitHub Actions OIDC publisher。

两者不是同一步。新 npm identity 不能先用 Trusted Publishing 建立 package settings：第一次必须用 `auth_mode=new-identity-bootstrap` 和 `NPM_TOKEN` bootstrap，成功后立即配置 Trusted Publisher，下一次发布才改用无 token 的 `auth_mode=oidc`。bootstrap 必须是明确非空的 alias-closed `packages`、`publish_all=false`、`publish_tag=onboarding`，并且每个 selected identity 在 registry 都不存在；它发布当前 pre-target 版本，不得声称目标发布 provenance。`NPM_TOKEN` 是 bootstrap / 定向恢复 fallback，不是日常发布认证；绝不在文档、日志或命令回显中复制它的值。

## npm 发布前：身份与登录态

在 dispatch 前，先收敛本次的**完整 npm public identity set**：所有实际会发布的 public workspace package，以及 `apps/bootstrap/package.json` 的 `oneworks.publishAliases` 展开的 publish alias。不要只看 workspace 名称、也不要手工猜 alias；用发布计划和该 manifest 的当前值逐项列出。

对每一个 identity 都审计其 Trusted Publisher 配置。浏览器已登录 npm 不表示 CLI 已认证；用 `npm whoami`（必要时完成 CLI login）确认操作者 CLI 身份。它只说明本地 CLI 登录态，**不**说明 GitHub OIDC 是否能发布，也不应被用作 OIDC 状态证明。

在 dispatch 前还必须把 provenance repository metadata 视为发布不变量：每个选中的 public source workspace manifest 都要声明 `repository.type=git`、`repository.url=https://github.com/oneworks-ai/app.git`，且 `repository.directory` 精确等于仓库相对 workspace 路径；publish alias 继承并只校验其 source package。真实发布和 publish dry-run 都必须在第一个 publish 子进程前 fail closed，不能等 registry 以 `E422` 拒绝后再补元数据。冻结 tarball 前还要按 selected source package 构建其 workspace dependency closure；不能假设 fresh checkout 中已有依赖包 `dist`，也不能等单个 package 的 `prepack` 在批次中途才暴露缺失构建产物。

```bash
# 对完整 identity set 中的每个 <package> 分别执行。
pnpm dlx npm@11.15.0 trust list <package> --json
```

预期的 publisher 值为：GitHub Actions、repository `oneworks-ai/app`、workflow filename `npm-publish-alpha.yml`、允许 `npm publish`，且不设置 environment。先处理任何缺失或不一致的 identity，再 dispatch 发布。

## 使用 npm trust 配置 Trusted Publisher

优先使用当前 npm `trust` CLI，而不是逐 package 在网页上点击。`npm trust` 要求 npm >= 11.15、package 已经存在、操作者具有 package write access，并启用账户 2FA。bootstrap 使用的 Granular Access Token（包括 bypass 2FA token）和 legacy basic auth 都不能代替这次交互式账户认证。若本机 npm 过旧，用一次性的新 CLI，避免全局修改开发者工具：

```bash
# 为已存在的 <package> 创建配置；environment 未设置，因此故意省略该选项。
pnpm dlx npm@11.15.0 trust github <package> \
  --file npm-publish-alpha.yml \
  --repo oneworks-ai/app \
  --allow-publish \
  --yes

# 保存后立刻逐个核对实际配置。
pnpm dlx npm@11.15.0 trust list <package> --json
```

批量配置仍按 package **顺序**执行：第一项需要交互式 2FA 时完成它；如果 npm 提供五分钟跳过选项，使用该选项以完成同一受控批次。每个 package 保存后先 `list` 验证精确字段，再等待至少两秒处理下一个，以避免 rate limiting。不要并发发送一组配置请求。

网页 UI 仅是 CLI 不可用时的 fallback。使用 UI 时只保留一个可见 tab，等每项出现稳定的成功状态并重新确认保存的精确值，再处理下一项；不要快速连点，也不要绕过 CAPTCHA、2FA 或其他安全挑战。

## npm mixed-result 恢复

一次完整发布混合成功 / 失败时，先逐 identity 审计 registry 的**精确** version、dist-tag 与 tarball integrity，并和批准的发布计划对账。下面是单个 identity 的最小探针；对完整 publish plan（包括 aliases）逐项执行，并保存结构化结果：

```bash
npm view <package>@<version> version dist.integrity dist.shasum dist.tarball --json
npm view <package> dist-tags.<tag> --json
npm pack <package>@<version> --dry-run --json >/dev/null
```

目标 version 必须精确存在、目标 dist-tag 必须等于该 version、`dist.integrity` / `dist.shasum` / `dist.tarball` 必须非空，且远端 tarball 必须通过 npm 客户端的 integrity 验证。只冻结 / 选中仍缺失的 identities；不要广泛 republish。`--skip-existing` 可以保护已存在的同名同版本，但不能替代这次 reconciliation。

只有两类已核实的认证缺口才使用 token recovery：全新的 identity 需要首次 bootstrap，或已存在的 identity 因缺少 Trusted Publisher 而出现 OIDC token-exchange / publish 认证失败；npm token-exchange 或 publish `404` 是后一种情况的可能症状，仍需结合 `npm trust list` 和 registry 状态确认。执行一次范围仅限 registry 中目标版本仍缺失 identities 的 targeted recovery：`packages` 只填写冻结后的缺失集合、`publish_all=false`，并显式选择 `auth_mode=missing-trust-recovery`。但只要目标版本需要 provenance，该 mode 必须失败；修复 trust 后改用 OIDC 定向恢复。完成后立即按本页配置 trust，再对**完整 publish plan** 重跑上面的 exact version / dist-tag / integrity 审计；只有全部 identities（包括 aliases）通过才算 npm 分发完成。下一次发布恢复 tokenless OIDC。其他失败原因必须按实际错误处理，不要因为有 token 就把已存在版本重新发布。

manifest provenance metadata 缺失或错误导致的 npm `E422` 属于包元数据校验失败，不是 token bootstrap / recovery 条件。mixed-result 时仍先冻结已成功 identities，只在受保护主线修复元数据和 pre-dispatch gate 后，对 registry 中缺失的 identity 走原 Trusted Publisher OIDC 定向恢复；不要选择 token auth mode，也不要改版本或移动既有 tag。同版本恢复在 dispatch 前还必须冻结双 SHA 证据：原始不可变 product / tag SHA、受保护主线上的 recovery / source SHA、精确的 metadata / gate-only diff，以及按包形态适用的 runtime、prebuild 与 tarball 内容对比；最终审计必须分别记录两个 SHA，并确认 registry provenance 如实指向实际执行恢复发布的 recovery commit，不能把原始 product / tag SHA 伪装成这次恢复的来源。

## Open VSX：发布与 namespace verification 独立

`OVSX_PAT` 能否发布、extension 是否可下载，以及 namespace 是否显示为 verified，是独立状态。Open VSX API 的 `verified=false` 或 `unrelatedPublisher=true` 本身不表示发布失败。

发布后独立验证逻辑 version / `preRelease` 元数据，以及公开下载的 VSIX bytes 与 hash 是否匹配 authoritative artifact。不要为了改变 verification metadata 轮换 `OVSX_PAT` 或重新发布相同版本。

namespace verification 走 Open VSX 的官方 namespace-claim 流程，并等待其外部 maintainer review。它不是 publish token 配置的一部分；在 review 期间继续按实际发布和 artifact 证据判断发布结果。
