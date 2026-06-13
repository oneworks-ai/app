# Relay 0.1.0-alpha.0

- Add Cloudflare and Vercel deployment support for Relay Server and serve Relay Admin as part of the deployable server app.
- Add official Cloudflare and Vercel Relay service presets to the Relay plugin, with per-server login state and accordion account status.
- Support multiple Relay server connections at the same time so local, company, and official services can coexist.
- Add Relay email send risk controls before provider delivery, including Turnstile verification, domain policy checks, per-email/IP/domain limits, global budgets, and TTL challenge reuse.
- Document the official domain, DNS, and email topology for public, dev, Cloudflare, Vercel, and support-mail deployments.
