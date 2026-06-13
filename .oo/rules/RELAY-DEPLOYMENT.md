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

| Host                    | Role                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `oneworks.cloud`        | Official website, served by GitHub Pages custom domain for `https://oneworks-ai.github.io/`. |
| `www.oneworks.cloud`    | Website alias or redirect to the apex domain.                                                |
| `dev.cf.oneworks.cloud` | Cloudflare dev Relay/Admin service.                                                          |
| `cf.oneworks.cloud`     | Cloudflare production Relay/Admin service.                                                   |
| `dev.vc.oneworks.cloud` | Vercel dev Relay/Admin service.                                                              |
| `vc.oneworks.cloud`     | Vercel production Relay/Admin service.                                                       |

For each Relay slot, set `ONEWORKS_RELAY_PUBLIC_URL` and `ONEWORKS_RELAY_ALLOW_ORIGIN` to the user-facing Admin origin for that slot. In the Cloudflare shape, the Worker origin should usually stay behind the Pages/custom-domain proxy; expose the Pages/custom domain as the public Admin/API/login origin.

The official topology is not a template for user private deployments. Private deployments should use the user's own domains and generic examples such as `https://relay.example.com` in committed docs.

## Official Mail Topology

- `support@oneworks.cloud` and `hello@oneworks.cloud` receive mail through Cloudflare Email Routing and forward to verified destination mailboxes.
- Public docs, AGENTS, rules, handoffs, and changelogs must not name personal Gmail addresses, private mailboxes, or individual maintainer accounts as routing targets.
- Resend is only for transactional mail such as verification codes, invites, and system notifications. Do not use Resend as the support or hello inbound mailbox.
- Use stable Resend sending subdomains: `mail.oneworks.cloud` for production and `mail.dev.oneworks.cloud` for dev.
- Put Resend DNS records on those mail subdomains, not on Relay/Admin service hosts such as `cf.oneworks.cloud`, `dev.cf.oneworks.cloud`, `vc.oneworks.cloud`, or `dev.vc.oneworks.cloud`. This avoids CNAME/MX/TXT conflicts with web service hosts and keeps mail reputation scoped to stable mail domains.
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
6. Deploy, then verify health, Admin shell, unauthorized admin API behavior, owner login, and plugin device registration.
7. Update Relay plugin `servers[]` only after the target public origin is known.

## Vercel Notes

- Preferred private Vercel shape is the `apps/relay-server` single project.
- Official OneWorks Vercel slots use `dev.vc.oneworks.cloud` for dev and `vc.oneworks.cloud` for production. Private Vercel deployments should use the user's own Vercel project domain or custom domain.
- `pnpm build:vercel` builds `apps/relay-admin`, embeds Admin under `/admin`, and builds the serverless function.
- Vercel serverless must use the Postgres storage driver. Do not rely on local JSON, SQLite files, or process memory for durable cloud state.
- Required env: `ONEWORKS_RELAY_STORAGE_DRIVER=postgres`, `ONEWORKS_RELAY_POSTGRES_URL` or `DATABASE_URL`, `ONEWORKS_RELAY_ADMIN_TOKEN`, `ONEWORKS_RELAY_DEVICE_METADATA_SECRET`, `ONEWORKS_RELAY_PUBLIC_URL`, and `ONEWORKS_RELAY_ALLOW_ORIGIN`.
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
