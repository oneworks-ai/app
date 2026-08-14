# JetBrains Junie CLI Adapter

The `junie` adapter uses the non-interactive headless mode of JetBrains' official `@jetbrains/junie` CLI. One Works manages package `2651.4.0` by default and conservatively accepts its reported `26.8.x (2651.4)` protocol family. An incompatible CLI or wire event shape fails explicitly; TUI text is never treated as a stable protocol.

## Configuration

```yaml
adapters:
  junie:
    cli:
      source: managed
      version: 2651.4.0
      prepareOnInstall: true
    provider: openai
    effort: high
    review: false
    agentMode: classic
    disableAutoUpdate: true
    shareAnonymousStatistics: false
```

`provider` selects Junie's BYOK provider only. Credentials must come from an officially supported `JUNIE_API_KEY` / `JUNIE_*_API_KEY` environment variable or the operating-system credential store. One Works model services are neither translated nor routed into a Junie provider and do not appear in the Junie selector; use Junie's native model/provider configuration instead. `configContent` is for non-secret Junie settings. Before the shared task `base.json` cache or Junie's staged session config is persisted, One Works omits credential-like keys, direct secret scalars below `byok`, token-shaped values, and URI/form/base64/embedded JSON/raw credential representations from every Junie config view while retaining legitimate nonsecret content. This applies to every configured adapter instance whose effective package/runtime identity resolves to Junie—including custom keys using `packageId` or a Junie package root—in every shared config, asset-config, layer, and raw/resolved source view even when the current task selects another adapter; a key effectively overridden or tombstoned to another runtime and that other adapter's own `configContent` are not changed by the Junie policy. Mixed credential URLs are scrubbed completely across userinfo, query, path, and fragment positions without dropping unrelated routing content. This pure clone scrub does not mutate the live runtime config object, but credentials in `configContent` are not a supported authentication path. Authentication flags are also blocked in `extraOptions` so secrets do not enter recorded process arguments.

The complete `--effort` set advertised by the official 26.8.10 (2651.4) `--help` is `low`, `medium`, and `high`. The same three values drive Default-model metadata, the config schema, the client selector, and runtime validation. Unadvertised values such as `max` are not shown, and an unsupported persisted configuration or request fails before child-process spawn rather than being silently mapped. Advanced args cannot override adapter-owned model/provider/review/agent-mode, update/privacy, session/prompt/project, path/asset, authentication, or input/output settings. Their split/equal/case/repeated forms, the official `-a` / `-c` / `-p` aliases, conservatively reserved effort aliases, and the `--` argument terminator are rejected before preparation or spawn. Safe Junie options such as `--verbose` remain available; the adapter emits each controlled value only from its validated shared source.

## Sessions and output

- The default path uses `json-stream`. A native id from a `session` event remains tentative until the same turn has a confirmed `result`, no later failure/terminal protocol error, and normal process completion. Only then is it stored in the One Works session cache. Later turns use the exact `--session-id=<id> --resume` pair; a returned-id mismatch fails without mutating the cache.
- Omitting `mode` still selects stream, so the default new-session path has a verified “new → cache native id → resume” lifecycle.
- `mode: direct` is an explicit terminal/headless-text path. Junie text output has no verified session-id event, so a new direct session reports a nonfatal limitation and cannot promise later recovery. Direct resume is available only after stream mode has already cached the native id for the same One Works session.
- The pinned release's stable wire schema is `CliStreamEvent`, with `session`, `step`, `system`, `error`, and `result` records. It exposes structured step-level progress rather than token deltas. Named steps map to tool start/result events; unnamed steps and system/result records map to assistant messages. A successful terminal must carry the descriptor-required string `result` and the serialized `errorCode` array; despite that wire name, this field contains `LlmUsageOutput` entries with required `model` and `calls` fields, not a process error code. Exit zero with a missing, malformed, incompatible, or truncated terminal is an incomplete stream and cannot commit the native id. Ordinary nonterminal events after a valid `result` are deterministically diagnosed and ignored; a later failure/terminal-shaped or malformed result event invalidates success. Unknown ordinary EAP-shaped types are diagnosed and tolerated. Unknown failure/terminal-shaped types, a missing session id, truncated JSON, an empty stream, and an incompatible CLI version fail explicitly.
- Cancellation sends `SIGINT` to the active child, waits for closure, and emits only one terminal/exit result.

The checked-in protocol fixture is a sanitized synthetic sequence derived from `CliStreamEvent` / `OutputWriter` and underlying A2UX class and field descriptors in the official `2651.4.0` JAR. It is not a captured CLI transcript, and raw A2UX objects are not presented as wire output. A fake CLI additionally verifies arbitrary chunking, multiple events per chunk, multi-turn resume, cancellation, spawn errors, nonzero exits, EOF without `result`, malformed/truncated `result` and `errorCode` records on create and resume, late terminal events, resume-id mismatch, duplicate terminal events, cache-commit boundaries, persisted-config scrubbing, and child-environment isolation.

## Isolation, assets, and hooks

Each One Works session receives its own HOME, JUNIE_DATA, XDG config/data/cache, Junie cache, explicit config, and asset directories under project home. Managed installation also uses an isolated install HOME under the One Works bootstrap cache. A system source only resolves the actual executable behind the official launcher; the real Junie data/config directory is not mounted into the running session. Default user/project discovery for config, MCP, skills, commands, agents, and models is disabled; only selected session assets are passed through explicit paths.

- System prompts and rules/instructions are staged in an explicit `--ide-guidelines` file.
- Selected MCP servers are written to an isolated `mcp.json`; selected skills and agents are exposed only through session symlinks and `--skill-location` / `--agent-location`.
- Native headless hooks cover `SessionStart`, `PreToolUse`, `Stop`, `StopFailure`, and `SessionEnd`. `PreToolUse` preserves deny/ask decisions, `StopFailure` is observability-only as required upstream, and `SessionEnd` handles cleanup. Headless Junie does not trigger `UserPromptSubmit`, and no verified `PostToolUse` event exists, so those capabilities are not claimed.
- The upstream batch host also exposes `PermissionRequest`, but One Works has no distinct normalized hook with that name today. The adapter does not map it to a second `PreToolUse` invocation and run policy twice for one tool call; native `PreToolUse` currently owns permission deny/ask enforcement.
- Junie's `--plan` is interactive-only. One Works plan permission degrades to a mandatory read-only planning instruction in headless mode; it is not presented as native Plan Mode or as a process sandbox.
- `review: true` maps to native `--review`. Junie still schedules its own subagents. The pinned `CliStreamEvent` flattens internal A2UX blocks into generic steps and exposes no stable subagent id/parent/task wire fields, so the adapter does not invent operation or child-task relationships.

## Authentication and BYOK boundary

One Works does not log in to a JetBrains account, store a Junie token, or copy/link the entire `~/.junie` directory. The child environment is built from an empty object and contains only required PATH/locale/platform basics, explicit nonsecret One Works project/hook entries, isolated HOME/JUNIE_HOME/JUNIE_DATA/XDG paths, and `JUNIE_API_KEY`. Only the configured provider receives that provider's `JUNIE_*_API_KEY` and corresponding standard variable confirmed in the official JAR (plus the LiteLLM URL). Unrelated OPENAI/AWS/AZURE/Git/internal secrets are not inherited. Authentication env is refreshed before every turn. Before a Junie task's shared `base.json` is written, every supported Junie/account/provider authentication key is removed from the cloned environment and known long credential echoes are scrubbed from encoded/config representations; the live runtime context and selected create/resume child environment remain unchanged. Nonsecret PATH, locale, proxy, and One Works routing metadata remain in the cache clone. On Linux, only a shape-validated local `DBUS_SESSION_BUS_ADDRESS` and absolute `XDG_RUNTIME_DIR` are preserved so the native user-session credential service remains addressable; invalid or non-Linux values are omitted, and these locators do not broaden ambient environment inheritance. No keychain or credential-store files are copied. Keys are never written to arguments, persisted session config, cache, hook, or session files, and the isolated session paths never write back to the real user directory. Complete first-time authentication outside One Works, or provide an officially supported token/BYOK environment variable when starting One Works.

## History import and current confidence

Junie does not appear in External Sessions preview/import. The official release contains events, transcript, and subagent files, but no stable, verified public history schema. One Works therefore does not guess project ownership, deduplication, or subtask relationships.

Official `--help` / `--version` probes, `CliStreamEvent` / `OutputWriter` descriptor inspection, and the isolated fake lifecycle are complete. No real account login or authenticated end-to-end Junie CLI lifecycle smoke was performed. Confidence in version checks, arguments, isolation, failure parsing, and process cleanup comes from the official release descriptors and deterministic automation; the complete step mix and rendered text returned by a real authenticated provider remain an explicit independent-verification risk.

See [Adapter CLI Installation and Versions](./adapter-cli.md) for prepare commands and environment overrides.
