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

For built-in SSO providers, set dedicated platform secrets. For GitHub dev login, use `ONEWORKS_RELAY_GITHUB_CLIENT_ID` and `ONEWORKS_RELAY_GITHUB_CLIENT_SECRET` on both the Cloudflare Worker and the Vercel project. Remove any stale `ONEWORKS_RELAY_SSO_PROVIDERS` secret that contains a reserved built-in id such as `github`, because it will make `/health` and other routes fail during startup.

### Reading And Updating Platform Env

Use platform CLIs to list variable names and confirm the target project / Worker. Do not paste secret values into shell history, PRs, logs, or committed scratch files.

Vercel:

```bash
cd apps/relay-server
pnpm dlx vercel@<version> env ls production --token "$RELAY_DEV_VERCEL_TOKEN"
pnpm dlx vercel@<version> env remove ONEWORKS_RELAY_SSO_PROVIDERS production --token "$RELAY_DEV_VERCEL_TOKEN"
pnpm dlx vercel@<version> env add ONEWORKS_RELAY_GITHUB_CLIENT_ID production --token "$RELAY_DEV_VERCEL_TOKEN" < /path/to/ignored-client-id.txt
pnpm dlx vercel@<version> env add ONEWORKS_RELAY_GITHUB_CLIENT_SECRET production --token "$RELAY_DEV_VERCEL_TOKEN" < /path/to/ignored-client-secret.txt
```

- The official Vercel dev slot deploys with `vercel build --prod` and `vercel deploy --prebuilt --prod`, so inspect and update the Vercel `production` environment for that dev project, not `development` or `preview`.
- `vercel env ls` confirms names and target environment, not secret values. Use it to prove stale keys are gone.
- `vercel env pull --environment=production <file>` writes secrets to disk; use an ignored scratch file only when necessary, and delete it after the check.
- `vercel pull` writes `.vercel/project.json` and `.vercel/.env.*.local`. Do not commit `.vercel/`; avoid changing the repository's deployment binding unless the PR is explicitly about Vercel project setup.
- Updating a Vercel env var does not mutate an already deployed serverless function. Run the deploy workflow or a new production deployment before checking `dev.vc.oneworks.cloud`.

Cloudflare Worker:

```bash
pnpm dlx wrangler@<version> secret list \
  --config apps/relay-server/wrangler.jsonc \
  --name "<worker-name>"
pnpm dlx wrangler@<version> secret delete ONEWORKS_RELAY_SSO_PROVIDERS \
  --config apps/relay-server/wrangler.jsonc \
  --name "<worker-name>"
pnpm dlx wrangler@<version> secret put ONEWORKS_RELAY_GITHUB_CLIENT_ID \
  --config apps/relay-server/wrangler.jsonc \
  --name "<worker-name>"
pnpm dlx wrangler@<version> secret put ONEWORKS_RELAY_GITHUB_CLIENT_SECRET \
  --config apps/relay-server/wrangler.jsonc \
  --name "<worker-name>"
```

- Use the same Worker name that the workflow deploys with `--name "$CF_WORKER_NAME"`; otherwise `wrangler secret list` may inspect the default `name` in `wrangler.jsonc` instead of the live dev Worker.
- Wrangler secret values are hidden. Trust only the key list and smoke checks, not local memory of what was typed.
- `wrangler secret put` and `wrangler secret delete` can create a new Worker version / deployment immediately. Still run or monitor the normal deploy workflow so code, Durable Object config, and Pages proxy are from the intended commit.
- `wrangler secret delete` can prompt for confirmation; in automation, use an approved non-interactive flag only after confirming the exact Worker name. Always re-run `secret list` and verify the stale key is absent.
- Wrangler config is the Worker source of truth for non-secret `vars`; dashboard changes to variables can be overwritten by the next deploy unless the config intentionally keeps dashboard vars. Secrets are not removed by ordinary deploys and must be deleted explicitly.

Cloudflare Pages:

```bash
pnpm dlx wrangler@<version> pages secret list --project-name "<pages-project>"
pnpm dlx wrangler@<version> pages secret delete <KEY> --project-name "<pages-project>"
pnpm dlx wrangler@<version> pages secret put <KEY> --project-name "<pages-project>"
```

- The official Cloudflare Admin Pages project normally only needs proxy/public-origin configuration; Relay runtime SSO secrets belong on the Worker unless the Pages Function itself reads them.
- Pages and Workers have separate env stores. Fixing the Worker does not change Pages proxy env, and fixing Pages does not change Worker runtime env.
- Pages project names and Worker names are independent. Check both `RELAY_DEV_CF_PAGES_PROJECT` and `RELAY_DEV_CF_WORKER_NAME` before changing Cloudflare env.

## Smoke Checks

After deploy, the workflow checks:

- `/health` returns `ok=true`.
- `/api/auth/providers` contains expected SSO providers when configured.
- `/api/admin/users` returns `401` without authentication.
- `/login` injects Relay login config and contains expected SSO provider ids when configured.
