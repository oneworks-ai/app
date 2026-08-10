# Pi coding-agent adapter

Status: implemented\
Upstream revision: `368e013dec766724d892cfa5cc247d2f2bee8795` (`@earendil-works/pi-coding-agent` 0.84.1)\
Reviewed: 2026-08-09

## Goal

Let an existing One Works session start, resume, steer, interrupt, render, and safely consume Pi coding-agent without introducing a second product workflow. Pi remains the agent runtime; One Works remains the owner of session selection, workspace assets, model-service routing, permissions, normalized events, and UI.

## Upstream environment and settings

- Runtime: Node.js `>=22.19.0`, ESM, with the `pi` binary from `@earendil-works/pi-coding-agent`.
- Recommended installation: npm with lifecycle scripts disabled. Pi does not need install scripts for normal npm installs.
- Stable embedding seam: `pi --mode rpc`, a bidirectional JSONL protocol over stdin/stdout. Records are LF-delimited; U+2028 and U+2029 are ordinary JSON characters and must not be treated as record separators.
- Session state: JSONL files selected by `--session-id` and stored under `--session-dir`. A One Works UUID is a valid Pi session ID.
- Configuration: `PI_CODING_AGENT_DIR` (default `~/.pi/agent`), `settings.json`, `auth.json`, and `models.json`. Project settings live at `.pi/settings.json` when project resources are trusted.
- Authentication: provider environment variables or Pi's `auth.json` populated by `/login`.
- Model selection: `--provider`, `--model`, and `--thinking`; custom OpenAI-, Anthropic-, and Google-compatible services are described in `models.json`.
- Resources: explicit `--skill` and `--extension` paths can be loaded while automatic discovery is disabled. Extensions have full process privileges and therefore must not be inherited silently.
- Safety/network controls: `--approve`/`--no-approve`, `PI_OFFLINE`, `PI_TELEMETRY`, and `PI_SKIP_VERSION_CHECK`.
- Built-in tools: `read`, `bash`, `edit`, and `write`; `grep`, `find`, and `ls` are available when requested.
- Pi has no built-in MCP client. MCP can only be added through an extension, so V1 reports selected MCP assets as skipped instead of claiming false parity.

Primary sources:

- [coding-agent README](https://github.com/earendil-works/pi/blob/368e013dec766724d892cfa5cc247d2f2bee8795/packages/coding-agent/README.md)
- [package manifest](https://github.com/earendil-works/pi/blob/368e013dec766724d892cfa5cc247d2f2bee8795/packages/coding-agent/package.json)
- [RPC protocol](https://github.com/earendil-works/pi/blob/368e013dec766724d892cfa5cc247d2f2bee8795/packages/coding-agent/docs/rpc.md)
- [settings](https://github.com/earendil-works/pi/blob/368e013dec766724d892cfa5cc247d2f2bee8795/packages/coding-agent/docs/settings.md)
- [custom models](https://github.com/earendil-works/pi/blob/368e013dec766724d892cfa5cc247d2f2bee8795/packages/coding-agent/docs/models.md)
- [skills](https://github.com/earendil-works/pi/blob/368e013dec766724d892cfa5cc247d2f2bee8795/packages/coding-agent/docs/skills.md)
- [extensions](https://github.com/earendil-works/pi/blob/368e013dec766724d892cfa5cc247d2f2bee8795/packages/coding-agent/docs/extensions.md)
- [security](https://github.com/earendil-works/pi/blob/368e013dec766724d892cfa5cc247d2f2bee8795/packages/coding-agent/docs/security.md)

## Change Brief

### Current behavior

One Works discovers and loads built-in adapters through the shared adapter contract. Pi is absent from the runtime registry, desktop package closure, adapter selector, workspace-asset capability map, and managed CLI preparation flow.

### Proposed behavior

Add `@oneworks/adapter-pi` as a deep adapter module. It owns Pi CLI preparation, isolated native configuration, model-service translation, strict RPC transport, event normalization, permission interaction, and direct-mode startup. Existing task, server, client, and hook layers continue consuming the unchanged Adapter interface.

### Invariants

- No writes back to real Pi profile data or session files. When a real `auth.json` exists, One Works only briefly creates and removes Pi-compatible `auth.json.lock` to take a consistent snapshot.
- Existing Pi authentication is seeded into a durable project-private native profile. OAuth refreshes persist there and share Pi's credential lock across concurrent sessions; a real Pi login change or logout is synchronized without writing back to real profile data. Native sessions in the same project intentionally share that profile, so a login or refresh is visible to the other native sessions in that project.
- Native settings are copied through a nested inert allowlist; model defaults remain seamless, while extensions, packages, skills, prompts, themes, npm commands, shell prefixes, unknown fields, and context files are not inherited unless One Works explicitly selects a supported resource. Command-backed credentials and headers are removed from both `auth.json` and `models.json`.
- The user's permission mode and persisted One Works tool decisions are enforced before Pi executes a governed tool. Server-backed streaming sessions resolve and persist live one-time/session/project decisions through the One Works interaction UI; if a configured permission-check server is unreachable, every Pi tool fails closed and the mirror is not read. In direct/serverless mode, preparation atomically claims an `allow_once` from the private permission mirror before spawning Pi, then bakes it into that Pi process; a pre-spawn crash may conservatively lose that authorization. Durable `deny_once` remains in the mirror and is re-applied conservatively after restart. Direct terminal sessions retain Pi's native per-call Allow/Deny prompt.
- A successful Pi turn stops only after `agent_settled`, not merely after prompt acceptance or `agent_end`; prompt preflight and terminal model errors fail the turn instead of later projecting success.
- Assistant text, tool calls/results, usage, compaction, title changes, errors, and exit status use existing normalized events.
- Selected MCP assets remain visible as `skipped` diagnostics until a separately reviewed Pi MCP extension exists.

### Impact map

- New module: `packages/adapters/pi`.
- Registration: root/client/desktop manifests, built-in adapter metadata, desktop cache seed, default config.
- Runtime capabilities: task effort and workspace asset allowlists.
- Workspace assets: Pi skills become explicit `--skill` overlays; MCP and OpenCode-only assets receive honest diagnostics.
- No Adapter contract, database schema, layout, or styling change. Pi reuses the existing interact router and adds the internal `/api/interact/permission-check` endpoint; it does not add a user-facing workflow.

### Abstraction decision

Pi is a real variation at the existing adapter seam, so it gets a new adapter package. Managed npm CLI, project mock-home paths, model-service resolution, permission persistence, asset selection, and normalized events are reused. Pi-specific JSONL framing, RPC correlation, arguments, models, permissions, and event projection remain private to the package; no shared abstraction is added until a second adapter demonstrates the same variation.

## First-principles review: Musk's five steps

1. **Question every requirement.** The actual requirement is seamless One Works consumption of Pi, not embedding Pi's SDK, reproducing its TUI, or matching every optional extension ecosystem feature.
2. **Delete.** Delete SDK coupling, a duplicate session database, writes back to real HOME data, automatic third-party extension loading, fake MCP support, broad settings passthrough, and a custom UI flow.
3. **Simplify and optimize.** Use one long-lived RPC process per One Works session, the same session UUID on both sides, explicit resources, a session-private generated-provider profile or durable project-private native-auth profile, a shared project session directory, and the final successful `message_end` as the authority for streamed text.
4. **Accelerate cycle time.** Pin a protocol-compatible Pi minor line, install through the existing CLI preparer, isolate pure mappings from process control, and test against captured official protocol shapes before a real CLI smoke.
5. **Automate.** Auto-prepare the CLI with install scripts disabled, generate session configuration and the permission extension, register the adapter in packaged runtimes, and gate with Vitest, typecheck, formatting, and a real RPC startup smoke.

The review rejects two tempting additions: native MCP parity (upstream has no stable primitive) and SDK embedding (it would couple One Works to Pi internals while duplicating process/session ownership). Both can be reconsidered only with a concrete missing user scenario and an independently stable upstream seam.

## Runtime design

```text
One Works task/session
  -> Adapter.query (unchanged seam)
    -> Pi session preparation
       - managed pi CLI
       - isolated generated-provider profile or durable private native profile
       - locked OAuth shadow + copied safe settings/models
       - generated model-service provider
       - explicit skills + managed permission extension
    -> pi --mode rpc
       <-> strict JSONL RPC client
       -> normalized One Works messages/interactions/usage/operations
```

The adapter has three internal layers:

- `runtime/common`: pure argument, prompt, model-service, permission, and event mapping.
- `runtime/protocol`: strict JSONL framing and request/response correlation.
- `runtime/session`: filesystem preparation, process lifecycle, direct/RPC session orchestration.

## Acceptance scenarios

1. Start Pi with managed or configured CLI and reuse existing Pi auth without writing real profile data or session files.
2. Create and resume the exact One Works session ID.
3. Consume Pi's streamed assistant output as one authoritative successful `message_end` message, keep tool activity live, emit provider-reported usage, and stop on `agent_settled`.
4. Send a follow-up while idle, steer while active, and interrupt an active turn.
5. Enforce `plan`, `acceptEdits`, `default`, `dontAsk`, and `bypassPermissions` in both launch modes, with scoped decision persistence in streaming sessions.
6. Route a One Works model service through generated `models.json` without writing the API key to disk.
7. Load only selected One Works skills.
8. Report unsupported MCP/assets explicitly.
9. Preserve the existing adapter selector geometry in light and dark themes.
10. Preserve refreshed private OAuth credentials across sessions, synchronize a real login/logout, and strip executable credential commands from inherited auth and models.

## Verification evidence

The implemented design was validated through 2026-08-10 against Pi `0.84.1` and Node.js `22.20.0`:

- A real authenticated native Pi request returned the expected sentinel through the configured default provider.
- `pnpm --silent tools adapter-e2e test pi` passed both the direct-answer and read-tool scenarios using the installed Pi CLI, the Responses API fixture, normalized hooks/events, and secret-leak assertions.
- The Pi suite passed 11 files / 86 tests. The current cross-layer regression gate passed 8 files / 143 tests across task, hooks, server, and client. Installed Pi adapter E2E passed 2/2; its hook-order race fix remained stable across consecutive runs. `pnpm install --frozen-lockfile`, all six typecheck scopes, candidate ESLint, dprint, diff integrity, and submodule checks also passed.
- A headed Chromium run exercised the complete Web path: select Pi with the native `default` model, create a session, execute Pi's `read` tool against `packages/adapters/pi/package.json`, render `PI_UI_E2E_OK`, send a second turn, reload the session URL, restore its full history, and complete another turn after reconnect. The page reported no runtime errors; the console contained only Vite and React development notices.
- Independent visual review passed in both light and dark themes. Pi kept the existing selector geometry, loaded its icon, preserved layout, and met the existing selected-label contrast threshold.

The automated RPC scenarios stay provider-independent, while the native and browser smoke tests prove that the same adapter also consumes a real local Pi login and model configuration.

## Known boundary

Pi's public RPC mode is the compatibility boundary. A future Pi version outside `>=0.84.1 <0.85.0` must be revalidated before the managed version is advanced. The current adapter output contract has no ephemeral assistant-text delta event, so Pi emits one durable assistant message from the successful `message_end` instead of persisting cumulative token snapshots; true token-by-token UI would require a separately reviewed non-durable delta contract. Native third-party extensions remain opt-in because they execute with the same privileges as the Pi process. Under that opt-in, global extension paths are explicit, project extension discovery additionally requires `projectTrust: always`, custom tools must also be named in `tools.include`, and unknown custom tools follow the managed permission gate. Direct terminal sessions intentionally retain Pi's native two-choice prompt instead of the streaming session's scoped One Works permission UI. Serverless `allow_once` is claimed atomically before Pi starts, so a crash can only lose an authorization; `deny_once` stays durable and therefore remains conservative across restarts.
