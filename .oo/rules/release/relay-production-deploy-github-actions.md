# Relay Production Deploy GitHub Actions

`.github/workflows/deploy-relay-server.yml` 只允许通过 `workflow_dispatch` 人工 promotion，并要求输入的 `source_sha` 与 workflow 从 `main` checkout 的不可变 SHA 完全一致。所有 production promotion 共享一个 workflow-level global concurrency group，避免 `both`、单平台和 external dispatch 并行修改同一目标；同一个 `both` run 内的 Cloudflare 与 Vercel 仍是彼此独立的 jobs，一个失败不阻止另一个运行。dispatch 必须显式选择 `both`、`cloudflare`、`vercel` 或 `external`。

Cloudflare direct deploy 优先读取：

- `RELAY_PROD_CLOUDFLARE_API_TOKEN`
- `RELAY_PROD_CLOUDFLARE_ACCOUNT_ID`

两项必须作为 production 原子凭据同时配置；workflow 不读取 dev Cloudflare 凭据作为回退。

可选 repository variables：

- `RELAY_PROD_CF_WORKER_NAME`：默认 `oneworks-relay-server`。
- `RELAY_PROD_CF_PAGES_PROJECT`：默认 `oneworks`。
- `RELAY_PROD_CF_ORIGIN`：默认 `https://cf.oneworks.cloud`。
- `RELAY_PROD_EXPECTED_SSO_PROVIDERS`：Cloudflare 与 Vercel production smoke 必须看到的 provider id，逗号分隔；留空表示该部署没有声明必须启用的 SSO provider，不应误写成平台默认值。

Vercel direct deploy 优先读取完整 pair：

- `RELAY_PROD_VERCEL_TOKEN`
- `RELAY_PROD_VERCEL_ORG_ID`

项目 ID 可通过 `RELAY_PROD_VERCEL_PROJECT_ID` secret 或 repository variable 明确配置；未配置时，workflow 用 production token / org 查询 Vercel API，并且只在精确 `vc.oneworks.cloud` 域名命中唯一项目时继续。token、org 和项目 ID 都须在 Actions 日志中 mask，不能写入 artifact。workflow 不读取 dev Vercel token、org 或 project 回退。

Vercel 使用固定 CLI `58.4.4`。`pull`、`build` 与 `pnpm prepare:vercel-output` 在 `apps/relay-server` 的 build link 中运行；随后脚本把已准备好的 `.vercel/output` 暂存搬运到仓库根目录的 deploy link，只有 `deploy --prebuilt` 从仓库根目录运行，以配合项目的 `rootDirectory=apps/relay-server`。deploy 的 runtime `--env` 写入 `ONEWORKS_RELAY_BUILD_SHA=$GITHUB_SHA`，随后 smoke 必须核对 `https://vc.oneworks.cloud/health` 的 version 和精确 build SHA。常规 dev slot 仍由 Vercel GitHub App 发布；此 CLI 路径只用于 manual production promotion。

`platform=external` 只用于将已验证的 immutable source handoff 给外部或 Node deployment。它要求以下完整原子 tuple：secret `RELAY_SERVER_DEPLOY_TOKEN`，以及 repository variables `RELAY_SERVER_DEPLOY_REPOSITORY` 和 `RELAY_SERVER_DEPLOY_WORKFLOW`。三项只在 external job 使用，缺少任一项即失败；不能用 Cloudflare、Vercel 或 dev 凭据补齐。该 handoff 不改变本地 Node package 的独立部署与回滚边界。

生产凭据必须是同一平台的完整原子 pair，不能拼接、跨用或回退到 dev。Cloudflare smoke 必须断言 v1 WebSocket、600 秒 heartbeat 和 Worker device origin；Vercel smoke 必须断言 v2 long-poll、50 秒 hold、250 秒 idle retry。Worker deploy 必须保留平台现有 vars / secrets，并写入当前 Git SHA 作为 `ONEWORKS_RELAY_BUILD_SHA`。部署后先有界等待 `/health.version` 与 `/health.buildSha` 指向目标 release，再只运行一次完整 smoke；provider、Admin asset、权限或 transport 断言失败时立即失败，不能把确定性功能错误当成部署传播继续重试。

回滚也按目标隔离：Node 重新部署该 Node 目标已验证的旧 immutable package / SHA；Cloudflare 将同一 slot 的 Worker 和 Pages 一起回滚到旧 immutable SHA；Vercel 将同一 project 回滚到旧 immutable SHA。不得删除 transport capability 以回到 legacy，也不得借用另一个平台的凭据、域名或 artifact。
