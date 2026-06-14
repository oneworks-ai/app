# PWA and Standalone Deployment

One Works Web can be used as a regular Web UI, or the client can be built as a static PWA and deployed to GitHub Pages, object storage, a CDN, or another static host. Users then enter the backend service address on first open.

## When to Use Each Mode

- Same-origin deployment: the server serves the Web UI at `/ui`. This is the simplest mode because frontend and backend share one origin.
- Standalone deployment: the client is deployed to a static site and the backend runs separately. Users enter a backend URL such as `https://<machine>.<tailnet>.ts.net` or `https://oneworks-api.example.com`.
- Mobile PWA: users install the page onto a desktop or home screen. Browsers usually require a secure context, meaning `https://` or local `localhost`.

For standalone deployment, the backend allows cross-origin requests and uses bearer tokens from login for HTTP and WebSocket authentication. Publicly reachable backends must enable `webAuth` and should add network-level access control.

## Build the Client

Standalone build:

```bash
__ONEWORKS_PROJECT_CLIENT_MODE__=standalone pnpm --filter @oneworks/client exec vite build
```

For a GitHub Pages project site such as `https://<github-user>.github.io/<repo-name>/`, set the client base:

```bash
__ONEWORKS_PROJECT_CLIENT_MODE__=standalone \
__ONEWORKS_PROJECT_CLIENT_BASE__=/<repo-name>/ \
pnpm --filter @oneworks/client exec vite build
```

Build output is under `apps/client/dist/`. Keep these PWA files at the static site root:

- `index.html`
- `manifest.webmanifest`
- `sw.js`
- `pwa-icon-192.png`
- `pwa-icon-512.png`

The Service Worker is registered only in production builds. Local dev mode avoids cache interference.

Homepage preview data and interaction runtime are controlled by build flags and should not enter ordinary PWA artifacts. The official `https://oneworks.cloud/pwa/` deployment uses `__ONEWORKS_PROJECT_CLIENT_BASE__=/pwa/`, which enables that preview runtime automatically. Other standalone deployments exclude it by default. Use `__ONEWORKS_PROJECT_CLIENT_HOMEPAGE_PREVIEW__=1` to include it, or `__ONEWORKS_PROJECT_CLIENT_HOMEPAGE_PREVIEW__=0` to force it off.

Standalone builds include the client version and build commit. `Settings -> About` shows both client and server versions; double-click the client version to reveal the build commit hash.

## Start the Backend

The reference script shown in the PWA connection page is suitable for local browser use, Tailscale Serve, Cloudflare Tunnel, ngrok, or a reverse proxy:

```bash
npx oneworks server --allow-cors
```

If an outer HTTPS tunnel or reverse proxy is present, enter the outer `https://...` URL in the PWA, not the local address printed in the terminal.

LAN access:

```bash
npx oneworks server --host 0.0.0.0 --port 8787 --allow-cors
```

For public tunnels, reverse proxies, or any non-private network entry point, enable authentication:

```bash
__ONEWORKS_PROJECT_WEB_AUTH_ENABLED=true \
__ONEWORKS_PROJECT_WEB_AUTH_USERNAME=admin \
__ONEWORKS_PROJECT_WEB_AUTH_PASSWORD=<strong-password> \
npx oneworks server --allow-cors
```

You can also store accounts in project config `webAuth.accounts`.

## Backend URL Options

### Same-origin Server UI

```text
http://localhost:8787/ui/
```

Best for local development, internal tools, or cases where the static client does not need an independent release.

### LAN HTTP

```text
http://<lan-ip>:8787
```

Useful for quick validation. It is not a good long-term backend for HTTPS frontends such as GitHub Pages because browsers may block mixed content, private-network access, or `ws://` WebSocket connections.

### Tailscale Serve

```bash
tailscale serve --bg --https=443 localhost:8787
```

Use this URL in the PWA:

```text
https://<machine-name>.<tailnet-name>.ts.net
```

Helpful commands:

```bash
tailscale status
tailscale ping <peer-device-name>
tailscale serve status
tailscale serve --https=443 off
```

### Cloudflare Tunnel

Temporary quick tunnel:

```bash
cloudflared tunnel --url http://localhost:8787
```

Long-term setups should use a named tunnel and stable hostname such as:

```text
https://oneworks-api.example.com -> http://localhost:8787
```

Use `webAuth` plus Cloudflare Access, IP allowlists, or another access layer.

### ngrok

```bash
ngrok http 8787
```

With a reserved domain:

```bash
ngrok http 8787 --url https://oneworks-api.example.ngrok.app
```

This is a public entry point. Enable `webAuth` and restrict who can access it.

### Own Domain and Local HTTPS

Common pattern:

```text
https://oneworks-api.example.com
```

Use Caddy, Nginx, or Traefik to reverse proxy to `http://localhost:8787`. Public services should use ACME / Let's Encrypt. Internal-only services can use `mkcert`, but every client device must trust the local CA and DNS/certificate names must match.

## GitHub Pages

GitHub Pages can host the standalone client. The official PWA deployment is maintained by the `oneworks-ai/pwa` repository at:

```text
https://oneworks.cloud/pwa/
```

When client-related inputs change on the main repository `main`, the PWA repository rebuilds and publishes its own `gh-pages`. Forks and private deployments can still use project-site URLs such as `https://<github-user>.github.io/<repo-name>/`.

Prefer HTTPS backend URLs:

```text
https://<machine-name>.<tailnet-name>.ts.net
https://oneworks-api.example.com
https://oneworks-api.example.ngrok.app
https://<random>.trycloudflare.com
```

Do not connect a long-lived HTTPS frontend to `http://<lan-ip>:8787`; it is likely to break on mobile, installed PWA mode, WebSocket, or future browser security changes.

## Install, Verify, and Troubleshoot

Continue to [PWA Install, Verification, and Troubleshooting](./pwa/operations.md).
