# @oneworks/relay-admin

React + Vite admin client for the self-hosted OneWorks Relay server.

The page shell uses `@oneworks/route-layout`'s `AppShellFrame` so the admin surface shares the same host shell mechanics, workbench sidebar, mobile sidebar behavior, and route container chrome as the main client while keeping business panels in local feature modules. Routes are handled by React Router and served through the relay server's `/admin/*` history fallback.

The app is built as static assets and served by `@oneworks/relay-server` at:

- `GET /admin`
- `GET /admin/users`, `/admin/users/:userId`, `/admin/profile`, `/admin/invites`, `/admin/sso`
- `GET /admin/assets/admin.js`
- `GET /admin/assets/admin.css`

It manages Relay users, roles, disabled status, invitation codes, and SSO providers through the server's `/api/admin/*` endpoints. The admin UI consumes the Relay login callback token from `#relay_token`, stores that session token locally, verifies it with `/api/auth/me`, and only loads admin data for `owner` or `admin` users.

## Development

```bash
pnpm -C apps/relay-admin dev
pnpm -C apps/relay-admin test
pnpm -C apps/relay-admin typecheck
pnpm -C apps/relay-admin build
pnpm -C apps/relay-admin build:platform
```

The development server is a normal Vite React app with HMR. Open `/admin`, `/admin/users`, `/admin/profile`, `/admin/invites`, or `/admin/sso` on the Vite origin during UI work. In dev, `/api/*` proxies to `http://127.0.0.1:48888` by default; set `ONEWORKS_RELAY_ADMIN_DEV_PROXY_TARGET` when the relay server uses another origin. `/login` and `/login/complete` are generated locally by the Vite dev server from relay-server source; `/login` loads `src/login/main.tsx` with HMR, while relay-server shell/config changes trigger a full reload on the Vite origin. The production build must use Vite. `vite.config.ts` fixes the main output filenames to `admin.js`, `login.js`, and `admin.css`; shared hashed JS chunks are served from the same `/admin/assets/` directory.

## Standalone Pages

The recommended Vercel deployment is the single-project Relay Server build from `apps/relay-server`: `pnpm build:vercel` builds this Admin app and serves it at the same origin under `/admin`. For product users, prefer the managed OneWorks Relay service unless they explicitly choose private deployment.

The managed OneWorks service uses the official Relay/Admin slots `dev.cf.oneworks.cloud`, `cf.oneworks.cloud`, `dev.vc.oneworks.cloud`, and `vc.oneworks.cloud`. Inbound support addresses such as `support@oneworks.cloud` and `hello@oneworks.cloud` are role addresses; do not document private forwarding destinations. Transactional mail belongs on stable mail subdomains such as `mail.oneworks.cloud` and `mail.dev.oneworks.cloud`, not on Admin or Relay web hosts.

Relay Admin can also run as a standalone static Pages/Vercel app while the Relay Server remains a separate persistent upstream. This mode keeps the browser on one public origin and proxies the Relay routes that need server behavior:

- `/api/*`
- `/health`
- `/login`
- `/login/complete`

Build the platform output with:

```bash
pnpm -C apps/relay-admin build:platform
```

The platform build writes:

- `dist/admin/index.html`: React Router history shell for `/admin/*`.
- `dist/admin/assets/*`: `admin.js`, `login.js`, CSS, chunks, and favicons.
- `dist/_redirects`: Cloudflare Pages SPA fallback rules.

### Standalone Vercel

Use `apps/relay-admin` as the Vercel project root. `vercel.json` runs `pnpm build:platform`, serves `dist`, rewrites `/admin/*` to the static shell, and sends `/api/*`, `/login`, and `/login/complete` through `api/proxy.ts`.

Use this mode only for private deployments where the user already has a separate Relay Server origin. In Vercel-only private deployments, prefer the single-project `apps/relay-server` shape so Admin and API share one domain.

Set one of these environment variables in Vercel:

```bash
ONEWORKS_RELAY_ADMIN_PROXY_TARGET=https://relay.example.com
```

### Cloudflare Pages

Use `apps/relay-admin` as the Pages project root. Set the build command to `pnpm build:platform` and the output directory to `dist`. `functions/health.ts`, `functions/api/[[path]].ts`, `functions/login.ts`, and `functions/login/complete.ts` proxy the same Relay routes through Cloudflare Pages Functions.

For Cloudflare private deployments, pair this Pages project with the `apps/relay-server` Worker + Durable Object deployment. The Pages domain, Worker name, Cloudflare account subdomain, DNS host, inbound mail plan, transactional mail sending domain, and Reply-To belong to the user's deployment account and domain plan; keep committed docs on placeholder domains.

Set one of these environment variables in Cloudflare Pages:

```bash
ONEWORKS_RELAY_ADMIN_PROXY_TARGET=https://relay.example.com
```

For SSO and password-login redirects to stay on the Admin domain, configure the upstream Relay Server with `ONEWORKS_RELAY_PUBLIC_URL` set to the Vercel or Cloudflare custom domain, for example `https://relay-admin.example.com`.

## Source Layout

- `src/app/`: React Router shell, shared app frame wiring, route header actions, and global app styles.
- `src/features/dashboard/`: snapshot loading, route page orchestration, stats, and status UI.
- `src/features/auth/`: Relay login callback token consumption, local session-token storage, and `/api/auth/me` client.
- `src/features/profile/`: current-account profile page for the footer account entry.
- `src/features/users/`: user API, form parsing, create form, table, and panel composition.
- `src/features/invites/`: invite API, form parsing, create form, table, and panel composition.
- `src/features/sso/`: SSO provider API, form parsing, create/edit forms, table, and panel composition.
- `src/shared/`: request helper, shared model types, role constants, small form utilities, and base UI.
- `__tests__/`: focused admin client unit tests.

Keep new admin areas in their own `src/features/<area>/` directory. The top-level `AdminApp` should remain a thin shell, and shared code should move to `src/shared/` only when at least two features need it.

SSO provider list/detail responses only include a redacted `clientSecret`. The edit form leaves the secret unchanged when the secret field is empty and rotates it only when a new value is submitted.

The SSO create form includes a Google preset. Selecting it fills the Google OAuth/OIDC endpoints and scope, keeps the secret field empty for the operator to paste locally, and shows the exact Redirect URI that must be registered on the Google OAuth Web application client.

## Current Handoff

The shared layout and session-auth migration notes live in [HANDOFF.md](./HANDOFF.md). Read it before continuing work on the Admin shell, sidebar quick links, route header sizing, session login flow, or `@oneworks/route-layout` extraction.
