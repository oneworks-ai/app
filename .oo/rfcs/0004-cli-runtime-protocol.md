---
rfc: 0004
title: CLI Runtime Protocol
status: draft
authors:
  - Codex
created: 2026-04-28
updated: 2026-04-30
targetVersion: vNext
---

# RFC 0004: CLI Runtime Protocol

## Summary

Define a unified CLI protocol mode for One Works agent sessions.

The goal is to make `ow run --input-format json|stream-json --output-format json|stream-json` the standard protocol mode for starting, messaging, stopping, resuming, observing, and debugging agent sessions. The current task manager should not be discarded. It should be promoted from an MCP-owned in-memory manager into a runtime engine that consumes typed commands and emits typed events.

The integration contract is a local runtime store:

```text
.oneworks/runtime/sessions/<sessionId>/
  meta.json
  events.jsonl
  commands.jsonl
  state.json
  heartbeat.json
  locks/
    runtime-owner.lock
    commands.append.lock
    events.append.lock
    state.write.lock
```

All external consumers depend on this protocol, not on `TaskManager` internals:

- CLI protocol mode appends runtime commands and reads runtime state/events.
- Server tails runtime events, projects sessions and agent rooms, and serves WebSocket updates.
- UI sends operations through server or CLI protocol-backed commands.
- Agent skills can call the unified CLI protocol mode directly.
- MCP is not a task-domain entry point. It may remain for non-task tools, but it must not provide task tools or translate task calls into runtime commands.

Dedicated `ow agent ...` subcommands are not the primary design surface. They may exist as a compatibility or debugging alias over the same protocol, but new integrations should use the unified CLI protocol mode and treat the runtime store as the state source.

## Motivation

A task runtime owned by MCP task tools would put too much responsibility inside an adapter surface:

- A tool-owned `TaskManager` starts child agents and keeps runtime state in memory.
- Server needs room/session state for UI rendering.
- UI needs to send messages, stop child sessions, and answer approvals.
- Parent agents need a way to delegate work using a stable operation surface.

Making MCP directly sync server state creates an architectural inversion: a tool adapter becomes a product state integration layer.

A unified CLI runtime protocol gives every participant the same contract:

```text
agent skill -> ow protocol mode -> runtime store -> runtime engine
server      -> runtime store watcher -> server projection -> UI
user/UI     -> server/protocol command -> runtime store -> runtime engine
```

This keeps the model simple:

- `TaskManager` is the execution engine.
- JSONL command/event files are the integration protocol.
- CLI protocol mode is the standard human and agent operation surface.
- Server owns product projection and UI delivery.
- MCP is outside the task runtime surface.

## Goals

- Provide standard protocol-mode CLI operations for runtime sessions.
- Keep `TaskManager` as the runtime engine and remove direct external consumption of its internal methods.
- Define append-only command and event files as the runtime integration contract.
- Support start, send message, stop, kill, resume, submit input, status, and event streaming.
- Let server render realtime UI by tailing runtime events instead of polling CLI status.
- Support command correlation, command results, produced event causality, priority, and cancellation.
- Support crash recovery from append-only logs plus snapshots.
- Allow parent agents to use the same CLI protocol from skills or built-in prompts.
- Make agent rooms a server projection over runtime events, not an MCP-specific synchronization feature.

## Non-Goals

- Do not make MCP the source of truth for child task runtime state.
- Do not provide MCP task tools such as `StartTasks`, `SendTaskMessage`, `SubmitTaskInput`, `StopTask`, `ListTasks`, or `GetTaskInfo`.
- Do not maintain an MCP-to-runtime command conversion layer.
- Do not require server to hold direct in-memory references to child agent processes.
- Do not make frontend code read runtime files directly.
- Do not treat CLI stdout as the long-term state source.
- Do not make `state.json` authoritative over append-only events.
- Do not encode user-visible room behavior inside runtime engine internals.
- Do not rely on JSONL file order alone as command execution order.

## Architecture

```text
TaskManager / RuntimeEngine
  consumes RuntimeCommand
  owns adapter run/resume/stop
  handles permission recovery and pending input
  emits RuntimeEvent

FileRuntimeStore
  appends commands.jsonl
  appends events.jsonl
  writes state.json snapshots
  writes heartbeat.json
  coordinates runtime ownership and append/write locks

ow CLI protocol mode
  reads RuntimeSessionCommandEnvelope input
  writes RuntimeSessionResultEnvelope output
  writes commands
  reads state and events

Server
  watches runtime stores
  projects sessions and agent rooms
  exposes API and WebSocket to UI
```

## Runtime Store

Each runtime session has one store directory:

```text
.oneworks/runtime/sessions/<sessionId>/
  meta.json
  events.jsonl
  commands.jsonl
  state.json
  heartbeat.json
  locks/
    runtime-owner.lock
    commands.append.lock
    events.append.lock
    state.write.lock
```

### Protocol Versioning

`protocolVersion` is a semver string, not a fixed numeric revision.

The producer writes the version from the runtime protocol package's `package.json.version`. The target package is `@oneworks/runtime-protocol`. Until that package is extracted, the protocol version follows the repository root `package.json` version. In this worktree that value is `1.0.0`.

Consumers must use semver compatibility rules instead of exact equality:

- same major version: compatible by default; consumers must ignore unknown additive fields;
- higher minor version in the same major: compatible when the consumer can ignore unknown commands, events, and fields; unsupported command or event types must degrade explicitly;
- higher major version: incompatible by default; command writers must refuse to write unless an explicit compatibility adapter exists;
- patch version: bugfix-only and must not change the protocol contract.

Runtime command writers should read `meta.json` or `state.json` before appending commands and verify that their supported semver range accepts the session protocol version. Runtime readers and writers should also expose `supportedProtocolRange`, for example `^1.0.0`, so compatibility can be checked from both sides.

Protocol package responsibilities:

- export TypeScript command, event, state, and metadata types;
- export Zod or equivalent runtime validators;
- export semver compatibility helpers;
- export JSONL parse and normalize helpers;
- own protocol changelog entries for breaking, additive, and patch-only changes.

### meta.json

Stable session metadata:

```json
{
  "protocolVersion": "1.0.0",
  "supportedProtocolRange": "^1.0.0",
  "sessionId": "sess_123",
  "title": "Dev verification",
  "entity": "dev",
  "adapter": "codex",
  "model": "gpt-5.4",
  "cwd": "/repo",
  "parentSessionId": "sess_host",
  "hostSessionId": "sess_host",
  "memberKey": "dev",
  "memberKind": "entity",
  "memberLabel": "dev",
  "runId": "sess_123",
  "runTitle": "Dev verification",
  "createdAt": 1777000000000
}
```

When the unified CLI runtime protocol start command runs inside a server-managed host session, the server provides
`__ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__`, `__ONEWORKS_AGENT_ROOM_ID__` when one already exists,
and `__ONEWORKS_AGENT_ROOM_TITLE__` as environment hints. The CLI writes those hints into
`meta.json`. If no explicit `roomId` exists, server projection uses `hostSessionId`
to create or reuse the host session's Agent Room. This keeps ordinary session
creation session-scoped while making multi-agent delegation switch to a room only
after the first child runtime is started.

### events.jsonl

Append-only facts emitted by the runtime engine.

Every event must include:

- `protocolVersion` as a semver string
- `id`
- `seq`
- `ts`
- `sessionId`
- `type`

Example:

```jsonl
{"protocolVersion":"1.0.0","id":"evt_1","seq":1,"ts":1777000000000,"sessionId":"sess_123","type":"session_started","status":"running"}
{"protocolVersion":"1.0.0","id":"evt_2","seq":2,"ts":1777000000100,"sessionId":"sess_123","type":"message","role":"assistant","content":"I will verify the flow."}
{"protocolVersion":"1.0.0","id":"evt_3","seq":3,"ts":1777000000200,"sessionId":"sess_123","type":"approval_requested","requestId":"req_1","question":"Allow edit?"}
```

### commands.jsonl

Append-only commands submitted by CLI, server, UI, or parent agents.

Every command must include:

- `protocolVersion` as a semver string
- `supportedProtocolRange` when written by a component that can consume the result
- `id`
- `ts`
- `sessionId`
- `type`
- `priority`
- `source`

Example:

```jsonl
{"protocolVersion":"1.0.0","supportedProtocolRange":"^1.0.0","id":"cmd_1","ts":1777000000300,"sessionId":"sess_123","type":"send_message","priority":20,"source":"ui","content":"Continue verification."}
{"protocolVersion":"1.0.0","supportedProtocolRange":"^1.0.0","id":"cmd_2","ts":1777000000400,"sessionId":"sess_123","type":"stop","priority":0,"source":"user","mode":"graceful"}
{"protocolVersion":"1.0.0","supportedProtocolRange":"^1.0.0","id":"cmd_3","ts":1777000000500,"sessionId":"sess_123","type":"submit_input","priority":10,"source":"ui","requestId":"req_1","value":"allow_once"}
```

`commands.jsonl` is not a response channel. Runtime responses are written to `events.jsonl` with command correlation fields.

### state.json

Latest runtime snapshot for fast status reads.

`state.json` is a cache. The authoritative source remains `events.jsonl`.

Example:

```json
{
  "protocolVersion": "1.0.0",
  "supportedProtocolRange": "^1.0.0",
  "sessionId": "sess_123",
  "status": "waiting_input",
  "lastSeq": 42,
  "lastMessage": "Allow edit?",
  "pendingInput": {
    "requestId": "req_1",
    "kind": "permission"
  },
  "updatedAt": 1777000000600
}
```

### heartbeat.json

Runtime liveness and ownership:

```json
{
  "protocolVersion": "1.0.0",
  "supportedProtocolRange": "^1.0.0",
  "sessionId": "sess_123",
  "runtimeId": "runtime_abc",
  "pid": 12345,
  "status": "running",
  "updatedAt": 1777000000700
}
```

Server and CLI use `heartbeat.json` plus lock ownership to detect stale or crashed runtimes.

The owner lock is only for runtime execution ownership. It must not be required for command writers. Multiple UI, CLI, or agent processes may append commands to the same session concurrently; they only need the short-lived command append lock.

## Runtime Discovery

The runtime store root must be discoverable without relying on a running server process.

Recommended root resolution:

1. `ONEWORKS_RUNTIME_HOME` when explicitly set.
2. Project-local `.oneworks/runtime` when the command runs inside a managed project or worktree.
3. User-level runtime home, for example `~/.oneworks/runtime`, when the session is not tied to one project root.

Each root should contain an index:

```text
.oneworks/runtime/
  index.json
  sessions/<sessionId>/
```

`index.json` maps active and recent sessions to store paths:

```json
{
  "protocolVersion": "1.0.0",
  "sessions": {
    "sess_123": {
      "storePath": ".oneworks/runtime/sessions/sess_123",
      "cwd": "/repo",
      "status": "running",
      "updatedAt": 1777000000700
    }
  }
}
```

Server startup should scan configured runtime roots, load indexes, then tail sessions that are active or recently updated. File system watching is an optimization; polling the index and session heartbeats is required as a fallback.

## Command And Event Correlation

A command has one command result and may produce many events.

Required one-to-one command result events:

- `command_ack`
- `command_failed`
- `command_cancelled`

Produced events may reference the command that caused them:

- `commandId`: event directly acknowledges or records the command.
- `causedByCommandId`: event was produced because of the command.
- `inReplyToCommandId`: assistant/user conversation event is a reply to the command.
- `parentEventId`: event is causally linked to a prior event.
- `runId`: event belongs to a specific run under a session or room member.

Example:

```jsonl
{"protocolVersion":"1.0.0","id":"evt_10","seq":10,"type":"command_ack","sessionId":"sess_123","commandId":"cmd_1"}
{"protocolVersion":"1.0.0","id":"evt_11","seq":11,"type":"message","sessionId":"sess_123","role":"user","content":"Continue verification.","causedByCommandId":"cmd_1"}
{"protocolVersion":"1.0.0","id":"evt_12","seq":12,"type":"status_changed","sessionId":"sess_123","status":"running","causedByCommandId":"cmd_1"}
{"protocolVersion":"1.0.0","id":"evt_13","seq":13,"type":"message","sessionId":"sess_123","role":"assistant","content":"Continuing now.","inReplyToCommandId":"cmd_1"}
```

Consumers must not assume the first assistant message after a command is the only response. Agent replies can be one-to-many, include tool calls, require approval, fail, or stop.

Command writers should use explicit timeout semantics:

- `ackTimeoutMs`: time allowed for `command_ack`, `command_failed`, or `command_cancelled`;
- `resultTimeoutMs`: optional time allowed for a terminal result, such as `stopped`, `submitted`, or `resumed`;
- timeout is a client-side observation and should not mutate runtime state by itself;
- a timed-out command can later receive a valid result, so consumers must reconcile late events by command id.

## Command Scheduling

`commands.jsonl` is persistent input. The runtime scheduler decides execution order.

Priority classes:

| Priority | Class     | Commands                                  |
| -------- | --------- | ----------------------------------------- |
| 0        | Lifecycle | `kill`, `stop`, `cancel`, `pause`         |
| 10       | Unblock   | `submit_input`, `approve`, `deny`         |
| 20       | Message   | `send_message`, `resume`, `steer_message` |

Scheduling rules:

- P0 lifecycle commands preempt lower-priority commands.
- P1 unblock commands run before ordinary messages.
- P2 message commands preserve timestamp order within the same priority.
- The runtime handles only one active non-lifecycle command per session at a time.
- P0 can interrupt an active run when the adapter supports interruption.
- A lower-priority command that has been acknowledged but not dispatched may be cancelled by a P0 command.
- A command already emitted to an adapter cannot be withdrawn; a later stop/kill can only stop the runtime.

To avoid race windows, the command reader should batch newly appended commands for a small scheduling window, for example 20-100ms. P0 commands should bypass the debounce window and trigger immediate preemption.

## Session State Machine

Recommended session statuses:

```text
starting
running
waiting_input
stopping
stopped
completed
failed
crashed
```

Important transitions:

- `start` creates `starting`, then `running`.
- `approval_requested` or generic input request moves to `waiting_input`.
- `submit_input` moves `waiting_input` back to `running` when accepted.
- `stop` moves to `stopping`, then `stopped`.
- `kill` moves directly toward `stopped` or `crashed` depending on process outcome.
- `send_message` against `completed` or `failed` is treated as `resume + send_message` only when explicitly allowed.
- `send_message` against `waiting_input` is rejected or queued according to command policy; `submit_input` is preferred.

## Idempotency And Conflict Rules

Commands must be idempotent by `id`.

Recommended behavior:

- Re-reading an already acked command must not execute it again.
- Multiple `stop` commands are idempotent and return `already_stopping` or `already_stopped`.
- Multiple `submit_input` commands for the same `requestId` accept the first valid command and reject or ignore later ones.
- `send_message` after `stop` is rejected unless it explicitly asks to resume.
- `kill` supersedes pending lower-priority commands.
- Runtime should write `command_cancelled` for pending commands superseded by lifecycle commands.

## File Safety

The file store must be safe under multiple writers and readers.

Requirements:

- Append JSONL lines atomically.
- Never write partial JSON lines.
- Separate long-lived runtime ownership from short-lived file write locks.
- Use a lock file or platform-specific advisory lock for command append, event append, and snapshot writes.
- Write snapshots through temp file plus atomic rename.
- Each event has monotonic `seq` per session.
- Readers track byte offset and last `seq`.
- Readers tolerate duplicate events and malformed trailing partial lines.
- Watchers use file system notifications only as a hint and must have polling fallback.
- Rotation or compaction must preserve replay from the last known snapshot.

### Lock Types

The protocol uses four logical locks:

| Lock                   | Holder                 | Lifetime     | Purpose                                                            |
| ---------------------- | ---------------------- | ------------ | ------------------------------------------------------------------ |
| `runtime-owner.lock`   | runtime engine         | long-lived   | Ensures only one runtime consumes commands and drives the session. |
| `commands.append.lock` | CLI, server, UI, agent | one append   | Serializes concurrent appends to `commands.jsonl`.                 |
| `events.append.lock`   | runtime engine         | one append   | Serializes event writes and `seq` assignment.                      |
| `state.write.lock`     | runtime/server tooling | one snapshot | Protects temp-file-plus-rename writes for `state.json` snapshots.  |

Multiple command writers must not compete for `runtime-owner.lock`. For example, two agents can send messages to the same session at the same time. Each writer briefly acquires `commands.append.lock`, appends one command, then releases it. The single runtime owner later reads the commands and schedules them by priority, timestamp, and state.

If no runtime owner is active, command writers may still append commands. Those commands remain pending until a runtime attaches or resumes the session.

`runtime-owner.lock` should record owner metadata:

```json
{
  "runtimeId": "runtime_abc",
  "pid": 12345,
  "host": "machine.local",
  "createdAt": 1777000000000,
  "updatedAt": 1777000000700
}
```

Stale owner lock recovery requires both a stale heartbeat and a failed owner liveness check when the platform can verify process existence. Append locks should have very short stale thresholds because they are never held across runtime work.

## Compaction And Retention

`events.jsonl` can grow without bound. The runtime store needs compaction rules before production use.

Recommended model:

```text
snapshots/<seq>.json
events.jsonl
events.<startSeq>-<endSeq>.jsonl.gz
```

Rules:

- event `seq` values are never reused;
- snapshots record the last included `seq`;
- compacted segments remain readable until all known consumers have advanced beyond them;
- if a server offset points to a compacted segment, it must reload the latest snapshot and replay from the next available event;
- audit-sensitive events can have a longer retention policy than ordinary message deltas;
- artifact references must not be garbage-collected while retained events still reference them.

## Command Surface

The primary command surface is unified protocol mode on the existing CLI input/output format flags. It accepts typed runtime session command envelopes through stdin or an equivalent input stream and writes typed runtime session result envelopes through stdout or an equivalent output stream. Use `json` for one command or `stream-json` for newline-delimited command streams:

```bash
printf '%s\n' '{"protocolVersion":"1.0.0","commandId":"cmdreq_start_1","type":"session.start","entity":"dev","title":"Dev verification","message":"Verify the new room flow"}' \
  | ow run --input-format stream-json --output-format stream-json

printf '%s\n' '{"protocolVersion":"1.0.0","commandId":"cmdreq_msg_1","sessionId":"sess_123","type":"session.message","content":"Continue verification"}' \
  | ow run --input-format stream-json --output-format stream-json

printf '%s\n' '{"protocolVersion":"1.0.0","commandId":"cmdreq_submit_1","sessionId":"sess_123","type":"session.submit","requestId":"req_1","value":"allow_once"}' \
  | ow run --input-format stream-json --output-format stream-json

printf '%s\n' '{"protocolVersion":"1.0.0","commandId":"cmdreq_stop_1","sessionId":"sess_123","type":"session.stop","mode":"graceful"}' \
  | ow run --input-format stream-json --output-format stream-json

printf '%s\n' '{"protocolVersion":"1.0.0","commandId":"cmdreq_status_1","sessionId":"sess_123","type":"session.status"}' \
  | ow run --input-format stream-json --output-format stream-json

printf '%s\n' '{"protocolVersion":"1.0.0","commandId":"cmdreq_events_1","sessionId":"sess_123","type":"session.events"}' \
  | ow run --input-format stream-json --output-format stream-json
```

The start command returns serialized session information inside a protocol output envelope:

```json
{
  "protocolVersion": "1.0.0",
  "supportedProtocolRange": "^1.0.0",
  "commandId": "cmdreq_start_1",
  "type": "session.start.result",
  "ok": true,
  "sessionId": "sess_123",
  "status": "starting",
  "storePath": ".oneworks/runtime/sessions/sess_123",
  "result": {
    "sessionId": "sess_123",
    "storePath": ".oneworks/runtime/sessions/sess_123",
    "status": "starting",
    "title": "Dev verification"
  }
}
```

Long-running state should not be inferred from CLI stdout after start. The state source is the runtime store.

Compatibility aliases such as `ow agent start`, `ow agent send`, `ow agent status`, or `ow agent events` may remain for manual debugging or legacy scripts. They must be thin adapters over the same protocol records and must not become the documented integration contract for new consumers.

## Composite Operations

Some workflows are not single-session commands.

Multi-agent delegation through the unified CLI runtime protocol may create one room, one host linkage, and multiple child runtime sessions. This should be represented as a composite operation with a stable `operationId`.

Recommended structure:

```text
.oneworks/runtime/operations/<operationId>/
  meta.json
  events.jsonl
  commands.jsonl
```

An operation event can link sessions and rooms:

```json
{
  "protocolVersion": "1.0.0",
  "id": "evt_op_1",
  "operationId": "op_123",
  "type": "operation_started",
  "roomId": "room_123",
  "hostSessionId": "sess_host",
  "childSessionIds": ["sess_dev", "sess_qa"]
}
```

Server projects composite operation events into Agent Room objects. Child sessions still keep their own session stores. Operation stores are coordination manifests, not replacements for session stores.

## TaskManager As Runtime Engine

`TaskManager` should be retained and narrowed:

```text
TaskRuntimeEngine
  applyCommand(command)
  emit RuntimeEvent
  read RuntimeState
```

It owns:

- adapter `run` and `resume`;
- initial prompt dispatch;
- follow-up messages;
- queued steer messages;
- permission recovery;
- pending input;
- stop and kill behavior;
- adapter output normalization.

It must not own:

- server sessions;
- agent rooms;
- UI routing;
- MCP-specific synchronization;
- frontend-facing labels beyond event payloads.

This allows the same engine to be used by CLI, server-attached runtimes, and local background workers.

## Server Projection

Server watches runtime stores and projects events into product data.

Projection responsibilities:

- create/update `Session` rows;
- persist display transcript;
- update runtime status;
- create/update Agent Room rows for multi-agent workflows;
- project public room events from runtime events;
- expose WebSocket updates to UI;
- keep private runtime transcript separate from public room messages.

Server should treat runtime events as input facts. The server database is the UI read model, not the runtime source of truth.

## Visibility And Privacy

Runtime events can contain private transcript content, public room summaries, audit metadata, and operational logs. Projection must not infer visibility from event type alone.

Events that can leave the private session view should declare visibility:

```json
{
  "protocolVersion": "1.0.0",
  "id": "evt_20",
  "seq": 20,
  "sessionId": "sess_dev",
  "type": "message",
  "role": "assistant",
  "content": "Implementation complete.",
  "visibility": "room"
}
```

Visibility classes:

| Visibility | Meaning                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `private`  | Only the session transcript and owner-level diagnostics can show it.     |
| `room`     | Server may project it into an Agent Room public timeline.                |
| `audit`    | Stored for security or permission review; not shown in normal timelines. |
| `system`   | Operational event used for status and health; usually not user-visible.  |

Default visibility is `private`. Server room projection must require explicit `room` visibility or a dedicated public summary field.

## Agent Rooms

Agent Room should stay a server-level aggregate.

Runtime events can include room-related metadata:

```json
{
  "protocolVersion": "1.0.0",
  "type": "session_started",
  "sessionId": "sess_dev",
  "parentSessionId": "sess_host",
  "roomId": "room_123",
  "memberKey": "entity:dev",
  "runId": "run_dev_1"
}
```

Server uses these fields to project:

- room members;
- room runs;
- assignment messages;
- attention requests;
- completion/failure summaries;
- member status.

The runtime engine does not render room UI semantics. It emits structured facts.

## Schema Registry

The protocol package should maintain a registry of command and event schemas keyed by semver and type.

Registry responsibilities:

- validate command writes before append;
- validate runtime events before append;
- normalize legacy records when compatibility adapters exist;
- expose unsupported command/event degradation helpers;
- generate TypeScript types and test fixtures from the same schema source.

Unknown additive fields in a compatible semver range must be preserved when records are copied or compacted.

## MCP Role

MCP is not part of the task runtime architecture.

The task runtime standard call surface is the unified `ow run --input-format json|stream-json --output-format json|stream-json` protocol mode plus the runtime protocol/store. MCP may remain for unrelated tools, but it must not register task tools, hold task state, or translate task-domain operations into runtime commands. In particular, MCP must not expose `StartTasks`, `SendTaskMessage`, `SubmitTaskInput`, `StopTask`, `ListTasks`, or `GetTaskInfo`.

## Crash Recovery

On startup or attach:

1. Acquire or validate `runtime-owner.lock`.
2. Read `meta.json`.
3. Replay `events.jsonl` from the latest valid snapshot.
4. Rebuild `state.json` if missing or stale.
5. Read `commands.jsonl`.
6. Skip commands that already have terminal command result events.
7. Requeue pending commands that are safe to retry.
8. Mark unsafe ambiguous commands as `command_failed` with a recovery reason.

Examples of safe retry:

- command was never acked;
- command is idempotent lifecycle command;
- command targets an already pending input and no submit result exists.

Examples of unsafe retry:

- `send_message` was acked and may already have been emitted to adapter;
- adapter process crashed mid-response and message delivery cannot be proven.

## Security

Runtime store access controls matter because commands can grant permissions or stop processes.

Requirements:

- Store directories should be created with user-only permissions.
- Commands should include `source` and optionally `actorId`.
- Permission-sensitive commands should be auditable through events.
- Cross-workspace command writes should be rejected unless explicitly allowed.
- Runtime should validate session id, workspace root, and command schema before execution.

## Large Content And Artifacts

JSONL should not carry large files, screenshots, or full binary content.

Events should reference artifacts:

```json
{
  "protocolVersion": "1.0.0",
  "type": "artifact_created",
  "artifactId": "artifact_1",
  "path": ".oneworks/runtime/sessions/sess_123/artifacts/screenshot.png",
  "mimeType": "image/png"
}
```

The same rule applies to large logs and long tool outputs. Store them as artifacts and reference them from events.

Artifact records should include enough metadata for lifecycle management:

- content hash;
- byte size;
- MIME type;
- producing event id;
- visibility;
- retention policy;
- created time.

## Remote Runtime Transport

The JSONL file store is the local transport implementation, not the only possible transport.

Remote runtimes, containers, or workers must expose an equivalent command/event stream:

```text
RuntimeCommand stream in
RuntimeEvent stream out
RuntimeState snapshot read
Heartbeat/liveness read
```

Server and CLI protocol mode should depend on the runtime protocol interface. Local JSONL, Unix socket, WebSocket, and remote worker transports are adapters behind that interface. The same semver compatibility and command correlation rules apply to every transport.

## Verification

Required tests:

- Unit tests for command parsing, event parsing, and schema validation.
- Scheduler tests for P0/P1/P2 priority, cancellation, duplicate commands, and waiting input behavior.
- File store tests for atomic append, malformed trailing lines, snapshot rewrite, and replay.
- Runtime engine tests for start, send, stop, kill, resume, submit input, and crash recovery.
- Server projection tests for session rows, room members, room runs, public room messages, and private transcript separation.
- CLI protocol-mode smoke tests that start a real runtime, send a message, stop it, and read events/status.
- Browser smoke tests that verify server tails runtime events and UI receives WebSocket updates.
- Protocol compatibility tests for same-major additive fields, unsupported minor features, and incompatible major versions.
- Remote transport contract tests that reuse the same command/event fixtures as the local JSONL store.

Minimum integrated smoke:

```text
ow protocol start command -> returns session/store info
runtime writes session_started
server tails events and creates session
ow protocol send_message command -> appends command
runtime writes command_ack and message events
server projects transcript and WS update
ow protocol stop command -> appends P0 command
runtime writes stopping/stopped events
server updates UI status
```

## Open Questions

- Should a protocol-mode start command launch a detached runtime process by default, or should there be an explicit background field or flag?
- Should server call CLI commands or use a shared runtime-store library for command writes?
- What is the exact runtime store root in managed worktrees versus user projects?
- How should remote or container runtimes expose the same protocol?
- What compaction policy should be used for long-running sessions?
- Which event fields are required for room projection in V1?

## Required Follow-Up Decisions

These decisions must be closed before implementation starts:

- Extract `@oneworks/runtime-protocol` or explicitly defer extraction while keeping protocol types in one package.
- Pick cross-platform implementations for `runtime-owner.lock`, append locks, and stale lock recovery.
- Define the first supported command and event schema set.
- Define command timeout defaults for CLI, server, and UI callers.
- Define runtime root discovery in desktop, server, worktree, and plain CLI modes.
- Define Agent Room projection fields, especially `operationId`, `roomId`, `memberKey`, `runId`, and `visibility`.
- Define artifact retention and compaction policy.
- Decide whether composite operation stores are required in V1 or can be represented by linked session stores only.

## Decision

Adopt CLI Runtime Protocol as the target architecture for multi-agent runtime control.

`TaskManager` remains the core runtime engine, but consumers integrate through the unified CLI protocol mode and command/event protocol files. The runtime store is the authoritative state source; `state.json` is only a cache over append-only events. Server projects runtime-store events into sessions and agent rooms. `ow agent ...` may remain only as a compatibility or debugging alias over protocol mode, not as the primary surface. MCP is not a task entry point and cannot own authoritative runtime state.
