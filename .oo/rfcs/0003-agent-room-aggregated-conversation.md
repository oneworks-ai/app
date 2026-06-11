---
rfc: 0003
title: Agent Room Aggregated Conversation
status: draft
authors:
  - Codex
created: 2026-04-24
updated: 2026-04-30
targetVersion: vNext
---

# RFC 0003: Agent Room Aggregated Conversation

## Summary

Add `AgentRoom` as a first-class aggregated conversation for multi-agent collaboration.

An Agent Room is not a decoration on the existing single-agent session message view. It is a separate room-level conversation that aggregates visible coordination between a user, a host agent, and one or more child or persistent agents.

The existing session view remains the private execution surface for a single runtime session. Agent Room becomes the user-facing collaboration surface when multiple agents are involved.

Update 2026-04-30: RFC 0004 supersedes the earlier `StartTasks` / MCP task-tool integration direction. Agent Rooms are now created or discovered by server projection over unified CLI runtime protocol metadata/events. Ordinary new sessions remain ordinary sessions; room projection starts only after a host session starts child runtime sessions.

## Motivation

Multi-agent workflows need a different interaction model from single-agent chat:

- A host agent can delegate work to child agents.
- Child agents can ask for confirmation, report progress, complete work, or fail.
- The user should see those public coordination points in one room-like conversation.
- Internal execution logs, tool calls, and long transcripts should stay hidden unless the user opens a specific run.
- When the room has multiple agents, the default surface should be the room view, not a parent session with child sessions embedded below it.

Trying to fit this into the existing message list makes the single-agent view carry multi-agent concerns: room events, member roster, target routing, and attention cards. The cleaner model is to introduce Agent Room as an independent aggregate.

## Goals

- Add Agent Room as a first-class persisted object.
- Add an independent Agent Room UI route and page.
- Keep the existing single-agent session message view focused on one runtime session.
- Default to opening Agent Room when a conversation involves multiple agents.
- Show room messages in a familiar group-chat layout:
  - agent messages on the left with avatar, name, and optional subtitle;
  - user messages on the right;
  - compact bubbles for text;
  - lightweight inline actions for confirmations and run details.
- Keep agent internals hidden by default.
- Support a room roster showing current members and each member's runs.
- Support multiple concurrent runs under the same member.
- Route user input through the host agent by default.
- Route directly to child agents only when the user explicitly targets a member or run.
- Preserve private runtime sessions for execution, resume, logs, tools, terminal, and workspace details.

## Non-Goals

- Do not embed room UI into `ChatHistoryView`.
- Do not make `MessageItem` understand room-specific display semantics.
- Do not show every child agent transcript in the room timeline.
- Do not represent a room as only a parent `Session` with child sessions.
- Do not make child agents freely inject arbitrary user-like messages.
- Do not require users to understand `taskId`, `sessionId`, or tool protocol names in the room UI.
- Do not expose MCP task tools as the Agent Room runtime consumer surface.
- Do not update user-facing `.oo/docs` until the feature is actually implemented and exposed.

## Concept Model

### Session

A `Session` remains a private single-agent runtime conversation.

It owns:

- adapter execution;
- full transcript;
- tool calls and tool results;
- terminal and workspace panels;
- resume state;
- runtime status and logs.

### AgentRoom

An `AgentRoom` is the user-facing group conversation.

It owns:

- room title and status;
- room members;
- public room messages;
- links to private runtime sessions and runs.

The room may link to a host runtime session, but the room id is the primary identity for the user-facing conversation.

### RoomMember

A `RoomMember` is an entity inside a room.

Member examples:

- host agent;
- temporary task agent;
- persistent entity such as `architect`, `reviewer`, or `planner`.

Members stay in the room until explicitly removed. A completed run does not mean the member left.

### RoomRun

A `RoomRun` is one execution thread under a member.

One member can have multiple runs at once:

- `@architect/billing-review`;
- `@architect/schema-plan`;
- `@reviewer/release-check`.

Runs can be `running`, `waiting`, `completed`, `failed`, or `stopped`.

### RoomMessage

A `RoomMessage` is public room timeline content.

Message categories:

- user message;
- host agent message;
- child agent public report;
- assignment;
- attention request;
- reply or confirmation acknowledgement;
- completion;
- failure;
- system membership event.

Room messages should be designed for user comprehension, not for full runtime replay.

## Interaction Rules

### Default Input Routing

User input without a target goes to the host agent.

The host agent is responsible for deciding whether to answer directly, resume a child run, submit an interaction response, or start new runs.

### Explicit Target Routing

Explicit targeting is opt-in:

- `@member message` routes to that member's room mailbox.
- `@member/run message` routes to that specific run.

The UI can provide chips and mention completion, but the room should remain usable as a normal group chat.

### Child Agent Attention

When a child agent needs confirmation, the room shows a normal left-side bubble, for example:

```text
@host 我需要确认：是否允许直接修改 schema？
```

The default user reply still goes to the host agent. This keeps the host agent as the coordinator.

Direct child reply is only used when the user explicitly chooses the child run target or a UI action that clearly says it will reply to that run.

### Completion And Failure

Completion and failure are room-visible messages:

```text
@host 我的任务已完成：已修复 flaky test，并补了回归。
@host 我卡住了：缺少发布说明。
```

The user can open the run detail to inspect the private execution transcript.

## UX Requirements

### Room Page

The room page should look like a common group chat:

- scrollable message timeline;
- avatars and names for agents;
- right-aligned user messages;
- left-aligned agent messages;
- compact timestamps or separators when useful;
- composer at the bottom;
- optional right-side roster on desktop;
- roster collapses or becomes a drawer on compact layouts.

The room page should not look like the existing operational session view with tool groups as the primary timeline.

### Roster

The roster shows room members, not raw sessions.

Each member row shows:

- avatar or icon;
- member name;
- aggregate status;
- pending count;
- active run count;
- latest public summary.

Expanding a member shows that member's runs.

### Run Detail

Opening a run enters the private execution surface.

This can reuse the existing session detail view because run detail is a single runtime session. The entry point should be visually secondary to the room.

### Session List

Agent Rooms should be listed as first-class conversation items.

When a flow creates multiple agents, the app should default to opening the Agent Room. Private child sessions should not clutter the top-level list by default; they can remain accessible from the room roster and run detail.

## Data Model

Recommended server tables:

```text
agent_rooms
  id
  title
  hostSessionId
  status
  lastMessage
  createdAt
  updatedAt

agent_room_members
  roomId
  memberKey
  kind
  label
  avatar
  status
  latestSummary
  activeRunCount
  pendingCount
  createdAt
  updatedAt

agent_room_runs
  roomId
  runKey
  memberKey
  sessionId
  title
  status
  latestSummary
  interactionId
  requestKind
  options
  createdAt
  updatedAt

agent_room_messages
  id
  roomId
  role
  memberKey
  runKey
  content
  eventType
  payloadJson
  createdAt
```

Shared contracts should live in `packages/types` or `packages/core`.

## API Shape

Recommended routes:

```text
GET  /api/agent-rooms
POST /api/agent-rooms
GET  /api/agent-rooms/:roomId
POST /api/agent-rooms/:roomId/messages
POST /api/agent-rooms/:roomId/events
POST /api/agent-rooms/:roomId/members
POST /api/agent-rooms/:roomId/runs
```

The event endpoint is for internal projections from runtime coordination. The message endpoint is for user-authored room input.

Server routes should stay thin. Room state updates belong in a service layer, with database access isolated in an `agentRooms` repo.

## Runtime Integration

### Runtime Protocol Projection

When a unified CLI runtime protocol start command starts a child runtime session from a host context:

1. Write child runtime metadata/events containing `hostSessionId` or an explicit `roomId`, plus member/run fields.
2. Ensure an Agent Room exists for the current collaboration context.
3. Add or update room members for target entities.
4. Create room runs for each child runtime session.
5. Write public assignment messages to the room.
6. Start private runtime sessions as usual.

Creating a normal session does not create a room. Room projection starts only when the server sees child runtime session metadata/events linked to a host session.

### Runtime Attention

When a child runtime session blocks on input or permission:

1. Keep the private run blocked.
2. Add an `attention_requested` room message.
3. Mark the run as `waiting`.
4. Increment the member pending count.

### Runtime Resume

When the host agent or explicit user target replies to a waiting run:

1. Add a public reply or acknowledgement message.
2. Submit the response to the private run through the runtime protocol.
3. Mark the run as `running`.
4. Add a resume message only when it gives useful context.

### Runtime Completion

When a private run completes:

1. Write a public completion message.
2. Mark the run as `completed`.
3. Recompute member aggregate state.

## Client Architecture

Add a new feature module instead of extending `components/chat`:

```text
apps/client/src/components/agent-room/
  AgentRoomView.tsx
  AgentRoomView.scss
  @components/
    AgentRoomMessageList.tsx
    AgentRoomBubble.tsx
    AgentRoomComposer.tsx
    AgentRoomRoster.tsx
    AgentRoomRunList.tsx
  @core/
    build-room-view-model.ts
    resolve-room-target.ts
  @hooks/
    use-agent-room.ts
    use-agent-room-subscription.ts
  @types/
    agent-room-view.ts
```

Routing:

```text
/rooms/:roomId
/session/:sessionId
```

`/session/:sessionId` remains the single-runtime detail route.

## Implementation Plan

### Phase 1: Contracts And Persistence

- Add shared Agent Room types.
- Add server database tables and repos.
- Add routes for list/detail/event writes.
- Add service methods for member/run/message state transitions.
- Add unit tests for persistence and aggregate status computation.

### Phase 2: Runtime Projection

- Project RFC 0004 runtime store metadata/events from unified CLI runtime protocol child-session starts to create or resolve a room.
- Project assignment, attention, reply, resume, completion, and failure into room messages.
- Keep private runtime sessions unchanged.
- Add runtime store projection tests for room event projection.

### Phase 3: Independent Room Page

- Add `/rooms/:roomId`.
- Build the group-chat message list.
- Build the roster and run expansion.
- Add the bottom composer.
- Add desktop and compact layouts.

### Phase 4: Input Routing

- Implement default host routing for ordinary messages.
- Implement explicit `@member` and `@member/run` routing.
- Add mention completion and selected-target preview.
- Add clear direct-run actions where needed.

### Phase 5: Navigation Defaults

- Show rooms as first-class list items.
- Default to room route when multiple agents exist.
- Keep child/private sessions accessible from run detail rather than top-level clutter.

### Phase 6: Verification And Polish

- Add targeted tests for routing, roster aggregation, message rendering, and API state.
- Run typecheck and relevant client/server tests.
- Run real Chrome smoke for desktop and compact layouts.
- Capture screenshots for:
  - room with multiple members;
  - waiting confirmation;
  - explicit `@member/run` target;
  - completed run;
  - run detail navigation.

## Team Execution Plan

This project should be implemented as coordinated parallel work, with one integration owner keeping the contract stable. The key rule is that the team must build a new Agent Room surface instead of extending the existing single-session chat view.

### Shared Contract First

Before parallel implementation starts, one small contract PR should land or be agreed as the shared base:

- `AgentRoom`, `AgentRoomMember`, `AgentRoomRun`, `AgentRoomMessage`, and detail/list response types.
- Room status and run status enums.
- Room event payload shape for assignment, attention, reply, resume, completion, and failure.
- Route names and response shapes for `GET /api/agent-rooms`, `GET /api/agent-rooms/:roomId`, `POST /api/agent-rooms/:roomId/messages`, and `POST /api/agent-rooms/:roomId/events`.
- Navigation contract for `/rooms/:roomId` and `/session/:sessionId`.

No UI or runtime worker should invent private versions of these types.

### Workstream A: Contracts And Server Persistence

Owner profile: backend / data model agent.

Write scope:

- `packages/types/src/agent-room.ts`
- `packages/types/src/index.ts`
- `packages/core/src/types.ts`
- `apps/server/src/db/agentRooms/`
- `apps/server/src/services/agent-room/`
- `apps/server/src/routes/agent-rooms.ts`
- `apps/server/src/routes/index.ts`
- focused server/db tests

Deliverables:

- Add persisted room, member, run, and message repos.
- Add service methods for idempotent member/run upsert and event application.
- Add list/detail APIs.
- Keep route handlers thin and put state transitions in services.
- Add tests for aggregate status, pending count, active run count, latest summary, and message ordering.

Dependencies:

- Starts first.
- Must publish stable response types before client and runtime workers depend on them.

Done when:

- Server can create a room, apply events, return detail, and compute roster state without involving MCP or the client.

### Workstream B: Runtime Projection

Owner profile: runtime protocol projection agent.

Write scope:

- `apps/cli/src/commands/agent/`
- `apps/server/src/services/runtime-store/`
- `packages/workspace-assets/src/task-tool-guidance.ts`
- runtime store projection tests

Deliverables:

- Ensure unified CLI runtime protocol child-session start metadata/events resolve or create an Agent Room for multi-agent work.
- Project runtime assignment into room messages.
- Project waiting input or permission into room attention messages.
- Project host replies or explicit direct-run replies into room reply/resume messages.
- Project completion and failure into room messages.
- Keep private runtime sessions and resume behavior unchanged.
- Do not add or consume MCP task tools.

Dependencies:

- Depends on Workstream A API contract.
- Can use a stubbed room client while Workstream A is in progress, but must converge on the shared API before merge.

Done when:

- Runtime store projection tests prove the room receives the correct public messages while private sessions still retain their full runtime behavior.

### Workstream C: Independent Room Page

Owner profile: frontend room UI agent.

Write scope:

- `apps/client/src/components/agent-room/AgentRoomView.tsx`
- `apps/client/src/components/agent-room/AgentRoomView.scss`
- `apps/client/src/components/agent-room/@components/AgentRoomMessageList.tsx`
- `apps/client/src/components/agent-room/@components/AgentRoomBubble.tsx`
- `apps/client/src/components/agent-room/@components/AgentRoomRoster.tsx`
- `apps/client/src/components/agent-room/@components/AgentRoomRunList.tsx`
- `apps/client/src/components/agent-room/@core/build-room-view-model.ts`
- room rendering tests

Deliverables:

- Build the group-chat room page.
- Render user bubbles on the right and agent bubbles on the left.
- Render agent avatar, name, subtitle, run label, and inline actions where relevant.
- Render a desktop roster and compact roster drawer behavior.
- Keep `ChatHistoryView` and `MessageItem` out of the room rendering path.

Dependencies:

- Depends on Workstream A detail response shape.
- Does not need runtime projection to start; can use fixture data in tests.

Done when:

- A fixture room with multiple members, waiting attention, completed run, and failed run renders correctly in tests and real Chrome smoke.

### Workstream D: Room Composer And Target Routing

Owner profile: frontend interaction agent.

Write scope:

- `apps/client/src/components/agent-room/@components/AgentRoomComposer.tsx`
- `apps/client/src/components/agent-room/@core/resolve-room-target.ts`
- `apps/client/src/components/agent-room/@hooks/use-agent-room-composer.ts`
- `apps/client/src/api/agent-rooms.ts`
- composer/routing tests

Deliverables:

- Default plain messages to the host agent.
- Resolve `@member` targets to member mailbox routing.
- Resolve `@member/run` targets to explicit run routing.
- Add mention completion using room members and runs.
- Show a clear selected-target preview.
- Wire submit to `POST /api/agent-rooms/:roomId/messages`.

Dependencies:

- Depends on Workstream A message API.
- Coordinates with Workstream C on component props and visual layout.

Done when:

- Tests cover default host routing, member routing, run routing, missing target, ambiguous target, and empty targeted message.

### Workstream E: Navigation And Conversation List

Owner profile: frontend shell/navigation agent.

Write scope:

- `apps/client/src/routes/AppRoutes.tsx`
- room route files under `apps/client/src/routes/`
- session/sidebar list API integration
- app shell selection logic
- navigation tests

Deliverables:

- Add `/rooms/:roomId`.
- Show Agent Rooms as first-class conversation items.
- Open Agent Room by default when a flow has multiple agents.
- Keep private child sessions accessible from room run detail.
- Avoid top-level clutter from child sessions by grouping or hiding them under the room.

Dependencies:

- Depends on Workstream A list API and Workstream C route component.

Done when:

- Navigating from a room list item opens `/rooms/:roomId`; opening a run still navigates to `/session/:sessionId`.

### Workstream F: Cleanup And Migration From Current Prototype

Owner profile: refactor/integration agent.

Write scope:

- existing room-specific additions under `apps/client/src/components/chat/`
- existing room-specific sender additions under `apps/client/src/components/chat/sender/`
- room prototype tests that target `ChatHistoryView`
- temporary smoke fixtures and `.tmp` artifacts

Deliverables:

- Remove room-specific rendering from the single-session message view.
- Move reusable logic into the new Agent Room module only when it remains generally useful.
- Keep single-agent chat tests passing.
- Delete or rewrite prototype tests that assert room behavior inside `ChatHistoryView`.

Dependencies:

- Should start after Workstream C and D have replacement coverage.

Done when:

- Single-agent chat no longer imports Agent Room components or room routing helpers.

### Workstream G: Verification And Release Readiness

Owner profile: verifier / QA agent.

Write scope:

- test plans and smoke scripts
- focused test files only when adding missing coverage
- screenshots under the agreed screenshot directory when needed

Deliverables:

- Maintain a verification matrix for each merged workstream.
- Run focused tests as work lands.
- Run `pnpm typecheck` after contract and integration changes.
- Run real Chrome smoke for desktop and compact layouts.
- Capture screenshots for waiting attention, selected target, completed run, and run detail navigation.

Dependencies:

- Can begin with fixture-based page verification once Workstream C has a route.
- Final smoke depends on Workstreams A through F.

Done when:

- Acceptance criteria are demonstrated by tests and real Chrome screenshots.

### Integration Owner

One agent should act as integration owner throughout the project.

Responsibilities:

- Keep the RFC contract stable.
- Review cross-workstream type changes.
- Merge in dependency order.
- Resolve conflicts between server response shape, runtime projection, and client view model.
- Prevent room behavior from drifting back into `ChatHistoryView`.
- Keep a running checklist of open questions and decisions.

Recommended merge order:

1. Workstream A contract and persistence.
2. Workstream C fixture-based room page shell.
3. Workstream D composer and routing against fixture/API mocks.
4. Workstream B runtime projection into real rooms.
5. Workstream E navigation defaults.
6. Workstream F cleanup from the prototype.
7. Workstream G final verification.

### Parallelization Rules

- Workstreams A and C can start in parallel after the shared contract is agreed.
- Workstream D can start once C exposes composer placement and A exposes message API shape.
- Workstream B can start with a local API client stub but should not merge before A.
- Workstream E should wait for A and C to avoid route/list churn.
- Workstream F should wait until the new room page covers the old prototype behavior.
- Workstream G should run continuously but owns final signoff last.

### Handoff Prompts For Agents

Backend persistence agent:

```text
Implement Workstream A from RFC 0003. Own only Agent Room shared contracts, server db repo, service, routes, and focused tests. Do not touch client room rendering or runtime protocol projection. Keep routes thin and put state transitions in the service layer.
```

Runtime projection agent:

```text
Implement Workstream B from RFC 0003. Own only unified CLI runtime protocol/store projection into Agent Room APIs. Preserve existing private runtime session behavior and resume semantics. Do not add or consume MCP task tools. Add tests proving assignment, attention, reply, resume, completion, and failure are projected into room messages.
```

Room UI agent:

```text
Implement Workstream C from RFC 0003. Build a new AgentRoomView under components/agent-room with fixture-driven tests. Do not modify ChatHistoryView or MessageItem. The UI should behave like a group chat with a separate roster.
```

Composer routing agent:

```text
Implement Workstream D from RFC 0003. Own Agent Room composer, @member and @member/run resolution, target preview, mention completion, and message submission. Keep this logic inside the Agent Room module.
```

Navigation agent:

```text
Implement Workstream E from RFC 0003. Add /rooms/:roomId routing and make Agent Rooms first-class conversation items. Keep private child sessions reachable from room run detail without cluttering the top-level list.
```

Cleanup agent:

```text
Implement Workstream F from RFC 0003 after the new room page exists. Remove room-specific UI and routing from the old single-session chat path while preserving all normal ChatHistoryView behavior.
```

Verifier agent:

```text
Implement Workstream G from RFC 0003. Maintain the verification matrix, run focused tests, run typecheck, and capture real Chrome screenshots for desktop and compact Agent Room flows. Report any unverified acceptance criteria explicitly.
```

## Acceptance Criteria

- Single-agent sessions still render through the existing message view with no room UI.
- Multi-agent flows open an Agent Room by default.
- The room timeline shows only public coordination messages.
- Child private transcripts are hidden until a run is opened.
- A child attention request appears as a normal group-chat message.
- A plain user reply goes to the host agent.
- Explicit `@member` and `@member/run` targets route correctly.
- The same member can have multiple runs and still appears once in the roster.
- Completed runs do not remove their member from the room.
- The roster aggregate state matches visible room messages.
- Real Chrome smoke passes on desktop and compact layouts.

## Open Questions

- Should a host runtime session be mandatory for every room, or can a room exist before the host starts?
- Should persistent entities share room-level memory across runs, or should each run only receive summarized member memory?
- Should private child sessions be hidden from the main session list by default, or grouped under their room item?
- What exact UI copy distinguishes "reply to host" from "directly reply to this run"?
- Should room messages support edit/recall/branch semantics, or should those remain session-only in V1?

## Handoff Notes

The target design is an independent Agent Room product surface.

Implementation work should avoid continuing to place room-specific UI inside:

- `ChatHistoryView`;
- `MessageItem`;
- existing single-session sender internals, except for reusable composer primitives.

Reusable pieces are still welcome, but room state, room routing, room message rendering, and roster behavior should belong to the Agent Room module.
