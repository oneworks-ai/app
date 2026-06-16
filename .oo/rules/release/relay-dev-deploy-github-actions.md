# Relay Dev Deploy GitHub Actions

`.github/workflows/deploy-relay-dev.yml` deploys the official Relay dev slots when Relay-related paths change on `main`. It also supports manual dispatch with `cloudflare`, `vercel`, or `both`.

If repository deploy secrets are missing, the matching job emits a notice and skips deployment. This keeps `main` green while credentials are being installed; after secrets exist, the same workflow performs the deployment and smoke checks.

## Cloudflare

Required repository secrets:

- `RELAY_DEV_CLOUDFLARE_API_TOKEN`
- `RELAY_DEV_CLOUDFLARE_ACCOUNT_ID`

Optional repository variables:

- `RELAY_DEV_CF_WORKER_NAME`: defaults to `oneworks-relay-dev`.
- `RELAY_DEV_CF_PAGES_PROJECT`: defaults to `oneworks-dev`.
- `RELAY_DEV_CF_ORIGIN`: defaults to `https://dev.cf.oneworks.cloud`.

The Cloudflare Pages Admin project must have `ONEWORKS_RELAY_ADMIN_PROXY_TARGET` configured to the matching Worker origin. Do not point it at the same Pages custom domain, or `/api/*`, `/login`, and `/login/complete` can proxy back to themselves.

## Vercel

Required repository secrets:

- `RELAY_DEV_VERCEL_TOKEN`
- `RELAY_DEV_VERCEL_ORG_ID`
- `RELAY_DEV_VERCEL_PROJECT_ID`

Optional repository variables:

- `RELAY_DEV_VC_ORIGIN`: defaults to `https://dev.vc.oneworks.cloud`.

The official Vercel dev slot uses `apps/relay-server` as a single project: Admin, API, and login are same-origin, and `ONEWORKS_RELAY_PUBLIC_URL` should point to the final dev Vercel custom domain.

## Shared Smoke Config

Optional repository variable:

- `RELAY_DEV_EXPECTED_SSO_PROVIDERS`: comma-separated provider ids, for example `github,google-sso`.

When `RELAY_DEV_EXPECTED_SSO_PROVIDERS` is set, the smoke check requires `/api/auth/providers` and `/login` config to include those provider ids.

## Platform Runtime Env

Runtime env still belongs in Cloudflare / Vercel platform secret stores, not in committed docs. For each dev slot, confirm at least:

- `ONEWORKS_RELAY_STORAGE_DRIVER`
- `ONEWORKS_RELAY_ADMIN_TOKEN`
- `ONEWORKS_RELAY_DEVICE_METADATA_SECRET`
- `ONEWORKS_RELAY_PUBLIC_URL`
- `ONEWORKS_RELAY_ALLOW_ORIGIN`
- SSO provider secrets
- mail provider secrets
- passkey, invite, and default login method settings

## Smoke Checks

After deploy, the workflow checks:

- `/health` returns `ok=true`.
- `/api/auth/providers` contains expected SSO providers when configured.
- `/api/admin/users` returns `401` without authentication.
- `/login` injects Relay login config and contains expected SSO provider ids when configured.
