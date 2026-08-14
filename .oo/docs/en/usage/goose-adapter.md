# Goose CLI Adapter

The `goose` adapter runs the official Goose CLI through its ACP stdio server. One Works owns the session orchestration boundary while Goose owns the coding-agent conversation and tool execution. The default managed version is `1.46.0`.

## Configuration

```yaml
adapters:
  goose:
    cli:
      source: managed
      version: 1.46.0
      variant: standard
      prepareOnInstall: true
    provider: anthropic
    mode: approve
    inheritNativeAuth: true
```

`cli.source` can be `managed`, `system`, or `path`. A path must be absolute. Managed installation accepts only a safe single version segment, selects the exact official platform/architecture asset, requires the release metadata's SHA-256 digest, rejects unsafe archive entries and symlinks, and atomically replaces the version directory only after `goose --version` succeeds. Managed prerelease versions must match the complete prerelease identity; build metadata is not accepted in configured release versions, while build metadata printed by the binary does not change semver identity.

## Runtime and session ownership

- One Works starts `goose acp`, creates a native session on the first process, caches its Goose session id, and uses `session/load` for later One Works resume processes. A missing or unloadable native id fails; it never silently starts a new conversation.
- ACP text, usage, tool calls, tool results, permission requests, cancellation, and terminal events are projected into the One Works runtime. Permission choices use One Works semantic decisions and are mapped back to Goose's exact native option ids. Replay notifications emitted during `session/load` are suppressed before live updates resume, and all startup and close RPCs have bounded deadlines with forced child cleanup.
- Each session receives an isolated `GOOSE_PATH_ROOT` plus isolated XDG config, data, state, and cache paths. Selected skills are linked under that root's `.agents/skills`; stdio and HTTP MCP servers are passed through ACP. Selected SSE MCP entries are skipped with a Goose diagnostic before session preparation because Goose ACP does not support that transport; direct unsupported input remains fail-closed.
- Bare stdio MCP commands are discovered with a tombstone-aware environment limited to path, shell, home, locale, proxy, certificate, platform, and temporary-directory basics. Before `goose acp` starts, One Works removes host `NODE_OPTIONS`, `NODE_PATH`, and current or legacy One Works loader state; the same boundary removes those fields from explicit MCP environments. Node module paths needed by an MCP server must therefore come from its selected command or normal package configuration, not the One Works host runtime.
- Native Goose provider credentials can be inherited only through a symlink to the existing `secrets.yaml`; credentials are not copied. The child process keeps only the selected provider's recognized authentication environment variables. A routed One Works model service receives one session-only API-key variable, and the key is not written to Goose provider JSON. Final Goose events, errors, stderr, permission prompts, terminal payloads, task-hook inputs, and persisted runtime cache artifacts redact selected credential values and encoded variants; user-visible payloads also redact the private isolated root.
- OpenAI Chat Completions and Anthropic Messages model services map to a session-scoped declarative Goose provider. Other model-service protocols are hidden or rejected.
- One Works applies the system prompt through Goose's system-prompt ACP extension and falls back to a tagged first-prompt block if that extension is unavailable.

Goose recipes and extensions are not loaded implicitly. One Works remains the single owner of selected skills, hooks, and MCP orchestration. Goose ACP does not expose a stable native hook contract, so hook plugins continue through the normalized One Works hook bridge. Recipe execution and subagent-history import are reported as unsupported instead of being simulated.

## Read-only history import

The External Sessions page reads Goose history only through the public commands:

```bash
goose session list --format json
goose session export --session-id <native-id> --format json
```

Calls have per-command and aggregate request deadlines plus independent process-output limits, validate JSON, native ids, and absolute project paths, and fail closed on command errors. The CLI is resolved once per request, and list metadata is used to filter, order, deduplicate, and page candidates before any export. Preview exports only the bounded matching page and counts raw Buffer bytes independently of line or Unicode boundaries. Production export output is streamed: content is retained only while it remains within the active serialized-size policy, while an oversized candidate is counted and reported without stopping later candidates. The bounded buffered fallback reserves 1 MiB of JSON-framing headroom beyond that policy, and every path has a 128 MiB absolute safety ceiling. Because the public export contains message and tool content, the Goose panel discloses this behavior before preview/import; content is parsed in memory and is not imported until the user chooses Import.

The configured size limit applies to preview and automatic import; the default is 50 MiB, adapter overrides inherit the global value, and explicit `null` disables that policy limit. Exact-boundary exports are accepted, while oversized candidates are reported and skipped without aborting unrelated candidates. A manual Import action may explicitly override the automatic policy limit, but the absolute process-output safety ceiling still applies. One Works discovers configured managed, system, or absolute-path binaries read-only and never installs from the history service. It never reads Goose SQLite state. Current-project, all-projects, and selected project-path scopes retain the native id and tool results, while repeat previews and imports are deduplicated. Recipe and subagent entries produce sanitized unsupported-kind diagnostics. Selecting the Goose **Subtasks** scope produces an explicit unsupported-scope diagnostic in preview and import, rather than a generic empty-history result.

Global `nativeHistoryImport.autoImport: true` is a best-effort scan: an unavailable optional Goose CLI is reported and skipped while other adapters continue. Explicit Goose-only selection, including an adapter-specific configured auto-import entry, fails actionably when the CLI is unavailable. An explicit mixed selection keeps successfully imported sessions and returns an error diagnostic for the unavailable Goose selection.

## Login and preparation

One Works does not provide a Goose multiple-account or login flow. Configure Goose with its official CLI outside the isolated session, then keep `inheritNativeAuth: true` to bridge the existing secrets file without copying it. Run `oneworks adapter prepare goose` to prepare the pinned managed binary without logging in.

See [Adapter CLI Installation and Versions](./adapter-cli.md) for shared CLI controls.
