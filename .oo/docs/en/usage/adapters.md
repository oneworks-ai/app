# Adapter Configuration and Multiple Accounts

This page covers the adapter configuration structure in the Web configuration UI and the shared multiple-account flow.

## Configuration Entry Points

- Adapter tab: `/ui/config?tab=adapters&source=project`
- Adapter detail: `/ui/config?tab=adapters&source=project&detail=<adapter>`
- Account list: `/ui/config?tab=adapters&source=project&detail=<adapter>/accounts`
- Account detail: `/ui/config?tab=adapters&source=project&detail=<adapter>/accounts/<accountKey>`

`source` can also be `global` or `user` for cross-project defaults or local overrides.

## Frontend Selector

The adapter selector in the chat input shows the native adapters built into the current application: Claude Code, Codex, Copilot, Cursor, [DSH](./dsh-adapter.md), Gemini, Grok, Kimi, OpenCode, and Pi. Adapter configuration controls binary selection, managed CLI versions, model routing, accounts, and adapter-specific options.
The adapter selector in the chat input shows the native adapters built into the current application: Claude Code, Codex, Copilot, Cursor, Gemini, Goose, Grok, Kimi, OpenCode, and Pi. Adapter configuration controls binary selection, managed CLI versions, model routing, accounts, and adapter-specific options.
The adapter selector in the chat input shows the native adapters built into the current application: Claude Code, Cline, Codex, Copilot, Cursor, Gemini, Grok, Kimi, OpenCode, and Pi. Adapter configuration controls binary selection, managed CLI versions, model routing, accounts, and adapter-specific options.

## Cline CLI

The `cline` adapter uses Cline's public ACP entry point with a verified `3.0.54` native-resume gate and a structured
fresh-only fallback for non-gated system/path binaries. See the [Cline CLI Adapter](./cline-adapter.md) for runtime,
credential isolation, assets, and read-only history behavior.
The adapter selector in the chat input shows the native adapters built into the current application: Claude Code, Codex, Copilot, Cursor, Gemini, Grok, Kiro, Kimi, OpenCode, and Pi. Adapter configuration controls binary selection, managed CLI versions, model routing, accounts, and adapter-specific options.
The adapter selector in the chat input shows the native adapters built into the current application: Claude Code, Codex, Copilot, Cursor, Gemini, Grok, Junie, Kimi, OpenCode, and Pi. Adapter configuration controls binary selection, managed CLI versions, model routing, accounts, and adapter-specific options.
The adapter selector in the chat input shows the native adapters built into the current application: Claude Code, Codex, Copilot, Cursor, Gemini, Grok, Kimi, OpenCode, Pi, and Qwen Code. Adapter configuration controls binary selection, managed CLI versions, model routing, accounts, and adapter-specific options.
The adapter selector in the chat input shows the native adapters built into the current application: Claude Code, Codex, Copilot, Cursor, Factory Droid, Gemini, Grok, Kimi, OpenCode, and Pi. Adapter configuration controls binary selection, managed CLI versions, model routing, accounts, and adapter-specific options.

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

Both adapters invoke official CLI login and status flows. On the first managed Claude account added on macOS, One Works can reuse an existing valid machine-wide Claude.ai login from Desktop or the default CLI and record a device-bound account card without opening another login flow. This account explicitly references the default Claude home instead of pretending to be an isolated login. Other managed logins use stable, isolated `CLAUDE_CONFIG_DIR` profiles and can run concurrently with the default account and with each other. Because older macOS CLI builds may carry a Keychain login across config directories, One Works verifies the profile boundary with official status calls before login and logout; it refuses the mutation when independence cannot be proven. One Works scrubs API key, router, and settings auth overrides for both forms. Removing the default-home reference deletes only One Works' record and binding, leaving the native login on the device; removing an isolated profile runs official logout only for that profile. The account list deduplicates the same email and organization identity across Desktop and isolated sources. Claude quota prefers fresh, identity-matched local data from CLI `cachedUsageUtilization`, Desktop plan-usage history, or the same-organization usage response already cached by Desktop; the last source can provide session-start and exact reset-time details. An explicit refresh can query Anthropic usage with the current OAuth credential in memory; One Works never writes that token to its configuration or logs, rejects profile/organization mismatches, honors remote `Retry-After`, and retains a safe local value when the request fails. Desktop and CLI may share default machine authentication and configuration, but their session histories remain separate; One Works does not merge or impersonate Desktop sessions.

Codex supports managed accounts, an Auto account pool, built-in model sharing, the official-client bridge, and native configuration imports. See [Codex accounts, shared models, and client access](./codex.md) for the full configuration and behavior.

Account data is private. Do not commit it to the workspace. A base64 payload is encoded, not encrypted; a device-bound account must be authenticated again on a new device. `.claude.json` is state and cached identity/usage, not a complete credential.

## Adapter CLI and Model Routing

Native CLI installation and version pinning are covered in [Adapter CLI Installation and Versions](./adapter-cli.md).

`modelServices` is shared configuration. Each adapter maps it to the native runtime differently:

- Claude Code connects directly to known official Anthropic-compatible endpoints for Anthropic, Kimi, DeepSeek, Alibaba Qwen/Bailian, Zhipu GLM, MiniMax, OpenRouter, Requesty, Vercel AI Gateway, and Portkey; other OpenAI-compatible routed models can still use Claude Code Router.
- Codex and Gemini use adapter-owned local proxy behavior.
- Grok writes routed `service,model` selections into a session-scoped native custom model entry and supports `chat_completions`, `responses`, and `messages` backends.
- Kiro exposes only its native **Default** entry in the static selector. Generic `modelServices` are not routed into Kiro; exact native IDs are accepted only when the live Kiro session advertises them.
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

The External Sessions configuration page can preview and import Codex, Claude Code, Cursor, Goose, and Grok history for the current project or across discovered projects. Cursor transcripts are read from `~/.cursor/projects/*/agent-transcripts/**/*.jsonl`; regular chats and tasks under `subagents/` remain distinguishable. Goose is read only through public `session list` and `session export` JSON commands, never through SQLite.

Global native-history auto-import is a best-effort scan across enabled adapters, so a missing optional native CLI is reported without discarding imports from available adapters. Explicit adapter selection remains strict and actionable; mixed explicit selection retains successes and reports unavailable selections.
The External Sessions configuration page can preview and import Codex, Claude Code, Cursor, Grok, and Qwen Code history for the current project or across discovered projects. Cursor transcripts are read from `~/.cursor/projects/*/agent-transcripts/**/*.jsonl`. Qwen Code reads 0.21.11-compatible JSONL under `projects/*/chats` and `projects/*/subagents`, and uses only the record `cwd` for project ownership.

Every automatic, preview, and manual import read has a server-enforced 50 MiB per-file and aggregate ceiling. The automatic-import setting may choose a smaller per-file threshold; leaving it empty or setting it to `null` uses 50 MiB. Per-adapter settings inherit the global value when absent, while an explicit `null` uses 50 MiB. Values above 50 MiB are invalid. Manual import may read a file skipped by a smaller automatic threshold, but it cannot bypass the server ceiling.

The preview and manual-import notice distinguish rejected files, per-file ceiling skips, and files left unread after aggregate budget exhaustion. Mixed results keep successful candidates visible. If every candidate is rejected or bounded, the UI reports an incomplete scan instead of claiming that no history exists.
The External Sessions configuration page can preview and import Codex, Claude Code, Cursor, Factory Droid, and Grok history for the current project or across discovered projects. Cursor transcripts are read from `~/.cursor/projects/*/agent-transcripts/**/*.jsonl`, while Factory Droid sessions are read from `~/.factory/sessions/**/*.jsonl`; regular chats and native child tasks remain distinguishable.

Import is read-only with respect to Cursor data. The resulting completed external session retains user messages, assistant text, and tool calls, and repeated imports are deduplicated by native session id and source file. Because Cursor encodes the workspace path in its project directory name, candidates are imported only when that directory can be matched to the current project, an explicitly selected project path, or Cursor workspace metadata.

## Grok Build CLI

The `grok` adapter uses xAI's official Grok Build CLI with managed installation, model routing, MCP servers, skills, hooks, and migration of resumable native UUID sessions.

See the [Grok Build CLI Adapter](./grok-adapter.md) for full configuration, the project-shared session home, external-session import, and login boundaries. See the [JetBrains Junie CLI Adapter](./junie-adapter.md) for Junie's headless stream, native resume, isolation, hooks, Plan fallback, and unsupported history-import boundary.

## Goose CLI

The `goose` adapter uses Goose ACP for persistent structured sessions, isolated configuration, native tools, permission requests, MCP, and selected skills. See the [Goose CLI Adapter](./goose-adapter.md) for managed release verification, credential boundaries, model-service support, explicit fallbacks, and public-CLI history import.

## Kiro CLI

`kiro` uses Kiro's official ACP channel, an isolated `KIRO_HOME`, native session id/load, selected skills, stdio MCP, and native hooks. Remote MCP transports are reported as unsupported for the verified Kiro CLI 2.18.0 contract. See the [Kiro CLI Adapter](./kiro-adapter.md) for configuration, Amazon Q migration boundaries, authentication, and explicit fallbacks.

## Qwen Code CLI

The `qwen-code` adapter uses the Qwen Code 0.21.11 native headless protocol, native session ID/resume, isolated homes, skills, MCP, and native hooks. Routed models support only the verified OpenAI Chat Completions path, and the adapter never copies or links credential files from the real QWEN_HOME.

See the [Qwen Code CLI Adapter](./qwen-code-adapter.md) for version constraints, authentication boundaries, history import, and fail-closed behavior.

## Environment Boundaries

Adapters run with an isolated runtime HOME by default. The mock home is created under the project home and bridges selected directories from the real user home when needed. This keeps project runtime state isolated while still allowing native tools to find credentials or platform-specific support files.

For Git worktrees, account directories and runtime caches resolve through the project home of the main worktree when possible, so related worktrees share expected adapter state without copying it into each workspace.

## Web UI Behavior

The adapter configuration pages show inherited values from global or extended config as read-only until you explicitly override them in the current source. Scalar fields can be edited directly; collections and detail items usually require an explicit override action so the current file receives a clear local override instead of mutating the inherited source.
