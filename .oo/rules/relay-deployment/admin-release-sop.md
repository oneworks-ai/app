---
description: Official Relay Admin production release SOP covering readiness, deployment, smoke checks, rollback, and post-release follow-up.
---

# Relay Admin Production Release SOP

Use this SOP when releasing the official Relay/Admin service to production or when preparing a private deployment playbook for a customer-owned production Admin origin. This is an internal release rule, not public user documentation. Keep account names, platform ids, secrets, database URLs, OAuth secrets, private mailboxes, and temporary deployment URLs out of this file.

## Release Model

- Dev slots deploy first and absorb integration risk:
  - Cloudflare dev: `dev.cf.oneworks.cloud`
  - Vercel dev: `dev.vc.oneworks.cloud`
- Production slots are promoted manually after dev verification:
  - Cloudflare production: `cf.oneworks.cloud`
  - Vercel production: `vc.oneworks.cloud`
- Cloudflare production may use gradual Worker rollout for API / login traffic when the release touches server behavior. Admin static Pages releases should still be treated as staged production changes with explicit smoke checks and rollback points.
- Vercel production uses staged deployment + manual promote + rollback unless the deployment account explicitly has a rollout product that supports percentage traffic splitting.
- Do not promote a production Admin release from a dirty local worktree. Production must reference an immutable Git SHA from `origin/main` or a signed release tag.

## Release Preconditions

Before creating or approving a production release:

- Confirm the target SHA is on `origin/main` and all required CI checks are green:
  - `lint`
  - `format-check`
  - `typecheck`
  - `commit-message`
  - `pr-change-policy`
- Confirm the release scope:
  - Admin-only UI / CSS / i18n
  - Login page UI
  - Server API / auth / storage
  - SSO / OAuth provider configuration
  - Passkey origin / RP behavior
  - Email verification / invite / mail provider behavior
  - Plugin server list or callback behavior
- If the release changes API, auth, storage, SSO, passkey, email, device registration, or session forwarding, treat it as a Relay release, not just an Admin static release.
- Confirm additive compatibility for any data model change. Production canary is not a substitute for backward-compatible migrations.
- Confirm official domains and secrets are configured in platform secret stores, not local files or committed docs.
- Confirm the deployment platform can identify the source SHA being promoted. If `/health` includes build metadata in the future, compare it with the target SHA; until then, use platform deployment metadata and GitHub Actions logs.
- Confirm rollback target:
  - Previous Cloudflare Worker version and Pages deployment id.
  - Previous Vercel production deployment.
  - Any release tag or Git SHA needed to rebuild the previous state.

## Configuration Checklist

For every production Admin origin:

- `ONEWORKS_RELAY_PUBLIC_URL` points to the final user-facing origin.
- `ONEWORKS_RELAY_ALLOW_ORIGIN` includes only the expected Admin origin(s); production must not use `*`.
- `ONEWORKS_RELAY_STORAGE_DRIVER` is correct for the platform:
  - Vercel: `postgres`
  - Cloudflare Worker: `cloudflare-do`
  - Single Node host: `sqlite`
- `ONEWORKS_RELAY_ADMIN_TOKEN` is non-empty in production.
- `ONEWORKS_RELAY_ADMIN_TOKEN` and `ONEWORKS_RELAY_DEVICE_METADATA_SECRET` are long random values and are not reused between unrelated deployments.
- Passkey settings match the final HTTPS origin:
  - `ONEWORKS_RELAY_PASSKEY_ORIGIN`
  - `ONEWORKS_RELAY_PASSKEY_RP_ID`
  - `ONEWORKS_RELAY_REGISTRATION_MODE`
  - `ONEWORKS_RELAY_PASSKEY_EMAIL_VERIFICATION_REQUIRED`
- Login behavior is intentional:
  - `ONEWORKS_RELAY_DEFAULT_LOGIN_METHOD`
  - enabled password / passkey / verification-code behavior
  - invite policy
- SSO providers are configured only after callback URLs are registered against the final production origin.
- Transactional mail uses a stable mail domain and role-address Reply-To. Do not attach mail DNS records to Admin / Relay web hosts.
- If SSO is expected, `/api/auth/providers` must return the expected provider ids before production traffic is opened.

## Dev Verification

After merging to `origin/main`, deploy the same SHA to dev first.

The official dev slots are deployed by `.github/workflows/deploy-relay-dev.yml` when Relay-related paths change on `main`. If a release needs to verify only one platform, run the same workflow manually and choose `cloudflare` or `vercel`; otherwise use `both`.

Run smoke checks against every dev slot being promoted from:

```bash
curl -fsS https://<dev-admin-origin>/health
curl -fsS https://<dev-admin-origin>/api/auth/providers
curl -i https://<dev-admin-origin>/api/admin/users
curl -fsS "https://<dev-admin-origin>/login?redirect_uri=https%3A%2F%2F<dev-admin-origin>%2Fadmin%2Fdevices&lang=zh-CN"
```

Expected:

- `/health` returns `{"ok":true,...}`.
- `/api/auth/providers` returns configured SSO providers when SSO should be enabled.
- `/api/admin/users` returns `401` without an admin or session token.
- `/login` contains the login config script and renders expected login methods.
- Admin shell loads `/admin` assets without 404s.
- Deployment metadata points at the same SHA that was approved for release.
- Owner/admin can log in through the intended default method.
- If passkey changed, register and log in on the final dev origin, not on a temporary platform domain.
- If SSO changed, complete one real provider callback per changed provider.
- If email verification changed, send one code through the real provider and confirm rate-limit / budget guards still apply.

Do not promote production if dev only works through a temporary domain while the production release will use a custom domain.

## Production Deployment Steps

1. Announce release scope, target SHA, target platforms, and rollback target in the release thread or PR.
2. Ensure no unrelated production deploy is in progress.
3. Deploy production from the exact target SHA or release tag.
4. For Cloudflare server/API changes:
   - Upload the new Worker version.
   - Start with a small percentage when gradual deployment is available.
   - Keep version affinity enabled for auth, passkey, device heartbeat, and session-forwarding traffic.
   - Increase traffic only after smoke checks and logs are clean.
5. For Cloudflare Admin static Pages changes:
   - Deploy the Pages project for the production Admin origin.
   - Confirm the Pages proxy still reaches the intended Worker.
6. For Vercel:
   - Build from the target SHA.
   - Promote the staged deployment to production.
   - Keep the previous production deployment ready for instant rollback.
7. Run the production smoke checks before announcing success.

## Production Smoke Checks

Run these against every production Admin origin that changed:

```bash
curl -fsS https://<prod-admin-origin>/health
curl -fsS https://<prod-admin-origin>/api/auth/providers
curl -i https://<prod-admin-origin>/api/admin/users
curl -fsS "https://<prod-admin-origin>/login?redirect_uri=https%3A%2F%2F<prod-admin-origin>%2Fadmin%2Fdevices&lang=zh-CN"
```

Then verify browser behavior:

- `/admin/devices` redirects unauthenticated users to `/login`.
- `/login` shows the expected default login method and SSO buttons.
- GitHub / Google / OIDC buttons use branded icons when supported.
- Existing admin session still reaches users, devices, invites, SSO, and profile pages.
- New login sessions can return to the original `redirect_uri`.
- Browser console has no asset load failures for `admin.js`, `admin.css`, login bundle, icons, or favicon.
- If plugin behavior changed, a Relay plugin configured with the production server can log in, register a device, heartbeat, and create a session in the intended server/device group.

## Rollback Rules

Rollback immediately when any of these are true:

- Admin shell cannot load.
- Login page cannot render.
- Admin users cannot authenticate with all intended production methods.
- `/api/admin/users` exposes data without authentication.
- SSO callback returns provider or redirect mismatch for a configured production provider.
- Passkey ceremonies fail because origin / RP id is wrong.
- Device heartbeat or session forwarding breaks for existing production devices.
- Error rate, auth failures, or email send volume jumps unexpectedly.

Rollback order:

1. Stop or reduce gradual traffic to the new Cloudflare Worker version.
2. Roll back Admin static deployment if the login/admin shell changed.
3. Restore the previous Vercel production deployment when Vercel is affected.
4. Disable only the broken SSO provider if the failure is isolated to one provider and local login remains safe.
5. Record the failing public symptom and the exact reverted version; do not record secrets or private account ids.

## Post-Release

After production is stable:

- Record public URLs, target SHA, platforms released, smoke results, and rollback target in the release thread or PR.
- Confirm SSO providers are enabled where expected by checking `/api/auth/providers`.
- Confirm no production secrets, account ids, database URLs, personal email routes, or temporary deployment URLs were added to committed files.
- File follow-up PRs for any cleanup discovered during release. Do not batch unrelated cleanup into the production release.
- If the release changed this SOP, `RELAY-DEPLOYMENT.md`, AGENTS files, or public docs, run:

```bash
pnpm exec dprint check
git diff --check
```

## Anti-Patterns

- Promoting production from a local dirty worktree.
- Treating Admin UI release as safe when `/login`, SSO, passkey, or server API behavior changed.
- Testing passkey or OAuth only on a temporary domain before moving users to a custom production domain.
- Registering OAuth callbacks on the hidden Worker URL while users open the Pages/custom Admin origin.
- Enabling SSO in provider consoles but forgetting the Relay server env/store provider configuration.
- Relying on `200 /admin` only; always check unauthorized admin API, login config, and provider list.
- Writing platform account ids, personal mailbox destinations, OAuth secrets, database URLs, or temporary deployment URLs into rules, README, `.oo/docs`, AGENTS, handoff, or changelog.
