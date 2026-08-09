# Runtime Broker Package

`@oneworks/runtime-broker` owns the transport-neutral contract and lifecycle core for resources that run in the manager process and are leased by workspace runtimes.

## Entry points

- `src/broker.ts`: driver registry, owner-bound leases, event/request delivery, timeout and stale-lease cleanup.
- `src/client.ts`: HTTP client transport and lease acquisition.
- `src/remote-lease.ts`: keepalive polling, at-most-once request dispatch, response retry, and idempotent invocation retry.
- `src/errors.ts`: transport error contract shared by the HTTP client and remote lease.
- `src/types.ts`: stable driver, lease and wire contracts.

## Boundaries

- The broker is adapter- and plugin-agnostic. Do not add Codex, hook, thread, JSON-RPC or plugin-specific fields here.
- A driver owns process spawning, pooling and operation semantics. The broker owns authentication-independent owner checks, lease lifecycle and bidirectional message correlation. Driver acquire/callback implementations receive an `AbortSignal` and must stop partially initialized or non-settling work when it fires.
- HTTP routing and token issuance belong to the server manager. This package accepts an already authenticated `ownerId`; it does not read server environment or Koa state.
- Server-to-resource callbacks use the same generic callback entry and are interpreted by the registered driver.
- `driver.acquire` must not await `context.request`: the lease is deliberately not pollable until acquisition finishes, and the broker rejects that phase with `lease_not_ready`.
- Polling must continue while server-to-workspace request handlers run. Advance the delivery cursor before dispatch, keep lifecycle events and business requests on separate ordered lanes, and carry one absolute broker deadline from enqueue through remote dispatch. Arm each request's `AbortSignal` when the envelope is accepted, skip expired handlers, and bound admission on both sides with validated finite integers and fixed package maxima so a busy lane cannot retain or execute stale work. Every request rejected by remote admission must keep its own `requestId` and receive a terminal response through the bounded, fixed-concurrency background rejection lane; never coalesce or drop later overflow responses after advancing their cursors, and never wait for a rejection transport slot in the poll/cursor ingestion path. Retry `respond` separately and keep it idempotent so an accepted-but-lost HTTP response cannot repeat business side effects.
- Every HTTP client timer option and per-call override is a validated bounded integer; derived poll/callback budgets must also stay inside the platform timer range. Every request, including raw client requests without an explicit override, has a hard transport deadline. Long-poll transport timeout must stay just above the server wait and below lease TTL; `respond` / `invoke` retry only with the same request or invocation ID after a hung response is aborted.
- Workspace-to-resource `invoke` retries must reuse `invocationId`; the broker deduplicates them within the bounded lease history.
- Resource callbacks require a stable `callbackId` across hard per-attempt and overall transport deadlines. Broker-side execution times out and aborts before the advertised retention horizon; its terminal tombstone survives ACK until that horizon ends, while lease release and broker disposal cancel immediately. Admission is bounded both per driver/profile/lease principal and by active-principal count, so one ACK failure or non-settling driver cannot starve unrelated adapters or profiles while total memory remains bounded.
- Manager transports must generation-bind callback capabilities. After a broker/driver swap, stale callback credentials fail closed instead of replaying an accepted callback into the new generation. Workspace lease credentials may remain generation-neutral so stale polling reaches the new broker and terminates with `lease_not_found`.
- Validate event cursor continuity both before and after a long-poll wait. A queue overflow during the wait must return terminal `event_gap`, never a truncated snapshot with an advanced cursor.
- `event_gap` is terminal for a remote lease. Acquisition has broker-side timeout/concurrency admission in addition to client HTTP timeout, and a successful slow acquire refreshes its heartbeat when the lease becomes pollable. Disposal rejects new work and aborts in-flight acquire/callback operations, then starts lease release and optional `driver.dispose` concurrently. Both cleanup paths have a broker-enforced deadline so a broken adapter/plugin cannot pin an old manager generation forever.

## Verification

- `pnpm --filter @oneworks/runtime-broker test`
- Cover fake-driver acquire/invoke/event/request/callback, cross-owner rejection, timeout and stale cleanup before changing the protocol.
