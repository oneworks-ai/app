---
description: Relay managed service, private deployment, Vercel, Cloudflare, domain, account, and secret handling guidance.
---

# Relay Deployment

This rule is the internal entry point for Relay deployment work. It covers `apps/relay-server`, `apps/relay-admin`, and `packages/plugins/relay`.

## Default Product Path

- Default to the OneWorks managed Relay service when a user only wants to use Relay.
- Before doing any private deployment work, ask whether the user wants a private deployment or the managed OneWorks service.
- If the user chooses private deployment, collect the target platform, the account or team to use, the desired public domains, DNS host, inbound support address plan, transactional mail provider, sending domain, and Reply-To before creating projects or changing account-level settings.
- Do not deploy Relay to a maintainer's personal account for a user. The deployment account must be provided by the user or be an approved OneWorks-owned service account.

## Official OneWorks Service Topology

These domains are the OneWorks-owned public topology. Keep this list in sync with deployment docs and do not copy private account slugs, platform account IDs, or personal mailbox destinations into committed files.

| Host                    | Role                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| `oneworks.cloud`        | Official website and docs canonical host, served by GitHub Pages. |
| `www.oneworks.cloud`    | Website alias or redirect to the apex domain.                     |
| `dev.cf.oneworks.cloud` | Cloudflare dev Relay/Admin service.                               |
| `cf.oneworks.cloud`     | Cloudflare production Relay/Admin service.                        |
| `dev.vc.oneworks.cloud` | Vercel dev Relay/Admin service.                                   |
| `vc.oneworks.cloud`     | Vercel production Relay/Admin service.                            |

For each Relay slot, set `ONEWORKS_RELAY_PUBLIC_URL` and `ONEWORKS_RELAY_ALLOW_ORIGIN` to the user-facing Admin origin for that slot. In the Cloudflare shape, the Worker origin should usually stay behind the Pages/custom-domain proxy; expose the Pages/custom domain as the public Admin/API/login origin.

Passkeys are bound to the browser origin and relying party id. For every official or private Relay slot, set `ONEWORKS_RELAY_PASSKEY_ORIGIN` and `ONEWORKS_RELAY_PASSKEY_RP_ID` only when the public origin cannot be inferred from `ONEWORKS_RELAY_PUBLIC_URL`; do not enroll production passkeys on a temporary platform domain and then move users to a custom domain.

Relay login method ordering is deployment configuration. Set `ONEWORKS_RELAY_DEFAULT_LOGIN_METHOD` to `password`, `passkey`, or `verification_code` for the first method shown on `/login`; browsers may remember the user's last selected method. Keep `ONEWORKS_RELAY_PASSKEY_EMAIL_VERIFICATION_REQUIRED` enabled unless a deployment intentionally allows new passkey accounts without email-code confirmation.

The official topology is not a template for user private deployments. Private deployments should use the user's own domains and generic examples such as `https://relay.example.com` in committed docs.

## Official Mail Topology

- `support@oneworks.cloud` and `hello@oneworks.cloud` receive mail through Cloudflare Email Routing and forward to verified destination mailboxes.
- Public docs, AGENTS, rules, handoffs, and changelogs must not name personal Gmail addresses, private mailboxes, or individual maintainer accounts as routing targets.
- Resend is only for transactional mail such as verification codes, invites, and system notifications. Do not use Resend as the support or hello inbound mailbox.
- Use `mail.oneworks.cloud` as the stable Resend sending domain for the official service. Add separate sending domains only when the mail provider plan, reputation strategy, and DNS ownership are explicitly confirmed.
- Put Resend DNS records on stable mail subdomains, not on Relay/Admin service hosts such as `cf.oneworks.cloud`, `dev.cf.oneworks.cloud`, `vc.oneworks.cloud`, or `dev.vc.oneworks.cloud`. This avoids CNAME/MX/TXT conflicts with web service hosts and keeps mail reputation scoped to mail domains.
- Transactional mail should use a role-address Reply-To such as `support@oneworks.cloud` or `hello@oneworks.cloud`, not a personal address.

## Privacy Boundary

- Do not write real personal account names, account IDs, project IDs, test credentials, tokens, OAuth secrets, database URLs, or temporary deployment URLs into committed docs, rules, AGENTS files, HANDOFF files, or changelog.
- Do not write private inbound mail forwarding destinations or individual maintainer mailboxes into committed docs, rules, AGENTS files, HANDOFF files, or changelog.
- Use placeholders such as `https://relay.example.com`, `https://<project>.vercel.app`, `https://<project>.pages.dev`, and `https://<worker>.<account-subdomain>.workers.dev`.
- Keep generated deployment secrets in the platform secret store or a local ignored scratch path only long enough to finish the setup. Do not copy them into repository files.
- When reporting a deployment result to the user, share only the public entry URLs and non-sensitive status. Avoid exposing platform account IDs unless the user explicitly asks.

## Private Deployment Flow

1. Confirm the user really wants private deployment instead of the managed OneWorks service.
2. Confirm platform and shape:
   - Vercel single project: Relay Server, Admin, `/login`, and `/api/*` on one origin.
   - Cloudflare split project: Relay Server on Workers + Durable Object, Admin on Pages with same-origin proxy functions.
   - Node single host: Relay Server with SQLite behind TLS/reverse proxy.
3. Confirm DNS and mail plan:
   - Production and dev domains are deployment configuration, not code constants.
   - Prefer custom domains for production.
   - Platform default domains are fine for tests, but keep examples generic in docs.
   - Confirm who controls DNS and which provider will host records.
   - Confirm whether inbound support or hello-style addresses are needed and where they route.
   - Confirm transactional mail provider, sending domain, DNS record ownership, and Reply-To.
   - For Resend or similar providers, prefer a stable mail subdomain such as `mail.example.com` and optional dev subdomain such as `mail.dev.example.com`, instead of attaching mail records to the Relay/Admin web host.
4. Generate long random values for `ONEWORKS_RELAY_ADMIN_TOKEN` and `ONEWORKS_RELAY_DEVICE_METADATA_SECRET`.
5. Set `ONEWORKS_RELAY_PUBLIC_URL` and `ONEWORKS_RELAY_ALLOW_ORIGIN` to the user-facing Admin origin.
6. Choose passkey registration policy: `invite_required` for gated deployments, `email_verified` for open verified-email onboarding, or `admin_created_only` for admin-provisioned accounts only.
7. Deploy, then verify health, Admin shell, unauthorized admin API behavior, owner login, passkey registration/login on the final public origin, and plugin device registration.
8. Update Relay plugin `servers[]` only after the target public origin is known.

## Configuration Source Of Truth

- Treat deployment URL, storage driver, mail provider, SSO clients, passkey origin, default login method, registration policy, and plugin `servers[]` as deployment configuration. Do not hard-code these values in TypeScript, committed JSON, screenshots, examples, or platform-specific output directories.
- The Relay Server public version must come from `apps/relay-server/package.json` package metadata. Do not introduce release-string constants for `/health`, config JSON, logs, Admin display, or deployment smoke checks. After every private or official deploy, compare `/health.version` with the package version that was deployed.
- Pick the final user-facing origin before configuring OAuth callbacks, passkeys, CORS, email links, or plugin server entries. Temporary platform domains are acceptable for tests, but do not enroll production passkeys or publish production plugin presets on a temporary domain that will later be replaced.
- Keep an operator-owned deployment matrix outside the repo for each private customer or self-hosted account: platform account/team, dev/prod domains, DNS host, storage backend, transactional mail domain, Reply-To, SSO app/client ids, callback URLs, and secret names. Repository docs should use placeholders only.
- Use platform secret stores for `ONEWORKS_RELAY_ADMIN_TOKEN`, `ONEWORKS_RELAY_DEVICE_METADATA_SECRET`, database URLs, Resend/API keys, OAuth client secrets, and Turnstile secrets. Local `.env` / scratch files are only for temporary operator setup and must stay ignored.
- When copying a deployment between Cloudflare and Vercel, re-evaluate storage and long-lived forwarding behavior instead of copying env blindly: Vercel requires Postgres for durable serverless state, Cloudflare uses Durable Object storage through the Worker adapter, and single-host Node usually uses SQLite.
- Treat health, login config, SSO providers, passkey registration, email code delivery, and plugin device registration as configuration smoke checks. A deployment that returns `ok` but exposes the wrong version, public URL, provider list, CORS origin, or login method is not fully configured.

## SSO / OAuth Provider Onboarding

- Provider-specific setup lessons are split by provider. Do not expand this file with detailed OAuth UI walkthroughs; read the narrow file that matches the provider being configured.
- Always read `.oo/rules/relay-deployment/sso-common.md` before creating or editing any SSO provider.
- For built-in GitHub login, continue with `.oo/rules/relay-deployment/sso-github.md`.
- For built-in Google login or Google managed provider setup, continue with `.oo/rules/relay-deployment/sso-google.md`.
- For custom OAuth/OIDC providers, continue with `.oo/rules/relay-deployment/sso-oidc.md`.
- If a new provider gets branded UI support, create a provider-specific rule file next to these and link it here instead of mixing its lessons into the common file.

## Production Admin Release

- For official production Admin / Relay releases, use `.oo/rules/relay-deployment/admin-release-sop.md`.
- Production Admin releases are manual promotions from a known `origin/main` SHA or release tag after dev slot verification.
- Treat login page, SSO, passkey, email-code, invite, device registration, session forwarding, or storage changes as Relay releases even when the visible diff looks like Admin UI.
- Production smoke checks must include health, provider list, unauthorized admin API behavior, login config, Admin shell assets, and the intended login methods.

## Vercel Notes

- Preferred private Vercel shape is the `apps/relay-server` single project.
- Official OneWorks Vercel slots use `dev.vc.oneworks.cloud` for dev and `vc.oneworks.cloud` for production. Private Vercel deployments should use the user's own Vercel project domain or custom domain.
- `pnpm build:vercel` builds `apps/relay-admin`, embeds Admin under `/admin`, and builds the serverless function.
- Vercel serverless must use the Postgres storage driver. Do not rely on local JSON, SQLite files, or process memory for durable cloud state.
- Required env: `ONEWORKS_RELAY_STORAGE_DRIVER=postgres`, `ONEWORKS_RELAY_POSTGRES_URL` or `DATABASE_URL`, `ONEWORKS_RELAY_ADMIN_TOKEN`, `ONEWORKS_RELAY_DEVICE_METADATA_SECRET`, `ONEWORKS_RELAY_PUBLIC_URL`, and `ONEWORKS_RELAY_ALLOW_ORIGIN`.
- Passkeys work on Vercel when `/login`, `/api/auth/passkey/*`, and `/admin` share the same final HTTPS origin. Set `ONEWORKS_RELAY_PASSKEY_ORIGIN` / `ONEWORKS_RELAY_PASSKEY_RP_ID` only if the inferred origin is wrong.
- SSO callbacks on Vercel should be registered against the same final Vercel project or custom domain used for `ONEWORKS_RELAY_PUBLIC_URL`; if a custom domain will replace the default `.vercel.app` domain, do that before production passkey enrollment and OAuth rollout.
- Local prebuilt CLI deploys should run `vercel build --prod`, `pnpm prepare:vercel-output`, then `vercel deploy --prebuilt --prod`.
- The Vercel project domain decides the default `.vercel.app` origin. Users can add their own custom domain and should then set public URL and CORS to that custom origin.

## Cloudflare Notes

- Preferred private Cloudflare shape is split:
  - `apps/relay-server` as a Worker with Durable Object storage.
  - `apps/relay-admin` as Pages, proxying `/api/*`, `/login`, and `/login/complete` to the Worker.
- Official OneWorks Cloudflare slots use `dev.cf.oneworks.cloud` for dev and `cf.oneworks.cloud` for production. Private Cloudflare deployments should use the user's own Pages/custom domains and Worker names.
- Workers default domains use `https://<worker-name>.<account-subdomain>.workers.dev`.
- The `workers.dev` account subdomain is account-level. Changing it affects every Worker in that Cloudflare account.
- For short test/prod Worker URLs, choose a neutral account subdomain owned by the deployment account, then use short Worker names such as `dev` and `pro`.
- Pages default domains use `https://<pages-project>.pages.dev`. Create separate Pages projects for dev and prod slots when the user wants both reserved.
- The public Admin origin should usually be the Pages or custom domain; the Worker URL can remain an implementation detail behind the Pages proxy.
- Passkeys work on Cloudflare when the browser reaches the Pages/custom domain and the proxied Worker verifies that same origin. Keep `ONEWORKS_RELAY_PUBLIC_URL` pointed at the Pages/custom domain, not the hidden Worker URL.
- SSO provider consoles should register callback URLs on the Pages/custom domain as well. Do not register only the Worker URL unless users actually open `/login` on the Worker origin, because OAuth callback, cookies, and passkey ceremonies must agree on the user-facing origin.

## Smoke Checks

Run the checks that match the deployment shape:

```bash
curl -fsS https://<relay-origin>/health
curl -i https://<admin-origin>/admin
curl -i https://<admin-origin>/api/admin/users
```

Expected:

- `/health` returns `{"ok":true,...}`.
- `/admin` serves or redirects to the Admin shell.
- `/api/admin/users` returns `401` without an admin or session token.
- A newly created owner can log in through `/api/auth/password-login`.
- A Relay plugin configured with the final `servers[]` entry can open `/login`, complete callback, register a device, and heartbeat.
