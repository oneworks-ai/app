# Codex Accounts, Shared Models, and Client Access

Codex supports the shared account lifecycle:

```yaml
adapters:
  codex:
    defaultAccount: work
    shareBuiltinModels: true
    accountPool:
      enabled: true
      strategy: sticky-priority
      cooldownMs: 300000
    accounts:
      work:
        title: Work
        priority: 100
      personal:
        title: Personal
        authFile: /absolute/path/to/personal-auth.json
        priority: 50
      paused:
        title: Paused
        disabled: true
```

## Account Pool and Shared Models

- These accounts come from official Codex sign-in and represent ChatGPT/Codex plan accounts, not API-key profiles under `modelServices`. Enabling the pool adds **Auto** to the Codex chat account selector.
- `shareBuiltinModels` appears as **Share Codex built-in models**. It adds one `codex built-in models` group to Claude Code, Gemini, OpenCode, Kimi, Pi, and Copilot. PM injects a runtime-only Chat Completions route and credential, so users configure no host, port, protocol, or token and persistent `modelServices` stay unchanged.
- The Codex source account comes from the Auto pool, or the default account when the pool is disabled. Models are not duplicated per account.
- The account selector immediately left of Adapter always controls the active adapter's own account. For example, Claude Code still displays and selects its Claude Code account while it uses a shared Codex model; that control is not a Codex source-account selector.
- Auto considers healthy accounts in descending priority only for a newly created session. The account becomes sticky before the first assistant, tool, or interaction result, and resumes keep that physical account.
- Before that commit point, a stream session may try the next account for a recognized login, plan, rate-limit, or transient service error. Failed accounts enter a model-specific cooldown; credential updates invalidate stale cooldown state. Explicit account selections and direct mode never fail over automatically.
- The adapter-facing route uses a Responses-star structure: Chat ingress is normalized to Responses, the official `codex app-server` runs caller-registered dynamic tools, and the result is translated back to Chat while the caller adapter still executes the tools. One Works applies CLIProxyAPI's request-scoped state, call-id, and pre-result fallback lessons without copying its private ChatGPT endpoint, OAuth client identity, or client-impersonation transport.
- The route never exports `auth.json` or access tokens and never persists a Codex login as `modelServices`. It is a loopback PM capability, not a public API gateway.

## Official Codex Client Access

- The same switch enables the official-client bridge at `/api/adapters/codex/app-server` on the existing manager PM port. Managed Codex CLI and app-server-compatible clients discover this endpoint automatically.
- A local official CLI connection without a browser `Origin` uses the PM loopback boundary and needs no separate token. Browser-origin and non-loopback connections must pass PM sign-in authentication.
- Run `oneworks adapter connect codex` locally. Add `--account <account-key>` to pin a physical account; omission uses the default account. Manager environments use the current PM, integrated workspace terminals discover the manager instead of using the workspace server, and external shells read the live manager instance file. Missing managers produce an actionable error instead of a guessed fixed port.
- For a remote PM, put the bearer token in `ONEWORKS_CODEX_REMOTE_AUTH_TOKEN`. The CLI receives only the environment variable name through `--remote-auth-token-env`; the token never enters the URL or argv.
- Raw app-server RPC never switches accounts mid-connection: an omitted account stays on the default and an explicit account stays on that physical account.
- The official app-server WebSocket transport remains experimental. Prefer loopback or managed networks; non-loopback deployments require TLS and PM sign-in authentication. See the [Codex app-server documentation](https://learn.chatgpt.com/docs/app-server).

## Models, Runtime, and Imports

- Empty projects default to Codex without writing `.oo.config.json` merely to start a session.
- An existing `~/.codex/auth.json` is a read-only fallback account source; One Works does not copy or delete it automatically.
- The Web model selector uses `model_catalog_json`, then `models_cache.json`, then a packaged fallback list.
- Launcher and daemon managers reuse Codex app-server processes across workspaces when the account, startup, and process/network profiles match. Model provider, MCP, cwd, permissions, workspace/session metadata, and selected skills remain thread-scoped. The manager warms at most three configured accounts in the background and keeps idle processes for five minutes by default; `appServer.idleTimeoutMs` changes that interval.
- Managed hooks return only to the owning workspace lease. Callback capability is thread-scoped, not part of the shared process environment, and ownership is validated by lease, thread ID, and cwd.
- Direct mode keeps a session-isolated HOME. Standalone stream mode without a manager keeps a project-local fallback pool. Manager-owned streams use a machine-shared profile HOME without linking workspace skills or hooks into it.
- `network.httpProxy`, `httpsProxy`, `allProxy`, `noProxy`, and `caCertificate` affect only the Codex adapter and cover both the native process and provider forwarding. Loopback routing is always bypassed; inline CA bundles are materialized as `0600` private files.
- The Adapter import row under **Settings → Model Services** reads user-level or trusted workspace Codex providers only when the user presses **Import**. It adds missing services without modifying native Codex configuration.
- The Adapter import row under **Settings → Environment** reads bounded regular `*.toml` files under `.codex/environments`. `setup` maps to `create` and `cleanup` maps to `destroy`; Codex actions are reported as skipped because they are not One Works `start` lifecycle scripts.
- The Web UI displays cached quota snapshots. `oneworks accounts show codex <account>` explicitly refreshes account details and quota.
