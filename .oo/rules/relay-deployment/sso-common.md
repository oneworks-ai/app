---
description: Common Relay SSO/OAuth setup rules shared by GitHub, Google, and custom OIDC providers.
---

# Relay SSO Common Setup

Read this before any provider-specific SSO work. Then continue to the provider file that matches the task:

- GitHub: `.oo/rules/relay-deployment/sso-github.md`
- Google: `.oo/rules/relay-deployment/sso-google.md`
- Custom OAuth/OIDC: `.oo/rules/relay-deployment/sso-oidc.md`

## Origin And Callback Planning

- Treat SSO setup as deployment work, not a UI-only change.
- Before creating or editing OAuth clients, confirm every public origin the user wants active: local dev, dev cloud, production cloud, and custom domains.
- `ONEWORKS_RELAY_PUBLIC_URL` determines Relay callback URLs. In split deployments, set it to the user-facing Admin/API/login origin, not a hidden Worker/function origin.
- Browser login, `/login/complete`, API callbacks, cookies, and passkeys should all resolve against the same final HTTPS origin.
- If the provider supports multiple callback URLs, add every active final origin explicitly. If callback slots are limited or environments should be isolated, create separate OAuth clients/apps for dev and production.
- Local validation can use loopback callbacks such as `http://127.0.0.1:<port>/api/auth/oauth/<provider-id>/callback`. For user private deployments, prefer user-owned dev OAuth clients rather than mixing local callbacks into a production client without explicit agreement.

## Deployment Origin Matrix

Use this matrix when deciding which callback URLs and passkey origins belong in a provider:

| Shape                           | `ONEWORKS_RELAY_PUBLIC_URL` / public origin              | OAuth callback to register                               | Passkey origin / RP id                                                           |
| ------------------------------- | -------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Node single host                | The final HTTPS host serving Relay, Admin, and `/login`. | Same host plus `/api/auth/oauth/<provider-id>/callback`. | Same host; RP id is usually that hostname.                                       |
| Vercel single project           | The Vercel project domain or final custom domain.        | Same Vercel/custom origin.                               | Same Vercel/custom origin; prefer custom domain before enrollment.               |
| Cloudflare Pages + Worker split | The Pages/custom domain that users open in the browser.  | The Pages/custom domain, not the hidden Worker URL.      | The Pages/custom domain; Worker validates the proxied origin.                    |
| Local loopback validation       | The exact loopback origin currently serving `/login`.    | The exact loopback origin and port.                      | Local passkeys are only for local validation; do not migrate them to production. |

For Cloudflare split deployments, `/api/*`, `/login`, and `/login/complete` may proxy to a Worker, but provider consoles should still see the user-facing Pages/custom-domain callback. For Vercel, Admin and API are normally same-origin, so callback and passkey origin should be the same final project/custom domain.

## Callback Paths

Common Relay callback paths:

```text
<public-origin>/api/auth/oauth/github/callback
<public-origin>/api/auth/oauth/google/callback
<public-origin>/api/auth/oauth/<provider-id>/callback
```

The managed provider path uses the provider id configured in Admin. Keep the provider id stable after users start logging in, because Relay identities bind to `(provider, providerUserId)`.

## Naming And Branding

- Avoid naming production OAuth clients/apps with `dev`, `test`, `Relay`, or a maintainer name unless that is the intended audience.
- Use a stable product-facing name such as `OneWorks Login` or the user's own brand, because provider consent pages may show it.
- Brand SSO providers need UI follow-through. Update `apps/relay-server/src/routes/login-page-client-config.ts`, `apps/relay-admin/src/login/LoginProviderIcon.tsx`, login provider types, and tests so GitHub / Google / future branded providers do not fall back to the generic login icon.
- Provider app icons should use transparent brand assets when the provider supports them and should not expose personal account branding.

## Secrets And Privacy

- Keep provider secrets in platform secret stores or local ignored scratch files only.
- Never commit client secrets, App private keys, manifest output, temporary test OAuth credentials, account IDs, personal mailbox addresses, or maintainer account names into README, AGENTS, `.oo/docs`, changelog, PR descriptions, or config files.
- When documenting setup, use placeholders such as `https://relay.example.com` and `<provider-client-id>`.

## Verification Checklist

After adding a provider, verify all layers:

- Run the focused local SSO path when code changes touch OAuth, login sessions, provider parsing, or Admin provider management:

```bash
pnpm -C apps/relay-server test:e2e:local-sso
pnpm exec vitest run --workspace vitest.workspace.ts --project node \
  apps/relay-server/__tests__/auth.spec.ts \
  apps/relay-server/__tests__/sso.spec.ts \
  apps/relay-server/__tests__/sso-admin.spec.ts \
  apps/relay-server/__tests__/oauth-proxy.spec.ts \
  apps/relay-server/__tests__/email-code-login.spec.ts
```

- `GET /api/relay/info` exposes `features.oauth=true` and the expected provider id when that endpoint is part of the tested surface.
- `GET /api/auth/oauth/<provider-id>/start?...` returns a `302`.
- The provider authorization URL contains the expected `client_id` and exact callback URL.
- `/login` renders the provider button with the correct brand name and icon.
- The provider callback completes `/login/complete` back to the original `redirect_uri`.
- A resulting user is keyed by provider identity, not by globally unique email.
- Same-email GitHub, Google, and custom SSO accounts remain separate users unless an explicit account-linking feature exists.
- SSO-only users cannot be signed in by email verification code just because the contact email matches.
- Providers that expose email verification must reject unverified email claims.
