# Cline CLI Adapter

The `cline` adapter uses Cline's public ACP entry point for persistent structured sessions. The managed runtime is
pinned to Cline CLI `3.0.54`, the version whose ACP protocol, native session loading, cancellation, permissions, and
history artifacts are covered by the adapter contract tests.

```yaml
adapters:
  cline:
    cli:
      source: managed
      version: 3.0.54
    authMethod: cline
    # Optional; omit to let task stop/kill own the human OAuth lifetime.
    authTimeoutMs: 600000
    telemetry: off
```

`authMethod` is an explicit choice from the pinned CLI's advertised agent-owned ACP methods: `cline`, `cline-pass`,
or `openai-codex`. Omit it to choose from the advertised methods at session startup. As an alternative for a verified
provider, select exactly which current-process credential variables may be passed:

```yaml
adapters:
  cline:
    provider: openai
    credentialEnv: [OPENAI_API_KEY]
```

For API-key providers, the selected source variable is mapped to Cline's verified `CLINE_API_KEY` process contract;
that form is already accepted by the upstream ACP readiness gate and cannot be combined with `authMethod`.
Bedrock and Vertex are different: selected AWS/Google native variables are delivered process-only, but do not satisfy
ACP readiness by themselves. Each create or cross-process load must still complete an explicitly configured, cached,
or interactively selected advertised `authMethod`. If the pinned CLI advertises no verified method, the adapter fails
before `newSession` / `loadSession` instead of treating provider variables as authentication.

Authentication-method choice and `authenticate` do not use the 20-second control-RPC deadline: a first-time browser
OAuth flow may wait for a human callback. The adapter returns a stoppable session handle and reports an in-progress
authentication operation before waiting. By default, task stop/kill or child exit owns cancellation. Set
`authTimeoutMs` (minimum 60 seconds) only
when an explicit bounded authentication policy is required. Cancellation, exit, and timeout produce one terminal
settlement and do not persist tokens.

## Runtime and resume boundary

- Managed sessions require ACP protocol version `1`, `agentInfo.name: cline`, native `loadSession`, and CLI version
  `3.0.54`. One Works caches Cline's native session id and loads it in a later Cline process.
- A `system` or `path` binary that does not satisfy that gate is fresh-only. It uses Cline's structured `--json`
  mode and never combines `--json` with `--id` or parses terminal UI output.
- A managed binary that fails the gate stops with an error instead of silently weakening resume behavior.
- If Cline reports a normal ACP `end_turn` without text, tool, or result output, One Works fails the turn with a
  generic message. Cline 3.0.54 does not expose the underlying provider error in that case, so One Works does not
  guess an HTTP or provider cause.
- Native permissions select request-scoped `allow_once` / `reject_once` only. Even stored One Works session/project
  decisions never select Cline's persistent `allow_always`; a request is visibly cancelled when `allow_once` is absent.
- Fresh-only `dontAsk` and `bypassPermissions` use Cline's verified `--yolo` mode, while `plan` keeps `--plan`.
  `default` and `acceptEdits` require an interactive responder and therefore fail before a fresh JSON child is spawned.
- ACP `usage_update.used` is current context occupancy, not cumulative input tokens. The shared usage contract cannot
  represent it accurately, so the adapter omits the value with a nonfatal diagnostic instead of inventing tokens/cost.

## Isolation and native assets

Each session gets an isolated home and Cline configuration directory. Native session data is project-private and
stable across One Works processes so verified ACP resume can load the native id. `provider` is passed only through
Cline 3.0.54's official `--provider` flag. Model selection is currently limited to Cline's native `Default`; One Works
service models are not forwarded as Cline model ids. Before `newSession` or `loadSession`, the adapter validates the
pinned CLI's advertised authentication methods and calls `authenticate` only after an explicit configured, cached
prior explicit, or interactive choice. It never silently selects an external login.

`inheritNativeAuth` remains unsupported: One Works does not inspect or copy another Cline store. Ambient provider,
Git, and internal credential variables are removed from the isolated child. `credentialEnv` is an explicit
current-process exception limited to the selected provider's verified Cline 3.0.54 variables (including selected
Bedrock/Vertex file locators); values are passed only to the child process and are never written to config, cache,
hooks, or logs. AWS/Google native variables never suppress the ACP authentication step.

Selected skills are staged into Cline's native skills directory. The One Works system prompt is added as a native
rule; replacing Cline's built-in system prompt is not supported. Cline 3.0.54 accepted ACP MCP arguments and a
`--hooks-dir`, but isolated probes did not show an observable MCP connection or native hook execution. Selected MCP
servers therefore report `skipped`; unified hook plugins use the One Works event-bridge fallback and do not claim
native Cline hook support.

## Native history

The External Sessions panel can preview and import Cline history from `~/.cline/data`. The importer opens only
`db/sessions.db` and the messages artifacts explicitly referenced by its session rows. SQLite is opened read-only and
query-only; mutable WAL/SHM sidecars, symlinks, traversal, oversized files, locks, corrupt databases, and unsupported
schemas fail closed. Provider settings, general configuration, and credential files are never read.

Messages artifacts must also match the verified Cline 3.0.54 `version: 1` and `origin` discriminators. Unknown,
missing, or mixed versions are diagnosed during preview and skipped without partial import. Preview and import use
the same server-owned file-size limit.

Imported history keeps the native session id and project ownership. Parent links are source-root/project scoped and
are emitted only when the parent is included or already exists, so a subagent-only import cannot create dangling
navigation. Incremental parent-first/child-only imports resolve the durable existing parent, while child-first imports
retain only non-secret native correlation metadata so a later parent import can repair the link. Ambiguous duplicate
native ids across roots fail closed. Tool results require one unique earlier retained
`tool_use_id` in the same artifact; missing, future, duplicate, or mismatched relationships reject the session.
Image-only replay placeholders are shown as unavailable content rather than fabricated tool output. Native source
artifacts remain untouched.

Run `oneworks adapter prepare cline` to prepare the managed CLI. See
[Adapter CLI Installation and Versions](./adapter-cli.md) for source and binary overrides.
