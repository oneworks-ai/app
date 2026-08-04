# One Works 0.1.0-rc.4

- Align all One Works applications, runtime packages, channels, adapters, and plugins on the `rc.4` release line.
- Keep Cloudflare, Vercel, and self-hosted Node Relay deployments independent: Cloudflare uses hibernating Durable Object WebSockets, Vercel uses bounded HTTP long-polling, and Node uses native WebSockets.
- Fix the installed Relay Server CLI entry and shared-types build ordering for npm and Cloudflare deployment artifacts.
- Refresh the Desktop release so the installed application includes the current RC runtime and built-in Relay transport implementation.
