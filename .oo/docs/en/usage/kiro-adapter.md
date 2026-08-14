# Kiro CLI Adapter

`kiro` runs Amazon's Kiro CLI. Kiro is the official successor to Amazon Q Developer CLI; One Works provides one `kiro` adapter and does not create a second Amazon Q adapter. The system source probes `kiro-cli` first. It accepts `q` only as a migration-era command alias when `q --version` identifies Kiro and `q acp --help` succeeds.

Kiro CLI is closed-source AWS Content licensed under the [AWS Intellectual Property License](https://kiro.dev/license/). Managed installation reads the [official Kiro stable manifest](https://prod.download.cli.kiro.dev/stable/latest/manifest.json), selects the current platform artifact, and verifies its SHA-256 checksum. Kiro's own terms also apply to installation and use.

## Configuration

```yaml
adapters:
  kiro:
    cli:
      source: managed
      version: latest
    additionalDirs:
      - /absolute/path/to/shared-context
    configContent:
      telemetry: false
    agentConfig:
      description: One Works managed Kiro agent
```

- `cli.source` supports `managed`, `system`, and `path`. An explicit path must pass both `--version` and `acp --help` probes.
- The managed source follows the release in the current manifest. Kiro does not expose a versioned stable manifest with verifiable old checksums, so another exact version fails closed instead of downloading an unverified historical artifact. Reuse and installation run under the managed-cache lock; symlinked managed roots/version ancestors, escaping real paths, and special executable entries are rejected before execution.
- `configContent` is written to the session-isolated `$KIRO_HOME/settings/cli.json`.
- `agentConfig` is merged into the isolated `oneworks` custom agent. Do not put tokens or credentials in shared configuration.
- `additionalDirs` is sent only when initialize advertises ACP additional-directories support.

Prepare the CLI ahead of time with:

```bash
oneworks adapter prepare kiro
```

## Structured Runtime and Resume

Stream sessions use only Kiro's official `kiro-cli acp --agent oneworks` JSON-RPC channel. Current Kiro documentation uses `session/prompt.content`, `session/notification`, and PascalCase update names, while the current ACP v1 specification uses `prompt`, `session/update`, and snake_case. One Works **sends only Kiro's documented format** and never guesses and re-sends the same turn. Its receiver accepts both notification names and casing variants for Kiro/ACP evolution.

The initialize response is reduced to an explicit capability matrix:

- A cached Kiro native session id is passed to `session/load` only when `loadSession: true` is advertised.
- The static selector exposes only Kiro's native **Default** entry; generic OpenAI, Anthropic, or other `modelServices` are not routed into Kiro. When Kiro session state advertises concrete native model IDs, an exact requested ID can be applied through the native session setter. A non-default ID that is absent from the session response fails startup instead of silently retaining another model. Effort setters likewise run only for an exact advertised option, and session metadata reports only Kiro's verified active effort state—not an unapplied requested value. Direct mode reports no effort because it has no verified native state response.
- Stdio MCP servers map directly to the ACP session. The Kiro CLI 2.18.0 initialize contract verified for this adapter does not advertise remote HTTP or SSE MCP transport, so selected remote servers are skipped with an asset diagnostic instead of being reported as active.
- Permission choices preserve Kiro's advertised native option IDs and scope. `dontAsk`/bypass, and write requests under `acceptEdits`, auto-allow only when Kiro offers a request-scoped `allow_once`; they fail visibly if the only allow choice is persistent. One Works remembered session/project allow or deny rules also satisfy each Kiro request only through native `allow_once` / `reject_once`, failing closed when that exact safe option is absent. Only an explicit current user choice of a native persistent option can change Kiro's persistent permission state. For default/plan, the adapter emits structured scope semantics and the client or channel renders complete English or Chinese labels, descriptions, tones, icons, and accessible action names. Channel replies accept the displayed localized label, its original native label/value, or its number; ambiguous labels are rejected rather than guessed. Unknown native options keep their native label inside a localized neutral unknown-scope frame.
- Initial prompts start only after One Works has registered the returned session response bridge, so default/plan permission questions can be answered on the first turn. `session/prompt` is a whole-turn request and has no fixed 30-second adapter timeout; it remains pending until Kiro responds, the caller cancels/times out the task, or the process exits. Cancellation settles pending permission requests before sending `session/cancel`. TurnEnd, errors, EOF, and process exit terminate once, and late requests/notifications after terminal state cannot create another UI interaction.

Kiro's `chat --no-interactive` is an official headless capability, but it is not One Works' structured stream protocol and is never presented as incremental JSON output.

Because headless/direct mode has no verified model collection or setter response, it accepts only **Default**; use the structured stream path for an exact native model advertised by Kiro.

## Assets and Isolation

Each Kiro process receives a fresh private `HOME` created atomically with mode `0700` in the platform temporary area; the session's durable `KIRO_HOME` remains under the One Works project home. Node does not expose a portable `openat`-style primitive for directory-handle-relative mkdir, removal, and symlink creation. The adapter therefore does not reuse or recursively remove a fixed `adapter-kiro/home` and does not create a filesystem macOS Keychain link. This intentionally narrower boundary has no validated-path-to-mutation window: pre-existing legacy home/Keychain paths are left untouched, while the managed cache/session root and durable native home still reject symlink ancestors, special entries, and escaping real paths.

- The system prompt and rules are staged as always-included steering referenced by the managed custom agent.
- Selected skills are staged under `$KIRO_HOME/skills`; display names are converted to a single portable POSIX/Windows-safe leaf, and the isolated root plus ancestor containment are checked before writes or links.
- Selected stdio MCP servers are passed through ACP session parameters. Remote transports remain unsupported until an explicit Kiro wire capability is verified. An explicitly selected workspace MCP name keeps precedence even when its remote transport is skipped, so a same-name session companion cannot run in its place. The managed agent disables implicit `mcp.json` loading to avoid a second configuration owner.
- Hook plugins map to Kiro's native `agentSpawn`, `userPromptSubmit`, `preToolUse`, `postToolUse`, and `stop` hooks. Overlapping generic hook-bridge events are suppressed.

One Works does not copy real `~/.kiro`, `~/.aws/amazonq`, Keychain directories, or credential files. Kiro/AWS provider variables—including `KIRO_API_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`/`FULL_URI`, `AWS_CONTAINER_AUTHORIZATION_TOKEN`/`TOKEN_FILE`, `AWS_SHARED_CREDENTIALS_FILE`, and `AWS_CONFIG_FILE`—are passed only to the current process. The last two are credential-bearing locators: AWS documents that the shared credentials file stores secrets and that the shared config file can also hold credentials or `credential_process`. Their keys, original values, raw, mixed/fully percent-encoded, nested URL/form-encoded, and common base64 equivalents are removed from both ordinary property names and values at the persistence boundary for task `base.json`, resume caches, native settings, runtime-protocol workspace-query-options caches, and diagnostic/log snapshots. The live Kiro runtime inputs are not mutated; a Kiro query-options cache hit is regenerated from the current process instead of replaying redacted credentials. Malformed percent fragments remain safe, and a very short secret causes the entire sensitive leaf or property to be removed instead of triggering global character replacement. Clearly non-secret resume settings such as `AWS_REGION` and `AWS_PROFILE` remain cacheable. Resume obtains credentials and provider file locators only from the current process or a system credential flow that Kiro itself can access; One Works does not materialize a filesystem Keychain view. If a Kiro login exists solely in an undocumented home file, authenticate the isolated profile through Kiro's official flow. The adapter does not expose a Kiro multiple-account API.

Kiro's official installer can migrate Amazon Q prompts, agents, MCP configuration, and rules, but that is Kiro-owned behavior. The adapter does not read or copy `~/.aws/amazonq`, and it does not treat legacy `q chat` as a structured runtime.

## History Boundary

One Works caches the native session id returned by ACP and resumes it with the verified `session/load` method. Kiro documents the `$KIRO_HOME/sessions/cli/*.json` and `*.jsonl` locations but does not publish a stable disk event-log schema. The External Sessions page therefore does not preview or import Kiro disk history and does not claim project discovery, all-project deduplication, or subagent history migration.

References: [Kiro ACP](https://kiro.dev/docs/cli/acp/), [Kiro headless mode](https://kiro.dev/docs/cli/headless/), [Kiro settings / `KIRO_HOME`](https://kiro.dev/docs/cli/reference/settings/), [migrating from Amazon Q](https://kiro.dev/docs/upgrade-guides/migrating-from-q/), [AWS shared config and credentials files](https://docs.aws.amazon.com/sdkref/latest/guide/file-format.html), and [ACP v1](https://agentclientprotocol.com/protocol/v1/).
