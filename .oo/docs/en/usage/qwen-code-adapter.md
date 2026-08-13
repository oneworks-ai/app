# Qwen Code CLI Adapter

The `qwen-code` adapter runs the native Qwen Code CLI. One Works manages `@qwen-code/qwen-code@0.21.11` by default, consumes the native headless `stream-json` and partial-message protocol, and stores Qwen's native session ID so later turns in the same One Works session resume it with the exact `--resume` value.

## Configuration

```yaml
adapters:
  qwen-code:
    cli:
      source: managed
      version: 0.21.11
    disableAutoUpdate: true
    disableExtensions: true
    telemetry: off
```

`cli.source` supports `managed`, `system`, and `path`. The implemented and verified version is exactly `0.21.11`. A system or explicit-path binary with any other version is rejected conservatively instead of assuming settings, routed-provider, or stream-schema compatibility.

## Runtime and sessions

- Stream mode uses `--output-format stream-json --include-partial-messages` and projects incremental text, tool calls, tool results, usage, errors, and exit events.
- Direct mode preserves the native interactive experience and recovers the native session ID from the isolated runtime chat record.
- The system prompt is written to a private session `ONEWORKS.md`. Selected skills, MCP servers, rules/instructions, and managed hooks are projected only into the isolated session directories.
- Permission modes map to Qwen Code's `default`, `plan`, `auto-edit`, `auto`, or `yolo` approval modes.
- If native resume reports session-not-found or invalid-session, the turn fails and keeps both the diagnostic and cached ID. It does not silently start a new conversation.
- Malformed or truncated streams, result errors, nonzero exits, and spawn failures fail closed. They do not fall back to another provider or report a new session as successful.

## Isolation and authentication boundary

Every One Works session gets separate `HOME`, `QWEN_HOME`, and `QWEN_RUNTIME_DIR` roots. The adapter does not link the full real QWEN_HOME and does not copy or symlink OAuth credentials, MCP tokens, or other credential files. The isolated runtime therefore cannot write new credentials back into the real home.

The verified credential bridge is `OPENAI_API_KEY`, including session-scoped injection from a One Works model service. Normal project/runtime variables such as `PATH`, locale, and proxy configuration remain available, but unrelated credential-named variables (for example GitHub, GitLab, AWS secret keys, private keys, cookies, passwords, and generic token/credential variables) are not inherited by the Qwen child. Credential values that are intentionally available to Qwen or an isolated MCP server seed runtime redaction before events, hooks, logs, and task persistence. One Works does not expose Qwen Code multiple-account management or an interactive login flow; native OAuth login through this adapter is currently unsupported.

## Model Service routing

Qwen Code routed models currently support only the verified OpenAI Chat Completions path:

```yaml
modelServices:
  qwen-openai-compatible:
    apiBaseUrl: https://provider.example.com/v1
    apiKey: <store-in-private-config>
    apiProtocol: openai-chat-completions
    models:
      - example-model
```

Selecting `qwen-openai-compatible,example-model` writes a fixed `openai` selected type and provider protocol, the exact model item ID, and the canonical `OPENAI_API_KEY` environment-variable name. The key value is passed only in the child environment and is never written to `settings.json`.

Anthropic Messages, Gemini protocols, and custom provider IDs are unsupported and fail closed in both UI filtering and runtime validation. This is version-specific: the Qwen Code 0.21.11 packaged documentation allows a custom protocol ID, but the same executable's `AUTH_ENV_MAPPINGS` can resolve authentication environment variables only for canonical providers; a custom selected type fails during authentication mapping. Until a newer upstream release passes a separate probe, this adapter promises only the OpenAI Chat Completions routed path.

## Native history import

External Sessions can preview and import Qwen Code 0.21.11-shaped `projects/*/chats/*.jsonl` and `projects/*/subagents/*/*.jsonl` read-only. The scan root uses `QWEN_RUNTIME_DIR` first, then `QWEN_HOME`, and finally the default `~/.qwen`.

Project ownership comes only from each record's `cwd`. Main-session and subagent metadata, native session ID, parent session ID, agent ID, and tool-use ID must agree. Import preserves tool calls/results and parent-child relationships, and deduplicates by native identity and source. Malformed or truncated JSONL, oversized files, symlinks, paths outside the root, and inconsistent identity records fail closed. Source files are never modified.

Qwen Code history uses the shared 50 MiB server ceiling for both each file and the aggregate bytes consumed by one preview or import request. A smaller automatic-import setting is honored; `null` uses the 50 MiB default and values above it are rejected. Manual import never bypasses the server ceiling. Files are identity-checked after open and byte-counted while reading so growth or replacement cannot evade the limit.

Preview rows and manual-import notices report malformed, changed, or unsafe files separately from files above the per-file ceiling and files left unread after the aggregate request budget is exhausted. An incomplete scan is never reported as “no history,” and aggregate exhaustion does not imply that each unread file is larger than 50 MiB. Qwen source remediation follows the same root order shown above.

See [Adapter CLI Installation and Versions](./adapter-cli.md) for installation, warmup, and environment overrides.
