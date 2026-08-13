# Factory Droid CLI Adapter

The `droid` adapter runs the official Factory Droid CLI over its native `stream-jsonrpc` protocol. One Works owns top-level task, permission, and workspace orchestration; Droid owns native reasoning, tool execution, and session state.

## Configuration

```yaml
adapters:
  droid:
    cli:
      source: managed
      version: 0.195.0
    effort: high
    disableBuiltinSkills: false
    configContent:
      general:
        theme: dark
```

`cli.source` supports `managed`, `system`, and `path`. Managed mode installs `@factory/cli@0.195.0` by default. System/path mode can select an existing `droid` binary, but every selected binary must satisfy `>=0.195.0 <0.196.0` and runtime protocol negotiation remains mandatory.

## Runtime behavior

- One Works starts `droid exec --input-format stream-jsonrpc --output-format stream-jsonrpc` and requires Factory API `1.0.0` with protocol `1.151.0`. A missing or incompatible version, or a malformed initialize/load response, terminates the session explicitly.
- A new conversation calls native `droid.initialize_session` and caches the Factory session id. A later process calls `droid.load_session`; a failed load never silently creates a replacement conversation.
- Text deltas, complete messages, tool calls/results, usage, hooks, child-session notices, and turn terminal events are projected into One Works events and deduplicated by native identifiers.
- Process exit records the outcome while stdout continues draining until the pipe closes; a bounded fallback prevents a broken child from hanging indefinitely. Fatal outbound RPC failures close the session once.
- Adapter diagnostics, peer RPC errors, malformed-frame context, stderr, and close logs redact injected Factory API keys and tokens before reaching runtime events, caches, or logs.
- The system prompt, selected rules/instructions, skills, MCP servers, permission mode, and `low`/`medium`/`high`/`xhigh`/`max` effort use native session parameters or isolated settings. The unsupported shared `ultra` level is rejected before Droid starts.
- Hook plugins map to Factory native hook events, while the generic bridge suppresses corresponding duplicate events.

Each One Works session receives a stable isolated `HOME`, XDG config/cache/data roots, `.factory` directory, and process working directory. The workspace path is sent only as the native session `cwd`; project `.factory/mcp.json` discovery is not trusted or loaded implicitly. The adapter does not read or copy real Factory settings, credentials, or login files. Only explicitly supplied `FACTORY_API_KEY` and `FACTORY_TOKEN` values may cross into the isolated environment. Plugins have no stable session-scoped `stream-jsonrpc` injection contract, so they are reported as skipped and are never installed into the real user HOME.

One Works remains the top-level workspace/task owner. The adapter does not enable Droid Missions, native worktrees, or additional worker orchestration.

The Factory protocol exposes `droid.fork_session`, but the current One Works adapter-session contract has no native fork operation. One Works message forks/branches continue as top-level One Works sessions with a history seed. The adapter does not claim a native fork or create a Droid worktree as a side effect.

## External-session import

The External Sessions page can scan `~/.factory/sessions/**/*.jsonl` read-only. The importer accepts only the Factory SDK session shape, retains the native session id, cwd, message parent chain, tool results, and worker/subsession classification, and supports the current project, all projects, `projectPaths`, and repeated-import deduplication.

Malformed, oversized, out-of-root, and symlinked files or source roots fail closed. The importer never reads adjacent settings files or Factory credentials and never modifies source JSONL.

## Authentication and limits

Inject `FACTORY_API_KEY` or `FACTORY_TOKEN` securely before starting One Works. The adapter does not proxy interactive login and does not copy credentials from the real `~/.factory` into the session HOME.

The model catalog currently exposes Factory's native default selection only; an explicit native model id is passed directly to Droid. Factory native plugins remain unsupported/skipped because the protocol lacks session-scoped injection.

See the [Factory Droid Exec documentation](https://docs.factory.ai/cli/droid-exec/overview) and [Adapter CLI Installation and Versions](./adapter-cli.md) for more detail.
