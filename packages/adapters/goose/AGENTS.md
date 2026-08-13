# Goose adapter

This package owns the native Goose CLI integration. Runtime traffic uses Goose's stable ACP v1 stdio server; do not route it through a repository-wide generic ACP layer.

- `src/runtime/` owns the isolated `GOOSE_PATH_ROOT`, ACP lifecycle, event projection, permissions, selected skills, MCP mapping, and native session cache.
- `src/managed-cli.ts` owns official release selection, digest verification, archive containment, atomic installation, and managed/system/path preparation.
- `src/history.ts` is the only native history boundary. It may call the public `goose session list/export --format json` commands and must never read Goose's private SQLite state.

Goose recipes, native hooks, and subagent history are not One Works-owned features. Keep their fallback explicit instead of materializing them into Goose configuration.

Validation: `pnpm vitest run packages/adapters/goose`, the relevant CLI/server/client/desktop tests, then repository typecheck, lint, dprint, diff-check, docs, and release preflight.
