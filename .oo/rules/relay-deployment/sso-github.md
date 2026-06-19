---
description: Relay GitHub SSO/GitHub App onboarding notes.
---

# Relay GitHub SSO

Read `.oo/rules/relay-deployment/sso-common.md` first.

## Recommended Shape

- Prefer a GitHub App or OAuth app owned by the deployment owner or an approved OneWorks service account.
- Use a product-facing app name such as `OneWorks Login` or the user's own brand.
- Do not create provider apps under a maintainer's personal account for user private deployments.
- Do not restrict login to the currently authenticated maintainer account unless the user explicitly wants a single-account test.

## GitHub App Vs OAuth App

- Relay needs GitHub's user authorization flow: a client id, client secret, and callback URL that can return a GitHub user id plus a verified primary email.
- A GitHub OAuth App is enough for simple sign-in.
- A GitHub App can also be used when the deployment owner wants GitHub App branding, ownership, and account installation controls. In that case, configure the user authorization callback; repository, issue, organization, or webhook permissions are not needed for Relay login unless another product feature explicitly requires them.
- If a GitHub App is used, choose whether it can be installed or authorized by any account or only by a specific organization/enterprise. Do not accidentally scope it to the maintainer's current account for a deployment that should accept other users.
- One shared GitHub App/client can keep branding consistent across local, dev, and production, but every callback in that app becomes part of its trust surface. Use separate apps or clients when environments need separate secrets, audiences, or callback slots.

## Permissions And Scopes

- Request the minimum user identity access.
- For OAuth app style login, use identity scopes such as `read:user` and `user:email`.
- For GitHub App style login, request read-only email identity access and avoid repository or organization permissions unless the product feature truly needs them.
- Choose account restrictions deliberately:
  - Public or self-serve login should allow broad account access.
  - Company-only login can restrict installation or authorization to the user's organization or enterprise.

## Relay Env

Configure the built-in GitHub provider with platform secrets:

```text
ONEWORKS_RELAY_GITHUB_CLIENT_ID=<github-client-id>
ONEWORKS_RELAY_GITHUB_CLIENT_SECRET=<github-client-secret>
```

Do not configure GitHub through `ONEWORKS_RELAY_SSO_PROVIDERS`. The `github` provider id is reserved for the built-in GitHub flow, and Relay rejects custom SSO JSON entries that try to override it.

When enabling GitHub SSO in cloud slots, update every active platform environment store that can serve the origin: Vercel project env, Cloudflare Worker secrets/vars, and any Pages proxy env that influences the public origin. Remove stale `ONEWORKS_RELAY_SSO_PROVIDERS` values that contain `github` before redeploying; leaving an old reserved-provider entry in one platform can make that platform fail even if another slot is fixed.

For official dev slot CLI commands and platform-specific env store pitfalls, read `.oo/rules/release/relay-dev-deploy-github-actions.md`.

## Callback Setup

GitHub callback for the built-in provider:

```text
<public-origin>/api/auth/oauth/github/callback
```

- Add every active final origin that must work: local dev, dev cloud, production cloud, and custom domains.
- GitHub callback lists are finite; keep them intentional. If dev/prod need different audiences or secrets, use separate apps instead of overloading one app.
- If using a shared production app for local validation, keep loopback callbacks only when the deployment owner understands that local callback URLs are part of that app's trust surface.

## Relay Identity Behavior

- Relay should read GitHub's verified primary email for contact email.
- Relay identities are keyed by provider id and GitHub user id, not by email.
- The same email from GitHub and another SSO provider must create distinct Relay users unless a future explicit account-linking flow is added.

## UI Follow-through

- The login button should use the GitHub icon and label, not the generic login icon.
- If the GitHub provider id changes, update provider icon mapping and tests at the same time.
- Keep app avatar/icon brand-neutral and transparent when possible; do not use a maintainer's profile image.

## Cloud Rollout Checks

After changing GitHub SSO env or callback settings on Vercel, Cloudflare, or a private equivalent, verify each public origin separately:

```bash
curl -fsS https://<relay-origin>/health
curl -fsS https://<relay-origin>/api/auth/providers
curl -I "https://<relay-origin>/api/auth/oauth/github/start?redirect_uri=https%3A%2F%2F<relay-origin>%2Fadmin%2Fdevices"
```

Expected:

- Deployment job or platform deploy is green for the same commit / config generation being tested.
- `/health` returns `ok`.
- `/api/auth/providers` includes `github`.
- OAuth start returns `302` to GitHub authorization and the `redirect_uri` inside that authorization URL matches the callback configured in the GitHub app/client.

Do this for both dev and production slots when both are active, and for every supported platform when the deployment supports both Cloudflare and Vercel. Do not assume success on one platform means the other platform's secret store, callback list, Pages proxy, or serverless bundle is correct.

## Troubleshooting

- If `/login` shows a generic provider button, check `login-page-client-config.ts`, `LoginProviderIcon.tsx`, and login provider types.
- If a deployment starts returning 500 after enabling GitHub SSO, check that platform secrets do not still contain `ONEWORKS_RELAY_SSO_PROVIDERS` with a `github` entry; remove that secret from every affected platform and redeploy so the runtime no longer sees the stale reserved-provider config.
- If one platform works and another does not, compare platform env first, then deployment logs. A common failure is fixing the repository or one cloud slot while a second slot still has the old `ONEWORKS_RELAY_SSO_PROVIDERS` value.
- If callback fails, compare the exact `redirect_uri` in the GitHub authorization URL with the callback URL configured in GitHub.
- If login creates or matches the wrong account, inspect auth identities and verify the provider id plus GitHub user id are used instead of email-only lookup.
