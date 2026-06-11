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
```

The development server is a normal Vite React app with HMR. Open `/admin`, `/admin/users`, `/admin/profile`, `/admin/invites`, or `/admin/sso` on the Vite origin during UI work. In dev, `/api/*` proxies to `http://127.0.0.1:48888` by default; set `ONEWORKS_RELAY_ADMIN_DEV_PROXY_TARGET` when the relay server uses another origin. `/login` and `/login/complete` are generated locally by the Vite dev server from relay-server source; `/login` loads `src/login/main.tsx` with HMR, while relay-server shell/config changes trigger a full reload on the Vite origin. The production build must use Vite. `vite.config.ts` fixes the main output filenames to `admin.js`, `login.js`, and `admin.css`; shared hashed JS chunks are served from the same `/admin/assets/` directory.

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
