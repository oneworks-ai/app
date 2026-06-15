---
description: Relay custom OAuth/OIDC-compatible provider onboarding notes.
---

# Relay Custom OAuth/OIDC-Compatible SSO

Read `.oo/rules/relay-deployment/sso-common.md` first.

## Provider Shape

- Use Admin managed SSO providers for operator-managed OAuth/OIDC connections whenever possible.
- Keep `provider.id` stable after users begin logging in; Relay identities bind to `(provider, providerUserId)`.
- Use clear ids such as `acme`, `acme-oidc`, or `company-sso`; avoid ids that encode a maintainer name or temporary environment unless that is the intended boundary.
- Provider secrets are write-only from the Admin UI perspective: list/detail responses must show redacted values only.

## Current Support Boundary

- Treat the current custom provider support as OAuth/OIDC-compatible userinfo login, not full automatic OIDC discovery.
- Operators must provide explicit authorization, token, and userinfo endpoints.
- Relay reads a stable user id and email metadata from the userinfo/profile response. It does not automatically discover metadata from `/.well-known/openid-configuration`, fetch JWKS, or validate ID tokens unless the implementation is extended to do so.
- If a provider requires ID-token-only profile claims or custom token validation, document and implement that provider explicitly before enabling it for production.

## Required Metadata

Custom providers should define:

- Authorization endpoint
- Token endpoint
- Userinfo endpoint or equivalent profile endpoint
- Client id
- Client secret
- Scope
- Enabled flag

Prefer OIDC-style identity fields:

- Stable subject/user id: `sub`
- Display name: `name` or `preferred_username`
- Contact email: `email`
- Email verification flag: `email_verified`

## Callback Setup

Managed provider callback path:

```text
<public-origin>/api/auth/oauth/<provider-id>/callback
```

The callback URL must use the final user-facing origin and the exact provider id configured in Admin.

## Relay Identity Behavior

- Do not bind custom SSO users by email alone.
- Require a stable provider user id. For OIDC, use `sub`.
- Require verified email when the provider exposes `email_verified`; if a provider cannot prove email ownership, do not automatically link it to an existing email account.
- Same-email SSO accounts should remain separate users unless a future explicit account-linking flow is added.

## Troubleshooting

- If callback succeeds but no user is created, inspect whether the userinfo response includes a stable id and verified email.
- If the provider cannot return `email_verified`, treat it as a provider contract issue rather than weakening account-linking rules.
- If a provider button needs branded UI, add a dedicated icon mapping and tests rather than using the generic login icon silently.
