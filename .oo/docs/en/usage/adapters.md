# Adapter Configuration and Multiple Accounts

This page covers the adapter configuration structure in the Web configuration UI and the shared multiple-account flow.

## Configuration Entry Points

- Adapter tab: `/ui/config?tab=adapters&source=project`
- Adapter detail: `/ui/config?tab=adapters&source=project&detail=<adapter>`
- Account list: `/ui/config?tab=adapters&source=project&detail=<adapter>/accounts`
- Account detail: `/ui/config?tab=adapters&source=project&detail=<adapter>/accounts/<accountKey>`

`source` can also be `global` or `user` for cross-project defaults or local overrides.

## Frontend Selector

The adapter selector in the chat input shows the native adapters built into the current application: Claude Code, Codex, Copilot, Cursor, Gemini, Kimi, OpenCode, and Pi. Adapter configuration controls binary selection, managed CLI versions, model routing, accounts, and adapter-specific options.

## Pi coding-agent

The `pi` adapter runs persistent sessions through Pi JSONL RPC, manages `@earendil-works/pi-coding-agent@0.84.1` by default, and can reuse Pi's native/default provider or a session-private model service.
See the [Pi coding-agent Adapter](./pi-adapter.md) for complete configuration, native credential inheritance, security and runtime boundaries, and CLI preparation.

## Multiple Accounts

Adapters share one account lifecycle contract, while each adapter owns credential persistence. Managed Codex and Claude Code accounts are stored in the global `~/.oneworks/.oo.config.json` so they can be reused across projects. Adapters that return account artifacts may still use the project home:

```text
<project-home>/.local/adapters/<adapter>/accounts/<accountKey>/
```

For Codex and Claude Code:

```bash
oneworks accounts add codex
oneworks accounts add codex work
oneworks accounts show codex work
oneworks accounts remove codex work
oneworks accounts add claude-code work
oneworks accounts show claude-code work
oneworks accounts remove claude-code work
```

Both adapters invoke official CLI login and status flows. Removal may invoke official logout only for portable credentials on a platform where the managed account is isolated. Claude Code gives each managed account a stable, isolated `CLAUDE_CONFIG_DIR`; macOS Keychain credentials remain device-bound, while an official `.credentials.json` can be stored as a portable snapshot. Removing a macOS or other device-bound account deletes only One Works' record and binding: the native login remains on that device. An explicit `claude auth logout` is a machine-level operation that affects the device's native login. Claude quota information comes only from the local `cachedUsageUtilization` snapshot.

Codex supports managed accounts, an Auto account pool, built-in model sharing, the official-client bridge, and native configuration imports. See [Codex accounts, shared models, and client access](./codex.md) for the full configuration and behavior.

Account data is private. Do not commit it to the workspace. A base64 payload is encoded, not encrypted; a device-bound account must be authenticated again on a new device. `.claude.json` is state and cached identity/usage, not a complete credential.

## Adapter CLI and Model Routing

Native CLI installation and version pinning are covered in [Adapter CLI Installation and Versions](./adapter-cli.md).

`modelServices` is shared configuration. Each adapter maps it to the native runtime differently:

- Claude Code connects directly to known official Anthropic-compatible endpoints for Anthropic, Kimi, DeepSeek, Alibaba Qwen/Bailian, Zhipu GLM, MiniMax, OpenRouter, Requesty, Vercel AI Gateway, and Portkey; other OpenAI-compatible routed models can still use Claude Code Router.
- Codex and Gemini use adapter-owned local proxy behavior.
- Some adapters write provider configuration to native config files or session-level state.

Workspaces launched by a Launcher or daemon manager reuse a manager-owned Codex app-server
across workspaces when the account, binary/startup, and effective process/network profile match.
Model provider, MCP, working directory, permissions, One Works workspace/session runtime
metadata, and selected skills are sent per thread, so switching workspaces or providers alone
does not restart the process. Other process-level environment differences form distinct profiles.
After the manager is ready, it warms at most three default/configured account profiles in the
background without delaying Launcher startup. An unused app-server remains available for five
minutes by default; configure `adapters.codex.appServer.idleTimeoutMs` to change that interval.

One Works managed hooks return through the manager and execute only in the workspace that owns
the Codex lease. The callback capability is injected into thread config instead of the shared
app-server process environment. After registration, ownership is checked by lease, thread ID, and
working directory; the brief thread-creation window allows only a pending setup in that same lease
to bind by working directory. Native `<workspace>/.codex/hooks.json` files are still discovered by
Codex from the thread working directory. Direct mode remains session-isolated, and standalone
stream mode without a manager keeps the project-local fallback pool.

Adapter-specific network settings are available under `adapters.codex.network`:
`httpProxy`, `httpsProxy`, `allProxy`, `noProxy`, and `caCertificate`. They apply to both
the native Codex process and One Works' routed provider requests without changing the
whole One Works server environment. Loopback hosts are always bypassed so Codex can reach
the adapter-owned local routing proxy. `caCertificate` accepts either a PEM bundle path or
inline PEM; inline content is materialized as a private file before the native process starts.

If no routed model is selected, the adapter continues to use its native model and binary defaults.

The bottom of **Settings → Model Services** contains a dedicated import row. Its
searchable selector lists only adapters whose packages expose model-service import
capability; choose an adapter on the left and press **Import** on the right. The
selected adapter declares which Global, Project, or User sources it supports.

When the user-level `CODEX_HOME/config.toml` or `~/.codex/config.toml` defines
`model_provider`, `model_providers`, or `openai_base_url`, select **Global**, choose
**Codex config.toml** in that row, and press **Import**. Selecting **Project** imports
provider fields from trusted workspace
`.codex/config.toml` files into the project `.oo.config.*` source.
Native Codex ignores provider and authentication keys at project scope, but One
Works uses the migrated result with its normal `global < project < user`
precedence. Untrusted project layers are skipped, and global/user provider values
are not expanded into the project file.

Import happens only when the button is pressed. Existing One Works services in
the selected source take precedence, and native Codex files are not modified. Codex-only
authentication, AWS, header, query, and retry settings are preserved under the
imported service's `extra.codex` configuration.

The bottom of **Settings → Environment** uses the same generic adapter-import
interaction, with Project and User as the supported destinations. Selecting Codex
discovers bounded regular `*.toml` files in the current workspace's
`.codex/environments` directory, including default, numbered, and named environments.
Codex `setup` scripts map to One Works `create` scripts, while `cleanup` maps to
`destroy`; a matching platform script overrides the default script. An empty base
script is treated as absent, so a platform-only lifecycle script can still be imported.
Environment IDs ending in `.local` (case-insensitive) are normalized because that
suffix is reserved for One Works' User-source display semantics.

Codex environment actions are not lifecycle `start` scripts, so they are reported as
skipped rather than migrated incorrectly. Import creates only missing environments,
never merges into or overwrites an existing environment directory, and never modifies
the native TOML files.

## Cursor

The `cursor` adapter runs Cursor Agent CLI. One Works installs an official managed CLI build by default, or it can use a system `agent` / `cursor-agent` binary or an explicit path.

```yaml
adapters:
  cursor:
    cli:
      source: managed
      version: latest
    mode: agent
    approveMcps: true
```

Stream sessions consume Cursor's JSON output and retain the native chat id, so later One Works turns resume the same Cursor chat. System instructions, selected skills, MCP servers, and hooks are staged in an isolated per-session Cursor config/data directory instead of modifying the real `~/.cursor`. Options such as `force`, `autoReview`, `approveMcps`, `sandbox`, `endpoint`, `additionalDirs`, `pluginDirs`, and `headers` map to Cursor Agent CLI flags. Cursor authentication remains managed by Cursor Agent CLI; One Works does not expose Cursor accounts through its multiple-account API.

## Migrating Native Sessions

The External Sessions configuration page can preview and import Codex, Claude Code, and Cursor history for the current project or across discovered projects. Cursor transcripts are read from `~/.cursor/projects/*/agent-transcripts/**/*.jsonl`; regular chats and tasks under `subagents/` remain distinguishable.

Import is read-only with respect to Cursor data. The resulting completed external session retains user messages, assistant text, and tool calls, and repeated imports are deduplicated by native session id and source file. Because Cursor encodes the workspace path in its project directory name, candidates are imported only when that directory can be matched to the current project, an explicitly selected project path, or Cursor workspace metadata.

## Environment Boundaries

Adapters run with an isolated runtime HOME by default. The mock home is created under the project home and bridges selected directories from the real user home when needed. This keeps project runtime state isolated while still allowing native tools to find credentials or platform-specific support files.

For Git worktrees, account directories and runtime caches resolve through the project home of the main worktree when possible, so related worktrees share expected adapter state without copying it into each workspace.

## Web UI Behavior

The adapter configuration pages show inherited values from global or extended config as read-only until you explicitly override them in the current source. Scalar fields can be edited directly; collections and detail items usually require an explicit override action so the current file receives a clear local override instead of mutating the inherited source.
