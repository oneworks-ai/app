# @oneworks/relay-server

Relay service for `@oneworks/plugin-relay`. Product users should normally use the managed OneWorks Relay service. Private deployment is available when an operator wants to run Relay in their own cloud account or on their own host.

```bash
npx @oneworks/relay-server --host 0.0.0.0 --port 8788 --admin-token change-me
```

Environment variables:

- `ONEWORKS_RELAY_HOST`: bind host, default `127.0.0.1`
- `ONEWORKS_RELAY_PORT`: bind port, default `8788`
- `ONEWORKS_RELAY_STORAGE_DRIVER`: storage driver, default `json`. Use `sqlite` for single-node Node deployments, `postgres` for Vercel or other serverless Node deployments, and `cloudflare-do` only through the Cloudflare Worker adapter.
- `ONEWORKS_RELAY_DATA_PATH`: JSON or SQLite data file path
- `ONEWORKS_RELAY_POSTGRES_URL` / `DATABASE_URL`: Postgres connection string for the `postgres` storage driver
- `ONEWORKS_RELAY_POSTGRES_POOL_MAX`: optional Postgres client pool size, default `3`
- `ONEWORKS_RELAY_ADMIN_TOKEN`: admin and initial pairing token
- `ONEWORKS_RELAY_DEVICE_METADATA_SECRET`: optional encryption secret for user-private device metadata; production should set a long random value
- `ONEWORKS_RELAY_ALLOW_ORIGIN`: CORS allow origin, default `*`
- `ONEWORKS_RELAY_PUBLIC_URL`: public base URL used for OAuth callback URLs
- `ONEWORKS_RELAY_DEVICE_ONLINE_TTL_SECONDS`: device online freshness window, default `60`
- `ONEWORKS_RELAY_LOG_LEVEL`: pino log level for relay trace logs, default `info`
- `ONEWORKS_RELAY_RATE_LIMIT_ENABLED`: set to `0`, `false`, `no`, or `off` to disable built-in sensitive-route rate limits
- `ONEWORKS_RELAY_RATE_LIMIT_AUTH_MAX` / `ONEWORKS_RELAY_RATE_LIMIT_AUTH_WINDOW_SECONDS`: OAuth start/callback limit, default `20` per `60` seconds
- `ONEWORKS_RELAY_RATE_LIMIT_DEVICE_REGISTER_MAX` / `ONEWORKS_RELAY_RATE_LIMIT_DEVICE_REGISTER_WINDOW_SECONDS`: device registration and invite redeem limit, default `20` per `60` seconds
- `ONEWORKS_RELAY_RATE_LIMIT_ADMIN_MUTATION_MAX` / `ONEWORKS_RELAY_RATE_LIMIT_ADMIN_MUTATION_WINDOW_SECONDS`: admin mutating API limit, default `60` per `60` seconds
- `ONEWORKS_RELAY_RATE_LIMIT_DEVICE_CLAIM_MAX` / `ONEWORKS_RELAY_RATE_LIMIT_DEVICE_CLAIM_WINDOW_SECONDS`: device session-job claim limit, default `120` per `60` seconds
- `ONEWORKS_RELAY_EMAIL_PROVIDER`: transactional email provider, `disabled` by default; set `resend` to enable Resend-backed verification code delivery
- `ONEWORKS_RELAY_EMAIL_FROM`: sender address for transactional email, required when `ONEWORKS_RELAY_EMAIL_PROVIDER=resend`
- `ONEWORKS_RELAY_EMAIL_LOGO_URL`: HTTPS PNG/JPEG logo used in transactional HTML emails. Defaults to `https://oneworks.cloud/pwa/pwa-icon-192.png`; set `off` or `none` to disable the image.
- `ONEWORKS_RELAY_RESEND_API_KEY`: Resend API key, required when `ONEWORKS_RELAY_EMAIL_PROVIDER=resend`
- `ONEWORKS_RELAY_EMAIL_TURNSTILE_MODE`: `auto`, `required`, or `off`; `auto` requires Turnstile when Resend is enabled or `NODE_ENV=production`
- `ONEWORKS_RELAY_TURNSTILE_SECRET_KEY`: Cloudflare Turnstile secret key for email send challenges
- `ONEWORKS_RELAY_TURNSTILE_VERIFY_URL`: optional Turnstile siteverify URL override for tests
- `ONEWORKS_RELAY_EMAIL_RISK_ENABLED`: set to `0`, `false`, `no`, or `off` to disable email send rate and budget checks; Turnstile and domain blocking remain explicit policy controls
- `ONEWORKS_RELAY_EMAIL_CODE_TTL_SECONDS`: verification code TTL, default `600`; repeat requests during the TTL reuse the active challenge and do not call the email provider again
- `ONEWORKS_RELAY_EMAIL_RESEND_COOLDOWN_SECONDS`: retry hint window for active challenges, default `60`
- `ONEWORKS_RELAY_EMAIL_RISK_EMAIL_MAX` / `ONEWORKS_RELAY_EMAIL_RISK_EMAIL_WINDOW_SECONDS`: per-email send limit, default `3` per `3600` seconds
- `ONEWORKS_RELAY_EMAIL_RISK_IP_MAX` / `ONEWORKS_RELAY_EMAIL_RISK_IP_WINDOW_SECONDS`: per-IP send limit, default `30` per `3600` seconds
- `ONEWORKS_RELAY_EMAIL_RISK_DOMAIN_MAX` / `ONEWORKS_RELAY_EMAIL_RISK_DOMAIN_WINDOW_SECONDS`: per-domain send limit, default `100` per `3600` seconds
- `ONEWORKS_RELAY_EMAIL_RISK_DAILY_BUDGET` / `ONEWORKS_RELAY_EMAIL_RISK_MONTHLY_BUDGET`: global email send circuit breakers, default `500` daily and `10000` monthly
- `ONEWORKS_RELAY_EMAIL_DOMAIN_ALLOWLIST` / `ONEWORKS_RELAY_EMAIL_DOMAIN_BLOCKLIST`: comma or whitespace separated email domain overrides. Allowlist only bypasses domain blocking; it does not bypass Turnstile, rate limits, or budgets.
- `ONEWORKS_RELAY_EMAIL_DISPOSABLE_BLOCKLIST_ENABLED`: set to `0`, `false`, `no`, or `off` to disable the built-in high-confidence disposable domain blocklist
- `ONEWORKS_RELAY_GITHUB_CLIENT_ID` / `ONEWORKS_RELAY_GITHUB_CLIENT_SECRET`: GitHub OAuth
- `ONEWORKS_RELAY_GOOGLE_CLIENT_ID` / `ONEWORKS_RELAY_GOOGLE_CLIENT_SECRET`: Google OAuth
- `ONEWORKS_RELAY_SSO_PROVIDERS`: JSON object or array for multiple custom OAuth/OIDC SSO providers
- `ONEWORKS_RELAY_SESSION_TTL_SECONDS`: login session lifetime

## Managed service and private deployment

The default deployment path is the managed OneWorks Relay service. The official website uses `oneworks.cloud` with `www.oneworks.cloud` as an alias or redirect. Official Relay/Admin service slots are `dev.cf.oneworks.cloud` and `cf.oneworks.cloud` on Cloudflare, plus `dev.vc.oneworks.cloud` and `vc.oneworks.cloud` on Vercel.

Official inbound addresses such as `support@oneworks.cloud` and `hello@oneworks.cloud` use Cloudflare Email Routing to verified destination mailboxes. Transactional mail such as verification codes, invitations, and system notifications should be sent from stable mail subdomains such as `mail.oneworks.cloud` and `mail.dev.oneworks.cloud`; do not attach transactional mail DNS records to Relay/Admin service hosts.

Before starting a private deployment, confirm that the user wants to self-host instead of using the managed OneWorks Relay service. Private deployments require the user's target platform account or team, their desired dev / production domains, DNS host, inbound mail strategy, transactional mail provider, sending domain, Reply-To, and their own secret storage. Do not use a maintainer's personal cloud account for a user deployment, and do not copy real account IDs, private mailbox destinations, tokens, database URLs, or test credentials into committed docs.

Use placeholder domains in examples:

- Vercel: `https://<project>.vercel.app` or a custom domain such as `https://relay.example.com`.
- Cloudflare Pages: `https://<pages-project>.pages.dev` or a custom domain.
- Cloudflare Workers: `https://<worker>.<account-subdomain>.workers.dev`. The `account-subdomain` is an account-level setting and changing it affects every Worker in that Cloudflare account.

## Google SSO

Google sign-in can be enabled in either of these ways:

- Built-in environment provider: set `ONEWORKS_RELAY_GOOGLE_CLIENT_ID` and `ONEWORKS_RELAY_GOOGLE_CLIENT_SECRET`.
- Managed provider: open `/admin`, choose the Google preset in the SSO provider form, then fill the Google Client ID and Client Secret.

For the built-in environment provider, add this Authorized redirect URI to the Google OAuth client:

```text
<ONEWORKS_RELAY_PUBLIC_URL or relay origin>/api/auth/oauth/google/callback
```

For a managed provider, use the Redirect URI shown in `/admin`. With the default Google preset id it is:

```text
<relay origin>/api/auth/oauth/google-sso/callback
```

The Google OAuth client must be a Web application client, and the redirect URI registered in Google Cloud must exactly match the URI sent by Relay.

## Admin

Admin APIs require `Authorization: Bearer <token>`. The token can be the deployment-level `ONEWORKS_RELAY_ADMIN_TOKEN` or a Relay login session token whose user role has admin capabilities (`owner` or `admin`). If the admin token is intentionally empty, admin endpoints remain open.

- `GET /api/admin/users`: list users with stable, redacted user records, including `deviceCount` and `maxDevices`.
- `POST /api/admin/users`: create a user. Emails are required and duplicate emails are rejected case-insensitively.
- `PATCH /api/admin/users`: update a user by `id` or `email`; supports `email`, `name`, `role`, `maxDevices`, and boolean `disabled`.
- `GET /api/admin/invites`: list invite records.
- `POST /api/admin/invites`: create an invite with `role` and `maxUses`; duplicate codes are rejected.
- `PATCH /api/admin/invites`: update or revoke an invite by `code`; set `revoked: true`.
- `DELETE /api/admin/invites?code=<code>`: delete an invite so that pairing code can no longer be used.
- `GET /api/admin/sso-providers`: list B-side managed SSO providers. `clientSecret` is always redacted.
- `GET /api/admin/sso-providers/<id>`: read one managed SSO provider with redacted `clientSecret`.
- `POST /api/admin/sso-providers`: create an OAuth/OIDC provider with `id`, `name`, `type`, endpoint URLs, `scope`, `enabled`, `clientId`, and `clientSecret`.
- `PATCH /api/admin/sso-providers/<id>`: update provider metadata or rotate `clientSecret`; omit `clientSecret` to keep the existing secret.
- `DELETE /api/admin/sso-providers/<id>`: delete a managed SSO provider.
- `POST /api/admin/security/tokens/rotate`: rotate a `session` token by token value or a `device` token by device id. `admin` token rotation is explicit but unsupported because it is environment-managed.
- `POST /api/admin/security/tokens/revoke`: revoke a `session` token by token value or user id, or revoke a `device` token by rotating it without returning the replacement token.
- `GET /api/relay/metrics`: read in-process relay metrics and recent trace metadata with the same admin authorization.

`GET /admin` serves the React admin client from `@oneworks/relay-admin` (`apps/relay-admin`). The server route only returns the HTML shell and static assets under `/admin/assets/*`; the React client is built by Vite, consumes the `/login` callback `relay_token`, verifies the session through `/api/auth/me`, and calls the admin APIs above only for `owner` or `admin` users.

`GET /login` serves the user-facing login page used by the Relay plugin. It accepts `redirect_uri`, `server_id`, `scope`, and optional `lang=zh-CN|en`; OAuth/OIDC success first returns to `/login/complete`, which stores recent account metadata in that browser and then redirects to the original callback with `relay_token` in the URL fragment. The same page also supports email + invite-code login through `POST /api/auth/invite-login`; successful invite login consumes one invite use and assigns the invite role to new users. When `lang` is omitted, the login page follows the browser `Accept-Language` header. Electron callbacks use `oneworks://relay/auth`; Web callbacks use the current plugin page URL.

`POST /api/auth/email-verification/send` accepts an `email`, optional `purpose` (`email-verification`, `invite`, or `login`), optional `locale` / `lang` (`zh-CN` or `en`), and optional `turnstileToken`. Login pages should pass their current page locale so verification emails match the visible UI language; when omitted, the server falls back to `Accept-Language` and then English. Before any provider call, Relay verifies Turnstile when required, evaluates domain policy, checks per-email / per-IP / per-domain limits, checks global daily and monthly budgets, and reuses an active code within its TTL instead of sending another email. Rejections use a generic response so callers cannot infer whether an account exists.

Admin client source lives in `apps/relay-admin`:

- `src/app/`: page shell and global styles.
- `src/features/dashboard/`: snapshot loading, status, stats, and page orchestration.
- `src/features/auth/`: Relay login callback token consumption, local session-token storage, and `/api/auth/me` client.
- `src/features/users/`: users API, form parsing, create form, table, and panel.
- `src/features/invites/`: invites API, form parsing, create form, table, and panel.
- `src/features/sso/`: SSO provider API, form parsing, create/edit forms, table, and panel.
- `src/shared/`: request helper, shared model types, roles, form utilities, and base UI.

Build the admin client before packaging or smoke-testing the server static route:

```bash
pnpm -C apps/relay-admin build
pnpm -C apps/relay-admin test
```

Run the local SSO end-to-end check without reaching GitHub, Google, or a public Relay:

```bash
pnpm -C apps/relay-server test:e2e:local-sso
```

This test starts a temporary mock OAuth/OIDC server on `127.0.0.1`, points Relay at that provider, follows `/login` through authorize/callback, verifies `/api/auth/me`, and registers a local device with the issued session token.

## Permissions

Relay authorization is capability based. Request handlers resolve the caller into a principal (`admin-token`, login `session`, or `device`) and then check centralized capabilities from `src/permissions/` before applying resource ownership rules. Unknown roles and unknown permissions are denied by default.

Default roles:

| Role     | Default capabilities                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `owner`  | All known admin and relay capabilities.                                                                                  |
| `admin`  | All known admin and relay capabilities.                                                                                  |
| `member` | Register owned devices, read owned devices/sessions/jobs, submit messages to owned sessions, and read owned job results. |
| `viewer` | Read owned devices/sessions/jobs and owned job results. Viewers cannot submit messages.                                  |

The admin token principal receives all known capabilities. Device tokens receive only device-scoped capabilities: heartbeat, self registration refresh, session snapshot publishing, session/job polling, and job status updates for the same device.

Capability names live in `src/permissions/capabilities.ts`; the role matrix lives in `src/permissions/roles.ts`; principal helpers live in `src/permissions/principals.ts`. Add new domains by defining a capability first, assigning it in the role matrix, and then using the shared permission helpers in the route or forwarding access helper. Do not add ad hoc role checks in routes.

Custom SSO example:

```bash
export ONEWORKS_RELAY_SSO_PROVIDERS='{
  "acme": {
    "name": "Acme SSO",
    "clientId": "acme-client",
    "clientSecret": "acme-secret",
    "authorizationUrl": "https://sso.example.com/oauth2/authorize",
    "tokenUrl": "https://sso.example.com/oauth2/token",
    "userInfoUrl": "https://sso.example.com/oauth2/userinfo",
    "scope": "openid email profile"
  },
  "okta": {
    "name": "Okta Workforce",
    "clientId": "okta-client",
    "clientSecret": "okta-secret",
    "authorizationUrl": "https://okta.example.com/oauth2/v1/authorize",
    "tokenUrl": "https://okta.example.com/oauth2/v1/token",
    "userInfoUrl": "https://okta.example.com/oauth2/v1/userinfo"
  }
}'
```

`ONEWORKS_RELAY_SSO_PROVIDERS` is still useful for bootstrapping static deployments. For B-side operations, create and manage additional providers from `/admin` or the `/api/admin/sso-providers` endpoints. Managed provider secrets are stored server-side and are never returned by list/detail responses.

This package is the reference service scaffold. It includes health checks, OAuth-backed login sessions, SSO login redirect handling, device registration, heartbeat status, basic users, invitation storage, and metadata-only session forwarding.

## Storage

For single-node production deployments, use the SQLite driver:

```bash
ONEWORKS_RELAY_STORAGE_DRIVER=sqlite
ONEWORKS_RELAY_DATA_PATH=/var/lib/oneworks-relay/relay.sqlite
```

The SQLite driver stores the relay metadata snapshot in a local SQLite database with WAL enabled and is intended for one relay-server process on one host. Persist `ONEWORKS_RELAY_DATA_PATH` on durable disk, back up the `.sqlite` file and its WAL sidecars, and keep the file writable by the service user. The JSON driver remains available for local development and very small single-process deployments:

```bash
ONEWORKS_RELAY_STORAGE_DRIVER=json
ONEWORKS_RELAY_DATA_PATH=/var/lib/oneworks-relay/relay.json
```

Avoid sharing the same JSON file across multiple running relay-server processes.

For Vercel or other serverless Node deployments, use the Postgres driver:

```bash
ONEWORKS_RELAY_STORAGE_DRIVER=postgres
ONEWORKS_RELAY_POSTGRES_URL=postgres://relay:secret@db.example.com:5432/relay
```

The Postgres driver stores the relay metadata snapshot in `relay_store_snapshots` and cloud forwarding payload/result bodies in `relay_forwarding_payloads`. Request handlers use a transaction and row lock around metadata mutations so cold starts and concurrent functions do not race on the JSON snapshot.

For Cloudflare Workers, do not select `cloudflare-do` from the Node CLI. Deploy the Worker adapter in this package; it binds all requests for one Relay instance to a Durable Object and stores metadata plus forwarding payload/result bodies in Durable Object storage.

Relay metadata storage must not record session content. The metadata snapshot may persist only trace/status/device/user/permission metadata such as `traceId`, `requestId`, status, byte sizes, timestamps, and error codes. It must not persist `message`, `content`, `result`, `lastMessage`, or `lastUserMessage` fields. Device names, capabilities, workspace folders, and plugin scopes are stored as encrypted device metadata; admin user records expose only device counts and max-device limits for other users. New device tokens are stored as hashes rather than plaintext. Forwarded request payloads and returned result bodies are stored separately from the metadata snapshot: in process memory for JSON/SQLite Node deployments, in Postgres for serverless Node, and in Durable Object storage for Cloudflare Workers.

## Serverless Deployment

Vercel:

- Project root: `apps/relay-server`.
- Build command: `pnpm build:vercel`; it builds `apps/relay-admin`, copies the Admin static assets into `apps/relay-server/public/admin`, then builds the Relay Server function.
- Local prebuilt CLI deploys should run `vercel build --prod`, then `pnpm prepare:vercel-output`, then `vercel deploy --prebuilt --prod`. The prepare step copies the Postgres runtime package into the Vercel function output for pnpm workspace deployments.
- `vercel.json` serves `/admin` and `/admin/*` as the Admin SPA on the same origin, and rewrites `/api/*`, `/login`, `/login/complete`, and `/health` to `api/relay.ts`.
- Required env: `ONEWORKS_RELAY_STORAGE_DRIVER=postgres`, `ONEWORKS_RELAY_POSTGRES_URL` or `DATABASE_URL`, `ONEWORKS_RELAY_ADMIN_TOKEN`, `ONEWORKS_RELAY_DEVICE_METADATA_SECRET`, `ONEWORKS_RELAY_PUBLIC_URL`, and a restricted `ONEWORKS_RELAY_ALLOW_ORIGIN`.
- The Vercel deployment is one project and one domain: Relay Admin is available at `/admin`, while the server APIs and login flow share the same origin.
- Domain choice is deployment configuration. The default `.vercel.app` domain follows the Vercel project name, such as `https://<project>.vercel.app`. For a custom domain, add the domain to the Vercel project and set both `ONEWORKS_RELAY_PUBLIC_URL` and `ONEWORKS_RELAY_ALLOW_ORIGIN` to that origin.
- Vercel does not make local JSON / SQLite files durable for serverless functions. Use the Postgres driver and a managed Postgres database owned by the deployment account.

Cloudflare Workers:

- Project root: `apps/relay-server`.
- Config: `wrangler.jsonc`.
- Storage: `RELAY_OBJECT` Durable Object binding, class `RelayDurableObject`.
- Required secrets/env: `ONEWORKS_RELAY_ADMIN_TOKEN`, `ONEWORKS_RELAY_DEVICE_METADATA_SECRET`, `ONEWORKS_RELAY_PUBLIC_URL`, and a restricted `ONEWORKS_RELAY_ALLOW_ORIGIN`.
- Optional env: `ONEWORKS_RELAY_INSTANCE_ID` to choose a Durable Object instance name; default is `main`.
- The Worker also disables embedded `/admin`; deploy `apps/relay-admin` on Cloudflare Pages and proxy `/api/*`, `/login`, and `/login/complete` to this Relay Worker.
- Workers default URLs are `https://<worker-name>.<account-subdomain>.workers.dev`. Choose Worker names such as `dev` and `pro` only after the user confirms the account subdomain. Do not change a Cloudflare account-level workers.dev subdomain without making the account-wide impact explicit.
- For the Admin origin, prefer a Pages or custom domain and hide the Worker URL behind the Pages proxy when possible.

OAuth env providers, managed SSO providers, sessions, devices, invites, and forwarding jobs use the same API surface across Node, Vercel, and Cloudflare. In serverless modes, in-process metrics and rate-limit buckets are still runtime-local; keep platform/CDN limits in front of sensitive endpoints.

Minimum post-deploy checks:

```bash
curl -fsS https://<relay-origin>/health
curl -i https://<admin-origin>/admin
curl -i https://<admin-origin>/api/admin/users
```

`/health` should return `ok`, `/admin` should serve or redirect to the Admin shell, and `/api/admin/users` should return `401` without credentials. Create an owner user through the admin API, verify password login, then configure the Relay plugin `servers[]` entry to the final user-facing origin.

## Observability

Relay logs use pino JSON lines and are for delivery, audit, and success-rate visibility only. Log records include events such as job submitted, job claimed, job status, result consumed, payload expired, device registered, heartbeat, session snapshot updates, rate-limit blocks, and token rotation/revocation decisions. Fields are limited to metadata such as `traceId`, `requestId`, status, payload/result sizes, timestamps, stable error codes, device/session/user IDs, job IDs, actor/action/resource, permission names, IP, user agent, and capability keys. The logger redacts request/response bodies, session messages, bearer tokens, device tokens, admin tokens, OAuth secrets, and other `token` / `secret` / `password` fields.

`GET /api/relay/metrics` returns JSON metrics protected by the admin token:

```bash
curl -H "Authorization: Bearer $ONEWORKS_RELAY_ADMIN_TOKEN" \
  https://oneworks.example.com/api/relay/metrics
```

The response is process-local and resets when the relay-server process restarts. It includes:

- `forwarding.counters.submitted / claimed / completed / failed / expired / cancelled`.
- `forwarding.rates.delivery`: `claimed / submitted`, useful for arrival rate.
- `forwarding.rates.success`: `completed / submitted`, useful for end-to-end success rate.
- `devices.items[]`: per-device heartbeat counts, last heartbeat timestamp, last status, and forwarding counters.
- `traces.recent[]`: recent trace metadata with `requestId`, `traceId`, `deviceId`, `userId`, `sessionId`, and `jobId`.

`failed` includes expired payloads, while `expired` is also exposed separately so operators can distinguish relay process restarts or in-memory payload loss from explicit device failures. Metrics and trace snapshots never include prompt text, result text, payload objects, bearer tokens, device tokens, admin tokens, or OAuth secrets.

## Production deployment

Run the service behind TLS and a reverse proxy. Set long random values for `ONEWORKS_RELAY_ADMIN_TOKEN` and `ONEWORKS_RELAY_DEVICE_METADATA_SECRET`, store OAuth client secrets outside source control, and restrict `ONEWORKS_RELAY_ALLOW_ORIGIN` to the web app origin instead of using `*`.

Built-in rate limits are enabled by default for OAuth start/callback, invite redeem, email verification sends, device registration, admin mutating APIs, and device session-job claims. A blocked request returns `429` with `Retry-After` and `X-RateLimit-*` headers. Keep nginx, load balancer, or CDN limits in front of the service as the first line of defense, especially for `/api/auth/*`, `/api/relay/devices/register`, `/api/relay/devices/<deviceId>/session-jobs`, `/api/relay/metrics`, and `/api/admin/*`.

Token boundaries:

- Admin token: `ONEWORKS_RELAY_ADMIN_TOKEN` is a process secret. Rotate it by changing the environment value and restarting all relay-server processes. The admin security endpoint reports this boundary instead of storing an alternate admin token.
- Session token: issued after OAuth / SSO / invite login and stored in relay metadata. Admins can revoke a session token, revoke all sessions for a user id, or rotate a specific session token through `/api/admin/security/tokens/*`.
- Device token: issued after pairing and returned once to the registering device. New device tokens are stored as hashes. Admins can rotate a device token and return the replacement, or revoke it by rotating without returning the replacement token.

Audit events are emitted through the same pino logger as relay trace events with event name `relay.audit`. Audit records contain only `actor`, `action`, `resource`, `status`, `ip`, `userAgent`, and `requestId`; they do not include request bodies, session content, OAuth codes, bearer tokens, admin tokens, device tokens, or payload/result data.

Docker example:

```bash
docker run -d --name oneworks-relay \
  --restart unless-stopped \
  -p 127.0.0.1:8788:8788 \
  -v oneworks-relay-data:/data \
  -e ONEWORKS_RELAY_HOST=0.0.0.0 \
  -e ONEWORKS_RELAY_PORT=8788 \
  -e ONEWORKS_RELAY_STORAGE_DRIVER=sqlite \
  -e ONEWORKS_RELAY_DATA_PATH=/data/relay.sqlite \
  -e ONEWORKS_RELAY_ADMIN_TOKEN="$(openssl rand -hex 32)" \
  -e ONEWORKS_RELAY_DEVICE_METADATA_SECRET="$(openssl rand -hex 32)" \
  -e ONEWORKS_RELAY_PUBLIC_URL=https://oneworks.example.com \
  -e ONEWORKS_RELAY_ALLOW_ORIGIN=https://oneworks.example.com \
  node:22-bookworm-slim \
  sh -lc "npx --yes @oneworks/relay-server@3.4.0-rc --host 0.0.0.0 --port 8788"
```

Systemd example after installing the package globally on the host:

```ini
[Unit]
Description=OneWorks Relay Server
After=network-online.target
Wants=network-online.target

[Service]
User=oneworks-relay
Group=oneworks-relay
EnvironmentFile=/etc/oneworks/relay.env
ExecStart=/usr/local/bin/oneworks-relay-server --host 127.0.0.1 --port 8788
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/oneworks-relay

[Install]
WantedBy=multi-user.target
```

Example `/etc/oneworks/relay.env`:

```dotenv
ONEWORKS_RELAY_STORAGE_DRIVER=sqlite
ONEWORKS_RELAY_DATA_PATH=/var/lib/oneworks-relay/relay.sqlite
ONEWORKS_RELAY_ADMIN_TOKEN=replace-with-random-secret
ONEWORKS_RELAY_DEVICE_METADATA_SECRET=replace-with-random-secret
ONEWORKS_RELAY_PUBLIC_URL=https://oneworks.example.com
ONEWORKS_RELAY_ALLOW_ORIGIN=https://oneworks.example.com
```

Nginx/TLS example:

```nginx
limit_req_zone $binary_remote_addr zone=oneworks_relay:10m rate=10r/s;

server {
  listen 443 ssl http2;
  server_name relay.example.com;

  ssl_certificate /etc/letsencrypt/live/relay.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

  location / {
    limit_req zone=oneworks_relay burst=30 nodelay;
    proxy_pass http://127.0.0.1:8788;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    client_max_body_size 1m;
  }
}
```

Built-in rate limits are intentionally small in scope and in-memory per relay-server process. Keep edge rate limiting at nginx, a load balancer, or a CDN for distributed deployments and adjust the `ONEWORKS_RELAY_RATE_LIMIT_*` values to match expected traffic.
