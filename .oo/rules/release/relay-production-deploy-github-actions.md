# Relay Production Deploy GitHub Actions

`.github/workflows/deploy-relay-server.yml` 只允许通过 `workflow_dispatch` 人工 promotion，并要求输入的 `source_sha` 与 workflow 从 `main` checkout 的不可变 SHA 完全一致。它优先使用 `RELAY_SERVER_DEPLOY_TOKEN`、`RELAY_SERVER_DEPLOY_REPOSITORY` 和 `RELAY_SERVER_DEPLOY_WORKFLOW` 触发外部发布；三项必须全部配置或全部缺省，部分配置直接失败。如果外部目标没有配置，workflow 会直接发布官方 Cloudflare production slot。

Cloudflare direct deploy 优先读取：

- `RELAY_PROD_CLOUDFLARE_API_TOKEN`
- `RELAY_PROD_CLOUDFLARE_ACCOUNT_ID`

迁移期间缺少独立 production 凭据时，workflow 可以回退到已有的 `RELAY_DEV_CLOUDFLARE_API_TOKEN` / `RELAY_DEV_CLOUDFLARE_ACCOUNT_ID`。回退 token 必须实际具备目标账号的 Workers Scripts 与 Cloudflare Pages 权限；生产凭据补齐后应让同名 production secrets 覆盖回退。

可选 repository variables：

- `RELAY_PROD_CF_WORKER_NAME`：默认 `oneworks-relay-server`。
- `RELAY_PROD_CF_PAGES_PROJECT`：默认 `oneworks`。
- `RELAY_PROD_CF_ORIGIN`：默认 `https://cf.oneworks.cloud`。
- `RELAY_PROD_ORIGIN`：所有 production 发布路径最终 smoke 的公网 origin；缺省时回退到 `RELAY_PROD_CF_ORIGIN`。
- `RELAY_PROD_EXPECTED_SSO_PROVIDERS`：production smoke 必须看到的 provider id，逗号分隔。

production / dev Cloudflare 凭据必须原子选择完整 pair；不能把 production token 与 dev account id 或反向组合。如果外部目标和 Cloudflare direct deploy 凭据都不可用，workflow 必须失败。Worker deploy 必须保留平台现有 vars / secrets，并写入当前 Git SHA 作为 `ONEWORKS_RELAY_BUILD_SHA`。部署后必须验证 `/health.version`、`/health.buildSha`、未授权 Admin API、`/login` 配置，以及 `/admin` 实际引用的 JS / CSS 资产。
