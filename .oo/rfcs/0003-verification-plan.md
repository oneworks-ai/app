---
rfc: 0003
title: Agent Room Aggregated Conversation Verification Plan
status: draft
created: 2026-04-24
updated: 2026-04-24
owner: Workstream G
---

# RFC 0003 Verification Plan

This plan tracks release readiness for RFC 0003 Workstream G. It is intentionally scoped to verification artifacts and focused tests; implementation changes remain owned by Workstreams A-F.

## Verification Matrix

| Acceptance criterion                                                                  | Primary owner | Required evidence                                                                                                                      | Focused verification                                                                                                                                                                       |
| ------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Single-agent sessions still render through the existing message view with no room UI. | F             | No Agent Room components in the single-session render path; existing chat tests pass.                                                  | `pnpm exec vitest run --workspace vitest.workspace.ts --project bundler.web apps/client/__tests__/chat-session-messages.spec.ts apps/client/__tests__/chat-history-status-notices.spec.ts` |
| Multi-agent flows open an Agent Room by default.                                      | E             | Conversation list or task launch opens `/rooms/:roomId` for multi-agent work.                                                          | Navigation-focused client tests plus Chrome smoke from a multi-agent fixture.                                                                                                              |
| The room timeline shows only public coordination messages.                            | B, C          | Runtime projection emits assignment, attention, reply, completion, and failure summaries without private transcript entries.           | MCP projection tests and room rendering tests using a fixture with hidden private session content.                                                                                         |
| Child private transcripts are hidden until a run is opened.                           | C, E          | Room page exposes secondary run-detail navigation, not embedded private logs.                                                          | Room UI tests assert no private transcript text in the room; Chrome smoke opens run detail separately.                                                                                     |
| A child attention request appears as a normal group-chat message.                     | B, C          | `attention_requested` projects into a left-side agent bubble with member/run context.                                                  | MCP attention projection test and room message rendering test.                                                                                                                             |
| A plain user reply goes to the host agent.                                            | D             | Untargeted composer submissions resolve to host routing.                                                                               | `resolve-room-target` or composer submit test for empty target.                                                                                                                            |
| Explicit `@member` and `@member/run` targets route correctly.                         | D             | Member and run targets resolve to the expected message payload and preview.                                                            | Routing tests for valid member, valid run, missing target, ambiguous target, and empty targeted message.                                                                                   |
| The same member can have multiple runs and still appears once in the roster.          | A, C          | Detail API returns one member with multiple runs; roster groups by member.                                                             | Server aggregate tests and roster rendering tests.                                                                                                                                         |
| Completed runs do not remove their member from the room.                              | A, C          | Completed run remains under the member; member aggregate status is recomputed without deletion.                                        | Server completion aggregate test and roster rendering fixture.                                                                                                                             |
| The roster aggregate state matches visible room messages.                             | A, B, C       | Pending count, active run count, latest summary, and status match projected events.                                                    | Server service tests for event application plus Chrome smoke for waiting and completed states.                                                                                             |
| Real Chrome smoke passes on desktop and compact layouts.                              | G             | Screenshots cover desktop roster, compact roster drawer, waiting attention, selected target, completed run, and run detail navigation. | Manual checklist in this document against a local dev build.                                                                                                                               |

## Focused Test Commands

Run the smallest relevant command as each workstream lands, then run broader checks before final signoff.

| Workstream                          | Scope                                                                            | Recommended commands                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: contracts and server persistence | Shared types, server db repo, service, routes, aggregate state.                  | `pnpm exec vitest run --workspace vitest.workspace.ts --project node apps/server/__tests__/db apps/server/__tests__/routes apps/server/__tests__/services`; `pnpm exec vitest run --workspace vitest.workspace.ts --project bundler packages/types/__tests__`; `pnpm typecheck`                                                         |
| B: runtime projection               | MCP task projection, private session preservation, task guidance copy.           | `pnpm exec vitest run --workspace vitest.workspace.ts --project bundler packages/mcp/__tests__/task-manager.spec.ts packages/mcp/__tests__/task-tool.spec.ts packages/mcp/__tests__/sync.spec.ts`; `pnpm exec vitest run --workspace vitest.workspace.ts --project bundler packages/workspace-assets/__tests__/prompt-builders.spec.ts` |
| C: independent room page            | Fixture-based room rendering, roster grouping, desktop and compact layout hooks. | `pnpm exec vitest run --workspace vitest.workspace.ts --project bundler.web apps/client/__tests__/room-event-message.spec.tsx apps/client/__tests__/room-participants.spec.ts apps/client/__tests__/room-attention-items.spec.ts`; Chrome smoke for `/rooms/:roomId`                                                                    |
| D: composer and target routing      | Default host routing, explicit targets, selected-target preview, submit payload. | `pnpm exec vitest run --workspace vitest.workspace.ts --project bundler.web apps/client/__tests__/room-participant-routing.spec.ts apps/client/__tests__/sender-completion.spec.ts`                                                                                                                                                     |
| E: navigation and conversation list | `/rooms/:roomId`, room list item selection, private run detail navigation.       | Add or run route/list tests once available; at minimum run the relevant client navigation specs and Chrome smoke for room-to-session navigation.                                                                                                                                                                                        |
| F: cleanup from prototype           | No room-specific UI in `ChatHistoryView`, single-session behavior unchanged.     | `pnpm exec vitest run --workspace vitest.workspace.ts --project bundler.web apps/client/__tests__/chat-session-messages.spec.ts apps/client/__tests__/chat-history-status-notices.spec.ts apps/client/__tests__/message-utils.spec.ts`; `pnpm tools message-actions verify --quiet` if sender or message-level behavior was touched.    |
| G: final verification               | Integrated quality gate and release readiness.                                   | `pnpm exec dprint check`; `pnpm exec eslint .`; `pnpm typecheck`; run the focused A-F tests that match merged changes; complete the Chrome smoke checklist below.                                                                                                                                                                       |

## Real Chrome Smoke Checklist

Use a cold Chrome instance with a separate profile when CDP debugging is needed. Do not reuse the user's daily browser profile. Start the app from the current worktree, reload after style or overlay changes, and record console warnings.

Desktop layout:

1. Open a room fixture or real multi-agent room at `/rooms/:roomId`.
2. Confirm the room is a group-chat surface, not the single-session operational transcript view.
3. Confirm user messages are right-aligned and agent messages are left-aligned with avatar, name, and useful subtitle or run label.
4. Confirm the right-side roster is visible, lists each member once, and expands to show multiple runs for the same member.
5. Confirm waiting attention appears as a normal agent bubble and increments the member pending count.
6. Submit a plain reply and verify the target preview or payload indicates host routing.
7. Select or type an explicit `@member` target and verify the selected-target preview is clear before submit.
8. Select or type an explicit `@member/run` target and verify the run target is preserved through submit.
9. Open a completed run from the roster and verify navigation goes to `/session/:sessionId` without embedding the private transcript in the room.
10. Check console output for React DOM nesting warnings, Ant deprecation warnings, failed network calls, and stale bundle warnings.

Compact layout:

1. Resize below the compact breakpoint or use device emulation.
2. Confirm the roster is collapsed or presented as a drawer, not a squeezed desktop sidebar.
3. Open and close the roster drawer; focus should return to the composer or triggering control.
4. Confirm message bubbles remain readable and do not overlap the composer.
5. Confirm the selected-target preview remains visible and does not hide the submit affordance.
6. Repeat waiting attention, explicit run target, completed run, and run detail navigation checks.

Required screenshot set for final signoff:

- desktop room with multiple members and visible roster;
- compact room with roster drawer;
- waiting attention message;
- selected `@member/run` target preview;
- completed run still grouped under its member;
- run detail navigation after opening a private session.

## Release Readiness Gaps

These gaps block Workstream G signoff until closed or explicitly deferred:

- No final integrated evidence yet that multi-agent task launch defaults to `/rooms/:roomId`.
- Runtime projection must prove private transcripts are not copied into public room messages.
- Composer routing needs negative coverage for missing, ambiguous, and empty explicit targets.
- Navigation cleanup needs evidence that private child sessions no longer clutter the top-level list by default.
- Workstream F must remove or rewrite prototype coverage that asserts room behavior inside `ChatHistoryView`.
- Real Chrome screenshots are not captured yet for desktop and compact Agent Room layouts.
- Full `pnpm typecheck`, `eslint`, and `dprint check` remain final-gate tasks after A-F finish merging.
