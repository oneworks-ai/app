# @oneworks/plugin-relay

Optional OneWorks Relay plugin.

It connects the current workspace service to a public Relay, so phones, web clients, or other apps can discover devices and forward session messages through that Relay instead of directly reaching the local machine. Product users should normally connect to the managed OneWorks Relay service. Private `servers[]` entries are available when a user explicitly chooses to run Relay in their own cloud account or on their own host.

## Configuration

```json
{
  "plugins": [
    {
      "id": "@oneworks/plugin-relay",
      "scope": "relay",
      "options": {
        "activeServerId": "prod",
        "autoConnect": true,
        "deviceName": "Office Mac",
        "exposeSessions": true,
        "servers": [
          {
            "id": "prod",
            "name": "Private Production Relay",
            "server": "relay.example.com",
            "port": 443,
            "protocol": "https",
            "pairingToken": "prod-pairing-token"
          },
          {
            "id": "lab",
            "name": "Lab Relay",
            "server": "127.0.0.1",
            "port": 8788,
            "protocol": "http",
            "pairingToken": "lab-pairing-token"
          }
        ]
      }
    }
  ]
}
```

Even one Relay service is configured through `servers[]`; there is no separate single-server config path. Use placeholder domains in docs and examples, and keep real deployment credentials in the platform secret store or project runtime store rather than in config files.

The default product path is the managed OneWorks Relay service. Official service domains and mail routing are maintained outside plugin config: Relay/Admin hosts use the OneWorks-owned service slots, support addresses use role mailboxes such as `support@oneworks.cloud` and `hello@oneworks.cloud`, and transactional mail should use stable mail subdomains such as `mail.oneworks.cloud` rather than a Relay/Admin web host. Private `servers[]` entries should use the user's own confirmed domain, DNS, and mail strategy.

Each server can also use `baseUrl` when a full URL is easier than separate `server`, `port`, and `protocol` fields. The device identity and remote-issued device tokens are stored under the project home runtime directory, not in the project config file. Tokens are stored per server id so switching Relay systems does not overwrite another system's token.

The plugin UI can open the selected Relay Server's `/login` page. In Electron, the login redirect uses the `oneworks://relay/auth` custom scheme to return to the current workspace plugin page; in Web, the redirect returns to the current plugin route. The callback token is used only to register the current device and is then replaced by the remote-issued device token.

The official package also contributes top-level CLI commands: `oneworks login`, `oneworks users`, `oneworks users enable`, `oneworks users disable`, and `oneworks logout`. They default to the managed Cloudflare service (`-s cf`), accept `-s vercel` / `-s vc` and custom server URLs, and store local login state in `~/.oneworks/auth.json`.

For a minimal self-hosted relay service, run:

```bash
npx @oneworks/relay-server --host 0.0.0.0 --port 8788
```

## Capabilities

- Device registration and heartbeat against the configured Relay service.
- Server-hosted SSO login page launch and Web/Electron callback handling.
- Configurable `servers[]` entries with server / port, named Relay systems, pairing tokens, and capability switches.
- Scoped plugin API for status, login URL, login callback, connect, disconnect, and forget actions.
- Optional session exposure with metadata snapshots and forwarding jobs.
- Optional user-root instruction document sync for `~/AGENTS.md`, `~/.oo/AGENTS.md`, and `~/.oo/rules/**/*.md`; Relay stores only encrypted payloads plus document counts and byte sizes, and `.local.md` files stay local.
- Device token storage under the project home runtime directory.

`connect`, `disconnect`, and `forget` accept an optional `serverId` payload. `connect` without `serverId` uses `activeServerId` for compatibility; `disconnect` and `forget` without `serverId` apply to all connected/stored Relay servers. Status responses keep a top-level `connection` compatibility summary and expose per-server connection details on each `servers[]` item.

The plugin must not persist session content. Session request payloads and results are forwarded through the Relay protocol while durable state remains limited to device identity, connection state, and remote-issued tokens.

## Source Layout

- `src/client/`: plugin UI entry.
- `src/server/api.ts`: scoped plugin API handlers.
- `src/server/controller.ts`: lifecycle and connect / disconnect / forget orchestration.
- `src/server/heartbeat.ts`: registration and heartbeat loop.
- `src/server/options.ts`: multi-server config normalization.
- `src/server/session-worker.ts`: session snapshot and job forwarding worker.
- `src/server/session-relay-client.ts`: remote Relay session API client.
- `src/server/store.ts`: device identity and token persistence.
- `__tests__/`: module-split tests for API, controller, heartbeat, sessions, and worker behavior.

## Development

```bash
pnpm -C packages/plugins/relay test
pnpm -C packages/plugins/relay typecheck
pnpm -C packages/plugins/relay build
```
