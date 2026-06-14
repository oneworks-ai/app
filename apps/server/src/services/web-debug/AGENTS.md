# Web Debug Service

This directory owns server-level browser debugging runtimes that can be reused by Web UI, iframe previews, desktop webviews, and future project surfaces.

- `chii.ts`: embeds the Chii HTTP assets and WebSocket target/client channels into the existing project server. It must not start a separate port.
- `chii-runtime.ts`: owns the server-managed Chii base path and public runtime URL response shape.
- Chii URLs are exposed through `routes/web-debug.ts`; UI consumers should request runtime URLs from the API instead of constructing ports or paths locally.
- The runtime response includes the current DevTools asset version. UI consumers should carry it into the `chii_app.html` query so already-running sessions do not keep using an older patched asset URL after a dev server restart.
- In dev, the client Vite server must proxy the Chii base path so browser-facing script URLs stay same-origin with the iframe page and satisfy the app CSP.
- Chii target sockets can be hidden behind the Vite proxy; keep server-side WebSocket ping enabled and do not delete a target on a stale close event while the channel manager still points to a live socket for the same id.
- Keep page metadata, favicon lookup, and ordinary webpage fetching in `services/webpage/`. Do not put debug runtime state there.
