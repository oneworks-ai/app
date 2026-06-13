# PWA Install, Verification, and Troubleshooting

## Install on Mobile

Android Chrome / Edge:

1. Open the standalone client URL.
2. Confirm that the page can connect to the backend and log in.
3. Choose "Install app" or "Add to Home screen" from the browser menu.

Some Android vendor systems separately restrict browser-created home screen shortcuts. On MIUI / HyperOS, if installation appears to succeed but no icon appears, grant the browser the home screen shortcut permission:

```text
Settings -> Apps -> Browser -> Permissions / Other permissions -> Home screen shortcuts -> Allow
```

You can also long-press the browser icon, open App info, and enable the same permission. Then remove the partially installed PWA and install it again.

If the icon still does not appear, check whether the launcher has a locked layout, app drawer mode, hidden apps, second space, or a work profile.

iOS Safari:

1. Open the standalone client URL in Safari.
2. Tap Share.
3. Choose "Add to Home Screen".

## Connections and Login State

An installed PWA keeps the backend address and login token saved under the same origin. To switch backend, use "Change backend service" on the login page or reset the backend address from the account and connection menu after entering the app. Logout for the current connection is in the same menu.

The connection page keeps a list of successful backend services with no fixed limit. Each service can have an alias and description, and the list shows whether the current browser has a saved login state for it.

Changing backend clears only the selected backend address. It does not clear saved login state for other services. Tokens are cleared only when logging out of the current connection or clearing that service's login state in service management.

On mobile, the Web UI uses the browser visual viewport to adjust visible height and bottom spacing so the keyboard does not cover login fields, backend URL fields, or the chat input.

## Version Compatibility

Before connecting, the standalone client reads:

```text
<server-base-url>/api/auth/status
```

Compatibility uses semver rules:

- `1.x` versions are compatible with each other.
- `0.x` requires the same minor version.
- prerelease versions require the full prerelease identifier to match.

If the backend is incompatible or does not return a version, the connection page reports an unsupported backend version. After a successful connection, the service list records the backend version.

## Verify Connectivity

Open this URL on the target device:

```text
<server-base-url>/api/auth/status
```

If it returns JSON containing `success`, the HTTP API is reachable.

Then open the standalone client, enter the same `<server-base-url>`, log in, create or open a session, and confirm that message streaming and terminal view work. WebSocket path defaults to `/ws`; the standalone client converts `http` / `https` to `ws` / `wss` automatically.

Troubleshooting order:

- Can `manifest.webmanifest` and `sw.js` be loaded from the static site root?
- Is the static site using HTTPS?
- Is the backend URL using HTTPS?
- Can `<server-base-url>/api/auth/status` be opened from the same device?
- Is `webAuth` enabled, and are the username/password correct?
- Does the tunnel, VPN, or reverse proxy forward WebSocket traffic to `/ws`?
- On Android, if installation says success but no icon appears, check whether the browser can create home screen shortcuts.

## Security and Privacy

- Do not put real email addresses, device names, tailnet names, home public IPs, LAN IPs, or fixed login passwords in docs, issues, screenshots, or example config.
- Use placeholders such as `<machine-name>.<tailnet-name>.ts.net`, `oneworks-api.example.com`, `<lan-ip>`, and `<repo-name>`.
- Standalone deployment allows any Origin to reach the backend so static clients can work. Real access boundaries should come from `webAuth`, tailnet ACLs, Cloudflare Access, ngrok access control, or reverse proxy authentication.
- Do not expose an unauthenticated backend to the public internet.

## References

- [GitHub Pages HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/setup/)
- [ngrok HTTP/S endpoints](https://ngrok.com/docs/universal-gateway/http)
- [mkcert](https://github.com/FiloSottile/mkcert)
