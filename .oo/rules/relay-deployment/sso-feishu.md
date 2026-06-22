---
description: Relay Feishu self-built app OAuth login setup notes.
---

# Relay Feishu SSO

Read `.oo/rules/relay-deployment/sso-common.md` first.

## Provider Shape

- Use a Feishu enterprise self-built app for private customer or internal deployments. Do not route this through Feishu App Directory or AnyCross unless the customer explicitly wants that product path.
- Treat the self-built app as an enterprise-tenant login path. Users normally must belong to the Feishu tenant and have access to the published app; use another provider or an explicit external-user product path for arbitrary public users.
- Use provider id `feishu` for the standard managed provider unless the deployment needs multiple isolated Feishu apps. Keep the id stable after users start logging in.
- Register callback URLs against the exact Relay public origin:

```text
<relay-origin>/api/auth/oauth/feishu/callback
```

- Local development can use a loopback callback such as:

```text
http://127.0.0.1:<port>/api/auth/oauth/feishu/callback
```

## Endpoints And Scope

Use these endpoints for Feishu China:

- Authorization endpoint: `https://accounts.feishu.cn/open-apis/authen/v1/authorize`
- Token endpoint: `https://open.feishu.cn/open-apis/authen/v2/oauth/token`
- Userinfo endpoint: `https://open.feishu.cn/open-apis/authen/v1/user_info`

Default scope for Relay login should be the smallest useful set:

```text
contact:user.email:readonly
```

Only add broader contact scopes when the deployment has a clear product need and the Feishu tenant admin approves the extra data access.

## Identity And Email

- Feishu `user_info` returns profile data under `data`, not as top-level OIDC claims.
- Relay should bind Feishu identities by `tenant_key` plus `union_id` when available, falling back to `open_id` or `user_id`.
- Feishu `email` and `mobile` are administrator-imported contact fields, not real-time user-verified login proofs. Treat the email as contact metadata and keep the auth identity's `emailVerified` false.
- Some Feishu tenants do not set `email` on every user. Relay should still allow login when a stable Feishu user id exists, using a `.invalid` placeholder contact email such as `feishu-<hash>@feishu.relay.invalid`.
- Do not link an existing account by Feishu email alone. Existing account linking must go through an explicit linking flow or Relay-owned email verification.

## Setup Checklist

1. Create or open the Feishu self-built app in the enterprise developer console.
2. Add every active Relay callback URL in **Development configuration -> Security settings -> Redirect URL**.
3. Request only the required API permissions, normally `contact:user.email:readonly`.
4. Publish the app version and let the enterprise administrator approve it.
5. In Relay Admin `/admin/sso`, choose the Feishu preset, paste App ID as Client ID and App Secret as Client Secret, enable the provider, then verify `/login`.

## Troubleshooting

- OAuth start returns a Feishu redirect error: check the callback URL exactly matches scheme, host, port, path, and provider id.
- Callback creates a `.invalid` placeholder email: the app has a stable Feishu user id but the Feishu account has no email field. Configure enterprise email in Feishu if the deployment needs a real contact email.
- Callback fails with missing stable id: inspect whether `user_info` includes `data.union_id`, `data.open_id`, or `data.user_id`.
