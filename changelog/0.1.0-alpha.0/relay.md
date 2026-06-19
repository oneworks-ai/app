# Relay 0.1.0-alpha.0

- Add Cloudflare and Vercel deployment support for Relay Server and serve Relay Admin as part of the deployable server app.
- Add official Cloudflare and Vercel Relay service presets to the Relay plugin, with per-server login state and accordion account status.
- Support multiple Relay server connections at the same time so local, company, and official services can coexist.
- Add Relay email send risk controls before provider delivery, including Turnstile verification, domain policy checks, per-email/IP/domain limits, global budgets, and TTL challenge reuse.
- Pass Relay email provider, Resend, Turnstile, rate-limit, budget, and domain policy environment variables through the Cloudflare Worker runtime.
- Fix Relay dev deployment automation so Cloudflare Pages deploys Admin proxy functions and same-origin `/health` smoke checks work.
- Fix Vercel prebuilt Relay deployments by copying WebAuthn runtime dependencies into the serverless function output.
- Fix Relay Server version reporting to read from its package metadata instead of a stale hardcoded release string.
- Add Relay team configuration distribution APIs, Admin team/message management surfaces, and plugin-side team config snapshot consumption.
- Document the official domain, DNS, and email topology for public, dev, Cloudflare, Vercel, and support-mail deployments.
