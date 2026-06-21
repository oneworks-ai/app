# Relay Hosting, Login, and Identity Model

Relay connects One Works plugin devices with cloud sessions. Most users should use the managed One Works Relay service. Private deployment is for teams that need their own domain, storage, SSO policy, or network isolation.

## Private Deployment Configuration Checklist

Before creating platform projects, OAuth clients, mail domains, or passkeys, decide these settings first:

| Setting          | Recommendation                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public domain    | Choose the final user-facing domain such as `https://relay.example.com` before configuring SSO or passkeys.                                           |
| Deployment shape | Use Postgres for a Vercel single-project deployment, Pages + Worker / Durable Object for Cloudflare, and usually SQLite for single-host Node.         |
| `PUBLIC_URL`     | Set `ONEWORKS_RELAY_PUBLIC_URL` to the real browser-facing Admin / login / API origin.                                                                |
| CORS             | In production, set `ONEWORKS_RELAY_ALLOW_ORIGIN` to the allowed frontend origin instead of `*`.                                                       |
| Secrets          | Store admin tokens, device metadata secrets, database URLs, mail keys, and OAuth secrets in the platform secret store.                                |
| Mail             | Send verification, invite, and system emails from a stable sending domain with a role-address Reply-To; do not attach mail DNS to the Relay web host. |
| SSO              | Callback URLs must exactly match the URL Relay sends; built-in GitHub and Google providers use their dedicated env vars.                              |
| Passkey          | Enroll on the final HTTPS origin; set `ONEWORKS_RELAY_PASSKEY_ORIGIN` / `ONEWORKS_RELAY_PASSKEY_RP_ID` when they must be explicit.                    |
| Plugin servers   | Put only final public origins in Relay plugin `servers[]`; dev, prod, and company services can coexist.                                               |

Configuration belongs to the deployment environment, not to code constants. Do not put real account IDs, project IDs, personal emails, database URLs, OAuth secrets, Resend keys, verification codes, or temporary deployment URLs into README files, `.oo/docs`, rules, screenshots, or example config.

When debugging platform configuration, first confirm that you are inspecting the right project and environment:

- On Vercel, use `vercel env ls production` for the current project's production environment. If the deployment command uses `--prod`, update production env even when the custom domain is a dev domain. `vercel env pull` writes secrets to local files; use only ignored scratch files and delete them afterward.
- On Cloudflare Workers, use `wrangler secret list --name <worker-name>` to inspect Worker secrets. If the workflow deploys with a `--name` override, use the same Worker name when listing or deleting secrets.
- Cloudflare Pages and Workers have separate env stores. Admin Pages proxy env and Relay Worker SSO / storage secrets must be checked separately.
- After deleting stale variables, list again to prove they are gone, then redeploy. Vercel needs a new deployment to pick up env changes; Cloudflare secret put/delete may create a new Worker version immediately, but you should still run the normal deploy workflow so code and config come from the same commit.

After deployment, run at least:

```bash
curl -fsS https://<relay-origin>/health
curl -fsS https://<relay-origin>/api/auth/providers
curl -i https://<relay-origin>/api/admin/users
```

`/health.version` should match the deployed `@oneworks/relay-server` package version. Returning `ok` is not enough; also verify the public URL, login methods, SSO providers, email codes, passkey flow, and plugin device registration on the final domain.

## OpenAPI and System Access Tokens

Relay Admin exposes two separated machine-readable OpenAPI documents:

```text
<relay-origin>/api/admin/openapi.json
<relay-origin>/api/profile/openapi.json
```

`/api/admin/openapi.json` describes only platform admin APIs, including users, access groups, invites, SSO, team policy, teams, team member groups, messages, configuration profiles / secrets, and operational metrics. `/api/profile/openapi.json` describes only current-user personal APIs, including profile security, current-user team self-service flows, team member groups, and managed configuration read / management endpoints. The Admin `/admin/openapi` page can also display, download, or open both JSON documents. Protected endpoints use `Authorization: Bearer <token>`; the token can be the deployment Admin token, a login session token, or an API access token generated from `/admin/profile`. Password, passkey, and access-token management still require a normal login session; deleting the current account also accepts a current-user API access token.

API access tokens belong to the current logged-in user and support `user`, `team`, and `platform` scopes. User tokens can call current-account APIs only; team tokens are bound to one team and are authorized through team member groups; platform tokens are authorized through platform access groups. `permissionGroupMode=all` follows the account's current groups, while `custom` restricts the token to listed group ids. The server stores only a token hash and preview, and the full token is shown once when it is created; revoke and recreate it if it is lost. An API access token cannot create or revoke other API access tokens, so those security actions require a normal login session.

Platform admins manage platform access groups and their capabilities / quotas from `/admin/access-groups`. Team owners manage member groups from the team's member-group subpage. Team member groups apply only inside that team, and they do not grant platform admins cross-team access to private team information. Both platform access groups and team member groups support default name / description fields plus `localizedNames` / `localizedDescriptions` keyed by supported locale tags; built-in system groups automatically include default copy for every supported language. The UI prefers the user's language and falls back to the default fields.

## Login Methods

`/login` is shared by the Relay plugin, Admin, and Web redirect flows. Operators can set the default method with `ONEWORKS_RELAY_DEFAULT_LOGIN_METHOD`, and the browser remembers the last method selected by the user.

- Password: for existing non-SSO accounts with a password.
- Verification code: for existing non-SSO / `email_code` accounts only. It sends a login code to that account email. It does not create accounts and cannot sign in SSO-only accounts that share the same email.
- Passkey: one entry supports both sign-in and registration. The user first enters an email or account name and clicks "Use PASS KEY"; if a passkey exists, the browser authentication prompt opens; if none exists and registration is allowed, registration begins.
- SSO: uses Google, GitHub, or custom OAuth/OIDC providers configured by an admin.

## Passkey Registration UX

The passkey page should stay two-step:

1. The first screen asks only for email or account name, remember-account preference, and the "Use PASS KEY" button.
2. The second step appears only when the server finds that no passkey is available and the deployment policy requires extra information.

The second step is policy-driven:

- `ONEWORKS_RELAY_PASSKEY_EMAIL_VERIFICATION_REQUIRED=on` shows the email verification code field.
- `ONEWORKS_RELAY_REGISTRATION_MODE=invite_required` shows the invite-code field.
- If new account registration needs neither email verification nor an invite, skip the second step and go directly into browser passkey creation.

Existing users must still verify email before adding a new passkey, even when new self-registration skips email confirmation. In production, serve `/login` on the final HTTPS origin and set `ONEWORKS_RELAY_PUBLIC_URL`; set `ONEWORKS_RELAY_PASSKEY_ORIGIN` and `ONEWORKS_RELAY_PASSKEY_RP_ID` when the expected WebAuthn origin or RP ID must be explicit. Passkeys are origin-bound, so moving domains after enrollment can make existing credentials unusable.

## Identity Model

Relay does not treat email as the global account key. `users.email` is a contact address; the server-side auth identities decide which login source belongs to which user.

- `loginId` is a user-visible, globally unique account name and can be changed after login.
- SSO accounts bind by `(provider, providerUserId)`. The same email through Google and GitHub creates separate Relay users.
- Google and generic OIDC providers must return a verified email. GitHub uses the verified primary email.
- Email verification-code login matches only `email_code` identities and cannot sign in SSO-only accounts just because the email matches.
- Non-SSO users created by password, invite, passkey, or admin flows receive an `email_code` identity and can use verification-code login.

This prevents corporate SSO, personal GitHub, and Google identities from overwriting each other, and avoids unsafe linking through unverified email fields.

## SSO Provider Setup

Before creating an OAuth/OIDC provider, confirm every public origin it must support: local development, dev cloud, production cloud, and custom domains. Callback URLs must exactly match the URLs Relay sends.

Common callback paths:

```text
<relay-origin>/api/auth/oauth/github/callback
<relay-origin>/api/auth/oauth/google/callback
<relay-origin>/api/auth/oauth/<provider-id>/callback
```

Provider secrets managed from Admin are stored server-side. List and detail APIs return only redacted values. User-facing SSO buttons should use branded provider icons instead of the generic login icon.

Built-in GitHub and Google login use dedicated environment variables. Do not put `github` or `google` into `ONEWORKS_RELAY_SSO_PROVIDERS`; those provider ids are reserved. If an existing deployment has the old value, remove it from every Vercel, Cloudflare, or equivalent platform env / secret store, redeploy, and verify `/health`, `/api/auth/providers`, and the OAuth start `302` on each public origin.

For private deployment, choose the final public domain before configuring SSO and passkeys. A Vercel single-project deployment usually serves Admin, API, and login from one domain. In a Cloudflare Pages + Worker split deployment, register OAuth callbacks on the Pages/custom domain that users open, not on a hidden Worker URL. Whether dev, test, and production share one OAuth client is a deployment decision; use separate clients when secrets, callbacks, or audiences need isolation.

## Email Codes and Abuse Control

Verification, invite, and login emails should all pass through the same delivery controls: Turnstile, domain allowlist / blocklist, disposable-email blocking, per-email / per-IP / per-domain windows, global daily / monthly budgets, and then the transactional email provider. Repeated requests during an active TTL should reuse the current code to avoid unnecessary provider calls and billing surprises.

Do not put real personal emails, OAuth secrets, Resend keys, database URLs, or test verification codes in docs, screenshots, or example config.
