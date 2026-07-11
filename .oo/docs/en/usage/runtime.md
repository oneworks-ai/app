# Start Services

## Start the Web UI

Run from your project root:

```bash
npx oneworks web
```

By default it:

- resolves the current workspace root
- starts a built-in server
- serves the built-in Web UI
- prints a client URL, usually `http://127.0.0.1:8787/ui/`

Common options:

```bash
npx oneworks web --workspace /path/to/project --config-dir /path/to/project/infra
```

## Start a Headless Server

Use this when a standalone PWA, static site, or another app should connect to the current project:

```bash
npx oneworks server
```

The server exposes only the control plane and does not mount the Web UI. Common options:

```bash
npx oneworks server --host 0.0.0.0 --port 8787 --allow-cors
```

Standalone PWA or static client deployments are usually cross-origin. If the server is only used behind a local tunnel or reverse proxy, start it with:

```bash
npx oneworks server --allow-cors
```

## Source Development UI Server and Client

This section is only for developing the One Works repository itself. Project integrations should prefer:

```bash
npx oneworks web
```

From the One Works repository root, after `pnpm install`:

```bash
pnpm --silent tools dev-service ensure web --json
```

The unified launcher stores the server database, runtime store, mock home, cache, and startup logs under the current development instance project home, normally `~/.oneworks/dev-instances/<worktree-key>/projects/<project-key>`. This keeps repository workspaces clean and prevents parallel source worktrees from sharing the same local state.

To update the current source worktree and start a development service:

```bash
pnpm --silent tools dev-service ensure <target> --json
```

Targets include `web`, `daemon`, `electron`, `electron-workspace`, `pwa`, `homepage`, `docs`, `relay`, `desktop-control`, and `android-emulator`. The launcher registers TypeScript through `scripts/run-tools.mjs`, installs missing register dependencies when needed, safely fetches and aligns the worktree when possible, checks workspace install state, starts services in the background under an operation lease, avoids busy ports, and prints machine-readable readiness state.

Notes:

- Web development defaults to server `8787` and client `5173`. If the default ports are busy, the launcher picks available ports unless explicit port environment variables are set.
- `oneworks-client` development mode depends on local source and workspace install state. It is not the general runtime path for the npm package.
- Outside development mode, `@oneworks/client` serves built `dist` directly and no longer depends on `vite preview`.

## Runtime Directories

- `__ONEWORKS_PROJECT_WORKSPACE_FOLDER__` points to the project root.
- If it is not set, `@oneworks/web`, `@oneworks/server`, `oneworks-server`, and `oneworks-client` walk up from the current directory and look for `.oo`, `.oo.config.*`, `pnpm-workspace.yaml`, or a Git root.
- Project config follows the resolved workspace root by default. Set `__ONEWORKS_PROJECT_CONFIG_DIR__` to move config files.
- `__ONEWORKS_PROJECT_BASE_DIR__` defaults to `.oo` and can be set to `.oneworks`, `.oo`, or another project asset directory.
- `__ONEWORKS_PROJECT_CACHE_DIR__` overrides the shared project cache. Without it, reusable adapter CLI and skill dependency resources are stored under `~/.oneworks/projects/<project-key>/caches`.
- Without `DB_PATH`, the server SQLite database is stored at `~/.oneworks/projects/<project-key>/.local/server/db.sqlite`; the runtime store is stored under `~/.oneworks/projects/<project-key>/runtime`.
- Multiple worktrees of the same Git project share a project key by default. Different projects do not share runtime data.
- In Git worktrees, project cache, server database, mock home, logs, and runtime store follow `__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__` when set; otherwise One Works resolves the main worktree from the Git common dir.
- `__ONEWORKS_PROJECT_ENTITIES_DIR__` defaults to `entities` and is resolved under the AI base directory.

## Adapter CLI Installation and Versions

Managed native adapter CLI installation, pinned versions, warmup, and environment overrides are documented in [Adapter CLI Installation and Versions](./adapter-cli.md).

## Web Authentication and Runtime Mapping

- Web authentication is disabled by default when the server binds to `localhost`, `127.*`, or `::1`; it is enabled by default when the server binds to `0.0.0.0`, a LAN IP, or a domain.
- Multiple accounts can be configured:

```yaml
webAuth:
  enabled: true
  rememberDeviceTtlDays: 30
  accounts:
    - username: alice
      password: change-me
    - username: bob
      password: change-me-too
```

- If no `webAuth.accounts` or `webAuth.password` is configured, the server generates `web-auth-password` in the data directory and uses `admin` as the default username.
- Temporary disable:

```yaml
webAuth:
  enabled: false
```

- `HOME` isolates runtime state. It defaults to the `.mock` directory under the project home. Startup bridges common dot directories from the real home and macOS Keychain/Application Support paths into the mock home.
- `modelServices` is shared configuration. Each adapter maps it to its native runtime:
  - `claude-code` connects directly to known official Anthropic-compatible endpoints for Anthropic, Kimi, DeepSeek, Alibaba Qwen/Bailian, Zhipu GLM, MiniMax, OpenRouter, Requesty, Vercel AI Gateway, and Portkey; other OpenAI-compatible `service,model` selections fall back to Claude Code Router.
  - `codex` and `gemini` use adapter-owned local proxies.
  - some adapters write provider config into session-level or native config files.
- Coding Plan and Token Plan mean provider billing products, not agent Plan Mode. Prefer dedicated provider ids such as `qwen-coding-plan`, `zhipu-coding-plan`, `minimax-token-plan`, `kimi-code`, `tencent-tokenhub-coding-plan`, `volcengine-ark-coding-plan`, and `baidu-qianfan-coding-plan`; do not mix plan keys with ordinary API keys or plan base URLs with ordinary API base URLs.
- Plan model lists come from the built-in catalog by default and do not assume `/v1/models` works. Write `models` only when you want a fixed allowlist:

```yaml
modelServices:
  qwen-coding:
    provider: qwen-coding-plan
    apiKey: ${ALIYUN_CODING_PLAN_KEY}

  minimax-token:
    provider: minimax-token-plan
    apiKey: ${MINIMAX_SUBSCRIPTION_KEY}
```

- If no routed `service,model` is selected, adapters keep using their native model and binary selection.

## Default Built-in MCP

- `oneworks` and server sessions load the built-in `OneWorks` MCP server by default.
- Disable for one run:

```bash
oneworks --no-default-oneworks-mcp-server "..."
```

- Disable globally:

```yaml
noDefaultOneWorksMcpServer: true
```
