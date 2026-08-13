# Qwen Code Adapter

This package is the single owner of the native Qwen Code CLI integration.

- `src/runtime/config.ts` owns isolated `QWEN_HOME` / `QWEN_RUNTIME_DIR`, safe inherited settings, model-service routing, selected skills, MCP, and system context.
- `src/runtime/session/` owns direct and headless process lifecycles plus native session resume.
- `src/protocol/` owns Qwen Code `stream-json` and partial-message projection.
- `src/runtime/native-hooks.ts` and `src/hook-bridge.ts` own the Qwen native hook bridge.
- Native history discovery/import remains in `apps/server/src/services/runtime-store/history-import.ts`; this package must not write or mutate native history.

The adapter must never link the complete real Qwen home into an isolated runtime. Qwen 0.21.x writes OAuth and MCP OAuth files during refresh, so those files are not linked or copied. Authentication is inherited through environment variables and explicit One Works model-service routing only.

Before changing protocol or filesystem behavior, read:

- `../../../.oo/rules/ADAPTERS.md`
- `../../../.oo/rules/adapter-design/runtime-config.md`
- `../../../.oo/rules/adapter-design/native-assets.md`
- `../../../.oo/rules/adapter-design/verification.md`
