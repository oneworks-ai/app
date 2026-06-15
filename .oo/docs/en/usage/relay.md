# Relay Hosting, Login, and Identity Model

Relay connects One Works plugin devices with cloud sessions. Most users should use the managed One Works Relay service. Private deployment is for teams that need their own domain, storage, SSO policy, or network isolation.

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

For private deployment, choose the final public domain before configuring SSO and passkeys. A Vercel single-project deployment usually serves Admin, API, and login from one domain. In a Cloudflare Pages + Worker split deployment, register OAuth callbacks on the Pages/custom domain that users open, not on a hidden Worker URL. Whether dev, test, and production share one OAuth client is a deployment decision; use separate clients when secrets, callbacks, or audiences need isolation.

## Email Codes and Abuse Control

Verification, invite, and login emails should all pass through the same delivery controls: Turnstile, domain allowlist / blocklist, disposable-email blocking, per-email / per-IP / per-domain windows, global daily / monthly budgets, and then the transactional email provider. Repeated requests during an active TTL should reuse the current code to avoid unnecessary provider calls and billing surprises.

Do not put real personal emails, OAuth secrets, Resend keys, database URLs, or test verification codes in docs, screenshots, or example config.
