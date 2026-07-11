# CUA Driver Plugin

This package owns the OneWorks-facing lifecycle around the native Cua Driver.

- `bin/cua-driver.cjs` and `bin/runtime.cjs`: installation lookup, daemon startup, stale IPC recovery, and macOS permission preflight. These prerequisites must stay invisible to normal user tasks.
- `bin/cursor-runtime.cjs`: session-scoped pointer identity and motion, validated hex colors, runtime SVG generation, and the cross-process “motion/style + pointer action” lock. Apply motion through the live MCP session before its first pointer action; daemon preflight cannot configure a future multi-cursor session. The lock uses an atomic per-user loopback port bind so process exit releases ownership without stale-file recovery races. Every click-family action must pass through this transaction; never expose arbitrary image paths or raw style mutation tools to agents.
- `bin/mcp-proxy.cjs`: the OneWorks safety boundary around upstream MCP tools. Keep its explicit external allowlist narrow; physical-cursor movement, runtime-config mutation, cursor disabling, trajectory replay, and child-session recording must not be exposed. `set_session_cursor_color` is local state only and must not mutate the daemon until a serialized pointer action runs.
- `bin/workflow-runtime.cjs`: session-local serial workflow execution, semantic target resolution, bounded waits/checkpoints, compact results, and progressive step lookup. When no window is declared, select the app-title match or largest visible current-Space window rather than trusting upstream order. The only permitted internal runtime mutation is pinning upstream `capture_mode` to `ax` once per MCP session so semantic workflows never depend on unstable screenshot/SOM parsing. Keep durable cross-session orchestration outside this plugin.
- `mcp/cua-driver.json`: projects the upstream native CUA tools into agent sessions.
- `bin/evidence-mcp.cjs`: internal diagnostic utility for legacy trajectory artifacts. It is intentionally not projected from `mcp/`; child sessions must never receive recording-finalization tools.
- `skills/cua-driver/`: intent routing, workflow-first selection, and action semantics only. Do not move daemon commands, binary discovery, permission preflight, workflow execution guarantees, or media repair into the skill.
- `server/src/`: manager/workspace status and launcher integration; it is not the MCP transport owner.

Run `pnpm -C packages/plugins/cua-driver test`, `pnpm -C packages/plugins/cua-driver typecheck`, and the repository typecheck after changing plugin assets or runtime contracts.
