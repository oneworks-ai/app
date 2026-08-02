# Relay Production Deploy GitHub Actions

`.github/workflows/deploy-relay-server.yml` 只允许通过 `workflow_dispatch` 人工 promotion，并要求输入的 `source_sha` 与 workflow 从 `main` checkout 的不可变 SHA 完全一致。它优先使用 `RELAY_SERVER_DEPLOY_TOKEN`、`RELAY_SERVER_DEPLOY_REPOSITORY` 和 `RELAY_SERVER_DEPLOY_WORKFLOW` 触发外部发布；三项必须全部配置或全部缺省，部分配置直接失败。如果外部目标没有配置，workflow 会直接发布官方 Cloudflare production slot 和 Vercel 单项目 Relay/Admin。

Cloudflare direct deploy 优先读取：

- `RELAY_PROD_CLOUDFLARE_API_TOKEN`
- `RELAY_PROD_CLOUDFLARE_ACCOUNT_ID`

迁移期间缺少独立 production 凭据时，workflow 可以回退到已有的 `RELAY_DEV_CLOUDFLARE_API_TOKEN` / `RELAY_DEV_CLOUDFLARE_ACCOUNT_ID`。回退 token 必须实际具备目标账号的 Workers Scripts 与 Cloudflare Pages 权限；生产凭据补齐后应让同名 production secrets 覆盖回退。

可选 repository variables：

- `RELAY_PROD_CF_WORKER_NAME`：默认 `oneworks-relay-server`。
- `RELAY_PROD_CF_PAGES_PROJECT`：默认 `oneworks`。
- `RELAY_PROD_CF_ORIGIN`：默认 `https://cf.oneworks.cloud`。
- `RELAY_PROD_ORIGIN`：Cloudflare direct 或 external production 路径最终 smoke 的公网 origin；缺省时回退到 `RELAY_PROD_CF_ORIGIN`。Vercel direct deploy 单独使用 `RELAY_PROD_VC_ORIGIN`，缺省为 `https://vc.oneworks.cloud`。
- `RELAY_PROD_EXPECTED_SSO_PROVIDERS`：production smoke 必须看到的 provider id，逗号分隔。

Vercel direct deploy 优先读取完整 pair：

- `RELAY_PROD_VERCEL_TOKEN`
- `RELAY_PROD_VERCEL_ORG_ID`

迁移期间 production pair 两项都缺省时，才允许回退到完整的 `RELAY_DEV_VERCEL_TOKEN` / `RELAY_DEV_VERCEL_ORG_ID`，并可使用同一 pair 的 `RELAY_DEV_VERCEL_PROJECT_ID`；不能跨 production / dev 拼接 token、org 或 project。项目 ID 可通过 `RELAY_PROD_VERCEL_PROJECT_ID` secret 或 repository variable 明确配置；未配置时，workflow 用当前选定 token / org 查询 Vercel API，并且只在精确 `vc.oneworks.cloud` 域名命中唯一项目时继续。token、org 和项目 ID 都须在 Actions 日志中 mask，不能写入 artifact。

Vercel 使用固定 CLI `58.4.4`。由于项目的 Vercel `rootDirectory` 是 `apps/relay-server`，CLI 的 `pull`、`build`、`deploy --prebuilt` 从仓库根目录运行；`pnpm prepare:vercel-output` 仍在 Relay package 中运行，并通过临时 `VERCEL_OUTPUT_DIR` 处理根目录 build output。deploy 的 runtime `--env` 写入 `ONEWORKS_RELAY_BUILD_SHA=$GITHUB_SHA`，随后 smoke 必须核对 `https://vc.oneworks.cloud/health` 的 version 和精确 build SHA。常规 dev slot 仍由 Vercel GitHub App 发布；此 CLI 路径只用于 manual production promotion。

production / dev Cloudflare 凭据必须原子选择完整 pair；不能把 production token 与 dev account id 或反向组合。如果外部目标和 Cloudflare direct deploy 凭据都不可用，workflow 必须失败。Worker deploy 必须保留平台现有 vars / secrets，并写入当前 Git SHA 作为 `ONEWORKS_RELAY_BUILD_SHA`。部署后必须验证 `/health.version`、`/health.buildSha`、未授权 Admin API、`/login` 配置，以及 `/admin` 实际引用的 JS / CSS 资产。
