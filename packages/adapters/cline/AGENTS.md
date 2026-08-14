# Cline Adapter

This package owns the Cline CLI integration. Keep its ACP lifecycle, capability gate, event projection, and fallback private to this package; do not add a shared ACP abstraction without proven matching semantics from another adapter.

- `src/runtime/session.ts`: persistent Cline ACP process and session lifecycle.
- `src/runtime/client.ts`: ACP event projection, permission bridge, replay suppression, and per-turn output accounting.
- `src/runtime/prepare.ts`: isolated HOME/config/data staging and adapter-owned official CLI flags.
- `src/runtime/fresh-json.ts`: explicitly fresh-only JSON fallback; it must never add `--id` or parse terminal UI.
- `src/cli-prepare.ts` and `src/paths.ts`: managed Cline 3.0.54 preparation and safe binary resolution.

Selected skills and session instructions are staged below the isolated config directory. Cline 3.0.54 ACP does not prove working MCP, native authentication inheritance, or native `--hooks-dir` behavior: keep them skipped, and translate hooks through the One Works event bridge without claiming native hook support.

Run the package tests before wider adapter registry and server history tests. Real CLI probes must use an isolated HOME/data dir and fake provider; never log prompts or credentials.
