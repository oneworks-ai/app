# Pi Adapter

## Responsibility

This package adapts Pi coding-agent to the shared One Works Adapter contract. It owns CLI preparation, isolated Pi configuration, model-service translation, JSONL RPC, permission UI bridging, event normalization, and direct/RPC process lifecycle.

## Structure

- `src/runtime/common/`: pure mappings for args, input, models, permissions, and Pi events.
- `src/runtime/protocol/`: strict LF-delimited JSONL framing and correlated RPC requests.
- `src/runtime/session/`: filesystem/config preparation and process lifecycle.
- `src/index.ts`: stable adapter entry; do not put runtime logic here.
- `__tests__/`: Vitest protocol and realistic session scenarios.

## Boundaries

- Keep the shared Adapter interface unchanged.
- Do not write to the real `~/.pi/agent`; synchronize authentication into the locked, durable project-private native profile and keep generated model-service profiles session-private.
- Keep automatic Pi resources disabled. Selected One Works skills and the managed permission extension are explicit CLI paths; native extensions and their explicitly named tools are opt-in.
- Do not translate MCP until Pi exposes a stable native seam or a separately reviewed extension is added.
- Treat `message_end.message` as authoritative and `agent_settled` as the turn completion signal.
- Keep files near 200 lines; split pure mapping from I/O and process state.

## Verification

Run the package Vitest suite first, then workspace typecheck/format checks and a real `pi --mode rpc` startup smoke using an isolated temporary config/session directory.
